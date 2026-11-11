import { fetchPlayerGames, clearCache } from './data.js';
import { analyze } from './analyze.js';
import { dayChart, lineChart, colChart, showTip, hideTip, tipBox, setTip, timeTick } from './charts.js';

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
  return n;
}
// "**bold** text" -> nodes, without ever touching innerHTML (names come from an API).
function rich(str) {
  const f = document.createDocumentFragment();
  str.split('**').forEach((part, i) => { if (part) f.append(i % 2 ? el('b', { text: part }) : part); });
  return f;
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const MINUS = '−';

const dfShort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dfLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const dfMed = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dfMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dfMonShort = new Intl.DateTimeFormat(undefined, { month: 'short' });
const dfMonYr = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });
const dfTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dfHour = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const dfDow = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const dfDowShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dowName = (dow, short) => (short ? dfDowShort : dfDow).format(new Date(2024, 0, 1 + dow)); // 2024-01-01 was a Monday
const H12 = /[a-z]/i.test(dfHour.format(new Date(2024, 0, 1, 15)));
const hourName = (h) => (H12 ? dfHour.format(new Date(2024, 0, 1, h)).replace(/\s/g, ' ').toLowerCase() : `${pad(h)}:00`);
const num = (n) => Math.round(n).toLocaleString();

function dur(s) {
  if (s == null || !isFinite(s)) return '–';
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return s < 600 && r ? `${m}m ${r}s` : `${Math.round(s / 60)}m`; }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${num(h)}h ${pad(m)}m`;
}
// Same value as nodes, with small unit letters, for the big tile figures.
function durNode(s) {
  const f = document.createDocumentFragment();
  for (const part of dur(s).split(' ')) {
    const mt = part.match(/^([\d,.–]+)([a-z]*)$/);
    if (!mt) { f.append(part); continue; }
    f.append(mt[1]);
    if (mt[2]) f.append(el('small', { text: mt[2] }));
  }
  return f;
}
function durWords(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  const hp = h ? `${num(h)} hour${h === 1 ? '' : 's'}` : '', mp = m || !h ? `${m} minute${m === 1 ? '' : 's'}` : '';
  return [hp, mp].filter(Boolean).join(' ');
}
function clockText(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h >= 1000 ? `${h}:${pad(m)}` : `${h}:${pad(m)}:${pad(r)}`;
}
const signed = (n) => (n > 0 ? '+' : n < 0 ? MINUS : '') + num(Math.abs(n));
const pct = (x, d = 0) => (x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d) + '%');
const rate = (o) => (o && o.games ? o.wins / o.games : null);
const wdl = (o) => `${o.wins}–${o.draws}–${o.losses}`;
const dateStr = (s, f = dfMed) => f.format(parseYmd(s));
const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;

const CLASS_LABEL = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' };
const CLASSES = [
  { key: 'bullet', cls: 'f-t1', label: 'Bullet' },
  { key: 'blitz', cls: 'f-t2', label: 'Blitz' },
  { key: 'rapid', cls: 'f-t3', label: 'Rapid' },
];
const ENDING = {
  checkmate: 'Checkmate', resignation: 'Resignation', timeout: 'Out of time', abandonment: 'Abandoned',
  stalemate: 'Stalemate', repetition: 'Repetition', agreement: 'Agreed draw', insufficient: 'Insufficient material',
  'fifty-move': '50-move rule', 'time-vs-insufficient': 'Timeout, no mating material', variant: 'Variant rule', other: 'Other',
};
function controlLabel(g) {
  if (g.timeClass === 'daily') { const d = g.base / 86400; return `${d >= 1 ? Math.round(d) : '<1'} day${d > 1.5 ? 's' : ''} per move`; }
  if (!g.base) return g.timeControl || '';
  const b = g.base % 60 === 0 ? `${g.base / 60}` : `${g.base}s`;
  return g.inc ? `${b}${g.base % 60 === 0 ? '' : ''} | ${g.inc}` : g.base % 60 === 0 ? `${b} min` : b;
}
function poolLabel(p) {
  const tc = CLASS_LABEL[p.timeClass] || p.timeClass;
  if (p.rules === 'chess') return tc;
  const r = { chess960: 'Chess960', bughouse: 'Bughouse', kingofthehill: 'King of the Hill', threecheck: '3-check', crazyhouse: 'Crazyhouse' }[p.rules] || p.rules;
  return `${r} ${tc.toLowerCase()}`;
}

// ---------- state ----------
const S = {
  users: [], focus: 0, preset: '30', from: '', to: '',
  tc: 'all', rated: false, gran: 'auto', heat: 'time', pool: null,
  sel: null, sort: { k: 'date', dir: -1 }, hideEmpty: true,
};
const store = new Map(); // lowercased username -> { state, player, games, stats, error }
let ctrl = null;
let runId = 0;

const key = (u) => u.toLowerCase();
const focusEntry = () => store.get(key(S.users[S.focus] || ''));

function applyPreset(p) {
  S.preset = p;
  const t = today();
  S.to = ymd(t);
  S.from = p === 'all' ? '' : ymd(addDays(t, -(Number(p) - 1)));
}

function readUrl() {
  const q = new URLSearchParams(location.search);
  const u = (q.get('u') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  S.users = [...new Map(u.map((x) => [key(x), x])).values()];
  const from = q.get('from'), to = q.get('to'), range = q.get('range');
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parseYmd(s));
  if (okDate(to) && (okDate(from) || from === '')) { S.preset = null; S.from = from; S.to = to; }
  else if (okDate(from) && okDate(to)) { S.preset = null; S.from = from; S.to = to; }
  else applyPreset(['7', '30', '90', '365', 'all'].includes(range) ? range : '30');
  if (['bullet', 'blitz', 'rapid', 'daily'].includes(q.get('tc'))) S.tc = q.get('tc');
  S.rated = q.get('rated') === '1';
  const f = S.users.findIndex((x) => key(x) === key(q.get('focus') || ''));
  S.focus = f >= 0 ? f : 0;
}
function writeUrl() {
  const q = new URLSearchParams();
  if (S.users.length) q.set('u', S.users.join(','));
  if (S.preset) q.set('range', S.preset); else { q.set('from', S.from); q.set('to', S.to); }
  if (S.tc !== 'all') q.set('tc', S.tc);
  if (S.rated) q.set('rated', '1');
  if (S.focus > 0 && S.users[S.focus]) q.set('focus', S.users[S.focus]);
  const s = q.toString();
  history.replaceState(null, '', s ? `?${s.replace(/%2C/g, ',')}` : location.pathname);
}

// ---------- controls ----------
function syncControls(keepTyped) {
  if (!keepTyped || !$('user').value) $('user').value = S.users[0] || $('user').value;
  $('from').value = S.from; $('to').value = S.to;
  $('to').max = ymd(today()); $('from').max = ymd(today());
  for (const b of $('presets').children) b.setAttribute('aria-pressed', String(b.dataset.preset === S.preset));
}
function showMsg(text) { const m = $('formMsg'); m.textContent = text || ''; m.hidden = !text; }
function setStatus(text, frac) {
  $('status').hidden = text == null;
  if (text != null) { $('statusText').textContent = text; $('barFill').style.width = `${Math.round((frac || 0) * 100)}%`; }
  $('go').disabled = text != null;
}

function seg(root, options, value, onPick) {
  root.replaceChildren(...options.map((o) => el('button', {
    type: 'button', text: o.label, 'aria-pressed': String(o.value === value), disabled: o.disabled,
    onclick: () => onPick(o.value),
  })));
}

// ---------- loading ----------
function rangeDates() {
  return { from: S.from ? parseYmd(S.from) : null, to: endOfDay(S.to ? parseYmd(S.to) : today()) };
}
function compute(e) {
  const { from, to } = rangeDates();
  const games = e.games.filter((g) => (S.tc === 'all' || g.timeClass === S.tc) && (!S.rated || g.rated));
  e.view = games;
  e.stats = analyze(games, { from, to });
}

// The last state that loaded completely. A failed lookup goes back to it instead of leaving the page half-switched.
let lastGood = null;
const snapshot = () => ({ users: S.users.slice(), focus: S.focus, preset: S.preset, from: S.from, to: S.to });
function settle() {
  for (const [k, e] of store) if (e.state !== 'ok') { if (e.stats) store.set(k, { ...e, state: 'ok', error: null }); else store.delete(k); }
}
function restore() {
  settle();
  if (lastGood) Object.assign(S, { ...lastGood, users: lastGood.users.slice() });
  else S.users = [];
  S.users = S.users.filter((u) => store.get(key(u))?.state === 'ok');
  if (S.focus >= S.users.length) S.focus = 0;
  for (const e of store.values()) if (e.state === 'ok') compute(e);
  setStatus(null);
  document.querySelectorAll('.is-stale').forEach((n) => n.classList.remove('is-stale'));
  writeUrl(); syncControls(true);
  if (S.users.length) render(); else renderPlayers();
}

async function run() {
  showMsg('');
  if (!S.users.length) { showMsg('Type a chess.com username first.'); $('user').focus(); return; }
  if (S.from && S.to && S.from > S.to) { showMsg('The start date is after the end date. Swap them or pick a preset.'); return; }
  if (!S.to) S.to = ymd(today());
  ctrl?.abort();
  ctrl = new AbortController();
  const my = ++runId, signal = ctrl.signal;
  syncControls(true);
  for (const u of S.users) { const e = store.get(key(u)); store.set(key(u), { ...(e || {}), state: 'loading', error: null }); }
  renderPlayers();
  document.querySelectorAll('#results .summary, #results .block').forEach((n) => n.classList.add('is-stale'));
  const { from, to } = rangeDates();
  const focusName = S.users[S.focus];
  const order = [focusName, ...S.users.filter((u) => u !== focusName)];
  let done = 0, problem = null;
  for (const u of order) {
    const isFocus = u === focusName;
    setStatus(`Fetching ${u}'s games`, done / order.length);
    try {
      const res = await fetchPlayerGames(u, {
        from, to, signal,
        onProgress: (p) => { if (my === runId) setStatus(`Fetching ${u}'s games${p.total ? `: month ${Math.min(p.total, p.done + 1)} of ${p.total}` : ''}`, (done + (p.total ? p.done / p.total : 0)) / order.length); },
      });
      if (my !== runId) return;
      const e = { state: 'ok', ...res };
      compute(e);
      store.set(key(u), e);
      const at = S.users.indexOf(u);
      if (at >= 0 && res.player?.username) S.users[at] = res.player.username;
    } catch (err) {
      if (my !== runId || err?.code === 'aborted' || err?.name === 'AbortError') return;
      if (!err?.code) console.error(err);
      const message = err?.code && err.message ? err.message : 'Something went wrong while loading the games. Try again.';
      problem ||= message;
      if (isFocus) { restore(); showMsg(message); return; }
      // A compare player that fails is dropped; the rest of the page stays.
      store.delete(key(u));
      S.users = S.users.filter((x) => x !== u);
      S.focus = Math.max(0, S.users.findIndex((x) => key(x) === key(focusName)));
    }
    done++;
    if (isFocus) { S.sel = null; render(); } else { renderPlayers(); renderCompare(); }
  }
  setStatus(null);
  lastGood = snapshot();
  writeUrl(); syncControls(true);
  render();
  if (problem) showMsg(problem);
}

