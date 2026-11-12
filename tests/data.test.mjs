import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUsername, parseClocks, parseTimeControl, countPlies, openingName, openingFamily,
  normalizeGame, computeRatingDeltas, fetchPlayerGames, clearCache, LAG_PER_PLY, isChessComUrl,
} from '../js/data.js';
import * as raw from './fixtures/raw-games.mjs';

const close = (a, b, eps = 0.06) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ------------------------------------------------------------------ parsing helpers

test('validateUsername trims and enforces chess.com rules', () => {
  assert.equal(validateUsername('  Hikaru '), 'Hikaru');
  assert.equal(validateUsername('a_b-c'), 'a_b-c');
  for (const bad of ['', '  ', 'ab', 'has space', 'x'.repeat(26), 'bad!name', 'émile']) {
    assert.throws(() => validateUsername(bad), (e) => e.code === 'invalid' && e.message.length > 0, bad);
  }
});

test('parseTimeControl handles live, increment and daily', () => {
  assert.deepEqual(parseTimeControl('180'), { base: 180, inc: 0 });
  assert.deepEqual(parseTimeControl('600+5'), { base: 600, inc: 5 });
  assert.deepEqual(parseTimeControl('1/86400'), { base: 86400, inc: 0 });
  assert.deepEqual(parseTimeControl(undefined), { base: 0, inc: 0 });
});

test('parseClocks reads %clk values including tenths and hours', () => {
  assert.deepEqual(parseClocks('1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:59.9]} 2. Nf3 {[%clk 1:00:00]}'), [180, 179.9, 3600]);
  assert.deepEqual(parseClocks('1. e4 e5'), []);
  assert.deepEqual(parseClocks(null), []);
});

test('countPlies counts SAN moves, ignoring comments and results', () => {
  assert.equal(countPlies('[Event "x"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 1/2-1/2'), 8);
  assert.equal(countPlies('1. e4 {[%clk 0:01:00]} 1... e5 {c} 2. O-O-O 1-0'), 3);
  assert.equal(countPlies(''), 0);
});

test('openingName drops the move-list tail and restores punctuation', () => {
  assert.equal(
    openingName('https://www.chess.com/openings/Kings-Indian-Defense-Fianchetto-Karlsbad-Panno-Uhlmann-Szabo-System-8.d5-Nb8'),
    "King's Indian Defense Fianchetto Karlsbad Panno Uhlmann Szabo System",
  );
  assert.equal(openingName('https://www.chess.com/openings/Birds-Opening-1...f5'), "Bird's Opening");
  assert.equal(openingName('https://www.chess.com/openings/Queens-Pawn-Opening-Chigorin-Variation...3.Bf4-a6'), "Queen's Pawn Opening Chigorin Variation");
  assert.equal(openingName('https://www.chess.com/openings/Caro-Kann-Defense'), 'Caro-Kann Defense');
  assert.equal(openingName(null), null);
  // chess.com files unclassified games under /openings/Undefined: that is no opening.
  assert.equal(openingName('https://www.chess.com/openings/Undefined'), null);
  assert.equal(openingName('https://www.chess.com/openings/undefined/'), null);
  assert.equal(openingName('https://www.chess.com/openings/Undefined-Variation'), 'Undefined Variation');
  assert.equal(openingFamily('Caro-Kann Defense Two Knights Attack'), 'Caro-Kann Defense');
  assert.equal(openingFamily('Closed Sicilian Defense Grand Prix Attack'), 'Closed Sicilian Defense');
});

// ------------------------------------------------------------------ normalisation

