# 03 算法与引擎：规则、Minimax、Pikafish

## 1. 象棋规则引擎

文件：[shared/gameLogic.js](../shared/gameLogic.js)

### 1.1 数据表示

```js
board[row][col] = null | { type: 'king'|'rook'|..., color: 'red'|'black', label: '帅' }
```

- `row 0` 是黑方底线，`row 9` 是红方底线；`col 0` 是屏幕最左列。
- 红方文件号：`CN_NUM[8 - c]`（红方从自己的右侧数，即屏幕右侧为“一”）。
- 黑方文件号：`CN_NUM[c]`（黑方从自己的右侧数，即屏幕左侧为“一”）。
- 选择二维数组而非一维 90 格：所有走法都是 `r/c` 偏移，二维更直观；棋盘很小，克隆成本可接受。

### 1.2 走法生成（`getLegalMoves` L58）

| 棋子 | 规则 | 关键边界 |
| --- | --- | --- |
| 车 | 四方向直线滑动，遇子停；可吃第一个敌子 | 不能越子 |
| 炮 | 四方向滑动；空格可走；吃子必须**恰好隔一个炮架** | 炮架之后找第一个子，是敌子才可吃 |
| 马 | 8 个“日”字；检查马腿 | 马腿坐标是长边方向的第一格 |
| 象/相 | 田字；检查象眼；不过河 | 红 `row>=5`，黑 `row<=4`；象眼必须在棋盘内 |
| 士/仕 | 九宫斜走一格 | 红 `row 7..9, col 3..5`；黑 `row 0..2, col 3..5` |
| 将/帅 | 九宫内直走一格；**飞将**：同列无阻挡可直接吃对方将 | 飞将写进将的走法里，`isInCheck` 因此能识别 |
| 兵/卒 | 未过河只能向前；过河后可左右 | 红向前 `row-1`，过河 `row<=4`；黑向前 `row+1`，过河 `row>=5` |

这里生成的是**伪合法着法**：不检查走完后己方是否被将。原因：

- 搜索里用“吃将”作为终局，伪合法 + 吃将判断足够驱动 AI；
- 交互和服务端再套一层 `getSafeMoves` 过滤，保证人类不会走出送将。

### 1.3 将军与安全着法

```js
isInCheck(board, color):
  king = findKing(board, color)
  遍历对方所有棋子：
    遍历其伪合法着法
    若命中 king 坐标 → 被将
```

- 飞将之所以能被检测：将的伪合法着法包含“沿同列吃对方将”。
- `getSafeMoves`：对每个伪合法着法，`makeMove` 后检查己方是否仍被将。
- `hasLegalMove`：任意棋子存在安全着法；用于将死/困毙。

复杂度：`hasLegalMove` 最坏 16 子 × 平均 ~10 着 × 每次 `isInCheck` 再遍历对方 ~16 子 → 常数很大，但棋盘只有 90 格，交互频率低，可接受。搜索里不用它，避免每层都做全量安全过滤。

### 1.4 终局判定（服务端与单机一致）

```text
吃到将             → checkmate
对方无任何安全着法  → 被将 = checkmate；未被将 = stalemate（困毙，判负）
新局面第三次出现    → repetition（和棋）
计时归零（仅单机）  → timeout
认输               → resign
断线宽限期超时      → disconnect
```

重复局面指纹 `boardKey`：

```js
每格：cell.color[0] + cell.type，空格为 "."
整体：10 行用 "/" 连接，再拼 "|" + 行棋方
```

不含步数/计时，符合“同一局面 + 同一行棋方”的三次重复定义。简化点：没有实现长将/长捉裁决。

### 1.5 FEN 与 UCI

文件：[shared/fen.js](../shared/fen.js)

- `boardToFEN`：`row 0` 直接作为 FEN 第一行（rank 9），红方为 `w`、黑方为 `b`。
- `fenToBoard`：校验 10 行、每行 9 格、字符合法。
- `moveToUCI`：`file = a + c`，`rank = 9 - r`；例如红方 `row9,col0` → `a0`。
- `uciToMove`：逆变换。

这四个函数是“应用坐标”和“引擎坐标”的唯一桥。面试时可以说：**坐标转换只允许出现在 `fen.js`，业务层永远用 `{r,c}`，避免两套坐标系互相污染。**

### 1.6 中文记谱（`generateNotation` L292）

规则：

```text
棋子名 + 起点线 + 动作 + 终点/步数
动作：
  横走 → 平<终点线>
  车/炮/兵/将 纵走 → 进/退<步数>
  马/象/士 斜走 → 进/退<终点线>
同列同色同类型 ≥2 子：
  红方：行号小的为“前”，大的为“后”
  黑方：行号大的为“前”，小的为“后”
```

