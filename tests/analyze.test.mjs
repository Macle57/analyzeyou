import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { analyze, dayKey } from '../js/analyze.js';

let seq = 0;
/** Builds a normalised Game. `start` is a local Date (or ms); duration in seconds. */
function G(start, o = {}) {
  const s = start instanceof Date ? start.getTime() : start;
  const duration = o.duration ?? 300;
  const live = o.live ?? (o.timeClass ?? 'blitz') !== 'daily';
  return {
    id: `g${++seq}`, url: null, start: s, end: s + (live ? duration : 86400) * 1000, duration: live ? duration : 0, live,
    timeClass: 'blitz', timeControl: '300', base: 300, inc: 0, rules: 'chess', rated: true, pool: 'chess:blitz',
    color: 'white', opponent: 'opp', myRating: 1500, oppRating: 1500, outcome: 'win', ending: 'resignation',
    moves: 30, plies: 59, myThink: live ? 120 : null, oppThink: live ? 150 : null, myClockLeft: live ? 180 : null,
    oppClockLeft: live ? 150 : null, ratingDelta: null, opening: null, eco: null, myAccuracy: null, oppAccuracy: null,
    ...o,
    ...(o.timeClass && !o.pool ? { pool: `chess:${o.timeClass}` } : {}),
  };
}
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m); // local time, October 2026
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

test('empty input returns a fully formed object covering the range', () => {
  const s = analyze([], { from: new Date(2026, 9, 1), to: new Date(2026, 9, 7, 23, 59, 59) });
  assert.deepEqual(s.range, { from: '2026-10-01', to: '2026-10-07', days: 7 });
  assert.equal(s.days.length, 7);
  assert.equal(s.days[0].date, '2026-10-01');
  assert.equal(s.days[0].dow, 3); // Thursday
  assert.ok(s.days.every((d) => d.games === 0 && d.time === 0 && d.gameIdx.length === 0 && d.firstStart === null));
  assert.equal(s.totals.games, 0);
  assert.equal(s.totals.avgGame, null);
  assert.equal(s.totals.avgPerDay, 0);
  for (const k of Object.keys(s.records)) assert.equal(s.records[k], null, k);
  assert.equal(s.heatmap.length, 7);
  assert.ok(s.heatmap.every((r) => r.length === 24));
  assert.equal(s.byHour.length, 24);
  assert.equal(s.byDow.length, 7);
  assert.deepEqual(s.sessions.list, []);
  assert.deepEqual(s.sessions.byPosition, []);
  assert.equal(s.sessions.longest, null);
  assert.deepEqual(s.durationHist, []);
  assert.deepEqual(s.openings, []);
  assert.equal(s.tilt.afterWin.winRate, null);
  assert.equal(s.streaks.current.type, null);
  assert.equal(s.streaks.currentDayStreak, 0);
  assert.equal(s.clock.fasterShare, null);
  assert.equal(s.ratingDiff.length, 7);
  assert.equal(s.dailyLoad.length, 5);
  // No range and no games: today.
  const t = analyze([], { now: new Date(2026, 4, 3, 12).getTime() });
  assert.deepEqual(t.range, { from: '2026-05-03', to: '2026-05-03', days: 1 });
  assert.equal(analyze(undefined).totals.games, 0);
});

