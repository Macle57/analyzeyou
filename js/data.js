// analyzeyou data layer: fetches a chess.com player's games from the public API,
// normalises them into compact `Game` objects and caches months in IndexedDB.
// Plain ES module, zero dependencies; runs in browsers and in Node 22.
// See docs/DATA.md for the full contract.

const API = 'https://api.chess.com/pub/player/';
const DB_NAME = 'analyzeyou';
const DB_STORE = 'months';
/** Bump when the stored (normalised) game shape changes; old entries are refetched. */
export const SCHEMA_VERSION = 2;
/** The current month (or a month cached before it ended) is reused for this long. */
const LIVE_TTL_MS = 5 * 60 * 1000;
/** A month counts as closed once it has been fetched this long after it ended. */
const CLOSE_MARGIN_MS = 60 * 60 * 1000;
/** A month that answered 404/410 is treated as empty for this long, then asked for again. */
const MISSING_TTL_MS = 60 * 60 * 1000;
/** At most this many months before the seed month are read, one at a time, to find rating baselines. */
const BASELINE_WALK_MONTHS = 6;
const CONCURRENCY = 2;
const MAX_TRIES = 3;
/** Seconds of wall clock per ply that chess.com does not charge to either clock (lag compensation, move transmission). Measured on real games, see docs/DATA.md. */
export const LAG_PER_PLY = 0.13;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class ChessDataError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ChessDataError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

// ---------------------------------------------------------------- usernames

const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

/** Returns the trimmed username, or throws a ChessDataError with code 'invalid'. */
export function validateUsername(username) {
  const name = String(username ?? '').trim();
  if (!name) throw new ChessDataError('invalid', 'Enter a chess.com username.');
  if (!USERNAME_RE.test(name)) {
    throw new ChessDataError(
      'invalid',
      `"${name}" isn't a valid chess.com username. Usernames are 3 to 25 letters, digits, underscores or hyphens.`,
    );
  }
  return name;
}

// ---------------------------------------------------------------- PGN helpers

/** Parses the `[Key "Value"]` header block of a PGN into an object. */
export function parsePgnHeaders(pgn) {
  const out = {};
  if (!pgn) return out;
  const re = /^\[(\w+) "([^"]*)"\]\s*$/gm;
  let m;
  while ((m = re.exec(pgn))) out[m[1]] = m[2];
  return out;
}

/** Returns the `%clk` values (seconds remaining after each ply, in ply order). Empty when absent. */
export function parseClocks(pgn) {
  const out = [];
  if (!pgn) return out;
  const re = /%clk (\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(pgn))) out.push(+m[1] * 3600 + +m[2] * 60 + +m[3]);
  return out;
}

/** Counts plies in the PGN movetext (used when clocks are absent). */
export function countPlies(pgn) {
  if (!pgn) return 0;
  const body = pgn.replace(/^\[.*\]\s*$/gm, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\([^()]*\)/g, ' ');
  let n = 0;
  for (const tok of body.split(/\s+/)) {
    const t = tok.replace(/^\d+\.(\.\.)?/, '');
    if (t && /^[KQRBNPOa-h@]/.test(t) && t !== '1-0' && t !== '0-1' && t !== '1/2-1/2') n++;
  }
  return n;
}

/** "180+2" -> {base:180, inc:2}; daily "1/86400" -> {base:86400, inc:0}. */
export function parseTimeControl(tc) {
  const s = String(tc ?? '');
  if (s.includes('/')) {
    const secs = Number(s.split('/')[1]);
    return { base: Number.isFinite(secs) ? secs : 0, inc: 0 };
  }
  const [b, i] = s.split('+');
  const base = Number(b);
  const inc = Number(i ?? 0);
  return { base: Number.isFinite(base) ? base : 0, inc: Number.isFinite(inc) ? inc : 0 };
}

function pgnDateTime(date, time) {
  if (!date || !time || !/^\d{4}\.\d{2}\.\d{2}$/.test(date) || !/^\d{1,2}:\d{2}:\d{2}$/.test(time)) return null;
  const t = Date.parse(`${date.replace(/\./g, '-')}T${time.padStart(8, '0')}Z`);
  return Number.isFinite(t) ? t : null;
}

