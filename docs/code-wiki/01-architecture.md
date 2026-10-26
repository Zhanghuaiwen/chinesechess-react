# 01 整体架构与依赖关系

## 1. 系统上下文

```text
┌──────────────────────────────── 浏览器（单页应用 + PWA） ────────────────────────────────┐
│                                                                                          │
│  React UI（App / Board / 面板）                                                           │
│    │                                                                                     │
│    ├── useGame ───────────────► shared/gameLogic.js（规则、走法、记谱、评估）              │
│    │     └── aiService（Minimax + Alpha-Beta）                                            │
│    │                                                                                     │
│    ├── useOnlineGame ─────────► onlineService（WebSocket 客户端）                          │
│    │                                                                                     │
│    └── EngineController ──────► HTTP POST /__pikafish/analyze                             │
│          ├── UIManager（原始行 → 棋子落点 / 热力图 / 侧栏）                                 │
│          ├── HeatmapRenderer（Canvas 覆盖层）                                              │
│          └── PikafishPanel（胜率条、推荐走法）                                             │
│                                                                                          │
│  Service Worker（生产构建）：应用外壳 / 引擎二进制 / 图标分离缓存                            │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                    │ WebSocket (JSON)                       │ HTTP (dev server 中间件)
                    ▼                                        ▼
┌──────────────────────── Node.js 联机服务（:8787） ─────────┐   ┌──── Vite 进程（dev/preview）────┐
│ index.ts：HTTP /health + WebSocketServer                    │   │ EngineHost（单例）               │
│   └── gateway.ts：消息路由 / 参数校验 / 断线处理             │   │   ├── 串行队列 + 递增 id         │
│         ├── Store：房间 & 对局注册表                         │   │   └── PikafishClient（UCI）      │
│         ├── Matchmaker：匹配队列 + Elo 结算                  │   └──────────────┬──────────────────┘
│         ├── RatingsStore / AccountsStore：JSON 持久化        │                  │ stdin/stdout
│         └── Game：唯一权威棋盘                               │                  ▼
│               └── shared/gameLogic.js（同一份规则）          │          Pikafish.exe + NNUE
└─────────────────────────────────────────────────────────────┘
```

三个进程边界要讲清楚：

1. **浏览器进程**：拥有 UI 状态和本地对局；联机时只拥有“服务端快照的投影”。
2. **Node 服务进程**：拥有联机对局的唯一真相；浏览器断开不影响对局继续。
3. **引擎子进程**：由 Vite 进程托管；浏览器永远不直接接触 exe，只通过 HTTP 拿结构化分析结果。

---

## 2. 分层与依赖方向

```text
UI 组件层        App / Board / Cell / GameInfo / MoveList / StatsPanel / PikafishPanel / OnlineGame
   │  props / 订阅
状态与编排层      useGame / useOnlineGame / EngineController / OnlineClient
   │               │
领域服务层        aiService（搜索）        UIManager（分析结果整形）        gateway（协议路由）
   │               │                        │
规则与模型层      shared/gameLogic.js  ◄────┴──────────── server/src/room.ts
                  shared/fen.js                         server/src/matchmaker.ts / rating.ts
   │
基础设施层        浏览器 Canvas / Web Audio / fetch / WebSocket
                  Node ws / fs / crypto / child_process
```

依赖规则（也是面试可以讲的“架构约束”）：

- `shared/` **不依赖** React、Node、DOM，只依赖纯 JS，所以能同构。
- `server/` 只依赖 `shared/`，不依赖 `src/`。
- `src/` 可以依赖 `shared/`，但不依赖 `server/`（协议类型是手写对齐，不是跨端 import）。
- 引擎客户端 `scripts/engine/pikafish-client.js` 只被 Vite 插件引用，不被浏览器 bundle 引用。

依赖矩阵：

| 模块 | React | shared | server | ws | fs/crypto | child_process |
| --- | --- | --- | --- | --- | --- | --- |
| `src/hooks/useGame.js` | 是 | 是 | 否 | 否 | 否 | 否 |
| `src/services/aiService.js` | 否 | 是 | 否 | 否 | 否 | 否 |
| `src/services/onlineService.js` | 否 | 否 | 否 | 浏览器 WebSocket | 否 | 否 |
| `src/engine/EngineController.js` | 否 | 是 | 否 | 否 | 否 | 否 |
| `server/src/gateway.ts` | 否 | 是 | 是 | 是 | 否 | 否 |
| `server/src/room.ts` | 否 | 是 | 是 | 是 | 否 | 否 |
| `server/src/ratings.ts` | 否 | 否 | 是 | 否 | 是 | 否 |
| `vite-plugin-pikafish.js` | 否 | 是 | 否 | 否 | 是 | 是 |

