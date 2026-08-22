import { startFEN } from '../utils/fen';

const ANALYZE_URL = '/__pikafish/analyze';
const RESET_URL = '/__pikafish/reset';

// 启动即分析(任务F)：首次研判用 `go movetime 300` 的快速参数，
// 挂在 requestAnalysis 的首次请求上，与后续走子分析共用同一链路，避免双请求竞态。
const ONLOAD_TARGET = { multiPV: 5, movetime: 300 };

// 标准辅助(默认)：轻量快速分析，只取前 5 路着法，满足"走子后 500ms 即时反馈"。
const LIGHT_TARGET = { multiPV: 5, movetime: 500 };

// 大师辅助(深度)：MultiPV 拉满把所有合法着法都排出来，go infinite 后一直搜到主变
// 深度达到 minDepth（保证推荐结果收敛稳定，不再每盘开局给出不同走法），最晚 delay 毫秒兜底。
// 服务端对"达到 minDepth 就立即 stop"，比旧的固定延时 800ms（深度≈8，开局结果还反复横跳）更深更稳。
const DEEP_TARGET = { multiPV: 256, infinite: true, minDepth: 10, delay: 4000 };

// 客户端请求上限：超过即判引擎异常，避免 fetch 永久挂起导致面板一直"加载中"。
const REQUEST_TIMEOUT_MS = 30000;

/**
 * 全应用共享的单调请求 id。
 * 面板分析与"皮卡鱼大师"AI 走棋都走同一个 /__pikafish/analyze 服务端队列，
 * 服务端用 id 判断"最新请求取胜"。两处必须用同一把单调递增标尺，
 * AI 走棋才能打断面板分析，且不会被之后的面板请求误判为 stale。
 */
let _id = 0;
export function nextRequestId() {
  _id = Math.max(Date.now(), _id + 1);
  return _id;
}

/**
 * EngineController —— 事件驱动引擎控制器。
 *
 * 取代旧的"每步固定延时重查"式轮询：由象棋落子回调显式触发一次分析，
 * 服务端串行队列 + 客户端 seq 失效标记保证"永远只有最后一次请求生效"，
 * 不会出现旧局面覆盖新局面、也不会积压无用的引擎计算。
 *
 * 对外是 React 无关的纯控制器，UI 通过 subscribe() 订阅快照。
 */
export class EngineController {
  constructor({ url = ANALYZE_URL, resetUrl = RESET_URL } = {}) {
    this.url = url;
    this.resetUrl = resetUrl;
    this._seq = 0;
    this._activeFen = null;
    this._analyzedOnce = false; // 首次分析已在途/完成：阻止 analyzeOnLoad 重复发起
    this._ctrl = null;           // 在途 fetch 的 AbortController，重开时中止
    this._opening = null;        // 缓存的标准开局分析 { fen, json, deep } —— 供重新开局复用
    this._listeners = new Set();
    this.state = {
      mode: 'light',   // 'light' | 'deep'
      loading: false,
      data: null,
      error: null,
      fen: null,
    };
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  isDeepMode() {
    return this.state.mode === 'deep';
  }

  _emit() {
    for (const fn of this._listeners) {
      try {
        fn(this.state);
      } catch {
        /* 单个订阅者出错不拖垮其他订阅者 */
      }
    }
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this._emit();
  }

  /** 开启大师辅助并立即用深度参数重算当前局面。 */
  enableDeepMode() {
    this.setDeepMode(true);
  }

  /** 关闭大师辅助，退回轻量 5 路分析。 */
  disableDeepMode() {
    this.setDeepMode(false);
  }

  setDeepMode(deep) {
    const mode = deep ? 'deep' : 'light';
    if (this.state.mode === mode) return;
    this._set({ mode });
    // 有"当前局面"时立刻重算；force=true 绕过 fen 去重，保证模式切换即时生效。
    if (this._activeFen) {
      this.requestAnalysis(this._activeFen, this._sideToMove, { force: true });
    }
  }

  /**
   * 启动即分析（任务F）：幂等护栏，只负责兜底，不重复发请求。
   * 首次分析由 App 挂载时的 requestAnalysis 自然触发（内部自动走 movetime 300），
   * 本方法仅当"从未发过分析"时才主动补发，杜绝挂载期双请求竞态。
   */
  analyzeOnLoad() {
    if (this._analyzedOnce) return;
    if (!this._activeFen) return;
    this.requestAnalysis(this._activeFen, this._sideToMove);
  }

  /**
   * 事件驱动入口：每次棋子落定/局面变化后调用一次。
   * force=false 时对同一局面去重，避免动画或无关重渲染引发的重复请求。
   * 首次请求（启动研判）自动使用 movetime 300；其余按 deep/light 参数。
   *
   * 开局缓存：每一盘都从同一标准开局出发，开局局面一模一样——
   * 缓存上次对该局面的分析结果，重新开局时面板瞬时出数，
   * 既消掉"重开要分析老半天"的卡顿，又让大师模式开局推荐每盘保持稳定一致。
   */
  async requestAnalysis(fen, sideToMove, { force = false, target = null } = {}) {
    if (!fen) return;
    if (!force && this._activeFen === fen) return;

    const first = !this._analyzedOnce;
    this._analyzedOnce = true;
    const t =
      target ||
      (first ? ONLOAD_TARGET : this.state.mode === 'deep' ? DEEP_TARGET : LIGHT_TARGET);
    const deepReq = !!t.infinite;

    // 开局缓存命中：直接复用，不发引擎请求。
    // 仅当缓存比请求"更完整"时可用（深度分析可降级给浅度请求，反之不行）。
    if (!force && this._opening && this._opening.fen === fen && (this._opening.deep || !deepReq)) {
      this._activeFen = fen;
      this._sideToMove = sideToMove || 'red';
      this._set({ fen, loading: false, data: this._opening.json, error: null });
      return;
    }

    const seq = ++this._seq;
    this._activeFen = fen;
    this._sideToMove = sideToMove || 'red';
    this._set({ fen, loading: true, error: null });

    try {
      const ctrl = new AbortController();
      this._ctrl = ctrl;
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, id: nextRequestId(), ...t }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (this._ctrl === ctrl) this._ctrl = null;
      const json = await res.json();
      if (seq !== this._seq) return; // 已被更新的请求取代
      if (!json.ok) {
        if (!json.stale) this._set({ loading: false, error: json.error || '引擎异常' });
        else this._set({ loading: false }); // stale：给更新的请求让路，静默忽略
        return;
      }
      // 只缓存标准开局局面的分析供"重新开局"复用；中局局面随走子变化，不做缓存以免陈旧。
      if (fen === startFEN()) this._opening = { fen, json, deep: deepReq };
      this._set({ loading: false, data: json, error: null });
    } catch (e) {
      if (seq !== this._seq) return;
      const aborted = e && e.name === 'AbortError';
      this._set({ loading: false, error: aborted ? '分析超时，请稍后重试' : String(e?.message || e) });
    }
  }

  /**
   * 重新开局：作废在途请求、清空显示状态（保留开局缓存，回开局直接复用），
   * 并通知服务端清空引擎上一局的搜索记忆（ucinewgame，无需杀掉子进程）。
   */
  resetForNewGame() {
    this._seq++;
    if (this._ctrl) {
      try {
        this._ctrl.abort();
      } catch {}
      this._ctrl = null;
    }
    this._activeFen = null;
    this._set({ loading: false, data: null, error: null });
    fetch(this.resetUrl, { method: 'POST' }).catch(() => {});
  }
}

/** 单例：全应用共享同一引擎会话。 */
export const engine = new EngineController();