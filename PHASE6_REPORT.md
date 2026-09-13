# PHASE6_REPORT — Turn-level Token / Duration Telemetry Correctness Hotfix

- 项目：`dsh-mail-notify` v0.1.1（release candidate）
- 仓库：`https://github.com/HaowenCang/dsh-mail-notify`
- 基线：`eebe8a9c4fee2f807727a7d092ad61f38a894ebf`（Phase 5 之后的文档终态，等于 `origin/main`）
- 执行范围：查明真实运行时语义、修复 Turn 级遥测、全量回归、产出 v0.1.1 RC；**不发布**

---

## 1. Status

```text
PASS — v0.1.1 RC READY
```

`usage` 的根因已被真实运行时证据确认并修复（`BUG-TEL-001`），Turn 级按 bucket 折叠与 DSH 自带的独立实现逐 Turn 一致；Duration 在同一批真实 Turn 上被独立复核，**未复现缺陷**，因此未改动算法。schema 已按 D013 递增为 `2`。全部回归、双版本兼容、真实 Turn 与真实 163 SMTP E2E 均通过。本阶段**未发布**：`npm publish`、`git tag v0.1.1`、GitHub Release 均未执行，`v0.1.0` tag 未被移动或修改。

---

## 2. Baseline

执行开始时（`git rev-parse`、`git status --porcelain`、`git rev-parse v0.1.0`）：

```text
branch            main
HEAD              eebe8a9c4fee2f807727a7d092ad61f38a894ebf
origin/main       eebe8a9c4fee2f807727a7d092ad61f38a894ebf   （同步）
working tree      clean
v0.1.0 tag        0d113e70406330c373eb0a1fef6cc8e78a837c30
```

对照环境：

```text
DSH（rc.1）       0.1.5-rc.1   C:\Users\20659\node_modules\@deepseek-ai\dsh
DSH（rc.2）       0.1.5-rc.2   E:\Projects\DSHarness\.tmp-rc2-mailnotify（本阶段新建的隔离安装，520 packages）
cordis            4.0.2（两侧相同）
schemastery       3.18.2（两侧相同）
Node              v24.13.0
用户观测来源      $DSH_HOME/profiles/web 中的 dsh-mail-notify@0.1.0（已安装、enabled: true、真实 163 SMTP）
```

**装配一致性核查。** 用户观测到的邮件来自运行中的 `web` profile。该 profile 中已安装的 `lib/**` 与仓库 `lib/**`（v0.1.0 构建）**逐文件 SHA-256 相同**（`event-handler.js`、`turn-state.js`、`subject.js`、`index.js` 四项一致），因此第 5 节排除了「已安装 bundle 与仓库不一致」这一候选根因。

---

## 3. Observed defect

```text
BUG-TEL-001  v0.1.0 的候选 usage 只承载最后一个携带 usage 的 assistant/message，
             而不是整个 Turn 的用量。
```

v0.1.0 的 `src/event-handler.ts` 在每个 `assistant/message` 上执行 `state.usage = event.usage`，因此 step 1…N 的 usage 被逐次覆盖，最终只剩最后一次模型调用的原始计数器。该行为在真实 Turn 上的后果见第 4 节：一个 63 步的真实 Turn 中，v0.1.0 报告的数字是 Turn 合计的 **0.3%** 量级。

用户侧的表述（「Token usage 和 Duration 看起来像最终输出消息的数据」）对 Token 部分成立、对 Duration 部分不成立，两者在本报告第 4、5 节分别取证，不合并为一个根因。

---

## 4. Runtime evidence

### 4.1 事件面取证（858 份 session log）

对 `$DSH_HOME/sessions` 下全部 858 份 durable session log（含历史格式）做 Zstandard 多帧解码后统计，共 503 208 个事件、1 432 个已结束 Turn：

| 事实 | 观测值 |
| --- | --- |
| `assistant/message` | 30 227 条，其中携带 `usage` 30 224 条（缺 usage 3 条） |
| `assistant/message` 的 stream 内携带 usage | 0 条（usage 一律在 `data.usage`） |
| `assistant/attempt` | 83 条，其中 stream 携带 usage **0** 条 |
| `llm/retry` / `llm/retry-started` | 376 / 376 条，覆盖 261 个不同 step |
| `step/start` / `step/end` | 30 335 / 30 318 条 |
| 同一 `(turn, step)` 内出现两条 `assistant/message` | **0 次** |
| 单 step 内 `assistant/attempt` 最大值 / `llm/retry` 最大值 | 4 / 5 |
| 单 Turn step 数最大值 | 2 611 |
| `seq` 缺失（`assistant/message`、`assistant/attempt`、`llm/retry`、`step/*`、`tool/*`、`turn/*`） | 0 条；会话内严格递增 |
| usage 计数器键形状 | `input+output`、`+cacheRead`、`+reasoning`、`+totalTokens` 的六种组合；**`cacheWriteTokens` 一次都未出现** |
| `totalTokens == input + cacheRead + cacheWrite + output`（逐 sample 校验） | 30 205 / 30 205 成立，3 283 条未报告该字段 |
| `reasoningTokens > outputTokens` | 0 次 |

