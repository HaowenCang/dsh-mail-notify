# Phase 8.1 Report — Approval E2E + Credential Contract Closure

本报告记录 Phase 8.1 的结果。阶段目标只有三项，且未做任何设计变更、未新增功能、未发布：

```text
1. 补齐 approval 的真实装配端到端证据
2. 裁决凭据引用契约的分歧
3. 重跑完整的 release-candidate 门禁
```

最终结论：

```text
PASS — v0.2.0 RC READY
```

本阶段未执行且不得执行的动作均未执行：无 `npm publish`、无 `git tag v0.2.0`、无 GitHub Release、未合并到 `main`。

---

## 1. Baseline

阶段开始时逐项确认：

| 项 | 值 |
| --- | --- |
| branch | `feat/v0.2.0-human-attention` |
| 阶段开始时本地 HEAD | `5c29a2a`（`docs: reconcile the Phase 8 notes with the sections they annotate`） |
| `origin/main` | `229637580284621f38e3820c94b7f49208cd3962` |
| `rev-list --left-right --count origin/main...HEAD` | `0 6`（本分支领先 `main` 六个提交，落后零） |
| working tree | 干净（`git status --porcelain` 无输出） |
| `v0.1.1` tag | 注释对象 `819fde114357cb653d8ad902f74a8fd35d30a0af` → commit `340ef3624126bc4cf8bd0f2c26394371e4fa7b56` |
| `v0.1.0` tag | 注释对象 `0d113e70406330c373eb0a1fef6cc8e78a837c30` → commit `02191a43894f7cf9323641a1d117ae838c4a0c88` |
| npm 已发布版本 | `0.1.0`、`0.1.1`（`npm view dsh-mail-notify versions`）；**无 `0.2.0`** |
| 远端 tag | `refs/tags/v0.1.0`、`refs/tags/v0.1.1`，与本地逐字符一致 |

`main..HEAD` 恰好包含 Phase 8 的六个提交：

```text
7cfd117 feat: add terminal failure notifications
4989fda feat: add human-attention notifications
fb3ca5d test: cover failure and interaction mail paths
fb2088c docs: document v0.2.0 notification semantics
fb18ea1 docs: list the Phase 8 report in the documentation table
5c29a2a docs: reconcile the Phase 8 notes with the sections they annotate
```

两个已发布 tag 全程未被移动或改写；本阶段结束时其对象与目标 commit 与上表逐字一致。

---

## 2. Approval 真实装配端到端

### 2.1 此前为何失败

Phase 8 的 `approvals` 场景把审批触发寄托在「`pwsh` 写工作区外文件 → 沙箱升级 → 审批」这条路径上。本阶段复现了该失败：该路径的 turn 结果为 `completed-with-tool-errors`，`pwsh` 调用本身未成功执行，`approval/asked` 从未追加。同时确认了第二个更根本的约束：本机 `DSH_PERMISSION_MODE` 为 `danger-full-access`，`dsh-base` 据此把 approval policy 求值为 `never`（`cordis.patch.yml`：`policy: !!js "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'"`），而 `never` 在 waterfall 之前就确定性地拒绝，根本不产生审计记录。

因此 Phase 8 报告第 8.3 节对失败原因的三条描述属实，但其结论「approval 通知只到集成层」在本阶段被取代。

### 2.2 本阶段的构成

新增一个**隔离的、approval-capable 的 composition**，不触碰操作者的 profile：

| 项 | 内容 |
| --- | --- |
| profile | 出厂 `headless`（`dsh-base` + `dsh-headless`），叠加 `scripts/probe/overlay-base.yml` |
| `DSH_HOME` | 一次性目录 `tmp/probe/home`，每次运行前整体重建 |
| **effective approval policy** | **`ask`** —— 由叠加层 `- id: approval / config: { policy: ask }` 显式钉住，因此与操作者的 permission preset 无关 |
| 模型 | `probe-scripted`（脚本化 provider，经 `ctx.llm.registerAdapter` 注册） |
| 工具 | 出厂工具树 + `ask_user_question` + `probe_request_approval`（测试专用） |
| ApprovalService | **出厂** `@deepseek-ai/dsh-user-approval` |
| scripted answerer | `scripts/probe/auto-answer.mjs`，注册在官方 `approval/request` waterfall 上 |
| dsh-mail-notify | `lib/index.js`（真实构建产物） |
| SMTP | 回环服务器，端口由操作系统分配 |

**被测插件依然不注册 `approval/request`。** 该 waterfall 上只有人工替身；插件只观察持久化的 `approval/asked`。这一点在实现中可静态核验（`src/index.ts` 的注册集合只有 `session/event` 与 `session/disposed`），也在运行中可核验（替身与插件的日志互不干涉）。

