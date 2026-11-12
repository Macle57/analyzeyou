// The page's sense of humour: the verdict tiers, the art, the stickers and the one-line remarks.
// Every joke is tied to a real number from the stats, so it is true for the player on screen.

const NS = 'http://www.w3.org/2000/svg';
const H = 3600;

// ---------- art ----------
// All art is drawn here as static SVG (author-written markup, never API data) in the page's own
// colours, through classes defined in style.css, so it follows the theme.
function svg(inner, label, viewBox = '0 0 200 170', cls = 'art') {
  const n = document.createElementNS(NS, 'svg');
  n.setAttribute('viewBox', viewBox);
  n.setAttribute('class', cls);
  if (label) { n.setAttribute('role', 'img'); n.setAttribute('aria-label', label); } else n.setAttribute('aria-hidden', 'true');
  n.innerHTML = inner;
  return n;
}

const eyes = (y, dx = 9) => `<circle class="k" cx="${-dx}" cy="${y}" r="2.9"/><circle class="k" cx="${dx}" cy="${y}" r="2.9"/>`;
const bags = (y) => `<path class="t" d="M-14 ${y + 7} q5 4 10 0 M4 ${y + 7} q5 4 10 0"/>`;
const FACES = {
  smile: (y) => `${eyes(y)}<path class="l" d="M-7 ${y + 10} q7 7 14 0"/>`,
  flat: (y) => `${eyes(y)}<path class="l" d="M-6 ${y + 12} h12"/>`,
  shrug: (y) => `${eyes(y)}<path class="t" d="M-14 ${y - 6} l8 -3 M14 ${y - 6} l-8 -3"/><circle class="l" cx="0" cy="${y + 12}" r="3"/>`,
  tired: (y) => `${eyes(y)}${bags(y)}<path class="t" d="M-14 ${y - 6} h10 M4 ${y - 6} h10"/><path class="l" d="M-6 ${y + 14} h12"/>`,
  wired: (y) => `<circle class="w" cx="-9" cy="${y}" r="6.5"/><circle class="w" cx="9" cy="${y}" r="6.5"/><circle class="k" cx="-8" cy="${y}" r="2"/><circle class="k" cx="10" cy="${y}" r="2"/>`
    + `<path class="t" d="M-16 ${y + 10} q7 4 13 0 M3 ${y + 10} q7 4 13 0"/><path class="l" d="M-7 ${y + 18} q3.5 -3 7 0 t7 0"/>`,
  asleep: (y) => `<path class="l" d="M-14 ${y} q5 5 10 0 M4 ${y} q5 5 10 0"/><ellipse class="l" cx="0" cy="${y + 12}" rx="3" ry="4"/>`,
  gone: (y) => `<circle class="w" cx="-9" cy="${y}" r="7"/><circle class="w" cx="9" cy="${y}" r="7"/><circle class="k" cx="-11" cy="${y - 1}" r="1.7"/><circle class="k" cx="11" cy="${y + 2}" r="1.7"/>`
    + `<path class="t" d="M-17 ${y + 9} q8 4 15 0 M2 ${y + 9} q8 4 15 0 M-15 ${y + 12.5} q6 3 11 0 M4 ${y + 12.5} q6 3 11 0"/><path class="l" d="M-4 ${y + 18} h8"/>`,
};

const BODY = '<rect class="o" x="-36" y="136" width="72" height="14" rx="7"/>'
  + '<path class="o" d="M-26 136 C-24 116 -15 104 -13 92 H13 C15 104 24 116 26 136 Z"/>';
