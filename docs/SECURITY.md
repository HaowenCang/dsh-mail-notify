# SECURITY — dsh-mail-notify

本文件声明项目的安全边界、凭据生命周期、脱敏规则与隐私默认值。所有条款与 [`DECISIONS.md`](DECISIONS.md) 及 [`CONFIG_SPEC.md`](CONFIG_SPEC.md) 一致；出现不一致时以 `DECISIONS.md` 为准。

当前仓库尚无 `src/` 实现。本文件描述的是 Phase 3 必须满足的约束，其中「禁止」类条款不因实现便利而放宽。

---

## 1. 威胁模型

本插件引入的核心安全变化是：**Agent 的输出离开本机**。这一变化带来四类需要显式处理的后果。

| 资产 | 威胁 | 本项目的控制 |
| --- | --- | --- |
| 模型对用户工作区的输出 | 经第三方邮件服务商传输与存储；可能包含源码片段、路径、标识符 | 最小化外发字段（第 5 节）；正文上限；不提供开启推理/工具参数/工具结果的开关 |
| SMTP 密码 | 经源码、配置、日志、Git 泄露 | 仅以引用名存储；每次操作解析；不缓存；不入日志（第 2、4 节） |
| 推理内容与工具参数 | 经邮件正文泄露 | 白名单提取（第 5 节） |
| 用户原始输入 | 经邮件正文泄露 | 默认关闭（第 5 节） |

不在威胁模型内的项：本插件不防御已获得本机文件系统读写权限的攻击者——该攻击者可直接读取 DSH 的凭据存储，插件不是这一层级的控制点。本插件也不防御邮件服务商本身的泄露：一旦发送，内容即受服务商的策略与保留期约束，这一点必须对用户明确。

---

## 2. 凭据生命周期

**存储形式**：配置中只有引用名 `smtpPasswordCredential`（示例值 `DSH_MAIL_SMTP_PASSWORD`），它是 `CredentialRef`，即一个品牌字符串。真实 secret 由 DSH Credential 服务的来源层提供。

**允许的 secret 来源**：DSH Credential 服务的分层解析器覆盖的来源——进程环境变量、provider 管理的存储、`.env` 文件。

**禁止的 secret 存放位置**（逐项列举，无例外）：

```text
package.json
cordis.patch.yml
README 及 docs/ 中的示例实际值
.gitignore 覆盖范围之外的任何仓库文件
结构化日志（任何级别）
NotificationCandidate 及其任何派生结构
调试出口输出
错误消息与错误对象的原始字段
测试 fixture 中的真实密码
npm tarball
```

**解析时机**：每次发送操作开始时通过 `credentials.resolve(ref)` 解析，结果仅存在于该次操作的局部作用域。

**禁止缓存**：不得写入模块级变量、不得写入配置对象、不得写入类字段、不得在多次发送之间复用同一个已解析值。依据是 Credential 服务的明确契约——解析是 per-call 的，调用方必须在每次操作时重新 resolve，这正是「密码轮换后无需重启即可生效」的实现机制。

**解析失败（`resolve` 返回 `undefined`）**：按永久错误处理——不重试、不发送、写结构化 warning。诊断信息可包含引用名与 `credentials.describe(ref)` 的结果（`configured` / `source` / `writable`），**不得**包含 secret 值。

**describe 的用途**：`describe()` 是构造诊断信息的正确入口，因为它返回值以外的一切。任何时候需要向用户说明「凭据是什么状态」，都应使用 `describe()` 而非 `resolve()`。

---

## 3. 传输安全

TLS 证书校验**不得关闭**。以下写法一律禁止：

```js
rejectUnauthorized: false
tls: { rejectUnauthorized: false }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
```

理由不是一般性的安全建议：邮件正文包含模型对用户工作区的完整输出，关闭校验会使内容在中间人攻击下明文暴露，而其所换取的唯一好处是绕过自签名证书——后者应通过为证书提供正确的信任链（导入 CA 或改用受信任证书）解决。

`secure` 与端口的关系由 `CONFIG_SPEC.md` 第 2.2 节与第 4 节规定，端口与 `secure` 组合异常时给警告而不静默修正——静默修正会让用户以为自己配置的端口生效。

不提供任何形式的 TLS 关闭开关，包括「仅用于调试」的开关：此类开关在实践中会被长期留在配置里，且会让证书错误这一本应可见的运维问题静默通过（D010）。

---

## 4. 日志脱敏

### 允许记录

```text
sessionId
turn
status
provider
model
visibleTextLength
durationMs
telemetryComplete
explicitToolErrorCount
queue size / dropped count
retry attempt 序号
SMTP error category 与 class
suppression reason
credential 引用名（不是值）
credential describe() 的 configured / source
```

### 禁止记录

```text
完整 visibleText（任何长度）
visibleText 的片段
reasoning 文本
system prompt
tool arguments
tool results
凭据值、API key、SMTP password
SMTP auth 对象
Nodemailer transport 对象
完整邮件正文或主题（主题含 model 名，属允许范围，但不得整串记录正文）
```

### 排障与内容可见性的边界

正文内容在邮件中已对收件人可见，因此「为了排障而记录正文」不提供额外信息，只会扩大泄露面（日志通常被集中收集、保留期更长、访问控制更松）。排障所需的信号是长度、状态、错误分类与时间，这些均在允许列表内。

若确需确认「邮件里到底发了什么」，正确做法是配置一个测试收件人并实际接收邮件，而不是把正文写入日志。

### 错误对象脱敏

SMTP 错误对象在记录前必须处理，规则如下：

