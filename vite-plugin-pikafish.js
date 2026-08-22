import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PikafishClient } from './scripts/engine/pikafish-client.js';
import { fenToBoard } from './src/utils/fen.js';
import { getAllLegalMoves } from './src/utils/gameLogic.js';

const RELEASE = join(dirname(fileURLToPath(import.meta.url)), 'Pikafish-master', 'release');
const EXE = join(RELEASE, 'Pikafish.exe');

// 实测：Pikafish 对超过 ~128 的 MultiPV 会静默拒不应用并回归默认 1！
// 因此以 128 为硬上限，再用当前局面真实合法着法数精确收敛，确保"一个不漏"。
const MAX_ENGINE_MULTIPV = 128;

/** 计算当前局面行棋方真实合法着法数（用于把 MultiPV 收敛到"最大合法走法数"）。 */
function legalMoveCount(fen) {
  try {
    const { board, sideToMove } = fenToBoard(fen);
    return getAllLegalMoves(board, sideToMove).length;
  } catch {
    return 0;
  }
}

/** 把请求的 MultiPV 收敛到引擎可接受且不漏着法的值。 */
function capMultiPV(requested, fen) {
  if (!(requested > 1)) return 1;
  let v = Math.min(MAX_ENGINE_MULTIPV, Math.max(1, requested));
  const legal = legalMoveCount(fen);
  if (legal > 0) v = Math.min(v, legal);
  return Math.max(1, v);
}

const sendJson = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
};

function parseInfoLine(l) {
  const score = l.match(/score (cp|mate) (-?\d+)/);
  const wdl = l.match(/wdl (\d+) (\d+) (\d+)/);
  const pvMatch = l.match(/ pv (.*)$/);
  return {
    depth: l.match(/depth (\d+)/)?.[1] ? Number(l.match(/depth (\d+)/)[1]) : null,
    multipv: l.match(/multipv (\d+)/)?.[1] ? Number(l.match(/multipv (\d+)/)[1]) : null,
    score: score ? { type: score[1], value: Number(score[2]) } : null,
    wdl: wdl ? { win: Number(wdl[1]), draw: Number(wdl[2]), loss: Number(wdl[3]) } : null,
    pv: pvMatch ? pvMatch[1].split(' ') : [],
  };
}

/** 从一次搜索的输出行里，取每路 multipv 最深的一条，并汇总局面分/胜率。 */
function summarize(lines) {
  const by = new Map();
  for (const l of lines) {
    const p = parseInfoLine(l);
    if (!p.multipv || !p.score) continue;
    const cur = by.get(p.multipv);
    if (!cur || (p.depth ?? 0) > (cur.depth ?? 0)) by.set(p.multipv, p);
  }
  const moves = [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([multipv, p]) => ({
      rank: multipv,
      move: p.pv[0] || null,
      score: p.score,
      depth: p.depth,
      pv: p.pv,
    }));
  const best = by.get(1);
  return { moves, score: best?.score ?? null, wdl: best?.wdl ?? null, depth: best?.depth ?? null };
}

/** 常驻引擎宿主：惰性启动、单会话、串行搜索、崩溃后自动重启、旧请求即时"让路"。 */
class EngineHost {
  constructor({ threads = 4, hash = 64 } = {}) {
    this.threads = threads;
    this.hash = hash;
    this.engine = null;
    this.queue = Promise.resolve();
    this.latest = 0;      // 最新一次请求的 id，旧的排队请求据此视为 stale 直接跳过
    this.searching = false;
    this._wake = null;    // go infinite 模式下的可中断延时
  }

  async ensure() {
    if (!this.engine) {
      this.engine = new PikafishClient(EXE, { cwd: RELEASE });
      await this.engine.init({ threads: this.threads, hash: this.hash });
      await this.engine.setOption('UCI_ShowWDL', 'true');
      if (this.engine.lines.some((l) => l.startsWith('!ENGINE'))) {
        throw new Error('Pikafish 引擎启动失败，请检查 release 目录');
      }
    }
    return this.engine;
  }

  /** 打断当前正在进行的搜索（发 stop + 唤醒延时），让引擎尽快交还搜索权。 */
  interrupt() {
    if (this._wake) {
      const w = this._wake;
      this._wake = null;
      w();
    }
    if (this.engine && this.searching) {
      try {
        this.engine.send('stop');
      } catch {}
    }
  }

