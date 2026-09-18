# TEST_PLAN — dsh-mail-notify

本文件定义测试矩阵、测试层次与断言要求。矩阵中的每条用例都对应 [`DECISIONS.md`](DECISIONS.md) 中某项可验证的冻结断言；未在矩阵中出现的决策不视为已冻结。文件成文于 Phase 3，`§6.2`、`§6.3`、`§14.1`、`§14.2`、`PKG-07`、`PKG-08` 与 `DUR-05/06` 由 Phase 6 增补，`§8.1`、`§14.3`–`§14.6` 与 `PKG-09` 由 Phase 8 增补（D018）；既有条目未被改写。

---

## 1. 测试层次与工具

| 层次 | 对象 | 工具策略 | 是否触网 |
| --- | --- | --- | --- |
| L1 纯函数单测 | `content.ts`、`completion.ts`、`normalize.ts`、`subject.ts`、`retry.ts`、`turn-state.ts`、`telemetry.ts`、`notifier.ts`、`human-attention.ts` | 无 mock、无 I/O、时间由参数注入 | 不触网 |
| L2 队列与生命周期单测 | `queue.ts`、`event-handler.ts` | 注入假 sink、假 timer、假记录器 | 不触网 |
| L3 适配器测试 | `runtime-adapter.ts` | 手工构造的 `SessionEvent` 形状对象（含畸形样本） | 不触网 |
| L4 SMTP 集成测试 | `mailer.ts` + `retry.ts` + `queue.ts` | Nodemailer `streamTransport` / `jsonTransport` 或自定义 stub transport；错误由 stub 抛出 | **不触网** |
| L5 端到端契约测试 | 完整插件 | 假事件总线（直接调用注册的监听器）+ stub transport | **不触网** |
| L6 运行时安装测试 | 打包后的 `.tgz` | 独立 DSH 安装 + 显式 `enabled: false` 或指向本地 sink | 仅本地 |

测试运行器采用 DSH 生态中通用的 Vitest；该选择在 Phase 3 P3.1 中确定，不影响本矩阵的内容。

> **Implementation note（Phase 3 补记，2026-09）。** 测试运行器最终采用 **Node 内置 `node --test`**，未引入 Vitest。理由是本机与研究生态的既有约定（同机 `dsh-vibe-usage-sync` 使用 `node --test` 且已通过），以及 Node 24 原生支持直接执行 `.ts` 测试文件：这使整个测试栈不新增任何依赖，与「只引入完成设计所必需的依赖」一致。矩阵内容、层次划分与断言要求未因此改变，L1–L5 全部不触网。
>
> 运行命令：`npm test` → `node --test "tests/**/*.test.ts"`。
>
> 目录与层次对应关系：`tests/unit`（L1）、`tests/adapter`（L3）、`tests/integration`（L2、L4、L5）、`tests/package`（L6 中可自动化的部分）、`tests/fixtures`（真实 runtime shape 的脱敏样本）、`tests/support`（配置与候选构造辅助）。
>
> **L6 的实际执行结果。** PKG-01、PKG-02 由 `tests/package/tarball.test.ts` 对真实 `npm pack` 产物自动断言（并要求 `tar` 与 `npm` 在 PATH 上）。PKG-03…PKG-06 需要独立 DSH 安装，已实际执行但**不是自动化测试**，证据见 [`DSH_INTEGRATION.md`](DSH_INTEGRATION.md) 第 4 节与 [`../PHASE3_REPORT.md`](../PHASE3_REPORT.md)。
>
> **一条运行时观察需记录。** 重复 `turn/end` 在真实运行时会因「结算即释放」而重建空状态，从而先命中 `no-visible-text` 抑制，`duplicate` 分支在真实运行时因此是防御性的。DED-01/DED-04 由 L1/L2 覆盖（驱动真实事件总线），该观察已写入 `DSH_INTEGRATION.md` 第 4 节。


**硬性要求**：L1–L5 全部不得产生真实网络连接。唯一的真实 SMTP 路径是显式运行的手工 smoke test（`scripts/smtp-smoke-test.ts`，`00_MASTER.md` §17），它不属于自动化测试矩阵。

---

## 2. 覆盖矩阵总览

| 决策 | 主要验证层次 | 用例编号 |
| --- | --- | --- |
| D001 事件边界 | L3、L5 | SES-05、ADP-01…ADP-06 |
| D002 可见内容白名单 | L1 | CNT-01…CNT-07 |
| D003 根/子会话判定 | L3、L5 | SES-01…SES-05 |
| D004 mid-turn 懒初始化 | L2、L5 | TRN-03、TRN-09 |
| D005 显式工具错误 | L1、L3 | TOOL-01…TOOL-05 |
| D006 usage 原始遥测 | L1 | USE-01…USE-06 |
| D007 候选 DTO | L1、L5 | CAND-01…CAND-04 |
| D008 去重 | L1、L2 | DED-01…DED-04 |
| D009 有界队列 | L2 | QUE-01…QUE-06 |
| D010 凭据每次解析 | L4 | SEC-01…SEC-04 |
| D011 无可见文本抑制 | L1、L2 | SUP-01…SUP-04 |
| D012 隐私默认 | L1、L5、L6 | PRIV-01…PRIV-08 |
| D013 schemaVersion | L1 | CAND-01 |
| D014 截断 | L1 | TRUNC-01…TRUNC-05 |
| D015 时长门槛与时长语义 | L1、L5 | DUR-01…DUR-06 |
| D017 Turn 级遥测聚合 | L1、L5 | USE-10…USE-25b、TEL-01…TEL-15 |
| D018 三条通知链路与隐私边界 | L1、L2、L4、L5，外加 `§14.3`、`§14.4` 的探针 | FNL-01…FNL-11、HAT-01…HAT-12f、HAT-POL-01…HAT-POL-08、QUE-01…QUE-12、APR-01…APR-08、PROBE-01…PROBE-03 |

D018 同一行内出现两个 `QUE-` 前缀组，各自属于不同对象：`§9` 的 `QUE-01…QUE-07` 是**队列**用例，`§14.5` 的 `QUE-01…QUE-12` 是 **question 通知**用例。编号沿用各自文件中的既有 id，不重新编号；引用时以所在小节为准。

---

## 3. Content（D002、D014）

