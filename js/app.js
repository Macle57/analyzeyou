import { fetchPlayerGames, clearCache, isChessComUrl } from './data.js';
import { analyze } from './analyze.js';
import { dayChart, lineChart, colChart, showTip, hideTip, tipBox, setTip, maxOf, histTicks, readout, liveRegion } from './charts.js';
import { verdict, planQuips, stickers, equivalents, pawnMark, parseMood, lineup } from './fun.js';
import { NB, MINUS, num, dur, durT, durWords, clockText, pct, avg, per, plural } from './format.js';

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
  return n;
}
// "**bold** text" -> nodes, without ever touching innerHTML (names come from an API).
function rich(str) {
  const f = document.createDocumentFragment();
  str.split('**').forEach((part, i) => { if (part) f.append(i % 2 ? el('b', { text: part }) : part); });
  return f;
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

// Short month names of one length: en-GB writes "Sept" beside "Aug", and es "sept" beside "ago". When a
// locale's short months are Latin script, mostly three letters already (8 of 12 or more), and three
// letters keep all twelve apart, every month is written as its first three letters, without a period
// (en-GB "Sep", de "Jan Feb Mär … Dez", the DIN form). Any other locale (French "juin"/"juil.",
// Finnish, non-Latin scripts) keeps its own forms, since a cut there would invent abbreviations.
const MON3 = (() => {
  try {
    const f = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const names = Array.from({ length: 12 }, (_, m) => f.formatToParts(new Date(2024, m, 15)).find((p) => p.type === 'month')?.value || '');
    const bare = names.map((n) => n.replace(/\.$/, ''));
    if (!bare.some((n) => n.length > 3) || bare.filter((n) => n.length <= 3).length < 8) return null;
    if (!bare.every((n) => /^\p{Script=Latin}+$/u.test(n))) return null;
    const cut = bare.map((n) => n.slice(0, 3));
    return new Set(cut.map((c) => c.toLowerCase())).size === 12 ? cut : null;
  } catch { return null; }
})();
/** A formatter whose month part uses MON3 (when the locale gets one); same `format` as Intl's. */
const mon3 = (df) => (MON3 ? { format: (d) => df.formatToParts(d).map((p) => (p.type === 'month' ? MON3[d.getMonth()] : p.value)).join('') } : df);
const dfShort = mon3(new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }));
const dfLong = mon3(new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
const dfMed = mon3(new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
const dfMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dfMonShort = mon3(new Intl.DateTimeFormat(undefined, { month: 'short' }));
const dfMonYear = mon3(new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }));
const dfDayMon = mon3(new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
const PHONE = matchMedia('(max-width: 600px)');
const dfTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dfHour = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const dfDow = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const dfDowShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dowName = (dow, short) => (short ? dfDowShort : dfDow).format(new Date(2024, 0, 1 + dow)); // 2024-01-01 was a Monday
const H12 = /[a-z]/i.test(dfHour.format(new Date(2024, 0, 1, 15)));
const hourName = (h) => (H12 ? dfHour.format(new Date(2024, 0, 1, h)).replace(/\s/g, ' ').toLowerCase() : `${pad(h)}:00`);
// The one rule for short dates: when the range on screen touches more than one calendar year, every
// date carries its year ("14 Mar" across nine years says nothing). Set once per render.
let multiYear = false;
/** A short date: "14 Oct", or "14 Oct 2025" on a range that spans years. Takes 'YYYY-MM-DD' or a timestamp. */
const sd = (x) => (multiYear ? dfMed : dfShort).format(typeof x === 'string' ? parseYmd(x) : new Date(x));
/** Two short dates as a span, or one date when both ends are the same day. */
const sdSpan = (a, b) => (ymd(new Date(typeof a === 'string' ? parseYmd(a) : a)) === ymd(new Date(typeof b === 'string' ? parseYmd(b) : b)) ? sd(a) : `${sd(a)} to ${sd(b)}`);

// Same value as nodes, with small unit letters, for the big tile figures.
function durNode(s) {
  const f = document.createDocumentFragment();
  for (const part of dur(s).split(NB)) {
    const mt = part.match(/^([\d,.–]+)([a-z]*)$/);
    if (!mt) { f.append(part); continue; }
    f.append(mt[1]);
    if (mt[2]) f.append(el('small', { text: mt[2] }));
  }
  return f;
}
// The digits on a face in groups, each with its unit printed small under it, so 1,062 hours can never
// be read as minutes and seconds. `long` (1,000 hours or more) drops the seconds to fit the glass.
function clockParts(s, long) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return long ? [[String(h), 'h'], [pad(m), 'm']] : [[String(h), 'h'], [pad(m), 'm'], [pad(r), 's']];
}
function paintLcd(node, s, long) {
  const parts = clockParts(s, long);
  if (node.childElementCount !== parts.length) {
    node.replaceChildren(...parts.flatMap(([, u], i) => [i ? ':' : null, el('span', { class: 'lg' }, el('b'), el('small', { text: u }))]).filter(Boolean));
  }
  [...node.children].forEach((g, i) => { g.firstChild.textContent = parts[i][0]; });
}
const signed = (n) => (n > 0 ? '+' : n < 0 ? MINUS : '') + num(Math.abs(n));
const rate = (o) => (o && o.games ? o.wins / o.games : null);
const wdl = (o) => `${num(o.wins)}–${num(o.draws)}–${num(o.losses)}`;
const dateStr = (s, f = dfMed) => f.format(parseYmd(s));
// Rating won and lost in running text: a zero is a dash, never "+0" or "−0".
const gain = (n) => (n ? `+${num(n)}` : '–');
const loss = (n) => (n ? `${MINUS}${num(n)}` : '–');
/** A net rating change with its two sides, "+18 (+56 −38)"; one-sided days are just the net. */
const netText = (net, g, l) => (g && l ? `${signed(net)} (+${num(g)} ${MINUS}${num(l)})` : signed(net));
// A sideways-scrolling strip (calendar, heatmap) fades at whichever edge has more to show.
function cue(wrap) {
  const box = wrap.parentElement;
  const upd = () => {
    box.toggleAttribute('data-l', wrap.scrollLeft > 6);
    box.toggleAttribute('data-r', wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 6);
  };
  if (!wrap.dataset.cue) { wrap.dataset.cue = '1'; wrap.addEventListener('scroll', upd, { passive: true }); }
  upd();
}
/** "Aug 30 to Sep 2", or one date when both ends are the same day. `a`, `b` are 'YYYY-MM-DD'. */
const dateSpan = (a, b, f = dfMed) => (a === b ? dateStr(a, f) : `${dateStr(a, f)} to ${dateStr(b, f)}`);

// Replaces a region's children and, if the focus was inside it, puts the focus back on the control
// that matches it in the new content (same data-fk), so re-rendering never drops the focus to <body>.
function swap(root, ...kids) {
  const a = document.activeElement, fk = a && a !== root && root.contains(a) ? a.dataset.fk : null;
  root.replaceChildren(...kids);
  if (fk != null) root.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
}
// One tab stop for a grid of marks: arrow keys move between `cells`, `step(i, key)` gives the next index.
function rove(root, cells, active, step, onActive) {
  cells.forEach((c, i) => { c.tabIndex = i === active ? 0 : -1; });
  const first = !root.rove;
  root.rove = { cells, step, onActive }; // the listeners below are added once and read the latest cells
  if (!first) return;
  root.addEventListener('focusin', (ev) => {
    const { cells, onActive } = root.rove, i = cells.indexOf(ev.target);
    if (i < 0) return;
    cells.forEach((c, j) => { c.tabIndex = j === i ? 0 : -1; });
    onActive(i);
  });
  root.addEventListener('keydown', (ev) => {
    const { cells, step } = root.rove, i = cells.indexOf(ev.target);
    if (i < 0 || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const j = step(i, ev.key);
    if (j == null) return;
    ev.preventDefault();
    cells[Math.max(0, Math.min(cells.length - 1, j))].focus();
  });
}

const CLASS_LABEL = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' };
const CLASSES = [
  { key: 'bullet', cls: 'f-t1', label: 'Bullet' },
  { key: 'blitz', cls: 'f-t2', label: 'Blitz' },
  { key: 'rapid', cls: 'f-t3', label: 'Rapid' },
];
const ENDING = {
  checkmate: 'Checkmate', resignation: 'Resignation', timeout: 'Out of time', abandonment: 'Abandoned',
  stalemate: 'Stalemate', repetition: 'Repetition', agreement: 'Agreed draw', insufficient: 'Insufficient material',
  'fifty-move': '50-move rule', 'time-vs-insufficient': 'Timeout, no mating material', variant: 'Variant rule', other: 'Other',
};
function controlLabel(g) {
  if (g.timeClass === 'daily') { const d = g.base / 86400; return `${d >= 1 ? Math.round(d) : '<1'} day${d > 1.5 ? 's' : ''} per move`; }
  if (!g.base) return g.timeControl || '';
  const b = g.base % 60 === 0 ? `${g.base / 60}` : `${g.base}s`;
  return g.inc ? `${b}${g.base % 60 === 0 ? '' : ''} | ${g.inc}` : g.base % 60 === 0 ? `${b} min` : b;
}
function poolLabel(p) {
  const tc = CLASS_LABEL[p.timeClass] || p.timeClass;
  if (p.rules === 'chess') return tc;
  const r = { chess960: 'Chess960', bughouse: 'Bughouse', kingofthehill: 'King of the Hill', threecheck: '3-check', crazyhouse: 'Crazyhouse' }[p.rules] || p.rules;
  return `${r} ${tc.toLowerCase()}`;
}

// ---------- state ----------
const S = {
  users: [], focus: 0, preset: '30', from: '', to: '',
  tc: 'all', rated: false, gran: 'auto', heat: 'time', pool: null,
  sel: null, sort: { k: 'date', dir: -1 }, hideEmpty: true,
};
const store = new Map(); // lowercased username -> { state, player, games, stats, error }
let ctrl = null;
let runId = 0;
const DEFAULT_TITLE = document.title;
// ?mood=0..6 forces a verdict level, so each one can be seen without finding a player who fits.
const MOOD = parseMood(new URLSearchParams(location.search).get('mood'));

const key = (u) => u.toLowerCase();
const focusEntry = () => store.get(key(S.users[S.focus] || ''));

function applyPreset(p) {
  S.preset = p;
  const t = today();
  S.to = ymd(t);
  S.from = p === 'all' ? '' : ymd(addDays(t, -(Number(p) - 1)));
}

// The form accepts "@name" and spaces around it; links get the same treatment.
const cleanName = (s) => String(s || '').trim().replace(/^@/, '').trim();
// Days after today cannot hold games: a date in the future means today.
const notAfterToday = (s) => { const t = ymd(today()); return s && s > t ? t : s; };

function readUrl() {
  const q = new URLSearchParams(location.search);
  const u = (q.get('u') || '').split(',').map(cleanName).filter(Boolean).slice(0, 4);
  S.users = [...new Map(u.map((x) => [key(x), x])).values()];
  const range = q.get('range');
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parseYmd(s));
  const from = okDate(q.get('from')) ? notAfterToday(q.get('from')) : q.get('from'), to = okDate(q.get('to')) ? notAfterToday(q.get('to')) : null;
  if (to && (okDate(from) || from === '') && !(from && from > to)) { S.preset = null; S.from = from; S.to = to; }
  else applyPreset(['7', '30', '90', '365', 'all'].includes(range) ? range : '30');
  S.tc = ['bullet', 'blitz', 'rapid', 'daily'].includes(q.get('tc')) ? q.get('tc') : 'all'; // also on Back, so no else keeps a stale filter
  S.rated = q.get('rated') === '1';
  S.pool = /^[a-z0-9]+:[a-z]+$/.test(q.get('pool') || '') ? q.get('pool') : null;
  const f = S.users.findIndex((x) => key(x) === key(q.get('focus') || ''));
  S.focus = f >= 0 ? f : 0;
}
// `st` defaults to the page state; a lookup that failed for a reason a reload can fix passes the attempted state.
function writeUrl(st = S) {
  const q = new URLSearchParams();
  if (st.users.length) q.set('u', st.users.join(','));
  if (st.preset) q.set('range', st.preset); else { q.set('from', st.from); q.set('to', st.to); }
  if (S.tc !== 'all') q.set('tc', S.tc);
  if (S.rated) q.set('rated', '1');
  if (S.pool) q.set('pool', S.pool);
  if (st.focus > 0 && st.users[st.focus]) q.set('focus', st.users[st.focus]);
  if (MOOD != null) q.set('mood', String(MOOD));
  const s = q.toString(), url = s ? `?${s.replace(/%2C/g, ',')}` : location.pathname;
  // A new main player or a new set of players is a new page in the history, so Back returns to the
  // previous search; range, filters, focus and rating list only update the current entry. Nothing is
  // pushed while the page follows its own URL (first load, Back and Forward).
  const shown = (new URLSearchParams(location.search).get('u') || '').split(',').map(cleanName).filter(Boolean).map(key).join(',');
  if (!followingUrl && st.users.map(key).join(',') !== shown) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}
// True while the players on screen come from the URL (the first load, Back, Forward) rather than from
// something done on the page; set back to false by every action that changes the players.
let followingUrl = true;
/** The range a store entry was loaded for, so Back can tell whether it still fits. */
const rangeKey = () => `${S.preset}|${S.from}|${S.to}`;

// ---------- controls ----------
function syncControls(keepTyped) {
  if (!keepTyped || !$('user').value) $('user').value = S.users[0] || $('user').value;
  $('from').value = S.from; $('to').value = S.to;
  $('to').max = ymd(today()); $('from').max = ymd(today());
  for (const b of $('presets').children) b.setAttribute('aria-pressed', String(b.dataset.preset === S.preset));
}
// Every message shown bumps msgSeq, so a run can tell whether a newer message came up while it loaded
// and leave that one alone.
let msgSeq = 0;
function showMsg(text) { const m = $('formMsg'); m.textContent = text || ''; m.hidden = !text; if (text) msgSeq++; }
// The comparison's own message sits beside its field; the next edit clears it.
function showAddMsg(text) { const m = $('addMsg'); m.textContent = text || ''; m.hidden = !text; }
let pendingAdd = null; // a name from "Compare with…" whose lookup is running
function setStatus(text, frac) {
  $('status').hidden = text == null;
  if (text != null) { $('statusText').textContent = text; $('barFill').style.width = `${Math.round((frac || 0) * 100)}%`; }
  $('go').disabled = text != null;
}

function seg(root, options, value, onPick) {
  swap(root, ...options.map((o) => el('button', {
    type: 'button', text: o.label, 'aria-pressed': String(o.value === value), disabled: o.disabled, 'data-fk': String(o.value),
    onclick: () => onPick(o.value),
  })));
}