test('increment game: clock usage per side and final think for the side on move', () => {
  const g = normalizeGame(raw.incrementResign, 'testuser');
  assert.equal(g.color, 'white');
  assert.equal(g.opponent, 'Opp1');
  assert.equal(g.outcome, 'win');
  assert.equal(g.ending, 'resignation');
  assert.equal(g.base, 180);
  assert.equal(g.inc, 2);
  assert.equal(g.pool, 'chess:blitz');
  assert.equal(g.start, Date.parse('2026-10-02T12:00:00Z'));
  assert.equal(g.duration, 45);
  assert.equal(g.plies, 5);
  assert.equal(g.moves, 3);
  // White: 0 + (182+2-177) + (177+2-170) = 16. Black: (180+2-181) + (181+2-175) = 9.
  assert.equal(g.myThink, 16);
  // Black was on move when they resigned: 45 - 25 - lag(5 plies) goes to black.
  close(g.oppThink, 9 + 45 - 25 - 5 * LAG_PER_PLY);
  assert.equal(g.myClockLeft, 170);
  close(g.oppClockLeft, 175 - (45 - 25 - 5 * LAG_PER_PLY));
  assert.ok(g.myThink + g.oppThink <= g.duration);
  assert.equal(g.opening, 'Ruy López Opening Morphy Defense');
  assert.equal(g.eco, 'C70');
  assert.equal(g.myAccuracy, 91.5);
  assert.equal(g.oppAccuracy, 70.25);
});

test('timeout: the flagger is charged their whole remaining clock', () => {
  const g = normalizeGame(raw.timeoutLoss, 'TESTUSER');
  assert.equal(g.color, 'black');
  assert.equal(g.outcome, 'loss');
  assert.equal(g.ending, 'timeout');
  assert.equal(g.duration, 70);
  assert.equal(g.myThink, 60);
  assert.equal(g.myClockLeft, 0);
  assert.equal(g.oppThink, 8);
  assert.equal(g.oppClockLeft, 52);
  assert.equal(g.moves, 2);
});

test('checkmate: game ends on a move, nobody gets the unexplained remainder', () => {
  const g = normalizeGame(raw.checkmateWin, 'testuser');
  assert.equal(g.ending, 'checkmate');
  assert.equal(g.myThink, 35);
  assert.equal(g.oppThink, 40);
  assert.equal(g.duration, 100);
  assert.equal(g.moves, 4);
  assert.equal(g.rated, false);
  assert.equal(g.opening, "King's Pawn Opening Wayward Queen Attack");
});

test('no clocks: think and clocks are null, moves come from the movetext', () => {
  const g = normalizeGame(raw.noClocks, 'testuser');
  assert.equal(g.live, true);
  assert.equal(g.outcome, 'draw');
  assert.equal(g.ending, 'agreement');
  assert.equal(g.duration, 300);
  assert.equal(g.myThink, null);
  assert.equal(g.oppThink, null);
  assert.equal(g.myClockLeft, null);
  assert.equal(g.moves, 4);
  assert.equal(g.opening, null);
});

test('daily games are not live and have no time data', () => {
  const g = normalizeGame(raw.daily, 'testuser');
  assert.equal(g.live, false);
  assert.equal(g.duration, 0);
  assert.equal(g.timeClass, 'daily');
  assert.equal(g.base, 259200);
  assert.equal(g.myThink, null);
  assert.equal(g.myClockLeft, null);
  assert.equal(g.ending, 'abandonment');
  assert.equal(g.start, Date.parse('2026-09-28T20:00:00Z'));
  assert.equal(g.plies, 3);
  assert.equal(g.moves, 2);
});

test('start falls back to StartTime across UTC midnight, and to end without a PGN', () => {
  const a = normalizeGame(raw.startTimeOnly, 'testuser');
  assert.equal(a.start, Date.parse('2026-10-02T23:58:00Z'));
  assert.equal(a.duration, 240);
  const b = normalizeGame(raw.noPgn, 'testuser');
  assert.equal(b.start, b.end);
  assert.equal(b.duration, 0);
  assert.equal(b.moves, 0);
  assert.equal(b.ending, 'stalemate');
  assert.equal(b.outcome, 'draw');
  assert.equal(b.pool, 'chess960:blitz');
});

