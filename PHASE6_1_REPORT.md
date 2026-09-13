# PHASE 6.1 — Nodemailer 10 Security Uplift + v0.1.1 RC Revalidation

```text
Status: PASS — v0.1.1 RELEASE READY
```

本阶段不新增功能，也不重新设计任何已冻结语义。唯一实质变更是把已停止安全维护的
Nodemailer 7.x 升级到受支持的 10.x，并在新依赖下重新完成 v0.1.1 的全部发布前验证。
发布动作（`npm publish`、`git tag v0.1.1`、`git push --tags`、GitHub Release）均未执行。

---

## 1. Baseline

执行开始时（本阶段唯一的运行时变更之前）：

```text
branch                      main
HEAD                        c636d0e86f699898629b1e191f21f2c819c3347d
ahead/behind vs origin/main 0	0
working tree                clean
```

`v0.1.0` 注释 tag 未移动、未重建，其对象与目标 commit 与本阶段开始前的记录逐字相同：

```text
tag object      0d113e70406330c373eb0a1fef6cc8e78a837c30
target commit   02191a43894f7cf9323641a1d117ae838c4a0c88
```

Phase 6 基线测试为 327 pass / 0 fail / 0 skipped；本阶段结束时为 336（见 §9）。

---

## 2. Dependency finding

升级前的 `package.json`：

```json
"dependencies":    { "nodemailer": "^7.0.13" }
"devDependencies": { "@types/nodemailer": "^7.0.12" }
```

安装版本 `nodemailer@7.0.13`。`npm audit --omit=dev` 在该版本上报告 **10 条 advisory**，
其中 1 条 High：

| GHSA | severity | affected range |
| --- | --- | --- |
| GHSA-2x7j-588g-ccc2 | **high** | `<9.1.0` |
| GHSA-c7w3-x93f-qmm8 | low | `<8.0.4` |
| GHSA-vvjj-xcjg-gr5g | moderate | `<=8.0.4` |
| GHSA-268h-hp4c-crq3 | moderate | `<=8.0.8` |
| GHSA-wqvq-jvpq-h66f | moderate | `<=9.0.x` |
| GHSA-r7g4-qg5f-qqm2 | moderate | `<9.1.0` |
| GHSA-p6gq-j5cr-w38f | moderate | `<9.1.0` |
| GHSA-8m3c-c648-2xjj | moderate | `<9.1.0` |
| GHSA-wmmp-3585-3rmp | moderate | `<9.1.0` |
| GHSA-cc9r-2j5m-2m83 | moderate | `<9.1.0` |

`GHSA-2x7j-588g-ccc2`（addressparser 的 O(n²) 解析，单个构造地址串可阻塞事件循环）是本阶段
的触发项。Nodemailer 的 Security Policy 明确只有 `10.x` 受支持、`<10.0` 不受支持，因此
「该 advisory 在当前配置下不可达」既不是继续发布 7.x 的理由，也不是推迟升级的理由。

---

## 3. Nodemailer old / new

以执行时 registry 的真实 metadata 为准，未使用任何来自记忆的版本号：

```text
$ npm view nodemailer version          -> 10.0.9
$ npm view nodemailer engines          -> { node: '>=20.0.0' }
$ npm view nodemailer types            -> ./dist/cjs/nodemailer.d.ts
$ npm view nodemailer dist-tags --json -> { "beta": "2.4.0-beta.0", "latest": "10.0.9" }
$ npm view nodemailer dependencies     -> （无输出：零运行时依赖）
$ npm view nodemailer license          -> MIT-0
```

| 项 | old | new |
| --- | --- | --- |
| version | `7.0.13` | `10.0.9` |
| declared range | `^7.0.13` | `^10.0.9` |
| engines | `>=6.0.0` | `>=20.0.0` |
| types | 外部 `@types/nodemailer` | 包内自带 `dist/cjs/nodemailer.d.ts` |
| license | `MIT-0` | `MIT-0`（未变） |
| runtime dependencies | 0 | 0（未变） |

