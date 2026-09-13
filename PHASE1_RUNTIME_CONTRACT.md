# DSH Runtime Contract

Phase 1 运行时接口契约。本文档只记录经 Inspect 或运行时取证确认的事实；未确认项明确标注。

取证方式：

- **Inspect**：`cordis_inspect_list` → `cordis_inspect_query`（host / Service.listService、Event.listEvents、Builtin.listBuiltins）。
- **Source**：`C:\Users\20659\node_modules\@deepseek-ai\...` 中 DSH 自身分发的类型声明与实现。
- **Runtime**：动态原型 `mailnt-1` 在真实会话中捕获到的 `SessionEvent`。

---

## Environment

| 项目 | 值 | 来源 |
| --- | --- | --- |
| DSH version | `0.1.5-rc.1` | `@deepseek-ai/dsh/package.json` |
| 关键包版本 | `dsh-session` / `dsh-llm` / `dsh-agent-loop` / `dsh-tools` / `dsh-scope` / `dsh-tool-cordis` = `0.1.5-rc.1` | 各包 `package.json` |
| Node version | `v24.13.0` | `node -v` |
| 运行模式 | `dsh web --no-open`（PID 14092），profile = `web` | `Win32_Process.CommandLine` |
| Agent preset | `standard`（观察到的会话 `agentPreset` 字段值） | Runtime |
| 文件策略 | `danger-full-access`；本会话 approval prompts 已禁用 | 运行时上下文 |

Session 事件日志使用什么序号并不重要，但有一点关键：`Session.append()` 对 `event.data` 先做 `snapshotJsonValue` 再 `deepFreeze`，因此投递给监听器的 `event.data` **始终是普通 JSON 数据**，不是 live 对象。这一点决定了监听器里可以直接读字段、也可以直接 `JSON.stringify(event.data)`。

---

## Services

| Service | 访问方式 | 本项目用途 | 状态 |
| --- | --- | --- | --- |
| `sessions` | `ctx.get('sessions')` 或 `inject: ['sessions']` | 按 id 反查 live `Session`（Phase 2 备用；Phase 1 未使用） | Inspect |
| `credentials` | `ctx.get('credentials')` / `inject: ['credentials']` | Phase 2 解析 SMTP 密码 | Inspect，Phase 1 未使用 |
| `timer` | `inject: ['timer']` | Phase 2 重试退避 | Inspect，Phase 1 未使用 |

Phase 1 原型**没有**使用任何 Service：全部能力来自 `ctx.on('session/event', ...)`。

### credentials（Phase 2 关键约束）

```
resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
  ResolvedCredential = { value: string; source: string }
describe(ref: CredentialRef): Promise<CredentialInfo>
  CredentialInfo = { configured: boolean; source?: string; writable: boolean }
```

服务文档明确规定：解析是**每次调用**进行的，调用方必须在每次操作时重新 resolve，不得跨操作缓存。这与总设计文档 §6「在每一次发送操作开始时通过 Credential service 解析 secret，不得缓存 password」完全一致，实现时按此执行。

`CredentialRef` 是 `Branded<'CredentialRef'>`（即 string 品牌类型）。凭据引用可分层解析自：进程环境变量、provider 管理的存储、`.env` 文件。**空存储值在全部来源中视为不存在**，因此空字符串不会被误判为已配置。

---

## Session

`Session` 是普通 class（不是 Service），由 `ctx.sessions.create()` 创建。

### 字段（Source：`dsh-session` 类型声明）

```ts
class Session {
  get id(): SessionId                    // Branded<'SessionId'>，字符串品牌类型
  readonly header: SessionHeader
  get seq(): SessionLogOffset
  get surface(): SessionSurface
  readonly inheritedEventCount: SessionLogOffset
  readonly firstLiveSeq: SessionLogOffset
  eventAt(seq): SessionEvent | undefined
  snapshotEvents(fromSeq?, toSeqExclusive?): readonly SessionEvent[]
  ownEvents(): readonly SessionEvent[]
  deriveMessages(): Message[]
}
```