**真实 retry 顺序**（两类都在日志中出现）：

```text
A: step/start → assistant/attempt(无 usage) → llm/retry → llm/retry-started → assistant/message(usage)
B: step/start → (仅流式 chunk)            → llm/retry → llm/retry-started → assistant/message(usage)
C: step/start → assistant/attempt(空 stream) → step/end          （失败终止，无 message）
```

失败调用的 usage 在 A、B、C 三类中**都不可观察**：`llm/retry` 的 payload 只有 failure 与 policy，`assistant/attempt` 的 usage 只可能来自其 stream，而实测 83 条 attempt 全部没有。

### 4.2 修复前 / 修复后（同一真实 Turn）

对真实 Turn `session-ff9d3f58…` turn 1（63 step、65 次模型调用、2 次 retry）用 `scripts/turn-telemetry-probe.mjs` 把**录制的原始事件链**分别重放进 v0.1.0 构建（从已发布的 `dsh-mail-notify-0.1.0.tgz` 解出）与修复后构建：

| 项 | 值 |
| --- | --- |
| v0.1.0 `candidate.usage` | `{inputTokens:299, outputTokens:1190, totalTokens:201041, cacheReadTokens:199552}`（= 最后一次调用） |
| 独立折叠的期望值 | `{inputTokens:99960, outputTokens:84145, cacheReadTokens:9103616}` |
| v0.1.1 `candidate.usage` | `{inputTokens:99960, outputTokens:84145, cacheReadTokens:9103616}`（sampleCount 65） |
| v0.1.0 / v0.1.1 `durationMs` | 602355 / 602355（两者相同） |
| `turn/end − turn/start` | 602355 |

### 4.3 与 DSH 自带实现的交叉验证

`@deepseek-ai/dsh-token-meter` 的 `deriveTurnTokenUsage(events)` 是与本插件无关的独立实现。对全部 1 432 个已结束 Turn 同时运行两者：

```text
official meter 返回数值的 Turn            967
其中 inputTokens  与本插件聚合完全一致     967 / 967
其中 outputTokens 与本插件聚合完全一致     967 / 967
official meter 返回 undefined 的 Turn     464
official meter 抛异常的 Turn（旧格式缺 stream）  1
```

464 个 `undefined` 中，与本插件 `usageComplete: true` 重叠的 295 个已逐项归因：全部满足 step 生命周期完整、无 attempt、无 retry，仅因官方实现更严格的 bucket 完备规则而放弃披露（它要求每个 attempt 都报告 `totalTokens`，或同时报告两个 cache bucket——而 `cacheWriteTokens` 在 503 208 个事件中出现 0 次）。两者的差异只存在于「可选 bucket 是否要求全员报告」这一披露策略，数值本身一致（第 6 节 D017 第 4 条）。

---

## 5. Root cause

### Token usage

**已确认。** DSH 的 `TokenUsage` 是 **per-call** accounting：每个 `assistant/message` 携带的是产生该消息的那一次模型调用的计数器。一个 Turn 是多次模型调用的序列（实测最多 2 611 次），因此 Turn 的用量只能是逐次折叠的结果。v0.1.0 把「最后一次观测」当作「Turn 合计」，是**字段语义与用户理解不一致**的实现缺陷，不是数据缺失，也不是 provider 行为变化。

D006 的三条原则（不计算价格、不校正 provider 数据、不参与 completion）并未被违反；被违反的是隐含的「`usage` 表示整个 Turn」这一读者预期。修复因此不是推翻 D006，而是补一条折叠语义：D017。

### Duration

```text
Duration bug NOT reproduced.
```

`durationMs = event.time(turn/end) − event.time(turn/start)` 在实现中**本来就是 Turn 边界差**，与最后一次 assistant message 的延迟无关。取证方式与结论：

| 检查 | 结果 |
| --- | --- |
| v0.1.0 与 v0.1.1 在同一真实 Turn 上的 `durationMs` | 602355 / 602355（相同） |
| 该值是否等于 `turn/end − turn/start` | 成立 |
| 该值是否等于最后一次 assistant message 与前一事件之差 | 不成立（最后一次调用仅耗时 3 ms，Turn 为 602 秒） |
| §18 冻结 fixture（`t=1000` 起、`t=16000` 止，三次模型调用与两次工具结果夹在中间） | `durationMs = 15000`，且不等于 2000 / 8000 / 14000 / `16000−14000` |
| mid-turn（无 `turn/start`） | `durationMs = null`，未用首事件、首消息或插件装载时刻冒充起点 |
| 逐 Turn 复核（1 432 个已结束 Turn） | 无一处出现 `durationMs ≠ turn/end − turn/start` |