**range 选择理由。** `^10.0.9` 把 major 固定在 10：caret 在 10 上不允许跨到 11，而 major
正是 Nodemailer 做破坏性变更的位置；同时它允许 10.x 内的安全补丁与 minor 自动进入，不需要
每次补丁都改 manifest。下界写作 `10.0.9` 而不是 `10.0.0`，使「全新安装在无 lockfile 时至少
得到当前已修补版本」成为 range 本身的性质。`engines` 下界由 `>=20.0.0` 兜住；本项目的
`engines` 为 `^22.19.0 || >=24.0.0`，是其严格子集，实际运行 `v24.13.0`。

---

## 4. Security advisory analysis

**GHSA-2x7j-588g-ccc2 的可达性。** 该缺陷位于 Nodemailer 的地址解析器，触发条件是单个字段
承载一个逗号分隔的地址列表。本插件在任何路径上都不产生这种输入，原因是配置层的地址校验
（`src/config.ts` 的 `ADDRESS_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/`）在地址进入插件
之前就拒绝 `,`、`;` 与空白；`from` 与 `to` 均为本地可信配置，模型输出不进入任何 recipient
地址字段。因此该路径在本插件中不可达。

「不可达」是升级的必要性之外的事实，而不是替代升级的理由。升级后该 advisory 连同其余 9 条
一并消失（§5），可达性问题不再需要论证。

**历史 advisory 路径的不可达性维持不变。** 传输层仍只构造 `host` / `port` / `secure` /
`auth.user` / `auth.pass`，消息仍只包含 `from` / `to` / `subject` / `text`。`attachments`、
`html`、`raw`、`envelope`、`alternatives`、`icalEvent`、`dkim`、`headers` 均不出现，也不存在
可以开启它们的配置项。因此 file content resolution、URL content resolution、`raw` option、
`jsonTransport` 四条历史 advisory 路径继续不可达。§8 的 TRN-01/02 以此作为断言而非描述。

---

## 5. npm audit

```text
$ npm audit --omit=dev     -> found 0 vulnerabilities
$ npm audit                -> found 0 vulnerabilities
```

10 条 advisory 全部消失，`0 high / 0 critical`。目标达成，无需逐项记录残留项。

---

## 6. Migration impact

升级前读取了 Nodemailer 10 的发行说明、包内 metadata 与 TypeScript declaration，只核查本插件
实际使用的那一条 API：

```ts
nodemailer.createTransport({ host, port, secure, auth: { user, pass } })
transporter.sendMail({ from, to, subject, text })
```

`10.0.0` 的 breaking change 只有一条：要求 Node.js 20 或更新，并移除 Node.js 6 语法兼容检查
与 `.npmignore`。该包的 API 面没有破坏性变更，`SMTPTransportOptions extends
SMTPConnectionOptions` 仍提供 `host` / `port` / `secure`，`Transporter<T> = Mail<T>` 仍提供
`sendMail`。升级前的 TypeScript 声明布局由 `typesVersions` 保留，`@types/nodemailer` 的布局
被显式兼容（`keep the @types/nodemailer type layout working`）。

`src/transport.ts` 是本包唯一 import Nodemailer 的模块，因此迁移面为**一个文件、一条调用、
零行改动**。未引入 pool、OAuth2、proxy、DKIM、attachments、HTML、raw message 或
jsonTransport。

---

## 7. Type migration

```text
$ npm run typecheck   -> exit 0
```

`Transporter`、`createTransport`、`sendMail` 均无类型错误，因此**未修改任何源码**。`any`、
`as any`、`@ts-ignore`、`@ts-expect-error` 一概未使用。

`@types/nodemailer` 已删除。删除依据不是「Nodemailer 10 自带声明」这一条断言，而是
typecheck 在删除后仍为 exit 0；文档同时明确指出，把两套声明装在一起会产生冲突声明，因此
不存在「两者并存」的中间状态。

`moduleResolution` 为 `nodenext`，`exports` 中只有 `import` / `require` 条件而无 `types`
条件，顶层 `types` 字段（`./dist/cjs/nodemailer.d.ts`）承担解析，实测通过。