const COLLAR = '<rect class="o" x="-22" y="82" width="44" height="11" rx="5.5"/>';
const HEADS = {
  pawn: { y: 56, d: '<circle class="o" cx="0" cy="57" r="25"/>' },
  rook: { y: 55, d: '<path class="o" d="M-24 84 V28 H-13 V37 H-4.5 V28 H4.5 V37 H13 V28 H24 V84 Z"/>' },
  bishop: { y: 62, d: '<circle class="o" cx="0" cy="15" r="5.5"/><path class="o" d="M0 20 C20 38 25 52 25 62 C25 75 14 84 0 84 C-14 84 -25 75 -25 62 C-25 52 -20 38 0 20 Z"/><path class="l" d="M5 33 l9 12"/>' },
  king: { y: 66, d: '<circle class="o" cx="0" cy="60" r="24"/><path class="o" d="M-3 6 h6 v6 h6 v6 h-6 v10 h-6 v-10 h-6 v-6 h6 Z"/><path class="o f-l" d="M-23 50 L-26 30 L-12 39 L0 27 L12 39 L26 30 L23 50 Z"/>' },
  queen: { y: 61, d: '<circle class="o" cx="0" cy="60" r="24"/><path class="o f-l" d="M-24 50 L-30 26 L-15 38 L-8 21 L0 36 L8 21 L15 38 L30 26 L24 50 Z"/>'
    + '<circle class="o f-l" cx="-30" cy="24" r="3.6"/><circle class="o f-l" cx="-8" cy="18" r="3.6"/><circle class="o f-l" cx="8" cy="18" r="3.6"/><circle class="o f-l" cx="30" cy="24" r="3.6"/>' },
};
function piece(kind, face, { x = 100, y = 0, rot = 0, extra = '', noBody = false } = {}) {
  const h = HEADS[kind];
  return `<g transform="translate(${x} ${y}) rotate(${rot} 0 90)">${noBody ? '' : BODY}${h.d}${noBody ? '' : COLLAR}${FACES[face](h.y)}${extra}</g>`;
}
// The knight has its own silhouette and a single eye, so it is drawn by hand.
function knight(x, extra = '') {
  return `<g transform="translate(${x} 0)">${BODY}`
    + '<path class="o" d="M-20 84 C-27 62 -21 40 -7 30 L-10 13 L6 24 C24 28 37 44 39 60 C40 68 34 72 27 70 L12 64 C9 71 14 78 20 84 Z"/>'
    + '<path class="t" d="M-22 62 l-8 -3 M-23 50 l-8 -5 M-18 38 l-7 -7"/>'
    + `${COLLAR}<circle class="k" cx="12" cy="45" r="3"/><path class="t" d="M6 40 h13"/><circle class="k" cx="32" cy="60" r="1.6"/><path class="l" d="M19 66 q5 1 8 -2"/>${extra}</g>`;
}
const shadow = (cx, rx) => `<ellipse class="sh" cx="${cx}" cy="152" rx="${rx}" ry="5"/>`;

