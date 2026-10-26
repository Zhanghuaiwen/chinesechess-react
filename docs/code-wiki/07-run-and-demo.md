# 07 运行、验证与演示

## 1. 环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | 20+（Vite 8 建议 20.19+ / 22.12+） |
| npm | 10+ |
| 系统 | Windows（Pikafish.exe 为 Windows 构建；其它平台需替换引擎二进制） |
| 浏览器 | Chrome / Edge（Web Animations、Canvas、PWA） |

---

## 2. 安装

```bash
# 仓库根目录
npm install

# 服务端单独安装（有自己的 package.json）
npm --prefix server install
```

---

## 3. 启动（两个终端）

### 终端 A：联机服务

```bash
npm run server
# 等价：npm --prefix server run start
# 输出：ws://localhost:8787，GET /health
```

健康检查：

```bash
curl http://localhost:8787/health
# {"ok":true,"service":"chinesechess-server","rooms":"in-memory","queue":0}
```

### 终端 B：前端

```bash
npm run dev
# Vite 默认 5173；端口占用会自动 +1（本机常用 5174）
```

打开：

```text
http://localhost:5173/   或   http://localhost:5174/
```

### 联机房间 / 排位身份

```text
同一房间：http://localhost:5174/?room=demo
排位身份：http://localhost:5174/?pid=alice
         http://localhost:5174/?pid=bob
```

- `room`：进入后填昵称，加入同一房间。
- `pid`：决定 `playerId`（排位档案），不同标签用不同 `pid` 才能匹配到自己以外的人。

---

## 4. Pikafish 引擎

### 4.1 前置文件

```text
Pikafish-master/release/
├─ Pikafish.exe
└─ pikafish.nnue
```

两者必须同目录；缺 `nnue` 时引擎会启动失败或立即退出。

### 4.2 工作方式

```text
npm run dev / npm run preview
  → Vite 插件按需 spawn Pikafish.exe
  → POST /__pikafish/analyze
  → POST /__pikafish/reset
```

### 4.3 联调验证

```bash
npm run engine:verify
# scripts/engine/verify.js：13 项棋盘 ↔ FEN/UCI ↔ 引擎 bestmove 验证
```

验证内容：

- `boardToFEN(initBoard())` 与引擎 StartFEN 完全一致；
- `fenToBoard` 行棋方与棋盘一致；
- `moveToUCI` / `uciToMove` 往返；
- 引擎能返回合法 bestmove；
- 炮/马等特殊走法转换正确。

### 4.4 引擎不可用时

- UI 会显示“引擎未连接/分析不可用”；
- 单机 AI 和联机对战不受影响；
- 纯静态部署（只托管 `dist/`）没有中间件，这是预期行为。

---

## 5. 构建与预览

```bash
npm run build      # 产物 dist/
npm run preview    # http://localhost:4173
```

注意：

- Service Worker 只在 `import.meta.env.PROD` 注册，所以 **PWA 必须 build + preview**；
- preview 同样有 Pikafish 中间件；
- `dist/` 纯静态托管时，联机需要单独跑服务端，引擎分析不可用。

---

## 6. 静态检查

```bash
npm run lint                 # oxlint
cd server && npx tsc --noEmit
npm run build
node --check server/src/*.ts # 不适用 TS，改用 tsc；JS 文件可用 node --check
```

推荐完整验证顺序：

```text
1. npm run lint
2. cd server && npx tsc --noEmit
3. npm run build
4. npm run engine:verify
5. 4 个冒烟脚本
```

---

## 7. 冒烟测试（74 项）

| 脚本 | 断言数 | 前置 | 说明 |
| --- | --- | --- | --- |
| `node server/scripts/smoke.mjs` | 13 | 8787 在跑 | P0：房间、走子、拒绝、认输、快照 |
| `node server/scripts/smoke-p1.mjs` | 26 | 无（自建 8799） | P1：匹配、ELO、排行榜、档案 |
| `node server/scripts/smoke-p2.mjs` | 13 | 8787 在跑 | P2：重连、伪造 sessionId、超时判负 |
| `node server/scripts/smoke-auth.mjs` | 22 | 无（自建 8801） | P4：注册、登录、令牌、游客迁移 |

