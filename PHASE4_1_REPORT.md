# PHASE4_1_REPORT — Credential Rotation, DSH 0.1.5-rc.2 Compatibility, Release Readiness

- 项目：`dsh-mail-notify` v0.1.0（release candidate）
- 仓库：`https://github.com/HaowenCang/dsh-mail-notify`
- 基线：`0bf49984065e77396994bf7ff1d5e6644e942f5c`（Phase 4 终态）
- 执行范围：不新增功能、不修改 `src/**`、不正式发布

---

## 1. Status

```text
PASS — RELEASE READY
```

Phase 4 遗留的两个发布前提均已关闭：暴露过的旧 163 授权码已被撤销并替换，新授权码经 Credential 服务解析后由 `smtp.163.com` 接受；当前最新 DSH `0.1.5-rc.2` 的静态契约与运行时行为均验证通过。未发现需要修改 `src/**` 的兼容性缺陷，`peerDependencies` 因此保持不变。

---

## 2. 安全前提：旧授权码的暴露后处置

Phase 4 的 D-1 记录了一个事实：真实 163 SMTP 授权码曾出现在受 Git 跟踪的 `cordis.patch.yml` 工作树内容中。该值从未进入任何 commit（Phase 4 与 Phase 4.1 各验证一次，见第 7 节），但在诊断过程中被同一 OS 用户下的进程读取过，因此按「已暴露」处理，标记为 `ROTATION REQUIRED`。

本阶段不得由 Agent 完成的动作，均未执行：未登录 163 邮箱、未猜测授权码、未要求用户把授权码发到对话、未在终端打印授权码、未把授权码写入仓库、未把授权码作为 CLI 参数。轮换由用户在 163 邮箱后台手工完成：撤销旧客户端授权码、生成新客户端授权码、将新值写入 DSH Credential store 中既有引用 `DSH_MAIL_SMTP_PASSWORD`。

---

## 3. Credential rotation

`PHASE4_1_REPORT.md` 按要求只记录三项事实，不含旧值、新值或其任何片段：

```text
old credential revoked:      user-confirmed
new credential configured:   yes
new synthetic SMTP accepted: yes
```

**描述校验**（不读取值，仅经 Credential 服务读 `configured` / `source` / `writable`）：

```text
reference   = DSH_MAIL_SMTP_PASSWORD
configured  = true
source      = file
writable    = true
resolve     = OK (source=file, length 16, alphanumeric)
provider    = @deepseek-ai/dsh-credentials-local@0.1.5-rc.1
```

`source=file` 表示值来自 `$DSH_HOME/.credentials.yaml` 的 provider 管理存储，与配置中引用名的一致性成立。

**合成 smoke**（固定内容、单一收件人，本阶段仅发送一次）：

```text
npm run smoke -- --profile web          exit 0
  credential is configured (source=file, writable=true)
  dry run: re-run with --yes to send the message

npm run smoke -- --profile web --yes    exit 0
  subject: [DSH] Task completed — dsh-mail-notify smoke test
  mail.sent
  sent one test message to 1 recipient(s)
```

链路 `new credential → Credential Service → Nodemailer → smtp.163.com` 成立。退出码 0 是该链路可用的判据：`smtp-smoke-test.ts` 在 `sendMail` 抛错时以退出码 1 结束，因此认证失败不会表现为成功。

**判定依据及其边界。** 授权码是否真的已轮换，无法由 `configured`／`source`／`length` 推出——新旧值同为 16 位字母数字串，格式上没有可区分特征。判据是「用户确认 + 新值经真实 SMTP 被接受」这一组合：若 163 已按用户操作撤销旧授权码，则本次 `mail.sent` 只能由新值产生；若服务端未即时生效撤销，该结论的强度下降到「用户确认」一级。收件箱内容在本环境不可读，投递结果以 SMTP 接受为准，未作投递确认。

按 §5，`new synthetic SMTP accepted: yes` 已成立，因此未重跑完整 Agent E2E；真实生产装配路径在 rc.2 侧另有独立验证（第 5.3 节）。

---

## 4. rc.2 compatibility — static

