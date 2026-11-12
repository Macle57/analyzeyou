// Small hand-rolled SVG charts. Colours come from CSS classes so both themes work without re-rendering.

const NS = 'http://www.w3.org/2000/svg';

export function S(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}

// ---------- tooltip ----------
const tipEl = () => document.getElementById('tip');

export function tipBox(title, rows = [], note) {
  const f = document.createDocumentFragment();
  if (title) { const s = document.createElement('strong'); s.textContent = title; f.append(s); }
  for (const [k, v] of rows) {
    const r = document.createElement('div'); r.className = 'tr';
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('span'); b.textContent = v;
    r.append(a, b); f.append(r);
  }
  if (note) { const d = document.createElement('div'); d.textContent = note; d.style.opacity = '0.75'; f.append(d); }
  return f;
}

// The chart whose readout the tooltip shows (null for plain marks). A chart that loses focus hides the
// tooltip only if it is still its own: a tap on another chart shows that chart's tooltip first, and
// only then moves the focus, so the first chart's blur would otherwise hide the new one.
let tipOwner = null;
export function showTip(x, y, content, owner = null) {
  tipOwner = owner;
  const t = tipEl();
  t.replaceChildren(content);
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y + 16;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (left < 8) left = 8;
  if (top + r.height > innerHeight - 8) top = y - r.height - 12;
  if (top < 8) top = 8;
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}
export function hideTip() { tipEl().hidden = true; }
/** Shows the tooltip next to an element (keyboard focus has no pointer position). */
export function showTipAt(node, content) {
  const r = node.getBoundingClientRect();
  showTip(r.left + r.width / 2, r.bottom - 4, content);
}
/** True for a finger or a pen: no hover, so a tap shows the tooltip and it stays until the next tap or a scroll. */
export const isTouch = (e) => e.pointerType != null && e.pointerType !== 'mouse';
/** A tooltip's content as one sentence, for a live region: "Title: key value, key value." */
export function tipText(content) {
  const parts = [];
  let title = '';
  for (const n of content.childNodes ?? []) {
    if (n.tagName === 'STRONG') title = n.textContent;
    else if (n.className === 'tr') parts.push([...n.childNodes].map((c) => c.textContent).join(' '));
    else if (n.textContent) parts.push(n.textContent);
  }
  return `${title}${title && parts.length ? ': ' : ''}${parts.join(', ')}.`;
}

/**
 * The keyboard half of every chart, shared so they all behave alike: the chart is one tab stop; Left and
 * Right move between its `n` marks, PageUp and PageDown by a twentieth, Home and End to the ends; the
 * mark gets the same tooltip as hover and a live region reads it out. Escape hides the readout (and
 * stops there, so the page's own Escape handling waits for a second press).
 * o: { n, start(key) -> index to move from before any move, mark(i), unmark(), tip(i), at(i) -> [x, y]
 *      in client px, announce(text), onEnter(i) }
 */
export function readout(svg, o) {
  let cur = -1, shown = false;
  const show = (i, cx, cy) => {
    cur = i; shown = true; o.mark?.(i);
    const content = o.tip(i);
    if (cx == null) { [cx, cy] = o.at(i); o.announce?.(tipText(content)); }
    showTip(cx, cy, content, svg);
  };
  const leave = () => { shown = false; o.unmark?.(); if (tipOwner === svg) hideTip(); };
  svg.setAttribute('tabindex', 0);
  const page = Math.max(2, Math.round(o.n / 20));
  svg.addEventListener('keydown', (e) => {
    const k = e.key;
    const move = { ArrowLeft: -1, ArrowRight: 1, PageUp: -page, PageDown: page }[k];
    if (move != null || k === 'Home' || k === 'End') {
      e.preventDefault();
      const from = cur >= 0 ? cur : o.start?.(k) ?? -1;
      const to = k === 'Home' ? 0 : k === 'End' ? o.n - 1 : from < 0 ? (move < 0 ? o.n - 1 : 0) : from + move;
      show(Math.max(0, Math.min(o.n - 1, to)));
    } else if ((k === 'Enter' || k === ' ') && cur >= 0 && o.onEnter) { e.preventDefault(); o.onEnter(cur); }
    else if (k === 'Escape' && shown) { e.stopPropagation(); leave(); }
  });
  svg.addEventListener('blur', leave);
  return { show, leave, get cur() { return cur; }, set cur(v) { cur = v; }, get shown() { return shown; } };
}
/** A visually hidden live region for a chart's keyboard readout. */
export function liveRegion() {
  const p = document.createElement('p');
  p.className = 'sr-only'; p.setAttribute('aria-live', 'polite');
  return p;
}
/** Client coordinates of a point given in a chart's viewBox units (W wide). */
function toClient(svg, W, x, y) {
  const r = svg.getBoundingClientRect(), k = r.width / W;
  return [r.left + x * k, r.top + y * k];
}

