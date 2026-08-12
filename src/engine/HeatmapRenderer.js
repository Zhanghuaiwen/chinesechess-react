// ──────────────────────────────────────────────────────────────────
//  HeatmapRenderer —— 棋盘热力图 Canvas 覆盖层
//
//  亮点：
//  1. 放置在 #board 之上的独立 <canvas>，pointer-events:none，
//     完全不影响棋盘原有点击/拖拽；所有绘制都在 Canvas 内完成。
//  2. 地理数据通过 DOM 实测（cell data-pos=0-0 / 5-0）反推，即使
//     未来 CSS 网格尺寸调整也不需要改代码。
//  3. setData() 只记录"期望状态"，统一交给 requestAnimationFrame
//     冲刷 —— 多次连续更新在下一帧合并为一次重绘（防抖），避免
//     MultiPV=256 海量数据引发频繁重绘卡顿。
//  4. 点击棋子的走法指示器（V2.0 相对强度可视化）完全委托给
//     MoveIndicatorRenderer 绘制：动态尺寸/颜色插值/脉动动画都在那边，
//     本类负责统一 rAF 调度并持续喂帧给脉动循环。
//
//  配色（严格按照审美红线）：
//   - 正分(暖)   #FFF5EB -> #FFB088 -> #C0392B
//   - 负分(冷)   #F0F4FF -> #7B9CD6 -> #1A365D
//   - 透明度钳制在 [0.20, 0.65]，保证木纹/墨绿底色隐约可见
//   - 着法指示器带 shadowBlur 高斯模糊阴影营造悬浮感
//     （指示器的色值映射统一收敛在 MoveIndicatorRenderer，勿在本类写死）
// ──────────────────────────────────────────────────────────────────

import { drawMoveIndicators } from './MoveIndicatorRenderer';

const WARM = ['#FFF5EB', '#FFB088', '#C0392B'];
const COOL = ['#F0F4FF', '#7B9CD6', '#1A365D'];

const MIN_ALPHA = 0.2;   // 极浅：让底色透出来
const MAX_ALPHA = 0.65;  // 最浓也不能盖死棋盘

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const l = Math.round;
  return `rgb(${l(A[0] + (B[0] - A[0]) * t)},${l(A[1] + (B[1] - A[1]) * t)},${l(A[2] + (B[2] - A[2]) * t)})`;
}

// 三段渐变插值：0 -> 基础色，0.5 -> 过渡色，1 -> 极值色
function gradient(t, stops) {
  if (t <= 0.5) return mix(stops[0], stops[1], t * 2);
  return mix(stops[1], stops[2], (t - 0.5) * 2);
}

export class HeatmapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geo = null;
    this.pending = null;
    this._raf = 0;
    this._destroyed = false;
    this._pulseTick = 0; // 上一帧节拍时间戳：驱动 Top1 脉动动画的连续重绘

    this._onResize = () => {
      this.resize();
      this.schedule();
    };
    window.addEventListener('resize', this._onResize);

    this._ro = null;
    const host = canvas.parentElement;
    if (host && typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(host);
    }

    // 等首帧布局完成后再量尺寸，避免 0 尺寸
    requestAnimationFrame(this._onResize);
  }

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
  }

  /** 记录新数据并调度重绘（rAF 防抖：多次 setData 只画一次）。 */
  setData(payload) {
    this.pending = payload;
    this.schedule();
  }

  clear() {
    this.pending = null;
    this.schedule();
  }

  schedule() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => {
      if (this._destroyed) return;
      this._draw();
    });
  }

  // ─────────────── 几何测量（DOM 实测，天然适配各种缩放） ───────────────

  resize() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();      // 含外层 transform scale
    const cw = el.clientWidth || 1;               // CSS 布局宽度(未缩放)
    const ch = el.clientHeight || 1;
    const scale = rect.width > 0 ? rect.width / cw : 1;
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.max(1, Math.round(cw * dpr));
    this.canvas.height = Math.max(1, Math.round(ch * dpr));
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;

    // 元素相对父级的 CSS 坐标（已除掉外层缩放的干扰）
    const rel = (r, c) => {
      const cell = el.querySelector(`.cell[data-pos="${r}-${c}"]`);
      if (!cell) return null;
      const cr = cell.getBoundingClientRect();
      return { x: (cr.left - rect.left) / scale, y: (cr.top - rect.top) / scale, w: cr.width / scale };
    };

    const a = rel(0, 0);      // 上区首格
    const b = rel(5, 0);      // 下区首格（跨过楚河汉界）
    const a2 = rel(0, 1);     // 同列次格：求列步长（含 gap）
    const a3 = rel(1, 0);     // 同列次格：求行步长（含 gap）
    if (!a || !b || !a2 || !a3) return;

    this.geo = {
      originX: a.x,
      originY: a.y,
      originY5: b.y,
      cell: a.w,
      colStep: a2.x - a.x,   // 1列：格宽 + gap
      rowStep: a3.y - a.y,   // 1行：格高 + gap
      cssW: cw,
      cssH: ch,
    };
  }

  // ─────────────── 绘制 ───────────────

  _cellRect(r, c) {
    const g = this.geo;
    const x = g.originX + c * g.colStep;
    const y = r < 5 ? g.originY + r * g.rowStep : g.originY5 + (r - 5) * g.rowStep;
    return { x, y, w: g.cell, h: g.cell };
  }

  _draw() {
    const { ctx, canvas, geo, pending } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!pending || !geo) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (pending.isDeep) {
      if (pending.cells && pending.cells.length > 0) this._drawHeatMap(pending.cells);

      // 走法指示器：V2.0 统一由 MoveIndicatorRenderer 绘制（含脉动）。
      // 有"优等实心圆点"时维持连续帧喂给脉动循环，否则只画一次。
      const selection = pending.selection || null;
      if (selection && (selection.kind === 'moves' || selection.kind === 'dead')) {
        const hasLive = selection.kind === 'moves';
        const tick = hasLive ? (this._pulseTick || performance.now()) : 0;
        drawMoveIndicators(ctx, geo, selection, tick);
        if (hasLive) {
          this._pulseTick = tick;
          this.schedule();
        }
      }
    }
  }

  /**
   * 每个格子的强度 t 已经由 UIManager 按组内相对排名算好（0~1），
   * 名次越靠前越浓，极值色只给组内最优/最劣，中间力量自然变淡。
   */
  _drawHeatMap(cells) {
    const { ctx, geo } = this;
    for (const cell of cells) {
      if (!cell.t) continue; // 组内垫底 → 完全透明，不干扰视线
      const alpha = MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * cell.t;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = cell.value > 0 ? gradient(cell.t, WARM) : gradient(cell.t, COOL);
      const r = this._cellRect(cell.r, cell.c);
      const inset = geo.cell * 0.05;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, geo.cell * 0.12);
        ctx.fill();
      } else {
        ctx.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
      }
    }
    ctx.globalAlpha = 1;
  }
}