test('normalizeGame returns null when the player is not in the game', () => {
  assert.equal(normalizeGame(raw.incrementResign, 'someoneelse'), null);
});

test('rating deltas: per pool, previous rated game only, unrated ignored', () => {
  const mk = (id, end, pool, rated, myRating) => ({ id, start: end - 100, end, pool, rated, myRating, ratingDelta: 123 });
  const games = [
    mk('b1', 1000, 'chess:blitz', true, 1500),
    mk('u1', 1500, 'chess:blitz', false, 1490), // unrated: no delta, does not reset the baseline
    mk('x1', 1600, 'chess:bullet', true, 1300),
    mk('b2', 2000, 'chess:blitz', true, 1512),
    mk('x2', 2500, 'chess:bullet', true, 1291),
    mk('9', 2600, 'chess960:blitz', true, 1800),
    mk('b3', 3000, 'chess:blitz', true, 1505),
  ];
  computeRatingDeltas([...games].reverse()); // order of input does not matter
  const d = Object.fromEntries(games.map((g) => [g.id, g.ratingDelta]));
  assert.deepEqual(d, { b1: null, u1: null, x1: null, b2: 12, x2: -9, 9: null, b3: -7 });
});

// ------------------------------------------------------------------ fetchPlayerGames (mocked fetch)

