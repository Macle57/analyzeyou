import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, colChart, thinLine, maxOf, minOf, evenTicks, histTicks, durLabel } from '../js/charts.js';
import { durationHistogram, HIST_WIDTHS } from '../js/analyze.js';

// Just enough DOM for lineChart to build its SVG tree in Node.
function fakeNode(tag) {
  return {
    tag, attrs: {}, children: [], clientWidth: 900,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    append(...kids) { this.children.push(...kids); },
    replaceChildren(...kids) { this.children = kids; },
    addEventListener() {},
  };
}
function walk(node, out = []) {
  out.push(node);
  for (const c of node.children ?? []) if (typeof c === 'object') walk(c, out);
  return out;
}

/** 150k+ rated games: a slow random walk with one sharp spike and one sharp dip. */
function bigSeries(n) {
  const pts = [];
  let v = 1500, seed = 7;
  for (let k = 0; k < n; k++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    v += (seed % 17) - 8;
    pts.push({ t: k, v, i: k, at: k });
  }
  pts[123456].v = 9000;
  pts[54321].v = -500;
  return pts;
}

test('maxOf/minOf handle arrays far beyond the spread-argument limit', () => {
  const arr = Array.from({ length: 300000 }, (_, i) => ({ v: (i * 7919) % 100003 }));
  assert.throws(() => Math.max(...arr.map((p) => p.v)), RangeError, 'the hazard being fixed');
  assert.equal(maxOf(arr, (p) => p.v), 100002);
  assert.equal(minOf(arr, (p) => p.v), 0);
  assert.equal(maxOf([], (p) => p.v, 60), 60);
});

test('thinLine keeps first, last and every bucket extreme, and caps the size', () => {
  const pts = bigSeries(200000);
  const thin = thinLine(pts, 2400);
  assert.ok(thin.length <= 2402, `${thin.length} points`);
  assert.equal(thin[0], pts[0]);
  assert.equal(thin.at(-1), pts.at(-1));
  assert.ok(thin.includes(pts[123456]), 'spike survives');
  assert.ok(thin.includes(pts[54321]), 'dip survives');
  for (let i = 1; i < thin.length; i++) assert.ok(thin[i].t > thin[i - 1].t, 'stays in order');
  const short = pts.slice(0, 100);
  assert.equal(thinLine(short, 2400), short);
});

test('lineChart draws 200k points without RangeError and labels the real peak', () => {
  globalThis.document = { createElementNS: (_ns, tag) => fakeNode(tag), createElement: (tag) => fakeNode(tag) };
  try {
    const pts = bigSeries(200000);
    const root = fakeNode('div');
    lineChart(root, pts, { label: 'x', start: 1500, fmtX: (t) => String(Math.round(t)), tip: () => null });
    const nodes = walk(root);
    const path = nodes.find((n) => n.tag === 'path');
    const segments = (path.attrs.d.match(/[ML]/g) || []).length;
    assert.ok(segments <= 2402, `${segments} path segments`);
    const labels = nodes.filter((n) => n.tag === 'text').map((n) => n.children.join(''));
    assert.ok(labels.includes('Peak 9000'), 'peak label uses the real maximum');
    assert.ok(labels.includes(String(pts.at(-1).v)), 'last label uses the real last point');
    // The peak dot sits on a vertex of the drawn line, and has no ring that would paint over the line.
    const vertices = new Set(path.attrs.d.split(/[ML]/).filter(Boolean));
    const peakDot = nodes.filter((n) => n.tag === 'circle' && n.attrs.cx != null)[0];
    assert.ok(vertices.has(`${Number(peakDot.attrs.cx).toFixed(1)},${Number(peakDot.attrs.cy).toFixed(1)}`), 'peak dot on the line');
    assert.ok(!/ring/.test(peakDot.attrs.class));
  } finally {
    delete globalThis.document;
  }
});

test('evenTicks: one constant step counted back from the last bucket, labels never touch', () => {
  const w = () => 60;
  for (const [n, x0, x1] of [[30, 44, 1274], [30, 44, 384], [365, 44, 1274], [13, 44, 1274], [13, 44, 384], [1, 44, 300], [2, 44, 120]]) {
    const t = evenTicks(n, x0, x1, w);
    assert.ok(t.length >= 1, `${n} buckets get a label`);
    assert.equal(t.at(-1).i, n - 1, 'the last bucket is labelled');
    const steps = new Set(t.slice(1).map((x, k) => x.i - t[k].i));
    // The first label may be dropped alone, so the step is constant from the second label on.
    const inner = new Set(t.slice(2).map((x, k) => x.i - t[k + 1].i));
    assert.ok(inner.size <= 1, `constant step for ${n}: ${[...steps]}`);
    const box = (x) => (x.anchor === 'start' ? [x.x, x.x + 60] : x.anchor === 'end' ? [x.x - 60, x.x] : [x.x - 30, x.x + 30]);
    for (let k = 1; k < t.length; k++) assert.ok(box(t[k - 1])[1] + 12 <= box(t[k])[0], `labels ${k - 1} and ${k} touch`);
    for (const x of t) { assert.ok(box(x)[0] >= x0 - 1e-9 && box(x)[1] <= x1 + 1e-9, 'inside the axis'); }
  }
  // 13 months on a wide chart: every month gets its label, none goes missing.
  assert.equal(evenTicks(13, 44, 1274, () => 62).length, 13);
});

