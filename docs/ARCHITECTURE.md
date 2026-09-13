# ARCHITECTURE — dsh-mail-notify

本文件冻结 Phase 3 正式 TypeScript 实现的架构、模块边界与运行期契约。所有结构性决策的依据见 [`DECISIONS.md`](DECISIONS.md)；配置面的完整定义见 [`CONFIG_SPEC.md`](CONFIG_SPEC.md)。

本文件描述的是**待实现**的设计，不是已存在的代码。当前仓库没有任何 `src/` 目录。

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
            ▼
    runtime-adapter.ts
            │  读 session.header.* / event.data.*
            │  形状检查、判别字段比对、字段可选性处理
            │  产出：InternalEvent（无 DSH 引用）
            ▼
    event-handler.ts
            │  根/子会话判定 → 丢弃 subagent
            │  turnStateOf(turn) 懒初始化
            │  按 type 分派累积
            ▼
      turn-state.ts  ──────►  content.ts（text 白名单提取）
            │                 normalize.ts（lossless JSON）
            │  turn/end 到来
            ▼
      completion.ts
            │  reason.kind + explicitToolErrorCount → status
            ▼
      NotificationCandidate（schemaVersion 1）
            │
            ▼
      notifier.ts
            │  抑制规则（无可见文本 / 时长门槛 / 策略开关）
            │  去重标记（仅在确定要发时写入）
            ▼
        queue.ts（concurrency = 1，上界 queueSize，满则拒绝最新）
            │  后台 worker
            ▼
        mailer.ts ──► credentials.resolve()（每次操作重新解析）
            │        ──► nodemailer transport.sendMail()
            ▼
         retry.ts（transient 才重试，指数退避）
            │
            ▼
        结果记录（logger.ts，脱敏后）
```

`subject.ts` 与渲染函数在 `mailer.ts` 之前被调用，从候选生成主题与正文；它们是纯函数，不参与上面主链的状态传递。

---

## 3. 模块规格

Phase 3 的目录布局固定为：

```text
src/
├─ index.ts
├─ config.ts
├─ types.ts
├─ runtime-adapter.ts
├─ event-handler.ts
├─ turn-state.ts
├─ content.ts
├─ completion.ts
├─ normalize.ts
├─ notifier.ts
├─ queue.ts
├─ mailer.ts
├─ retry.ts
├─ subject.ts
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

`apply()` 的装配顺序固定为：解析配置 → 校验配置 → 构造 logger → 构造 queue → 构造 mailer → 构造 handler → `ctx.on('session/event', …)` → `ctx.on('session/disposed', …)`。

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
| 职责 | 全部内部 DTO 与枚举的类型声明：`InternalEvent`、`TurnState`、`NotificationCandidate`、`CandidateStatus`、`TurnEndKind`、`NotifyDecision`、`SuppressionReason`、`RetryClass`、`MailJob` |
| 输入 | 无（纯类型模块） |
| 输出 | 类型声明 |
| 不允许 | 不含任何运行时代码；不含 DSH 类型导入（DSH 类型的出现位置仅限 `runtime-adapter.ts`，且仅在适配函数签名上） |

### `runtime-adapter.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 唯一的 DSH 边界。把 `(session, event)` 转为 `InternalEvent`；把 `session.header` 转为 `SessionFacts`；实现根/子会话三判据（D003）；处理字段可选性与未知形状 |
| 输入 | live `Session` 对象、`SessionEvent`（其 `data` 是已 snapshot + deepFreeze 的普通 JSON） |
| 输出 | `InternalEvent` 判别联合：`{ kind: 'turn-start', turn, timeMs }`、`{ kind: 'assistant-message', turn, step, blocks, messageId?, provider?, model?, usage?, timeMs }`、`{ kind: 'tool-result', turn, step, explicitError, errorName?, errorCode?, timeMs }`、`{ kind: 'turn-end', turn, turnEndKind, detail?, timeMs }`、`{ kind: 'other', type, turn?, timeMs }`；以及 `SessionFacts = { sessionId, isSubagent, decidedBy, cwd?, agentPreset? }` |
| 不允许 | 不做业务判定、不构造候选、不累积状态、不写日志（返回值由 handler 记录）、不访问网络或文件、不抛异常（未知形状转 `{ kind: 'other' }`） |

