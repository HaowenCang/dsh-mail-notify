# Decision Record — dsh-mail-notify

本文件以 ADR（Architecture Decision Record）形式冻结 Phase 3 正式实现所依据的全部实质设计决策。文档中的决策均有 Phase 1 运行时证据或当前 DSH Inspect 结果支撑，不以模型记忆为依据。

事实优先级（与本文件冲突时以此为准）：

```text
当前运行时实证 / Inspect
    >
PHASE1_RUNTIME_CONTRACT.md
    >
PHASE1_REPORT.md
    >
README.md 当前状态
    >
00_MASTER.md 初始设计
    >
模型记忆
```

状态标记：**Frozen** 表示 Phase 3 不得在实现过程中自行变更，如需变更须新增 ADR 并说明理由。

---

## 决策索引

| ID | 标题 | 状态 |
| --- | --- | --- |
| D001 | 事件边界：唯一入口 `session/event` + Runtime Adapter | Frozen |
| D002 | 可见内容：仅 `type === 'text'` 白名单 | Frozen |
| D003 | 根/子会话判定：三判据优先级与严格比较 | Frozen |
| D004 | Turn 中途装载：懒初始化，时长未知写 `null` | Frozen |
| D005 | 显式工具错误语义：双判据，不含 shell 退出码 | Frozen |
| D006 | `usage` 仅作原始遥测，不推算、不参与状态 | Frozen |
| D007 | `NotificationCandidate` schema v1 | Frozen |
| D008 | 去重：单进程有界内存 LRU | Frozen |
| D009 | 异步有界队列，并发 1，拒绝最新 | Frozen |
| D010 | Nodemailer + DSH Credential Service，每次操作重新解析 | Frozen |
| D011 | 无可见文本抑制规则，completion 与 failure 通知分离 | Frozen |
| D012 | 隐私默认值与理由 | Frozen |
| D013 | `schemaVersion` 编号策略与向后兼容契约 | Frozen |
| D014 | 截断可解释性：footer 通知（可关闭） | Frozen |
| D015 | 时长门槛在未知时长时不抑制 | Frozen |
| D016 | 文档冲突裁决清单 | Frozen |
| D017 | Turn 级遥测聚合语义（`usage` 语义变更，schema v2） | Frozen |
| D018 | Human-attention 通知触发器与隐私边界（Phase 8，2026-09） | Frozen |
| D019 | 凭据引用文法回归 DSH 的 `CredentialRef` 契约（Phase 8.1，2026-09） | Frozen |

---

## D001 — 事件边界：唯一入口 `session/event` + Runtime Adapter

**Decision**

插件对 SessionEvent 使用的**唯一顶层 Cordis 事件名**是 `session/event`，签名为 `(this: Scoped<Session>, session: Session, event: SessionEvent): void`。`turn/start`、`assistant/message`、`tool/call`、`tool/result`、`turn/end`、`approval/asked` 均不是顶层事件，而是 `SessionEvent.type` 的取值。

本决策约束的是**事件名**，不是回调数量。普通 Turn 状态由主 `session/event` 监听器按 `event.type` 分派维护；Phase 8 另注册一个同名 `session/event` observer，仅观察 `approval/asked`（D018）。两者都经 Runtime Adapter 与有界观察路径，且都不注册 `user-questions/request` 或 `approval/request`。

`session/disposed` 是独立的顶层 Cordis 事件，仅用于释放 `Map<sessionId, …>`，不参与 Turn 分类。

所有对 DSH 原始 payload 的形状知识集中在 `src/runtime-adapter.ts` 一个模块内；该模块之后的所有模块只接触本项目自定义的内部 DTO。

**Reason**

Phase 1 运行时确证：四个「事件」实为同一事件的成员，注册为顶层监听器在语法上不可行。同时运行时的 `Session.append()` 会先 `snapshotJsonValue` 再 `deepFreeze`，投递到监听器的 `event.data` 是普通 JSON 数据，但 `session` 本身是 live class 实例。把「live 对象与深路径访问」限制在一个模块内，使 DSH RC API 变更的影响面收敛为单文件修改。

**Rejected alternatives**

1. **分别注册 `turn/start` 等四个顶层监听器**：当前运行时不存在这些事件，写法不可行。
2. **不设 adapter，各模块直接读 `event.data.*`**：DSH 字段路径会散布到 `event-handler`、`turn-state`、`content`、`completion` 四处，任一字段改名即需要跨模块修改；Phase 1 已证明字段路径带 `data` 包装层，记忆中的路径系统性错误。
3. **通过 `ctx.get('sessions')` 反查 live Session 以补全缺失信息**：Phase 1 证明根级未打 scope 标签的监听器已能全局接收事件，引入 Session Service 只会增加耦合与生命周期风险，无信息增益。

**Consequences**

- 新增一层 DTO 映射代码，`runtime-adapter.ts` 是唯一需要随 DSH 版本升级而重审的模块。
- 适配层必须对每个字段做运行时形状检查（`typeof`、判别字段比对），不能依赖 TypeScript 类型在运行时的存在——动态 Host 与打包插件均无编译期类型约束。
- 监听器在 `Session.append()` 的同步路径上被调用，因此 adapter 与 handler 必须是同步的、不得 `await`（见 D009）。

---

## D002 — 可见内容：仅 `type === 'text'` 白名单

**Decision**

邮件正文的模型输出部分只能来自 `event.data.message.content` 中 `block.type === 'text'` 的 block 的 `.text` 字段。

排除集合为封闭白名单的补集：`reasoning`、`tool-call`、`tool-result`、`image`、`file`，以及一切未知 block 类型。未知类型**静默跳过**，不抛异常、不降级为 `text`、不记录 block 原文。

多个 `text` block 以 `\n` 连接，空串与纯空白 block 丢弃。

**Reason**

Phase 1 运行时证据表明 `reasoning` block 与 `text` block 是**两个不同类型的 block，各自带一个名为 `text` 的字段**（`blockTypes: ["reasoning","text","tool-call","tool-call"]` 已在真实会话观察到）。因此任何按字段名 `text` 取值、或按「有 text 字段就算可见」的实现，都会把推理内容写进邮件，直接违反 `00_MASTER.md` §5 与 §19。

`ContentBlockMap` 被声明为 merge-extensible，插件可追加新 block 类型，因此未知类型是设计允许的正常情况而非异常。白名单是该扩展性下唯一安全的默认。

**Rejected alternatives**

1. **按字段名取 `block.text`**：会把 `reasoning` 的 `text` 当作用户可见文本，隐私边界失效。
2. **黑名单（排除已知的 reasoning/tool-\*）**：未知类型会落入「允许」一侧，未来任何新增 block 类型都会默认外发。安全默认必须是不外发。
3. **对未知类型抛异常**：会使插件在 DSH 升级后停止工作，而未知 block 是设计上允许的正常事件。
4. **把未知类型降级记录到日志**：会把未经审查的内容写入日志，扩大而非收敛泄露面。

**Consequences**

- 纯 `reasoning` 的 Assistant message 产出 `visibleTextLength === 0`，触发 D011 的抑制规则。
- 空 text block 必须丢弃，否则多个 block 连接会产生多余空行。
- 提取函数必须是可单测的纯函数（`src/content.ts`），不接触 session、不接触配置、不接触 I/O。

---

## D003 — 根/子会话判定：三判据优先级与严格比较

**Decision**

判定顺序固定为：

```text
1. session.header.origin === 'subagent'
2. session.header.parentSession !== undefined
3. typeof session.header.delegationDepth === 'number' && session.header.delegationDepth > 0
```

命中任一即为 subagent，并记录命中的判据名（`origin` / `parentSession` / `delegationDepth`）以便审计。

禁止的写法（三条均为运行时确证的误判路径）：

```js
if (session.header.delegationDepth) { }              // 0 为假值，看似安全，但语义依赖巧合
if ('delegationDepth' in session.header) { }         // 键存在即命中
if (session.header.delegationDepth !== undefined) { } // 同上
```

禁止按 `session.id` 字符串格式推断层级——根会话与 subagent 会话的 id 前缀相同（`session-<uuid>`），格式不含层级语义。

**Reason**

Phase 1 在运行时观察到并行根会话 `session-280861aa-…`：`origin: null`、`parentSession: null`、`delegationDepth: 0`——`delegationDepth` **存在且等于 0**，该会话是正常根会话。键存在性或 `!== undefined` 写法必然把它误判为 subagent，从而静默丢弃一个真实顶层 Turn 的通知。

`origin` 为首选判据的依据更强：它在 3 个 subagent 会话上全部命中、在 2 个根会话上全部缺省；且由 `SessionStore.create()` 从 `meta` 写入并成为不可变 header。`parentSession` 与 `delegationDepth` 仅覆盖 `origin` 未设置的历史或外部创建路径。

**Rejected alternatives**

1. **仅用 `origin`**：对 `origin` 未设置的会话（历史会话、外部创建路径）会误判为顶层。
2. **用 `delegationDepth > 0` 作主判据**：等价于主判据的较弱形式，且更容易被上述错误写法污染；`origin` 是写入即不可变、语义最直接的字段。
3. **只用 `parentSession`**：`parentSession` 的存在性同样依赖创建路径写入，且不能表达「深度」。

**Consequences**

- 判定结果必须携带 `decidedBy`，使「为什么这封邮件没发」可被日志审计，而不是只能看到一个静默跳过。
- `includeSubagents: false` 时，subagent 的 `turn/end` 在 `TurnState` 创建**之前**即返回，不产生任何状态与候选（避免为不通知的会话维护 `Map` 条目）。
- 该判据只作用于「是否需要状态与候选」，不作用于状态释放：subagent 的 `session/disposed` 仍须处理（此时通常无条目，处理为空操作）。

---

## D004 — Turn 中途装载：懒初始化，时长未知写 `null`

**Decision**

任何携带 `turn` 编号的事件（`assistant/message`、`tool/call`、`tool/result`、`turn/end`）都通过同一个 `turnStateOf(turn)` 取状态；条目不存在时就地创建并立即用于累积，`sawTurnStart = false`、`startAt = undefined`、`telemetryComplete = false`。

`turn/start` 到达时写入 `sawTurnStart = true` 与真实 `startAt`，并把 `telemetryComplete` 置为 `true`；若该 Turn 已因懒初始化而存在条目，则**就地补写**这两个字段，不重建条目、不清空已累积计数。

`durationMs` 的取值只有两种：

```text
sawTurnStart === true && startAt 已知  →  event.time − startAt
否则                                   →  null
```

`durationMs: 0` 与 `durationMs: null` 语义不同，前者是「耗时为零」的断言，后者是「未知」。正式实现不得用 `0` 表示未知。

**Reason**

Phase 1 运行时确证两件事。其一，原型 `pkg-1`/`pkg-2` 正是在 turn 1 中途装载，从未观察到该 Turn 的 `turn/start`——中途装载是正常发生的事实，不是理论边界。其二，首版实现在 `turn/end` 分支里「找不到状态就新建空状态」，导致真实 turn 1 的 44 个 step、多次工具调用、至少 1 次真实工具错误全部被丢弃，`status` 被误报为 `completed-clean`（正确值应为 `completed-with-tool-errors`）。这是**分类错误**，不只是统计缺失。

`turn/start` 是证明 Turn 起始时间的唯一来源，因此时长在缺失该事件时不可恢复，只能诚实标记为未知。

**Rejected alternatives**

1. **在 `TurnState` 缺失时构造空状态后立即结算**：Phase 1 已实测该路径产生错误分类。
2. **用首个观察到的事件时间作为 `startAt` 的替代**：把「观察到第一个事件的时间」冒充「Turn 开始时间」，系统性地低估耗时且无法与真实值区分，属伪造精确性。
3. **中途装载的 Turn 直接不通知**：会让热重载、按需装载等常见场景丢失通知，而该类 Turn 的可见文本与错误计数实际完整可得。
4. **用 `telemetryComplete` 之外的字段表达覆盖范围**：`sawTurnStart` 与 `telemetryComplete` 当前同值，但语义不同（前者描述事件是否被观察到，后者描述计数是否覆盖整个 Turn）；保留两个字段以便未来在不改变语义的前提下引入其它覆盖缺陷来源。

**Consequences**

- `telemetryComplete: false` 的候选必须仍然可通知；抑制条件中不得出现「遥测不完整即不通知」。
- `minTurnDurationMs` 在 `durationMs === null` 时不得触发抑制（见 D015）。
- 两种路径共用同一个 `turnStateOf`，不存在「正常路径」与「中途路径」两套逻辑；这是 Phase 1 修复缺陷时的核心手法，Phase 3 必须保持。

