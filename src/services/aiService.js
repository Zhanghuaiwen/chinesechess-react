import { getAllLegalMoves, makeMove, evaluateBoard } from '../utils/gameLogic';
import { boardToFEN, uciToMove } from '../utils/fen';
import { nextRequestId } from '../engine/EngineController';

export const DIFFICULTY = {
  easy:     { depth: 3, label: '简单' },
  medium:   { depth: 4, label: '中等' },
  hard:     { depth: 5, label: '困难' },
  pikafish: { depth: 0, label: '皮卡鱼大师' },
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

function minimax(board, depth, alpha, beta, isMaximizing, stats) {
  stats.nodes++;
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
      const result = minimax(newBoard, depth - 1, alpha, beta, false, stats);
      if (result.score > maxScore) {
        maxScore = result.score;
        bestMove = move;
      }
      alpha = Math.max(alpha, maxScore);
      if (beta <= alpha) {
        stats.prunes++;
        break;
      }
    }
    return { score: maxScore, move: bestMove };
  } else {
    let minScore = Infinity;
    for (const move of ordered) {
      const { board: newBoard, captured } = makeMove(board, move.from, move.to);
      if (captured && captured.type === 'king') {
        return { score: -100000 - depth, move };
      }
      const result = minimax(newBoard, depth - 1, alpha, beta, true, stats);
      if (result.score < minScore) {
        minScore = result.score;
        bestMove = move;
      }
      beta = Math.min(beta, minScore);
      if (beta <= alpha) {
        stats.prunes++;
        break;
      }
    }
    return { score: minScore, move: bestMove };
  }
}

function iterativeDeepening(board, maxDepth, timeBudget, stats, isMaximizing) {
  const color = isMaximizing ? 'red' : 'black';
  const allMoves = getAllLegalMoves(board, color);
  if (allMoves.length <= 1) return allMoves[0] || null;

  let bestMove = allMoves[0];
  const start = performance.now();

  for (let d = 1; d <= maxDepth; d++) {
    if (performance.now() - start >= timeBudget) break;
    stats.depthReached = d;
    const result = minimax(board, d, -Infinity, Infinity, isMaximizing, stats);
    if (result.move) bestMove = result.move;
  }

  return bestMove;
}

/** 本地 Minimax AI（easy/medium/hard 共用）。 */
function localMove(board, difficulty = 'medium', aiColor = 'black') {
  const config = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const stats = { nodes: 0, prunes: 0, depthReached: 0 };
  const start = performance.now();
  const isMaximizing = aiColor === 'red';

  let move = null;
  if (difficulty === 'hard') {
    move = iterativeDeepening(board, config.depth, 8000, stats, isMaximizing);
  } else {
    const result = minimax(board, config.depth, -Infinity, Infinity, isMaximizing, stats);
    move = result.move;
  }

  return {
    move,
    nodes: stats.nodes,
    prunes: stats.prunes,
    depth: stats.depthReached || config.depth,
    timeMs: Math.round(performance.now() - start),
  };
}

/**
 * 皮卡鱼大师：走棋交给本地 Pikafish 引擎（POST /__pikafish/analyze）。
 * 与右侧分析面板共用同一把单调 id（nextRequestId）——服务端据此让本次走棋
 * 打断进行中的面板分析，且不会误伤之后的面板请求。引擎不可用时降级本地困难 AI。
 */
async function getPikafishMove(board, aiColor = 'black') {
  const start = performance.now();
  const res = await fetch('/__pikafish/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: boardToFEN(board, aiColor), multiPV: 1, movetime: 2000, id: nextRequestId() }),
  });
  const json = await res.json();
  const best = json && json.ok && json.bestmove ? json.bestmove : null;
  if (!best || best === '0000') throw new Error('引擎未返回着法');
  const move = uciToMove(best);
  const piece = board[move.from.r]?.[move.from.c];
  if (!piece || piece.color !== aiColor) throw new Error(`引擎着法不合法: ${best}`);
  return {
    move,
    nodes: 0,
    prunes: 0,
    depth: json.depth || 0,
    timeMs: Math.round(performance.now() - start),
  };
}

export async function getAIMove(board, difficulty = 'medium', aiColor = 'black') {
  if (difficulty === 'pikafish') {
    try {
      return await getPikafishMove(board, aiColor);
    } catch (e) {
      // 引擎不可用（如纯静态构建）时降级到本地最强 minimax，保证 AI 仍能走棋。
      console.warn('[pikafish] 引擎走棋失败，降级本地 AI:', e?.message || e);
      return localMove(board, 'hard', aiColor);
    }
  }
  return localMove(board, difficulty, aiColor);
}