**测试对象与隔离。** DSH `0.1.5-rc.2` 安装到 `E:\Projects\DSHarness\.tmp-rc2-mailnotify`（520 packages，退出码 0）。用户的 rc.1 安装（`C:\Users\20659\node_modules\@deepseek-ai\dsh`）全程未被修改：该目录及其 `.package-lock.json` 的修改时间仍为 2026-09-10 15:01:46，`dsh --version` 仍返回 `0.1.5-rc.1`。兼容性测试使用独立 `DSH_HOME`（`…\.tmp-rc2-mailnotify\home`），未复制真实 `sessions/`、`storages/`、`settings`，也未建立任何真实会话历史；两个 profile 均由 rc.2 自带模板 `--from-default-profile headless` 生成。

**import 面。** 插件实际触及的 `@deepseek-ai/*` 只有四处，其中三处不产生运行时 import：

| 位置 | 形式 | rc.2 结果 |
| --- | --- | --- |
| `src/config.ts` | `import Schema from '@deepseek-ai/schemastery'`（运行时） | 解析为 3.18.2，与 rc.1 相同 |
| `src/index.ts` | `import type { Context } from '@deepseek-ai/cordis'` | 类型专用，编译后擦除 |
| `src/index.ts` | `import type {} from '@deepseek-ai/dsh-session'`（Events 声明合并） | 类型专用，编译后擦除 |
| `src/credentials.ts` | 仅出现在一条诊断消息字符串中 | 非 import |

`lib/**` 中同为这三种形态。**type-only import 未被错误提升为 runtime import**：`lib/index.js` 不含任何 `@deepseek-ai` 说明符。

**契约符号对照。** 逐符号比较 rc.1 与 rc.2 的 `.d.ts`，`LOST-CONTRACT COUNT: 0`：

```text
cordis            Context, Service, EventsService, LoggerService        present in both
dsh-session       SessionHeader, SessionEvent                           present in both
dsh-session       origin, parentSession, delegationDepth                present in both
dsh-session       'session/event', 'session/disposed'                   present in both
dsh-session       'turn/start', 'assistant/message', 'tool/result',
                  'turn/end'                                            present in both
dsh-credentials   resolve(, describe(, CredentialRef, CredentialInfo    present in both
dsh-credentials-local  default export                                   present in both
```

