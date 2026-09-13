# Phase 1 Report

DSH Mail Notify — 第一阶段：运行时 API Inspect 与动态原型验证。

---

## 1. Result

**PASS**

判定依据为第 9 节逐项核对的完成标准。所有硬性条件均满足：总设计文档已读取；DSH API 全部经 Inspect 或 DSH 自身类型声明确认，无一处凭记忆假定；Host-only 动态原型成功运行并捕获真实 `SessionEvent`；真实 `assistant/message` 与真实 `turn/end` 均已观察；`MAIL_NOTIFY_CANDIDATE` 已真实产出且**可完整序列化读取**；reasoning 未进入候选正文；subagent 过滤成立；原型未破坏 Agent Loop；关键运行时边界已写入契约。

本阶段共发现并修复 3 个真实缺陷，其中 2 个由运行时证据暴露、1 个由并行会话证据暴露。第 7 节列出一项不构成阻塞的残余限制。

---

## 2. DSH API Verification

### 已 Inspect（Inspect 工具或 DSH 自身类型声明确认）

| API | 确认内容 | 来源 |
| --- | --- | --- |
| `Service.listService` 目录 | Host 全部 Service 键与签名 | Inspect |
| `Service.listService{sessions}` | `create` / `prepare` / `enter` / `announce` / `flush` / `get` / `list` / `fork` | Inspect |
| `Service.listService{credentials}` | `resolve` / `describe` / `set` / `unset` / `readRecord` / `describeRecord` / `listRecords` / `modifyRecord` | Inspect |
| `Event.listEvents` 目录 | 全部 Host 事件名、mode、listener 签名 | Inspect |
| `Event.listEvents{session/event}` | mode=`emit`；签名 `(this: Scoped<Session>, session, event)`；payload 类型全集 | Inspect |
| `Builtin.listBuiltins`（host） | `ctx` / `harness` / `console` / `btoa` / `atob` / `TextEncoder` / `TextDecoder` | Inspect |
| `Tool.listTools` | 当前 Agent 可见工具全集（含 `read` 确证存在） | Inspect |
| `SessionEventMap` | 全部 13 种 SessionEvent 的 payload 形状 | Inspect |
| `SessionHeader` | `id` / `createdAt` / `cwd` / `parentSession` / `isSeeded` / `origin` / `delegationDepth` / `agentPreset` | Inspect |
| `ContentBlockMap` | `text` / `reasoning` / `image` / `file` / `tool-call` / `tool-result` | Inspect |
| `TokenUsage` | 6 个计数器中 4 个可选 | Inspect |
| `TurnEndReasonMap` | 6 种 kind 及各自 detail | Inspect |
| `TextBlock` / `ToolCallBlock` / `ToolResultBlock` | 精确字段与可选性 | DSH 声明 `dsh-llm/lib/types/types.d.ts` |
| `isError` 的全部产生点 | 8 个 origin 站点 + 2 个 abort 结果 + 4 处包外合成 | DSH 实现 `dsh-tools/lib/index.js:3131-3586` |
| `error.info` 的产生条件 | 仅 `HarnessError` 实例携带 `{name, code}` | DSH 实现 `dsh-tools/lib/index.js:2516-2525` |
| bash/pwsh 非零退出语义 | 非零退出记为**成功**，仅在文本中附 `[exit code: N]` | DSH 实现 `dsh-tool-bash/lib/index.js:63-73, 429-441` |
| `tool/result` 的 `error` 字段来源 | `result.error?.info`，即仅 typed failure 才非空 | DSH 实现 `dsh-agent-loop/lib/index.js:697-713` |
| `session/event` 投递与异常容器 | 同步派发、不 await 返回 Promise、单监听器 try/catch | DSH 实现 `dsh-session/lib/types/index.js:310-326, 585-594` |
| scope 过滤语义 | 未打标签的根级监听器全局接收 | DSH 实现 `dsh-scope/lib/index.js:327-338` |
| `session/disposed` | mode=`emit`；签名 `(this: Scoped<Session>, session)` | Inspect |

### 已运行时验证（原型在真实会话中实际观察）