test('a game belongs to the local day and hour of its start, even across local midnight', () => {
  const games = [
    G(at(2, 23, 50), { duration: 900 }), // ends 00:05 on the 3rd
    G(at(3, 0, 10), { duration: 300, outcome: 'loss' }),
  ];
  const s = analyze(games, { from: new Date(2026, 9, 2), to: new Date(2026, 9, 3, 23, 59) });
  assert.equal(s.days[0].games, 1);
  assert.equal(s.days[0].time, 900);
  assert.deepEqual(s.days[0].gameIdx, [0]);
  assert.equal(s.days[0].lastEnd, games[0].end);
  assert.equal(s.days[1].games, 1);
  assert.equal(s.days[1].time, 300);
  assert.equal(s.byHour[23].games, 1);
  assert.equal(s.byHour[0].games, 1);
  assert.equal(s.heatmap[4][23].time, 900); // 2 Oct 2026 is a Friday
  assert.equal(s.heatmap[5][0].losses, 1);
  assert.equal(s.byDow[4].activeDays, 1);
  // One session: the second game starts 5 minutes after the first ends (00:05 -> 00:10).
  assert.equal(s.sessions.count, 1);
  assert.equal(s.days[0].sessions, 1);
  // The session that started before midnight also has a game on the 3rd, so that day counts it too.
  assert.equal(s.days[1].sessions, 1);
});

test('local day bucketing follows the TZ of the runtime', () => {
  const url = new URL('../js/analyze.js', import.meta.url).href;
  const script = `
    const { analyze } = await import(${JSON.stringify(url)});
    const start = Date.parse('2026-10-02T03:00:00Z');
    const g = { id: 'x', start, end: start + 300000, duration: 300, live: true, timeClass: 'blitz', pool: 'chess:blitz',
      rated: false, outcome: 'win', ending: 'resignation', moves: 20, plies: 40, myThink: null, oppThink: null, color: 'white' };
    const s = analyze([g], {});
    console.log(JSON.stringify({ day: s.days[0].date, hour: s.byHour.findIndex((h) => h.games), dow: s.days[0].dow }));`;
  const run = (tz) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: tz } }).toString());
  assert.deepEqual(run('America/New_York'), { day: '2026-10-01', hour: 23, dow: 3 });
  assert.deepEqual(run('Asia/Tokyo'), { day: '2026-10-02', hour: 12, dow: 4 });
});

test('win/loss streaks, current streak and day streaks', () => {
  const o = ['win', 'win', 'loss', 'win', 'win', 'win', 'draw', 'loss', 'loss'];
  // Days 1,1,2,2,3,3,3,5,5 -> day streak 1..3 (3 days), current 1 (day 5)
  const dd = [1, 1, 2, 2, 3, 3, 3, 5, 5];
  const games = o.map((outcome, k) => G(at(dd[k], 10, k * 6), { outcome, duration: 120 }));
  const s = analyze(games, { from: new Date(2026, 9, 1), to: new Date(2026, 9, 5, 23, 59), now: at(20, 12).getTime() });
  assert.deepEqual(s.streaks.longestWin, { length: 3, start: games[3].start, end: games[5].end, startIdx: 3, endIdx: 5, opponents: 1 });
  assert.equal(s.streaks.longestLoss.length, 2);
  assert.equal(s.streaks.longestLoss.startIdx, 7);
  assert.deepEqual(s.streaks.current, { type: 'loss', length: 2 });
  assert.deepEqual(s.streaks.longestDayStreak, { length: 3, startDate: '2026-10-01', endDate: '2026-10-03' });
  assert.equal(s.streaks.currentDayStreak, 1);
  assert.equal(s.days[2].bestWinStreak, 2); // W W D on the 3rd
  assert.equal(s.days[2].bestLossStreak, 0);
  assert.equal(s.days[4].bestLossStreak, 2);
  // Range ending today with no game yet today: yesterday's streak still counts.
  const t = analyze(games, { from: new Date(2026, 9, 1), to: new Date(2026, 9, 6, 23, 59), now: at(6, 9).getTime() });
  assert.equal(t.streaks.currentDayStreak, 1);
  const u = analyze(games, { from: new Date(2026, 9, 1), to: new Date(2026, 9, 6, 23, 59), now: at(20, 9).getTime() });
  assert.equal(u.streaks.currentDayStreak, 0);
});