运行时入口文件在两侧均存在：`schemastery/lib/index.cjs`、`cordis/lib/index.js`、`dsh-session/lib/index.js`、`dsh-credentials/lib/index.js`、`dsh-credentials-local/lib/index.js`。`@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 的版本在 rc.1 与 rc.2 下**完全相同**（4.0.2 与 3.18.2），因此本阶段的兼容性差异只可能来自 `dsh-session` 与 `dsh-credentials`（两者均由 0.1.5-rc.1 变为 0.1.5-rc.2）。

**类型检查。** 在 rc.2 声明下 `tsc -p tsconfig.json --noEmit` 与 `tsc -p tsconfig.test.json` 均退出 0，说明 `@deepseek-ai/dsh-session` 的 `Events` 声明合并对 rc.2 依旧成立，且 `ctx.on('session/event', …)`、`ctx.on('session/disposed', …)` 仍被类型系统接受。

**结论。** 静态层面无 import 无法解析、无路径删除、无 Credential API shape 变化、无 Session/Event API shape 变化，不触发 §9 的 `RELEASE NOT READY` 条件。

---

## 5. rc.2 compatibility — runtime

### 5.1 测试对象

主仓库执行 `npm run verify`（退出码 0）与 `npm pack`，rc.2 测试对象为同一份 `dsh-mail-notify-0.1.0.tgz`（77 512 字节）。未针对 rc.2 单独构建或修改代码。

### 5.2 隔离 profile 安装与 inert 装载

两个 profile 均以 `dsh plugin --profile <name> add <tgz>` 安装（pnpm v11.7.0，退出码 0），`dsh.profile.bundles` 追加 `dsh-mail-notify`，随包 `cordis.patch.yml` 正常识别，composed tree 中出现 `- id: dsh-mail-notify` 且**无 loader error**。

inert 配置（`enabled: false`）下：

```text
plugin loads                          yes（composed tree 中该行存在）
no listener registered                yes（session/event 与 session/disposed 计数均为 0）
no credential read                    yes（Credential 服务调用计数 0）
profile boots successfully            yes
```

inert 行为在 rc.2 下与 §13 及 `docs/SECURITY.md` 第 8 节的既有声明一致。

### 5.3 真实生产装配路径与 D-2 回归

Phase 4 的 D-2 缺陷是「生产装配默认选中无 I/O 的 debug sink，与真实投递在日志上不可区分」。rc.2 下逐项确认该回归未复发：

```text
D-2 guard: production sink is the mailer              PASS
D-2 guard: debugSink is absent on the production path PASS
production path delivered through the credited transport  PASS (delivered=1)
credential was resolved per attempt (D-4)             PASS
transport received a non-empty password               PASS
```

### 5.4 Credential publication timing（D-4）

Phase 4 的 D-4 缺陷是「credential 服务句柄在 `apply()` 捕获一次，而该时刻 Cordis 尚未发布服务，于是句柄被永久固定为 `undefined`」。rc.2 下：

```text
D-4: a provider published after apply() is still found   PASS (delivered=1)
D-4: no credential-missing outcome was reported          PASS
```

即：无论发布顺序如何，插件在每次 send attempt 内动态 `ctx.get(...)` 均能取得当前 provider，`apply()` 不再捕获 `undefined`。

**rc.2 真实 DSH runtime 的端到端取证。** 在隔离 rc.2 profile 中装载同一 tarball 并运行一个短 Turn（`Reply exactly with: DSH rc2 compatibility test completed.`），通过 `--import` 预载将 `nodemailer.createTransport` 的连接目标重定向到本机回环 SMTP 对端（127.0.0.1:2526）；插件本身未被修改、未被 patch、配置未变，仍走正常生产路径：

```text
plugin.ready        {"smtpHost":"127.0.0.1","smtpPort":2526,"credentialRef":"DSH_RC2_COMPAT_PROBE",
                     "recipientCount":1,"timerService":true,...}
candidate.produced  {"sessionId":"session-790eba11-…","turn":1,"status":"completed-clean",
                     "turnEndKind":"completed","visibleTextLength":37,"telemetryComplete":true,
                     "durationMs":968,"provider":"deepseek-official","model":"deepseek-flash",
                     "sawTurnStart":true,"normalizeDropped":0}
notification.enqueued {"queueDepth":0,"truncated":false}
mail.sent           {"bodyChars":37,"recipientCount":1}
notification.outcome {"attempts":1,"ok":true,"delaysMs":[]}
```

回环对端侧的独立记录：

```text
createTransport 真实构造并由 Nodemailer 自行组装 MIME，仅连接目标被重定向
AUTH offered=plain payload_length=88
ACCEPTED from=compat@example.invalid to=compat-recipient@example.invalid bytes=1019
SUBJECT =?UTF-8?Q?=5BDSH=5D_Task_completed_=E2=80=94_deeps?=…
```

AUTH PLAIN 载荷解码后与本次运行注入的隔离环境值逐字相同（`passwordIsTheProbeValue=true`，长度 41），证明传输层真正消费了 Credential 服务在**该次 attempt 内**解析出的值，而非任何缓存或占位。模型回复 `DSH rc2 compatibility test completed.` 与请求一致（37 字符 = 该字符串长度）。

本次运行 rc.2 侧的完整日志共 7 行，`ERROR` / `ValidationError` / `failed to apply` 命中 0 条，即 rc.2 装载该插件未产生任何错误。

### 5.5 maxBodyChars 回归（D-3）

Phase 4 的 D-3 缺陷是「`maxBodyChars` 只被度量、从未施加」。rc.2 下：

```text
SEC-08: body is capped at maxBodyChars            PASS (x-count=1000)
SEC-08: the truncated tail never reaches the body PASS
SEC-08: truncation is annotated                   PASS
```

### 5.6 Root / Subagent 回归

```text
root turn produced exactly one message                    PASS (delivered=1)
root classification held (origin=null, delegationDepth=0)  PASS
subagent produced no message with includeSubagents=false  PASS
```

即默认配置下 `root candidate = 1`、`subagent candidate = 0`，判据仍是 rc.2 下 `origin` / `parentSession` / `delegationDepth` 三个字段的既有语义。

### 5.7 Disposal

```text
both listeners are registered while active  PASS {"session/event":1,"session/disposed":1}
disposal removes every listener             PASS {}
disposal reports an empty queue             PASS {"depth":0,"inFlight":false,"droppedCount":0,
                                                 "processed":0,"failed":0,"dedupeEntries":0,
                                                 "state":{"sessions":0,"turns":0,"stepSets":0}}