| 事实 | 运行时证据 | 级别 |
| --- | --- | --- |
| `session/event` 可被根级监听器接收 | `listenerInvocations` 累计 320+，`containedErrors` = 0 | Runtime verified |
| 全局接收（跨会话） | 观测到 5 个不同会话：2 个根会话 + 3 个 subagent | Runtime verified |
| `(session, event)` 两参数签名 | 处理函数按此签名取值，全部字段可读 | Runtime verified |
| `turn/start` | 主会话 turn 2 / turn 4 / turn 5；subagent 各 1 次 | Runtime verified |
| `assistant/message` | 累计 48+ 次，`event.data.message.content` 可读 | Runtime verified |
| `reasoning` block 真实存在 | 例：`blockTypes: ["reasoning","text","tool-call","tool-call"]` | Runtime verified |
| `tool/result` | 累计 76+ 次，含 `turn` / `step` / `message` | Runtime verified |
| 工具错误真实标记 | `isError: true, errorFieldPresent: true, blockIsError: true, errorName: "FsError", errorCode: "FS_NOT_FOUND"` | Runtime verified |
| `turn/end` | 累计 4 次（主会话 2 次可读，subagent 2 次） | Runtime verified |
| `MAIL_NOTIFY_CANDIDATE` 产出且可读 | 完整候选记录（见第 4 节） | Runtime verified |
| subagent 判定 | 3 个会话全部 `isSubagent: true, decidedBy: "origin"` | Runtime verified |
| `MAIL_NOTIFY_SKIP_SUBAGENT` | 3 个 subagent 各记录 1 次，`candidates: 0` | Runtime verified |
| `delegationDepth: 0` 为合法根会话 | 并行会话 `session-280861aa-…`：`origin: null` + `delegationDepth: 0`，非 subagent | Runtime verified |
| `usage` 可选字段缺省 | 候选记录中 `reasoningTokens` 缺省而记录整体可读 | Runtime verified |
| Agent Loop 未受影响 | Turn 正常推进至 44 step；监听器异常 0；无中断 | Runtime verified |

### 仅推断（有实现依据，未在运行时直接观察）

| 项 | 依据 | 限制 |
| --- | --- | --- |
| `session/disposed` 随会话卸载触发 | 事件存在于目录，实现中于 detach 路径 dispatch | DSH 进程存活期内会话不卸载，无法观察 |
| `ctx.on` 监听器随 Fiber dispose 自动注销 | Cordis 生命周期语义与 `ctx.on` 签名 | 原型未经历卸载 |
| 顶层会话「先见 `turn/start`」路径下的候选结果 | `turn/start` 分支已写入 `sawTurnStart=true` 与真实 `startAt`；同一 `turnOf` 路径 | 该路径的候选需在后续 Turn 读取，本阶段未读取到 |

### 尚未验证

- `max-tokens` / `error` / `aborted` / `blocked` / `interrupted` 五种 `turn/end` kind 的真实触发。
- `credentials.resolve` 的实际调用（Phase 1 不使用凭据）。
- 插件 dispose 后的监听器释放与 `Map` 清理的运行时确认。

---

## 3. Prototype

| 项 | 值 |
| --- | --- |
| Plugin ID | `mailnt-1`（全程唯一，未新建 Plugin） |
| Package 版本 | `pkg-1` → `pkg-2` → `pkg-3` → `pkg-4` |
| 当前 Run | `run-4`（`pkg-4`），state = running |
| 平台 | **Host-only**（无 Client half） |
| 使用的 Service | **无**。仅 `ctx.on` / `harness.defineTool` / `harness.registerTool` / `ctx.effect` |
| 动态工具 | `mail_notify_probe`（只读诊断） |
| 是否发送邮件 | **否**。无网络、无 SMTP、无凭据、未安装 Nodemailer |

各 revision 的实质变更：

| Package | 变更 |
| --- | --- |
| `pkg-1` | 事件观察 + 候选日志，含 mid-turn 缺陷 |
| `pkg-2` | 增加 `mail_notify_probe` 工具，使证据可读取 |
| `pkg-3` | 修复 mid-turn `TurnState` 丢失；时长未知写 `null`；增加 `session/disposed` 释放 |
| `pkg-4` | lossless-JSON 归一化（修复 `undefined` 可选字段）；根/子会话判定严格化 |

