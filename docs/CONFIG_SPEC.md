# CONFIG_SPEC — dsh-mail-notify 配置规范 v1

本文件冻结 Phase 3 第一版配置 Schema、默认值、校验规则与挂载示例。决策依据见 [`DECISIONS.md`](DECISIONS.md)（配置相关项为 D010、D012、D014、D015）。

字段一旦在本文件中冻结，Phase 3 实现不得在未新增 ADR 的情况下改名或改变语义。

---

## 0. Implementation notes（Phase 3 补记，2026-09）

以下为逐字段实现时的补充事实。**没有字段被改名、删除或改变语义**；`Config` schema 与 `resolveConfig()` 的实际取值与本文件第 3 节一致。

**校验分两层实现，与第 4 节的两级划分对应但不是同一套机制。**

- 类型与非空字段用 `@deepseek-ai/schemastery` 的 `Schema.object` 声明，默认值即第 3 节的默认值。schema 抛出的校验异常被 `resolveConfig()` 捕获并转为同形的诊断，因此坏配置表现为一条 `plugin.config-invalid` 日志，而不是未捕获异常。
- 取值范围（`smtpPort` 1–65535、`maxBodyChars` 1000–1 000 000、`queueSize` 1–10000、`retryAttempts` 0–10、`retryBaseDelayMs` 100–60000、`maxDedupeEntries` 10–100000、`minTurnDurationMs` 0–3600000）以 `.min()` / `.max()` 声明在 schema 上，超范围即拒绝。
- 「非空」与「含 `@`」这两类判断**不在 schema 内**，而在 `resolveConfig()` 中实现：`smtpHost`（非空、不含空白）、`smtpUser`（非空）、`smtpPasswordCredential`（非空且匹配 `CREDENTIAL_REF_PATTERN`，即 DSH 的 `CredentialRef` 文法；Phase 8 的那次放宽已在 Phase 8.1 撤销，见下方 Phase 8 补记第 3 项）、`from`（非空且形如地址）、`to`（逐项校验、去重后仍需 ≥ 1 项）。

**与第 4 节表逐条对照的结果：**

| 第 4 节规则 | 实现 |
| --- | --- |
| `smtpSecure === true` 且端口 587 → 警告 | 实现，且**不修正**端口（`SECURITY.md` 第 3 节要求不静默修正） |
| `smtpSecure === false` 且端口 465 → 警告 | 实现，同上 |
| `to` 去重后为空 → 字段级失败 | 实现 |
| 三个通知开关全关 → 警告 | 实现（Phase 8 起判据扩为五个开关全关），仍可装载 |

**`to` 为空数组时不会触发 schema 的 `.min(1)`。** 数组长度约束写在显式检查里而不是 schema 上，因为一条「去重后仍需 ≥ 1 项」的规则无法用 `.min()` 表达（`['a@b.com', 'A@B.COM']` 长度为 2 而去重后为 1）。`to` 在 schema 上的默认值是 `[]`，因此漏配 `to` 会走到同一条显式检查，得到 `to must contain at least one valid recipient address`，而不是一条 schema 类型错误。行为与第 4 节的「按字段级失败处理」一致。

**第三条警告的判定条件**（Phase 3 时为 `!notifyCompleted && !notifyErrors && !notifyMaxTokens`，Phase 8 起扩为五个开关全关，见本节 Phase 8 补记）与第 4 节表中「`minTurnDurationMs > 0` 且开关全关」略有出入：实现只在开关全关时警告，不要求 `minTurnDurationMs > 0`。开关全关时，无论门槛取何值都不可能发出任何邮件，因此把门槛并入条件是更窄的判据而非不同的语义；此处记录以避免被读成静默偏离。

**`enabled: false` 的短路位置**在 schema 校验之前：该分支直接返回一份字段全为默认值的 `ResolvedConfig`，不触碰任何必填字段，因此关闭插件不会被无关的必填字段错误阻塞（与第 4 节末段一致）。