test('sessions split on the gap, positions, tilt and requeue', () => {
  const games = [
    G(at(4, 10, 0), { duration: 300, outcome: 'win' }), // 10:00-10:05
    G(at(4, 10, 7), { duration: 300, outcome: 'loss' }), // gap 2 min
    G(at(4, 10, 20), { duration: 300, outcome: 'win' }), // gap 8 min
    G(at(4, 11, 30), { duration: 600, outcome: 'draw' }), // gap 65 min -> new session
    G(at(4, 11, 40), { timeClass: 'daily', outcome: 'win' }), // daily: not part of sessions
    G(at(4, 11, 41), { duration: 60, outcome: 'win' }), // gap 1 min
  ];
  const s = analyze(games, { from: new Date(2026, 9, 4), to: new Date(2026, 9, 4, 23, 59) });
  assert.equal(s.sessions.count, 2);
  const [a, b] = s.sessions.list;
  assert.deepEqual([a.games, a.wins, a.losses, a.draws, a.firstIdx, a.lastIdx, a.duration], [3, 2, 1, 0, 0, 2, 25 * 60]);
  assert.deepEqual([b.games, b.firstIdx, b.lastIdx, b.duration], [2, 3, 5, 12 * 60]);
  assert.equal(s.sessions.longest, 0);
  assert.equal(s.sessions.avgGames, 2.5);
  assert.equal(s.days[0].sessions, 2);
  assert.deepEqual(s.sessions.byPosition.map((p) => [p.label, p.games, p.wins]), [['1', 2, 1], ['2', 2, 1], ['3', 1, 1]]);
  // Next game in the same session: after win(0) -> loss, after loss(1) -> win, after draw(3) n/a, after win(2) none.
  assert.deepEqual([s.tilt.afterWin.games, s.tilt.afterWin.losses], [1, 1]);
  assert.deepEqual([s.tilt.afterLoss.games, s.tilt.afterLoss.wins, s.tilt.afterLoss.winRate], [1, 1, 1]);
  assert.equal(s.tilt.medianGapAfterWin, 120);
  assert.equal(s.tilt.medianGapAfterLoss, 480);
  // Live wins: 0 (next in 2 min: yes), 2 (next in 65 min: no), 5 (none) -> 1/3. Losses: 1 (8 min) -> 0.
  assert.equal(s.tilt.requeueAfterWin, 1 / 3);
  assert.equal(s.tilt.requeueAfterLoss, 0);
  // The denominators come with the rates, so the page can refuse to quote a rate from two games.
  assert.equal(s.tilt.liveWins, 3);
  assert.equal(s.tilt.liveWins * s.tilt.requeueAfterWin, 1);
  assert.equal(s.tilt.liveLosses, 1);
  // Daily game counted in games but not in time.
  assert.equal(s.totals.games, 6);
  assert.equal(s.totals.liveGames, 5);
  assert.equal(s.totals.time, 300 * 3 + 600 + 60);
  assert.equal(s.days[0].byClass.daily.games, 1);
  assert.equal(s.days[0].byClass.daily.time, 0);
  // A larger gap setting merges everything.
  assert.equal(analyze(games, { sessionGapMinutes: 90 }).sessions.count, 1);
});

test('10+ session position bucket', () => {
  const games = Array.from({ length: 12 }, (_, k) => G(at(6, 9, k * 5), { duration: 240 }));
  const s = analyze(games, {});
  assert.equal(s.sessions.byPosition.length, 10);
  assert.equal(s.sessions.byPosition[9].label, '10+');
  assert.equal(s.sessions.byPosition[9].games, 3);
});