### 实际监听到的事件类型（观察窗口内累计）

```text
tool/result 76   assistant/message 48   tool/call 75
step/start 49    step/end 49            turn/start 2    turn/end 2
agent/inbox/spliced 6   user/message 6  request/header 2
subagent/catalog 1   system/message 1   permission/preset 1
```

监听器调用 320+ 次，处理异常 0 次。所有证据通过 `mail_notify_probe` 读取，**未依赖不可达的 Host 标准输出**。

---

## 4. Tests

| Test | Result | Evidence Level | Evidence |
| --- | --- | --- | --- |
| 普通 Turn completion（`turn/start` → `assistant/message` → `turn/end` → candidate） | 通过 | **Runtime verified** | 候选记录 `turn: 4`：`status: "completed-clean"`、`assistantEvents: 3`、`visibleTextLength: 882`、`toolResultCount: 4`。完整链在 subagent 会话上从 `turn/start` 起全程观察 |
| 有工具调用的 Turn（多 Step，不得在首个 `assistant/message` 即判完成） | 通过 | **Runtime verified** | 主会话 turn 1 达 44 step、23 次 `tool/result`；候选仅在 `turn/end` 产出，未在任何 `assistant/message` 提前产出 |
| Subagent filter | 通过 | **Runtime verified** | 3 个 subagent：`origin: "subagent"`、`parentSession: <主会话>`、`delegationDepth: 1`；各产出 1 条 `MAIL_NOTIFY_SKIP_SUBAGENT`，`candidates: 0` |
| 根会话不被误判为 subagent | 通过 | **Runtime verified** | 并行根会话 `origin: null` + `delegationDepth: 0` → `isSubagent: false, decidedBy: null` |
| Reasoning 隔离 | 通过 | **Runtime verified** | 运行时存在 `["reasoning","text","tool-call","tool-call"]` 混合块，`visiblePreview` 仅含 text 内容；另有 `["reasoning","tool-call"]`（无 text）时 `visibleTextLength: 0` 且不污染既有 `lastVisibleText` |
| 未知 content block 安全跳过 | 通过 | **Logic only** | 提取函数为类型白名单，`blockType()` 对非对象返回 `undefined`；未构造真实未知 block 样本，仅结构保证 |
| completion 分类：`completed-clean` | 通过 | **Runtime verified** | `turnEndKind: "completed"` + `toolErrorCount: 0` → `status: "completed-clean"`（turn 4） |
| completion 分类：`completed-with-tool-errors` | 判据成立，组合未复测 | **Logic only** | `isError: true` 真实记录存在（`FsError`/`FS_NOT_FOUND`），且该 Turn 的 `reason.kind` 为 `completed`，两者可同时成立；但修复后未在同时含工具错误的 Turn 上读取到候选记录 |
| `max-tokens` 分类 | 未触发 | **Interface verified** | `TurnEndReasonMap` 含 `{ kind: 'max-tokens' }`；分类分支已实现，运行时未触发 |
| `error` 分类 | 未触发 | **Interface verified** | 含 `{ kind: 'error'; error: LlmFailure }`；`reasonDetail.code` 提取已实现 |
| `aborted` / `blocked` / `interrupted` 分类 | 未触发 | **Interface verified** | 三种 kind 均已确认；`aborted.reason.kind` 的 `TurnCancelledCause` 提取已实现 |
| `usage` 可选字段序列化安全 | 通过 | **Runtime verified** | 候选记录 `usage` 可读：`{inputTokens: 255, outputTokens: 759, totalTokens: 187638, cacheReadTokens: 186624}`，`reasoningTokens` 缺省且不影响序列化。修复前同一场景使整个探针失败 |
| mid-turn 装载（`TurnState` 懒初始化） | 通过 | **Runtime verified** | `pkg-4` 于 turn 4 中途装载：候选 `sawTurnStart: false`、`telemetryComplete: false`、`durationMs: null`，但计数为真实累积值（`assistantEvents: 3`、`toolCallCount: 3`、`toolResultCount: 4`）。修复前同场景全为 0 |
| 时长未知不伪造 | 通过 | **Runtime verified** | mid-turn 场景 `durationMs: null`，未写 0；`durationMs: 0` 与 `null` 语义区别已固化 |
| 候选正文不含 reasoning / tool arguments / tool result / credential | 通过 | **Runtime verified** | 候选结构仅含标量元数据与 `visibleTextPreview`（≤200 字符，来自 `type === 'text'` 白名单）；无任何 reasoning 文本、无 tool arguments、无 tool result 原文、无凭据字段 |
| 邮件未发送 | 通过 | **Runtime verified** | 原型无 SMTP/网络/凭据代码；候选自带 `mailSent: false`；未安装 Nodemailer |
| Plugin 成功运行 | 通过 | **Runtime verified** | `cordis_inspect_self`：`state: running`、`currentPackageId: pkg-4`、`activeRun: run-4`，4 个 revision 保留 |
| Agent Loop 未被破坏 | 通过 | **Runtime verified** | 320+ 次监听调用、0 处理异常；Turn 正常推进至 44 step；无中断或异常退出 |
| `session/disposed` 状态释放 | 未触发 | **Not verified** | DSH 进程存活期内会话不卸载 |

