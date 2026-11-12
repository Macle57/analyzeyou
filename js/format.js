// Number and duration formatting for running text. Pure (no DOM), so tests can import it in Node.
// Every part of a duration is joined with a non-breaking space, so "1h 02m" never wraps between its
// parts. CSV output swaps them back for plain spaces (see downloadCsv in js/app.js).

/** Non-breaking space. */
export const NB = ' ';
export const MINUS = '−';
const pad = (n) => String(n).padStart(2, '0');

/** A whole number with the locale's grouping. `|| 0` turns -0 into 0, which would print "-0". */
export const num = (n) => (Math.round(n) || 0).toLocaleString();

/**
 * A duration: "45s", "4m 05s" (seconds only under 10 minutes), "12m", "1h 02m". Rounding carries into
 * the next unit, so 59m 40s is "1h 00m", never "60m".
 */
export function dur(s) {
  if (s == null || !isFinite(s)) return '–';
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  if (s < 600) { const m = Math.floor(s / 60), r = s % 60; return r ? `${m}m${NB}${pad(r)}s` : `${m}m`; }
  if (s < 3600) { const m = Math.round(s / 60); if (m < 60) return `${m}m`; s = 3600; }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${num(h)}h${NB}${pad(m)}m`;
}
/** A duration for a table column: under an hour the seconds always show ("5m 00s"), so a column of game lengths reads evenly. */
export function durT(s) {
  if (s == null || !isFinite(s)) return '–';
  s = Math.round(s);
  return s >= 60 && s < 3600 ? `${Math.floor(s / 60)}m${NB}${pad(s % 60)}s` : dur(s);
}
/** "3 hours 2 minutes". Minutes are cut the way dur() cuts them, so the headline and the tiles never disagree by a minute. */
export function durWords(s) {
  s = Math.round(s);
  let h = Math.floor(s / 3600), m = h ? Math.floor((s % 3600) / 60) : Math.round(s / 60);
  if (!h && m >= 60) { h = 1; m = 0; }
  const hp = h ? `${num(h)}${NB}hour${h === 1 ? '' : 's'}` : '', mp = m || !h ? `${m}${NB}minute${m === 1 ? '' : 's'}` : '';
  return [hp, mp].filter(Boolean).join(NB);
}
/** A clock face's digits, "h:mm:ss" ("h:mm" from 1,000 hours on). */
export function clockText(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h >= 1000 ? `${h}:${pad(m)}` : `${h}:${pad(m)}:${pad(r)}`;
}

/**
 * A share as a percentage. A share that is not zero never prints as "0%" ("<1%"), and one that is not
 * all never prints as "100%" (">99%"). `d` decimals.
 */
export function pct(x, d = 0) {
  if (x == null || !isFinite(x)) return '–';
  const s = (x * 100).toFixed(d), v = Number(s), step = 1 / 10 ** d;
  if (x > 0 && v === 0) return `<${step.toFixed(d)}%`;
  if (x < 1 && v >= 100) return `>${(100 - step).toFixed(d)}%`;
  return `${s}%`;
}

/** An average to one decimal, without a ".0" when it is whole: 1 game, 2.5 games. */
export const dec1 = (x) => { const r = Math.round(x * 10) / 10; return Number.isInteger(r) ? num(r) : r.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
/** The one rule for averages such as games a day: one decimal under 10, none from 10 up, never "x.0". */
export const avg = (x) => (Math.abs(Math.round(x * 10) / 10) >= 10 ? num(x) : dec1(x));
/** An average with its noun: "1 game", "2.5 games", "27 games". */
export const per = (x, w) => { const s = avg(x); return `${s} ${w}${s === '1' ? '' : 's'}`; };
export const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