function recompute() {
  for (const e of store.values()) if (e.state === 'ok') compute(e);
  S.sel = null;
  writeUrl();
  render();
}

// ---------- render ----------
function render() {
  renderPlayers();
  const e = focusEntry();
  if (!e) return;
  if (e.state === 'error') {
    showMsg(e.error);
    if (!$('results').hidden) document.querySelectorAll('#results .summary, #results .block').forEach((n) => n.classList.remove('is-stale'));
    renderCompare();
    return;
  }
  if (e.state !== 'ok') return;
  showMsg('');
  $('intro').hidden = true;
  $('results').hidden = false;
  document.querySelectorAll('#results .summary, #results .block').forEach((n) => n.classList.remove('is-stale'));
  const st = e.stats, who = e.player?.username || S.users[S.focus];
  const has = st.totals.games > 0;
  for (const id of ['secInsights', 'secDays', 'secElo', 'secStreaks', 'secWhen', 'secSessions', 'secGames', 'secLedger']) $(id).hidden = !has;

  seg($('tcSeg'), [{ value: 'all', label: 'All' }, ...['bullet', 'blitz', 'rapid', 'daily'].map((c) => ({
    value: c, label: CLASS_LABEL[c], disabled: !e.games.some((g) => g.timeClass === c) && S.tc !== c,
  }))], S.tc, (v) => { S.tc = v; recompute(); });

  renderClock(e, who);
  renderSummary(e, who);
  renderCompare();
  if (!has) return;
  renderInsights(e, who);
  renderDays(e);
  renderElo(e);
  renderStreaks(e);
  renderWhen(e);
  renderSessions(e, who);
  renderGames(e, who);
  renderLedger(e);
}

function renderPlayers() {
  $('players').replaceChildren(...S.users.map((u, i) => {
    const e = store.get(key(u));
    return el('span', { class: 'chip', 'data-on': String(i === S.focus), 'data-state': e?.state || '' , title: e?.state === 'error' ? e.error : null },
      el('button', { type: 'button', text: u, 'aria-pressed': String(i === S.focus), onclick: () => { S.focus = i; S.sel = null; S.pool = null; if (lastGood) lastGood.focus = i; writeUrl(); render(); } }),
      S.users.length > 1 && el('button', { type: 'button', class: 'x', text: '×', 'aria-label': `Remove ${u}`, onclick: () => removeUser(i) }),
    );
  }));
  $('addForm').hidden = S.users.length >= 4;
}
function removeUser(i) {
  S.users.splice(i, 1);
  if (S.focus >= S.users.length) S.focus = S.users.length - 1; else if (i < S.focus) S.focus--; else if (i === S.focus) S.focus = 0;
  S.sel = null; S.pool = null;
  $('user').value = S.users[0] || '';
  if (lastGood) lastGood = snapshot();
  writeUrl(); render();
}

