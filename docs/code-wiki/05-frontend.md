# 05 前端：状态机、渲染、引擎分析层与 PWA

## 1. 组件与职责

```text
App.jsx
├─ GameInfo            状态栏：回合、计时、将军、提示
├─ Board               棋盘、动画、音效、Canvas 挂载
│  ├─ Cell             单格：棋子/标记/选中/将军/上一步
│  └─ <svg>            九宫斜线，viewBox 随实测几何更新
├─ MoveList            棋谱列表 + 回放
├─ StatsPanel          评估条、子力、搜索统计
├─ PikafishPanel       胜率条、TopN、深算开关
└─ OnlineGame          联机大厅/房间/匹配/排行榜/账号
```

App 负责三件“跨组件”的事：

1. 布局与缩放：`useLayoutEffect` 计算 scale，套在 `.layout` 上。
2. AI 触发：监听局面与 AI 配置，满足条件调用 `triggerAIMove`。
3. 分析联动：监听棋盘/分析结果，把 `UIManager` 的输出交给 Canvas。

---

## 2. 单机状态机 `useGame`

文件：[src/hooks/useGame.js](../src/hooks/useGame.js)

### 2.1 状态分组

| 组 | 状态 | 说明 |
| --- | --- | --- |
| 棋盘 | `board`、`current`、`selected`、`marks`、`lastMove`、`moveSeq` | `moveSeq` 只用于触发动画 |
| 对局 | `started`、`paused`、`gameOver`、`winner`、`log` | 准备/暂停/终局 |
| 棋谱 | `moves`、`history`、`viewIndex` | 历史快照 + 回放 |
| AI | `aiEnabled`、`aiColor`、`aiThinking`、`difficulty`、`aiStats` | AI 调度与统计 |
| 计时 | `redTime`、`blackTime`、`timeLimit` | 每秒扣时 |
| 统计 | `stats` | 走子数、吃子数、将军次数 |

状态多但不拆 store 的原因：

- 所有变更都围绕同一个对局，拆开会产生跨 store 事务；
- 异步 AI 需要读最新局面，用 `ref` 比全局 store 更直接；
- 代价是 hook 很长，后续可以用 `useReducer` 收敛。

### 2.2 历史快照不变量

```text
history[i] = 第 i+1 手走之前的完整状态 { board, current, gameOver }
moves.length === history.length
```

所以：

- 悔棋 = 弹出 k 个快照并恢复；
- 回放 = 取 `history[target]`；
- 不需要反向重放走法。

`undo`：

```text
k = aiEnabled ? (current === aiColor ? 1 : 2) : 1
```

- 玩家刚走完、AI 还没走（当前轮到 AI）→ 回退 1 步；
- AI 已应手（当前轮到玩家）→ 回退 2 步；
- 单机 → 回退 1 步。

### 2.3 走子入口 `doMove`

```text
1. generateNotation(board, from, to, color)
2. makeMove → newBoard / captured
3. setHistory(prev => [...prev, { board, current, gameOver }])
4. setBoard / setCurrent / setLastMove / setMoves / setMoveSeq
5. 吃将 → gameOver
6. 对方无安全着法 → 将死 / 困毙
7. boardKey 第三次 → 和棋
8. 音效 / 日志
```

顺序很重要：**先压历史，再改状态**，否则悔棋会丢一步。

### 2.4 AI 调度与异步竞态

触发链：

```text
App effect（key = started-paused-aiEnabled-aiColor-current-gameOver-aiThinking）
  → triggerAIMove()
      aiRef 上锁
      setAiThinking(true)
      setTimeout(MOVE_MS + 120)
      getAIMove(board, difficulty, aiColor)
      versionRef 校验
      doMove(...)
      finally 解锁
```

三层防竞态：

1. **`aiRef`**：同一时刻只允许一个 AI 任务，防止 effect 重入。
2. **App 的 `prevAITrigger` key**：同一组状态只触发一次。
3. **`versionRef`**：`reset`/`undo`/`replay` 会递增版本；AI 返回后发现版本变了就丢弃结果。