例：`炮二平五`、`马八进七`、`前车进一`。

已知限制：

- 同线 3 个以上同类型棋子时，`idx >= 2` 会退回“棋子名 + 起点线”，可能产生歧义；标准记谱应使用“前/中/后”或“前/二/三”。
- 没有处理“同一终点线多子”的完整消歧规则。

这两点是面试官最容易挑的规则细节，回答要诚实：**当前覆盖了常见局面，完整记谱需要更细的同线排序与消歧表。**

---

## 2. Minimax + Alpha-Beta

文件：[src/services/aiService.js](../src/services/aiService.js)

### 2.1 难度配置

```js
easy:     depth 3
medium:   depth 4
hard:     depth 5 + 8 秒预算（迭代加深）
pikafish: 交给原生引擎
```

### 2.2 核心递归（L24）

```text
minimax(board, depth, alpha, beta, isMaximizing):
  stats.nodes++
  moves = getAllLegalMoves(board, 当前方)
  if moves 为空: return 当前方输的极值
  if depth == 0: return evaluateBoard(board)

  ordered = orderMoves(moves)         // 吃子优先
  for move in ordered:
      newBoard, captured = makeMove(...)
      if captured 是 king:
          return ±(100000 + depth)     // 越早将死分越高
      score = minimax(newBoard, depth-1, alpha, beta, !isMaximizing)
      更新 best / alpha / beta
      if beta <= alpha: stats.prunes++; break
```

- **评估函数**：红为正、黑为负；物质总和，兵过河翻倍。
- **吃子排序**：按被吃棋子价值排序（将 6 > 车 5 > 炮 4 > 马 3 > 象 2 > 士 1 > 兵 0）。吃子优先能更早抬高 alpha / 压低 beta，提升剪枝率。
- **将死分数**：`100000 + depth` 让“更早将死”优于“更晚将死”；负分对称。
- **根节点**：`isMaximizing = aiColor === 'red'`，因为评估函数以红方为正。

### 2.3 Alpha-Beta 为什么能剪枝

以最大化层为例：

```text
alpha = 当前 MAX 已知最好值
beta  = 上层 MIN 已知最好值（对 MAX 来说是可接受上界）
若 beta <= alpha：
  MIN 不会允许走到这个分支（它已有更差的选择）
  → 剩余兄弟节点不可能影响结果 → 剪掉
```

理想复杂度：

- 纯 Minimax：`O(b^d)`，b≈40、d=5 → 约 `1.02 × 10^8` 个叶子。
- Alpha-Beta 最理想：约 `O(b^(d/2))` → 约 `2 × 10^4`；实际取决于走法排序，通常介于两者之间。
- 这也是为什么“吃子排序”是低成本高收益的优化。

### 2.4 迭代加深（L81）

```text
best = allMoves[0]
for d = 1..maxDepth:
    if 已超时: break
    stats.depthReached = d
    result = minimax(board, d, -∞, +∞, ...)
    if result.move: best = result.move
return best
```

优点：

- 任意时刻都有一个“当前深度最好解”；
- 浅层结果可用于下一层走法排序（当前实现还没做）；
- 时间预算可控（理论上）。

**关键缺陷（要主动说）**：

- 时间检查只在**每层开始前**，`minimax` 内部没有时钟检查，单层搜索不可中断，最坏会明显超过 8 秒。
- `stats.depthReached = d` 在搜索前赋值，如果该层中途超时（未来加了内部检查），统计会虚报深度。
- 迭代加深没有把上一层的最佳着法放到下一层最前面，收益未完全兑现。

### 2.5 评估函数的取舍

当前只有物质 + 过河兵：

```text
king 100000, rook 900, cannon 450, knight 400, bishop 200, advisor 200, pawn 100/200
```

缺少：

- 位置分（马中心、车占线、炮镇中路、兵推进）；
- 机动性（合法着法数）；
- 将安全（九宫防守、暴露度）；
- 子力协同（车马炮配合）；
- 局面阶段（开局/中局/残局权重）。

为什么仍然能用：象棋的物质价值差距很大，纯物质搜索在业余水平已经能下；而且**可解释**——面板上的节点/剪枝/深度/耗时都能对应到这套实现。

### 2.6 搜索层的已知问题与改进顺序

| 问题 | 影响 | 改进 |
| --- | --- | --- |
| 伪合法着法 + 吃将终局 | 叶节点无法识别将死/困毙；极端局面可能选到未解将着法 | 搜索内用安全着法；根节点先过滤 `getSafeMoves` |
| 无静止搜索 | 地平线效应：在吃子交换中途截断，评估偏差 | 加 quiescence（只扩展吃子/将军） |
| 无置换表 | 同一局面重复搜索 | Zobrist + TT（`boardKey` 已是雏形） |
| 排序只看被吃子价值 | 剪枝率一般 | MVV-LVA、killer moves、history heuristic |
| 主线程同步搜索 | depth 5 / 8 秒阻塞 UI | Web Worker + 可中断搜索 |
| 无重复局面规避 | AI 可能主动走进三次重复 | 搜索路径维护 `boardKey` 计数 |
| 无开局库/残局库 | 开局每盘可能不同 | 开局库或固定首着池 |