const NAME_FIXES = [
  [/\bKings\b/g, "King's"],
  [/\bQueens\b/g, "Queen's"],
  [/\bBishops\b/g, "Bishop's"],
  [/\bAlekhines\b/g, "Alekhine's"],
  [/\bBirds\b/g, "Bird's"],
  [/\bOwens\b/g, "Owen's"],
  [/\bPetrovs\b/g, "Petrov's"],
  [/\bLarsens\b/g, "Larsen's"],
  [/\bPhilidors\b/g, "Philidor's"],
  [/\bCaro Kann\b/g, 'Caro-Kann'],
  [/\bNimzo Larsen\b/g, 'Nimzo-Larsen'],
  [/\bNimzowitsch Larsen\b/g, 'Nimzowitsch-Larsen'],
  [/\bMieses Kotrc\b/g, 'Mieses-Kotrč'],
  [/\bRuy Lopez\b/g, 'Ruy López'],
];

/** Readable opening name from a chess.com opening URL/slug, without the move-list tail. */
export function openingName(ecoUrl) {
  if (!ecoUrl) return null;
  let slug = String(ecoUrl).split('?')[0].replace(/\/+$/, '').split('/').pop() ?? '';
  try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
  const words = [];
  for (const tok of slug.split('-')) {
    if (/^\d+\./.test(tok)) break; // "8.d5", "1...f5"
    const dots = tok.indexOf('...');
    if (dots >= 0) { if (dots > 0) words.push(tok.slice(0, dots)); break; }
    if (tok) words.push(tok);
  }
  // chess.com files games it could not classify under /openings/Undefined; that is no opening name.
  if (!words.length || (words.length === 1 && /^(undefined|null)$/i.test(words[0]))) return null;
  let name = words.join(' ');
  for (const [re, rep] of NAME_FIXES) name = name.replace(re, rep);
  return name;
}

const FAMILY_END = /^(Opening|Defense|Defence|Gambit|Countergambit|Game|Attack|System)$/;

/** Coarse opening family ("Caro-Kann Defense Two Knights Attack" -> "Caro-Kann Defense"). */
export function openingFamily(name) {
  if (!name) return null;
  const words = name.split(' ');
  const i = words.findIndex((w) => FAMILY_END.test(w));
  return words.slice(0, i >= 0 ? i + 1 : Math.min(3, words.length)).join(' ');
}

// ---------------------------------------------------------------- normalisation

const DRAW_CODES = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const ENDING_OF = {
  checkmated: 'checkmate',
  resigned: 'resignation',
  timeout: 'timeout',
  abandoned: 'abandonment',
  stalemate: 'stalemate',
  repetition: 'repetition',
  agreed: 'agreement',
  insufficient: 'insufficient',
  '50move': 'fifty-move',
  timevsinsufficient: 'time-vs-insufficient',
  kingofthehill: 'variant',
  threecheck: 'variant',
  bughousepartnerlose: 'variant',
};
/** Endings produced by the final move itself: nobody was thinking when the game stopped. */
const ENDED_BY_MOVE = new Set(['checkmate', 'stalemate', 'repetition', 'insufficient', 'fifty-move', 'variant']);

/**
 * Converts a raw chess.com game into the compact `Game` shape, from the point of view of
 * `username` (case-insensitive). Returns null if the player did not take part.
 * `ratingDelta` is left null; see computeRatingDeltas().
 */
