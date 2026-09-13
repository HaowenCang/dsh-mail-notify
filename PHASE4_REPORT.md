# Phase 4 Report

**主题：真实 SMTP E2E 验证与 v0.1.0 Release Candidate 审计**

---

## 1. Status

```text
PASS — RC READY
```

合成 SMTP smoke 与真实 Agent → Email E2E 均通过真实 SMTP 服务器，其余 RC 检查全部通过。审计中发现
四个缺陷，均已在提交前修复并重新验证（见 §11）。

---

## 2. Baseline

| 项 | 值 |
| --- | --- |
| branch | `main` |
| starting SHA | `99bef3220eada157f67d588db0fc5b94c8bdbe2a` |
| DSH version | `0.1.5-rc.1` |
| Node version | `v24.13.0` |
| npm version | `11.x`（`npm pack` / `npm audit` 所用） |
| pnpm version | `11.7.0`（`dsh plugin` 转发目标） |

DSH 版本与 Phase 3 验证版本一致（`0.1.5-rc.1`），因此未重新执行 Phase 1。仅对插件实际依赖的接口做
定向核查（§9）。

进入本阶段时工作树并非 clean：`cordis.patch.yml` 存在用户未提交修改。该修改被保留、审查并在
§11 中作为 D-1 处理，未使用 `git reset --hard`、`git clean -fd`、`--force`、`--amend` 或 `rebase`。

---

## 3. SMTP configuration

| 项 | 值 |
| --- | --- |
| host | `smtp.163.com` |
| port | `465` |
| secure | `true`（隐式 TLS） |
| credential reference | `DSH_MAIL_SMTP_PASSWORD` |
| credential source | `file`（`$DSH_HOME/.credentials.yaml`，provider-managed，`writable=true`） |
| recipient count | 1 |

进入本阶段时，用户的 SMTP 配置位于**错误的层**：仓库自身的 `cordis.patch.yml`（bundle 默认 patch，
**纳入 Git 跟踪**）被填入了真实配置，而该文件头部明确要求保持 inert；`web` profile 的
`cordis.patch.yml` 中对应行则是 Phase 3 遗留的 `disabled: true` 且无 `config:`。修复方式与结果见
§11 D-1。最终真实配置位于 `$DSH_HOME/profiles/web/cordis.patch.yml` 的 `- id: dsh-mail-notify` 行，
仓库文件恢复为已提交的 inert 默认（仅 `enabled: false`）。

本报告不记录任何 Secret。`DSH_MAIL_SMTP_PASSWORD` 是引用名，不是 Secret。

---

## 4. Synthetic smoke

| 项 | 结果 |
| --- | --- |
| dry-run | PASS — exit 0；`host smtp.163.com:465 secure=true`；`credential is configured (source=file, writable=true)`；`dry run: re-run with --yes to send the message` |
| real send | PASS — exit 0；`mail.sent`；`sent one test message to 1 recipient(s)`；elapsed 1298 ms |
| SMTP accepted | **YES** |
| mailbox observation | **EXTERNAL** |

发送前已确认 dry-run 输出中不存在 SMTP App Password、`auth.pass`、AUTH payload、`Authorization`、
Credential raw value、SMTP URL 内嵌密码。实际密码从未作为 grep/search 参数使用；本节仅检查输出结构
与日志字段。

命令为文档正典形式 `npm run smoke -- --profile web` 与 `npm run smoke -- --profile web --yes`，未添加
`--password` 之类参数。本阶段主动发送的合成邮件为 **1 封**，未循环重试。真实收件箱是否显示该邮件在
本环境不可观察，因此记为 EXTERNAL，不作投递确认。

---

## 5. Agent E2E

使用隔离的 disposable profile（`dsh --profile mailnotify-probe3 --from-default-profile headless`，
安装本阶段打包的 `.tgz`），通过 `scripts/dev-boot-probe.mjs` 启动真实 DSH runtime 并附加日志 exporter。

任务：`Reply exactly with: DSH mail notify end-to-end test completed.`

