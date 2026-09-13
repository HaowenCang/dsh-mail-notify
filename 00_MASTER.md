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

`completed` → 通知

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

Turn reason 是 completed 且 toolErrors == 0。

`completed-with-tool-errors`

Turn reason 是 completed 且 toolErrors > 0。

`max-tokens`

Turn 达到模型输出 Token 上限。

`error`

Turn 发生错误。

邮件主题和正文必须准确反映这些状态。

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

`smtpPasswordEnv`

例如：

`DSH_MAIL_SMTP_PASSWORD`

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

smtpPasswordEnv

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