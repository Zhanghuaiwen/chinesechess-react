# 中国象棋 (Chinese Chess)

基于 Minimax + Alpha-Beta 剪枝算法的中国象棋人机对弈，纯前端 React 应用。

## 技术栈

| 层      | 技术                     |
| ------- | ------------------------ |
| 框架    | React 19                 |
| 构建    | Vite 8                   |
| 语言    | JavaScript (JSX)         |
| 静态检查 | oxlint                  |
| AI 引擎 | Minimax + Alpha-Beta 剪枝（自实现，无外部依赖） |
| 分析引擎 | Pikafish（本地 UCI 中国象棋引擎，经 Vite 中间件常驻子进程） |
| 样式    | 原生 CSS（无 UI 框架）    |

零 AI 运行时依赖——不依赖 Ollama、LLM API 或任何第三方 AI 服务。对局 AI（Minimax + Alpha-Beta）完全在浏览器本地运行；右侧 Pikafish 分析面板则由**本地原生引擎**驱动（详见下文"Pikafish 实时分析面板"），同样不访问任何在线服务。

## 项目结构

```
src/
├── main.jsx                  # React DOM 入口
├── App.jsx                   # 根组件，组装布局 & 调度 AI 触发
├── App.css                   # 全局样式
├── hooks/
│   └── useGame.js            # 核心游戏状态机（棋盘、回合、计时、AI 编排）
├── components/
│   ├── Board.jsx             # 10×9 棋盘网格 + 棋子慢速滑行动画
│   ├── Cell.jsx              # 单格组件（棋子渲染、选中/将军/落子高亮）
│   ├── GameInfo.jsx          # 状态栏（回合/计时器/难度/先手/时限/操作按钮）
│   ├── MoveList.jsx          # 棋谱列表（中国象棋记谱，点击回放）
│   ├── StatsPanel.jsx        # 对局数据面板（节点数、剪枝数、局面评估）
│   └── PikafishPanel.jsx     # Pikafish 分析面板（实时胜率/局面分/主要着法评分）
├── services/
│   └── aiService.js          # AI 搜索引擎（Minimax + Alpha-Beta）
└── utils/
    ├── gameLogic.js          # 游戏规则引擎（走法生成、将军/困毙检测、记谱、局面评估）
    ├── fen.js                # 棋盘 ↔ UCI FEN / UCI 着法 双向换算（前端与 Node 脚本共享）
    └── sound.js              # 音效模块（Web Audio 合成：落子/吃子/选中/将军/开局等）
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

| 棋子       | 基础分值 | 过河后 |
| ---------- | ------- | ------ |
| 将/帅 (king) | 100000  | —      |
| 车 (rook)    | 900     | —      |
| 炮 (cannon)  | 450     | —      |
| 马 (knight)  | 400     | —      |
| 象/相 (bishop) | 200   | —      |
| 士/仕 (advisor) | 200  | —      |
| 兵/卒 (pawn)  | 100     | 200    |

```js
score = Σ(红方棋子价值) - Σ(黑方棋子价值)
```

正值表示红方有利，负值表示黑方有利。兵/卒过河后分值翻倍以反映其威胁性提升。

### 将杀检测与距离偏好

当某走法吃掉对方将/帅时，搜索立即截断并返回一个 mate score：

- 红方将杀：`score = 100000 + remaining_depth`（越快将杀分数越高）
- 黑方将杀：`score = -100000 - remaining_depth`（越快将杀分数越低）

这使得 AI 在多个将杀走法中选择最快的路线。

## 难度系统

| 难度 | 搜索深度 | 策略说明                                 |
| ---- | ------- | ---------------------------------------- |
| 简单 | 2       | 仅考虑 2 步以内的走法，较弱但响应极快       |
| 中等 | 3       | 默认设置，平衡强度与速度                    |
| 困难 | 4       | 使用迭代加深（ID），最多 8 秒时间预算       |

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

从 depth=1 开始逐层加深，每层完成后检查时间预算。若超时，返回上一层已完整搜索的最佳走法，保证在最坏情况下也有合理走法返回。

## 搜索统计与对局数据

`aiService.js` 在搜索过程中维护一个 `stats` 对象，实时累计两类核心指标：

| 指标             | 含义                                     | 统计位置               |
| ---------------- | ---------------------------------------- | ---------------------- |
| `nodes`          | 访问过的博弈树节点总数                   | 每次 `minimax()` 入口 +1 |
| `prunes`         | Alpha-Beta 剪枝命中次数                  | `beta <= alpha` 时 +1   |
| `depthReached`   | 实际完成的搜索深度（迭代加深逐层更新）     | 每层搜索开始时记录      |

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

- **棋盘 → FEN**：`src/utils/fen.js` 的 `boardToFEN`（UCI rank = 9 − row、file = col；红方大写 R N B A K C P，黑方小写）
- **请求策略**：每次走子（`board`/`current` 变化）防抖 500ms 触发一次分析，思考 2 秒、`MultiPV=5`
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

| 局面分 s（红方视角） | 对应子力    | win（净胜概率） |
| ------------------- | ----------- | --------------- |
| 0                   | 均势        | 50%             |
| +100                | 多 1 兵     | ≈64%            |
| +400                | 多 1 马     | ≈89%            |
| +900                | 多 1 车     | ≈99.5%（渐进）  |

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

| 局面       | 局面分 | 面板显示          |
| ---------- | ------ | ----------------- |
| 均势       | +23    | 红 25% 和 53% 黑 22% |
| 红多 1 兵  | +29    | 红 27% 和 51% 黑 22% |
| 红多 2 兵  | +47    | 红 31% 和 46% 黑 23% |
| 红多 1 马  | +360   | 红 82% 和 8% 黑 10% |
| 红多 1 车  | +616   | 红 95% 和 2% 黑 3%  |

> **注意**：① 这是**展示用的人性化换算**，并非引擎官方 WDL——官方模型更陡、更"引擎级严格"；② 胜率随搜索深度/时间轻微波动属正常（局面分本身会收敛）；③ 面板只反映当前局面的评估，与终局结果（将死/困毙/三次重复/超时）无关。

## 悔棋功能

`useGame` 维护一个 `history` 栈，每次 `doMove` 落子前将**当前快照** `{ board, current, gameOver }` 压栈。悔棋逻辑按对局模式决定回退层数：

- **AI 模式**：回退 2 层（撤销 AI 应手 + 玩家本手），若当前为 AI 回合则回退 1 层
- **双人对弈模式**（关闭 AI）：回退 1 层

悔棋恢复时同步清除选中态/标记，并重置 AI 防重入锁（`aiRef`）与思考状态，避免残留的定时器触发异常走子；同时截断棋谱 `moves`、重新计算将军状态与落子高亮。

## 产品功能

### 1. 将军提示

- 落子后调用 `isInCheck(newBoard, next)` 检测对方是否被将军
- 若被将军：棋盘上被将军的将/帅格子**红色脉冲高亮**，顶栏弹出红色 **"将军！"** 徽章，并播放警示音效

### 2. 胜负判定补全

完整的终局判定（`doMove` 内按序检查）：

| 情形 | 判定 | 说明 |
| ---- | ---- | ---- |
| 吃掉将/帅 | 直接判负 | 保留原逻辑 |
| 无合法走法 + 被将军 | **将死** | 攻击方获胜 |
| 无合法走法 + 未被将军 | **困毙** | 按中国象棋规则，无子可走的一方判负 |
| 同一局面出现 3 次 | **三次重复判和** | 通过 `boardKey`（棋盘序列化 + 行棋方）计数，覆盖常见长将/长捉场景 |

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

所有规则在 `src/utils/gameLogic.js` 中实现：

- **车 (Rook)**：直线滑动，遇子停止
- **马 (Knight)**：日字走法，蹩马腿检测
- **象/相 (Bishop)**：田字走法，塞象眼检测，不可过河
- **士/仕 (Advisor)**：九宫内斜走一步
- **将/帅 (King)**：九宫内直走一步，支持飞将（将帅对面）
- **炮 (Cannon)**：直线滑动，吃子需隔一子（炮架）
- **兵/卒 (Pawn)**：过河前只能前进，过河后可左右

走法生成（`getLegalMoves`）不做将军过滤——AI 搜索在递归中通过吃将/帅自动处理将军与将杀；人类玩家走子则经 `getSafeMoves` 过滤，防止送将。辅助函数：`isInCheck`（将军检测，含飞将）、`hasLegalMove`（困毙/将死判定）、`boardKey`（三次重复判和的局面指纹）。

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev
```

> Pikafish 分析面板仅在 `npm run dev` / `npm run preview` 下可用（由 Vite 中间件常驻本机引擎进程）。若提示"引擎未连接"，请确认 `Pikafish-master/release/Pikafish.exe` 与 `pikafish.nnue` 存在。

# 生产构建
npm run build

# 预览构建结果
npm run preview

# 静态检查
npm run lint
```

## 构建产物

```bash
npm run build
```

产物输出到 `dist/` 目录，包含：

- `index.html` — 入口 HTML
- `assets/index-*.css` — 压缩后的样式
- `assets/index-*.js` — 压缩后的 JS bundle（含 React 运行时，约 200KB / 64KB gzipped）