第 5 节的六个候选根因逐项排除：`wrong state`（状态在 `turn/start` 就地补写，实测 `sawTurnStart` 与 `startAt` 一致）、`wrong turn association`（事件按 `data.turn` 归档，实测无跨 Turn 串号）、`timestamp conversion`（两端同为 `event.time` 的 epoch ms，直接相减）、`hot reload`（本阶段未依赖热重载，所有运行均为冷启动）、`candidate source`（候选只由 `TurnState` 构造）、`installed bundle mismatch`（第 2 节已逐文件哈希比对，一致）。

因此按任务书 §8 的要求：**不为「看起来不对」修改算法**，Duration 的实现与语义保持原状，仅把「Turn 边界差」的断言补进测试矩阵（DUR-05、DUR-06、TEL-01、TEL-02）。

---

## 6. D017

新增决策记录 [`docs/DECISIONS.md`](docs/DECISIONS.md) D017「Turn 级遥测聚合语义」，冻结九条：聚合单位是模型调用而非 Turn 结束状态；只折叠不推导；bucket 语义固定且禁止把 `reasoningTokens` 计入 `outputTokens`、禁止出现任何 total 行；缺失即缺失（不补零、不插值，未报告的 bucket 在聚合中省略）；`totalTokens` 不参与聚合且不在 schema v2 中出现；覆盖范围必须显式（四个字段）；重复与重放不得重复计数（`seq` 为主、每 step 至多一条 message 为辅）；`usageComplete` 与 `telemetryComplete` 保持独立；Duration 语义不变。

D006 未被删除、未被改写。D017 的 Reason 同时解释了一件历史事实：D006 记录的「`inputTokens: 255` 与 `totalTokens: 187638` 不自洽」实际是**单次调用**的原始记录（255 + 186624 + 759 = 187638，逐字节自洽），Phase 1 之所以读成不自洽，是因为把 per-call 的 `totalTokens` 当成了累计量。D006 的结论（不换算、不校正）因此继续成立，`USE-05` 一类断言并未改变。

---

## 7. Schema v2 migration

```text
NotificationCandidate.schemaVersion   1 → 2
```

按 D013「改变字段语义必须递增版本号」执行，D013 处补一条 Phase 6 注解指向 D017（不改写其判决）。

| 字段 | v1 | v2 |
| --- | --- | --- |
| `usage` | 最后一次观测到的 per-call 原始计数器（可含 `totalTokens`） | Turn 级聚合：`inputTokens`、`outputTokens` 必在，`cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens` 仅在至少一个 sample 报告过时出现 |
| `usageSampleCount` | — | 新增必须字段：已折叠的、相互区分的模型调用 usage 报告数 |
| `usageMissingCount` | — | 新增必须字段：已观察但无可用 usage 的应计调用数（含未结算 step） |
| `usageUnobservableRetries` | — | 新增必须字段：失败且 usage 不可观察的重试调用数 |
| `usageComplete` | — | 新增必须字段：仅当每个应计调用都报告 usage 时为 `true` |

四个覆盖字段是**必须**字段且恒存在：`0` 与 `false` 是有效观测（中途装载即 `usageSampleCount: 0`、`usageComplete: false`），省略它们会使「未统计」与「统计为零」不可区分。

消费端已同步：`src/types.ts`、`src/turn-state.ts`、`src/subject.ts`、`src/debug-sink.ts`、`src/event-handler.ts`、`scripts/smtp-smoke-test.ts`、`tests/**`、`docs/ARCHITECTURE.md` 的 DTO 表。不兼容风险与判别方式已写入 [`docs/RELEASE.md`](docs/RELEASE.md) 第 9 节：同一 Turn 的 v1 与 v2 记录通常携带**不同**的 `usage`，且必然携带不同的 `schemaVersion`；忽略版本号的读取方会把 v2 的聚合值当成 v1 的单次样本。

---

## 8. Usage aggregation implementation

新增 `src/telemetry.ts`（纯模块，不知道任何 DSH payload 形状），`TurnState.usage` 由 `RawUsage | undefined` 改为 `TurnUsageLedger`。

适配器（`src/runtime-adapter.ts`）新增识别三类遥测事件，并为 settlement 透传 `seq`：

| 事件 | 内部形态 | 是否累积 |
| --- | --- | --- |
| `step/start` | `{ kind: 'step-start', turn, step, timeMs }` | 是——宣告一次应计模型调用 |
| `assistant/attempt` | `{ kind: 'assistant-attempt', turn, step, seq?, usage?, timeMs }` | 是——一次结算；无 usage 即计为缺口 |
| `llm/retry` | `{ kind: 'llm-retry', turn, step, seq?, timeMs }` | 是——一次 usage 不可观察的失败调用 |
| `llm/retry-started` | 不翻译（`other`） | 否——被替代的失败调用已在 `llm/retry` 计入 |

