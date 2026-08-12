import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PikafishClient } from './scripts/engine/pikafish-client.js';

const RELEASE = join(dirname(fileURLToPath(import.meta.url)), 'Pikafish-master', 'release');
const EXE = join(RELEASE, 'Pikafish.exe');

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

/** 从一次 go 的输出行里，取每路 multipv 最深的一条，并汇总局面分/胜率。 */
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

/** 常驻引擎宿主：惰性启动、单会话、串行搜索、崩溃后自动重启。 */
class EngineHost {
  constructor({ threads = 4, hash = 64 } = {}) {
    this.threads = threads;
    this.hash = hash;
    this.engine = null;
    this.queue = Promise.resolve();
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

  analyze(fen, multiPV, movetime) {
    const run = async () => {
      const engine = await this.ensure();
      const start = engine.lines.length;
      engine.send(`setoption name MultiPV value ${multiPV}`);
      engine.setPositionFEN(fen);
      engine.go({ movetime });
      const bm = await engine.awaitBestmove(30000);
      if (!bm.bestmove) throw new Error('引擎未返回着法');
      const lines = engine.lines.slice(start);
      const { moves, score, wdl, depth } = summarize(lines);
      return {
        bestmove: bm.bestmove,
        ponder: bm.ponder || null,
        moves,
        score,
        wdl,
        depth,
      };
    };
    const job = this.queue.then(run).catch((err) => {
      this.dispose();
      throw err;
    });
    this.queue = job.catch(() => {});
    return job;
  }

  dispose() {
    if (this.engine) {
      try {
        this.engine.quit();
      } catch {}
      this.engine = null;
    }
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
        const { fen, multiPV = 6, movetime = 2500 } = JSON.parse(body || '{}');
        if (!fen) {
          sendJson(res, 400, { ok: false, error: 'missing fen' });
          return;
        }
        const r = await host.analyze(fen, Math.min(128, Math.max(1, multiPV)), movetime);
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

  return {
    name: 'pikafish',
    configureServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.on('close', () => host.dispose());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.on('close', () => host.dispose());
    },
    closeBundle() {
      host.dispose();
    },
  };
}
