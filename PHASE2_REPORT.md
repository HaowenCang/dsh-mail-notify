# Phase 2 Report

DSH Mail Notify — 第二阶段：设计冻结、正式实现规格与 GitHub 进度同步。

---

## 1. Status

**PASS**

判定依据为任务书第 39 节的逐项 PASS 条件。全部条件满足：仓库状态已核查；Phase 1 Runtime Contract 与 Phase 1 Report 已完整读取；核心语义冲突已解决并逐项记录裁决；explicit tool error 口径、usage 口径、Candidate schema、root/subagent 规则、mid-turn 规则、completion policy、dedupe 策略、queue 策略、SMTP/Credential 边界、Config Schema、Security model、Test matrix、Phase 3 implementation plan 全部冻结并写入文档；README 与 `00_MASTER.md` 已更新；两笔 Phase 2 提交已 push，本地与远端 SHA 已核对一致；无 Secret 被提交。

阶段边界严格遵守：未创建 `src/`，未创建任何插件实现，未安装 Nodemailer，未连接 SMTP，未发送任何邮件，未请求用户提供密码，未修改 DSH 核心，未 npm publish，未发布 GitHub Release，未创建任何生产凭据，未删除或改写 Phase 1 历史证据，未 force push，未重写 Git 历史。

---

## 2. Repository baseline

| 项 | 值 |
| --- | --- |
| 工作目录 | `E:\Projects\DSHarness\dsh-mail-notify` |
| Branch | `main` |
| Starting HEAD | `f47912eb9af98f0d6cd171ffeda422d0270277d7` |
| Remote | `origin` = `https://github.com/HaowenCang/dsh-mail-notify.git`（fetch 与 push 均指向该 URL） |
| Starting working tree | `nothing to commit, working tree clean` |
| 起始分支状态 | `Your branch is up to date with 'origin/main'` |
| 起始提交 | `f47912e docs: 初始化 dsh-mail-notify 设计文档与仓库元文件` |

起始工作树无未提交修改，因此不存在「用户已有改动」的处理问题：无需区分纳入或保留，也未执行任何 `git reset --hard`、`git clean -fd` 或 `git checkout -- .`。

起始仓库内容（6 个文件）：`.gitignore`、`00_MASTER.md`、`LICENSE`、`README.md`、`PHASE1_RUNTIME_CONTRACT.md`、`PHASE1_REPORT.md`。无 `package.json`、无 `src/`、无 `tests/`、无可安装 `.tgz`——与任务书描述一致。

---

## 3. Phase 1 inputs

按任务书第 2 节要求的顺序完整读取以下事实源：

| 事实源 | 读取范围 | 用途 |
| --- | --- | --- |
| `PHASE1_RUNTIME_CONTRACT.md` | 全文 646 行 | 事实基线：Services、Session、Events、Assistant Content、Tool Result、Completion Reasons、Candidate Serialization、Mid-turn Attachment、Runtime-verified Event Flow |
| `PHASE1_REPORT.md` | 全文 238 行 | 证据等级、逐项测试结果、第 7 节九项风险与未验证项、第 8 节移交决策 |
| `README.md` | 全文 55 行 | Phase 1 后的项目状态表述 |
| `00_MASTER.md` | 全文 757 行（读取时为原始长度） | 业务要求、安全约束、测试要求、交付标准、原始阶段编排 |
| `.gitignore` | 全文 42 行 | 确认受保护模式完整且未被削弱 |

事实优先级按任务书规定执行：

```text
当前运行时实证 / Inspect  >  PHASE1_RUNTIME_CONTRACT.md  >  PHASE1_REPORT.md
  >  README.md 当前状态  >  00_MASTER.md 初始设计  >  模型记忆
```

**本阶段执行的定向 Inspect**（任务书第 0 节允许「对少量真正不确定的 DSH 接口执行定向 Inspect」）。范围内共 4 次查询，全部用于 Phase 3 必须依赖、而 Phase 1 未实际调用的接口：

