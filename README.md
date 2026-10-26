# 中国象棋 (Chinese Chess)

基于 Minimax + Alpha-Beta 剪枝算法的中国象棋对弈，React 前端 + Node/TypeScript 联机服务端。

单机人机对弈完全在浏览器本地运行；联机部分提供**房间制对战、ELO 随机匹配、断线重连、账号体系与排行榜**，棋盘规则在前后端同构复用同一份代码，由服务端做权威校验。支持 PWA 安装与离线打开。

## 技术栈

| 层       | 技术                                                        |
| -------- | ----------------------------------------------------------- |
| 框架     | React 19                                                    |
| 构建     | Vite 8                                                      |
| 语言     | JavaScript (JSX) / TypeScript（服务端）                     |
| 静态检查 | oxlint                                                      |
| AI 引擎  | Minimax + Alpha-Beta 剪枝（自实现，无外部依赖）             |
| 分析引擎 | Pikafish（本地 UCI 中国象棋引擎，经 Vite 中间件常驻子进程） |
| 联机服务 | Node.js + ws（WebSocket），权威校验 + 排位                  |
| PWA      | 手写 Service Worker + manifest（无 Workbox 依赖）           |
| 样式     | 原生 CSS（无 UI 框架）                                      |

零 AI 运行时依赖——不依赖 Ollama、LLM API 或任何第三方 AI 服务。对局 AI（Minimax + Alpha-Beta）完全在浏览器本地运行；右侧 Pikafish 分析面板则由**本地原生引擎**驱动（详见下文"Pikafish 实时分析面板"），同样不访问任何在线服务。

## 项目结构

```
src/
├── main.jsx                  # React DOM 入口（生产环境注册 Service Worker）
├── App.jsx                   # 根组件，组装布局 & 调度 AI 触发
├── App.css                   # 全局样式
├── constants.js              # 共享常量（棋盘尺寸、坐标换算等）
├── hooks/
│   ├── useGame.js            # 单机对局状态机（棋盘、回合、计时、AI 编排、悔棋）
│   └── useOnlineGame.js      # 联机状态机（大厅/房间/对局、重连、排位、登录）
├── components/
│   ├── Board.jsx             # 10×9 棋盘网格 + 棋子慢速滑行动画
│   ├── Cell.jsx              # 单格组件（棋子渲染、选中/将军/落子高亮）
│   ├── GameInfo.jsx          # 状态栏（回合/计时器/难度/先手/时限/操作按钮）
│   ├── MoveList.jsx          # 棋谱列表（中国象棋记谱，点击回放）
│   ├── StatsPanel.jsx        # 对局数据面板（节点数、剪枝数、局面评估）
│   ├── PikafishPanel.jsx     # Pikafish 分析面板（实时胜率/局面分/主要着法评分）
│   ├── OnlineGame.jsx        # 联机面板（大厅 + 房间 + 对局 + 登录 + 排行榜）
│   └── PwaControls.jsx       # 安装引导（beforeinstallprompt）+ 离线角标
├── services/
│   ├── aiService.js          # AI 搜索引擎（Minimax + Alpha-Beta）
│   └── onlineService.js      # WebSocket 客户端（指数退避重连、消息分发）
├── engine/                   # Pikafish 分析：事件驱动控制 + Canvas 可视化（V2 增量）
│   ├── EngineController.js   # 引擎控制器（订阅快照、seq 失效主导、启动即分析、超时安全阀）
│   ├── UIManager.js          # 引擎数据 → 侧边栏 / 热力图 / 指示器 的纯数据编排（红方视角统一）
│   ├── HeatmapRenderer.js    # 棋盘热力图 Canvas 覆盖层（rAF 防抖合并重绘 + 脉动喂帧）
│   └── MoveIndicatorRenderer.js # 走法相对强度指示器（分级阈值、getGradientColor、Top1 脉动）
└── utils/
    ├── sound.js              # 音效模块（Web Audio 合成：落子/吃子/选中/将军/开局等）

shared/                       # 前后端同构（浏览器与 Node 共用同一份规则代码）
├── gameLogic.js              # 规则引擎（走法生成、将死/困毙、记谱、局面评估、boardKey）
└── fen.js                    # 棋盘 ↔ UCI FEN / UCI 着法 双向换算

server/
├── src/
│   ├── index.ts              # HTTP(/health) + WebSocket 服务入口、优雅关闭
│   ├── gateway.ts            # 消息路由与参数校验（房间/走子/同步/匹配/档案/账号）
│   ├── room.ts               # Game 权威状态机（走子校验、终局、断线宽限期、快照）
│   ├── store.ts              # 房间/对局注册表（内存）
│   ├── protocol.ts           # 联机协议类型定义（客户端/服务端消息）
│   ├── matchmaker.ts         # ELO 随机匹配队列（分段区间随时间放宽）
│   ├── rating.ts             # Elo 纯函数（初始 1200 / K=32 / 零和）
│   ├── ratings.ts            # 排位档案仓库（JSON 落盘、排行榜、游客战绩迁移）
│   └── accounts.ts           # 账号与会话（scrypt 密码、令牌摘要、JSON 落盘）
├── scripts/                  # 协议级冒烟测试（自建隔离实例，不污染开发数据）
│   ├── smoke.mjs             # P0：房间/权威走子/拒绝原因（13 项）
│   ├── smoke-p1.mjs          # P1：匹配/结算/分段/取消/排行榜（26 项）
│   ├── smoke-p2.mjs          # P2：断线重连/伪造凭据/宽限期判负（13 项）
│   └── smoke-auth.mjs        # P4：游客/注册/登录/令牌权威/落盘安全（22 项）
└── data/                     # 运行期数据（可删除重置）
    ├── ratings.json          # 排位档案
    └── accounts.json         # 账号 + 会话摘要

public/                       # PWA 静态资源（构建时原样拷贝）
├── sw.js                     # 手写 Service Worker（Shell 预缓存 + 运行时缓存）
├── manifest.webmanifest      # 应用清单（standalone / 中文名 / 图标）
└── icons/                    # 192 / 512 / maskable / apple-touch 图标
```