test('elo per day and per pool, unrated games ignored', () => {
  const games = [
    G(at(7, 9), { myRating: 1510, ratingDelta: 10 }),
    G(at(7, 10), { myRating: 1504, ratingDelta: -6, outcome: 'loss' }),
    G(at(7, 11), { rated: false, myRating: 1504, ratingDelta: null }),
    G(at(7, 12), { timeClass: 'bullet', myRating: 1300, ratingDelta: null }), // first known bullet game
    G(at(8, 9), { timeClass: 'bullet', myRating: 1291, ratingDelta: -9, outcome: 'loss' }),
    G(at(8, 10), { myRating: 1520, ratingDelta: 16 }),
  ];
  const s = analyze(games, {});
  const [d7, d8] = s.days;
  assert.deepEqual([d7.eloGained, d7.eloLost, d7.eloNet], [10, 6, 4]);
  assert.deepEqual(d7.eloByPool['chess:blitz'], { gained: 10, lost: 6, net: 4, games: 2, end: 1504 });
  assert.deepEqual(d7.eloByPool['chess:bullet'], { gained: 0, lost: 0, net: 0, games: 1, end: 1300 });
  assert.deepEqual([d8.eloGained, d8.eloLost, d8.eloNet], [16, 9, 7]);
  assert.deepEqual([s.elo.gained, s.elo.lost, s.elo.net, s.elo.ratedGames], [26, 15, 11, 5]);
  const blitz = s.elo.byPool.find((p) => p.pool === 'chess:blitz');
  assert.deepEqual([blitz.games, blitz.start, blitz.end, blitz.net, blitz.peak, blitz.low], [3, 1500, 1520, 20, 1520, 1504]);
  assert.deepEqual(blitz.series.map((p) => p.i), [0, 1, 5]);
  const bullet = s.elo.byPool.find((p) => p.pool === 'chess:bullet');
  assert.deepEqual([bullet.start, bullet.end, bullet.net], [1300, 1291, -9]);
  assert.equal(s.elo.byPool[0].pool, 'chess:blitz'); // sorted by games desc
  assert.equal(s.records.bestEloDay, '2026-10-08');
  assert.equal(s.records.worstEloDay, null);
  for (const p of s.elo.byPool) assert.equal(p.end - p.start, p.net);
});