### 2.3 审批请求的来源

`arguments` 侧不在 Turn 内创建探针；审批请求**源自一次真实的工具执行**。

出厂工具树中唯一会合法调用 `ctx.approval.request()` 的路径是沙箱化 shell 工具的升级重试与 `tools` 管线的策略步骤。前者在本环境不可达（无升级对象），后者在工具体之前提问、无法瞄准时刻。因此按 Phase 8.1 §6 允许的第二条路径，在隔离 composition 中注册了测试专用工具 `probe_request_approval`：它是**普通注册工具**，由真实 agent loop 决定调用、经真实注册表校验参数并派发，其 `execute()` 在活动工具执行内部调用真实的：

```text
ctx.approval.request({ agent, toolName, callId, reason, signal })
```

仅在审批路径上被替换的是「人」与「模型的 token」。agent loop、`tool/call`、工具执行、`ApprovalService`、`Session.append`、插件的 `session/event` 监听器、队列、mailer 与 SMTP 会话全部为生产机制。

作为反向证据，`approval.request()` 的 Turn 前置条件在本阶段被再次确认是硬约束：源码中 `hasOpenTurn(session)` 不成立时抛出 `approval.request() outside an open turn…`，且该抛错发生在任何 append 之前。Phase 8 的两次 out-of-turn 尝试因此是预期行为，本阶段未重复。

### 2.4 scripted answerer 的行为

替身只做三件事，且都记录在自己的时间线上：

1. 观察请求，并从**活跃 session log** 读回本次交互的 service-issued id（DSH 的 `request()` 先 append `approval/asked`，随后把**不含 id** 的公开 `ApprovalRequest` 派发给 waterfall，故日志是替身唯一能获知身份的地方；该读取有界，只读类型与 id）。
2. 有意等待，直到探针通过 SMTP 观察到审批邮件到达，然后才返回结果。
3. 返回脚本化的 outcome（`allowed-once` / `rejected`）。

第 2 条是本阶段证据强度所在：它把「邮件已发出」变成「通知在审批仍然 pending 时抵达了邮件系统」。固定 sleep 会留下竞态——在慢机器上邮件可能落在决定之后——而无法区分这两种情形的通过不是证据。运行输出同时打印 `releasedBy=mail-observed` 与 `waitedMs`，若走的是超时路径会明确显示 `releasedBy=timeout`。

### 2.5 实测链（allowed-once）

```text
+  1943 ms  runtime: turn/start seq=4 turn=1
+  2007 ms  runtime: step/start seq=6 turn=1 step=1
+  2025 ms  runtime: assistant/message seq=15 turn=1 step=1 blocks=[tool-call]
+  2026 ms  runtime: tool/call seq=16 turn=1 step=1 tool="probe_request_approval" callId="probe-call-1"
+  2037 ms  runtime: approval/asked seq=18 tool="probe_request_approval" callId="probe-call-1" id="7eba4252-…"
+  2039 ms  answerer: approval/request received … id=7eba4252-… logTail=approval/asked-present
+  2053 ms  SMTP: DATA accepted -> "[DSH] Approval required — probe_request_approval"
+  2077 ms  answerer: approval/request released by=mail-observed waitedMs=37
+  2078 ms  runtime: approval/decided seq=19 id="7eba4252-…" outcome="allowed-once"
+  2081 ms  runtime: tool/result seq=21 turn=1 step=1 isError=false
+  2090 ms  runtime: step/start seq=23 turn=1 step=2
+  2094 ms  runtime: assistant/message seq=24 turn=1 step=2 blocks=[text]
+  2095 ms  runtime: turn/end seq=26 turn=1 kind=completed
+  2101 ms  SMTP: DATA accepted -> "[DSH] Task completed — probe-scripted"
```

关键不变量成立：`approval/asked`（seq 18）位于 `turn/start`（seq 4）与 `turn/end`（seq 26）之间，即**在打开的 Turn 内**，且严格早于 `approval/decided`（seq 19）。`step/end`（seq 22）之后出现了**新的** `step/start`（seq 23），证明 Turn 是继续而不是重启。

投递计数：

| 场景 | 实测投递 | 退出码 |
| --- | --- | --- |
| `approvals`（allowed-once） | **2 封**：`[DSH] Approval required — probe_request_approval`、`[DSH] Task completed — probe-scripted` | 0 |

---

## 3. Approval allowed-once 个案

- 触发：一次真实工具执行内的 `ctx.approval.request()`。
- 结果：`allowed-once`。
- 邮件：**恰好一封**「Approval required」，随后一封完成邮件。
- 工具恢复：`tool/result … isError=false`，工具内部记录 `resumed with allowed-once`。
- Turn 结束：`kind=completed`，`status=completed-clean`。