> **Implementation note（Phase 8 补记，2026-09）。** 以下为本文件在 v0.2.0（D018）下的增量事实，已就地更新正文对应位置；第 1–7 节除这些点外未被改写。
>
> 1. **两个通知开关（`notifyQuestions` / `notifyApprovals`）新增**，默认均为 `false`，见第 2.5 节。实现中的「全关」警告判据随之扩为五个开关全关，警告文本也逐项列出五个键；第 4 节表与该判据已同步。
> 2. **`notifyErrors` 的语义被明确**：它覆盖 `status === 'error'`，且**不要求该 Turn 有可见文本**。旧文字中「无可见文本即抑制」对该状态不再适用。默认值仍为 `false`（D018 第四条）。
> 3. **~~`CREDENTIAL_REF_PATTERN` 放宽~~ 已在 Phase 8.1 撤销**：该模式回归 DSH 的 `CredentialRef` 文法 `^[A-Za-z_][A-Za-z0-9_]*$`，且仅此一种形式。Phase 8 记录的「存储只接受 `<scope>/<id>`」把 seam 的 record half 当成了引用文法；`resolve()` 与 `describe()` 只读 `refs` 段，`records` 段经另一组方法访问。见第 2.2 节与 `DECISIONS.md` D019。
> 4. **question 解析器的界限常量**记录于第 2.5 节之后的新表；它们不是配置项，不可由用户调整。



---

## 1. 配置载体与解析时机

配置通过 DSH bundle 的 `cordis.patch.yml` 中的 mount 参数提供（`00_MASTER.md` §14）。插件在 `apply(ctx)` 时一次性读取并解析为 `ResolvedConfig`，插件的热重载或重新装载会重新解析。

**解析阶段永不读取凭据 secret。** 校验只确认 `smtpPasswordCredential` 是一个非空字符串引用名；该引用是否已配置属于运行时事实，在每次发送操作时判定（D010）。

当 `enabled === false` 时，插件在 `apply()` 阶段即短路：不注册 `session/event` 监听器、不创建队列、不解析凭据。这使「关闭」在行为与资源占用上都是真正的关闭，而不只是发送前的判断。

---

## 2. 完整配置表

### 2.1 总开关

| 字段 | 类型 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | — | 为 `false` 时不注册任何监听器，插件完全静默 |

### 2.2 SMTP 连接

| 字段 | 类型 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- | --- |
| `smtpHost` | `string` | 无（必填） | 非空，不含空白 | SMTP 服务器主机名 |
| `smtpPort` | `number` | `587` | 整数，1–65535 | 端口 |
| `smtpSecure` | `boolean` | `false` | — | `true` = 隐式 TLS（通常配 465）；`false` = 允许 STARTTLS 升级（通常配 587） |
| `smtpUser` | `string` | 无（必填） | 非空 | 认证用户名 |
| `smtpPasswordCredential` | `string` | 无（必填） | 非空，且匹配 `^[A-Za-z_][A-Za-z0-9_]*$` | **凭据引用名**，不是密码本身。交给 `credentials.resolve()` 解析。示例值 `DSH_MAIL_SMTP_PASSWORD` |

`smtpPasswordCredential` 只接受一种形式：DSH 的 `CredentialRef` 文法 `^[A-Za-z_][A-Za-z0-9_]*$`，即 POSIX 风格的环境变量名（`DECISIONS.md` D019）。该文法与 `@deepseek-ai/dsh-credentials` 的 `REF_PATTERN` 逐字符相同，也是同一 store 的 `refs` 段在解析时对每个键调用的校验。

`<scope>/<id>` 形式**被拒绝**。它是同一 seam 的另一个键空间 `CredentialKey`，寻址 `.credentials.yaml` 的 `records` 段，经 `readRecord`/`describeRecord` 访问；而 `resolve()` 与 `describe()` 只读 `refs` 段与继承环境，从不查询 `records`。因此一个 `<scope>/<id>` 引用在本插件里是一个永远解析不到的引用，把它拒在挂载期比让它到每次投递时才以「未配置」的形式失败更准确。该模式只判断**引用名的拼写**，引用是否可解析仍由 Credential 服务裁决（D010）。

字段名说明：`00_MASTER.md` §6/§15 原写作 `smtpPasswordEnv`。更名理由见 `DECISIONS.md` D016 第 3 项——`CredentialRef` 是分层解析器（进程环境变量 / provider 存储 / `.env`），名称中的 `Env` 会误导用户以为只能通过环境变量配置。

### 2.3 收发件人

| 字段 | 类型 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- | --- |
| `from` | `string` | 无（必填） | 非空，含 `@` | 发件人地址 |
| `to` | `string[]` | 无（必填） | 数组长度 ≥ 1；每项非空且含 `@`；去重后仍需 ≥ 1 项 | 收件人地址列表 |

`to` 为空数组、缺失或全部为非法地址时配置校验失败，插件不装载。**不存在「校验失败但继续运行」的降级路径**：把邮件发到未知收件人比不发送更糟。

### 2.4 范围控制

| 字段 | 类型 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- | --- |
| `includeSubagents` | `boolean` | `false` | — | 为 `true` 时 subagent 的 Turn 也产生通知 |