---

## D005 — 显式工具错误语义：双判据，不含 shell 退出码

**Decision**

`explicitToolErrorCount` 的含义严格限定为：

> DSH runtime **明确标记为失败**的工具结果数量。

计入口径为双判据取或（任一命中即计数 1，同一 `tool/result` 最多计 1）：

```text
A. event.data.message.content[0].isError === true      （宽信号，主导）
B. event.data.error !== undefined                       （窄信号）
```

字段名由 Phase 1 原型的 `toolErrorCount` 更名为 `explicitToolErrorCount`。**不得**计入基于文本猜测的 shell 失败：`bash` / `pwsh` 的非零退出被 DSH 设计为正常 Tool Result（仅在文本中附 `[exit code: N]`），不置 `isError`、不填 `error`，因此**不计入**。

不得解析 stdout / stderr 字符串、不得匹配 `exit code` 字样、不得使用退出码以外的启发式规则来补充该计数。

completion 分类据此为：

```text
completed-clean              = turn/end.reason.kind === 'completed' AND explicitToolErrorCount === 0
completed-with-tool-errors   = turn/end.reason.kind === 'completed' AND explicitToolErrorCount > 0
```

`completed-clean` **不等价于**「所有 shell / pwsh 命令的业务执行均成功」，它只表示 DSH 未报告显式工具失败。

为未来检测命令执行问题预留独立概念 `executionIssueCount`；Phase 2 与 Phase 3 v1 均不实现，也不定义任何基于 stdout/stderr 字符串解析的算法。

**Reason**

Phase 1 的源码级结论为：`message.content[0].isError` 是宽信号，覆盖工具抛错、参数校验失败、策略拒绝、post-execute 拦截、超时、中止、未解析调用闭合；`event.data.error` 是窄信号，仅当抛出异常是 `HarnessError` 子类时才非空（`errorInfo` 只在该条件下返回 `{name, code}`）。取或可以覆盖两者的并集，且判据 A 单独已覆盖绝大多数情形。

而「命令执行不成功」在 DSH 中**不是错误**，是成功结果携带的信息。把它并入错误计数需要解析工具输出文本，会引入与模型输出内容耦合的启发式判断：同一段文本在不同工具、不同 shell、不同本地化下含义不同，误判概率不可控，且会把「工具正常报告了业务失败」误报为「Harness 工具调用失败」。因此该口径在 v1 被明确排除，而非遗漏。

**Rejected alternatives**

1. **仅用判据 B（窄信号）**：会漏计非 `HarnessError` 来源的失败（参数校验、策略拒绝、中止等），使 `completed-with-tool-errors` 严重欠报。
2. **仅用判据 A**：覆盖面已足够，但放弃 B 无收益；两者取或的代价是零。
3. **把非零退出计入错误计数**：需要文本解析，语义上与 DSH 的设计相反，且会把正常业务结果误报为工具故障。
4. **记录宽/窄两个独立计数**：v1 无消费方，且 `completed-with-tool-errors` 的分类需要单一阈值；预留 `executionIssueCount` 已足够表达未来扩展方向。
5. **保留原名 `toolErrorCount`**：该名未表达「仅显式信号」这一关键限定，正是 Phase 1 风险 3 的争议来源；更名成本为一次批量替换，收益是口径在类型名上不可误读。

**Consequences**

- 一封标记为 `completed-clean` 的邮件，其 Turn 中可能包含多条「命令失败但被 DSH 视为正常结果」的工具调用。这是有意接受的口径，必须在 `docs/SECURITY.md` 与邮件正文的状态含义中保持一致，不得在正文里把 `completed-clean` 渲染为「全部成功」。
- 双判据取或可能在 `content[0].isError` 与 `event.data.error` 对同一结果给出不同结论时产生分歧；按取或处理（任一为真即计错误），偏保守。
- `ToolResultMessage.content` 是**单元素元组**，`content[0]` 恒存在；访问仍须做防御性检查，因为适配层面对的是未编译的运行时数据。

---

## D006 — `usage` 仅作原始遥测，不推算、不参与状态

**Decision**

`usage` 在 `NotificationCandidate` 中是一个可选的、字段可能部分缺失的原始计数器集合。冻结以下三条：

1. **不做价格计算**。不引入 token 单价、不做货币换算、不在正文中呈现费用。
2. **不做一致性推导**。不假设 `totalTokens = inputTokens + outputTokens`，不做单位换算，不校正不自洽的数值，不对缺失计数器做补零或插值。
3. **不参与 completion 状态判定**。`usage` 的任何取值（含缺失、含异常量级）都不得改变 `status`、不得触发抑制、不得影响是否通知。

构造时只写入运行时确实报告过的计数器（`typeof v === 'number' && Number.isFinite(v)`），缺失字段省略而非写 `undefined`。

**Reason**

Phase 1 在真实候选中读到 `{ "inputTokens": 255, "outputTokens": 759, "totalTokens": 187638, "cacheReadTokens": 186624 }`：若总输入为 187638，单次请求的 `inputTokens` 不应为 255，数量级不自洽。该现象有两种以上互斥解释（增量 vs 累计、是否含缓存读写、provider 语义差异），Phase 1 未能区分，Phase 2 亦无新增证据。在此条件下任何换算都会把未经确认的语义固化为实现假设，且错误会在用户可见的邮件正文中呈现为事实。

第二个理由是工程性的：`TokenUsage` 的 6 个计数器中有 4 个可选，Phase 1 已实测「三个可选计数器里恰好一个缺省」会使**整个**未归一化对象不可序列化，导致当时唯一的证据通道（探针工具）整体失效。因此省略 `undefined` 不是风格问题，而是可观测性的前提。

**Rejected alternatives**

1. **由 `totalTokens` 反推 `inputTokens`**：反推的前提（加法关系）恰是待确认的对象，属循环论证。
2. **在正文中展示 token 统计并附免责说明**：用户读到的仍是不自洽的数字，免责说明不能消除误读；且该数据对通知场景无决策价值。
3. **完全丢弃 `usage`**：Phase 1 已明确否定该做法；字段是否可用是运行时事实，应如实保留原始观测。
4. **用 `JSON.stringify` 的 replacer 整体清洗**：会掩盖真实的对象形状问题，且不能区分「正常缺省」与「异常结构」。

**Consequences**

- 若未来需要展示 token 统计，必须先完成计数器语义的独立验证，并以新 ADR 引入，不得在实现中顺手加入。
- `src/normalize.ts` 的 lossless-JSON 归一化必须在**任何**结构化对象离开插件之前执行（日志 payload、队列条目、候选记录、调试输出），而不是只在邮件渲染前执行。

---

## D007 — `NotificationCandidate` schema v1

**Decision**

`NotificationCandidate` 是插件内部与可观测性层之间的稳定 DTO，**不含任何 DSH live 对象**，全部字段为 lossless JSON 值：

```ts
interface NotificationCandidate {
  // 必须字段
  schemaVersion: 1
  sessionId: string
  turn: number
  status: CandidateStatus
  turnEndKind: TurnEndKind
  visibleText: string
  visibleTextLength: number
  explicitToolErrorCount: number
  telemetryComplete: boolean
  createdAt: number            // epoch ms，候选构造时刻

  // 可选字段（缺失即省略，不写 undefined / 不写 null 占位）
  turnEndDetail?: string       // aborted 的 cause kind、error 的 code 等
  reasonDetail?: string        // 面向人的简短说明，长度受限
  provider?: string
  model?: string
  assistantMessageId?: string
  durationMs?: number | null   // null 表示未知，与 0 语义不同
  usage?: RawUsage
  cwd?: string
}
```

额外冻结的字段语义：

- `visibleText` 是**完整**最终可见文本（按 `maxBodyChars` 截断发生在渲染阶段，见 D014），不再是 Phase 1 原型中的 200 字符预览。`visibleTextLength` 始终是**截断前**的字符长度。
- 不包含 `mailSent` 之类由传输层决定的字段。候选记录的是「Turn 的事实」，发送结果是通知管道的独立事实，两者不得混入同一 DTO。
- 不包含 subagent 标记字段。subagent 的 Turn 不产生候选（D003），因此该字段恒为「顶层」而无信息量。
- `status` 取值集合固定为：`completed-clean` | `completed-with-tool-errors` | `max-tokens` | `error` | `aborted` | `blocked` | `interrupted` | `unknown`。`unknown` 仅作为 `TurnEndReasonMap` 之外的防御性兜底，不得由已知的 6 种 kind 产生。

**Reason**

Phase 1 的核心交付物就是这一 DTO 的雏形，其字段选择已被运行时验证：候选记录可完整序列化读取，且不含 reasoning、tool arguments、tool result 原文与凭据。Phase 2 的任务是把雏形固定为版本化契约。

必须／可选字段的划分依据是「该字段缺失时，一个通知策略能否仍在无歧义的前提下做出判定」：`status`、`explicitToolErrorCount`、`telemetryComplete` 缺失即无法判定；`model`、`durationMs`、`usage` 缺失只影响正文丰富度，不影响正确性。这一划分使实现可以在信息不全时仍然安全决策，而不是被迫在「推测」与「放弃通知」之间选择。

剔除 `mailSent` 的理由是可分层性：把传输结果写入候选会让「Turn 事实」依赖于 SMTP 是否成功，进而使候选无法在发送前被可靠记录，也无法在重试后保持稳定。

**Rejected alternatives**

1. **保留 200 字符预览**：预览长度是 Phase 1 为规避不可序列化故障而设的证据采集约束，不是产品语义；正式实现需要完整文本才能渲染邮件。
2. **把必填字段全部改为可选以简化构造**：会使策略层出现大量 `undefined` 分支，把「运行时数据不全」与「实现遗漏」混为一谈。
3. **用 `null` 统一表示所有缺失**：`durationMs` 的 `null` 是**有信息量的观测结论**（时长未知），而 `model` 的缺失只是字段不存在。用同一个哨兵值表达两者会丢失这一区别。
4. **在候选中保存原始 `event.data` 副本**：会把 DSH payload 形状扩散到持久化与日志层，违反 D001 的边界设计。

**Consequences**

- 候选是策略判定与渲染的唯一输入，渲染层不得重新读取 `TurnState` 或 DSH 事件。
- `visibleTextLength` 与 `visibleText.length` 在截断前恒等；实现须在截断发生前计算长度，或保留截断前长度字段，不得让两者在截断场景下静默不一致。
- 候选的字段增删受 D013 约束。

---

## D008 — 去重：单进程有界内存 LRU

**Decision**

去重键固定为：

```text
dedupeKey = `${sessionId}:${turn}`
```

保证范围明确限定为：

> **单进程生命周期内，同一个 `(sessionId, turn)` 最多进入通知队列一次。**

**不保证**跨进程 exactly-once：DSH 进程重启后，此前处理过的 Turn 若被再次投递（会话恢复、日志重放、事件重放），可能产生第二封邮件。

实现为有界 LRU（`maxDedupeEntries = 1000`，可通过配置覆盖），条目在插入时打标。标记**只在候选通过策略并即将入队前写入**；因抑制规则未入队的 Turn 不写标记。

**Reason**

`turn/end` 在正常流程中每个 Turn 只提交一次，因此去重的真实作用是防御重复投递与重复处理，而不是修正常态行为。有界性是硬要求（`00_MASTER.md` §10：不得无限保存），而无界 Set 在长生命周期进程中是缓慢泄漏。

跨进程 exactly-once 需要持久化状态（磁盘文件或 Credential/存储服务），代价是：引入落盘位置与权限问题、引入状态损坏后的恢复语义、引入「同一 Turn 在重启后是否应重新通知」这一本身没有正确答案的产品问题。v1 的用户价值不足以支撑这三项复杂度，因此明确声明其边界而不是含糊承诺。

「只在实际入队前写标记」的理由是一个具体故障模式：若在 `turn/end` 一到达就写标记，则一个因无可见文本被抑制的 Turn 会永久占据该键；当同一 Turn 因日志重放或修订而再次出现且此时已有文本时，正确的通知会被去重逻辑吞掉。把标记后置到「确定要发」的判定之后，使去重只作用于真正的重复发送。

**Rejected alternatives**