// ---------- loading ----------
function rangeDates() {
  return { from: S.from ? parseYmd(S.from) : null, to: endOfDay(S.to ? parseYmd(S.to) : today()) };
}
function compute(e) {
  const { from, to } = rangeDates();
  const games = e.games.filter((g) => (S.tc === 'all' || g.timeClass === S.tc) && (!S.rated || g.rated));
  e.view = games;
  e.stats = analyze(games, { from, to, gaps: gapsOf(e) });
}
/** The months that failed to load, as [startMs, endMs) spans (chess.com files games by UTC month). */
const gapsOf = (e) => (e.failedMonths || []).map((k) => { const [y, m] = k.split('-').map(Number); return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)]; });

// The last state that loaded completely: the settings and the store entries that belong to them.
// A run may render the focus player early, so the store changes before the run commits; a failed or
// stopped run puts both the settings and the entries back, never one without the other.
let lastGood = null;
const snapshot = () => ({ users: S.users.slice(), focus: S.focus, preset: S.preset, from: S.from, to: S.to, entries: new Map(store) });
// Keeps lastGood's focus on the same player when the focus changes while it is current.
function rememberFocus() {
  if (!lastGood) return;
  const j = lastGood.users.findIndex((x) => key(x) === key(S.users[S.focus] || ''));
  if (j >= 0) lastGood.focus = j;
}
function restore() {
  store.clear();
  if (lastGood) {
    for (const [k, e] of lastGood.entries) store.set(k, e);
    Object.assign(S, { users: lastGood.users.slice(), focus: lastGood.focus, preset: lastGood.preset, from: lastGood.from, to: lastGood.to });
  } else S.users = [];
  const focusName = S.users[S.focus];
  S.users = S.users.filter((u) => store.get(key(u))?.state === 'ok');
  S.focus = Math.max(0, S.users.indexOf(focusName));
  for (const e of store.values()) if (e.state === 'ok') compute(e);
  setStatus(null);
  document.querySelectorAll('.is-stale').forEach((n) => n.classList.remove('is-stale'));
  writeUrl(); syncControls(true);
  if (S.users.length) render(); else { renderPlayers(); document.title = DEFAULT_TITLE; }
}

async function run() {
  showMsg('');
  if (!S.users.length) { showMsg('Type a chess.com username first.'); $('user').focus(); return; }
  if (S.from && S.to && S.from > S.to) { showMsg('The start date is after the end date. Swap them or pick a preset.'); return; }
  if (!S.to) S.to = ymd(today());
  const mark = msgSeq; // a message newer than this run's start is not this run's to clear
  ctrl?.abort();
  ctrl = new AbortController();
  const my = ++runId, signal = ctrl.signal;
  syncControls(true);
  for (const u of S.users) { const e = store.get(key(u)); store.set(key(u), { ...(e || {}), state: 'loading', error: null }); }
  renderPlayers();
  document.querySelectorAll('#results .summary, #results .block').forEach((n) => n.classList.add('is-stale'));
  const { from, to } = rangeDates();
  const focusName = S.users[S.focus];
  const attempt = { users: S.users.slice(), focus: S.focus, preset: S.preset, from: S.from, to: S.to };
  const order = [focusName, ...S.users.filter((u) => u !== focusName)];
  let done = 0, problem = null;
  for (const u of order) {
    const isFocus = u === focusName;
    setStatus(`Fetching ${u}'s games`, done / order.length);
    try {
      const res = await fetchPlayerGames(u, {
        from, to, signal,
        onProgress: (p) => { if (my === runId) setStatus(`Fetching ${u}'s games${p.total ? `: month ${Math.min(p.total, p.done + 1)} of ${p.total}` : ''}`, (done + (p.total ? p.done / p.total : 0)) / order.length); },
      });
      if (my !== runId) return;
      const e = { state: 'ok', ...res, rk: `${attempt.preset}|${attempt.from}|${attempt.to}` };
      compute(e);
      store.set(key(u), e);
      const at = S.users.indexOf(u);
      if (at >= 0 && res.player?.username) S.users[at] = res.player.username;
      if (pendingAdd && key(pendingAdd) === key(u)) {
        // Added: the field is free for the next name (unless something else was typed meanwhile).
        if (key(cleanName($('addUser').value)) === key(u)) $('addUser').value = '';
        pendingAdd = null;
      }
    } catch (err) {
      if (my !== runId || err?.code === 'aborted' || err?.name === 'AbortError') return;
      if (!err?.code) console.error(err);
      const message = err?.code && err.message ? err.message : 'Something went wrong while loading the games. Try again.';
      const added = !isFocus && pendingAdd && key(pendingAdd) === key(u);
      if (added) { pendingAdd = null; showAddMsg(message); } // said beside the field the name was typed in
      else problem ||= message;
      // Fatal: end this run before restoring, so nothing still in flight can report progress afterwards.
      if (isFocus) {
        ctrl?.abort(); runId++; restore(); showMsg(message);
        // A name that does not exist stays out of the link; a lookup that a reload can fix (rate limit,
        // network) keeps it, so reloading the page tries again.
        if (err?.code === 'rate_limited' || err?.code === 'network') writeUrl(attempt);
        return;
      }
      // A compare player that fails is dropped; the rest of the page stays.
      store.delete(key(u));
      S.users = S.users.filter((x) => x !== u);
      S.focus = Math.max(0, S.users.findIndex((x) => key(x) === key(focusName)));
    }
    done++;
    if (isFocus) { S.sel = null; render(msgSeq === mark); } else { renderPlayers(); renderCompare(); }
  }
  setStatus(null);
  lastGood = snapshot();
  writeUrl(); syncControls(true);
  render(msgSeq === mark);
  if (problem && msgSeq === mark) showMsg(problem);
}

function recompute() {
  for (const e of store.values()) if (e.state === 'ok') compute(e);
  S.sel = null;
  writeUrl();
  render();
}

// ---------- render ----------
/** `clearMsg` false keeps the form message up (a run that finishes after a newer message). */
function render(clearMsg = true) {
  renderPlayers();
  const e = focusEntry();
  if (!e) return;
  if (e.state === 'error') {
    showMsg(e.error);
    if (!$('results').hidden) document.querySelectorAll('#results .summary, #results .block').forEach((n) => n.classList.remove('is-stale'));
    renderCompare();
    return;
  }
  if (e.state !== 'ok') return;
  if (clearMsg) showMsg('');
  $('intro').hidden = true;
  $('results').hidden = false;
  // Data-quality warnings (months that failed, daily games beyond the range) stay up while this player is shown.
  const notes = e.warnings || [];
  // A month that failed to load makes every total too small. That is said on the clock, above the
  // numbers it qualifies, and the faces are marked as partial while it is up. Months that failed are
  // not cached, so running the lookup again retries just those.
  const partial = isPartial(e);
  const missing = partial ? notes.filter((n) => /^Couldn/.test(n)) : [];
  if (partial && !missing.length) missing.push('Some months could not be loaded; their numbers are missing.');
  swap($('notice'), el('span', { text: `${missing.join(' ')} Every total on this page is short by that much.` }),
    el('button', { type: 'button', class: 'notice-btn', text: 'Try again', 'data-fk': 'retry', onclick: retry }));
  $('notice').hidden = !partial;
  document.querySelector('.clock').toggleAttribute('data-partial', partial);
  // While a month is missing the results are marked too (tiles, verdict, stickers, ledger footer).
  $('results').toggleAttribute('data-partial', partial);
  // Quieter notes about the data (daily games still running past the range) stay with the results.
  const rest = notes.filter((n) => !missing.includes(n));
  $('dataNote').textContent = rest.join(' ');
  $('dataNote').hidden = !rest.length;
  document.querySelectorAll('#results .summary, #results .block').forEach((n) => n.classList.remove('is-stale'));
  const st = e.stats, who = e.player?.username || S.users[S.focus];
  multiYear = st.range.from.slice(0, 4) !== st.range.to.slice(0, 4);
  document.title = `${who}: analyzeyou`;
  const has = st.totals.games > 0;
  for (const id of ['secInsights', 'secDays', 'secElo', 'secStreaks', 'secWhen', 'secSessions', 'secGames', 'secLedger']) $(id).hidden = !has;

  seg($('tcSeg'), [{ value: 'all', label: 'All' }, ...['bullet', 'blitz', 'rapid', 'daily'].map((c) => ({
    value: c, label: CLASS_LABEL[c], disabled: !e.games.some((g) => g.timeClass === c) && S.tc !== c,
  }))], S.tc, (v) => { S.tc = v; recompute(); });

  renderClock(e, who);
  renderSummary(e, who);
  renderCompare();
  if (!has) return;
  renderInsights(e, who);
  renderDays(e);
  renderElo(e);
  renderStreaks(e);
  renderWhen(e);
  renderSessions(e, who);
  renderGames(e, who);
  renderLedger(e);
}

// "Try again" goes away when the retry loads everything: the focus then moves to the results heading
// instead of falling to <body>. A retry that still misses a month keeps the button, and the focus on it.
async function retry() {
  await run();
  const a = document.activeElement;
  if (!a || a === document.body) { const h = $('headline'); h.tabIndex = -1; h.focus(); }
}
/** True while a month of the range failed to load: the totals on screen are too small. */
const isPartial = (e) => (e?.failedMonths?.length || 0) > 0;
function renderPlayers() {
  swap($('players'), ...S.users.map((u, i) => {
    const e = store.get(key(u));
    return el('span', { class: 'chip', 'data-on': String(i === S.focus), 'data-state': e?.state || '' , title: e?.state === 'error' ? e.error : null },
      el('button', { type: 'button', text: u, 'data-fk': `p:${key(u)}`, 'aria-pressed': String(i === S.focus), onclick: () => { S.focus = i; S.sel = null; S.pool = null; rememberFocus(); writeUrl(); render(); } }),
      S.users.length > 1 && el('button', { type: 'button', class: 'x', text: '×', 'aria-label': `Remove ${u}`, onclick: () => removeUser(i) }),
    );
  }));
  $('addForm').hidden = S.users.length >= 4;
  $('addNote').hidden = S.users.length < 4;
}
function removeUser(i) {
  followingUrl = false;
  const [gone] = S.users.splice(i, 1);
  if (S.focus >= S.users.length) S.focus = S.users.length - 1; else if (i < S.focus) S.focus--; else if (i === S.focus) S.focus = 0;
  S.sel = null; S.pool = null;
  $('user').value = S.users[0] || '';
  // Drop the player from the last good state too, but keep its dates and entries: during a run, S holds
  // the new run's dates, which the old entries do not match.
  if (lastGood) {
    const focusName = lastGood.users[lastGood.focus];
    lastGood.users = lastGood.users.filter((x) => key(x) !== key(gone));
    lastGood.focus = Math.max(0, lastGood.users.indexOf(focusName));
    rememberFocus();
  }
  writeUrl(); render();
  // The remove button is gone with its chip: put the focus on the chip of the player now shown.
  if (document.activeElement === document.body) $('players').querySelector('[aria-pressed="true"]')?.focus();
}

// The clock faces: thinking time on each side of the board.
let clockAnim = 0, clockShown = '';
function renderClock(e, who) {
  const t = e.stats.totals, me = t.myThink || 0, opp = t.oppThink || 0;
  $('faceMeName').textContent = who;
  const has = t.thinkGames > 0;
  const even = has && Math.round(me) === Math.round(opp);
  for (const [side, secs, base] of [['Me', me, `${dur(me / t.thinkGames)} a game on their own clock`], ['Opp', opp, `${dur(opp / t.thinkGames)} a game on the other clock`]]) {
    const alt = (faceAlt[side] = { i: 0, list: has ? [base, ...equivalents(secs)] : ['no clock data in this range'] });
    $(`face${side}Foot`).textContent = alt.list[0];
    const box = $(`lcdBox${side}`), live = alt.list.length > 1;
    for (const [k, v] of [['role', 'button'], ['tabindex', '0'], ['aria-label', 'Say this time another way']]) { if (live) box.setAttribute(k, v); else box.removeAttribute(k); }
  }
  $('flagMe').hidden = !(has && (me > opp || even)); $('flagOpp').hidden = !(has && (opp > me || even));
  $('flagMe').textContent = $('flagOpp').textContent = even ? 'dead even' : 'thought longer';
  document.querySelector('.clock').dataset.lean = !has || even ? '' : me > opp ? 'me' : 'opp';
  renderStickers(e, who);
  const long = Math.max(me, opp) >= 3600000; // 1,000 hours: hours and minutes only
  const ghost = long ? '8888:88' : '888:88:88';
  document.querySelectorAll('.lcd-ghost').forEach((g) => { g.textContent = ghost; });
  $('clockSr').textContent = has ? `${who} thought for ${durWords(me)}; opponents for ${durWords(opp)}.` : '';
  // The two faces add up to a little less than the total time, and a careful reader will check. Lag
  // that chess.com allows for and the wait before each side's first move run on neither clock.
  const both = me + opp, gap = $('clockGap');
  gap.hidden = !(has && t.time - both >= 60 && both / t.time < 0.99);
  if (!gap.hidden) gap.textContent = `The two clocks add up to ${dur(both)} of the ${dur(t.time)} played. The rest ran on neither: the lag chess.com allows for, and the wait before each side’s first move.`;
  // Count up only when the figures on the faces change; a re-render with the same totals leaves them alone.
  const shown = `${clockText(me)}|${clockText(opp)}`;
  if (shown === clockShown) return;
  clockShown = shown;
  const id = ++clockAnim, t0 = performance.now(), D = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
  const frame = (now) => {
    if (id !== clockAnim) return;
    const k = D ? Math.min(1, (now - t0) / D) : 1, ease = 1 - Math.pow(1 - k, 3);
    paintLcd($('lcdMe'), me * ease, long); paintLcd($('lcdOpp'), opp * ease, long);
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Pressing a clock face says the same time another way (films, nights of sleep).
const faceAlt = { Me: { i: 0, list: [] }, Opp: { i: 0, list: [] } };
function cycleFace(side) {
  const alt = faceAlt[side];
  if (alt.list.length < 2) return;
  alt.i = (alt.i + 1) % alt.list.length;
  $(`face${side}Foot`).textContent = alt.list[alt.i];
}
for (const side of ['Me', 'Opp']) {
  const box = $(`lcdBox${side}`);
  box.addEventListener('click', () => cycleFace(side));
  box.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cycleFace(side); } });
}