| 编号 | 用例 | 输入 | 期望 | 层次 |
| --- | --- | --- | --- | --- |
| CNT-01 | 仅 text | `[{type:'text',text:'A'}]` | `'A'` | L1 |
| CNT-02 | 仅 reasoning | `[{type:'reasoning',text:'R'}]` | `''`，且**不抛异常** | L1 |
| CNT-03 | reasoning + text | `[{type:'reasoning',text:'R'},{type:'text',text:'A'}]` | `'A'`，不含 `'R'` | L1 |
| CNT-04 | text + tool-call | `[{type:'text',text:'A'},{type:'tool-call',id:'x',name:'n',arguments:'{"p":1}'}]` | `'A'`，不含 `arguments` 内容 | L1 |
| CNT-05 | 多个 text block | 三个 text block | 以 `\n` 连接；空串与纯空白 block 被丢弃 | L1 |
| CNT-06 | 未知 block 类型 | `[{type:'future-kind',payload:{…}},{type:'text',text:'A'}]` | `'A'`，未知类型静默跳过 | L1 |
| CNT-07 | 畸形输入 | `null`、非数组、元素为非对象、`text` 非字符串 | 返回 `''`，不抛异常 | L1 |
| TRUNC-01 | 恰好等于上限 | 长度 = `maxBodyChars` | 不截断，无标记 | L1 |
| TRUNC-02 | 上限 + 1 | 长度 = `maxBodyChars + 1` | 截断，含标记，`truncated: true` | L1 |
| TRUNC-03 | 多字节边界 | 截断点落在代理对中间 | 不产生孤立代理项；字符串可按码点遍历 | L1 |
| TRUNC-04 | `includeFooter: false` | 截断发生 | 正文无标记，但 `truncated: true` 仍写入日志 | L1 |
| TRUNC-05 | 长度语义 | 截断场景 | `visibleTextLength` 是截断前长度 | L1 |

---

## 4. Session（D003）

| 编号 | 用例 | 构造的 header | 期望 | 层次 |
| --- | --- | --- | --- | --- |
| SES-01 | 根会话 | `{origin: undefined, parentSession: undefined, delegationDepth: undefined}` | 非 subagent | L3 |
| SES-02 | 根会话 depth 0 | `{origin: null, parentSession: null, delegationDepth: 0}` | **非 subagent**（这是 Phase 1 确证的误判陷阱） | L3、L5 |
| SES-03 | subagent 由 origin | `{origin:'subagent'}` | subagent，`decidedBy: 'origin'` | L3 |
| SES-04 | subagent 由 parentSession | `{origin: undefined, parentSession:'session-x'}` | subagent，`decidedBy: 'parentSession'` | L3 |
| SES-05 | subagent 由 depth | `{origin: undefined, parentSession: undefined, delegationDepth: 1}` | subagent，`decidedBy: 'delegationDepth'` | L3 |
| SES-06 | `delegationDepth: 0` 与 `1` 的差异 | 两个会话仅 depth 不同 | 严格 `> 0` 比较，0 判为根 | L3 |
| SES-07 | 恶意 id 格式 | `id: 'session-subagent-lookalike'` | 不影响判定（不得按 id 格式推断） | L3 |

SES-02 与 SES-06 必须存在。它们对应 Phase 1 在运行时实际捕获的误判风险，而不是假想边界。

---

## 5. Turn 生命周期（D004、D005、D015）

| 编号 | 用例 | 事件序列 | 期望 | 层次 |
| --- | --- | --- | --- | --- |
| TRN-01 | 普通 Turn | `turn/start` → `assistant/message` → `turn/end(completed)` | `status: completed-clean`，`sawTurnStart: true`，`telemetryComplete: true`，`durationMs` 为数值 | L1、L5 |
| TRN-02 | 多 step | `turn/start` → 3 组 (`assistant/message` + `tool/call` + `tool/result`) → `turn/end` | `steps: 3`，计数正确，**不在任何 `assistant/message` 时提前产生候选** | L1 |
| TRN-03 | mid-turn 装载 | 首个事件为 `assistant/message`（无 `turn/start`） → … → `turn/end` | `sawTurnStart: false`，`telemetryComplete: false`，`durationMs: null`，但计数为真实累积值（**非零**） | L2、L5 |
| TRN-04 | completed clean | `turn/end(completed)` + 0 显式错误 | `completed-clean` | L1 |
| TRN-05 | completed 含显式工具错误 | `turn/end(completed)` + ≥1 `isError` | `completed-with-tool-errors` | L1 |
| TRN-06 | max-tokens | `turn/end(max-tokens)` | `status: max-tokens`，主题显式标记 | L1 |
| TRN-07 | error | `turn/end(error)` + `error.code`/`message` | `status: error`，`turnEndDetail` 为 code，`reasonDetail` 截断且清洗 | L1 |
| TRN-08 | aborted / blocked / interrupted | 三种 kind | 三种 status 各自正确；`aborted` 的 `turnEndDetail` 为 cause kind | L1 |
| TRN-09 | 未知 kind（防御） | `turn/end({kind:'future-kind'})` | `status: unknown`，不抛异常，不通知 | L1 |
| TRN-10 | 空文本不污染 | `assistant/message(text)` → `assistant/message(仅 reasoning)` → `turn/end` | `lastVisibleText` 仍为前一条文本 | L1 |
| TRN-11 | step 计数 | 同一 step 多次事件 + 含间隙的 step 编号 | `steps` 是不同 step 编号的数量，不是最大值 | L1 |
| DUR-01 | 时长未知不抑制 | mid-turn + `minTurnDurationMs: 60000` | **不抑制**（`durationMs === null`） | L1 |
| DUR-02 | 时长低于门槛 | `durationMs: 1000` + 门槛 60000 | 抑制，`reason: below-min-duration` | L1 |
| DUR-03 | 时长恰等于门槛 | `durationMs === minTurnDurationMs` | 不抑制（严格小于才抑制） | L1 |
| DUR-04 | 门槛为 0 | 任意时长 | 不抑制 | L1 |
| DUR-05 | 整 Turn 跨度（Phase 6 冻结 fixture） | `turn/start t=1000`；step1 `t=2000`；tool result `t=5000`；step2 `t=8000`；tool result `t=12000`；step3 `t=14000`；`turn/end t=16000` | `durationMs === 15000`；**不得**为 2000 / 8000 / 14000 / `16000−14000` | L1、L5 |
| DUR-06 | mid-turn 且无 `turn/start` | `turn/end t=16000`，无起始事件 | `durationMs === null`（不得用首个事件、首条消息或插件装载时刻冒充起始） | L1、L5 |
| TOOL-01 | 仅判据 A | `content[0].isError === true`，无 `error` 字段 | `explicitToolErrorCount: 1` | L1、L3 |
| TOOL-02 | 仅判据 B | `error: {name,code}` 存在，`isError` 缺省 | 计数 1 | L1、L3 |
| TOOL-03 | 两判据同时命中 | 两者均存在 | 计数 1，**不重复计** | L1 |
| TOOL-04 | `isError: false` | 显式 `false` | 计数 0 | L1 |
| TOOL-05 | 非零退出不计入 | `content[0]` 文本含 `[exit code: 1]`，无 `isError`、无 `error` | 计数 0 | L1 |

