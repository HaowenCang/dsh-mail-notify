# dsh-mail-notify

DeepSeek Harness（DSH）Host 插件，用于在顶层 Agent Turn 结束时，把该 Turn 最终用户可见的模型输出通过 SMTP 发送邮件通知。

**本仓库当前仍没有可安装产物，也没有 `package.json` / `src/` / `tests/`。** Phase 1（运行时 Inspect 与动态 Host 原型验证）与 Phase 2（设计冻结与正式实现规格）均已完成；正式 TypeScript 插件实现尚未开始。任何安装命令在当前状态下都会失败。

## 目标形态

插件以 DSH bundle 形式交付，安装方式预期为：

```bash
dsh plugin --profile web add ./dsh-mail-notify-<version>.tgz
```

交付形态要求独立、可测试、可打包，且不修改 DeepSeek Harness 核心源码。

## 当前状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 1 | 运行时 API Inspect、Host-only 动态原型验证、Runtime Contract 固化 | 已完成（PASS） |
| Phase 2 | 设计冻结：工具错误口径、候选 DTO、完成策略、架构、配置、安全、测试矩阵、实现计划 | 已完成（PASS） |
| Phase 3 | TypeScript 正式项目、测试矩阵、打包与安装验证 | 下一步 |

Phase 1 的原型为进程内临时对象（Plugin ID `mailnt-1`），不发送任何邮件、不访问网络、不读取凭据、未安装 Nodemailer；它只把 Turn 完成事件转换为结构化候选记录，用于验证接口契约。DSH 进程重启后该原型不再存在，本阶段结论以仓库内两份 Phase 1 文档为准。

Phase 2 未创建任何源码文件，也未安装 Nodemailer、未连接 SMTP、未发送任何邮件、未创建任何凭据。其交付物是 `docs/` 下的六份规格文档与 Phase 2 报告，供 Phase 3 仅依赖文档即可开始实现。

## 文档

### Phase 1（历史证据，未修改）

| 文件 | 内容 |
| --- | --- |
| [`PHASE1_RUNTIME_CONTRACT.md`](PHASE1_RUNTIME_CONTRACT.md) | 运行时契约：经 Inspect 或运行时取证确认的 DSH Service / Event / 字段路径，并标注取证方式 |
| [`PHASE1_REPORT.md`](PHASE1_REPORT.md) | Phase 1 报告：逐项验证结果、证据等级、已确证事件流、风险与未验证项、进入下一阶段的判定 |

### Phase 2（设计冻结）

| 文件 | 内容 |
| --- | --- |
| [`PHASE2_REPORT.md`](PHASE2_REPORT.md) | Phase 2 报告：状态、仓库基线、冻结的决策、架构、配置、安全、测试策略、剩余未知项、Phase 3 就绪判定、Git 同步记录 |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 决策记录（ADR）：D001–D016，每项含 Decision / Reason / Rejected alternatives / Consequences，以及全部文档冲突的裁决清单 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 正式架构：数据流、Phase 3 模块布局与逐模块职责边界、TurnState 规格、完成分类、重试分类、状态生命周期、可观测性 |
| [`docs/CONFIG_SPEC.md`](docs/CONFIG_SPEC.md) | 配置规范 v1：完整字段表、默认值、校验规则与失败行为、挂载示例、有意缺失的开关 |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 安全边界：威胁模型、凭据生命周期、TLS 约束、日志脱敏、隐私默认值、仓库与产物卫生、用户须知 |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) | 测试矩阵：六个测试层次与逐条用例（CNT / TRUNC / SES / TRN / TOOL / USE / CAND / NORM / DED / SUP / QUE / ADP / SEC / RET / PRIV / LIFE / E2E / PKG） |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Phase 3 实现计划：P3.1–P3.7 每步的输入、输出、验证方式与失败条件 |

### 总设计

| 文件 | 内容 |
| --- | --- |
| [`00_MASTER.md`](00_MASTER.md) | 项目总设计：业务要求、事件状态机、隐私与安全约束、模块划分、测试与交付标准，以及经 Phase 1 实证后重新编排的 Execution Roadmap |

## 已确证的关键契约

以下几项与最初设计假设存在差异，已在 Phase 1 固化，并在 Phase 2 冻结为实现规格：