`includeSubagents: true` 会使子会话（通常是为父 Agent 消费的中间产物）内容外发，隐私影响见 `SECURITY.md` 第 5 节。

### 2.5 通知策略

| 字段 | 类型 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- | --- |
| `notifyCompleted` | `boolean` | `true` | — | 覆盖 `completed-clean` 与 `completed-with-tool-errors` 两种状态 |
| `notifyErrors` | `boolean` | `false` | — | 覆盖 `status === 'error'`。终局 error Turn **即使没有可见助手输出也会通知**；`completed` 与 `max-tokens` 仍要求可见文本（D018 第三条） |
| `notifyMaxTokens` | `boolean` | `true` | — | 覆盖 `status === 'max-tokens'` |
| `notifyQuestions` | `boolean` | `false` | — | 覆盖「Agent 阻塞在 `ask_user_question`」。**默认关闭**：开启即把该提问的文本与选项发送到第三方邮件系统 |
| `notifyApprovals` | `boolean` | `false` | — | 覆盖「Agent 阻塞在审批决定」。**默认关闭**：开启即把待审批工具名与提问方给出的 reason 发送到第三方邮件系统 |

`aborted`、`blocked`、`interrupted` 与防御性的 `unknown` **没有**对应开关，恒不通知。原因：这四种终止方式不产生「模型有意图传达给用户的输出」这一语义，也未被任何现有要求列为可通知状态（`00_MASTER.md` §2 明确要求默认不通知）。为其增设开关会扩大邮件噪声，且无用户需求支撑。

`notifyQuestions` 与 `notifyApprovals` 的默认值同样是 `false`，理由与 `notifyErrors` 同源：开启任一项都会使 Agent 自己产生的文本离开本机。`notifyErrors` 的默认值不因语义修正而改变——升级不得使既有用户突然开始外发故障信息（D018 第四条）。五个开关彼此独立，不存在「开启某一个会顺带开启另一个」的关系。

`minTurnDurationMs` **只**适用于终局 Turn 通知，对 question 与 approval 通知不适用：刚进入 Turn 两秒就提问的 Agent 正是该邮件存在的理由（D018 第五条）。

### 2.5.1 question 解析器界限常量（非配置项）

以下常量定义在 `src/human-attention.ts` 中，是 question 通知的内容上界。它们**不是**配置项，字段名、默认值与校验规则三列都不适用，用户无法调整；列在这里是因为「一封 question 邮件最多能有多大」由它们决定，而不是由 `maxBodyChars` 决定（人工注意力变体的 `truncated` 恒为 `false`）。

| 常量 | 值 | 界限对象 |
| --- | --- | --- |
| `MAX_QUESTIONS` | 20 | 一次调用中携带的问题数；其余被计数而不读取 |
| `MAX_OPTIONS_PER_QUESTION` | 20 | 单个问题上携带的选项数 |
| `MAX_QUESTION_CHARS` | 2000 | 单个问题正文的码点上限 |
| `MAX_OPTION_LABEL_CHARS` | 500 | 单个选项 label 的码点上限 |
| `MAX_OPTION_DESCRIPTION_CHARS` | 1000 | 单个选项 description 的码点上限 |
| `MAX_HEADER_CHARS` | 120 | 问题 header 的码点上限 |
| `MAX_QUESTION_ID_CHARS` | 200 | 单个问题 id 的码点上限（approval 的 `callId` 复用同一上限） |
| `MAX_TOTAL_QUESTION_CHARS` | 6000 | 所有被携带问题字段合计的码点上限；按 `id` + `question` 的实际长度累计 |
| `MAX_APPROVAL_REASON_CHARS` | 1000 | approval 的提问方 reason 上限 |
| `MAX_APPROVAL_TOOL_NAME_CHARS` | 200 | approval 的工具名上限 |

界限按固定顺序施加——先数量、再单字段长度、最后累计总量——因此同一个超限调用总是得到同一组被携带问题，不依赖对象键顺序。累计总量在被拒绝的问题上同样消耗额度，使被携带集合始终是调用的前缀。

`QuestionDropReason` 的 `content-limit` 在当前界限下不可达：首个可用问题的成本上限为 `MAX_QUESTION_CHARS` + `MAX_QUESTION_ID_CHARS`（2200），低于 `MAX_TOTAL_QUESTION_CHARS`（6000），因此首个可用问题除非自身字段校验失败必被携带。该成员保留而不删除，因为解析器的记账逻辑确实能够上报它（D018 A9 补记）。

