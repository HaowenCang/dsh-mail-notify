# ARCHITECTURE — dsh-mail-notify

本文件冻结 Phase 3 正式 TypeScript 实现的架构、模块边界与运行期契约。所有结构性决策的依据见 [`DECISIONS.md`](DECISIONS.md)；配置面的完整定义见 [`CONFIG_SPEC.md`](CONFIG_SPEC.md)。

本文件描述的是**待实现**的设计，不是已存在的代码。当前仓库没有任何 `src/` 目录。

> **Implementation note（Phase 3 补记，2026-09）。** `src/` 现已存在，本文件描述的设计已按第 3 节逐模块落地。实现过程中出现的、本文件未预见的事实记录如下；这些是补记，不修改上文任何冻结条目。
>
> 1. **实际模块清单**在本文件第 3 节的 15 个模块之外增加两个：`src/credentials.ts`（凭据解析 seam，含 `getCredentialProvider` / `resolveSmtpPassword` / `describeCredential`）与 `src/transport.ts`（`MailTransport` 接口与 Nodemailer transport 工厂）。二者是第 3 节 `mailer.ts` 一行的职责拆分：`mailer.ts` 仍负责渲染与编排，凭据生命周期与运输构造各自独立成模块，以便在测试中替换而不触网。`src/debug-sink.ts` 是第 3 节 P3.4 所要求的 DebugSink，作为独立模块实现。
>
> 2. **`InternalEvent` 增加 `tool-call` 变体。** 第 3 节 `runtime-adapter.ts` 的输出清单只列了四个带 turn 的变体，但本文件第 4 节要求 `tool/call` 更新 `toolCallCount`，D007 的候选说明也保留了该计数。为满足该要求，适配器输出 `{ kind: 'tool-call', turn, step, timeMs }`，取值路径为 `event.data.turn` / `.step`（Phase 1 契约已确认两者存在）。这是补齐冻结设计内部一致性的推论，不是语义变更。
>
> 3. **`InternalEvent` 增加 `user-message` 变体，且它在 turn 守卫之前处理。** `user/message` 的 payload 是 `UserMessage` 本身，不含 `turn` 与 `step`（见 `PHASE1_RUNTIME_CONTRACT.md` 的 `SessionEventMap`）。因此它不能走「turn 缺失即降级为 `other`」的分支。运行时的实际顺序是 `user/message` 先于它所归属的 `turn/start` 到达，所以 handler 将文本暂存在 `Map<sessionId, {text, at}>` 中，待该会话的下一个 turn 建立时写入，并以 `PENDING_USER_TEXT_TTL_MS`（120 s）为界，避免把很久以前的 prompt 接到无关的新 turn 上。采集始终进行，仅渲染受 `includeUserPrompt` 控制（`CONFIG_SPEC.md` 第 6 节）。
>
> 4. **`turn-end` 的 `turnEndKind` 在适配器内完成窄化。** 第 3 节把它列为输出字段而非 detail；实现中 `detail` 与 `reasonDetail` 也在适配器内由 `completion.ts` 的纯函数提取（`aborted` 取 cause kind，`error` 取 code 与清洗后的 message）。`completion.ts` 仍是唯一实现分类与 detail 清洗的模块，适配器只负责取值路径。这一分工保持了不变量一：DSH 深路径知识不出 `runtime-adapter.ts`。
>
> 5. **`logger.ts` 的 `LoggerLike` 是结构化接口，不是 Cordis 导入。** `PluginLogger` 通过 `ctx.logger(name)` 得到的对象在结构上满足该接口，测试则传入记录器。这样日志 seam 不必为四个方法导入 DSH 包，同时保留本文件第 3 节为 `logger.ts` 规定的职责与禁止项。
>
> 6. **`apply()` 的返回值。** 生产路径返回 `undefined`（`index.ts` 不向外暴露服务）；当 `enabled: false` 或配置校验失败时同样返回 `undefined` 且不注册任何资源。集成测试通过第三个 `internals` 参数注入 sink、时钟与等待函数，该参数在生产调用中省略。

> **Implementation note（Phase 8 补记，2026-09）。** 以下为本文件在 v0.2.0（D018）下的增量事实。**第 1–11 节除第 3、4 节明确标注的扩充点外未被改写**；本补记与既有条目冲突时，以本补记为准，并已在正文对应位置就地更新。
>
> 1. **实际模块清单在第 3 节的 15 个模块之外共增加五个。** Phase 3 增加 `src/credentials.ts`（凭据解析 seam）与 `src/transport.ts`（`MailTransport` 接口与 Nodemailer transport 工厂），Phase 6 增加 `src/telemetry.ts`（Turn 级 usage 折叠），Phase 8 增加 `src/human-attention.ts`。加上第 3 节 P3.4 所要求的 `src/debug-sink.ts`，`src/` 现共 20 个模块。`human-attention.ts` 是其中唯一被允许读取 `tool/call.arguments` 的模块，职责为：question 参数白名单解析、approval 载荷清洗，以及两条人工注意力通知的策略判定。
>
> 2. **`Notification` 成为判别联合，`MailJob` 的载体随之改变。** 此前队列条目的载体是 `NotificationCandidate`；现在它是 `Notification = TurnNotification | QuestionNotification | ApprovalNotification`，`kind` 是唯一判别字段。`NotificationCandidate` 本身未变，`schemaVersion` 仍为 `2`——变的是承载它的信封。
>
> 3. **`session/event` 上注册两个监听器。** 第一个维护 Turn 状态，第二个只观察 `approval/asked`。`user-questions/request` 与 `approval/request` 不在注册集合内（D018 第六、八、十一条）。
>
> 4. **`DedupeCache` 的键带命名空间前缀**：`turn:` / `question:` / `approval:`。`keyFor` 的旧键形不再是契约的一部分；去重不持久化，因此该变更无迁移成本（D008、D018 第九条）。
>
> 5. **`CREDENTIAL_REF_PATTERN` 放宽**为同时接受裸名与 DSH 凭据存储的 `<scope>/<id>` 寻址。存储本身仍是「该引用是否可解析」的唯一权威（D010、D018 Consequences）。


---

## 1. 架构目标与三条不变量

正式实现的全部结构由三条不变量决定，任何模块划分都必须满足它们。

