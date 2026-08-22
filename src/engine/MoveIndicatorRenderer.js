import { uciToMove } from '../utils/fen';

// ──────────────────────────────────────────────────────────────────
//  MoveIndicatorRenderer —— 基于得分的走法指示器（V2.0）
//
//  职责拆成两层：
//    1. buildAndRate() 纯数据层：从 MultiPV 全量里过滤选中棋子的走法，
//       按红方视角得分降序排序，并按"相对强度"分级。点击棋子时调用，
//       数据量仅限该棋子的候选着法，毫秒级完成。
//    2. draw() 绘制层：把分级结果画到棋盘 Canvas 上，内含
//       径向渐变"能量聚焦"、Top1 脉动动画（sin 缓动）。
//
//  分级阈值（相对强度 ratio，恒在 [0,1]，最佳走法恒为 1）：
//    good   ratio >= 0.40  -> 黄色系实心发光圆点，尺寸/透明度随相对强度线性放大
//                             （优等走法；局面整体不占优时仍至少保留榜首作为推荐）
//    mark   ratio < 0.40   -> 绿色小圆点，回归"普通合法走法"的绿点样式（其余走法均可走）
//  只有 1 个合法走法时：薄荷绿固定圆点，不做缩放对比。
//  注：本版将 V2.0 的"半透明薄环/彻底隐藏"统一收敛为绿点 —— 用户更关心"哪里能走"，
//  强度高低只由黄色圆点的体积/脉动表达，不牺牲走法信息的完整性。
//
//  注意：draw() 只依赖传入的 rating 与 geo（供 HeatmapRenderer 委托调用），
//  自身不持有 Canvas 生命周期，把 rAF 批量重绘合并交给 HeatmapRenderer 完成，
//  从而同时满足"性能优化(明显防闪烁)"与"不重复量尺寸"两条约束。
// ──────────────────────────────────────────────────────────────────

// 颜色分级收入（严格禁止在绘制逻辑里写死 RGB 值，统一走 getGradientColor）
const WARM_HI = [230, 126, 34];   // #E67E22 暖橙
const WARM_LO = [241, 196, 15];   // #F1C40F 金
const COOL_HI = [142, 68, 173];   // #8E44AD 冷紫
const COOL_LO = [52, 152, 219];   // #3498DB 蓝
const MATE_BRIGHT = [255, 215, 0]; // 杀棋/绝杀用最亮的金色，一眼命中
const MATTE_MINT = [26, 188, 156]; // #1ABC9C 无对比时的柔和薄荷绿
const GREEN_DOT = [39, 174, 96];   // #27AE60 普通合法走法的绿点（与 DOM .mark 一致）

const GOOD_MIN_ALPHA = 0.6;
const GOOD_MAX_ALPHA = 1.0;
const MIN_GOOD_PIXEL = 6;   // 基础半径
const MAX_GOOD_PIXEL = 20;  // 最佳可达冲击力半径
const PULSE_PERIOD_MS = 1500;
const PULSE_AMPLITUDE = 0.15; // 1.0 -> 1.15 循环

/** 引擎得分(可含 mate) -> 可排序数值，正=行棋方占优（指示器按"选中的棋子的行棋方"定优劣）。 */
function scoreToNum(score) {
  if (!score) return 0;
  if (score.type === 'mate') return score.value > 0 ? 100000 : -100000;
  return score.value;
}

/** 引擎得分(可含 mate) -> 指定展示视角(默认玩家执红)可比较数值。 */
function viewNum(score, sideToMove, perspective = 'red') {
  // 引擎分数以"行棋方"为正；换算到展示视角：行棋方==视角则同号，否则取反。正=视角方优。
  return sideToMove === perspective ? scoreToNum(score) : -scoreToNum(score);
}