折叠规则：同 bucket 相加，safe-integer 越界即撤回整份聚合并把该次调用计为缺失；可选 bucket 按「报告过的 sample 求和」，全部未报告则省略；重复计数由两层身份控制（`seq` 或 `message.id` 为主，`assistant/message` 每 step 至多一条的实测边界为辅，且辅判据只作用于携带可折叠 sample 的 message）；单 Turn 记账规模有上界（`MAX_ACCOUNTED_STEPS` / `MAX_ACCOUNTED_SETTLEMENTS` = 65 536），越界即令 `complete = false`，不静默截断。

正文渲染（`src/subject.ts`）：

```text
Token usage (turn aggregate): inputTokens=…, outputTokens=…, cacheReadTokens=…, cacheWriteTokens=not reported, reasoningTokens=not reported
Token telemetry complete: yes (4 model calls observed, each reporting usage)
```

标签由 `Token counters (as reported)` 改为 `Token usage (turn aggregate)`；未报告的 bucket 写作 `not reported` 而非 `0`；完整性单独成行，与 `Telemetry complete:`（插件是否从 `turn/start` 开始观察）分开。**不出现任何 total 行，也不计算费用。**

`candidate.produced` 新增五个安全标量字段（`usageSampleCount`、`usageMissingCount`、`usageUnobservableRetries`、`usageComplete`、`steps`）；计数器本身仍只进入邮件正文，不进入日志。

---

## 9. Duration investigation

见第 5 节。要点复述如下，因为它是与 Token 完全独立的结论：

```text
Concern investigated; implementation was already turn-boundary based.
No duration algorithm defect found.
```

未修改任何与 Duration 有关的代码路径（`state.startAt` 的写入、`input.endTimeMs − state.startAt` 的求值、`null` 语义三者均与 v0.1.0 相同）。新增的只是断言。

---

## 10. Tests

```text
npm run check:text   PASS（66 files，strict UTF-8、BOM-free、无已知 mojibake）
npm run typecheck    exit 0
npm test             327 pass / 0 fail / 0 skipped / 0 cancelled / 0 todo
npm run build        exit 0
```

相对 Phase 4.1 基线的 276 项，本阶段**净增 51 项**（既有测试无删除，语义变更的断言被就地改写并加注理由）。新增覆盖：

| 组 | 用例 | 层次 |
| --- | --- | --- |
| Duration | DUR-05（§18 的冻结 fixture，期望 15000，且不等于 2000/8000/14000/2000）、DUR-06（无 `turn/start` → `null`） | L1 |
| 折叠 | USE-10…USE-25b：多 step 折叠、最后一次不代表 Turn、可选 bucket、cacheWrite/reasoning 独立折叠、reasoning 不叠加、`totalTokens` 不参与、缺失 usage、缺必须 pair、mid-turn、重复投递、重放、retry 两类真实顺序、retry 重复、未结算 step、空 Turn、safe-integer 越界、lossless JSON、无缓存调用不抹掉他人 bucket | L1 |
| 渲染与日志 | TEL-11…TEL-15（正文标签、完整性行、`not reported` 措辞、两个完整性断言分离、日志字段） | L1、L5 |
| 链式 | TEL-01…TEL-12：整 Turn 时长、mid-turn、三调用聚合、混合 bucket、reasoning、缺失 usage、mid-turn 双标志、重复事件、整链重放、retry 两类、标签、隐私 | L5 |
| 适配器 | `step/start`、`assistant/attempt`、`llm/retry`、`llm/retry-started` 的翻译与降级；stream 内 usage 的兼容路径与优先级；`seq` 的透传与缺失不补 | L3 |
| 测试装置 | 抽取 `tests/support/plugin-harness.ts`，使两个 L5 套件共用同一套真实注册／释放路径 | — |

除单元与集成测试外，本阶段新增 `scripts/turn-telemetry-probe.mjs`：它解码真实 session log 的 Zstandard 多帧容器、独立折叠一个 Turn、把该 Turn 的原始事件链重放进指定构建、并可调用 DSH 自带的 `deriveTurnTokenUsage` 做第三方交叉验证。它是开发期证据工具，不进入 `files` 白名单，也不被任何自动化测试调用。

---

## 11. Runtime E2E

在隔离的 `DSH_HOME`（`E:\Projects\DSHarness\.tmp-phase6\home`）与隔离 profile（`probe6`，由随包 `headless` 模板生成）中，把 `dsh-mail-notify-0.1.1.tgz` 按文档命令安装，用同一段受控任务制造**一个**多 step Turn：

```text
task: 让模型用 pwsh 依次执行三条命令（node -v / node -e "console.log(6*7)" / Write-Output …），
      每条一次调用并等待结果，最后只回三行输出。
```

最近一次受控运行（`session-a794420a-707c-486e-a477-93e71d2708bd`，turn 1）：

