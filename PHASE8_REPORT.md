# Phase 8 Report — v0.2.0 Human Attention Notifications

本报告记录 Phase 8 的实现与验证结果。阶段目标不是发布，而是实现并验证三条通知链路：

```text
A. Terminal failure notification
B. ask_user_question notification
C. approval/asked notification
```

最终结论：

```text
PARTIAL — v0.2.0 RC NOT READY
```

> **后记（Phase 8.1，2026-09）。** 本报告发布时把状态记为 `PASS — v0.2.0 RC READY`，但第 8.3 节已经记录了唯一未闭合的验证项（approval 的真实装配端到端投递）。在该项补齐之前，RC READY 的表述过强，故此处改为与第 8.3 节一致的 `PARTIAL — v0.2.0 RC NOT READY`。三项后续处置见 [`PHASE8_1_REPORT.md`](PHASE8_1_REPORT.md)：approval E2E 已补齐（`approvals`、`approvals-duplicate`、`approvals-rejected` 三个场景）；第 11 节第 2 项记录的凭据引用诊断经复核**不成立并已撤销**（见该报告第 6 节与 `docs/DECISIONS.md` D019）；`QuestionDropReason.'content-limit'` 的处置见该报告第 7 节。Phase 8.1 的最终状态为 `PASS — v0.2.0 RC READY`。

本阶段未执行且不得执行的动作均未执行：无 `npm publish`、无 `git tag v0.2.0`、无 GitHub Release。

---

## 1. Baseline

阶段开始时逐项确认：

| 项 | 值 |
| --- | --- |
| branch | `main` |
| HEAD | `229637580284621f38e3820c94b7f49208cd3962` |
| `origin/main` | `229637580284621f38e3820c94b7f49208cd3962`（与 HEAD 一致，`rev-list --left-right --count` = `0 0`） |
| working tree | 干净（`git status --porcelain` 无输出） |
| `v0.1.1` tag target | `a233c25f322c7f7951dc138ad5e238a96c57f2c5` |
| `v0.1.0` tag target | `ee8c956cc2346df74bec1ffbef4d2857bf6e2f17` |

两个已发布 tag 全程未被移动或改写；本阶段全部工作在从 `main` 创建的 `feat/v0.2.0-human-attention` 分支上进行。

---

## 2. Runtime evidence

**本节的所有形状均来自当前本机实际安装的 DSH，而非旧 Phase 报告或模型记忆。** 安装版本为 `@deepseek-ai/dsh@0.1.5-rc.1`（`C:\Users\20659\node_modules\@deepseek-ai\`），取证方式为读取该安装的声明文件与打包产物。

### 2.1 `turn/end` 与失败事实

`dsh-session` 的 `SessionEventMap` 声明：

```text
'turn/end': { turn: number; reason: TurnEndReason }
```

`TurnEndReasonMap` 的 `error` 成员：

```text
error: { kind: 'error'; error: LlmFailure }
```

字段名是 **`error`**，不是 `failure`——后者是 `dsh-llm` 内部 `FinishReasonMap` 上的拼写，两者不可混用。

`LlmFailure`（`dsh-llm` 的 `types.d.ts`）恰好五个字段：

| 字段 | 类型 | 可选 |
| --- | --- | --- |
| `message` | `string` | 必填 |
| `code` | `string` | 必填 |
| `status` | `number` | 可选 |
| `providerRetryAfterMs` | `number` | 可选 |
| `requestId` | `ProviderRequestId`（品牌字符串） | 可选 |

该闭集由运行时自身校验：`dsh-llm` 的 `failureSnapshot` 只读取这五个键并拒绝其它形状。

`code` **没有封闭联合类型**，声明为 `string`。实际词表由多处共同构成：`dsh-llm` 导出 `QUOTA`、`CONTEXT_WINDOW_EXCEEDED`、`EMPTY_RESPONSE`、`INVALID_CREDENTIAL` 四个常量；模块私有的默认可重试集合为 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`；`UNKNOWN` 由 `harnessErrorCode` 对非 Harness 错误产出；DeepSeek adapter 另产出 `AUTH`、`INVALID_REQUEST`、`HTTP_<status>`、`ABORTED`、`FILES_API`。因此实现把 `code` 当作开放字符串处理，并在其缺席时回落 `UNKNOWN`（该值本身是运行时自己的词表）。

### 2.2 `llm/retry`

`dsh-llm-retry` 把它声明为**会话事件**而非 Cordis 事件：

```text
'llm/retry': LlmRetryEventData
```