- **Session ID 字段**：`session.id`（`String(session.id)` 可用；`id` 是字符串品牌类型，实测形如 `session-3f0c2938-3769-471e-b2bf-12badadde842`）。
  **注意**：不得按 id 格式判断是否为 subagent。运行时会话 id 与 subagent 会话 id 前缀相同（都由 `session-<uuid>` 形式生成），格式不含层级语义。
- **`session.header` 是 `SessionHeader`**，运行时实测可读（取证：原型读到 `cwd = E:\Projects\DSHarness\dsh-mail-notify`、`agentPreset = standard`）。

### SessionHeader 结构

```ts
interface SessionHeader {
  readonly version: typeof SESSION_FORMAT_VERSION
  readonly id: SessionId
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: SessionId
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly agentPreset?: string
}
```

### Subagent 判定

总设计文档假设的 `session.header.origin === "subagent"` **在当前运行时确实存在**，字段名与取值完全一致，且与另外两个字段互为冗余：

| 判据 | 字段路径 | 类型 |
| --- | --- | --- |
| 主判据 | `session.header.origin === 'subagent'` | `'subagent' | undefined` |
| 冗余判据 1 | `session.header.parentSession !== undefined` | `SessionId | undefined` |
| 冗余判据 2 | `session.header.delegationDepth > 0` | `number | undefined` |

判定优先级（原型实现）：`origin === 'subagent'` → `parentSession !== undefined` → `delegationDepth > 0`；命中任一即为 subagent，记录命中的具体判据以便审计。

#### 判定写法上的硬性约束（运行时已验证的误判风险）

**`delegationDepth: 0` 是合法根 Session 取值。** 运行时观察到 `session-280861aa-7048-49b0-b8a1-dfb85a4c64f6` 这一并行顶层会话同时满足：

```text
origin: null
parentSession: null
delegationDepth: 0        ← 存在且为 0，不是 undefined
```

该会话是正常根会话（`cwd = E:\Projects\Pi\ETS2Nav`），**不是** subagent。因此以下两种写法都会把它误判为 subagent，禁止使用：

```js
if (session.header.delegationDepth) { /* 错误：0 为假值，看似安全，但 */ }
if ('delegationDepth' in session.header) { /* 错误：键存在即命中，必然误判 */ }
if (session.header.delegationDepth !== undefined) { /* 错误：同上 */ }
```

正确写法只有一种比较形式：

```js
if (typeof session.header.delegationDepth === 'number' && session.header.delegationDepth > 0) { /* subagent */ }
```

首选判据仍是 `session.header.origin === 'subagent'`：该字段在 3 个 subagent 会话上全部命中、在 2 个根会话上全部缺省（`undefined`），且在会话创建时由 `SessionStore` 从 `meta` 写入并成为不可变 header。`parentSession` 与 `delegationDepth` 仅作为冗余判据，用于覆盖 `origin` 未设置的历史或外部创建路径。

`SessionStore.create()` 的 `meta` 参数接受 `origin` / `parentSession` / `delegationDepth`，即这三个字段在会话创建时写入并成为不可变 header；`sessions.create` 同时校验 `cwd` 必须为绝对路径、元数据必须是 plain lossless-JSON。这从构造侧支持了上述判定的可靠性。

---

## Events

### 关键结构性发现

`turn/start`、`turn/end`、`assistant/message`、`tool/result` **不是**顶层 Cordis 事件。它们是 `SessionEvent` 联合类型的成员，通过**唯一一个**顶层 Cordis 事件 `session/event` 投递。

```
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
```

回调签名确认为 **`(session, event)`** 两个参数，与总设计文档的假设一致。`SessionEvent` 形状：

```ts
{
  type: SessionEventType       // 'turn/start' | 'turn/end' | 'assistant/message' | 'tool/result' | ...
  seq: SessionSeq
  time: number                 // 事件时间戳，Date.now() 域
  data: SessionEventMap[type]  // 按 type 区分的 payload
  ignorable?: true
  surfaceOp?: ...              // 仅 surface 事件
}
```

因此 payload 的真实路径一律是 **`event.data.<字段>`**，turn/step 编号在 `event.data.turn` / `event.data.step`。

### 投递模式