| 项 | 结果 |
| --- | --- |
| probe exit code | 0 |
| plugin mount | `plugin.ready`，携带解析后的完整配置（`smtpHost: smtp.163.com`、`smtpPort: 465`、`credentialRef: DSH_MAIL_SMTP_PASSWORD`、`recipientCount: 1`、`timerService: true`） |
| candidate | `candidate.produced` — 1 个；`status: completed-clean`；`visibleTextLength: 42`；`turn: 1`；`durationMs: 2256` |
| queue | `notification.enqueued` — 1 个；`queueDepth: 0`；`truncated: false` |
| SMTP outcome | `mail.sent {"bodyChars":42,"recipientCount":1}`；`notification.outcome {"attempts":1,"ok":true}` |
| SMTP accepted | **YES** |

`ok: true` 仅在 `transport.sendMail()` 正常 resolve 之后返回（`src/mailer.ts`：成功分支紧接
`mail.sent` 且返回 `{ ok: true }`；失败分支捕获异常并返回 `{ ok: false, … }`），因此该结果等价于
SMTP 服务器接受了该消息。probe 在候选人之后自行重放一次完整 turn 链用于重复抑制测试：日志中
`candidate.produced` / `notification.enqueued` / `notification.outcome` 各自恰好 1 次，重放未产生第二
封邮件，与 Phase 3 记录的 live 去重行为一致。

### 邮件正文验证

| 断言 | 结果 |
| --- | --- |
| 通知内容包含测试模型的 visible text | YES — `visibleTextLength: 42`，与 `DSH mail notify end-to-end test completed.` 的 42 个码点一致；`bodyChars: 42` |
| 不含 reasoning | YES — `PRIV-01`、`CNT-02/03` 断言，且 candidate 不携带文本字段 |
| 不含 system prompt / tool-call arguments / tool-result body | YES — `SEC-05b`、`PRIV-02/03` |
| 不含 credential / SMTP password | YES — `SEC-04`、`SEC-05` |

**Mailbox content observation: EXTERNAL.** 本环境无法读取收件箱，正文确认依据为 renderer + runtime
Candidate + `mail.sent` 三项证据，未伪称打开过收件箱。

### 当前 Phase 4 Turn 的污染说明

`web` profile 的 `dsh.profile.bundles` **不包含** `dsh-mail-notify`（`dsh --profile web --dump-config`
中不存在该行），因此当前 DSH 主进程没有任何路径装载本插件，本 Phase 4 长回复的 `turn/end` 不会产生
通知邮件，无需为规避额外邮件而调整 profile。本报告未把当前 Turn 计入受控 E2E 证据。

### Subagent

沿用 Phase 3 的 runtime evidence（真实 subagent 不产生 Candidate），本阶段未为重复证明该点而额外发
送邮件。

---

## 6. Verification

| 检查 | exit code | 结果 |
| --- | --- | --- |
| `check:text` | 0 | `scanned 57 text files` — 全部严格 UTF-8、无 BOM、无已知 mojibake |
| `typecheck` | 0 | `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json` |
| `tests` | 0 | **276 pass / 0 fail / 0 skipped**（273 基线 + 3 个新增回归测试） |
| `build` | 0 | `tsc -p tsconfig.json` |
| `npm pack` | 0 | `dsh-mail-notify-0.1.0.tgz` |
| `npm run pack:check` | 0 | `PASS: required entries present, no forbidden entry found` |

测试数量由 273 增至 276：D-2、D-3、D-4 各补 1 个回归测试，D-1 属配置层修复（其代码侧约束原本已由
「the credential reference must be a name, not a value」覆盖）。真实数量如实记录，未人为维持 273。

### Tarball audit

| 项 | 值 |
| --- | --- |
| archive | `dsh-mail-notify-0.1.0.tgz` |
| size | 77 512 bytes（unpacked 285.7 kB） |
| entries | 76 |
| compiled modules | 18 |
| forbidden entries | 0 — 无 `.env`、credential 文件、password 文件、`*.pem`、`*.key`、`tests/`、`scripts/`、`node_modules/` |
| shasum | `3df9f1399f972a57d3d92bda9fe44539df368c60`（修复前）；修复后重新打包，见 §13 |

`pack:check` 之外的独立扫描确认：归档内每个编译文件均不含形如密码字面量的赋值（`PKG-02b`），且
随包发布的 `cordis.patch.yml` 仍为 inert（`enabled: false`，`PKG-02c`）。

### npm metadata