const ART = {
  // 0: a pawn on holiday
  tourist: () => svg(
    shadow(104, 76)
    + piece('pawn', 'smile', { x: 82, extra: '<ellipse class="o f-m" cx="0" cy="37" rx="33" ry="6.5"/><path class="o f-m" d="M-17 36 C-17 14 17 14 17 36 Z"/><path class="band" d="M-16.5 31 H16.5"/>' })
    + '<g transform="translate(148 0)"><path class="l" d="M-9 106 v-7 q0 -5 5 -5 h8 q5 0 5 5 v7"/><rect class="o f-b" x="-24" y="106" width="48" height="44" rx="7"/><path class="t" d="M-10 106 v44 M10 106 v44"/><circle class="o f-l" cx="0" cy="128" r="7"/></g>',
    'A pawn in a sun hat with a suitcase'),
  // 1: a pawn with a coffee
  coffee: () => svg(
    shadow(104, 72)
    + piece('pawn', 'smile', { x: 80 })
    + '<g transform="translate(144 0)"><path class="t steam" d="M-6 104 q-5 -6 0 -12 q5 -6 0 -12"/><path class="t steam s2" d="M7 104 q-5 -6 0 -12 q5 -6 0 -12"/>'
    + '<path class="l" d="M17 122 h6 q9 0 9 8 q0 8 -9 8 h-6"/><path class="o f-b" d="M-17 112 H17 V138 Q17 150 5 150 H-5 Q-17 150 -17 138 Z"/></g>',
    'A pawn next to a steaming mug of coffee'),
  // 2: a knight at its usual table
  regular: () => svg(
    shadow(104, 76)
    + knight(72)
    + '<g transform="translate(152 0)"><path class="o f-m" d="M-32 150 L-27 118 H27 L32 150 Z"/><text class="tx" x="0" y="139" text-anchor="middle">Reserved</text></g>',
    'A knight beside a table card that says reserved'),
  // 3: a bishop with a tie and a briefcase
  parttime: () => svg(
    shadow(104, 76)
    + piece('bishop', 'flat', { x: 80, extra: '<path class="o f-r" d="M-5 93 H5 L7 104 L0 126 L-7 104 Z"/>' })
    + '<g transform="translate(148 0)"><path class="l" d="M-9 116 v-6 q0 -5 5 -5 h8 q5 0 5 5 v6"/><rect class="o f-m" x="-26" y="116" width="52" height="34" rx="6"/><path class="t" d="M-26 131 H26"/><rect class="o f-l" x="-5" y="126" width="10" height="10" rx="2"/></g>',
    'A bishop wearing a tie, with a briefcase'),
  // 4: a rook that has not slept, with the empties
  fulltime: () => svg(
    shadow(104, 78)
    + piece('rook', 'wired', { x: 78 })
    + '<g transform="translate(150 0)"><path class="o f-b" d="M-25 128 H-7 L-9 150 H-23 Z"/><path class="o f-b" d="M5 128 H23 L21 150 H7 Z"/><path class="o f-b" d="M-10 105 H8 L6 127 H-8 Z"/>'
    + '<path class="t" d="M-24 133 h16 M6 133 h16 M-9 110 h16"/></g>',
    'A wide-eyed rook with bags under its eyes beside a stack of empty coffee cups'),
  // 5: a king asleep on the chess clock; the left display shows the real daily average
  resident: (lcd = '7:00') => svg(
    '<ellipse class="sh" cx="100" cy="154" rx="86" ry="5"/>'
    + piece('king', 'asleep', { x: 92, y: 22, rot: -14, noBody: true })
    + '<rect class="case" x="18" y="106" width="164" height="46" rx="11"/><rect class="lcdp" x="30" y="117" width="62" height="24" rx="4"/><rect class="lcdp" x="108" y="117" width="62" height="24" rx="4"/>'
    + `<text class="seg" x="87" y="136" text-anchor="end">${lcd}</text><text class="seg" x="165" y="136" text-anchor="end">0:00</text>`
    + '<g class="zz"><text class="tx z1" x="134" y="62">z</text><text class="tx z2" x="150" y="44">z</text><text class="tx z3" x="170" y="24">z</text></g>',
    'A king fast asleep with its head on a chess clock'),
  // 6: a queen who has been here long enough to gather cobwebs and unopened post
  fossil: () => svg(
    shadow(104, 80)
    + '<path class="t" d="M196 4 L138 10 M196 4 L158 44 M196 4 L192 62 M176 6 q-4 12 2 18 q8 4 16 2 M158 8 q-6 22 10 32 q12 8 24 6"/>'
    + '<path class="t" d="M172 30 V70"/><circle class="k" cx="172" cy="75" r="5"/><path class="t" d="M167 73 l-7 -4 M167 77 l-7 3 M177 73 l7 -4 M177 77 l7 3"/>'
    + piece('queen', 'gone', { x: 96, extra: '<path class="t" d="M30 26 L44 60 L22 84 M36 42 q-6 6 -11 3 M40 56 q-8 8 -14 6"/>' })
    + '<g transform="translate(34 0)"><rect class="o f-m" x="-22" y="136" width="44" height="14" rx="2"/><path class="t" d="M-22 136 l22 9 l22 -9"/><rect class="o f-m" x="-19" y="123" width="44" height="14" rx="2" transform="rotate(-7 0 130)"/><path class="t" d="M-19 123 l22 9 l22 -9" transform="rotate(-7 0 130)"/></g>',
    'A wide-eyed queen covered in cobwebs, with a spider and a pile of unopened post'),
  // nothing played
  empty: () => svg(
    shadow(96, 74)
    + piece('pawn', 'shrug', { x: 70 })
    + '<g class="weed"><circle class="l" cx="150" cy="130" r="19"/><path class="t" d="M136 122 q14 -12 28 4 q-4 18 -22 14 q-10 -8 0 -18 q10 -4 14 6 M134 136 q10 8 24 6"/></g><path class="t" d="M106 142 h12 M110 149 h10"/>',
    'A shrugging pawn watching a tumbleweed roll past'),
};