1. **无去重**：重复 `turn/end` 会产生重复邮件，Phase 1 已将「重复 `turn/end` 不重复发送」列入测试矩阵。
2. **持久化去重表**：见上述三项复杂度；且 Phase 3 v1 无对应的用户需求。
3. **以 `assistantMessageId` 参与去重键**（`${sessionId}:${turn}:${assistantMessageId}`）：一个 Turn 可含多个 Assistant message，也允许出现空文本消息，按此键会把同一 Turn 的不同消息视为不同 Turn，反而制造重复发送。
4. **无界 Set**：违反 §10 的有界性要求，长生命周期进程内存单调增长。
5. **在 `turn/end` 到达时立即写标记**：见上述抑制与重放交互的故障模式。

**Consequences**

- 去重缓存必须在插件 dispose 时清空（见 `docs/ARCHITECTURE.md` 生命周期表）。
- 邮件正文或日志中若要披露去重信息，只能披露「本次为重复投递」这一事实，不得承诺跨重启语义。
- 该边界必须写入用户可见文档，避免用户据「每个 Turn 一封」推断出跨重启的强保证。

---

## D009 — 异步有界队列，并发 1，拒绝最新

**Decision**

`session/event` 监听器必须在**常数时间**内返回，且不得 `await` 任何 I/O。通知通过内存队列异步发送：

```text
session/event  →  adapter  →  handler  →  candidate  →  enqueue  →  立即返回
                                                          ↓
                                              后台 worker（concurrency = 1）
                                                          ↓
                                                   mailer → retry → 结果记录
```

冻结参数：

| 参数 | 默认 | 语义 |
| --- | --- | --- |
| `queueSize` | 100 | 队列中**等待中**条目的上限（不含正在发送的 1 条） |
| 并发 | 1 | 同时最多 1 个 SMTP 发送在途 |
| 队列满时行为 | 拒绝最新 | 丢弃新到的候选，写结构化 warning，计数器自增 |

禁止：无界队列、阻塞监听器等待队列腾空、在队列满时静默丢弃（必须有日志与计数）。

**Reason**

Phase 1 的源码级结论是决定性的：`Session.append()` 在**同步路径**上调用监听器，返回的 Promise 不被等待（`void Promise.resolve(returned).catch(...)`），仅被记录警告。因此监听器内做长时 I/O 会直接阻塞会话日志提交，即阻塞 Agent Loop。这不是性能优化建议，而是正确性约束。

并发取 1 的理由是通知场景的负载特征：SMTP 会话建立与认证成本远高于单封发送成本，而通知是低频事件，吞吐不构成约束；串行化则消除了多连接下的顺序问题（用户期望邮件按 Turn 顺序到达）与并发认证带来的 provider 限流风险。

「拒绝最新」而非「丢弃最旧」的理由与通知语义有关：最旧的条目通常对应更早完成的 Turn，其内容已在用户视野之外；而队列持续满员说明发送能力长期不足，此时保留任意条目都不改善最终结果，但保留最新条目至少让「最近一次 Turn」有机会被送达。两者都不理想，因此该情形必须伴随明确的告警日志，使配置不足可见，而不是静默降级。

**Rejected alternatives**

1. **在监听器内 `await` 发送**：阻塞 `Session.append()` 的同步路径，违反运行时约束。
2. **无界队列**：SMTP 长期不可用时内存单调增长，违反 §19「无限 queue」禁令。
3. **丢弃最旧**：与「最新 Turn 最相关」的通知语义相反。
4. **背压（让监听器等待）**：等价于方案 1。
5. **并发 > 1**：v1 无吞吐需求，且引入发送顺序不确定与并发认证风险。
6. **`fire-and-forget` 不设队列**：无法限流、无法重试、无法在 dispose 时收敛在途操作。

**Consequences**

- 队列必须在 dispose 时停止接收新条目并处置在途条目，不得留下悬挂 Promise。
- 所有后台 Promise 必须有 `catch`，不得产生 unhandled rejection。
- 队列状态（当前深度、累计拒绝数）必须可观测，否则「拒绝最新」会成为不可见的静默丢失。
- 队列条目是 DTO 的副本而非引用，避免与 `TurnState` 的生命周期耦合（见 D007 与 `docs/ARCHITECTURE.md`）。

---

## D010 — Nodemailer + DSH Credential Service，每次操作重新解析

**Decision**

SMTP 传输使用 **Nodemailer**，不自行实现 SMTP 协议。配置只保存凭据**引用名**，不保存 secret：

| 配置字段 | 语义 | 示例值 |
| --- | --- | --- |
| `smtpPasswordCredential` | `CredentialRef`（品牌字符串），交给 `credentials.resolve()` 按名解析 | `DSH_MAIL_SMTP_PASSWORD` |

冻结的运行时行为：

1. secret 在**每次发送操作开始时**通过 `ctx.get('credentials')` → `resolve(ref)` 解析，不得跨操作缓存到长期变量、不得写入配置对象、不得写入候选、不得写入日志。
2. 解析返回 `undefined`（未配置）时，该次发送按**永久错误**处理：不重试，写结构化 warning，并明确提示引用名。可选地先调用 `describe(ref)` 取得 `configured` / `source` 以生成更有用的诊断信息（`describe` 不返回值本身）。
3. `credentials` 以可选依赖方式获取（`ctx.get('credentials')` + `undefined` 检查）；服务缺席时不抛异常，而是记录明确错误并停止发送。
4. TLS 证书校验不得关闭，**禁止 `rejectUnauthorized: false`**，禁止任何形式的 `NODE_TLS_REJECT_UNAUTHORIZED=0` 依赖。
5. 至少需要一个收件人；`to` 为 `string[]`，空数组或全部为非法地址时配置校验失败。

**Reason**

`credentials` 服务的文档明确规定：解析是**每次调用**进行的，调用方必须在每次操作时重新 resolve，不得跨操作缓存——「per-operation read is what makes a changed credential reach the next operation without a restart」。这与 `00_MASTER.md` §6 的要求逐字一致，因此不是设计偏好而是对既成契约的遵守。缓存 secret 会使用户在轮换密码后必须重启 DSH 才能生效，并延长 secret 在进程内的存活时间。

`resolve` 的返回类型 `ResolvedCredential = { value: string; source: string }` 与 `describe` 的 `CredentialInfo = { configured: boolean; source?: string; writable: boolean }` 已经 Inspect 确证：`describe` 是构造诊断信息时的正确入口，因为它不暴露 secret。

TLS 校验不可关闭的理由不是一般性的安全建议：邮件正文包含模型对用户工作区的完整输出，关闭校验会使内容在中间人攻击下明文暴露，而其「收益」仅是绕过自签名证书——后者应通过为证书提供正确的信任链解决。

**Rejected alternatives**

1. **自实现 SMTP**：需要处理 MIME 编码、附件、EHLO/STARTTLS/AUTH 协商、多行响应解析与 dot-stuffing，且每次 provider 差异都需自维护；无收益。
2. **把密码写入 `cordis.patch.yml` 或环境变量直读**：违反 §6 与 §19；`cordis.patch.yml` 是明文配置文件，环境变量直读则绕过了凭据解析的分层与空值语义（空存储值在全部来源中视为不存在）。
3. **在插件启动时解析一次并缓存在模块级变量**：与 `resolve` 的 per-call 契约直接冲突，并使密码轮换需要重启。
4. **在配置中允许内联 `smtpPassword` 以方便调试**：一旦存在该字段，它就会出现在用户的实际配置与共享的排障片段中；便利性收益不足以抵偿明文 secret 的扩散面。
5. **`rejectUnauthorized: false` 作为可配置项**：可配置的 TLS 关闭开关在实践中会被长期留在配置里，且会让「证书错误」这一本应可见的运维问题静默通过。

**Consequences**

- 发送路径必须能表达「凭据未配置」这一独立失败类别，并使其诊断信息包含引用名与 `describe()` 结果。
- 每次发送都会产生一次异步凭据解析；该成本相对 SMTP 会话建立可忽略。
- 配置校验阶段**不**解析 secret（避免在校验路径上读取 secret），只校验引用名非空且为字符串。
- `smtpPasswordCredential` 取代 `00_MASTER.md` §6 与 §15 中的 `smtpPasswordEnv`（见 D016 第 3 项）。

---

## D011 — 无可见文本抑制规则，completion 与 failure 通知分离

**Decision**

通知被分为两个语义不同、规则不同的类别：

| 类别 | 定义 | v1 是否实现 |
| --- | --- | --- |
| **completion notification** | 内容型通知：把 Turn 的最终用户可见输出作为邮件正文送达 | 实现 |
| **failure / status notification** | 状态型通知：不含模型输出，只报告 Turn 以何种方式终止 | 仅实现 `max-tokens` 与 `error` 的**状态文本**（当有可见文本时二者仍按 completion 形态发送） |

无可见文本的抑制规则：

```text
若 visibleText.trim().length === 0
   → 不进入通知队列
   → 记录 suppressedReason = "no-visible-text"
```

该规则**无配置开关**，对所有 `status` 一致生效。即使未来把 `notifyErrors` 打开，`status === 'error'` 且无可见文本的 Turn 仍然不发送——v1 不存在「仅状态邮件」这一形态。

> **D018 对本条的修订（Phase 8，2026-09）**：本决策的后半句——「`status === 'error'` 且无可见文本的 Turn 仍然不发送」——已被 **D018 第 3 条**取代。自 v0.2.0 起，`error` 状态豁免于无可见文本抑制，理由是「终局故障」本身就是该邮件的全部内容，而终局 provider 故障恰恰是模型不产生任何可见输出的那一类情形。本条前半句（completion 型通知仍需可见文本）以及「规则无配置开关」仍完全有效。D011 的其余内容未被修改。

**Reason**

`00_MASTER.md` 与 README 定义的核心语义是「把该 Turn 最终用户可见的模型输出通过 SMTP 发送」。`visibleText` 为空时，邮件不含任何模型输出，收件人只会收到一封说明「某个 Turn 以某种状态结束」的邮件——它既不满足核心语义，也不携带用户在打开邮件前无法从其它渠道得知的信息。此类邮件在长期使用中会稳定地稀释通知通道的信噪比，使真正需要阅读的邮件被忽略。

把规则设为无配置开关而非可选项，是因为「无内容通知」不存在合理的默认使用场景：任何想要它的用户，实际想要的是「Turn 结束」这一事实的推送，而这属于另一个功能（进度推送），不应由本插件以空邮件的形式兼职提供。

明确区分两个类别而非只实现 completion，是为未来扩展保留接口形状：`max-tokens` 与 `error` 是用户最需要主动获知的终止方式，它们的**状态文本**是有效信息，只是不应以「空邮件」形式单独发送。当前版本在二者有可见文本时按正常 completion 形态发送并明确标记状态，不引入第二种邮件形态。

**Rejected alternatives**

1. **无可见文本也发送简短状态邮件**：产生稳定噪声，且不满足插件的核心语义。
2. **为无可见文本提供配置开关**：引入一个只产生噪声的配置项，并需要在测试矩阵中覆盖第二个邮件形态，收益为零。
3. **发送「Turn 无可见输出」的占位文本**：与「邮件正文是模型输出」的定义冲突，收件人无法区分模型说了这句话还是插件生成了这句话。
4. **把无可见文本记为错误或降级为 `unknown`**：抑制与分类是两件事；Turn 的状态分类应如实反映 `turn/end.reason`，抑制只是「不发」。
5. **以 `visibleText.length === 0` 判定**：纯空白文本（仅空格与换行）在邮件中同样不可读，应与空文本同处理，故取 `trim()` 后判定。

**Consequences**

- 抑制必须可观测：`suppressedReason` 写入结构化日志，否则用户无法区分「没有可见文本」与「插件没工作」。
- `visibleTextLength` 记录截断前长度，因此日志中可见 `visibleTextLength > 0` 但 `trim()` 后为空的情形——这正是需要 `trim()` 判定的场景。
- 抑制发生在去重标记之前（D008），避免被抑制的 Turn 污染去重键。

---

## D012 — 隐私默认值与理由

**Decision**

默认值及其方向性约束：

| 配置项 | 默认 | 方向 |
| --- | --- | --- |
| `includeSubagents` | `false` | 默认不收窄也不扩大外发范围至子会话 |
| `includeUserPrompt` | `false` | 用户原始输入默认不外发 |
| `includeMetadata` | `true` | 仅含 Session ID、cwd、provider/model、耗时、状态 |
| `notifyCompleted` | `true` | 核心用途 |
| `notifyErrors` | `false` | 默认只报告「有产出的完成」 |
| `notifyMaxTokens` | `true` | 截断属用户需要主动知晓的终止方式 |

