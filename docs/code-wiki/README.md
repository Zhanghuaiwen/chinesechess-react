# 中国象棋 AI 对弈平台 — Code Wiki（面试向）

> 仓库：`chinesechess-react`
> 文档目标：**先帮你把面试讲明白、答得住**；架构、模块、依赖、运行方式作为支撑材料。

---

## 0. 这份文档怎么用

| 时间 | 做什么 |
| --- | --- |
| 面试前 1 天 | 通读 [01-architecture.md](./01-architecture.md)、[02-modules-and-flows.md](./02-modules-and-flows.md) |
| 面试前 1 小时 | 读 [03-algorithms.md](./03-algorithms.md)、[04-online.md](./04-online.md)、[05-frontend.md](./05-frontend.md) 的“面试可讲点” |
| 面试前 10 分钟 | 只背本文的「30 秒介绍」「三条主线」「关键数字」「五个不足」+ [06-interview-qna.md](./06-interview-qna.md) 的 A/B/C/D 四组题 |
| 被追问代码 | 打开对应章节，按“入口 → 调用链 → 状态变化 → 边界条件”讲 |

文档索引：

1. [01-architecture.md](./01-architecture.md)：整体架构、依赖关系、设计约束、关键取舍
2. [02-modules-and-flows.md](./02-modules-and-flows.md)：模块职责、关键类与函数、协议、核心时序
3. [03-algorithms.md](./03-algorithms.md)：象棋规则引擎、Minimax + Alpha-Beta、Pikafish/UCI 集成
4. [04-online.md](./04-online.md)：WebSocket 服务端、权威状态机、断线重连、ELO、账号
5. [05-frontend.md](./05-frontend.md)：React 状态机、渲染/动画、Canvas 分析层、PWA
6. [06-interview-qna.md](./06-interview-qna.md)：**重点拷打题库与应对**（本文档的核心）
7. [07-run-and-demo.md](./07-run-and-demo.md)：运行方式、验证命令、演示脚本、排障

---

## 1. 30 秒项目介绍（建议直接背）

> 我做了一个前后端一体的中国象棋对弈平台。前端是 React 19 + Canvas，本地 AI 用 Minimax + Alpha-Beta，支持简单/中等/困难三档，困难档用迭代加深和 8 秒时间预算；联机侧是 Node.js + WebSocket，服务端持有唯一权威棋盘，前端只提交“走子意图”，用 `baseSeq` 做乐观并发校验；断线后凭 `sessionId` 在 30 秒宽限期内恢复原座位；排位用标准 Elo 和随时间放宽的分段匹配。另外把本地 Pikafish 原生引擎通过 UCI 接进 Vite 中间件，做实时局面分、胜率和 MultiPV 推荐走法。
>
> 这个项目最核心的设计是：**规则代码前后端同构，服务端权威裁决，客户端只做投影**。

如果对方只给你 15 秒，压缩成一句：

> 一个“本地可下、联机可战、引擎可分析”的象棋平台，重点解决了规则一致性、权威状态机和实时引擎通信三个工程问题。

---

## 2. 两分钟版本（STAR，适合“介绍一下你最得意的项目”）

- **S（背景）**：我想验证两件事——搜索算法能不能真的下棋，以及复杂对局状态机能不能做稳。所以没有停在“能点棋盘的 demo”，而是把本地 AI、联机对战、断线恢复、引擎分析都做进同一个仓库。
- **T（目标）**：完整象棋规则；可解释的本地 AI；服务端权威的联机对战；原生引擎实时分析。
- **A（动作）**：
  1. 把走法生成、将军/将死/困毙、记谱、局面评估抽到 `shared/gameLogic.js`，浏览器和 Node 共用同一份规则，服务端用 `getSafeMoves` 做权威校验。
  2. 本地 AI 用 Minimax + Alpha-Beta，加吃子排序；困难档做迭代加深 + 时间预算；AI 执红/执黑都能走。
  3. 联机侧用 `Game` 类持有唯一棋盘，走子带 `baseSeq`，服务端只接受基于最新版本的请求；断线保留座位 30 秒，客户端指数退避重连 + `room.resume` + 全量快照恢复。
  4. Pikafish 用 Vite 中间件托管常驻子进程，UCI 通信；服务端做串行队列 + 递增 `id` 失效旧请求，支持 `go infinite` 到指定深度。
- **R（结果）**：4 个协议级冒烟脚本共 74 项断言全绿；`tsc --noEmit`、`oxlint`、`vite build` 通过；单机、联机、断线续局、引擎分析均可现场演示。

---

## 3. 面试主线：只讲三件事

### 主线一：规则一致性 —— “同一份规则，两种运行环境”

- 事实：`shared/gameLogic.js` 同时被 `src/` 和 `server/src/` 引用。
- 关键点：前端只用它做**交互提示**（`getSafeMoves` 高亮可走格），服务端用它做**最终裁决**（`Game.applyMove`）。
- 结果：不会出现“前端能走、后端不认”或“两套规则各说各话”。
- 可延伸：这是“**单一事实来源（Single Source of Truth）**”在规则层的落地。