### 2.6 抑制门槛

| 字段 | 类型 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- | --- |
| `minTurnDurationMs` | `number` | `0` | 整数，≥ 0，≤ 3600000 | 耗时低于该值时抑制。`0` 表示不按耗时过滤 |

抑制条件严格为 `durationMs !== null AND durationMs < minTurnDurationMs`。`durationMs === null`（mid-turn 装载导致时长未知）时**不抑制**（D015）。

### 2.7 正文内容

| 字段 | 类型 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- | --- |
| `maxBodyChars` | `number` | `100000` | 整数，≥ 1000，≤ 1000000 | 可见文本字符上限（按码点计） |
| `includeMetadata` | `boolean` | `true` | — | 为 `true` 时正文含 Session ID、cwd、provider/model、耗时、状态 |
| `includeUserPrompt` | `boolean` | `false` | — | 为 `true` 时正文附该 Turn 最近一条用户消息。**默认必须为 false** |
| `includeFooter` | `boolean` | `true` | — | 为 `true` 时正文附生成器说明行；截断标记依赖此开关（D014） |

`maxBodyChars` 的上限 1000000 是硬性配置上界，防止用户把上限调到事实无界。上限不足 1000 会使邮件正文短到无法容纳元数据头部，因此设为下界。

### 2.8 队列与重试

| 字段 | 类型 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- | --- |
| `queueSize` | `number` | `100` | 整数，1–10000 | 等待中条目上限（不含在途的 1 条） |
| `retryAttempts` | `number` | `3` | 整数，0–10 | **重试**次数；总尝试次数 = 1 + `retryAttempts` |
| `retryBaseDelayMs` | `number` | `1000` | 整数，≥ 100，≤ 60000 | 退避基数，第 n 次重试等待 `base × 3^(n-1)` |
| `maxDedupeEntries` | `number` | `1000` | 整数，≥ 10，≤ 100000 | 去重缓存容量上限 |

`retryAttempts: 0` 是合法配置，表示只尝试一次。

---

## 3. 默认值汇总（安全默认）

```yaml
enabled: true

smtpHost: <required>
smtpPort: 587
smtpSecure: false
smtpUser: <required>
smtpPasswordCredential: <required>

from: <required>
to: <required, string[]>

includeSubagents: false

notifyCompleted: true
notifyErrors: false
notifyMaxTokens: true
notifyQuestions: false
notifyApprovals: false

minTurnDurationMs: 0
maxBodyChars: 100000

includeMetadata: true
includeUserPrompt: false
includeFooter: true

queueSize: 100
retryAttempts: 3
retryBaseDelayMs: 1000
maxDedupeEntries: 1000
```

五个隐私相关默认值的方向性由 D012 冻结；后两项为 Phase 8 新增，其方向性由 D018 冻结（`notifyErrors` 的语义与 `includeSubagents` 的覆盖面同样由 D018 补充）：

```text
includeSubagents   = false     默认不外发子会话内容，也不外发其提问与审批
includeUserPrompt  = false     默认不外发用户原始输入
notifyCompleted    = true      核心用途
notifyErrors       = false     瞬时故障默认不推送；修正的是语义，不是默认值
notifyMaxTokens    = true      截断必须被知晓
notifyQuestions    = false     提问文本可能引用用户任务，默认不外发
notifyApprovals    = false     工具名与 reason 默认不外发
```

---

## 4. 校验规则与失败行为

校验在 `apply()` 阶段同步完成，分两级。

**字段级校验**（上表的「校验」列）：失败即整体校验失败。

**交叉校验**：

| 规则 | 理由 |
| --- | --- |
| `smtpSecure === true` 且 `smtpPort` 为 587 | 587 通常要求 STARTTLS 而非隐式 TLS，几乎必为配置错误。按警告处理，允许装载 |
| `smtpSecure === false` 且 `smtpPort` 为 465 | 465 通常要求隐式 TLS。按警告处理，允许装载 |
| `to` 去重后为空 | 按字段级失败处理 |
| `minTurnDurationMs > 0` 且五个通知开关全关 | 五个开关全关时插件不可能发送任何邮件。按警告处理，允许装载（用户可能正在临时停用）。实现只在开关全关时警告，不要求门槛大于 0（见第 0 节末段） |

**失败行为**：校验失败时插件**不装载**，并输出一条包含全部失败字段及其原因的结构化错误。不提供「部分生效」模式。

`enabled: false` 时不执行除 `enabled` 之外的任何校验——用户关闭插件时不应被无关的必填字段错误阻塞。