Pikafish 引擎集成（Vite 开发服中间件 + Node 工具）：

```
├── vite-plugin-pikafish.js   # Vite 中间件：常驻 Pikafish.exe 子进程 + POST /__pikafish/analyze 接口
├── scripts/engine/           # Node 侧 UCI 工具与验证脚本
│   ├── pikafish-client.js    # UCI 子进程客户端（命令/应答/bestmove 解析）
│   ├── verify.js             # 13 项棋盘↔UCI 联调验证（npm run engine:verify）
│   ├── multipv-demo.js       # MultiPV 多着法评分演示
│   └── wdl-probe.js          # WDL 模型饱和特性探针（验证软胜率必要性）
└── Pikafish-master/          # Pikafish 引擎源码与编译产物
    └── release/              # Pikafish.exe + pikafish.nnue（引擎运行必需，与 exe 同目录）
```

## AI 引擎设计

### 算法：Minimax + Alpha-Beta 剪枝

AI 使用标准的对抗搜索算法，红方为最大化方（Max），黑方为最小化方（Min）。

```
function minimax(board, depth, alpha, beta, isMaximizing):
  1. 生成当前方所有合法走法
  2. 若无合法走法，返回极值（±99999）
  3. 若 depth == 0，返回 evaluateBoard(board)
  4. 对每个走法：
     a. 执行走法得到新棋盘
     b. 若吃掉将/帅，立即返回 mate score（±100000 + depth，更快将杀得分更高）
     c. 递归调用 minimax(newBoard, depth-1, alpha, beta, !isMaximizing)
     d. 更新 alpha/beta 进行剪枝
  5. 返回最佳走法及对应的评估分
```

### 走法排序（Move Ordering）

为提高 Alpha-Beta 剪枝效率，搜索前按**吃子价值**对走法降序排列：

```js
function orderMoves(board, moves):
  return moves.sort((a, b) => captureValue(b) - captureValue(a))
```

吃子优先级：将 > 车 > 炮 > 马 > 象 > 士 > 兵

这保证了最有希望的走法（吃大子）最先被搜索，使剪枝更早发生，大幅减少搜索树规模。

### 评估函数

评估函数是纯物质型的（material-only），对棋盘上所有棋子加权求和：

| 棋子            | 基础分值 | 过河后 |
| --------------- | -------- | ------ |
| 将/帅 (king)    | 100000   | —      |
| 车 (rook)       | 900      | —      |
| 炮 (cannon)     | 450      | —      |
| 马 (knight)     | 400      | —      |
| 象/相 (bishop)  | 200      | —      |
| 士/仕 (advisor) | 200      | —      |
| 兵/卒 (pawn)    | 100      | 200    |

```js
score = Σ(红方棋子价值) - Σ(黑方棋子价值);
```

正值表示红方有利，负值表示黑方有利。兵/卒过河后分值翻倍以反映其威胁性提升。

### 将杀检测与距离偏好

当某走法吃掉对方将/帅时，搜索立即截断并返回一个 mate score：

- 红方将杀：`score = 100000 + remaining_depth`（越快将杀分数越高）
- 黑方将杀：`score = -100000 - remaining_depth`（越快将杀分数越低）

这使得 AI 在多个将杀走法中选择最快的路线。

## 难度系统

| 难度       | 搜索深度 | 策略说明                                |
| ---------- | -------- | --------------------------------------- |
| 简单       | 3        | 仅考虑 3 步以内的走法，较弱但响应极快   |
| 中等       | 4        | 默认设置，平衡强度与速度                |
| 困难       | 5        | 使用迭代加深（ID），最多 8 秒时间预算   |
| 皮卡鱼大师 | 引擎     | 走棋交给本地 Pikafish 引擎（思考 2 秒） |

**困难模式的迭代加深** (Iterative Deepening)：

```
function iterativeDeepening(board, maxDepth, timeBudget, isMaximizing):
  start = performance.now()
  for depth = 1 to maxDepth:
    if elapsed >= timeBudget: break
    result = minimax(board, depth, -Infinity, Infinity, isMaximizing)
    bestMove = result.move
  return bestMove
```