---

## 8. Transport invariant

`src/transport.ts` 未改一行。新增 `tests/unit/transport.test.ts`（6 项）在此之前该文件没有任何
直接测试——既有 SEC-06 只断言 mailer 交给 transport factory 的参数，而 factory 在测试中被
stub 替换，真实构造路径因此从未被断言。新测试用 fake `Transporter` 替换
`nodemailer.createTransport` 的返回值，其余全部走生产代码。

| 用例 | 断言 |
| --- | --- |
| TRN-01 | 传给 `createTransport` 的对象**精确等于** `{host, port, secure, auth:{user, pass}}`（深比较，非子集比较，第五个键会被判失败） |
| TRN-02 | 传给 `sendMail` 的对象精确等于 `{from, to, subject, text}`；八个禁止字段逐一断言不存在 |
| TRN-03 | recipient 数组是被复制的，事后修改原数组不影响已交付内容 |
| TRN-04 | 返回的 `MailTransport` 只暴露 `sendMail`；底层 transporter 不可达 |
| TRN-05 | 选项形状中不存在 `tls`，也不存在 `rejectUnauthorized` |
| TRN-06 | `src/**` 中只有 `transport.ts` import Nodemailer（依赖爆炸半径的静态证据） |

不提供关闭 TLS 校验的配置，也没有「仅用于调试」的开关：`rejectUnauthorized: false` 在包内
任何位置都不出现。

---

## 9. Tests

```text
$ npm run check:text   -> PASS: every file is strict UTF-8, BOM-free, and free of known mojibake（70 files）
$ npm run typecheck    -> exit 0
$ npm test             -> 336 pass / 0 fail / 0 skipped / 0 cancelled / 0 todo
$ npm run build        -> exit 0
```

相对 Phase 6 的 327 项净增 9 项，无删除、无 skip、无弱化。

| 组 | 用例 | 层次 |
| --- | --- | --- |
| 地址解析 advisory 回归 | ADDR-01（12 种列表形态作为单个 `from` 与单个 `to` entry 一律被拒且不武装插件）、ADDR-02（数组形式的多收件人仍可用） | L1 |
| 传输不变量 | TRN-01…TRN-06（新建 `tests/unit/transport.test.ts`，6 项） | L1 |
| 打包契约 | PKG-01b（打包后的 manifest 有且仅有 `nodemailer` 一个运行时依赖，range 不跨 major，`@types/nodemailer` 不在 devDependencies） | L6 |
| 既有 | 327 项全部继续 PASS | L1–L6 |

**ADDR-01 是 defense-in-depth，不是 advisory 的复现。** 它证明的是配置层不接受
`a@example.com,b@example.com`、`a@example.com;b@example.com`、以及以空白分隔的地址列表作为
**一个** entry；它不构造任何大型 DoS payload，也不调用 Nodemailer 的解析器。升级前该断言
证明路径不可达，升级后它防止回归。

Phase 6 冻结的遥测语义未被改动，相关回归全部继续 PASS：Turn usage aggregate、retry 处理、
assistant/attempt、duplicate/replay、`usageComplete`、`schemaVersion 2`、duration 15000 ms
fixture、mid-turn duration 为 `null`、以及隐私负向断言。`src/telemetry.ts`、D017 与五个
usage 字段的语义在本阶段**零改动**。

---

## 10. Pack

```text
$ npm pack          -> dsh-mail-notify-0.1.1.tgz
$ npm run pack:check -> PASS: required entries present, no forbidden entry found
```

| 项 | Phase 6 | Phase 6.1 |
| --- | --- | --- |
| 文件名 | `dsh-mail-notify-0.1.1.tgz` | `dsh-mail-notify-0.1.1.tgz`（未变） |
| sha256 | `f8677338…` | `5b6328d878178b79ff3e83cde1e1596862cea71a076e32bc4ef220821b6f9f9a` |
| size | — | 90 405 bytes |
| entry count | — | 80 |
| compiled module count | — | 19 个 `.js` + 19 个 `.d.ts` |
| 解包后字节数 | — | 341 774 |