---

## 5. 挂载配置示例

示例中的值均为占位符。**真实密码不得出现在本文件、`cordis.patch.yml`、`package.json`、README 或任何提交中**（D010）。

```yaml
# cordis.patch.yml 片段（示意）
- id: dsh-mail-notify
  plugin: dsh-mail-notify
  config:
    enabled: true

    smtpHost: smtp.example.com
    smtpPort: 587
    smtpSecure: false
    smtpUser: notify@example.com
    smtpPasswordCredential: DSH_MAIL_SMTP_PASSWORD

    from: notify@example.com
    to:
      - recipient@example.com

    includeSubagents: false
    notifyCompleted: true
    notifyErrors: false
    notifyMaxTokens: true
    notifyQuestions: false
    notifyApprovals: false

    minTurnDurationMs: 0
    maxBodyChars: 100000

    includeMetadata: true
    includeUserPrompt: false
```

`DSH_MAIL_SMTP_PASSWORD` 是**引用名**（亦可写成存储寻址形式 `dsh/mail-smtp-password`）。真实 secret 由 DSH Credential 的来源层（进程环境变量、provider 管理的存储或 `.env`）提供，插件在每次发送操作时重新解析，不缓存（D010）。

---

## 6. 配置与行为的完整映射

| 配置 | 影响的执行阶段 | 影响方式 |
| --- | --- | --- |
| `enabled` | `apply()` | 为假时不注册监听器 |
| `smtpHost` / `smtpPort` / `smtpSecure` / `smtpUser` / `smtpPasswordCredential` / `from` / `to` | 发送阶段 | 构造 transport 与信封 |
| `includeSubagents` | 事件处理阶段 | 决定 subagent 是否创建 `TurnState`；Phase 8 起同一判据覆盖全部三个通知族 |
| `notifyCompleted` / `notifyErrors` / `notifyMaxTokens` | 策略阶段 | 决定终局 Turn 的 `disabled-by-policy` 抑制 |
| `notifyQuestions` / `notifyApprovals` | 策略阶段（回合中） | 决定 question / approval 通知的 `disabled-by-policy` 抑制；两者彼此独立 |
| `minTurnDurationMs` | 策略阶段 | 决定 `below-min-duration` 抑制；仅作用于终局 Turn 通知 |
| `maxBodyChars` | 渲染阶段 | 决定截断与截断标记 |
| `includeMetadata` | 渲染阶段 | 决定元数据头部是否存在 |
| `includeUserPrompt` | 采集 + 渲染阶段 | 采集始终进行，仅在为真时渲染 |
| `includeFooter` | 渲染阶段 | 决定生成器说明行与截断标记是否出现 |
| `queueSize` | 入队阶段 | 决定队列上界与 `reject newest` 触发点 |
| `retryAttempts` / `retryBaseDelayMs` | 重试阶段 | 决定尝试次数与退避时序 |
| `maxDedupeEntries` | 策略阶段 | 决定去重缓存容量 |

`includeUserPrompt` 的采集始终进行而渲染受配置控制的理由：若仅在开关打开时采集，用户无法在 Turn 进行中临时改变结果，且采集路径会因配置产生两条不同的累积逻辑。采集本身不产生外发（D012）。

---

## 7. 配置不提供的开关（有意缺失）

| 未提供的配置 | 理由 |
| --- | --- |
| `smtpPassword`（内联密码） | 会出现在用户实际配置与共享排障片段中（D010） |
| `rejectUnauthorized` / `tlsInsecure` | TLS 校验不得可关闭（D010、SECURITY.md） |
| `includeReasoning` | 推理内容外发不是用户可选项（D012） |
| `includeToolArguments` / `includeToolResults` | 同上 |
| 通知 `aborted` / `blocked` / `interrupted` 的开关 | 无用户需求支撑，且会扩大噪声 |
| `schemaVersion` 或输出格式开关 | 候选契约由代码版本决定，不由用户配置 |
| 队列满时行为开关 | 「拒绝最新 + 告警」是唯一被设计的行为（D009） |
| 跨进程去重开关 | 需要持久化状态，v1 明确不提供（D008） |
| HTML 邮件开关 | 非目标（ARCHITECTURE.md §11） |
| 邮件内作答 / 一键批准 / action link | 非目标；人工注意力通知是只读观察，不参与 answer ownership chain（D018 第十一条） |
| 深链接模板（含 DSH Web token） | 插件不构造 Web 链接，也不读取 token；auth token 与会话 secret 一律不得进入邮件（D018 Consequences） |