`getAIMove(board, difficulty, aiColor)` 支持 AI 执红或执黑：AI 执红走 Maximizer（`isMaximizing = true`），执黑走 Minimizer。
当难度为 `pikafish`（皮卡鱼大师）时，走棋改为请求 `/__pikafish/analyze`（`multiPV=1, movetime=2000`），
与右侧分析面板共用单调 id，引擎不可用时自动降级为本地困难 AI。

从 depth=1 开始逐层加深，每层完成后检查时间预算。若超时，返回上一层已完整搜索的最佳走法，保证在最坏情况下也有合理走法返回。

## 搜索统计与对局数据

`aiService.js` 在搜索过程中维护一个 `stats` 对象，实时累计两类核心指标：

| 指标           | 含义                                   | 统计位置                 |
| -------------- | -------------------------------------- | ------------------------ |
| `nodes`        | 访问过的博弈树节点总数                 | 每次 `minimax()` 入口 +1 |
| `prunes`       | Alpha-Beta 剪枝命中次数                | `beta <= alpha` 时 +1    |
| `depthReached` | 实际完成的搜索深度（迭代加深逐层更新） | 每层搜索开始时记录       |

每次 `getAIMove()` 返回 `{ move, nodes, prunes, depth, timeMs }`，其中 `timeMs` 为该次搜索的实际耗时。`useGame` 将其累计为全局 `aiStats`（`nodes`/`prunes` 累加，`lastNodes`/`lastPrunes`/`lastDepth`/`lastTimeMs` 记录最近一次搜索）并传给 `StatsPanel` 展示。

`StatsPanel` 分"本次搜索 / 累计"两组实时显示：

**本次搜索**（最近一次 AI 搜索）：

- **当前思考节点数**：`lastNodes`，最近一次搜索访问的节点数
- **当前剪枝数**：`lastPrunes`，最近一次搜索的剪枝命中次数
- **搜索深度** / **搜索耗时**：`lastDepth` / `lastTimeMs`

**累计**（整局）：

- **总思考节点数**：`nodes`，所有搜索的节点数之和
- **Alpha-Beta剪枝总数**：`prunes`，累计剪枝命中次数
- **AI走棋次数**：`moves`，AI 已落子数
- **棋盘价值**：`evaluateBoard(board)`，正值红方占优 / 负值黑方占优（每次渲染实时计算）

## Pikafish 实时分析面板

右侧 "Pikafish" 面板实时展示当前局面的 **实时胜率**、**局面分** 与 **Top 主要着法评分**，由本地 Pikafish 引擎（皮卡鱼，UCI 协议）驱动。每次走子后自动刷新。

### 架构：浏览器 × 原生引擎

浏览器无法直接运行原生 exe，因此采用 **Vite 开发服务器中间件 + 子进程**架构：

```
Vite 开发服务器
 ├─ vite-plugin-pikafish.js  ──spawn──> Pikafish.exe（常驻子进程，cwd = release/）
 │     ├─ POST /__pikafish/analyze  { fen, multiPV, movetime }
 │     │    ├─ position fen <fen>
 │     │    ├─ setoption name MultiPV value N / UCI_ShowWDL=true
 │     │    ├─ go movetime X  → 解析 info…/bestmove
 │     │    └─ 返回 JSON（bestmove、局面分、Top N 着法及评分、搜索深度）
 │     └─ 串行搜索队列 / 崩溃自动重启 / 服务器关闭时清理子进程
 └─ src/components/PikafishPanel.jsx  ──fetch──> 渲染胜率条 / 局面分 / 主要着法
```

- **棋盘 → FEN**：`shared/fen.js` 的 `boardToFEN`（UCI rank = 9 − row、file = col；红方大写 R N B A K C P，黑方小写）
- **请求策略**：每次走子（`board`/`current` 变化）防抖 500ms 触发一次分析，轻量 500ms / Master 深度搜索至主变深度 10（`minDepth`），最晚 4 秒兜底
- **大师深度**：`go infinite` 后轮询主变深度，达到 `minDepth` 立即 `stop`，比固定延时更深、结果更收敛
- **开局缓存 + 重开**：标准开局局面的分析结果被缓存，重新开局时面板瞬时复用（不再"重开要分析老半天"），且大师模式开局推荐在每盘间保持一致；新开局还会通知引擎 `ucinewgame` 清空上一局搜索记忆（常驻进程不重启）
- **仅开发/预览可用**：`npm run dev` / `npm run preview` 中间件生效；纯静态 `dist/` 无此接口
- **引擎前提**：`Pikafish-master/release/` 下须存在 `Pikafish.exe` 与 `pikafish.nnue`（NNUE 权重与 exe 同目录），否则面板显示"引擎未连接"

Node 侧工具（`scripts/engine/`）可直接复用：`npm run engine:verify` 跑 13 项棋盘↔UCI 联调验证。

### 软胜率换算算法（winModel）