/** 视角得分文本，供点击棋子的评级附注使用。 */
export function redViewLabel(score, sideToMove, perspective = 'red') {
  if (!score) return '—';
  const v = viewNum(score, sideToMove, perspective);
  if (score.type === 'mate') return v > 0 ? `杀${score.value}` : `负${-score.value}`;
  return `${v >= 0 ? '+' : ''}${(v / 100).toFixed(2)}`;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * 颜色映射函数（唯一允许出现色值的地方）。
 * ratio ∈ [0,1]：该着法得分 / 该棋子最佳得分（好 = 1）。
 * 正分走暖橙金、负分冷却紫蓝；杀棋负极值直接命中金色极值。
 * 返回 { r, g, b, alpha, size }：
 *   size 为 [0,1] 的强度因子，实际像素半径由 draw() 按 ratio 换算，
 *   使"尺寸随强度"的规则与画布格宽解耦。
 */
export function getGradientColor(score, maxScore, ratio) {
  const mate = score && score.type === 'mate';
  let rgb;
  if (mate && score.value > 0) {
    rgb = MATE_BRIGHT;
  } else if (ratio > 0) {
    rgb = mix(WARM_HI, WARM_LO, ratio);
  } else {
    rgb = mix(COOL_HI, COOL_LO, Math.min(1, -ratio + 0.35));
  }
  const alpha = GOOD_MIN_ALPHA + (GOOD_MAX_ALPHA - GOOD_MIN_ALPHA) * ratio;
  const size = ratio;
  void maxScore; // 保留参数以契约定（约定内的比率已经隐式携带相对性）
  return { r: rgb[0], g: rgb[1], b: rgb[2], alpha, size };
}

/** 把 [r,g,b] 写成 css rgb() 串，透明度另由 globalAlpha 控制。 */
function cssColor([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}

/**
 * 点击棋子 -> 评级结果（供 HeatmapRenderer 作为 selection 渲染）。
 * 返回：
 *   null（无数据，清空指示器）
 *   { kind:'dead' }（该子没有候选着法）
 *   { kind:'moves', moves:[{ to, rank, num, ratio, isBest, isSingle, cls, alpha, shade, capture }] }
 * cls  ∈ 'good'（黄色发光圆点）| 'mark'（绿色小点）；isBest/isSingle 只会出现在 good 上。
 * alpha∈[0,1] 强度；shade=>[r,g,b] 已算好的渲染色矩阵，draw() 直接消费不再重复插值。
 * 评分基准：引擎分恒以"行棋方"为正，而选中的棋子必属行棋方，因此强弱直接按
 * scoreToNum（行棋方视角）排序，不再按展示视角翻转——否则黑方行棋（尤其人机对战时
 * perspective 恒定 'red'）会把黑方最差的着法标成最佳，白送对手。
 */
export function buildAndRate(data, board, selected) {
  if (!data || !selected || !Array.isArray(data.moves)) return null;
  const list = [];
  for (const m of data.moves) {
    if (!m.move) continue;
    let mv;
    try {
      mv = uciToMove(m.move);
    } catch {
      continue;
    }
    if (mv.from.r !== selected.r || mv.from.c !== selected.c) continue;
    const target = board && board[mv.to.r] ? board[mv.to.r][mv.to.c] : null;
    list.push({
      to: mv.to,
      rank: m.rank,
      // 引擎分以"行棋方"为正；选中的棋子必属行棋方，直接按行棋方视角比较强弱。
      num: scoreToNum(m.score),
      score: m.score,
      capture: !!target,
    });
  }
  if (list.length === 0) return { kind: 'dead' };

  list.sort((a, b) => b.num - a.num || a.rank - b.rank);
  const maxScore = list[0].num;
  const card = (item) => {
    const mate = item.score && item.score.type === 'mate';
    if (list.length === 1) {
      // 只有一个合法走法：没有对比对象，不做缩放渲染，柔和薄荷绿固定圆点
      return {
        to: item.to,
        rank: item.rank,
        num: item.num,
        capture: item.capture,
        ratio: 1,
        isBest: true,
        isSingle: true,
        cls: 'good',
        alpha: 0.9,
        shade: MATTE_MINT,
      };
    }
    // 相对强度统一换算到 [0,1]：最优着法（列表第一）恒为 1 —— 当局势整体
    // 不占优/被将杀时，榜首始终是"推荐下法"，用户一眼可知该往哪下；
    // 其余着法按"与最优的分差"线性衰减，全程正数除法，杜绝全负数局面下
    // ratio 溢出成数千倍、把更差的走法画成占屏巨点的事故。
    //   maxScore>0 时数学上与旧的 num/maxScore 完全等价；
    //   不占优局面示例(maxScore=-30, 其它=-50/-100000)
    //   -> ratio: 1 / 0.33 / 0，榜首高亮、差距大的转绿。
    const loss = maxScore - item.num;
    const span = Math.max(1, Math.abs(maxScore));
    const ratio = Math.max(0, Math.min(1, 1 - loss / span));
    if (ratio >= 0.4) {
      // 优等走法：黄色系实心发光圆点；杀棋(第X手杀, value>0)命中金色极值，
      // 被杀的负 mate 走真实负分，绝不误用金色。
      const { r, g, b, alpha } = getGradientColor(item.score, maxScore, ratio);
      return {
        to: item.to,
        rank: item.rank,
        num: item.num,
        capture: item.capture,
        ratio,
        isBest: item.rank === list[0].rank && !mate,
        isSingle: false,
        cls: 'good',
        alpha,
        shade: [r, g, b],
      };
    }
    // 其余合法走法（含平庸/负分）：一律绿色小圆点，保证"哪里能走"完整可见
    return {
      to: item.to,
      rank: item.rank,
      num: item.num,
      capture: item.capture,
      ratio,
      isBest: false,
      isSingle: false,
      cls: 'mark',
      alpha: 0.85,
      shade: GREEN_DOT,
    };
  };
  const moves = [];
  for (const item of list) {
    const c = card(item);
    if (c) moves.push(c);
  }
  if (moves.length === 0) return { kind: 'dead' };
  return { kind: 'moves', moves };
}

/**
 * 绘制走法指示器。
 * ctx 已由 HeatmapRenderer 做好 dpr 变换；geo 为棋盘几何（_cellRect 口径一致）。
 * t 为当前帧时间戳（由 HeatmapRenderer 的 rAF 循环提供），做 sin 缓动脉动。
 */
export function drawMoveIndicators(ctx, geo, selection, t) {
  if (!selection || selection.kind === 'dead') return;
  const pulse =
    ((t % PULSE_PERIOD_MS) / PULSE_PERIOD_MS) * Math.PI * 2 - Math.PI / 2;
  const pulseScale = 1 + PULSE_AMPLITUDE * 0.5 * (1 + Math.sin(pulse)); // 1.0 → 1.15 → 1.0

  for (const mv of selection.moves) {
    try {
      const r = cellRect(geo, mv.to.r, mv.to.c);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;

      if (mv.cls === 'mark') {
        // 普通合法走法：绿色小圆点（与 DOM .mark 视觉一致），只表"可走"，不抢强度表达
        const R = Math.max(3, geo.cell * 0.09);
        ctx.save();
        ctx.globalAlpha = mv.alpha;
        ctx.fillStyle = cssColor(GREEN_DOT);
        ctx.shadowColor = cssColor([46, 204, 113]);
        ctx.shadowBlur = geo.cell * 0.16;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      // 优等走法：实心发光圆点，核心颜色来自 getGradientColor 的映射，绝不写死色值
      const baseR = mv.isSingle
        ? geo.cell * 0.09
        : MIN_GOOD_PIXEL + (MAX_GOOD_PIXEL - MIN_GOOD_PIXEL) * mv.ratio;
      const scale =
        mv.isBest && !mv.isSingle ? (mv.ratio === 1 ? pulseScale : 1) : 1;
      // 双保险：无论上游 ratio 出什么异常，圆点半径绝不超过半格宽，
      // 杜绝"黄色圆圈占满整个屏幕"这类事故。
      const maxR = Math.max(8, geo.cell * 0.5);
      const R = Math.max(1, Math.min(baseR * (mv.isBest ? scale : 1), maxR));
      const [r0, g0, b0] = mv.shade;

      ctx.save();
      // 能量聚焦：中心亮、边缘淡的径向渐变
      const grad = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
      grad.addColorStop(0, `rgba(${Math.min(255, r0 + 90)},${Math.min(255, g0 + 90)},${Math.min(255, b0 + 70)},1)`);
      grad.addColorStop(0.55, `rgba(${r0},${g0},${b0},${mv.alpha})`);
      grad.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);

      ctx.shadowColor = cssColor([r0, g0, b0]);
      ctx.shadowBlur = R * 0.65;
      ctx.globalAlpha = mv.alpha;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } catch {
      /* 单点绘制失败不影响其余指示器 */
    }
  }
}

/** 与 HeatmapRenderer#_cellRect 相同口径的格子矩形换算。 */
function cellRect(geo, r, c) {
  const g = geo || {};
  const x = g.originX || 0;
  const y = r < 5 ? g.originY || 0 : g.originY5 || 0;
  return { x: x + c * (g.colStep || 0), y: y + (r < 5 ? r : r - 5) * (g.rowStep || 0), w: g.cell || 0, h: g.cell || 0 };
}