哈希与 Phase 6 不同符合预期：编译产物本身未变，但本轮重新构建过，且 `package.json` 增加了
`scan:secrets` 脚本。Phase 6 的 `f8677338…` 不被沿用为本阶段哈希。

连续两次 `npm pack` 产生逐字节相同的归档（同一 sha256），因此上表哈希可用于核对同一构建。
该哈希随任何源文件变更而改变，它不是发布用的不可变标识——发布标识由后续阶段的 tag 承担。

**投递验证与最终产物。** §11–§14 的隔离安装、受控 Turn 与投递先在功能等价的构建上完成；随后
§14a 在**上表这一份归档**上重做了全新安装、受控 Turn 与投递，两者结论一致。

---

## 11. Fresh install

从本阶段生成的 tarball 建立全新的隔离环境，不借用 repository 的 `node_modules`（隔离
`DSH_HOME` 下的 profile 目录是空目录，全部依赖由 `dsh plugin add` 现装）：

```text
$ dsh plugin --profile probe6 add ./dsh-mail-notify-0.1.1.tgz
✓ Lockfile passes supply-chain policies
Packages: +2
Done in 2.6s using pnpm v11.7.0
```

| 检查 | 结果 |
| --- | --- |
| import 成功 | 通过（冷启动装载，无 loader error） |
| Nodemailer 10 解析 | `nodemailer@10.0.9`，`node_modules/nodemailer` 存在 |
| `@types/nodemailer` | 不存在（`@types/` 目录本身不存在） |
| 依赖数量 | 恰好 2 个包：`dsh-mail-notify` + `nodemailer`（无传递依赖） |
| schemaVersion 2 | `candidate.produced` 输出 `"schemaVersion":2` |
| telemetry fixture | PASS（§12、§13） |

lockfile 中该插件的 snapshot 只有一条依赖边：`dsh-mail-notify -> nodemailer: 10.0.9`。

---

## 12. DSH rc.1

在全新隔离 `DSH_HOME`（`E:\Projects\DSHarness\.tmp-phase61\home`）与隔离 profile（`probe6`）中
安装本阶段 tarball，冷启动装载，执行一个受控多 step Turn（三条 pwsh 命令，每条一次模型调用），
卸载前完成投递。DSH 版本 `0.1.5-rc.1`。**用户的稳定 web profile 未被修改。**

rc.1 真实 163 投递（`session-accb9db9-5319-48dd-87c6-6d947524c7fe`，turn 1）：

```text
plugin.ready       {"smtpHost":"smtp.163.com","smtpPort":465,"smtpSecure":true,...}
candidate.produced {"schemaVersion":2,"status":"completed-clean","durationMs":16458,
                    "telemetryComplete":true,"usageSampleCount":4,"usageMissingCount":0,
                    "usageUnobservableRetries":0,"usageComplete":true,"steps":4}
notification.enqueued {"queueDepth":0,"truncated":false}
mail.sent          {"bodyChars":23,"recipientCount":1}
notification.outcome {"attempts":1,"ok":true,"delaysMs":[]}
```

rc.1 同时通过回环 SMTP 对端（`127.0.0.1:2526`，不出网）取得逐字节传输证据：

```text
AUTH PLAIN  user=probe@example.com  passwordLength=16  passwordMatches=true
envelope    from=<probe@example.com>  to=<phase6-recipient@example.invalid>
```

解码后的正文（`session-b79cdc02-39d7-484a-a26e-545948ed0145`，`durationMs=14753`）：

```text
Status:    Task completed (completed-clean)
Session:   session-b79cdc02-39d7-484a-a26e-545948ed0145
Turn:      1
Duration:  14.8 s
Provider:  deepseek-official
Model:     deepseek-flash
Workspace: E:\Projects\DSHarness\.tmp-phase61\ws
Tool errors reported by DSH: 0
Telemetry complete: yes
Token usage (turn aggregate): inputTokens=1354, outputTokens=400, cacheReadTokens=31360, cacheWriteTokens=not reported, reasoningTokens=192
Token telemetry complete: yes (4 model calls observed, each reporting usage)
```

