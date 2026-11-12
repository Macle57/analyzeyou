import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUsername, parseClocks, parseTimeControl, countPlies, openingName, openingFamily,
  normalizeGame, computeRatingDeltas, fetchPlayerGames, clearCache, LAG_PER_PLY,
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
  const months = log.filter((u) => /\/games\/\d{4}\/\d{2}$/.test(u)).map((u) => u.slice(-7)).sort();
  assert.ok(months.includes('2026/08'), 'seed month fetched');
  assert.ok(months.includes('2026/10'));
  assert.ok(!months.includes('2026/06'));
  assert.equal(progress.at(-1).done, progress.at(-1).total);
  // Range filter is by local start; all October games start inside [from, to] in any timezone except the daily one.
  for (const g of res.games) assert.ok(g.start >= from.getTime() && g.start <= to.getTime());
  assert.ok(!res.games.some((g) => g.id === 'seed'), 'seed games are not returned');
  assert.ok(!res.games.some((g) => g.id === 'g-daily'), 'daily game started before the range');
  for (let i = 1; i < res.games.length; i++) assert.ok(res.games[i - 1].start <= res.games[i].start);
  const incr = res.games.find((g) => g.id === 'g-incr');
  assert.equal(incr?.ratingDelta, 30, 'delta against the seed-month game');
  assert.deepEqual(res.warnings, []);
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
});

test('player with no games in range is not an error', async () => {
  const routes = { [API]: PROFILE, [`${API}/games/archives`]: { archives: [] } };
  const res = await fetchPlayerGames('testuser', { from: new Date(2026, 0, 1), to: new Date(2026, 0, 31), fetch: mockApi(routes), now: NOW, cache: false });
  assert.deepEqual(res.games, []);
  assert.equal(res.firstArchive, null);
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