永久禁止外发的内容（无配置项可开启）：`reasoning` 文本、`system prompt`、tool arguments、tool result 原文、任何凭据或 API key、SMTP password。永久禁止入日志的内容：完整 `visibleText`、`reasoning`、tool arguments/results、凭据、SMTP auth 对象（见 `docs/SECURITY.md`）。

**Reason**

邮件意味着 Assistant 输出**离开本机**并进入至少一个第三方邮件服务商的存储。这一事实使默认值的方向选择具有非对称后果：错误地外发一条内容无法撤回，而少发一封通知只是可被配置修正的不便。因此每一项默认值都取隐私一侧。

`includeSubagents: false` 的额外理由来自 Phase 1 的运行时观察：subagent 的输出通常是为父 Agent 消费的中间产物（工具调用规划、局部结果校验），而非面向用户的最终答复；其内容往往包含尚在讨论中的假设与试错路径，外发价值低而暴露面大。

`includeUserPrompt: false` 的理由是用户输入可能包含用户未预期被外发的材料（粘贴的文件片段、内部标识、他人信息），且通知的既定用途是「告知模型说了什么」，而非「复现请求」。

`notifyErrors: false` 而 `notifyMaxTokens: true` 的差异来自两类终止的信息价值：`max-tokens` 表示输出被硬截断，收件人若不被告知会把不完整的答复误读为完整结论，因此默认开启；`error` 通常表示 provider 侧或网络侧故障，用户在同一会话中重启 Turn 即可自然获知，无需外部推送，因此默认关闭但可开启。

**Rejected alternatives**

1. **`includeSubagents: true` 默认**：与「只通知顶层 Session」的核心要求（§1）相反。
2. **`notifyErrors: true` 默认**：会把瞬时 provider 故障转化为邮件噪声，且在重试与限流场景下可能连续推送。
3. **`includeMetadata: false` 默认**：会移除 cwd 与 session id，使用户在收到多封邮件时无法定位来源；这些字段不含用户内容。
4. **提供 `includeReasoning` 开关**：推理内容是否外发不属用户的策略选择，而是本项目不可让步的边界（§5、§19）；提供开关等于把违反边界的责任转移给用户。
5. **默认在日志中记录完整 `visibleText` 以简化排障**：正文内容已在邮件中可见，日志副本只会扩大泄露面并可能使日志体积失控；排障所需的长度、哈希与状态字段足够。

**Consequences**

- `includeUserPrompt: true` 的实现需要在 `TurnState` 中保存最近一条 `user/message`，因此该字段的采集在 Phase 3 即实现，但仅在开关打开时进入渲染；采集本身不产生外发。
- 测试矩阵必须包含「默认配置下 reasoning / tool arguments / tool results / 用户 prompt 均不出现」的显式断言，而不是仅断言正文包含期望字段。
- `docs/SECURITY.md` 中的每一条默认值都必须与本节一致，任何不一致以本节为准。

---

## D013 — `schemaVersion` 编号策略与向后兼容契约

**Decision**

`NotificationCandidate.schemaVersion` 从 `1` 开始，为**字面量类型**而非 `number`。

版本递增规则：

| 变更类型 | 处理 |
| --- | --- |
| 新增可选字段 | 不递增（`1` 内兼容） |
| 删除字段、重命名字段、改变字段语义或类型 | 递增主版本号 |
| 新增必须字段 | 递增主版本号 |

消费方（日志读取、调试出口、未来的持久化）必须对未知字段宽容、对缺失的**可选**字段容忍，并显式检查 `schemaVersion` 后再解释字段。同一份输出中不得混用不同 `schemaVersion`。

**Reason**

候选会进入日志、调试出口，未来可能进入持久化。没有版本号时，字段增删会使历史记录的解释产生静默歧义——一个在 `v1` 中表示「截断前长度」的字段，在字段被重命名后可能被读成「截断后长度」，而两类记录在日志中外观相同。

把版本号设为字面量类型（而非 `number`）的理由是编译期防护：`schemaVersion: 2` 的构造点在任何未更新的消费分支上都会产生类型错误，而不是在运行时静默通过。这与 D007 中「必须／可选字段」的划分共同构成候选契约的可演进性设计。

**Rejected alternatives**

1. **不设版本号**：字段演进后历史记录无法可靠解释。
2. **用 `number` 类型**：失去编译期约束，版本不匹配只能在运行时被发现。
3. **每个字段自带版本或引入通用 schema 库**：对单一 DTO 而言过度设计，且引入运行时依赖与构建复杂度。
4. **用包版本号代替 schema 版本**：包版本随任意改动递增，与 DTO 契约的兼容性无对应关系。

**Consequences**

- 任何改变候选字段语义的提交都必须同时递增 `schemaVersion` 并更新 `docs/ARCHITECTURE.md` 的 DTO 表。
- 测试须包含对 `schemaVersion === 1` 的显式断言，使意外的版本漂移在单元测试中被捕获。
- **Phase 6 注解（不改写本条判决）**：`usage` 的语义已在 D017 中由「最后一次观察到的 per-call 原始计数器」改为「Turn 级聚合」，因此 `schemaVersion` 已按本条规则递增为 `2`，上述断言相应地针对 `2`。编号策略、字面量类型与兼容契约三项条款均未改变。

---

## D014 — 截断可解释性：footer 通知（可关闭）

**Decision**

正文字符上限 `maxBodyChars` 默认 `100000`，作用于 `visibleText`。

截断语义：

1. 上限在**可见文本**上生效，不作用于元数据头部。
2. 截断按**码点**进行，不切断代理对（surrogate pair）；不使用字节长度作为判据。
3. 截断发生时，邮件正文**必须**包含标记 `[Output truncated by dsh-mail-notify]`（见 D016 第 6 项），且 `visibleTextLength` 保持截断前长度。
4. 该标记通过 `includeFooter: boolean`（默认 `true`）控制。关闭 footer 时标记不出现，但结构化日志中仍记录 `truncated: true`。

**Reason**

静默截断使用户无法区分「模型在此处结束」与「邮件在此处被切断」，会导致对模型输出的实质性误读——这正是 `§21` 要求明确标记的原因。把标记放在可关闭的 footer 中，而不是硬编码进正文，是因为正文本身也会被发送给第三方解析或归档工具，footer 会被当作模型输出的一部分；提供开关使需要干净正文的用户可以关闭，同时默认保留可解释性。

按码点而非字节截断的理由是：中文、emoji 与部分符号在 UTF-8 中占多字节，按字节截断会产生无效序列或半个字符，既破坏可读性也可能破坏邮件编码。

**Rejected alternatives**

1. **不截断**：单封邮件正文可达数 MB，超过常见 SMTP 与邮箱的正文处理范围，会导致发送失败或收件端截断（后者正是静默截断）。
2. **在正文中静默截断**：见上述误读风险。
3. **按字节截断**：见上述编码破坏。
4. **把标记写进 Subject**：主题长度有限，且会使同一 Turn 的邮件难以按主题归类。
5. **超出上限的部分改为附件**：引入附件生成与 MIME 复杂度，且附件不受正文隐私约束的同等审查，v1 明确不做附件。

**Consequences**

- 截断函数 `truncateVisibleText()` 必须是纯函数并可单测，测试须覆盖「恰好等于上限」「上限 +1」「多字节字符边界」三种情形。
- `maxBodyChars` 必须有配置上限（防止用户把上限调到实际无界），见 `docs/CONFIG_SPEC.md`。
- `truncated` 标志同时进入候选之外的通知记录与日志，使「实际发送了多少字符」可观测。

---

## D015 — 时长门槛在未知时长时不抑制

**Decision**

`minTurnDurationMs` 默认 `0`（即默认不按耗时过滤）。抑制条件严格为：

```text
durationMs !== null AND durationMs < minTurnDurationMs   →  suppress（reason = "below-min-duration"）
```

`durationMs === null`（中途装载、遥测不完整）时**不得**抑制。

**Reason**

`durationMs: null` 表示**时长未知**，不表示**时长为零**。在未知条件下应用最低时长门槛，等价于假设「未知时长一定很短」，这是无依据的推断，其后果是系统性地漏发恰恰在热重载或按需装载场景下的通知——而这类场景正是用户在主动关注 Harness 行为的时刻。

未知时长的成因（插件在 Turn 中途装载）与时长本身无关：一个中途装载的长 Turn 与一个中途装载的短 Turn 在数据上完全无法区分。因此在该维度上唯一诚实的策略是不施加约束。

默认值取 `0` 而非某个正数，同样是隐私与正确性的不对称性所决定：默认过滤会让用户在不知情的情况下丢失通知（不可察觉），而默认不过滤的最坏后果是多几封邮件（可察觉、可配置修正）。

**Rejected alternatives**

1. **`durationMs === null` 时视为 0 并抑制**：把未知当已知，系统性漏发。
2. **`durationMs === null` 时视为 `Infinity`（一定超过门槛）**：与方案 1 方向相反，但在门槛设为较大值时同样会让未知时长的短 Turn 通过——不过这里的关键是「未知就是未知」，把它映射为任何具体数值都是无依据的。v1 选择「不抑制」，因为该方向失败可察觉、可修正。
3. **默认设为一个正数（如 5000 ms）以降低噪声**：需要一个用户未提出的产品判断，且会让极短 Turn 的通知静默消失。噪声应由用户按需配置。
4. **抑制时不留日志**：会使用户无法区分「Turn 太短」与「插件失效」。

**Consequences**

- 抑制原因必须记录为可枚举的机器可读值（`no-visible-text`、`below-min-duration`、`disabled-by-policy` 等），供日志审计与测试断言使用。
- 测试须包含「mid-turn 且耗时极短」的用例，断言其**不**被时长门槛抑制。

---

## D016 — 文档冲突裁决清单

Phase 1 与 Phase 2 期间发现现有文档之间存在若干实质冲突。本节逐项记录冲突内容、采用一方与理由。**没有任何冲突被静默选择**；`PHASE1_RUNTIME_CONTRACT.md` 与 `PHASE1_REPORT.md` 作为历史证据未被修改，需要修正之处以勘误形式记录于此及 `PHASE2_REPORT.md`。

### 1. 阶段编排：`00_MASTER.md` §11–§13 与项目实际执行历史

**冲突**：`00_MASTER.md` 将项目分为「第一阶段：Inspect」「第二阶段：创造模式原型」「第三阶段：正式项目」；实际执行中 Phase 1 = Inspect + 动态 Host 原型 + Runtime Contract，Phase 2 = 设计冻结，Phase 3 = 正式 TypeScript 实现。

**采用**：实际执行历史的三阶段模型。`00_MASTER.md` 增加 `## Execution Roadmap` 一节说明重新编排及其原因，原有业务要求、安全约束与最终目标全部保留。

**理由**：`00_MASTER.md` 的两阶段划分（Inspect 与原型分离）在运行时并不成立——原型本身是 Inspect 结论的唯一运行时证据来源，二者不可分离，且原型的 3 个缺陷（mid-turn 状态丢失、时长伪造、可选字段不可序列化）只能在运行中发现。设计冻结被证明是一个独立且必要的阶段：Phase 1 移交的唯一实质决策（工具错误口径）在 Phase 2 才被解决，而它直接决定候选 DTO 的字段与分类语义。若 Phase 1 直接进入编码，该决策会在实现中途被动做出，且缺少文档依据。

### 2. 事件模型：`00_MASTER.md` §2 与 PHASE1_RUNTIME_CONTRACT

**冲突**：`00_MASTER.md` §2 与 §11 把 `turn/start`、`assistant/message`、`tool/result`、`turn/end` 描述为四个可分别监听的顶层事件；运行时只有一个 `session/event`。

**采用**：Runtime Contract。见 D001。

**理由**：Phase 1 Runtime verified（`listenerInvocations` 320+、`containedErrors` 0）。分层写法在当前运行时不成立。

### 3. 凭据配置字段名：`00_MASTER.md` §6 / §15 的 `smtpPasswordEnv` 与 Phase 2 的 `smtpPasswordCredential`

**冲突**：`00_MASTER.md` 两处使用 `smtpPasswordEnv`；Phase 2 阶段要求使用 `smtpPasswordCredential`。

**采用**：`smtpPasswordCredential`。**该冲突在 Phase 2 任务书中未被提及，此处为主动记录的裁决。**