// The clock faces: thinking time on each side of the board.
let clockAnim = 0;
function renderClock(e, who) {
  const t = e.stats.totals, me = t.myThink || 0, opp = t.oppThink || 0;
  $('faceMeName').textContent = who;
  const has = t.thinkGames > 0;
  $('faceMeFoot').textContent = has ? `${dur(me / t.thinkGames)} a game on their own clock` : 'no clock data in this range';
  $('faceOppFoot').textContent = has ? `${dur(opp / t.thinkGames)} a game on the other clock` : 'no clock data in this range';
  $('flagMe').hidden = !(has && me > opp); $('flagOpp').hidden = !(has && opp > me);
  document.querySelector('.clock').dataset.lean = !has || me === opp ? '' : me > opp ? 'me' : 'opp';
  const ghost = Math.max(me, opp) >= 3600000 ? '8888:88' : '888:88:88';
  document.querySelectorAll('.lcd-ghost').forEach((g) => { g.textContent = ghost; });
  $('clockSr').textContent = has ? `${who} thought for ${durWords(me)}; opponents for ${durWords(opp)}.` : '';
  const id = ++clockAnim, t0 = performance.now(), D = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
  const frame = (now) => {
    if (id !== clockAnim) return;
    const k = D ? Math.min(1, (now - t0) / D) : 1, ease = 1 - Math.pow(1 - k, 3);
    $('lcdMe').textContent = clockText(me * ease); $('lcdOpp').textContent = clockText(opp * ease);
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function tile(label, value, note) {
  return el('div', { class: 'tile' }, el('dt', { text: label }), el('dd', { class: 'v' }, value), el('dd', { class: 'n' }, note || ' '));
}
function dayLink(date, f = dfMed) {
  return el('button', { type: 'button', class: 'link-btn', text: dateStr(date, f), onclick: () => select('day', date, true) });
}

function renderSummary(e, who) {
  const st = e.stats, t = st.totals, r = st.range;
  const rangeText = `${dateStr(r.from)} to ${dateStr(r.to)}`;
  if (!t.games) {
    $('headline').textContent = `No games for ${who} in this range`;
    $('subline').textContent = `Nothing was played between ${rangeText}${S.tc !== 'all' || S.rated ? ' with these filters' : ''}. Try a longer range${S.tc !== 'all' || S.rated ? ' or clear the filters' : ''}.`;
    $('tiles').replaceChildren();
    $('tiles').hidden = true;
    return;
  }
  $('tiles').hidden = false;
  $('headline').textContent = `${who} spent ${durWords(t.time)} playing chess`;
  const waking = t.time / (r.days * 16 * 3600);
  const dailyOnly = t.liveGames === 0;
  $('subline').textContent = dailyOnly
    ? `${plural(t.games, 'daily game')} between ${rangeText}. Daily games run over days, so they have no time at the board to count.`
    : `${plural(t.games, 'game')} on ${t.activeDays} of ${plural(r.days, 'day')}, ${rangeText}. That is ${dur(t.avgPerDay)} for every day in the range, or ${pct(waking, waking < 0.1 ? 1 : 0)} of the waking hours.`;
  const rec = st.records, day = (d) => st.days.find((x) => x.date === d);
  const longest = st.sessions.longest != null ? st.sessions.list[st.sessions.longest] : null;
  const b = rec.busiestDay && day(rec.busiestDay), b30 = rec.busiestDayLast30 && day(rec.busiestDayLast30);
  $('tiles').replaceChildren(
    tile('Total time', durNode(t.time), `${plural(t.games, 'game')}, ${pct(rate(t))} won`),
    tile('Busiest day', b ? durNode(b.time) : '–', b ? [dayLink(b.date), `, ${plural(b.games, 'game')}`] : null),
    tile('Busiest in the last 30 days', b30 ? durNode(b30.time) : '–', b30 ? [dayLink(b30.date), `, ${plural(b30.games, 'game')}`] : 'no games in the last 30 days'),
    tile('Average game', durNode(t.avgGame), `half are under ${dur(t.medianGame)}`),
    tile('Per day played', durNode(t.avgPerActiveDay), `${(t.games / Math.max(1, t.activeDays)).toFixed(1)} games a day`),
    tile('Longest session', longest ? durNode(longest.duration) : '–', longest ? [dayLink(ymd(new Date(longest.start))), `, ${plural(longest.games, 'game')}`] : null),
  );
}

// ---------- insights ----------
function renderInsights(e, who) {
  const st = e.stats, t = st.totals, out = [];
  const minN = Math.max(8, Math.round(t.games * 0.03));
  const hours = st.byHour.filter((h) => h.games >= minN);
  if (t.time > 0) {
    const peak = st.byHour.reduce((a, b) => (b.time > a.time ? b : a));
    out.push(`The heaviest hour is **${hourName(peak.hour)}**: ${dur(peak.time)} of the total, ${pct(peak.time / t.time)} of all playing time.`);
  }
  if (hours.length >= 2) {
    const best = hours.reduce((a, b) => (rate(b) > rate(a) ? b : a)), worst = hours.reduce((a, b) => (rate(b) < rate(a) ? b : a));
    if (rate(best) - rate(worst) >= 0.08) out.push(`Sharpest around **${hourName(best.hour)}** (${pct(rate(best))} won in ${best.games} games), weakest around **${hourName(worst.hour)}** (${pct(rate(worst))} in ${worst.games}).`);
  }
  const tl = st.tilt;
  if (tl.afterWin.games >= 15 && tl.afterLoss.games >= 15) {
    const a = tl.afterLoss.winRate, b = tl.afterWin.winRate;
    out.push(`The game right after a loss is won **${pct(a)}** of the time; right after a win, **${pct(b)}**.${a < b - 0.04 ? ' Losses carry over.' : a > b + 0.04 ? ' Losses seem to sharpen the focus.' : ''}`);
  }
  if (tl.requeueAfterLoss != null && tl.requeueAfterWin != null && t.liveGames >= 30) {
    out.push(`After a loss, another game starts within five minutes **${pct(tl.requeueAfterLoss)}** of the time. After a win: ${pct(tl.requeueAfterWin)}.`);
  }
  const pos = st.sessions.byPosition;
  if (pos.length >= 6) {
    const early = pos.slice(0, 3).reduce((a, p) => ({ games: a.games + p.games, wins: a.wins + p.wins }), { games: 0, wins: 0 });
    const late = pos.slice(7).reduce((a, p) => ({ games: a.games + p.games, wins: a.wins + p.wins }), { games: 0, wins: 0 });
    if (early.games >= 20 && late.games >= 20) {
      const d = rate(late) - rate(early);
      out.push(`Games 1 to 3 of a session are won ${pct(rate(early))} of the time; from game 8 on it is **${pct(rate(late))}**.${d <= -0.04 ? ' Long sessions cost points.' : d >= 0.04 ? ' It takes a few games to warm up.' : ''}`);
    }
  }
  const dows = st.days.reduce((a, d) => { a[d.dow]++; return a; }, Array(7).fill(0));
  const dowAvg = st.byDow.map((d) => ({ dow: d.dow, avg: dows[d.dow] ? d.time / dows[d.dow] : 0 }));
  if (st.range.days >= 14 && t.time > 0) {
    const hi = dowAvg.reduce((a, b) => (b.avg > a.avg ? b : a)), lo = dowAvg.reduce((a, b) => (b.avg < a.avg ? b : a));
    out.push(`**${dowName(hi.dow)}s** are the heaviest day at ${dur(hi.avg)} on average; ${lo.avg > 0 ? `${dowName(lo.dow)}s the lightest at ${dur(lo.avg)}` : `nothing was played on a ${dowName(lo.dow)}`}.`);
  }
  if (st.elo.ratedGames >= 5 && st.records.bestEloDay && st.records.worstEloDay) {
    const b = st.days.find((d) => d.date === st.records.bestEloDay), w = st.days.find((d) => d.date === st.records.worstEloDay);
    if (b && w && b.eloNet > 0 && w.eloNet < 0) out.push(`Best day for the rating: **${signed(b.eloNet)}** on ${dateStr(b.date, dfShort)}. Worst: **${signed(w.eloNet)}** on ${dateStr(w.date, dfShort)}.`);
  }
  const c = st.clock;
  if (t.losses >= 10 && c.timeoutLosses / t.losses >= 0.12) out.push(`**${pct(c.timeoutLosses / t.losses)}** of the losses came from running out of time (${c.timeoutLosses} games).`);
  if (t.thinkGames >= 20 && c.fasterShare != null) out.push(`${who} used less clock than the opponent in **${pct(c.fasterShare)}** of games.`);
  const heavy = st.dailyLoad.filter((d) => d.days >= 2);
  if (heavy.length >= 2) {
    const first = heavy[0], last = heavy[heavy.length - 1];
    if (first.games >= 10 && last.games >= 20 && Math.abs(rate(first) - rate(last)) >= 0.04) out.push(`On days with ${last.label.replace('-', '–')} games the win rate is **${pct(rate(last))}**; on days with ${first.label.replace('-', '–')} it is ${pct(rate(first))}.`);
  }
  const wc = st.byColor.white, bc = st.byColor.black;
  if (wc.games >= 20 && bc.games >= 20 && Math.abs(rate(wc) - rate(bc)) >= 0.05) out.push(`With white: ${pct(rate(wc))} won. With black: **${pct(rate(bc))}**.`);
  const ds = st.streaks.longestDayStreak;
  if (ds && ds.length >= 5) out.push(`Longest run without a day off: **${ds.length} days**, ${dateStr(ds.startDate, dfShort)} to ${dateStr(ds.endDate, dfShort)}.`);
  const lg = st.records.longestGame != null ? e.view[st.records.longestGame] : null;
  if (lg && lg.duration > 0) out.push(`The longest single game took **${dur(lg.duration)}**, a ${lg.outcome} against ${lg.opponent} on ${dfShort.format(new Date(lg.start))}.`);
  $('secInsights').hidden = out.length === 0;
  $('insights').replaceChildren(...out.slice(0, 10).map((s) => el('li', null, rich(s))));
}

// ---------- day by day ----------
function streaksOf(games) {
  let w = 0, l = 0, bw = 0, bl = 0;
  for (const g of games) {
    if (g.outcome === 'win') { w++; l = 0; } else if (g.outcome === 'loss') { l++; w = 0; } else { w = 0; l = 0; }
    if (w > bw) bw = w; if (l > bl) bl = l;
  }
  return [bw, bl];
}
function bucketize(e, mode) {
  const days = e.stats.days;
  if (mode === 'day') return days.map((d) => ({ ...d, key: d.date, mode, label: dateStr(d.date, dfLong), activeDays: d.games ? 1 : 0, span: 1 }));
  const map = new Map();
  for (const d of days) {
    const dt = parseYmd(d.date);
    const k = mode === 'week' ? ymd(addDays(dt, -d.dow)) : d.date.slice(0, 7);
    let b = map.get(k);
    if (!b) {
      b = { key: k, mode, first: d.date, last: d.date, games: 0, wins: 0, losses: 0, draws: 0, time: 0, myThink: 0, oppThink: 0, eloGained: 0, eloLost: 0, eloNet: 0, sessions: 0, byClass: {}, gameIdx: [], activeDays: 0, span: 0, firstStart: null, lastEnd: null };
      map.set(k, b);
    }
    b.last = d.date; b.span++;
    for (const f of ['games', 'wins', 'losses', 'draws', 'time', 'myThink', 'oppThink', 'eloGained', 'eloLost', 'eloNet', 'sessions']) b[f] += d[f] || 0;
    if (d.games) b.activeDays++;
    for (const c in d.byClass) { const x = (b.byClass[c] ||= { games: 0, time: 0 }); x.games += d.byClass[c].games; x.time += d.byClass[c].time; }
    for (const i of d.gameIdx) b.gameIdx.push(i);
    if (d.firstStart != null && (b.firstStart == null || d.firstStart < b.firstStart)) b.firstStart = d.firstStart;
    if (d.lastEnd != null && (b.lastEnd == null || d.lastEnd > b.lastEnd)) b.lastEnd = d.lastEnd;
  }
  const out = [...map.values()];
  for (const b of out) {
    [b.bestWinStreak, b.bestLossStreak] = streaksOf(b.gameIdx.map((i) => e.view[i]));
    b.label = mode === 'week' ? `${dateStr(b.first, dfShort)} to ${dateStr(b.last, dfMed)}` : dfMonth.format(parseYmd(b.first));
  }
  return out;
}
function granOf(e) {
  const n = e.stats.range.days;
  if (S.gran !== 'auto' && !(S.gran === 'day' && n > 800)) return S.gran;
  return n <= 92 ? 'day' : n <= 550 ? 'week' : 'month';
}
function bucketTip(b) {
  const rows = [['Time', dur(b.time)], ['Games', `${b.games}`]];
  if (b.games) {
    rows.push(['Won, drawn, lost', wdl(b)]);
    if (b.eloGained || b.eloLost) rows.push(['Rating', `${signed(b.eloNet)}  (+${b.eloGained} ${MINUS}${b.eloLost})`]);
    rows.push(['Best winning streak', `${b.bestWinStreak}`], ['Worst losing streak', `${b.bestLossStreak}`]);
  }
  return tipBox(b.label, rows);
}
function select(mode, k, scroll) {
  S.sel = S.sel && S.sel.mode === mode && S.sel.key === k && !scroll ? null : { mode, key: k };
  const e = focusEntry();
  renderDays(e); renderLedger(e);
  if (scroll && S.sel) $('detail').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

function renderDays(e) {
  const st = e.stats, gran = granOf(e), n = st.range.days;
  seg($('granSeg'), [
    { value: 'day', label: 'Days', disabled: n > 800 }, { value: 'week', label: 'Weeks', disabled: n < 14 }, { value: 'month', label: 'Months', disabled: n < 45 },
  ], gran, (v) => { S.gran = v; S.sel = null; renderDays(e); });
  const buckets = bucketize(e, gran);
  const used = CLASSES.filter((c) => st.byClass.some((x) => x.timeClass === c.key && x.time > 0));
  $('dayLegend').replaceChildren(
    ...(used.length > 1 ? used.map((c) => el('span', { class: 'key' }, el('i', { class: c.cls }), c.label)) : []),
    ...(st.elo.ratedGames ? [
      el('span', { class: 'key' }, el('i', { class: 'f-win' }), 'Rating won'), el('span', { class: 'key' }, el('i', { class: 'f-loss' }), 'Rating lost'),
      el('span', { class: 'key' }, el('i', { class: 'f-ink', style: 'height:3px;width:12px' }), 'Net'),
    ] : []),
  );
  // highlight the bucket that holds the selection
  let selKey = null;
  if (S.sel) {
    if (S.sel.mode === gran) selKey = S.sel.key;
    else if (S.sel.mode === 'day') selKey = gran === 'week' ? ymd(addDays(parseYmd(S.sel.key), -((parseYmd(S.sel.key).getDay() + 6) % 7))) : S.sel.key.slice(0, 7);
  }
  $('daysSub').textContent = `Time at the board${st.elo.ratedGames ? ', and rating won and lost' : ''}. Pick a ${gran === 'day' ? 'day' : gran} to open it${matchMedia('(hover: hover)').matches ? '; arrow keys work too' : ''}.`;
  dayChart($('dayChart'), buckets, {
    label: `Time played per ${gran}. Use the left and right arrow keys to read values, Enter to open one.`,
    classes: CLASSES, selectedKey: selKey, fmtTime: dur, tip: bucketTip,
    tick: (b) => (gran === 'month' ? dfMonYr.format(parseYmd(b.first)) : dateStr(gran === 'day' ? b.date : b.first, dfShort)),
    onSelect: (b) => select(gran, b.key),
  });
  renderDetail(e);
  renderCalendar(e);
}

function resultPill(g) {
  const c = g.outcome === 'win' ? 'w' : g.outcome === 'loss' ? 'l' : 'd';
  return el('span', { class: `pill ${c}`, text: c === 'w' ? 'W' : c === 'l' ? 'L' : 'D', title: `${g.outcome === 'win' ? 'Won' : g.outcome === 'loss' ? 'Lost' : 'Drew'} by ${(ENDING[g.ending] || g.ending || '').toLowerCase()}` });
}
function renderDetail(e) {
  const box = $('detail');
  if (!S.sel) { box.hidden = true; box.replaceChildren(); return; }
  const b = bucketize(e, S.sel.mode).find((x) => x.key === S.sel.key);
  if (!b) { box.hidden = true; return; }
  box.hidden = false;
  const games = b.gameIdx.map((i) => e.view[i]);
  const multi = S.sel.mode !== 'day';
  const head = el('div', { class: 'detail-head' },
    el('div', null, el('h3', { text: b.label }),
      el('p', { text: b.games ? (multi ? `${b.activeDays} of ${plural(b.span, 'day')} played` : b.firstStart ? `First game ${dfTime.format(new Date(b.firstStart))}, last one over at ${dfTime.format(new Date(b.lastEnd))}` : '') : 'No games.' })),
    el('button', { type: 'button', class: 'ghost-btn', text: 'Close', onclick: () => { S.sel = null; renderDays(e); renderLedger(e); } }));
  box.replaceChildren(head);
  if (!b.games) return;
  const think = b.myThink + b.oppThink;
  box.append(el('dl', { class: 'tiles' },
    tile('Time', durNode(b.time), `${plural(b.sessions, 'session')}`),
    tile('Games', String(b.games), `${wdl(b)} won, drawn, lost`),
    tile('Rating', el('span', { class: b.eloNet > 0 ? 'up' : b.eloNet < 0 ? 'down' : '', text: signed(b.eloNet) }), `+${b.eloGained} won, ${MINUS}${b.eloLost} lost`),
    tile('Best winning streak', String(b.bestWinStreak), b.bestWinStreak === 1 ? 'game' : 'games in a row'),
    tile('Worst losing streak', String(b.bestLossStreak), b.bestLossStreak === 1 ? 'game' : 'games in a row'),
    tile('Own clock', think ? durNode(b.myThink) : '–', think ? `opponents ${dur(b.oppThink)}` : 'no clock data'),
  ));
  const cap = 250, shown = games.slice(0, cap);
  const rows = shown.map((g) => el('tr', null,
    el('td', { text: multi ? `${dfShort.format(new Date(g.start))}, ${dfTime.format(new Date(g.start))}` : dfTime.format(new Date(g.start)) }),
    el('td', null, resultPill(g)),
    el('td', null, el('a', { href: g.url, target: '_blank', rel: 'noopener', text: g.opponent }), g.oppRating ? ` (${g.oppRating})` : ''),
    el('td', { text: `${CLASS_LABEL[g.timeClass] || g.timeClass}, ${controlLabel(g)}${g.rated ? '' : ', unrated'}` }),
    el('td', { class: 'num', text: g.live === false ? '–' : dur(g.duration) }),
    el('td', { class: 'num', text: g.myThink != null ? `${dur(g.myThink)} / ${dur(g.oppThink)}` : '–' }),
    el('td', { class: `num ${g.ratingDelta > 0 ? 'up' : g.ratingDelta < 0 ? 'down' : ''}`, text: g.ratingDelta == null ? '–' : signed(g.ratingDelta) }),
    el('td', { class: 'num', text: g.myRating ?? '–' }),
  ));
  box.append(el('div', { class: 'table-wrap tall' }, el('table', { class: 'ledger' },
    el('thead', null, el('tr', null, ...['Started', '', 'Opponent', 'Game', 'Length', 'Clock, own / theirs', 'Rating', 'After'].map((h, i) => el('th', { class: i >= 4 ? 'num' : null, text: h })))),
    el('tbody', null, ...rows))));
  if (games.length > cap) box.append(el('p', { class: 'note', text: `Showing the first ${cap} of ${num(games.length)} games.` }));
}

function mixTime(frac) { return `color-mix(in oklab, var(--time) ${Math.round(frac * 100)}%, var(--surface-2))`; }
function level(v, max) { if (!v || !max) return 0; const r = v / max; return r <= 0.15 ? 1 : r <= 0.35 ? 2 : r <= 0.6 ? 3 : r <= 0.85 ? 4 : 5; }
const LEVEL_MIX = [0, 0.25, 0.45, 0.65, 0.82, 1];

function renderCalendar(e) {
  const st = e.stats, days = st.days, n = days.length;
  const show = n >= 28 && n <= 1100;
  $('calPanel').hidden = !show;
  if (!show) return;
  const max = Math.max(...days.map((d) => d.time));
  const cal = $('cal'), nodes = [];
  let col = [];
  let lastMonth = '';
  const flush = (first) => {
    if (!col.length) return;
    const mo = first.date.slice(0, 7);
    const showLabel = mo !== lastMonth && (lastMonth === '' || Number(first.date.slice(8)) <= 7);
    nodes.push(el('span', { text: showLabel ? dfMonShort.format(parseYmd(first.date)) : '' }));
    if (showLabel) lastMonth = mo;
    nodes.push(...col);
    col = [];
  };
  let firstOfCol = days[0];
  for (let i = 0; i < days[0].dow; i++) col.push(el('i'));
  for (const d of days) {
    if (d.dow === 0 && col.length) { flush(firstOfCol); firstOfCol = d; }
    if (!col.length) firstOfCol = d;
    const b = el('button', {
      type: 'button', tabindex: -1, 'aria-label': `${dateStr(d.date, dfLong)}: ${dur(d.time)}, ${plural(d.games, 'game')}`,
      'aria-pressed': String(S.sel?.mode === 'day' && S.sel.key === d.date),
      style: d.time ? `background:${mixTime(LEVEL_MIX[level(d.time, max)])}` : (d.games ? 'background:var(--axis)' : null),
      onclick: () => select('day', d.date),
    });
    setTip(b, () => bucketTip({ ...d, label: dateStr(d.date, dfLong) }));
    col.push(b);
  }
  while (col.length < 7) col.push(el('i'));
  flush(firstOfCol);
  cal.replaceChildren(...nodes);
  const weeks = nodes.length / 8, room = (cal.parentElement.clientWidth || 600) - 6;
  cal.style.setProperty('--c', `${Math.max(13, Math.min(22, Math.floor(room / weeks) - 3))}px`);
  $('calScale').replaceChildren('Less', ...[0, 1, 2, 3, 4, 5].map((l) => el('i', { style: `background:${l ? mixTime(LEVEL_MIX[l]) : 'var(--surface-2)'}` })), `More (up to ${dur(max)} in a day)`);
  const wrap = cal.parentElement; wrap.scrollLeft = wrap.scrollWidth;
}

// ---------- rating ----------
function renderElo(e) {
  const st = e.stats, pools = st.elo.byPool;
  $('secElo').hidden = !pools.length;
  if (!pools.length) return;
  if (!pools.some((p) => p.pool === S.pool)) S.pool = pools[0].pool;
  const p = pools.find((x) => x.pool === S.pool);
  seg($('poolSeg'), pools.slice(0, 6).map((x) => ({ value: x.pool, label: poolLabel(x) })), S.pool, (v) => { S.pool = v; renderElo(e); });
  $('poolSeg').hidden = pools.length < 2;
  const sp = (cls, text) => el('span', { class: cls, text });
  $('eloTiles').replaceChildren(
    tile('Rating won', sp('up', `+${num(p.gained)}`), `over ${plural(p.games, 'rated game')}`),
    tile('Rating lost', sp('down', `${MINUS}${num(p.lost)}`), pools.length > 1 ? `all lists: +${num(st.elo.gained)} ${MINUS}${num(st.elo.lost)}` : `${(p.lost / Math.max(1, p.games)).toFixed(1)} a game`),
    tile('Net change', sp(p.net > 0 ? 'up' : p.net < 0 ? 'down' : '', signed(p.net)), `${p.start} to ${p.end}`),
    tile('Peak', String(p.peak), `lowest ${p.low}`),
  );
  // One even step per rated game: plotted against real time, a session collapses into a vertical cliff.
  const pts = p.series.map((s, k) => ({ t: k, v: s.rating, i: s.i, at: s.t }));
  $('eloNote').textContent = `One step per rated game, ${num(pts.length)} in all. The dates under the line show when those games were played.`;
  lineChart($('eloChart'), pts, {
    label: `${poolLabel(p)} rating over time, from ${p.start} to ${p.end}`, start: p.start,
    fmtX: (t) => dfShort.format(new Date(pts[Math.max(0, Math.min(pts.length - 1, Math.round(t)))].at)),
    tip: (pt) => {
      const g = e.view[pt.i];
      return tipBox(String(pt.v), g ? [['When', `${dfShort.format(new Date(g.end))}, ${dfTime.format(new Date(g.end))}`], ['Game', `${g.outcome} vs ${g.opponent}`], ['Change', g.ratingDelta == null ? '–' : signed(g.ratingDelta)]] : []);
    },
  });
}

// ---------- streaks ----------
function renderStreaks(e) {
  const st = e.stats, s = st.streaks, games = e.view;
  const span = (x) => (x && x.length ? `${dfShort.format(new Date(x.start))}${ymd(new Date(x.start)) !== ymd(new Date(x.end)) ? ' to ' + dfShort.format(new Date(x.end)) : ''}` : null);
  const cur = s.current;
  $('streakTiles').replaceChildren(
    tile('Longest winning streak', String(s.longestWin?.length || 0), span(s.longestWin) || 'no wins in the range'),
    tile('Longest losing streak', String(s.longestLoss?.length || 0), span(s.longestLoss) || 'no losses in the range'),
    tile('Streak at the end of the range', cur?.type && cur.length ? `${cur.length} ${cur.type === 'win' ? 'won' : cur.type === 'loss' ? 'lost' : 'drawn'}` : '–', 'counting back from the last game'),
    tile('Most days in a row', String(s.longestDayStreak?.length || 0), s.longestDayStreak?.length ? `${dateStr(s.longestDayStreak.startDate, dfShort)} to ${dateStr(s.longestDayStreak.endDate, dfShort)}` : null),
  );
  const cap = 300, from = Math.max(0, games.length - cap);
  $('tapeTitle').textContent = games.length > cap ? `The last ${cap} results, oldest first` : `All ${plural(games.length, 'result')}, oldest first`;
  const inRun = (i, r) => r && r.length > 1 && i >= r.startIdx && i <= r.endIdx;
  const frag = [];
  for (let i = from; i < games.length; i++) {
    const g = games[i];
    const n = el('i', { class: `${g.outcome === 'win' ? 'w' : g.outcome === 'loss' ? 'l' : ''}${inRun(i, s.longestWin) || inRun(i, s.longestLoss) ? ' hl' : ''}` });
    setTip(n, () => tipBox(`${g.outcome === 'win' ? 'Won' : g.outcome === 'loss' ? 'Lost' : 'Drew'} vs ${g.opponent}`, [['When', `${dfShort.format(new Date(g.start))}, ${dfTime.format(new Date(g.start))}`], ['Game', `${CLASS_LABEL[g.timeClass] || g.timeClass}, ${controlLabel(g)}`], ['Rating', g.ratingDelta == null ? '–' : signed(g.ratingDelta)]]));
    frag.push(n);
  }
  $('tape').replaceChildren(...frag);
  $('tapeLegend').replaceChildren(
    el('span', { class: 'key' }, el('i', { class: 'f-win' }), 'Won'), el('span', { class: 'key' }, el('i', { class: 'f-draw' }), 'Drawn'), el('span', { class: 'key' }, el('i', { class: 'f-loss' }), 'Lost'),
    el('span', { class: 'key' }, el('i', { class: 'f-ink', style: 'height:2px;width:14px;border-radius:0' }), 'Longest winning and losing streaks'),
  );
}

// ---------- time of week ----------
function renderWhen(e) {
  const st = e.stats;
  seg($('heatSeg'), [{ value: 'time', label: 'Time' }, { value: 'games', label: 'Games' }, { value: 'win', label: 'Win rate' }, { value: 'elo', label: 'Rating' }], S.heat, (v) => { S.heat = v; renderWhen(e); });
  const cells = st.heatmap.flat();
  const max = S.heat === 'time' ? Math.max(...cells.map((c) => c.time)) : S.heat === 'games' ? Math.max(...cells.map((c) => c.games)) : S.heat === 'elo' ? Math.max(1, ...cells.map((c) => Math.abs(c.eloNet))) : 0;
  const minGames = 4;
  const div = (good, mag) => `color-mix(in oklab, var(--${good ? 'win' : 'loss'}) ${Math.round(Math.min(1, Math.max(0.12, mag)) * 100)}%, var(--surface-2))`;
  const colour = (c) => {
    if (!c.games) return null;
    if (S.heat === 'time') return c.time ? mixTime(0.15 + 0.85 * (c.time / max)) : null;
    if (S.heat === 'games') return mixTime(0.15 + 0.85 * (c.games / max));
    if (S.heat === 'win') { if (c.games < minGames) return 'var(--line)'; const r = c.wins / c.games; return div(r >= 0.5, Math.abs(r - 0.5) / 0.3); }
    return c.eloNet ? div(c.eloNet > 0, Math.abs(c.eloNet) / max) : 'var(--line)';
  };
  const nodes = [el('span')];
  for (let h = 0; h < 24; h++) nodes.push(el('span', { class: 'hh', text: h % 3 === 0 ? (H12 ? hourName(h).replace(/\s/g, '') : pad(h)) : '' }));
  st.heatmap.forEach((row, dow) => {
    nodes.push(el('span', { class: 'dd', text: dowName(dow, true) }));
    row.forEach((c, h) => {
      const bg = colour(c);
      const n = el('div', { class: 'cell', style: bg ? `background:${bg}` : null });
      setTip(n, () => tipBox(`${dowName(dow)}, ${hourName(h)} to ${hourName((h + 1) % 24)}`, c.games ? [['Time', dur(c.time)], ['Games', String(c.games)], ['Won', `${pct(rate(c))} (${wdl(c)})`], ['Rating', signed(c.eloNet)]] : [], c.games ? null : 'No games'));
      nodes.push(n);
    });
  });
  $('heat').replaceChildren(...nodes);
  const sw = (bg) => el('i', { style: `background:${bg}` });
  $('heatScale').replaceChildren(...(S.heat === 'time' || S.heat === 'games'
    ? ['Less', sw('var(--surface-2)'), ...[0.15, 0.4, 0.65, 1].map((f) => sw(mixTime(f))), `More (up to ${S.heat === 'time' ? dur(max) : plural(max, 'game')} in one slot)`]
    : S.heat === 'win'
      ? ['Mostly lost', ...[1, 0.5].map((f) => sw(div(false, f))), sw('var(--surface-2)'), ...[0.5, 1].map((f) => sw(div(true, f))), `Mostly won. Slots with fewer than ${minGames} games stay grey.`]
      : ['Rating lost', ...[1, 0.5].map((f) => sw(div(false, f))), sw('var(--surface-2)'), ...[0.5, 1].map((f) => sw(div(true, f))), `Rating won (up to ${max} points in one slot)`]));
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('whenSub').textContent = `Each square is one hour of the week${zone ? `, in ${zone.replace(/_/g, ' ')} time` : ''}.`;

  const counts = st.days.reduce((a, d) => { a[d.dow]++; return a; }, Array(7).fill(0));
  const avg = st.byDow.map((d) => (counts[d.dow] ? d.time / counts[d.dow] : 0)), top = Math.max(...avg, 1);
  $('dowRows').replaceChildren(...st.byDow.map((d, i) => el('div', { class: 'row' },
    el('span', { class: 'rl', text: dowName(d.dow) }),
    el('span', { class: 'track' }, avg[i] > 0 && el('span', { class: 'fill', style: `width:${(avg[i] / top) * 100}%` })),
    el('span', { class: 'rv' }, d.games ? dur(avg[i]) : '', el('small', { text: d.games ? `${pct(rate(d))} won` : 'no games' })))));
}

// ---------- sessions ----------
function pairs(head, rows) {
  return el('div', { class: 'pairs' },
    el('div', { class: 'pair head' }, ...head.map((h) => el('span', { text: h }))),
    ...rows.map((r) => el('div', { class: 'pair' }, el('span', { text: r[0] }), el('b', { text: r[1] }), r[2] != null ? el('b', { text: r[2] }) : el('span'))));
}
function renderSessions(e, who) {
  const st = e.stats, s = st.sessions;
  const longest = s.longest != null ? s.list[s.longest] : null;
  $('secSessions').hidden = !s.count;
  if (!s.count) return;
  $('sessionTiles').replaceChildren(
    tile('Sessions', num(s.count), `${(s.count / Math.max(1, st.totals.activeDays)).toFixed(1)} on a day played`),
    tile('Average session', durNode(s.avgDuration), `${s.avgGames.toFixed(1)} games`),
    tile('Half of sessions are under', durNode(s.medianDuration), null),
    tile('Longest session', longest ? durNode(longest.duration) : '–', longest ? `${plural(longest.games, 'game')}, ${wdl(longest)}, rating ${signed(longest.eloNet)}` : null),
  );
  colChart($('posChart'), s.byPosition.map((p) => ({
    label: p.label, value: p.games ? (p.wins / p.games) * 100 : null,
    tip: () => tipBox(`Game ${p.label} of a session`, [['Won', pct(rate(p))], ['Games', String(p.games)], ['Won, drawn, lost', wdl(p)], ['Rating', signed(p.eloNet)]]),
  })), { label: 'Share of games won, by position of the game within a session', max: 100, step: 25, fmtY: (v) => v + '%', ref: 50 });
  const tl = st.tilt;
  $('tilt').replaceChildren(
    pairs(['The next game in the session', 'After a win', 'After a loss'], [
      ['is won', pct(tl.afterWin.winRate), pct(tl.afterLoss.winRate)],
      ['starts within 5 minutes', pct(tl.requeueAfterWin), pct(tl.requeueAfterLoss)],
      ['starts after a pause of', dur(tl.medianGapAfterWin), dur(tl.medianGapAfterLoss)],
    ]),
    el('p', { class: 'note', text: `Based on ${num(tl.afterWin.games)} games played right after a win and ${num(tl.afterLoss.games)} right after a loss. The pause is the typical (median) gap.` }));
  const load = st.dailyLoad.filter((d) => d.days > 0);
  $('loadRows').replaceChildren(
    ...load.map((d) => el('div', { class: 'row' },
      el('span', { class: 'rl', text: `${d.label.replace('-', '–')} games` }),
      wdlBar(d),
      el('span', { class: 'rv' }, `${pct(rate(d))} won`, el('small', { text: `${signed(Math.round(d.eloNet / d.days))} a day` })))),
    el('p', { class: 'note', text: `Days grouped by how many games ${who} played. The bar shows games won, drawn and lost; the last figure is the average rating change on such a day.` }));
}
function wdlBar(o, thin) {
  const b = el('span', { class: `wdl${thin ? ' thin' : ''}`, role: 'img', 'aria-label': `${o.wins} won, ${o.draws} drawn, ${o.losses} lost` },
    o.wins > 0 && el('i', { class: 'w', style: `flex:${o.wins}` }), o.draws > 0 && el('i', { class: 'd', style: `flex:${o.draws}` }), o.losses > 0 && el('i', { class: 'l', style: `flex:${o.losses}` }));
  setTip(b, () => tipBox(null, [['Won', `${o.wins} (${pct(o.wins / o.games)})`], ['Drawn', `${o.draws} (${pct(o.draws / o.games)})`], ['Lost', `${o.losses} (${pct(o.losses / o.games)})`]]));
  return b;
}

// ---------- games ----------
function renderGames(e, who) {
  const st = e.stats, t = st.totals, c = st.clock;
  const hist = st.durationHist;
  const edge = (s) => (s === 0 ? '0' : s < 60 ? `${s}s` : timeTick(s));
  colChart($('histChart'), hist.map((b) => ({
    label: b.to == null ? `${edge(b.from)}+` : edge(b.from), value: b.count,
    tip: () => tipBox(b.to == null ? `${dur(b.from)} or longer` : `${dur(b.from)} to ${dur(b.to)}`, [['Games', num(b.count)], ['Share', pct(b.count / Math.max(1, t.liveGames))]]),
  })), { label: 'Number of games by how long they lasted', labelWidth: 44 });
  $('histChart').hidden = !hist.length;

  const tg = t.thinkGames;
  $('clockStats').replaceChildren(tg ? pairs(['', who, 'Opponents'], [
    ['Clock used in total', dur(t.myThink), dur(t.oppThink)],
    ['Clock used per game', dur(t.myThink / tg), dur(t.oppThink / tg)],
    ['Per move', c.avgMyMove != null ? `${c.avgMyMove.toFixed(1)}s` : '–', c.avgOppMove != null ? `${c.avgOppMove.toFixed(1)}s` : '–'],
    ['Left on the clock when winning', dur(c.avgLeftWin), null],
    ['Left on the clock when losing', dur(c.avgLeftLoss), null],
    ['Games decided on time', `${c.timeoutWins} won`, `${c.timeoutLosses} lost`],
  ]) : el('p', { class: 'empty', text: 'These games carry no clock data.' }));
  if (tg && tg < t.games) $('clockStats').append(el('p', { class: 'note', text: `Clock figures cover the ${num(tg)} games that recorded move times.` }));

  const groups = [['Won', st.endings.wins, 'w', t.wins], ['Lost', st.endings.losses, 'l', t.losses], ['Drawn', st.endings.draws, 'd', t.draws]].filter((g) => g[1].length);
  $('endings').replaceChildren(el('div', { class: 'rows' }, ...groups.flatMap(([name, list, cls, total]) => [
    el('h4', { text: `${name}: ${num(total)}` }),
    ...list.slice(0, 5).map((x) => el('div', { class: 'row' },
      el('span', { class: 'rl', text: ENDING[x.ending] || x.ending, title: ENDING[x.ending] || x.ending }),
      el('span', { class: 'track' }, el('span', { class: `fill ${cls}`, style: `width:${(x.count / Math.max(1, total)) * 100}%` })),
      el('span', { class: 'rv' }, num(x.count), el('small', { text: pct(x.count / Math.max(1, total)) })))),
  ])));

  const DIFF = ['200+ weaker', '100 to 200 weaker', '25 to 100 weaker', 'About equal', '25 to 100 stronger', '100 to 200 stronger', '200+ stronger'];
  const diff = st.ratingDiff.map((b, i) => ({ ...b, name: st.ratingDiff.length === 7 ? DIFF[i] : b.label })).filter((b) => b.games > 0);
  $('diffRows').replaceChildren(...(diff.length ? diff.map((b) => el('div', { class: 'row wide' },
    el('span', { class: 'rl', text: b.name, title: b.name }), wdlBar(b),
    el('span', { class: 'rv' }, `${pct(rate(b))} won`, el('small', { text: plural(b.games, 'game') })))) : [el('p', { class: 'empty', text: 'No rated opponents to compare.' })]),
    diff.length ? el('p', { class: 'note', text: 'Opponents grouped by how their rating compared when the game was played.' }) : null);

  const mini = (root, head, rows, empty) => root.replaceChildren(...(rows.length
    ? [el('thead', null, el('tr', null, ...head.map((h, i) => el('th', { class: i && i !== 2 ? 'num' : null, text: h })))), el('tbody', null, ...rows)]
    : [el('tbody', null, el('tr', null, el('td', { class: 'empty', text: empty })))]));
  mini($('openings'), ['Opening', 'Games', 'Won', 'Time'], st.openings.map((o) => el('tr', null,
    el('td', { text: o.name, title: o.name }), el('td', { class: 'num', text: num(o.games) }),
    el('td', null, wdlBar(o, true), ` ${pct(rate(o))}`), el('td', { class: 'num', text: dur(o.time) }))), 'No opening names in these games.');
  mini($('opponents'), ['Opponent', 'Games', 'Won', 'Time'], st.opponents.map((o) => el('tr', null,
    el('td', null, el('a', { href: `https://www.chess.com/member/${encodeURIComponent(o.username)}`, target: '_blank', rel: 'noopener', text: o.username })),
    el('td', { class: 'num', text: num(o.games) }), el('td', null, wdlBar(o, true), ` ${pct(rate(o))}`), el('td', { class: 'num', text: dur(o.time) }))), 'Nobody was played more than once in this range.');
}

// ---------- compare ----------
function renderCompare() {
  const sec = $('secCompare');
  sec.hidden = S.users.length < 2 || $('results').hidden;
  if (sec.hidden) return;
  const head = ['Player', 'Time', 'Games', 'Days played', 'On a day played', 'Average game', 'Won', 'Rating', 'Longest session', 'Own share of clock time'];
  const rows = S.users.map((u, i) => {
    const e = store.get(key(u));
    const pick = () => { S.focus = i; S.sel = null; S.pool = null; if (lastGood) lastGood.focus = i; writeUrl(); render(); scrollTo({ top: 0, behavior: 'auto' }); };
    const first = el('td', null, el('button', { type: 'button', class: 'link-btn', text: u, onclick: (ev) => { ev.stopPropagation(); pick(); } }));
    if (!e || e.state === 'loading') return el('tr', null, first, el('td', { colspan: head.length - 1, class: 'empty', text: 'Loading…' }));
    if (e.state === 'error') return el('tr', null, first, el('td', { colspan: head.length - 1, class: 'down', text: e.error }));
    const st = e.stats, t = st.totals, L = st.sessions.longest != null ? st.sessions.list[st.sessions.longest] : null;
    return el('tr', { 'data-click': '1', 'aria-selected': String(i === S.focus), onclick: pick }, first,
      el('td', { class: 'num', text: dur(t.time) }), el('td', { class: 'num', text: num(t.games) }),
      el('td', { class: 'num', text: `${t.activeDays} of ${st.range.days}` }), el('td', { class: 'num', text: dur(t.avgPerActiveDay) }),
      el('td', { class: 'num', text: dur(t.avgGame) }), el('td', { class: 'num', text: pct(rate(t)) }),
      el('td', { class: `num ${st.elo.net > 0 ? 'up' : st.elo.net < 0 ? 'down' : ''}`, text: st.elo.ratedGames ? `${signed(st.elo.net)} (+${num(st.elo.gained)} ${MINUS}${num(st.elo.lost)})` : '–' }),
      el('td', { class: 'num', text: L ? dur(L.duration) : '–' }),
      el('td', { class: 'num', text: t.myThink + t.oppThink ? pct(t.myThink / (t.myThink + t.oppThink)) : '–' }));
  });
  $('compare').replaceChildren(el('thead', null, el('tr', null, ...head.map((h, i) => el('th', { class: i ? 'num' : null, text: h })))), el('tbody', null, ...rows));
}

// ---------- ledger ----------
const COLS = [
  { k: 'date', label: 'Date', get: (d) => d.date, show: (d) => dateStr(d.date, dfLong) },
  { k: 'games', label: 'Games' }, { k: 'time', label: 'Time', show: (d) => (d.games ? dur(d.time) : '–') },
  { k: 'wins', label: 'Won' }, { k: 'draws', label: 'Drawn' }, { k: 'losses', label: 'Lost' },
  { k: 'eloGained', label: 'Rating won', show: (d) => (d.eloGained ? `+${d.eloGained}` : '–'), cls: () => 'up' },
  { k: 'eloLost', label: 'Rating lost', show: (d) => (d.eloLost ? `${MINUS}${d.eloLost}` : '–'), cls: () => 'down' },
  { k: 'eloNet', label: 'Net', show: (d) => (d.eloGained || d.eloLost ? signed(d.eloNet) : '–'), cls: (d) => (d.eloNet > 0 ? 'up' : d.eloNet < 0 ? 'down' : '') },
  { k: 'bestWinStreak', label: 'Winning streak' }, { k: 'bestLossStreak', label: 'Losing streak' },
  { k: 'avg', label: 'Average game', get: (d) => (d.liveN ? d.time / d.liveN : 0), show: (d) => (d.liveN ? dur(d.time / d.liveN) : '–') },
];
function ledgerRows(e) {
  return e.stats.days.map((d) => ({ ...d, liveN: d.gameIdx.reduce((n, i) => n + (e.view[i].live === false ? 0 : 1), 0) }));
}
function renderLedger(e) {
  const st = e.stats, t = st.totals;
  let rows = ledgerRows(e);
  if (S.hideEmpty) rows = rows.filter((d) => d.games);
  const col = COLS.find((c) => c.k === S.sort.k) || COLS[0], get = col.get || ((d) => d[col.k]);
  rows.sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : a.date < b.date ? -1 : 1) * S.sort.dir; });
  const head = el('tr', null, ...COLS.map((c) => el('th', { class: c.k === 'date' ? null : 'num', 'aria-sort': S.sort.k === c.k ? (S.sort.dir > 0 ? 'ascending' : 'descending') : null },
    el('button', { type: 'button', text: c.label, onclick: () => { S.sort = { k: c.k, dir: S.sort.k === c.k ? -S.sort.dir : c.k === 'date' ? 1 : -1 }; renderLedger(e); } }))));
  const body = rows.map((d) => el('tr', { 'data-click': '1', 'aria-selected': String(S.sel?.mode === 'day' && S.sel.key === d.date), onclick: () => select('day', d.date, true) },
    ...COLS.map((c) => el('td', { class: c.k === 'date' ? null : `num ${c.cls && (c.show ? c.show(d) !== '–' : true) ? c.cls(d) : ''}`, text: c.show ? c.show(d) : (d.games ? d[c.k] : '–') }))));
  const foot = el('tr', null, el('td', { text: `${plural(t.activeDays, 'day')} played` }), el('td', { class: 'num', text: num(t.games) }), el('td', { class: 'num', text: dur(t.time) }),
    el('td', { class: 'num', text: num(t.wins) }), el('td', { class: 'num', text: num(t.draws) }), el('td', { class: 'num', text: num(t.losses) }),
    el('td', { class: 'num up', text: `+${num(st.elo.gained)}` }), el('td', { class: 'num down', text: `${MINUS}${num(st.elo.lost)}` }),
    el('td', { class: `num ${st.elo.net > 0 ? 'up' : st.elo.net < 0 ? 'down' : ''}`, text: signed(st.elo.net) }),
    el('td', { class: 'num', text: String(st.streaks.longestWin?.length || 0) }), el('td', { class: 'num', text: String(st.streaks.longestLoss?.length || 0) }),
    el('td', { class: 'num', text: dur(t.avgGame) }));
  $('ledger').replaceChildren(el('thead', null, head), el('tbody', null, ...(body.length ? body : [el('tr', null, el('td', { colspan: COLS.length, class: 'empty', text: 'No days to show.' }))])), el('tfoot', null, foot));
}
function downloadCsv() {
  const e = focusEntry();
  if (!e?.stats) return;
  const head = ['date', 'weekday', 'games', 'seconds_played', 'time_played', 'won', 'drawn', 'lost', 'rating_won', 'rating_lost', 'rating_net', 'best_winning_streak', 'worst_losing_streak', 'own_clock_seconds', 'opponent_clock_seconds', 'sessions'];
  const lines = [head.join(',')];
  for (const d of e.stats.days) lines.push([d.date, dowName(d.dow), d.games, Math.round(d.time), `"${dur(d.time)}"`, d.wins, d.draws, d.losses, d.eloGained, d.eloLost, d.eloNet, d.bestWinStreak, d.bestLossStreak, Math.round(d.myThink || 0), Math.round(d.oppThink || 0), d.sessions].join(','));
  const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' })), download: `analyzeyou-${key(S.users[S.focus])}-${e.stats.range.from}-to-${e.stats.range.to}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- events ----------
function submitMain() {
  const u = $('user').value.trim().replace(/^@/, '');
  if (!u) { showMsg('Type a chess.com username first.'); $('user').focus(); return; }
  const rest = S.users.slice(1).filter((x) => key(x) !== key(u));
  S.users = [u, ...rest]; S.focus = 0; S.sel = null; S.pool = null;
  run();
}
$('form').addEventListener('submit', (ev) => { ev.preventDefault(); submitMain(); });
$('presets').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-preset]');
  if (!b) return;
  applyPreset(b.dataset.preset); syncControls();
  if (S.users.length) run(); else writeUrl();
});
for (const id of ['from', 'to']) $(id).addEventListener('change', () => {
  const f = $('from').value, t = $('to').value;
  if (!t || (!f && S.preset !== 'all')) return;
  S.preset = null; S.from = f; S.to = t; syncControls();
  if (f && t && f > t) { showMsg('The start date is after the end date. Swap them or pick a preset.'); return; }
  showMsg('');
  if (S.users.length) run(); else writeUrl();
});
$('addForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const u = $('addUser').value.trim().replace(/^@/, '');
  if (!u) return;
  $('addUser').value = '';
  const at = S.users.findIndex((x) => key(x) === key(u));
  if (at >= 0) { S.focus = at; render(); return; }
  if (S.users.length >= 4) return;
  S.users.push(u);
  run();
});
$('ratedOnly').addEventListener('change', (ev) => { S.rated = ev.target.checked; recompute(); });
$('hideEmpty').addEventListener('change', (ev) => { S.hideEmpty = ev.target.checked; renderLedger(focusEntry()); });
$('csvBtn').addEventListener('click', downloadCsv);
$('cancelBtn').addEventListener('click', () => {
  ctrl?.abort(); runId++;
  restore();
  showMsg('Stopped before the games finished loading.');
});
document.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => { $('user').value = b.dataset.try; submitMain(); }));
$('clearCache').addEventListener('click', async () => {
  await clearCache().catch(() => {});
  $('clearCache').textContent = 'Saved games cleared';
  setTimeout(() => { $('clearCache').textContent = 'Clear saved games'; }, 2500);
});
$('themeBtn').addEventListener('click', () => {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('analyzeyou-theme', document.documentElement.dataset.theme); } catch (e) { /* private mode */ }
  syncTheme();
});
function syncTheme() {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  $('themeBtn').textContent = dark ? 'Light' : 'Dark';
}

let rz = 0, lastW = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === lastW) return;
  lastW = innerWidth;
  clearTimeout(rz);
  rz = setTimeout(() => { const e = focusEntry(); if (e?.state === 'ok' && e.stats.totals.games) { hideTip(); renderDays(e); renderElo(e); renderSessions(e, e.player?.username || ''); renderGames(e, e.player?.username || ''); } }, 150);
});

// ---------- start ----------
readUrl();
syncTheme();
syncControls();
$('ratedOnly').checked = S.rated;
{
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone) $('tzNote').textContent = ` (${zone.replace(/_/g, ' ')})`;
}
if (S.users.length) { $('user').value = S.users[0]; run(); }
