#!/usr/bin/env node
// Fetches real games through js/data.js, runs js/analyze.js and writes
// tests/fixtures/sample-<username>.json as { player, games, stats }, then prints sanity checks.
//
//   node scripts/sample.mjs <username> <fromYYYY-MM-DD> <toYYYY-MM-DD>
//   node scripts/sample.mjs hikaru 60d          (last 60 days, ending today)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPlayerGames } from '../js/data.js';
import { analyze } from '../js/analyze.js';

// chess.com's Cloudflare front answers 403 to non-browser User-Agents. The browser app sends
// no custom headers; only this script wraps fetch.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const browserLikeFetch = (url, init = {}) =>
  fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) } });

function parseDay(s, endOfDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  return endOfDay ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999) : new Date(+m[1], +m[2] - 1, +m[3]);
}

const [username, a, b] = process.argv.slice(2);
if (!username || !a) {
  console.error('usage: node scripts/sample.mjs <username> <fromYYYY-MM-DD> <toYYYY-MM-DD> | <username> <N>d');
  process.exit(2);
}
let from, to;
const rel = /^(\d+)d$/.exec(a);
if (rel) {
  const now = new Date();
  to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (+rel[1] - 1));
} else {
  from = parseDay(a, false);
  to = parseDay(b ?? a, true);
}

const t0 = Date.now();
const res = await fetchPlayerGames(username, {
  from, to, fetch: browserLikeFetch, cache: false,
  onProgress: ({ done, total, label }) => process.stderr.write(`\r  ${done}/${total} ${label}        `),
});
process.stderr.write('\n');
const t1 = Date.now();
const stats = analyze(res.games, { from, to });
const t2 = Date.now();

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'tests', 'fixtures', `sample-${username.toLowerCase()}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ player: res.player, games: res.games, stats }));
console.log(`wrote ${out}: ${res.games.length} games, fetch ${t1 - t0} ms, analyze ${t2 - t1} ms`);
if (res.warnings.length) console.log('warnings:', res.warnings);

// ------------------------------------------------------------- sanity checks
const g = res.games;
const S = stats;
const sum = (arr, f) => arr.reduce((acc, x) => acc + f(x), 0);
const checks = [];
const check = (label, ok, detail = '') => checks.push({ label, ok, detail });
const near = (x, y, eps = 1e-6) => Math.abs(x - y) <= eps * Math.max(1, Math.abs(x), Math.abs(y));

check('totals.games = sum(days.games)', S.totals.games === sum(S.days, (d) => d.games), `${S.totals.games} vs ${sum(S.days, (d) => d.games)}`);
check('totals.time = sum(days.time)', near(S.totals.time, sum(S.days, (d) => d.time)));
check('wins+losses+draws = games', S.totals.wins + S.totals.losses + S.totals.draws === S.totals.games);
check('elo.net = sum(days.eloNet)', S.elo.net === sum(S.days, (d) => d.eloNet), `${S.elo.net} vs ${sum(S.days, (d) => d.eloNet)}`);
for (const p of S.elo.byPool) check(`pool ${p.pool}: end - start = net`, p.end - p.start === p.net, `start ${p.start} end ${p.end} net ${p.net} peak ${p.peak} low ${p.low}`);
check('sessions cover all live games', sum(S.sessions.list, (s) => s.games) === S.totals.liveGames);
check('heatmap games = total', sum(S.heatmap.flat(), (c) => c.games) === S.totals.games);
check('byHour time = total time', near(sum(S.byHour, (h) => h.time), S.totals.time));
check('durationHist count = live games', sum(S.durationHist, (b) => b.count) === S.totals.liveGames);
const think = g.filter((x) => x.live && x.myThink != null);
const over = think.filter((x) => x.myThink + x.oppThink > x.duration + 2);
check('think <= duration (+2 s)', over.length === 0, `${over.length} of ${think.length} exceed`);
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.detail ? `  (${c.detail})` : ''}`);

