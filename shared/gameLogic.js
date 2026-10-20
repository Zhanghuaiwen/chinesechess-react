const ROWS = 10;
const COLS = 9;

export function makePiece(type, color, label) {
  return { type, color, label };
}

function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

export function initBoard() {
  const board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null),
  );

  board[0][0] = makePiece("rook", "black", "车");
  board[0][1] = makePiece("knight", "black", "马");
  board[0][2] = makePiece("bishop", "black", "象");
  board[0][3] = makePiece("advisor", "black", "士");
  board[0][4] = makePiece("king", "black", "将");
  board[0][5] = makePiece("advisor", "black", "士");
  board[0][6] = makePiece("bishop", "black", "象");
  board[0][7] = makePiece("knight", "black", "马");
  board[0][8] = makePiece("rook", "black", "车");
  board[2][1] = makePiece("cannon", "black", "炮");
  board[2][7] = makePiece("cannon", "black", "炮");
  board[3][0] = makePiece("pawn", "black", "卒");
  board[3][2] = makePiece("pawn", "black", "卒");
  board[3][4] = makePiece("pawn", "black", "卒");
  board[3][6] = makePiece("pawn", "black", "卒");
  board[3][8] = makePiece("pawn", "black", "卒");

  board[9][0] = makePiece("rook", "red", "车");
  board[9][1] = makePiece("knight", "red", "马");
  board[9][2] = makePiece("bishop", "red", "相");
  board[9][3] = makePiece("advisor", "red", "仕");
  board[9][4] = makePiece("king", "red", "帅");
  board[9][5] = makePiece("advisor", "red", "仕");
  board[9][6] = makePiece("bishop", "red", "相");
  board[9][7] = makePiece("knight", "red", "马");
  board[9][8] = makePiece("rook", "red", "车");
  board[7][1] = makePiece("cannon", "red", "炮");
  board[7][7] = makePiece("cannon", "red", "炮");
  board[6][0] = makePiece("pawn", "red", "兵");
  board[6][2] = makePiece("pawn", "red", "兵");
  board[6][4] = makePiece("pawn", "red", "兵");
  board[6][6] = makePiece("pawn", "red", "兵");
  board[6][8] = makePiece("pawn", "red", "兵");

  return board;
}

export function cloneBoard(board) {
  return board.map(row => row.map(cell => cell ? { ...cell } : null));
}

export function getLegalMoves(board, r, c) {
  const p = board[r][c];
  if (!p) return [];
  const moves = [];

  const add = (rr, cc) => {
    if (!inBounds(rr, cc)) return;
    const q = board[rr][cc];
    if (!q || q.color !== p.color) moves.push({ r: rr, c: cc });
  };

  if (p.type === "rook") {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        if (!board[rr][cc]) {
          moves.push({ r: rr, c: cc });
          rr += dr; cc += dc;
        } else {
          if (board[rr][cc].color !== p.color) moves.push({ r: rr, c: cc });
          break;
        }
      }
    }
  }

  else if (p.type === "knight") {
    const legs = [[[1,0],[2,1]],[[1,0],[2,-1]],[[-1,0],[-2,1]],[[-1,0],[-2,-1]],[[0,1],[1,2]],[[0,1],[-1,2]],[[0,-1],[1,-2]],[[0,-1],[-1,-2]]];
    for (const [[lr, lc], [mr, mc]] of legs) {
      const legR = r + lr, legC = c + lc;
      const tarR = r + mr, tarC = c + mc;
      if (inBounds(legR, legC) && !board[legR][legC]) add(tarR, tarC);
    }
  }

  else if (p.type === "bishop") {
    const dirs = [[2,2],[2,-2],[-2,2],[-2,-2]];
    for (const [dr, dc] of dirs) {
      const mr = r + dr / 2, mc = c + dc / 2;
      const rr = r + dr, cc = c + dc;
      if (inBounds(mr, mc) && !board[mr][mc]) {
        if (p.color === "black" && rr <= 4) add(rr, cc);
        else if (p.color === "red" && rr >= 5) add(rr, cc);
      }
    }
  }

  else if (p.type === "advisor") {
    const opts = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dr, dc] of opts) {
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc)) {
        if (p.color === "black" && rr >= 0 && rr <= 2 && cc >= 3 && cc <= 5) add(rr, cc);
        if (p.color === "red" && rr >= 7 && rr <= 9 && cc >= 3 && cc <= 5) add(rr, cc);
      }
    }
  }

  else if (p.type === "king") {
    const steps = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr, dc] of steps) {
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc)) {
        if (p.color === "black" && rr >= 0 && rr <= 2 && cc >= 3 && cc <= 5) add(rr, cc);
        if (p.color === "red" && rr >= 7 && rr <= 9 && cc >= 3 && cc <= 5) add(rr, cc);
      }
    }
    for (let rr = r - 1; rr >= 0; rr--) {
      if (board[rr][c]) {
        if (board[rr][c].type === "king" && board[rr][c].color !== p.color) moves.push({ r: rr, c });
        break;
      }
    }
    for (let rr = r + 1; rr < ROWS; rr++) {
      if (board[rr][c]) {
        if (board[rr][c].type === "king" && board[rr][c].color !== p.color) moves.push({ r: rr, c });
        break;
      }
    }
  }

  else if (p.type === "cannon") {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc) && !board[rr][cc]) {
        moves.push({ r: rr, c: cc });
        rr += dr; cc += dc;
      }
      const blockR = rr, blockC = cc;
      if (inBounds(blockR, blockC)) {
        let rr2 = blockR + dr, cc2 = blockC + dc;
        while (inBounds(rr2, cc2)) {
          if (board[rr2][cc2]) {
            if (board[rr2][cc2].color !== p.color) moves.push({ r: rr2, c: cc2 });
            break;
          }
          rr2 += dr; cc2 += dc;
        }
      }
    }
  }

  else if (p.type === "pawn") {
    const forward = p.color === "black" ? 1 : -1;
    const fr = r + forward, fc = c;
    if (inBounds(fr, fc)) add(fr, fc);
    if ((p.color === "black" && r >= 5) || (p.color === "red" && r <= 4)) {
      add(r, c - 1);
      add(r, c + 1);
    }
  }

  return moves;
}

