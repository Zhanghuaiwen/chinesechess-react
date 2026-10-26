# 02 模块职责、关键类与核心时序

## 1. 模块总表

### 1.1 共享规则层

| 文件 | 职责 | 关键导出 | 被谁使用 |
| --- | --- | --- | --- |
| [shared/gameLogic.js](../shared/gameLogic.js) | 棋盘初始化、走法生成、安全着法、将军/将死、评估、重复局面指纹、中文记谱 | `initBoard`、`getLegalMoves`、`getSafeMoves`、`makeMove`、`isInCheck`、`hasLegalMove`、`boardKey`、`generateNotation`、`evaluateBoard` | `useGame`、`aiService`、`EngineController`、`room.ts`、测试脚本 |
| [shared/fen.js](../shared/fen.js) | 棋盘 ↔ FEN、坐标 ↔ UCI | `boardToFEN`、`fenToBoard`、`moveToUCI`、`uciToMove`、`startFEN` | `aiService`、`EngineController`、`vite-plugin-pikafish`、`UIManager` |

### 1.2 前端

| 文件 | 职责 | 关键导出/方法 |
| --- | --- | --- |
| [src/hooks/useGame.js](../src/hooks/useGame.js) | 单机对局状态机：棋盘、回合、计时、悔棋、回放、AI 调度、终局判定 | `doMove`、`onCellClick`、`triggerAIMove`、`undo`、`replayToMove`、`startNewGame`、`start` |
| [src/hooks/useOnlineGame.js](../src/hooks/useOnlineGame.js) | 联机状态机：大厅/房间/匹配/重连/账号/快照应用 | `joinRoom`、`findMatch`、`cancelMatch`、`makeMove`、`resign`、`leaveRoom`、`applySnapshot` |
| [src/services/aiService.js](../src/services/aiService.js) | Minimax + Alpha-Beta；皮卡鱼走棋；难度配置 | `getAIMove`、`localMove`、`iterativeDeepening`、`minimax` |
| [src/services/onlineService.js](../src/services/onlineService.js) | WebSocket 客户端：连接、心跳、指数退避、消息分发 | `OnlineClient.connect/send/close` |
| [src/engine/EngineController.js](../src/engine/EngineController.js) | 分析请求编排：防抖、去重、失效、模式切换、开局缓存 | `engine.analyzeOnLoad/setDeepMode/resetForNewGame` |
| [src/engine/UIManager.js](../src/engine/UIManager.js) | 把引擎原始 MultiPV 结果整形为棋子落点/热力图/侧栏 | `buildPieceMap`、`buildHeatCells`、`buildSidebarRows` |
| [src/engine/HeatmapRenderer.js](../src/engine/HeatmapRenderer.js) | Canvas 热力图：DPR、尺寸测量、渐变、脉动 | `setData`、`clear`、`destroy` |
| [src/engine/MoveIndicatorRenderer.js](../src/engine/MoveIndicatorRenderer.js) | 选中棋子后的黄/绿落点指示 | `buildAndRate`、`drawMoveIndicators` |
| [src/App.jsx](../src/App.jsx) | 布局、模式切换、AI 触发 effect、分析联动、缩放适配 | 组件 |
| [src/components/Board.jsx](../src/components/Board.jsx) | 棋盘网格、几何测量、飞行动画、音效、Canvas 挂载 | 组件 |
| [src/components/PikafishPanel.jsx](../src/components/PikafishPanel.jsx) | 胜率条、TopN 推荐、深算开关、订阅 `engine` | 组件 |

### 1.3 服务端