### 2.7 面试可讲的“算法权衡”

> 我没有一上来就追求棋力，而是先保证“可解释、可演示、无依赖”。Minimax + Alpha-Beta 的每个数字都能在 UI 上解释；Pikafish 则负责棋力上限。两者解决的是不同约束：一个是教学与可控，一个是强度与专业分析。

---

## 3. Pikafish / UCI 集成

### 3.1 为什么是“Vite 中间件 + 原生 exe”

```text
浏览器不能 spawn 进程
  → 需要一个本地服务托管引擎
  → 开发期已有 Vite，用中间件最省一次部署
  → Vite 进程 spawn Pikafish.exe，stdin/stdout 走 UCI
  → 浏览器只发 HTTP，拿 JSON
```

相关文件：

- [vite-plugin-pikafish.js](../vite-plugin-pikafish.js)：HTTP 端点 + `EngineHost`
- [scripts/engine/pikafish-client.js](../scripts/engine/pikafish-client.js)：UCI 行协议客户端
- [Pikafish-master/release/Pikafish.exe](../Pikafish-master/release/Pikafish.exe) + `pikafish.nnue`

端点：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/__pikafish/analyze` | 分析一个 FEN，返回 bestmove + 每路 PV/score/wdl/depth |
| POST | `/__pikafish/reset` | `ucinewgame`，清空上一局搜索记忆 |

### 3.2 UCI 生命周期

```text
spawn exe
  → "uci"            → 等 "uciok"
  → setoption Threads=4
  → setoption Hash=64
  → setoption UCI_ShowWDL=true
  → "isready"        → 等 "readyok"

每次分析：
  → setoption MultiPV=N
  → position fen <FEN>
  → go movetime 500  /  go infinite
  → 读 info depth/score/wdl/pv
  → stop（infinite 模式）
  → 等 bestmove
```

`PikafishClient` 的关键设计：

- 所有输出行保留在 `lines`，分析时用 `start = lines.length` 切片，避免混入上一轮；
- `waitFor` 同时监听 `!ENGINE-ERROR` / `!ENGINE-EXIT` 标记；
- `quit()` 先发 `quit`，500ms 未退出再 `kill`，避免僵尸进程；
- `go()` 无参数时默认 `infinite`。

### 3.3 串行队列 + 最新请求取胜

这是整个引擎集成最值得讲的部分。

```text
请求 A(id=100) 正在搜索
请求 B(id=101) 到达
  → latest = 101
  → searching=true → interrupt()：发 stop，唤醒延时
  → 队列排队 B

A 的 awaitBestmove 返回
  → 检查 id !== latest → 返回 stale
  → finally searching=false
B 开始执行
```

三层失效检查：

1. 进 job 前：`id !== latest` 直接 stale，不碰引擎；
2. `ensure()` 之后：引擎启动期间又被新请求取代，也直接 stale；
3. `awaitBestmove` 之后：搜索期间被取代，丢弃结果。

为什么需要：

- 用户快速连点/连续走子时，旧局面的分析没有意义；
- 引擎同一时刻只能搜一个局面，必须串行；
- `bestmove` 必须被消费，否则会污染下一次请求。

`latest` 用递增 `id` 而不是 FEN 字符串：同一局面也可能因为“模式切换/强制重算”需要重新搜索，`id` 能表达“这次请求比上次新”。

### 3.4 `go infinite` + `minDepth` 而不是固定时间

深度模式：

```json
{ "multiPV": 256, "infinite": true, "minDepth": 10, "delay": 4000 }
```

- `go infinite` 让引擎一直搜；
- 服务端每 40ms 扫 `info ... multipv 1 ... depth`；
- 主变深度达到 10 就 `stop`；
- 最晚 4 秒兜底，避免无限等待。

好处：

- 开局复杂、深度上得慢时，不会只拿到 depth 6 的抖动结果；
- 简单局面很快达到 depth 10，提前停止，省 CPU；
- 比“固定 800ms”更稳，推荐走法不会每盘乱跳。

代价：

- 需要自己解析 `info` 行、管理 `stop`；
- 如果引擎不输出 `depth`，只能等满 `delay`。

### 3.5 MultiPV 的坑

实测：Pikafish 对超过约 **128** 的 MultiPV 会静默拒绝并回到默认 1。

所以：

```js
MAX_ENGINE_MULTIPV = 128
capMultiPV(requested, fen):
  v = min(128, max(1, requested))
  legal = 当前局面合法着法数（用 shared/gameLogic 算）
  v = min(v, legal)
