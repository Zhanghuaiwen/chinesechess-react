import { spawn } from 'node:child_process';

/**
 * 轻量 UCI 客户端：把 Pikafish.exe 作为子进程，通过 stdin/stdout 交互。
 * 线程安全地等待某行出现；引擎所有输出行都保留在 this.lines 中。
 */
export class PikafishClient {
  constructor(exePath, { cwd } = {}) {
    this.child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    this.buf = '';
    this.lines = [];
    this.waiters = [];
    this.onLine = [];
    this.exited = false;

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d) => {
      this.buf += d;
      let idx;
      while ((idx = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, idx).replace(/\r$/, '');
        this.buf = this.buf.slice(idx + 1);
        this._push(line);
      }
    });
    this.child.on('error', (e) => this._push(`!ENGINE-ERROR: ${e.message}`));
    this.child.on('exit', (code) => {
      this.exited = true;
      this._push(`!ENGINE-EXIT: ${code}`);
    });
  }

  _push(line) {
    this.lines.push(line);
    this.waiters = this.waiters.filter((w) => !w(line));
    for (const cb of this.onLine) cb(line);
  }

  send(cmd) {
    this.child.stdin.write(cmd + '\n');
  }

  waitFor(match, { timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const pred = (l) =>
        l.startsWith('!ENGINE') ||
        (typeof match === 'string' ? l.startsWith(match) : match(l));
      const startIdx = this.lines.length;
      for (let i = startIdx; i < this.lines.length; i++) if (pred(this.lines[i])) return resolve(this.lines[i]);
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`等待超时: ${typeof match === 'string' ? match : '<fn>'}`));
      }, timeout);
      const waiter = (l) => {
        if (pred(l)) {
          clearTimeout(t);
          resolve(l);
          return true;
        }
        return false;
      };
      this.waiters.push(waiter);
    });
  }

  async init({ threads, hash } = {}) {
    this.send('uci');
    await this.waitFor('uciok');
    if (threads) await this.setOption('Threads', threads);
    if (hash) await this.setOption('Hash', hash);
    await this.isReady();
  }

  async isReady() {
    this.send('isready');
    await this.waitFor('readyok');
  }

  async setOption(name, value) {
    this.send(`setoption name ${name} value ${value}`);
    await this.isReady();
  }

  setPositionFEN(fen, moves = []) {
    this.send(
      moves.length ? `position fen ${fen} moves ${moves.join(' ')}` : `position fen ${fen}`,
    );
  }

  setPositionStartpos(moves = []) {
    this.send(moves.length ? `position startpos moves ${moves.join(' ')}` : 'position startpos');
  }

  go({ movetime, depth, nodes } = {}) {
    const args = [];
    if (movetime) args.push(`movetime ${movetime}`);
    if (depth) args.push(`depth ${depth}`);
    if (nodes) args.push(`nodes ${nodes}`);
    if (args.length === 0) args.push('infinite');
    this.send(`go ${args.join(' ')}`);
  }

  async awaitBestmove(timeout = 30000) {
    const line = await this.waitFor((l) => l.startsWith('bestmove'), { timeout });
    const m = line.match(/^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/);
    return { bestmove: m ? m[1] : null, ponder: m ? m[2] : null };
  }

  quit() {
    try {
      this.send('quit');
    } catch {}
    setTimeout(() => {
      if (!this.exited) this.child.kill();
    }, 500);
  }
}