**不变量一：DSH 原始 payload 只有一个读取点。** `src/runtime-adapter.ts` 是唯一了解 `Session`、`SessionEvent`、`event.data.*` 深路径与判别联合结构的模块。它之后的所有模块只接触本项目定义的内部 DTO。DSH RC API 变更时，预期影响面为单文件（D001）。

**不变量二：决策核心是纯函数，不接触运行时。** 内容提取、状态分类、抑制判定、候选构造、正文渲染、错误分类全部实现为无副作用、无 I/O、无时间依赖（时间由参数注入）的纯函数。`src/event-handler.ts` 是唯一把纯函数与有状态累积粘合起来的地方，且它自身不做 I/O。

**不变量三：事件监听器路径上不存在 `await`。** `Session.append()` 在同步路径上调用监听器且不等待其返回的 Promise。因此从 `session/event` 到 `queue.enqueue()` 的整条路径必须是同步的，任何耗时操作只能发生在队列 worker 中（D009）。

---

## 2. 数据流

```text
DSH Session + SessionEvent（live 对象 + event.data 深路径）
            │
            │  ctx.on('session/event', (session, event) => …)      ← 同步路径起点
            │  （Turn 监听器 + approval/asked 观察监听器，共两次注册）
            ▼
    runtime-adapter.ts
            │  读 session.header.* / event.data.*
            │  形状检查、判别字段比对、字段可选性处理
            │  产出：InternalEvent（无 DSH 引用）
            ▼
    event-handler.ts
            │  根/子会话判定 → 丢弃 subagent（覆盖全部三个族）
            │  turnStateOf(turn) 懒初始化
            │  按 type 分派累积
            ├──────────────────────────────────────────────┐
            ▼                                              ▼
      turn-state.ts  ──────►  content.ts（text 白名单提取）   human-attention.ts
            │                 telemetry.ts（Turn 级 usage 折叠，D017） │  tool/call 且 name 精确命中
            │                 normalize.ts（lossless JSON）           │  → 白名单解析 question
            │  turn/end 到来                                          │  approval/asked → 清洗 approval
            ▼                                                        │
      completion.ts                                                  │
            │  reason.kind + explicitToolErrorCount → status          │
            │  reason.error → FailureFacts（仅 error，D018）           │
            ▼                                                        │
      NotificationCandidate（schemaVersion 2）                        │
            │                                                        │
            ▼                                                        ▼
      notifier.ts  ──►  Notification（判别联合：turn / question / approval）
            │  抑制规则（无可见文本 / 时长门槛 / 策略开关）
            │  去重标记（三套命名空间，仅在确定要发时写入）
            ▼
        queue.ts（concurrency = 1，上界 queueSize，满则拒绝最新）
            │  后台 worker
            ▼
        mailer.ts ──► 渲染（subject.ts，按 kind 分支）
            │        ──► credentials.resolve()（每次操作重新解析）
            │        ──► nodemailer transport.sendMail()
            ▼
         retry.ts（transient 才重试，指数退避）
            │
            ▼
        结果记录（logger.ts，脱敏后）
```

`subject.ts` 与渲染函数在 `mailer.ts` 之前被调用，从信封生成主题与正文；它们是纯函数，不参与上面主链的状态传递。`human-attention.ts` 的接入点有两处：question 走 `tool/call` 事件（与 Turn 状态无关，命中即同步入队），approval 走 `approval/asked` 审计事件（由第二个监听器进入）。两条支路都不经过 `completion.ts` 与 `decideNotification`，因此 Turn 的状态分类与时长门槛对它们均不适用。

---

## 3. 模块规格

Phase 3 的目录布局固定为（Phase 6 新增 `telemetry.ts`，Phase 8 新增 `human-attention.ts`；`credentials.ts` / `transport.ts` / `debug-sink.ts` 为 Phase 3 的职责拆分模块）：

```text
src/
├─ index.ts
├─ config.ts
├─ types.ts
├─ runtime-adapter.ts
├─ event-handler.ts
├─ turn-state.ts
├─ telemetry.ts
├─ content.ts
├─ completion.ts
├─ human-attention.ts
├─ normalize.ts
├─ notifier.ts
├─ queue.ts
├─ mailer.ts
├─ credentials.ts
├─ transport.ts
├─ retry.ts
├─ subject.ts
├─ debug-sink.ts
└─ logger.ts
```

下表逐模块给出职责、输入、输出与**不允许承担的职责**。

### `index.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | Cordis 插件入口：导出 plugin 对象、声明 `inject`、在 `apply(ctx)` 中按顺序装配并注册所有可释放资源 |
| 输入 | Cordis `ctx`、原始配置对象 |
| 输出 | 注册到当前 Fiber 的监听器、队列、日志器；其 disposer 由 Cordis 管理 |
| 不允许 | 不包含事件分派逻辑、不读 `event.data`、不构造候选、不做配置默认值计算（委托 `config.ts`）、不实现 SMTP |

`apply()` 的装配顺序固定为：解析配置 → 校验配置 → 构造 logger → 构造 queue → 构造 mailer → 构造 handler → `ctx.on('session/event', …)` → `ctx.on('session/disposed', …)` → `ctx.on('session/event', onApprovalEvent)`。

`session/event` 上有**两次注册**（Phase 8，D018）：第一次挂 Turn 状态维护监听器，第二次挂只观察 `approval/asked` 的监听器。二者回答不同的问题——前者对每个事件维护 Turn 状态，后者只处理一种 durable 审计类型——因此拆成两个入口，而不是在第一个入口内分支。拆开的另一个作用是把「观察的是哪个事件」写在注册处：被观察的是 `approval/asked` 审计记录，`approval/request` waterfall 拥有作答权，**不在注册集合内**。第二次注册在结构上比 DSH 声明更窄，因此以类型断言跨越该边界；函数体内不读取结构视图未声明的字段。

### `config.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 配置 schema 声明、默认值填充、字段级校验、交叉校验（`to` 非空、`enabled` 为假时短路） |
| 输入 | 用户配置（来自 `cordis.patch.yml` 的 mount 参数，未经校验） |
| 输出 | `ResolvedConfig`（全部字段已确定，无 `undefined`）或校验失败结果 |
| 不允许 | 不解析凭据 secret、不创建 SMTP 连接、不读环境变量、不写日志 |

