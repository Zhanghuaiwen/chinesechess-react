import { uciToMove } from '../utils/fen';
import { generateNotation } from '../utils/gameLogic';
import { buildAndRate } from './MoveIndicatorRenderer';

// ─────────────────────────────── 分数工具 ───────────────────────────────

/** 将引擎分数转成可排序的数值。杀棋按 ±100000 处理，永远排在热力归一化的两极。 */
export function scoreToNum(score) {
  if (!score) return 0;
  if (score.type === 'mate') return score.value > 0 ? 100000 : -100000;
  return score.value;
}

/** 展示文本：+1.25 / -0.75 / 杀2 / 负2（红方视角，黑方行棋时自动取反）。 */
export function scoreLabel(score, sideToMove) {
  if (!score) return '—';
  const red = sideToMove === 'black' ? -scoreToNum(score) : scoreToNum(score);
  if (score.type === 'mate') return red > 0 ? `杀${score.value}` : `负${-score.value}`;
  const v = red / 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

/**
 * UIManager —— 纯数据编排层（不碰 DOM 副作用）。
 * 负责从引擎 MultiPV 全量结果里构建：
 *   1. 侧边栏走法列表（红方视角得分从高到低，正分红色 +xxx / 负分蓝色 -xxx）
 *   2. 热力图逐格数据（每格取该子最优着法在红方视角下的得分）
 *   3. 点击棋子的着法指示器（V2.0 委托 MoveIndicatorRenderer 做相对强度分级）
 *   4. 大师辅助按钮的状态类名
 */
export class UIManager {
  /** 按钮状态：依据是否深度开启返回 className。 */
  static buttonClasses(deep) {
    return deep ? 'master-btn active' : 'master-btn';
  }

  static applyButtonState(el, deep) {
    if (!el) return;
    el.className = this.buttonClasses(deep);
  }

  /**
   * 把所有候选着法按"from 格"聚合成 Map：
   *   key = "r,c" -> { best, moves }
   *   best  = 该格排名最靠前(rank 最小)的着法
   *   moves = 该格全部着法（含是否吃子，用于点击棋子指示器）
   */
  static buildPieceMap(data, board) {
    const map = new Map();
    if (!data || !Array.isArray(data.moves)) return map;
    const side = data.sideToMove;

    for (const m of data.moves) {
      if (!m.move) continue;
      let mv;
      try {
        mv = uciToMove(m.move);
      } catch {
        continue;
      }
      const key = `${mv.from.r},${mv.from.c}`;
      const target = board && board[mv.to.r] ? board[mv.to.r][mv.to.c] : null;
      // num 统一到红方视角：引擎分数以"行棋方"为正，黑方行棋时取反。
      const num = side === 'black' ? -scoreToNum(m.score) : scoreToNum(m.score);
      const item = { to: mv.to, capture: !!target, num, score: m.score, rank: m.rank };

      const entry = map.get(key);
      if (!entry) {
        map.set(key, { best: item, moves: [item] });
      } else {
        if (m.rank < entry.best.rank) entry.best = item;
        entry.moves.push(item);
      }
    }

    for (const [key, entry] of map) {
      entry.moves.sort((a, b) => a.rank - b.rank);
      map.set(key, entry);
    }
    return map;
  }

  /**
   * 热力图数据：每个有走法的棋子格子取其"最优着法得分"。
   * 强度不做数值归一，而是**按相对排名**：把正分格子一套、负分格子一套，
   * 组内按 |分| 从高到低排序，名次越靠前越浓、越靠后越淡。
   * 这样红色那侧不会再因为分差普遍偏小而整体发白，蓝色也不会因为个别大分值
   * 而一片死深 —— 两色的深浅始终对称。0 分格子直接剔除（保持透明）。
   * 返回 { cells: [{r, c, value, t}] }，t∈[0,1] 为组内名次强度。
   */
  static buildHeatCells(data, board) {
    const raw = [];
    if (data) {
      const map = this.buildPieceMap(data, board);
      for (const [key, entry] of map) {
        const [r, c] = key.split(',').map(Number);
        const value = entry.best.num;
        if (value === 0) continue;
        raw.push({ r, c, value, t: 0 });
      }
    }
    const rankWithinGroup = (list) => {
      list.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      const n = list.length;
      for (let i = 0; i < n; i++) list[i].t = n === 1 ? 1 : 1 - i / (n - 1);
    };
    const pos = raw.filter((c) => c.value > 0);
    const neg = raw.filter((c) => c.value < 0);
    rankWithinGroup(pos);
    rankWithinGroup(neg);
    return { cells: raw };
  }

  /**
   * 侧边栏走法列表：按引擎 rank（即得分从高到低）排序。
   * limit 用于标准模式只取前 N 路；深度模式传 Infinity 展示全部。
   */
  static buildSidebarRows(data, board, sideToMove, limit = 5) {
    const rows = [];
    if (!data || !Array.isArray(data.moves)) return rows;

    for (const m of data.moves) {
      if (!m.move) continue;
      if (rows.length >= limit) break;
      let mv;
      try {
        mv = uciToMove(m.move);
      } catch {
        continue;
      }
      let notation = m.move;
      try {
        notation = generateNotation(board, mv.from, mv.to, sideToMove || 'red');
      } catch {
        /* UCI 原文兜底 */
      }
      const num = sideToMove === 'black' ? -scoreToNum(m.score) : scoreToNum(m.score);
      rows.push({
        rank: m.rank,
        notation,
        text: scoreLabel(m.score, sideToMove),
        tone: num > 0 ? 'pos' : num < 0 ? 'neg' : 'eq',
        capture: !!(board && board[mv.to.r] && board[mv.to.r][mv.to.c]),
      });
    }
    return rows;
  }

  /**
   * 点击棋子的着法指示器数据 —— V2.0 全部托管给 MoveIndicatorRenderer.buildAndRate：
   * 废除以"吃子/非吃子"分类的旧渲染，改按红方视角得分的相对强度分级
   * （优等实心发光圆点/中等薄环/平庸隐藏）+ Top1 脉动（在绘制层兑现）。
   */
  static buildPieceSelection(data, board, selected) {
    return buildAndRate(data, board, selected);
  }
}