| 属性 | 值 | 来源 |
| --- | --- | --- |
| mode | `emit`（fire-and-forget） | Event.listEvents |
| 同步性 | 同步派发；`Session.append()` 先解析监听器快照，再 push 日志，再调用回调 | Source `dsh-session/lib/types/index.js:585-594` |
| Promise 是否被等待 | **否**。`invokeContainedSessionObservers` 用 `void Promise.resolve(returned).catch(...)`，返回的 Promise 只被记录警告，调用方不 await | Source 同上 `:314-326` |
| 监听器抛异常 | **被单监听器容器捕获**：每个 callback 独立 try/catch，抛错只写 `ctx.logger.warn`，不会让 append 失败、也不会影响其他监听器 | Source 同上 |
| 监听器自动释放 | **是**。使用 `ctx.on()` 注册，随 Fiber dispose 自动注销 | Builtin 签名 + Cordis 语义 |

结论：`session/event` 是理想的通知观察通道——同步、隔离、异常不致 Agent Loop 崩溃，但**监听器内不得做长时 I/O**，因为它在 append 的同步路径上。

### Scope 过滤语义（决定能否做全局观察）

`session/event` 是**按 scope 过滤**的事件，路由键是 session 本身（`scoped-events.generated` 中注册的 resolver 为 `null`，只做 carrier 存在性校验）。过滤器实现在 `dsh-scope/lib/index.js:327-338`：

```js
carrier = { [Context.filter](ctx) {
  if (baseFilter !== undefined && !baseFilter.call(base, ctx)) return false
  const tag = scopeOf(ctx)
  if (tag === undefined) return true          // ← 未打 scope 标签的监听器：全局接收
  for (cursor = key; cursor; cursor = scopeParents.get(cursor))
    if (cursor === tag) return true
  return false
}}
```

即：**未打 scope 标签的（应用根级）监听器接收全部会话的事件**；打了标签的监听器只接收自己 scope 链上的会话事件（事件沿 scope 链向上流动，不向下）。

运行时证实：动态 Host 原型在根级 `ctx.on('session/event', ...)` 注册后，捕获到真实会话 `session-3f0c2938-...` 的事件，**因此 Phase 2 插件无需 inject 任何 Service 即可全局观察**。

### 事件清单

| 事件 | 类型 | Payload | 本项目使用字段 |
| --- | --- | --- | --- |
| Turn Start | `event.type === 'turn/start'` | `{ turn: number }` | `event.data.turn`、`event.time` |
| Assistant Message | `event.type === 'assistant/message'` | 见下 | `event.data.turn` / `.step` / `.message` / `.usage` / `.interrupted` |
| Tool Result | `event.type === 'tool/result'` | 见下 | `event.data.turn` / `.error` / `.message.content[].isError` |
| Turn End | `event.type === 'turn/end'` | `{ turn: number, reason: TurnEndReason }` | `event.data.turn`、`event.data.reason.kind`、`event.time` |
| Session Dispose | 顶层 `session/disposed(session)` | `(this: Scoped<Session>, session: Session)` | `session.id`（用于释放 `Map<sessionId, turnState>`） |

完整 `SessionEventMap`（Source: `dsh-session`）：

```ts
'turn/start':        { turn: number }
'turn/end':          { turn: number; reason: TurnEndReason }
'step/start':        { turn: number; step: number }
'step/end':          { turn: number; step: number }
'user/message':      UserMessage
'system/message':    { turn: number; step: number; message: SystemMessage }
'assistant/message': { turn: number; step: number; message: AssistantMessage;
                       stream: AssistantStreamRecord[]; usage?: TokenUsage; interrupted?: true }
'assistant/attempt': { turn: number; step: number; stream: AssistantStreamRecord[] }
'tool/call':         { turn: number; step: number; callId: ToolCallId; name: string; arguments: string }
'tool/result':       { turn: number; step: number; message: ToolResultMessage;
                       error?: { name: string; code: string }; meta?: JsonValue }
'request/header':    { header: EpochHeader; reason: RequestHeaderReason; startsSeries?: true }
'request/context':   RequestContext
'session/end-seed':  { inherited?: true }
```

### 对总设计文档的重要修正

总设计文档 §2 / §11 把 `assistant/message`、`tool/result`、`turn/start`、`turn/end` 当作四个独立顶层事件来「监听」。**当前运行时不支持这种写法**：必须监听 `session/event` 一个事件，再按 `event.type` 分派。这是 Phase 2 实现方式上的硬性差异，不是可选风格。

