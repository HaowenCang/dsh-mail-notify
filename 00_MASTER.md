# DSH Mail Notify 开发任务

你正在 DeepSeek Harness（DSH）的开发环境中工作。

目标是开发一个可长期安装和使用的 DSH Host 插件：

`dsh-mail-notify`

它的职责是：

当一个顶层 DSH Agent Turn 完成时，取得该 Turn 最终用户可见的模型输出，并通过 SMTP 发送邮件通知指定收件人。

最终产物必须是一个独立、可测试、可打包、可通过：

`dsh plugin --profile web add ...`

安装的 DSH bundle。

不要修改 DeepSeek Harness 核心源码。

---

## 文档状态说明（Phase 2 更新）

本文件是项目的总设计文档，记录业务要求、安全约束与最终目标。其结构在一次运行时实证之后经过了重新编排，编排变更见下方 `## Execution Roadmap`。

Phase 2 期间对本文件做了三类就地修正，均以注释形式标注，原文语义未被删除：

1. `§6`、`§15` 的 `smtpPasswordEnv` 更名为 `smtpPasswordCredential`。
2. `§3` 的 `toolErrors` 更名为 `explicitToolErrorCount`，并明确其口径。
3. `§2` 的 `completed → 通知` 补充无可见文本的抑制条件。

本文件的原始「第一阶段 / 第二阶段 / 第三阶段」编排（§11–§13）保留原样作为设计意图记录，但**不再表示实际执行顺序**；实际执行阶段以 `## Execution Roadmap` 为准。详细裁决理由见 [`docs/DECISIONS.md`](docs/DECISIONS.md) D016。

---

## Execution Roadmap

项目的实际执行历史与最初设想不同。最初的编排把「Inspect」与「创造模式原型」当作两个先后阶段，把正式实现当作第三阶段；实际执行中，Inspect 的结论能否成立只能由运行中的原型判定，二者不可分离，因此合并为 Phase 1，并把「设计冻结」独立为 Phase 2。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 1 — Runtime verification | 运行时 API Inspect、Host-only 动态原型验证、Runtime Contract 固化 | **PASS** |
| Phase 2 — Design freeze | 设计冻结与正式实现规格：决策记录、架构、配置、安全、测试矩阵、实现计划 | **PASS** |
| Phase 3 — Formal implementation | TypeScript 正式项目、测试矩阵、打包与安装验证 | **PASS WITH SMTP SMOKE DEFERRED**（见 [`PHASE3_REPORT.md`](PHASE3_REPORT.md)） |
| Phase 3.1 — Report integrity | 报告编码与文本完整性回归修复 | **PASS** |
| Phase 4 — Real SMTP E2E + Release Candidate Audit | 真实 SMTP 合成 smoke 与真实 Agent → Email E2E、v0.1.0 RC 全量审计、三个缺陷修复 | **PASS — RC READY**（见 [`PHASE4_REPORT.md`](PHASE4_REPORT.md)） |
| Phase 4.1 — Credential rotation + DSH rc.2 compatibility | 旧 SMTP 授权码轮换与凭据描述校验、DSH `0.1.5-rc.2` 静态与运行时兼容性验证、Git 全历史 secret 扫描 | **PASS — RELEASE READY**（见 [`PHASE4_1_REPORT.md`](PHASE4_1_REPORT.md)） |
| Phase 5 — v0.1.0 Formal Release | 将已验证的 `02191a4` 作为不可变的 `v0.1.0` 正式发布：npm package、Git tag、GitHub Release，以及发布后逐项核验 | **PASS**（见 [`RELEASE_V0.1.0.md`](RELEASE_V0.1.0.md)） |
| Phase 6 — Turn-level telemetry correctness hotfix | 查明真实运行时语义、修复 Turn 级 Token／Duration 遥测（`BUG-TEL-001`）、schema v2 迁移、全量回归与 rc.1/rc.2 复验，产出 v0.1.1 RC | **PASS — v0.1.1 RC READY**（见 [`PHASE6_REPORT.md`](PHASE6_REPORT.md)） |
| Phase 6.1 — Nodemailer 10 security uplift | 将已停止安全维护的 Nodemailer 7.x 升级到受支持的 10.x，删除 legacy `@types/nodemailer`，并在新依赖下重新完成 v0.1.1 的全量回归、打包、全新安装、rc.1/rc.2 与真实 SMTP 复验 | **PASS — v0.1.1 RELEASE READY**（见 [`PHASE6_1_REPORT.md`](PHASE6_1_REPORT.md)） |
| Phase 7 — v0.1.1 Formal Release | 冻结发布对象 `340ef362`、复现归档 SHA、`npm publish` 精确 tarball、annotated tag `v0.1.1`、GitHub Release 与 asset，以及本地／npm／GitHub 三方 SHA-256 一致性与 registry 全新安装核验 | **PASS — v0.1.1 RELEASED**（见 [`RELEASE_V0.1.1.md`](RELEASE_V0.1.1.md)） |