| # | 查询 | 确认内容 |
| --- | --- | --- |
| 1 | `host / Service / listService {credentials}` | 8 个方法签名；`resolve(ref) → Promise<ResolvedCredential \| undefined>`；`ResolvedCredential = { value: string; source: string }`；`CredentialRef = Branded<'CredentialRef'>`；per-call 解析契约的原始表述 |
| 2 | `host / Event / listEvents {session/disposed}` | mode = `emit`；签名 `(this: Scoped<Session>, session: Session): void`；触发条件为「会话离开 store 时发出一次，含 publication rollback」；监听器失败被记录并隔离 |
| 3 | `host / Builtin / listBuiltins` | 动态 Host 的符号集：`ctx`（`get` / `on` / `provide` / `effect`）、`harness`、`console`、`btoa` / `atob`、`TextEncoder` / `TextDecoder` |
| 4 | `host / Service / listService {timer}` | `timeout` / `interval` / `throttle` / `debounce` 全部返回 disposer；timeout 的 Promise 形式在 disposal 时 reject |

查询 1 与 4 的结果直接决定了 D010（凭据每次操作重新解析）与 `docs/ARCHITECTURE.md` 第 6 节（退避必须可被 dispose 中断）的措辞。查询 3 修正了 Phase 1 Report 第 219 行「Host 标准输出不可达」在一般情形下的适用范围（见第 9 节勘误第 c 项）。

除上述 4 次外未执行任何 Inspect 或运行时操作。**本阶段未运行任何动态 Cordis Plugin**，未调用 `cordis_define` / `cordis_run`。

为确认 Phase 3 scaffold 的工程约定，另读取了本机 DSH 安装中的既有事实（非 Inspect，属文件读取）：

| 事实源 | 确认内容 |
| --- | --- |
| DSH 自身 bundle 的 `package.json` | `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`（`dsh-base` / `dsh-web-app` / `dsh-headless` / `dsh-sdk-minimal` 一致） |
| DSH bundle 的 `cordis.patch.yml` | `insert:` 列表语法；`id` / `name` / `disabled` / `config` 字段；**patch 替换整行 config 而非合并** |
| `@deepseek-ai/dsh-llm-retry` 等 | function 风格插件导出 `name` / `inject` / `Config`（`@deepseek-ai/schemastery` 的 `z.object`）/ `apply` |
| 本机第三方插件 `wechat-notify` | 同一导出形态的独立复现 |

这些事实写入 `docs/IMPLEMENTATION_PLAN.md` 的 P3.1，使 Phase 3 的 scaffold 有可核查依据，而不是凭记忆假定。

---

## 4. Decisions frozen

14 项决策写入 [`docs/DECISIONS.md`](docs/DECISIONS.md)，其中 D001–D012 为任务书指定项，D013–D016 为本阶段实际需要而新增。

| ID | 决策 | 关键内容 |
| --- | --- | --- |
| D001 | 事件边界 = `session/event` + Runtime Adapter | 唯一入口；DSH payload 形状知识集中在 `runtime-adapter.ts` 单模块 |
| D002 | 可见内容 = 仅 `type === 'text'` | 白名单；`reasoning` 同样带 `text` 字段，禁止按字段名泛取 |
| D003 | root/subagent 分类 | 三判据优先级；`delegationDepth` 只允许 `typeof === 'number' && > 0` |
| D004 | mid-turn 懒初始化 | 任何带 `turn` 的事件均就地创建状态；时长未知写 `null` 不写 `0` |
| D005 | explicit tool error 语义 | `explicitToolErrorCount`；双判据取或；shell 非零退出不计入 |
| D006 | usage = 仅原始遥测 | 不计算价格、不推导一致性、不参与 completion 状态 |
| D007 | Candidate schema v1 | 必须／可选字段划分；`mailSent` 移除；完整 `visibleText` 取代预览 |
| D008 | 有界内存去重 | `dedupeKey = ${sessionId}:${turn}`；仅单进程；标记只在确定入队时写入 |
| D009 | 异步有界队列 | 并发 1，上限 100，满时拒绝最新并告警；监听器不得 await SMTP |
| D010 | Nodemailer + DSH Credential | `smtpPasswordCredential` 引用名；每次操作重新 `resolve`；禁止 `rejectUnauthorized: false` |
| D011 | 无可见文本抑制规则 | completion 通知与 failure/status 通知分离；抑制无配置开关 |
| D012 | 隐私默认值 | `includeSubagents=false`、`includeUserPrompt=false`、`notifyCompleted=true`、`notifyErrors=false`、`notifyMaxTokens=true` |
| D013 | schemaVersion 编号策略 | 字面量 `1`；新增可选字段不递增，语义变更递增（新增） |
| D014 | 截断可解释性 | `[Output truncated by dsh-mail-notify]`；按码点截断；`includeFooter` 可关闭（新增） |
| D015 | 时长门槛在未知时不抑制 | `durationMs === null` 永不触发 `below-min-duration`（新增） |
| D016 | 文档冲突裁决清单 | 10 组冲突／澄清逐项记录，含 Phase 1 勘误（新增） |