const FMT = { dur, pct, num, plural, date: (d) => sd(d) };
// Stickers on the clock casing: small true facts about this player, each revealed by pressing it.
function renderStickers(e, who) {
  const list = stickers(e.stats, e.view, who, FMT), row = $('stickers'), note = $('stickerNote');
  row.hidden = !list.length; note.hidden = true; note.replaceChildren();
  row.replaceChildren(...list.map((s) => {
    const b = el('button', { type: 'button', class: 'sticker', text: s.label, 'aria-expanded': 'false' });
    b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') === 'true';
      for (const x of row.children) x.setAttribute('aria-expanded', 'false');
      note.hidden = open;
      if (!open) { b.setAttribute('aria-expanded', 'true'); note.replaceChildren(pawnMark(), el('span', { text: s.note })); }
    });
    return b;
  }));
}
function closeSticker() {
  const note = $('stickerNote');
  if (note.hidden) return;
  note.hidden = true;
  for (const x of $('stickers').children) x.setAttribute('aria-expanded', 'false');
}
function renderVerdict(e, who) {
  const v = verdict(e.stats, who, FMT, MOOD), box = $('verdict');
  box.hidden = false; box.dataset.tier = v.key;
  box.replaceChildren(
    el('div', { class: 'verdict-art' }, v.art),
    el('div', { class: 'verdict-text' },
      el('h2', { class: 'verdict-label', text: v.label }), el('p', { class: 'verdict-line', text: v.line }),
      v.extra && el('p', { class: 'verdict-line', text: v.extra }), v.basis && el('p', { class: 'verdict-basis', text: v.basis })));
}

function tile(label, value, note) {
  return el('div', { class: 'tile' }, el('dt', { text: label }), el('dd', { class: 'v' }, value), el('dd', { class: 'n' }, note || ' '));
}
function dayLink(date, f = dfMed) {
  const b = el('button', { type: 'button', class: 'link-btn', text: dateStr(date, f), onclick: (ev) => select('day', date, { scroll: true, kb: ev.detail === 0, from: b }) });
  return b;
}

// Tiles size their grid from how many there are (data-n), so a short row never leaves grey gaps.
function setTiles(root, tiles) { root.dataset.n = String(tiles.length); root.replaceChildren(...tiles); }
// A session runs on the wall clock, breaks included, so its length can exceed the playing time inside it.
const sessionPlay = (x) => (x.duration - x.playTime >= 60 ? `, ${dur(x.playTime)} of it at the board` : '');
// "+34 won, −8 lost", with words where a side is zero.
const ratingNote = (g, l) => (g || l ? `${g ? `+${num(g)} won` : 'nothing won'}, ${l ? `${MINUS}${num(l)} lost` : 'nothing lost'}` : 'no change');

function renderSummary(e, who) {
  const st = e.stats, t = st.totals, r = st.range;
  const rangeText = dateSpan(r.from, r.to);
  const filtered = S.tc !== 'all' || S.rated;
  renderVerdict(e, who);
  if (!t.games) {
    $('headline').textContent = `No games for ${who} in this range`;
    const span = r.from === r.to ? `on ${dateStr(r.from)}` : `between ${dateStr(r.from)} and ${dateStr(r.to)}`;
    // Only suggest what could turn up games: fewer filters, or more days.
    // A dormant account: say when the last games are from (the newest monthly archive), and offer the
    // whole history unless it is already on screen.
    // The same goes for a range that ends before the account's first games. Inside the years the
    // account was active, the only useful advice is more days.
    const month = (ym) => dfMonth.format(parseYmd(`${ym}-01`));
    const record = filtered ? null
      : e.lastArchive && e.lastArchive < r.from.slice(0, 7) ? `The last games on record are from ${month(e.lastArchive)}.`
        : e.firstArchive && e.firstArchive > r.to.slice(0, 7) ? `The first games on record are from ${month(e.firstArchive)}.` : null;
    const advice = filtered ? 'Clear the filters, or pick more days.' : record || (r.days === 1 ? 'Pick more than one day.' : 'Pick a longer range.');
    $('subline').replaceChildren(`Nothing was played ${span}${filtered ? ' with these filters' : ''}. ${advice}`,
      ...(record && S.preset !== 'all' ? [' ', el('button', { type: 'button', class: 'link-btn', text: 'Show all time', onclick: () => { applyPreset('all'); rangeChanged(); } })] : []));
    $('tiles').replaceChildren();
    $('tiles').hidden = true;
    return;
  }
  $('tiles').hidden = false;
  const rated = st.elo.ratedGames > 0;
  const ratingTile = () => tile('Rating', el('span', { class: st.elo.net > 0 ? 'up' : st.elo.net < 0 ? 'down' : '', text: signed(st.elo.net) }), ratingNote(st.elo.gained, st.elo.lost));
  if (!hasTime(st)) {
    // Daily games only: no clock runs, so the page counts games instead of time.
    $('headline').textContent = `${who} played ${plural(t.games, 'daily game')} and no live chess`;
    $('subline').textContent = `${rangeText}. A daily game runs for days with no clock ticking, so there is no time at the board to add up.`;
    setTiles($('tiles'), [
      tile('Games', num(t.games), `${pct(rate(t))} won`),
      tile('Days with a game', num(t.activeDays), `of ${plural(r.days, 'day')}`),
      ...(rated ? [ratingTile()] : []),
    ]);
    return;
  }
  const waking = t.time / (r.days * 16 * 3600);
  $('headline').textContent = `${who} spent ${isPartial(e) ? 'at least ' : ''}${durWords(t.time)} playing chess`;
  const share = waking < 0.001 ? 'under 0.1%' : pct(waking, waking < 0.1 ? 1 : 0);
  $('subline').textContent = r.days === 1
    ? `${plural(t.games, 'game')} on ${rangeText}. That is ${share} of that day’s waking hours.`
    : `${plural(t.games, 'game')} on ${num(t.activeDays)} of ${plural(r.days, 'day')}, ${rangeText}. That is ${dur(t.avgPerDay)} for every day in the range, or ${share} of the waking hours.`;
  const rec = st.records, day = (d) => st.days.find((x) => x.date === d);
  const longest = st.sessions.longest != null ? st.sessions.list[st.sessions.longest] : null;
  const b = rec.busiestDay && day(rec.busiestDay), b30 = rec.busiestDayLast30 && day(rec.busiestDayLast30), mg = rec.mostGamesDay && day(rec.mostGamesDay);
  const sessionTile = tile('Longest session', longest ? durNode(longest.duration) : '–', longest ? [dayLink(ymd(new Date(longest.start))), `, ${plural(longest.games, 'game')}${sessionPlay(longest)}`] : null);
  // A median of one or two games says nothing the average does not.
  const avgTile = tile(t.liveGames === 1 ? 'Game length' : 'Average game', durNode(t.avgGame), t.liveGames >= 3 ? `half are under ${dur(t.medianGame)}` : null);
  if (t.liveDays <= 1) {
    // One day of play: "busiest day" and "per day played" would all repeat the total.
    setTiles($('tiles'), [
      tile('Total time', durNode(t.time), b ? ['all on ', dayLink(b.date)] : null),
      tile('Games', num(t.games), `${wdl(t)} won, drawn, lost`),
      avgTile, sessionTile,
      ...(rated ? [ratingTile()] : []),
    ]);
    return;
  }
  // "Busiest in the last 30 days" earns a tile when it is a different day from the range's busiest;
  // when it is the same day the busiest-day tile says so, and the slot goes to something new.
  const same30 = b && b30 && b30.date === b.date;
  const third = b30 && !same30
    ? tile('Busiest in the last 30 days', durNode(b30.time), [dayLink(b30.date), `, ${plural(b30.games, 'game')}`])
    : mg && b && mg.date !== b.date
      // A day of daily games only has no time: no ", 0s".
      ? tile('Most games in a day', num(mg.games), [dayLink(mg.date), mg.time > 0 ? `, ${dur(mg.time)}` : ''])
      : tile('Days played', num(t.liveDays), `of ${plural(r.days, 'day')}`);
  setTiles($('tiles'), [
    tile('Total time', durNode(t.time), `${plural(t.games, 'game')}, ${pct(rate(t))} won`),
    tile('Busiest day', b ? durNode(b.time) : '–', b ? [dayLink(b.date), `, ${plural(b.games, 'game')}${same30 && r.days > 30 ? ', and the busiest of the last 30 days' : ''}`] : null),
    third, avgTile,
    // Both figures are over days with a live game: days with only daily games add no time.
    tile('Per day played', durNode(t.avgPerActiveDay), `${per(t.liveGames / Math.max(1, t.liveDays), 'game')} a day`),
    sessionTile,
  ]);
}
/** Whether anything in the selection has time at the board (false with daily games only). */
const hasTime = (st) => st.totals.liveGames > 0 && st.totals.time > 0;

// ---------- insights ----------
// One rule for every claim on this page: a rate needs about MIN_SAMPLE games behind each side of it,
// and a claim about days needs MIN_DAYS days. Below that an insight is not said at all.
const MIN_SAMPLE = 20, MIN_DAYS = 5, MIN_GAP = 5;
function renderInsights(e, who) {
  const st = e.stats, t = st.totals, out = [];
  const minN = Math.max(MIN_SAMPLE, Math.round(t.games * 0.03));
  const hours = st.byHour.filter((h) => h.games >= minN);
  if (t.time > 0 && t.liveGames >= MIN_SAMPLE) {
    const peak = st.byHour.reduce((a, b) => (b.time > a.time ? b : a));
    // Hours are the viewer's clock; the lines that use them say so.
    out.push(`Most of the playing lands around **${hourName(peak.hour)} your time**: ${dur(peak.time)}, ${pct(peak.time / t.time)} of the total.`);
  }
  if (hours.length >= 2) {
    const best = hours.reduce((a, b) => (rate(b) > rate(a) ? b : a)), worst = hours.reduce((a, b) => (rate(b) < rate(a) ? b : a));
    if (rate(best) - rate(worst) >= 0.08) out.push(`Sharpest around **${hourName(best.hour)}** on your clock (${pct(rate(best))} won in ${num(best.games)} games), weakest around **${hourName(worst.hour)}** (${pct(rate(worst))} in ${num(worst.games)}).`);
  }
  // Two rates are compared only when both have the sample and they differ by at least MIN_GAP points
  // as printed: "78% after a loss, 79% after a win" is not a finding.
  const apart = (a, b) => a != null && b != null && Math.abs(Math.round(a * 100) - Math.round(b * 100)) >= MIN_GAP;
  const tl = st.tilt;
  if (tl.afterWin.games >= MIN_SAMPLE && tl.afterLoss.games >= MIN_SAMPLE && apart(tl.afterLoss.winRate, tl.afterWin.winRate)) {
    const a = tl.afterLoss.winRate, b = tl.afterWin.winRate;
    out.push(`The game right after a loss is won **${pct(a)}** of the time; right after a win, **${pct(b)}**.${a < b ? ' Losses carry over.' : ' Losses seem to sharpen the focus.'}`);
  }
  if (tl.liveLosses >= MIN_SAMPLE && tl.liveWins >= MIN_SAMPLE && apart(tl.requeueAfterLoss, tl.requeueAfterWin)) {
    out.push(`After a loss, another game starts within five minutes **${pct(tl.requeueAfterLoss)}** of the time. After a win: ${pct(tl.requeueAfterWin)}.`);
  }
  // Games 1 to 3 against the "10+" bar of the chart beside it, the one bucket that is all long-session play.
  const pos = st.sessions.byPosition, late = pos.length >= 10 ? pos[9] : null;
  if (late && late.games >= MIN_SAMPLE) {
    const early = pos.slice(0, 3).reduce((a, p) => ({ games: a.games + p.games, wins: a.wins + p.wins }), { games: 0, wins: 0 });
    if (early.games >= MIN_SAMPLE && apart(rate(early), rate(late))) {
      out.push(`Games 1 to 3 of a session are won ${pct(rate(early))} of the time; from game 10 on it is **${pct(rate(late))}**.${rate(late) < rate(early) ? ' Long sessions cost points.' : ' It takes a few games to warm up.'}`);
    }
  }
  const dows = st.days.reduce((a, d) => { a[d.dow]++; return a; }, Array(7).fill(0));
  const dowAvg = st.byDow.map((d) => ({ dow: d.dow, avg: dows[d.dow] ? d.time / dows[d.dow] : 0 }));
  // Each weekday's average needs a few of that weekday: four weeks give every weekday four or five.
  if (st.range.days >= 28 && t.liveDays >= MIN_DAYS && t.liveGames >= MIN_SAMPLE) {
    const hi = dowAvg.reduce((a, b) => (b.avg > a.avg ? b : a)), lo = dowAvg.reduce((a, b) => (b.avg < a.avg ? b : a));
    out.push(`**${dowName(hi.dow)}s** are the heaviest day at ${dur(hi.avg)} on average; ${lo.avg > 0 ? `${dowName(lo.dow)}s the lightest at ${dur(lo.avg)}` : `nothing was played on a ${dowName(lo.dow)}`}.`);
  }
  if (st.elo.ratedGames >= MIN_SAMPLE && st.days.filter((d) => d.eloGained || d.eloLost).length >= MIN_DAYS && st.records.bestEloDay && st.records.worstEloDay) {
    const b = st.days.find((d) => d.date === st.records.bestEloDay), w = st.days.find((d) => d.date === st.records.worstEloDay);
    if (b && w && b.eloNet > 0 && w.eloNet < 0) out.push(`Best day for the rating: **${signed(b.eloNet)}** on ${sd(b.date)}. Worst: **${signed(w.eloNet)}** on ${sd(w.date)}.`);
  }
  const c = st.clock;
  if (t.losses >= MIN_SAMPLE && c.timeoutLosses / t.losses >= 0.12) out.push(`**${pct(c.timeoutLosses / t.losses)}** of the losses came from running out of time (${num(c.timeoutLosses)} games).`);
  if (t.thinkGames >= MIN_SAMPLE && c.fasterShare != null) out.push(`${who} used less clock than the opponent in **${pct(c.fasterShare)}** of games.`);
  const heavy = st.dailyLoad.filter((d) => d.days >= MIN_DAYS && d.games >= MIN_SAMPLE);
  if (heavy.length >= 2) {
    const first = heavy[0], last = heavy[heavy.length - 1];
    if (apart(rate(first), rate(last))) out.push(`On days with ${last.label.replace('-', '–')} games the win rate is **${pct(rate(last))}**; on days with ${first.label.replace('-', '–')} it is ${pct(rate(first))}.`);
  }
  const wc = st.byColor.white, bc = st.byColor.black;
  if (wc.games >= MIN_SAMPLE && bc.games >= MIN_SAMPLE && apart(rate(wc), rate(bc))) out.push(`With white: ${pct(rate(wc))} won. With black: **${pct(rate(bc))}**.`);
  const ds = st.streaks.longestDayStreak;
  if (ds && ds.length >= 5) out.push(`Longest run without a day off: **${num(ds.length)} days**, ${sdSpan(ds.startDate, ds.endDate)}.`);
  const lg = st.records.longestGame != null ? e.view[st.records.longestGame] : null;
  if (lg && lg.duration > 0) out.push(`The longest single game took **${dur(lg.duration)}**, a ${lg.outcome} against ${lg.opponent} on ${sd(lg.start)}.`);
  $('secInsights').hidden = out.length === 0;
  $('insights').replaceChildren(...out.slice(0, 10).map((s) => el('li', null, rich(s))));
}