```text
turn/start              t=1789310644684
step/start  step=1      t=1789310644739
assistant/message step=1 t=1789310645933  seq=16  usage={input:252, output:78,  total:8010, cacheRead:7680, reasoning:19}
tool/call   step=1      t=1789310645935
tool/result step=1      t=1789310646396
step/end    step=1      t=1789310646397
step/start  step=2      t=1789310646430
assistant/message step=2 t=1789310647385  seq=21  usage={input:222, output:68,  total:8098, cacheRead:7808, reasoning:0}
tool/call   step=2      t=1789310647386
tool/result step=2      t=1789310653963
step/end    step=2      t=1789310653963
step/start  step=3      t=1789310653992
assistant/message step=3 t=1789310654955  seq=26  usage={input:176, output:114, total:8226, cacheRead:7936, reasoning:50}
tool/call   step=3      t=1789310654956
tool/result step=3      t=1789310655405
step/end    step=3      t=1789310655406
step/start  step=4      t=1789310655436
assistant/message step=4 t=1789310656133  seq=31  usage={input:179, output:15,  total:8258, cacheRead:8064, reasoning:0}
step/end    step=4      t=1789310656133
turn/end    reason=completed  t=1789310656134
wall clock（进程外测量）  2026-09-13T14:44:02.682Z → 2026-09-13T14:44:19.776Z（17.1 s，含启动与收尾）
```

证据表：

| 项 | v0.1.0 语义（该 Turn 的最后一次调用） | v0.1.1 candidate | 独立折叠 | DSH 官方 meter |
| --- | --- | --- | --- | --- |
| inputTokens | 179 | **829** | 829 | 829（`uncachedInputTokens`） |
| outputTokens | 15 | **275** | 275 | 275 |
| cacheReadTokens | 8064 | **31488** | 31488 | 31488 |
| reasoningTokens | 0 | **69** | 69 | 69 |
| `totalTokens` | 8258 | 不输出 | — | 32592（官方实现自行折叠） |
| duration | — | **11450 ms** | `turn/end − turn/start = 11450` | — |
| 覆盖 | — | sampleCount 4、missing 0、retries 0、complete true | 同 | 返回完整披露 |

`candidate usage == 独立折叠的期望值`、`candidate duration == turn/end − turn/start` 两条均为逐字相等，且与 DSH 自带实现一致。`candidate.produced` 的实测一行：

```text
{"schemaVersion":2,"sessionId":"session-a794420a-…","turn":1,"status":"completed-clean",
 "turnEndKind":"completed","visibleTextLength":33,"explicitToolErrorCount":0,
 "telemetryComplete":true,"durationMs":11450,"provider":"deepseek-official","model":"deepseek-flash",
 "sawTurnStart":true,"usageSampleCount":4,"usageMissingCount":0,"usageUnobservableRetries":0,
 "usageComplete":true,"steps":4,"normalizeDropped":0}
```

同一受控任务在 rc.1 与 rc.2 下各跑一次，结果结构相同（`usageSampleCount` = 模型调用数、`usageComplete: true`、`mail.sent`、`attempts: 1, ok: true`）。

---

## 12. SMTP E2E

使用既有 163 凭据（引用名 `DSH_MAIL_SMTP_PASSWORD`，值全程留在 DSH Credential store，未打印、未落盘、未作为命令行参数）向已配置收件人投递**一封**真实邮件，发送方是插件自身的生产路径（`mailer.ts` → `credential` 服务 → `nodemailer` → `smtp.163.com:465`）：

```text
session-68ee3a44-8d6e-42d2-89fe-d791e654e7fb  turn 1
mail.sent            {"bodyChars":27,"recipientCount":1}
notification.outcome {"attempts":1,"ok":true,"delaysMs":[]}
```

独立复核（同一 Turn 的事件链，官方 meter 与独立折叠）：

```text
start/end     1789310439716 / 1789310451432 -> expected duration 11716 ms
candidate     durationMs=11716  usage={input:1405, output:308, cacheRead:31104, reasoning:88} sampleCount=4 complete=true
official      {uncachedInputTokens:1405, outputTokens:308, cacheReadTokens:31104, reasoningTokens:88}
```

邮件正文（同一 Turn 的候选经由同一构建的渲染器输出，与已投递的那封逐字相同）：

```text
Status:    Task completed (completed-clean)
Turn:      1
Duration:  11.7 s
Tool errors reported by DSH: 0
Telemetry complete: yes
Token usage (turn aggregate): inputTokens=1405, outputTokens=308, cacheReadTokens=31104, cacheWriteTokens=not reported, reasoningTokens=88
Token telemetry complete: yes (4 model calls observed, each reporting usage)
```

三项确认全部成立：Turn aggregate Token usage、正确的 Turn duration、最终可见输出；且正文中不含 reasoning 文本、tool 参数、tool 结果或凭据（三枚 sentinel 在 L5 用例 TEL-12 中另有断言）。

**逐字节的传输证据来自回环对端。** 真实 163 那一封的收件箱副本在本环境不可读，因此「插件确实把渲染结果交给 SMTP」这一环节由隔离运行中捕获的 MIME 记录承担——同一条生产路径、同一次受控任务，只是连接目标是本机 127.0.0.1（不出网），因此可以逐字节检查。§11 那次运行的捕获结果（quoted-printable 解码后）：