TOOL-05 是本项目最重要的一条语义测试：它把「DSH 未报告显式工具失败」与「命令业务执行成功」的区别固定为可执行断言。

---

## 6. Usage（D006、D017）

### 6.1 原始 per-call 计数器（D006）

| 编号 | 用例 | 输入 | 期望 | 层次 |
| --- | --- | --- | --- | --- |
| USE-01 | 完整 | 6 个计数器齐备 | `collectUsage` 全部保留，不做任何换算 | L1 |
| USE-02 | 部分缺失 | 缺 `reasoningTokens` | 缺失键**不存在**（不是 `undefined`），整体可读 | L1 |
| USE-03 | `undefined` 值 | 显式 `reasoningTokens: undefined` | 该键被省略，不使对象不可序列化 | L1 |
| USE-04 | 完全缺失 | `usage` 不存在 | 无可折叠 sample，候选中无 `usage` 键，其余字段不受影响 | L1 |
| USE-05 | 数值异常不干预 | `inputTokens: 255` 且 `totalTokens: 187638` | 原样保留，**不校正、不换算、不影响 status** | L1 |
| USE-06 | 非法数值 | `NaN` / `Infinity` | 该键被省略，记录 dropped 路径 | L1 |

USE-05 对应 Phase 1 记录的 `inputTokens` 与 `totalTokens` 数量级不自洽的真实观测（该观测在 Phase 6 被解释为「per-call 的 `totalTokens` 被误读为累计量」，见 D017 的 Reason）。测试断言的是「不干预」而非某个具体解释（D006）。

### 6.2 Turn 级折叠（D017）

| 编号 | 用例 | 输入 | 期望 | 层次 |
| --- | --- | --- | --- | --- |
| USE-10 | 多 step 折叠 | call1 `100/10`、call2 `200/20`、call3 `300/30` | `input=600`、`output=60`、`usageSampleCount=3`、`usageComplete=true` | L1、L5 |
| USE-11 | 最后一次调用不代表 Turn | 同上 | 聚合值 ≠ 最后一次调用值 | L1、L5 |
| USE-12 | 可选 bucket 折叠 | 两个均报 `cacheReadTokens` 的 sample | 两值相加；未报告的 bucket 在聚合中**不存在** | L1、L5 |
| USE-13 | cacheWrite / reasoning 独立折叠 | 两个 sample 各报两桶 | 两桶分别相加，互不影响 | L1 |
| USE-14 | reasoning 不叠加到 output | `output=252, reasoning=180` | `outputTokens === 252`，**不等于** 432 | L1、L5 |
| USE-15 | `totalTokens` 不参与聚合 | sample 报 `totalTokens` | 聚合中**不存在**该键 | L1、L5 |
| USE-16 | 缺失 usage | 两个 step，其一无 usage | 观察到部分仍报出；`usageMissingCount=1`、`usageComplete=false` | L1、L5 |
| USE-17 | 缺少必须 pair | sample 只有 `inputTokens` | 不补零、不产出聚合值；计为缺失 | L1 |
| USE-18 | mid-turn 装载 | `sawTurnStart=false`，1 个 sample | `usageSampleCount=1`、`usageComplete=false` | L1、L5 |
| USE-19 | 同一 settlement 重复投递 | 同 `seq` 折叠两次 | 第二次为 `duplicate`，不 double count | L1、L5 |
| USE-20 | 重放（新 `seq`、同 step 的携带 usage message） | 同 step 两条 usage message | 第二条按重复处理 | L1 |
| USE-21 | 重试（attempt + retry + message 的真实顺序） | `assistant/attempt` → `llm/retry` → `assistant/message(usage)` | `sampleCount=1`、`missingCount=1`、`unobservableRetries=1`、`usageComplete=false` | L1、L5 |
| USE-21b | 重试（无 attempt 记录） | `llm/retry` → `assistant/message(usage)` | `unobservableRetries=1`、`usageComplete=false` | L1、L5 |
| USE-21c | 重试记录重复投递 | 同 `seq` 的 `llm/retry` 两次 | 计 1 次 | L1 |
| USE-22 | step 未结算 | `step/start` 无对应 settlement | 计为一次缺失，`usageComplete=false` | L1 |
| USE-23 | 完全无 sample | 空 Turn | `usage` 不存在、`usageComplete=false` | L1 |
| USE-24 | safe-integer 越界 | 两次求和的 input 越界 | 聚合整体撤回（不钳制、不截断），该次调用计为缺失 | L1 |
| USE-25 | 聚合值是 lossless JSON | 混合形状 sample | 可通过 lossless-JSON 校验 | L1 |
| USE-25b | 无缓存调用不抹掉他者的 bucket | 一个 `input+output`、一个含 `cacheReadTokens` | `cacheReadTokens` 保留为后者之值 | L1、L5 |

### 6.3 渲染与日志（D017）

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| TEL-11 | 正文标签 | 出现 `Token usage (turn aggregate):`，不出现 `Token counters`／`as reported`／`totalTokens` | L1、L5 |
| TEL-12 | 完整性行 | `usageComplete=true` → `Token telemetry complete: yes (N model calls observed, each reporting usage)`；`false` → `... no (...)` 并给出可数原因 | L1、L5 |
| TEL-13 | 未报告 bucket 的措辞 | 未报告的 bucket 写作 `=not reported`，**不写** `=0` | L1、L5 |
| TEL-14 | 两个完整性断言分离 | `telemetryComplete: true` 与 `usageComplete: false` 同时出现时，正文两行各自表述 | L1、L5 |
| TEL-15 | 日志字段 | `candidate.produced` 含 `usageSampleCount` / `usageMissingCount` / `usageUnobservableRetries` / `usageComplete` / `steps`；不含任何计数器值 | L1、L5 |

---