**理由**：`smtpPasswordEnv` 的命名预设了「凭据就是一个环境变量名」这一实现假设，但 Phase 1 与本次 Inspect 均确认 `CredentialRef` 是**分层解析器**：按序解析自进程环境变量、provider 管理的存储与 `.env` 文件。命名中的 `Env` 会误导用户以为只能通过环境变量配置，从而放弃更安全的 provider 存储路径；`Credential` 与运行时类型名 `CredentialRef`、服务方法名 `resolve(ref: CredentialRef)` 一致，可直接对照。改动仅涉及字段名，不损失任何表达能力，且同时满足 §6 的实质要求（secret 不进入 `cordis.patch.yml`、每次操作解析、不缓存）。`00_MASTER.md` 已在 §6 与 §15 就地标注该更名。

### 4. 错误计数命名：`00_MASTER.md` §3 的 `toolErrors` 与 Phase 2 的 `explicitToolErrorCount`

**冲突**：`00_MASTER.md` §3 使用 `toolErrors`；Phase 2 要求 `explicitToolErrorCount`。

**采用**：`explicitToolErrorCount`。见 D005。

**理由**：`toolErrors` 未表达「仅 DSH 显式标记」这一限定，而该限定正是 Phase 1 风险 3 的争议焦点（`bash`/`pwsh` 非零退出被设计为成功）。名称必须使误读在类型层面不可能发生。

### 5. 主题与正文：`00_MASTER.md` §2 的 max-tokens 表述

**冲突**：`00_MASTER.md` §2 要求 `max-tokens` 通知「必须明确标记为 max-tokens，不得写成成功完成」；Phase 2 的完成策略表需要确定其默认是否通知。

**采用**：`00_MASTER.md` 与 Phase 2 一致——`max-tokens` 默认通知（`notifyMaxTokens: true`），且状态与主题必须显式标记为 `max-tokens`。**此项无冲突**，此处记录为已核对项，避免后续被误认为分歧。

**理由**：截断的输出若不加标记，收件人会把不完整答复读作完整结论。

### 6. 截断标记文本：Phase 2 任务书与 `00_MASTER.md`

**冲突**：Phase 2 任务书 §21 要求标记 `[Output truncated by dsh-mail-notify]`；`00_MASTER.md` 未规定标记文本（仅在 §18 要求正文超限场景被测试覆盖）。

**采用**：Phase 2 任务书给出的英文标记文本。

**理由**：`00_MASTER.md` 无冲突条款，此处属补全而非裁决；记录在案以明确标记文本的来源。

### 7. `docs/` 文档清单：`00_MASTER.md` §18 与 Phase 2 交付清单

**冲突**：`00_MASTER.md` §18 列出 `docs/PRODUCT_SPEC.md`、`ARCHITECTURE.md`、`DSH_INTEGRATION.md`、`SECURITY.md`、`TEST_PLAN.md`、`RELEASE.md`；Phase 2 只创建 `ARCHITECTURE.md`、`CONFIG_SPEC.md`、`SECURITY.md`、`TEST_PLAN.md`、`IMPLEMENTATION_PLAN.md`、`DECISIONS.md`。

**采用**：Phase 2 创建其清单内的 6 份文档；`00_MASTER.md` §18 保留原清单，并把未创建项标注为 Phase 3 交付物（`docs/DSH_INTEGRATION.md` 的内容当前由 `PHASE1_RUNTIME_CONTRACT.md` 承担，Phase 3 实现完成后应据此拆分为「本插件实际使用的接口」与「运行时契约全集」两份）。

**理由**：Phase 2 的职责是设计冻结，`RELEASE.md` 与 `PRODUCT_SPEC.md` 描述的是尚不存在的构建与安装流程，此时撰写会产出与最终实现不符的内容。`DSH_INTEGRATION.md` 的价值在于记录**实际使用**的接口与版本，而该集合在正式代码存在之前无法确定。

### 8. `00_MASTER.md` §2「completed → 通知」与无可见文本抑制

**冲突**：§2 将 `completed` 一律映射为通知；D011 规定无可见文本时不通知。

**采用**：D011 的抑制规则。`00_MASTER.md` §2 就地补充该条件说明。

**理由**：§2 的意图是「`completed` 默认是可通知状态」（与 `aborted`/`blocked`/`interrupted` 的默认不通知相对），而非「`completed` 必然产生一封邮件」。§4 已要求「保存最后一个**非空**用户可见文本」，暗示空文本是可能情形；D011 把该暗示明确为规则。

### 9. Phase 1 文档中的命名与枚举偏差（勘误）

以下为**已读取的历史证据中与当前 Inspect 结果不一致的细节**。按 Phase 2 第 30 节的要求，不修改 Phase 1 文件，在此以勘误形式记录：

| # | Phase 1 文档原文 | 当前事实 | 影响 |
| --- | --- | --- | --- |
| a | `PHASE1_REPORT.md` 第 128 行把 `aborted.reason.kind` 的取值类型写作 `TurnCancelledCause` | 类型名为 `TurnEndCancelCause`，其取值包含 `AgentCancelCause` 联合（`user` / `parent` / `hook` / `disposed`）**以及** `{ kind: 'legacy' }` | 仅类型名与取值集合的完整性；Phase 1 的运行时结论不受影响。D005 与 `docs/ARCHITECTURE.md` 使用当前类型名 |
| b | `PHASE1_RUNTIME_CONTRACT.md` 第 361 行把取值集合写作 `'user' \| 'parent' \| 'hook' \| 'disposed' \| 'legacy'`（并列于同一层） | 该集合正确，但结构是 `AgentCancelCause \| { kind: 'legacy' }`，且 `hook` 分支携带 `reason: string` | 实现若需区分 `legacy`，应把它作为 `TurnEndCancelCause` 的顶层分支处理；Phase 1 的判据可用性不受影响 |
| c | `PHASE1_REPORT.md` 第 219 行称「Host 标准输出不可达」 | 动态 Host 的 Builtin 目录中确有 `console`（`console.log` / `console.error`，package-tagged） | 该结论描述的是 Phase 1 的原型运行环境；不影响 Phase 3 的打包插件。Phase 3 自带 `src/logger.ts`，不依赖 Host stdout |

上述三项均为**细节层**偏差，不推翻 Phase 1 的任何运行时结论，因此不构成对 Phase 1 判定（PASS）的修订。

### 10. 候选 DTO 的字段差异：Phase 1 原型与 D007

**冲突**：Phase 1 原型的候选含 `visibleTextPreview`（≤200 字符）、`mailSent: false`、`sawTurnStart`、`steps`、`assistantEvents`、`toolCallCount`、`toolResultCount`、`toolErrorCount`；D007 的 v1 候选不含其中若干项。

**采用**：D007。差异逐项说明如下（**这是澄清，不是冲突**）：

| Phase 1 字段 | v1 处理 | 理由 |
| --- | --- | --- |
| `visibleTextPreview` | 改为完整 `visibleText` | 预览是 Phase 1 的证据采集约束，非产品语义 |
| `mailSent` | 移除 | 传输结果不属于 Turn 事实，见 D007 |
| `sawTurnStart` | 保留 | 中间装载的核心事实 |
| `toolErrorCount` | 更名 `explicitToolErrorCount` | 见 D005 |
| `steps` / `assistantEvents` / `toolCallCount` / `toolResultCount` | 保留为候选字段 | 它们已在运行时验证可读且对审计有用 |

**理由**：Phase 1 的 DTO 是**证据采集工具**的形状，v1 的 DTO 是**产品契约**的形状。两者目标不同，因此形状差异是预期的，无需把 Phase 1 的选择解释为错误。唯一需要显式处理的是更名项与移除项，已在表中列明。

---

## D017 — Turn 级遥测聚合语义（Phase 6，2026-09）

**背景**

D006 冻结的是「不推算、不校正、不参与 completion」，而 Phase 2–4 的实现把该原则落实为「`usage` = 最后一个携带 usage 的 `assistant/message` 的原始计数器」。Phase 6 的用户反馈与运行时取证（`PHASE6_REPORT.md` 第 3–4 节）确认：该实现把一次模型调用的数据呈现为整个 Turn 的数据，属于**字段语义与用户理解不一致**的缺陷，记为 `BUG-TEL-001`。

D006 的三条原则继续成立且未被削弱；D017 补充的是同一 Turn 内多个 provider-reported per-call usage 的折叠语义。

**Decision**

`usage` 的语义由「最后一次观察到的 per-call 原始计数器」改为「本 Turn 内可观察的、provider 逐次报告的 per-call 计数器按 bucket 折叠后的 Turn 级聚合」，并按 D013 递增 `NotificationCandidate.schemaVersion`：`1` → `2`。

冻结以下条款：

1. **聚合单位是模型调用，不是 Turn 结束时的状态。** 每个被确认为属于本 Turn 的模型调用贡献一个 sample；sample 逐 bucket 相加得到聚合值。最后一个 sample 在任何情况下都不代表 Turn。
2. **只折叠，不推导。** 聚合只做同 bucket 相加。不从 bucket 之间推导任何未报告的数据，不换算单位，不做价格计算，不校正不自洽的数值，不参与 `status` 判定或抑制判定（这三条是 D006 原文，继续有效）。
3. **bucket 语义固定。** `inputTokens` 是**未命中缓存的输入**，与 `cacheReadTokens`、`cacheWriteTokens` 互不重叠，三者相加才是计费输入；`reasoningTokens` 已包含在 `outputTokens` 内，**永不**与 `outputTokens` 相加。因此正文中不出现任何「total」行。
4. **缺失即缺失。** provider 未报告的 bucket 不补零、不插值：该 sample 对该 bucket 不贡献，且当全部 sample 都未报告某 bucket 时，聚合值中该字段**省略**。实测依据：`opencode-go/hy3` 在无缓存命中时省略 `cacheReadTokens`（省略即该次调用没有缓存读入），而 `deepseek-official` 恒报该字段——两者在同一 Turn 内混合出现，因此「按报告过的 sample 求和」重建的是该 bucket 的真实 Turn 合计，而「要求所有 sample 都报告」会丢弃真实数据。
5. **`totalTokens` 不参与聚合，且不在 schema v2 中出现。** 该字段在 DSH 中的定义是 per-call 的「整次调用 prompt + output 合计」，其值可能由 adapter 从权威计数器推导而来，而非 provider 原样给出；把逐次合计再求和，等于由插件产出一个语义混杂的 Turn total，与第 3 条及 §21 的约束冲突（实测 30 205 个 sample 中 3 283 个未报告该字段，按缺失即缺失处理会得到一个不完整却形似总数的数字）。per-call 的 `totalTokens` 仍可被适配器读取，但不再进入候选。
6. **覆盖范围必须显式。** schema v2 新增四个必须字段：

   | 字段 | 语义 |
   | --- | --- |
   | `usageSampleCount` | 已折叠的、相互区分的模型调用 usage 报告数 |
   | `usageMissingCount` | 已观察到但未给出可用 usage 的应计模型调用数（含未结算的 step） |
   | `usageUnobservableRetries` | 失败且 usage 不可观察的重试调用数（`llm/retry` 记录） |
   | `usageComplete` | 当且仅当 Turn 自 `turn/start` 起被观察、无重试、无缺失、无未结算 step 且至少有一个 sample 时为 `true` |

   `usageMissingCount` 与 `usageUnobservableRetries` 是两条**独立事实**，不是对 Turn 调用集合的划分：同一次失败调用可能同时留下 `assistant/attempt` 结算与 `llm/retry` 记录，因而在两个计数中各出现一次。正因为如此，二者都不得被表述为「调用总数」。
7. **重复与重放不得重复计数。** settlement 身份取自已被证实稳定的运行时字段：durable `seq`（会话内单调唯一，实测 30 227 条 `assistant/message`、83 条 `assistant/attempt`、376 条 `llm/retry` 全部携带），其次是 `message.id`。在此之上再加一条实测边界：`assistant/message` 每个 step **至多一条**（实测 30 227 条消息中同 step 出现两条的次数为 0），因此「同一 step 的第二条携带 usage 的 message」按重复处理。该边界只作用于携带可折叠 sample 的 message，使同 step 中不携带 usage 的 message 仍被计为一次独立调用，而不是被静默吞并。
8. **`usageComplete` 与 `telemetryComplete` 保持独立。** 前者断言「每个应计模型调用都报告了 usage」，后者只断言「插件从 `turn/start` 起观察该 Turn」。完整观察不等于 provider 逐次报告，二者不得合并为一个字段，正文中分行呈现。
9. **Duration 不受本决策影响。** `durationMs = event.time(turn/end) − event.time(turn/start)` 的定义不变（D015 与 `ARCHITECTURE.md` 第 5 节）。Phase 6 在同一真实 Turn 上独立复核了该公式，未发现缺陷；见 `PHASE6_REPORT.md` 第 5 节。

