<img src="assets/icon.svg" width="64" height="64" alt="">

# analyzeyou

Analyzing your chess addiction: how much time a chess.com player spends playing, not how well they play.

**Live:** https://macle57.github.io/analyzeyou/

Type a chess.com username, pick a date range, and the page adds up the clock:

- total time, time per day, the busiest day in the range and in the last 30 days, average time per game
- thinking time on each side of the board (the player's clock against their opponents')
- for every day: rating won, rating lost and the net, the best winning streak and the worst losing streak
- rating over time per rating list, with the total won and lost
- sessions, win rate by game number in a session, what happens after a win and after a loss
- an hour-by-weekday heatmap (time, games, win rate, rating), game lengths, how games end, openings, opponents
- up to four players side by side
- a verdict on the habit, with a few things to find

## How it works

It is a static page with no server and no build step. The browser reads the
[chess.com published-data API](https://www.chess.com/news/view/published-data-api) directly, and nothing
is sent anywhere else. Finished months are kept in IndexedDB so a second look is instant. Days and hours
use the viewer's time zone.

| Path | What it holds |
|---|---|
| `index.html`, `css/style.css` | the page and its styles |
| `js/data.js` | fetching, caching, PGN clock parsing, one compact record per game |
| `js/analyze.js` | every statistic, as one pure function over those records |
| `js/app.js`, `js/charts.js` | rendering and the hand-drawn SVG charts |
| `js/fun.js` | the verdict tiers, remarks and their art |
| `docs/DATA.md` | the shape of the game records and the statistics, and the reasoning behind them |

## Run it locally

Any static file server works, for example:

```
python -m http.server 8000
```

then open http://localhost:8000/.

Tests for the data layer need Node 22 or newer:

```
node --test tests/
```

`node scripts/sample.mjs <username> 60d` fetches a real player in Node and writes the analysis to
`tests/fixtures/` (ignored by git).

## Links worth knowing

- `?u=hikaru&range=30` opens straight into an analysis. `range` is `7`, `30`, `90`, `365` or `all`;
  `from=YYYY-MM-DD&to=YYYY-MM-DD` sets a custom range; `u=a,b,c` compares players.
- `?mood=0` to `?mood=6` previews each verdict level without finding a player who earns it.

Not affiliated with chess.com. The seven-segment clock font is [DSEG](https://www.keshikan.net/fonts-e.html)
(SIL Open Font License, see `assets/fonts/DSEG-LICENSE.txt`).