D013–D016 的新增理由：任务书给出的 D001–D012 覆盖了核心语义，但 `schemaVersion` 的演进规则、截断标记的实现位置、时长门槛与未知时长的交互、以及现有文档之间已发现的具体冲突，都直接决定 Phase 3 的代码结构，若不冻结则 Phase 3 仍需讨论——而第 40 节要求 Phase 3 在这些问题上无需继续讨论。

---

## 5. Architecture

正式架构由三条不变量约束（[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)）：

1. **DSH 原始 payload 只有一个读取点**：`src/runtime-adapter.ts` 是唯一了解 `Session`、`SessionEvent`、`event.data.*` 深路径与判别联合的模块；DSH RC API 变更时预期影响面为单文件。
2. **决策核心是纯函数**：内容提取、分类、抑制判定、候选构造、渲染、错误分类均为无副作用、无 I/O、时间由参数注入的纯函数。
3. **事件监听器路径上不存在 `await`**：`Session.append()` 在同步路径上调用监听器且不等待其返回的 Promise，因此从 `session/event` 到 `enqueue()` 必须同步；任何耗时操作只在队列 worker 中发生。

数据流：

```text
DSH Session + SessionEvent
    → runtime-adapter（唯一 DSH 边界）
    → event-handler（分派 + 累积 + 生命周期）
    → turn-state（Map<sessionId, Map<turn, TurnState>>）
    → completion（status 分类）
    → NotificationCandidate（schemaVersion 1）
    → notifier（抑制 + 去重）
    → queue（并发 1，上限 100）
    → mailer + retry（Credential resolve → Nodemailer）
```

模块布局扩展为 15 个文件（任务书建议 14 个，新增 `logger.ts`），每个模块在 `docs/ARCHITECTURE.md` 第 3 节给出职责、输入、输出与**不允许承担的职责**。`src/logger.ts` 的新增理由：日志脱敏是 `docs/SECURITY.md` 的强制项，若没有单一出口，脱敏规则会散布到各模块的调用点。

`TurnState` 的字段、两种创建路径（正常初始化与懒初始化）、每类事件的更新规则、以及「仅当提取结果非空时覆盖 `lastVisibleAssistantText`」的行为均已冻结。状态生命周期固定为「逐 Turn 结算即清理」＋「`session/disposed` 清理整会话」＋「插件 dispose 清理全部」，三者共同保证不无限保存历史会话。

---

## 6. Configuration

完整配置表、默认值、校验规则与失败行为见 [`docs/CONFIG_SPEC.md`](docs/CONFIG_SPEC.md)。冻结的默认值：

| 字段 | 默认 |
| --- | --- |
| `enabled` | `true` |
| `smtpPort` | `587` |
| `smtpSecure` | `false` |
| `includeSubagents` | `false` |
| `notifyCompleted` | `true` |
| `notifyErrors` | `false` |
| `notifyMaxTokens` | `true` |
| `minTurnDurationMs` | `0` |
| `maxBodyChars` | `100000` |
| `includeMetadata` | `true` |
| `includeUserPrompt` | `false` |
| `includeFooter` | `true` |
| `queueSize` | `100` |
| `retryAttempts` | `3` |
| `retryBaseDelayMs` | `1000` |
| `maxDedupeEntries` | `1000` |

必填字段：`smtpHost`、`smtpUser`、`smtpPasswordCredential`、`from`、`to`（`string[]`，至少一个收件人）。

