# IMPLEMENTATION_PLAN — dsh-mail-notify Phase 3

本文件把 [`ARCHITECTURE.md`](ARCHITECTURE.md) 的模块规格与 [`DECISIONS.md`](DECISIONS.md) 的冻结决策拆分为可执行、可验证的实现顺序。每个步骤给出输入、输出、验证方式与失败条件。

**当前仓库尚无 `src/`、无 `package.json`、无 `tests/`。本文件描述 Phase 3 的工作，不描述已完成的实现。**

> **Implementation note（Phase 3 补记，2026-09）。** P3.1–P3.7 已全部执行完毕，上文每一项「输出」均已产出。逐项结果、命令、退出码、测试数量与失败修复记录见 [`../PHASE3_REPORT.md`](../PHASE3_REPORT.md)。与此计划的偏离共三处，均为计划未预见的事实，逐项记录如下。
>
> 1. **测试运行器是 `node --test`，不是 Vitest。** 第 P3.6 节与本文件未指定运行器；实际采用 Node 内置测试运行器与 `node --test "tests/**/*.test.ts"`，不新增依赖。理由见 [`TEST_PLAN.md`](TEST_PLAN.md) 的补记。
>
> 2. **第 1 节「不引入除 Nodemailer 外的网络依赖」的检查方式**由「审查 `package.json` 的 `dependencies`」扩展为可执行断言：`tests/package/tarball.test.ts` 扫描归档内全部编译产物与相对导入，且 `dependencies` 中除 `nodemailer` 外没有其他条目。
>
> 3. **`src/runtime-adapter.ts` 的输出联合增加了 `tool-call` 与 `user-message` 两个变体。** 理由与取值路径见 [`ARCHITECTURE.md`](ARCHITECTURE.md) 的补记第 2、3 项。


---

## 0. 步骤间的依赖关系

```text
P3.1 scaffold ──► P3.2 pure core ──► P3.3 adapter ──► P3.4 candidate pipeline
                                                              │
                                                              ▼
                                                        P3.5 SMTP
                                                              │
                                                              ▼
                                                        P3.6 tests（贯穿）
                                                              │
                                                              ▼
                                                        P3.7 runtime integration
```

P3.2 可与 P3.3 并行推进（前者是纯函数，后者依赖 DSH payload 形状），但 P3.4 必须等待二者都完成。

---

## P3.1 Project scaffold

| 项 | 内容 |
| --- | --- |
| **目标** | 建立可编译、可测试、可打包的最小工程骨架，并使一个空插件能被 DSH 装载 |
| **输入** | 本仓库的 `docs/` 规格；DSH `0.1.5-rc.1`；Node `v24.13.0` |
| **输出** | `package.json`、`tsconfig.json`、`cordis.patch.yml`、`src/index.ts`（最小可装载）、`src/logger.ts`、`.env.example`、测试运行器配置、构建脚本 |

### 具体内容

**`package.json`** 必须声明 bundle manifest，这是 DSH 识别可安装插件的唯一入口：

```json
{
  "name": "dsh-mail-notify",
  "type": "module",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/schemastery": "*"
  },
  "dependencies": { "nodemailer": "^7" },
  "files": ["lib", "cordis.patch.yml", "README.md", "LICENSE"]
}
```

该形状已由本机 DSH 安装取证：`@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-headless`、`dsh-sdk-minimal` 均使用 `{"bundle":{"patch":"./cordis.patch.yml"}}`。`peerDependencies` 的版本范围声明为 `*` 而不硬编码版本——插件与宿主共享同一份 Cordis 与 schemastery 实例，硬编码版本会导致重复安装与两个互不相识的服务注册表。

`files` 是白名单而非黑名单。不列入 `files` 的一切（含 `.env`、`*.pem`、`tests/`、开发缓存）不会进入 tarball，这是 `docs/SECURITY.md` 第 6 节在打包层面的落实。

**`src/index.ts`** 的最小形态，导出形态由本机 `wechat-notify` 与 DSH 自身插件共同确认：

```ts
export const name = 'dsh-mail-notify'
export const inject = []
export function apply(ctx: Context, config: Config) { /* 空实现 */ }
export const Config = z.object({ /* 由 config.ts 提供 */ })
```

Cordis 的 function 风格插件导出 `name` / `inject` / `Config` / `apply` 四个符号（取证：`@deepseek-ai/dsh-llm-retry` 的 `export { Config, RetryId, apply, inject, name }`），`apply` 收到的 `config` 已由 `Config` schema 校验。配置校验失败时 Cordis 本身即拒绝装载，因此 `docs/CONFIG_SPEC.md` 第 4 节的「校验失败即不装载」无需自行实现装载控制。