---

## 5. Confirmed Event Flow

真实观察到的流程，未经推断补全。详见 `PHASE1_RUNTIME_CONTRACT.md` 的 Runtime-verified Event Flow 一节。

```text
── 完整链（原型先于 turn/start 装载）────────────────────────
turn/start
    ↓
step/start → assistant/message → tool/call → tool/result → step/end
    ↓   （重复 N 轮）
turn/end
    ↓
MAIL_NOTIFY_CANDIDATE                         [顶层会话]
MAIL_NOTIFY_SKIP_SUBAGENT                     [subagent 会话，不产候选]

── 中途装载链（turn/start 未观察）──────────────────────────
[turn 已在进行中：插件装载]
    ↓
assistant/message → tool/call → tool/result …   （懒初始化累积）
    ↓
turn/end → MAIL_NOTIFY_CANDIDATE
        sawTurnStart: false / telemetryComplete: false / durationMs: null
        计数为真实累积值

── 轮次边界 ────────────────────────────────────────────
turn/end (turn N) → MAIL_NOTIFY_CANDIDATE → turn/start (turn N+1)
```

与总设计文档预期流程的关键差异：总设计文档预期四个独立顶层事件顺序到达；真实运行时只有一个 `session/event`，四类事件均为其 `event.type` 取值，因此真实流程是**单入口 + 按 type 分派**。

---

## 6. Confirmed Field Paths

| 语义 | 路径 |
| --- | --- |
| 事件入口 | `ctx.on('session/event', (session, event) => …)` |
| 事件类型 / 时间 / 序号 | `event.type` / `event.time` / `event.seq` |
| payload 根 | `event.data` |
| Session ID | `session.id`（`String()` 后可作 Map 键） |
| cwd / preset | `session.header.cwd` / `session.header.agentPreset` |
| Subagent 首选判据 | `session.header.origin === 'subagent'` |
| Subagent 冗余判据 | `session.header.parentSession !== undefined`；`session.header.delegationDepth > 0`（**禁止**真值或键存在性写法） |
| Turn 编号 | `event.data.turn`（`turn/start`、`assistant/message`、`tool/*`、`turn/end` 均有） |
| Step 编号 | `event.data.step` |
| content blocks | `event.data.message.content` |
| **用户可见文本** | `event.data.message.content[i].text`，**仅当** `.type === 'text'` |
| message ID | `event.data.message.id` |
| provider / model | `event.data.message.source.provider` / `.model`（当 `.source.kind === 'model'`） |
| usage | `event.data.usage`（`inputTokens` / `outputTokens` / `totalTokens?` / `cacheReadTokens?` / `cacheWriteTokens?` / `reasoningTokens?`） |
| 是否被打断 | `event.data.interrupted === true` |
| 工具名 / 调用 ID | `event.data.name` / `event.data.callId` |
| 工具失败判据 A（窄） | `event.data.error !== undefined` → `.name` / `.code` |
| 工具失败判据 B（宽，推荐主导） | `event.data.message.content[0].isError === true` |
| completion kind | `event.data.reason.kind` |
| aborted detail | `event.data.reason.reason.kind` |
| error detail | `event.data.reason.error.code` / `.message` / `.status` |
| 会话卸载 | `ctx.on('session/disposed', (session) => …)` → `session.id` |

