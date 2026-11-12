import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/analyze.js';
import { stickers, planQuips } from '../js/fun.js';
import { dur, num, pct, plural } from '../js/format.js';

const FMT = { dur, num, pct, plural, date: (d) => String(d) };
let seq = 0;
const G = (start, o = {}) => ({
  id: `f${++seq}`, start, end: start + 60000, duration: 60, live: true, timeClass: 'bullet', pool: 'chess:bullet', rules: 'chess',
  rated: false, color: 'white', opponent: 'opp', myRating: null, oppRating: null, outcome: 'win', ending: 'resignation',
  moves: 20, plies: 40, myThink: 25, oppThink: 30, myClockLeft: 30, oppClockLeft: 25, ratingDelta: null, opening: null, ...o,
});

test('"On a heater" counts distinct opponents, not wins', () => {
  const t0 = new Date(2026, 9, 3, 10).getTime();
  // 12 wins in a row against 3 people.
  const games = Array.from({ length: 12 }, (_, k) => G(t0 + k * 120000, { opponent: ['ann', 'bob', 'Ann', 'cy'][k % 4] }));
  const st = analyze(games, { from: new Date(2026, 9, 3), to: new Date(2026, 9, 3, 23, 59) });
  const heat = stickers(st, games, 'someone', FMT).find((s) => s.label === 'On a heater');
  assert.equal(heat.note, '12 wins in a row. 3 people closed the tab annoyed.');
  // All against one person.
  const one = games.map((g) => ({ ...g, opponent: 'solo' }));
  const st1 = analyze(one, { from: new Date(2026, 9, 3), to: new Date(2026, 9, 3, 23, 59) });
  assert.equal(stickers(st1, one, 'someone', FMT).find((s) => s.label === 'On a heater').note, '12 wins in a row. 1 person closed the tab annoyed, 12 times.');
});

test('a day remark that claims the opponents changed is not said of a day against one opponent', () => {
  // 5 Oct 2026 is the day whose turn in the 50-games lines falls on "The opponents changed".
  const day = (opponent) => {
    const t0 = new Date(2026, 9, 5, 8).getTime();
    const games = Array.from({ length: 55 }, (_, k) => G(t0 + k * 120000, { opponent: opponent(k), outcome: k % 2 ? 'win' : 'loss' }));
    const st = analyze(games, { from: new Date(2026, 9, 5), to: new Date(2026, 9, 5, 23, 59) });
    return planQuips(st.days, games, FMT).get('2026-10-05');
  };
  assert.match(day((k) => `p${k}`), /opponents changed/, 'many opponents: the line is true and is said');
  const solo = day(() => 'solo');
  assert.ok(solo && !/opponents changed/.test(solo), solo);
});