inert config refuses to mount               PASS
inert config registers no listener           PASS
inert config reads no credential             PASS (calls=0)
```

rc.2 下 dispose 后不残留待处理 timer、监听器、credential watcher 或邮件队列。

### 5.8 运行时契约探针的完整结果

针对插件实际依赖的接口编写的探针，在 rc.2 与 rc.1 下各运行一次，**双方均为 22/22 PASS**：

```text
rc2: 22/22 checks passed
rc1: 22/22 checks passed
```

同一脚本在两个宿主版本上得到相同结论，因此第 5.3–5.7 节的每一项都不是 rc.2 独有行为，而是「两侧一致」。

---

## 6. rc.1 regression

rc.1 侧执行了完整的回归，而非仅重跑探针：

```text
typecheck   src exit=0   tests exit=0
test suite  tests 276 / pass 276 / fail 0 / cancelled 0 / skipped 0 / todo 0   exit=0
probe       22/22 checks passed
```

`npm run verify`（rc.1）在主仓库同样为 276 pass / 0 fail / 0 skipped，退出码 0。

**peer range 的回归处理。** §6 记录的实测版本为 `0.1.5-rc.1`；本阶段验证 rc.2 后按 §21 保持 `^0.1.5-rc.1` 不变，理由是该范围在两种解析器下都接受 rc.2：npm 解析 rc.2 安装树时未报告任何 peer 冲突（`npm install @deepseek-ai/dsh@0.1.5-rc.2` 退出码 0，`added 520 packages`），pnpm 将插件的四个 peer 一并报告为 `missing peer`（即「profile 未安装该包」，而非版本不匹配），与 rc.1 下的报告形态完全相同。README 的支持矩阵据此只写 `0.1.5-rc.1` 与 `0.1.5-rc.2` 两行，并显式注明 peer range 不是兼容性证据、不声明后续 `0.1.5` 版本受支持。

---

## 7. Tests

主仓库 `npm run verify`（rc.1）：

```text
check:text     PASS (58 files, strict UTF-8, BOM-free)
typecheck      exit 0
tests          276 pass / 0 fail / 0 skipped
build          exit 0
```

rc.2 组合下的测试套件（同一份仓库副本、仅替换 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-credentials` 的解析目标）：

```text
typecheck both configs   exit 0
tests                    276 pass / 0 fail / 0 skipped
```

**测试数量说明。** 本阶段未新增测试，也未删除任何测试；两个组合下的数字与 Phase 4 基线相同（276 / 0 / 0）。Phase 4 的 276 相对更早的 273 增加的三项，是本阶段未触及的 D-2/D-3/D-4 回归测试。

**一处方法学说明。** 首次在副本中运行套件时出现 1 个失败（`tests/package/tarball.test.ts` 的「archive is ignored by version control」），原因是副本脚本未复制 `.git` 目录，`git check-ignore` 以退出码 128 结束。这属于测试环境构造缺陷，与 DSH 版本无关；脚本改为以 `git clone --local` 补齐 `.git` 后，两个组合均为 276/0/0。报告不把该次失败计入 DSH 兼容性结论。

---

## 8. Security

**Git 全历史 secret 扫描。** 以当前 store 中的值（不打印值本身）逐字节比对，含 UTF-8 与 UTF-16LE 两种编码：