1. **白名单字段**：只提取 `code`、`responseCode`、`command`、经截断与清洗的 `message`。不整体序列化错误对象。
2. **必须移除的字段**：`config`、`request`、`response`、`auth`、`credentials`、`connection`，以及任何包含 `pass` / `password` / `secret` / `token` / `authorization` 子串的键。
3. **`message` 处理**：长度截断至固定上限（建议 500 字符），移除控制字符与换行（防止日志注入伪造行）。
4. **认证失败专项**：`EAUTH` / `535` / `534` / `530` 类错误的原始消息可能回显用户名；记录时只保留分类与 `responseCode`，不保留原始消息。

「日志注入」在本项目中是实际的考虑项：SMTP 服务器返回的错误文本是外部输入，若原样写入行式日志，可被用于伪造日志行。

---

## 5. 隐私默认值与内容边界

### 默认外发的内容

| 内容 | 默认 | 说明 |
| --- | --- | --- |
| 最终用户可见文本（`type === 'text'`） | 是 | 插件的核心用途 |
| 状态、终止方式 | 是 | 邮件主题与正文头部 |
| Session ID | 是 | 用于定位来源 |
| cwd | 是 | 用于区分工作区 |
| provider / model | 是 | 用于区分来源模型 |
| 耗时、是否完整覆盖 | 是 | 元数据 |
| 用户原始输入 | **否** | `includeUserPrompt: false` |
| subagent 内容 | **否** | `includeSubagents: false` |

`includeMetadata` 为假时只保留状态与终止方式，其余元数据项不出现。

### 永久禁止外发的内容（无开关可开启）

```text
reasoning 文本
system prompt
tool arguments
tool result 原文
provider 原始错误响应的完整内容
凭据、API key、SMTP password
```

这些项没有对应配置字段。为其提供开关会把「是否违反边界」的责任转移给用户，而其中若干项（如推理内容）在任何配置下都缺少外发的合理场景（D012）。

### 正文上限与截断

`maxBodyChars` 默认 100000。截断发生时正文包含标记 `[Output truncated by dsh-mail-notify]`（受 `includeFooter` 控制），且日志记录 `truncated: true`。静默截断被禁止——它会使收件人把插件的截断误读为模型的输出结束（D014）。

### 主题与头部注入

所有源自候选的字符串在写入邮件主题或头部之前必须移除 `\r` 与 `\n`，并截断至固定长度。主题源自 `model` 名与状态文本，二者在正常情形下不含换行，但 `model` 字段的取值最终来自 provider 配置，属于不可信输入。

正文中的元数据字段（cwd、session id、provider/model）同样按不可信文本处理：清洗控制字符。

---

## 6. 仓库与产物卫生

`.gitignore` 必须持续覆盖以下模式，**不得削弱**：

```text
node_modules
.env
.env.*
*.pem
*.key
.secrets/
.credentials/
*.tgz
```

（当前 `.gitignore` 已包含上述全部模式，并额外覆盖构建产物、覆盖率、日志与编辑器文件。唯一的否定模式是 `!.env.example`，其用途是提供不含真实值的示例文件。）

提交前必须检查：

```powershell
git status
git diff --check
git diff
```

检查项：无凭据、无 API key、无 SMTP password、无 `.env`、无测试 secret、无不相关大文件。

npm tarball 的 `files` 白名单必须排除：`.env` 及任何变体、`*.pem` / `*.key`、测试 fixture 目录中的非必要文件、本地缓存。发布前的 tarball 内容检查是 Phase 3 的验收项之一。

### 测试中的凭据

测试**不得**使用真实密码作为 fixture，即使是被认为「已经废弃」的密码：废弃密码仍可能在其他系统中有效，且会进入 CI 日志与本地开发者的检出。测试使用的凭据值必须是明显的合成值（如 `test-password-not-real`），并在测试中以 mock transporter 消费，不触及网络（见 [`TEST_PLAN.md`](TEST_PLAN.md) 第 7 节）。

---

## 7. 运行时边界

| 约束 | 理由 |
| --- | --- |
| 不修改 DSH 核心源码 | 交付要求（`00_MASTER.md` 引言、§19） |
| 不引入除 Nodemailer 之外的网络依赖 | 缩小供应链面与出网路径 |
| 发送路径不向 `session/event` 监听器抛异常 | 失败不得影响 Agent Loop（架构不变量三） |
| 不吞掉异常 | `00_MASTER.md` §19 明确禁止。失败必须产生日志与计数 |
| 队列有界、缓存有界、重试有界 | §19 明确禁止无限队列 / 无限 Map / 无限 retry |
| 状态必须有释放路径 | 见 `ARCHITECTURE.md` 第 7 节 |
| 附件不实现 | 附件不受正文同等的内容审查，且会引入 MIME 复杂度 |

「不吞掉异常」与「失败不影响 Agent Loop」并不矛盾，二者通过分层实现：监听器路径不抛异常（异常在适配器与策略层被转为拒绝决策），发送路径的异常被捕获后写入结构化日志与计数器，并作为 `SendResult` 返回给队列。异常被**记录**，而不是被**向上传播**。

---

## 8. 用户在启用前应知悉的事项

以下内容应在 README 与 `docs/SECURITY.md` 中以实质内容呈现，而不是仅作引用：

1. 启用本插件意味着 Agent 的最终输出会经 SMTP 发送至配置的收件人，并存储于该邮件服务商。
2. 正文可能包含工作区路径、文件片段与业务标识。
3. 若收件人地址指向共享邮箱或邮件组，可见范围由该地址的成员决定，插件无法控制。
4. 关闭插件（`enabled: false`）是唯一的完全停止方式；仅调整通知开关仍会保留事件监听与状态累积（但不会发送）。
5. 密码轮换后无需重启 DSH——每次发送都会重新解析凭据。

第 4 项需要实现上的对应：`enabled: false` 时不注册监听器（见 `CONFIG_SPEC.md` 第 1 节），这使该说明成为事实而非近似。