两处需要说明的取值：`minTurnDurationMs` 默认 `0` 而非正数——默认开启过滤会让用户在不知情的情况下丢失通知（不可察觉），而默认不过滤的最坏后果是多几封邮件（可察觉、可配置修正）；`notifyErrors` 默认 `false` 而 `notifyMaxTokens` 默认 `true`——`max-tokens` 表示输出被硬截断，收件人若不被告知会把不完整答复读作完整结论，而 `error` 通常可在同一会话中重启 Turn 自然获知。

配置不提供 `smtpPassword`（内联密码）、`rejectUnauthorized`（TLS 关闭）、`includeReasoning`、`includeToolArguments`、队列满时行为开关、跨进程去重开关等字段，理由逐项记录在 `docs/CONFIG_SPEC.md` 第 7 节。

---

## 7. Security

完整条款见 [`docs/SECURITY.md`](docs/SECURITY.md)。核心边界：

- **邮件意味着输出离开本机。** 威胁模型明确列出四条资产—威胁—控制链，并明确不防御已获得本机文件系统读写权限的攻击者（插件不是该层级的控制点），也不防御邮件服务商自身的泄露（一旦发送即受服务商策略与保留期约束）。
- **凭据生命周期。** 配置只保存引用名；真实 secret 由 DSH Credential 服务的分层来源提供；每次发送操作开头 `resolve`，禁止写入模块级变量、配置对象或类字段；诊断信息使用 `describe()` 而非 `resolve()`。
- **TLS 校验不得关闭。** `rejectUnauthorized: false`、`tls: { rejectUnauthorized: false }`、`NODE_TLS_REJECT_UNAUTHORIZED=0` 一律禁止，且不提供任何形式的开关（包括「仅调试」开关）。
- **日志脱敏。** 白名单允许记录 sessionId / turn / status / provider / model / visibleTextLength / durationMs / explicitToolErrorCount / 队列与重试计数 / 错误分类；禁止完整 `visibleText`、reasoning、tool arguments/results、凭据、SMTP auth 对象。SMTP 错误对象只按白名单提取 `code` / `responseCode` / `command` / 清洗后的 `message`，并专项处理认证失败类错误可能回显用户名的问题。SMTP 返回文本按外部输入处理（日志注入防护）。
- **隐私默认。** 默认不外发用户 prompt、不外发 subagent 内容；永久禁止外发项（reasoning、system prompt、tool arguments、tool result 原文、凭据）不提供任何配置开关。
- **仓库与产物卫生。** `.gitignore` 现有模式完整保留、未削弱；tarball 的 `files` 采用白名单；测试禁止使用真实密码 fixture。

---

## 8. Testing strategy

完整矩阵见 [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)，共六个层次与 18 组用例（CNT / TRUNC / SES / TRN / TOOL / USE / CAND / NORM / DED / SUP / QUE / ADP / SEC / RET / PRIV / LIFE / E2E / PKG）。

| 层次 | 对象 | 是否触网 |
| --- | --- | --- |
| L1 纯函数单测 | content / completion / normalize / subject / retry / turn-state / notifier | 否 |
| L2 队列与生命周期 | queue / event-handler（假 sink、假 timer） | 否 |
| L3 适配器 | runtime-adapter（含畸形 payload 样本） | 否 |
| L4 SMTP 集成 | mailer + retry + queue（stub transport） | **否** |
| L5 端到端契约 | 完整插件（假事件总线 + DebugSink） | 否 |
| L6 打包与安装 | `.tgz` 在独立 DSH 安装中 | 仅本地 |

设计要求中值得单独指出的三点：

1. **负向断言。** PRIV-01…04 与 SEC-04/05 采用「断言正文／日志不含特定字符串」，而不是只断言包含期望字段。仅正向断言的测试无法发现新增字段导致的泄露。
2. **两条语义锚点用例。** TOOL-05（非零退出不计入错误计数）与 USE-05（usage 数值不自洽时不校正）把 Phase 2 最重要的两个口径决定固定为可执行断言，使它们不会在后续实现中被「顺手修正」。
3. **同步性断言。** QUE-06 / QUE-07 与 E2E-07 验证监听器返回 `undefined` 且在慢 sink 下仍立即返回，这是「不阻塞 Agent Loop」唯一可自动化的判据。