---

## Assistant Content

### 真实 ContentBlock 类型（当前版本）

```ts
interface ContentBlockMap {
  'text':        { type: 'text';        text: string }
  'reasoning':   { type: 'reasoning';   text: string }
  'image':       { type: 'image';       attachment: ImageAttachmentRef }
  'file':        { type: 'file';        attachment: FileAttachmentRef }
  'tool-call':   { type: 'tool-call';   id: ToolCallId; name: string; arguments: string }
  'tool-result': { type: 'tool-result'; toolCallId: ToolCallId; content: ContentBlock[]; isError?: boolean }
}
```

`reasoning` 与 `text` 是**两个不同类型的 block，各自带 `text` 字段**——这正是隐私边界所在：只读 `block.type === 'text'` 的 `block.text`，绝不按字段名 `text` 泛取。

`ContentBlockMap` 被声明为 **merge-extensible**（插件可向 `ContentBlockMap` 追加新 block 类型），因此未来出现未知 `type` 是设计允许的正常事件，不是异常。提取函数必须以白名单方式工作，未知类型安全跳过。

### 邮件正文准入判定

| block type | 是否进入通知正文 | 理由 |
| --- | --- | --- |
| `text` | **允许** | 唯一代表用户可见普通文本的 block |
| `reasoning` | 排除 | 推理内容，总设计文档 §5 明令禁止 |
| `tool-call` | 排除 | `arguments` 是原始 JSON 字符串，含完整工具参数 |
| `tool-result` | 排除 | 工具返回内容，可能含文件内容与受保护数据 |
| `image` | 排除 | 二进制附件引用，非文本；且邮件正文不做附件外发 |
| `file` | 排除 | 同上 |
| 未知类型 | 排除 | 无法确认安全性，安全默认为排除 |

多块拼接：`text` block 之间用 `\n` 连接，空串块丢弃。

### assistant/message 的真实 payload

```ts
event.data = {
  turn: number,
  step: number,
  message: AssistantMessage,
  stream: AssistantStreamRecord[],
  usage?: TokenUsage,
  interrupted?: true,
}
```

字段路径：

| 需要的信息 | 路径 | 类型 |
| --- | --- | --- |
| Turn 编号 | `event.data.turn` | `number` |
| Step 编号 | `event.data.step` | `number` |
| content blocks | `event.data.message.content` | `ContentBlock[]` |
| message ID | `event.data.message.id` | `Branded<'MessageId'>` |
| provider | `event.data.message.source.provider` | `string`（当 `source.kind === 'model'`） |
| model | `event.data.message.source.model` | `string`（同上） |
| usage | `event.data.usage` | `TokenUsage | undefined` |
| 是否被打断 | `event.data.interrupted` | `true | undefined` |

`AssistantMessage.source` 是 `ModelMessageSource`：

```ts
interface ModelMessageSource extends AssistantProvenance { kind: 'model' }
interface AssistantProvenance { provider: string; model: string; replayState?: unknown }
```

即 provider/model **确实存在**。access 时必须先确认 `source.kind === 'model'`（`MessageSource` 是联合类型，另含 `user` / `plugin` / `tool` 三种）。

`TokenUsage`：

```ts
{ inputTokens: number; outputTokens: number; totalTokens?: number;
  cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }
```

---

## Tool Result

```ts
event.data = {
  turn: number,
  step: number,
  message: ToolResultMessage,
  error?: { name: string; code: string },
  meta?: JsonValue,
}
```

失败判定采用**双判据**（任一命中即计为工具错误）：

1. `event.data.error !== undefined` —— 事件级的归一化错误描述 `{ name, code }`。
2. `event.data.message.content[0].isError === true` —— block 级的错误标记。

`ToolResultMessage` 的形状是确定性的：

```ts
interface ToolResultMessage extends Message {
  readonly role: 'user'
  readonly content: [ToolResultBlock]     // 元组，恰好一个元素
  readonly source: ToolMessageSource      // { kind: 'tool'; callId: ToolCallId }
}
```