// The narrator: a small pawn face that marks every remark the page makes in its own voice.
export function pawnMark() {
  return svg('<circle class="o" cx="12" cy="12" r="10"/><circle class="k" cx="8.4" cy="11" r="1.5"/><circle class="k" cx="15.6" cy="11" r="1.5"/><path class="t" d="M8.5 15.5 q3.5 3 7 0"/>', null, '0 0 24 24', 'art mini');
}

// ---------- the verdict ----------
// Measured on the average time per day that had at least one game. `min` is the lower bound in seconds.
export const TIERS = [
  { key: 'tourist', min: 0, sample: 9 * 60, label: 'Just visiting',
    line: '{t} on the days there is any chess at all. This is what a healthy relationship with the game looks like, and frankly it is a little suspicious.' },
  { key: 'coffee', min: 15 * 60, sample: 35 * 60, label: 'A coffee break’s worth',
    line: '{t} a day. Long enough to hang a queen, short enough to still have other interests.' },
  { key: 'regular', min: 1 * H, sample: 1.4 * H, label: 'A regular',
    line: '{t} a day. The site keeps the usual table free. This is the stage where it still gets called a hobby with a straight face.' },
  { key: 'parttime', min: 2 * H, sample: 2.8 * H, label: 'A part-time job',
    line: '{t} a day. That is a part-time job that pays in rating points, and the exchange rate is terrible.' },
  { key: 'fulltime', min: 4 * H, sample: 5.2 * H, label: 'Full-time, no benefits',
    line: '{t} a day. Past four hours it stops being a pastime and becomes a shift. Nobody is paying the overtime.' },
  { key: 'resident', min: 7 * H, sample: 8.1 * H, label: 'The board is home now',
    line: '{t} a day. That is more than most people sleep on a work night. The pieces have started saving a seat.' },
  { key: 'fossil', min: 10 * H, sample: 11.5 * H, label: 'Legally a resident of chess.com',
    line: '{t} a day. There are airline pilots with shorter days and stricter rest rules. The sun has started asking after {who}.' },
];
export function tierIndex(seconds) {
  let i = 0;
  TIERS.forEach((t, k) => { if (seconds >= t.min) i = k; });
  return i;
}
// `?mood=` accepts a tier number (0 to 6) or its key.
export function parseMood(v) {
  if (v == null || v === '') return null;
  const byKey = TIERS.findIndex((t) => t.key === String(v).toLowerCase());
  if (byKey >= 0) return byKey;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < TIERS.length ? n : null;
}
const lcdTime = (s) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