test('totals match the sums over days; records; clocks; distributions', () => {
  const games = [
    G(at(9, 9), { duration: 400, outcome: 'win', myRating: 1500, oppRating: 1700, ratingDelta: 12, ending: 'checkmate', opening: 'Sicilian Defense Najdorf Variation', eco: 'B90', opponent: 'Bob', myClockLeft: 40 }),
    G(at(9, 9, 10), { duration: 90, outcome: 'win', myRating: 1508, oppRating: 1520, ratingDelta: 8, opening: 'Sicilian Defense Najdorf Variation', eco: 'B90', opponent: 'bob', myClockLeft: 20 }),
    G(at(9, 9, 20), { duration: 700, outcome: 'loss', ending: 'timeout', myRating: 1500, oppRating: 1400, ratingDelta: -8, myThink: 300, oppThink: 250, opening: 'Sicilian Defense Dragon Variation', color: 'black', opponent: 'Carl', myClockLeft: 0 }),
    G(at(11, 20), { duration: 200, outcome: 'draw', ending: 'repetition', myRating: 1500, oppRating: 1500, ratingDelta: 0, myThink: null, oppThink: null, myClockLeft: null, oppClockLeft: null, opponent: 'Dan' }),
    G(at(11, 21), { timeClass: 'daily', outcome: 'win', opponent: 'Eve' }),
  ];
  const s = analyze(games, { from: new Date(2026, 9, 9), to: new Date(2026, 9, 12, 23, 59), now: at(12, 22).getTime() });
  assert.equal(s.range.days, 4);
  assert.equal(s.totals.games, sum(s.days, (d) => d.games));
  assert.equal(s.totals.time, sum(s.days, (d) => d.time));
  assert.equal(s.totals.myThink, sum(s.days, (d) => d.myThink));
  assert.equal(s.totals.time, 1390);
  assert.equal(s.totals.thinkGames, 3);
  assert.equal(s.totals.myThink, 540);
  assert.equal(s.totals.activeDays, 2);
  assert.equal(s.totals.avgPerActiveDay, 695);
  assert.equal(s.totals.avgPerDay, 1390 / 4);
  assert.equal(s.totals.medianGame, 300);
  assert.equal(s.totals.moves, 150);
  assert.equal(s.elo.net, sum(s.days, (d) => d.eloNet));
  assert.equal(s.records.busiestDay, '2026-10-09');
  assert.equal(s.records.busiestDayLast30, '2026-10-09');
  assert.equal(s.records.mostGamesDay, '2026-10-09');
  assert.equal(s.records.longestGame, 2);
  assert.equal(s.records.quickestWin, 1);
  // Pre-game: me 1488, opponent 1712 -> +224 upset.
  assert.equal(s.records.biggestUpset, 0);
  assert.equal(s.ratingDiff[6].games, 1);
  // Pre-game diffs: +224, +28, -116, 0, 0 (daily, no delta).
  assert.deepEqual(s.ratingDiff.map((b) => b.games), [0, 1, 0, 2, 1, 0, 1]);
  assert.deepEqual(s.byColor, { white: { games: 4, wins: 3, losses: 0, draws: 1 }, black: { games: 1, wins: 0, losses: 1, draws: 0 } });
  assert.deepEqual(s.endings.wins[0], { ending: 'resignation', count: 2 });
  assert.deepEqual(s.endings.losses, [{ ending: 'timeout', count: 1 }]);
  assert.equal(s.clock.timeoutLosses, 1);
  assert.equal(s.clock.avgLeftWin, 30);
  assert.equal(s.clock.avgLeftLoss, 0);
  assert.equal(s.clock.fasterShare, 2 / 3);
  assert.equal(s.clock.avgMyMove, 540 / 90);
  assert.equal(s.openings[0].name, 'Sicilian Defense Najdorf Variation');
  assert.equal(s.openings[0].games, 2);
  assert.equal(s.openings[0].eco, 'B90');
  assert.deepEqual(s.openingFamilies[0], { name: 'Sicilian Defense', games: 3, wins: 2, losses: 1, draws: 0, time: 1190 });
  assert.deepEqual(s.opponents, [{ username: 'Bob', games: 2, wins: 2, losses: 0, draws: 0, time: 490 }]);
  assert.equal(s.byClass[0].timeClass, 'blitz');
  assert.equal(s.byClass.find((c) => c.timeClass === 'daily').avgGame, null);
  assert.deepEqual(s.dailyLoad.map((b) => b.days), [2, 0, 0, 0, 0]);
  assert.equal(sum(s.durationHist, (b) => b.count), 4);
  const last = s.durationHist.at(-1);
  assert.ok(last.to === null || last.to >= 700);
});

test('fast enough for 20k games', () => {
  const games = [];
  let t = new Date(2024, 0, 1, 8).getTime();
  const outcomes = ['win', 'loss', 'draw'];
  for (let k = 0; k < 20000; k++) {
    t += (k % 15 === 0 ? 6 * 3600 : 400) * 1000;
    games.push(G(t, { duration: 180 + (k % 200), outcome: outcomes[k % 3], ratingDelta: (k % 7) - 3, opening: `Opening ${k % 50}`, opponent: `p${k % 300}` }));
  }
  const t0 = performance.now();
  const s = analyze(games, {});
  const ms = performance.now() - t0;
  assert.equal(s.totals.games, 20000);
  assert.ok(ms < 1500, `analyze took ${ms.toFixed(0)} ms`);
});

test('dayKey uses local calendar fields', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 0, 0, 1)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31, 23, 59, 59).getTime()), '2026-12-31');
});