export function normalizeGame(raw, username) {
  if (!raw || !raw.white || !raw.black) return null;
  const me = String(username).toLowerCase();
  const isMe = (p) =>
    String(p.username ?? '').toLowerCase() === me ||
    String(p['@id'] ?? '').toLowerCase().endsWith(`/player/${me}`);
  const color = isMe(raw.white) ? 'white' : isMe(raw.black) ? 'black' : null;
  if (!color) return null;
  const oppColor = color === 'white' ? 'black' : 'white';
  const mine = raw[color];
  const theirs = raw[oppColor];

  const h = parsePgnHeaders(raw.pgn);
  const timeClass = raw.time_class ?? 'unknown';
  const live = timeClass !== 'daily';
  const rules = raw.rules ?? 'chess';
  const { base, inc } = parseTimeControl(raw.time_control ?? h.TimeControl);
  const end = Number.isFinite(raw.end_time) ? raw.end_time * 1000 : pgnDateTime(h.EndDate, h.EndTime) ?? 0;

  // Outcome / ending
  const myRes = mine.result;
  const oppRes = theirs.result;
  const outcome = myRes === 'win' ? 'win' : DRAW_CODES.has(myRes) ? 'draw' : 'loss';
  const code = outcome === 'win' ? oppRes : myRes;
  const ending = ENDING_OF[code] ?? 'other';

  // Plies and clocks
  const clocks = live ? parseClocks(raw.pgn) : [];
  const plies = clocks.length || countPlies(raw.pgn);
  const firstMover = String(raw.initial_setup ?? h.FEN ?? '').split(' ')[1] === 'b' ? 'black' : 'white';
  const moverOf = (ply) => ((ply % 2 === 0) === (firstMover === 'white') ? 'white' : 'black');
  const moves = color === firstMover ? Math.ceil(plies / 2) : Math.floor(plies / 2);
  const toMove = moverOf(plies); // side whose clock was running when the game stopped

  // Start time
  let start = pgnDateTime(h.UTCDate, h.UTCTime);
  if (start == null && Number.isFinite(raw.start_time)) start = raw.start_time * 1000;
  if (start == null && h.StartTime) {
    let s = pgnDateTime(h.EndDate ?? h.Date, h.StartTime);
    if (s != null && s > end) s -= 86400000;
    start = s;
  }
  let used = null; // clock-charged seconds per side
  let left = null; // clock remaining per side
  if (clocks.length) {
    used = { white: 0, black: 0 };
    left = { white: base, black: base };
    const n = { white: 0, black: 0 };
    clocks.forEach((c, i) => { const s = moverOf(i); left[s] = c; n[s]++; });
    for (const s of ['white', 'black']) used[s] = Math.max(0, base + n[s] * inc - left[s]);
  }
  // Think time: clock-charged time, plus the final think of the side on move.
  let think = null;
  const flagged = ending === 'timeout' || ending === 'time-vs-insufficient';
  if (live && used) {
    think = { ...used };
    if (flagged) {
      // The flagger burned their whole remaining clock.
      const flagger = ending === 'timeout' ? (outcome === 'win' ? oppColor : color) : toMove;
      think[flagger] += left[flagger];
      left[flagger] = 0;
    }
  }
  // Last-resort start: back from the end by all known think time (a flagger's last clock included),
  // rounded up to whole seconds so think time can never exceed the duration.
  if (start == null) start = think ? end - Math.ceil(think.white + think.black) * 1000 : end;
  if (start > end) start = end;
  const duration = live ? Math.max(0, Math.round((end - start) / 1000)) : 0;
  if (think && !flagged && !ENDED_BY_MOVE.has(ending)) {
    // Resignation, agreement, abandonment, other: the side on move was on the clock.
    const remainder = duration - used.white - used.black - LAG_PER_PLY * plies;
    const extra = Math.min(Math.max(0, remainder), left[toMove]);
    think[toMove] += extra;
    left[toMove] -= extra;
  }
  const r1 = (x) => Math.round(x * 10) / 10;

  return {
    id: raw.uuid || raw.url,
    url: raw.url ?? null,
    start,
    end,
    duration,
    live,
    timeClass,
    timeControl: String(raw.time_control ?? h.TimeControl ?? ''),
    base,
    inc,
    rules,
    rated: !!raw.rated,
    pool: `${rules}:${timeClass}`,
    color,
    opponent: theirs.username ?? null,
    myRating: Number.isFinite(mine.rating) ? mine.rating : null,
    oppRating: Number.isFinite(theirs.rating) ? theirs.rating : null,
    outcome,
    ending,
    moves,
    plies,
    myThink: think ? r1(think[color]) : null,
    oppThink: think ? r1(think[oppColor]) : null,
    myClockLeft: live && left ? r1(left[color]) : null,
    oppClockLeft: live && left ? r1(left[oppColor]) : null,
    ratingDelta: null,
    opening: openingName(raw.eco ?? h.ECOUrl),
    eco: h.ECO && h.ECO !== '?' ? h.ECO : null,
    myAccuracy: Number.isFinite(raw.accuracies?.[color]) ? raw.accuracies[color] : null,
    oppAccuracy: Number.isFinite(raw.accuracies?.[oppColor]) ? raw.accuracies[oppColor] : null,
  };
}