重新编排的理由：

1. **Inspect 与原型不可分离。** 原型本身是 Inspect 结论的唯一运行时证据来源。实际执行中原型的三个缺陷（mid-turn 状态丢失导致分类错误、时长被伪造为 `0`、可选字段使整批输出不可序列化）都只能在运行中发现，静态 Inspect 无法暴露。把二者拆成两个阶段会产出未经运行时证伪的契约。
2. **设计冻结是独立且必要的阶段。** Phase 1 移交的唯一实质设计决策（工具错误判定口径）在 Phase 2 才被解决，而它直接决定候选 DTO 的字段与完成分类语义。若 Phase 1 结束后直接编码，该决策会在实现中途被动做出，缺少文档依据，且会影响已经写好的模块边界。
3. **交付物形态不同。** Phase 1/2 的交付物是文档与判据；Phase 3 的交付物是代码与可安装产物。二者的验收标准、失败模式与所需证据类型不同，混为一阶段会使「看起来已完成」与「实际可用」难以区分。

Phase 4 的拆分（例如把「运行时集成与发布」独立出来）在 Phase 3 的实际工作量明确之前不作预设。当前 §20 的验证与交付标准已包含打包、安装与回滚验证，暂不拆分。

Phase 4 已按「真实 SMTP E2E 验证 + Release Candidate 审计」执行完毕，结论为 **PASS — RC READY**，并暴露、修复了装配层与配置层的三个缺陷；正式发布（`npm publish`、Git tag、GitHub Release）仍留待后续独立阶段，不在 Phase 4 范围内。

Phase 4.1 处理正式发布前剩余的两个前提：旧 SMTP 授权码的暴露后处置，以及当前最新 DSH `0.1.5-rc.2` 的兼容性验证。结论为 **PASS — RELEASE READY**：轮换后的凭据通过 Credential 服务解析并被 `smtp.163.com` 接受；rc.2 的静态契约与运行时行为均验证通过，且未发现需要修改 `src/**` 的兼容性缺陷。`peerDependencies` 保持 `^0.1.5-rc.1` 不变——该范围在 npm 与 pnpm 下均接受 `0.1.5-rc.2`，但范围本身不是兼容性证据，实测矩阵记入 [`README.md`](README.md)。正式发布仍不在本阶段范围内。

Phase 5 只做发布，不新增功能、不重构，也不修改 SMTP、Credential、runtime adapter 或测试语义。发布对象被固定为已完整验证的 `02191a43894f7cf9323641a1d117ae838c4a0c88` / `0.1.0`：执行开始时先核对 HEAD 与该 commit 相等，之后全部变更均不发生在此之前。npm `dsh-mail-notify@0.1.0`、Git 注释 tag `v0.1.0`（指向 `02191a4`）与 GitHub Release `v0.1.0` 均已创建，且本地 tarball、npm registry 产物与 GitHub Release asset 的 SHA-256 三者一致。发布后的 README 与报告以 post-release documentation commit 形式位于 `main > v0.1.0`，tag 不随之移动。结论为 **PASS**，详见 [`RELEASE_V0.1.0.md`](RELEASE_V0.1.0.md)。