Pikafish 自带的 `UCI_ShowWDL` 胜率模型过于陡峭——局面分一旦超过约 300 厘兵（多一个子）就输出 1000‰（必赢），下几步就"钉死"在 100%，对人类观感过于绝对。因此面板**不直接用引擎 WDL**，改用**局面分 → 软胜率**换算，渐进且在有限分差下永不为 100%。

输入仅两项：引擎 `score`（`cp` 厘兵分或 `mate` 杀棋）与当前行棋方 `sideToMove`。

**① 视角归一**：引擎局面分是"行棋方视角"（正 = 行棋方有利），先转为红方视角：

```
s = sideToMove === 'red' ? score.value : -score.value
```

**② 杀棋特判**：`score mate N` 直接返回 `红 99% / 和 1% / 黑 0%`（黑方胜则对称）。

**③ 净胜概率（Elo 型 logistic）**：把局面分当作双方"实力差"，`400` 厘兵为一个数量级步长：

```
win = 100 / (1 + 10^(-s / 400))
```

| 局面分 s（红方视角） | 对应子力 | win（净胜概率） |
| -------------------- | -------- | --------------- |
| 0                    | 均势     | 50%             |
| +100                 | 多 1 兵  | ≈64%            |
| +400                 | 多 1 马  | ≈89%            |
| +900                 | 多 1 车  | ≈99.5%（渐进）  |

**④ 和棋占比（负指数衰减）**：越接近均势越可能和棋：

```
draw = round(60 × e^(-|s| / 180))
```

均势时封顶 60%，分差越大和棋越少；`180` 为衰减半宽（约半个马的差距即基本无和棋空间）。

**⑤ 归一拆分**：先扣除和棋占比，再按 `win` 分配给红/黑，三项之和恒为 100%：

```
redWin   = round(win × (100 - draw) / 100)
blackWin = 100 - redWin - draw
```

**参数标定依据**：`400` 取自引擎子力价值（兵 100 / 马 400 / 炮 450 / 车 900）；`180` 为和棋衰减半宽；`60` 为和棋上限（避免均势显示成"必和"）。

**实际效果示例**（引擎实搜 2.5 秒）：

| 局面      | 局面分 | 面板显示             |
| --------- | ------ | -------------------- |
| 均势      | +23    | 红 25% 和 53% 黑 22% |
| 红多 1 兵 | +29    | 红 27% 和 51% 黑 22% |
| 红多 2 兵 | +47    | 红 31% 和 46% 黑 23% |
| 红多 1 马 | +360   | 红 82% 和 8% 黑 10%  |
| 红多 1 车 | +616   | 红 95% 和 2% 黑 3%   |

> **注意**：① 这是**展示用的人性化换算**，并非引擎官方 WDL——官方模型更陡、更"引擎级严格"；② 胜率随搜索深度/时间轻微波动属正常（局面分本身会收敛）；③ 面板只反映当前局面的评估，与终局结果（将死/困毙/三次重复/超时）无关。

## 悔棋功能

`useGame` 维护一个 `history` 栈，每次 `doMove` 落子前将**当前快照** `{ board, current, gameOver }` 压栈。悔棋逻辑按对局模式决定回退层数：

- **AI 模式**：回退 2 层（撤销 AI 应手 + 玩家本手），若当前为 AI 回合则回退 1 层
- **双人对弈模式**（关闭 AI）：回退 1 层

悔棋恢复时同步清除选中态/标记，并重置 AI 防重入锁（`aiRef`）与思考状态，避免残留的定时器触发异常走子；同时截断棋谱 `moves`、重新计算将军状态与落子高亮。

## 大师辅助与稳定性增强（V2 增量）

面向面试的高频工程点，均可通过 🔍 大师辅助按钮现场演示。

### 1. 事件驱动分析 + 启动即分析

- 弃用"每步固定延时轮询"，改为**落子回调显式触发一次分析**；服务端常驻单一引擎会话 + 串行队列，客户端以递增 `seq` 失效标记保证**永远只有最后一次请求生效**——旧请求返回 `stale` 静默丢弃，不积压、不覆盖。
- 首次分析（棋盘初始化后）自动走 `go movetime 300` 快速研判，消除首屏右侧面板空白；后续按 `light(500ms/前5路)` 与 `deep(全量 MultiPV)` 自动升降级。
- `fetch` 侧加 **AbortController 20s 超时**安全阀，引擎异常不再让面板永久"加载中"。

### 2. 大师辅助走法推荐 —— 相对强度可视化

点击己方棋子后：

- **黄/暖色系实心发光圆点** = 优等走法：半径 `6px + (score / maxScore) × 14px`、透明度 0.6→1.0 线性映射，Top1 以 1.5s 周期 sin 缓动作 1.0→1.15 脉动——0.1 秒内锁定"神之一手"；
- **绿色小圆点** = 其余合法走法，保留"哪里能走"的完整信息（辅助开启不丢走法可见性）；
- 单走法棋子特判为薄荷绿固定圆点（无对比，不做缩放）。
- 全部颜色收敛在单一 `getGradientColor(score, maxScore)` 映射函数，绘制层零硬编码色值。

### 3. 一次"整应用白屏"的雷区（重点复盘）