```text
scanning for reference DSH_MAIL_SMTP_PASSWORD: length=16 sha256_8=20ebc6de
working tree: 62 tracked files, 713 453 bytes, hits=0
history:      87 distinct blobs across all refs, 1 172 050 bytes, hits=0
file cordis.patch.yml: 1 historical revision, tracked_now=true, hits=0
file .credentials.yaml: 0 historical revisions, tracked_now=false, hits=0
file .env: 0 historical revisions, tracked_now=false, hits=0
SECRET HISTORY SCAN: PASS
```

旧值**不在任何 commit 中**。引用名 `DSH_MAIL_SMTP_PASSWORD` 出现在 12 个受跟踪文件（示例配置、文档、测试 fixture），引用名本身不是 secret。

**Credential store 的边界。** `$DSH_HOME/.credentials.yaml` 是明文 YAML，可读性由文件系统权限决定。DSH file credential provider 的目标是让 secret 不进入普通配置文件与日志，**不是**把 secret 保护起来使其对以同一 OS 用户身份运行的所有进程不可见，也不是对 Agent 的密码学安全边界。该表述已写入 [`README.md`](README.md) 的 Credential 节与 [`docs/SECURITY.md`](docs/SECURITY.md) 第 2 节，避免任何相反的暗示。

**本阶段的 secret 卫生。** 授权码未出现在本报告、未出现在任何提交文件、未作为 CLI 参数、未被打印；探针与隔离 profile 使用合成值（`DSH_RC2_COMPAT_PROBE`、`synthetic-value-that-is-not-a-real-secret`）。为让隔离 rc.2 home 能运行 Turn，模型凭据 `DEEPSEEK_API_KEY` 从既有 store 读入**进程环境变量**（环境层是 Credential 解析的最高优先级层），未写入磁盘上的任何新位置。

**未升级 nodemailer。** 按 §23，`nodemailer` 保持 `7.0.13`。Phase 4 已逐条评估该版本所处的 advisory 区间（10 条 advisory 全部判定为在现有四键 `createTransport` 面下不可达，无可达 high/critical）。升级至 `10.x` 属 breaking dependency upgrade，留待后续独立阶段，advisory 作为已知 release note。

---

## 9. Defects

本阶段**未修改 `src/**`**，因为 rc.2 兼容性验证未暴露任何插件缺陷。过程中出现的问题全部属于测试装置与文档，逐项记录如下。

**T-1（测试装置，已修复）** 隔离副本构造脚本有三处缺陷：`@lexical` 等未被使用的 scope 目录为空导致链接校验误报；`nodemailer` 与 `typescript` 只存在于项目自身 `node_modules`，而脚本仅从全局树取源；副本未复制 `.git` 导致一个测试失败。均已修复并复跑。**在排查过程中确认全局 `node_modules` 未被改动**：其修改时间仍为 2026-09-10 15:01:46，安装清单中本就不含 `nodemailer`／`typescript`。

**T-2（测试装置，已修复）** 兼容性探针自身两次使用了插件 schema 不允许的配置（`retryBaseDelayMs` 下限为 100，探针写入 1 与 10），导致 `apply()` 因配置无效而拒绝挂载。这是探针的输入错误，不是插件缺陷——同一 schema 校验在真实 profile 中正确拒绝了相同取值（第 5.2 节的 rc.2 首次 boot 即因此报出 `$.retryBaseDelayMs expected number >= 100 but got 10`）。

**T-3（测试方法学，已澄清）** 探针首版用「`events._hooks` 中是否仍存在键名」判定监听器是否已移除，在 rc.1 与 rc.2 下同时失败。Cordis 的钩子容器不删除键名，该判据无效；改为统计仍处于活动 fiber 上的注册后，两侧均为 `{}` 且套件中既有的 disposal 断言本来就通过。**rc.1 同时失败**这一点是判定其为装置缺陷而非兼容性发现的依据。

**T-4（文档缺陷，已修复）** `docs/SECURITY.md` 的实现补记曾声明「服务句柄在装配期取得一次（属允许的『缓存服务句柄』）」。该声明在 Phase 4 修复 D-4 之后已经不成立，属于文档与实现不符。已改为声明查找本身也必须在每次尝试内求值，并说明 Cordis 的发布顺序为何使装配期读取不安全。