---

## 7. Risks / Unknowns

1. **顶层会话「从 `turn/start` 起完整覆盖」的候选记录尚未读取到。** 该路径的代码与 mid-turn 路径共用同一个 `turnOf`，`turn/start` 分支写入 `sawTurnStart = true` 与真实 `startAt`，逻辑上唯一差异是 `durationMs` 会得到真实数值；但本阶段读取到的可读候选（turn 4）属 mid-turn 情形。verification 需在后续 Turn 读取一次 `sawTurnStart: true` 的候选。不构成阻塞：完整链本身已在 subagent 会话上从 `turn/start` 起全程验证。

2. **`completed-with-tool-errors` 的组合未复测。** 两个输入各自已运行时确证——`isError: true` 真实存在，且同一 Turn 的 `reason.kind` 为 `completed`——但修复后未在同时含工具错误的 Turn 上读到候选记录。

3. **工具失败判据的选择需要 Phase 2 明确。** 源码级结论：`message.content[0].isError` 是**宽**信号（覆盖工具抛错、参数校验失败、策略拒绝、post-execute 拦截、超时、中止、未解析调用闭合）；`event.data.error` 是**窄**信号，仅在抛出的异常是 `HarnessError` 子类时才非空（`errorInfo` 只在该条件下返回 `{name, code}`）。此外 **bash/pwsh 非零退出被设计为成功**，只在文本中附 `[exit code: N]`，不计入 `isError`。原型当前采用两者取或，因此 `toolErrorCount` 会**漏计**「命令执行不成功」这一类。Phase 2 需明确取舍并写入文档。

4. **`session/disposed` 与 Fiber dispose 清理未实证。** DSH 进程存活期内会话不卸载，该事件及依赖它的 `Map` 释放路径仅有实现层依据。

5. **五种非 completed 的 `turn/end` kind 未真实触发。**

6. **`durationMs` 在 mid-turn 情形恒为 `null`。** 这是设计取舍而非缺陷，但意味着若正式插件在 Turn 中途被启用，第一批 Turn 的耗时数据不可用。

7. **`usage` 计数器语义未确认。** 候选记录中 `inputTokens: 255` 与 `totalTokens: 187638` 在数量级上不自洽。原型如实读取并原样记录，未做任何推算。交付层若展示 token 统计，需先单独确认这些计数器的实际语义（增量/累计、是否含缓存）。

8. **原型是进程内临时对象。** DSH 进程重启后 `mailnt-1` 与全部 Package 不再存在；本阶段结论的可复现性依赖两份文档记录的契约。

9. **Host 标准输出不可达。** 本阶段通过自建 `mail_notify_probe` 获取证据，该工具仅在原型运行期存在。Phase 2 的正式插件需要自己的可观测路径。

---

## 8. Decision for Phase 2

六项条件逐项判定：

| # | 条件 | 判定 | 依据 |
| --- | --- | --- | --- |
| 1 | 能可靠识别顶层 Session | **满足** | 三判据 + 严格 `> 0` 比较；3 个 subagent 与 2 个根会话（含 `delegationDepth: 0`）全部判定正确 |
| 2 | 能监听 Assistant 完整消息 | **满足** | 48+ 次 `assistant/message` 全量取得 `content` / `id` / `source.provider` / `source.model` / `usage` |
| 3 | 能只提取用户可见文本 | **满足** | 白名单 `type === 'text'`；混合块与纯 reasoning 消息两种情形均运行时验证 |
| 4 | 能监听 Turn completion | **满足** | `turn/end` 4 次真实捕获；`event.data.reason.kind` 可读 |
| 5 | 原型未导致 DSH Agent Loop 异常 | **满足** | 320+ 次监听调用，`containedErrors: 0` |
| 6 | 至少完成一次真实 Turn completion 验证 | **满足** | 真实 Turn 结束并产出 `MAIL_NOTIFY_CANDIDATE`，记录可完整序列化读取 |

**结论：具备进入 Phase 2 的条件。**

Phase 2 首个动作应当是依据第 7 节第 3 项确定 `toolErrorCount` 的判定口径——这是本阶段唯一移交的实质设计决策。