点击棋子后所有界面消失，根因不在渲染，而在 effect 中抛出的 `TypeError`：

```
// HeatmapRenderer 只导出了一个"鸭式对象"，buildAndRate 并不存在
export const MoveIndicatorRenderer = { draw }
// App 却调用 MoveIndicatorRenderer.buildAndRate(...)
//   → undefined is not a function → effect 未捕获异常
// React 19 默认 unmount 整棵应用树 → 白屏
```

修复：**直连真实现** `import { buildAndRate } from .../MoveIndicatorRenderer`，并删除误导性的鸭式 re-export。

配套的工程级鲁棒性：

- 所有"数据派生 → 渲染"的 effect 包 `try/catch`：异常只清空覆盖层并记日志，绝不扩散到 React 渲染树；
- 绘制循环单点 `try/catch` + 半径钳制 + 空 geo 兜底：某个指示器画不出不影响其余；
- 竞态源头治理：`analyzeOnLoad()` 改为幂等护栏（`_analyzedOnce` 状态锁），首次分析并入主请求链路，挂载期只发**一个**请求。

### 4. 视角统一（红方视角）

引擎分数以"行棋方"为正，所有数据统一换算到红方视角（黑方行棋时取反），侧边栏评分、热力图冷暖、走法指示器的语义全程一致。

## 产品功能

### 1. 将军提示

- 落子后调用 `isInCheck(newBoard, next)` 检测对方是否被将军
- 若被将军：棋盘上被将军的将/帅格子**红色脉冲高亮**，顶栏弹出红色 **"将军！"** 徽章，并播放警示音效

### 2. 胜负判定补全

完整的终局判定（`doMove` 内按序检查）：

| 情形                  | 判定             | 说明                                                              |
| --------------------- | ---------------- | ----------------------------------------------------------------- |
| 吃掉将/帅             | 直接判负         | 保留原逻辑                                                        |
| 无合法走法 + 被将军   | **将死**         | 攻击方获胜                                                        |
| 无合法走法 + 未被将军 | **困毙**         | 按中国象棋规则，无子可走的一方判负                                |
| 同一局面出现 3 次     | **三次重复判和** | 通过 `boardKey`（棋盘序列化 + 行棋方）计数，覆盖常见长将/长捉场景 |

人类玩家走子使用 `getSafeMoves`（过滤掉会送将的走法），确保不会走出暴露己方将/帅的非法棋；AI 仍使用伪合法走法 + 吃将检测（见上）。

### 3. 中国象棋记谱 + 走法回放

`generateNotation(board, from, to, color)` 生成标准中式记谱：

- 红方使用中文数字（一~九）、黑方使用阿拉伯数字（1~9），从各自身边右往左编号
- 直行棋（车/炮/兵/帅将）用"进/退 + 步数"，跳跃棋（马/相/士）用"进/退 + 目标纵线"，横向用"平 + 目标纵线"
- 同一直线上同型双子用"前/后"区分（如前车进一）

示例：`炮二平五`、`马8进7`、`车三进二`、`兵七进一`。

棋谱以"回合"为行展示在棋盘下方（红先黑后），**点击任意一手可回放**到该局面：截断 `history`/`moves` 并从该位置继续对局（若回放到 AI 回合且 AI 开启，AI 会接管续走）。

### 4. 先手选择 + 计时器

- **先手选择**：可切换"玩家先手"（AI 执黑）或"AI 先手"（AI 执红），`aiService` 通过 `aiColor` 参数决定搜索侧（AI 执红时走 Maximizer）
- **计时器**：每方 N 分钟（5/10/20 分钟或不限时），走子方倒计时；任一方超时判负（`setInterval` 每秒递减，`current` 切换时重启）
- **开始流程（Ready / Go 倒计时）**：进入页面后对局处于"未开始"状态（计时器不启动、不能走子），棋盘上有半透明遮罩与"开始对局"按钮；点击后播放 Ready 提示音并在遮罩上弹出 **"Ready"**，等待 1 秒后弹出 **"Go!"** 并播放 Go 音效，再经 100ms 正式开钟开赛；重新开局后回到该状态
- **设置面板**：先手/时限/AI难度/音效统一收纳在"设置"弹出的**浮层卡片**中（`position: fixed` 全屏遮罩，背景变暗），不改变主界面宽度；打开设置即**暂停**对局（计时器停止、AI 与玩家走子全部挂起），点"完成"或点击遮罩关闭并恢复

### 5. 动画与音效

- **慢速滑行动画**：每次落子后，棋子会以约 650ms 的过渡时长**从起点格平滑滑行到目标格**（`Board.jsx` 中通过绝对定位的 `floating-piece` 浮层 + Web Animations API 的显式 from→to 关键帧实现，起止坐标由 DOM 实测获取，不依赖写死坐标），滑行结束落位时触发落子/吃子音效；同时保留落位缩放、吃子红闪、末手橙光、被将军红脉冲等反馈
- **选中音效**：点击选中己方棋子时播放**敲击木头**的音效（Web Audio 滤波噪声合成）
- **开局音效**：点击"开始对局"播放 Ready 提示音，1 秒后播放 Go 提示音，与遮罩上的 Ready/Go 倒计时同步
- **音效**：`sound.js` 用 Web Audio API 实时合成（零音频资源），区分落子/吃子/选中/将军/获胜/落败/和棋/Ready/Go 等音效，设置面板内提供"音效: 开/关"切换