配置校验只验证 `smtpPasswordCredential` 是**非空字符串引用名**，不验证该引用是否已配置——后者属于运行时事实，应在发送时通过 `credentials.describe()` 处理（D010）。

### `types.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 全部内部 DTO 与枚举的类型声明：`InternalEvent`、`TurnState`、`NotificationCandidate`、`CandidateStatus`、`TurnEndKind`、`FailureFacts`、`QuestionItem` / `QuestionParseResult` / `QuestionDropReason`、`Notification`（判别联合）、`NotifyDecision`、`SuppressionReason`、`RetryClass`、`MailJob` |
| 输入 | 无（纯类型模块） |
| 输出 | 类型声明 |
| 不允许 | 不含任何运行时代码；不含 DSH 类型导入（DSH 类型的出现位置仅限 `runtime-adapter.ts`，且仅在适配函数签名上） |

### `runtime-adapter.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 唯一的 DSH 边界。把 `(session, event)` 转为 `InternalEvent`；把 `session.header` 转为 `SessionFacts`；实现根/子会话三判据（D003）；把 `approval/asked` 的原始 payload 转为 `ApprovalObservation`；处理字段可选性与未知形状 |
| 输入 | live `Session` 对象、`SessionEvent`（其 `data` 是已 snapshot + deepFreeze 的普通 JSON）、`approval/asked` 的原始 payload |
| 输出 | `InternalEvent` 判别联合：`{ kind: 'turn-start', turn, timeMs }`、`{ kind: 'step-start', turn, step, timeMs }`、`{ kind: 'assistant-message', turn, step, seq?, blocks, messageId?, provider?, model?, usage?, timeMs }`、`{ kind: 'assistant-attempt', turn, step, seq?, usage?, timeMs }`、`{ kind: 'llm-retry', turn, step, seq?, timeMs }`、`{ kind: 'tool-call', turn, step, callId?, name?, rawArguments?, timeMs }`、`{ kind: 'tool-result', turn, step, explicitError, errorName?, errorCode?, timeMs }`、`{ kind: 'user-message', turn?, text, timeMs }`、`{ kind: 'turn-end', turn, turnEndKind, detail?, reasonDetail?, failure?, timeMs }`、`{ kind: 'other', type, turn?, timeMs }`；`SessionFacts = { sessionId, isSubagent, decidedBy, cwd?, agentPreset? }`；`ApprovalObservation = { sessionId, notification }` |
| 不允许 | 不做业务判定、不构造候选、不累积状态、不写日志（返回值由 handler 记录）、不访问网络或文件、不抛异常（未知形状转 `{ kind: 'other' }`） |

适配器的实现约束：

- 所有字段访问都必须经过形状检查（`typeof`、`Array.isArray`、判别字段比对）。运行时数据没有编译期类型保证。
- `event.data.turn` 缺失或非数字时，该事件降级为 `{ kind: 'other' }`，不得用 `0` 或 `NaN` 兜底。
- `tool/result` 的双判据取或在适配器内完成，输出**已折叠为单一布尔** `explicitError`；只有判据命时才附带 `errorName` / `errorCode`（D005）。
- `session.header` 的读取必须容忍字段缺失（`cwd`、`agentPreset`、`parentSession`、`delegationDepth` 均可为 `undefined`）。
- 返回的对象只含标量与自有数组，**不得**包含对 `session`、`event`、`event.data` 的任何引用。
- `assistant/message` 的 usage 取值顺序是 `data.usage` 优先、`data.stream` 中最后一条 `{ type: 'chunk', chunk: { type: 'usage' } }` 记录次之（与 `dsh-token-meter` 一致）；`assistant/attempt` 只从 stream 取。两条路径都不合成、不补齐缺失计数器。
- `seq` 是 settlement 身份：它是 durable 事件的单调序号（实测 `assistant/message`、`assistant/attempt`、`llm/retry`、`step/start`、`tool/call`、`tool/result`、`turn/start`、`turn/end` 全部携带），适配器原样透传，缺失时省略而不补默认值。
- `tool/call` 的 `name` 与 `arguments` 各作一次字符串拷贝即以原样携带（D018 第一条与 A8 补记）：`name` 供 handler 精确比对，`arguments` 作为单个不透明字符串交专用解析器，适配器不解析、不记录、不存储；实测该字段恒为字符串，遇到结构化值即视为无参数。
- `turn/end` 的 `failure` 只在 `reason.kind === 'error'` 时由 `completion.ts` 的 `extractFailureFacts()` 产出，且在此处读取一次（D018 第一条）。恢复的 `llm/retry` 永不进入该分支。
- `approval/asked` 不走 `InternalEvent`：它由独立的 `toApprovalObservation()` 处理，逐字段复制 `toolName` / `callId` / `reason`，请求 id 刻意不进 `ApprovalNotification`（只作去重身份，由 handler 另行读取）。
- `llm/retry-started` 不翻译为可累积事件：它标记的失败调用已在 `llm/retry` 计入，替代它的调用通过自身的 `assistant/message` 或 `assistant/attempt` 结算。

### `event-handler.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 事件分派与状态累积的粘合层：`session/event` 的监听器主体；维护 `Map<sessionId, Map<turn, TurnState>>`；在 `turn/end` 时驱动 completion → notifier → enqueue；在 `tool/call` 命中 `ask_user_question` 时驱动 human-attention 解析 → 策略 → enqueue；在 `approval/asked` 时驱动 approval 观察 → 策略 → enqueue；处理 `session/disposed` |
| 输入 | `InternalEvent`、`SessionFacts`、`ResolvedConfig`、queue 引用、logger 引用、`approval/asked` 的原始 payload |
| 输出 | 状态变更、`queue.enqueue(job)` 调用、结构化日志 |
| 不允许 | 不做 `await`（必须同步返回）、不做 SMTP、不做内容提取（委托 `content.ts`）、不做状态分类（委托 `completion.ts`）、不解析 question 参数（只做一次精确工具名比较后转交 `human-attention.ts`）、不读 `event.data` |

`session/event` 回调的返回类型是 `void`，实现中不得把 handler 写成 `async`。

三个族共用同一条入队函数 `enqueueNotification()`，因此「只在入队被接受时才写入去重标记」这条规则不会在三个族之间漂移：被拒绝的任务不留标记、保持可再次尝试，且拒绝会被计数而不是静默丢弃。