| 字段 | 值 |
| --- | --- |
| name | `dsh-mail-notify` |
| version | `0.1.0` |
| main | `lib/index.js` |
| types | `lib/types/index.d.ts` |
| exports | `"." → { types: ./lib/types/index.d.ts, default: ./lib/index.js }`、`"./package.json"` |
| files | `lib`、`cordis.patch.yml`、`README.md`、`LICENSE` |
| engines | `node: ^22.19.0 \|\| >=24.0.0` |
| peerDependencies | `@deepseek-ai/cordis ^4.0.2`、`@deepseek-ai/dsh-credentials ^0.1.5-rc.1`、`@deepseek-ai/dsh-session ^0.1.5-rc.1`、`@deepseek-ai/schemastery ^3.18.2` |
| dependencies | `nodemailer ^7.0.13` |
| dsh.bundle.patch | `./cordis.patch.yml` — 存在 |

---

## 7. Supply chain

### `npm audit --omit=dev`

exit code 1，报告 **1 个 high severity vulnerability** 集合（`nodemailer <=9.1.0`），覆盖 10 条 advisory；
已安装版本 `nodemailer@7.0.13`。修复建议为 `nodemailer@10.0.9`（breaking change）。

### 可达性分析（非仅报告数量）

插件的全部 nodemailer 暴露面只有一处：`src/transport.ts`。它向 `createTransport` 传入的键恰为
`host, port, secure, auth:{user,pass}`，向 `sendMail` 传入的字段恰为 `from, to, subject, text`。逐条
advisory 对应的选项/API 均未被提供：

| advisory 关注点 | 插件是否提供 | 裁定 |
| --- | --- | --- |
| `envelope.size` | 否，`sendMail` 无 `envelope` | UNREACHABLE |
| transport `name`（EHLO/HELO 注入） | 否，`createTransport` 无 `name` | UNREACHABLE |
| `list`（List-* 头注释注入） | 否，无 `list` 亦无 `headers` | UNREACHABLE |
| `jsonTransport` 绕过文件/URL 访问限制 | 否，恒定构造 SMTP transport | UNREACHABLE |
| OAuth2 token fetch 的 TLS 校验 | 否，`auth` 仅 `{user,pass}`，无 `type: 'OAUTH2'` | UNREACHABLE |
| 消息级 `raw`（任意文件读 / SSRF） | 否，无 `raw` | UNREACHABLE |
| 旧签名 `resolveContent()` | 否，插件不调用该方法 | UNREACHABLE |
| IDN/Punycode 白名单绕过 | 不适用，插件不设收件域白名单，域直接取自运维配置 | UNREACHABLE |
| addressparser 二次复杂度 DoS | 否，输入恒为单个经 `ADDRESS_PATTERN` 校验的地址 | UNREACHABLE |
| RFC 5322 注释误解析导致域绕过 | 否，同上 | UNREACHABLE |

`from`/`to` 来自运维配置，逐元素通过 `/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/` 校验并在失败时拒绝挂载；
`subject` 的全部非字面量成分经 `sanitizeLine` 折叠为单行（`[\r\n\u2028\u2029\u0000-\u001f\u007f]+ → ' '`），
因此模型输出无法进入头部。结论：**无可达的 high/critical**，不构成 RC blocker。

证据边界：未取得各 advisory 的 upstream patch diff，裁定依据是插件调用路径与已安装 7.0.13 的实现，
而非补丁文本比对。

### `npm ls --omit=dev`