如果不做第三层，典型 bug 是：

```text
AI 思考中 → 玩家点“悔棋” → AI 返回 → 把一个属于旧局面的走法落到新棋盘上
```

### 2.5 计时与开始流程

- 计时 effect 每秒对 `current` 方减 1；`timeLimit = 0` 时不启动。
- `paused`、`gameOver`、`!started` 时暂停。
- 任一方的秒数 ≤0 → 对方胜，`reason=timeout`。
- `start()`：`ready → 1000ms → started → 100ms → 正式启动`，只是交互仪式，不影响规则。

### 2.6 单机与联机的规则一致性

| 环节 | 单机 | 联机 |
| --- | --- | --- |
| 人类可走格 | `getSafeMoves` | `getSafeMoves`（仅提示） |
| 落子裁决 | `doMove` 内部 | 服务端 `Game.applyMove` |
| 终局 | `hasLegalMove` / 重复 / 计时 | 服务端 `hasLegalMove` / 重复 / 认输 / 断线 |
| 初始局面重复计数 | 构造时计入 1 次 | `Game` 构造时计入 1 次 |

P4 修过一个细节：单机最初没有把初始局面计入重复计数，导致“回到初始局面”要第 4 次才判和；现在与服务端一致。

---

## 3. 联机状态机 `useOnlineGame`

文件：[src/hooks/useOnlineGame.js](../src/hooks/useOnlineGame.js)

### 3.1 阶段

```text
lobby → waiting（房间等待）
      → queuing（匹配中）
      → playing
      → over
      → resuming（重连中）
```

`phase` 是 UI 的唯一分支依据；服务端消息只负责推进它。

### 3.2 意图重放（`desiredRef`）

重连后应该恢复什么？

```js
desiredRef = { type: 'join', roomId, name }
           | { type: 'match', playerId, name, token }
           | { type: 'resume' }
```

- `open` 时如果已有 `session`，`desiredRef = resume`；
- 否则按用户最后一次操作重放 join/match；
- 这样“断线时正在匹配”会重新入队，“断线时在房里”会重新进房，“断线时在对局中”会 resume。

### 3.3 会话持久化

```js
sessionStorage['cc.online.session'] = { gameId, roomId, sessionId, youAre }
```

- 刷新页面：sessionStorage 还在 → 自动 `room.resume`；
- 关闭标签页：sessionStorage 清空 → 下次进入大厅；
- 对局结束/恢复失败/主动离开 → 清 session。

为什么不用 localStorage：

- 多标签会共享 localStorage，容易出现“两个标签抢同一个座位”；
- sessionStorage 天然按标签隔离，符合“一个标签一局”的模型。

### 3.4 快照应用 `applySnapshot`

```text
1. 计算 lastMove：
   用 prevBoard 与新 board 做差，找 from/to/captured
2. 设置 board / current / moves / seq / status
3. status=waiting → phase waiting
4. status=over   → phase over，清 session
5. 否则 phase playing，根据 youAre 生成提示
```

为什么要从棋盘差重建 `lastMove`：

- 快照只保证最终状态，不保证携带动画所需的 `from/to/piece`；
- 本地做差可以复用同一套 Board 动画，无需协议额外字段；
- 代价是多一次 90 格扫描，可忽略。

### 3.5 走子与错误处理

```text
onCellClick → 本地 getSafeMoves 提示 → makeMove 乐观落子
  → send game.move{baseSeq: seq}
  → accepted：等待快照（快照会覆盖乐观结果）
  → rejected(stale_seq)：提示 + sync.request
  → rejected(illegal/not_your_turn)：提示 + 回滚由下一帧快照完成
```

严格说，当前是“**乐观 UI + 快照收敛**”而不是完整回滚：

- 本地先落子是为了手感；
- 服务端快照到达后一定以快照为准；
- 如果服务端拒绝且没有新快照，客户端会短暂显示错误局面，需要 `sync.request` 修正。