**审批邮件正文**（原文，来自 `tmp/probe/out/smtp-approvals.json`）：

```text
Status:    Waiting for a human
Session:   session-9e4c42e0-0d60-4a6d-adb0-be6802b87d2f
Workspace: E:\Projects\DSHarness\dsh-mail-notify
Observed:  2026-09-18T16:01:17.881Z

--- Approval ---
Tool: probe_request_approval
Reason: the probe needs a one-shot grant before it performs the action
Tool arguments: not published by DSH and not included in this message.

Open DSH to answer this request. This message is a notification only; it cannot be answered by reply.
```

逐项核对 Phase 8.1 §8 的最低字段要求：

| 要求字段 | 实测 |
| --- | --- |
| workspace | `Workspace: E:\Projects\DSHarness\dsh-mail-notify` |
| session | `Session: session-9e4c42e0-…` |
| turn context（若可用） | **不可用**：`approval/asked` 的 payload 无 `turn` 字段，turn 上下文是位置性的。正文不伪造该行。 |
| tool name | `Tool: probe_request_approval` |
| reason（若提供） | `Reason: the probe needs a one-shot grant…` |

`callId` 的处置**显式裁决**：它出现在 DTO（`ApprovalNotification.callId`）、日志字段（`hasCallId`）与去重键中，**不进入正文**。理由与 `requestId` 在故障邮件中的处置同源——它是诊断标识而非读者需要的信息，且 DSH 已把它链接到界面上已经展示过的 tool call。因此正文中不存在任何 id。

不外发内容的**实测**验证方式不是「字段里没有」，而是在工具参数中植入 sentinel `PROBE_TOOL_ARGUMENT_SENTINEL_9f2c41`，然后在运行输出上断言它不出现于：原始 SMTP 载荷、插件的 stderr、插件的 stdout。

```text
clean | the approval's tool arguments are absent from raw SMTP payloads
clean | the approval's tool arguments are absent from plugin stderr
clean | the approval's tool arguments are absent from plugin stdout
```

由于正文是**逐字段**构造的（`toApprovalNotification` 只拷贝 `toolName`、`callId`、`reason`、`cwd`，无任何 spread），tool arguments / tool result / reasoning / system prompt / credential / Web token 都没有安放的字段；sentinel 断言是对这一结构性事实的运行期复核。

---

## 4. Approval 去重个案

`approvals-duplicate` 场景在允许路径之上增加一步：工具在决定返回后，把**同一个 service-issued id** 的 `approval/asked` 通过真实 `Session.append()` 再追加一次。该 id 由替身从活跃 session log 读出后落盘，工具读取该文件。

```text
+  2037 ms  runtime: approval/asked seq=18 id="7eba4252-…"          ← 服务追加
+  2039 ms  answerer: approval/request received …
+  2053 ms  SMTP: DATA accepted -> "[DSH] Approval required — …"     ← 此时仍 pending
+  2078 ms  runtime: approval/decided seq=19 outcome="allowed-once"
+  2079 ms  runtime: approval/asked seq=20 id="7eba4252-…"          ← 工具追加的重复
+  2081 ms  runtime: tool/result seq=21 isError=false
+  2095 ms  runtime: turn/end seq=26 kind=completed
+  2101 ms  SMTP: DATA accepted -> "[DSH] Task completed — …"
```

| 指标 | 实测 |
| --- | --- |
| 该 id 的 `approval/asked` 记录数 | **2**（重复确实进入了日志，不是「重放没发生」） |
| 不同 approval id 数 | 1 |
| 该 Turn 的总投递 | **2 封**：审批邮件 + 完成邮件 |

因此：重复的 `approval/asked` 只产生一封审批邮件，且审批去重键**没有**消耗 Turn 完成键。`approval:` 与 `turn:` 两个命名空间的独立性由此在真实装配中被证明，而不只是在 `DED-*` 的键构造断言层面。

---

## 5. Approval 拒绝个案

`approvals-rejected` 场景把替身的返回改为 `rejected`。

```text
+  1998 ms  runtime: approval/asked id="886945a2-…"
+  2012 ms  SMTP: DATA accepted -> "[DSH] Approval required — …"
+  2131 ms  runtime: approval/decided outcome="rejected"
+  2131 ms  answerer: approval/request answering rejected
+  2133 ms  runtime: tool/result seq=20 isError=true
+  2143 ms  runtime: step/start seq=22 step=2
+  2147 ms  runtime: assistant/message seq=23 blocks=[text]
+  2148 ms  runtime: turn/end seq=26 kind=completed
+  2154 ms  SMTP: DATA accepted -> "[DSH] Task completed with tool errors — …"
```