Phase 6 处理发布后由真实邮件暴露的遥测语义缺陷：`usage` 实际只承载最后一个携带 usage 的 `assistant/message`，被用户理解为整个 Turn 的用量。本阶段先以真实运行时取证确认该语义（858 份 session log、1 432 个已结束 Turn），再以新增的 `telemetry.ts` 实现 Turn 级按 bucket 折叠，并按 D013 将 `schemaVersion` 递增为 `2`；Duration 在同一批真实 Turn 上被独立复核，**未复现缺陷**，因此未改动算法。结论为 **PASS — v0.1.1 RC READY**，详见 [`PHASE6_REPORT.md`](PHASE6_REPORT.md)。本阶段不发布：`npm publish`、`git tag v0.1.1`、GitHub Release 均未执行。

Phase 6.1 处理 v0.1.1 正式发布前暴露的依赖安全缺陷：Phase 6 的遥测 RC 原先保留 Nodemailer 7.x，而 7.x 已不在 Nodemailer 的受支持范围内（只有 `10.x` 收到安全修复），且处于 `GHSA-2x7j-588g-ccc2` 等 10 条 advisory 的影响区间内。本阶段把运行时依赖升级到 `^10.0.9`，删除与内置声明冲突的 `@types/nodemailer`，并证明升级**未改动任何源码**：本包只在一个文件中以一条调用形态使用 Nodemailer。随后在同一 tarball 上重新完成全量回归（336 项）、打包、隔离全新安装、rc.1/rc.2 两个 DSH 版本的受控 Turn 与真实 163 投递，以及三个面的密钥扫描。「当前配置下该 advisory 不可达」被记录为降低实际风险的事实，而非推迟升级的理由。结论为 **PASS — v0.1.1 RELEASE READY**，详见 [`PHASE6_1_REPORT.md`](PHASE6_1_REPORT.md)。本阶段同样不发布。

Phase 7 只做发布，不新增功能、不重构、不改动 telemetry 语义，也不升级依赖。发布对象被固定为已完整验证的 `340ef3624126bc4cf8bd0f2c26394371e4fa7b56` / `0.1.1`：执行开始时逐项核对 baseline（HEAD 与 `origin/main` 同为该 commit、工作树干净、`v0.1.1` 的 npm 版本／Git tag／GitHub Release 三者均不存在），之后全部变更均不发生在此之前。在第 7 节重新执行 `npm pack` 所得的归档 SHA-256 与 Phase 6.1 已验证归档**逐字节一致**，因此发布的确为既有验证对象。npm `dsh-mail-notify@0.1.1`、Git 注释 tag `v0.1.1`（tag object `819fde114357cb653d8ad902f74a8fd35d30a0af`，指向 `340ef362`）与 GitHub Release `v0.1.1` 均已创建，本地 tarball、npm registry 产物与 GitHub Release asset 的 SHA-256 三方一致。registry 全新隔离安装（`mnrel011h`，headless 模板 + 按 specifier 从 registry 安装）完成了加载、受控 Turn 与回环 SMTP 投递。发布后的 README 与报告以 post-release documentation commit 形式位于 `main > v0.1.1`，tag 不随之移动。结论为 **PASS — v0.1.1 RELEASED**，详见 [`RELEASE_V0.1.1.md`](RELEASE_V0.1.1.md)。

各阶段的详细结论见 [`PHASE1_REPORT.md`](PHASE1_REPORT.md)、[`PHASE2_REPORT.md`](PHASE2_REPORT.md)、[`PHASE3_REPORT.md`](PHASE3_REPORT.md)、[`PHASE4_REPORT.md`](PHASE4_REPORT.md)、[`PHASE4_1_REPORT.md`](PHASE4_1_REPORT.md)、[`PHASE6_REPORT.md`](PHASE6_REPORT.md)、[`PHASE6_1_REPORT.md`](PHASE6_1_REPORT.md)、[`RELEASE_V0.1.1.md`](RELEASE_V0.1.1.md)。