更严谨的做法是保存 `optimisticBackup`，拒绝时立即回滚。

### 3.6 账号与资料

- `pendingAuth`：注册/登录请求先存起来，等连接 `open` 再发；
- `auth.ok` 后设置 `user`，再用账号 `playerId` 拉 `profile.get` / `leaderboard.get`；
- 令牌存 localStorage（30 天），登出只清本地 + 调 `auth.logout`。

---

## 4. WebSocket 客户端 `OnlineClient`

文件：[src/services/onlineService.js](../src/services/onlineService.js)

### 4.1 状态

```text
idle → connecting → open → reconnecting → idle
```

对外事件：`open`、`close`、`message`、`status`。

### 4.2 心跳

```text
open: lastPong = now，每 15 秒发 ping
每 15 秒检查：now - lastPong > 40 秒 → close()
```

为什么需要应用层心跳：

- TCP 半开连接可能长时间不触发 `close`；
- 只有应用层 ping/pong 才能发现“对端进程已死但 socket 还在”。

### 4.3 指数退避

```text
delay = 1000 * 2^attempt
attempt = 0..7 → 1s,2s,4s,8s,16s,16s,16s,16s
总计约 79 秒
```

- 与服务端 30 秒宽限期配合：前 5 次重连一定能覆盖宽限期；
- 超过 8 次停止，`status=closed`，UI 提示手动重试；
- `manualClose` 为 true 时（用户主动离开）不重连。

### 4.4 为什么不使用 socket.io

- 协议只有十几种消息，原生 JSON 足够；
- 心跳、退避、session 恢复都由业务控制，库的默认行为反而要覆盖；
- 少一个运行时依赖，协议更透明，面试时能逐行解释。

---

## 5. 棋盘渲染与动画

文件：[src/components/Board.jsx](../src/components/Board.jsx)

### 5.1 结构

```html
<div id="board">
  <div class="cell" data-pos="0-0">…</div>   × 45   <!-- 上半区 row 0-4 -->
  <div class="river">楚河 汉界</div>
  <div class="cell" data-pos="5-0">…</div>   × 45   <!-- 下半区 row 5-9 -->
  <svg class="board-lines" viewBox="0 0 w h">九宫斜线</svg>
  <canvas class="heatmap-canvas">            <!-- 分析覆盖层 -->
</div>
```

- 分成上下两个 5 行网格，中间插入楚河汉界，避免用绝对定位画河。
- 九宫线用 SVG，`viewBox` 由实测几何重算，所以缩放时线不会错位。
- `Cell` 只接收布尔标记，不接触规则。

### 5.2 几何测量（`measureMetrics`）

```text
量 (0,0)、(0,1)、(1,0)、(5,0) 四个格
→ 求 cell、colStep、rowStep、gap、riverH、pad、w、h
→ 除以 getBoundingClientRect / clientWidth 得到的 scale
→ 得到“未缩放 CSS 坐标”
```

为什么实测而不是写死常量：

- 棋盘尺寸由 CSS 变量控制，且外层有 `transform: scale()`；
- 写死会在不同屏幕/缩放下错位；
- `ResizeObserver` + rAF 去抖，尺寸变化才重算。

### 5.3 飞行动画

```text
lastMove 变化（moveSeq 触发）
  → displayBoard 先移除起点、终点放被吃子（或空）
  → animPiece 浮层从起点绝对定位
  → Web Animations API：translate(from → to)，650ms ease-in-out
  → 650+30ms 后恢复真实 board，播放 move/capture 音效
```

优点：

- 不改真实棋盘，动画结束才落定；
- 浮层用 `fill: forwards`，避免最后一帧跳回；
- 被吃子先在终点显示，浮层飞过去覆盖它，视觉上像“吃掉”。

已知边界：

- `measure()` 没有除以缩放系数，`transform: scale()` 不为 1 时，飞行距离/浮层尺寸会被缩放两次；`measureMetrics` 做了除缩放，动画没有。
- 修复：`measure` 复用 `measureMetrics` 的 scale，或把浮层放到未缩放坐标系。