| 要求 | 实测 |
| --- | --- |
| `approval/asked` | 出现一次 |
| 一封 approval-required 邮件 | **恰好一封** |
| `approval/decided` 为 `rejected` | 是 |
| 工具收到拒绝 | 是：`tool/result … isError=true`，工具体返回错误「the decision was "rejected", so the requested action was not performed」 |
| `decided` 时不再发第二封「approval required」 | 是：全程只有一封审批邮件 |

**Turn 的后续结局按实际记录、不予制造**：拒绝之后 agent loop 进入了新的 `step/start`（seq 22）、产出最终文本，并以 `turn/end kind=completed`（seq 26）结束；因为有一个工具报错，`status` 为 `completed-with-tool-errors`，完成邮件的主题相应为 `[DSH] Task completed with tool errors — probe-scripted`。这是真实工具/Agent 行为，不是脚本指定。

---

## 6. 凭据契约裁决

**结论：Phase 8 的凭据诊断「incorrect and reverted（错误，已撤销）」。**

### 6.1 实际安装的 DSH 取证

| 项 | 取证结果 |
| --- | --- |
| 安装位置 | `C:\Users\20659\node_modules\@deepseek-ai\` |
| `@deepseek-ai/dsh` version | `0.1.5-rc.1` |
| `dsh-credentials` version | `0.1.5-rc.1` |
| `dsh-credentials-local` version | `0.1.5-rc.1` |
| `CredentialRef` 构造/辅助 | `credentialRef(value)`：`if (!isCredentialRefName(value)) throw new TypeError(...)`，返回 `brandString(value)`（`dsh-credentials/lib/types/index.js:20`） |
| `CredentialRef` 文法 | `const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/`（同文件 L12） |
| `CredentialKey` 文法 | `const KEY_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/`；`credentialKey(scope, id)` 逐段校验，`parseCredentialKey(value)` 要求恰好两段（同文件 L14、L57、L72） |
| `credentials.resolve()` 参数类型 | `resolve(ref: CredentialRef): Promise<ResolvedCredential \| undefined>`（`dsh-credentials/lib/types/index.d.ts:129`） |
| `credentials.describe()` 参数类型 | `describe(ref: CredentialRef): Promise<CredentialInfo>`（同文件 L136） |
| 本地 provider 存储格式 | `$DSH_HOME/.credentials.yaml`，顶层两段：`refs:`（POSIX 标识符键 → 非空字符串值）与 `records:`（`<scope>/<id>` 键 → 带 `kind` 标签的记录）。解析入口 `parseCredentialsDocument()`，`refs` 段每个键调用 `credentialRef()`（`dsh-credentials-local/lib/index.js:193`），`records` 段每个键调用 `parseCredentialKey()`（同文件 L204） |
| 层优先级 | `resolve()` 依次读继承环境快照（`source: 'env'`）、文档快照（`source: 'file'`）、`.env` 回落（`project-env` / `user-env`）；`records` **不参与** |

### 6.2 `CredentialRef` 与 `CredentialKey` 的区分

两者是同一个 seam 上**互不相通**的两个键空间，DSH 的类型注释明确说明 `/` 的存在正是为了让两个文法不相交、使一个主体永远不会对「它属于哪个键空间」产生歧义：

| 概念 | 角色 | 文法 | 入口方法 | 文档位置 |
| --- | --- | --- | --- | --- |
| `CredentialRef` | 「这个环境变量名背后是什么」——按继承环境、provider 管理的 store、`.env` 分层解析 | `^[A-Za-z_][A-Za-z0-9_]*$` | `resolve` / `describe` / `set` / `unset` | `.credentials.yaml` 的 `refs` 段 |
| `CredentialKey` | 「这个插件为这个 id 持有什么凭据」——不做分层，记录存在与否即是全部事实 | `<scope>/<id>`，每段 `^[a-z][a-z0-9-]*$` | `readRecord` / `describeRecord` / `modifyRecord` / `deleteRecord` / `listRecords` | 同一文件的 `records` 段 |

插件的 `smtpPasswordCredential` 被交给 `resolve()` 与 `describe()`，因此其校验必须匹配这两个方法要求的类型，即 `CredentialRef`。`<scope>/<id>` 是 `CredentialKey`，而 `resolve()` **从不查询** `records`：本机取证实测 `resolve("credentials/smtp-password")` 返回 `undefined`、`describe()` 报 `configured: false`。

Phase 8 的错误在于把 `records` 段的寻址当成了引用的文法。该错误的实际后果不是「拒绝了一个合法部署」，而是「接受了一个永远解析不到的引用」——把一次本可在挂载期报出的配置错误推迟到每一次投递尝试，并以「未配置」这一误导性诊断呈现。

### 6.3 处置（Outcome A）

`src/config.ts` 的 `CREDENTIAL_REF_PATTERN` 回归为：

```text
^[A-Za-z_][A-Za-z0-9_]*$
```

与 DSH 的 `REF_PATTERN` 逐字符相同，且**仅接受这一种形式**。`has-dash` 这类含连字符的名字同样被拒——POSIX 标识符没有连字符，环境层无法承载该名字，引用文法因此也不接受它。

新挂载期错误信息：

```text
smtpPasswordCredential "credentials/smtp-password" is not a valid credential reference name
(expected ^[A-Za-z_][A-Za-z0-9_]*$, the DSH CredentialRef grammar;
 a `<scope>/<id>` CredentialKey addresses the record half of the store and cannot be resolved here)