适配器的实现约束：

- 所有字段访问都必须经过形状检查（`typeof`、`Array.isArray`、判别字段比对）。运行时数据没有编译期类型保证。
- `event.data.turn` 缺失或非数字时，该事件降级为 `{ kind: 'other' }`，不得用 `0` 或 `NaN` 兜底。
- `tool/result` 的双判据取或在适配器内完成，输出**已折叠为单一布尔** `explicitError`；只有判据命中时才附带 `errorName` / `errorCode`（D005）。
- `session.header` 的读取必须容忍字段缺失（`cwd`、`agentPreset`、`parentSession`、`delegationDepth` 均可为 `undefined`）。
- 返回的对象只含标量与自有数组，**不得**包含对 `session`、`event`、`event.data` 的任何引用。

### `event-handler.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | 事件分派与状态累积的粘合层：`session/event` 的监听器主体；维护 `Map<sessionId, Map<turn, TurnState>>`；在 `turn/end` 时驱动 completion → notifier → enqueue；处理 `session/disposed` |
| 输入 | `InternalEvent`、`SessionFacts`、`ResolvedConfig`、queue 引用、logger 引用 |
| 输出 | 状态变更、`queue.enqueue(job)` 调用、结构化日志 |
| 不允许 | 不做 `await`（必须同步返回）、不做 SMTP、不做内容提取（委托 `content.ts`）、不做状态分类（委托 `completion.ts`）、不读 `event.data` |

`session/event` 回调的返回类型是 `void`，实现中不得把 handler 写成 `async`。

### `turn-state.ts`

| 项 | 内容 |
| --- | --- |
| 职责 | `TurnState` 的定义与生命周期操作：创建、懒初始化、累积更新、逐 Turn 清理、逐 Session 清理 |
| 输入 | `InternalEvent`、可变状态容器 |
| 输出 | 变更后的 `TurnState` |
| 不允许 | 不做判定（不决定是否通知）、不做 I/O、不访问配置 |

`TurnState` 的字段规格见第 4 节。

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
| 职责 | 由 `NotificationCandidate` 与 `ResolvedConfig` 决定 `NotifyDecision`：`{ notify: true, job }` 或 `{ notify: false, reason: SuppressionReason }`；维护去重缓存（D008） |
| 输入 | `NotificationCandidate`、`ResolvedConfig`、去重缓存 |
| 输出 | `NotifyDecision` |
| 不允许 | 不做 SMTP、不做模板渲染、不 await、不修改候选 |

判定顺序固定（顺序本身是契约，因为它决定日志中出现哪个 `suppressedReason`）：

```text
1. enabled === false                        → suppress("disabled")
2. isSubagent 且 includeSubagents === false → suppress("subagent-excluded")   [在 handler 中提前返回]
3. 状态策略开关（completed / error / max-tokens 三类）→ suppress("disabled-by-policy")
4. visibleText.trim().length === 0          → suppress("no-visible-text")
5. durationMs !== null 且 < minTurnDurationMs → suppress("below-min-duration")
6. 去重命中                                  → suppress("duplicate")
7. 否则                                      → notify，并写入去重标记
```

第 3 步中不含配置开关的三种终止方式（`aborted`、`blocked`、`interrupted`）以及防御性的 `unknown` 恒为 `suppress("disabled-by-policy")`。

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
| 职责 | 由 `NotificationCandidate` 生成邮件主题，并生成正文的元数据头部 |
| 输入 | `NotificationCandidate`、`ResolvedConfig` |
| 输出 | `{ subject: string, header: string }` |
| 不允许 | 不做 SMTP、不读配置以外状态、不做截断（截断属 `content.ts`）、不引入换行（主题必须单行） |