### P2 的短宽限期

```powershell
# 终端 A（PowerShell）
$env:RECONNECT_GRACE_MS=2000; npm run server
```

```bash
# 终端 B
node server/scripts/smoke-p2.mjs
```

脚本会从快照读取 `graceMs`，所以 2000 或 30000 都能跑，只是 30 秒会等很久。

### 隔离端口

- P1 默认 8799；可用 `SMOKE_PORT` 覆盖。
- Auth 默认 8801；可用 `SMOKE_PORT` 覆盖。
- P0/P2 默认 `ws://localhost:8787`；可用 `WS_URL` 覆盖。

---

## 8. 端口与环境变量

| 端口 | 用途 |
| --- | --- |
| 8787 | 联机服务 HTTP + WebSocket |
| 5173/5174 | Vite 开发服（自动 +1） |
| 4173 | Vite preview |
| 8799 | P1 冒烟隔离实例 |
| 8801 | Auth 冒烟隔离实例 |

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PORT` | 8787 | 服务端端口 |
| `HOST` | 0.0.0.0 | 监听地址（局域网可访问） |
| `RECONNECT_GRACE_MS` | 30000 | 断线宽限期 |
| `RATINGS_FILE` | `server/data/ratings.json` | 排位档案 |
| `ACCOUNTS_FILE` | `server/data/accounts.json` | 账号/会话 |
| `WS_URL` | `ws://localhost:8787` | 冒烟脚本目标 |
| `SMOKE_PORT` | 8799/8801 | P1/Auth 隔离端口 |
| `VITE_WS_URL` | 自适应 | 前端显式指定联机地址 |

前端默认地址：

```text
ws://<页面 host>:8787
```

所以局域网用 `http://10.x.x.x:5174` 打开，会自动连 `ws://10.x.x.x:8787`。

---

## 9. 局域网访问

1. 服务端监听 `0.0.0.0:8787`；
2. Vite `server.host = true`；
3. Windows 防火墙放行 5174/8787（管理员 PowerShell）：

```powershell
netsh advfirewall firewall add rule name="CC-5174" dir=in action=allow protocol=TCP localport=5174
netsh advfirewall firewall add rule name="CC-8787" dir=in action=allow protocol=TCP localport=8787
```

4. 另一台设备访问 `http://<本机IP>:5174/`。

---

## 10. 数据重置

```text
server/data/ratings.json    → 删除或置为 []
server/data/accounts.json   → 删除或置为 { "accounts": [], "sessions": [] }
```

重启服务端生效。注意：删除账号文件会同时清掉所有 token 和会话。

---

## 11. 常见故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 联机一直“连接中” | 服务端没跑 / 端口占用 / 防火墙 | 先访问 `/health`；确认 8787；放行防火墙 |
| 两个标签匹配不到 | 用了同一个 `pid` | 分别用 `?pid=alice` / `?pid=bob` |
| 房间加入后没对手 | 房间号不一致 / 一个已在别的局 | 统一 `?room=`；检查是否已在对局中 |
| 引擎面板“未连接” | exe 缺失 / nnue 缺失 / 非 dev/preview | 检查 `Pikafish-master/release`；用 dev/preview 打开 |
| 引擎分析超时 | 引擎崩溃 / MultiPV 过大 / 旧请求卡住 | 看 Vite 终端日志；重启 dev；确认 MultiPV ≤128 |
| PWA 不生效 | 在 dev 下打开 / 旧 SW 缓存 | `npm run build && npm run preview`；DevTools 清 SW |
| 刷新后没恢复对局 | sessionStorage 被清 / 超过 30 秒 | 同标签刷新；检查宽限期；看 `resume_failed` |
| 走子提示“状态已更新” | `stale_seq` | 正常自愈；观察是否频繁双发 |
| 排行榜没有自己 | 0 场 / 未登录且 pid 不同 | 打一局排位；确认 `pid` |
| `tsc` 报错 | 服务端类型 | `cd server && npx tsc --noEmit` 看具体文件 |
| `oxlint` 告警 | 未使用变量/导入 | 修掉再 build |