| 文件 | 职责 | 关键类/函数 |
| --- | --- | --- |
| [server/src/index.ts](../server/src/index.ts) | HTTP `/health` + WebSocket 升级 + 连接/关闭接线 | 启动入口 |
| [server/src/gateway.ts](../server/src/gateway.ts) | 消息路由、参数形状校验、断线处理、认证 | `handleMessage`、`handleClose` |
| [server/src/room.ts](../server/src/room.ts) | 权威对局状态机：座位、走子、终局、离线宽限、快照 | `Game.seat`、`applyMove`、`resign`、`endGame`、`snapshotFor` |
| [server/src/store.ts](../server/src/store.ts) | 房间/对局内存注册表、回收 | `Store.joinRoom`、`findGameBySocket`、`reap` |
| [server/src/matchmaker.ts](../server/src/matchmaker.ts) | 匹配队列、分段放宽、排位结算 | `Matchmaker.join/tick/tryMatch/settle` |
| [server/src/rating.ts](../server/src/rating.ts) | Elo 纯函数 | `expectedScore`、`updateRatings` |
| [server/src/ratings.ts](../server/src/ratings.ts) | 排位档案 + JSON 持久化 | `get`、`settle`、`top`、`transfer` |
| [server/src/accounts.ts](../server/src/accounts.ts) | 账号、scrypt、令牌摘要、会话 | `register`、`login`、`verify`、`logout` |
| [server/src/protocol.ts](../server/src/protocol.ts) | 协议类型与拒绝原因 | `ClientMessage`、`ServerMessage`、`GameSnapshot` |

---

## 2. 关键函数逐个说明

### 2.1 `shared/gameLogic.js`

| 函数 | 行为 | 面试要点 |
| --- | --- | --- |
| `initBoard()` L12 | 生成 10×9 初始棋盘，红黑各 16 子 | 坐标约定：row0 黑底线、row9 红底线；红方底线从左到右是“车马相仕帅仕相马车” |
| `getLegalMoves(board,r,c)` L58 | 生成“伪合法”着法，不检查走后是否被将 | 马腿、象眼、炮架、九宫、过河兵、飞将都在这一个函数里 |
| `getAllLegalMoves(board,color)` L175 | 汇总某方所有伪合法着法 | AI 搜索用；配合“吃将”作为终局 |
| `getSafeMoves(board,r,c)` L258 | 在伪合法基础上克隆棋盘、走一步、检查己方是否被将 | 人类交互与服务端裁决用；比 AI 多一层过滤 |
| `hasLegalMove(board,color)` L264 | 任一枚棋子存在安全着法 | 将死/困毙判定 |
| `isInCheck(board,color)` L236 | 找将，再遍历对方所有伪合法着法是否命中将 | 包含“飞将”：对方将沿同列无阻挡可直接吃将 |
| `makeMove(board,from,to)` L191 | 返回新棋盘与 `captured`，不修改原棋盘 | 不可变更新，React 状态和搜索分支都安全 |
| `evaluateBoard(board)` L209 | 红为正、黑为负的物质评估 | 将 100000、车 900、炮 450、马 400、象/士 200、兵 100（过河 200） |
| `boardKey(board,color)` L274 | 生成局面指纹（90 格 + 行棋方） | 三次重复判和 |
| `generateNotation(board,from,to,color)` L292 | 中文记谱：棋子 + 起点线 + 进退平 + 终点线 | 同线两子用“前/后”；三子以上未覆盖 |

### 2.2 `server/src/room.ts`（权威核心）

| 成员 | 行为 | 面试要点 |
| --- | --- | --- |
| `seat(ws,name?,identity?)` L107 | 空位分配红/黑；两人齐则 `playing` | 房间座位是**服务端资产**，不是客户端自报 |
| `snapshotFor(youAre)` L210 | 生成带个人视角 `youAre` 的全量快照 | 同一状态对两人生成不同 `youAre`，其余完全一致 |
| `applyMove(player,baseSeq,from,to)` L234 | 六道校验后落子，递增 `seq`，判终局 | 校验顺序：状态 → 回合 → 版本 → 有子 → 安全着法 |
| `markOffline/reattach/expireOffline` L165/L171/L177 | 断线保留、回连撤销、超时判负/释放座位 | 宽限期是“状态保留”而不是“暂停对局” |
| `resign(player)` L299 | 认输 → 对手胜 | 与断线超时共用 `endGame` |
| `endGame(winnerColor,reason)` L308 | 统一终局出口，触发 `onEnd` 结算 | 排位结算通过回调注入，`Game` 不依赖 `Matchmaker` |

`applyMove` 的终局判定顺序：

```text
1. 吃到将            → checkmate
2. 对方无任何安全着法 → 被将 = checkmate / 未被将 = stalemate（困毙）
3. 新局面第三次出现   → repetition（和棋）
```

### 2.3 `server/src/gateway.ts`