### 5.4 音效

`src/utils/sound.js` 用 Web Audio 合成，不加载音频文件：

- `move`：短促点击；
- `capture`：更低、更重的噪声；
- `check`：提示音。

好处：零资源、零网络、可离线；坏处：音色有限。

---

## 6. 引擎分析层

### 6.1 `EngineController`

文件：[src/engine/EngineController.js](../src/engine/EngineController.js)

| 能力 | 实现 |
| --- | --- |
| 首帧分析 | `analyzeOnLoad` + `_analyzedOnce` 幂等 |
| 局面去重 | 同 FEN 且非 force 直接返回 |
| 请求失效 | `_seq++`，响应校验 |
| 中止请求 | `AbortController`，30 秒超时 |
| 模式切换 | `enableDeepMode` / `disableDeepMode` → `setDeepMode` |
| 开局缓存 | 标准开局深模式结果可复用给浅模式 |
| 新局重置 | `POST /__pikafish/reset` + 清状态 |

请求参数：

```js
轻量：{ multiPV: 5,  movetime: 500 }
深算：{ multiPV: 256, infinite: true, minDepth: 10, delay: 4000 }
启动：{ multiPV: 5,  movetime: 300 }
```

### 6.2 `UIManager` 的三种输出

| 输出 | 消费者 | 逻辑 |
| --- | --- | --- |
| `buildPieceMap(data, board, perspective)` | 选中棋子的落点 | 按 `from` 聚合 MultiPV，分数按展示视角翻转 |
| `buildHeatCells(data, board, perspective)` | 热力图 | 每个落点分数 → 正/负分组内排名 → `t∈[0,1]` |
| `buildSidebarRows(data, perspective, deep)` | 右侧列表 | UCI → 中文记谱、分数文本、颜色 |

关键设计：

- **组内相对排名**：不按绝对分归一化，否则优势方全红、劣势方全蓝；现在每组最强/最弱才有极值色。
- **视角统一**：引擎以行棋方为正，展示按玩家视角翻转；选子指示器不翻（选中棋子必属行棋方）。
- **异常隔离**：`uciToMove` 失败跳过该条，不让一条坏数据毁掉整个面板。

### 6.3 `HeatmapRenderer`

- Canvas 尺寸 = CSS 尺寸 × DPR；`ctx.setTransform(dpr,...)`。
- 几何来自 DOM 实测（与 Board 同口径），所以跨河、gap、缩放都对齐。
- `setData` 用 rAF 合并多次更新，只画一帧。
- 热力色：正分暖色、负分冷色；`MIN_ALPHA..MAX_ALPHA` 控制透明度。
- 走法指示器：优等走法黄色发光圆点（Top1 脉动），其余绿色小点。

已知 bug：

```js
const tick = hasLive ? (this._pulseTick || performance.now()) : 0;
...
this._pulseTick = tick;
```

第一帧把 `_pulseTick` 设成当前时间，之后每帧都复用它，`t` 不再变化，**Top1 脉动实际是静止的**。修复：

```js
const tick = hasLive ? performance.now() : 0;
```

### 6.4 `MoveIndicatorRenderer`

`buildAndRate` 的 4 个保护：

1. 只保留 `from === selected` 的着法；
2. `ratio` 用“与最优的分差 / |最优分|”归一化，避免全负局面 ratio 爆炸；
3. 只有一个合法着法时固定薄荷绿，不做强弱对比；
4. 半径上限 `geo.cell * 0.5`，防止异常数据画出占屏大圆。

`drawMoveIndicators`：

- `t` 做 `sin` 脉动，周期 `PULSE_PERIOD_MS`；
- 优等走法径向渐变 + shadowBlur；
- 单个点 try/catch，坏点不影响其余。

### 6.5 白屏事故的教训

历史问题：

```text
某模块 duck-typing 的 re-export 指向 undefined
  → 订阅 effect 抛错
  → React 19 卸载整棵树
  → 白屏
```

修复：

