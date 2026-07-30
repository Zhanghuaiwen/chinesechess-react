import { getAllLegalMoves, makeMove, evaluateBoard } from '../utils/gameLogic';

export const DIFFICULTY = {
  easy:   { depth: 2, label: '简单' },
  medium: { depth: 3, label: '中等' },
  hard:   { depth: 4, label: '困难' },
};

const PIECE_RANK = { king: 6, rook: 5, cannon: 4, knight: 3, bishop: 2, advisor: 1, pawn: 0 };

function moveScore(board, move) {
  const target = board[move.to.r][move.to.c];
  if (!target) return -1;
  return PIECE_RANK[target.type];
}

function orderMoves(board, moves) {
  return moves.sort((a, b) => moveScore(board, b) - moveScore(board, a));
}

function minimax(board, depth, alpha, beta, isMaximizing) {
  const color = isMaximizing ? 'red' : 'black';
  const moves = getAllLegalMoves(board, color);

  if (moves.length === 0) {
    return { score: isMaximizing ? -99999 : 99999 };
  }

  if (depth === 0) {
    return { score: evaluateBoard(board) };
  }

  const ordered = orderMoves(board, moves);
  let bestMove = ordered[0];

  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const move of ordered) {
      const { board: newBoard, captured } = makeMove(board, move.from, move.to);
      if (captured && captured.type === 'king') {
        return { score: 100000 + depth, move };
      }
      const result = minimax(newBoard, depth - 1, alpha, beta, false);
      if (result.score > maxScore) {
        maxScore = result.score;
        bestMove = move;
      }
      alpha = Math.max(alpha, maxScore);
      if (beta <= alpha) break;
    }
    return { score: maxScore, move: bestMove };
  } else {
    let minScore = Infinity;
    for (const move of ordered) {
      const { board: newBoard, captured } = makeMove(board, move.from, move.to);
      if (captured && captured.type === 'king') {
        return { score: -100000 - depth, move };
      }
      const result = minimax(newBoard, depth - 1, alpha, beta, true);
      if (result.score < minScore) {
        minScore = result.score;
        bestMove = move;
      }
      beta = Math.min(beta, minScore);
      if (beta <= alpha) break;
    }
    return { score: minScore, move: bestMove };
  }
}

function iterativeDeepening(board, maxDepth, timeBudget) {
  const allMoves = getAllLegalMoves(board, 'black');
  if (allMoves.length <= 1) return allMoves[0] || null;

  let bestMove = allMoves[0];
  const start = performance.now();

  for (let d = 1; d <= maxDepth; d++) {
    if (performance.now() - start >= timeBudget) break;
    const result = minimax(board, d, -Infinity, Infinity, false);
    if (result.move) bestMove = result.move;
  }

  return bestMove;
}

export function getAIMove(board, difficulty = 'medium') {
  const config = DIFFICULTY[difficulty] || DIFFICULTY.medium;

  if (difficulty === 'hard') {
    return iterativeDeepening(board, config.depth, 8000);
  }

  const result = minimax(board, config.depth, -Infinity, Infinity, false);
  return result.move;
}
