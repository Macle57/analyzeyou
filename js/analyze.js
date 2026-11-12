// analyzeyou statistics: pure, synchronous aggregation of normalised `Game`s (see js/data.js).
// All day/hour bucketing uses the runtime's local timezone. See docs/DATA.md for every field.

import { openingFamily } from './data.js';

const REQUEUE_SECONDS = 5 * 60;

const pad2 = (n) => String(n).padStart(2, '0');
/** Local calendar date 'YYYY-MM-DD' of a ms timestamp or Date. */
export function dayKey(t) {
  const d = t instanceof Date ? t : new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** Monday = 0 ... Sunday = 6. */
const dowOf = (d) => (d.getDay() + 6) % 7;
const parseDay = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };

const rate = (w, n) => (n > 0 ? w / n : null);
function median(arr) {
  if (!arr.length) return null;
  const a = Float64Array.from(arr).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const wld = () => ({ games: 0, wins: 0, losses: 0, draws: 0 });
function addResult(o, g) {
  o.games++;
  if (g.outcome === 'win') o.wins++;
  else if (g.outcome === 'loss') o.losses++;
  else o.draws++;
}
const withRate = (o) => ({ ...o, winRate: rate(o.wins, o.games) });

/**
 * @param {object[]} games normalised games, sorted by start ascending
 * @param {{from?: Date|null, to?: Date|null, sessionGapMinutes?: number, now?: number}} [opts]
 */
export function analyze(games, opts = {}) {
  games = Array.isArray(games) ? games : [];
  const { from = null, to = null, sessionGapMinutes = 30, now = Date.now() } = opts;
  const N = games.length;
  const gapMs = sessionGapMinutes * 60000;

  // ---------------------------------------------------------- per-game precomputation
  const gDay = new Array(N);
  const gDow = new Int8Array(N);
  const gHour = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    const d = new Date(games[i].start);
    gDay[i] = dayKey(d);
    gDow[i] = dowOf(d);
    gHour[i] = d.getHours();
  }
  const delta = (g) => (g.rated && g.ratingDelta != null ? g.ratingDelta : 0);

  // ---------------------------------------------------------- range and days
  const todayKey = dayKey(now);
  const fromKey = from ? dayKey(from) : N ? gDay[0] : todayKey;
  let toKey = to ? dayKey(to) : N ? gDay.reduce((a, b) => (b > a ? b : a)) : todayKey;
  if (toKey < fromKey) toKey = fromKey;
  const days = [];
  const dayIndex = new Map();
  for (let d = parseDay(fromKey), k = fromKey; k <= toKey; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), k = dayKey(d)) {
    dayIndex.set(k, days.length);
    days.push({
      date: k, dow: dowOf(d),
      games: 0, wins: 0, losses: 0, draws: 0,
      time: 0, myThink: 0, oppThink: 0,
      eloGained: 0, eloLost: 0, eloNet: 0, eloByPool: {},
      bestWinStreak: 0, bestLossStreak: 0,
      firstStart: null, lastEnd: null,
      sessions: 0, byClass: {}, gameIdx: [],
    });
  }
  const range = { from: fromKey, to: toKey, days: days.length };

  // ---------------------------------------------------------- single pass over games
  const totals = {
    games: N, liveGames: 0, wins: 0, losses: 0, draws: 0, time: 0, myThink: 0, oppThink: 0, thinkGames: 0,
    avgGame: null, medianGame: null, activeDays: 0, avgPerActiveDay: null, avgPerDay: null, moves: 0,
  };
  const liveDur = [];
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ ...wld(), time: 0, eloNet: 0 })));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, ...wld(), time: 0, eloNet: 0 }));
  const byDow = Array.from({ length: 7 }, (_, dow) => ({ dow, ...wld(), time: 0, eloNet: 0, activeDays: 0, days: 0 }));
  const classMap = new Map();
  const byColor = { white: wld(), black: wld() };
  const endingMaps = { win: new Map(), loss: new Map(), draw: new Map() };
  const openingMap = new Map();
  const familyMap = new Map();
  const oppMap = new Map();
  const poolMap = new Map();
  const ratingDiff = [
    { label: '≤ -200', min: null, max: -200 },
    { label: '-200 to -100', min: -200, max: -100 },
    { label: '-100 to -25', min: -100, max: -25 },
    { label: '-25 to 25', min: -25, max: 25 },
    { label: '25 to 100', min: 25, max: 100 },
    { label: '100 to 200', min: 100, max: 200 },
    { label: '≥ 200', min: 200, max: null },
  ].map((b) => ({ ...b, ...wld() }));
  const clockAcc = { leftWin: 0, nWin: 0, leftLoss: 0, nLoss: 0, timeoutLosses: 0, timeoutWins: 0, faster: 0, myT: 0, myM: 0, oppT: 0, oppM: 0 };
  const elo = { gained: 0, lost: 0, net: 0, ratedGames: 0, byPool: [] };
  let longestGame = null, quickestWin = null, biggestUpset = null, upsetDiff = 0;

  for (let i = 0; i < N; i++) {
    const g = games[i];
    const dl = delta(g);
    const di = dayIndex.get(gDay[i]);
    const day = di != null ? days[di] : null;

    // results
    if (g.outcome === 'win') totals.wins++; else if (g.outcome === 'loss') totals.losses++; else totals.draws++;
    totals.moves += g.moves || 0;
    addResult(byColor[g.color] ?? (byColor[g.color] = wld()), g);
    const em = endingMaps[g.outcome];
    em.set(g.ending, (em.get(g.ending) ?? 0) + 1);

    // live time
    const t = g.live ? g.duration : 0;
    if (g.live) {
      totals.liveGames++;
      totals.time += t;
      liveDur.push(t);
      if (g.myThink != null && g.oppThink != null) {
        totals.thinkGames++;
        totals.myThink += g.myThink;
        totals.oppThink += g.oppThink;
        if (g.myThink < g.oppThink) clockAcc.faster++;
        const plies = g.plies ?? g.moves * 2;
        const myMoves = g.moves || 0;
        const oppMoves = Math.max(0, plies - myMoves);
        if (myMoves) { clockAcc.myT += g.myThink; clockAcc.myM += myMoves; }
        if (oppMoves) { clockAcc.oppT += g.oppThink; clockAcc.oppM += oppMoves; }
      }
      if (g.myClockLeft != null) {
        if (g.outcome === 'win') { clockAcc.leftWin += g.myClockLeft; clockAcc.nWin++; }
        else if (g.outcome === 'loss') { clockAcc.leftLoss += g.myClockLeft; clockAcc.nLoss++; }
      }
      if (longestGame == null || t > games[longestGame].duration) longestGame = i;
      if (g.outcome === 'win' && t > 0 && (quickestWin == null || t < games[quickestWin].duration)) quickestWin = i;
    }
    if (g.ending === 'timeout') { if (g.outcome === 'loss') clockAcc.timeoutLosses++; else if (g.outcome === 'win') clockAcc.timeoutWins++; }

    // pre-game ratings (ratings on a game are post-game)
    if (g.myRating != null && g.oppRating != null) {
      const myPre = g.myRating - dl;
      const oppPre = g.oppRating + dl;
      const diff = oppPre - myPre;
      const b = diff <= -200 ? 0 : diff <= -100 ? 1 : diff < -25 ? 2 : diff <= 25 ? 3 : diff < 100 ? 4 : diff < 200 ? 5 : 6;
      addResult(ratingDiff[b], g);
      if (g.outcome === 'win' && diff > upsetDiff) { upsetDiff = diff; biggestUpset = i; }
    }

    // elo
    if (g.rated && g.myRating != null) {
      elo.ratedGames++;
      let p = poolMap.get(g.pool);
      if (!p) {
        p = { pool: g.pool, timeClass: g.timeClass, rules: g.rules, games: 0, gained: 0, lost: 0, net: 0, start: null, end: null, peak: null, low: null, series: [] };
        poolMap.set(g.pool, p);
      }
      p.games++;
      p.series.push({ t: g.end, rating: g.myRating, i });
      if (dl > 0) { elo.gained += dl; p.gained += dl; } else if (dl < 0) { elo.lost -= dl; p.lost -= dl; }
    }

    // hour / dow
    const hm = heatmap[gDow[i]][gHour[i]];
    const bh = byHour[gHour[i]];
    const bd = byDow[gDow[i]];
    for (const o of [hm, bh, bd]) { addResult(o, g); o.time += t; o.eloNet += dl; }

    // class
    let c = classMap.get(g.timeClass);
    if (!c) { c = { timeClass: g.timeClass, ...wld(), time: 0, liveGames: 0, avgGame: null, eloNet: 0 }; classMap.set(g.timeClass, c); }
    addResult(c, g); c.time += t; c.eloNet += dl; if (g.live) c.liveGames++;

    // openings
    if (g.opening) {
      let o = openingMap.get(g.opening);
      if (!o) { o = { name: g.opening, eco: g.eco, ecos: new Map(), ...wld(), time: 0 }; openingMap.set(g.opening, o); }
      addResult(o, g); o.time += t;
      if (g.eco) o.ecos.set(g.eco, (o.ecos.get(g.eco) ?? 0) + 1);
      const fam = openingFamilyOf(g.opening);
      let f = familyMap.get(fam);
      if (!f) { f = { name: fam, ...wld(), time: 0 }; familyMap.set(fam, f); }
      addResult(f, g); f.time += t;
    }

    // opponents
    if (g.opponent) {
      const k = g.opponent.toLowerCase();
      let o = oppMap.get(k);
      if (!o) { o = { username: g.opponent, ...wld(), time: 0 }; oppMap.set(k, o); }
      addResult(o, g); o.time += t;
    }

    // day
    if (day) {
      addResult(day, g);
      day.gameIdx.push(i);
      day.time += t;
      if (g.live && g.myThink != null && g.oppThink != null) { day.myThink += g.myThink; day.oppThink += g.oppThink; }
      if (dl > 0) day.eloGained += dl; else if (dl < 0) day.eloLost -= dl;
      if (g.rated && g.myRating != null) {
        let ep = day.eloByPool[g.pool];
        if (!ep) ep = day.eloByPool[g.pool] = { gained: 0, lost: 0, net: 0, games: 0, end: null, _endT: -Infinity };
        ep.games++;
        if (dl > 0) ep.gained += dl; else if (dl < 0) ep.lost -= dl;
        ep.net += dl;
        if (g.end >= ep._endT) { ep._endT = g.end; ep.end = g.myRating; }
      }
      if (g.live) {
        if (day.firstStart == null || g.start < day.firstStart) day.firstStart = g.start;
        if (day.lastEnd == null || g.end > day.lastEnd) day.lastEnd = g.end;
      }
      const bc = day.byClass[g.timeClass] ?? (day.byClass[g.timeClass] = { games: 0, time: 0 });
      bc.games++; bc.time += t;
    }
  }
  elo.net = elo.gained - elo.lost;

  // ---------------------------------------------------------- days: finish
  for (const day of days) {
    day.eloNet = day.eloGained - day.eloLost;
    for (const k in day.eloByPool) delete day.eloByPool[k]._endT;
    let w = 0, l = 0;
    let maxWin = 0, maxLoss = 0;
    for (const i of day.gameIdx) {
      const o = games[i].outcome;
      if (o === 'win') { w++; l = 0; } else if (o === 'loss') { l++; w = 0; } else { w = 0; l = 0; }
      if (w > maxWin) maxWin = w;
      if (l > maxLoss) maxLoss = l;
    }
    day.bestWinStreak = maxWin;
    day.bestLossStreak = maxLoss;
    if (day.games > 0) {
      totals.activeDays++;
      byDow[day.dow].activeDays++;
    }
    byDow[day.dow].days++;
  }
  totals.avgGame = totals.liveGames ? totals.time / totals.liveGames : null;
  totals.medianGame = median(liveDur);
  totals.avgPerActiveDay = totals.activeDays ? totals.time / totals.activeDays : null;
  totals.avgPerDay = days.length ? totals.time / days.length : null;

  // ---------------------------------------------------------- sessions and tilt
  const sessionList = [];
  const posBuckets = Array.from({ length: 10 }, (_, k) => ({ label: k === 9 ? '10+' : String(k + 1), ...wld(), eloNet: 0 }));
  const tiltWin = wld(), tiltLoss = wld();
  const gapsWin = [], gapsLoss = [];
  let liveWins = 0, liveLosses = 0, requeueWin = 0, requeueLoss = 0;
  {
    let cur = null;
    let prev = -1; // previous live game index
    for (let i = 0; i < N; i++) {
      const g = games[i];
      if (!g.live) continue;
      if (cur && g.start - cur.end <= gapMs) {
        // continues the session
        const pg = games[prev];
        const gap = Math.max(0, (g.start - pg.end) / 1000);
        if (pg.outcome === 'win') { addResult(tiltWin, g); gapsWin.push(gap); }
        else if (pg.outcome === 'loss') { addResult(tiltLoss, g); gapsLoss.push(gap); }
        cur.games++; cur.lastIdx = i;
        if (g.end > cur.end) cur.end = g.end;
      } else {
        cur = { start: g.start, end: g.end, duration: 0, games: 1, wins: 0, losses: 0, draws: 0, eloNet: 0, firstIdx: i, lastIdx: i };
        sessionList.push(cur);
        const di = dayIndex.get(gDay[i]);
        if (di != null) days[di].sessions++;
      }
      if (g.outcome === 'win') cur.wins++; else if (g.outcome === 'loss') cur.losses++; else cur.draws++;
      cur.eloNet += delta(g);
      const pb = posBuckets[Math.min(cur.games, 10) - 1];
      addResult(pb, g); pb.eloNet += delta(g);
      prev = i;
    }
    for (const s of sessionList) s.duration = Math.max(0, Math.round((s.end - s.start) / 1000));

    // requeue: next live game (any session) starting within 5 minutes of this one's end
    let nextLive = -1;
    const nextStart = new Float64Array(N).fill(Infinity);
    for (let i = N - 1; i >= 0; i--) { if (games[i].live) { nextStart[i] = nextLive >= 0 ? games[nextLive].start : Infinity; nextLive = i; } }
    for (let i = 0; i < N; i++) {
      const g = games[i];
      if (!g.live) continue;
      const quick = nextStart[i] - g.end <= REQUEUE_SECONDS * 1000;
      if (g.outcome === 'win') { liveWins++; if (quick) requeueWin++; }
      else if (g.outcome === 'loss') { liveLosses++; if (quick) requeueLoss++; }
    }
  }
  while (posBuckets.length && posBuckets[posBuckets.length - 1].games === 0) posBuckets.pop();
  let longestSession = null;
  sessionList.forEach((s, k) => { if (longestSession == null || s.duration > sessionList[longestSession].duration) longestSession = k; });
  const sessDur = sessionList.map((s) => s.duration);
  const sessions = {
    count: sessionList.length,
    avgDuration: sessionList.length ? sessDur.reduce((a, b) => a + b, 0) / sessionList.length : null,
    avgGames: sessionList.length ? sessionList.reduce((a, s) => a + s.games, 0) / sessionList.length : null,
    medianDuration: median(sessDur),
    list: sessionList,
    longest: longestSession,
    byPosition: posBuckets.map((b) => ({ label: b.label, games: b.games, wins: b.wins, losses: b.losses, draws: b.draws, winRate: rate(b.wins, b.games), eloNet: b.eloNet })),
  };
  const tilt = {
    afterWin: withRate(tiltWin),
    afterLoss: withRate(tiltLoss),
    requeueAfterWin: rate(requeueWin, liveWins),
    requeueAfterLoss: rate(requeueLoss, liveLosses),
    medianGapAfterWin: median(gapsWin),
    medianGapAfterLoss: median(gapsLoss),
  };

  // ---------------------------------------------------------- streaks
  const streaks = {
    longestWin: { length: 0, start: null, end: null, startIdx: null, endIdx: null },
    longestLoss: { length: 0, start: null, end: null, startIdx: null, endIdx: null },
    current: { type: null, length: 0 },
    longestDayStreak: { length: 0, startDate: null, endDate: null },
    currentDayStreak: 0,
  };
  {
    let runType = null, runLen = 0, runStart = 0;
    for (let i = 0; i < N; i++) {
      const o = games[i].outcome;
      if (o === runType) runLen++; else { runType = o; runLen = 1; runStart = i; }
      const key = o === 'win' ? 'longestWin' : o === 'loss' ? 'longestLoss' : null;
      if (key && runLen > streaks[key].length) {
        streaks[key] = { length: runLen, start: games[runStart].start, end: games[i].end, startIdx: runStart, endIdx: i };
      }
    }
    if (N) streaks.current = { type: runType, length: runLen };

    let len = 0, startK = null;
    for (const day of days) {
      if (day.games > 0) {
        if (len === 0) startK = day.date;
        len++;
        if (len > streaks.longestDayStreak.length) streaks.longestDayStreak = { length: len, startDate: startK, endDate: day.date };
      } else len = 0;
    }
    // Current: count back from the range end; an empty "today" doesn't break a streak yet.
    let k = days.length - 1;
    if (k >= 0 && days[k].games === 0 && days[k].date >= todayKey) k--;
    while (k >= 0 && days[k].games > 0) { streaks.currentDayStreak++; k--; }
  }

  // ---------------------------------------------------------- records
  const pickDay = (list, score, want) => {
    let best = null, bestV = 0;
    for (const d of list) { const v = score(d); if (want(v) && (best == null || v > bestV)) { best = d.date; bestV = v; } }
    return best;
  };
  const last30End = toKey < todayKey ? toKey : todayKey;
  const last30Start = dayKey(new Date(parseDay(last30End).getFullYear(), parseDay(last30End).getMonth(), parseDay(last30End).getDate() - 29));
  const last30 = days.filter((d) => d.date >= last30Start && d.date <= last30End);
  const records = {
    busiestDay: pickDay(days, (d) => d.time, (v) => v > 0),
    busiestDayLast30: pickDay(last30, (d) => d.time, (v) => v > 0),
    mostGamesDay: pickDay(days, (d) => d.games, (v) => v > 0),
    bestEloDay: pickDay(days, (d) => d.eloNet, (v) => v > 0),
    worstEloDay: pickDay(days, (d) => -d.eloNet, (v) => v > 0),
    longestGame: longestGame != null && games[longestGame].duration > 0 ? longestGame : null,
    quickestWin,
    biggestUpset,
  };

  // ---------------------------------------------------------- elo pools
  for (const p of poolMap.values()) {
    p.series.sort((a, b) => a.t - b.t);
    p.net = p.gained - p.lost;
    const first = p.series[0];
    const firstDelta = games[first.i].ratingDelta;
    p.start = firstDelta != null ? first.rating - firstDelta : first.rating;
    p.end = p.series[p.series.length - 1].rating;
    let peak = -Infinity, low = Infinity;
    for (const s of p.series) { if (s.rating > peak) peak = s.rating; if (s.rating < low) low = s.rating; }
    p.peak = peak; p.low = low;
    elo.byPool.push(p);
  }
  elo.byPool.sort((a, b) => b.games - a.games);

  // ---------------------------------------------------------- lists
  const byClass = [...classMap.values()]
    .map((c) => ({ ...c, avgGame: c.liveGames ? c.time / c.liveGames : null }))
    .sort((a, b) => b.time - a.time || b.games - a.games);
  const endingList = (m) => [...m.entries()].map(([ending, count]) => ({ ending, count })).sort((a, b) => b.count - a.count);
  const endings = { wins: endingList(endingMaps.win), losses: endingList(endingMaps.loss), draws: endingList(endingMaps.draw) };
  const openings = [...openingMap.values()]
    .sort((a, b) => b.games - a.games || b.time - a.time)
    .slice(0, 12)
    .map(({ ecos, ...o }) => ({ ...o, eco: topKey(ecos) ?? o.eco }));
  const openingFamilies = [...familyMap.values()].sort((a, b) => b.games - a.games || b.time - a.time).slice(0, 12);
  const opponents = [...oppMap.values()].filter((o) => o.games >= 2).sort((a, b) => b.games - a.games || b.time - a.time).slice(0, 10);

  const dailyLoad = [
    { label: '1-3', min: 1, max: 3 },
    { label: '4-7', min: 4, max: 7 },
    { label: '8-15', min: 8, max: 15 },
    { label: '16-30', min: 16, max: 30 },
    { label: '31+', min: 31, max: null },
  ].map((b) => ({ ...b, days: 0, games: 0, wins: 0, losses: 0, draws: 0, eloNet: 0 }));
  for (const d of days) {
    if (!d.games) continue;
    const b = dailyLoad[d.games <= 3 ? 0 : d.games <= 7 ? 1 : d.games <= 15 ? 2 : d.games <= 30 ? 3 : 4];
    b.days++; b.games += d.games; b.wins += d.wins; b.losses += d.losses; b.draws += d.draws; b.eloNet += d.eloNet;
  }

  const clock = {
    avgLeftWin: clockAcc.nWin ? clockAcc.leftWin / clockAcc.nWin : null,
    avgLeftLoss: clockAcc.nLoss ? clockAcc.leftLoss / clockAcc.nLoss : null,
    timeoutLosses: clockAcc.timeoutLosses,
    timeoutWins: clockAcc.timeoutWins,
    fasterShare: rate(clockAcc.faster, totals.thinkGames),
    avgMyMove: clockAcc.myM ? clockAcc.myT / clockAcc.myM : null,
    avgOppMove: clockAcc.oppM ? clockAcc.oppT / clockAcc.oppM : null,
  };

  return {
    range,
    totals,
    days,
    records,
    elo,
    streaks,
    sessions,
    heatmap,
    byHour,
    byDow,
    tilt,
    byClass,
    byColor,
    endings,
    openings,
    openingFamilies,
    opponents,
    durationHist: durationHistogram(liveDur),
    ratingDiff,
    dailyLoad,
    clock,
  };
}