// ---------- day by day ----------
function streaksOf(games) {
  let w = 0, l = 0, bw = 0, bl = 0;
  for (const g of games) {
    if (g.outcome === 'win') { w++; l = 0; } else if (g.outcome === 'loss') { l++; w = 0; } else { w = 0; l = 0; }
    if (w > bw) bw = w; if (l > bl) bl = l;
  }
  return [bw, bl];
}
function bucketize(e, mode) {
  const days = e.stats.days;
  if (mode === 'day') return days.map((d) => ({ ...d, key: d.date, mode, label: dateStr(d.date, dfLong), activeDays: d.games ? 1 : 0, span: 1, missing: d.missing ? 1 : 0 }));
  const map = new Map();
  for (const d of days) {
    const dt = parseYmd(d.date);
    const k = mode === 'week' ? ymd(addDays(dt, -d.dow)) : d.date.slice(0, 7);
    let b = map.get(k);
    if (!b) {
      b = { key: k, mode, first: d.date, last: d.date, games: 0, wins: 0, losses: 0, draws: 0, time: 0, myThink: 0, oppThink: 0, eloGained: 0, eloLost: 0, eloNet: 0, sessions: 0, byClass: {}, gameIdx: [], activeDays: 0, span: 0, missing: 0, firstStart: null, lastEnd: null };
      map.set(k, b);
    }
    b.last = d.date; b.span++;
    for (const f of ['games', 'wins', 'losses', 'draws', 'time', 'myThink', 'oppThink', 'eloGained', 'eloLost', 'eloNet', 'sessions']) b[f] += d[f] || 0;
    if (d.games) b.activeDays++;
    if (d.missing) b.missing++; // days in a month that failed to load
    for (const c in d.byClass) { const x = (b.byClass[c] ||= { games: 0, time: 0 }); x.games += d.byClass[c].games; x.time += d.byClass[c].time; }
    for (const i of d.gameIdx) b.gameIdx.push(i);
    if (d.firstStart != null && (b.firstStart == null || d.firstStart < b.firstStart)) b.firstStart = d.firstStart;
    if (d.lastEnd != null && (b.lastEnd == null || d.lastEnd > b.lastEnd)) b.lastEnd = d.lastEnd;
  }
  const out = [...map.values()];
  // A session that runs past midnight counts on both days, so summing the days would count it twice:
  // count each session once for every bucket it has a game in.
  const spans = e.stats.sessions.list.map((s) => [ymd(new Date(e.view[s.firstIdx].start)), ymd(new Date(e.view[s.lastIdx].start))]);
  for (const b of out) {
    [b.bestWinStreak, b.bestLossStreak] = streaksOf(b.gameIdx.map((i) => e.view[i]));
    b.sessions = spans.reduce((n, [a, z]) => n + (a <= b.last && z >= b.first ? 1 : 0), 0);
    b.label = mode !== 'week' ? dfMonth.format(parseYmd(b.first)) : b.first === b.last ? dateStr(b.first, dfMed) : `${dateStr(b.first, dfShort)} to ${dateStr(b.last, dfMed)}`;
  }
  return out;
}
function granOf(e) {
  const n = e.stats.range.days;
  if (S.gran !== 'auto' && !(S.gran === 'day' && n > 800)) return S.gran;
  return n <= 92 ? 'day' : n <= 550 ? 'week' : 'month';
}
/** A streak length for a readout: "none" rather than 0. */
const streakText = (n) => (n ? num(n) : 'none');
function bucketRows(b) {
  const rows = b.time ? [['Time', dur(b.time)]] : [];
  rows.push(['Games', num(b.games)], ['Won, drawn, lost', wdl(b)]);
  if (b.eloGained || b.eloLost) rows.push(['Rating', netText(b.eloNet, b.eloGained, b.eloLost)]);
  rows.push(['Best winning streak', streakText(b.bestWinStreak)], ['Worst losing streak', streakText(b.bestLossStreak)]);
  return rows;
}
// A bucket in a month that failed to load says so; one without games says "No games", like every other
// mark. `missing` counts the bucket's days that were not loaded, `span` its days.
function missingNote(b) {
  if (!b.missing) return null;
  if (!b.games && b.missing >= b.span) return 'Not loaded';
  return b.span > 1 ? `${plural(b.missing, 'day')} not loaded` : 'Partly not loaded';
}
function bucketTip(b) {
  if (!b.games) return tipBox(b.label, [], [b.missing >= b.span ? null : 'No games', missingNote(b)].filter(Boolean).join('; '));
  return tipBox(b.label, bucketRows(b), missingNote(b));
}
// The same readout as one sentence, for the day chart's live region.
function bucketText(b) {
  const gone = missingNote(b)?.toLowerCase();
  if (!b.games) return `${b.label}: ${gone && b.missing >= b.span ? gone : `no games${gone ? `; ${gone}` : ''}`}.`;
  const parts = [b.time ? `${dur(b.time)} played` : null, plural(b.games, 'game'), `${num(b.wins)} won, ${num(b.draws)} drawn, ${num(b.losses)} lost`];
  if (b.eloGained || b.eloLost) parts.push(`rating ${signed(b.eloNet)}`);
  if (gone) parts.push(gone);
  return `${b.label}: ${parts.filter(Boolean).join(', ')}.`;
}
// The control that opened the detail panel: an element, or a data-fk to find its re-rendered copy.
let opener = null;
/**
 * Opens (or, from the day chart, toggles) a day, week or month in the detail panel.
 * `scroll` brings the panel into view and never toggles; `kb` (opened from the keyboard) moves the
 * focus to the panel's heading; `from` is what to give the focus back to when the panel closes.
 */
function select(mode, k, { scroll = false, reveal = false, kb = false, from = null } = {}) {
  S.sel = S.sel && S.sel.mode === mode && S.sel.key === k && !scroll ? null : { mode, key: k };
  scroll ||= reveal; // `reveal` (the day chart) toggles like before, and brings an opened panel into view
  opener = S.sel ? from : null;
  const e = focusEntry();
  renderDays(e); renderLedger(e);
  const box = $('detail'), head = $('detailTitle');
  if (!S.sel || box.hidden || !head) return;
  if (scroll) {
    // The panel sits above the calendar and the ledger: bring its top into view, all of it when it fits.
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: box.offsetHeight <= innerHeight ? 'nearest' : 'start' });
  }
  if (kb) head.focus({ preventScroll: scroll });
}
function closeDetail(kb) {
  if (!S.sel) return;
  const back = opener;
  opener = null; S.sel = null;
  const e = focusEntry();
  renderDays(e); renderLedger(e);
  const t = back instanceof Element ? (back.isConnected ? back : null) : back ? document.querySelector(`[data-fk="${CSS.escape(back)}"]`) : null;
  (t && !t.closest('[hidden]') ? t : document.querySelector('#dayChart svg'))?.focus({ preventScroll: !kb });
}

function renderDays(e) {
  const st = e.stats, gran = granOf(e), n = st.range.days;
  seg($('granSeg'), [
    { value: 'day', label: 'Days', disabled: n > 800 }, { value: 'week', label: 'Weeks', disabled: n < 14 }, { value: 'month', label: 'Months', disabled: n < 45 },
  ], gran, (v) => { S.gran = v; S.sel = null; renderDays(e); });
  const buckets = bucketize(e, gran);
  const used = CLASSES.filter((c) => st.byClass.some((x) => x.timeClass === c.key && x.time > 0));
  $('dayLegend').replaceChildren(
    ...(used.length > 1 ? used.map((c) => el('span', { class: 'key' }, el('i', { class: c.cls }), c.label)) : []),
    ...(st.elo.ratedGames ? [
      el('span', { class: 'key' }, el('i', { class: 'f-win' }), 'Rating won'), el('span', { class: 'key' }, el('i', { class: 'f-loss' }), 'Rating lost'),
      el('span', { class: 'key' }, el('i', { class: 'f-ink', style: 'height:3px;width:12px' }), 'Net'),
    ] : []),
  );
  // highlight the bucket that holds the selection
  let selKey = null;
  if (S.sel) {
    if (S.sel.mode === gran) selKey = S.sel.key;
    else if (S.sel.mode === 'day') selKey = gran === 'week' ? ymd(addDays(parseYmd(S.sel.key), -((parseYmd(S.sel.key).getDay() + 6) % 7))) : S.sel.key.slice(0, 7);
  }
  const timed = hasTime(st);
  // With daily games only there is no time panel; with no rating change either, there is nothing to
  // draw: the panel goes, and the sentence under the heading says the one thing there is to say.
  const marks = timed || st.days.some((d) => d.eloGained || d.eloLost);
  $('dayChart').parentElement.hidden = !marks;
  $('granSeg').hidden = !marks;
  if (!marks) {
    const only = st.days.filter((d) => d.games);
    const what = only.length !== 1 ? `${plural(st.totals.games, 'game')} on ${plural(only.length, 'day')}` : only[0].games === 1 ? `1 game, started on ${dateStr(only[0].date)}` : `${plural(only[0].games, 'game')}, all started on ${dateStr(only[0].date)}`;
    $('daysSub').textContent = `${what}. No clock ran and the rating did not move, so there is nothing to chart.`;
  } else $('daysSub').textContent = `${timed ? 'Time at the board' : 'Games'}${st.elo.ratedGames ? ', and rating won and lost' : ''}. Pick a ${gran === 'day' ? 'day' : gran} to open it${matchMedia('(hover: hover)').matches ? '; arrow keys work too' : ''}.`;
  dayChart($('dayChart'), buckets, {
    label: `${timed ? 'Time played' : 'Rating won and lost'} per ${gran}. Use the left and right arrow keys, Home and End to read values, Enter to open one.`,
    classes: CLASSES, selectedKey: selKey, fmtTime: dur, tip: bucketTip, showTime: timed,
    cursorKey: chartCursor, onCursor: (b) => { chartCursor = b.key; },
    announce: (b) => { $('dayChartLive').textContent = bucketText(b); },
    // "Mar 2017", never "Mar 17", which reads as the 17th of March.
    tick: (b) => (gran === 'month' ? dfMonYear.format(parseYmd(b.first)) : sd(gran === 'day' ? b.date : b.first)),
    // Like the calendar and the ledger, a bar brings the panel it opens into view.
    onSelect: (b, kb) => select(gran, b.key, { kb, reveal: true }),
  });
  renderDetail(e);
  renderCalendar(e);
}
let chartCursor = null; // key of the bar the day chart's keyboard cursor is on

/** A player's name as a link to their chess.com profile. */
function profileLink(name) {
  return el('a', { href: `https://www.chess.com/member/${encodeURIComponent(name)}`, target: '_blank', rel: 'noopener', title: `${name} on chess.com`, text: name });
}
function resultPill(g) {
  const c = g.outcome === 'win' ? 'w' : g.outcome === 'loss' ? 'l' : 'd';
  return el('span', { class: `pill ${c}`, text: c === 'w' ? 'W' : c === 'l' ? 'L' : 'D', title: `${g.outcome === 'win' ? 'Won' : g.outcome === 'loss' ? 'Lost' : 'Drew'} by ${(ENDING[g.ending] || g.ending || '').toLowerCase()}` });
}
// The day remarks are planned once per set of statistics, over the whole range, so no line repeats.
const quipPlans = new WeakMap();
function quipsFor(e) {
  let plan = quipPlans.get(e.stats);
  if (!plan) { plan = planQuips(e.stats.days, e.view, FMT); quipPlans.set(e.stats, plan); }
  return plan;
}
function renderDetail(e) {
  const box = $('detail');
  if (!S.sel) { box.hidden = true; box.replaceChildren(); return; }
  const b = bucketize(e, S.sel.mode).find((x) => x.key === S.sel.key);
  if (!b) { box.hidden = true; return; }
  box.hidden = false;
  const games = b.gameIdx.map((i) => e.view[i]);
  const multi = S.sel.mode !== 'day';
  const head = el('div', { class: 'detail-head' },
    // tabindex -1: the focus moves here when a day is opened from the keyboard.
    el('div', null, el('h3', { text: b.label, id: 'detailTitle', tabindex: -1 }),
      el('p', { text: [
        b.games ? (multi ? `${num(b.activeDays)} of ${plural(b.span, 'day')} played` : b.firstStart ? `First game ${dfTime.format(new Date(b.firstStart))}, last one over at ${dfTime.format(new Date(b.lastEnd))}` : '') : b.missing >= b.span ? '' : 'No games.',
        !b.missing ? '' : b.missing >= b.span ? 'Not loaded: chess.com did not answer for this month. Try again from the notice at the top.' : `${missingNote(b)}.`,
      ].filter(Boolean).join(' ') })),
    el('button', { type: 'button', class: 'ghost-btn', text: 'Close', onclick: (ev) => closeDetail(ev.detail === 0) }));
  box.replaceChildren(head);
  if (!b.games) return;
  const quip = multi ? null : quipsFor(e).get(b.key);
  if (quip) box.append(el('p', { class: 'quip' }, pawnMark(), el('span', { text: quip })));
  const think = b.myThink + b.oppThink;
  box.append(el('dl', { class: 'tiles' },
    // Daily games only: no time at the board and no sessions.
    tile('Time', b.time ? durNode(b.time) : '–', b.time ? plural(b.sessions, 'session') : 'daily games have no clock'),
    tile('Games', num(b.games), `${wdl(b)} won, drawn, lost`),
    tile('Rating', el('span', { class: b.eloNet > 0 ? 'up' : b.eloNet < 0 ? 'down' : '', text: signed(b.eloNet) }), ratingNote(b.eloGained, b.eloLost)),
    tile('Best winning streak', streakText(b.bestWinStreak), !b.bestWinStreak ? null : b.bestWinStreak === 1 ? 'game' : 'games in a row'),
    tile('Worst losing streak', streakText(b.bestLossStreak), !b.bestLossStreak ? null : b.bestLossStreak === 1 ? 'game' : 'games in a row'),
    tile('Own clock', think ? durNode(b.myThink) : '–', think ? `opponents ${dur(b.oppThink)}` : 'no clock data'),
  ));
  const cap = 250, shown = games.slice(0, cap);
  // A name always opens that player's profile; "Open game" opens the game. On a phone the table keeps
  // result, opponent, rating change, length and the link, with the start and game type on a second line.
  const rows = shown.map((g) => {
    const when = multi ? `${sd(g.start)}, ${dfTime.format(new Date(g.start))}` : dfTime.format(new Date(g.start));
    const kind = `${CLASS_LABEL[g.timeClass] || g.timeClass}, ${controlLabel(g)}${g.rated ? '' : ', unrated'}`;
    return el('tr', null,
      el('td', { class: 'c-start', text: when }),
      el('td', { class: 'c-res' }, resultPill(g)),
      el('td', { class: 'c-opp' }, profileLink(g.opponent), g.oppRating ? ` (${g.oppRating})` : '', el('small', { class: 'c-sub', text: `${when}, ${kind}` })),
      el('td', { class: 'c-game', text: kind }),
      el('td', { class: 'num c-len', text: g.live === false ? '–' : durT(g.duration) }),
      el('td', { class: 'num c-clock', text: g.myThink != null ? `${durT(g.myThink)} / ${durT(g.oppThink)}` : '–' }),
      el('td', { class: `num c-rat ${g.ratingDelta > 0 ? 'up' : g.ratingDelta < 0 ? 'down' : ''}`, text: g.ratingDelta == null ? '–' : signed(g.ratingDelta) }),
      el('td', { class: 'num c-after', text: g.myRating ?? '–' }),
      el('td', { class: 'c-open' }, isChessComUrl(g.url) && el('a', { href: g.url, target: '_blank', rel: 'noopener', 'aria-label': `Open the game against ${g.opponent} on chess.com` }, 'Open', el('span', { class: 'c-wide', text: ' game' }))),
    );
  });
  const heads = [['Started', 'c-start'], ['', 'c-res'], ['Opponent', 'c-opp'], ['Game', 'c-game'], ['Length', 'num c-len'], ['Clock, own / theirs', 'num c-clock'], ['Rating', 'num c-rat'], ['After', 'num c-after'], ['', 'c-open']];
  box.append(el('div', { class: 'table-wrap tall' }, el('table', { class: 'ledger games' },
    el('thead', null, el('tr', null, ...heads.map(([h, c]) => el('th', { class: c, text: h })))),
    el('tbody', null, ...rows))));
  if (games.length > cap) box.append(el('p', { class: 'note', text: `Showing the first ${cap} of ${num(games.length)} games.` }));
}