`content` 是**单元素元组**，因此 `content[0]` 恒为 `ToolResultBlock`。两个字段需注意用途区别：`ToolResultBlock.isError` 是**可选**标记（成功时为 `undefined`，不是 `false`）；判断应写成 `block.isError === true`。

`TurnEndReasonMap` 中不存在 `canceled` / `rejected` / `timeout` 之类的工具级状态。工具被取消、超时或拒绝时，其表现是错误结果（走上述两条判据之一），**不会**产生独立的工具状态字段。因此 Phase 2「工具错误计数」只能依据上述双判据，不能依赖不存在的状态枚举。

### 必须避免的假设

`turn/end` 的 `reason.kind === 'completed'` **不代表所有工具调用成功**。运行时契约中两者是完全独立的维度：工具错误只体现在 `tool/result` 上，不会回写到 `turn/end.reason`。这正是总设计文档 §3 要求区分 `completed-clean` 与 `completed-with-tool-errors` 的原因。

---

## Completion Reasons

`turn/end` 的 `event.data.reason` 是判别联合 `TurnEndReason`，判别字段 `kind`：

```ts
interface TurnEndReasonMap {
  completed:    { kind: 'completed' }
  aborted:      { kind: 'aborted'; reason: TurnEndCancelCause }
  blocked:      { kind: 'blocked' }
  error:        { kind: 'error'; error: LlmFailure }
  'max-tokens': { kind: 'max-tokens' }
  interrupted:  { kind: 'interrupted' }
}
```

**恰好 6 种 kind**：`completed`、`aborted`、`blocked`、`error`、`max-tokens`、`interrupted`。总设计文档 §2 列出的六种与此**逐项一致**，无差异。

附带 detail：

- `aborted` 携带 `reason: TurnEndCancelCause`，其 `kind` 为 `'user' | 'parent' | 'hook' | 'disposed' | 'legacy'`。
- `error` 携带 `error: LlmFailure = { message, code, status?, providerRetryAfterMs?, requestId? }`。**该 message 属于模型/provider 错误信息，不含 SMTP 凭据**；但外发前仍应做长度截断。

分类映射（原型实现，与总设计文档 §3 一致）：

| reason.kind | toolErrorCount | status |
| --- | --- | --- |
| `completed` | `0` | `completed-clean` |
| `completed` | `> 0` | `completed-with-tool-errors` |
| `max-tokens` | 任意 | `max-tokens` |
| `error` | 任意 | `error` |
| `aborted` | 任意 | `aborted` |
| `blocked` | 任意 | `blocked` |
| `interrupted` | 任意 | `interrupted` |

---

## Differences From Master Design

| # | 总设计文档假设 | 运行时事实 | 影响 |
| --- | --- | --- | --- |
| 1 | 分别监听 `turn/start` / `assistant/message` / `tool/result` / `turn/end` 四个事件 | 当前运行时**没有**这些顶层事件；四者都是 `SessionEvent` 成员，统一由 `session/event(session, event)` 投递，需按 `event.type` 分派 | Phase 2 事件处理结构必须改为「单入口 + 分派」 |
| 2 | payload 直接可读（如「`assistant/message` contains content」） | 真实路径是 `event.data.message.content`，多一层 `data` 包装 | 所有字段访问路径下移一层 |
| 3 | `session.header.origin === "subagent"` | **存在且一致** | 无差异，可直接使用 |
| 4 | `reason.kind` 六种取值 | **完全一致**：completed / aborted / blocked / error / max-tokens / interrupted | 无差异 |
| 5 | 内容提取依据 `type === "text"` | **存在且一致**，但 `reasoning` block 同样带 `text` 字段，必须按 `type` 白名单取 | 实现须严格白名单，不可按字段名取值 |
| 6 | 未提及 scope 过滤 | `session/event` 是按 scope 过滤的事件；根级未打标签的监听器接收全部会话 | Phase 2 可直接全局观察，无需 Session Service |
| 7 | 未提及事件生命周期 | `session/disposed(session)` 顶层事件存在，可作为 `Map<sessionId, turnState>` 的释放信号 | 内存释放路径有据可依 |
| 8 | 未提及监听器执行约束 | 监听器在 `Session.append()` 的同步路径上被调用，无 await，异常被容器捕获 | 监听器内禁止长时 I/O，与 §7 的 MailQueue 设计一致 |
| 9 | 未提及 payload 可选字段的序列化风险 | `TokenUsage` 等类型的可选字段缺省即为 `undefined`，会使未归一化的输出整体不可序列化（运行时已实际发生） | 新增 Candidate Serialization 约束，见上文 |
| 10 | 未提及装载时机 | 插件可能在 Turn 中途装载，永远收不到该 Turn 的 `turn/start` | 必须懒初始化 `TurnState`，且时长未知时写 `null` 而非 `0` |

