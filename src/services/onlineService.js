/**
 * 联机服务客户端：原生 WebSocket 封装。
 *
 * 为什么要自己实现而不直接用 socket.io：
 *   心跳探测、断线检测、重连策略都由我方掌控，能体现工程细节。
 * 本层只负责「连接 / 收发 / 心跳」，不含任何游戏语义 —— 游戏状态由 useOnlineGame 承载。
 */
const DEFAULT_URL = import.meta.env?.VITE_WS_URL || 'ws://localhost:8787';

/** 应用层心跳间隔（毫秒） */
const HEARTBEAT_MS = 15000;
/** 超过此时长未收到 pong 即判定链路已死，主动断开触发自动重连 */
const PONG_TIMEOUT_MS = 40000;
/** 自动重连：指数退避 1s / 2s / 4s / 8s…，单次上限 16s，最多 8 次 */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 16000;
const RECONNECT_MAX_ATTEMPTS = 8;

export const WS_URL = DEFAULT_URL;

export class OnlineClient {
  constructor(url = DEFAULT_URL) {
    this.url = url;
    this.ws = null;
    // idle | connecting | open | reconnecting | closed
    this.status = 'idle';
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.hbTimer = null;
    this.reconnectTimer = null;
    this.attempt = 0;
    this.lastPong = 0;
    this.manualClose = false;
  }

  onMessage(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.manualClose = false;
    this.setStatus(this.attempt > 0 ? 'reconnecting' : 'connecting');

    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      console.error('[online] WebSocket 创建失败:', e);
      this.setStatus('closed');
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.lastPong = Date.now();
      this.attempt = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.setStatus('open');
      this.startHeartbeat();
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        this.lastPong = Date.now();
        return; // 心跳不向上层暴露
      }
      for (const fn of this.listeners) fn(msg);
    });

    ws.addEventListener('close', () => {
      this.stopHeartbeat();
      if (this.ws === ws) this.ws = null;
      if (this.manualClose) {
        this.setStatus('idle');
        return;
      }
      this.scheduleReconnect();
    });

    // 连接层错误统一由 close 事件收尾，这里只记录
    ws.addEventListener('error', () => {
      console.warn('[online] WebSocket 连接异常');
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      this.send({ t: 'ping', ts: Date.now() });
      if (Date.now() - this.lastPong > PONG_TIMEOUT_MS) {
        console.warn('[online] 心跳超时，主动断开');
        this.ws.close();
      }
    }, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  /** 断线后按指数退避自动重连；超过最大次数则彻底置为 closed 交由上层提示。 */
  scheduleReconnect() {
    if (this.manualClose) return;
    if (this.attempt >= RECONNECT_MAX_ATTEMPTS) {
      this.setStatus('closed');
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    this.attempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  close() {
    this.manualClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    if (this.ws) this.ws.close();
    this.ws = null;
    this.setStatus('idle');
  }
}