```text
Status:    Task completed (completed-clean)
Session:   session-a794420a-707c-486e-a477-93e71d2708bd
Turn:      1
Duration:  11.4 s
Tool errors reported by DSH: 0
Telemetry complete: yes
Token usage (turn aggregate): inputTokens=829, outputTokens=275, cacheReadTokens=31488, cacheWriteTokens=not reported, reasoningTokens=69
Token telemetry complete: yes (4 model calls observed, each reporting usage)

v24.13.0
(no output)
phase6-final
```

回环对端同时核对传输层确实消费了 Credential 服务解析出的值（三条记录的结论一致）：

```text
AUTH PLAIN  user=probe@example.com  passwordLength=16  passwordMatches=true
envelope    from=<probe@example.com> to=<phase6-recipient@example.invalid>
```

---

## 13. rc.1/rc.2 compatibility

**契约层。** `dsh-session`、`dsh-llm`、`dsh-llm-retry`、`dsh-token-meter` 的 `types.d.ts` 与 `turn-usage.js` 在 rc.1 与 rc.2 之间**逐字节相同**（SHA-256 一致，行级 diff 为空），`cordis` 与 `schemastery` 版本两侧相同。因此本插件**不存在版本分支**：同一份 `runtime-adapter.ts` 同时服务两个版本，核心逻辑中没有散布版本判断。

| 检查 | rc.1 | rc.2 |
| --- | --- | --- |
| `npm run typecheck`（src + tests） | exit 0 | exit 0 |
| `npm test` | 327 pass / 0 fail | 327 pass / 0 fail |
| `npm run build` | exit 0 | exit 0 |
| `npm run pack:check` | PASS | PASS |
| 隔离 profile 安装同一份 tgz | 成功（pnpm） | 成功（pnpm） |
| 冷启动装载、无 loader error | 通过 | 通过 |
| 真实多 step Turn + 投递 | `candidate.produced` → `mail.sent` → `outcome ok` | 同 |
| 该 Turn 的样本数与完整性 | sampleCount 4 / complete true | sampleCount 4 / complete true |
| 独立折叠与官方 meter 一致 | 一致 | 一致 |
| 卸载后无残留 | 依赖与 bundles 条目均移除，composed tree 无该行 | 同 |

rc.2 侧的运行证据（`session-bf363d71-…` turn 1）：

```text
durationMs=11115   独立折叠 {input:928, output:290, cacheRead:31488, reasoning:83}
rc.2 官方 meter     {uncachedInputTokens:928, outputTokens:290, cacheReadTokens:31488, reasoningTokens:83}
邮件正文            inputTokens=928, outputTokens=290, cacheReadTokens=31488, reasoningTokens=83 / 4 model calls / complete yes
```

`peerDependencies` 保持 `^0.1.5-rc.1` 不变：本阶段没有发现任何需要修改依赖范围的事实，该范围在 npm 与 pnpm 下均接受 rc.2，但范围本身不是兼容性证据，实测矩阵记入 [`README.md`](README.md)。

---

## 14. Security

```text
scanning DSH_MAIL_SMTP_PASSWORD: length=16 sha256_8=20ebc6de
scanning TAVILY_API_KEY:         length=57 sha256_8=178da371
scanning DEEPSEEK_API_KEY:       length=35 sha256_8=720ebce8
scanning COMMAND_GOAT_API_KEY:   length=92 sha256_8=62b11645
scanning COMMANDCODE_API_KEY:    length=92 sha256_8=62b11645
file cordis.patch.yml: tracked_now=true bytes=898 hits=0
working tree: 65 tracked files, 809082 bytes, hits=0
history: 152 distinct objects, 1319348 bytes, hits=0
SECRET SCAN: PASS
```

比对方式为逐字节 `includes`，UTF-8 与 UTF-16LE 两种编码各一次；值只在内存中参与比较，输出仅有长度与 8 位摘要。

**新增能力的隐私边界。** `src/telemetry.ts` 只接受数值计数器，且只复制 `inputTokens` / `outputTokens` / `totalTokens` / `cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens` 六个键；它不读任何文本字段，因此 reasoning 文本、tool 参数与 tool 结果没有进入候选的路径。`candidate.produced` 新增的五个字段全是整数与布尔值，计数器值本身仍不进入日志（`SECURITY.md` §4）。Phase 6 未削弱任何既有负向隐私断言：PRIV-01…PRIV-08 全部保留，L5 的 TEL-12 又在 Turn 级折叠路径上重放了三枚 sentinel 并断言其不出现。

**本阶段的 secret 卫生。** 隔离运行通过把既有 store 中的值读入**子进程环境变量**（环境层是 DSH Credential 解析的最高优先级层）来喂给隔离 `DSH_HOME`，未把任何 secret 复制到磁盘上的新位置；日志、报告、提交与命令行参数中均无凭据值。隔离 profile 使用的收件人与发件人都是 `*.invalid` 合成地址。