function mockApi(routes, log = []) {
  return async (url, init) => {
    log.push(url);
    if (init?.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    const r = typeof routes === 'function' ? routes(url) : routes[url];
    if (r == null) return new Response('{"code":0,"message":"not found"}', { status: 404 });
    if (typeof r === 'number') return new Response('{}', { status: r });
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const API = 'https://api.chess.com/pub/player/testuser';
const PROFILE = {
  username: 'testuser', url: 'https://www.chess.com/member/TestUser', name: 'Test User',
  avatar: 'https://x/a.png', country: 'https://api.chess.com/pub/country/NO', joined: 1600000000,
};
const NOW = Date.parse('2026-11-12T12:00:00Z');

test('invalid username is rejected before any request', async () => {
  const log = [];
  await assert.rejects(fetchPlayerGames('no way!', { fetch: mockApi({}, log) }), (e) => e.code === 'invalid');
  assert.equal(log.length, 0);
});

test('unknown player -> not_found with a readable message', async () => {
  await assert.rejects(
    fetchPlayerGames('nobodyhere', { fetch: mockApi({}), now: NOW }),
    (e) => e.code === 'not_found' && /No chess\.com player is called "nobodyhere"/.test(e.message),
  );
});

test('fetches only overlapping months plus a seed month, seeds rating deltas, filters by start', async () => {
  const routes = {
    [API]: PROFILE,
    [`${API}/games/archives`]: { archives: ['2026/06', '2026/08', '2026/10', '2026/11'].map((m) => `${API}/games/${m}`) },
    [`${API}/games/2026/08`]: { games: [{ ...raw.incrementResign, uuid: 'seed', end_time: Date.parse('2026-08-20T10:00:45Z') / 1000, pgn: raw.incrementResign.pgn.replace('2026.10.02', '2026.08.20').replace('12:00:00', '10:00:00'), white: { ...raw.incrementResign.white, rating: 1480 } }] },
    [`${API}/games/2026/10`]: { games: [raw.incrementResign, raw.timeoutLoss, raw.checkmateWin, raw.noClocks, raw.daily, raw.startTimeOnly, raw.noPgn] },
  };
  const log = [];
  const progress = [];
  const from = new Date(2026, 9, 2); // local 2026-10-02 00:00
  const to = new Date(2026, 9, 3, 23, 59, 59, 999);
  const res = await fetchPlayerGames(' TestUser ', {
    from, to, fetch: mockApi(routes, log), now: NOW, cache: false, onProgress: (p) => progress.push(p),
  });
  assert.deepEqual(res.player, {
    username: 'TestUser', name: 'Test User', avatar: 'https://x/a.png', url: 'https://www.chess.com/member/TestUser',
    country: 'NO', joined: 1600000000000,
  });
  assert.equal(res.firstArchive, '2026-06');
  assert.equal(res.lastArchive, '2026-11', 'newest archive, even though it lies after the range');
  const months = log.filter((u) => /\/games\/\d{4}\/\d{2}$/.test(u)).map((u) => u.slice(-7)).sort();
  assert.ok(months.includes('2026/08'), 'seed month fetched');
  assert.ok(months.includes('2026/10'));
  // June is outside the range; it is read only afterwards, as a baseline walk-back for the pools
  // (bullet, rapid, chess960) that the seed month did not have.
  const monthLog = log.filter((u) => /\/games\/\d{4}\/\d{2}$/.test(u));
  assert.equal(monthLog.at(-1), `${API}/games/2026/06`, 'June only as the last, walk-back request');
  assert.equal(progress.at(-1).done, progress.at(-1).total);
  // Range filter is by local start; all October games start inside [from, to] in any timezone except the daily one.
  for (const g of res.games) assert.ok(g.start >= from.getTime() && g.start <= to.getTime());
  assert.ok(!res.games.some((g) => g.id === 'seed'), 'seed games are not returned');
  assert.ok(!res.games.some((g) => g.id === 'g-daily'), 'daily game started before the range');
  for (let i = 1; i < res.games.length; i++) assert.ok(res.games[i - 1].start <= res.games[i].start);
  const incr = res.games.find((g) => g.id === 'g-incr');
  assert.equal(incr?.ratingDelta, 30, 'delta against the seed-month game');
  // October holds a daily game and the range ends before November, so later-ending daily games could be missing.
  assert.deepEqual(res.warnings, ['Daily games that started in this range but ended after Oct 2026 are not counted.']);
});

test('a stale 404 on the archive list is retried with a cache-busting query', async () => {
  const log = [];
  const routes = (url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return null;
    if (url.startsWith(`${API}/games/archives?`)) return { archives: [`${API}/games/2026/10`] };
    if (url === `${API}/games/2026/10`) return { games: [raw.incrementResign] };
    return null;
  };
  const res = await fetchPlayerGames('testuser', { fetch: mockApi(routes, log), now: NOW, cache: false });
  assert.equal(res.games.length, 1);
  assert.equal(res.firstArchive, '2026-10');
  assert.equal(res.lastArchive, '2026-10');
});

test('player with no games in range is not an error', async () => {
  const routes = { [API]: PROFILE, [`${API}/games/archives`]: { archives: [] } };
  const res = await fetchPlayerGames('testuser', { from: new Date(2026, 0, 1), to: new Date(2026, 0, 31), fetch: mockApi(routes), now: NOW, cache: false });
  assert.deepEqual(res.games, []);
  assert.equal(res.firstArchive, null);
  assert.equal(res.lastArchive, null);
});

test('a dormant player: no games in range, lastArchive names the newest month on record', async () => {
  const log = [];
  const routes = {
    [API]: PROFILE,
    // Unsorted on purpose: the newest month is found by sorting, not by position.
    [`${API}/games/archives`]: { archives: ['2008/04', '2007/11', '2008/02'].map((m) => `${API}/games/${m}`) },
  };
  const res = await fetchPlayerGames('testuser', { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31), fetch: mockApi(routes, log), now: NOW, cache: false });
  assert.deepEqual(res.games, []);
  assert.equal(res.firstArchive, '2007-11');
  assert.equal(res.lastArchive, '2008-04');
  // Only the profile, the archive list and the seed month (the newest before the range) are requested.
  assert.deepEqual(log.filter((u) => /\/games\/\d{4}\/\d{2}$/.test(u)), [`${API}/games/2008/04`]);
});

test('persistent 429 -> rate_limited after retries', async () => {
  let calls = 0;
  const f = async () => { calls++; return new Response('{}', { status: 429 }); };
  await assert.rejects(fetchPlayerGames('testuser', { fetch: f, now: NOW, cache: false, retryBaseMs: 1 }), (e) => e.code === 'rate_limited');
  assert.equal(calls, 3);
});

test('network failure -> network; transient 503 is retried', async () => {
  await assert.rejects(
    fetchPlayerGames('testuser', { fetch: async () => { throw new TypeError('Failed to fetch'); }, now: NOW, cache: false, retryBaseMs: 1 }),
    (e) => e.code === 'network',
  );
  let n = 0;
  const flaky = mockApi((url) => {
    if (url === API && n++ === 0) return 503;
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return { archives: [] };
    return null;
  });
  const res = await fetchPlayerGames('testuser', { fetch: flaky, now: NOW, cache: false, retryBaseMs: 1 });
  assert.equal(res.player.username, 'TestUser');
});

test('abort -> aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(fetchPlayerGames('testuser', { signal: ac.signal, fetch: mockApi({}), now: NOW }), (e) => e.code === 'aborted');
  const ac2 = new AbortController();
  const f = mockApi((url) => { if (url === API) { ac2.abort(); return PROFILE; } return { archives: [`${API}/games/2026/10`] }; });
  await assert.rejects(fetchPlayerGames('testuser', { signal: ac2.signal, fetch: f, now: NOW, cache: false }), (e) => e.code === 'aborted');
});

test('clearCache and caching are harmless without IndexedDB (Node)', async () => {
  await clearCache();
  const routes = { [API]: PROFILE, [`${API}/games/archives`]: { archives: [`${API}/games/2026/10`] }, [`${API}/games/2026/10`]: { games: [raw.checkmateWin] } };
  const res = await fetchPlayerGames('testuser', { fetch: mockApi(routes), now: NOW });
  assert.equal(res.games.length, 1);
});

// ------------------------------------------------------------------ review round 1 regressions

/** A minimal raw game for TestUser (no PGN, so start = end). */
function rawGame(uuid, endIso, timeClass, rating, extra = {}) {
  return {
    url: `https://www.chess.com/game/live/${uuid}`, uuid, time_control: timeClass === 'daily' ? '1/86400' : '180',
    end_time: Math.floor(Date.parse(endIso) / 1000), rated: true, time_class: timeClass, rules: 'chess',
    white: { username: 'TestUser', rating, result: 'win' }, black: { username: 'Opp', rating: 1400, result: 'resigned' },
    ...extra,
  };
}
const archives = (...months) => ({ archives: months.map((m) => `${API}/games/${m}`) });
const utc = (iso) => new Date(Date.parse(iso));
const monthsIn = (log) => log.filter((u) => /\/games\/\d{4}\/\d{2}$/.test(u)).map((u) => u.slice(-7));

test('timeout without start headers: start is backed off by the flagged clock too, think <= duration', () => {
  const pgn = raw.timeoutLoss.pgn.replace(/^\[(UTCDate|UTCTime|StartTime) "[^"]*"\]\n/gm, '');
  assert.ok(!/UTCTime|StartTime/.test(pgn));
  const g = normalizeGame({ ...raw.timeoutLoss, pgn }, 'testuser');
  // White used 8 s, black used 55 s and flagged with 5 s left: 68 s on the clocks in total.
  assert.equal(g.myThink, 60);
  assert.equal(g.oppThink, 8);
  assert.equal(g.duration, 68);
  assert.ok(g.myThink + g.oppThink <= g.duration);
});

test('rating deltas never bridge a month that failed to load', () => {
  const mk = (id, end, myRating) => ({ id, start: end - 100, end, pool: 'chess:blitz', rated: true, myRating, ratingDelta: 0 });
  const aug = mk('aug', Date.parse('2026-08-20T10:00:00Z'), 1400);
  const oct1 = mk('oct1', Date.parse('2026-10-02T10:00:00Z'), 1430);
  const oct2 = mk('oct2', Date.parse('2026-10-02T11:00:00Z'), 1435);
  const sep = [Date.parse('2026-09-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z')];
  computeRatingDeltas([aug, oct1, oct2], [sep]);
  assert.equal(oct1.ratingDelta, null, 'September is unknown, so the October jump is unknown');
  assert.equal(oct2.ratingDelta, 5, 'continuity resumes after the gap');
  computeRatingDeltas([aug, oct1, oct2]);
  assert.equal(oct1.ratingDelta, 30, 'without a gap the delta spans the months');
});

test('a failed month in the range breaks the rating baseline through fetchPlayerGames', async () => {
  const routes = (url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return archives('2026/08', '2026/09', '2026/10');
    if (url === `${API}/games/2026/08`) return { games: [rawGame('aug', '2026-08-20T10:00:00Z', 'blitz', 1400)] };
    if (url === `${API}/games/2026/09`) return 503;
    if (url === `${API}/games/2026/10`) return { games: [rawGame('oct1', '2026-10-02T10:00:00Z', 'blitz', 1430), rawGame('oct2', '2026-10-02T11:00:00Z', 'blitz', 1435)] };
    return null;
  };
  const res = await fetchPlayerGames('testuser', { from: utc('2026-08-15T12:00:00Z'), to: utc('2026-10-05T12:00:00Z'), fetch: mockApi(routes), now: NOW, cache: false, retryBaseMs: 1 });
  const d = Object.fromEntries(res.games.map((g) => [g.id, g.ratingDelta]));
  assert.deepEqual(d, { aug: null, oct1: null, oct2: 5 });
  assert.deepEqual(res.warnings, ["Couldn't load Sep 2026; numbers for that month are missing."]);
  assert.deepEqual(res.failedMonths, ['2026-09'], 'the page offers a retry for these');
});

test('every month overlapping the range failed -> error, even when the seed month loaded', async () => {
  const routes = (url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return archives('2026/09', '2026/10');
    if (url === `${API}/games/2026/09`) return { games: [rawGame('sep', '2026-09-20T10:00:00Z', 'blitz', 1400)] };
    if (url === `${API}/games/2026/10`) return 503;
    return null;
  };
  await assert.rejects(
    fetchPlayerGames('testuser', { from: utc('2026-10-02T12:00:00Z'), to: utc('2026-10-03T12:00:00Z'), fetch: mockApi(routes), now: NOW, cache: false, retryBaseMs: 1 }),
    (e) => e.code === 'network',
  );
});

test('after a fatal month error no queued month starts and onProgress stops', async () => {
  const log = [];
  const slow = (body, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(new Response(JSON.stringify(body), { status: 200 })), 80);
    signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
  });
  const f = async (url, init) => {
    log.push(url);
    if (url === API) return new Response(JSON.stringify(PROFILE), { status: 200 });
    if (url === `${API}/games/archives`) return new Response(JSON.stringify(archives('2026/06', '2026/07', '2026/08', '2026/09', '2026/10')), { status: 200 });
    if (url === `${API}/games/2026/06`) return new Response('{}', { status: 429 });
    return slow({ games: [] }, init?.signal);
  };
  const progress = [];
  let rejectedAt = null;
  await assert.rejects(
    fetchPlayerGames('testuser', { from: utc('2026-06-10T12:00:00Z'), to: utc('2026-10-30T12:00:00Z'), fetch: f, now: NOW, cache: false, retryBaseMs: 1, onProgress: (p) => progress.push({ ...p, late: rejectedAt != null }) })
      .finally(() => { rejectedAt = log.length; }),
    (e) => e.code === 'rate_limited',
  );
  await new Promise((r) => setTimeout(r, 200)); // give stragglers time to (wrongly) report or start
  assert.equal(log.length, rejectedAt, 'no request after the rejection');
  assert.deepEqual(monthsIn(log).sort(), ['2026/06', '2026/06', '2026/06', '2026/07'], 'August to October never started');
  assert.ok(!progress.some((p) => p.late), 'no progress after the rejection');
});