### `human-attention.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 人工注意力通知的唯一解析与策略点：`ask_user_question` 参数的严格白名单解析（`parseAskUserQuestionArguments`）、`approval/asked` 载荷清洗（`toApprovalNotification`）、两条策略判定（`decideQuestionNotification` / `decideApprovalNotification`），以及 `QUESTION_TOOL_NAME` 与全部界限常量 |
| 输入 | 原始 `arguments` 值（期望为模型产生的 JSON 字符串）、`approval/asked` 原始 payload、`ResolvedConfig`、去重命中与否 |
| 输出 | `QuestionParseResult`、`ApprovalNotification`、`AttentionDecision` |
| 不允许 | 不做 I/O、不写日志、不认识 `TurnState`、不读取除白名单字段以外的任何参数、不对源对象做 spread、不保留原始 JSON 字符串或对它的任何引用、不因畸形输入抛异常 |

两条结构性保证不是约定而是构造：解析结果逐字段新建，源值随即丢弃，因此下游无法持有对 `arguments` 的引用；文件中不存在对源对象的 spread，因此白名单未命名的字段即使到达也不会被携带。畸形 JSON 是正常结果，降级为「无可通知内容」并记录原因与计数，不在 session append 路径上抛出。

### `turn-state.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | `TurnState` 的定义与生命周期操作：创建、懒初始化、累积更新、逐 Turn 清理、逐 Session 清理 |
| 输入 | `InternalEvent`、可变状态容器 |
| 输出 | 变更后的 `TurnState` |
| 不允许 | 不做判定（不决定是否通知）、不做 I/O、不访问配置 |

`TurnState` 的字段规格见第 4 节。

### `telemetry.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | Turn 级 token 遥测折叠（D017）：把本 Turn 内每个已确认模型调用的 per-call usage 按 bucket 相加，维护 settlement 身份去重，并给出覆盖范围（`sampleCount` / `missingCount` / `unobservableRetries` / `complete`） |
| 输入 | `SettlementInput`（kind、step、seq?、messageId?、timeMs、原始 usage）、`RetryInput`、step 开启通知 |
| 输出 | `TurnUsageSnapshot`（`usage?`、`sampleCount`、`missingCount`、`unobservableRetries`、`complete`）、`collectUsage()`（原始 per-call 计数器集合） |
| 不允许 | 不推算（不补零、不插值、不从 bucket 推导 bucket、不计算价格）、不参与 completion 判定、不做 I/O、不知道任何 DSH payload 形状（usage 以 `unknown` 进入，逐字段复制） |

折叠的三条实现约束：

- 求和只在同一 bucket 内进行，且使用 safe-integer 检查；越界时**整份聚合被撤回**（而非截断或钳制），并把该次调用计为缺失。
- 可选 bucket 按「报告过的 sample 求和」处理：全部 sample 都未报告时该字段在聚合中省略，而不是写成 `0`。
- 重复计数由两层身份控制：durable `seq`（或 `message.id`）为主，`assistant/message` 每 step 至多一条的实测边界为辅；辅判据只作用于携带可折叠 sample 的 message。单 Turn 的记账规模有上限（`MAX_ACCOUNTED_STEPS` / `MAX_ACCOUNTED_SETTLEMENTS`），越界即令 `complete = false`，不静默截断。

### `content.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 从 content blocks 提取用户可见文本；`truncateVisibleText()` |
| 输入 | blocks 数组（运行时未知形状）、`maxBodyChars` |
| 输出 | 提取后的文本字符串、是否被截断 |
| 不允许 | 不读配置对象、不写日志、不抛异常（未知 block 类型静默跳过）、不按字段名 `text` 泛取 |

本模块是 D002 的唯一实现点。`truncateVisibleText()` 按码点截断，不切断代理对（D014）。

### `completion.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 状态分类：由 `turnEndKind` 与 `explicitToolErrorCount` 计算 `CandidateStatus`；提取 `turnEndDetail` 与 `reasonDetail` |
| 输入 | `turnEndKind`、`explicitToolErrorCount`、适配器给出的 detail |
| 输出 | `CandidateStatus`、detail 字符串 |
| 不允许 | 不读 `usage`（D006）、不做抑制判定（属 `notifier.ts`）、不做 I/O |

分类表见第 5 节。

### `normalize.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | lossless-JSON 归一化：把任意值转为可安全序列化的结构，省略 `undefined` / `NaN` / `Infinity` / 函数 / 非 plain object，并累计被省略路径 |
| 输入 | 任意结构化值 |
| 输出 | 归一化后的值 + `dropped` 路径列表 |
| 不允许 | 不抛异常、不做类型转换（不把字符串数字转为数字）、不静默吞掉异常（省略与吞异常是两件事，见 `PHASE1_RUNTIME_CONTRACT.md`） |

本模块必须在**任何**结构化对象离开插件之前被调用：日志 payload、队列条目、调试出口。这是 Phase 1 实际发生的故障（单个 `undefined` 使整批输出不可读）的直接对策。

### `notifier.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 由 `NotificationCandidate` 与 `ResolvedConfig` 决定 `NotifyDecision`：`{ notify: true, job }` 或 `{ notify: false, reason: SuppressionReason }`；维护去重缓存（D008）；提供三个命名空间的键构造器（D018） |
| 输入 | `NotificationCandidate`、`ResolvedConfig`、去重缓存 |
| 输出 | `NotifyDecision`、`DedupeCache` 的键 |
| 不允许 | 不做 SMTP、不做模板渲染、不 await、不修改候选、不判定 question / approval（属 `human-attention.ts`） |

判定顺序固定（顺序本身是契约，因为它决定日志中出现哪个 `suppressedReason`）：

```text
1. enabled === false                        → suppress("disabled")
2. isSubagent 且 includeSubagents === false → suppress("subagent-excluded")   [在 handler 中提前返回]
3. 状态策略开关（completed / error / max-tokens 三类）→ suppress("disabled-by-policy")
4. visibleText.trim().length === 0          → suppress("no-visible-text")     [status === 'error' 时不适用，D018]
5. durationMs !== null 且 < minTurnDurationMs → suppress("below-min-duration")
6. 去重命中                                  → suppress("duplicate")
7. 否则                                      → notify，并写入去重标记
```

