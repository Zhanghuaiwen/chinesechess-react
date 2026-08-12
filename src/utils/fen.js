import { initBoard } from './gameLogic.js';

const PIECE_CHAR = {
  red:   { rook: 'R', knight: 'N', bishop: 'B', advisor: 'A', king: 'K', cannon: 'C', pawn: 'P' },
  black: { rook: 'r', knight: 'n', bishop: 'b', advisor: 'a', king: 'k', cannon: 'c', pawn: 'p' },
};

const CHAR_PIECE = {};
for (const [color, map] of Object.entries(PIECE_CHAR)) {
  for (const [type, ch] of Object.entries(map)) CHAR_PIECE[ch] = { type, color };
}

/**
 * 应用棋盘(board[row][col], row0=黑方底线, row9=红方底线) -> UCI FEN。
 * 引擎 FEN 第 1 行是 rank9(黑方底线), 与应用 row0 对应, 行序一致。
 */
export function boardToFEN(board, sideToMove = 'red') {
  const rows = board.map((row) => {
    let out = '';
    let empty = 0;
    for (const cell of row) {
      if (!cell) {
        empty++;
        continue;
      }
      if (empty > 0) {
        out += empty;
        empty = 0;
      }
      out += PIECE_CHAR[cell.color][cell.type];
    }
    if (empty > 0) out += empty;
    return out;
  });
  return `${rows.join('/')} ${sideToMove === 'black' ? 'b' : 'w'} - - 0 1`;
}

/** UCI FEN -> 应用棋盘。返回 { board, sideToMove }。 */
export function fenToBoard(fen) {
  const [layout, side = 'w'] = fen.trim().split(/\s+/);
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const ranks = layout.split('/');
  if (ranks.length !== 10) throw new Error(`FEN 行数不对: ${ranks.length}`);
  ranks.forEach((rowStr, r) => {
    let c = 0;
    for (const ch of rowStr) {
      if (/[1-9]/.test(ch)) {
        c += Number(ch);
        continue;
      }
      const piece = CHAR_PIECE[ch];
      if (!piece) throw new Error(`FEN 非法棋子字符: ${ch}`);
      board[r][c] = { type: piece.type, color: piece.color, label: '' };
      c++;
    }
    if (c !== 9) throw new Error(`FEN 第${r + 1}行格子数不对: ${c}`);
  });
  return { board, sideToMove: side === 'b' ? 'black' : 'red' };
}

/** 应用走法 {from,to} -> UCI "a0a1" 形式。rank = 9 - row, file = col(a-i)。 */
export function moveToUCI({ from, to }) {
  const sq = ({ r, c }) => String.fromCharCode(97 + c) + String(9 - r);
  return sq(from) + sq(to);
}

/** UCI "a0a1" -> 应用走法。 */
export function uciToMove(uci) {
  const sq = (s) => ({ r: 9 - Number(s[1]), c: s.charCodeAt(0) - 97 });
  return { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)) };
}

export function movesToUCI(moves) {
  return moves.map(moveToUCI).join(' ');
}

/** 初始局面 FEN（红先行）。 */
export function startFEN() {
  return boardToFEN(initBoard(), 'red');
}