/**
 * Sets `ratingDelta` on every game (mutates): my rating minus my rating after the previous
 * rated game of the same pool, ordered by end time. Null for unrated games and for the first
 * known rated game of a pool.
 * `gaps` lists `[startMs, endMs)` spans whose games are unknown (months that failed to load).
 * A delta is never taken across a gap: the next rated game of each pool after one gets null.
 */
export function computeRatingDeltas(games, gaps = []) {
  const order = [...games].sort((a, b) => a.end - b.end || a.start - b.start);
  const last = new Map(); // pool -> { rating, end }
  const crossesGap = (from, to) => gaps.some(([s, e]) => from < e && to >= s);
  for (const g of order) {
    g.ratingDelta = null;
    if (!g.rated || g.myRating == null) continue;
    const prev = last.get(g.pool);
    if (prev && !crossesGap(prev.end, g.end)) g.ratingDelta = g.myRating - prev.rating;
    last.set(g.pool, { rating: g.myRating, end: g.end });
  }
  return games;
}

/** True when `url` is an https link on chess.com or one of its subdomains (safe to use as an href). */
export function isChessComUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'chess.com' || host.endsWith('.chess.com'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- months

const pad2 = (n) => String(n).padStart(2, '0');
const utcMonthKey = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}`; };
const monthEndMs = (key) => { const [y, m] = key.split('/').map(Number); return Date.UTC(y, m, 1); };
const monthStartMs = (key) => { const [y, m] = key.split('/').map(Number); return Date.UTC(y, m - 1, 1); };
function prevMonthKey(key) { const [y, m] = key.split('/').map(Number); return m === 1 ? `${y - 1}/12` : `${y}/${pad2(m - 1)}`; }
const monthLabel = (key) => { const [y, m] = key.split('/'); return `${MONTHS[+m - 1]} ${y}`; };
function nextMonthKey(key) { const [y, m] = key.split('/').map(Number); return m === 12 ? `${y + 1}/01` : `${y}/${pad2(m + 1)}`; }
function monthsBetween(lo, hi) { const out = []; for (let k = lo; k <= hi; k = nextMonthKey(k)) out.push(k); return out; }

// ---------------------------------------------------------------- HTTP

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const t = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(abortError()); };
  signal?.addEventListener?.('abort', onAbort, { once: true });
});
const abortError = () => new ChessDataError('aborted', 'Loading was cancelled.');

/** GET JSON with retries. Resolves to {status, data}; 404 resolves with data = null. */
async function getJson(url, { fetchImpl, signal, retryBaseMs = 800 }) {
  let lastStatus = 0;
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (signal?.aborted) throw abortError();
    let retryAfter = 0;
    try {
      const res = await fetchImpl(url, signal ? { signal } : undefined);
      lastStatus = res.status;
      if (res.ok) return { status: res.status, data: await res.json() };
      if (res.status === 404 || res.status === 410) return { status: res.status, data: null };
      if (res.status !== 429 && res.status < 500) {
        throw new ChessDataError('network', `Chess.com answered with an unexpected error (${res.status}). Try again in a moment.`);
      }
      retryAfter = Number(res.headers?.get?.('retry-after')) || 0;
    } catch (err) {
      if (err instanceof ChessDataError) throw err;
      if (signal?.aborted || err?.name === 'AbortError') throw abortError();
      lastErr = err;
      lastStatus = 0;
    }
    if (attempt < MAX_TRIES - 1) {
      const backoff = Math.max(retryAfter * 1000, retryBaseMs * 3 ** attempt) + Math.random() * (retryBaseMs / 3);
      await sleep(Math.min(backoff, 15000), signal);
    }
  }
  if (lastStatus === 429) {
    throw new ChessDataError('rate_limited', 'Chess.com is limiting requests right now. Wait a minute and try again.');
  }
  throw new ChessDataError('network', "Couldn't reach chess.com. Check your connection and try again.", lastErr ?? undefined);
}

// ---------------------------------------------------------------- IndexedDB cache

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
      const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(DB_STORE)) db.deleteObjectStore(DB_STORE);
        db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idb(mode, fn) {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, mode);
        const req = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve(req?.result ?? null);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

const cacheGet = (key) => idb('readonly', (s) => s.get(key));
const cachePut = (key, value) => idb('readwrite', (s) => s.put(value, key));

/** Removes every cached month. Never throws. */
export async function clearCache() {
  await idb('readwrite', (s) => s.clear());
}

// ---------------------------------------------------------------- main entry

/** Runs `worker` over `items`, `limit` at a time. After the first rejection no further item is started. */
async function pool(items, limit, worker) {
  let next = 0;
  let failed = false;
  const run = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try { await worker(items[i], i); } catch (err) { failed = true; throw err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

/**
 * Fetches a player's profile and the games whose start lies in [from, to].
 * @param {string} username
 * @param {{from?: Date|null, to?: Date|null, onProgress?: Function, signal?: AbortSignal,
 *          fetch?: typeof fetch, cache?: boolean, cacheStore?: {get: Function, put: Function},
 *          now?: number, retryBaseMs?: number}} [opts]
 *   `fetch` (custom fetch implementation), `cache` (default true), `cacheStore` (replaces
 *   IndexedDB: async `get(key)` / `put(key, value)`), `now` and `retryBaseMs` (first retry
 *   delay, default 800 ms) are for scripts/tests.
 */
export async function fetchPlayerGames(username, opts = {}) {
  const name = validateUsername(username);
  const outer = opts.signal;
  if (outer?.aborted) throw abortError();
  // One controller per call: aborted by the caller's signal, and by this call itself when a month
  // fails fatally, so requests still in flight and months not yet started stop at once.
  const inner = new AbortController();
  const onAbort = () => inner.abort();
  outer?.addEventListener?.('abort', onAbort, { once: true });
  try {
    return await loadPlayer(name, opts, inner.signal);
  } catch (err) {
    inner.abort();
    throw outer?.aborted ? abortError() : err;
  } finally {
    outer?.removeEventListener?.('abort', onAbort);
  }
}

async function loadPlayer(name, opts, signal) {
  const { from = null, to = null, cache = true, retryBaseMs = 800 } = opts;
  const report = opts.onProgress;
  const onProgress = report ? (p) => { if (!signal.aborted) report(p); } : null;
  const fetchImpl = opts.fetch ?? globalThis.fetch?.bind(globalThis);
  const now = opts.now ?? Date.now();
  const store = opts.cacheStore ?? { get: cacheGet, put: cachePut };
  const lower = name.toLowerCase();
  const warnings = [];
  if (!fetchImpl) throw new ChessDataError('network', "This browser can't make network requests.");

  // Profile
  const prof = await getJson(`${API}${encodeURIComponent(lower)}`, { fetchImpl, signal, retryBaseMs });
  if (!prof.data) {
    throw new ChessDataError('not_found', `No chess.com player is called "${name}". Check the spelling.`);
  }
  const p = prof.data;
  const player = {
    username: canonicalName(p, lower, name),
    name: p.name ?? null,
    avatar: p.avatar ?? null,
    url: isChessComUrl(p.url) ? p.url : `https://www.chess.com/member/${lower}`,
    country: /\/country\/([A-Za-z]{2})$/.exec(p.country ?? '')?.[1]?.toUpperCase() ?? null,
    joined: Number.isFinite(p.joined) ? p.joined * 1000 : null,
  };

  // Archive list. chess.com's CDN sometimes serves a stale 404 for it; a query string bypasses that.
  const archUrl = `${API}${encodeURIComponent(lower)}/games/archives`;
  let arch = await getJson(archUrl, { fetchImpl, signal, retryBaseMs });
  if (!arch.data) arch = await getJson(`${archUrl}?_=${now}`, { fetchImpl, signal, retryBaseMs });
  let available = null;
  if (arch.data && Array.isArray(arch.data.archives)) {
    available = arch.data.archives
      .map((u) => /(\d{4})\/(\d{2})\/?$/.exec(u))
      .filter(Boolean)
      .map((m) => `${m[1]}/${m[2]}`)
      .sort();
  }

  const currentMonth = utcMonthKey(now);
  // Months whose (UTC, by end time) archives can hold games starting in [from, to] in any timezone.
  const lo = from ? utcMonthKey(from.getTime() - 14 * 3600e3) : null;
  let hi = to ? utcMonthKey(to.getTime() + 18 * 3600e3) : currentMonth;
  if (hi > currentMonth) hi = currentMonth;
  const joinedKey = player.joined ? utcMonthKey(player.joined) : '2007/01';
  let wanted;
  let seed = null;
  let firstArchive = null;
  if (available) {
    firstArchive = available.length ? available[0].replace('/', '-') : null;
    wanted = available.filter((k) => (lo == null || k >= lo) && k <= hi);
    if (lo != null) seed = available.filter((k) => k < lo).pop() ?? null;
  } else {
    warnings.push("Chess.com didn't return this player's list of monthly archives, so every month in the range was requested directly.");
    const start = lo == null || lo < joinedKey ? joinedKey : lo;
    const end = hi > currentMonth ? currentMonth : hi;
    wanted = start <= end ? monthsBetween(start, end) : [];
    if (lo != null && lo > joinedKey) seed = prevMonthKey(lo);
  }
  const toFetch = seed ? [seed, ...wanted] : wanted;

  // Fetch months
  const byMonth = new Map();
  const failures = [];
  const ctx = { fetchImpl, signal, cache, store, now, currentMonth, failures, retryBaseMs };
  let done = 0;
  let total = toFetch.length;
  onProgress?.({ done, total, label: total ? `Loading ${monthLabel(toFetch[0])}` : 'Nothing to load' });
  await pool(toFetch, CONCURRENCY, async (key) => {
    const games = await loadMonth(lower, key, ctx);
    if (signal.aborted) return;
    byMonth.set(key, games);
    done++;
    onProgress?.({ done, total, label: monthLabel(key) });
  });
  const failed = new Set(failures.map((f) => f.key));
  const rangeFailed = wanted.filter((k) => failed.has(k));
  if (rangeFailed.length && rangeFailed.length === wanted.length) {
    // Every month that can hold games of the range failed; a loaded seed month does not make that a result.
    throw failures.find((f) => f.key === rangeFailed[0]).error;
  }
  if (rangeFailed.length) {
    warnings.push(
      `Couldn't load ${rangeFailed.map(monthLabel).join(', ')}; numbers for ${rangeFailed.length === 1 ? 'that month' : 'those months'} are missing.`,
    );
  }

  const fromMs = from ? from.getTime() : -Infinity;
  const toMs = to ? to.getTime() : Infinity;
  const inRange = (g) => g.start >= fromMs && g.start <= toMs;

  // Rating baselines: a pool played in the range but not in the seed month has no earlier game to
  // measure its first delta against. Walk further back, one month at a time and at most
  // BASELINE_WALK_MONTHS months, until every such pool has a baseline. Skipped when the seed failed.
  const need = poolsWithoutBaseline(byMonth, inRange);
  if (need.size && seed && !failed.has(seed)) {
    const earlier = [];
    if (available) earlier.push(...available.filter((k) => k < seed).reverse().slice(0, BASELINE_WALK_MONTHS));
    else for (let k = prevMonthKey(seed); k >= joinedKey && earlier.length < BASELINE_WALK_MONTHS; k = prevMonthKey(k)) earlier.push(k);
    for (const key of earlier) {
      total++;
      onProgress?.({ done, total, label: `Looking for earlier ratings in ${monthLabel(key)}` });
      const before = failures.length;
      const games = await loadMonth(lower, key, ctx);
      if (failures.length > before) break; // nothing before a failed month can be a baseline
      byMonth.set(key, games);
      done++;
      onProgress?.({ done, total, label: monthLabel(key) });
      for (const g of games) if (g.rated && g.myRating != null) need.delete(g.pool);
      if (!need.size) break;
    }
  }

  // Merge, rating deltas, filter
  const seen = new Set();
  const all = [];
  for (const games of byMonth.values()) {
    for (const g of games) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      all.push({ ...g });
    }
  }
  computeRatingDeltas(all, failures.map((f) => [monthStartMs(f.key), monthEndMs(f.key)]));
  const games = all.filter(inRange).sort((a, b) => a.start - b.start || a.end - b.end);

  // Daily games are filed under the month they end in. One that started in the range but ended after
  // the last fetched month is not loaded; say so instead of making extra requests.
  if (hi < currentMonth && wanted.some((k) => byMonth.get(k)?.some((g) => g.timeClass === 'daily'))) {
    warnings.push(`Daily games that started in this range but ended after ${monthLabel(hi)} are not counted.`);
  }
  return { player, games, firstArchive, warnings, failedMonths: rangeFailed.map((k) => k.replace('/', '-')) };
}