// Tooltips for plain HTML marks: put data on the node with setTip(node, fn). Hover shows it, so does
// keyboard focus, and so does a tap on a touch screen.
const tipFns = new WeakMap();
export function setTip(node, fn) { tipFns.set(node, fn); node.dataset.tip = '1'; }
if (typeof document !== 'undefined' && typeof addEventListener === 'function') { // absent when tests import this in Node
  document.addEventListener('pointermove', (e) => {
    if (isTouch(e)) return; // a finger that moves is scrolling, and the scroll hides the tooltip
    const n = e.target.closest?.('[data-tip]');
    if (n && tipFns.has(n)) showTip(e.clientX, e.clientY, tipFns.get(n)());
    else if (!e.target.closest?.('svg[data-chart]')) hideTip();
  });
  document.addEventListener('pointerdown', (e) => {
    const n = e.target.closest?.('[data-tip]');
    if (isTouch(e) && n && tipFns.has(n)) showTip(e.clientX, e.clientY, tipFns.get(n)());
    else if (!e.target.closest?.('[data-tip], svg[data-chart]')) hideTip();
  });
  let focusTip = null; // the mark whose tooltip keyboard focus opened; losing focus hides only that one
  document.addEventListener('focusin', (e) => {
    const n = e.target;
    if (n?.dataset?.tip && tipFns.has(n) && n.matches(':focus-visible')) { showTipAt(n, tipFns.get(n)()); focusTip = n; }
    else focusTip = null;
  });
  document.addEventListener('focusout', (e) => { if (e.target === focusTip) { focusTip = null; hideTip(); } });
  addEventListener('scroll', hideTip, { passive: true });
}

// ---------- array helpers (loops: spreading 100k+ values into Math.min/max throws RangeError) ----------
/** Largest `f(x)` over `arr`, at least `floor`. */
export function maxOf(arr, f = (x) => x, floor = -Infinity) {
  let m = floor;
  for (let i = 0; i < arr.length; i++) { const v = f(arr[i]); if (v > m) m = v; }
  return m;
}
/** Smallest `f(x)` over `arr`, at most `ceil`. */
export function minOf(arr, f = (x) => x, ceil = Infinity) {
  let m = ceil;
  for (let i = 0; i < arr.length; i++) { const v = f(arr[i]); if (v < m) m = v; }
  return m;
}
/**
 * Thins a line for drawing: above `limit` points, splits them into buckets and keeps each bucket's
 * lowest and highest point (in their original order), so peaks and dips survive. Always keeps the
 * first and last point. Returns the input unchanged when it is short enough.
 */
export function thinLine(pts, limit = 2400) {
  const n = pts.length;
  if (n <= limit) return pts;
  const size = Math.ceil(n / Math.floor(limit / 2));
  const out = [pts[0]];
  for (let s = 1; s < n - 1; s += size) {
    const e = Math.min(n - 1, s + size);
    let lo = s, hi = s;
    for (let i = s + 1; i < e; i++) { if (pts[i].v < pts[lo].v) lo = i; if (pts[i].v > pts[hi].v) hi = i; }
    if (lo === hi) out.push(pts[lo]);
    else if (lo < hi) out.push(pts[lo], pts[hi]);
    else out.push(pts[hi], pts[lo]);
  }
  out.push(pts[n - 1]);
  return out;
}

// ---------- scales ----------
export function niceMax(max, target = 4) {
  if (!(max > 0)) return { max: 1, step: 1 };
  const raw = max / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = [1, 2, 2.5, 5, 10].find((k) => k * p >= raw) * p;
  return { max: Math.ceil(max / m - 1e-9) * m, step: m };
}