第 3 步中不含配置开关的三种终止方式（`aborted`、`blocked`、`interrupted`）以及防御性的 `unknown` 恒为 `suppress("disabled-by-policy")`。

第 4 步自 D018 起是条件规则：**终局失败通知不要求可见文本**（provider 故障常常不产生任何可见输出，而那正是最需要被告知的一类失败），`completed` 与 `max-tokens` 通知仍然要求。空文本判定用 `trim()` 后的值，而 `visibleTextLength` 仍记原始长度。

第 5 步的时长门槛是 Turn 级规则：question 与 approval 通知不经过本函数，因此永不施加该门槛（D018 第五条）。

#### 三套去重命名空间（D018 第九条）

```text
turn:${sessionId}:${turn}
question:${sessionId}:${callId}       // 无 callId 时回落 question:${sessionId}:t${turn}:s${step}
approval:${sessionId}:${approvalId}
```

命名空间是让三条生命周期互不干扰的机制，而不是命名风格。question 通知在 Turn 仍打开时触发，若复用 `turn:` 键，一次中途提问就会占用该 Turn 的键，使随后的完成或失败通知被判为重复而丢弃；反过来，终局通知在人工回答之后**必须**仍然可通知。同一 Turn 内不同 `callId` 各自可通知，因此一次调用多问两次会得到两封邮件，而同一 call 的重复投递只得到一封。三条规则都不改变缓存自身的保证：它仍是有界、插入序淘汰、不持久化的（D008）。

`human-attention.ts` 的两条策略判定顺序同样是契约，且刻意短于 Turn 的判定：

```text
1. enabled === false            → suppress("disabled")
2. 对应开关为 false              → suppress("disabled-by-policy")   [detail 指明是哪个开关]
3. 去重命中                      → suppress("duplicate")
4. 否则                          → notify，并写入去重标记
```

两条判定都不接受通知本身作为参数：到达该函数的 question 已经过白名单解析，是否值得发送只取决于配置与去重，接受载荷会诱导未来对内容添加条件——本阶段没有任何规则授权这种条件。

### `queue.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 有界 FIFO 队列 + 单并发 worker；`enqueue()` 同步返回布尔值；`dispose()` 停止接收并收敛在途工作 |
| 输入 | `MailJob`、sink 函数（`(job) => Promise<Result>`）、`queueSize` |
| 输出 | `enqueue` 的接受/拒绝结果；worker 的发送结果回调 |
| 不允许 | 不做内容判断、不做去重、不做邮件渲染、不吞掉 sink 的 rejection |

`enqueue()` 必须是同步函数并返回 `boolean`，使调用方（`notifier`/`handler`）能在同一 tick 内记录队列拒绝。队列满时丢弃**最新**条目、自增 `droppedCount` 并写结构化 warning（D009）。

### `mailer.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 由 `MailJob` 渲染并发送：调用 `subject.ts` 与正文渲染 → 解析凭据 → 构造 Nodemailer transport → `sendMail` |
| 输入 | `MailJob`、`ResolvedConfig`、凭据服务句柄（可为 `undefined`）、logger |
| 输出 | `SendResult = { ok: true } | { ok: false, class: RetryClass, category: string, message: string }`（message 已脱敏、已截断） |
| 不允许 | 不读 `TurnState`、不读 DSH 事件、不决定是否重试（由 `queue` + `retry` 决定）、不缓存 secret、不记录凭据对象 |

`mailer` 是唯一创建 SMTP 传输的模块。transport 的创建与凭据解析都在**每次发送操作内部**完成，不在模块级变量中持有（D010）。

### `retry.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 错误分类（`retry` / `permanent`）与退避计算；`withRetry(operation, policy)` |
| 输入 | 抛出的错误对象、当前尝试序号、重试策略参数 |
| 输出 | `RetryClass`、退避毫秒数、最终结果 |
| 不允许 | 不做 I/O、不写日志、不认识 SMTP 之外的概念、不无限重试 |

错误分类表见第 6 节。

### `subject.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 由通知信封生成邮件主题与正文：Turn 主题（含失败码标签）、人工注意力主题（固定的 question / approval 前缀）、元数据块、失败段、question 段、approval 段、footer |
| 输入 | `Notification`（判别联合）、`RenderConfig`、截断标志、被忽略的配置字段 |
| 输出 | `RenderedMail = { subject, text, bodyTextLength }` |
| 不允许 | 不做 SMTP、不读配置以外状态、不做截断（截断属 `content.ts`）、不引入换行（主题必须单行） |

主题长度上限固定为 200 字符，超出时截断并保留状态前缀。任何源自候选的字符串在写入主题前必须移除 `\r` 与 `\n`。

渲染按 `kind` 显式分支，而不是依据「哪些字段有值」反推形态：`turn` 走 `renderTurnMail`，`question` / `approval` 走 `renderAttentionMail`。这条显式分支是「提问绝不能被渲染成模型的最终输出」的实现保证。人工注意力邮件的主题前缀是常量（`[DSH] Input required`、`[DSH] Approval required`），因此没有任何模型提供的字符串能决定一条消息是否读起来像插件发出的指令；approval 的正文明确写出被审批工具的参数未由 DSH 发布、也不在本消息中。

### `logger.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 结构化日志的唯一出口；字段白名单；脱敏；归一化 |
| 输入 | 日志级别、事件名、字段对象 |
| 输出 | 经 `ctx.logger`（或 Cordis 上下文等价接口）输出的结构化记录 |
| 不允许 | 不接收 `visibleText` 全文、不接收 reasoning、不接收 tool arguments/results、不接收凭据或 SMTP auth 对象 |

日志字段白名单与禁止项见 [`SECURITY.md`](SECURITY.md) 第 4 节。

---

## 4. `TurnState` 规格

```ts
interface TurnState {
  turn: number
  sawTurnStart: boolean
  startAt?: number              // epoch ms，仅在观察到 turn/start 时写入
  telemetryComplete: boolean

  lastVisibleAssistantText: string   // 最后一个非空可见文本
  lastAssistantMessageId?: string

  provider?: string
  model?: string
  usage: TurnUsageLedger        // Turn 级 token 折叠；类型见 telemetry.ts（D017）

  steps: number                 // 观察到的不同 step 编号数
  assistantEvents: number
  toolCallCount: number
  toolResultCount: number
  explicitToolErrorCount: number
}
```