```text
dsh-mail-notify@0.1.0 E:\Projects\DSHarness\dsh-mail-notify
`-- nodemailer@7.0.13
```

直接运行时依赖 1 个（`nodemailer`），传递依赖 0 个。与预期一致。

---

## 8. Fresh install

在临时目录中执行 `npm install <tarball>`（不走仓库源码），结果：

| 项 | 结果 |
| --- | --- |
| install | 成功 — `added 17 packages`（含 peer 依赖与 `nodemailer`） |
| entry import | 成功 — `name: dsh-mail-notify`、`inject: []`、`apply: function`、`Config: function` |
| types | 存在 — `lib/types/index.d.ts` |
| cordis.patch.yml | 存在，且内容为 inert（`enabled: false`） |
| relative imports | 27 条，全部在归档内解析 — 0 条 unresolved |
| 依赖仓库源码 | 否 — 归档独立可装载 |

另在**纯解包、无 `node_modules`** 的条件下复核：18 个编译模块、27 条相对导入全部解析；
`lib/index.js` 现确实引用 `./mailer.js`（修复后），因此唯一未安装的外部依赖为 `nodemailer`，与
`package.json` 声明一致。临时目录已全部清理。

---

## 9. DSH install / uninstall

在 disposable profile（`mailnotify-probe3`，由 shipped `headless` 模板生成）上完成 round-trip；
用户的日常 `web` profile 未被安装或卸载任何东西。

| 步 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `dsh plugin --profile mailnotify-probe3 add ./dsh-mail-notify-0.1.0.tgz` | exit 0；`dsh.profile.bundles` 追加 `dsh-mail-notify` |
| 2 | `dsh plugin --profile mailnotify-probe3 list` | `dsh-mail-notify@0.1.0`，1 package |
| 3 | `dsh --profile mailnotify-probe3 --dump-config` | 行出现：`- id: dsh-mail-notify / name: dsh-mail-notify / config: enabled: true` |
| 4 | 装载与 E2E | `plugin.ready` 且真实 SMTP 投递成功（§5） |
| 5 | `dsh plugin --profile mailnotify-probe3 remove dsh-mail-notify` | exit 0；bundles 恢复为 base + headless |
| 6 | 卸载后 | `node_modules` junction 已删除；`$DSH_HOME/storages/dsh-mail-notify` 不存在（无持久状态） |
| 7 | 卸载后 profile 仍可启动 | 真实 boot exit 0，回复 `probe-ok` |
| 8 | 残留 listener | 无 — profile patch 中针对该 id 的行在包移除后只剩一条 `patch: entry "dsh-mail-notify" not found` 提示，属预期；随 profile 一并删除 |

三个 disposable probe profile 均已删除，`$DSH_HOME/profiles` 恢复为 `web` 与 `web.backup-*`。

### Peers

`pnpm peers check` 报告 4 条 `missing peer`（`@deepseek-ai/cordis`、`dsh-credentials`、`dsh-session`、
`schemastery`），exit 1。裁定为 **pnpm 静态 peer warning，而非真实不兼容**：同一 profile 真实启动后
`plugin.ready` 成功，四个 peer 均由宿主 runtime 解析（启动失败或服务缺失会以 `plugin.config-invalid`
或 `credential-missing` 显式暴露）。未为消除 warning 向 profile 安装第二套 Cordis/DSH runtime。

---

## 10. Security

| 断言 | 结果 |
| --- | --- |
| 无 Secret 进入仓库 | 确认 — 61 个跟踪文件、76 个归档成员、本阶段全部日志与 Git 全历史 blobs 中，真实授权码出现 0 次 |
| 无 credential value 进入日志 | 确认 — 插件只记录引用名与 `describe()` 的 `configured`/`source`/`writable` |
| 无 reasoning | 确认 — 抽取层按类型排除；candidate 不含文本字段 |
| 无 tool arguments / tool results | 确认 — `SEC-05b`、`PRIV-02/03` |
| 无 user prompt（默认） | 确认 — `includeUserPrompt: false`，`PRIV-04` |
| TLS 校验开启 | 确认 — transport 选项恒为 `{host, port, secure, user, password}`，全仓不存在 `rejectUnauthorized`、`NODE_TLS_REJECT_UNAUTHORIZED`；本阶段未修改 TLS 策略 |
| 未把 Secret 写入任何文件 | 确认 — 授权码仅存在于 DSH managed store（`$DSH_HOME/.credentials.yaml`，仓库外、不进 Git），迁移过程的中间备份已在同一轮内删除 |
| 未把 Secret 输出到终端 | 确认 — 迁移与全部诊断均只输出长度与布尔值 |

扫描同时覆盖 `smtp://`/`smtps://` 内嵌密码、`Bearer`、`AUTH PLAIN`/`AUTH LOGIN`、`Authorization:`、
`-----BEGIN` 私钥头。

---

## 11. Defects

本阶段发现并修复四个缺陷（D-1…D-4），其中两个（D-2、D-3）出在装配层，一个（D-4）在修复 D-2 后才
真正暴露。全部按 `reproduce → failing test → minimal fix → full verify → pack → runtime re-test` 执行。

### D-1（安全，配置层）SMTP 授权码被写入 Git 跟踪文件，且引用字段被填成密码本身

**现象。** 进入本阶段时，仓库根 `cordis.patch.yml` 第 14 行 `smtpPasswordCredential` 存放的是 163
客户端授权码原文，而非引用名。该字段语义是「credential reference name」，README 与 `docs/CONFIG_SPEC.md`
均明确禁止把密码写入此文件。