const TIME_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 28800, 43200, 86400, 172800, 345600, 864000];
export function timeTick(v) {
  if (v === 0) return '0';
  if (v < 3600) return Math.round(v / 60) + 'm';
  const h = Math.floor(v / 3600), m = Math.round((v % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
function timeScale(max) {
  const step = TIME_STEPS.find((s) => max / s <= 4.2) || TIME_STEPS[TIME_STEPS.length - 1];
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
  const ticks = [];
  for (let v = 0; v <= top + 1; v += step) ticks.push(v);
  return { max: top, ticks };
}

function roundedTop(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function roundedBottom(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
}

// Width of a tick label in px. A canvas measures it in the browser; Node (tests) uses an average glyph.
let measureCtx = null;
export function textWidth(str, size = 11.5) {
  if (measureCtx === null) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = `${size}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
    } catch { measureCtx = false; }
  }
  return measureCtx ? measureCtx.measureText(str).width : str.length * size * 0.55;
}
/**
 * Which buckets of a band axis get a label: every `step`-th bucket counting back from the last, with
 * the smallest step at which no two labels touch. `width(i)` is label i's width; a label is centred on
 * its band but kept inside [x0, x1]. The first label alone is dropped when only it collides (it is
 * squeezed against the left edge), rather than doubling the step for everyone.
 * Returns [{ i, x, anchor }] with x the text position for that anchor.
 */
export function evenTicks(n, x0, x1, width, gap = 12) {
  if (n <= 0) return [];
  const band = (x1 - x0) / n;
  const place = (i) => {
    const c = x0 + i * band + band / 2, w = width(i);
    if (c - w / 2 < x0) return { i, x: x0, anchor: 'start', l: x0, r: x0 + w };
    if (c + w / 2 > x1) return { i, x: x1, anchor: 'end', l: x1 - w, r: x1 };
    return { i, x: c, anchor: 'middle', l: c - w / 2, r: c + w / 2 };
  };
  for (let step = 1; step <= n; step++) {
    const at = [];
    for (let i = n - 1; i >= 0; i -= step) at.unshift(place(i));
    let ok = true;
    for (let k = 2; k < at.length && ok; k++) ok = at[k - 1].r + gap <= at[k].l;
    if (!ok) continue;
    if (at.length >= 2 && at[0].r + gap > at[1].l) at.shift();
    return at.map(({ i, x, anchor }) => ({ i, x, anchor }));
  }
  return [];
}

/** A duration as an exact axis label: 0, 45s, 1m, 1m 30s, 2h, 1h 30m. Nothing is rounded away. */
export function durLabel(s) {
  s = Math.round(s);
  if (s === 0) return '0';
  if (s < 60) return `${s}s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r ? `${m}m ${r}s` : `${m}m`; }
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
const LABEL_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400];
/**
 * Labels for a duration histogram (bins of one width, from js/analyze.js): the edges that are whole
 * multiples of the smallest round step (a multiple of the bin width) giving at most `maxLabels`.
 * The open tail bin is labelled "6m+" when it is a step edge. Returns [{ i, label }].
 */
export function histTicks(bins, maxLabels) {
  if (!bins.length) return [];
  const width = bins.find((b) => b.to != null)?.to - bins.find((b) => b.to != null)?.from || bins[0].from || 1;
  const steps = LABEL_STEPS.filter((s) => s % width === 0);
  if (!steps.length || steps[0] !== width) steps.unshift(width);
  const pick = (step) => bins.map((b, i) => ({ i, b })).filter(({ b }) => b.from % step === 0);
  let at = pick(steps[steps.length - 1]);
  for (const step of steps) { const p = pick(step); if (p.length <= Math.max(1, maxLabels)) { at = p; break; } }
  return at.map(({ i, b }) => ({ i, label: b.to == null ? `${durLabel(b.from)}+` : durLabel(b.from) }));
}

// ---------- day chart: time columns above, rating won/lost below, one shared x ----------
export function dayChart(root, buckets, o) {
  // A re-render while the chart has focus puts the focus on the new chart.
  const hadFocus = root.contains(document.activeElement);
  const n = buckets.length;
  if (!n) { root.replaceChildren(); return; }
  const W = Math.max(280, Math.floor(root.clientWidth));
  const small = W < 520;
  const showElo = buckets.some((b) => b.eloGained || b.eloLost);
  const showTime = o.showTime !== false; // false when nothing in the range has time at the board (daily games only)
  const m = { l: 44, r: 6, t: 24, b: 24 };
  const h1 = showTime ? (small ? 150 : 210) : 0, gap = showTime ? 54 : 20, h2 = showElo ? (small ? 96 : 120) : 0;
  const H = m.t + h1 + (showElo ? gap + h2 : 0) + m.b;
  const iw = W - m.l - m.r, band = iw / n;
  const bw = Math.max(1, Math.min(24, band >= 8 ? band - 2 : band >= 4 ? band - 1 : band));
  const bx = (i) => m.l + i * band + (band - bw) / 2;
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': o.label, 'data-chart': 'day' });

  // time panel
  const ts = timeScale(maxOf(buckets, (b) => b.time, 60));
  const y1 = (v) => m.t + h1 - (v / ts.max) * h1;
  if (showTime) svg.append(S('text', { x: 0, y: 12, class: 'cap' }, 'Time played'));
  if (showTime) for (const v of ts.ticks) {
    svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y1(v), y2: y1(v), class: v ? 'grid' : 'base' }));
    svg.append(S('text', { x: m.l - 8, y: y1(v) + 4, 'text-anchor': 'end', class: 'tick' }, timeTick(v)));
  }
  const selBand = S('rect', { class: 'sel-band', y: m.t - 4, height: H - m.t - m.b + 4, width: band, visibility: 'hidden' });
  const hovBand = S('rect', { class: 'hover-band', y: m.t - 4, height: H - m.t - m.b + 4, width: band, visibility: 'hidden' });
  svg.append(selBand, hovBand);

  let maxI = 0;
  buckets.forEach((b, i) => {
    if (b.time > buckets[maxI].time) maxI = i;
    let acc = 0;
    const segs = o.classes.map((c) => ({ c, v: b.byClass?.[c.key]?.time || 0 })).filter((s) => s.v > 0);
    segs.forEach((s, k) => {
      const yTop = y1(acc + s.v), yBot = y1(acc);
      const top = k === segs.length - 1;
      const g = top || bw < 4 ? 0 : 2; // surface gap between stacked segments
      const hh = Math.max(top ? 1 : 0.5, yBot - yTop - g);
      svg.append(top && bw >= 5
        ? S('path', { d: roundedTop(bx(i), yTop, bw, hh, 4), class: s.c.cls })
        : S('rect', { x: bx(i), y: yTop + g, width: bw, height: hh, class: s.c.cls }));
      acc += s.v;
    });
  });
  if (showTime && buckets[maxI].time > 0) {
    const x = Math.min(W - m.r - 30, Math.max(m.l + 30, bx(maxI) + bw / 2));
    svg.append(S('text', { x, y: y1(buckets[maxI].time) - 6, 'text-anchor': 'middle', class: 'lab' }, o.fmtTime(buckets[maxI].time)));
  }

  // rating panel
  if (showElo) {
    const y0 = m.t + h1 + gap;
    // Each side is as tall as its own data needs (plus a little air); gridlines sit at round values inside
    // that. Rounding both sides up to a shared step used to leave half the panel empty.
    const upMax = Math.max(1, maxOf(buckets, (b) => b.eloGained, 0) * 1.08);
    const dnMax = Math.max(1, maxOf(buckets, (b) => b.eloLost, 0) * 1.08);
    const step = niceMax(upMax + dnMax, 4).step;
    const y2 = (v) => y0 + ((upMax - v) / (upMax + dnMax)) * h2;
    svg.append(S('text', { x: 0, y: y0 - 16, class: 'cap' }, 'Rating won and lost'));
    for (let v = -Math.floor(dnMax / step) * step; v <= upMax + 1e-9; v += step) {
      svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y2(v), y2: y2(v), class: v ? 'grid' : 'base' }));
      svg.append(S('text', { x: m.l - 8, y: y2(v) + 4, 'text-anchor': 'end', class: 'tick' }, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString()));
    }
    buckets.forEach((b, i) => {
      if (b.eloGained > 0) {
        const hh = Math.max(1, y2(0) - y2(b.eloGained) - 1);
        svg.append(bw >= 5 ? S('path', { d: roundedTop(bx(i), y2(0) - 1 - hh, bw, hh, 3), class: 'f-win' }) : S('rect', { x: bx(i), y: y2(0) - 1 - hh, width: bw, height: hh, class: 'f-win' }));
      }
      if (b.eloLost > 0) {
        const hh = Math.max(1, y2(-b.eloLost) - y2(0) - 1);
        svg.append(bw >= 5 ? S('path', { d: roundedBottom(bx(i), y2(0) + 1, bw, hh, 3), class: 'f-loss' }) : S('rect', { x: bx(i), y: y2(0) + 1, width: bw, height: hh, class: 'f-loss' }));
      }
      if (band >= 7 && (b.eloGained || b.eloLost)) {
        svg.append(S('rect', { x: bx(i) - 2, y: y2(b.eloNet) - 1, width: bw + 4, height: 2, class: 'f-ink' }));
      }
    });
  }

  // x labels
  const yx = H - 6;
  const labels = buckets.map((b) => o.tick(b));
  for (const t of evenTicks(n, m.l, W - m.r, (i) => textWidth(labels[i]))) {
    svg.append(S('text', { x: t.x, y: yx, 'text-anchor': t.anchor, class: 'tick' }, labels[t.i]));
  }

  // interaction
  const hit = S('rect', { x: m.l, y: 0, width: iw, height: H, fill: 'transparent', style: 'cursor:pointer' });
  svg.append(hit);
  const place = (rect, i) => { rect.setAttribute('x', m.l + i * band); rect.setAttribute('visibility', 'visible'); };
  const selI = buckets.findIndex((b) => b.key === o.selectedKey);
  if (selI >= 0) place(selBand, selI);
  const idxAt = (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(n - 1, Math.floor((x - m.l) / band)));
  };
  const nav = readout(svg, {
    n, start: () => (selI >= 0 ? selI : -1),
    mark: (i) => { place(hovBand, i); o.onCursor?.(buckets[i]); },
    unmark: () => hovBand.setAttribute('visibility', 'hidden'),
    tip: (i) => o.tip(buckets[i]),
    at: (i) => toClient(svg, W, m.l + i * band + band / 2, 40),
    // The day chart has its own live region and its own sentence (o.announce), not the tooltip's text.
    announce: () => o.announce?.(buckets[nav.cur]),
    onEnter: (i) => o.onSelect(buckets[i], true),
  });
  // The bar the keyboard is on survives a re-render through o.cursorKey.
  nav.cur = o.cursorKey != null ? buckets.findIndex((b) => b.key === o.cursorKey) : -1;
  // Touch has no hover: a tap is a click and opens the bar, so the pointer events below are for the mouse.
  hit.addEventListener('pointermove', (e) => { if (!isTouch(e)) nav.show(idxAt(e), e.clientX, e.clientY); });
  hit.addEventListener('pointerleave', (e) => { if (!isTouch(e)) { nav.leave(); nav.cur = -1; } });
  hit.addEventListener('click', (e) => o.onSelect(buckets[idxAt(e)], false));
  root.replaceChildren(svg);
  if (hadFocus) svg.focus({ preventScroll: true });
}