export function verdict(st, who, f, forced) {
  const t = st.totals, r = st.range;
  if (!t.games || !t.liveGames) {
    return {
      key: 'empty', art: ART.empty(),
      label: t.games ? 'Slow chess' : 'A clean record',
      line: t.games
        ? `${f.plural(t.games, 'daily game')} and no clock running on any of them. Chess by post. The patience is noted.`
        : `Not one game in ${f.plural(r.days, 'day')}. Either the dates are off or somebody went outside.`,
      basis: '',
    };
  }
  const real = t.avgPerActiveDay, natural = tierIndex(real);
  const i = forced ?? natural, tier = TIERS[i];
  const shown = forced != null && forced !== natural ? tier.sample : real;
  const out = {
    key: tier.key, index: i,
    art: tier.key === 'resident' ? ART.resident(lcdTime(shown)) : ART[tier.key](),
    label: tier.label,
    line: tier.line.replace('{t}', f.dur(shown)).replace('{who}', who),
    basis: forced != null && forced !== natural
      ? `Preview of level ${i + 1} of ${TIERS.length}. The real average is ${f.dur(real)} on a day played, which is level ${natural + 1}.`
      : t.liveDays === 1 ? 'Going by the one day with a live game.' : `Averaged over the ${f.num(t.liveDays)} days with a live game, out of ${f.num(r.days)}.`,
  };
  // The single heaviest day gets its own line when it sits in a higher bracket than the average.
  const top = st.records.busiestDay && st.days.find((d) => d.date === st.records.busiestDay);
  if (top && top.time >= 4 * H && tierIndex(top.time) > natural) {
    out.extra = `${f.date(top.date)} alone ran to ${f.dur(top.time)}. ${top.time >= 10 * H ? 'That is a long-haul flight with no meal service.' : top.time >= 7 * H ? 'A full working day, plus the commute.' : 'Somebody skipped dinner.'}`;
  }
  return out;
}