### 主线二：双 AI 架构 —— “可解释的本地搜索 + 强引擎”

- 本地：Minimax + Alpha-Beta，纯前端、零依赖、可展示节点数/剪枝数/深度/耗时。
- 引擎：Pikafish 原生 exe，UCI 协议，浏览器通过 Vite 中间件访问；提供实时胜率、局面分、MultiPV 推荐。
- 取舍：本地 AI 保证“离线也能玩、算法可解释”；引擎保证“棋力上限和分析质量”。
- 可延伸：算法不是替代工程，二者是**不同约束下的最优解**。

### 主线三：复杂状态机 —— “权威服务端 + 乐观并发 + 可恢复会话”

- 联机不是“把棋盘广播一下”：有座位、回合、版本号、离线宽限期、匹配队列、排位结算、账号身份。
- 关键机制：`baseSeq` 乐观并发、全量快照、`sessionId` 座位凭据、指数退避重连、`id` 请求失效。
- 可延伸：这是“**状态所有权**”问题——谁拥有真相，谁只是缓存。

---

## 4. 项目一页地图

```text
chinesechess-react/
├─ src/                          React 前端
│  ├─ App.jsx                    布局、模式切换、AI 触发、分析联动
│  ├─ hooks/
│  │  ├─ useGame.js              单机对局状态机（棋盘/回合/计时/悔棋/AI 调度）
│  │  └─ useOnlineGame.js        联机状态机（大厅/房间/匹配/重连/账号）
│  ├─ components/                棋盘、格、棋谱、状态栏、数据面板、Pikafish 面板
│  ├─ services/
│  │  ├─ aiService.js            Minimax + Alpha-Beta + 皮卡鱼走棋
│  │  └─ onlineService.js        WebSocket 客户端（心跳、重连）
│  ├─ engine/                    Pikafish 分析：控制器 + 数据编排 + Canvas 渲染
│  └─ utils/sound.js             Web Audio 合成音效
├─ shared/                       前后端同构
│  ├─ gameLogic.js               规则、走法、评估、记谱、局面指纹
│  └─ fen.js                     棋盘 ↔ FEN / UCI 走法
├─ server/
│  ├─ src/
│  │  ├─ index.ts                HTTP(/health) + WebSocket 入口
│  │  ├─ gateway.ts              消息路由、参数校验、断线处理
│  │  ├─ room.ts                 Game 权威状态机
│  │  ├─ store.ts                房间/对局内存注册表
│  │  ├─ matchmaker.ts           ELO 随机匹配队列
│  │  ├─ rating.ts               Elo 纯函数
│  │  ├─ ratings.ts              排位档案仓库（JSON 落盘）
│  │  ├─ accounts.ts             账号与会话（scrypt / token 摘要）
│  │  └─ protocol.ts             联机协议类型
│  └─ scripts/                   4 个协议级冒烟脚本（共 74 项）
├─ scripts/engine/               UCI 客户端、联调验证、MultiPV/WDL 探针
├─ vite-plugin-pikafish.js       Vite 中间件 + Pikafish 常驻子进程
├─ Pikafish-master/release/      Pikafish.exe + pikafish.nnue
└─ public/                       PWA：sw.js、manifest、图标
```

---

## 5. 技术栈与选型理由（面试官常问“为什么不用 X”）

| 选择 | 理由 | 没用另一个的原因 |
| --- | --- | --- |
| React 19 | 对局状态多但集中，组件只是投影；Hooks 足够 | 不需要 Redux：状态集中在两个 hook，跨组件用 props/订阅，引复杂度不划算 |
| 原生 WebSocket + `ws` | 协议是自定义 JSON，消息类型少；心跳/重连自己可控 | socket.io 会引入额外协议层和依赖，且断线语义由库决定，不便讲清 |
| 服务端权威 | 防作弊、防双发、防乱序；客户端只做乐观 UI | 纯 P2P/客户端权威无法保证双方一致 |
| 全量快照 | 实现简单、恢复可靠；棋盘 10×9 数据量很小 | 增量同步需要处理丢包、乱序、重放，复杂度高且收益低 |
| TypeScript（仅服务端） | 协议与状态形状多，类型能兜住重构 | 前端逻辑偏 UI，JS + lint 迭代更快 |
| JSON 落盘 | 零外部依赖，本地/小型联机足够 | 没引数据库：项目定位是单机演示，Redis/Postgres 属于过度设计 |
| Vite 中间件 + 原生 exe | 浏览器不能 spawn 进程；UCI 是成熟协议 | 没走 WASM：原生引擎棋力/速度更完整，WASM 资产未接入 |
| Canvas 覆盖层 | 热力图/推荐点数量多，Canvas 避免大量 DOM 节点 | DOM 节点会导致频繁重排，且动画成本高 |
| 手写 Service Worker | 只有 4 类缓存策略，代码可控、可解释 | Workbox 增加构建依赖，收益不明显 |

---

## 6. 关键数字速查（面试前必背）