**Reason**

真实运行时取证（858 份 session log、1 432 个已结束 Turn、503 208 个事件）给出四条决定性事实：

其一，`assistant/message` 的 `usage` 是**逐次调用**的，一个 Turn 有多次调用。实测单个 Turn 最多 2 611 个 step；一个 63 步的真实 Turn 折叠出 `inputTokens=99960, outputTokens=84145, cacheReadTokens=9103616`，而 v0.1.0 的候选只有最后一次调用的 `inputTokens=299, outputTokens=1190, cacheReadTokens=199552`。丢失的部分不是舍入误差，而是 99% 以上的数据。

其二，失败调用在两类记录中留下痕迹：`llm/retry`（实测 376 条，覆盖 261 个 step）与 `assistant/attempt`（实测 83 条）。两者都**不携带**失败调用的 usage，因此该次调用的用量在现有事件面下不可观察。把这种情况静默忽略，会把部分统计呈现为完整统计，正是本决策第 6 条要防止的。

其三，逐 bucket 折叠的正确性可由 harness 自带的独立实现交叉验证。`@deepseek-ai/dsh-token-meter` 的 `deriveTurnTokenUsage` 与本插件在同一天的全部真实 Turn 上对比：在其给出数值的 967 个 Turn 上，`inputTokens`/`outputTokens` 与本插件聚合值 **967/967 完全一致**；其余 464 个 Turn 因其更严格的 bucket 完备规则返回 `undefined`（要求每个 attempt 都报告 `totalTokens`，或同时报告两个 cache bucket——而实测 503 208 个事件中 `cacheWriteTokens` 出现 0 次）。两者的差异只在「可选 bucket 是否要求全员报告」这一披露策略上，不在数值上。

其四，D006 中记录的不自洽样本 `{inputTokens: 255, outputTokens: 759, totalTokens: 187638, cacheReadTokens: 186624}` 现已可解释：它是**单次调用**的原始记录（未缓存输入 255 + 缓存读入 186624 + 输出 759 = 187638 = `totalTokens`，逐字节自洽），Phase 1 之所以读成不自洽，是因为把 per-call 的 `totalTokens` 当成了累计量。该结论不改变 D006 的任何条款——本插件仍不作换算、不作校正——但它解释了 D006 的 Reason 中列出的那条观察。

**Rejected alternatives**

1. **保持 schemaVersion 1 并只改实现**：`usage` 的字段语义发生改变，而 v1 的消费方无法区分「最后一次调用」与「Turn 聚合」；D013 明确要求语义变化必须递增版本号。
2. **聚合时把 `totalTokens` 一并求和并展示为 Total**：会产出与第 3 条冲突的、语义混杂的总数，且 10.9% 的 sample 不携带该字段，得到的是一个不完整却形似总数的值。
3. **要求所有 sample 都报告某 bucket 才输出该 bucket（官方 meter 的严格规则）**：会丢弃真实数据（实测 111/1432 个 Turn 的 sample 形状不一致），并且与第 4 条的实测语义不符。
4. **用 `usage += event.usage` 的单行累加代替带身份的折叠**：无法抵御重复投递、重放与重试，会把一次调用计成两次。
5. **在无法观察重试用量时把 `usageComplete` 置为 true 并在正文中附免责说明**：免责说明不能消除误读，且与第 6 条的判据直接冲突。
6. **把 `usageComplete` 合并进 `telemetryComplete`**：两者语义不同（见第 8 条），合并会使「完整观察但 provider 未逐次报告」与「中途装载」无法区分。

**Consequences**

- 消费端必须检查 `schemaVersion === 2` 后再按 Turn 聚合语义解释 `usage`；任何仍按「最后一次调用」解释 v2 记录的读取方都会得到错误的量级判断。
- 测试须包含 `schemaVersion === 2` 的显式断言（替代 D013 中针对 `1` 的那条），并覆盖多 step 折叠、可选 bucket、reasoning 不重复计入、缺失 usage、中途装载、重复／重放、重试七类场景。
- 正文标签由 `Token counters (as reported)` 改为 `Token usage (turn aggregate)`，并新增 `Token telemetry complete:` 一行；标签的措辞是契约的一部分，不是排版选择。
- `candidate.produced` 日志新增 `usageSampleCount` / `usageMissingCount` / `usageUnobservableRetries` / `usageComplete` / `steps` 五个标量字段；计数器本身仍不进入日志（`SECURITY.md` §4）。
- 若未来要展示计费总量或费用，必须另行设计并新增 ADR，不得在本决策之上顺手扩展。

---

## D018 — Human-attention 通知触发器与隐私边界（Phase 8，2026-09）

**背景**

v0.1.1 的通知模型只有一个生命周期：一个已结算的 Turn。Phase 8 要求覆盖另外两条真实存在的链路——**终局失败**与**回合中的人工交互**（`ask_user_question`、`approval/asked`）。这三者不是同一个东西，把它们塞进同一个 `NotificationCandidate` 会让「已结算 Turn」这一语义被稀释，也会让隐私边界失去唯一的声明点。

Phase 8 同时暴露了 v0.1.1 的一个实质缺陷：`turn/end.reason.kind === 'error'` 的 Turn 若无可见文本，则按 D011 被无条件抑制。真实运行时取证确认，终局 provider 故障（额度耗尽、速率限制最终失败、传输失败）恰好经常不产生任何可见输出——被抑制的正是最需要被告知的那一类失败。

本决策同时冻结三件事：三条链路的触发点、失败邮件的结构语义、以及 `ask_user_question` 引入的、项目历史上第一个工具参数外发例外。

**Decision**

**一、终局失败只在最终 `turn/end` 触发，恢复的重试不触发。**

失败事实只在 `turn/end` 的 `reason.error` 边界读取一次，且只在 `reason.kind === 'error'` 时读取。`llm/retry` 是**单次失败尝试**的持久化记录，不是故障通知触发器：DSH 内部重试后恢复的请求，其 Turn 仍以 `{ kind: 'completed' }` 结束，因此不产生任何故障邮件。

```text
temporary request failure
    !=
terminal turn failure
```

该区分是硬语义，不是优化。`llm/retry` 的默认可重试码集合为 `EMPTY_RESPONSE` / `RATE_LIMIT` / `SERVER` / `TIMEOUT` / `TRANSPORT`（`dsh-llm` 的 `DEFAULT_RETRYABLE_CODES`），在正常网络条件下这些都是会被自动恢复的瞬时状态；对它们发邮件会稳定地制造噪声。

**二、失败分类只读结构化字段，不读 message 文本。**

只读取 `reason.error` 的 `code`、`status`、`providerRetryAfterMs`。**禁止**用 `"429"`、`"quota"`、`"timeout"`、`"rate limit"` 等字符串匹配决定错误类型。`message` 仅供人阅读，不参与任何状态判定。该约束的权威依据是 DSH 自身：`HarnessError.code` 的文档明确要求「route on this, never by parsing `message`」。

`reason.error.requestId` 本阶段**不外发**。它是 provider 签发的不透明诊断标识，对收件人没有行动价值，出现在第三方邮箱里只扩大暴露面。

**三、故障邮件不要求可见文本；completion 邮件仍然要求。**

```text
completed notification
    may require visible assistant output

failure notification
    does NOT require visible assistant output
```

该条款取代 D011 中「`status === 'error'` 且无可见文本仍不发送」的后半句。D011 的其余部分（completion 型通知需有文本、规则无配置开关）继续有效。

故障邮件必须携带独立的 Failure 段，逐项声明观察结果；运行时不提供的项写「not reported」，**不写默认值**——未报告的 Retry-After 与 0 毫秒是两个不同的事实。失败前存在用户可见输出时，该输出放入标题为 `--- Partial model output before failure ---` 的独立段落，**不得**被表述为最终答案；不存在时写明 `--- No model output was produced before this failure ---`，而不是留空。

**四、`notifyErrors` 的公开默认值保持 `false`。**

升级不得使既有用户突然开始外发故障信息。修正的是文档语义而非默认值：`notifyErrors: true` 必须真正意味着「终局 error Turn 即使没有可见助手输出也会发送通知」。不新增含义重复的 `notifyFailures`。

**五、人类注意力通知是回合中事件，不是已结算 Turn。**

`question` / `approval` 属于回合中的人工交互生命周期，与终局 Turn 生命周期是两件事，因此在类型上是 discriminated union 的两个独立成员（`turn` / `question` / `approval`），而不是同一个 `NotificationCandidate` 的字段组合。渲染器按 `kind` 显式分支，question/approval/failure 三种形态**不得**伪装成「模型最终输出」。footer 措辞也按族区分。

`minTurnDurationMs` **只**适用于终局 Turn 通知。刚进入 Turn 两秒就提问的 Agent 正是该邮件存在的理由，对它施加回合时长门槛会系统性地把它抑制掉。

**六、`ask_user_question` 经持久化 `tool/call` 观察，不拦截 waterfall。**

触发点是持久化的 `tool/call` 会话事件，且仅在 `name === 'ask_user_question'` 精确命中时才解析其 `arguments`。`user-questions/request` 是 **answer ownership chain**（返回答案即认领该请求，否则调用 `next()` 委托），通知插件不得注册它，也不得 claim / answer / reorder / delay / replace 官方 UI answerer。邮件通知必须是 observation only。

收到合法 `tool/call` 后立即构建通知并异步入队，**同步返回**；不等待 `tool/result`、不等待 `turn/end`、更不等待人工回答。session/event 监听器仍不得 `await` SMTP。

**七、通用工具参数仍然禁止外发；例外是一个语义白名单，不是权限。**

项目原则「tool arguments never leave the process」继续成立。新增的例外极窄：

> `ask_user_question` 中**已由 DSH 定义为 human-facing presentation** 的白名单字段可以进入 question notification。

白名单恰好五项：`id`、`header`、`question`、`options[].label`、`options[].description`，加上布尔字段 `multi_select`。**原始 `ask_user_question` arguments 仍然禁止外发**：JSON 字符串被解析后逐字段复制进新对象即丢弃，不保留引用、不落日志、不进邮件；实现中不存在对源对象的任何 spread。其它任何 `additionalProperties` 一律丢弃。

解析器必须防御性 `JSON.parse`、做形状检查、逐字段拷贝、并对长度与数量设界（问题数、每题选项数、单字段字符数、总字符数）。畸形 JSON 是正常结果而非异常：降级为「无可通知内容」并记录原因，**不得**在 session append 路径上抛出。

**八、approval 经持久化 `approval/asked` 观察，不用 `approval/request` waterfall。**

理由与第六条同构：`approval/asked` 是 durable audit 事件（与 `hook/*` 同类，无 `surfaceOp`），观察它不会争夺 answer ownership。只使用该审计契约实际提供的安全字段（`id`、`toolName`、`callId?`、`reason?`）；DSH 的 approval 契约**刻意不复制** tool arguments，该安全属性必须原样保持——不得为了展示「被批准的是什么」而回头去 join `tool/call`。

只在 `asked` 时发送「需要处理」邮件。`decided` 表示人工已经作出决定，此时再发第二封「需要你处理」是错误陈述。本阶段也不发送「你已批准」状态邮件。

**九、去重命名空间彼此独立。**

```text
turn:${sessionId}:${turn}
question:${sessionId}:${callId}          // 无 callId 时回落 question:${sessionId}:t${turn}:s${step}
approval:${sessionId}:${approvalId}
```

question 通知**不得**复用 `${sessionId}:${turn}`，否则它会与同一 Turn 的终局通知互相消耗：回合中的提问会占用该 Turn 的键，导致后续的完成或失败通知被判为重复而丢弃。同一 call 至多通知一次（进程生命周期内），同一 Turn 中不同 `callId` 各自可通知，终局通知在人工回答之后**仍然必须**保持可通知。

**十、`includeSubagents` 的既有语义覆盖全部三个族。**

`includeSubagents: false`（默认）下，子代理的回合、提问与审批都不发邮件。该判定在状态建立之前完成，因此被排除的会话不占内存。

**十一、订阅面保持 observation only。**

`approval/asked` 与 question 的 `tool/call` 都只读观察。插件注册的监听器集合中不存在 `user-questions/request` 与 `approval/request`。

**Reason**