创建方式固定为两种，二者共用同一个 `turnStateOf(turn)` 访问器：

| 路径 | 触发 | 结果 |
| --- | --- | --- |
| 正常初始化 | 观察到 `turn/start` | `sawTurnStart = true`、`startAt = event.time`、`telemetryComplete = true` |
| 懒初始化 | 任何其它携带 `turn` 的事件 | `sawTurnStart = false`、`startAt = undefined`、`telemetryComplete = false` |

若懒初始化已创建条目，之后才到达 `turn/start`（理论上不应发生，实现仍须正确），则**就地补写** `sawTurnStart` / `startAt` / `telemetryComplete`，保留已累积计数，不重建条目。

字段更新规则：

| 事件 | 更新 |
| --- | --- |
| `turn/start` | 见上表 |
| `step/start` | `steps` 记入该 step；向 `usage.noteStepStarted(step)` 报告「本 step 将发起一次模型调用」 |
| `assistant/message` | `assistantEvents += 1`；取 `content.ts` 的白名单结果，**仅当结果非空时**覆盖 `lastVisibleAssistantText` 与 `lastAssistantMessageId`；覆盖 `provider` / `model`（当适配器给出时）；以 `(seq, messageId, step)` 为身份，把该次调用的 usage **折叠**进 `usage`（`addSettlement`），不再覆盖 |
| `assistant/attempt` | 以 `seq` 为身份折叠该次调用的 usage；无 usage 时计为一次缺失的应计调用 |
| `llm/retry` | `usage.noteRetry({ step, seq, timeMs })`：记录一次 usage 不可观察的失败调用 |
| `tool/call` | `toolCallCount += 1` |
| `tool/result` | `toolResultCount += 1`；`explicitError === true` 时 `explicitToolErrorCount += 1` |
| 任何带 `step` 的事件 | `steps` 累计不同 step 编号的数量（以集合或「最大值 + 是否存在间隙」的等价方式实现；不得用「最大 step 编号」冒充数量） |
| `turn/end` | 不更新计数，触发结算 |

「仅当结果非空时覆盖」是 Phase 1 已运行时验证的行为：`["reasoning","tool-call"]`（无 text）的消息产生 `visibleTextLength: 0` 且**不污染**既有的 `lastVisibleText`。

`usage` 的累积是 Turn 级的折叠而非赋值（D017）：每个 `assistant/message` 代表一次模型调用，追加而非覆盖。聚合值在候选构造时经 `normalize.ts` 归一化。`steps` 的统计不得依赖事件到达顺序。

---

## 4.1 `NotificationCandidate`（schema v2）

`schemaVersion: 2`。与 v1 的差异全部集中在遥测字段，其余字段的语义与可选性不变（D007、D017）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `usage?` | `TurnUsage` | Turn 级聚合：`inputTokens`、`outputTokens` 必在，`cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens` 仅在至少一个 sample 报告过时出现。无任何可读 sample 时整个字段省略 |
| `usageSampleCount` | `number` | 已折叠的、相互区分的模型调用 usage 报告数 |
| `usageMissingCount` | `number` | 已观察但未给出可用 usage 的应计模型调用数（含未结算的 step） |
| `usageUnobservableRetries` | `number` | 失败且 usage 不可观察的重试调用数 |
| `usageComplete` | `boolean` | 每个应计模型调用都报告了 usage 时为 `true` |

四个覆盖字段都是**必须**字段且恒存在：0 与 `false` 是有效观测（中途装载的 Turn 即 `usageSampleCount: 0` 且 `usageComplete: false`），省略它们会使「未统计」与「统计为零」不可区分。`telemetryComplete` 保持 v1 语义不变，与 `usageComplete` 分属两个断言（D017 第 8 条）。

本候选自 D018 起不再直接作为队列条目的载体，而是包在下一节的判别联合里。

### 4.2 通知信封（D018）

`NotificationCandidate` 描述的是**一个已结算的 Turn**。回合中的人工交互不是已结算的 Turn：`status`、`durationMs`、`usage`、`visibleText` 对它都没有意义。因此队列承载的信封是一个判别联合，而不是把两类事件塞进同一个候选：

```ts
type Notification = TurnNotification | QuestionNotification | ApprovalNotification
// TurnNotification      = { kind: 'turn', candidate: NotificationCandidate }
// QuestionNotification  = { kind: 'question', questions, droppedQuestions, argumentsUnreadable?, ...HumanAttentionPayload }
// ApprovalNotification  = { kind: 'approval', toolName, reason?, ...HumanAttentionPayload }
// HumanAttentionPayload = { sessionId, turn?, step?, callId?, cwd?, observedAt }
```

**question 为什么不是 `NotificationCandidate`。** 三个理由，各自独立成立。其一，类型层面必须保留「该 Turn 是否已结算」这一判据；把 question 表达为候选的字段组合会使该判据只能靠「哪些字段有值」反推，而那种反推正是把提问渲染成最终答案的路径。其二，`candidate` 的必填字段（`status`、`visibleText`、四个 usage 覆盖字段）对回合中事件全是无意义的填充，填充它们等于让每个读者都要先判断这些值是否可信。其三，隐私边界需要一个唯一的声明点：question 的内容来自白名单解析，approval 的内容来自 DSH 审计契约，二者的来源与 Turn 的可见文本都不同，混在一个类型里会让「什么可以外发」不再可核查。

`kind` 是唯一判别字段，因此对它的 `switch` 会穷尽；`MailJob.notification` 的类型随之从候选变为该联合。`truncated` 只描述 turn 变体的可见文本：人工注意力变体恒为 `false`，它们的内容由解析器的界限而非 `maxBodyChars` 约束。

---

## 5. Completion 分类

`completion.ts` 的输入是 `turnEndKind`（6 种已确证取值 + 防御性 `unknown`）与 `explicitToolErrorCount`。

| `turn/end.reason.kind` | `explicitToolErrorCount` | `CandidateStatus` |
| --- | --- | --- |
| `completed` | `0` | `completed-clean` |
| `completed` | `> 0` | `completed-with-tool-errors` |
| `max-tokens` | 任意 | `max-tokens` |
| `error` | 任意 | `error` |
| `aborted` | 任意 | `aborted` |
| `blocked` | 任意 | `blocked` |
| `interrupted` | 任意 | `interrupted` |
| 其它（防御） | 任意 | `unknown` |