## 游戏规则实现

所有规则在 `shared/gameLogic.js` 中实现（前后端同构，服务端权威校验复用同一份代码）：

- **车 (Rook)**：直线滑动，遇子停止
- **马 (Knight)**：日字走法，蹩马腿检测
- **象/相 (Bishop)**：田字走法，塞象眼检测，不可过河
- **士/仕 (Advisor)**：九宫内斜走一步
- **将/帅 (King)**：九宫内直走一步，支持飞将（将帅对面）
- **炮 (Cannon)**：直线滑动，吃子需隔一子（炮架）
- **兵/卒 (Pawn)**：过河前只能前进，过河后可左右

走法生成（`getLegalMoves`）不做将军过滤——AI 搜索在递归中通过吃将/帅自动处理将军与将杀；人类玩家走子则经 `getSafeMoves` 过滤，防止送将。辅助函数：`isInCheck`（将军检测，含飞将）、`hasLegalMove`（困毙/将死判定）、`boardKey`（三次重复判和的局面指纹）。

## 联机对战系统

联机部分分为 P0–P4 五块：**P0 房间制对战 + 服务端权威校验**、**P1 ELO 随机匹配**、**P2 断线重连 + 状态同步**、**P3 PWA**、**P4 后端整理 + 账号与排行榜**。

### 架构与数据流

```
浏览器 A ──ws──┐
               ├─> Node 服务端 (ws://localhost:8787)
浏览器 B ──ws──┘     ├─ gateway.ts   解析/校验消息，路由到房间或匹配器
                     ├─ room.ts      Game 权威状态机（唯一裁决走子）
                     ├─ matchmaker   匹配队列
                     ├─ ratings      ratings.json（排位档案，落盘）
                     └─ accounts     accounts.json（账号/令牌摘要，落盘）
                     ↑
                 shared/gameLogic.js  与服务端共用同一份规则实现
```

三条不可动摇的设计约束：

1. **客户端不做权威落子** —— 前端只用规则层做选中/可走格提示，能否落子由服务端裁决；
2. **全量快照是唯一真相** —— 断线回连直接以 `game.state` 覆盖本地，因此**不需要重放历史走法**；
3. **规则同构** —— 前后端都从 `shared/gameLogic.js` 导入，避免"两套规则各说各话"。

### 协议一览

客户端 → 服务端：

| 消息                                                  | 说明                                 |
| ----------------------------------------------------- | ------------------------------------ |
| `room.join {roomId, name}`                            | 加入/创建房间（第二人入座即开局）    |
| `room.resume {gameId, sessionId}`                     | 凭重连凭据认领原座位                 |
| `game.move {gameId, baseSeq, from, to}`               | 发起走子（`baseSeq` 做乐观并发校验） |
| `game.resign {gameId}`                                | 认输                                 |
| `sync.request {gameId}`                               | 主动拉取全量权威快照                 |
| `match.join {playerId, name?, token?}`                | 进入随机匹配队列                     |
| `match.leave`                                         | 取消匹配                             |
| `profile.get {playerId, token?}`                      | 查询排位档案                         |
| `leaderboard.get {limit?}`                            | 查询排行榜                           |
| `auth.register {username, password, name?, guestId?}` | 注册（可把游客战绩迁入账号）         |
| `auth.login {username, password}`                     | 登录                                 |
| `auth.me {token}`                                     | 用已存令牌恢复登录态                 |
| `auth.logout {token}`                                 | 退出登录                             |
| `ping {ts}`                                           | 心跳探测                             |

服务端 → 客户端：`pong`、`room.waiting`、`room.joined`、`game.state`（全量快照）、`game.move.accepted`、`game.move.rejected`、`game.over`、`match.queued`、`match.found`、`profile`、`leaderboard`、`rating.update`、`auth.ok`、`auth.error`、`auth.loggedOut`、`error`。

### 权威走子校验

`game.move` 全部在服务端 `Game.move()` 里按序裁决，拒绝原因直接回给客户端：

| 拒绝原因        | 触发条件                                             |
| --------------- | ---------------------------------------------------- |
| `stale_seq`     | `baseSeq` 落后于服务端当前 `seq`（客户端状态已过期） |
| `not_your_turn` | 非行棋方抢行                                         |
| `illegal_move`  | 走法不在合法走法集合内                               |
| `game_over`     | 对局已结束                                           |
| `not_found`     | gameId 不存在                                        |

`baseSeq` 是乐观并发控制的版本号：客户端每次收到快照都同步 `seq`，落子时带上自己看到的版本；服务端只接受"基于最新版本"的走子，从而防止双发、乱序与网络延迟导致的错位。

### ELO 随机匹配（P1）

