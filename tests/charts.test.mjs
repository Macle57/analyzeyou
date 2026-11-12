import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, thinLine, maxOf, minOf } from '../js/charts.js';

// Just enough DOM for lineChart to build its SVG tree in Node.
function fakeNode(tag) {
  return {
    tag, attrs: {}, children: [], clientWidth: 900,
    setAttribute(k, v) { this.attrs[k] = String(v); },
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
  globalThis.document = { createElementNS: (_ns, tag) => fakeNode(tag) };
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
  } finally {
    delete globalThis.document;
  }
});