// ---------- line chart (rating over time) ----------
export function lineChart(root, pts, o) {
  root.replaceChildren();
  if (!pts.length) return;
  const W = Math.max(280, Math.floor(root.clientWidth));
  const m = { l: 44, r: 56, t: 18, b: 26 }, h = W < 520 ? 180 : 240, H = m.t + h + m.b;
  const iw = W - m.l - m.r;
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `${o.label}. Use the left and right arrow keys, Page Up, Page Down, Home and End to read the games.`, 'data-chart': 'line' });
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  let lo = minOf(pts, (p) => p.v), hi = maxOf(pts, (p) => p.v);
  if (o.start != null) { lo = Math.min(lo, o.start); hi = Math.max(hi, o.start); }
  const span = Math.max(10, hi - lo);
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => span / s <= 4.5) || 1000;
  const yLo = Math.floor(lo / step) * step, yHi = Math.max(yLo + step, Math.ceil(hi / step) * step);
  const x = (t) => (t1 === t0 ? m.l + iw / 2 : m.l + ((t - t0) / (t1 - t0)) * iw);
  const y = (v) => m.t + h - ((v - yLo) / (yHi - yLo)) * h;
  for (let v = yLo; v <= yHi; v += step) {
    svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === yLo ? 'base' : 'grid' }));
    svg.append(S('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, v));
  }
  // x labels. o.ticks are candidates in order ({ t, label }); a label is drawn where it sits, with a small
  // mark on the axis, only if it does not run into the one before it, and never twice.
  const seen = new Set();
  let lastRight = -Infinity;
  for (const k of o.ticks || []) {
    if (seen.has(k.label)) continue;
    const px = x(k.t), w = k.label.length * 6.3;
    const anchor = px - w / 2 < m.l ? 'start' : px + w / 2 > m.l + iw + 20 ? 'end' : 'middle';
    const left = anchor === 'start' ? px : anchor === 'end' ? px - w : px - w / 2;
    if (left < lastRight + 12) continue;
    lastRight = left + w; seen.add(k.label);
    svg.append(S('line', { x1: px, x2: px, y1: m.t + h, y2: m.t + h + 4, class: 'base' }));
    svg.append(S('text', { x: px, y: H - 5, 'text-anchor': anchor, class: 'tick' }, k.label));
  }

  // The path is drawn from a thinned copy; the peak, last point and tooltips use every real point.
  const parts = [];
  thinLine(pts).forEach((p, i) => { parts.push((i ? 'L' : 'M') + x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)); });
  const d = parts.join('');
  svg.append(S('path', { d, class: 's-time', fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const last = pts[pts.length - 1];
  let peak = pts[0];
  for (const p of pts) if (p.v > peak.v) peak = p;
  // No surface-coloured ring on these two: on a one-game spike the ring painted over the last few
  // pixels of the line, so the peak dot seemed to float above it. Drawn plain, the line runs into it.
  const dot = (p, cls = 'f-time') => S('circle', { cx: x(p.t), cy: y(p.v), r: 4, class: cls });
  if (peak !== last && x(last.t) - x(peak.t) > 46) {
    svg.append(dot(peak));
    svg.append(S('text', { x: x(peak.t), y: y(peak.v) - 9, 'text-anchor': x(peak.t) < m.l + 40 ? 'start' : 'middle', class: 'lab' }, `Peak ${peak.v}`));
  }
  svg.append(dot(last));
  svg.append(S('text', { x: x(last.t) + 9, y: y(last.v) + 4, class: 'lab' }, last.v));

  const cross = S('line', { y1: m.t, y2: m.t + h, class: 'base', visibility: 'hidden' });
  const cdot = S('circle', { r: 4.5, class: 'f-ink ring', visibility: 'hidden' });
  const hit = S('rect', { x: m.l, y: 0, width: iw + 8, height: H, fill: 'transparent' });
  svg.append(cross, cdot, hit);
  const live = liveRegion();
  const nav = readout(svg, {
    n: pts.length,
    mark: (k) => {
      const p = pts[k];
      cross.setAttribute('x1', x(p.t)); cross.setAttribute('x2', x(p.t)); cross.setAttribute('visibility', 'visible');
      cdot.setAttribute('cx', x(p.t)); cdot.setAttribute('cy', y(p.v)); cdot.setAttribute('visibility', 'visible');
    },
    unmark: () => { cross.setAttribute('visibility', 'hidden'); cdot.setAttribute('visibility', 'hidden'); },
    tip: (k) => o.tip(pts[k]),
    at: (k) => toClient(svg, W, x(pts[k].t), Math.max(m.t, y(pts[k].v) - 10)),
    announce: (text) => { live.textContent = text; },
  });
  const nearest = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = t1 === t0 ? t0 : t0 + ((px - m.l) / iw) * (t1 - t0);
    let a = 0, b = pts.length - 1;
    while (b - a > 1) { const mid = (a + b) >> 1; if (pts[mid].t < t) a = mid; else b = mid; }
    return Math.abs(pts[a].t - t) <= Math.abs(pts[b].t - t) ? a : b;
  };
  hit.addEventListener('pointermove', (e) => { if (!isTouch(e)) nav.show(nearest(e), e.clientX, e.clientY); });
  hit.addEventListener('pointerdown', (e) => { if (isTouch(e)) nav.show(nearest(e), e.clientX, e.clientY); }); // a tap pins the readout
  hit.addEventListener('pointerleave', (e) => { if (!isTouch(e)) nav.leave(); });
  root.append(svg, live);
}

// ---------- plain columns (histogram, win rate by game number) ----------
export function colChart(root, items, o) {
  root.replaceChildren();
  if (!items.length) return;
  const W = Math.max(240, Math.floor(root.clientWidth));
  const m = { l: 40, r: 6, t: 14, b: 24 }, h = 170, H = m.t + h + m.b;
  const iw = W - m.l - m.r, n = items.length, band = iw / n, bw = Math.max(2, Math.min(24, band - 2));
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `${o.label}. Use the left and right arrow keys, Home and End to read the bars.`, 'data-chart': 'col' });
  const sc = o.max ? { max: o.max, step: o.step } : niceMax(maxOf(items, (d) => d.value || 0, 0), 4);
  const y = (v) => m.t + h - (v / sc.max) * h;
  for (let v = 0; v <= sc.max + 1e-9; v += sc.step) {
    svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v ? 'grid' : 'base' }));
    svg.append(S('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, o.fmtY ? o.fmtY(v) : v));
  }
  if (o.ref != null) svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y(o.ref), y2: y(o.ref), class: 'ref' }));
  const maxLabels = Math.max(1, Math.floor(iw / (o.labelWidth || 34)));
  // o.ticks(maxLabels) -> [{ i, label }] picks the labels (the histogram labels round edges only);
  // otherwise every k-th bar is labelled with its own label.
  const every = Math.ceil(n / maxLabels);
  const ticks = o.ticks ? o.ticks(maxLabels) : items.map((d, i) => ({ i, label: d.label })).filter(({ i }) => i % every === 0);
  const hov = S('rect', { class: 'hover-band', y: m.t - 4, height: h + 4, width: band, visibility: 'hidden' });
  svg.append(hov);
  items.forEach((d, i) => {
    const x0 = m.l + i * band + (band - bw) / 2;
    // `few`: drawn from too few games to read much into, so muted. A value of 0 gets a stub on the
    // baseline, so "0%" never looks like "no games" (value null), which draws nothing.
    const cls = d.few ? 'f-muted' : d.cls || 'f-time';
    if (d.value != null) {
      const hh = y(0) - y(d.value);
      if (hh >= 3) svg.append(S('path', { d: roundedTop(x0, y(0) - hh, bw, hh, 4), class: cls }));
      else svg.append(S('rect', { x: x0, y: y(0) - 3, width: bw, height: 3, rx: 1, class: cls }));
    }
  });
  // A bar's label sits under its left edge: the histogram's labels are bin edges, and so are the bars'.
  for (const t of ticks) {
    const lx = o.ticks ? m.l + t.i * band : m.l + t.i * band + band / 2, w = textWidth(t.label);
    const anchor = lx - w / 2 < m.l - 30 ? 'start' : lx + w / 2 > W ? 'end' : 'middle';
    svg.append(S('text', { x: anchor === 'end' ? W : lx, y: H - 6, 'text-anchor': anchor, class: 'tick' }, t.label));
  }
  const hit = S('rect', { x: m.l, y: 0, width: iw, height: H, fill: 'transparent' });
  svg.append(hit);
  const live = liveRegion();
  const nav = readout(svg, {
    n,
    mark: (i) => { hov.setAttribute('x', m.l + i * band); hov.setAttribute('visibility', 'visible'); },
    unmark: () => hov.setAttribute('visibility', 'hidden'),
    tip: (i) => items[i].tip(),
    at: (i) => toClient(svg, W, m.l + i * band + band / 2, m.t + 30),
    announce: (text) => { live.textContent = text; },
  });
  const idxAt = (e) => {
    const r = svg.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor((((e.clientX - r.left) / r.width) * W - m.l) / band)));
  };
  hit.addEventListener('pointermove', (e) => { if (!isTouch(e)) nav.show(idxAt(e), e.clientX, e.clientY); });
  hit.addEventListener('pointerdown', (e) => { if (isTouch(e)) nav.show(idxAt(e), e.clientX, e.clientY); });
  hit.addEventListener('pointerleave', (e) => { if (!isTouch(e)) nav.leave(); });
  root.append(svg, live);
}