其 payload 携带 `retryId`、`turn`、`step`、`provider`、`mode`、`policyKey`、`retry`、`delayMs` 与 `failure: LlmFailure`。它记录的是**一次失败尝试**，不是 Turn 的结局。重试成功后的 Turn 以 `{ kind: 'completed' }` 结束——这正是 D018 第一条「恢复的重试不通知」的可核验依据。

不存在 `llm/request` 或 `llm/response` 事件，也没有任何事件携带 `requestId`；它只存在于 `LlmFailure.requestId`。

### 2.3 `tool/call`

```text
'tool/call': { turn: number; step: number; callId: ToolCallId; name: string; arguments: string }
```

四项均为必填。`arguments` 是「模型原样产生的未解析 JSON 字符串」。`callId` 与 `tool/result` 配对。

### 2.4 `ask_user_question`

工具注册名精确为 `ask_user_question`（`dsh-tool-ask-user`）。其参数 schema 的字段为 `questions[].{id, question, header, options[].{label, description}, multi_select}`，其中 **wire 侧拼写确认为 `multi_select`**（服务侧 `AskUserQuestionItem` 的拼写是 `multiSelect`，工具在映射时转换）。`execute` 会 `await ctx.userQuestions.ask(...)`，因此在人工回答之前阻塞。

`ctx.userQuestions.ask` 对 delegated caller 抛 `DELEGATED_CALLER`，所以「子代理能否提问」随 composition 而异，不能假设。

`user-questions/request` 是 `@mode waterfall`，语义为「返回答案即认领，否则调用 `next()` 委托」。全树只存在这一个 user-questions 事件名；不存在 `user-questions/asked|answered|settled`。

### 2.5 `approval/asked`

```text
'approval/asked': { id: ApprovalRequestId; toolName: string; callId?: ToolCallId; reason?: string }
'approval/decided': { id: ApprovalRequestId; outcome: ApprovalOutcome }
```

两者都是 log-only audit（无 `surfaceOp`）。payload 上**没有** `turn` 与 `session` 字段：turn 上下文是位置性的（`request()` 在无 open turn 时抛错），session 是 append 目标。