  /** 可被 interrupt() 提前唤醒的"条件等待"：
   * 每 40ms 轮询一次 cond()，条件成立或超过 maxMs 即返回（比纯延时更能控制搜索深度）。 */
  _until(cond, maxMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        let done = false;
        try {
          done = cond();
        } catch {
          done = true;
        }
        if (done || Date.now() - start >= maxMs) {
          clearInterval(timer);
          this._wake = null;
          resolve();
        }
      }, 40);
      this._wake = () => {
        clearInterval(timer);
        this._wake = null;
        resolve();
      };
    });
  }

  /**
   * 单会话串行分析。
   *  - 轻量：movetime 模式（客户端 500ms 快查）
   *  - 深度：go infinite -> 一直搜到主变深度达到 minDepth（或超过 delay 上限）-> stop，
   *    一次收齐全 MultiPV 得分。minDepth 保证"深度到位"，delay 只是最坏情况护栏，
   *    结果比固定延时更稳、更快。
   * id 用于"最新请求取胜"：更新请求到达时打断旧搜索，旧任务短路返回 stale，
   * 优先级低的排队任务在新请求到来前根本不落地到引擎。
   */
  analyze(fen, { multiPV = 5, movetime = 500, infinite = false, delay = 800, minDepth = 0 } = {}, id = 0) {
    if (id > this.latest) this.latest = id;
    if (this.searching) this.interrupt();

    const job = async () => {
      if (id !== this.latest) return { ok: false, stale: true };
      const engine = await this.ensure();
      if (id !== this.latest) return { ok: false, stale: true };
      this.searching = true;
      try {
        const start = engine.lines.length;
        engine.send(`setoption name MultiPV value ${capMultiPV(multiPV, fen)}`);
        engine.setPositionFEN(fen);

        if (infinite) {
          engine.go(); // -> "go infinite"
          let scan = start;
          let topDepth = 0;
          await this._until(() => {
            while (scan < engine.lines.length) {
              const p = parseInfoLine(engine.lines[scan++]);
              if (p.multipv === 1 && p.depth) topDepth = Math.max(topDepth, p.depth);
            }
            return minDepth > 0 && topDepth >= minDepth;
          }, delay);
          engine.send('stop');
        } else {
          engine.go({ movetime });
        }

        // 始终消费 bestmove 行：既能拿到结果，也能保证被打断的旧搜索清空缓存行，
        // 不会把上一步的 bestmove 误配给下一个请求。
        const bm = await engine.awaitBestmove(30000);
        if (id !== this.latest) return { ok: false, stale: true };
        if (!bm.bestmove) throw new Error('引擎未返回着法');

        const lines = engine.lines.slice(start);
        const { moves, score, wdl, depth } = summarize(lines);
        return {
          ok: true,
          bestmove: bm.bestmove,
          ponder: bm.ponder || null,
          moves,
          score,
          wdl,
          depth,
        };
      } finally {
        this.searching = false;
      }
    };

    const task = this.queue.then(job).catch((err) => {
      this.dispose();
      throw err;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  dispose() {
    if (this.engine) {
      try {
        this.engine.quit();
      } catch {}
      this.engine = null;
    }
  }

  /**
   * 新开局专用：打断进行中的搜索并让引擎清空上一局的搜索记忆（ucinewgame）。
   * 比"杀掉子进程重启"轻量得多：进程常驻、只需清哈希表，无需重新 spawn/UCI 握手。
   * 走串行队列保证 ucinewgame 一定排在任何后续 go 之前，不会吞掉新搜索的应答。
   */
  async resetEngine() {
    this.interrupt();
    if (!this.engine) return;
    const task = this.queue.then(() => {
      if (!this.engine) return;
      try {
        this.engine.send('ucinewgame');
        return this.engine.isReady();
      } catch {}
    });
    this.queue = task.catch(() => {});
    await this.queue;
  }
}

export function pikafishPlugin(options = {}) {
  const host = new EngineHost(options);

  const middleware = (req, res, next) => {
    if (!req.url || !/\/__pikafish\/analyze$/.test(req.url)) return next();
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', async () => {
      try {
        const { fen, multiPV = 5, movetime = 500, infinite = false, delay = 800, minDepth = 0, id = 0 } = JSON.parse(body || '{}');
        if (!fen) {
          sendJson(res, 400, { ok: false, error: 'missing fen' });
          return;
        }
        const r = await host.analyze(fen, { multiPV, movetime, infinite, delay, minDepth }, id);
        if (r.stale) {
          sendJson(res, 200, { ok: false, stale: true });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          fen,
          sideToMove: fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'red',
          ...r,
        });
      } catch (e) {
        sendJson(res, 200, { ok: false, error: String(e?.message || e) });
      }
    });
  };

  const resetHandler = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    try {
      await host.resetEngine();
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: String(e?.message || e) });
    }
  };

  return {
    name: 'pikafish',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && /\/__pikafish\/reset$/.test(req.url)) return resetHandler(req, res);
        return next();
      });
      server.middlewares.use(middleware);
      server.httpServer?.on('close', () => host.dispose());
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && /\/__pikafish\/reset$/.test(req.url)) return resetHandler(req, res);
        return next();
      });
      server.middlewares.use(middleware);
      server.httpServer?.on('close', () => host.dispose());
    },
    closeBundle() {
      host.dispose();
    },
  };
}