**`cordis.patch.yml`** 使用 `insert` 列表语法（取证：`dsh-base` / `dsh-web-app` 的 bundle patch）：

```yaml
- insert:
    - id: dsh-mail-notify
      name: dsh-mail-notify
      config:
        enabled: true
        smtpHost: smtp.example.com
        # …
```

注意事项（均由 DSH 自身的 patch 文件注释确证）：

- **patch 替换整行 `config` 而非合并**，因此任何覆盖该行的后续 patch 层必须重述它拥有的每个键。`cordis.patch.yml` 中应给出完整的、语义安全的默认配置，而不是只写必填项。
- `!!js` 表达式可用（如 `!!js process.env.X`），但本插件**不使用**：配置从文件读取比从环境变量读取更可审计，而密码走 Credential 服务（D010）。

**`inject` 的取值**：不要 `inject: ['credentials']` 或 `inject: ['timer']`。二者在 `docs/ARCHITECTURE.md` 第 10 节中均声明为可选依赖（`ctx.get()` + `undefined` 检查）。使用 `inject` 会把它们变为硬依赖，使插件在服务缺席时无法激活，而本插件在两者缺席时仍应能运行并给出明确诊断。

**`.env.example`** 只含占位符（如 `DSH_MAIL_SMTP_PASSWORD=`）。`.gitignore` 已包含 `!.env.example` 否定规则，但该文件本身也应只有在确有必要时才添加。

| 项 | 内容 |
| --- | --- |
| **验证** | ① `tsc --noEmit` 通过；② 构建产出 `lib/index.js`；③ 在独立 DSH 安装中以本地路径装载该 bundle，插件出现在 loader entries 且无 error 日志；④ `enabled: false` 时装载后不注册任何监听器 |
| **失败条件** | ① 类型检查报错；② DSH 报告 `dsh.bundle` manifest 缺失或 patch 文件不存在；③ 插件装载成功但 `apply` 未被调用；④ `npm pack` 产物缺少 `cordis.patch.yml` |

---

## P3.2 Pure core

| 项 | 内容 |
| --- | --- |
| **目标** | 实现全部无副作用、无 I/O 的核心逻辑，并使其可被单元测试直接覆盖 |
| **输入** | `docs/ARCHITECTURE.md` 第 3–6 节的模块规格；`docs/CONFIG_SPEC.md` 的配置表 |
| **输出** | `src/types.ts`、`src/config.ts`、`src/normalize.ts`、`src/content.ts`、`src/completion.ts`、`src/subject.ts`、`src/turn-state.ts`、`src/retry.ts`（分类与退避计算部分） |
| **依赖** | P3.1 |

### 实现顺序与要点

`types.ts` 先行：`NotificationCandidate`（D007）、`TurnState`、`CandidateStatus`、`TurnEndKind`、`SuppressReason`、`RetryClass`、`ResolvedConfig`。`schemaVersion` 声明为字面量 `1`。

`config.ts` 其次：用 `@deepseek-ai/schemastery` 的 `z.object({...})` 声明 `Config`，`z.object` 的默认值即 `docs/CONFIG_SPEC.md` 第 3 节的默认值。交叉校验（端口与 `secure` 的组合、三个通知开关全关）以 schema 之外的显式检查实现，按 `CONFIG_SPEC.md` 第 4 节给警告而不阻断。

`normalize.ts`：实现 lossless-JSON 归一化（D006、Phase 1 的归一化规则表）。这是最容易被低估的模块——Phase 1 的实际故障是「三个可选计数器里恰好一个缺省」使**整批**输出不可读，因此该模块的正确性直接决定可观测性。必须返回被省略的字段路径，而不是静默丢弃。

`content.ts`：`extractVisibleText(blocks)` 与 `truncateVisibleText(text, maxChars)`。前者是白名单实现（D002），后者按码点截断（D014）。两者都不得抛异常。

`completion.ts`：分类表（`ARCHITECTURE.md` 第 5 节）与 detail 提取。`reasonDetail` 的清洗（去除控制字符、截断）在此实现。

`turn-state.ts`：`createTurnState`、`applyEvent`、`createCandidate`。`steps` 的累计方式必须满足 `TEST_PLAN.md` 的 TRN-11（不同 step 编号的数量，不是最大值）。