**依赖审计。** `npm audit --omit=dev` 报 1 项 high（`nodemailer <=9.1.0` 的 advisory 组），退出码 1。该结果与 Phase 4 的评估一致，本阶段复核了可达性：插件对 Nodemailer 的全部使用面是 `createTransport({host, port, secure, auth})` 与 `sendMail({from, to, subject, text})`，不使用 `envelope.size`、transport `name`、`raw`、`headers`/`List-*`、`jsonTransport`、`resolveContent()` 或 OAuth2；收件人来自操作者配置而非模型输出。因此已列出的每条 advisory 都要求本插件从不提供的输入。按 §24 未升级依赖（升级到 10.x 属 breaking change，需独立阶段）。

---

## 15. Packaging

```text
npm pack          → dsh-mail-notify-0.1.1.tgz
npm run pack:check → PASS: required entries present, no forbidden entry found
fresh install     → npm install <tgz> 于临时项目：exit 0，安装 0.1.1
fresh import      → exports {Config, apply, inject, name}；name=dsh-mail-notify；inject=0
                    resolveConfig → 0 error / 0 warning
                    同一份构建的行为：schemaVersion 2、durationMs 15000、usage {300,30,10}、coverage 2/0/0/true
                    renderMail → 「Token usage (turn aggregate): …」与「Token telemetry complete: yes (2 model calls …)」
DSH install       → 隔离 profile 安装（rc.1 与 rc.2）
DSH runtime       → 冷启动、受控 Turn、投递、卸载，均通过
DSH uninstall     → 依赖与 dsh.profile.bundles 条目同时移除，composed tree 无该行
```

`package.json` 与 `package-lock.json` 的版本已更新为 `0.1.1`；`files` 白名单未变（`lib`、`cordis.patch.yml`、`README.md`、`LICENSE`），新增的 `src/telemetry.ts` 与 `scripts/turn-telemetry-probe.mjs` 因此不会进入归档（前者经 `lib/telemetry.js` 进入运行时，后者是开发装置）。

---

## 16. Git

```text
starting SHA    eebe8a9c4fee2f807727a7d092ad61f38a894ebf
v0.1.0 tag      0d113e70406330c373eb0a1fef6cc8e78a837c30（未移动、未修改）
final local     （见 §18 提交后回填）
remote SHA      （见 §18 提交后回填）
sync status     （见 §18）
```

提交按代码修复、测试、文档三步分离；未执行 `reset --hard`、`clean`、`rebase`、force push，未移动或重建任何 tag，未执行 `npm publish`、`git tag v0.1.1`、`git push --tags`、GitHub Release。

---

## 17. Remaining limitations

**新增或明确化的限制（本阶段产生）**

1. **重试调用的用量不可观察。** 失败调用的 usage 不在 `llm/retry` 的 payload 中，实测 83 条 `assistant/attempt` 也全部没有 stream usage。因此这类 Turn 的聚合值只覆盖报告过计数器的调用，并以 `usageComplete: false` 与正文的 `Token telemetry complete: no (…)` 如实表达。缺失部分**不估算**；实测 1 432 个已结束 Turn 中 939 个（65.6%）为完整覆盖。
2. **`totalTokens` 在 schema v2 中不再出现。** 需要该数值的消费方必须回到 per-call 记录自行折叠；本插件的 DTO 不再承载它（D017 第 5 条）。
3. **可选 bucket 的语义按 provider 的解释处理。** 聚合按「报告过的 sample 求和」，其正确性依赖「未报告即该次调用没有该桶」这一实测语义（D017 第 4 条）。若未来出现一个「有值但省略该字段」的 provider，聚合值会偏低，而 `usageComplete` 不会因此变为 `false`——该字段只断言调用级的 usage 覆盖。
4. **覆盖范围的判据是保守的。** `usageComplete` 要求每个已宣告的 step 都有结算；一个被取消且未留下任何结算的 step 会使该 Turn 判为不完整，即使实际上并未发生调用。

**沿用（未变化）**

- 去重不跨进程重启（D008）。
- mid-turn 装载时 `durationMs` 为 `null`，`minTurnDurationMs` 因此无法抑制（D015）。
- 六种 `turn/end` 原因中只有 `completed` 在真实 composition 中端到端观察过。
- headless profile 在 Turn 结束后可能随进程退出，投递不保证完成（Phase 4.1 的 R-1；本阶段的隔离运行实际观察到了完整的 `mail.sent` 与 `outcome ok`，但该行为仍不被保证）。
- `nodemailer` 停留在 advisory 区间（可达性已逐条排除，未升级）。
- `scripts/inspect-tarball.mjs` 的 `pack()` 回退路径用 `execFileSync('npm', …)` 且未启用 shell，在本机环境下无法解析 `npm`（Windows 上 `npm` 是 `npm.cmd`）。当目录中已存在 `.tgz` 时该回退不执行，`npm pack` 之后再 `npm run pack:check` 因此正常。本阶段未修改该脚本（不在任务范围内），仅记录这一行为。