**影响。** 两层后果：其一，真实 Secret 位于**纳入 Git 跟踪**的文件中，`git status` 已显示为已修改，
一旦按常规提交即会推送到 GitHub；其二，该值恰好满足引用名语法
`^[A-Za-z_][A-Za-z0-9_]*$`（16 字符字母数字），因此配置校验通过，插件会去查找名为「<授权码>」的
credential —— 该引用不存在，dry-run 与任何发送都会以 `credential not configured` 失败。即配置既泄
露了 Secret，又根本无法工作。

**根因。** 配置写在了错误的层：仓库的 `cordis.patch.yml` 是包自带的 bundle 默认 patch，其文件头明
确要求保持 inert，真实配置应放在 profile 自己的 patch 文件；而 profile 中对应的行是 Phase 3 注入器
残留的 `disabled: true`，无 `config:`，因此插件既未被装载、也读不到配置。

**修复。** 把授权码迁移到 DSH managed credential store 的 `refs` 段
（`DSH_MAIL_SMTP_PASSWORD`），把仓库文件的该字段改为引用名，随后把完整真实配置移入
`$DSH_HOME/profiles/web/cordis.patch.yml`，并将仓库文件恢复为已提交的 inert 默认（`enabled: false`）。
迁移全程未向 stdout 输出该值；中间备份在删除后确认不存在。

**验证。** 迁移后 `refs` 段含 5 个引用且无重复；仓库文件 `git diff` 显示相对 HEAD 为空（与已提交
内容一致）；dry-run 由 exit 2（`no config: block`）转为 exit 0 且 `credential is configured
(source=file, writable=true)`。

### D-2（功能性，阻断级）生产装配从不使用 mailer，默认 sink 是无 I/O 的 debug sink

**现象。** `src/index.ts` 在选择 sink 时对 `internals?.sink === undefined` 取反，导致**未注入测试
sink 时选中的是 debug sink**；`createMailer` 在生产代码中没有任何调用方。debug sink 直接返回
`{ ok: true }` 而不做任何 I/O。

**影响。** 生产环境中插件的整条链路（事件 → adapter → turn state → candidate → policy → queue →
outcome）照常运行并报告成功，但**从不发送任何邮件**。更危险的是它使「邮件路径未接通」与「邮件已
投递」在日志上无法区分：`notification.outcome {"ok":true}` 两种情况下完全一致。这也直接解释了本轮
第一次 E2E 为何「成功」——当时的 E2E 证据实际来自 debug sink。

**根因。** 装配条件写反，与 `docs/ARCHITECTURE.md` §`index.ts`:117 规定的装配顺序
（… → 构造 mailer → 构造 handler → 注册监听器）以及 §19「生产路径省略 `internals`，集成测试注入
sink」相矛盾。

**修复。** sink 选择改为：注入的 `sink` 优先 → 显式 `debugSink: true` 时用 debug sink → 否则构造
`createMailer`。同时为 `ApplyInternals` 增加 `transportFactory` seam（使套件在保持离线的同时仍走真实
render/credential/classify 路径）与 `debugSink` 显式开关。

**验证。** 新增回归测试断言默认 sink **不是** debug sink，且一次真实投递确实解析了 credential 并把
配置的收件人、渲染后的 subject、visible text 交给 transport。此测试在修复前失败。既有
「debug sink records safe summaries…」测试改为显式请求 debug sink。修复后完整套件 276 pass。

### D-3（功能性）`maxBodyChars` 只被度量、从未施加

**现象。** `src/event-handler.ts` 用 `Array.from(candidate.visibleText).length > maxBodyChars` 计算
`truncated`，但 `renderMail` 把 `candidate.visibleText` 原文整体写入正文，
`truncateVisibleText` 在这条路径上从未被调用。

**影响。** 邮件正文不受 `maxBodyChars` 约束：超长模型输出会被整体邮寄，可能触发 SMTP 尺寸上限而失
败；而 footer 仍会打印「输出已截断」标记，形成「声称已截断、实际未截断」的不一致。

**修复。** 在 `src/mailer.ts` 的发送路径上调用一次 `truncateVisibleText`，用其自身结果同时决定正文
与 `truncated` 标记。`MailJob.truncated` 保持其既有语义（enqueue 时的判定）。