## 7. Candidate 与 Normalize（D007、D013）

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| CAND-01 | `schemaVersion` | 恒为字面量 `2`（Phase 6 由 `1` 递增，见 D013、D017） | L1 |
| CAND-02 | 必须字段齐备 | 所有必须字段存在且类型正确（含四个 usage 覆盖字段） | L1 |
| CAND-02b | 覆盖字段恒存在 | 无 sample 时 `usageSampleCount: 0`、`usageComplete: false` 仍存在，不省略 | L1 |
| CAND-03 | 可选字段缺省 | 缺失的可选键**不存在**，不是 `undefined`、不是 `null` | L1 |
| CAND-04 | lossless JSON | 完整候选可通过 lossless-JSON 校验（对象/数组/字符串/数字/布尔/null） | L1、L5 |
| NORM-01 | 嵌套对象 | `{a:{b:undefined,c:1}}` | 结果 `{a:{c:1}}`，dropped 含 `a.b` | L1 |
| NORM-02 | 数组含 undefined | `[1,undefined,2]` | `[1,2]` | L1 |
| NORM-03 | 非 plain object | `Date`、`Map`、`Set`、class 实例 | 整体省略该字段并记录，不抛异常 | L1 |
| NORM-04 | 函数 / symbol / bigint | 三种值 | 省略并记录 | L1 |
| NORM-05 | 单条坏记录不影响批量 | 一批记录中含一条 `undefined` 字段 | 全部记录可读（直接对应 Phase 1 的探针整体失效故障） | L1 |

---

## 8. Dedupe 与通知策略（D008、D011）

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| DED-01 | 重复 `turn/end` | 第二次不入队，`reason: duplicate` | L1、L2 |
| DED-02 | 不同 turn 相同 session | 两次均入队 | L1 |
| DED-03 | 有界性 | 插入 `maxDedupeEntries + N` 条 | 缓存规模不超过上限，最旧条目被淘汰 | L1 |
| DED-04 | 抑制不污染去重 | 先因 `no-visible-text` 抑制，再以同一 `(sessionId, turn)` 且含文本到达 | 第二次**入队**（抑制不留标记） | L1 |
| SUP-01 | 空文本 | `visibleText: ''` | `suppress('no-visible-text')` | L1 |
| SUP-02 | 纯空白文本 | `visibleText: '   \n\t '` | `suppress('no-visible-text')` | L1 |
| SUP-03 | 策略开关 | `notifyErrors: false` + `status: error` | `suppress('disabled-by-policy')` | L1 |
| SUP-04 | 无开关的终止方式 | `aborted` / `blocked` / `interrupted` / `unknown` | 恒为 `suppress('disabled-by-policy')`，不存在开启路径 | L1 |
| SUP-05 | `enabled: false` | 任意候选 | `suppress('disabled')`（实现上应为不注册监听器） | L2、L5 |
| SUP-06 | 判定顺序 | 同时满足多个抑制条件 | 记录的 reason 符合固定顺序（ARCHITECTURE.md §3 `notifier.ts`） | L1 |

### 8.1 终局失败通知（D018 第一至四条）

`tests/integration/failure-notification.test.ts`（11 项，`FNL-*`）以真实事件总线驱动完整插件，断言失败事实只在最终 `turn/end` 读取、并且不要求可见文本。

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| FNL-01 | 无可见输出的终局失败 | `turn/end(error)` 且 `visibleText === ''`，`notifyErrors: true` | **入队**（空文本规则对 error 不适用） | L5 |
| FNL-02 | 默认开关 | 同上，`notifyErrors: false` | 不入队；日志含 `suppressedReason: disabled-by-policy` | L5 |
| FNL-03 | 逐码分类 | 每个可重试码与一个词表外的码 | 各自按 `code` 原值分类，不映射、不归并 | L5 |
| FNL-04 | 只读结构化码 | message 文本中含 `429` / `quota` / `timeout` 字样而 `code` 为其它值 | 分类只由 `code` 决定；正文照录 message | L5 |
| FNL-05 | 未报告的字段写「未报告」 | provider 只给 `code` | `HTTP status: not reported`、`Retry-After: not reported`；**不写** `0` | L5 |
| FNL-06 | 失败前的输出 | 失败前存在可见文本 | 段落标题为 `--- Partial model output before failure ---`，不得表述为最终答案 | L5 |
| FNL-07 | 恢复的重试 | `llm/retry` 后 Turn 以 `completed` 结束，`notifyErrors: true` | **不产生失败邮件**（`llm/retry` 不是触发器） | L5 |
| FNL-08 | 多次重试后终局失败 | 若干 `llm/retry` + `turn/end(error)` | 恰好 1 封失败邮件 | L5 |
| FNL-09 | 失败前的遥测 | 失败前有可折叠 usage | 邮件携带失败前观察到的用量，不上报未观察到的部分 | L5 |
| FNL-10 | 请求身份与栈不入邮件 | fixture 中含 `requestId`、stack 与 sentinel | 三者均不出现在主题、正文、队列条目与日志中 | L5 |
| FNL-11 | aborted 不是失败 | `turn/end(aborted)`，五个开关全开 | 不发邮件（`aborted` 无开关） | L5 |

---

## 9. Queue（D009）

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| QUE-01 | FIFO 顺序 | 入队 A、B、C，sink 逐个完成 | 发送顺序为 A、B、C | L2 |
| QUE-02 | 并发为 1 | sink 记录同时在途数量 | 最大同时在途 = 1 | L2 |
| QUE-03 | 队列满 | `queueSize: 2`，快速入队 5 条 | 前 2 条（加在途 1 条）被接受，其余被拒绝；`droppedCount` 正确；有结构化 warning | L2 |
| QUE-04 | sink 抛错 | sink reject | worker 不崩溃、不产生 unhandled rejection、失败被记录 | L2 |
| QUE-05 | dispose | 队列中还有条目时 dispose | 停止接收新条目；在途 Promise 被处置；无悬挂 Promise、无未处理 rejection | L2 |
| QUE-06 | 监听器同步性 | 调用注册的 `session/event` 监听器 | 返回值为 `undefined`（非 Promise）；队列满时同样同步返回 | L2、L5 |
| QUE-07 | 慢 sink 不阻塞监听器 | sink 挂起 1 s | 监听器调用在同步路径上立即返回（用时间上界断言） | L2 |

QUE-06 与 QUE-07 共同验证架构不变量三（监听器路径无 `await`），这是「不阻塞 Agent Loop」的唯一可自动化的判据。

---