---

## 18. Release readiness

```text
v0.1.1 RC READY
```

§33 的放行前提逐项核对：

| 前提 | 结果 | 依据 |
| --- | --- | --- |
| usage 根因确认 | 成立 | §5；`BUG-TEL-001` 在真实 Turn 上复现并归因 |
| Turn 聚合正确 | 成立 | §4.2、§11；与独立折叠及 DSH 官方 meter 逐字一致 |
| retry 语义已处理 | 成立 | §4.1 的两类真实顺序；`llm/retry` 计入 `usageUnobservableRetries`，`assistant/attempt` 计入缺失 |
| schemaVersion 2 | 成立 | §7；D013 + D017 |
| duration 独立复核 | 成立 | §5；`Duration bug NOT reproduced`，未改算法 |
| 测试 PASS | 成立 | §10；327/0/0，check:text / typecheck / build 均 exit 0 |
| 真实多 step 运行 PASS | 成立 | §11；sampleCount = 模型调用数，聚合与时长逐字相等 |
| SMTP E2E PASS | 成立 | §12；真实 163 投递 + `outcome ok` |
| rc.1 PASS | 成立 | §13 |
| rc.2 PASS | 成立 | §13 |
| pack PASS | 成立 | §15；`pack:check` PASS、fresh install/import 通过 |
| security PASS | 成立 | §14；工作树与全历史 0 命中 |

因此本阶段结论为 `PASS — v0.1.1 RC READY`。**发布不在本阶段范围内**：`npm publish`、`git tag v0.1.1`、`git push --tags`、GitHub Release 均未执行，`v0.1.0` tag 保持在 `0d113e70`，等待用户核查本报告后再进入发布阶段。

---

## 19. Documentation sync

| 文件 | 变更 |
| --- | --- |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 新增 D017 与决策索引行；D013 补一条指向 D017 的 Phase 6 注解（不改写其判决） |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 目录与数据流加入 `telemetry.ts`；适配器输出联合扩充为十种事件；新增 §4.1 schema v2 DTO 表；第 4 节字段更新规则改写（折叠而非覆盖）；第 9 节日志字段集扩充；第 10 节补事件类型清单 |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) | Usage 一节拆为原始计数器与 Turn 折叠两组（USE-10…USE-25b、TEL-11…TEL-15）；DUR-05/06；CAND-01/02 更新为 v2；新增 §14.1（TEL-01…TEL-12）与 §14.2（真实录制数据回放）；PKG-07/08；L1 模块清单加入 `telemetry.ts` |
| [`docs/DSH_INTEGRATION.md`](docs/DSH_INTEGRATION.md) | 验证版本表加入 rc.2 与本阶段证据量；事件路径表扩充；新增 §2.1 遥测事件支持矩阵（含出现次数与累积决策）；wire-level facts 增加四条实测约束；第 4/5 节加入本阶段的运行时与交叉验证结论 |
| [`docs/RELEASE.md`](docs/RELEASE.md) | 归档名改为 `<version>`；release checklist 增加两条；新增 §9 版本历史与 v1/v2 判别说明 |
| [`README.md`](README.md) | 版本与状态改为 `0.1.1`（RC，未发布）；支持矩阵加入本阶段证据；新增元数据块示例与说明；troubleshooting 增加两条；known limitations 改写 token 相关两条；文档索引加入本报告 |
| [`00_MASTER.md`](00_MASTER.md) | Execution Roadmap 增加 Phase 6 行与段落；报告索引加入本报告 |

历史 Phase 报告（Phase 1–5）**未被改写**，包括其中对 `usage` 的旧描述；v0.1.0 的遥测缺陷在本报告 §3 与 D017 中作为历史事实记录，而不是回填进旧报告。

---

## 20. 本阶段的实际影响面

**代码**：`src/` 新增 `telemetry.ts`，修改 `types.ts`、`runtime-adapter.ts`、`turn-state.ts`、`event-handler.ts`、`subject.ts`、`debug-sink.ts`。配置字段**零变更**（`docs/CONFIG_SPEC.md` 未修改），因此已配置 profile 的 patch 不需要任何编辑。`peerDependencies` 未变。

**测试**：新增 `tests/unit/telemetry.test.ts`、`tests/integration/turn-telemetry.test.ts`、`tests/support/plugin-harness.ts`；修改 5 个既有测试文件中的断言与装置。

**脚本**：新增 `scripts/turn-telemetry-probe.mjs`（开发期证据工具，不打包）；`scripts/smtp-smoke-test.ts` 仅同步 schema 版本字段。

**用户侧需要执行的动作**：无。`web` profile 中安装的仍是 `dsh-mail-notify@0.1.0`，本阶段未对它做任何替换；v0.1.1 的生效需要用户核查本报告后，在发布阶段或手工安装 tarball 并重启。