`subject.ts`：主题生成与元数据头部渲染。主题的换行移除与长度截断在此实现。

`retry.ts`：只实现分类与退避**计算**（纯函数）；实际等待与循环在 P3.5 与 `queue.ts` 中组装。

| 项 | 内容 |
| --- | --- |
| **验证** | `docs/TEST_PLAN.md` 中标记为 L1 的全部用例通过：CNT-01…07、TRUNC-01…05、TRN-01…11、DUR-01…04、TOOL-01…05、USE-01…06、CAND-01…04、NORM-01…05、DED-01…04、SUP-01…06、PRIV-01…08、RET-10 |
| **失败条件** | ① 任何 L1 用例失败；② 模块出现对 `ctx`、`session` 或 `event` 的引用（违反架构不变量二）；③ `content.ts` 或 `normalize.ts` 抛出异常；④ 构造的候选无法通过 lossless-JSON 校验 |

---

## P3.3 DSH adapter

| 项 | 内容 |
| --- | --- |
| **目标** | 把 DSH 原始 payload 收敛为内部 DTO，成为唯一的 DSH 边界 |
| **输入** | `PHASE1_RUNTIME_CONTRACT.md` 的全部已确证字段路径；`docs/DECISIONS.md` D001、D003、D005 |
| **输出** | `src/runtime-adapter.ts` |
| **依赖** | P3.1、P3.2（`types.ts`） |

### 实现要点

- `toSessionFacts(session)`：实现三判据优先级与 `decidedBy` 记录（D003）。`delegationDepth` 只允许 `typeof === 'number' && > 0` 一种比较形式。
- `toInternalEvent(event)`：按 `event.type` 分派到 `turn-start` / `assistant-message` / `tool-result` / `turn-end` / `other`。
- `assistant/message` 分支：`event.data.message.content`、`event.data.message.id`、`event.data.message.source.kind === 'model'` 时的 `provider` / `model`、`event.data.usage`。
- `tool/result` 分支：双判据取或并折叠为单一 `explicitError`（D005）。不得在此解析 stdout/stderr。
- 所有字段访问都必须有形状检查。任何 `turn` 缺失或非数字的事件降级为 `{ kind: 'other' }`，**不得**用 `0` / `NaN` 兜底。
- 返回值不得包含对 `session` / `event` / `event.data` 的引用（`TEST_PLAN.md` ADP-05）。

本步骤**不**包含 `session/event` 的注册——事件注册属 P3.4。适配器是纯函数模块，可在无 Cordis 环境下测试。

| 项 | 内容 |
| --- | --- |
| **验证** | `TEST_PLAN.md` 的 SES-01…07、ADP-01…06、TOOL-01…05（L3 部分）通过 |
| **失败条件** | ① `{origin:null, parentSession:null, delegationDepth:0}` 被判定为 subagent（这是 Phase 1 实际发生过的误判类缺陷）；② 适配器抛出任何异常；③ 返回值中泄漏 DSH live 对象引用；④ 出现对 `event.data.message.content[0].text` 之类「按字段名取值」的推理文本访问 |

---

## P3.4 Candidate pipeline

| 项 | 内容 |
| --- | --- |
| **目标** | 打通从事件到队列的完整链路，并以 DebugSink 替代 SMTP，使链路可在无网络条件下端到端验证 |
| **输入** | P3.2 的纯函数核心、P3.3 的适配器 |
| **输出** | `src/event-handler.ts`、`src/queue.ts`、`src/notifier.ts`、`src/index.ts`（完整装配）、DebugSink |
| **依赖** | P3.2、P3.3 |

### 实现要点

`notifier.ts` 的抑制判定顺序是契约（`ARCHITECTURE.md` 第 3 节），因为它决定日志中出现哪个 `suppressedReason`。去重标记**只在确定要发时**写入（D008）——`TEST_PLAN.md` 的 DED-04 专门验证这一点。

`queue.ts` 的 `enqueue()` 必须是同步函数并返回 `boolean`。队列满时丢弃最新条目、自增计数、写结构化 warning（D009）。

`event-handler.ts` 的 `session/event` 回调**不得**是 `async`，其返回值必须是 `undefined`（`TEST_PLAN.md` QUE-06）。`session/disposed` 在同一个 handler 中注册。

`index.ts` 的装配顺序：解析配置 → 校验 → 构造 logger → 构造 queue → 构造 notifier → 构造 handler → 注册两个监听器。全部资源通过 `ctx.effect()` 或 `ctx.on()` 注册，使 Fiber dispose 能回收。