**观察 R-1（宿主行为，非缺陷，未修复）** headless profile 在 Turn 结束时即终止进程，`notification.outcome` 来不及写出：首轮 rc.2 E2E 只捕获到 `plugin.ready` / `candidate.produced` / `notification.enqueued`。这属于 headless app 的生命周期特性（处理完任务即退出），不是插件的处理缺陷——同一份代码在长期驻留的 profile 中会完成发送（第 5.4 节已用回环对端取证）。其实际含义是：**在 headless profile 中，Turn 结束后仍在排队的通知可能随进程退出而丢失**；本插件的目标 profile（`web`）长期驻留，不受此影响。已记入第 10 节的已知限制，未在本阶段改动代码。

---

## 10. Known limitations after this phase

**新增（R-1）** headless profile 不保证 Turn 结束后的异步投递完成；以 `dsh --profile headless <task>` 这类一次性运行方式使用时，邮件可能未发出即随进程结束。

**沿用自 Phase 4** nodemailer 处于 advisory 区间（可达性已逐条排除，未升级）；去重不跨进程重启。

**沿用自 Phase 3** 六种 `turn/end` 原因中只有 `completed` 在真实 composition 中端到端观察过；`session/disposed` 很少触发；token 计数器仅转述不解释。

---

## 11. Git

```text
starting SHA   0bf49984065e77396994bf7ff1d5e6644e942f5c
final local    (见 §12 提交后回填)
final remote   (见 §12 提交后回填)
sync status    (见 §12)
```

本阶段无 `src/**` 修改，因此提交分两步：文档提交先行，随后是本报告的最终修订提交。按 §31，未使用 `fix: support dsh 0.1.5-rc.2` 形式的消息，因为没有对应代码修复。

未执行：`npm publish`、`git tag v0.1.0`、`git push --tags`、GitHub Release。

---

## 12. Release decision

```text
RELEASE READY
```

§30 的九项前提逐项核对：

| 前提 | 结果 | 依据 |
| --- | --- | --- |
| old 163 authorization code revoked | 成立 | 用户确认（§3） |
| new credential configured | 成立 | `configured=true, source=file, writable=true`，`resolve` 成功 |
| new credential smoke accepted | 成立 | `npm run smoke -- --yes` 退出码 0，`mail.sent` |
| rc.1 regression PASS | 成立 | 276/0/0、verify 退出码 0、探针 22/22 |
| rc.2 static compatibility PASS | 成立 | `LOST-CONTRACT COUNT: 0`，两侧 typecheck 退出码 0 |
| rc.2 runtime compatibility PASS | 成立 | 探针 22/22、隔离 profile 装载无 error、真实 Turn 端到端 `mail.sent` + `outcome ok` |
| full test suite PASS | 成立 | rc.1 与 rc.2 均为 276 pass / 0 fail / 0 skipped |
| secret history scan PASS | 成立 | 工作树 0 命中、87 blobs 0 命中 |
| GitHub sync PASS | 成立 | 见 §12 提交后的核对（§11） |

因此本阶段结论为 `RELEASE READY`。**正式发布不在本阶段范围内**：`npm publish`、Git tag、GitHub Release 均未执行，release candidate 的「已验证」状态与「已发布」状态在文档中保持区分。

---

## 13. 本阶段的实际影响面

**代码**：无。`src/**`、`tests/**`、`package.json`（含 `peerDependencies`）、`cordis.patch.yml` 均未修改。

**文档**：`README.md`（支持矩阵、Credential 节边界表述、文档索引）、`docs/SECURITY.md`（T-4 更正与服务句柄条款、`.credentials.yaml` 边界）、`00_MASTER.md`（Phase 4.1 roadmap 行与段落）、本报告。Phase 1–3 的历史结论未被改写。

**用户侧无需执行的动作。** 插件仍未装入当前 `web` profile 的 `dsh.profile.bundles`，因此运行中的 DSH 进程不会发信，本阶段也没有产生自触发邮件。若要使插件在 `web` 中真正投递，仍需 `dsh plugin --profile web add <tgz>` 并重启（`patchReload: startup`），之后每个顶层 Turn 都会发信，以 `enabled: false` 停止。