```

- 深模式请求 256 → 服务端钳到 128 → 再按实际合法着法数收敛；
- 保证“不漏着法”，也不会让引擎忽略 MultiPV 设置；
- `legalMoveCount` 复用共享规则，不需要自己再写一遍。

### 3.6 分数与胜率

`info` 行解析：

```text
score cp <厘兵> | score mate <步数>
wdl <win> <draw> <loss>          // 千分比
pv <uci 着法序列>
depth <n>
multipv <k>
```

`summarize`：

- 每个 `multipv` 取 `depth` 最大的一条（搜索过程中会多次输出同一路）；
- 按 `multipv` 升序返回 `moves`；
- `best = multipv 1`，其 `score/wdl/depth` 作为全局结果。

`wdl` 字段存在，但界面**没有直接用**引擎 WDL，而是用局面分算“软胜率”：

```js
win  = 100 / (1 + 10^(-s/400))     // logistic，s 为行棋方视角厘兵
draw = round(60 * exp(-|s|/180))   // 领先越多，和棋概率越低
redWin = round(win * (100 - draw) / 100)
```

原因：

- 引擎 WDL 在领先约 300 厘兵后就容易饱和到 100%，观感差；
- logistic 永不归 1，领先一兵约 64%、一马约 88%、一车约 95%，更符合人类直觉；
- 和棋概率上限 60%，避免“必胜”观感。

### 3.7 视角统一

引擎分数以**行棋方**为正。UI 要按“玩家视角”展示：

```text
玩家执红：红方分数 = 引擎分数
玩家执黑：黑方分数 = -引擎分数
```

`UIManager.buildPieceMap` / `buildSidebarRows` 都做这个翻转；`PikafishPanel.playerScore` 也做。

一个容易问的点：

> 为什么 `buildAndRate`（选子指示器）不翻转？

因为选中的棋子一定属于当前行棋方，落点分数天然就是“当前行棋方视角”，与选中方一致，不需要再翻。

### 3.8 缓存与失效

`EngineController`：

- `_activeFen`：同一局面去重；
- `_seq`：每次请求递增，响应回来若已过期直接丢弃；
- `_ctrl`：`AbortController`，重开/新请求可中止；
- `_opening`：只缓存标准开局；深模式结果可降级给浅模式，反之不行；
- `_analyzedOnce`：防止 StrictMode 双挂载导致双请求；
- `resetForNewGame`：`_seq++`、abort、清状态、`POST /reset`。

### 3.9 异常恢复

| 异常 | 处理 |
| --- | --- |
| exe 不存在 / 启动失败 | `ensure()` 检查 `!ENGINE` 行并抛错；HTTP 返回 `{ok:false,error}` |
| 引擎崩溃 | job catch → `dispose()`；下一次请求重新 spawn + UCI 握手 |
| 搜索超时 | `awaitBestmove(30000)` 超时 → job 失败 → dispose |
| 客户端请求超时 | 30 秒 Abort → 面板显示“分析超时” |
| `MultiPV` 过大 | 服务端钳制，不让引擎静默失效 |
| 旧请求 | `id` 三层检查 + 客户端 `seq` 检查 |

### 3.10 为什么不用 WASM

- `public/pikafish` 下有 WASM 资产，但没有接入主流程，属于历史遗留；
- 原生 exe 的棋力、线程、NNUE 支持更完整；
- WASM 适合纯静态部署，但需要额外处理线程/内存/加载体积；
- 当前定位是开发期演示，原生方案成本更低。

面试时如果被问“线上怎么部署”，答案：

> 把 `EngineHost` 抽成独立分析服务（Node/Python 均可），HTTP 或消息队列接入；引擎进程池化，按 `id` 做请求失效，前端只依赖分析 API。Vite 中间件只是开发期载体。

---

## 4. 算法部分的面试雷区

1. **不要说“Alpha-Beta 一定能把 40^5 降到 2 万”**：那是理想排序下的上界，实际远高于此；说“取决于排序，通常能剪掉大部分”。
2. **不要把“吃将”说成完整将死判定**：搜索里是吃将终局；将死/困毙是交互层用 `hasLegalMove` 判的。
3. **不要回避时间预算的缺陷**：单层不可中断，可能超时；正确做法是搜索内部检查时钟 + Worker。
4. **不要说 WDL 是界面胜率来源**：界面是局面分 logistic 软胜率，WDL 只是引擎输出之一。
5. **不要把飞将说成单独规则**：它被编码进“将的走法”，所以 `isInCheck` 自然能检测。
6. **不要声称记谱完整**：同线三子以上未覆盖，主动说明。