test('pools missing from the seed month walk back for a baseline (bounded, serial)', async () => {
  const log = [];
  const routes = (url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return archives('2026/07', '2026/08', '2026/09', '2026/10');
    if (url === `${API}/games/2026/07`) return { games: [rawGame('jul', '2026-07-20T10:00:00Z', 'blitz', 1390)] };
    if (url === `${API}/games/2026/08`) return { games: [rawGame('aug', '2026-08-20T10:00:00Z', 'blitz', 1400)] };
    if (url === `${API}/games/2026/09`) return { games: [rawGame('sep', '2026-09-20T10:00:00Z', 'bullet', 1200)] };
    if (url === `${API}/games/2026/10`) return { games: [rawGame('oct', '2026-10-02T12:00:00Z', 'blitz', 1410)] };
    return null;
  };
  const res = await fetchPlayerGames('testuser', { from: utc('2026-10-02T00:00:00Z'), to: utc('2026-10-03T23:00:00Z'), fetch: mockApi(routes, log), now: NOW, cache: false });
  assert.equal(res.games.length, 1);
  assert.equal(res.games[0].ratingDelta, 10, 'baseline found in August');
  assert.deepEqual(monthsIn(log).slice(-1), ['2026/08']);
  assert.ok(!monthsIn(log).includes('2026/07'), 'stops as soon as every pool has a baseline');

  // A pool never played before: the walk stops after 6 earlier months and the delta stays null.
  const many = ['2025/12', '2026/01', '2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08', '2026/09', '2026/10'];
  const log2 = [];
  const routes2 = (url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return archives(...many);
    if (url === `${API}/games/2026/10`) return { games: [rawGame('oct', '2026-10-02T12:00:00Z', 'rapid', 1500)] };
    if (/\/games\/\d{4}\/\d{2}$/.test(url)) return { games: [rawGame(url.slice(-7), `${url.slice(-7).replace('/', '-')}-10T10:00:00Z`, 'blitz', 1400)] };
    return null;
  };
  const res2 = await fetchPlayerGames('testuser', { from: utc('2026-10-02T00:00:00Z'), to: utc('2026-10-03T23:00:00Z'), fetch: mockApi(routes2, log2), now: NOW, cache: false });
  assert.equal(res2.games[0].ratingDelta, null);
  assert.deepEqual(monthsIn(log2).sort(), ['2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08', '2026/09', '2026/10']);
});

