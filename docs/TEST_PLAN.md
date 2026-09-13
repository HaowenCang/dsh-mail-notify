# TEST_PLAN — dsh-mail-notify

本文件定义 Phase 3 的测试矩阵、测试层次与断言要求。矩阵中的每条用例都对应 [`DECISIONS.md`](DECISIONS.md) 中某项可验证的冻结断言；未在矩阵中出现的决策不视为已冻结。

**当前仓库不存在任何测试代码。** 本文件是 Phase 3 的验收清单。

---

## 1. 测试层次与工具

| 层次 | 对象 | 工具策略 | 是否触网 |
| --- | --- | --- | --- |
| L1 纯函数单测 | `content.ts`、`completion.ts`、`normalize.ts`、`subject.ts`、`retry.ts`、`turn-state.ts`、`notifier.ts` | 无 mock、无 I/O、时间由参数注入 | 不触网 |
| L2 队列与生命周期单测 | `queue.ts`、`event-handler.ts` | 注入假 sink、假 timer、假记录器 | 不触网 |
| L3 适配器测试 | `runtime-adapter.ts` | 手工构造的 `SessionEvent` 形状对象（含畸形样本） | 不触网 |
| L4 SMTP 集成测试 | `mailer.ts` + `retry.ts` + `queue.ts` | Nodemailer `streamTransport` / `jsonTransport` 或自定义 stub transport；错误由 stub 抛出 | **不触网** |
| L5 端到端契约测试 | 完整插件 | 假事件总线（直接调用注册的监听器）+ stub transport | **不触网** |
| L6 运行时安装测试 | 打包后的 `.tgz` | 独立 DSH 安装 + 显式 `enabled: false` 或指向本地 sink | 仅本地 |

测试运行器采用 DSH 生态中通用的 Vitest；该选择在 Phase 3 P3.1 中确定，不影响本矩阵的内容。

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
| D006 usage 原始遥测 | L1 | USE-01…USE-04 |
| D007 候选 schema v1 | L1、L5 | CAND-01…CAND-04 |
| D008 去重 | L1、L2 | DED-01…DED-04 |
| D009 有界队列 | L2 | QUE-01…QUE-06 |
| D010 凭据每次解析 | L4 | SEC-01…SEC-04 |
| D011 无可见文本抑制 | L1、L2 | SUP-01…SUP-04 |
| D012 隐私默认 | L1、L5、L6 | PRIV-01…PRIV-08 |
| D013 schemaVersion | L1 | CAND-01 |
| D014 截断 | L1 | TRUNC-01…TRUNC-05 |
| D015 时长门槛 | L1 | DUR-01…DUR-04 |

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
| TOOL-01 | 仅判据 A | `content[0].isError === true`，无 `error` 字段 | `explicitToolErrorCount: 1` | L1、L3 |
| TOOL-02 | 仅判据 B | `error: {name,code}` 存在，`isError` 缺省 | 计数 1 | L1、L3 |
| TOOL-03 | 两判据同时命中 | 两者均存在 | 计数 1，**不重复计** | L1 |
| TOOL-04 | `isError: false` | 显式 `false` | 计数 0 | L1 |
| TOOL-05 | 非零退出不计入 | `content[0]` 文本含 `[exit code: 1]`，无 `isError`、无 `error` | 计数 0 | L1 |

TOOL-05 是本项目最重要的一条语义测试：它把「DSH 未报告显式工具失败」与「命令业务执行成功」的区别固定为可执行断言。

---

## 6. Usage（D006）

| 编号 | 用例 | 输入 | 期望 | 层次 |
| --- | --- | --- | --- | --- |
| USE-01 | 完整 | 6 个计数器齐备 | 全部保留，候选可序列化 | L1 |
| USE-02 | 部分缺失 | 缺 `reasoningTokens` | 缺失键**不存在**（不是 `undefined`），整体可读 | L1 |
| USE-03 | `undefined` 值 | 显式 `reasoningTokens: undefined` | 该键被省略，不使对象不可序列化 | L1 |
| USE-04 | 完全缺失 | `usage` 不存在 | 候选中无 `usage` 键，其余字段不受影响 | L1 |
| USE-05 | 数值异常不干预 | `inputTokens: 255` 且 `totalTokens: 187638` | 原样保留，**不校正、不换算、不影响 status** | L1 |
| USE-06 | 非法数值 | `NaN` / `Infinity` | 该键被省略，记录 dropped 路径 | L1 |

USE-05 对应 Phase 1 记录的 `inputTokens` 与 `totalTokens` 数量级不自洽的真实观测；测试断言的是「不干预」而非某个具体解释（D006）。

---

## 7. Candidate 与 Normalize（D007、D013）

| 编号 | 用例 | 期望 | 层次 |
| --- | --- | --- | --- |
| CAND-01 | `schemaVersion` | 恒为字面量 `1` | L1 |
| CAND-02 | 必须字段齐备 | 所有必须字段存在且类型正确 | L1 |
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
| 五种非 `completed` 的 `turn/end` 在真实 DSH 会话中的触发 | 运行时观察（Phase 1 已确认接口；真实触发依赖模型与 provider 行为，不可自动化） |
| `session/disposed` 在真实 DSH 中的触发 | 运行时观察（Phase 1 已记录：进程存活期内会话通常不卸载） |
| 跨进程去重语义 | 明确不保证（D008），因此不测试 |
| DSH 升级后的字段路径变化 | L3 适配器测试的手工样本需随 DSH 版本更新；这是设计上预期的维护点 |
