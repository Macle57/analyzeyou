# Data layer

Two plain ES modules with no dependencies and no build step. They run unchanged in browsers and in Node 22.

| Module | Job |
|---|---|
| `js/data.js` | Fetches a chess.com player's games, normalises them into compact `Game` objects and caches each month in IndexedDB. |
| `js/analyze.js` | `analyze(games, opts)`: pure, synchronous aggregation of `Game[]` into everything the dashboard draws. |

Tests: `node --test tests/` (or `node --test`). Real-data check: `node scripts/sample.mjs <user> <from> <to>` or `node scripts/sample.mjs <user> 60d`.

---

## `fetchPlayerGames(username, { from, to, onProgress, signal })`

- `from` and `to` are `Date`s and both bounds are inclusive. Either can be `null`, meaning no bound. A game is returned when its **start** lies in `[from, to]`.
- `onProgress({ done, total, label })` is called once before the first month (`done: 0`) and after each month. `label` is e.g. `"Oct 2026"`. During the baseline walk-back (below) `total` grows by one for each extra month read.
- `signal` is an `AbortSignal`. Aborting rejects with code `aborted`.
- Extra options for scripts and tests: `fetch` (a custom fetch, used by `scripts/sample.mjs` to send a browser User-Agent), `cache: false`, `cacheStore` (an object with async `get(key)` and `put(key, value)` that replaces IndexedDB), `now` (ms), `retryBaseMs`.

Returns `{ player, games, firstArchive, lastArchive, warnings, failedMonths }`:

- `player`: `{ username, name, avatar, url, country, joined }`. `username` has the canonical casing, taken from the profile URL (the API's `username` field is lowercase). `country` is the ISO-2 code or `null`. `joined` is in ms.
- `games`: `Game[]`, sorted by start ascending.
- `firstArchive`: `'YYYY-MM'` of the earliest month that has games, or `null`.
- `lastArchive`: `'YYYY-MM'` of the newest month in the archive list, whatever the range, or `null` when the player has no archives or the list could not be read. It is a UTC month of game **end** times, like every archive. The page uses it to say when a dormant player last played ("The last games on record are from April 2008").
- `warnings`: strings written for end users. They mean the numbers are incomplete, so the page shows them above the results for as long as that player is shown. Possible warnings:
  - `Couldn't load Oct 2026; numbers for that month are missing.` when some (not all) months of the range failed.
  - `Daily games that started in this range but ended after Oct 2026 are not counted.` when a month of the range held daily games and the range ends before the current month (see *Not covered* below).
  - The archive-list fallback described below.
- `failedMonths`: `'YYYY-MM'` of each month of the range that failed to load (the months the first warning names), `[]` when none did. Those months are not cached, so running the same lookup again retries them; the page offers a "Try again" button when the list is not empty.

### Errors

Every error is a `ChessDataError` (exported) with a `code` and a plain-language `message`.

| code | when |
|---|---|
| `invalid` | Empty username, or one that breaks chess.com's rules (3–25 letters, digits, `_` or `-`). No request is made. |
| `not_found` | The profile is a 404. Message: `No chess.com player is called "xyz". Check the spelling.` |
| `rate_limited` | A request still got 429 after 3 tries. |
| `network` | A request failed after 3 tries (network error or 5xx), or got an unexpected 4xx. Also thrown when **every** month that can hold games of the range failed; a seed month that loaded does not change that. If only some months failed, the call still succeeds and adds a warning. |
| `aborted` | The signal was aborted. |

A player with no games in range is not an error; `games` comes back as `[]`.

### Which months are fetched

chess.com files each game under the UTC month of its **end** time. Ranges are in local time, so:

- The first month is the UTC month of `from − 14 h` and the last is the UTC month of `to + 18 h` (time zone margin plus a long live game), capped at the current month. Only months that appear in the archive list are requested.
- One more month is fetched: the nearest archive **before** the first month (the "seed"). It provides rating baselines, so the first game of each pool in the range gets a `ratingDelta`. Its games are returned only if they start inside the range.
- **Baseline walk-back.** A pool that is played in the range but has no rated game in the seed month (for example blitz in the range, only bullet in the seed month) would start with an unknown delta. For such pools the archives before the seed are read one at a time, newest first, and the walk stops as soon as every such pool has a baseline. It reads at most **6** more months (`BASELINE_WALK_MONTHS` in `js/data.js`), stops at a month that fails, and is skipped when the seed month itself failed. A pool still without a baseline keeps `ratingDelta: null` on its first game.
- Months are fetched 2 at a time. 429, 5xx and network errors are retried up to 3 tries in total, with exponential backoff (0.8 s, then 2.4 s, plus jitter; `Retry-After` is honoured).
- A month that still fails (a dropped connection or a 5xx, treated alike) is skipped and reported in `warnings` and `failedMonths`; the months that loaded are kept. A 429 or an abort is fatal: the call rejects, no further month is started, requests still in flight are cancelled and `onProgress` is not called again.
- A month that answers 404 or 410 counts as empty.

**Archive-list quirk.** chess.com's CDN sometimes serves a stale 404 for `/games/archives` even though the player exists. On 2026-11-12, `magnuscarlsen` did this. The list is then requested again with a cache-busting `?_=<now>` query, which stays a CORS-simple request. If that also fails, every month in the range is requested directly, starting no earlier than the join month, and a warning is added.

**Not covered:** a daily (correspondence) game that starts inside the range but ends after the last fetched month (the UTC month of `to + 18 h`) is filed in a later month that is not fetched, so it is missing. Daily games carry no time statistics, so this affects only counts and ratings. No extra requests are made for it; instead, when a month of the range held daily games and that last month is before the current month, a warning says so.

### Cache (IndexedDB)

- The database is `analyzeyou`, the store is `months`, and the key is `"<lowercased user>|YYYY/MM"`. The value is `{ v: SCHEMA_VERSION, fetchedAt, games }` holding normalised games; raw PGN is never stored.
- A month is **closed**, and cached forever, once it was fetched at least 1 h after it ended in UTC. Anything else, including the current month, is reused for 5 minutes and then refetched.
- A month that answered 404 or 410 is stored with `missing: true` and reused for 1 hour only, never as a closed month: chess.com's CDN can serve a stale 404 for a month that has games.
- Bump `SCHEMA_VERSION` in `js/data.js` when the `Game` shape changes, or when the stored values change meaning. The store is then recreated. Version 2 (2026-11-12): `opening` is `null` for `/openings/Undefined`.
- When IndexedDB is missing or fails (Node, some private modes), the module silently runs without a cache. `clearCache()` never throws.
- `ratingDelta` is computed after merging months, so cached games do not depend on which months were loaded together.

Browser check (headless Chrome, 2026-11-12): a first load of hikaru over 20 days made 5 requests and took 1.3–1.9 s. An immediate reload made 2 requests (profile and archive list) and took about 10 ms.

---

## `Game` shape

| field | meaning |
|---|---|
| `id`, `url` | chess.com uuid (falls back to the URL), game URL |
| `start`, `end` | ms epoch. For `start`, see *Start time* below. `end` = `end_time`. |
| `duration` | Wall-clock seconds, `end − start`, ≥ 0. Always 0 for daily games. |
| `live` | `false` for `timeClass === 'daily'`. Non-live games are left out of every time statistic. |
| `timeClass`, `timeControl`, `base`, `inc` | `"180+2"` gives base 180 and inc 2. Daily `"1/86400"` gives base 86400 (seconds per move) and inc 0. |
| `rules`, `rated`, `pool` | `pool = "${rules}:${timeClass}"`, e.g. `chess:blitz` or `chess960:blitz` |
| `color`, `opponent`, `myRating`, `oppRating` | Ratings are **after** the game, as chess.com reports them |
| `outcome` | `win`, `loss` or `draw` |
| `ending` | `checkmate`, `resignation`, `timeout`, `abandonment`, `stalemate`, `repetition`, `agreement`, `insufficient`, `fifty-move`, `time-vs-insufficient`, `variant` or `other`. Taken from the loser's result code in decisive games and from the shared code in draws. |
| `moves` | My moves (full moves), 0 when unknown |
| `plies` | **Added.** Total half-moves in the game. Used for opponent per-move averages. |
| `myThink`, `oppThink` | Seconds each side was on the clock (see below), or `null` |
| `myClockLeft`, `oppClockLeft` | Seconds left at the end (see below), or `null` |
| `ratingDelta` | Rating after this game minus rating after the previous **rated** game of the same pool, ordered by end time and searched across everything fetched (seed and walk-back months included). `null` when the game is unrated, when no earlier rated game of that pool was fetched, or when a month that failed to load lies between the two games (the next delta of each pool after a failed month is unknown; continuity resumes after that). |
| `opening` | Readable name from the opening URL slug, cut before the move tail. For example `Kings-Indian-Defense-Fianchetto-…-System-8.d5-Nb8` becomes `King's Indian Defense Fianchetto … System`. Common apostrophes and hyphens are restored. `null` when there is none, and for chess.com's catch-all slug `/openings/Undefined`, which it uses for games it could not classify (gothamchess, all time: 792 games). |
| `eco` | `"E62"` or `null` |
| `myAccuracy`, `oppAccuracy` | From `accuracies`, or `null` |

### Start time

The first source available wins:

1. PGN `UTCDate` + `UTCTime`.
2. The API's `start_time`; daily games have it.
3. `StartTime` on the `EndDate` (or `Date`), moved back a day if it would come after the end.
4. `end −` all clock time used, including a flagger's remaining clock, rounded up to whole seconds (so think time never exceeds `duration`).
5. `end`.

Fallback 5 only happens without a PGN, and gives `duration` 0.

### Think time: how it is attributed, and why

`%clk` is the mover's clock **after** the move, with increment already added. For each side:

```
used = base + (number of moves made) × inc − last clock
```

This equals the sum of `previous + inc − clock` over every move, with `previous = base` before the first move.

The brief proposed giving the whole unexplained remainder (`duration − used_white − used_black`) to the side on move at the end. Measurements on 583 of hikaru's October 2026 games show why I did something different:

- The remainder grows with game length at **≈ 0.13 s per ply**, even in checkmate games where nobody can be thinking at the end. A fit on checkmates gave slope 0.130 and intercept 0.7 s. This is chess.com's lag compensation: time in transit is not charged to either clock.
- Giving all of it to one side would credit the last mover with about 13 s of "thinking" in a 100-ply game. That is a systematic bias of a few percent.

So the rule is:

| ending | extra think added |
|---|---|
| `timeout`, `time-vs-insufficient` | The flagger gets their **whole remaining clock** (exact), and their clock left becomes 0. For a timeout the flagger is the side that lost on time; for time-vs-insufficient it is the side on move. |
| `checkmate`, `stalemate`, `repetition`, `insufficient`, `fifty-move`, `variant` | None. The final move ended the game, so nobody was thinking. |
| `resignation`, `agreement`, `abandonment`, `other` | The side whose clock was running (the side on move, worked out from ply parity and the starting FEN) gets `clamp(duration − used − 0.13 × plies, 0, their clock left)`. That amount is also taken off their clock left. |

Values are rounded to 0.1 s. `myThink + oppThink ≤ duration` held for every game in both samples. In the samples, clocks account for 94 % of wall time (median per game; 5th–95th percentile 0.82–0.98). The remaining ~6 % is lag compensation and the uncharged first moves. The constant is `LAG_PER_PLY` in `js/data.js`.

Think and clock-left values are `null` when:

- the game is daily (correspondence `%clk` values are per-move clocks, not time spent);
- the PGN has no `%clk` (old games, some variants);
- no move was made (abandoned before the first move).

---

## `analyze(games, { from, to, sessionGapMinutes = 30, now = Date.now(), gaps = [] })`

- `gaps` lists `[startMs, endMs)` spans whose games are unknown: the page passes one per entry of `failedMonths` (the UTC month). Every day whose local span overlaps a gap gets `missing: true`; nothing else changes.

- `games` must be sorted by start. Indexes in the output (`gameIdx`, `i`, `*Idx`, `records.longestGame`, and so on) point into **this** array.
- Days and hours use the runtime's local time zone. A game belongs to the local day and hour of its **start**, even when it ends after midnight. Its whole duration counts toward that start hour.
- **Time** figures (seconds, sessions, `time` in every bucket, think, clock stats, the duration histogram) use only `live` games. **Counts, results and Elo** use every game passed in, including daily games, which are bucketed at their start.
- Games outside `[from, to]` count in totals and lists but get no `days` entry. The UI should pass only games in range.
- Win rate is always `wins / games`, and `null` when `games` is 0.
- Empty input gives a fully formed object: zeros, `null`s and empty arrays, with `days` still covering the range. When both `from` and `to` are null the range is today.
- About 21k real games over 3 years take 70–140 ms on legion (the test requires under 1.5 s for 20k synthetic games).

| key | notes |
|---|---|
| `range` | `{ from, to, days }`. Uses the local days of `from`/`to`, else the first and last game day, else today. |
| `totals` | `games, liveGames, wins, losses, draws, time, myThink, oppThink, thinkGames, avgGame, medianGame, activeDays, avgPerActiveDay, avgPerDay, moves`. `myThink`/`oppThink` add up only over `thinkGames`: live games with clock data. `activeDays` counts days with at least one game of any kind; `liveDays` counts days with at least one live game. `avgPerActiveDay` is `time / liveDays` (`null` when `liveDays` is 0): daily games carry no time, so days with only daily games would dilute it. `avgGame` and `medianGame` are over live games. `avgPerDay` divides by every day in the range. |
| `days[]` | One entry per calendar day, empty days included. `dow` is 0 for Monday. `eloGained` and `eloLost` are both positive and summed across pools. `eloByPool[pool]` is `{ gained, lost, net, games, end }`, where `games` counts rated games and `end` is the rating after that day's last rated game. Streaks count draws as breaking a run. `firstStart` and `lastEnd` use live games only. `sessions` counts the sessions that have at least one game starting that day, so a session that runs past midnight counts on both days and every day with a live game has at least 1. The page's CSV calls this column `sessions_touching_day` for that reason: it can sum to more than the session count. `missing` is true when the day overlaps one of `opts.gaps` (a month that failed to load): its figures are unknown or incomplete, not zero. |
| `records` | `busiestDay` (most time), `busiestDayLast30` (most time in the 30 days ending at the earlier of range end and today), `mostGamesDay`, `bestEloDay` (highest `eloNet`, only if > 0), `worstEloDay` (lowest `eloNet`, only if < 0). These are dates or `null`. `longestGame` and `quickestWin` are game indexes over live games. `biggestUpset` is the win with the largest positive pre-game rating gap (see `ratingDiff`). |
| `elo` | `gained, lost, net, ratedGames`, plus `byPool[]` sorted by game count. Each pool has `start` (first rating minus its delta, or the first rating if the delta is unknown), `end`, `peak`, `low` (from the series) and `series[]` (`{ t: end ms, rating, i }`). `end − start = net` whenever the pool's games are contiguous, which they are unless the UI filtered some out. |
| `streaks` | `longestWin` and `longestLoss` are `{ length, start, end, startIdx, endIdx, opponents }`; `start` is the first game's start and `end` the last game's end. `opponents` is the number of distinct opponents (case-insensitive) inside the streak, which can be far below `length`. `current` is the outcome and run length of the last game. `longestDayStreak` is `{ length, startDate, endDate }`. `currentDayStreak` counts back from the range end; if the last day is today and has no game yet, counting starts from yesterday. |
| `sessions` | A session is a run of live games where each starts within `sessionGapMinutes` of the **latest end so far** in the session; overlapping games join. `list[]` holds `{ start, end, duration, playTime, games, wins, losses, draws, eloNet, firstIdx, lastIdx }`. `duration` is wall-clock seconds from the first start to the latest end, breaks between games included, so the longest session can be longer than the total time. `playTime` is the sum of its games' `duration`s, breaks left out; it is at most `duration` unless games overlap. `longest` is an index into `list`; that one session also carries `stretches[]`, `{ start, end, games }`, from `sessionStretches(games, session, minBreak = 300)`: the session cut at every pause between games of 5 minutes or more (shorter pauses stay inside a stretch), so the break before stretch k is `stretches[k].start - stretches[k - 1].end`. `byPosition` covers positions 1–9 and then `10+`, with empty trailing buckets dropped. `perDay` is the sum of `days[].sessions` over the days with a live game, divided by `totals.liveDays` (null without one): sessions touching a day played, per day played. It is never under 1 when there is play, unlike `count / liveDays`, which counts a session across midnight once but both of its days. |
| `heatmap` | 7 × 24 grid, `heatmap[dow][hour]` = `{ games, wins, losses, draws, time, eloNet }` |
| `byHour`, `byDow` | Same fields. `byDow` also has `activeDays` (days with games on that weekday) and an **added** `days` (how many of that weekday fall in the range), useful for per-day averages. |
| `tilt` | `afterWin` and `afterLoss` give the result of the **next game in the same session**. `requeueAfterWin` and `requeueAfterLoss` are the fraction of live wins (or losses) followed by a live game starting within 5 minutes of their end, in any session; the very last game counts as not followed. `liveWins` and `liveLosses` are those fractions' denominators, so a reader can tell 100 % of 2 losses from 100 % of 200. `medianGapAfterWin` and `medianGapAfterLoss` are in seconds, within the same session. |
| `byClass[]` | `{ timeClass, games, liveGames, time, wins, losses, draws, avgGame, eloNet }`, sorted by time. `avgGame` is `null` for daily games. |
| `byColor` | `white` and `black`, each `{ games, wins, losses, draws }` |
| `endings` | `wins`, `losses` and `draws`, each a list of `{ ending, count }` sorted by count descending |
| `openings[]` | Top 12 by games. Each is `{ name, eco, games, wins, losses, draws, time }`, where `eco` is the most common code for that name. |
| `openingFamilies[]` | **Added.** Top 12 coarse families, each `{ name, games, wins, losses, draws, time }`. The family is the name up to the first Opening, Defense, Gambit, Game, Attack, System or Countergambit word. Full names are very fragmented (hikaru: 330 distinct names in 583 games), so families make the better chart. |
| `opponents[]` | Top 10 opponents with at least 2 games. Matching ignores case; the first spelling seen is kept. |
| `durationHist[]` | `{ from, to, count }` in seconds. The width is the smallest step from `HIST_WIDTHS` (5 s, 10 s, 15 s, 30 s, 1 m, 2 m, 5 m, 10 m, 15 m, 30 m, 1 h, 2 h; exported) that covers the 95th percentile in 20 bins or fewer. Each width divides a minute or is a whole number of minutes, so every edge is a round value an axis can print exactly (no 20 s or 90 s bins, which an axis would round to repeated minutes). One final open bin (`to: null`) holds the tail, and empty leading bins are dropped. |
| `ratingDiff[]` | Opponent minus me, using **pre-game** ratings: `myRating − ratingDelta` and `oppRating + ratingDelta`. Ratings on a game are post-game, and the opponent's change is roughly the mirror of mine. The 7 buckets are `≤ -200`, `-200 to -100`, `-100 to -25`, `-25 to 25`, `25 to 100`, `100 to 200` and `≥ 200`. `min` and `max` are `null` on the open ends. |
| `dailyLoad[]` | Days with games, grouped by games played that day: 1–3, 4–7, 8–15, 16–30 and 31+. `max` is `null` on the last group. |
| `clock` | `avgLeftWin` and `avgLeftLoss` (seconds on **my** clock at the end of live games), `timeoutLosses`, `timeoutWins`, `fasterShare` (share of `thinkGames` where `myThink < oppThink`), and `avgMyMove` / `avgOppMove` (total think divided by moves, per side). |

---

## Data quirks worth knowing in the UI

- **Clocks are almost always present for live games.** In the samples, 0 of 1166 hikaru games and 2 of 459 Magnus games lacked them; both were abandoned before the first move. Old or variant games may lack them, so treat `thinkGames < liveGames` as normal.
- **Daily games** count for results and Elo but add no time. A player who plays only correspondence will see 0 hours.
- **Unrated games** exist even for top players (Magnus: 13 of 459, including `oddschess`). They have ratings but no `ratingDelta`.
- **The first rated game of a pool** has `ratingDelta: null` when neither the seed month nor the up to 6 months before it had a game in that pool (Magnus, chess960: 1 game).
- **Ratings are post-game.** Use `ratingDelta` to recover the pre-game rating.
- **Accuracy** is present on nearly every recent game (hikaru 1166/1166, Magnus 457/459) but not guaranteed.
- **The duration histogram is bimodal for mixed bullet/blitz players** (hikaru peaks at 90–120 s and at 300–330 s). Colouring it by time class is probably worth it.

## Scripts

`scripts/sample.mjs` writes `tests/fixtures/sample-<user>.json` as `{ player, games, stats }` and prints consistency checks:

- totals equal the sums over days;
- `elo.net` equals the sum of daily `eloNet`;
- each pool's `end − start` equals its `net`;
- sessions cover every live game;
- the heatmap, hour and histogram totals match;
- think time never exceeds duration.

It exits with 1 if any check fails. Results on 2026-11-12, all checks passing:

| player | range | games | time | think explained by clocks |
|---|---|---|---|---|
| hikaru | 60 days | 1166 (blitz 618 / bullet 548) | 65 h 53 m | 94 % |
| magnuscarlsen | 90 days | 459 (4 pools incl. chess960) | 30 h 54 m | 94 % |