| 类别 | 数字 |
| --- | --- |
| 棋盘 | 10 行 × 9 列，32 枚棋子；`row 0` 黑方底线，`row 9` 红方底线 |
| 本地 AI | 简单 depth 3 / 中等 depth 4 / 困难 depth 5 + 8 秒预算 |
| 棋子价值 | 将 100000、车 900、炮 450、马 400、象/士 200、兵 100（过河 200） |
| 走法排序 | 将 6 > 车 5 > 炮 4 > 马 3 > 象 2 > 士 1 > 兵 0 |
| 服务端 | 默认 `0.0.0.0:8787`，健康检查 `/health` |
| 前端 | Vite 默认 5173，端口占用时自动 +1（本机常用 5174）；preview 4173 |
| Elo | 初始 1200，K=32，零和；匹配起始 ±100，每 5 秒 +100，上限 ±800，等待 30 秒兜底 |
| 断线 | 宽限期 30 秒；心跳 15 秒，40 秒无 pong 判死；重连 1/2/4/8/16 秒，最多 8 次 |
| 引擎 | 轻量 500ms / MultiPV 5；大师 `minDepth=10`、最晚 4 秒；启动分析 300ms；请求超时 30 秒 |
| 引擎上限 | MultiPV 硬上限 128，再按当前局面合法着法数收敛 |
| 软胜率 | logistic 尺度 400；和棋上限 60%；衰减半宽 180 |
| 测试 | P0 13 + P1 26 + P2 13 + P4 22 = 74 项 |

---

## 7. 运行方式（详细排障见 07）

```bash
# 依赖（前端 + 服务端各一次）
npm install
npm --prefix server install

# 两个终端
npm run server     # ws://localhost:8787，健康检查 /health
npm run dev        # Vite，默认 5173 / 本机常见 5174

# 构建与预览（PWA 只在生产构建注册）
npm run build
npm run preview    # 4173

# 静态检查与验证
npm run lint
cd server && npx tsc --noEmit
npm run engine:verify
```

联机冒烟：

```bash
node server/scripts/smoke.mjs        # 需 8787 在跑
node server/scripts/smoke-p1.mjs     # 自建 8799 隔离实例
node server/scripts/smoke-p2.mjs     # 需 8787；建议服务端 RECONNECT_GRACE_MS=2000
node server/scripts/smoke-auth.mjs   # 自建 8801 隔离实例
```

---

## 8. 五分钟现场演示脚本

1. **单机基础（40 秒）**：开始对局 → 走一步 → AI 应手 → 指出棋谱、将军提示、计时。
2. **算法面板（40 秒）**：切困难 → 走一步 → 打开“对局数据”，讲节点数、剪枝数、深度、耗时。
3. **大师辅助（60 秒）**：点“开启大师” → 点己方棋子 → 黄点=优等走法、绿点=其余合法走法；右侧胜率条与 TopN 评分；讲“相对强度”和“红方视角统一”。
4. **皮卡鱼大师（40 秒）**：难度切“皮卡鱼大师” → AI 走一步 → 讲 Vite 中间件、UCI、串行队列。
5. **联机与重连（90 秒）**：两个标签进同一房间 → 走子 → 关掉一方标签 → 展示对手倒计时 → 30 秒内重开/刷新恢复 → 讲 `sessionId` 与全量快照。
6. **排位（40 秒）**：`?pid=alice` / `?pid=bob` 两个身份随机匹配 → 认输 → 展示 `rating.update` 和排行榜。
7. **PWA（30 秒，可选）**：`npm run build && npm run preview` → 安装 → 断网打开外壳。

---

## 9. 五个主动承认的不足（把“被挑错”变成“有判断”）

1. **本地 AI 跑在主线程**：depth 5 / 8 秒会阻塞 UI，目前靠“AI 思考中”提示兜底；正确做法是 Web Worker + 可中断搜索。
2. **评估函数是纯物质型**：没有位置分、机动性、将安全、静止搜索、置换表，棋力有限；这是“可解释优先”的取舍。
3. **联机是单进程内存 + JSON**：重启丢房间，不能水平扩展；生产化需要 Redis/Postgres + 房间分片 + sticky session。
4. **Pikafish 只在 dev/preview 可用**：纯静态部署没有中间件；`public/pikafish` 下的 WASM 资产未接入，属于历史遗留。
5. **规则是简化版**：三次重复直接判和，未实现长将/长捉裁决与自然限着；记谱只处理同线两子（前/后），三子以上未覆盖。

面试官如果问“还有呢”，补两个真实的边界问题：

- 困难档的“时间预算”只在**每层之间**检查，单层搜索不可中断，最坏会超出 8 秒。
- `HeatmapRenderer` 的 Top1 脉动时间戳被复用（`_pulseTick = tick`），实际脉动不会推进；修复是每帧取 `performance.now()`。

---

## 10. 一句话总结（收尾用）

> 这个项目真正有价值的不是“象棋”本身，而是它把**规则一致性、权威状态机、实时引擎通信**这三个通用工程问题放在一个可演示、可验证的闭环里。