| 分支 | 关键动作 | 边界 |
| --- | --- | --- |
| `room.join` L45 | 房间号 trim + ≤32；`name` 归一化为 `string\|undefined`；满员拒绝 | 非字符串 `name` 曾导致 `name?.trim()` 抛错崩进程，已修 |
| `room.resume` L87 | `gameId + sessionId` 找座位；关闭旧连接；清定时器；`reattach`；下发 `room.joined` + 快照 | 旧连接可能因网络抖动残留 |
| `game.move` L123 | `isCell` 校验 from/to；`baseSeq` 必须是 number；失败回带当前 `seq` | 拒绝原因码可直接驱动前端提示 |
| `game.resign` L157 | 只允许局内玩家 | |
| `sync.request` L176 | 定向发快照 | 客户端收到 `stale_seq` 后的自愈入口 |
| `match.join` L187 | 有 token 时以账号身份为准，忽略自报 `playerId` | 防冒用他人分数 |
| `handleClose` L286 | 先出匹配队列；再找对局；`markOffline`；启动宽限定时器 | 排队掉线必须先移除，避免“幽灵匹配” |

### 2.4 匹配与评分

| 函数 | 行为 | 面试要点 |
| --- | --- | --- |
| `Matchmaker.join` L41 | 去重入队、取档案、立即通知、尝试撮合 | 同一 socket 重复入队先移除 |
| `bandOf` L68 | 起始 ±100，每 5 秒 +100，上限 ±800；30 秒后无限 | 解决“高分没人”的饿死 |
| `tryMatch` L96 | 按等待时间排序；为每人找分差最小且在双方 band 内的对手 | 双方 band 取 `min`，避免单方面放宽造成不公平 |
| `startRanked` L130 | 创建排位局、分配座位、挂 `onEnd`、发 `match.found` | 排位局不挂房间号 |
| `settle` L162 | 按 `winnerColor` 计算 A 得分，更新双方 ELO，推送 `rating.update` | 用颜色而非昵称判定胜负 |
| `expectedScore` L11 / `updateRatings` L20 | 标准 Elo，K=32，零和 | 分差 400 时期望胜率约 91% |
| `RatingsStore.top` L121 | 只收录 `games>0`，分数降序，同分按昵称 | 防止 0 场访客占榜 |
| `RatingsStore.transfer` L133 | 注册时把游客战绩迁到账号 | 仅当来源有战绩、目标无战绩 |

### 2.5 账号

| 函数 | 行为 | 面试要点 |
| --- | --- | --- |
| `register` L90 | 用户名校验、密码 6-64、scrypt 加盐、签发令牌 | 密码永不明文；盐 16 字节 |
| `login` L119 | 重新派生 + `timingSafeEqual` | 防时序侧信道 |
| `verify` L136 | 令牌 sha256 查会话，过期清理 | 文件里只有摘要，泄露也不能直接登录 |
| `logout` L153 | 只失效当前令牌 | 多设备登录互不影响 |

### 2.6 前端 `useGame`

| 成员 | 行为 | 面试要点 |
| --- | --- | --- |
| `doMove(from,to)` L89 | 记谱、落子、写历史、判断吃将/将死/困毙/重复、计时与音效 | 先把“走子前状态”压入 `history`，所以悔棋是快照回滚 |
| `triggerAIMove` | `aiRef` 防重入；`setTimeout` 等动画；`versionRef` 校验结果是否过期 | 异步 AI 返回时局面可能已被悔棋/重开 |
| `undo` | 按 AI 模式决定回退 1 步或 2 步 | 若当前轮到 AI，只回退玩家那一步 |
| `replayToMove(index)` | 从 `history` 恢复目标局面，截断后续棋谱 | 回放不改写历史，只切换视图 |
| 计时 effect | 每秒扣当前行棋方；归零判负；暂停/不限时跳过 | 与 AI 思考解耦 |
| `start` | 准备 → 1 秒 → 开始 → 100ms → 真正启动 | 用定时器做“准备/开始”仪式感 |

### 2.7 前端联机与引擎