---

## 13. DSH rc.2

在独立安装（`E:\Projects\DSHarness\.tmp-rc2-mailnotify`，`@deepseek-ai/dsh@0.1.5-rc.2`）与独立
隔离 `DSH_HOME`（`E:\Projects\DSHarness\.tmp-phase61\home-rc2`）下执行同一组验证。rc.2 的
`DSH_HOME` 与 install root 均与 rc.1 分离，用户稳定的 rc.1 web profile 未被触碰。

| 检查 | rc.1 | rc.2 |
| --- | --- | --- |
| 同一个 tgz 隔离安装 | 成功（`+2` packages） | 成功（`+2` packages） |
| Nodemailer 解析 | `10.0.9` | `10.0.9` |
| `@types/nodemailer` | 不存在 | 不存在 |
| 冷启动装载、无 loader error | 通过 | 通过 |
| 受控多 step Turn | 通过 | 通过 |
| `schemaVersion` | 2 | 2 |
| `usageSampleCount` / `usageComplete` | 4 / true | 4 / true |
| `mail.sent` | 通过 | 通过 |
| `notification.outcome` | `attempts:1, ok:true` | `attempts:1, ok:true` |
| 该次 `mail.sent` 的真实目标 | `smtp.163.com:465`（真实投递，`session-accb9db9-…`，`durationMs=16458`） | `127.0.0.1:2527`（回环对端，`session-34f87141-…`，`durationMs=17838`） |
| 真实 163 投递（rc.2 另跑一次） | — | `session-29090fd3-…`，`durationMs=13926` |
| 回环逐字节捕获 | `session-b79cdc02-…`，`durationMs=14753` | `session-34f87141-…`，`durationMs=17838` |

rc.2 回环捕获的正文：

```text
Status:    Task completed (completed-clean)
Session:   session-34f87141-8d9f-47f7-b4e3-60c21d502001
Turn:      1
Duration:  17.8 s
Provider:  deepseek-official
Model:     deepseek-flash
Workspace: E:\Projects\DSHarness\.tmp-phase61\ws
Tool errors reported by DSH: 0
Telemetry complete: yes
Token usage (turn aggregate): inputTokens=1299, outputTokens=906, cacheReadTokens=32512, cacheWriteTokens=not reported, reasoningTokens=683
Token telemetry complete: yes (4 model calls observed, each reporting usage)

v24.13.0
The string is missing the terminator: ". (ParserError, exit 1)
phase61-rc2-loop
```

该 Turn 的第 2 条命令在 pwsh 侧解析失败并以非零码退出，模型据此调整后完成——这是 rc.2 侧
**有意保留的真实失败路径**：`explicitToolErrorCount` 仍为 0（DSH 未将其记为工具错误），
`status` 仍为 `completed-clean`，Turn 正常结束并投递。它顺带证明失败的工具调用不会污染
遥测聚合：4 次模型调用全部上报 usage，聚合完整。

`peerDependencies` 保持 `^0.1.5-rc.1` 不变。本阶段未发现任何需要修改该范围的事实。

---

## 13a. 最终产物复验

§11–§13 的隔离安装、受控 Turn 与投递完成后，`package.json` 增加了 `scan:secrets` 脚本，因此
重新打包。为使「被验证的产物」与「被记录的产物」是同一份，在 §10 上表那一份归档上重做了
全新安装（先 `remove` 再 `add`，确认依赖与 bundles 条目均被移除后重装）：

