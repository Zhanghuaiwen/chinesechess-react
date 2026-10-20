import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handleClose, handleMessage } from './gateway.js';
import { matchmaker } from './matchmaker.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'chinesechess-server', rooms: 'in-memory', queue: matchmaker.waitingCount }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws, req) => {
  const peer = req.socket.remoteAddress ?? 'unknown';
  console.log(`[conn] + ${peer}`);

  ws.on('message', (data) => handleMessage(ws, data.toString()));

  ws.on('close', () => {
    console.log(`[conn] - ${peer}`);
    handleClose(ws);
  });

  ws.on('error', (err) => {
    console.warn(`[conn] error ${peer}: ${err.message}`);
  });
});

http.listen(PORT, HOST, () => {
  console.log(`[server] 象棋联机服务已启动  ws://localhost:${PORT}  (health: /health)`);
  matchmaker.start();
});

function shutdown(): void {
  console.log('\n[server] 正在关闭...');
  wss.close(() => {
    http.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
