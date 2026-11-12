import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NB, dur, durT, durWords, clockText, pct, avg, per } from '../js/format.js';
import { timeTick, durLabel } from '../js/charts.js';

const sp = (s) => s.replaceAll(NB, ' ');

test('dur: rounding carries into the next unit at every boundary', () => {
  assert.equal(dur(59.4), '59s');
  assert.equal(dur(59.5), '1m');
  assert.equal(sp(dur(599.4)), '9m 59s');
  assert.equal(dur(599.5), '10m');
  assert.equal(dur(3569), '59m');
  for (const s of [3570, 3585, 3599, 3599.5]) assert.equal(sp(dur(s)), '1h 00m', `${s}`);
  assert.equal(sp(dur(3720)), '1h 02m');
  assert.equal(sp(dur(7199.6)), '2h 00m');
  assert.equal(sp(dur(3_600_000 * 1.5)), `${(1500).toLocaleString()}h 00m`);
  assert.equal(dur(null), '–');
});

test('durations join their parts with a non-breaking space', () => {
  assert.equal(dur(3720), `1h${NB}02m`);
  assert.equal(dur(125), `2m${NB}05s`);
  assert.equal(durT(300), `5m${NB}00s`);
  assert.ok(!/ /.test(dur(3720) + durT(300) + durWords(3720)), 'no breaking space');
});

test('durT, durWords and clockText carry too', () => {
  assert.equal(sp(durT(59.5)), '1m 00s');
  assert.equal(sp(durT(3599.5)), '1h 00m');
  assert.equal(sp(durWords(3590)), '1 hour', 'never "60 minutes"');
  assert.equal(sp(durWords(3569)), '59 minutes');
  assert.equal(sp(durWords(7260)), '2 hours 1 minute');
  assert.equal(sp(durWords(0)), '0 minutes');
  assert.equal(clockText(3599.6), '1:00:00');
  assert.equal(clockText(59.5), '0:01:00');
});

test('chart labels carry: timeTick and durLabel never print 60m', () => {
  assert.equal(timeTick(3590), '1h');
  assert.equal(timeTick(1800), '30m');
  assert.equal(timeTick(5400), '1h 30m');
  assert.equal(durLabel(7190), '2h');
  assert.equal(durLabel(3600 + 59 * 60 + 50), '2h');
  assert.equal(durLabel(5400), '1h 30m');
});

test('pct: a share that is not zero is never 0%, one that is not all is never 100%', () => {
  assert.equal(pct(0), '0%');
  assert.equal(pct(1), '100%');
  assert.equal(pct(0.004), '<1%');
  assert.equal(pct(7 / 1500), '<1%');
  assert.equal(pct(0.996), '>99%');
  assert.equal(pct(0.0004, 1), '<0.1%');
  assert.equal(pct(0.9996, 1), '>99.9%');
  assert.equal(pct(0.5), '50%');
  assert.equal(pct(0.123, 1), '12.3%');
  assert.equal(pct(null), '–');
});

test('averages: one decimal under 10, none from 10 up, never x.0', () => {
  assert.equal(avg(0.74), '0.7');
  assert.equal(avg(2), '2');
  assert.equal(avg(9.94), '9.9');
  assert.equal(avg(9.96), '10');
  assert.equal(avg(26.8), '27');
  assert.equal(avg(26), '26');
  assert.equal(per(1.04, 'game'), '1 game');
  assert.equal(per(2.5, 'game'), '2.5 games');
  assert.equal(per(26.8, 'game'), '27 games');
});