**DebugSink** 是 P3.4 的关键设计：它实现与 `mailer.ts` 相同的 sink 签名 `(job) => Promise<SendResult>`，但只把归一化后的 job 写入日志或内存缓冲。这使得整条链路（事件 → 状态 → 候选 → 策略 → 队列 → 结果）在没有 Nodemailer、没有网络、没有凭据的情况下完全可测，并在 P3.5 之后继续作为集成测试的默认 sink（`TEST_PLAN.md` L5 即以此为基础）。

| 项 | 内容 |
| --- | --- |
| **验证** | `TEST_PLAN.md` 的 QUE-01…07、LIFE-01…07、E2E-01…08 通过；在真实 DSH 会话中装载后，一个真实 Turn 产生一条符合 schema v1 的候选记录 |
| **失败条件** | ① `session/event` 回调返回 Promise；② 队列无界增长或满时静默丢弃；③ `turn/end` 结算后 `TurnState` 未清理；④ 重复 `turn/end` 产生两条队列条目；⑤ 真实会话中的候选 `status` 与 `turn/end.kind` 不一致 |

---

## P3.5 SMTP

| 项 | 内容 |
| --- | --- |
| **目标** | 以 Nodemailer 实现发送路径，接入 DSH Credential 服务与错误分类重试 |
| **输入** | `docs/CONFIG_SPEC.md` 第 2.2/2.3 节、`docs/SECURITY.md` 第 2/3/4 节、`docs/ARCHITECTURE.md` 第 6 节 |
| **输出** | `src/mailer.ts`、`src/retry.ts`（等待与循环部分）、`src/subject.ts` 的渲染接入、`scripts/smtp-smoke-test.ts` |
| **依赖** | P3.4 |

### 实现要点

- 凭据解析必须在**每次发送操作内部**完成：调用 `ctx.get('credentials')` 取得服务句柄（可在装配时缓存**句柄**，但不得缓存**解析结果**），然后 `resolve(ref)`（D010）。`TEST_PLAN.md` SEC-02 验证的正是这一点。
- `resolve` 返回 `undefined` 时按 `permanent` 处理，诊断信息含引用名与 `describe()` 结果，不含 secret。
- TLS 配置不得出现 `rejectUnauthorized: false`（SEC-06）。
- transport 每次发送创建或在发送作用域内持有，不得在模块级变量中长期持有凭据。
- 错误分类以 Nodemailer 错误对象的 `code` / `responseCode` 为主判据；无法识别默认为 `permanent` 并标记 `unknown-error`（RET-08）。
- 退避等待必须可被 dispose 中断：使用 `ctx.get('timer')` 或等价的随 Fiber 释放的定时器（RET-11）。
- `scripts/smtp-smoke-test.ts` 是唯一允许真实发送的入口，运行前用 `describe()` 校验凭据已配置，且不打印任何 secret。

| 项 | 内容 |
| --- | --- |
| **验证** | `TEST_PLAN.md` 的 SEC-01…07、RET-01…11 在 stub transport 下全部通过；`npm run smoke` 在显式运行时能投递一封测试邮件 |
| **失败条件** | ① `resolve` 在连续两次发送中被调用少于两次（说明发生了缓存）；② 认证失败被重试；③ 未知错误被重试 4 次；④ 日志中出现 stub 密码值；⑤ 构造的 transport 参数含 `rejectUnauthorized: false`；⑥ dispose 后仍有未结算的退避定时器 |

---

## P3.6 Tests

| 项 | 内容 |
| --- | --- |
| **目标** | 把 `docs/TEST_PLAN.md` 的矩阵落为可重复执行的自动化测试 |
| **输入** | `docs/TEST_PLAN.md` 全部用例 |
| **输出** | `tests/unit/**`、`tests/integration/**`、`tests/fixtures/**`、测试运行器配置 |
| **依赖** | 与 P3.2–P3.5 并行，但完整覆盖需在 P3.5 完成后 |

### 层次与边界

| 层次 | 覆盖范围 | 关键约束 |
| --- | --- | --- |
| unit | L1 全部纯函数用例 | 不引入 mock 框架；时间与随机由参数注入 |
| adapter | L3，含畸形 payload 样本 | 样本须来自 `PHASE1_RUNTIME_CONTRACT.md` 的真实形状，而不是凭类型声明猜测的形状 |
| integration | L2、L4、L5 | 使用 DebugSink 或 stub transport，**不触网** |
| package | L6 | 对 `npm pack` 产物做内容与安装检查 |