// ------------------------------------------------------------- data quirks
const live = g.filter((x) => x.live);
const noClock = live.filter((x) => x.myThink == null).length;
const thinkShare = sum(think, (x) => x.myThink + x.oppThink) / Math.max(1, sum(think, (x) => x.duration));
const unrated = g.filter((x) => !x.rated).length;
const noDelta = g.filter((x) => x.rated && x.ratingDelta == null).length;
const noOpening = g.filter((x) => !x.opening).length;
const fmt = (s) => (s == null ? '-' : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`);
console.log(`
player        ${res.player.username} (${res.player.name ?? '-'}, ${res.player.country ?? '-'}), first archive ${res.firstArchive}
range         ${S.range.from} .. ${S.range.to} (${S.range.days} days), active ${S.totals.activeDays}
games         ${S.totals.games} (live ${S.totals.liveGames}), W/L/D ${S.totals.wins}/${S.totals.losses}/${S.totals.draws}
time          ${fmt(S.totals.time)} total, avg game ${S.totals.avgGame?.toFixed(0)} s, median ${S.totals.medianGame} s, per active day ${fmt(S.totals.avgPerActiveDay)}
think         me ${fmt(S.totals.myThink)} / opp ${fmt(S.totals.oppThink)} over ${S.totals.thinkGames} games; clocks explain ${(thinkShare * 100).toFixed(1)}% of wall time
clock         avg move me ${S.clock.avgMyMove?.toFixed(2)} s, opp ${S.clock.avgOppMove?.toFixed(2)} s; left in wins ${S.clock.avgLeftWin?.toFixed(1)} s, losses ${S.clock.avgLeftLoss?.toFixed(1)} s; faster ${(S.clock.fasterShare * 100).toFixed(0)}%
missing       no clocks ${noClock}/${live.length} live, unrated ${unrated}, rated w/o delta ${noDelta}, no opening ${noOpening}
sessions      ${S.sessions.count}, avg ${fmt(S.sessions.avgDuration)}, median ${fmt(S.sessions.medianDuration)}, avg games ${S.sessions.avgGames?.toFixed(1)}
records       busiest ${S.records.busiestDay}, most games ${S.records.mostGamesDay}, best elo ${S.records.bestEloDay}, worst elo ${S.records.worstEloDay}
streaks       win ${S.streaks.longestWin.length}, loss ${S.streaks.longestLoss.length}, current ${S.streaks.current.type} x${S.streaks.current.length}, days ${S.streaks.longestDayStreak.length} (current ${S.streaks.currentDayStreak})
tilt          after win ${(S.tilt.afterWin.winRate * 100).toFixed(1)}% (${S.tilt.afterWin.games}), after loss ${(S.tilt.afterLoss.winRate * 100).toFixed(1)}% (${S.tilt.afterLoss.games}); requeue W ${(S.tilt.requeueAfterWin * 100).toFixed(0)}% L ${(S.tilt.requeueAfterLoss * 100).toFixed(0)}%
elo pools     ${S.elo.byPool.map((p) => `${p.pool} ${p.start}->${p.end} (${p.net >= 0 ? '+' : ''}${p.net}, ${p.games} g)`).join('; ')}
by class      ${S.byClass.map((c) => `${c.timeClass} ${c.games} g ${fmt(c.time)}`).join('; ')}
endings W     ${S.endings.wins.map((e) => `${e.ending} ${e.count}`).join(', ')}
endings L     ${S.endings.losses.map((e) => `${e.ending} ${e.count}`).join(', ')}
openings      ${S.openings.slice(0, 5).map((o) => `${o.name} (${o.games})`).join('; ')}
families      ${S.openingFamilies.slice(0, 5).map((o) => `${o.name} (${o.games})`).join('; ')}
hist          ${S.durationHist.map((b) => `${b.from}-${b.to ?? ''}:${b.count}`).join(' ')}
`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