```

本机未安装第二个受支持的 DSH 版本（`peerDependencies` 声明 `^0.1.5-rc.1`，实际安装即 `0.1.5-rc.1`；项目此前只承诺并验证过该版本），因此不存在 Outcome B 所描述的版本分流需求。

### 6.4 「不以密钥巧合通过」的验证

Phase 8.1 §14 要求同时证明「校验器接受该引用」与「CredentialService 能解析同一引用」，且不得从环境回落、其它凭据层或环境态巧合中推断正确性。实现方式：

- **隔离的 `DSH_HOME`**：探针每次运行前整体重建 `tmp/probe/home`，其中写入一份只含一条引用的 `.credentials.yaml`。
- **单一受控来源**：出厂 `@deepseek-ai/dsh-credentials-local` 被指向该文件（`credentials` 行 `path` 覆盖），不再是替身。
- **主动排除环境回落**：探针在派生子进程前从环境中**删除** `DSH_MAIL_SMTP_PASSWORD`，并在运行期逐一断言三个环境层均不供给该值。
- **来源元数据即证据**：`resolve()` 返回 `source: 'file'`，`describe()` 返回 `configured: true, source: 'file', writable: true`。
- **精确值比对**：合成值经环境变量传给校验器，与其实际写入文档的值逐字符比较，而不是只比长度。

真实 provider 上的实测输出（`npm run probe:credentials`，14 项全 PASS、0 FAIL）：

```text
installed dsh-credentials        0.1.5-rc.1
installed dsh-credentials-local  0.1.5-rc.1
PASS | credentialRef("DSH_MAIL_SMTP_PASSWORD") | credentialRef accepts: true, isCredentialRefName: true
PASS | credentialRef("has-dash") | credentialRef accepts: false, isCredentialRefName: false
PASS | credentialRef("credentials/smtp-password") | credentialRef accepts: false, isCredentialRefName: false
PASS | a CredentialKey is not a CredentialRef | credentialRef accepts it: false
PASS | a CredentialRef is not a CredentialKey | parseCredentialKey("DSH_MAIL_SMTP_PASSWORD") is accepted: false
PASS | the document admits this reference in `refs` | refs entries: 1, records entries: 0
PASS | the document refuses a CredentialKey in `refs` | rejected: credential ref "…" must match /^[A-Za-z_][A-Za-z0-9_]*$/
PASS | the value is absent from every environment layer | process=false project-env=false user-env=false
PASS | resolve(DSH_MAIL_SMTP_PASSWORD) returns the stored value from the file layer | resolved: true exact value match: true source: file length: 37
PASS | describe() reports the reference configured without exposing it | configured: true source: file writable: true
PASS | resolve() cannot read a CredentialKey reference | resolve("credentials/smtp-password") -> undefined; describe configured: false
```

回归测试层面，`tests/integration/credential-contract.test.ts` 以**安装的** `credentialRef()` / `isCredentialRefName()` / `credentialKey()` / `parseCredentialKey()` 为基准，对 24 个候选逐项比对插件自己的模式副本。这是该缺陷类别唯一能被抓住的方式：拿插件自己的模式做基准，测的正是出错的那一份。

`DSH_MAIL_SMTP_PASSWORD` 的「valid and resolvable」因此由两处独立证据共同支持：测试套件证明校验器与 DSH 辅助函数一致，探针证明真实的 `CredentialService` 能从受控来源解析它。

### 6.5 探针的凭据层由替身改为出厂 provider

Phase 8 的探针用 `scripts/probe/fake-credentials.mjs` 发布了一个凭据服务替身，从单个环境变量解析一个硬编码引用。该替身使邮件链路可以不带真实密钥运行，但也使「插件配置里的引用是否合法」这一问题完全无法被这次运行回答——一个接受任意字符串的替身只能证明替身宽容。本阶段改为把**出厂** provider 指向一次性目录，替身文件已删除。这同时是对 Phase 8 §8.1「被替换的只有人和 SMTP 服务器身份」这一表述的修正：v0.2.0 的探针还替换了凭据服务，现在不再替换。

---

## 7. `QuestionDropReason.'content-limit'` 的处置

Phase 8 报告把该成员记为「在当前界限下不可达」。本阶段独立复核并给出处置。

**可达性论证。** 该原因只在「本次调用未携带任何问题，且有某个问题被运行总量界限拒绝」时上报。这两个条件当前不可能同时成立：

- 单个良构问题的成本上限为 `MAX_QUESTION_CHARS + MAX_QUESTION_ID_CHARS = 2000 + 200 = 2200`，低于 `MAX_TOTAL_QUESTION_CHARS = 6000`，因此首个良构问题必被携带；
- 尺寸界限只能在已有问题被携带**之后**拒绝后续问题，于是结果必然是部分携带，而 `dropReason` 只在 `questions.length === 0` 时计算。

第 2 点比 Phase 8 报告的表述更强：报告写的是「首个问题必被携带」，实际成立的是「尺寸界限的拒绝**蕴含**已有携带」。

**裁决：保留该成员，并标注为保留值。**

理由：解析器的记账仍会赋值 `truncatedBySize`（`parseAskUserQuestionArguments` 的循环内），若两个界限的相对大小在未来改变，该值会立即变为可达；删除它会让一个仍在使用的取值脱离词汇表。保留的代价是一个联合分支加一个测试。

**测试支撑。** 既不删除也不靠「不可达」这一断言本身：

- `HAT-11c` 证明边界：解析器可携带的最大集合仍在总额度内，`dropReason` 未定义且明确不为 `content-limit`。
- `HAT-11e`（本阶段新增）证明不可达性的**成因**：用耗尽额度的夹具（5 个 1495 字符问题，成本 7485）让尺寸界限真实触发——实测携带 4 个、`droppedFields` 为 `['questions[4]']`、`dropReason` 未定义。该测试因此同时钉住两件事：尺寸界限确实会拒绝，以及拒绝之后必然是部分携带。
- `src/types.ts` 的该联合分支上附有结论性注释，指向这两个测试。

未重新设计解析器，未改变任何界限常量。

---

## 8. `parentSession` 子代理判据复核

Phase 8 记录过一个理论性担忧：fork 出的会话也携带 `parentSession`，故三判据的第二条可能把用户主动 fork 的会话判为子代理。本阶段对照本机安装的 DSH 源码复核，结论是**担忧成立，但范围比记录更窄**：

| 事实 | 取证 |
| --- | --- |
| 子代理子会话的 header | `dsh-subagent` 的 `childSessionMeta()`（`lib/index.js:502`）同时写入 `origin: 'subagent'`、`delegationDepth: parent + 1`、`parentSession: parent.id` |
| 该函数的覆盖面 | 被 `dsh-subagent`（`lib/index.js:1697`）、`dsh-subagent/continuation.js:162`、`dsh-subagent-in-process-driver/index.js:183` 三条创建路径共同使用，即**全部**运行时子代理 |
| 一般 fork 的 header | `dsh-session` 的 `SessionStore.fork()`（`lib/index.js:1578`）只写 `parentSession` 与 `isSeeded: true`，**不写** `origin`、**不写** `delegationDepth` |
| 该路径的驱动者 | `session/fork` 远端命令（`dsh-api-session-controller`），即用户主动的会话分支 |

因此第一条判据（`origin === 'subagent'`）覆盖全部运行时子代理；第二条判据只在**用户主动 fork** 这一种情形下单独成立。**未观察到任何真实子代理被误判**，故按 Phase 8.1 §17 的要求，三判据及其优先顺序**保持不变**，本阶段未改动任何分类行为。上表事实作为后续复核依据记入 `DECISIONS.md` A15。

需要注意与 Phase 8 报告措辞的差别：Phase 8 说「fork 出的子会话也携带 `parentSession`，因此一个用户主动 fork 的顶层会话可能被判为子代理」——该表述在事实上正确，但它容易被读成「子代理判定不可靠」，而实际结论是相反的（子代理判定由第一条判据承担，第二条只影响用户 fork）。这是本阶段对该条记录的精确化，不是行为变更。

---

## 9. 回归套件

全部命令在最终源状态下执行，退出码均为 0：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 文本完整性 | `npm run check:text` | PASS — 95 个文本文件，严格 UTF-8、无 BOM、无 mojibake |
| 类型检查 | `npm run typecheck` | 退出码 0（`tsconfig.json --noEmit` 与 `tsconfig.test.json` 均通过） |
| 测试 | `npm test` | **409 pass，0 fail，0 cancelled，0 skipped，0 todo** |
| 构建 | `npm run build` | 退出码 0 |
| 打包 | `npm pack` | `dsh-mail-notify-0.2.0.tgz`，84 entries |
| 归档审计 | `npm run pack:check` | PASS — required entries present, no forbidden entry |
| 密钥扫描 | `npm run scan:secrets` | PASS — 84 entries，467 164 bytes，credential-value hits=0，shaped-literal hits=0 |
| 生产依赖审计 | `npm audit --omit=dev` | **0 vulnerabilities** |
| 全新安装 | 见 §10 | PASS |

测试计数：v0.1.1 的 336 项全部保留；Phase 8 结束时的 `npm test` 记录为 405 项；本阶段新增 4 项，达到 **409** 项。可核验的增量是 `git diff fb3ca5d..HEAD -- tests` 的 `2 files changed, 52 insertions(+), 9 deletions(-)`：`tests/unit/config.test.ts` 的一项拆为两项（净 +1）、`tests/unit/human-attention.test.ts` 新增 `HAT-11e`（+1）、`tests/integration/credential-contract.test.ts` 新增三项（+3），合计 +5 项减去 `human-attention.test.ts` 中被改写而非新增的那一项（净 +4）。无跳过、无弱化断言、无被删除的既有断言。

本阶段新增与调整：

| 文件 | 变化 | 覆盖 |
| --- | --- | --- |
| `tests/integration/credential-contract.test.ts` | 新增 3 项 | 插件模式副本与安装的 `credentialRef()` / `isCredentialRefName()` 逐候选一致；两个键空间不相交；`CredentialKey` 不是 `CredentialRef` |
| `tests/unit/config.test.ts` | 1 项拆为 2 项（净 +1） | 「凭据引用必须是名字而不是值」与「`CredentialKey` 被拒绝，因为 `resolve()` 读不到 record half」 |
| `tests/unit/human-attention.test.ts` | 新增 `HAT-11e` | 尺寸界限真实触发时必然是部分携带，从而证明 `content-limit` 不可达的成因 |

`APR-*`（8 项）、`FNL-*`（11 项）、`QUE-*`、`HAT-*`、`DED-*` 以及 v0.1.1 的全部 telemetry / duration / SMTP / privacy / packaging / credential / retry 断言均保持不变并通过。

---

## 10. 打包与全新安装

归档：`dsh-mail-notify-0.2.0.tgz`，84 entries（Phase 8 为 84 entries，本阶段未新增任何进入归档的源文件；`lib/` 中仅 `config.js` 与其声明发生变化）。

`scripts/` 不在 `files` 白名单内，因此本阶段新增的 `scripts/probe/approval-tool.mjs`、`scripts/probe/credential-contract.mjs`、`scripts/probe/timeline.mjs` 与重写过的 `scripts/probe-e2e.mjs` 均未进入归档；`npm run pack:check` 重新推导了这一点。

全新安装验证：在临时目录中 `npm install ./dsh-mail-notify-0.2.0.tgz`，然后：

1. 从安装的包导入成功：`name`、`inject`、`Config`、`apply` 齐备；默认值 `notifyErrors=false`、`notifyQuestions=false`、`notifyApprovals=false`、`enabled=true`。
2. **挂载门禁**：在最小 Cordis context 上以三种引用调用 `apply()`：

```text
"DSH_MAIL_SMTP_PASSWORD":    DSH isCredentialRefName=true  mounted=true
"credentials/smtp-password": DSH isCredentialRefName=false mounted=false  reason=<CredentialKey 说明>
"has-dash":                  DSH isCredentialRefName=false mounted=false  reason=<CredentialRef 文法>
```

第 2 项是本阶段新增的验证强度：Phase 8 只验证了「`<scope>/<id>` 形式的引用通过校验」，那是与被撤销的错误同向的验证；现在验证的是**安装产物**的挂载门禁与安装的 DSH 辅助函数判断一致，且不一致时给出可操作的诊断。

---

## 11. 安全

| 检查 | 结果 |
| --- | --- |
| 本报告与本阶段所有脚本不含任何凭据值 | 是。凭据证据只包含引用名、`configured` 状态、来源层名与文法 |
| SMTP 密码 | 探针使用合成值 `PROBE_SMTP_PASSWORD_NOT_A_REAL_SECRET`（37 字节），从不离开回环接口；任何输出只报 `length` |
| 授权码 / credential value | 未读取、未打印、未写入任何报告 |
| `scan:secrets` | PASS，credential-value hits=0，shaped-literal hits=0（该脚本从操作者自己的凭据文档读取真实值并只打印名字、长度与 sha256 前 8 位，从不打印值） |
| tool arguments 不外发 | 真实装配下以 sentinel 断言，覆盖原始 SMTP 载荷与插件 stderr/stdout |
| 控制字符 / 长度有界 / header injection 防护 | 未改动，既有 `HAT-*` 断言全部保留并通过 |
| 探针覆盖层不修改操作者 profile | 是。所有写入都发生在一次性 `DSH_HOME`（`tmp/probe/home`）内；`approval.policy: ask` 只作用于该 composition |

本阶段的探针改动带来一项需要记录的顺带事实：`tmp/probe/` 下的运行产物（含会话日志、SMTP 原始报文）仅在本地磁盘，已被 `.gitignore` 的 `/tmp/` 规则排除，不进入仓库。

---

## 12. Git

分支：`feat/v0.2.0-human-attention`（从 `main` 的 `2296375` 创建）。本阶段提交边界：

```text
fix: align smtp credential references with dsh contract
test: close approval e2e and credential contract gaps
```

未执行且不得执行：移动或改写 `v0.1.1` / `v0.1.0`、force push 已发布历史、合并到 `main`、打 tag、npm publish。两个 tag 的对象与目标 commit 在本阶段结束时与阶段开始时一致（§1 表格）。

分支已推送至 `origin`，推送后的远端 SHA 与工作树状态见 `PHASE8_1_REPORT.md` 交付说明与最终答复；本报告不写入自身的提交哈希（一个文件无法命名包含它自己的那个提交）。

---

## 13. 第 19 节要求的四条真实特性链

| # | 链路 | 证据 | 结果 |
| --- | --- | --- | --- |
| 1 | retry → recovery → 无故障邮件 | `FNL-07`（离线，真实事件总线）；探针 `errors` 场景证明终局故障恰好 1 封 | PASS |
| 2 | 终局 model/API 错误 → `turn/end` error → 一封故障邮件 | 探针 `errors`：1 封 `[DSH] Task failed — QUOTA (402)` | PASS |
| 3 | `ask_user_question` → 提问邮件 → 用户作答 → Turn 继续 → 完成邮件 | 探针 `questions`：2 封（`[DSH] Input required — Choose Mode`、`[DSH] Task completed — probe-scripted`） | PASS |
| 4 | **真实 Turn 内审批请求 → `approval/asked` → 审批邮件 → 审批决定 → 工具恢复 → Turn 继续或正常结束** | 探针 `approvals` / `approvals-duplicate` / `approvals-rejected`：时间线、投递计数与 sentinel 断言见 §2–§5 | **PASS** |

第 4 条即 Phase 8 缺失的证据，本阶段补齐。

---

## 14. RC 状态

```text
PASS — v0.2.0 RC READY
```

四条真实特性链全部通过，凭据契约已与安装的 DSH 对齐并取得真实 provider 证据，全部回归门禁为绿。未发布：无 npm 发布、无 `v0.2.0` tag、无 GitHub Release、未合并到 `main`。

---

## 15. 未决事项

1. **未使用真实 SMTP 凭据做投递。** 所有 SMTP 验证仍使用回环服务器；真实投递留待 RC 之后的发布验证。回环「接受」不等于邮箱「收到」。
2. **用户主动 fork 的会话仍被判为子代理**（§8）。这是既有语义，本阶段按「不以理论顾虑改动」的要求未改；若要修正，需要一次独立裁决，并注意不能把 `delegationDepth > 0` 提到 `parentSession` 之前——那会让 fork 子会话（不写 `delegationDepth`）在 `includeSubagents: false` 下开始发邮件。
3. **`QuestionDropReason.'content-limit'` 保留为不可达成员**（§7）。若未来调整 `MAX_TOTAL_QUESTION_CHARS` 或单项界限使其可达，`HAT-11e` 的断言会失败并提示重新裁决。
4. **仅验证 `0.1.5-rc.1`。** `peerDependencies` 的 `^0.1.5-rc.1` 是 SemVer 范围而非兼容承诺；更高版本未测试。若某个更高版本改变了 `REF_PATTERN`，`tests/integration/credential-contract.test.ts` 会在依赖升级时立即失败——这正是它存在的目的。
5. Phase 8 报告中关于凭据诊断的那一条已被 D019 与 §6 取代；`docs/DECISIONS.md` D018 的对应条目已加删除线并指向 D019，原始表述作为历史保留，未伪装成从未存在。