detail 提取：

| kind | `turnEndDetail` | `reasonDetail` |
| --- | --- | --- |
| `aborted` | `reason.reason.kind`（`user` / `parent` / `hook` / `disposed` / `legacy`） | 该 kind 的可读描述；`hook` 分支可附其 `reason` 字符串（截断，且视为不可信文本一并清洗） |
| `error` | `reason.error.code` | `reason.error.message`（截断至固定上限，清洗控制字符；该文本来自 provider，不含 SMTP 凭据，但仍按不可信输入处理） |
| 其它 | 省略 | 省略 |

注意 `completed-clean` 的语义边界：它只表示 DSH 未报告显式工具失败，**不表示**所有 shell / pwsh 命令的业务执行均成功（D005）。主题与正文的渲染不得使用「全部成功」之类措辞。

`error` 一行另有结构化补充（D018 第二条）：`completion.ts` 的 `extractFailureFacts()` 从同一个 `reason.error` 对象逐键取出 `code`、`status`、`providerRetryAfterMs`、`message`，产出 `FailureFacts`。**只有 `code` 参与分类**；`message` 仅供人阅读，禁止对 `"429"`、`"quota"`、`"timeout"` 等做字符串匹配。`requestId` 刻意不在该形状内，本阶段不外发。四个字段各自的缺失都记为缺失（`status` / `providerRetryAfterMs` 省略，`message` 缺失时置 `messageMissing`），不写默认值。

---

## 6. 重试与错误分类

`retry.ts` 只做两件事：判定某次失败是否值得重试，以及计算退避时间。默认策略（可配置）：

| 参数 | 默认 | 语义 |
| --- | --- | --- |
| `retryAttempts` | 3 | **重试**次数上限；总尝试次数为 1 + 3 = 4 |
| 退避基数 | 1000 ms | 第 n 次重试前等待 `1000 × 3^(n-1)`，即 1 s / 3 s / 9 s |
| 退避上限 | 30000 ms | 单次等待上限 |

分类表（**只有 `retry` 类会被重试**）：

| 类别 | 判据 | 处理 |
| --- | --- | --- |
| `retry` | `ETIMEDOUT` | 重试 |
| `retry` | `ECONNRESET`、`EPIPE`、`ECONNABORTED` | 重试 |
| `retry` | `EAI_AGAIN`（临时 DNS） | 重试 |
| `retry` | `ESOCKET`、`ETIMEDOUT` 之外的连接阶段瞬时错误 | 重试 |
| `retry` | SMTP `4xx` 瞬时响应（**除下述白名单外**） | 重试 |
| `permanent` | `EAUTH`、`535`、`534`、`530`、`454`（认证失败，含 4xx 中的认证类） | 立即失败 |
| `permanent` | `EENVELOPE`、`550`、`551`、`552`、`553`（无效收件人 / 被拒） | 立即失败 |
| `permanent` | `5xx` 永久策略拒绝 | 立即失败 |
| `permanent` | `ENOTFOUND`（域名不存在）、`ECONNREFUSED` | 立即失败 |
| `permanent` | 凭据未配置（`resolve` 返回 `undefined`） | 立即失败，诊断信息含引用名与 `describe()` 结果 |
| `permanent` | 配置校验失败、渲染失败、候选不完整 | 立即失败 |
| `permanent` | 队列已满导致拒绝 | 不发生（拒绝在入队时即判定，不进入重试） |

分类实现必须以 Nodemailer 错误对象的 `code` / `responseCode` 字段为主判据；无法识别的错误**默认为 `permanent`**（避免对未知原因进行 4 次放大尝试），并在日志中标记 `unknown-error`。

退避必须可被 dispose 中断：等待通过 Cordis `timer` 服务或等价的、随 Fiber 释放的定时器实现，不使用脱离生命周期的裸定时器。

---

## 7. 状态生命周期与释放路径

状态结构固定为：

```text
Map<sessionId, Map<turn, TurnState>>
```

释放规则：

| 触发 | 动作 |
| --- | --- |
| `turn/end` 结算完成（无论是否通知、无论 `NotifyDecision` 为何） | 删除该 `(sessionId, turn)` 条目；该 session 的内层 Map 变空时一并删除 |
| `session/disposed(session)` | 删除该 sessionId 的整个内层 Map |
| 插件 dispose（Fiber 释放） | 清空外层 Map、去重缓存；停止队列接收；结算在途发送；释放全部定时器与监听器 |

三条约束：

1. **不得无限保存历史 Session。** 外层 Map 的键集合必须在会话卸载后收缩，不能只增不减。
2. **subagent 不产生状态条目。** `includeSubagents: false` 时，subagent 的事件在 `TurnState` 创建之前返回，因此不会为不通知的会话维护任何状态（D003）。
3. **结算后必须清理，包括抑制情形。** 一次 `turn/end` 无论产出通知、被抑制，还是因 `enabled: false` 短路，都必须删除对应条目；否则被抑制的 Turn 会永久驻留。

`session/disposed` 的触发条件已由 Inspect 确证：会话离开 store 时发出一次（含 publication rollback），且监听器失败被记录并隔离。DSH 进程存活期内会话通常不卸载，因此该路径在实践中可能长期不被触发——这**不**降低其必要性，因为它是唯一能覆盖异常卸载路径的释放信号，而规则 1、3 已在常态路径上限制了增长。

---

## 8. 并发与错误传播

| 关注点 | 约定 |
| --- | --- |
| 监听器线程 | `session/event` 回调同步执行；不得 `async`、不得 `await` |
| 队列 worker | 单并发；worker 的 Promise 必须被捕获，不得产生 unhandled rejection |
| 凭据解析 | 每次发送操作内 `await`，结果仅在本次操作作用域内存在 |
| 重试等待 | 可被 dispose 中断 |
| 发送失败 | 不向 `session/event` 路径抛出；失败只写入日志与计数 |
| 适配器异常 | 适配器不抛异常；未知形状降级为 `{ kind: 'other' }` |
| handler 异常 | Cordis 会按单监听器容器捕获并记录，但插件自身应保证不抛出，避免依赖容器的容错 |
| 渲染异常 | 视为 `permanent` 失败，记录后丢弃该任务，不重试 |