function mixTime(frac) { return `color-mix(in oklab, var(--time) ${Math.round(frac * 100)}%, var(--surface-2))`; }
function level(v, max) { if (!v || !max) return 0; const r = v / max; return r <= 0.15 ? 1 : r <= 0.35 ? 2 : r <= 0.6 ? 3 : r <= 0.85 ? 4 : 5; }
const LEVEL_MIX = [0, 0.3, 0.48, 0.66, 0.83, 1];

function renderCalendar(e) {
  const st = e.stats, days = st.days, n = days.length;
  const show = n >= 28 && n <= 1100;
  $('calPanel').hidden = !show;
  if (!show) return;
  const max = maxOf(days, (d) => d.time);
  const cal = $('cal'), nodes = [];
  let col = [];
  let lastMonth = '';
  const flush = (first) => {
    if (!col.length) return;
    const mo = first.date.slice(0, 7);
    const showLabel = mo !== lastMonth && (lastMonth === '' || Number(first.date.slice(8)) <= 7);
    // On a range that spans years, the first label and every January carry the year.
    const withYear = multiYear && (lastMonth === '' || mo.endsWith('-01'));
    nodes.push(el('span', { text: showLabel ? (withYear ? dfMonYear : dfMonShort).format(parseYmd(first.date)) : '' }));
    if (showLabel) lastMonth = mo;
    nodes.push(...col);
    col = [];
  };
  let firstOfCol = days[0];
  for (let i = 0; i < days[0].dow; i++) col.push(el('i'));
  const cells = [];
  let dailyOnly = false, anyMissing = false;
  for (const d of days) {
    if (d.dow === 0 && col.length) { flush(firstOfCol); firstOfCol = d; }
    if (!col.length) firstOfCol = d;
    if (d.games && !d.time) dailyOnly = true;
    if (d.missing) anyMissing = true;
    // A day in a month that failed to load is "not loaded", never "no games"; one at a month's edge
    // that has games from the neighbouring month is partly loaded.
    const b = el('button', {
      type: 'button', 'data-fk': `cal:${d.date}`, class: d.missing ? (d.games ? 'missing partial' : 'missing') : null,
      'aria-label': `${dateStr(d.date, dfLong)}: ${d.games ? `${d.time ? `${dur(d.time)}, ` : ''}${plural(d.games, 'game')}${d.missing ? ', partly not loaded' : ''}` : d.missing ? 'not loaded' : 'no games'}`,
      'aria-pressed': String(S.sel?.mode === 'day' && S.sel.key === d.date),
      style: d.time ? `background-color:${mixTime(LEVEL_MIX[level(d.time, max)])}` : (d.games ? 'background-color:var(--axis)' : null),
      // Like a ledger row: always opens (never toggles) and brings the panel above into view.
      onclick: (ev) => select('day', d.date, { scroll: true, kb: ev.detail === 0, from: `cal:${d.date}` }),
    });
    setTip(b, () => bucketTip({ ...d, label: dateStr(d.date, dfLong), span: 1, missing: d.missing ? 1 : 0 }));
    col.push(b); cells.push(b);
  }
  while (col.length < 7) col.push(el('i'));
  flush(firstOfCol);
  swap(cal, ...nodes);
  // One tab stop: up and down move a day, left and right a week (a column is a week).
  const at = (date) => days.findIndex((d) => d.date === date);
  let active = at(calCursor);
  if (active < 0 && S.sel?.mode === 'day') active = at(S.sel.key);
  if (active < 0) active = days.findLastIndex((d) => d.games);
  if (active < 0) active = n - 1;
  rove(cal, cells, active, (i, k) => ({ ArrowUp: i - 1, ArrowDown: i + 1, ArrowLeft: i - 7, ArrowRight: i + 7, Home: 0, End: n - 1 })[k], (i) => { calCursor = days[i].date; });
  cal.setAttribute('role', 'group');
  cal.setAttribute('aria-label', 'Calendar, one square per day. Arrow keys move by day and week, Enter opens a day.');
  // Square size: as large as the panel allows, within reason. A short range does not need the whole
  // width, so the busiest days sit beside it; a long one takes the row and the list drops below.
  const panel = $('calPanel'), phone = innerWidth <= 600;
  const weeks = nodes.length / 8, room = (panel.clientWidth || 600) - (phone ? 30 : 38) - 40;
  // On a phone a square is something to tap: never under 22px, even if a long range then scrolls.
  // The same on a tablet or any touch screen, where the squares may also grow to use the panel.
  const touch = phone || matchMedia('(pointer: coarse)').matches;
  const c = Math.max(touch ? 22 : 13, Math.min(phone ? 38 : touch ? 40 : 24, Math.floor(room / weeks) - 3));
  cal.closest('.cal-box').style.setProperty('--c', `${c}px`);
  // Weekday labels down the side: all seven when the squares are tall enough, else every other one.
  $('calWd').replaceChildren(el('span'), ...[0, 1, 2, 3, 4, 5, 6].map((d) => el('span', { text: c >= 15 || d % 2 === 0 ? dowName(d, true) : '' })));
  renderTopDays(e);
  // Days with only daily games have games but no time: they are drawn grey, and the legend says so.
  const greyKey = dailyOnly ? [el('i', { style: 'background:var(--axis);margin-left:10px' }), 'daily games, no clock'] : [];
  $('calScale').replaceChildren(...(max > 0
    ? ['Less', ...[0, 1, 2, 3, 4, 5].map((l) => el('i', { style: `background:${l ? mixTime(LEVEL_MIX[l]) : 'var(--cell-0)'}` })), `More (up to ${dur(max)} in a day)`]
    : [el('i', { style: 'background:var(--cell-0)' }), 'no games']), ...greyKey,
    ...(anyMissing ? [el('i', { class: 'missing-key', style: 'margin-left:10px' }), 'not loaded'] : []));
  const wrap = cal.parentElement;
  if (!wrap.contains(document.activeElement)) wrap.scrollLeft = wrap.scrollWidth;
  cue(wrap);
}
// The five heaviest days as a ranked list beside the calendar. Each one opens its day.
function renderTopDays(e) {
  const st = e.stats, timed = hasTime(st), val = (d) => (timed ? d.time : d.games);
  const top = st.days.filter((d) => val(d) > 0).sort((a, b) => val(b) - val(a) || (a.date < b.date ? 1 : -1)).slice(0, 5);
  const box = $('topDays').parentElement;
  box.hidden = top.length < 2;
  if (box.hidden) return;
  $('topDaysTitle').textContent = timed ? 'Busiest days' : 'Days with the most games';
  swap($('topDays'), ...top.map((d) => {
    const b = el('button', { type: 'button', class: 'link-btn', text: dateStr(d.date, dfLong), 'data-fk': `top:${d.date}`, onclick: (ev) => select('day', d.date, { scroll: true, kb: ev.detail === 0, from: `top:${d.date}` }) });
    return el('div', { class: 'row' },
      el('span', { class: 'rl' }, b),
      el('span', { class: 'track' }, el('span', { class: 'fill', style: `width:${(val(d) / val(top[0])) * 100}%` })),
      el('span', { class: 'rv' }, timed ? dur(d.time) : plural(d.games, 'game'), timed ? el('small', { text: plural(d.games, 'game') }) : null));
  }));
}
let calCursor = null; // date of the calendar square that holds the tab stop
let heatCursor = 0; // index (dow * 24 + hour) of the heatmap square that holds the tab stop
const MIN_GAMES = 4; // fewer games than this in a slot or bucket are too few to read a win rate from
const HEAT_FLOOR = 0.26; // the faintest "something happened here" on the heatmap: clearly not an empty square

// ---------- rating ----------
function renderElo(e) {
  const st = e.stats, pools = st.elo.byPool;
  $('secElo').hidden = !pools.length;
  if (!pools.length) return;
  // S.pool is the list picked by hand (kept in the link as pool=); the busiest list is shown otherwise.
  const p = pools.find((x) => x.pool === S.pool) || pools[0];
  seg($('poolSeg'), pools.slice(0, 6).map((x) => ({ value: x.pool, label: poolLabel(x) })), p.pool, (v) => { S.pool = v; writeUrl(); renderElo(e); });
  $('poolSeg').hidden = pools.length < 2;
  const sp = (cls, text) => el('span', { class: cls, text });
  // A zero is "0", without a sign; a zero in running text is a dash.
  $('eloTiles').replaceChildren(
    tile('Rating won', p.gained ? sp('up', `+${num(p.gained)}`) : '0', `over ${plural(p.games, 'rated game')}`),
    tile('Rating lost', p.lost ? sp('down', `${MINUS}${num(p.lost)}`) : '0', p.lost ? `${avg(p.lost / p.games)} points for every rated game played` : 'not a point dropped'),
    tile('Net change', sp(p.net > 0 ? 'up' : p.net < 0 ? 'down' : '', signed(p.net)), `${p.start} to ${p.end}`),
    tile('Peak', String(p.peak), `lowest ${p.low}`),
  );
  // One even step per rated game: plotted against real time, a session collapses into a vertical cliff.
  const pts = p.series.map((s, k) => ({ t: k, v: s.rating, i: s.i, at: s.t }));
  // The totals over every rating list belong to the section, not to one list's tile.
  $('eloSub').textContent = `Every rated game moves the rating. This is the sum of the ups, the sum of the downs, and where that left it.${pools.length > 1 ? ` Across ${pools.length === 2 ? 'both rating lists' : `all ${num(pools.length)} rating lists`}: ${gain(st.elo.gained)} won, ${loss(st.elo.lost)} lost.` : ''}`;
  $('eloNote').textContent = `The line takes one step per rated game (${num(pts.length)} in all), so a busy day is wide and a quiet week is narrow. Each date marks that day’s first rated game.`;
  // One rated game draws no line: no chart, just the fact.
  $('eloChart').hidden = pts.length < 2;
  if (pts.length < 2) {
    const g = e.view[pts[0].i];
    $('eloNote').textContent = `One rated game on this list${g ? `, on ${sd(g.end)}` : ''}. It left the rating at ${pts[0].v}.`;
    $('eloChart').replaceChildren();
    return;
  }
  // Tick candidates: the first rated game of each calendar day. The chart draws the ones that fit.
  const ticks = [];
  for (let k = 0, last = ''; k < pts.length; k++) { const dkey = ymd(new Date(pts[k].at)); if (dkey !== last) { ticks.push({ t: k, label: sd(pts[k].at) }); last = dkey; } }
  lineChart($('eloChart'), pts, {
    label: `${poolLabel(p)} rating over time, from ${p.start} to ${p.end}`, start: p.start,
    ticks,
    tip: (pt) => {
      const g = e.view[pt.i];
      return tipBox(String(pt.v), g ? [['When', `${sd(g.end)}, ${dfTime.format(new Date(g.end))}`], ['Game', `${g.outcome} vs ${g.opponent}`], ['Change', g.ratingDelta == null ? '–' : signed(g.ratingDelta)]] : []);
    },
  });
}