| 检查 | rc.1 | rc.2 |
| --- | --- | --- |
| 卸载后无残留 | 依赖与 bundles 条目均移除，`node_modules` 中不再有该包 | 同 |
| 重装 | `+2` packages | `+2` packages |
| 安装后的 `scan:secrets` 脚本 | 存在（证明安装的是当前归档而非缓存副本） | 存在 |
| Nodemailer | `10.0.9` | `10.0.9` |
| `@types/nodemailer` | 不存在 | 不存在 |
| 受控多 step Turn | `session-b82df89c-e2d0-40d3-9de6-d990ba2b782d`，`durationMs=14488` | `session-f71977bb-0fd9-44a2-9d4a-69c2960289ef`，`durationMs=13022` |
| `schemaVersion` / `usageSampleCount` / `usageComplete` | 2 / 4 / true | 2 / 4 / true |
| 投递 | 真实 163：`mail.sent`，`attempts:1, ok:true` | 回环 `127.0.0.1:2528`：`mail.sent`，`attempts:1, ok:true` |

rc.2 最终回环捕获（同一条生产路径，只把连接目标换成本机，因此可逐字节检查）：

```text
AUTH PLAIN  user=probe@example.com  passwordLength=16  passwordMatches=true
envelope    from=<probe@example.com>  to=<phase6-recipient@example.invalid>

Status:    Task completed (completed-clean)
Session:   session-f71977bb-0fd9-44a2-9d4a-69c2960289ef
Turn:      1
Duration:  13.0 s
Telemetry complete: yes
Token usage (turn aggregate): inputTokens=1401, outputTokens=825, cacheReadTokens=32384, cacheWriteTokens=not reported, reasoningTokens=616
Token telemetry complete: yes (4 model calls observed, each reporting usage)

v24.13.0
42
phase61-rc2-final
```

卸载路径本身也因此得到复验：`dsh plugin remove` 之后 profile 的 `dependencies` 与
`dsh.profile.bundles` 都不再包含该插件，重装回到相同状态。

---

## 14. 163 SMTP E2E

使用既有 Credential Service（引用名 `DSH_MAIL_SMTP_PASSWORD`，值始终留在 DSH Credential
store）。密码未被打印、未被写入配置、未进入命令行、未写入测试、未写入本报告——§16 的扫描
覆盖全部五个凭据。

本阶段共投递 **3 封**真实邮件，均为插件生产路径
（`mailer.ts` → Credential 服务 → Nodemailer 10 → `smtp.163.com:465`，implicit TLS）：

| 收件人 | 触发 | 结果 |
| --- | --- | --- |
| `canghw2023@foxmail.com` | rc.1 受控 Turn（`overlay-163.yml`） | `mail.sent`，`attempts:1, ok:true` |
| `canghw2023@foxmail.com` | rc.2 受控 Turn（`overlay-163.yml`） | `mail.sent`，`attempts:1, ok:true` |
| `canghw2023@foxmail.com` | rc.1 最终产物复验（§13a） | `mail.sent`，`attempts:1, ok:true` |

`mail.sent` 由 `transporter.sendMail()` 正常 resolve 后才写入，因此它同时证明 TCP 连接、
implicit TLS 握手与证书校验（Nodemailer 默认开启，且本包没有任何关闭它的配置）、`AUTH`、
`MAIL FROM` / `RCPT TO` / `DATA` 全部被服务器接受。四次尝试（2 次真实 + 2 次回环）均为
`attempts:1`，无重试。

```text
SMTP accepted; mailbox observation external
```

本环境不可读取该邮箱，因此不对「收件箱中可见」作断言。

---

## 15. Telemetry SMTP regression

真实邮件与回环捕获的正文载有同一份候选，四项逐一确认：

| 项 | 证据 |
| --- | --- |
| Token usage (turn aggregate) | `inputTokens=1354, outputTokens=400, cacheReadTokens=31360, reasoningTokens=192`（rc.1 回环）；`inputTokens=1299, outputTokens=906, cacheReadTokens=32512, reasoningTokens=683`（rc.2 回环） |
| Token telemetry complete | `yes (4 model calls observed, each reporting usage)`，`usageSampleCount=4`、`usageMissingCount=0`、`usageComplete=true` |
| Duration | `candidate.durationMs` 与正文 `Duration:` 同一来源；`14753` / `17838` / `16458` / `13926` 四个 Turn 均非 `null`、非 `0` |
| schema-v2 candidate path | 四次运行全部输出 `"schemaVersion":2` |
| final visible output | 正文尾部即该 Turn 的最后可见输出（`v24.13.0` / `42` / `phase61-rc1-loop` 等） |