export function getAllLegalMoves(board, color) {
  const all = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p && p.color === color) {
        const moves = getLegalMoves(board, r, c);
        for (const m of moves) {
          all.push({ from: { r, c }, to: m });
        }
      }
    }
  }
  return all;
}

export function makeMove(board, from, to) {
  const newBoard = cloneBoard(board);
  const captured = newBoard[to.r][to.c];
  newBoard[to.r][to.c] = newBoard[from.r][from.c];
  newBoard[from.r][from.c] = null;
  return { board: newBoard, captured };
}

const PIECE_VALUES = {
  king: 100000,
  rook: 900,
  cannon: 450,
  knight: 400,
  bishop: 200,
  advisor: 200,
  pawn: 100,
};

export function evaluateBoard(board) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p) continue;
      let value = PIECE_VALUES[p.type];
      if (p.type === "pawn") {
        if (p.color === "red" && r <= 4) value = 200;
        if (p.color === "black" && r >= 5) value = 200;
      }
      score += p.color === "red" ? value : -value;
    }
  }
  return score;
}

export function findKing(board, color) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p && p.type === "king" && p.color === color) return { r, c };
    }
  }
  return null;
}

export function isInCheck(board, color) {
  const king = findKing(board, color);
  if (!king) return false;
  const opp = color === "red" ? "black" : "red";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p || p.color !== opp) continue;
      const moves = getLegalMoves(board, r, c);
      for (const m of moves) {
        if (m.r === king.r && m.c === king.c) return true;
      }
    }
  }
  return false;
}

function isMoveSafe(board, from, to, color) {
  const { board: nb } = makeMove(board, from, to);
  return !isInCheck(nb, color);
}

export function getSafeMoves(board, r, c) {
  const p = board[r][c];
  if (!p) return [];
  return getLegalMoves(board, r, c).filter(m => isMoveSafe(board, { r, c }, m, p.color));
}

export function hasLegalMove(board, color) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p && p.color === color && getSafeMoves(board, r, c).length > 0) return true;
    }
  }
  return false;
}

export function boardKey(board, color) {
  const rows = board.map(row =>
    row.map(cell => (cell ? cell.color[0] + cell.type : ".")).join(""),
  );
  return rows.join("/") + "|" + color;
}

const CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

const PIECE_NAMES = {
  red: { king: "帅", rook: "车", knight: "马", cannon: "炮", bishop: "相", advisor: "仕", pawn: "兵" },
  black: { king: "将", rook: "车", knight: "马", cannon: "炮", bishop: "象", advisor: "士", pawn: "卒" },
};

function fileLabel(color, c) {
  return color === "red" ? CN_NUM[8 - c] : CN_NUM[c];
}

export function generateNotation(board, from, to, color) {
  const p = board[from.r][from.c];
  const name = PIECE_NAMES[color][p.type];
  const isRed = color === "red";
  const advance = isRed ? to.r < from.r : to.r > from.r;
  const retreat = isRed ? to.r > from.r : to.r < from.r;

  let verb;
  if (!advance && !retreat) {
    verb = `平${fileLabel(color, to.c)}`;
  } else if (p.type === "rook" || p.type === "cannon" || p.type === "pawn" || p.type === "king") {
    const steps = Math.abs(to.r - from.r);
    verb = `${advance ? "进" : "退"}${CN_NUM[steps - 1]}`;
  } else {
    verb = `${advance ? "进" : "退"}${fileLabel(color, to.c)}`;
  }

  const same = [];
  for (let r = 0; r < ROWS; r++) {
    const q = board[r][from.c];
    if (q && q.color === color && q.type === p.type) same.push(r);
  }
  if (same.length >= 2) {
    const ordered = [...same].sort((a, b) => (isRed ? a - b : b - a));
    const idx = ordered.indexOf(from.r);
    if (idx === 0) return `前${name}${verb}`;
    if (idx === 1) return `后${name}${verb}`;
  }

  return `${name}${fileLabel(color, from.c)}${verb}`;
}