Phase 2 冻结的实现规格见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)、[`docs/CONFIG_SPEC.md`](docs/CONFIG_SPEC.md)、[`docs/SECURITY.md`](docs/SECURITY.md)、[`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)、[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)、[`docs/DECISIONS.md`](docs/DECISIONS.md)。

---

# 0. 工作原则

本项目必须遵守以下规则。

第一，不允许根据记忆猜测 DSH API。

在使用任何 Cordis Service、Event、Builtin、Slot 或其他 DSH 接口之前，必须先使用创造模式提供的 Inspect 工具查询当前实际运行时接口。

优先执行：

1. `cordis_inspect_list`
2. `cordis_inspect_query`

确认接口之后才允许编写依赖该接口的代码。

如果 Inspect 得到的接口与本文件描述不一致，以当前运行时 Inspect 结果为准，并把差异记录到：

`docs/DSH_INTEGRATION.md`

不要静默修改设计假设。

---

# 1. 核心业务要求

插件默认只通知顶层 Session。

如果：

`session.header.origin === "subagent"`

则默认不得发送邮件。

配置允许未来开启：

`includeSubagents: true`

但默认必须为 false。

---

# 2. 完成事件定义

不要在收到流式 token 时发送邮件。

不要在第一次收到 `assistant/message` 时立即发送邮件。

一个 DSH Turn 可能包含多个 Step 和工具调用。

应监听 Session 的 durable event。

核心状态机：

`turn/start`

开始记录一个新的 Turn。

`assistant/message`

记录该 Turn 当前最新 Assistant message。

只保留其中用户可见的 text content。

不得把 reasoning 内容加入邮件。

不得把 tool-call arguments 加入邮件。

不得把 tool-result 自动加入邮件。

`tool/result`

记录工具执行是否存在错误。

`turn/end`

根据 TurnEndReason 判断 Turn 是否结束，并决定是否产生通知。

默认：

`completed` → 通知，但仅在存在用户可见文本时（`visibleText.trim().length === 0` 时抑制，见 [`docs/DECISIONS.md`](docs/DECISIONS.md) D011）

`max-tokens` → 通知，但必须明确标记为 max-tokens，不得写成成功完成

`error` → 默认关闭，可配置通知

`aborted` → 默认不通知

`blocked` → 默认不通知

`interrupted` → 默认不通知

---

# 3. completion 质量分类

不要简单认为：

`reason.kind === "completed"`

一定意味着任务完全成功。

插件必须同时跟踪本 Turn 的 tool result。

定义至少以下状态：

`completed-clean`

Turn reason 是 completed 且 `explicitToolErrorCount == 0`。

`completed-with-tool-errors`

Turn reason 是 completed 且 `explicitToolErrorCount > 0`。

`max-tokens`

Turn 达到模型输出 Token 上限。

`error`

Turn 发生错误。

邮件主题和正文必须准确反映这些状态。

**口径说明（Phase 2 冻结）。** 原 `toolErrors` 更名为 `explicitToolErrorCount`，含义严格限定为「DSH runtime 明确标记为失败的工具结果数量」，判据为 `event.data.message.content[0].isError === true` 或 `event.data.error !== undefined`。基于 stdout/stderr 文本推断的 shell 失败**不计入**——bash / pwsh 的非零退出被 DSH 设计为正常 Tool Result。因此 `completed-clean` 的含义是「DSH 未报告显式工具失败」，不等价于「所有命令的业务执行均成功」。若未来需要检测命令执行问题，使用独立概念 `executionIssueCount`，且不采用字符串解析算法。依据见 [`docs/DECISIONS.md`](docs/DECISIONS.md) D005。

---

# 4. Assistant 内容提取

Assistant message 的可见输出只允许来自：

`content` 中 `type === "text"` 的 block。

必须忽略：

`reasoning`

`tool-call`

`tool-result`

`image`

以及未知未来 block 类型。

未知 block 类型必须安全跳过，而不是抛出异常导致插件停止工作。

多个 text block 使用换行连接。

一个 Turn 中如果有多个 assistant/message，保存最后一个非空用户可见文本。

---

# 5. 隐私原则

默认邮件正文只能包含：

最终 Assistant visible text

Session ID

workspace cwd

模型/provider

任务耗时

completion 状态

不得默认包含：

reasoning

完整 system prompt

tool arguments

tool results

Credential

API key

SMTP Password

用户原始 Prompt

如果未来提供 `includeUserPrompt`，默认必须是 false。

---

# 6. SMTP

正式 npm 插件使用 Nodemailer。

依赖范围必须停在 Nodemailer 的**受支持 major** 上：它只为当前 major 提供安全修复，不向旧 major 回移补丁。当前声明为 `^10.0.9`——caret 在 10 上不允许跨到 11，下界取已修补版本而非 `10.0.0`。Nodemailer 自带 TypeScript declarations，因此不得同时安装 `@types/nodemailer`（两套声明描述同一模块，会产生冲突声明与过时 API 类型）。

不要自己实现 SMTP 协议。

支持至少：

SMTP host

SMTP port

SMTP secure

SMTP username

SMTP password credential reference

from

to

SMTP Password 不允许直接放入 cordis.patch.yml。

应使用 DSH Credential service。

配置只保存：

`smtpPasswordCredential`

例如：

`DSH_MAIL_SMTP_PASSWORD`

**更名说明（Phase 2）。** 本字段原名 `smtpPasswordEnv`，现更名为 `smtpPasswordCredential`。原因是运行时 `CredentialRef` 是一个**分层解析器**（按序解析自进程环境变量、provider 管理的存储与 `.env` 文件），名称中的 `Env` 会误导用户以为只能通过环境变量配置。字段名与运行时类型 `CredentialRef`、服务方法 `resolve(ref: CredentialRef)` 保持一致，实质要求（secret 不进入 `cordis.patch.yml`、每次操作解析、不缓存）不变。依据见 [`docs/DECISIONS.md`](docs/DECISIONS.md) D010 与 D016 第 3 项。

在每一次发送操作开始时通过 Credential service 解析 secret。

不得缓存 password 到长期全局变量。

日志不得输出 password。

错误对象如果可能包含认证信息，必须在日志前做脱敏。

---

# 7. 异步模型

Session event handler 中不得直接进行长时间 SMTP I/O。

Session listener 只负责：

更新状态

判断通知

enqueue notification

实际 SMTP 请求由后台 MailQueue 执行。

要求：

并发默认 1

有界队列

有限重试

失败不能使 DSH Agent Loop 崩溃

所有异步 Promise 必须有 error handling

不能产生 unhandled rejection

---

# 8. Retry

仅对可能恢复的错误进行重试，例如：

timeout

ECONNRESET

临时 DNS/network failure

SMTP 4xx transient response

默认最多 3 次。

采用指数退避。

永久性错误例如：

authentication failure

invalid recipient

明显 SMTP 5xx policy rejection

不要不断重试。

---

# 9. Deduplication

每个 Turn 最多发送一封通知。

建议 key：

`${sessionId}:${turn}`

或者：

`${sessionId}:${turn}:${assistantMessageId}`

维护有界 dedupe cache。

不得无限增长。

---

# 10. 内存生命周期

不得无限保存 Session。

Turn 完成发送后清理对应 TurnState。

Session disposed 时清理该 Session 所有状态。

所有 Map/Set 必须存在明确释放路径。

---

# 11. 第一阶段：Inspect

> **阶段编号说明（Phase 2）。** 本节与 §12、§13 保留了最初的三阶段编排，作为设计意图记录。实际执行中，本节与 §12 合并为 **Phase 1（Runtime verification）**，§13 成为 **Phase 3（Formal implementation）**，二者之间增设 **Phase 2（Design freeze）**。理由见文首 `## Execution Roadmap`。以下内容的要求本身未被修改。

现在不要编写正式 npm 插件。

首先：

调用 `cordis_inspect_list`。

查询：

session service

session/event

SessionHeader

assistant/message

tool/result

turn/start

turn/end

credentials service

plugin lifecycle / effect disposal

如果需要使用其他接口，也必须先 Inspect。

把发现的接口写成一份契约说明。

如果运行时存在与设计文档不同的地方，明确指出。

完成该步骤后继续，不需要询问用户确认。

---

# 12. 第二阶段：创造模式原型

使用创造模式创建一个新的 Host-only dynamic Cordis Plugin。

它不得发送真实邮件。

它只验证：

可以观察顶层 Session

可以识别 turn/start

可以读取 assistant/message visible text

可以识别 tool result error

可以捕获 turn/end

可以排除 subagent

Turn 完成时只输出结构化日志：

`MAIL_NOTIFY_CANDIDATE`

日志应包含：

session id

turn

completion status

model

visible text length

tool error count

不得输出 reasoning 或 secret。

必须实际调用：

`cordis_define`

然后：

`cordis_run`

对插件进行运行验证。

如果失败：

使用 `cordis_inspect_self`

读取真实诊断。

在同一个 Plugin ID 下创建新的 Package 修复。

不要遇到问题就创建新的 Plugin。

---

# 13. 第三阶段：正式项目

> **阶段对应（Phase 2）。** 本节即 **Phase 3（Formal implementation）**。本节的模块清单为最低要求，Phase 2 已将模块布局扩展并逐模块冻结职责边界，见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 第 3 节与 [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)。执行顺序亦已拆分为 P3.1–P3.7 七步。

动态原型验证通过之后，在 workspace 中建立：

dsh-mail-notify/
  package.json
  tsconfig.json
  cordis.patch.yml
  README.md
  src/
  tests/
  docs/
  prompts/
  scripts/

正式插件使用 TypeScript。

模块至少拆分为：

src/index.ts

src/config.ts

src/event-handler.ts

src/turn-state.ts

src/content.ts

src/notifier.ts

src/mailer.ts

src/retry.ts

src/subject.ts

src/types.ts

不要把全部逻辑放在 index.ts。

---

# 14. Bundle

package.json 必须声明 DSH bundle。

形式：

`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`

cordis.patch.yml 应负责 mount 插件。

不得依赖用户手动编辑 DSH 核心配置。

---

# 15. 配置 Schema

使用 DSH/Cordis 当前实际采用的 Schema 系统。

至少提供：

enabled

smtpHost

smtpPort

smtpSecure

smtpUser

smtpPasswordCredential

from

to

includeSubagents

notifyCompleted

notifyErrors

notifyMaxTokens

minTurnDurationMs

maxBodyChars

includeMetadata

includeUserPrompt

为所有字段提供合理校验。

email recipient 至少不能为空。

maxBodyChars 必须有合理上限。

---

# 16. 测试

不得只做手工测试。

至少编写以下测试场景：

普通一次性回答

模型先调用工具再回答

多个 Step 后完成

工具调用发生错误但 Turn reason 仍 completed

Turn error

Turn max-tokens

Turn aborted

Subagent 完成

Assistant 仅有 reasoning 无 visible text

Assistant content 包含 reasoning + text

正文超 maxBodyChars

SMTP transient failure 后重试成功

SMTP authentication failure 不进行无限重试

重复 turn/end 不重复发送

plugin dispose 后不存在悬挂 Promise

SMTP 测试必须使用 mock transporter。

普通测试不得真的向互联网发送邮件。

---

# 17. Smoke Test

提供：

`scripts/smtp-smoke-test.ts`

只有显式运行该脚本时才允许发送真实测试邮件。

运行前必须验证 Credential 已配置。

不得在 CLI 中打印 secret。

---

# 18. 文档

生成：

docs/PRODUCT_SPEC.md

说明功能范围和非目标。

docs/ARCHITECTURE.md

说明 Session Event → TurnState → Notification Queue → SMTP 的完整数据流。

docs/DSH_INTEGRATION.md

记录本项目实际使用的 DSH Service/Event 接口及对应版本。

docs/SECURITY.md

说明 Credential、邮件内容外发、日志脱敏、TLS 等安全边界。

docs/TEST_PLAN.md

列出测试矩阵。

docs/RELEASE.md

说明 build、pack、安装、更新、回滚方式。

README.md

必须给最终用户提供：

安装方法

配置方法

Credential 配置方法

启动方法

测试邮件方法

卸载方法

故障排查

**交付阶段划分（Phase 2 更新）。** 上述清单原为一次性交付，现按阶段划分：

| 文档 | 交付阶段 | 说明 |
| --- | --- | --- |
| `docs/ARCHITECTURE.md` | Phase 2 已交付 | 数据流与模块边界已冻结 |
| `docs/SECURITY.md` | Phase 2 已交付 | 安全边界已声明 |
| `docs/TEST_PLAN.md` | Phase 2 已交付 | 测试矩阵已列出 |
| `docs/PRODUCT_SPEC.md` | Phase 3 | 功能范围与非目标在实现完成后才能准确陈述；Phase 2 的范围声明见 `docs/ARCHITECTURE.md` 第 11 节「明确非目标」 |
| `docs/DSH_INTEGRATION.md` | Phase 3 | 内容为「本插件**实际使用**的接口及版本」，在正式代码存在前无法确定；当前由 [`PHASE1_RUNTIME_CONTRACT.md`](PHASE1_RUNTIME_CONTRACT.md) 承担该职责 |
| `docs/RELEASE.md` | Phase 3 | 描述尚不存在的构建与安装流程会产出与最终实现不符的内容 |
| `README.md` 的完整用户文档 | Phase 3 | 安装 / 配置 / Credential / 启动 / 测试邮件 / 卸载 / 故障排查七项，在产物可安装之前无法编写 |

Phase 2 另交付四份本文档未列出的规格文件：[`docs/DECISIONS.md`](docs/DECISIONS.md)（决策记录）、[`docs/CONFIG_SPEC.md`](docs/CONFIG_SPEC.md)（配置规范）、[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)（实现计划）、[`PHASE2_REPORT.md`](PHASE2_REPORT.md)（阶段报告）。依据见 [`docs/DECISIONS.md`](docs/DECISIONS.md) D016 第 7 项。

---

# 19. 安全要求

禁止：

把 SMTP password 写入源码

把 SMTP password 写入 cordis.patch.yml

把 reasoning 发邮件

把完整 tool arguments 发邮件

把 Credential 打日志

关闭 TLS certificate validation

使用 rejectUnauthorized:false

无限 retry

无限 queue

无限 Map cache

吞掉所有异常

修改 DSH 核心文件

---

# 20. 验证与交付标准

在认为项目完成之前必须实际运行：

类型检查

lint

unit tests

integration tests

build

pack

然后检查 tarball 内容。

确保 tarball 包含：

编译后的 runtime

cordis.patch.yml

package.json

必要 README/LICENSE

不包含：

.env

credential

测试 secret

开发缓存

随后给出本地安装命令。

优先使用打包后的 tgz 做最终安装测试，而不是直接依赖源码目录。

---

# 21. 工作方式

> **阶段适用范围（Phase 2）。** 本节面向实现阶段。Phase 2 的职责是设计冻结，其交付物是规格文档，因此「实际完成项目文件」在该阶段解释为「实际完成文档、判定与裁决」，而不是创建源码。Phase 2 明确禁止创建 `src/`、安装 Nodemailer、连接 SMTP、发送邮件或请求用户提供密码。

不要只告诉用户应该写什么。

实际完成项目文件。

在每个阶段执行验证。

如果某个 DSH API 不确定，Inspect，而不是猜。

如果测试失败，分析根因并修复。

如果实现与当前 DSH runtime 不兼容，优先适配当前 runtime，而不是修改 Harness。

不要因为某一步困难而停下来询问用户。

只有确实涉及用户私密 Credential 值时，保留占位符，不要求用户把 Secret 发给模型。

最终输出：

实现摘要

验证结果

已知限制

安装命令

配置示例

Smoke test 方法

回滚方法