## 10. 适配器（D001）

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| ADP-01 | 完整 `assistant/message` | 全部字段正确映射 | L3 |
| ADP-02 | 缺 `turn` | 降级为 `{kind:'other'}`，不产生 `turn: 0` / `NaN` | L3 |
| ADP-03 | `source.kind !== 'model'` | `provider` / `model` 省略，不抛异常 | L3 |
| ADP-04 | 未知 `event.type` | 降级为 `{kind:'other'}`，不抛异常 | L3 |
| ADP-05 | 无 DSH 引用泄漏 | 适配器返回值中不含 `session` / `event` / `event.data` 的任何引用 | L3 |
| ADP-06 | `session/event` 为唯一入口 | 不注册 `turn/start` 等顶层监听器；注册表只含 `session/event` 与 `session/disposed` | L5 |

ADP-05 的检查方式：对返回值做递归遍历，断言不存在指向输入对象的引用（或断言返回值在输入被丢弃后仍可独立使用）。

---

## 11. SMTP 与凭据（D010）

以下用例全部使用 stub transport，不触网。

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| SEC-01 | 成功发送 | `{ok:true}`，计数器自增 | L4 |
| SEC-02 | 每次操作重新解析凭据 | 连续两次发送 → `resolve` 被调用两次；改变 stub 返回值后第二次发送使用新值 | L4 |
| SEC-03 | 凭据未配置 | `resolve` 返回 `undefined` → `permanent`，不重试；诊断含引用名与 `describe()` 结果，**不含 secret** | L4 |
| SEC-04 | secret 不入日志 | 捕获全部日志记录，断言不含 stub 密码值 | L4 |
| SEC-05 | secret 不入候选 / 队列条目 | 序列化候选与 job，断言不含密码值 | L1、L4 |
| SEC-06 | TLS 配置 | 构造的 transport 参数不含 `rejectUnauthorized: false` | L4 |
| SEC-07 | 收件人 | `to` 全部出现在 `envelope.to`；空 `to` 在配置校验阶段即失败 | L4 |
| RET-01 | `ETIMEDOUT` 重试后成功 | 尝试 2 次，最终 `{ok:true}` | L4 |
| RET-02 | `ECONNRESET` 重试 | 同上 | L4 |
| RET-03 | `EAI_AGAIN`（临时 DNS）重试 | 同上 | L4 |
| RET-04 | SMTP 4xx 瞬时响应重试 | 同上 | L4 |
| RET-05 | `EAUTH` / 535 认证失败 | **不重试**，尝试次数 = 1 | L4 |
| RET-06 | 无效收件人 `EENVELOPE` / 550 | **不重试**，尝试次数 = 1 | L4 |
| RET-07 | SMTP 5xx 策略拒绝 | **不重试** | L4 |
| RET-08 | 未知错误码 | 默认 `permanent`，尝试次数 = 1，日志标记 `unknown-error` | L4 |
| RET-09 | 重试次数上限 | 持续 `ETIMEDOUT` | 总尝试次数 = 1 + `retryAttempts` | L4 |
| RET-10 | 退避时序 | `retryBaseDelayMs: 100`，注入假 timer | 等待序列为 100 / 300 / 900 ms | L4 |
| RET-11 | dispose 中断退避 | 退避等待中 dispose | 立即收敛，无悬挂定时器 | L2、L4 |

SEC-02 是 D010 的核心可执行断言：它验证的是「不缓存」，而不仅是「能解析」。

### 11.1 凭据引用文法与 DSH 契约（Phase 8.1，D019）

`tests/integration/credential-contract.test.ts`（3 项）以**安装的** `@deepseek-ai/dsh-credentials` 为基准，而不是以插件自己的模式副本为基准——插件自己的副本正是 Phase 8 出错的那一份，用它做基准测不出这类错误。

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| CRED-01 | 文法一致性 | 对 24 个候选（含 `DSH_MAIL_SMTP_PASSWORD`、含连字符名、`<scope>/<id>` 形、含空格/点/冒号/前导数字/非 ASCII）逐一断言 `CREDENTIAL_REF_PATTERN.test(x) === isCredentialRefName(x)` | L3 |
| CRED-02 | 接受集与拒绝集 | 接受集中的每一项都能被 `credentialRef()` 原样返回；拒绝集中的每一项都令 `isCredentialRefName` 为 `false` 且 `credentialRef()` 抛 `TypeError` | L3 |
| CRED-03 | 两个键空间不相交 | 每个 `CredentialRef` 候选都无法被 `parseCredentialKey()` 解析；`credentialKey('credentials','smtp-password')` 的产物不被引用文法接受 | L3 |

`npm run probe:credentials` 在此基础上补足「真实服务能解析」这一半：它让安装的 file-backed provider 在一次性文档上 `resolve()` 与 `describe()`，并断言来源层为 `file`、值与写入文档逐字符相同、三个环境层均不供给该值。两处证据合起来才是 D019 要求的「校验器接受」与「服务解析同一引用」。

---

## 12. 隐私（D012）

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| PRIV-01 | reasoning 不外发 | 含 reasoning + text 的 Turn | 渲染后的主题 + 正文均不含 reasoning 文本 | L1 |
| PRIV-02 | tool arguments 不外发 | 含 `tool-call` 的 Turn | 正文不含 `arguments` 原文 | L1 |
| PRIV-03 | tool result 不外发 | 含 `tool-result` 的 Turn | 正文不含工具返回内容 | L1 |
| PRIV-04 | 用户 prompt 默认不外发 | `includeUserPrompt: false` | 正文不含用户消息文本 | L1 |
| PRIV-05 | 用户 prompt 开关生效 | `includeUserPrompt: true` | 仅在此时出现，且已截断清洗 | L1 |
| PRIV-06 | 默认不通知 subagent | `includeSubagents: false` | subagent 不产生候选、不创建 `TurnState` | L2、L5 |
| PRIV-07 | 元数据最小化 | `includeMetadata: false` | 正文无 cwd、无 session id，仅状态与终止方式 | L1 |
| PRIV-08 | 默认值快照 | 空配置 | `includeSubagents: false`、`includeUserPrompt: false`、`includeMetadata: true`、`notifyErrors: false` | L1 |

PRIV-01…PRIV-04 必须采用**否定断言**（断言正文不含特定字符串），而不是只断言包含期望字段。仅正向断言的测试无法发现新增字段导致的泄露。

---