- Session 事件是单一入口。运行时并不存在四个独立顶层事件，`turn/start`、`assistant/message`、`tool/call`、`tool/result`、`turn/end` 都是 `ctx.on('session/event', (session, event) => …)` 的 `event.type` 取值，按 type 分派。DSH 原始 payload 的形状知识集中在唯一的 `runtime-adapter` 模块内。
- 用户可见文本只来自 `event.data.message.content[i].text` 且 `.type === 'text'`；`reasoning`、`tool-call`、`tool-result`、`image`、`file` 及未知 block 类型一律排除。注意 `reasoning` block 同样带 `text` 字段，因此必须按 `type` 白名单取值，不得按字段名泛取。
- 顶层会话判定以 `session.header.origin === 'subagent'` 为首选判据，`parentSession`、`delegationDepth > 0` 为冗余判据；真值写法与键存在性写法都会把 `delegationDepth: 0` 的合法根会话误判为 subagent，因此禁止使用。
- 插件可能在 Turn 中途装载，因此任何携带 `turn` 编号的事件都必须懒初始化 `TurnState`；未观察到 `turn/start` 时时长记为 `null`（未知）而不是 `0`，且不因时长未知而抑制通知。
- 工具错误口径已冻结为 `explicitToolErrorCount`：仅统计 DSH 显式标记为失败的工具结果（`content[0].isError === true` 或 `event.data.error !== undefined`）。**bash / pwsh 的非零退出被 DSH 设计为正常 Tool Result，不计入**。因此 `completed-clean` 的含义是「DSH 未报告显式工具失败」，不等价于「所有命令的业务执行均成功」。
- `usage` 仅作为原始遥测保留：不作价格计算、不做一致性推导、不参与完成状态判定。Phase 1 已记录其计数器语义未确认（`inputTokens` 与 `totalTokens` 量级不自洽）。
- 邮件正文默认只包含最终可见文本与少量元数据（Session ID、cwd、provider/model、耗时、完成状态），不含 reasoning、tool arguments、tool results、凭据或用户原始 Prompt。
- 无可见文本的 Turn 默认不发送邮件（记录 `suppressedReason = "no-visible-text"`）。默认通知的状态为 `completed-clean`、`completed-with-tool-errors`、`max-tokens`；`error` 默认关闭但可配置；`aborted`、`blocked`、`interrupted` 不提供开关。
- 通知经有界内存队列异步发送（并发 1，默认上限 100，满时拒绝最新并告警），事件监听器内不做任何 SMTP I/O；去重为单进程内存 LRU，**不保证**跨进程 exactly-once。

## 已知限制

Phase 1 报告第 7 节列出九项风险与未验证项，Phase 2 已对其中可裁决项给出结论：

- 五种非 `completed` 的 `turn/end` 类型尚未真实触发；其分类与主题渲染已按接口契约实现规格冻结，但真实触发依赖模型与 provider 行为，不可自动化测试。
- `usage` 计数器语义未确认，且 Phase 2 决定不再追求确认——正式设计将其限定为原始遥测，不用于任何推导或展示决策。
- `session/disposed` 与 Fiber dispose 后的状态释放只有实现层依据，DSH 进程存活期内会话通常不卸载。Phase 2 将其作为释放路径保留，并以「逐 Turn 结算即清理」作为常态路径上的主要约束。
- mid-turn 装载情况下 `durationMs` 恒为 `null`。这是设计取舍而非缺陷，正式实现对未知时长既不伪造也不据此抑制。
- 去重不跨进程。DSH 进程重启后，被重放的历史 Turn 可能产生第二封邮件。

## 安全边界

设计约束禁止将 SMTP 密码写入源码或 `cordis.patch.yml`；配置中只保存凭据**引用名**（`smtpPasswordCredential`，如 `DSH_MAIL_SMTP_PASSWORD`），真实 secret 由 DSH Credential service 在每次发送操作开始时解析且不得缓存到长期变量；日志不得输出密码，错误对象在记录前须脱敏；不得关闭 TLS 证书校验，不得使用 `rejectUnauthorized: false`；不得无限重试、无限队列或无限缓存。完整条款见 [`docs/SECURITY.md`](docs/SECURITY.md)。

## 许可

MIT，见 [`LICENSE`](LICENSE)。