| 参数         | 取值                                         |
| ------------ | -------------------------------------------- |
| 初始分       | 1200                                         |
| K 系数       | 32                                           |
| 期望胜率     | `E(A) = 1 / (1 + 10^((Rb−Ra)/400))`          |
| 分数变化     | `Δ = round(K × (实际得分 − 期望))`，双方零和 |
| 匹配起始区间 | ±100 分                                      |
| 区间放宽     | 每 5 秒 +100，上限 ±800                      |
| 兜底         | 等待超过 30 秒忽略分差，直接与最近的人开局   |

匹配成功即创建**排位局**（`ranked: true`），终局后由服务端统一结算：写 `ratings.json`、下发 `rating.update`（含双方新分与分差）。房间号对局为休闲局，不计分。

### 断线重连与状态同步（P2）

- 入座时服务端下发 `sessionId`（座位凭据），客户端存 `sessionStorage`，**按标签页隔离**；
- 断线后服务端保留座位 **30 秒**（`RECONNECT_GRACE_MS` 可配置），并向对手广播 `offline` 信息与倒计时；
- 期间客户端用**指数退避**自动重连，`room.resume` 认领原座位（颜色、棋盘、seq 全部不变）；
- 刷新页面也能续局：`sessionId` 在 `sessionStorage` 中存活，重连后直接以快照恢复；
- 宽限期结束仍未回连 → 判该方负（`reason: disconnect`）。

### 排行榜

服务端 `RatingsStore.top(limit)` 按分数降序返回（同分按昵称升序，保证顺序稳定），`limit` 钳制在 1..100。**只收录 `games > 0` 的档案**——因为任何访客打开页面都会自动建档（0 场），不过滤会让榜单被空档案占满。

前端在大厅展示 Top 10，连接建立时自动拉取；榜单为空时提示"暂无排位记录，打完一局随机匹配后出现"。

### 身份与账号

| 模式 | 身份来源                    | 存储                         | 换浏览器 | 排行榜   |
| ---- | --------------------------- | ---------------------------- | -------- | -------- |
| 游客 | 本机 UUID（`cc.playerId`）  | localStorage                 | 分数丢失 | 可以上榜 |
| 账号 | 注册时服务端生成的固定 UUID | 令牌 `cc.authToken`（30 天） | 登录找回 | 可以上榜 |

- **游客模式保留**：不登录也能开房间、随机匹配、积累分数；只是分数只认这台浏览器。
- **注册**：密码用 `node:crypto` 的 `scrypt` 加盐派生（不存明文），令牌只落盘 sha256 摘要；注册时会自动把**当前游客的战绩并入新账号**（仅当游客有战绩、账号尚无战绩时），否则刚注册就被打回 1200 分。
- **令牌权威**：带令牌时服务端以令牌解析出的 `playerId` 为准，**忽略客户端自报的 playerId**，所以无法伪造 id 冒用他人分数；昵称也固定为账号昵称。
- **退出登录**：只让当前令牌失效，不影响其他设备上的登录。

左下角常驻一个 uid 角标（显示前 8 位，悬停可见全量），并标注当前是"游客"还是"账号"。

> 找回密码、邮箱验证、第三方 OAuth 均未实现（避免引入邮件服务等外部依赖）。忘记密码目前需要删除 `server/data/accounts.json` 中对应记录。

### PWA（P3）

- `manifest.webmanifest`：`standalone` 显示、中文名称、192/512/maskable/apple-touch 图标；
- `public/sw.js`（手写，无 Workbox）四级缓存策略：
  1. App Shell 预缓存（HTML/manifest/图标）—— 离线也能打开外壳；
  2. 导航请求**网络优先**，失败回退 Shell；
  3. `/pikafish/` 下的引擎 js/wasm **缓存优先**；
  4. 其余同源静态资源 **stale-while-revalidate**；
- 非 GET 请求与跨域请求（含 `ws://` 联机）一律不接管；
- Service Worker **只在生产构建注册**（`import.meta.env.PROD`），因此需 `npm run build` + `npm run preview` 验证；
- 安装引导（`beforeinstallprompt`）与离线角标由 `PwaControls.jsx` 提供。

## 快速开始

### 目录结构与命令

前后端是两个独立 package：根目录管前端，`server/` 管服务端。根目录已提供快捷脚本，**不需要手动 `cd`**：

```bash
# 安装依赖（前端 + 服务端各一次）
npm install
npm --prefix server install

# 启动联机服务端  ->  ws://localhost:8787  (健康检查 /health)
npm run server

# 启动前端开发服  ->  http://localhost:5174
npm run dev
```

两个终端分别跑 `npm run server` 与 `npm run dev`，打开 `http://localhost:5174` 即可。

| 根目录命令              | 等价操作                        | 用途                              |
| ----------------------- | ------------------------------- | --------------------------------- |
| `npm run server`        | `cd server && npm run start`    | 启动联机服务端（tsx）             |
| `npm run server:dev`    | `cd server && npm run dev`      | 同上，改代码自动重启（tsx watch） |
| `npm run dev`           | `vite`                          | 前端开发服                        |
| `npm run build`         | `vite build`                    | 生产构建到 `dist/`                |
| `npm run preview`       | `vite preview`                  | 预览构建结果（4173）              |
| `npm run lint`          | `oxlint`                        | 静态检查                          |
| `npm run engine:verify` | `node scripts/engine/verify.js` | Pikafish 棋盘↔UCI 联调验证        |