## 13. 生命周期与内存（架构第 7 节）

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| LIFE-01 | Turn 结算后清理 | `turn/end` 后 | 该 `(sessionId, turn)` 条目不存在 | L2 |
| LIFE-02 | 抑制后同样清理 | 因 `no-visible-text` 抑制的 `turn/end` 后 | 条目被删除 | L2 |
| LIFE-03 | 空 Map 收缩 | 某 session 的最后一条 Turn 结算 | 内层 Map 与外层键均被删除 | L2 |
| LIFE-04 | `session/disposed` | 触发后 | 该 session 的全部状态被删除 | L2 |
| LIFE-05 | 插件 dispose | 卸载插件 | Map、去重缓存、队列、定时器、监听器全部释放 | L2、L5 |
| LIFE-06 | 不无限保存 | 模拟大量会话创建与卸载 | 外层 Map 规模回到基线 | L2 |
| LIFE-07 | subagent 不产生条目 | `includeSubagents: false` | 无状态被创建 | L2 |

---

## 14. 端到端契约测试（L5）

以假事件总线驱动完整插件，验证 Phase 1 已运行时确认的流程在打包实现中仍然成立：

| 编号 | 场景 | 期望 |
| --- | --- | --- |
| E2E-01 | 完整链：`turn/start` → 多 step → `turn/end(completed)` | 恰好 1 个 job 入队；`sawTurnStart: true`；`durationMs` 为数值 |
| E2E-02 | mid-turn 链 | 恰好 1 个 job；`durationMs: null`；计数非零 |
| E2E-03 | 顶层 + 3 个 subagent 混合 | 仅顶层产生 job |
| E2E-04 | 含真实工具错误的真实 Turn 形状 | `completed-with-tool-errors`，主题显式标记 |
| E2E-05 | 重复 `turn/end` | 仅 1 封 |
| E2E-06 | 无可见文本 | 0 封，日志含 `suppressedReason: no-visible-text` |
| E2E-07 | Agent Loop 不受影响 | 监听器全部返回 `undefined`；无未处理 rejection；假总线记录 0 次异常 |
| E2E-08 | 队列满 | 监听器仍同步返回；丢弃被计数并告警 |

E2E-07 直接对应 Phase 1 的核心结论（`listenerInvocations` 320+、`containedErrors` 0），把该结论从「原型未破坏 Agent Loop」升级为「打包实现不破坏 Agent Loop」的可回归断言。

### 14.1 Turn 遥测链（Phase 6，D017）

同一 L5 层，事件序列取真实运行时的顺序（`turn/start` → 每组 `step/start` + `assistant/message(usage)` + `tool/call` + `tool/result` + `step/end` → `turn/end`）：

| 编号 | 场景 | 期望 |
| --- | --- | --- |
| TEL-01 | 整 Turn 时长（DUR-05 的链式版本） | 候选与正文的 `Duration` 均为 15000 ms，且不等于任何单步延迟 |
| TEL-02 | 无 `turn/start` | `durationMs: null`、`sawTurnStart: false`、`telemetryComplete: false` |
| TEL-03 | 三次模型调用 | `usage === {input:600, output:60}`、`usageSampleCount: 3`、`usageComplete: true` |
| TEL-03b | 同上 | 聚合值 ≠ 最后一次调用值 |
| TEL-04 | 混合 bucket 形状 | 三个 bucket 各自等于独立折叠值；存在性规则符合 §6.2 |
| TEL-05 | reasoning 子集 | `outputTokens` 不含 reasoning；无 `totalTokens` |
| TEL-06 | 一次 settlement 无 usage | 已观察部分仍报出；`usageComplete: false`；正文写明缺失计数 |
| TEL-07 | mid-turn 装载 | `telemetryComplete: false` 与 `usageComplete: false` 同时成立且正文分行表述 |
| TEL-08 | 同一事件投递两次 | 聚合不翻倍；`usageSampleCount` 等于不同 settlement 数 |
| TEL-09 | 整条 Turn 链重放 | 仍只产生 1 个 job（去重生效），且首个候选的 sample 数正确 |
| TEL-10 | 重试（attempt + retry + message） | 聚合为成功调用的值；`usageUnobservableRetries: 1`；正文含重试原因 |
| TEL-10b | 重试（无 attempt 记录） | 同上 |
| TEL-11 | 正文标签 | 出现 `Token usage (turn aggregate):`，不出现 `as reported`／`totalTokens` |
| TEL-12 | 隐私 | reasoning 文本、tool 参数、tool 结果三枚 sentinel 均不出现在正文 |

### 14.2 真实录制数据的回放（Phase 6）

`scripts/turn-telemetry-probe.mjs` 把**真实 session log** 中的 Turn 事件链（经 Zstandard 多帧解码）重新喂给指定构建的 `createSessionHandlers`，因此「修复前／修复后」的对比建立在真实运行时数据而非 fixture 之上。它同时可以调用 DSH 自带的 `deriveTurnTokenUsage` 对同一批事件做独立折叠，用于交叉验证。

```text
node scripts/turn-telemetry-probe.mjs --log <session.v3.jsonl.zstd> --turn <n> \
     --replay <build-dir>... [--meter <dsh-install-root>] [--chain] [--mail] [--json]
```

该脚本是开发期证据工具，不进入 `files` 打包清单，也不被任何自动化测试调用。

### 14.3 失败通知的端到端探针（Phase 8）

终局失败**不能靠真实 provider 稳定复现**：要触发它必须真的耗尽额度或让请求终局失败，代价是消耗真实配额，且失败形态由 provider 决定而非由测试决定。因此该路径的运行时证据来自脚本化 provider：`scripts/probe-e2e.mjs errors` 让脚本中的一次模型调用直接返回 `{ message, code: 'QUOTA', status: 402 }`，脚本 provider 不声明重试策略，于是该失败是终局的。

| 编号 | 场景 | 期望 | 层 |
| --- | --- | --- | --- |
| PROBE-02 | `errors` 场景 | 回环 SMTP 服务器恰好收到 1 封，主题为 `[DSH] Task failed — QUOTA (402)`；该 Turn 无可见助手输出 | 探针（非自动化） |

实测结果与本节一致：1 封。该场景同时证明「无可见输出的终局失败会被寄出」这一条在真实 DSH composition 中成立，而不只是在单元与集成层成立。

### 14.4 人工注意力通知的端到端探针（Phase 8）