唯一的真实 SMTP 路径是显式运行的手工 smoke test（`scripts/smtp-smoke-test.ts`），不属于自动化矩阵。

---

## 9. Document conflicts and errata

任务书第 2 节要求「如果文档之间存在冲突，不得默默选择」。**本阶段发现 10 组冲突或需要澄清的不一致，全部记录在 [`docs/DECISIONS.md`](docs/DECISIONS.md) D016**，逐项给出冲突内容、采用一方与理由。其中任务书本身未提及、由本阶段主动发现并裁决的有两组：

- **`smtpPasswordEnv`（`00_MASTER.md` §6/§15）与 `smtpPasswordCredential`（Phase 2 要求）。** 采用后者。`CredentialRef` 是分层解析器（进程环境变量 / provider 存储 / `.env`），名称中的 `Env` 会误导用户以为只能通过环境变量配置。`00_MASTER.md` 已就地标注更名说明。
- **`toolErrorCount`／`toolErrors` 与 `explicitToolErrorCount`。** 采用后者，因为原名未表达「仅 DSH 显式标记」这一限定，而该限定正是 Phase 1 风险 3 的争议焦点。

**Phase 1 文档处理。** 按任务书第 30 节，`PHASE1_RUNTIME_CONTRACT.md` 与 `PHASE1_REPORT.md` **未被修改**（可核验：两文件的最后一笔提交仍为 `f47912e`）。读取过程中发现三处细节层偏差，按「不得静默改写」的要求以勘误形式记录在 D016 第 9 项：

| # | 位置 | 偏差 | 对 Phase 1 结论的影响 |
| --- | --- | --- | --- |
| a | `PHASE1_REPORT.md:128` | 把 `aborted.reason.kind` 的类型写作 `TurnCancelledCause`；实际类型名为 `TurnEndCancelCause` | 无。仅类型名 |
| b | `PHASE1_RUNTIME_CONTRACT.md:361` | 把 `'user' \| 'parent' \| 'hook' \| 'disposed' \| 'legacy'` 写作同一层并列；实际结构为 `AgentCancelCause \| { kind: 'legacy' }`，且 `hook` 分支携带 `reason: string` | 无。取值集合本身正确 |
| c | `PHASE1_REPORT.md:219` | 「Host 标准输出不可达」；实际动态 Host 的 Builtin 目录含 `console`（package-tagged） | 无。该结论描述的是 Phase 1 原型运行环境 |

三项均为细节层偏差，不推翻 Phase 1 的任何运行时结论，因此**不构成对 Phase 1 判定（PASS）的修订**。三处均未就地改写 Phase 1 文件。

---

## 10. Remaining unknowns

以下为真正剩余、且**不阻塞 Phase 3 开工**的未知项。每项都已在设计中给出应对方式，因此 Phase 3 遇到它们时无需重新讨论架构。

| # | 未知项 | 来源 | Phase 3 的应对 |
| --- | --- | --- | --- |
| 1 | `usage` 计数器语义（`inputTokens` 与 `totalTokens` 量级不自洽） | Phase 1 风险 7 | 不追求确认。D006 将 usage 限定为原始遥测，不推算、不展示、不参与状态 |
| 2 | `max-tokens` / `error` / `aborted` / `blocked` / `interrupted` 五种 `turn/end` kind 的真实触发 | Phase 1 风险 5 | 接口契约已确证（6 种 kind 及 detail 结构）；分类与渲染按契约实现，L1 用例覆盖全部 6 种 + 防御性 `unknown`。真实触发依赖模型与 provider 行为，不可自动化 |
| 3 | `session/disposed` 与 Fiber dispose 清理的运行时确认 | Phase 1 风险 4 | 作为释放路径实现；常态路径由「逐 Turn 结算即清理」承担，不依赖该事件才能有界 |
| 4 | 顶层会话「从 `turn/start` 起完整覆盖」的候选尚未读取到 | Phase 1 风险 1 | 与 mid-turn 共用同一 `turnStateOf`，逻辑等价性已由 Phase 1 说明；L5 用例 E2E-01 覆盖 |
| 5 | `completed-with-tool-errors` 的组合未在真实 Turn 上复测 | Phase 1 风险 2 | 两个输入各自已运行时确证；L1 + L5 用例覆盖组合 |
| 6 | 跨进程 exactly-once 不存在 | 本阶段明确界定的边界（D008） | 不实现。边界写入用户可见文档，避免用户推断出跨重启强保证 |
| 7 | shell / pwsh 命令的业务执行失败无法从 DSH 信号中区分 | Phase 1 风险 3 的残余部分 | 明确排除在 `explicitToolErrorCount` 之外；预留 `executionIssueCount` 概念，不定义字符串解析算法 |
| 8 | DSH 升级后字段路径可能变化 | 结构性风险 | `runtime-adapter.ts` 为单点影响面；L3 适配器测试的人工样本是预期的维护点 |