三条链路各自的触发点是运行时取证的结果，而非设计偏好。`turn/end.reason.error` 的形状是 `LlmFailure = { message, code, status?, providerRetryAfterMs?, requestId? }`（`dsh-llm` 类型面，且由 `failureSnapshot` 在运行时校验为闭集），因此结构化分类有据可依；`tool/call` 的 payload 是 `{ turn, step, callId, name, arguments }`，`arguments` 是「模型原样产生的未解析 JSON 字符串」，因此「精确匹配工具名后再解析」是唯一可用的观察方式；`approval/asked` 的 payload 是 `{ id, toolName, callId?, reason? }`，其中**没有** turn 与 session 字段——turn 上下文是位置性的（只在 open turn 内合法），session 是 append 目标。这三点共同决定了触发器只能落在持久化事件上，而不是 waterfall 上。

把 question/approval 塞进 `NotificationCandidate` 会在类型层面失去「该 Turn 是否已结算」这一判据，`status`、`durationMs`、`usage`、`visibleText` 这些字段对回合中事件均无意义；用一个 `candidate` 承载三种语义必然导致渲染层靠「哪些字段有值」反推形态，而那种反推正是把提问渲染成最终答案的路径。

隐私例外之所以必须写成白名单而非权限，是因为工具参数的禁止规则一旦以「按工具名放行」的形式表达，下一个需要放行的工具就会以同样理由被加入。白名单把例外锚定在「DSH 已定义为面向人的展示字段」这一可核验的属性上：这些字段本来就是给人类读者准备的，而 `bash` 的命令行、`fs` 的路径、`subagent` 的提示词从来不是。

**Rejected alternatives**

1. **对每个 `llm/retry` 发失败邮件**：在正常网络条件下制造稳定噪声，且把「瞬时失败已被自动恢复」与「任务最终失败」等同起来，掩盖真正需要人工介入的事件。
2. **用 message 文本匹配判断错误类型**：与 DSH 自身的显式要求冲突；provider 的措辞会变化，且模型可控文本出现在分类路径上等于把状态判定交给不可信输入。
3. **保留「无可见文本即抑制」并让用户在 `notifyErrors` 之外再开一个「仅状态邮件」开关**：需要第二个邮件形态与第二套测试矩阵，而它要解决的问题（终局故障无输出）应当直接由 `notifyErrors: true` 的语义覆盖。
4. **把 `notifyErrors` 默认改为 `true`**：升级会使用户在不知情的情况下开始外发故障信息，包含 provider 错误文本。
5. **注册 `user-questions/request` waterfall 监听器并调用 `next()`**：会进入 answer ownership chain；即使只是调用 `next()` 也是对该链的参与，一旦某处实现偏离（忘记 `next()`、抛错、改变顺序），官方 UI answerer 就会被静默替换。
6. **在 `approval/decided` 时补发一封结果邮件**：本阶段不需要状态邮件，且「已决定」的邮件会被误读为仍需处理。
7. **question 复用 `${sessionId}:${turn}` 去重键**：会吞掉同一 Turn 的终局通知，这恰是 Phase 8 第 33 节端到端用例要证明不能发生的事。
8. **把 `minTurnDurationMs` 也施加于 question/approval**：会系统性抑制「刚开始就提问」这一最常见情形。
9. **为了展示被审批的命令而把 `approval/asked.callId` 与 `tool/call.arguments` join 起来**：直接破坏 DSH approval 契约刻意保留的安全属性。

**Consequences**

- `MailJob` 的载体由 `candidate` 变为 discriminated union `Notification`；`renderMail` 的入参同步改变。这是内部契约变更，不涉及 `NotificationCandidate` 的 `schemaVersion`（仍为 `2`）：候选本身未变，变的是承载它的信封。
- 新增两个配置项 `notifyQuestions`、`notifyApprovals`，默认均为 `false`。README 必须明确：开启任一项都会把相应的人机交互内容发送到第三方邮件系统。
- 新增模块 `src/human-attention.ts`，是 `src/` 中唯一被允许读取 `tool/call.arguments` 的模块；`runtime-adapter.ts` 只做字符串拷贝，`event-handler.ts` 只做一次精确工具名比较后转交。
- `src/index.ts` 注册两个 `session/event` 监听器：一个维护 Turn 状态，一个只观察 `approval/asked`。`user-questions/request` 与 `approval/request` 不在注册集合内。
- `DedupeCache` 新增 `questionKeyFor` / `approvalKeyFor`，`keyFor` 的返回值改为带 `turn:` 前缀。旧键形不再是契约的一部分（去重不持久化，跨重启无保证，见 D008），因此该变更无迁移成本。
- ~~Phase 8 曾把 `CREDENTIAL_REF_PATTERN` 放宽为同时接受裸名与 `<scope>/<id>`。~~
  **该诊断与实现均已在 Phase 8.1 撤销；现行凭据契约完全由 D019 定义。**
- 子代理的 `ask` 能力不假设可用：DSH 的 `dsh-user-questions` 对 delegated caller 抛 `DELEGATED_CALLER`，因此「子代理是否真能提问」随 composition 而异。插件的闸门（`includeSubagents`）必须独立于该能力可观测。
- 本阶段不实现：邮件回复作答、邮件内 action link、一键批准、远程回调。也不构造任何含 DSH Web token 的深链接——`?token=...`、auth token、session secret 一律不得进入邮件。

---

## D019 — 凭据引用文法回归 DSH 的 `CredentialRef` 契约（Phase 8.1，2026-09）

**背景。** D018 的 Consequences 记录了一项实现期修正：把 `CREDENTIAL_REF_PATTERN` 从 `^[A-Za-z_][A-Za-z0-9_]*$` 放宽为同时接受裸名与 `<scope>/<id>`，理由是「Credential store 只接受 `<scope>/<id>`」。该诊断经复核**不成立**，Phase 8.1 予以撤销。

**决定。** `smtpPasswordCredential` 的校验文法回归为：

```text
^[A-Za-z_][A-Za-z0-9_]*$
```

即 DSH `CredentialRef` 的**全部**文法，且仅此一种形式。`<scope>/<id>` 形式被拒绝。

**Reason**

DSH 的凭据 seam 有两个**互不相通**的键空间，Phase 8 把二者混为一谈：

| 概念 | 文法 | 入口 | 存储位置 |
| --- | --- | --- | --- |
| `CredentialRef` | `^[A-Za-z_][A-Za-z0-9_]*$` | `resolve()` / `describe()` / `set()` / `unset()` | `.credentials.yaml` 的 `refs` 段 |
| `CredentialKey` | `<scope>/<id>`，每段 `^[a-z][a-z0-9-]*$` | `readRecord()` / `describeRecord()` / `modifyRecord()` / `listRecords()` | 同一文件的 `records` 段 |

本机安装的 `@deepseek-ai/dsh-credentials@0.1.5-rc.1`（`lib/types/index.js`）把该契约实现为两个模块级常量：`REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/` 与 `KEY_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/`；`credentialRef()` 对前者抛 `TypeError`，`credentialKey()` / `parseCredentialKey()` 对后者抛。同一安装的 `@deepseek-ai/dsh-credentials-local@0.1.5-rc.1` 在解析文档时对 `refs` 段的每个键调用 `credentialRef()`、对 `records` 段的每个键调用 `parseCredentialKey()`，因此**一个 `<scope>/<id>` 键写入 `refs` 段会使整份文档在启动期被拒绝**。

关键事实是 Phase 8 遗漏的那一半：`LocalCredentialProvider.resolve()` 与 `describe()` 只读 `values`（即 `refs` 段）与继承环境，**从不查询 `records`**。因此 `<scope>/<id>` 作为 `smtpPasswordCredential` 是一个永远解析不到的引用。放宽文法不但无益，还有害：它把一次可以在挂载期报出的配置错误推迟到每次投递尝试，并且报出的是一条「未配置」诊断——而真正的原因是引用形式根本不属于该键空间。

**Rejected alternatives**

1. **保留双形式（Phase 8 现状）**：如上，接受一个 `resolve()` 永远读不到的引用，把挂载期错误变成运行期静默失败。
2. **按 DSH 版本分流（Outcome B）**：本机只安装并验证过 `0.1.5-rc.1` 一个版本，两个文法常量同属该版本，不存在需要分流的第二个 shape。为一个不存在的历史差异引入版本判断只会制造未经测试的代码路径。
3. **新增一个独立的 `smtpPasswordCredentialKey` 配置项走 records 段**：新增配置面与一条新的解析路径，而 `records` 段的 payload 是**拥有者自定义格式**（`ApiKeyRecord` 或 `GrantRecord`），seam 明确声明自己不解释它。一个 SMTP 密码放进 records 段是误用该段的设计意图，不是本插件该支持的部署。

**Consequences**

- `src/config.ts` 的 `CREDENTIAL_REF_PATTERN` 与 DSH 的 `REF_PATTERN` 逐字符相同；挂载期错误信息直接说明 `<scope>/<id>` 属于 record half。
- 新增 `tests/integration/credential-contract.test.ts`：以**安装的** `credentialRef()` / `isCredentialRefName()` / `credentialKey()` / `parseCredentialKey()` 为基准，逐候选比对插件自己的文法副本。这是该缺陷类别唯一能被抓住的方式——拿插件自己的模式做基准测试，测的正是出错的那份副本。
- 探针的凭据引用由 `credentials/smtp-password` 改为 `DSH_MAIL_SMTP_PASSWORD`，并改为把**出厂** provider 指向一次性探针目录，使 `resolve()`/`describe()` 的真实实现参与运行（A13）。
- `.env.example`、`docs/CONFIG_SPEC.md` 与本文件的示例名称不变：它们一直是 `DSH_MAIL_SMTP_PASSWORD`，即被撤销的那次放宽从未改变文档化的默认值。

---

## 附：Implementation Addendum — Phase 8（2026-09）

本节记录 v0.2.0 实现期间出现的、D001–D017 未覆盖或需补充的事实。**D001–D017 本身除 D011 中已显式标注的那一句外未被修改。**

### A8（补记，非偏离）— `tool/call` 适配输出的扩展

D001 与 Phase 3 补记 A1 把 `tool/call` 的输出定为 `{ kind: 'tool-call', turn, step, timeMs }`。D018 第六条要求对工具名做精确比较、并在命中时把 `arguments` 交给专用解析器，因此该变体扩展为同时携带 `callId`、`name` 与 `rawArguments`。

扩展是必要推论而非语义选择：没有 `name` 就无法在不解析参数的前提下判断是否为 question call，而「不解析其它工具的参数」正是 D018 第七条要求保持的性质。`rawArguments` 只允许被 `human-attention.ts` 读取；`runtime-adapter.ts` 只做一次 `typeof === 'string'` 拷贝，`event-handler.ts` 只做一次精确比较后转交，不检视、不记录、不存储。**不构成对 D001 的偏离。**

实测边界：`tool/call` 的 `arguments` 在已安装运行时恒为**字符串**（`dsh-session` 类型面声明为 `arguments: string`）。适配器因此只接受字符串，遇到结构化值即视为无参数；解析器自身另有一条接受对象的兼容分支，使该字段在两侧都不会以未类型化的形式被传递。

### A9（补记，非偏离）— `QuestionDropReason` 中 `content-limit` 在当前界限下不可达

`content-limit` 只在「本次调用中每一个问题都被运行总量界限拒绝」时上报。而首个可用问题的成本上限为 `MAX_QUESTION_CHARS`（2000）加 `MAX_QUESTION_ID_CHARS`（200），远低于 `MAX_TOTAL_QUESTION_CHARS`（6000），因此首个问题除非自身字段校验失败，否则必被携带——该原因在当前界限下不可达。

保留该成员而不删除，是因为解析器的记账逻辑确实能够上报它，且未来调整界限可能使其可达；「罕见」与「错误」不是同一件事。测试对该夹具能诚实给出的结论做了断言：以解析器可携带的最大集合验证原因未定义且明确不为 `content-limit`。

### A10（补记，非偏离）— 实现期间修正的一个解析器缺陷

`parseAskUserQuestionArguments` 的运行总量界限最初只为**被携带**的问题递增，导致被尺寸上限拒绝的问题不消耗额度，其后更小的问题会穿过缺口被携带，返回集合不再是调用的前缀。最小复现：三个 2000 字符问题加一个 3 字符问题，累计在第 3 问越界，实测携带第 1、2、4 问。

修正方式为在边界判断**之前**执行累计（`totalChars += cost`），使被拒绝的问题同样消耗额度，携带集合成为严格前缀。该缺陷由 Phase 8 的单元测试发现，早于发布。