「失败不能使 DSH Agent Loop 崩溃」是硬要求（`00_MASTER.md` §7）。实现上通过三层保证：监听器同步且不含 I/O、后台 Promise 全部带 `catch`、适配器不抛异常。

---

## 9. 可观测性

正式插件需要独立于 Phase 1 探针工具的观测路径（Phase 1 风险 9：探针仅在原型运行期存在）。

| 出口 | 内容 | 约束 |
| --- | --- | --- |
| 结构化日志 | 事件生命周期、抑制原因、队列状态、重试次数、错误分类、遥测覆盖范围 | 字段白名单，见 `SECURITY.md` |
| 计数器 | `candidatesProduced`、`notificationsSent`、`notificationsSuppressed`（按 reason 分组）、`queueDropped`、`sendFailures`（按 class 分组）、`questionCallsObserved`、`approvalAsksObserved`、`attentionUnparsable` | 只增不减的整数，随插件生命期存在 |
| 调试出口（可选） | 归一化后的候选记录 | 仅在显式开启时输出；输出前必须经 `normalize.ts` |

`candidate.produced` 一行的字段集（Phase 6 扩充，D017）：`schemaVersion`、`sessionId`、`turn`、`status`、`turnEndKind`、`visibleTextLength`、`explicitToolErrorCount`、`telemetryComplete`、`durationMs`、`provider`、`model`、`sawTurnStart`、`usageSampleCount`、`usageMissingCount`、`usageUnobservableRetries`、`usageComplete`、`steps`、`normalizeDropped`。

新增的五项都是标量计数与布尔值：它们描述**统计的形状**，而计数器本身仍只进入邮件正文，不进入日志（`SECURITY.md` §4）。把「统计了 3 次调用、覆盖完整」写进日志，使「邮件里的数字为何偏小」可以在不读取邮件正文的前提下被诊断。

调试出口的设计动机来自 Phase 1 的实际故障：当时唯一的证据通道（探针工具）因单个不可序列化字段而整体失效。因此调试输出必须逐条归一化、逐条输出，一条坏记录不得影响其余记录的读取。

日志与计数器都不得包含 `visibleText` 全文、reasoning、tool arguments/results 或任何凭据（D012）。

人工注意力路径的日志字段同样受此约束：`question.unparsable` 只携带 `dropReason` 与 `argumentsReadable`，`approval.unusable` 只携带 `sessionId`，`notification.enqueued` / `notification.suppressed` 只携带 notificationKind、turn、step、questionCount 之类的标量。question 的文本与 approval 的 reason **不进入日志**——它们只进入邮件正文。这与「正文已对收件人可见，因此写进日志不增加信息、只扩大暴露面」是同一条理由（`SECURITY.md` 第 4 节）。

---

## 10. 与 DSH 的接口面

本插件对 DSH 的全部依赖如下，除此之外不引入任何 DSH 接口。

| 接口 | 用途 | 获取方式 | 取证 |
| --- | --- | --- | --- |
| `session/event` 事件 | 唯一的事件观察入口（注册两次：Turn 状态维护 + `approval/asked` 观察） | `ctx.on('session/event', (session, event) => …)` | Inspect + Runtime |
| `session/disposed` 事件 | 状态释放信号 | `ctx.on('session/disposed', (session) => …)` | Inspect |
| `credentials.resolve(ref)` | 每次发送操作解析 SMTP 密码 | `ctx.get('credentials')` + `undefined` 检查 | Inspect |
| `credentials.describe(ref)` | 构造不含 secret 的诊断信息 | 同上 | Inspect |
| `timer` | 可随 Fiber 释放的退避等待 | `ctx.get('timer')` + `undefined` 检查 | Inspect |
| `ctx.effect` | 注册需随 Fiber 释放的资源 | `ctx.effect(callback, label?)` | Inspect |
| 日志接口 | 结构化日志输出 | Cordis 上下文 logger（等价物；`console` 仅作 `apply` 早期阶段的兜底） | Inspect（Builtin 目录） |

明确**不**使用：`sessions` Service（根级监听器已全局接收事件，无需反查 live Session）、任何 DSH Slot / Client 侧接口（本插件为 Host-only，无 UI 需求）、任何修改 DSH 核心配置的路径。

`session/event` 上被识别的 `event.type` 共十种：`turn/start`、`step/start`、`assistant/message`、`assistant/attempt`、`llm/retry`、`tool/call`、`tool/result`、`user/message`、`turn/end`，以及显式忽略但仍被适配器识别的 `llm/retry-started`。全部事件类型的实际支持矩阵与取证见 [`DSH_INTEGRATION.md`](DSH_INTEGRATION.md) 第 2 节。

`approval/asked` 同样经 `session/event` 投递，但不经过上面这张适配器表（D018 第八条）：它由第二个监听器直接观察，并由 `runtime-adapter.ts` 的 `toApprovalObservation()` 转为安全标量。它是一次性的 durable 审计事件，不带 turn 上下文，这决定了它的触发点只能落在审计事件本身，而不能落在 `approval/request` 上。

**本插件为 Host-only。** 不存在 Client half，不注册 Slot，不依赖浏览器环境。

---

## 11. 明确非目标

以下内容不属于本项目范围，Phase 3 不得实现；末两项由 Phase 8 复核（D018 Consequences），其结论是维持非目标：

- 邮件附件（任何形式的正文外附件，含超长正文转附件）。
- HTML 邮件模板系统或主题定制引擎。
- 反向通道（从邮件回复影响 Harness 行为）。
- 多收件人分组、按 Turn 类型路由到不同收件人。
- 去重状态的跨进程持久化。
- 基于 shell 输出文本的执行问题检测（保留 `executionIssueCount` 概念，不实现算法）。
- 基于 `usage` 的成本统计或配额告警。
- Client / 浏览器 UI。
- 对 DSH 核心源码的任何修改。
- 邮件内作答、action link、一键批准与远程回调：人工注意力通知是只读观察，不参与 answer ownership chain。
- 任何含 DSH Web token 的深链接：`?token=…`、auth token 与会话 secret 一律不得进入邮件；插件不构造 Web 链接，也不读取 token。