负向确认（在同一份捕获正文上检查）：**不含** reasoning 文本、工具参数、工具结果正文与任何
凭据。正文只含渲染后的 metadata 块、最终可见输出与 footer；`includeUserPrompt` 为 `false`，
用户提示词未出现。`cacheWriteTokens=not reported` 而非 `0`，与 D017 的「未报告的 bucket 不
补零」一致。

---

## 16. Retry / failure classification

未用错误密码试探真实服务器。分类策略由 stub/loopback 路径继续验证，本阶段**未改动
`src/retry.ts` 与 `src/mailer.ts` 的任何一行**，因此策略与 Phase 6 相同：

| 类别 | 用例 |
| --- | --- |
| transient retry | `RET-01`（ETIMEDOUT）、`RET-02`（ECONNRESET）、`RET-03`（EAI_AGAIN）、`RET-04`（SMTP 4xx） |
| permanent failure | `RET-05`（EAUTH / 535）、`RET-05b`（认证语义的 4xx）、`RET-06`（EENVELOPE / 550）、`RET-07`（任何 5xx）、`RET-07b`（ECONNREFUSED）、`RET-08`（未识别 → permanent） |
| auth classification | `RET-05`、`RET-05b`、`SEC-04b`（认证失败只保留分类，不保留服务器原文） |
| 预算与退避 | `RET-09`…`RET-10b`（总尝试数 = `retryAttempts + 1`；退避 `base × 3^(n−1)`，上限 30 s） |

全部继续 PASS。依赖 major 升级没有改变 retry policy。

---

## 17. Secret scan

三个面分别扫描，凭据值只用于内存比较，从不打印、从不作为参数传递。

```text
$ node secret-scan.mjs .                # working tree + full git history
scanning DSH_MAIL_SMTP_PASSWORD: length=16 sha256_8=20ebc6de
scanning TAVILY_API_KEY:         length=57 sha256_8=178da371
scanning DEEPSEEK_API_KEY:       length=35 sha256_8=720ebce8
scanning COMMAND_GOAT_API_KEY:   length=92 sha256_8=62b11645
scanning COMMANDCODE_API_KEY:    length=92 sha256_8=62b11645
file cordis.patch.yml: tracked_now=true bytes=898 hits=0
working tree: 71 tracked files, 915709 bytes, hits=0
history: 205 distinct objects, 1896338 bytes, hits=0
SECRET SCAN: PASS

$ npm run scan:secrets                  # the shipping archive
archive: 80 entries, 340664 bytes, credential-value hits=0, shaped-literal hits=0
TARBALL SECRET SCAN: PASS
```

字节级比较覆盖 UTF-8 与 UTF-16LE 两种编码。tarball 扫描另外检查 PEM 私钥、SSH key blob、
赋值型 password 字面量、AWS access key id 与 `sk-` 形式的 API key 五种形状。

```text
0 credential values
0 private keys
0 SMTP App Password
```

新增 `scripts/scan-tarball-secrets.mjs`（不进入 `files` 白名单，因此不随包分发），并注册为
`npm run scan:secrets`。

---

## 18. License / package metadata

| 项 | 值 |
| --- | --- |
| 本包 license | `MIT`（未变） |
| Nodemailer license | `MIT-0`（7.x 亦为 MIT-0，**未变化**） |
| Nodemailer engines | `>=20.0.0`（原 `>=6.0.0`） |
| Nodemailer types | 包内自带 `dist/cjs/nodemailer.d.ts` |
| 运行时依赖数量 | 1（`nodemailer`），零传递依赖 |
| 开发依赖数量 | 6（删除 `@types/nodemailer` 后由 7 降至 6） |

Nodemailer 的 license 在本次 major 升级中未发生变化，因此**不需要**更新第三方依赖说明。
本项目也没有独立的第三方依赖说明文件——`LICENSE` 仅覆盖本包自身，而 `MIT-0` 比本包的
`MIT` 更宽松（不保留署名要求），不存在需要额外声明的分发义务。