---

## 12. 五分钟演示脚本（按 UI 顺序）

### 0. 演示前检查（30 秒）

- 服务端 `/health` 返回 ok；
- 前端 `dev` 打开无报错；
- 引擎面板显示“已连接”；
- 准备两个标签：`?pid=alice`、`?pid=bob`；
- 准备一个房间号：`?room=demo`。

### 1. 单机基础（40 秒）

1. 难度“中等” → 开始对局；
2. 走“炮二平五”；
3. AI 应手；
4. 指出：棋谱、将军提示、计时、音效。

**讲**：规则来自 `shared/gameLogic`，AI 是本地 Minimax，不依赖网络。

### 2. 算法面板（40 秒）

1. 难度切“困难”；
2. 走一步；
3. 打开“对局数据”；
4. 讲：节点数、剪枝数、`depthReached`、耗时。

**讲**：迭代加深 + Alpha-Beta；时间预算的缺陷也主动说。

### 3. 大师辅助（60 秒）

1. 点“开启大师”（Pikafish 辅助）；
2. 点己方棋子；
3. 黄点=优等走法，绿点=其余合法；
4. 右侧胜率条、TopN；
5. 走动一步看热力图变化。

**讲**：MultiPV、相对排名、视角统一、logistic 软胜率。

### 4. 皮卡鱼大师（40 秒）

1. 难度切“皮卡鱼大师”；
2. 走一步，等 AI 应手；
3. 讲 Vite 中间件、UCI、串行队列、`id` 失效。

### 5. 联机与重连（90 秒）

1. 两个标签都进 `?room=demo`；
2. 各自填昵称，加入；
3. A 走一步，B 看到同步；
4. 关闭 B 的标签；
5. A 看到“对手离线 + 倒计时”；
6. 30 秒内重新打开 B（同标签刷新），自动 resume；
7. 讲 `sessionId`、全量快照、宽限期。

### 6. 排位（40 秒）

1. `?pid=alice` 与 `?pid=bob`；
2. 都点“随机匹配”；
3. 匹配成功，下一局；
4. 一方认输；
5. 展示 `rating.update` 与排行榜。

**讲**：Elo、K=32、零和、band 放宽。

### 7. PWA（30 秒，可选）

```bash
npm run build && npm run preview
```

1. 打开 4173；
2. DevTools → Application → Manifest/Service Worker；
3. 断网，刷新，外壳仍可打开；
4. 讲：离线只保证外壳 + 单机，联机/引擎需要服务。

---

## 13. 演示时的“叙事节奏”

不要按功能清单念，按问题讲：

```text
问题 1：规则会不会两边不一致？ → shared + 服务端裁决
问题 2：网络断了怎么办？     → sessionId + 快照 + 宽限
问题 3：AI 怎么下棋？         → Minimax + Alpha-Beta
问题 4：怎么更强/可分析？     → Pikafish + UCI + MultiPV
问题 5：怎么证明？            → 74 项冒烟 + 引擎联调 + build/lint/tsc
```

每讲完一个，停 2 秒，等面试官追问；不要一口气讲完所有细节。

---

## 14. 面试现场“只让我看代码”时的打开顺序

1. [shared/gameLogic.js](../shared/gameLogic.js)：从 `getLegalMoves` 看规则；
2. [server/src/room.ts](../server/src/room.ts)：从 `applyMove` 看权威校验；
3. [server/src/gateway.ts](../server/src/gateway.ts)：从 `room.resume` / `handleClose` 看重连；
4. [src/services/aiService.js](../src/services/aiService.js)：从 `minimax` 看搜索；
5. [vite-plugin-pikafish.js](../vite-plugin-pikafish.js)：从 `analyze` 看串行队列；
6. [src/hooks/useGame.js](../src/hooks/useGame.js)：从 `triggerAIMove` 看异步竞态。

这个顺序的好处：**规则 → 权威 → 恢复 → 算法 → 引擎 → 前端**，每条都能独立讲 1 分钟。