| 编号 | 场景 | 期望 | 层 |
| --- | --- | --- | --- |
| PROBE-01 | `questions` 场景 | 回环 SMTP 服务器恰好收到 2 封：`[DSH] Input required — Choose Mode` 与 `[DSH] Task completed — probe-scripted` | 探针（非自动化） |
| PROBE-03 | `approvals` 场景 | 回环 SMTP 服务器恰好收到 2 封：`[DSH] Approval required — probe_request_approval` 与 `[DSH] Task completed — probe-scripted`；打印的时间线中 `approval/asked` 早于审批邮件，审批邮件早于 `approval/decided` | 探针（非自动化） |
| PROBE-04 | `approvals-duplicate` 场景 | 同一 approval id 在日志中出现 2 次，投递仍为 2 封（一封审批 + 一封完成） | 探针（非自动化） |
| PROBE-05 | `approvals-rejected` 场景 | 审批邮件恰好 1 封；`approval/decided` outcome 为 `rejected`；工具结果为 error；`decided` 时不补发第二封审批邮件。Turn 自身的结局按实测记录 | 探针（非自动化） |
| PROBE-06 | `credentials` 场景 | 针对**安装的** file-backed provider 的 14 项契约检查全部 PASS | 探针（非自动化） |

PROBE-01 的 2 封已实测得到，两封而非一封正是「question 的去重命名空间没有消耗 Turn 的键」的运行时证据。

**PROBE-03 在 Phase 8 未达成，在 Phase 8.1 补齐。** Phase 8 执行时审批请求始终没有打开，原因是环境约束而非实现缺陷：该 composition 的 approval policy 由 `DSH_PERMISSION_MODE` 推导，本机 preset 为 `danger-full-access`，其 policy 为 `never`，在 waterfall 之前就确定性拒绝，因此不产生 `approval/asked`。Phase 8.1 的探针叠加层显式钉住 `approval.policy: ask`，并以一次真实工具执行内的 `ctx.approval.request()` 触发审批；人工替身在探针通过 SMTP 观察到审批邮件之前**不返回决定**，因此「通知发生在审批仍 pending 时」是被测量的事实而不是对时序的假设。实测结果见 `PHASE8_1_REPORT.md` 第 2–5 节。

探针的实际运行环境为 Node `v24.13.0` 与 DSH `0.1.5-rc.1`（`dsh --version`）。它以 `--profile headless --patch <overlay>` 启动，overlay 中携带脚本化 provider、`ask_user_question` 工具、`probe_request_approval` 工具、人工替身、凭据契约检查与指向回环 SMTP 的插件本体；`DSH_HOME` 指向 `tmp/probe/home`（每次运行前整体重建），operator 自己的 DSH 安装根通过 `DSH_INSTALL_ROOT` 提供，二者互不写入。
探针替换的恰好三项（脚本化模型 provider、人工替身、SMTP 服务器的身份）在输出中被具名；凭据服务**不**被替换——出厂 file-backed store 被指向一次性目录，其真实解析路径参与运行。真实的 agent loop、工具注册表、session log、`ctx.approval`、插件的监听器、队列与 mailer、以及一次真实 SMTP 会话全部参与。各场景只打开自己要验证的开关，因此一封邮件只可能来自被测族。

### 14.5 question 与 approval 通知链（Phase 8，D018 第五至十一条）

`tests/integration/attention-notification.test.ts`（19 项，`QUE-*` / `APR-*`）以真实事件总线驱动完整插件，事件序列取运行时顺序。question 走持久化 `tool/call`，approval 走持久化 `approval/asked`。

| 编号 | 场景 | 期望 |
| --- | --- | --- |
| QUE-01 | 一次提问 | 1 封邮件；正文含问题文本、选项 label 与 description，以及「打开 DSH 作答、本消息不能回复作答」的说明 |
| QUE-02 | 一次调用含多个问题 | 1 封邮件携带全部被携带的问题 |
| QUE-03 | 同一 Turn 内两次调用 | 各 1 封（不同 `callId` 各自可通知） |
| QUE-04 | 同一 call 重复投递 | 仅 1 封（`duplicate`） |
| QUE-05 | 入队时机 | 在 `tool/call` 事件上**同步**产生 job，不等待 `tool/result`、`turn/end` 或人工回答 |
| QUE-06 | 开关关闭 | `notifyQuestions: false` 时不发，日志为 `disabled-by-policy` 并指明该开关 |
| QUE-07 | 其它工具的参数 | `bash` / `pwsh` / `fs` / `subagent` 的参数不出现在任何 job、邮件或日志中 |
| QUE-08 | 畸形 arguments | 不发邮件；`question.unparsable` 记录原因与计数，**参数原文不出现** |
| QUE-09 | 白名单外的字段 | 模型额外塞入的字段被丢弃，永不渲染 |
| QUE-10 | 超长问题 | 被界限截断，邮件仍然产出 |
| QUE-11 | subagent 提问 | `includeSubagents: false` 时静默；开启后才通知 |
| QUE-12 / APR-08 | 时长门槛 | `minTurnDurationMs` 极大时 question 与 approval **仍**通知 |
| APR-01 | 一次审批请求 | 1 封邮件，主题为 `[DSH] Approval required — <tool>`，正文含工具名与 reason |
| APR-02 | 开关关闭 | 不发，日志为 `disabled-by-policy` 并指明 `notifyApprovals` |
| APR-03 | 同一审批重复投递 | 仅 1 封 |
| APR-04 | `approval/decided` | **不产生**第二封「需要你处理」的邮件 |
| APR-05 | 无 `callId`、无 `reason` | 仍可通知（两者都是可选字段） |
| APR-06 | 敌意载荷 | 载荷中额外添加的 arguments 字段不出现在邮件、job 或日志中 |
| APR-07 | subagent 审批 | `includeSubagents: false` 时静默；开启后才通知 |

### 14.6 question 解析器的白名单与界限（Phase 8，D018 第七、八条）