/** Pools whose earliest loaded rated game starts inside the range, so nothing loaded precedes it. */
function poolsWithoutBaseline(byMonth, inRange) {
  const first = new Map();
  for (const games of byMonth.values()) {
    for (const g of games) {
      if (!g.rated || g.myRating == null) continue;
      const f = first.get(g.pool);
      if (!f || g.end < f.end) first.set(g.pool, g);
    }
  }
  const out = new Set();
  for (const [pool, g] of first) if (inRange(g)) out.add(pool);
  return out;
}

/** Profile `username` is lowercase; the profile URL carries the canonical casing. */
function canonicalName(p, lower, typed) {
  const seg = String(p.url ?? '').replace(/\/+$/, '').split('/').pop();
  if (seg && seg.toLowerCase() === lower) return seg;
  return p.username ?? typed;
}

async function loadMonth(user, key, { fetchImpl, signal, cache, store, now, currentMonth, failures, retryBaseMs }) {
  const cacheKey = `${user}|${key}`;
  if (cache) {
    let hit = null;
    try { hit = await store.get(cacheKey); } catch { /* treat as a miss */ }
    if (hit && hit.v === SCHEMA_VERSION && Array.isArray(hit.games)) {
      if (hit.missing) {
        if (now - hit.fetchedAt < MISSING_TTL_MS) return hit.games;
      } else {
        const closed = key < currentMonth && hit.fetchedAt >= monthEndMs(key) + CLOSE_MARGIN_MS;
        if (closed || now - hit.fetchedAt < LIVE_TTL_MS) return hit.games;
      }
    }
  }
  let res;
  try {
    res = await getJson(`${API}${encodeURIComponent(user)}/games/${key}`, { fetchImpl, signal, retryBaseMs });
  } catch (err) {
    if (err.code === 'aborted' || err.code === 'rate_limited') throw err;
    failures.push({ key, error: err });
    return [];
  }
  const raw = res.data?.games ?? [];
  const games = [];
  for (const r of raw) {
    const g = normalizeGame(r, user);
    if (g) games.push(g);
  }
  // A 404/410 can be a stale CDN answer for a month that does have games, so it is only kept for
  // MISSING_TTL_MS and never as a closed month.
  const entry = { v: SCHEMA_VERSION, fetchedAt: now, games };
  if (res.data == null) entry.missing = true;
  if (cache) {
    try { await store.put(cacheKey, entry); } catch { /* caching is best effort */ }
  }
  return games;
}