---

## Candidate Serialization

### 问题（已在运行时实际发生）

Runtime event payload 中存在**可选字段缺省即为 `undefined`** 的情况。这不是理论风险：原型首个 probe 工具在读取自身缓冲区时整体失败，错误为

```text
harness.defineTool execute result.records[10].data.usage.reasoningTokens must be lossless JSON data
(objects, arrays, strings, numbers, booleans, null) — not a class instance, function, Map/Set, Date, or undefined.
```

关键证据在错误文本本身：校验器**只**指出了 `reasoningTokens`，而同一对象里的 `inputTokens`、`outputTokens` 通过了校验。这说明产生该记录的对象形状是：

```js
{ inputTokens: <number>, outputTokens: <number>, reasoningTokens: undefined }
```

即「三个可选计数器里恰好一个缺省」。单条这样的记录就使**整个**缓冲区不可读——探针是当时唯一的证据通道，故障期间观测能力完全丧失。

`TokenUsage` 的字段可选性是原因：

```ts
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
```

### 结论：正式插件必须做 normalization

**任何要离开插件的结构化对象（日志 payload、邮件正文数据、队列条目、工具返回值）都必须先归一化为 lossless JSON。** 这既是对 Tool 输出契约的遵守，也是可观测性的前提：不可序列化的一条记录不能拖垮整批输出。

归一化规则（原型 `pkg-4` 的实现，可直接移植）：

| 输入类型 | 处理 |
| --- | --- |
| `null` | 保留 |
| `string` / `boolean` | 原样保留 |
| 有限 `number` | 原样保留 |
| `NaN` / `Infinity` / `-Infinity` | **省略**该字段并记录 |
| `undefined` | **省略**该字段（静默，属正常情况） |
| `function` / `symbol` / `bigint` | 省略该字段并记录 |
| `Array` | 递归逐项归一化，`undefined` 项丢弃 |
| plain object（原型为 `Object.prototype` 或 `null`） | 递归归一化，值被省略的键不写入结果 |
| 非 plain object（class 实例、`Map`、`Set`、`Date` 等） | **整体省略**该字段并记录，不抛异常 |
| 循环引用 | 不做支持，也不做特殊处理（原型不产生循环结构） |

被省略的字段不是静默丢弃：原型累计 `normalizeDropped` 计数并把前若干条路径附在响应上，因此「归一化丢掉了什么」本身是可观测的。这一点很重要——**静默吞掉异常与静默省略字段是两件不同的事**，前者掩盖故障，后者是契约要求的行为。

### 更根本的写法：只在字段存在时构造

归一化是兜底，不是首选。构造 payload 时就应避免写入 `undefined`：

```js
// 错误：三个可选计数器里缺一个就产生 undefined
usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens, reasoningTokens: u.reasoningTokens }

// 正确：只写入运行时确实报告过的计数器
function makeUsage(u) {
  const out = {}
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens',
                     'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    const v = u[key]
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
  }
  return out
}
```

**不得为了绕开该问题而整体丢弃 `usage`**，也不得用 `JSON.stringify` 的 replacer 掩盖整个对象。字段是否可用是运行时事实，缺失的字段省略、存在的字段保留。

### 运行时验证结果

`pkg-4` 的候选记录（真实 Turn）中 `usage` 字段为：

```json
{ "inputTokens": 255, "outputTokens": 759, "totalTokens": 187638, "cacheReadTokens": 186624 }
```

`reasoningTokens` **不存在**——如果该 Turn 的 provider 未报告推理 token 数，字段即被省略，而整条记录仍可完整序列化与读取。这与修复前的失败形成直接对照。

### 一个反直觉但必须记录的事实

