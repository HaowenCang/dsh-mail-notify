# dsh-mail-notify

DeepSeek Harness（DSH）Host 插件，用于在顶层 Agent Turn 结束时，把该 Turn 最终用户可见的模型输出通过 SMTP 发送邮件通知。

仓库当前处于设计验证阶段：Phase 1（运行时接口 Inspect）与动态原型验证已经完成并留下两份可核查的文档，正式 TypeScript 插件项目（Phase 3）尚未开始。因此本仓库暂时没有可安装产物，也没有 `package.json` / `src/` / `tests/`。

## 目标形态

插件以 DSH bundle 形式交付，安装方式预期为：

```bash
dsh plugin --profile web add ./dsh-mail-notify-<version>.tgz
```

交付形态要求独立、可测试、可打包，且不修改 DeepSeek Harness 核心源码。

## 当前状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 1 | 运行时 API Inspect 与 Host-only 动态原型验证 | 已完成 |
| Phase 2 | 正式插件设计口径确定（如 `toolErrorCount` 判据） | 待开始 |
| Phase 3 | TypeScript 正式项目、测试矩阵、打包与安装验证 | 待开始 |

Phase 1 的原型为进程内临时对象（Plugin ID `mailnt-1`），不发送任何邮件、不访问网络、不读取凭据、未安装 Nodemailer；它只把 Turn 完成事件转换为结构化候选记录，用于验证接口契约。DSH 进程重启后该原型不再存在，本阶段结论以仓库内两份文档为准。

## 文档

| 文件 | 内容 |
| --- | --- |
| [`00_MASTER.md`](00_MASTER.md) | 项目总设计：业务要求、事件状态机、隐私与安全约束、模块划分、测试与交付标准 |
| [`PHASE1_RUNTIME_CONTRACT.md`](PHASE1_RUNTIME_CONTRACT.md) | 运行时契约：经 Inspect 或运行时取证确认的 DSH Service / Event / 字段路径，并标注取证方式 |
| [`PHASE1_REPORT.md`](PHASE1_REPORT.md) | Phase 1 报告：逐项验证结果、证据等级、已确证事件流、风险与未验证项、进入下一阶段的判定 |

## 已确证的关键契约

以下几项与最初设计假设存在差异，已在文档中固化：

- Session 事件是单一入口。运行时并不存在四个独立顶层事件，`turn/start`、`assistant/message`、`tool/result`、`turn/end` 都是 `ctx.on('session/event', (session, event) => …)` 的 `event.type` 取值，按 type 分派。
- 用户可见文本只来自 `event.data.message.content[i].text` 且 `.type === 'text'`；`reasoning`、`tool-call`、`tool-result`、`image` 及未知 block 类型一律排除或安全跳过。
- 顶层会话判定以 `session.header.origin === 'subagent'` 为首选判据，`parentSession`、`delegationDepth > 0` 为冗余判据；真值或键存在性写法不可用。
- `tool/result` 的工具失败有两个判据，宽信号 `message.content[0].isError === true` 与窄信号 `event.data.error`，二者覆盖范围不同；bash / pwsh 的非零退出被设计为成功，不计入错误。
- 邮件正文默认只包含最终可见文本与少量元数据（Session ID、cwd、provider/model、耗时、completion 状态），不含 reasoning、tool arguments、tool results、凭据或用户原始 Prompt。

## 已知限制

`PHASE1_REPORT.md` 第 7 节列出九项风险与未验证项，其中影响后续实现的主要有：五种非 `completed` 的 `turn/end` 类型尚未真实触发；`usage` 计数器语义未确认（`inputTokens` 与 `totalTokens` 量级不自洽）；`session/disposed` 与 Fiber dispose 后的状态释放只有实现层依据；mid-turn 装载情况下 `durationMs` 恒为 `null`。

## 安全边界

设计约束禁止将 SMTP 密码写入源码或 `cordis.patch.yml`，密码应通过 DSH Credential service 在每次发送操作开始时解析且不得缓存到长期变量；日志不得输出密码，错误对象在记录前须脱敏；不得关闭 TLS 证书校验，不得使用 `rejectUnauthorized: false`；不得无限重试、无限队列或无限缓存。

## 许可

MIT，见 [`LICENSE`](LICENSE)。