`ApprovalOutcome` 为 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`——**不存在** `'allowed'` 或 `'denied'`。

tool arguments 被刻意省略，DSH 自己在类型注释与 README 中两次说明这一点（`callId` 链接到已经展示过的 tool call，因此参数不在此重复）。

`approval/request` 同样是 waterfall，且是 answer ownership chain。

### 2.6 订阅面

`turn/*`、`step/*`、`tool/*`、`assistant/*`、`llm/retry`、`approval/*` 都**不是** Cordis 顶层事件，而是同一个 `session/event` Cordis 事件（`@mode emit`）的载荷成员。不存在名为 `turn/end` 的 Cordis 事件。

---

## 3. Feature A — Terminal failure notification

### 3.1 实现

失败事实只在 `turn/end` 的 `reason.error` 边界读取一次，且只在 `reason.kind === 'error'` 时读取（`runtime-adapter.ts` 的 `turn/end` 分支，调用 `completion.ts` 的 `extractFailureFacts`）。`llm/retry` 分支不产生任何失败事实。

分类只读 `code`；`status` 与 `providerRetryAfterMs` 结构化读取，缺席记作缺席。`requestId` 不被拷贝进 DTO。

策略上，`notifier.ts` 的 `decideNotification` 把无可见文本规则改为条件式：

```text
status !== 'error' 且 visibleText.trim() === ''  → no-visible-text
status === 'error'                                → 该规则不适用
```

正文新增独立 Failure 段，逐项声明观察结果；`status` 或 `providerRetryAfterMs` 未报告时写明 `not reported` 而非默认值。失败前的可见输出放入 `--- Partial model output before failure ---` 独立段落；不存在时写 `--- No model output was produced before this failure ---`。

主题形如 `[DSH] Task failed — QUOTA (429)`：前缀与状态标签恒定，其后依次是高优先级的 `code`、HTTP status，最后是模型名（预算不足时优先丢弃）。

### 3.2 验证

| 要求 | 结果 | 证据 |
| --- | --- | --- |
| 终局 RATE_LIMIT / QUOTA / TIMEOUT / TRANSPORT / SERVER / UNKNOWN 各自成信 | PASS | `FNL-03` |
| 有 status 的错误 | PASS | `FNL-05`（主题断言为 `[DSH] Task failed — SERVER (503)`） |
| 无 status 的错误 | PASS | `FNL-05`（正文断言 `HTTP status: not reported`） |
| 无 visibleText 的错误仍发送 | PASS | `FNL-01` |
| 有部分 visibleText 的错误 | PASS | `FNL-06`（独立段落，且位于标题之后） |
| `notifyErrors=false` → 无邮件 | PASS | `FNL-02` |
| `notifyErrors=true` → 一封邮件 | PASS | `FNL-01` |
| `llm/retry` → 成功 ⇒ 0 封失败邮件 | PASS | `FNL-07` |
| 多次重试 → 终局错误 ⇒ 恰好 1 封 | PASS | `FNL-08` |
| 不按文本分类 | PASS | `FNL-04`（两个 message 文本故意误导的失败，主题均按结构化 `code`） |
| `requestId`、栈、reasoning/tool sentinel 不外发 | PASS | `FNL-10` |
| aborted 不产生故障邮件 | PASS | `FNL-11` |

`FNL-07` 是本阶段最重要的反向测试：它证明「瞬时请求失败」与「终局 Turn 失败」在实现上确实是两件事。

---

## 4. Feature B — `ask_user_question` notification

### 4.1 实现

触发点是持久化 `tool/call` 的精确工具名命中（`event-handler.ts` 的 `observeToolCall`）。命中后把原始字符串交给 `human-attention.ts` 的 `parseAskUserQuestionArguments`，该模块**逐字段**构建 DTO：全文件不存在对源对象的 spread，因此未列入白名单的 `additionalProperties` 无法到达邮件。

行为界限（常量见 `human-attention.ts`）：问题数 ≤ 20；每题选项数 ≤ 20；问题正文 ≤ 2000 码点；选项标签 ≤ 500；选项描述 ≤ 1000；header ≤ 120；id ≤ 200；全部携带内容合计 ≤ 6000 码点。畸形 JSON 降级为「无可通知内容」并记录 `question.unparsable`，日志只含计数与原因。

通知在 `tool/call` 上同步构建并入队，不等 `tool/result`、不等 `turn/end`、不等人工回答；session/event 监听器不 `await` SMTP。

`user-questions/request` **未被注册**。

### 4.2 验证

| 要求 | 结果 | 证据 |
| --- | --- | --- |
| 单个提问 | PASS | `QUE-01` |
| 一次调用多个问题 | PASS | `QUE-02` |
| 一个 Turn 内多次调用 | PASS | `QUE-03`（按 `callId` 各自成信） |
| 选项与多选 | PASS | `QUE-01`、`HAT-03` |
| 可自由文本的提问 | PASS | `HAT-03`、人工替身在探针中以自由文本作答 |
| 畸形 JSON | PASS | `QUE-08`、`HAT-07` |
| 未知字段被丢弃 | PASS | `HAT-01`、`QUE-09`（sentinel 不外发） |
| 超大提问被界定 | PASS | `QUE-10`、`HAT-05`、`HAT-06`（按码点而非 UTF-16 单元计数） |
| 重复 `tool/call` | PASS | `QUE-04` |
| 通用工具调用 | PASS | `QUE-07` |
| 子代理 | PASS | `QUE-11` |
| **通用工具参数绝不进入邮件或日志** | PASS | `QUE-07`（`bash`/`pwsh`/`read`/`write`/`subagent`/`web_search`/MCP 七类工具的参数 sentinel 未出现在任何 job、body 或日志中） |

`HAT-01` 的断言经过反向验证：把实现临时换成 `{ ...record }` 时，键白名单断言与 sentinel 扫描都会失败；对逐字段拷贝的实现则都不触发。

---

## 5. Feature C — `approval/asked` notification

### 5.1 实现

触发点是持久化 `approval/asked` 审计事件，由 `index.ts` 注册的第二个 `session/event` 监听器观察（`event.type === 'approval/asked'` 时才处理）。`approval/request` waterfall **未被注册**。

只使用契约实际提供的字段：`toolName`（必需）、`reason?`、`callId?`。被审批工具的 raw arguments **不可能**出现在邮件中，因为 DSH 的契约不提供它们，而渲染器没有安放它们的字段。`approval/decided` 不产生任何邮件。

### 5.2 验证

| 要求 | 结果 | 证据 |
| --- | --- | --- |
| `approval/asked` | PASS | `APR-01` |
| `approval/decided` allowed-once | PASS | `APR-04`（仍只有一封） |
| `approval/decided` rejected | PASS | `APR-04` |
| 重复 asked 事件 | PASS | `APR-03` |
| 无 `callId` 的审批 | PASS | `APR-05` |
| 无 `reason` 的审批 | PASS | `APR-05`（正文为 `Reason: not reported`） |
| 子代理 | PASS | `APR-07` |
| `decided` 之后不再发第二封「需要处理」 | PASS | `APR-04` |
| 被审批工具的 arguments 不外发 | PASS | `APR-06`（在 payload 中植入 `arguments` sentinel，未到达 body 或日志） |

---

## 6. Privacy boundary

通用工具参数仍然禁止外发，该原则未被削弱。新增的例外是**语义白名单**，恰好覆盖 D018 第七条列举的字段：

| 新增允许项 | 来源 | 依据 |
| --- | --- | --- |
| `ask_user_question` 的 presentation 字段 | `tool/call.arguments` 解析后逐字段拷贝 | DSH 已把这些字段定义为面向人的展示内容 |
| `approval/asked` 的 `toolName` 与 `reason` | 持久化审计事件 | DSH 的审批契约本身只发布这些字段 |
| 经净化的终局失败事实 | `turn/end.reason.error` | 结构化标量，且 `message` 只供人阅读 |

永久禁止进入邮件或日志的集合：reasoning、system prompt、通用工具参数、通用工具结果、凭据（API key、SMTP password）、DSH Web auth token。`requestId` 与 approval `callId` 作为诊断标识在本阶段同样不外发。

实现层面的保证方式：`rawArguments` 只允许被 `human-attention.ts` 读取；适配器只做一次字符串拷贝；handler 只做一次精确比较后转交；解析结果中不保留任何对源对象的引用；日志只记录计数与原因。`QUE-07`、`APR-06`、`FNL-10`、`HAT-01`、`HAT-12` 分别对这几条做断言。

---

## 7. Dedupe model

三个独立命名空间：

```text
turn:${sessionId}:${turn}
question:${sessionId}:${callId}          // 无 callId 时回落 question:${sessionId}:t${turn}:s${step}
approval:${sessionId}:${approvalId}
```

保证：同一 call 在进程生命周期内至多通知一次；同一 Turn 中不同 `callId` 各自可通知；终局通知在人工回答之后仍然可通知。

验证：`DED-*` 与「the three dedupe namespaces cannot collide」断言四个键互不相同、question 键不消耗 turn 键、同 Turn 两个 question 键不同、重复 approval id 得到同一键。

端到端验证是本阶段的关键一环，见第 8 节：一次提问加一次完成的 Turn 恰好投递两封邮件。

---

## 8. End-to-end

### 8.1 探针构成

`scripts/probe-e2e.mjs` 与 `scripts/probe/` 在一次性 `DSH_HOME` 上启动**出厂 `headless` profile**，叠加四个探针行：

```text
probe-credentials        从环境变量解析凭据（替换出厂的 file-backed store，服务名唯一）
probe-scripted-provider  脚本化模型 provider，经 ctx.llm.registerAdapter 注册
tool-ask-user            出厂树不含的模型侧工具
probe-auto-answer        人工替身：应答 user-questions/request 与 approval/request
dsh-mail-notify          被测插件本体，指向回环 SMTP 服务器
```

真实的 agent loop、工具注册表、`ctx.userQuestions` 阻塞调用、session log、插件的监听器/队列/mailer 与一次真实 SMTP 会话全部参与。被替换的只有两件事，且探针在输出中具名：**人**（替身应答者）与 **SMTP 服务器的身份**（回环、无 TLS、无认证、不转发）。

### 8.2 实测结果

| 场景 | 实测投递 | 退出码 |
| --- | --- | --- |
| `questions` | **2 封**：`[DSH] Input required — Choose Mode`、`[DSH] Task completed — probe-scripted` | 0 |
| `errors` | **1 封**：`[DSH] Task failed — QUOTA` | 0 |
| `approvals` | **未到达审批路径**，该场景的结果不构成证据 | 0 |

`questions` 场景是本阶段要求的「提问 + 完成同 Turn」证明：脚本化模型调用 `ask_user_question`，通知在 Turn 仍打开时入队并投递；随后人工替身以 `A` 作答，工具返回，Turn 继续并完成，第二封完成邮件投递。两封邮件的存在直接证明两个去重命名空间未互相消耗。

`errors` 场景证明结构化终局失败在真实装配中产生恰好一封故障邮件，主题携带 `code`。

### 8.3 未完成项：approval 的真实 E2E

`approvals` 场景未取得证据，原因是环境约束而非实现缺陷：审批通知的触发要求 `approval/asked` 出现在一个**打开的 Turn 内**（`approval.request()` 在无 open turn 时抛错），而本环境中：

- 没有任何工具会在脚本化模型的执行路径上请求审批——`pwsh` 调用本身未成功执行（探针记录的 turn 状态为 `completed-with-tool-errors`）；
- 由探针侧主动调用 `ctx.approval.request()` 的尝试全部失败：`agent/created` 时 agent 尚无 session（`Cannot read properties of undefined (reading 'seq')`），`agent/session-start` 时 Turn 尚未打开或已经结束（`approval.request() outside an open turn`）；
- 当前 DSH profile 的权限预设为 `danger-full-access`，其 approval policy 为 `never`，因此该环境本身不产生审批请求。

因此 approval 通知的验证目前只到集成层（`APR-01`…`APR-08`，8 项，全部使用真实 `approval/asked` 载荷经真实事件总线驱动），**没有**真实装配下的端到端投递证据。这是本阶段唯一未闭合的验证项，也是 RC 转正式发布前应当补做的一项。

---

## 9. Compatibility

| 项 | 结论 |
| --- | --- |
| 已验证的 DSH 版本 | `0.1.5-rc.1`（本机实际安装） |
| `peerDependencies` 声明范围 | 未变更 |
| question / approval 事件面 | 以 `0.1.5-rc.1` 的实际证据为准，见第 2 节 |
| 旧版本兼容层 | 不需要：项目此前只承诺并验证过 `0.1.5-rc.1`，不存在需要分流的第二个 shape |

形状差异若在未来出现，只允许在 `runtime-adapter.ts` 建立兼容分支；核心通知逻辑不得出现散落的版本判断。当前没有任何版本判断存在于适配器之外。

`tool/call.arguments` 的字符串假设已在适配器中收窄为「仅接受字符串」，并在解析器中保留接受结构化对象的兼容分支，使该字段在两侧都不会以未类型化形式被传递。

---

## 10. Security

| 检查 | 结果 |
| --- | --- |
| 控制字符剥离 | PASS（`sanitizeDetail` 覆盖全部 C0/C1） |
| 长度有界 | PASS（问题/选项/失败文本各自有界常量） |
| header injection 防护 | PASS（主题经 `sanitizeLine`，CR/LF 被压平） |
| 不外发 raw thrown object / stack | PASS（`FNL-10`） |
| 不外发 request headers / API key / provider credential | PASS（无读取路径） |
| 不外发 SMTP credential | PASS（凭据只在单次发送尝试内解析并直接交给 transport） |
| `?token=` / DSH Web token 不进邮件 | PASS（插件不构造任何深链接） |
| `npm audit --omit=dev` | 0 vulnerabilities |
| tarball secret scan | PASS（84 entries，credential-value hits=0，shaped-literal hits=0） |

---

## 11. Tests

```text
check:text    PASS
typecheck     PASS（tsc -p tsconfig.json --noEmit 与 tsconfig.test.json --noEmit 均 exit 0）
tests         405 / 405 PASS，0 fail
build         PASS
pack          PASS（dsh-mail-notify-0.2.0.tgz）
pack:check    PASS（required entries present, no forbidden entry found）
scan:secrets  PASS
npm audit     0 vulnerabilities
fresh install PASS（临时目录安装 0.2.0 tarball 后 import 成功，
                  默认 notifyErrors/notifyQuestions/notifyApprovals 均为 false，
                  `<scope>/<id>` 形式的凭据引用通过校验）
```

测试增量：v0.1.1 的 341 项全部保留并通过，新增 64 项：

| 文件 | 数量 | 覆盖 |
| --- | --- | --- |
| `tests/unit/human-attention.test.ts` | 25 | 白名单严格性、sentinel 不外发、界限、畸形 JSON、控制字符 |
| `tests/unit/attention-policy.test.ts` | 8 | 开关独立性、默认值、`minTurnDurationMs` 不适用 |
| `tests/integration/failure-notification.test.ts` | 11 | 终局失败链路与恢复重试反向测试 |
| `tests/integration/attention-notification.test.ts` | 19 | question 与 approval 链路、隐私、去重 |

既有回归覆盖未被削弱：telemetry、duration、SMTP、privacy、packaging、credential、retry 的断言全部保持并通过。

### 实现期间发现并修正的两个缺陷

1. **解析器总量界限的记账缺陷**（`A10`）：被尺寸上限拒绝的问题不消耗额度，导致返回集合不再是前缀。已修正为在边界判断前累计。
2. ~~**凭据引用语法不兼容**（`D018` Consequences）：原本只接受裸名（`^[A-Za-z_][A-Za-z0-9_]*$`），而 DSH Credential store 只接受 `<scope>/<id>`（每段 `^[a-z][a-z0-9-]*$`）。一个把密码存进 store 的部署会在挂载期被拒绝，且操作者无法在不损害凭据卫生的前提下修正。已放宽为同时接受两种形式，并补测试断言两种形式及若干非法形式。~~
   **该诊断经 Phase 8.1 复核不成立，放宽已撤销。** `<scope>/<id>` 是 DSH 凭据 seam 的**另一个键空间** `CredentialKey`（`records` 段，经 `readRecord`/`describeRecord` 访问），而 `resolve()` 与 `describe()` 只读 `refs` 段；把一个 `CredentialKey` 交给 `resolve()` 得到的是永久 `undefined`。因此那次放宽接受了一个永远解析不到的引用。现状：文法回归 DSH 的 `CredentialRef`（`^[A-Za-z_][A-Za-z0-9_]*$`），证据与裁决见 [`PHASE8_1_REPORT.md`](PHASE8_1_REPORT.md) 第 6 节与 `docs/DECISIONS.md` D019。

---

## 12. Git

分支：`feat/v0.2.0-human-attention`（从 `main` 的 `2296375` 创建）。

提交边界：

```text
feat: add terminal failure notifications
feat: add human-attention notifications
test: cover failure and interaction mail paths
docs: document v0.2.0 notification semantics
```

未执行且不得执行：移动或改写 `v0.1.1`、force push 已发布历史。`v0.1.1` 与 `v0.1.0` 的 tag target 在本阶段结束时与阶段开始时一致（第 1 节的两个 SHA）。

---

## 13. Phase 8 exit gate

| 门 | 结果 |
| --- | --- |
| terminal error notification | PASS |
| recovered retry negative test | PASS |
| `ask_user_question` notification | PASS |
| approval notification | PASS（集成层） |
| question + completion same turn | PASS（真实装配，2 封邮件） |
| strict tool-argument privacy | PASS |
| dedupe separation | PASS |
| existing v0.1.1 regression | PASS（341/341） |
| pack | PASS |
| fresh install | PASS |
| SMTP E2E | PASS（回环，questions 与 errors 两个场景） |
| secret scan | PASS |
| supported DSH matrix | PASS（`0.1.5-rc.1`） |
| **approval E2E（真实装配）** | **未取得证据 — 见第 8.3 节** |

```text
PARTIAL — v0.2.0 RC NOT READY
```

该表中的每一行都是本阶段结束时的事实。唯一未通过的门是最后一行，它正是第 14 节第 1 项。Phase 8.1 补齐了该门并据此重判状态；本阶段的记录保持不变。

---

## 14. 未决事项

1. **approval 的真实端到端投递未取得证据**（第 8.3 节）。集成层 8 项断言全部通过，但真实装配下的 `approval/asked` → 邮件链路未在一次带审批的真实运行中被观察到。建议在 RC 转正式前，在一个 approval policy 为 `ask` 的 profile 中补做。**（Phase 8.1 已补齐：`approvals`、`approvals-duplicate`、`approvals-rejected` 三个场景，见 [`PHASE8_1_REPORT.md`](PHASE8_1_REPORT.md) 第 2–5 节。）**
2. **`QuestionDropReason.'content-limit'` 在当前界限下不可达**（`A9`）。保留该成员并已在测试中记录，但若认为不可达的联合成员应当删除，需要一次决策。**（Phase 8.1 已裁决：保留并标注为保留值，附 `HAT-11e` 证明其不可达的成因，见该报告第 7 节。）**
3. `includeSubagents` 的判定沿用三判据（`origin` → `parentSession` → `delegationDepth`）。运行时证据显示 fork 出的子会话也携带 `parentSession`，因此一个用户主动 fork 的顶层会话可能被判为子代理。该行为在 Phase 1 固化且本阶段未改动——本阶段的要求是保持既有语义——但它是一个独立于 Phase 8 的、值得单独复核的判据问题。**（Phase 8.1 已复核：担忧成立但范围更窄，全部运行时子代理由第一条判据覆盖，行为保持不变；见该报告第 8 节。）**
4. 本阶段未使用真实 SMTP 凭据做投递。所有 SMTP 验证使用回环服务器；真实投递留待 RC 之后的发布验证。**（Phase 8.1 维持该边界。）**