上述 `inputTokens: 255` 与 `totalTokens: 187638` 在数量级上不自洽（若总输入为 187638，单次请求的 `inputTokens` 不应为 255）。本阶段**不对该值作解释**：原型如实读取 `event.data.usage` 并原样记录，未做任何推算、单位换算或校正。交付层若要让用户看到 token 统计，需要先单独确认这些计数器的实际语义（增量 vs 累计、是否含缓存），否则不应展示。本阶段只确认「字段可读、可选字段可省略」。

---

## Mid-turn Attachment

### 问题

**动态插件可能在 Turn 已经开始之后才被装载。** 该 Turn 的 `turn/start` 已经提交并派发完毕，监听器注册得太晚，永远收不到它。因此：

- 监听器不能假设「先收到 `turn/start`，后续才有事件」；
- 首个到达的事件可能是 `assistant/message`、`tool/result`，甚至直接是 `turn/end`；
- 此时 `Map<turn, TurnState>` 中根本没有该 Turn 的条目。

原型 `pkg-1`/`pkg-2` 正是如此：它们在 turn 1 的中途装载，从未观察 turn 1 的 `turn/start`。

### 首版实现的错误

首版在 `turn/end` 处理分支里做了这样的回退：

```js
const turn = ts === undefined ? newTurn(data.turn, eventTime) : ts
```

后果是产出的候选记录把**已累积的全部 telemetry 丢弃并换成空值**：真实 turn 1 有 44 个 step、多次工具调用、至少 1 次真实工具错误，但候选记录报出

```json
{ "status": "completed-clean", "assistantEvents": 0, "toolCallCount": 0,
  "toolResultCount": 0, "toolErrorCount": 0, "visibleTextLength": 0,
  "steps": null, "durationMs": 0 }
```

`status` 因此被误报为 `completed-clean`，正确值应为 `completed-with-tool-errors`。这是一个**分类错误**，不只是统计数字缺失。

### 修复策略（`pkg-3`，`pkg-4` 沿用）

两条独立规则：

1. **懒初始化，而非回退到空状态。** 任何携带 `turn` 编号的事件（`assistant/message`、`tool/call`、`tool/result`、`turn/end`）都通过同一个 `turnStateOf(rec, turn)` 取得状态；条目不存在时就地创建并立即用于累积。这样中途装载后收到的每一个事件都被计入，`turn/end` 到达时拿到的是真实累积值。

```js
function turnStateOf(rec, turn) {
  let ts = rec.turns.get(turn)
  if (ts === undefined) {
    ts = newTurn(turn, false, undefined)   // sawTurnStart = false
    rec.turns.set(turn, ts)
  }
  return ts
}
```

2. **`startAt` 缺省即未知，不得伪造。** `turn/start` 是唯一能证明 Turn 起始时间的来源。未收到它时 `startAt` 保持 `undefined`，候选记录中：

```js
sawTurnStart: ts.sawTurnStart,                      // 是否见过本 Turn 的 turn/start
telemetryComplete: ts.sawTurnStart,                 // 计数是否覆盖整个 Turn
durationMs: ts.sawTurnStart && ts.startAt !== undefined
  ? eventTime - ts.startAt
  : null,                                           // 未知 → null，绝不写 0
```

`durationMs: 0` 与 `durationMs: null` 的区别是本质性的：前者是「耗时为零」的断言，后者是「未知」的诚实表达。**正式插件应优先保证正确性，而不是伪精确。**

### 运行时验证结果（`pkg-4`，真实 Turn）

中途装载场景——`pkg-4` 于 turn 4 中途装载，未观察其 `turn/start`，候选记录为：

```json
{ "turn": 4, "status": "completed-clean", "sawTurnStart": false,
  "telemetryComplete": false, "durationMs": null,
  "steps": 5, "assistantEvents": 3, "toolCallCount": 3, "toolResultCount": 4,
  "toolErrorCount": 0, "visibleTextLength": 882 }
```

要点：计数全部是**真实累积值**（非零、非空），只有时长被标为未知。修复前同样场景下这些字段全为 0。懒初始化未产生错误 duration，也未把未知时长写成 0。

对正常从 `turn/start` 开始的 Turn 无影响：`turn/start` 分支写入 `sawTurnStart = true` 与真实 `startAt`，两种路径共用同一个 `turnStateOf`，不存在两套逻辑。

