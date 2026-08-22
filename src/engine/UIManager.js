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

/** 展示文本：+1.25 / -0.75 / 杀2 / 负2。默认红方视角，黑方行棋时取反；perspective 指定展示给谁看（默认'red'，AI先手时玩家是黑方则传'black'）。 */
export function scoreLabel(score, sideToMove, perspective = 'red') {
  if (!score) return '—';
  const view = sideToMove === perspective ? scoreToNum(score) : -scoreToNum(score);
  if (score.type === 'mate') return view > 0 ? `杀${score.value}` : `负${-score.value}`;
  const v = view / 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

// ─────────────────────────── 分数配色（红正蓝负） ───────────────────────────

const SCORE_RED_LIGHT = '#e0705b';   // 小正分：偏浅的红
const SCORE_RED_DEEP = '#7a1208';    // 大正分：深红
const SCORE_BLUE_LIGHT = '#5f93bd';  // 小负分：偏浅的蓝
const SCORE_BLUE_DEEP = '#0f3a5c';   // 大负分：深蓝
const SCORE_NEUTRAL = '#8a6d4f';

function mixHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const ch = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/**
 * 分数(厘兵，玩家视角) -> 文本色。规则固定：正分一律红色、加的越多越深；
 * 负分一律蓝色、扣的越多越深；≈0 用中性色。杀棋按 ±100000 直接落深端。
 */
export function scoreColor(view) {
  if (!view) return SCORE_NEUTRAL;
  const t = Math.min(1, Math.abs(view) / 900); // 900 ≈ 一车，之后饱和到最深
  return view > 0
    ? mixHex(SCORE_RED_LIGHT, SCORE_RED_DEEP, t)
    : mixHex(SCORE_BLUE_LIGHT, SCORE_BLUE_DEEP, t);
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
   * perspective 为展示视角（AI先手时玩家执黑传 'black'），让玩家自己的优着为正值(暖色)。
   */
  static buildPieceMap(data, board, perspective = 'red') {
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
      // 引擎分以"行棋方"为正；换算到展示视角：行棋方==视角则同号，否则取反。
      const num = perspective === side ? scoreToNum(m.score) : -scoreToNum(m.score);
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
   * 这样视角方那侧不会再因为分差普遍偏小而整体发白，对手也不会因为个别大分值
   * 而一片死深 —— 两色的深浅始终对称。0 分格子直接剔除（保持透明）。
   * 返回 { cells: [{r, c, value, t}] }，t∈[0,1] 为组内名次强度。
   */
  static buildHeatCells(data, board, perspective = 'red') {
    const raw = [];
    if (data) {
      const map = this.buildPieceMap(data, board, perspective);
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
   * perspective 决定分数/着法着色展示给谁（默认红方；AI先手时玩家执黑传 'black'）。
   */
  static buildSidebarRows(data, board, sideToMove, limit = 5, perspective = 'red') {
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
      // 引擎分以"行棋方"为正；换算到玩家视角：行棋方==玩家则同号，否则取反。
      const num = perspective === sideToMove ? scoreToNum(m.score) : -scoreToNum(m.score);
      rows.push({
        rank: m.rank,
        notation,
        text: scoreLabel(m.score, sideToMove, perspective),
        num,
        color: scoreColor(num),
        capture: !!(board && board[mv.to.r] && board[mv.to.r][mv.to.c]),
      });
    }
    return rows;
  }

  /**
   * 点击棋子的着法指示器数据 —— V2.0 全部托管给 MoveIndicatorRenderer.buildAndRate：
   * 废除以"吃子/非吃子"分类的旧渲染，改按行棋方视角得分的相对强度分级
   * （优等实心发光圆点/中等薄环/平庸隐藏）+ Top1 脉动（在绘制层兑现）。
   */
  static buildPieceSelection(data, board, selected) {
    return buildAndRate(data, board, selected);
  }
}