---

## 3. 运行时拓扑（三种形态）

### 3.1 开发（dev）

- `npm run server`：`tsx server/src/index.ts`，监听 8787。
- `npm run dev`：Vite，默认 5173（被占用则 5174）。
- Pikafish 由 Vite 插件在 `configureServer` 中按需启动。
- 前端 WebSocket 地址：`ws://<当前 host>:8787`；可用 `?server=` / `?http=` 覆盖。

### 3.2 预览（preview）

- `npm run build` → `npm run preview`（4173）。
- Service Worker 只在 `import.meta.env.PROD` 注册，所以 PWA 必须走 preview。
- Pikafish 插件在 `configurePreviewServer` 中同样可用。

### 3.3 纯静态部署

- 前端可以托管到任意静态服务器，联机服务单独部署（WebSocket 地址需反代）。
- **Pikafish 不可用**：没有 Vite 中间件。前端会进入分析不可用状态，本地 AI 和联机不受影响。
- 这也是“为什么引擎只能演示、不能算线上能力”的边界。

---

## 4. 状态所有权矩阵（面试高频）

| 状态 | 唯一所有者 | 其他角色的副本 | 同步方式 |
| --- | --- | --- | --- |
| 单机棋盘/回合/计时 | `useGame` | 组件通过 props | 同进程状态 |
| 联机棋盘/回合/终局 | 服务端 `Game` | `useOnlineGame` 的快照 | 全量快照 `game.state` |
| 房间注册表 | `Store`（进程内存） | 无 | 不暴露 |
| 匹配队列 | `Matchmaker` | 客户端 `match.queued` 倒计时 | 服务端推送 |
| 排位分 | `RatingsStore`（JSON） | `profile` / `leaderboard` | 请求 + 推送 |
| 账号/令牌 | `AccountsStore`（JSON） | `auth.ok` 中的 user | 请求 |
| 引擎分析结果 | `EngineController`（浏览器内存） | `PikafishPanel` 订阅 | 发布订阅 |
| 断线座位 | `Game.Player.sessionId` | `sessionStorage` | `room.resume` |

一条重要的判断：

> 联机模式下，客户端**不允许**自行推进棋盘。它可以在点击时做本地合法性提示，但最终以服务端快照为准。这样双发、乱序、作弊都收敛到服务端的单点裁决。

---

## 5. 核心数据契约

### 5.1 棋盘

```js
// Cell = { type, color, label }，空格为 null
board[row][col]        // row 0 = 黑方底线，row 9 = 红方底线
```

- 选择二维数组而不是 90 长度一维数组：走法生成大量使用 `r/c` 偏移，二维可读性更高；棋盘的序列化体积很小，不是瓶颈。
- 棋子对象包含 `type`（逻辑）、`color`、`label`（中文显示），避免 UI 再维护映射。

### 5.2 快照（`GameSnapshot`）

```ts
{
  t: 'game.state',
  gameId, roomId,
  board,                 // 10×9
  turn: 'red' | 'black',
  moves: MoveRecord[],   // seq/from/to/notation/color/captured
  seq,                   // 权威版本号
  status: 'waiting' | 'playing' | 'over',
  winner, reason,
  players: PlayerInfo[], // 含 connected / rating
  youAre: 'red' | 'black' | null,
  offline: { color, deadline } | null,
  graceMs, ranked
}
```

快照同时承担四种职责：**恢复、对齐、展示、结算依据**。这是选择“全量”而不是“增量”的直接原因。

### 5.3 走子意图

```ts
{ t: 'game.move', gameId, baseSeq, from: {r,c}, to: {r,c} }
```

`baseSeq` 是客户端认为自己基于的版本。服务端只在 `baseSeq === seq` 时接受。它不是严格锁，而是**乐观并发控制**：冲突时拒绝 + 回带当前序号，客户端重新同步。

---

## 6. 关键架构决策（ADR 速记）

### ADR-1 规则同构，服务端裁决

- 背景：如果前后端各写一套规则，边界条件（蹩马腿、塞象眼、飞将、炮架）迟早不一致。
- 决策：规则只写一份，放在 `shared/`；前端用于提示，服务端用于裁决。
- 代价：共享文件必须保持零环境依赖；类型用 JSDoc/TS 各自适配。
- 收益：规则 bug 只需修一处；联机不会出现“双方看到不同合法着法”。