function topKey(map) {
  let best = null, n = 0;
  for (const [k, v] of map) if (v > n) { best = k; n = v; }
  return best;
}

const familyCache = new Map();
function openingFamilyOf(name) {
  let f = familyCache.get(name);
  if (f === undefined) { f = openingFamily(name); familyCache.set(name, f); }
  return f;
}

const NICE_WIDTHS = [5, 10, 15, 20, 30, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 3600, 7200];
/** Bins from 0 up to ~the 95th percentile, then one open bin (to = null) for the tail. */
function durationHistogram(durations) {
  if (!durations.length) return [];
  const sorted = Float64Array.from(durations).sort();
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const max = sorted[sorted.length - 1];
  const width = NICE_WIDTHS.find((w) => Math.ceil(p95 / w) <= 20) ?? Math.ceil(p95 / 20 / 3600) * 3600;
  let n = Math.max(1, Math.ceil(p95 / width));
  // Skip an open tail bin when the data ends inside the regular bins.
  const tail = max >= n * width;
  const bins = [];
  for (let k = 0; k < n; k++) bins.push({ from: k * width, to: (k + 1) * width, count: 0 });
  if (tail) bins.push({ from: n * width, to: null, count: 0 });
  for (const d of sorted) {
    const k = Math.floor(d / width);
    bins[Math.min(k, bins.length - 1)].count++;
  }
  // Drop empty leading bins (e.g. no bullet game lasts under 30 s) but keep at least one.
  while (bins.length > 1 && bins[0].count === 0) bins.shift();
  return bins;
}