test('duration histogram widths divide a round unit, so every edge is exact', () => {
  for (const w of HIST_WIDTHS) assert.ok(60 % w === 0 || w % 60 === 0, `${w}`);
  assert.ok(!HIST_WIDTHS.includes(20) && !HIST_WIDTHS.includes(90), 'no widths that land between minutes');
  // A blitz-and-rapid mix like gothamchess over a year: p95 around 7 minutes.
  const durs = Array.from({ length: 2000 }, (_, k) => 20 + ((k * 7919) % 460));
  const bins = durationHistogram(durs);
  const width = bins[0].to - bins[0].from;
  assert.ok(HIST_WIDTHS.includes(width), `${width}`);
  for (const b of bins) assert.equal(b.from % width, 0);
  assert.equal(bins.reduce((a, b) => a + b.count, 0), durs.length);
});

test('histTicks label exact edges at an even step, never twice', () => {
  const make = (width, n, tail) => {
    const bins = Array.from({ length: n }, (_, k) => ({ from: k * width, to: (k + 1) * width, count: 1 }));
    if (tail) bins.push({ from: n * width, to: null, count: 1 });
    return bins;
  };
  assert.equal(durLabel(0), '0');
  assert.equal(durLabel(45), '45s');
  assert.equal(durLabel(90), '1m 30s');
  assert.equal(durLabel(120), '2m');
  assert.equal(durLabel(5400), '1h 30m');
  for (const width of HIST_WIDTHS) {
    for (const n of [4, 12, 20]) {
      for (const max of [3, 6, 10, 30]) {
        const bins = make(width, n, true);
        const t = histTicks(bins, max);
        const labels = t.map((x) => x.label);
        assert.equal(new Set(labels).size, labels.length, `repeat in ${labels}`);
        assert.ok(t.length <= Math.max(max, 1) || t.length === 1, `${t.length} > ${max}`);
        for (const x of t) {
          const b = bins[x.i];
          assert.equal(x.label, b.to == null ? `${durLabel(b.from)}+` : durLabel(b.from), 'label is the bin edge');
        }
        const gaps = new Set(t.slice(1).map((x, k) => bins[x.i].from - bins[t[k].i].from));
        assert.ok(gaps.size <= 1, `even step: ${[...gaps]}`);
      }
    }
  }
  // 30 s bins, room for 6 labels: whole minutes.
  assert.deepEqual(histTicks(make(30, 14, true), 6).map((x) => x.label), ['0', '2m', '4m', '6m']);
  assert.deepEqual(histTicks(make(30, 14, true), 9).map((x) => x.label), ['0', '1m', '2m', '3m', '4m', '5m', '6m', '7m+']);
});

test('colChart: a 0% bar keeps a stub, no games draws nothing, few games are muted', () => {
  globalThis.document = { createElementNS: (_ns, tag) => fakeNode(tag), createElement: (tag) => fakeNode(tag) };
  try {
    const root = fakeNode('div');
    const items = [
      { label: '1', value: 60, tip: () => null },
      { label: '2', value: 0, tip: () => null },
      { label: '3', value: 100, few: true, tip: () => null },
      { label: '4', value: null, tip: () => null },
    ];
    colChart(root, items, { label: 'x', max: 100, step: 25 });
    const marks = walk(root).filter((n) => (n.tag === 'path' || (n.tag === 'rect' && n.attrs.height === '3')) && /^f-/.test(n.attrs.class || ''));
    assert.equal(marks.length, 3, 'three marks: the null bar draws nothing');
    assert.deepEqual(marks.map((n) => n.attrs.class), ['f-time', 'f-time', 'f-muted']);
    assert.equal(marks[1].tag, 'rect', '0% is a stub on the baseline');
    const svg = root.children[0];
    assert.equal(svg.attrs.tabindex, '0', 'one tab stop');
    assert.equal(svg.attrs.role, 'group');
    assert.equal(root.children[1].attrs['aria-live'], 'polite', 'a live region for the keyboard readout');
  } finally {
    delete globalThis.document;
  }
});