test('days count every session with a game that day, not only sessions that started that day', () => {
  // One session from 23:30 on the 1st running past midnight, one more on the 2nd, nothing on the 3rd.
  const games = [
    G(new Date(2026, 10, 1, 23, 30), { duration: 600 }),
    G(new Date(2026, 10, 1, 23, 45), { duration: 600 }),
    G(new Date(2026, 10, 2, 0, 5), { duration: 600 }), // same session, next day
    G(new Date(2026, 10, 2, 0, 20), { duration: 600 }),
    G(new Date(2026, 10, 2, 9, 0), { duration: 600 }), // a new session
    G(new Date(2026, 10, 2, 9, 30), { timeClass: 'daily' }), // daily: no session
  ];
  const s = analyze(games, { from: new Date(2026, 10, 1), to: new Date(2026, 10, 3, 23, 59) });
  assert.equal(s.sessions.count, 2);
  assert.deepEqual(s.days.map((d) => d.sessions), [1, 2, 0]);
  // Every day with a live game has at least one session.
  for (const d of s.days) if (d.firstStart != null) assert.ok(d.sessions >= 1, d.date);
  assert.equal(s.sessions.list.some((x) => '_day' in x), false, 'no internal fields leak');
});

test('liveDays leaves out days with only daily games, and avgPerActiveDay divides by it', () => {
  const games = [
    G(at(5, 10), { duration: 600 }),
    G(at(5, 11), { duration: 1200 }),
    G(at(6, 12), { timeClass: 'daily' }),
    G(at(7, 12), { timeClass: 'daily' }),
    G(at(8, 9), { duration: 1800 }),
  ];
  const s = analyze(games, { from: new Date(2026, 9, 5), to: new Date(2026, 9, 8, 23, 59) });
  assert.equal(s.totals.activeDays, 4);
  assert.equal(s.totals.liveDays, 2);
  assert.equal(s.totals.time, 3600);
  assert.equal(s.totals.avgPerActiveDay, 1800);
  // Only daily games: no live day, no average.
  const d = analyze([G(at(6, 12), { timeClass: 'daily' })], { from: new Date(2026, 9, 6), to: new Date(2026, 9, 6, 23, 59) });
  assert.equal(d.totals.activeDays, 1);
  assert.equal(d.totals.liveDays, 0);
  assert.equal(d.totals.avgPerActiveDay, null);
  assert.equal(analyze([]).totals.liveDays, 0);
});

test('sessions carry playTime, the sum of game durations, next to the wall-clock duration', () => {
  const games = [
    G(at(10, 9, 0), { duration: 600 }),
    G(at(10, 9, 25), { duration: 300 }), // 15-minute break before it
    G(at(10, 9, 55), { duration: 900 }), // 25-minute break
  ];
  const s = analyze(games, { from: new Date(2026, 9, 10), to: new Date(2026, 9, 10, 23, 59) });
  assert.equal(s.sessions.count, 1);
  const x = s.sessions.list[0];
  assert.equal(x.playTime, 1800);
  assert.equal(x.duration, 70 * 60);
  assert.ok(x.playTime <= x.duration);
  assert.equal(x.playTime, s.totals.time);
});

test('durationHist: round widths, edges on whole multiples, open tail', () => {
  const games = [];
  let t = new Date(2026, 9, 1, 9).getTime();
  // 300 games, 40 s to 7 min 20 s, plus a 25-minute outlier for the tail.
  for (let k = 0; k < 300; k++) { const d = 40 + ((k * 37) % 400); games.push(G(t, { duration: d })); t += (d + 60) * 1000; }
  games.push(G(t, { duration: 1500 }));
  const h = analyze(games).durationHist;
  const width = h[0].to - h[0].from;
  assert.equal(width, 30, 'p95 near 7 minutes fits 20 bins of 30 s, not 20 s');
  for (const b of h) assert.equal(b.from % width, 0);
  assert.equal(h.at(-1).to, null, 'the 25-minute game lands in the open tail');
  assert.equal(h.reduce((a, b) => a + b.count, 0), 301);
});

// ------------------------------------------------------------------ review round 3