// ---------- streaks ----------
function renderStreaks(e) {
  const st = e.stats, s = st.streaks, games = e.view;
  const span = (x) => (x && x.length ? sdSpan(x.start, x.end) : null);
  const cur = s.current;
  setTiles($('streakTiles'), [
    tile('Longest winning streak', streakText(s.longestWin?.length || 0), span(s.longestWin) || 'no wins in the range'),
    tile('Longest losing streak', streakText(s.longestLoss?.length || 0), span(s.longestLoss) || 'no losses in the range'),
    tile('Streak at the end of the range', cur?.type && cur.length ? `${num(cur.length)} ${cur.type === 'win' ? 'won' : cur.type === 'loss' ? 'lost' : 'drawn'}` : '–', 'counting back from the last game'),
    // On a one-day range "days in a row" can only be 1.
    st.range.days > 1 && tile('Most days in a row', num(s.longestDayStreak?.length || 0), s.longestDayStreak?.length ? sdSpan(s.longestDayStreak.startDate, s.longestDayStreak.endDate) : null),
  ].filter(Boolean));
  const cap = 300, from = Math.max(0, games.length - cap);
  $('tapeTitle').textContent = games.length > cap ? `The last ${cap} results, oldest first` : `All ${plural(games.length, 'result')}, oldest first`;
  // The colours carry win, draw and loss; this line says it in words, for everyone and as the tape's name.
  let tw = 0, td = 0, tl = 0, run = 0, best = 0;
  for (let i = from; i < games.length; i++) {
    const o = games[i].outcome;
    if (o === 'win') { tw++; run++; if (run > best) best = run; } else { run = 0; if (o === 'loss') tl++; else td++; }
  }
  const tapeSum = `${games.length > cap ? `Last ${cap}` : `All ${num(games.length)}`}: ${num(tw)} won, ${num(td)} drawn, ${num(tl)} lost; ${best ? `longest winning run ${num(best)}` : 'no wins'}`;
  $('tapeSum').textContent = tapeSum;
  $('tape').setAttribute('role', 'img');
  $('tape').setAttribute('aria-label', `Results, oldest first. ${tapeSum}.`);
  const inRun = (i, r) => r && r.length > 1 && i >= r.startIdx && i <= r.endIdx;
  const frag = [];
  for (let i = from; i < games.length; i++) {
    const g = games[i];
    const n = el('i', { class: `${g.outcome === 'win' ? 'w' : g.outcome === 'loss' ? 'l' : ''}${inRun(i, s.longestWin) || inRun(i, s.longestLoss) ? ' hl' : ''}` });
    setTip(n, () => tipBox(`${g.outcome === 'win' ? 'Won' : g.outcome === 'loss' ? 'Lost' : 'Drew'} vs ${g.opponent}`, [['When', `${sd(g.start)}, ${dfTime.format(new Date(g.start))}`], ['Game', `${CLASS_LABEL[g.timeClass] || g.timeClass}, ${controlLabel(g)}`], ['Rating', g.ratingDelta == null ? '–' : signed(g.ratingDelta)]]));
    frag.push(n);
  }
  $('tape').replaceChildren(...frag);
  $('tapeLegend').replaceChildren(
    el('span', { class: 'key' }, el('i', { class: 'f-win' }), 'Won'), el('span', { class: 'key' }, el('i', { class: 'f-draw' }), 'Drawn'), el('span', { class: 'key' }, el('i', { class: 'f-loss' }), 'Lost'),
    el('span', { class: 'key' }, el('i', { class: 'f-ink', style: 'height:2px;width:14px;border-radius:0' }), 'Longest winning and losing streaks'),
  );
}

// ---------- time of week ----------
function renderWhen(e) {
  const st = e.stats, timed = hasTime(st);
  // Without time at the board the Time view would be blank: show games instead (the choice is kept for later).
  const mode = S.heat === 'time' && !timed ? 'games' : S.heat;
  seg($('heatSeg'), [{ value: 'time', label: 'Time', disabled: !timed }, { value: 'games', label: 'Games' }, { value: 'win', label: 'Win rate' }, { value: 'elo', label: 'Rating' }], mode, (v) => { S.heat = v; renderWhen(e); });
  const cells = st.heatmap.flat();
  const max = mode === 'time' ? maxOf(cells, (c) => c.time) : mode === 'games' ? maxOf(cells, (c) => c.games) : mode === 'elo' ? maxOf(cells, (c) => Math.abs(c.eloNet), 1) : 0;
  const minGames = MIN_GAMES;
  const div = (good, mag) => `color-mix(in oklab, var(--${good ? 'win' : 'loss'}) ${Math.round(Math.min(1, Math.max(0.22, mag)) * 100)}%, var(--surface-2))`;
  const colour = (c) => {
    if (!c.games) return null;
    if (mode === 'time') return c.time ? mixTime(HEAT_FLOOR + (1 - HEAT_FLOOR) * (c.time / max)) : null;
    if (mode === 'games') return mixTime(HEAT_FLOOR + (1 - HEAT_FLOOR) * (c.games / max));
    if (mode === 'win') { if (c.games < minGames) return 'var(--line)'; const r = c.wins / c.games; return div(r >= 0.5, Math.abs(r - 0.5) / 0.3); }
    return c.eloNet ? div(c.eloNet > 0, Math.abs(c.eloNet) / max) : 'var(--line)';
  };
  const nodes = [el('span')], marks = [];
  for (let h = 0; h < 24; h++) nodes.push(el('span', { class: 'hh', text: h % 3 === 0 ? (H12 ? hourName(h).replace(/\s/g, '') : pad(h)) : '' }));
  st.heatmap.forEach((row, dow) => {
    nodes.push(el('span', { class: 'dd', text: dowName(dow, true) }));
    row.forEach((c, h) => {
      const bg = colour(c), title = `${dowName(dow)}, ${hourName(h)} to ${hourName((h + 1) % 24)}`;
      const n = el('div', {
        class: 'cell', style: bg ? `background:${bg}` : null, role: 'img', 'data-fk': `heat:${dow}:${h}`,
        'aria-label': `${title}: ${c.games ? `${c.time ? `${dur(c.time)}, ` : ''}${plural(c.games, 'game')}, ${pct(rate(c))} won, rating ${signed(c.eloNet)}` : 'no games'}`,
      });
      setTip(n, () => tipBox(title, c.games ? [...(c.time ? [['Time', dur(c.time)]] : []), ['Games', num(c.games)], ['Won', `${pct(rate(c))} (${wdl(c)})`], ['Rating', signed(c.eloNet)]] : [], c.games ? null : 'No games'));
      nodes.push(n); marks.push(n);
    });
  });
  swap($('heat'), ...nodes);
  // One tab stop for the 168 squares: left and right move an hour, up and down a day.
  rove($('heat'), marks, heatCursor, (i, k) => {
    const row = Math.floor(i / 24);
    return { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i >= 24 ? i - 24 : null, ArrowDown: i < 144 ? i + 24 : null, Home: row * 24, End: row * 24 + 23 }[k];
  }, (i) => { heatCursor = i; });
  $('heat').setAttribute('role', 'group');
  $('heat').setAttribute('aria-label', 'Hours of the week. Arrow keys move between hours and days.');
  const sw = (bg) => el('i', { style: `background:${bg}` });
  $('heatScale').replaceChildren(...(mode === 'time' || mode === 'games'
    ? ['Less', sw('var(--cell-0)'), ...[HEAT_FLOOR, 0.52, 0.76, 1].map((f) => sw(mixTime(f))), `More (up to ${mode === 'time' ? dur(max) : plural(max, 'game')} in one slot)`]
    : mode === 'win'
      ? ['Mostly lost', ...[1, 0.5].map((f) => sw(div(false, f))), sw('var(--cell-0)'), ...[0.5, 1].map((f) => sw(div(true, f))), `Mostly won. Slots with fewer than ${minGames} games stay grey.`]
      : ['Rating lost', ...[1, 0.5].map((f) => sw(div(false, f))), sw('var(--cell-0)'), ...[0.5, 1].map((f) => sw(div(true, f))), `Rating won (up to ${num(max)} points in one slot)`]));
  // Average time per weekday means nothing without time at the board.
  // A range shorter than a week has some weekdays not at all: the averages would be mostly empty rows.
  $('dowRows').closest('.panel').hidden = !timed || st.range.days < 7;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('whenSub').textContent = `Each square is one hour of the week on your clock${zone ? ` (${zone.replace(/_/g, ' ')})` : ''}, which may not be the player’s.`;
  // On a phone the grid scrolls sideways: open it on the busiest hours, once per player and range.
  const wrap = $('heat').parentElement, sig = `${key(S.users[S.focus] || '')}|${st.range.from}|${st.range.to}|${S.tc}|${S.rated}`;
  if (wrap.dataset.for !== sig && wrap.scrollWidth > wrap.clientWidth + 4) {
    wrap.dataset.for = sig;
    let peak = 0;
    st.byHour.forEach((h, i) => { if (h.games > st.byHour[peak].games) peak = i; });
    const cell = marks[peak].getBoundingClientRect(), box = wrap.getBoundingClientRect();
    wrap.scrollLeft = Math.max(0, cell.left - box.left + wrap.scrollLeft - (wrap.clientWidth + 38) / 2);
  }
  cue(wrap);

  const counts = st.days.reduce((a, d) => { a[d.dow]++; return a; }, Array(7).fill(0));
  const avgT = st.byDow.map((d) => (counts[d.dow] ? d.time / counts[d.dow] : 0)), top = Math.max(...avgT, 1);
  $('dowRows').replaceChildren(...st.byDow.map((d, i) => el('div', { class: 'row' },
    el('span', { class: 'rl', text: dowName(d.dow) }),
    el('span', { class: 'track' }, avgT[i] > 0 && el('span', { class: 'fill', style: `width:${(avgT[i] / top) * 100}%` })),
    // A win rate from fewer than MIN_GAMES games is not given; the count is. A weekday whose games are
    // all daily has no time: it shows its count of daily games, never "0s".
    el('span', { class: 'rv' }, !d.games ? '' : avgT[i] > 0 ? dur(avgT[i]) : plural(d.games, 'daily game'),
      el('small', { text: !d.games ? 'no games' : !(avgT[i] > 0) ? '' : d.games < MIN_GAMES ? plural(d.games, 'game') : `${pct(rate(d))} won` })))));
}

// ---------- sessions ----------
const BOTH = Symbol('spans both columns');
function pairs(head, rows) {
  return el('div', { class: 'pairs' },
    el('div', { class: 'pair head' }, ...head.map((h) => el('span', { text: h }))),
    ...rows.map((r) => el('div', { class: 'pair' }, el('span', { text: r[0] }),
      // [label, value, BOTH]: one figure that belongs to the first column's side, written across both columns.
      r[2] === BOTH ? el('b', { text: r[1], style: 'grid-column: span 2' }) : [el('b', { text: r[1] }), r[2] != null ? el('b', { text: r[2] }) : el('span')])));
}
function renderSessions(e, who) {
  const st = e.stats, s = st.sessions;
  const longest = s.longest != null ? s.list[s.longest] : null;
  $('secSessions').hidden = !s.count;
  if (!s.count) return;
  setTiles($('sessionTiles'), [
    // Sessions touching each day with a live game, averaged (a session across midnight counts on both
    // of its days, as both count as played), so this is never under 1.
    tile('Sessions', num(s.count), s.perDay != null ? `${avg(s.perDay)} on a day played` : null),
    // With one session the average is that session, which the longest-session tile already shows.
    s.count >= 2 && tile('Average session', durNode(s.avgDuration), per(s.avgGames, 'game')),
    // A median says something from three sessions on.
    s.count >= 3 && tile('Half of sessions are under', durNode(s.medianDuration), null),
    tile(s.count === 1 ? 'The one session' : 'Longest session', longest ? durNode(longest.duration) : '–', longest ? `${plural(longest.games, 'game')}${sessionPlay(longest)}, rating ${signed(longest.eloNet)}` : null),
  ].filter(Boolean));
  // A position with fewer than MIN_GAMES games is drawn muted; a 0% bar keeps a stub on the baseline.
  const posItems = s.byPosition.map((p) => ({
    label: p.label, value: p.games ? (p.wins / p.games) * 100 : null, few: p.games > 0 && p.games < MIN_GAMES,
    tip: () => tipBox(`Game ${p.label} of a session`, p.games ? [['Won', pct(rate(p))], ['Games', num(p.games)], ['Won, drawn, lost', wdl(p)], ['Rating', signed(p.eloNet)]] : [],
      !p.games ? 'No games' : p.games < MIN_GAMES ? `Only ${plural(p.games, 'game')}: too few to judge.` : null),
  }));
  // A chart whose every bar is grey says nothing: it goes (and the row beside it takes the width).
  const posShown = posItems.some((d) => d.value != null && !d.few);
  $('posChart').closest('.panel').hidden = !posShown;
  if (posShown) {
    colChart($('posChart'), posItems, { label: 'Share of games won, by position of the game within a session', max: 100, step: 25, fmtY: (v) => v + '%', ref: 50 });
    if (posItems.some((d) => d.few)) $('posChart').append(el('p', { class: 'note', text: `Grey bars come from fewer than ${MIN_GAMES} games, too few to read much into.` }));
  } else $('posChart').replaceChildren();
  // The same rule for the table: a figure from fewer than MIN_GAMES games is a dash, and a table of
  // nothing but dashes is not shown.
  const tl = st.tilt, ok = (n) => n >= MIN_GAMES, cell = (v, n, f) => (ok(n) ? f(v) : '–');
  const bases = [tl.afterWin.games, tl.afterLoss.games, tl.liveWins, tl.liveLosses];
  $('tilt').closest('.panel').hidden = !bases.some(ok);
  const cut = bases.some((n) => n > 0 && !ok(n));
  $('tilt').replaceChildren(
    pairs(['The next game in the session', 'After a win', 'After a loss'], [
      ['is won', cell(tl.afterWin.winRate, tl.afterWin.games, pct), cell(tl.afterLoss.winRate, tl.afterLoss.games, pct)],
      ['starts within 5 minutes', cell(tl.requeueAfterWin, tl.liveWins, pct), cell(tl.requeueAfterLoss, tl.liveLosses, pct)],
      ['starts after a pause of', cell(tl.medianGapAfterWin, tl.afterWin.games, dur), cell(tl.medianGapAfterLoss, tl.afterLoss.games, dur)],
    ]),
    el('p', { class: 'note', text: `Based on ${num(tl.afterWin.games)} games played right after a win and ${num(tl.afterLoss.games)} right after a loss. The pause is the typical (median) gap.${cut ? ` A dash means fewer than ${MIN_GAMES} games to go on.` : ''}` }));
  const load = st.dailyLoad.filter((d) => d.days > 0);
  $('loadRows').replaceChildren(
    ...load.map((d) => {
      // Like the rating-gap rows: a group with fewer than MIN_GAMES games is marked as too few to judge.
      const few = d.games < MIN_GAMES;
      return el('div', { class: `row${few ? ' few' : ''}`, title: few ? `Only ${plural(d.games, 'game')}: not enough to judge.` : null },
        el('span', { class: 'rl', text: `${d.label.replace('-', '–')} games` }),
        wdlBar(d),
        // Too few to judge: the count stands in for a rate that would only mislead.
        el('span', { class: 'rv' }, few ? plural(d.games, 'game') : `${pct(rate(d))} won`, el('small', { text: few ? 'not enough to judge' : `${signed(Math.round(d.eloNet / d.days))} a day` })));
    }),
    el('p', { class: 'note', text: `Days grouped by how many games ${who} played. The bar shows games won, drawn and lost; the last figure is the average rating change on such a day.` }));
}
function wdlBar(o, thin) {
  const b = el('span', { class: `wdl${thin ? ' thin' : ''}`, role: 'img', 'aria-label': `${num(o.wins)} won, ${num(o.draws)} drawn, ${num(o.losses)} lost` },
    o.wins > 0 && el('i', { class: 'w', style: `flex:${o.wins}` }), o.draws > 0 && el('i', { class: 'd', style: `flex:${o.draws}` }), o.losses > 0 && el('i', { class: 'l', style: `flex:${o.losses}` }));
  setTip(b, () => tipBox(null, [['Won', `${num(o.wins)} (${pct(o.wins / o.games)})`], ['Drawn', `${num(o.draws)} (${pct(o.draws / o.games)})`], ['Lost', `${num(o.losses)} (${pct(o.losses / o.games)})`]]));
  return b;
}