主题长度上限固定为 200 字符，超出时截断并保留状态前缀。任何源自候选的字符串在写入主题前必须移除 `\r` 与 `\n`。

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
  usage?: RawUsage

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
| `assistant/message` | `assistantEvents += 1`；取 `content.ts` 的白名单结果，**仅当结果非空时**覆盖 `lastVisibleAssistantText` 与 `lastAssistantMessageId`；覆盖 `provider` / `model`（当适配器给出时）；覆盖 `usage`（当适配器给出时） |
| `tool/call` | `toolCallCount += 1` |
| `tool/result` | `toolResultCount += 1`；`explicitError === true` 时 `explicitToolErrorCount += 1` |
| 任何带 `step` 的事件 | `steps` 累计不同 step 编号的数量（以集合或「最大值 + 是否存在间隙」的等价方式实现；不得用「最大 step 编号」冒充数量） |
| `turn/end` | 不更新计数，触发结算 |

「仅当结果非空时覆盖」是 Phase 1 已运行时验证的行为：`["reasoning","tool-call"]`（无 text）的消息产生 `visibleTextLength: 0` 且**不污染**既有的 `lastVisibleText`。

`usage` 在 `TurnState` 中保存原始观测值，仅在候选构造时经 `normalize.ts` 归一化。`steps` 的统计不得依赖事件到达顺序。

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
| 结构化日志 | 事件生命周期、抑制原因、队列状态、重试次数、错误分类 | 字段白名单，见 `SECURITY.md` |
| 计数器 | `candidatesProduced`、`notificationsSent`、`notificationsSuppressed`（按 reason 分组）、`queueDropped`、`sendFailures`（按 class 分组） | 只增不减的整数，随插件生命期存在 |
| 调试出口（可选） | 归一化后的候选记录 | 仅在显式开启时输出；输出前必须经 `normalize.ts` |

调试出口的设计动机来自 Phase 1 的实际故障：当时唯一的证据通道（探针工具）因单个不可序列化字段而整体失效。因此调试输出必须逐条归一化、逐条输出，一条坏记录不得影响其余记录的读取。

日志与计数器都不得包含 `visibleText` 全文、reasoning、tool arguments/results 或任何凭据（D012）。

---

## 10. 与 DSH 的接口面

本插件对 DSH 的全部依赖如下，除此之外不引入任何 DSH 接口。

| 接口 | 用途 | 获取方式 | 取证 |
| --- | --- | --- | --- |
| `session/event` 事件 | 唯一的事件观察入口 | `ctx.on('session/event', (session, event) => …)` | Inspect + Runtime |
| `session/disposed` 事件 | 状态释放信号 | `ctx.on('session/disposed', (session) => …)` | Inspect |
| `credentials.resolve(ref)` | 每次发送操作解析 SMTP 密码 | `ctx.get('credentials')` + `undefined` 检查 | Inspect |
| `credentials.describe(ref)` | 构造不含 secret 的诊断信息 | 同上 | Inspect |
| `timer` | 可随 Fiber 释放的退避等待 | `ctx.get('timer')` + `undefined` 检查 | Inspect |
| `ctx.effect` | 注册需随 Fiber 释放的资源 | `ctx.effect(callback, label?)` | Inspect |
| 日志接口 | 结构化日志输出 | Cordis 上下文 logger（等价物；`console` 仅作 `apply` 早期阶段的兜底） | Inspect（Builtin 目录） |

明确**不**使用：`sessions` Service（根级监听器已全局接收事件，无需反查 live Session）、任何 DSH Slot / Client 侧接口（本插件为 Host-only，无 UI 需求）、任何修改 DSH 核心配置的路径。

**本插件为 Host-only。** 不存在 Client half，不注册 Slot，不依赖浏览器环境。

---

## 11. 明确非目标

以下内容不属于本项目范围，Phase 3 不得实现：

- 邮件附件（任何形式的正文外附件，含超长正文转附件）。
- HTML 邮件模板系统或主题定制引擎。
- 反向通道（从邮件回复影响 Harness 行为）。
- 多收件人分组、按 Turn 类型路由到不同收件人。
- 去重状态的跨进程持久化。
- 基于 shell 输出文本的执行问题检测（保留 `executionIssueCount` 概念，不实现算法）。
- 基于 `usage` 的成本统计或配额告警。
- Client / 浏览器 UI。
- 对 DSH 核心源码的任何修改。