以下条目由本契约直接推出，构成 Phase 2 的实现边界：

1. 事件入口唯一：`ctx.on('session/event', (session, event) => ...)`，按 `event.type` 分派。
2. 顶层判定用 `session.header.origin`，辅以 `parentSession` 与 `delegationDepth`。
3. 可见文本提取为纯函数：白名单 `type === 'text'`，多块 `\n` 连接，未知类型静默跳过。
4. 监听器内只做状态更新与入队，不做 SMTP I/O（与总设计文档 §7 一致，且为运行时同步路径所要求）。
5. `session/disposed` 作为状态释放信号。
6. 凭据每次发送操作重新 `resolve`，不缓存。
7. 不要按 session id 格式推断层级。
8. 不要用真值或键存在性判断 `delegationDepth`：根会话合法取值为 `0`，只能写 `> 0`。
9. 所有外发结构化对象先归一化为 lossless JSON；缺省的可选字段省略，绝不写入 `undefined`。
10. 假定自己可能在 Turn 中途装载：任何带 `turn` 编号的事件都懒初始化 `TurnState`，不得依赖先收到 `turn/start`。
11. 时长未知时写 `null`，不写 `0`；用 `sawTurnStart` / `telemetryComplete` 标记计数覆盖范围。

---

## Runtime-verified Event Flow

以下流程为原型在真实会话中**实际观察到**的序列，未经推断补全。

### 完整链（`turn/start` 起点已知）

subagent 会话 `08062578-254d-4051-a7cf-dc329d334fb1`（原型在 `turn/start` 之前已装载，故为完整链）：

```text
turn/start            (turn 1)
    ↓
step/start (step 1) → assistant/message → tool/call → tool/result → step/end
    ↓
step/start (step 2) → … → step/end
    ↓   （共 4 个 step）
turn/end              (reason.kind = "completed")
    ↓
MAIL_NOTIFY_SKIP_SUBAGENT      ← subagent 会话在此终止，不产生候选
```

### 顶层会话的完整链（含候选产出）

主会话 `session-3f0c2938-3769-471e-b2bf-12badadde842`：

```text
[turn 1：原型于中途装载，未观察 turn/start；turn/end 时产出 telemetry 为空的候选]
    ↓
turn/end (turn 1) → MAIL_NOTIFY_CANDIDATE
    ↓
turn/start (turn 2)
    ↓
… assistant/message / tool/call / tool/result 交替 …
    ↓
turn/end (turn 2) → MAIL_NOTIFY_CANDIDATE
    ↓
turn/start (turn 3)
    ↓
…
```

### 中途装载链（`turn/start` 未观察）

```text
[turn 4 已在进行中：原型装载]
    ↓
assistant/message (step 1 … step 5，懒初始化累积)
    ↓
tool/call → tool/result          (3 次调用、4 次结果，均计入)
    ↓
turn/end (turn 4) → MAIL_NOTIFY_CANDIDATE
        sawTurnStart: false, telemetryComplete: false, durationMs: null
        但 assistantEvents/toolCallCount/toolResultCount/visibleTextLength 均为真实值
    ↓
turn/start (turn 5)
```

### 必须记录的非预期观察

**subagent 完成不会自动开启父会话的新 Turn。** 观察到的真实行为是：subagent 结算时向父会话 inbox 注入消息（事件类型 `agent/inbox/spliced`），父会话在**同一个** Turn 内继续推进 step。evidence：turn 1 内 `agent/inbox/spliced` 出现在 step 31→32 之间，随后该 Turn 继续到 step 44 才结束。

这意味着：Phase 2 不能把「subagent 结束」当作「父 Turn 结束」的信号，也不需要为此做特殊处理；但任何基于「一次委托 = 一个 Turn」的耗时直觉都是错的。

### 事件计数（观察窗口内的真实施加值）

```text
tool/result 76   assistant/message 48   tool/call 75   step/start 49   step/end 49
turn/start 2     turn/end 2             agent/inbox/spliced 6
request/header 2 user/message 6         subagent/catalog 1  system/message 1
```

监听器调用 320 次，处理异常 0 次（`containedErrors: 0`），DSH Agent Loop 全程正常运行。
