const ANALYZE_URL = '/__pikafish/analyze';

// 启动即分析(任务F)：首次研判用 `go movetime 300` 的快速参数，
// 挂在 requestAnalysis 的首次请求上，与后续走子分析共用同一链路，避免双请求竞态。
const ONLOAD_TARGET = { multiPV: 5, movetime: 300 };

// 标准辅助(默认)：轻量快速分析，只取前 5 路着法，满足"走子后 500ms 即时反馈"。
const LIGHT_TARGET = { multiPV: 5, movetime: 500 };

// 大师辅助(深度)：MultiPV 拉满把所有合法着法都排出来，go infinite 后延迟 800ms 再 stop，
// 一次性收集全量走法得分，供热力图与点击棋子指示器使用。
const DEEP_TARGET = { multiPV: 256, infinite: true, delay: 800 };

// 客户端请求上限：超过即判引擎异常，避免 fetch 永久挂起导致面板一直"加载中"。
const REQUEST_TIMEOUT_MS = 20000;

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
  constructor({ url = ANALYZE_URL } = {}) {
    this.url = url;
    this._seq = 0;
    this._activeFen = null;
    this._analyzedOnce = false; // 首次分析已在途/完成：阻止 analyzeOnLoad 重复发起
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
   */
  async requestAnalysis(fen, sideToMove, { force = false, target = null } = {}) {
    if (!fen) return;
    if (!force && this._activeFen === fen) return;

    const seq = ++this._seq;
    this._activeFen = fen;
    this._sideToMove = sideToMove || 'red';
    this._set({ fen, loading: true, error: null });

    const first = !this._analyzedOnce;
    this._analyzedOnce = true;
    const t =
      target ||
      (first ? ONLOAD_TARGET : this.state.mode === 'deep' ? DEEP_TARGET : LIGHT_TARGET);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, id: seq, ...t }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (seq !== this._seq) return; // 已被更新的请求取代
      if (!json.ok) {
        if (!json.stale) this._set({ loading: false, error: json.error || '引擎异常' });
        else this._set({ loading: false }); // stale：给更新的请求让路，静默忽略
        return;
      }
      this._set({ loading: false, data: json, error: null });
    } catch (e) {
      if (seq !== this._seq) return;
      const aborted = e && e.name === 'AbortError';
      this._set({ loading: false, error: aborted ? '分析超时，请稍后重试' : String(e?.message || e) });
    }
  }

  /** 丢弃当前结果（重新开局/悔棋到开局时调用）。 */
  resetState() {
    this._seq++;
    this._activeFen = null;
    this._analyzedOnce = false;
    this._set({ loading: false, data: null, error: null });
  }
}

/** 单例：全应用共享同一引擎会话。 */
export const engine = new EngineController();