test('a 404 month is cached for an hour only, never as a closed month', async () => {
  const mem = new Map();
  const cacheStore = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); } };
  const routes = (url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return archives('2026/09', '2026/10');
    if (url === `${API}/games/2026/10`) return { games: [rawGame('oct', '2026-10-02T12:00:00Z', 'blitz', 1410)] };
    return null; // September: stale 404
  };
  const opts = (now, log) => ({ from: utc('2026-09-10T00:00:00Z'), to: utc('2026-10-05T00:00:00Z'), fetch: mockApi(routes, log), now, cacheStore });
  const l1 = [], l2 = [], l3 = [];
  await fetchPlayerGames('testuser', opts(NOW, l1));
  assert.deepEqual(monthsIn(l1).sort(), ['2026/09', '2026/10']);
  assert.equal(mem.get('testuser|2026/09').missing, true);
  await fetchPlayerGames('testuser', opts(NOW + 10 * 60e3, l2));
  assert.deepEqual(monthsIn(l2), [], 'both months reused within the hour');
  await fetchPlayerGames('testuser', opts(NOW + 2 * 3600e3, l3));
  assert.deepEqual(monthsIn(l3), ['2026/09'], 'the 404 month is asked for again; October stays cached');
});

test('daily games in a past range add a warning; a range reaching the current month does not', async () => {
  const routes = (url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return archives('2026/10', '2026/11');
    if (url === `${API}/games/2026/10`) return { games: [rawGame('d1', '2026-10-04T12:00:00Z', 'daily', 1500)] };
    if (url === `${API}/games/2026/11`) return { games: [rawGame('d2', '2026-11-04T12:00:00Z', 'daily', 1505)] };
    return null;
  };
  const past = await fetchPlayerGames('testuser', { from: utc('2026-10-01T12:00:00Z'), to: utc('2026-10-10T12:00:00Z'), fetch: mockApi(routes), now: NOW, cache: false });
  assert.deepEqual(past.warnings, ['Daily games that started in this range but ended after Oct 2026 are not counted.']);
  const current = await fetchPlayerGames('testuser', { from: utc('2026-11-01T12:00:00Z'), to: utc('2026-11-10T12:00:00Z'), fetch: mockApi(routes), now: NOW, cache: false });
  assert.deepEqual(current.warnings, []);
  const noDaily = await fetchPlayerGames('testuser', { from: utc('2026-10-01T12:00:00Z'), to: utc('2026-10-10T12:00:00Z'), fetch: mockApi((u) => (u === `${API}/games/2026/10` ? { games: [rawGame('b', '2026-10-04T12:00:00Z', 'blitz', 1500)] } : routes(u))), now: NOW, cache: false });
  assert.deepEqual(noDaily.warnings, []);
});