### ADR-2 服务端权威 + 客户端投影

- 背景：联机对局必须防双发、防乱序、防篡改。
- 决策：`Game.applyMove` 是唯一入口；客户端只提交意图，接收全量快照。
- 代价：每次走子多一次广播；客户端要做“乐观 UI + 失败回滚”。
- 收益：一致性可证明；断线恢复只需一次快照。

### ADR-3 全量快照而不是增量事件

- 背景：增量同步需要处理丢包、乱序、重放、补偿，复杂度高。
- 决策：每次状态变化广播完整棋盘 + 走子历史 + 元信息。
- 代价：带宽略大（10×9×小对象，实际几 KB）。
- 收益：任意时刻收到快照都能直接渲染；重连不需要 replay。

### ADR-4 会话凭据与排位身份分离

- `playerId`：跨对局的排位身份，存 `localStorage`，可迁移到账号。
- `sessionId`：单局座位凭据，存 `sessionStorage`，只用于 reclaim 座位。
- `token`：账号登录令牌，存 `localStorage`，用于身份恢复。
- 分离的原因：换账号不应丢座位；换设备不应继承排位；刷新不应重新登录。

### ADR-5 本地 AI 与原生引擎并存

- 本地 Minimax：离线、零依赖、可解释（能看到节点/剪枝/深度）。
- Pikafish：棋力上限、实时评分、MultiPV。
- 决策：难度选项里同时提供两者，而不是二选一。
- 代价：两套 AI 调度路径（同步搜索 vs 异步 HTTP）都要处理。

### ADR-6 Vite 中间件托管引擎

- 背景：浏览器不能 spawn 本地进程；UCI 是行协议。
- 决策：Vite 插件启动常驻子进程，暴露两个 HTTP 端点。
- 代价：只在 dev/preview 可用；生产要换成独立服务。
- 收益：零额外后端即可演示原生引擎；串行队列和失效逻辑集中在服务端。

### ADR-7 单进程内存 + JSON 落盘

- 背景：项目目标是单机/小型联机演示，不想引入数据库运维。
- 决策：房间/队列在内存，排位/账号原子写 JSON。
- 代价：重启丢房间；不能多实例；写盘不是事务。
- 收益：零外部依赖，克隆即跑；数据可读可备份。

### ADR-8 手写 Service Worker

- 背景：只有四类资源，缓存策略明确。
- 决策：自己写 install/fetch/activate，版本化缓存。
- 代价：要自己处理 `skipWaiting`、旧缓存清理、导航回退。
- 收益：无构建期依赖，策略可逐行解释。

---

## 7. 失败模型与边界

| 失败 | 当前行为 | 改进方向 |
| --- | --- | --- |
| 浏览器断网 | 指数退避重连；30 秒内 `room.resume` 恢复 | 更长宽限 + 服务端倒计时展示 |
| 服务端重启 | 内存对局丢失；客户端 `resume` 失败后回大厅 | 房间快照持久化 / Redis |
| 引擎 exe 缺失 | 分析接口返回 `ENGINE_ERROR`，UI 提示不可用 | 启动时健康检查 + 明确文案 |
| 引擎崩溃 | 当前 job 失败并 `dispose`，下次请求重建 | 熔断 + 重启计数 |
| 客户端消息异常 | `parse` 失败静默忽略；部分字段有校验 | 在 dispatch 外层加统一 try/catch |
| 双端同时走子 | 后到者 `stale_seq` 被拒，客户端 `sync.request` | 可加“拒绝原因”埋点 |
| 重复局面 | 三次重复判和（简化规则） | 长将/长捉裁决、自然限着 |

---

## 8. 架构层面的面试可讲点

1. **“为什么 shared 能同构？”** 因为它只做纯函数，不碰 DOM/Node API；输入棋盘和坐标，输出走法/新棋盘/记谱。
2. **“为什么要版本号？”** 网络是异步的，双端可能基于不同状态提交；版本号把“最后写入 wins”变成“基于旧版本写入被拒绝”。
3. **“为什么服务端不信任前端走法？”** 前端校验只是体验优化；服务端必须重新计算 `getSafeMoves`，否则改一行 JS 就能作弊。
4. **“为什么引擎不放在 Node 服务里？”** 当前是开发期工具链，跟 Vite 同生命周期最省部署；生产应独立成分析服务，避免阻塞 API 进程。
5. **“架构最大的债是什么？”** 单进程内存状态。它决定了不能水平扩展、重启即丢局；这是演示项目与生产系统的分水岭。