`engines` 兼容性：Nodemailer 10 要求 `>=20.0.0`，本包要求 `^22.19.0 || >=24.0.0`，后者是前者
的严格子集，因此本包声明的每一个 Node 版本都能满足 Nodemailer 10 的要求。

---

## 19. Git

```text
starting SHA   c636d0e86f699898629b1e191f21f2c819c3347d
final local    a233c25（docs: record phase 6.1 dependency security review）
remote SHA     （见 §21，要求与 final SHA 相等）
v0.1.0 tag     0d113e70406330c373eb0a1fef6cc8e78a837c30 -> 02191a43894f7cf9323641a1d117ae838c4a0c88（未移动）
sync           ahead/behind = 0 0，working tree clean
```

三个提交分别承担依赖升级、验证测试与文档：

| 提交 | 主题 | 内容 |
| --- | --- | --- |
| `d93a267` | `chore: upgrade nodemailer to supported major` | `package.json`、`package-lock.json` |
| `69b7b61` | `test: revalidate smtp transport on nodemailer 10` | 三个测试文件 |
| `a233c25` | `docs: record phase 6.1 dependency security review` | 报告、四份文档、归档密钥扫描脚本 |

未 rebase 已发布的 `v0.1.0`，未 force push，未移动 `v0.1.0`，未 amend 任何历史发布提交。
本报告自身的 Git 记录以追加的 report-only 提交固定，与 Phase 6 采用同一做法：报告不声称自己
所在的提交，而声称代码、测试与文档的终态。

---

## 20. Release readiness

| 条件 | 结果 | 依据 |
| --- | --- | --- |
| Nodemailer supported major | 成立 | §3、§5：`10.0.9`，`npm audit` 0 条 |
| legacy `@types` removed where appropriate | 成立 | §7：已删除，typecheck exit 0 |
| npm audit acceptable | 成立 | §5：`0 high / 0 critical` |
| typecheck PASS | 成立 | §9：exit 0 |
| 327+ tests PASS | 成立 | §9：336 pass / 0 fail / 0 skipped |
| build PASS | 成立 | §9：exit 0 |
| pack PASS | 成立 | §10：`pack:check` PASS |
| fresh install PASS | 成立 | §11 |
| Phase 6 telemetry regression PASS | 成立 | §9、§15 |
| DSH rc.1 PASS | 成立 | §12 |
| DSH rc.2 PASS | 成立 | §13 |
| real 163 SMTP PASS | 成立 | §14 |
| secret scan PASS | 成立 | §17 |

```text
PASS — v0.1.1 RELEASE READY
```

本阶段不发布。`npm publish`、`git tag v0.1.1`、`git push --tags`、`gh release create` 均未执行，
正式发布留在下一阶段。

---

## 21. 文档更新

| 文件 | 变更 |
| --- | --- |
| [`PHASE6_1_REPORT.md`](PHASE6_1_REPORT.md) | 本文件 |
| [`README.md`](README.md) | 依赖要求补入 Nodemailer `10.x`；版本表补入本阶段的 rc.1/rc.2 证据；说明 Phase 6 的 RC 原先保留 7.x，发布前安全评审将其升级为受支持的 10.x |
| [`00_MASTER.md`](00_MASTER.md) | Roadmap 补入 Phase 6.1 行；SMTP 一节记录受支持 major 的要求 |
| [`docs/RELEASE.md`](docs/RELEASE.md) | 前置条件表补入 Nodemailer 10.x 与「唯一运行时依赖」的可执行检查；新增 `npm run scan:secrets` |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 传输安全一节记录受支持 major 与不可达路径的维持方式；运行时边界表补入依赖版本约束 |

Phase 6 的历史报告 [`PHASE6_REPORT.md`](PHASE6_REPORT.md) 保持原样，未被改写为「当时已经使用
Nodemailer 10」。本阶段的说明是：Phase 6 的遥测 RC 原先保留 Nodemailer 7.x，发布前安全评审
将其升级为受支持的 10.x。