**验证。** 新增回归测试：`maxBodyChars: 1000` 下 5000 字符的回答必须恰好保留 1000 字符、出现截断标
记、且完整回答不得到达 transport。此测试在修复前失败。

### D-4（功能性，D-2 修复后暴露）credential 服务在 `apply()` 时被提前读取，导致真实 profile 中解析失败

**现象。** D-2 修复后重跑 E2E，链路首次真正走到凭据解析，却报
`credential-missing`：`this profile mounts no Credential service …`——而该 profile 的
`--dump-config` 明确包含 `- id: credentials / name: @deepseek-ai/dsh-credentials-local`。

**根因。** `createMailer` 在构造时（即 `apply()` 期间）一次性读取
`getCredentialProvider(ctx)`。Cordis 的服务在插件 `apply` 时可能尚未发布：对 probe 启动上下文逐
fiber 取证显示，`dsh-mail-notify`、`agent-instructions`、`SessionTitleService`、`GoalService`、
`TokenMeter` 等在该时刻 `ctx.get('credentials') === undefined`，而 `SessionProjectionCache` 与
`scope` 拿到的是正常对象。因此这不是「未装载」，而是**激活顺序导致的过早读取**；一次过早的
`undefined` 会让此后每一次发送都永久失败。

**修复。** provider 改为在**每次发送尝试内**查找：新增
`MailerOptions.credentialProviderResolver`，生产装配传入 `() => getCredentialProvider(ctx)`；测试绑
定 provider 的既有路径不变。这与 D010「凭据在每次操作内解析、从不缓存」的契约一致。

**验证。** 新增回归测试：构造后服务尚不存在时发送得到 `credential-missing`；随后服务「发布」，下一
次发送必须成功，且每次尝试都重新查找。此测试在修复前失败。修复后 E2E 首次成功投递（§5）。

### 附注

- 三项 src 修改均为最小修复，未做重构或「顺便优化」。
- 修复后 `npm pack` 产物与 profile 中实际安装的 `lib/index.js` 做过 SHA256 比对：需
  `remove` + `add` 才能强制 pnpm 更新 `file:` 依赖，仅 `add` 会因缓存报 `Already up to date` 而保留
  旧构建。该注意点已在本轮规避，并作为操作经验记录于此。

---

## 12. Release Candidate Decision

```text
RC READY
```

判据：合成 SMTP smoke 与真实 Agent → Email E2E 均获 SMTP 服务器接受；四个缺陷修复后完整套件
276 pass / 0 fail；打包产物通过白名单审计且独立可安装；无可达的 high/critical runtime 漏洞；仓库、
归档、日志与 Git 历史中无 Secret。

不构成本轮动作的保留项：`nodemailer` 处于 high advisory 区间（可达性已逐条排除，升级到 10.x 为
breaking change，留待后续评估）；Phase 3 记录的「去重不跨进程重启」限制仍在。

---

## 13. Git synchronization

| 项 | 值 |
| --- | --- |
| starting SHA | `99bef3220eada157f67d588db0fc5b94c8bdbe2a` |
| fix commit | `680e33b` — `fix: deliver mail from production and resolve the credential per attempt` |
| docs commit | `6af19d5` — `docs: complete phase 4 release candidate audit` |
| final local SHA | `6af19d51afb6d41530c4d43f5bda8c71dcf751d6` |
| remote SHA | `6af19d51afb6d41530c4d43f5bda8c71dcf751d6`（`git ls-remote origin refs/heads/main`） |
| sync status | 一致 — `git rev-list --left-right --count HEAD...origin/main` 为 `0  0` |

提交内容：四个缺陷的修复与其回归测试、`PHASE4_REPORT.md`、`README.md` 状态与文档表更新、
`00_MASTER.md` roadmap 更新。`cordis.patch.yml` 未纳入提交（已恢复为 HEAD 内容），归档产物 `.tgz`
按既有 `.gitignore` 规则不入库。

推送后重新读取远端 `README.md` 与 `PHASE4_REPORT.md`：UTF-8 正常、无 Phase 3.1 编码回归、无 Secret、
状态正确；`git diff origin/main HEAD` 为空，即远端树与本地产物逐一相同。

本阶段未执行：`npm publish`、`git tag`、`git push --tags`、GitHub Release。正式发布留待后续独立阶段。