**fixtures 的构造原则**：真实 Turn 的 payload 形状应以 Phase 1 文档记录的字段路径与实测值为准（例如 `tool/result` 的 `content` 是单元素元组、`isError` 成功时缺省而非 `false`、`TurnEndReason` 恰好 6 种 kind）。不得为了提高覆盖率而构造 DSH 不会产生的形状——那会让适配器测试通过而真实运行失败。

**必须存在的负向断言**：`PRIV-01…04` 与 `SEC-04/05` 采用「断言不含特定字符串」，而不是只断言包含期望字段。仅正向断言的测试无法发现新增字段导致的泄露。

| 项 | 内容 |
| --- | --- |
| **验证** | ① 测试全绿；② 在断网条件下运行测试仍全绿（证明 L1–L5 不触网）；③ 覆盖率不是验收标准，`TEST_PLAN.md` 的逐条用例通过才是 |
| **失败条件** | ① 任何用例为跳过状态而非通过；② 测试过程中产生真实网络请求；③ fixtures 中含真实凭据；④ 用例断言的是实现细节（内部函数名、日志措辞）而非 `TEST_PLAN.md` 规定的可观察行为 |

---

## P3.7 Runtime integration

| 项 | 内容 |
| --- | --- |
| **目标** | 证明打包产物可在真实 DSH 中安装、运行、观测、卸载 |
| **输入** | P3.1–P3.6 的全部产出 |
| **输出** | `dsh-mail-notify-<version>.tgz`、安装与回滚说明 |
| **依赖** | 全部前置步骤 |

### 执行顺序

1. 类型检查、lint、单元与集成测试、构建、`npm pack`，全部实际运行并记录退出码。
2. 检查 tarball 内容（`TEST_PLAN.md` PKG-01、PKG-02）。
3. 在**独立的 DSH 安装**（而非当前开发安装）中以 `.tgz` 安装，验证 package.json 的 bundle manifest 被识别（PKG-03）。
4. 使用 DebugSink 运行一个真实 DSH 会话，确认顶层 Turn 产生候选、subagent 不产生（PKG-04、E2E-01…08 在真实运行时的对应验证）。
5. 切换为真实 SMTP，用专用测试收件人验证一封邮件的端到端投递（这是唯一需要真实投递的步骤）。
6. 卸载并确认无残留监听器与状态（PKG-06）。

**优先使用打包后的 tgz 做安装测试**，而不是直接指向源码目录（`00_MASTER.md` §20）。源码目录装载会跳过 `files` 白名单、`dsh.bundle` manifest 解析与编译产物校验，因此无法验证真实安装路径。

| 项 | 内容 |
| --- | --- |
| **验证** | `TEST_PLAN.md` PKG-01…06 全部通过；真实 Turn 的通知内容与候选记录一致；卸载后 DSH 正常运行 |
| **失败条件** | ① tarball 含 `.env` / 凭据 / 测试 secret；② 独立安装无法识别 bundle；③ 卸载后仍有监听器或状态残留；④ 真实运行中插件异常影响 Agent Loop；⑤ 构建、测试、打包任一步未实际运行而被记为通过 |

---

## 1. 跨步骤的持续要求

以下约束在每个步骤中都必须成立，不属于任何单个步骤：

| 要求 | 检查方式 |
| --- | --- |
| 不修改 DSH 核心源码 | `git status` 中不含 DSH 安装目录的改动 |
| 不引入除 Nodemailer 外的网络依赖 | 审查 `package.json` 的 `dependencies` |
| 所有结构化输出经 `normalize.ts` | 审查日志与队列条目的构造点 |
| 监听器路径无 `await` | 审查 `event-handler.ts`；QUE-06 自动化验证 |
| 无 `rejectUnauthorized: false` | 全仓库文本检索 |
| 凭据不进入任何持久化位置 | 提交前检索 `git diff` |
| 每个模块的「不允许承担的职责」未被违反 | 代码审查，逐模块对照 `ARCHITECTURE.md` 第 3 节 |

## 2. 阶段完成的判定

Phase 3 完成的判定依据是 `00_MASTER.md` §20 与实际运行结果，具体为：类型检查、lint、单元测试、集成测试、构建、打包全部**实际执行**且通过；tarball 内容已检查；本地安装命令已在独立安装中验证；smoke test 方法、配置示例与回滚方式已在 README 中给出。

未实际运行而被记为通过的检查项属于虚假声明。任何一步无法执行时，应报告该步的阻塞原因与已排除的可能，而不是跳过。