`tests/unit/human-attention.test.ts`（25 项，`HAT-*`）与 `tests/unit/attention-policy.test.ts`（8 项，`HAT-POL-*`）覆盖解析器本身与两条策略判定。

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| HAT-01 | 提问里带凭据 | 只产出两个白名单字段；凭据串不出现在结果中 | L1 |
| HAT-02 | 选项重建 | 选项只由 label 与 description 重建，源对象不被 spread | L1 |
| HAT-03 | 合法字段与两种拼写 | `header`、选项字段与 `multi_select` 保留；服务侧拼写 `multiSelect` 同样被接受 | L1 |
| HAT-04 | 非布尔 `multi_select` | 丢弃而不做真值转换 | L1 |
| HAT-05 / 05b | 数量界限 | 超过 `MAX_QUESTIONS` / `MAX_OPTIONS_PER_QUESTION` 的部分被计数或截断，不读取 | L1 |
| HAT-05c / 05d | 长度与总量界限 | 单字段截断至码点上限；总量只携带放得下的部分并计数其余 | L1 |
| HAT-06 | 星光面字符 | 按码点计界，不切断代理对 | L1 |
| HAT-07 / 07b | 畸形与非法输入 | 降级为「无可通知内容」，**不抛异常**；非字符串/非对象与空问题数组各自给出 reason | L1 |
| HAT-08 | 结构化 arguments | 兼容分支同样逐字段复制 | L1 |
| HAT-09 | 缺 id 或缺正文 | 按路径丢弃该问题并记录路径 | L1 |
| HAT-10 / 10b | 控制字符 | C0/C1 整段被压成空格，行结构被抹平；选项 label 走同一规则 | L1 |
| HAT-11 / 11b / 11c / 11d / 11e | 界限的可达性与前缀性 | 纯数量溢出上报 question-limit；被尺寸拒绝的问题同样消耗额度，携带集合是前缀；当前界限下 `content-limit` 不可达且被明确断言不为该值；全部不可用时不报任何界限；11e 用耗尽额度的夹具让尺寸界限真实触发，证明拒绝必然留下部分携带，从而给出 11c 的成因 | L1 |
| HAT-12 / 12b…12f | approval 载荷 | 只由白名单字段重建；无工具名即不构成通知；超长 reason 截断且抹平行结构；cwd 已知才携带；两个可选字段互相独立；超长 `callId` 按 id 上限截断 | L1 |
| HAT-POL-01 / 02 | 默认值 | 两个开关默认 `false`，抑制原因各自指明自己的开关 | L1 |
| HAT-POL-03 | 开关独立性 | 双向验证：开一个不会影响另一个 | L1 |
| HAT-POL-04 | 主开关优先 | `enabled: false` 时以 `disabled` 抑制，先于任何通知开关 | L1 |
| HAT-POL-05 | 时长门槛不适用 | 极大 `minTurnDurationMs` 下 question 仍通知 | L1 |
| HAT-POL-06 | 去重顺序 | 重复判定在开关判定之后，且仅在其后 | L1 |
| HAT-POL-07 | 默认配置快照 | 空配置下两个注意力开关均为 `false` | L1 |
| HAT-POL-08 | 全关警告 | 「五个开关全关」的警告文本逐项列出两个注意力开关 | L1 |

---

## 15. 打包产物测试（L6）

| 编号 | 检查 | 期望 |
| --- | --- | --- |
| PKG-01 | tarball 内容 | 含编译后 runtime、`cordis.patch.yml`、`package.json`、README、LICENSE |
| PKG-02 | tarball 排除 | 不含 `.env` 及变体、`*.pem`、`*.key`、测试 secret、开发缓存 |
| PKG-03 | 安装 | 在独立 DSH 安装中以 `.tgz` 安装成功，无需手工编辑核心配置 |
| PKG-04 | 启动 | 配置合法时插件加载且注册监听器；配置非法时加载失败并给出字段级错误 |
| PKG-05 | `enabled: false` | 不注册监听器（可通过日志或探针确认） |
| PKG-06 | 卸载 | 卸载后无残留监听器、无残留状态；DSH 正常运行 |
| PKG-07 | 产物新鲜度（Phase 6） | tarball 内的 `lib/**` 与当前 `npm run build` 输出逐文件一致，且 `package.json` 版本与候选版本一致 |
| PKG-08 | 双版本安装（Phase 6） | 同一份 tarball 在 `0.1.5-rc.1` 与 `0.1.5-rc.2` 下均安装、装载、投递成功 |
| PKG-09 | 新模块进入产物（Phase 8） | tarball 内的编译产物含 `human-attention` 对应的 `lib` 文件；`scripts/probe-e2e.mjs` 与 `scripts/probe/` **不在**归档内 |

---

## 16. 手工 smoke test

`scripts/smtp-smoke-test.ts` 是唯一允许发送真实邮件的路径，必须满足：

1. 仅在显式运行时执行，不被任何自动化脚本调用。
2. 运行前通过 `credentials.describe(ref)` 校验凭据已配置；未配置时给出明确提示并退出。
3. 不向 stdout 打印任何 secret。
4. 发送一封内容固定、明显为测试用途的邮件。
5. 使用与正式实现相同的 `mailer.ts` 代码路径（避免 smoke test 验证的是另一套逻辑）。

---

## 17. 不属于自动化测试矩阵的项

| 项 | 处理方式 |
| --- | --- |
| 真实 SMTP 服务器的端到端投递 | 手工 smoke test |
| 五种非 `completed` 的 `turn/end` 在真实 DSH 会话中的触发 | 运行时观察（Phase 1 已确认接口；真实触发依赖模型与 provider 行为，不可自动化）。`error` 由 `§14.3` 的脚本化 provider 场景实际触发；续期与审批路径中的真实 provider 故障仍属本行 |
| `session/disposed` 在真实 DSH 中的触发 | 运行时观察（Phase 1 已记录：进程存活期内会话通常不卸载） |
| 跨进程去重语义 | 明确不保证（D008），因此不测试 |
| DSH 升级后的字段路径变化 | L3 适配器测试的手工样本需随 DSH 版本更新；这是设计上预期的维护点 |
| 失败模型调用的 usage | 现有事件面（`llm/retry`、`assistant/attempt`）均不携带，因此不可自动化取回；以 `usageComplete: false` 如实表达，并以 `llm/retry` 的计数作为「该 Turn 存在不可观察调用」的证据 |
| provider 侧的 bucket 完备性 | 各 provider 对可选 bucket 的报告策略不同，插件按「报告过的 sample 求和」处理（D017 第 4 条）；这是披露策略而非可测试的运行时事实 |
| 用真实 provider 触发终局失败 | 需要真的耗尽额度或让请求终局失败，代价是消耗真实配额，且失败形态由 provider 而非由测试决定；因此该路径的运行时证据来自 `§14.3` 的脚本化 provider，而不是真实账号 |
| approval 路径在真实 composition 中的触发 | 已由 `§14.4` 的 `approvals` / `approvals-duplicate` / `approvals-rejected` 三个场景覆盖（Phase 8.1 补齐；需一个 approval policy 为 `ask` 的 composition，探针叠加层显式钉住该值） |