test('isChessComUrl accepts only https links on chess.com', () => {
  for (const ok of ['https://www.chess.com/game/live/1', 'https://chess.com/member/x', 'https://images.chess.com/a.png']) assert.ok(isChessComUrl(ok), ok);
  for (const bad of ['javascript:alert(1)', 'http://www.chess.com/game/live/1', 'https://evilchess.com/x', 'https://chess.com.evil.io/x', 'data:text/html,x', '', null, undefined, 42, '/game/live/1']) {
    assert.ok(!isChessComUrl(bad), String(bad));
  }
});

// ------------------------------------------------------------------ review round 3

test('a dropped connection on one month is reported like a 503: the months that loaded are kept', async () => {
  let octTries = 0;
  const api = mockApi((url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return archives('2026/08', '2026/09', '2026/10');
    if (url === `${API}/games/2026/08`) return { games: [rawGame('aug', '2026-08-20T10:00:00Z', 'blitz', 1400)] };
    if (url === `${API}/games/2026/09`) return { games: [rawGame('sep', '2026-09-20T10:00:00Z', 'blitz', 1410)] };
    return null;
  });
  const f = async (url, init) => {
    if (url === `${API}/games/2026/10`) { octTries++; throw new TypeError('Failed to fetch'); }
    return api(url, init);
  };
  const res = await fetchPlayerGames('testuser', { from: utc('2026-08-15T12:00:00Z'), to: utc('2026-10-05T12:00:00Z'), fetch: f, now: NOW, cache: false, retryBaseMs: 1 });
  assert.equal(octTries, 3, 'retried before giving up');
  assert.deepEqual(res.games.map((g) => g.id), ['aug', 'sep']);
  assert.deepEqual(res.failedMonths, ['2026-10']);
  assert.deepEqual(res.warnings, ["Couldn't load Oct 2026; numbers for that month are missing."]);
});

test('a dropped connection on every month of the range is an error, even when the seed month loaded', async () => {
  const api = mockApi((url) => {
    if (url === API) return PROFILE;
    if (url === `${API}/games/archives`) return archives('2026/09', '2026/10', '2026/11');
    if (url === `${API}/games/2026/09`) return { games: [rawGame('sep', '2026-09-20T10:00:00Z', 'blitz', 1400)] };
    return null;
  });
  const f = async (url, init) => {
    if (/games\/2026\/1[01]$/.test(url)) throw new TypeError('Failed to fetch');
    return api(url, init);
  };
  await assert.rejects(
    fetchPlayerGames('testuser', { from: utc('2026-10-14T12:00:00Z'), to: utc('2026-11-12T12:00:00Z'), fetch: f, now: NOW, cache: false, retryBaseMs: 1 }),
    (e) => e.code === 'network',
  );
});