- 直接 import 具体模块，不做“兼容层 re-export”；
- 分析管线（App heatmap effect）整体 try/catch，出错只清空覆盖层；
- `analyzeOnLoad` 幂等，StrictMode 双挂载不产生双请求。

面试可讲：**“React 的渲染树很脆弱，第三方/异步数据的边界必须自己兜异常；尤其是 Canvas/订阅这类非 React 状态。”**

---

## 7. PWA

文件：[public/sw.js](../public/sw.js)、[src/main.jsx](../src/main.jsx)

### 7.1 注册

```js
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}
```

- 仅生产构建注册，避免开发态拦截 Vite 模块与 HMR；
- 所以验证 PWA 必须 `build + preview`，不能只看 `dev`。

### 7.2 四类策略

| 请求 | 策略 | 理由 |
| --- | --- | --- |
| 导航（HTML） | 网络优先，失败回退 Shell | 保证拿到最新入口，离线也能开 |
| `/pikafish/*` | 缓存优先 | 体积大、随构建哈希更新 |
| 同源静态资源 | stale-while-revalidate | 先快后新 |
| 非 GET / 跨域 | 不接管 | WS、引擎 HTTP 不能被缓存 |

### 7.3 版本与更新

```js
const VERSION = 'v1'
const SHELL_CACHE = `cc-shell-${VERSION}`
const RUNTIME_CACHE = `cc-runtime-${VERSION}`
```

- `install`：预缓存 Shell；单个资源失败不阻断安装；
- `activate`：删掉非当前版本缓存，`clients.claim()`；
- 更新版本只需改 `VERSION`；
- `skipWaiting` 让新 SW 立即接管，代价是可能有一次“新旧资源混用”的窗口。

### 7.4 离线的真实能力

| 能力 | 离线可用 |
| --- | --- |
| 打开应用外壳 | 是 |
| 本地 AI 对局 | 是（JS 已在缓存） |
| 联机对战 | 否（WebSocket 不可用） |
| Pikafish 分析 | 否（依赖 Vite 中间件） |
| 排行榜/账号 | 否（依赖服务端） |

面试时不要夸大“离线可玩联机”；准确说法是“**离线可打开并单机对弈，联机与引擎分析需要网络/本地服务**”。

---

## 8. 性能与已知问题

| 问题 | 影响 | 改进 |
| --- | --- | --- |
| Minimax 主线程 | AI 思考期间 UI 冻结，动画可能掉帧 | Web Worker + 可中断 |
| 每秒计时 setState | 整页每秒重渲染 | 计时拆成独立组件/外部 store |
| `Cell` 数量 90 | 每次走子全量 diff | `React.memo(Cell)` + 稳定 props |
| 动画 measure 未除 scale | 非 1 缩放时飞行距离偏大 | 复用 `measureMetrics` 的 scale |
| 脉动时间戳复用 | Top1 不脉动 | 每帧 `performance.now()` |
| 联机固定红底 | 黑方看到自己在上方 | 可加“己方在下”旋转选项 |
| 联机无计时/悔棋/回放 | 功能缺口 | 协议加时钟与请求类型 |

---

## 9. 前端面试可讲点

1. **“为什么不用 Redux？”** 状态集中在一个对局域，跨组件共享靠 props/订阅；引 Redux 只会增加 action/selector 样板。真正的问题是 hook 太长，下一步是 `useReducer`。
2. **“AI 异步竞态怎么处理？”** `aiRef` 防重入、`versionRef` 防过期、App effect key 防重复触发。
3. **“为什么用快照做悔棋？”** 走法可逆性受吃子/将军影响，反向推演容易错；快照回滚简单且必然正确，内存成本可接受。
4. **“Canvas 为什么不用 DOM？”** 热力图最多 90 格 + 多路指示器，DOM 会产生大量节点和重排；Canvas 一次绘制，DPR 自己控制。
5. **“React 白屏怎么排查？”** 先看是否 effect 抛错导致整树卸载；把非 React 数据管线包 try/catch，再做最小复现。