### A11（补记）— `cleanText` 的实际行为严于其注释所述

`human-attention.ts` 的 `cleanText` 委托 `sanitizeDetail`，后者把整个 C0/C1 控制字符区间压成空格，**不保留换行**。该行为严于「保留行结构」这一最初设想，且是刻意的：解析器的输出同时供给正文与主题行，主题行不能容忍 CR/LF，两者中更严的约束支配。注释已改为与实际一致。

### A12（补记）— Phase 8 的端到端探针

仓库内含 `scripts/probe-e2e.mjs` 与 `scripts/probe/`：它在一次性 `DSH_HOME` 上启动**出厂 `headless` profile**，并叠加四个探针行——脚本化模型 provider（因此运行不需要任何外部凭据、也不消耗真实套餐额度）、`ask_user_question` 工具、人工替身（应答 `user-questions/request` 与 `approval/request`）、以及指向回环 SMTP 服务器的 `dsh-mail-notify` 本体。真实的 agent loop、工具注册表、session log、插件的监听器/队列/mailer 与一次真实 SMTP 会话全部参与。

与 Phase 3 补记 A6 的 `dev-boot-probe.mjs` 一样，它不属于产品交付面，`package.json` 的 `files` 白名单不含 `scripts/`，因此不进入 npm 归档。

---

## 附：Implementation Addendum — Phase 8.1（2026-09）

### A13（补记）— 探针的凭据层由替身改为出厂 provider

Phase 8 的探针用 `fake-credentials.mjs` 发布了一个凭据服务替身（从单个环境变量解析一个硬编码引用）。该替身让邮件链路可以不带真实密钥运行，但也使「插件配置里的引用是否合法」这一问题完全无法被这次运行回答：一个接受任意字符串的替身只能证明替身本身宽容。

Phase 8.1 改为把**出厂**的 `@deepseek-ai/dsh-credentials-local` 指向一次性探针目录（`credentials` 行的 `path` 覆盖），文档中只放一条合成引用。于是 `resolve()`、`describe()`、层优先级与文档解析全部走真实实现，而来源仍受控。替身文件已删除。

### A14（补记）— `QuestionDropReason.'content-limit'` 的处置：保留但标注为保留值

`content-limit` 只在「本次调用未携带任何问题，且有某个问题被运行总量界限拒绝」时上报。当前界限下该组合不可能出现：单个良构问题的成本上限为 `MAX_QUESTION_CHARS + MAX_QUESTION_ID_CHARS = 2200`，低于 `MAX_TOTAL_QUESTION_CHARS = 6000`，因此首个良构问题必被携带；而尺寸界限只能在已有问题被携带**之后**拒绝后续问题，于是结果必然是部分携带，`dropReason` 根本不会被计算。`HAT-11c` 证明该边界，`HAT-11e` 用耗尽额度的夹具证明其不可达。

**裁决：保留该成员。** 依据是解析器的记账仍会赋值 `truncatedBySize`（若两个界限的相对大小在未来改变，该值会立即变为可达），删除它会让一个仍在使用的取值脱离词汇表；保留的代价是一个联合分支加一个测试，且该测试明确写出它今天为何不能触发。`src/types.ts` 的该分支上已附这条结论。

### A15（补记）— `parentSession` 与 DSH 真实 header 的对照

Phase 8 记录过一个理论性担忧：fork 出的会话也携带 `parentSession`，因此三判据中的第二条可能把用户主动 fork 的会话判为子代理。Phase 8.1 对照了本机安装的 DSH 源码，结论是**该担忧成立，但范围比记录更窄**：

- `dsh-subagent` 的 `childSessionMeta()`（`lib/index.js:502`）为**每一个**子代理子会话同时写入 `origin: 'subagent'`、`delegationDepth: parent + 1` 与 `parentSession: parent.id`。该函数被 `dsh-subagent`、`dsh-subagent-continuation` 与 `dsh-subagent-in-process-driver` 三条创建路径共同使用，因此运行时的子代理**全部**命中第一条判据。
- `dsh-session` 的 `SessionStore.fork()`（`lib/index.js:1578`）只写 `parentSession` 与 `isSeeded: true`，**不写** `origin`、**不写** `delegationDepth`。该路径由 `session/fork` 远端命令（`dsh-api-session-controller`）驱动，即用户主动的会话分支。

因此当且仅当一个用户主动 fork 会话时，第二条判据才会单独成立并把该会话判为子代理；`includeSubagents: false` 下该分支的回合、提问与审批都不发邮件。**未观察到任何真实子代理被误判**，故按「不以理论顾虑改动既有语义」的要求，三判据及其顺序在本阶段保持不变；上表事实作为后续复核依据记入。

---

## 附：Implementation Addendum — D001–D016 的实现补记

本节记录实现期间出现的、D001–D016 未覆盖或需补充说明的事实。**D001–D016 本身未被修改，也未新增或删除任何决策的语义。** 逐项标注它属于「补记」还是「需要裁决的实现偏离」。

### A1（补记，非偏离）— 适配器输出联合的完整性

D001 把「四个事件」收敛为单一入口，`ARCHITECTURE.md` 第 3 节列出了适配器的五个输出变体，但该清单遗漏了 `tool/call`。实现要求 `TurnState.toolCallCount` 计数（`ARCHITECTURE.md` 第 4 节字段表、D007 对 `toolCallCount` 的保留说明），因此适配器必须识别 `tool/call` 并输出 `{ kind: 'tool-call', turn, step, timeMs }`，路径为 `event.data.turn` / `.step`（`PHASE1_RUNTIME_CONTRACT.md` 已确认两者存在）。

这是补齐冻结设计内部一致性所必需的推论，而非语义选择：若不输出该变体，`toolCallCount` 将恒为 0，与 `ARCHITECTURE.md` 第 4 节直接冲突。**不构成对 D001 的偏离。**

### A2（补记，非偏离）— `user/message` 不携带 turn，需按会话暂存

D012 的 Consequences 要求 `includeUserPrompt` 的采集在 Phase 3 即实现。实现时发现一个设计未预见的事实：`user/message` 的 payload 是 `UserMessage` 本身，**不含 `turn` 与 `step`**（`PHASE1_RUNTIME_CONTRACT.md` 的 `SessionEventMap` 明确如此），而运行时的投递顺序是 `user/message` 先于它所归属的 `turn/start`。

因此该事件不能走「turn 缺失即降级为 `other`」的判别（那会丢弃全部用户文本），实现改按会话暂存：`Map<sessionId, {text, at}>`，在该会话下一个 turn 建立时写入其 `TurnState.lastUserText`，并以 `PENDING_USER_TEXT_TTL_MS = 120_000` 为界，避免把很久以前的 prompt 接到无关的新 turn 上。采集始终进行，仅渲染受开关控制——与 D012 及 `CONFIG_SPEC.md` 第 6 节一致。**这是补齐，不是偏离。**

### A3（补记）— 结算即释放使 `duplicate` 在运行时成为防御性分支

D008 的判定顺序把去重放在最后一步，并要求「只有确定入队成功时才写标记」。实现遵循该顺序，但在真实 DSH composition 中观察到：由于 `turn/end` 结算后立即释放 `TurnState`（`ARCHITECTURE.md` 第 7 节），同一 `(sessionId, turn)` 的**重复 `turn/end`** 会懒初始化出一个空状态，先命中 `no-visible-text` 抑制，因而永远走不到 `duplicate` 分支。

这**不改变 D008 的任何条款**：去重的真实对象是「同一 turn 的重复投递」，其行为（第二次不入队、reason 为 `duplicate`）由 L1/L2 测试驱动真实事件总线验证；跨重启不保证的边界说明同样不变。此处记录的是该分支在正常运行时的可达性，避免日后被误读为「实现遗漏了去重」。完整观察见 [`DSH_INTEGRATION.md`](DSH_INTEGRATION.md) 第 4 节。

### A4（补记）— `NotificationCandidate` 的两个新增可选字段

D007 的候选在实现中增加两个**可选**字段：`sawTurnStart?: boolean` 与 `userText?: string`。

- `sawTurnStart` 来自 D016 第 10 项对 Phase 1 字段的保留裁决（「sawTurnStart 保留」）。Phase 1 原型把它作为独立字段，而 D007 的必填/可选清单未列入。实现将其作为可选字段一并输出，供日志审计辨别「正常路径」与「中途装载路径」。它与 `telemetryComplete` 当前同值，语义不同（前者描述事件是否被观察到，后者描述计数是否覆盖整个 turn），这正是 D004 拒绝合并两者的理由。
- `userText` 仅在 `includeUserPrompt: true` 时携带（D012），使渲染层不需要第二个数据来源。

按 D013 的版本递增规则，**新增可选字段不递增 `schemaVersion`**，因此两者均属 `schemaVersion: 1` 内兼容，`schemaVersion` 保持字面量 `1`。此处记录是因为 D007 的字段清单未列出它们。

### A5（补记）— 重试上限与错误分类的两处实现细节

- `RetryPolicy` 增加 `retryMaxDelayMs`（固定 `30_000`），对应 `ARCHITECTURE.md` 第 6 节的「退避上限 30000 ms」。该值不是配置项：`CONFIG_SPEC.md` 第 2.8 节未提供对应字段，实现也不新增，符合「不自行新增配置」。
- `ECONNREFUSED` 归入 `permanent`，与 `ARCHITECTURE.md` 第 6 节分类表中「`ENOTFOUND`（域名不存在）、`ECONNREFUSED` → 立即失败」一致；`ENOTFOUND` 与 `EAI_AGAIN` 分属两类（后者为临时 DNS，可重试），同样与该表一致。实现中 `TRANSIENT_CODES` 与 `PERMANENT_CODES` 两个集合逐项对照该表，未新增未列出的码。

### A6（补记）— 开发期观测工具的存在

`dsh` 命令行不注册 Cordis log exporter，日志仅存于进程内 1000 条环形缓冲，因此插件的结构化日志在进程外不可见。为使「在真实 composition 中运行」可被观测，仓库内含 `scripts/dev-boot-probe.mjs`：它调用 launcher 自身的 `runProfile`，并以包装 `LoggerService.prototype.exporter` 的方式附加一个输出到 stderr／文件的 sink。**它不修改 Harness 任何文件**，也不属于产品交付面；`package.json` 的 `files` 白名单不含 `scripts/`，因此它不进入 npm 归档。

### A7（补记）— 未新增任何配置字段

`CONFIG_SPEC.md` 第 2 节的字段集合与实现逐项一致，未新增字段。实现中唯一的判据性收紧是 `smtpHost` / `smtpUser` / `smtpPasswordCredential` / `from` / `to` 的「非空且格式合法」检查放在 `resolveConfig()` 而非 schema 内，以及 `to` 的「去重后 ≥ 1」规则无法用 schema 的 `.min()` 表达——两者行为与 `CONFIG_SPEC.md` 第 4 节一致，细节见该文件补记。

---

## 附：本文件与其它文档的关系

| 文档 | 关系 |
| --- | --- |
| `PHASE1_RUNTIME_CONTRACT.md` | 本文件所有 D001–D006 的事实来源；未被修改 |
| `PHASE1_REPORT.md` | 本文件 D016 第 9 项勘误的对象；未被修改 |
| `docs/ARCHITECTURE.md` | 实现 D001、D007、D009 的结构描述 |
| `docs/CONFIG_SPEC.md` | 实现 D010、D012、D014、D015 的配置面 |
| `docs/SECURITY.md` | 实现 D002、D010、D012 的边界声明 |
| `docs/TEST_PLAN.md` | 对 D001–D015 中每项可验证断言的测试映射 |
| `docs/IMPLEMENTATION_PLAN.md` | 实现上述决策的执行顺序 |
| `docs/DSH_INTEGRATION.md` | 本插件**实际使用**的 DSH 接口及验证版本（Phase 3 新增） |
| `docs/RELEASE.md` | 构建、打包、安装、更新与回滚（Phase 3 新增） |
| `docs/PRODUCT_SPEC.md` | 功能范围与明确的非目标（Phase 3 新增） |
| `PHASE3_REPORT.md` | 实现与验证的逐项结果（Phase 3 新增） |
| `PHASE8_REPORT.md` | D018 的实现与验证的逐项结果（Phase 8 新增） |
| `PHASE8_1_REPORT.md` | D019 的取证与裁决，approval E2E 的补齐，以及 Phase 8 遗留三项的处置（Phase 8.1 新增） |