// ---------- games ----------
function renderGames(e, who) {
  const st = e.stats, t = st.totals, c = st.clock;
  const hist = st.durationHist;
  // Bin edges are round (js/analyze.js), so the labels are exact edges at an even step (histTicks).
  // A player who mixes time controls gets one peak per control. Each bar is split by control so the
  // peaks explain themselves; counted from the same games and bin edges as the totals.
  const liveGames = e.view.filter((g) => g.live !== false);
  const mix = CLASSES.filter((c) => liveGames.some((g) => g.timeClass === c.key));
  let parts = null;
  if (mix.length > 1 && hist.length) {
    parts = hist.map(() => mix.map(() => 0));
    for (const g of liveGames) {
      const bi = hist.findIndex((b) => g.duration >= b.from && (b.to == null || g.duration < b.to));
      const ci = mix.findIndex((c) => c.key === g.timeClass);
      if (bi >= 0 && ci >= 0) parts[bi][ci]++;
    }
    // Only when the split adds up to every bar exactly.
    if (!hist.every((b, i) => parts[i].reduce((a, x) => a + x, 0) === b.count)) parts = null;
  }
  $('histLegend').replaceChildren(...(parts ? mix.map((c) => el('span', { class: 'key' }, el('i', { class: c.cls }), c.label)) : []));
  colChart($('histChart'), hist.map((b, i) => ({
    value: b.count,
    parts: parts && parts[i].map((v, k) => ({ value: v, cls: mix[k].cls })),
    tip: () => tipBox(b.to == null ? `${dur(b.from)} or longer` : `${dur(b.from)} to ${dur(b.to)}`, [['Games', num(b.count)], ['Share', pct(b.count / Math.max(1, t.liveGames))],
      ...(parts ? mix.map((c, k) => [c.label, num(parts[i][k])]).filter((r) => r[1] !== '0') : [])]),
  })), { label: `Number of games by how long they lasted${parts ? `, split into ${mix.map((c) => c.label.toLowerCase()).join(', ')}` : ''}`, labelWidth: 52, ticks: (max) => histTicks(hist, max) });
  // Game length and the clock are about live games; with daily games only, both panels go.
  const timed = hasTime(st);
  // One or two games make a chart of one or two bars, which says less than the "Game length" tile does.
  $('histChart').closest('.panel').hidden = !hist.length || !timed || t.liveGames < 3;
  $('clockStats').closest('.panel').hidden = !timed;

  const tg = t.thinkGames;
  $('clockStats').replaceChildren(tg ? pairs(['', who, 'Opponents'], [
    ['Clock used in total', dur(t.myThink), dur(t.oppThink)],
    ['Clock used per game', dur(t.myThink / tg), dur(t.oppThink / tg)],
    ['Per move', c.avgMyMove != null ? `${c.avgMyMove.toFixed(1)}s` : '–', c.avgOppMove != null ? `${c.avgOppMove.toFixed(1)}s` : '–'],
    ['Left on the clock when winning', dur(c.avgLeftWin), null],
    ['Left on the clock when losing', dur(c.avgLeftLoss), null],
    // Both figures are the player's own, so they share one cell instead of sitting under "Opponents".
    ['Games decided on time', c.timeoutWins || c.timeoutLosses ? `${num(c.timeoutWins)} won, ${num(c.timeoutLosses)} lost` : 'none', BOTH],
  ]) : el('p', { class: 'empty', text: 'These games carry no clock data.' }));
  if (tg && tg < t.games) $('clockStats').append(el('p', { class: 'note', text: `Clock figures cover the ${num(tg)} games that recorded move times.` }));

  const groups = [['Won', st.endings.wins, 'w', t.wins], ['Lost', st.endings.losses, 'l', t.losses], ['Drawn', st.endings.draws, 'd', t.draws]].filter((g) => g[1].length);
  $('endings').replaceChildren(el('div', { class: 'rows' }, ...groups.flatMap(([name, list, cls, total]) => [
    el('h4', { text: `${name}: ${num(total)}` }),
    ...list.slice(0, 5).map((x) => el('div', { class: 'row' },
      el('span', { class: 'rl', text: ENDING[x.ending] || x.ending, title: ENDING[x.ending] || x.ending }),
      el('span', { class: 'track' }, el('span', { class: `fill ${cls}`, style: `width:${(x.count / Math.max(1, total)) * 100}%` })),
      el('span', { class: 'rv' }, num(x.count), el('small', { text: pct(x.count / Math.max(1, total)) })))),
  ])));

  const DIFF = ['200+ weaker', '100 to 200 weaker', '25 to 100 weaker', 'About equal', '25 to 100 stronger', '100 to 200 stronger', '200+ stronger'];
  const diff = st.ratingDiff.map((b, i) => ({ ...b, name: st.ratingDiff.length === 7 ? DIFF[i] : b.label })).filter((b) => b.games > 0);
  // Like the win-rate heatmap's grey slots: a bucket with fewer than MIN_GAMES games is marked as too few to read much into.
  $('diffRows').replaceChildren(...(diff.length ? diff.map((b) => {
    const few = b.games < MIN_GAMES;
    return el('div', { class: `row wide${few ? ' few' : ''}`, title: few ? `Only ${plural(b.games, 'game')}: not enough to judge.` : null },
      el('span', { class: 'rl', text: b.name, title: few ? null : b.name }), wdlBar(b),
      el('span', { class: 'rv' }, few ? plural(b.games, 'game') : `${pct(rate(b))} won`, el('small', { text: few ? 'not enough to judge' : plural(b.games, 'game') })));
  }) : [el('p', { class: 'empty', text: 'No rated opponents to compare.' })]),
    diff.length ? el('p', { class: 'note', text: 'Opponents grouped by how their rating compared when the game was played.' }) : null);

  const mini = (root, head, rows, empty) => root.replaceChildren(...(rows.length
    ? [el('thead', null, el('tr', null, ...head.map((h, i) => el('th', { class: i && i !== 2 ? 'num' : null, text: h })))), el('tbody', null, ...rows)]
    : [el('tbody', null, el('tr', null, el('td', { class: 'empty', text: empty })))]));
  // A row with fewer than MIN_GAMES games is muted like the other thin samples: its bar would be a
  // full-width 100% or 0% from one or two games. The count stays; the rate gives way to "too few".
  const few = (o) => o.games < MIN_GAMES;
  const wonCell = (o) => el('td', null, wdlBar(o, true), few(o) ? el('small', { class: 'few-cue', text: ' too few' }) : ` ${pct(rate(o))}`);
  const rowOf = (o, ...cells) => el('tr', { class: few(o) ? 'few' : null, title: few(o) ? `Only ${plural(o.games, 'game')}: not enough to judge.` : null }, ...cells);
  mini($('openings'), ['Opening', 'Games', 'Won', 'Time'], st.openings.map((o) => rowOf(o,
    el('td', { text: o.name, title: o.name }), el('td', { class: 'num', text: num(o.games) }),
    wonCell(o), el('td', { class: 'num', text: o.time ? dur(o.time) : '–' }))), 'No opening names in these games.');
  mini($('opponents'), ['Opponent', 'Games', 'Won', 'Time'], st.opponents.map((o) => rowOf(o,
    el('td', null, profileLink(o.username)),
    el('td', { class: 'num', text: num(o.games) }), wonCell(o), el('td', { class: 'num', text: o.time ? dur(o.time) : '–' }))), 'Nobody was played more than once in this range.');
}

// ---------- compare ----------
// One row per player: total time as a bar and time per day (per week on long ranges) as a strip, all on
// shared scales, so the rows can be read against each other. The table below carries every number.
/** The strip's marks: one per day, or one per 7 days on long ranges, each { first, last, time, games }. */
function stripValues(e) {
  const days = e.stats.days;
  if (days.length <= 200) return days.map((d) => ({ first: d.date, last: d.date, time: d.time, games: d.games }));
  const out = [];
  days.forEach((d, i) => {
    const b = (out[Math.floor(i / 7)] ||= { first: d.date, last: d.date, time: 0, games: 0 });
    b.last = d.date; b.time += d.time; b.games += d.games;
  });
  return out;
}
// A player's time per day as a strip of thin columns. Hover, a tap or the arrow keys (one tab stop, the
// same readout as the charts) give each day's date, time and games.
function strip(values, max, label) {
  const NS = 'http://www.w3.org/2000/svg', n = values.length;
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of [['viewBox', `0 0 ${n} 24`], ['preserveAspectRatio', 'none'], ['class', 'cmp-strip'], ['role', 'group'], ['data-chart', 'strip'],
    ['aria-label', `${label}. Use the left and right arrow keys, Home and End to read each one.`]]) svg.setAttribute(k, v);
  const w = n > 120 ? 1 : 0.82;
  values.forEach((v, i) => {
    if (!(v.time > 0)) return;
    const h = Math.max(1, (v.time / max) * 24), r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', i); r.setAttribute('y', 24 - h); r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('class', 'f-time');
    svg.append(r);
  });
  const hov = document.createElementNS(NS, 'rect');
  for (const [k, v] of [['y', 0], ['height', 24], ['width', Math.max(w, n / 160)], ['class', 'hover-band'], ['visibility', 'hidden']]) hov.setAttribute(k, v);
  svg.prepend(hov);
  const live = liveRegion();
  const name = (v) => (v.first === v.last ? dateStr(v.first, dfLong) : `${dateStr(v.first, dfShort)} to ${dateStr(v.last, dfMed)}`);
  const nav = readout(svg, {
    n,
    mark: (i) => { hov.setAttribute('x', i + w / 2 - Number(hov.getAttribute('width')) / 2); hov.setAttribute('visibility', 'visible'); },
    unmark: () => hov.setAttribute('visibility', 'hidden'),
    tip: (i) => tipBox(name(values[i]), values[i].games ? [...(values[i].time ? [['Time', dur(values[i].time)]] : []), ['Games', num(values[i].games)]] : [], values[i].games ? null : 'No games'),
    at: (i) => { const r = svg.getBoundingClientRect(); return [r.left + ((i + 0.5) / n) * r.width, r.bottom - 4]; },
    announce: (text) => { live.textContent = text; },
  });
  const idxAt = (e) => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))); };
  svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') nav.show(idxAt(e), e.clientX, e.clientY); });
  svg.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') nav.show(idxAt(e), e.clientX, e.clientY); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') nav.leave(); });
  const f = document.createDocumentFragment();
  f.append(svg, live);
  return f;
}
function renderCompare() {
  const sec = $('secCompare'), full = S.users.length >= 4;
  $('addForm').hidden = full;
  $('addNote').hidden = !full;
  sec.hidden = S.users.length < 2 || $('results').hidden;
  if (sec.hidden) return;
  const pick = (i) => { S.focus = i; S.sel = null; S.pool = null; rememberFocus(); writeUrl(); render(); };
  const ok = S.users.map((u) => store.get(key(u))).filter((e) => e?.state === 'ok');
  const strips = new Map(ok.map((e) => [e, stripValues(e)]));
  const maxTotal = maxOf(ok, (e) => e.stats.totals.time, 1), maxStrip = maxOf(ok, (e) => maxOf(strips.get(e), (v) => v.time), 1);
  const weekly = ok.some((e) => e.stats.days.length > 200);
  swap($('cmpRows'), ...S.users.map((u, i) => {
    const e = store.get(key(u)), on = i === S.focus;
    const name = el('button', { type: 'button', class: 'link-btn', text: u, 'data-fk': `cmpv:${key(u)}`, 'aria-pressed': String(on), onclick: () => pick(i) });
    if (!e || e.state !== 'ok') return el('div', { class: 'row cmp' }, el('span', { class: 'rl' }, name), el('span', { class: 'cmp-vis empty', text: e?.state === 'error' ? e.error : 'Loading…' }), el('span', { class: 'rv' }));
    const t = e.stats.totals;
    return el('div', { class: `row cmp${on ? ' on' : ''}` },
      el('span', { class: 'rl' }, name),
      el('span', { class: 'cmp-vis' },
        el('span', { class: 'track' }, t.time > 0 && el('span', { class: 'fill', style: `width:${(t.time / maxTotal) * 100}%` })),
        strip(strips.get(e), maxStrip, `${u}: time played per ${weekly ? 'week' : 'day'}`)),
      el('span', { class: 'rv' }, t.time ? dur(t.time) : '–', el('small', { text: plural(t.games, 'game') })));
  }),
  // Where the strips start and end.
  ...(ok.length ? [el('div', { class: 'row cmp cmp-axis' }, el('span', { class: 'rl' }),
    el('span', { class: 'cmp-dates' }, el('span', { text: sd(ok[0].stats.range.from) }), el('span', { text: sd(ok[0].stats.range.to) })), el('span', { class: 'rv' }))] : []));
  $('cmpNote').textContent = `Bar: total time. Strip: time per ${weekly ? 'week' : 'day'}. Same scales on every row. The filled dot is the player on this page; pick a name to switch.`;

  const head = ['Player', 'Time', 'Games', 'Days played', 'On a day played', 'Average game', 'Won', 'Rating', 'Longest session, breaks included', 'Own share of clock time'];
  const rows = S.users.map((u, i) => {
    const e = store.get(key(u));
    const first = el('td', null, el('button', { type: 'button', class: 'link-btn', text: u, 'data-fk': `cmp:${key(u)}`, onclick: (ev) => { ev.stopPropagation(); pick(i); } }));
    if (!e || e.state === 'loading') return el('tr', null, first, el('td', { colspan: head.length - 1, class: 'empty', text: 'Loading…' }));
    if (e.state === 'error') return el('tr', null, first, el('td', { colspan: head.length - 1, class: 'down', text: e.error }));
    const st = e.stats, t = st.totals, L = st.sessions.longest != null ? st.sessions.list[st.sessions.longest] : null;
    return el('tr', { 'data-click': '1', 'aria-current': i === S.focus ? 'true' : null, onclick: () => pick(i) }, first,
      el('td', { class: 'num', text: t.time ? dur(t.time) : '–' }), el('td', { class: 'num', text: num(t.games) }),
      el('td', { class: 'num', text: `${num(t.activeDays)} of ${num(st.range.days)}` }), el('td', { class: 'num', text: t.time ? dur(t.avgPerActiveDay) : '–' }),
      el('td', { class: 'num', text: t.time ? dur(t.avgGame) : '–' }), el('td', { class: 'num', text: pct(rate(t)) }),
      el('td', { class: `num ${st.elo.net > 0 ? 'up' : st.elo.net < 0 ? 'down' : ''}`, text: st.elo.ratedGames ? netText(st.elo.net, st.elo.gained, st.elo.lost) : '–' }),
      el('td', { class: 'num', text: L ? dur(L.duration) : '–' }),
      el('td', { class: 'num', text: t.myThink + t.oppThink ? pct(t.myThink / (t.myThink + t.oppThink)) : '–' }));
  });
  swap($('compare'), el('thead', null, el('tr', null, ...head.map((h, i) => el('th', { class: i ? 'num' : null, text: h })))), el('tbody', null, ...rows));
}