第 7 项需要说明其性质：它不是「待确认的未知」，而是**已确认不可从现有信号中获得的量**。把它列入未知项是为了避免后续误以为「再查一次就能拿到」。

---

## 11. Phase 3 readiness

**READY**

任务书第 40 节列出的 18 个主题逐一对应到已冻结的文档位置，均无待决问题：

| 主题 | 冻结位置 |
| --- | --- |
| event boundary | D001、ARCHITECTURE 第 2/10 节 |
| runtime adapter | D001、ARCHITECTURE 第 3 节 `runtime-adapter.ts` |
| internal DTO | D007、ARCHITECTURE 第 3 节 `types.ts` |
| visible text | D002、ARCHITECTURE 第 3 节 `content.ts` |
| root/subagent | D003、ARCHITECTURE 第 3 节 `runtime-adapter.ts` |
| mid-turn | D004、ARCHITECTURE 第 4 节 |
| completion status | ARCHITECTURE 第 5 节 |
| explicit tool errors | D005 |
| usage telemetry | D006 |
| dedupe | D008 |
| queue | D009 |
| retry | ARCHITECTURE 第 6 节 |
| Credential | D010、SECURITY 第 2 节 |
| SMTP config | CONFIG_SPEC 第 2.2/2.3 节 |
| privacy | D012、SECURITY 第 5 节 |
| test matrix | TEST_PLAN 全文 |
| module layout | ARCHITECTURE 第 3 节 |
| 执行顺序 | IMPLEMENTATION_PLAN P3.1–P3.7 |

Phase 3 应当能够仅依赖仓库文档开始实现，无需重新 Inspect DSH API 或重新讨论核心架构。唯一预期需要 Inspect 的情形是 DSH 版本升级导致适配器字段路径失配——这属于实现期的适配工作，不是设计未决。

---

## 12. Git synchronization

| 项 | 值 |
| --- | --- |
| Repository | `https://github.com/HaowenCang/dsh-mail-notify` |
| Branch | `main` |
| Starting SHA | `f47912eb9af98f0d6cd171ffeda422d0270277d7` |
| Phase 2 implementation commit | `pending` — `docs: complete phase 2 design freeze` |
| Final documentation sync commit | `pending` — `docs: record phase 2 synchronization` |
| Remote SHA | `pending` |
| Sync status | `pending` |

工作树在提交前状态：`docs/` 目录为新建（6 个文件），`README.md` 与 `00_MASTER.md` 为修改，`PHASE2_REPORT.md` 为新建。`PHASE1_RUNTIME_CONTRACT.md`、`PHASE1_REPORT.md`、`.gitignore`、`LICENSE` 未改动。

未执行 `git reset --hard`、`git clean -fd`、`git push --force`、`git rebase --onto`、`git commit --amend`。未创建 GitHub Release，未执行 npm publish。

---

## 13. Phase 3 next step

Phase 3 的第一项动作是 [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) 的 **P3.1 Project scaffold**：建立 `package.json`（含 `dsh.bundle.patch` manifest）、`tsconfig.json`、`cordis.patch.yml`、最小可装载的 `src/index.ts` 与 `src/logger.ts`，并验证该骨架能在 DSH 中装载、在 `enabled: false` 时不注册任何监听器。

P3.1 的具体形状（manifest 字段、`insert` 挂载语法、`Config` schema 的声明方式、`peerDependencies` 的范围策略、patch 替换整行 config 的后果）已由本机既有 DSH bundle 与第三方插件取证，写入 `docs/IMPLEMENTATION_PLAN.md`，无需在 Phase 3 重新探查。