| 成员 | 行为 | 面试要点 |
| --- | --- | --- |
| `OnlineClient.connect` L62 | 建连、`open` 后启心跳、`close` 后清心跳 | `manualClose` 阻止主动退出后的重连 |
| `startHeartbeat` L122 | 15 秒 ping；40 秒无 pong 主动关闭 | 应用层心跳，解决半开连接 |
| `scheduleReconnect` L150 | 1/2/4/8/16 秒退避，最多 8 次 | 与服务端 30 秒宽限期配合 |
| `EngineController.analyzeOnLoad` L110 | 首帧分析、同 FEN 去重、开局缓存 | 避免 React StrictMode 双调用 |
| `setDeepMode` L95 | 切换轻/深模式并强制重算当前局面 | 深模式 MultiPV 256（服务端钳到 128） |
| `resetForNewGame` L183 | 序号递增、Abort、清状态、`POST /reset` | 防止旧请求污染新局 |
| `UIManager.buildPieceMap` L69 | 按 `from` 聚合 MultiPV；行棋方视角换算 | 玩家执黑时分数取反，保证“自己优着为暖色” |
| `UIManager.buildHeatCells` L112 | 正/负分各自按 |分| 排名给强度 | 避免一侧整体发白、另一侧死深 |
| `UIManager.buildSidebarRows` L140 | 生成中文记谱、分数文本、颜色 | 标准模式前 5，深模式全部 |

---

## 3. 协议速查

### 3.1 客户端 → 服务端

| 类型 | 关键字段 | 说明 |
| --- | --- | --- |
| `room.join` | `roomId, name?` | 加入/创建房间 |
| `room.resume` | `gameId, sessionId` | 断线/刷新后 reclaim 座位 |
| `game.move` | `gameId, baseSeq, from, to` | 走子意图 |
| `game.resign` | `gameId` | 认输 |
| `sync.request` | `gameId` | 主动拉快照 |
| `match.join` | `playerId, name?, token?` | 入匹配队列 |
| `match.leave` | 无 | 取消匹配 |
| `profile.get` | `playerId, token?` | 查排位档案 |
| `leaderboard.get` | `limit?` | 排行榜 |
| `auth.register/login/me/logout` | 账号字段 | 认证 |
| `ping` | `ts` | 心跳 |

### 3.2 服务端 → 客户端

| 类型 | 作用 |
| --- | --- |
| `room.waiting` | 已入座，等待对手，带 `sessionId` |
| `room.joined` | 开局/回连，带个人 `youAre` 与 `sessionId` |
| `game.state` | 全量权威快照 |
| `game.move.accepted` | 走子确认，带 `notation/check/turn` |
| `game.move.rejected` | 拒绝原因 + 当前 `seq` |
| `game.over` | 终局（胜者/原因） |
| `match.queued` | 排队中，带 `rating/waiting/band` |
| `match.found` | 匹配成功 |
| `rating.update` | 排位结算明细 |
| `profile/leaderboard` | 档案/榜单 |
| `auth.ok/auth.error/auth.loggedOut` | 认证结果 |
| `pong/error` | 心跳/通用错误 |

### 3.3 拒绝原因（`RejectReason`）

`not_playing`、`not_a_player`、`not_your_turn`、`stale_seq`、`no_piece`、`illegal_move`。

前端对 `stale_seq` 的处理：提示“状态已更新，已为你重新同步”，并立即 `sync.request`。

---

## 4. 核心时序

### 4.1 单机：玩家走子 → AI 应手

```text
点击格子
  → useGame.onCellClick
      → 选中己方棋子：marks = getSafeMoves(...)
      → 点击落点：doMove(from,to)
          → generateNotation / makeMove
          → setHistory(走子前快照)
          → setMoves / setLastMove / setMoveSeq
          → isInCheck / hasLegalMove / 三次重复
          → 若终局：setGameOver + 音效
  → App effect 监听 [board,current,aiEnabled,...]
      → triggerAIMove
          → aiRef 上锁
          → setTimeout(MOVE_MS + 120)
          → getAIMove(board,difficulty,aiColor)
              ├─ easy/medium：minimax(depth 3/4)
              ├─ hard：iterativeDeepening(maxDepth 5, 8000ms)
              └─ master：POST /__pikafish/analyze → UCI bestmove
          → versionRef 校验（局面是否已被悔棋/重开）
          → doMove(aiMove.from, aiMove.to)
          → aiRef 解锁
```