### 服务端可配置环境变量

| 变量                 | 默认值                      | 说明                   |
| -------------------- | --------------------------- | ---------------------- |
| `PORT`               | `8787`                      | WebSocket / HTTP 端口  |
| `HOST`               | `0.0.0.0`                   | 监听地址               |
| `RECONNECT_GRACE_MS` | `30000`                     | 断线宽限期（超时判负） |
| `RATINGS_FILE`       | `server/data/ratings.json`  | 排位档案落盘路径       |
| `ACCOUNTS_FILE`      | `server/data/accounts.json` | 账号/会话落盘路径      |

> 排位与账号都是**单机 JSON 落盘**，适合本地/小型联机；重启服务端不丢分，删除对应文件即重置（重启后生效）。

### 同机测试多个用户

- **房间模式**：同一浏览器开两个标签即可——座位凭据存在 `sessionStorage`，按标签页隔离，天然是两把座位。
- **匹配/排位模式**：两个标签共享同一个 `localStorage` 身份，会被认成同一人（服务端也会拒绝自己匹配自己）。用 URL 参数区分身份：

```
http://localhost:5174/?pid=alice
http://localhost:5174/?pid=bob
```

也可以"普通窗口 + 隐身窗口"或换浏览器。注意：换 origin（`localhost` / `127.0.0.1` / 不同端口）意味着换一套 `localStorage`，即换一个游客身份。

### 局域网联机（另一台电脑 / 手机）

默认配置已支持局域网，无需改代码：

- **前端**：`vite.config.js` 设了 `server.host: true`，`npm run dev` 启动后会打印 `Network` 地址，形如
  `http://10.130.201.223:5174/`；
- **后端**：服务端默认监听 `0.0.0.0:8787`，局域网可直接访问；
- **联机地址自适应**：前端不再硬编码 `localhost`，而是按"页面所在主机名 + 8787"拼 WebSocket 地址——
  用 `http://10.130.201.223:5174` 打开页面，就会自动连 `ws://10.130.201.223:8787`。

另一台设备与这台电脑连**同一 Wi-Fi / 同一网段**，浏览器打开启动日志里的 `Network` 地址即可。

首次启动时 Windows 会弹出防火墙提示，**必须勾选"专用网络"并允许**；若没有弹窗或仍连不上，可用管理员 PowerShell 手动放行：

```powershell
netsh advfirewall firewall add rule name="CC-5174" dir=in action=allow protocol=TCP localport=5174
netsh advfirewall firewall add rule name="CC-8787" dir=in action=allow protocol=TCP localport=8787
```

注意事项：

- 公司/学校 Wi-Fi 常开启 **AP 隔离**（客户端之间不能互访），此时只能手机热点或家用路由器；
- 若服务端部署在另一台机器，可用 `VITE_WS_URL=ws://192.168.1.10:8787 npm run dev` 显式指定；
- 局域网地址与 `localhost` 是**不同 origin**，游客身份（`localStorage`）互不相通；要跨设备保留分数请注册账号（账号数据在服务端）；
- 当前是明文 `ws://`，仅适合可信局域网，不要直接暴露到公网。

### 协议级冒烟测试

`server/scripts/` 下四个协议级脚本。`smoke-p1.mjs` 与 `smoke-auth.mjs` 会**自行拉起隔离实例**（独立端口 + 临时数据文件），不污染开发数据；`smoke.mjs` 与 `smoke-p2.mjs` 连接开发服务端，需先启动。

```bash
node server/scripts/smoke.mjs        # P0：13 项（需 8787 在跑）
node server/scripts/smoke-p1.mjs     # P1：26 项（自建实例，端口 8799）
node server/scripts/smoke-p2.mjs     # P2：13 项（需 8787 在跑）
node server/scripts/smoke-auth.mjs   # P4：22 项（自建实例，端口 8801）
```

也可在 `server/` 下用 `npm run smoke` / `npm run smoke:p1` / `npm run smoke:p2` / `npm run smoke:auth`。

### 常规验证清单

```bash
cd server && npx tsc --noEmit          # 服务端类型检查
cd .. && npx oxlint src server/src shared server/scripts   # 静态检查
npx vite build                          # 前端构建
```

## 构建产物

```bash
npm run build
```

产物输出到 `dist/` 目录，包含：

- `index.html` — 入口 HTML
- `assets/index-*.css` — 压缩后的样式
- `assets/index-*.js` — 压缩后的 JS bundle（含 React 运行时，约 253KB）
- `sw.js` / `manifest.webmanifest` / `icons/` — PWA 资源（由 `public/` 原样拷贝）

> 静态 `dist/` 只有前端外壳：联机需另行运行 `npm run server`，Pikafish 分析面板需 `npm run dev` / `npm run preview` 的中间件。纯静态部署时页面对局仍可正常使用（单机 AI），联机与引擎分析不可用。