// ---------- ledger ----------
const COLS = [
  { k: 'date', label: 'Date', get: (d) => d.date, show: (d) => dateStr(d.date, dfLong) },
  { k: 'games', label: 'Games' }, { k: 'time', label: 'Time', show: (d) => (d.liveN ? dur(d.time) : '–') },
  { k: 'wins', label: 'Won' }, { k: 'draws', label: 'Drawn' }, { k: 'losses', label: 'Lost' },
  { k: 'eloGained', label: 'Rating won', show: (d) => gain(d.eloGained), cls: () => 'up' },
  { k: 'eloLost', label: 'Rating lost', show: (d) => loss(d.eloLost), cls: () => 'down' },
  { k: 'eloNet', label: 'Net', show: (d) => (d.eloGained || d.eloLost ? signed(d.eloNet) : '–'), cls: (d) => (d.eloNet > 0 ? 'up' : d.eloNet < 0 ? 'down' : '') },
  { k: 'bestWinStreak', label: 'Winning streak' }, { k: 'bestLossStreak', label: 'Losing streak' },
  { k: 'avg', label: 'Average game', get: (d) => (d.liveN ? d.time / d.liveN : 0), show: (d) => (d.liveN ? durT(d.time / d.liveN) : '–') },
];
// On a phone four columns fit: the date and the three things most worth knowing about it. The rest
// follow in the usual order and are reached by scrolling sideways.
const PHONE_ORDER = ['date', 'time', 'games', 'eloNet', 'eloGained', 'eloLost', 'wins', 'draws', 'losses', 'bestWinStreak', 'bestLossStreak', 'avg'];
const ledgerCols = () => (PHONE.matches ? PHONE_ORDER.map((k) => COLS.find((c) => c.k === k)) : COLS);
const REHEAD = 12; // on a phone the ledger repeats its column names every this many rows
// The date as a row shows it: without the year on a phone, where the range line above already has it.
const ledgerDate = (d) => (PHONE.matches && !multiYear ? dfDayMon : dfLong).format(parseYmd(d.date));
function ledgerRows(e) {
  return e.stats.days.map((d) => ({ ...d, liveN: d.gameIdx.reduce((n, i) => n + (e.view[i].live === false ? 0 : 1), 0) }));
}
function renderLedger(e) {
  const st = e.stats, t = st.totals;
  // Days of a month that failed to load (and hold no games) become one "not loaded" row per run of
  // such days, shown even when days without games are hidden: they are not days without games.
  const rows = [];
  let gap = null;
  for (const d of ledgerRows(e)) {
    if (d.missing && !d.games) {
      if (gap) { gap.last = d.date; gap.span++; } else rows.push(gap = { ...d, gap: true, last: d.date, span: 1 });
      continue;
    }
    gap = null;
    if (d.games || !S.hideEmpty) rows.push(d);
  }
  const col = COLS.find((c) => c.k === S.sort.k) || COLS[0], get = col.get || ((d) => d[col.k]);
  rows.sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : a.date < b.date ? -1 : 1) * S.sort.dir; });
  const cols = ledgerCols();
  const head = el('tr', null, ...cols.map((c) => el('th', { class: c.k === 'date' ? null : 'num', 'aria-sort': S.sort.k === c.k ? (S.sort.dir > 0 ? 'ascending' : 'descending') : null },
    el('button', { type: 'button', text: c.label, 'data-fk': `sort:${c.k}`, onclick: () => { S.sort = { k: c.k, dir: S.sort.k === c.k ? -S.sort.dir : c.k === 'date' ? 1 : -1 }; renderLedger(e); } }))));
  // The whole row opens the day for the mouse; the date is a real button for the keyboard and screen readers.
  const open = (d, ev) => select('day', d.date, { scroll: true, kb: ev.detail === 0, from: `day:${d.date}` });
  // A day without games has nothing to open: its date is plain text, so a long range of empty days
  // does not add hundreds of tab stops.
  const body = rows.map((d) => d.gap ? el('tr', { class: 'missing' },
    el('td', { text: d.span === 1 ? ledgerDate(d) : `${sd(d.date)} to ${sd(d.last)}` }),
    el('td', { class: 'missing-cell', colspan: cols.length - 1 }, el('span', { class: 'missing-tag', text: `Not loaded${d.span > 1 ? `: ${plural(d.span, 'day')}` : ''}` })))
    : el('tr', { class: d.missing ? 'partial' : null, title: d.missing ? 'Partly not loaded' : null, 'data-click': d.games ? '1' : null, 'aria-current': S.sel?.mode === 'day' && S.sel.key === d.date ? 'true' : null, onclick: d.games ? (ev) => open(d, ev) : null },
    ...cols.map((c) => c.k === 'date'
      ? el('td', null, d.games ? el('button', { type: 'button', class: 'cell-btn', text: ledgerDate(d), 'data-fk': `day:${d.date}`, onclick: (ev) => { ev.stopPropagation(); open(d, ev); } }) : ledgerDate(d))
      : el('td', { class: `num ${c.cls && (c.show ? c.show(d) !== '–' : true) ? c.cls(d) : ''}`, text: c.show ? c.show(d) : (d.games ? num(d[c.k]) : '–') }))));
  const totals = {
    date: [`${plural(t.activeDays, 'day')} played`, null], games: [num(t.games)], time: [t.time ? dur(t.time) : '–'],
    wins: [num(t.wins)], draws: [num(t.draws)], losses: [num(t.losses)],
    eloGained: [gain(st.elo.gained), 'up'], eloLost: [loss(st.elo.lost), 'down'],
    eloNet: [st.elo.ratedGames ? signed(st.elo.net) : '–', st.elo.net > 0 ? 'up' : st.elo.net < 0 ? 'down' : ''],
    bestWinStreak: [num(st.streaks.longestWin?.length || 0)], bestLossStreak: [num(st.streaks.longestLoss?.length || 0)],
    avg: [t.liveGames ? durT(t.avgGame) : '–'],
  };
  const foot = el('tr', null, ...cols.map((c) => el('td', { class: c.k === 'date' ? null : `num ${totals[c.k][1] || ''}`, text: totals[c.k][0] })));
  // On a phone the table is as tall as its rows and scrolls sideways, so its header cannot stay on
  // screen: the column names are repeated every dozen rows instead (for the eye only; the real header
  // is the one screen readers get), so some are always in view while reading.
  if (PHONE.matches && body.length > REHEAD + 3) {
    for (let i = body.length - (body.length % REHEAD || REHEAD); i >= REHEAD; i -= REHEAD) {
      body.splice(i, 0, el('tr', { class: 'rehead', 'aria-hidden': 'true' }, ...cols.map((c) => el('td', { class: c.k === 'date' ? null : 'num', text: c.label }))));
    }
  }
  swap($('ledger'), el('thead', null, head), el('tbody', null, (body.length ? body :[el('tr', null, el('td', { colspan: cols.length, class: 'empty', text: 'No days to show.' }))])), el('tfoot', null, foot));
}
function downloadCsv() {
  const e = focusEntry();
  if (!e?.stats) return;
  const head = ['date', 'weekday', 'games', 'seconds_played', 'time_played', 'won', 'drawn', 'lost', 'rating_won', 'rating_lost', 'rating_net', 'best_winning_streak', 'worst_losing_streak', 'own_clock_seconds', 'opponent_clock_seconds', 'sessions_touching_day'];
  const lines = [head.join(',')];
  for (const d of e.stats.days) lines.push([d.date, dowName(d.dow), d.games, Math.round(d.time), `"${dur(d.time).replaceAll(NB, ' ')}"`, d.wins, d.draws, d.losses, d.eloGained, d.eloLost, d.eloNet, d.bestWinStreak, d.bestLossStreak, Math.round(d.myThink || 0), Math.round(d.oppThink || 0), d.sessions].join(','));
  const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' })), download: `analyzeyou-${key(S.users[S.focus])}-${e.stats.range.from}-to-${e.stats.range.to}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- events ----------
function submitMain() {
  const u = $('user').value.trim().replace(/^@/, '');
  if (!u) { showMsg('Type a chess.com username first.'); $('user').focus(); return; }
  const rest = S.users.slice(1).filter((x) => key(x) !== key(u));
  S.users = [u, ...rest]; S.focus = 0; S.sel = null; S.pool = null;
  followingUrl = false;
  run();
}
// Back and Forward: read the URL again. Players already loaded for that range are shown as they are;
// anything else is loaded. Neither pushes a history entry.
addEventListener('popstate', () => {
  followingUrl = true;
  hideTip();
  readUrl();
  S.sel = null;
  $('ratedOnly').checked = S.rated;
  $('user').value = S.users[0] || '';
  $('addUser').value = ''; showAddMsg(''); showMsg('');
  syncControls();
  if (!S.users.length) {
    ctrl?.abort(); runId++; setStatus(null);
    $('results').hidden = true; $('intro').hidden = false; $('notice').hidden = true;
    document.title = DEFAULT_TITLE;
    renderPlayers();
    return;
  }
  const ready = S.users.every((u) => { const e = store.get(key(u)); return e?.state === 'ok' && e.rk === rangeKey(); });
  if (!ready) { run(); return; }
  ctrl?.abort(); runId++; setStatus(null);
  S.users = S.users.map((u) => store.get(key(u)).player?.username || u);
  for (const u of S.users) compute(store.get(key(u)));
  lastGood = snapshot();
  writeUrl();
  render();
});
$('form').addEventListener('submit', (ev) => { ev.preventDefault(); submitMain(); });
// After the range changes: a name typed in the box that is not the player on screen is searched for
// with the new range; otherwise the players on screen are loaded again.
function rangeChanged() {
  const typed = cleanName($('user').value);
  if (typed && key(typed) !== key(S.users[0] || '')) { submitMain(); return; }
  syncControls(true);
  if (S.users.length) run(); else writeUrl();
}
$('presets').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-preset]');
  if (!b) return;
  applyPreset(b.dataset.preset);
  rangeChanged();
});
for (const id of ['from', 'to']) $(id).addEventListener('change', () => {
  let f = $('from').value, t = $('to').value;
  if (!t || (!f && S.preset !== 'all')) return;
  f = notAfterToday(f); t = notAfterToday(t);
  if (f && t && f > t) {
    // Keep the range that is on screen; the inputs go back to it.
    showMsg('The start date is after the end date. Swap them or pick a preset.');
    syncControls(true);
    return;
  }
  S.preset = null; S.from = f; S.to = t;
  showMsg('');
  rangeChanged();
});
// Escape closes an open sticker note, else the open day (the day chart uses a first Escape to hide its readout).
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || ev.defaultPrevented) return;
  hideTip();
  const note = $('stickerNote'), inClock = document.activeElement?.closest?.('.clock');
  if (!note.hidden && (inClock || !S.sel)) { closeSticker(); return; }
  if (S.sel && !$('detail').hidden) closeDetail(true);
});
$('addForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const u = cleanName($('addUser').value);
  if (!u) return;
  showAddMsg('');
  followingUrl = false;
  const at = S.users.findIndex((x) => key(x) === key(u));
  // Already in the comparison: say so beside the field (the next edit clears it) and show that player.
  if (at >= 0) { $('addUser').value = ''; S.focus = at; S.sel = null; S.pool = null; rememberFocus(); writeUrl(); render(); showAddMsg(`${S.users[at]} is already here.`); return; }
  if (S.users.length >= 4) return;
  // The name stays in the field until it has loaded; a name that fails is said beside the field.
  pendingAdd = u;
  S.users.push(u);
  run();
});
$('addUser').addEventListener('input', () => showAddMsg(''));
$('ratedOnly').addEventListener('change', (ev) => { S.rated = ev.target.checked; recompute(); });
$('hideEmpty').addEventListener('change', (ev) => { S.hideEmpty = ev.target.checked; renderLedger(focusEntry()); });
$('csvBtn').addEventListener('click', downloadCsv);
$('cancelBtn').addEventListener('click', () => {
  ctrl?.abort(); runId++;
  restore();
  showMsg('Stopped before the games finished loading.');
});
document.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => { $('user').value = b.dataset.try; submitMain(); }));
$('clearCache').addEventListener('click', async () => {
  await clearCache().catch(() => {});
  $('clearCache').textContent = 'Saved games cleared';
  setTimeout(() => { $('clearCache').textContent = 'Clear saved games'; }, 2500);
});
$('themeBtn').addEventListener('click', () => {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('analyzeyou-theme', document.documentElement.dataset.theme); } catch (e) { /* private mode */ }
  syncTheme();
});
function syncTheme() {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  $('themeBtn').textContent = dark ? 'Light' : 'Dark';
}

let rz = 0, lastW = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === lastW) return;
  lastW = innerWidth;
  clearTimeout(rz);
  rz = setTimeout(() => { const e = focusEntry(); if (e?.state === 'ok' && e.stats.totals.games) { hideTip(); renderDays(e); renderElo(e); renderSessions(e, e.player?.username || ''); renderGames(e, e.player?.username || ''); renderLedger(e); cue($('heat').parentElement); } }, 150);
});

// ---------- start ----------
console.info('%canalyzeyou', 'font-weight:800;font-size:16px', '\nReading the source instead of queueing another game. That is the healthiest thing on this page.');
readUrl();
syncTheme();
syncControls();
paintLcd($('lcdMe'), 0, false); paintLcd($('lcdOpp'), 0, false);
// The landing page shows the seven verdicts with their real art and thresholds: a preview, not sample data.
$('lineup').replaceChildren(...lineup().map((t, i, all) => el('li', null, el('div', { class: 'lineup-art' }, t.art), el('b', { text: t.label }),
  el('span', { text: i === 0 ? `under ${durWords(all[1].from)} a day` : `${durWords(t.from)} a day or more` }))));
$('ratedOnly').checked = S.rated;
{
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone) $('tzNote').textContent = ` (${zone.replace(/_/g, ' ')})`;
}
if (S.users.length) { $('user').value = S.users[0]; run(); }