// ---------- one day ----------
// At most one remark per day, heaviest reason first, and no line is said twice in one range: the days
// are walked in date order and each takes the first line of its reason that is still unused. A reason
// that has said everything it has passes the day on to its next matching reason, or to no remark at
// all. No line here repeats a sticker's note. Hours of the day are the viewer's clock, and the lines
// that use them say so. A line that returns null is not true of that day and is skipped.
const dayNumber = (date) => { const [y, m, d] = date.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
const REASONS = [
  { key: 'h10', when: (c) => c.d.time >= 10 * H, lines: [
    (c) => `${c.t} in one day. Days only come with 24 of those.`,
    (c) => `${c.t}. The board saw more of this day than the sun did.`,
    (c) => `${c.t} of chess in a single day. That is most of the waking part.`,
    (c) => `${c.t}. Whatever else was planned for this day did not happen.`,
  ] },
  { key: 'h7', when: (c) => c.d.time >= 7 * H, lines: [
    (c) => `${c.t} of chess. Longer than a working day, with fewer breaks.`,
    (c) => `${c.t}. An office would have sent everyone home by then.`,
    (c) => `${c.t}. This day had a job, and the job was chess.`,
    (c) => `${c.t}. Long enough that at least one meal was eaten at the board.`,
  ] },
  { key: 'h4', when: (c) => c.d.time >= 4 * H, lines: [
    (c) => `${c.t}. That was not a quick game before bed.`,
    (c) => `${c.t}. Somewhere a to-do list went untouched.`,
    (c) => `${c.t} at the board. Lunch was probably eaten with one hand.`,
    (c) => `${c.t}. A film and its sequel would have been shorter.`,
    (c) => `${c.t}. The plan was almost certainly one game.`,
    (c) => `${c.t} of chess. The rest of the day got what was left.`,
  ] },
  { key: 'ls', when: (c) => c.ls >= 8, lines: [
    (c) => `${c.ls} losses in a row, and the queue button still got pressed.`,
    (c) => `${c.ls} straight losses. The stopping point was passed several games ago.`,
    (c) => `${c.ls} losses back to back. Persistence is a virtue, in moderation.`,
    (c) => `${c.ls} in a row the wrong way. Each one was going to be the one that fixed it.`,
  ] },
  { key: 'g64', when: (c) => c.d.games === 64, lines: [
    () => '64 games. One for every square on the board.',
  ] },
  { key: 'g50', when: (c) => c.d.games >= 50, lines: [
    (c) => `${c.g} games in a day. That is one every ${Math.max(1, Math.round((16 * 60) / c.d.games))} minutes of being awake.`,
    (c) => `${c.g} games. The mouse has earned a day off.`,
    (c) => `${c.g} games in one day. Plenty of people take a year over that many.`,
    (c) => `${c.g} games. Each one was going to be the last.`,
    (c) => (c.opps > 1 ? `${c.g} games in a day. The opponents changed; the chair did not.` : null),
    (c) => `${c.g} games. A tournament plays nine rounds and calls it a week.`,
    (c) => `${c.g} in one day. The new-game button held up well.`,
  ] },
  { key: 'ws', when: (c) => c.ws >= 10, lines: [
    (c) => `${c.ws} wins in a row. A fair few mice got blamed.`,
    (c) => `${c.ws} straight wins. The rating graph briefly looked like a wall.`,
    (c) => `${c.ws} wins on the trot. Nobody stops on a day like that, and nobody did.`,
    (c) => `${c.ws} in a row. The opponents would like a word with matchmaking.`,
    (c) => `${c.ws} wins without a miss. Stopping there was an option nobody considered.`,
    (c) => `${c.ws} straight. Days like this are why the queue button gets pressed on the bad ones.`,
    (c) => `${c.ws} wins running. Enjoyable for exactly one of the two people in each game.`,
    (c) => `A run of ${c.ws}. It felt like skill at the time, and some of it was.`,
  ] },
  { key: 'night', when: (c) => c.night >= 3, lines: [
    (c) => `${c.night} of these started between 2 and 5 in the morning, going by your clock.`,
    (c) => `${c.night} games began after 2 a.m. on your clock. If that is the player’s clock too, sleep lost.`,
    (c) => `${c.night} starts between 2 and 5 a.m. your time. Where the opponents live, it may have been lunch.`,
    (c) => `${c.night} games in the small hours, by your clock. The site never closes, which is the problem.`,
    (c) => `${c.night} starts between 2 and 5 a.m. on your clock. Somewhere it was a perfectly reasonable hour.`,
  ] },
  { key: 'down', when: (c) => c.d.eloNet <= -50, lines: [
    (c) => `Down ${c.pts} points by bedtime. Tomorrow has a job to do.`,
    (c) => `${c.pts} points gone in a day. They took a good deal longer to collect.`,
    (c) => `Minus ${c.pts}. The rating will be back. Probably.`,
    (c) => `${c.pts} points handed out to strangers. Generous.`,
    (c) => `Down ${c.pts}. The sensible stopping point was some games earlier.`,
  ] },
  { key: 'up', when: (c) => c.d.eloNet >= 50, lines: [
    (c) => `Up ${c.pts} points in a day. The correct move is to stop. It will not be played.`,
    (c) => `Plus ${c.pts}. Screenshot it before tomorrow happens.`,
    (c) => `${c.pts} points up. Days like this are why the bad ones get forgiven.`,
    (c) => `Plus ${c.pts} in a day. Tomorrow will want some of that back.`,
    (c) => `Up ${c.pts}. For one evening the number was telling the truth.`,
  ] },
  { key: 'one', when: (c) => c.d.games === 1 && c.d.losses === 1, lines: [
    () => 'One game, one loss, and then the laptop was closed. Rare discipline.',
    () => 'Played one, lost one, left. That is either wisdom or a very short temper.',
    () => 'One game, lost, and nothing after it. The rematch button went unpressed.',
    () => 'A single loss and then silence. Most days do not end that cleanly.',
    () => 'Lost the only game of the day and walked away. It can be done.',
  ] },
];
function quipContext(d, games, f) {
  const night = games.filter((g) => { const h = new Date(g.start).getHours(); return h >= 2 && h < 5; }).length;
  const opps = new Set(games.map((g, i) => String(g.opponent ?? `?${i}`).toLowerCase())).size;
  return { d, night, opps, t: f.dur(d.time), ls: d.bestLossStreak, ws: d.bestWinStreak, g: f.num(d.games), pts: f.num(Math.abs(d.eloNet)) };
}
/**
 * The remarks for a whole range: Map of 'YYYY-MM-DD' -> line. `days` are the range's days in date order
 * (stats.days) and `games` the list their gameIdx point into. The same input always gives the same map.
 */
// A theme is one joke however it is worded: "lost one game and left" four times in a range is the same
// remark four times. So no theme speaks more than twice in a range, and the two whose lines are all
// the same thought (the single lost game, the small hours) speak once unless the range is a long one.
// A day that would repeat a theme goes to its next reason or stays quiet. The hour marks (4, 7 and
// 10 hours) are exempt: they are what the remarks are for, and each of their lines is its own thought.
const HOUR_THEMES = new Set(['h10', 'h7', 'h4']);
const ONE_NOTE = new Set(['one', 'night']);
export function planQuips(days, games, f) {
  const used = new Set(), out = new Map(), said = new Map();
  const long = days.length > 60;
  const capOf = (key) => (long || !ONE_NOTE.has(key) ? 2 : 1);
  for (const d of days) {
    if (!d.games) continue;
    const c = quipContext(d, d.gameIdx.map((i) => games[i]), f);
    for (const r of REASONS) {
      if (!r.when(c)) continue;
      if (!HOUR_THEMES.has(r.key) && (said.get(r.key) || 0) >= capOf(r.key)) continue;
      const n = r.lines.length, start = dayNumber(d.date) % n;
      let hit = -1, line = null;
      for (let k = 0; k < n && hit < 0; k++) {
        const i = (start + k) % n;
        if (used.has(`${r.key}:${i}`)) continue;
        line = r.lines[i](c);
        if (line) hit = i;
      }
      if (hit < 0) continue; // this reason has said all it has: the day goes to its next reason
      used.add(`${r.key}:${hit}`);
      said.set(r.key, (said.get(r.key) || 0) + 1);
      out.set(d.date, line);
      break;
    }
  }
  return out;
}
/** One day on its own (no range to avoid repeats in). `games` are that day's games. */
export function dayQuip(d, games, f) {
  if (!d.games) return null;
  const c = quipContext(d, games, f);
  for (const r of REASONS) {
    if (!r.when(c)) continue;
    const n = r.lines.length, start = dayNumber(d.date) % n;
    for (let k = 0; k < n; k++) { const line = r.lines[(start + k) % n](c); if (line) return line; }
  }
  return null;
}

// ---------- stickers on the clock ----------
// Small achievements, each with the number that earned it. They only appear when they are true.
const FAMOUS = {
  hikaru: ['Takes, takes, takes', 'This one is a professional. The hours are, technically, work.'],
  magnuscarlsen: ['World number one', 'The best player alive still has to press the clock like everyone else.'],
  gothamchess: ['And he sacrifices', 'Somewhere in these games a rook was given away on purpose.'],
  erik: ['The landlord', 'Runs the site. Still has to wait for the opponent to move.'],
};
export function stickers(st, games, who, f) {
  const out = [], t = st.totals, add = (label, note) => out.push({ label, note });
  if (!t.games) return out;
  const fam = FAMOUS[who.toLowerCase()];
  if (fam) add(fam[0], fam[1]);
  if (t.activeDays === st.range.days && st.range.days >= 7) add('No days off', `Played on all ${f.num(st.range.days)} days of the range. The streak is safe. Other things may not be.`);
  let night = 0;
  for (const row of st.heatmap) for (const h of [2, 3, 4]) night += row[h].games;
  // Hours are the viewer's clock, not necessarily the player's: the note says so instead of guessing.
  if (night >= Math.max(5, t.games * 0.03)) add('Night shift', `${f.num(night)} games started between 2 and 5 in the morning, going by your clock. If this is your own account, nothing good was ever decided at that hour. If not, it may have been their lunchtime.`);
  const L = st.sessions.longest != null ? st.sessions.list[st.sessions.longest] : null;
  if (L && L.duration >= 3 * H) add('Marathon', `${f.dur(L.duration)} in one sitting, ${f.num(L.games)} games. Somebody’s legs went numb.`);
  const tl = st.tilt;
  if (tl.requeueAfterLoss != null && tl.requeueAfterLoss >= 0.9 && tl.liveLosses >= 20) add('One more game', `After ${f.pct(tl.requeueAfterLoss)} of losses the next game started within five minutes. “One more” is doing a lot of work.`);
  const ll = st.streaks.longestLoss?.length || 0, lw = st.streaks.longestWin?.length || 0;
  if (ll >= 10) add('Free fall', `${ll} losses in a row. Game ${ll + 1} was a choice.`);
  // The people are distinct opponents: a streak can beat the same player more than once.
  const lwo = st.streaks.longestWin?.opponents || lw;
  if (lw >= 10) add('On a heater', `${lw} wins in a row. ${lwo === 1 ? `1 person closed the tab annoyed, ${lw} times.` : `${lwo} people closed the tab annoyed.`}`);
  const c = st.clock;
  if (c.timeoutWins >= 5 && t.wins >= 20 && c.timeoutWins / t.wins >= 0.2) add('Flag merchant', `${f.num(c.timeoutWins)} wins came on the clock, ${f.pct(c.timeoutWins / t.wins)} of them all. A win is a win, says the flag.`);
  if (c.timeoutLosses >= 5 && t.losses >= 20 && c.timeoutLosses / t.losses >= 0.25) add('Time trouble', `${f.num(c.timeoutLosses)} losses on time. The position was fine. The clock disagreed.`);
  const up = st.records.biggestUpset != null ? games[st.records.biggestUpset] : null;
  if (up && t.games >= 5 && up.oppRating - up.myRating >= 200) add('Giant killer', `Beat ${up.opponent}, rated ${up.oppRating - up.myRating} points higher. Frame that one.`);
  const rival = st.opponents[0];
  if (rival && rival.games >= 10) add('Rematch', `${f.num(rival.games)} games against ${rival.username} alone. At this point, just exchange numbers.`);
  const bullet = st.byClass.find((x) => x.timeClass === 'bullet');
  if (bullet && t.games >= 30 && bullet.games / t.games >= 0.7) add('Bullet brain', `${f.pct(bullet.games / t.games)} of the games were bullet. Thinking is for people with time.`);
  const wk = st.byDow.slice(5).reduce((a, d) => a + d.time, 0);
  // A habit needs a few days and a few games behind it: one Saturday game is not a pattern.
  if (st.range.days >= 14 && t.liveDays >= 4 && t.liveGames >= 20 && wk / t.time >= 0.6) add('Weekend warrior', `${f.pct(wk / t.time)} of the time was played on Saturdays and Sundays. Weekdays are for recovering.`);
  if (t.games >= 64 && t.games % 64 === 0) add('Full board', `${f.num(t.games)} games: exactly ${t.games / 64} for every square on the board.`);
  return out.slice(0, 6);
}

// ---------- the same time, said another way (cycled by pressing a clock face) ----------
export function equivalents(seconds) {
  // Said the way a person would: "about half a night's sleep", "about one working week", then a count.
  // Never "0.5 full nights" or "1.0 films".
  const say = (per, half, one, many) => {
    const v = seconds / per;
    if (v < 0.75) return `about ${half}`;
    if (v < 1.25) return `about ${one}`;
    return many(v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ''));
  };
  const out = [];
  if (seconds >= 1 * H) out.push(`that is ${say(2 * H, 'half a feature film', 'one feature film', (n) => `${n} feature films, back to back`)}`);
  if (seconds >= 4 * H) out.push(`or ${say(8 * H, 'half a night’s sleep', 'one full night’s sleep', (n) => `${n} full nights of sleep`)}`);
  if (seconds >= 16 * H) out.push(`or ${say(33 * H, 'half a read-through of War and Peace', 'one read-through of War and Peace', (n) => `${n} read-throughs of War and Peace`)}`);
  if (seconds >= 20 * H) out.push(`or ${say(40 * H, 'half a working week', 'one working week', (n) => `${n} working weeks`)}`);
  return out;
}

// ---------- the seven verdicts, for the landing page ----------
/** Every tier with its art and lower bound in seconds, lightest first. */
export function lineup() {
  return TIERS.map((t) => ({ key: t.key, label: t.label, from: t.min, art: t.key === 'resident' ? ART.resident('7:00') : ART[t.key]() }));
}