### 4.2 联机：房间加入

```text
A: room.join(roomId)
  → Store.joinRoom：创建 Game，seat(A)=红
  → room.waiting(sessionId)
  → game.state(status=waiting)

B: room.join(roomId)
  → 复用 Game，seat(B)=黑 → status=playing
  → 对 A/B 各发 room.joined(youAre, sessionId)
  → 广播 game.state(status=playing)
```

### 4.3 联机：走子与冲突

```text
A: game.move{baseSeq: 7, from, to}
  → Game.applyMove
      status=playing ✓
      A.color === turn ✓
      baseSeq === seq(7) ✓
      有子且颜色匹配 ✓
      to ∈ getSafeMoves(from) ✓
      → seq=8, turn=B, moves.push(...)
      → 判将/将死/重复
  → 给 A 发 game.move.accepted(seq=8, check)
  → 双方收 game.state(seq=8)
  → 若有终局：广播 game.over

冲突场景：
B 仍基于 seq=7 提交 → stale_seq
  → 服务端回 game.move.rejected(seq=8)
  → B 客户端提示并 sync.request
  → 收 game.state(seq=8)，本地对齐
```

### 4.4 断线与重连

```text
A 断网
  → 服务端 handleClose
      matchmaker.remove(A)          （若在排队）
      game.markOffline(A)           ws=null, offlineUntil=now+30s
      setTimeout(30s)
  → 广播 game.state(offline={color:red, deadline})
  → B 看到倒计时；A 的座位仍保留

A 在 30 秒内重连
  → 客户端读 sessionStorage 的 {gameId, sessionId}
  → room.resume
      playerByToken(sessionId) 命中
      关闭旧连接、clearTimeout、reattach
  → room.joined + game.state（全量快照，seq 对齐）
  → 继续对局

A 超过 30 秒未回连
  → expireOffline
      playing → endGame(对手胜, 'disconnect')
      waiting → 移除座位
  → 广播 game.state + game.over
  → Store.reap 在双方都离线时回收
```

### 4.5 排位匹配与结算

```text
A/B: match.join
  → 以 token 身份为准（若已登录）
  → ratings.get 建档（初始 1200）
  → 入队 → match.queued(band)
  → tick 每秒：
      band 随时间放宽
      找分差最小且双方 band 允许的对手
  → startRanked：createRanked + seat + onEnd=settle
  → match.found（各自 youAre/sessionId）+ 快照
  → 对局结束 endGame → settle
      scoreA = 1/0.5/0（按 winnerColor）
      updateRatings（K=32，零和）
      rating.update 分别下发
```

### 4.6 Pikafish 分析

```text
前端 EngineController.requestAnalysis(fen, turn)
  → 同 FEN 去重 / 模式切换 force
  → Abort 上一个 fetch
  → POST /__pikafish/analyze {fen, multiPV, movetime|infinite, id}

Vite EngineHost
  → capMultiPV(请求值, 合法着法数)     上限 128
  → id 更新为 latest
  → 若正在搜索：interrupt（stop）
  → 串行队列执行：
      ensure()：spawn exe → uci → setoption → isready
      position fen ...
      go infinite / go movetime
      轮询 info depth 到 minDepth 或 delay 上限
      stop → await bestmove
      summarize 最深每路 → 返回
  → 若 id 已过期：直接返回 stale，不污染引擎

前端
  → UIManager.buildPieceMap / buildHeatCells / buildSidebarRows
  → Board：黄点/绿点指示
  → HeatmapRenderer：Canvas 热力图
  → PikafishPanel：胜率条 / TopN / 走法
```

---

## 5. 调用图（文字版）

```text
App
├─ useGame
│  ├─ shared/gameLogic
│  ├─ services/aiService
│  │  ├─ shared/gameLogic
│  │  ├─ shared/fen
│  │  └─ fetch /__pikafish/analyze
│  └─ utils/sound
├─ useOnlineGame
│  └─ services/onlineService (WebSocket)
├─ Board
│  ├─ Cell
│  └─ HeatmapRenderer / MoveIndicatorRenderer
├─ PikafishPanel
│  └─ engine.subscribe
└─ engine (EngineController)
   ├─ shared/fen
   └─ UIManager
```
