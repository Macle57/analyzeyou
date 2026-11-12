// Hand-written raw chess.com game objects (shape of /pub/player/{u}/games/{YYYY}/{MM}).
// The analysed player is "TestUser" in all of them.

const ME = { username: 'TestUser', '@id': 'https://api.chess.com/pub/player/testuser', uuid: 'me' };
const STD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function pgn(headers, moves) {
  return `${Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`).join('\n')}\n\n${moves}\n`;
}
const t = (iso) => Math.floor(Date.parse(iso) / 1000);

/** 180+2 blitz, TestUser white, black resigns on move (black to move after 5 plies). Lasts 45 s. */
export const incrementResign = {
  url: 'https://www.chess.com/game/live/1001',
  uuid: 'g-incr',
  time_control: '180+2',
  end_time: t('2026-10-02T12:00:45Z'),
  rated: true,
  accuracies: { white: 91.5, black: 70.25 },
  initial_setup: STD,
  time_class: 'blitz',
  rules: 'chess',
  white: { ...ME, rating: 1510, result: 'win' },
  black: { username: 'Opp1', rating: 1490, result: 'resigned' },
  eco: 'https://www.chess.com/openings/Ruy-Lopez-Opening-Morphy-Defense-3...a6-4.Ba4',
  pgn: pgn(
    {
      Event: 'Live Chess', Site: 'Chess.com', Date: '2026.10.02', White: 'TestUser', Black: 'Opp1', Result: '1-0',
      ECO: 'C70', ECOUrl: 'https://www.chess.com/openings/Ruy-Lopez-Opening-Morphy-Defense-3...a6-4.Ba4',
      UTCDate: '2026.10.02', UTCTime: '12:00:00', TimeControl: '180+2', Termination: 'TestUser won by resignation',
      StartTime: '12:00:00', EndDate: '2026.10.02', EndTime: '12:00:45',
    },
    '1. e4 {[%clk 0:03:02]} 1... e5 {[%clk 0:03:01]} 2. Nf3 {[%clk 0:02:57]} 2... Nc6 {[%clk 0:02:55]} 3. Bb5 {[%clk 0:02:50]} 1-0',
  ),
};

/** 60+0 bullet, TestUser black, flags after 5 plies (black to move). Lasts 70 s. */
export const timeoutLoss = {
  url: 'https://www.chess.com/game/live/1002',
  uuid: 'g-flag',
  time_control: '60',
  end_time: t('2026-10-02T12:02:10Z'),
  rated: true,
  initial_setup: STD,
  time_class: 'bullet',
  rules: 'chess',
  white: { username: 'Opp2', rating: 1608, result: 'win' },
  black: { ...ME, rating: 1392, result: 'timeout' },
  pgn: pgn(
    {
      Event: 'Live Chess', ECO: 'B01', ECOUrl: 'https://www.chess.com/openings/Scandinavian-Defense',
      UTCDate: '2026.10.02', UTCTime: '12:01:00', TimeControl: '60', Termination: 'Opp2 won on time',
      StartTime: '12:01:00', EndDate: '2026.10.02', EndTime: '12:02:10',
    },
    '1. e4 {[%clk 0:01:00]} 1... d5 {[%clk 0:00:50]} 2. exd5 {[%clk 0:00:55]} 2... Qxd5 {[%clk 0:00:05]} 3. Nc3 {[%clk 0:00:52]} 1-0',
  ),
};

/** 600+0 rapid, TestUser white mates in 7 plies. Lasts 100 s; nobody gets the remainder. */
export const checkmateWin = {
  url: 'https://www.chess.com/game/live/1003',
  uuid: 'g-mate',
  time_control: '600',
  end_time: t('2026-10-02T13:01:40Z'),
  rated: false,
  initial_setup: STD,
  time_class: 'rapid',
  rules: 'chess',
  white: { ...ME, rating: 1200, result: 'win' },
  black: { username: 'Opp3', rating: 1100, result: 'checkmated' },
  pgn: pgn(
    {
      ECO: 'C20', ECOUrl: "https://www.chess.com/openings/Kings-Pawn-Opening-Wayward-Queen-Attack-2...Nc6-3.Bc4",
      UTCDate: '2026.10.02', UTCTime: '13:00:00', TimeControl: '600', Termination: 'TestUser won by checkmate',
      StartTime: '13:00:00', EndDate: '2026.10.02', EndTime: '13:01:40',
    },
    '1. e4 {[%clk 0:10:00]} 1... e5 {[%clk 0:09:58]} 2. Qh5 {[%clk 0:09:50]} 2... Nc6 {[%clk 0:09:40]} 3. Bc4 {[%clk 0:09:30]} 3... Nf6 {[%clk 0:09:20]} 4. Qxf7# {[%clk 0:09:25]} 1-0',
  ),
};

/** Live rapid game whose PGN has no clocks (e.g. old games). Draw by agreement. */
export const noClocks = {
  url: 'https://www.chess.com/game/live/1004',
  uuid: 'g-noclk',
  time_control: '600+5',
  end_time: t('2026-10-02T14:05:00Z'),
  rated: true,
  initial_setup: STD,
  time_class: 'rapid',
  rules: 'chess',
  white: { username: 'Opp4', rating: 1300, result: 'agreed' },
  black: { ...ME, rating: 1305, result: 'agreed' },
  pgn: pgn(
    { UTCDate: '2026.10.02', UTCTime: '14:00:00', TimeControl: '600+5', EndDate: '2026.10.02', EndTime: '14:05:00' },
    '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 1/2-1/2',
  ),
};

/** Daily (correspondence) game: excluded from time stats. */
export const daily = {
  url: 'https://www.chess.com/game/daily/1005',
  uuid: 'g-daily',
  time_control: '1/259200',
  end_time: t('2026-10-05T08:00:00Z'),
  start_time: t('2026-09-28T20:00:00Z'),
  rated: true,
  initial_setup: STD,
  time_class: 'daily',
  rules: 'chess',
  white: { ...ME, rating: 1450, result: 'win' },
  black: { username: 'Opp5', rating: 1440, result: 'abandoned' },
  pgn: pgn(
    { UTCDate: '2026.09.28', UTCTime: '20:00:00', TimeControl: '1/259200', EndDate: '2026.10.05', EndTime: '08:00:00' },
    '1. e4 {[%clk 23:10:00]} 1... c5 {[%clk 50:00:00]} 2. Nf3 {[%clk 70:12:00]} 1-0',
  ),
};

/** No UTCDate/UTCTime: start falls back to StartTime, which is on the previous UTC day. */
export const startTimeOnly = {
  url: 'https://www.chess.com/game/live/1006',
  uuid: 'g-starttime',
  time_control: '180',
  end_time: t('2026-10-03T00:02:00Z'),
  rated: true,
  initial_setup: STD,
  time_class: 'blitz',
  rules: 'chess',
  white: { username: 'Opp6', rating: 1500, result: 'win' },
  black: { ...ME, rating: 1500, result: 'resigned' },
  pgn: pgn({ StartTime: '23:58:00', EndDate: '2026.10.03', EndTime: '00:02:00', TimeControl: '180' }, '1. e4 e5 0-1'),
};

/** No PGN at all: start = end, unknown moves and clocks. */
export const noPgn = {
  url: 'https://www.chess.com/game/live/1007',
  uuid: 'g-nopgn',
  time_control: '300',
  end_time: t('2026-10-03T10:00:00Z'),
  rated: true,
  time_class: 'blitz',
  rules: 'chess960',
  white: { ...ME, rating: 1700, result: 'stalemate' },
  black: { username: 'Opp7', rating: 1690, result: 'stalemate' },
};

export const all = [incrementResign, timeoutLoss, checkmateWin, noClocks, daily, startTimeOnly, noPgn];