test('a session across midnight: sessions.perDay counts it on both days, so it is never under 1', () => {
  // The bullet case: one session from 23:50 into the next day, and both days count as played.
  const games = [
    G(new Date(2026, 10, 1, 23, 50), { duration: 300 }),
    G(new Date(2026, 10, 2, 0, 0), { duration: 300 }),
  ];
  const s = analyze(games, { from: new Date(2026, 10, 1), to: new Date(2026, 10, 2, 23, 59) });
  assert.equal(s.sessions.count, 1);
  assert.equal(s.totals.liveDays, 2);
  assert.equal(s.sessions.perDay, 1, 'count / liveDays would say 0.5');
  assert.equal(analyze([]).sessions.perDay, null);
});

test('the longest streaks count distinct opponents', () => {
  const opp = ['a', 'B', 'b', 'c', 'a', 'x', 'y'];
  const out = ['win', 'win', 'win', 'win', 'win', 'loss', 'loss'];
  const games = opp.map((o, k) => G(at(3, 10, k * 6), { opponent: o, outcome: out[k], duration: 120 }));
  const s = analyze(games, { from: new Date(2026, 9, 3), to: new Date(2026, 9, 3, 23, 59) });
  assert.equal(s.streaks.longestWin.length, 5);
  assert.equal(s.streaks.longestWin.opponents, 3, 'a, b (any case) and c');
  assert.equal(s.streaks.longestLoss.opponents, 2);
  assert.equal(analyze([]).streaks.longestWin.opponents, 0);
});

test('gaps mark the days of a month that failed to load as missing', () => {
  // October 2026 (UTC) did not load. Local days that overlap it are missing, whatever the timezone.
  const gap = [Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1)];
  const s = analyze([G(new Date(2026, 10, 5, 12))], { from: new Date(2026, 8, 25), to: new Date(2026, 10, 6, 23, 59), gaps: [gap] });
  const miss = s.days.filter((d) => d.missing).map((d) => d.date);
  assert.ok(miss.includes('2026-10-02') && miss.includes('2026-10-30'), 'inner days of the month');
  assert.ok(!miss.includes('2026-09-25') && !miss.includes('2026-11-05'), 'days well outside it');
  for (const d of s.days) {
    const start = new Date(...d.date.split('-').map((x, i) => (i === 1 ? x - 1 : +x))).getTime();
    const next = new Date(new Date(start).getFullYear(), new Date(start).getMonth(), new Date(start).getDate() + 1).getTime();
    assert.equal(d.missing, start < gap[1] && next > gap[0], d.date);
  }
  assert.ok(analyze([], { from: new Date(2026, 9, 1), to: new Date(2026, 9, 3) }).days.every((d) => d.missing === false));
});

test('the longest session splits into stretches at breaks of 5 minutes or more; shorter pauses stay inside', () => {
  const games = [
    G(at(12, 9, 0), { duration: 600 }), // 9:00-9:10
    G(at(12, 9, 14), { duration: 600 }), // 4-minute pause: same stretch, ends 9:24
    G(at(12, 9, 29), { duration: 300 }), // exactly 5 minutes: a new stretch, ends 9:34
    G(at(12, 9, 34), { timeClass: 'daily' }), // daily: never part of a session
    G(at(12, 10, 0), { duration: 600 }), // 26-minute break
    G(at(12, 12, 0), { duration: 300 }), // a separate, shorter session
  ];
  const s = analyze(games, { from: new Date(2026, 9, 12), to: new Date(2026, 9, 12, 23, 59) });
  const L = s.sessions.list[s.sessions.longest];
  assert.deepEqual(L.stretches.map((x) => [x.start, x.end, x.games]), [
    [at(12, 9, 0).getTime(), at(12, 9, 24).getTime(), 2],
    [at(12, 9, 29).getTime(), at(12, 9, 34).getTime(), 1],
    [at(12, 10, 0).getTime(), at(12, 10, 10).getTime(), 1],
  ]);
  assert.equal(sum(L.stretches, (x) => x.games), L.games);
  assert.equal(L.stretches[0].start, L.start);
  assert.equal(L.stretches.at(-1).end, L.end);
  assert.equal(s.sessions.list.filter((x) => 'stretches' in x).length, 1, 'only the longest session carries them');
});
