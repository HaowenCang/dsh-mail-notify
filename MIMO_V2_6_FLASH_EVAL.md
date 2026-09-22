# MiMo-V2.6-Flash v0.3.1 Evaluation

Model:
mimo-v2.6-flash

Base:
v0.3.0

Base commit:
b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4

Branch:
eval/mimo-v2.6-flash-v0.3.1-ui

DSH:
0.1.5-rc.2

Initial baseline:
- check:text: PASS (119 text files strict UTF-8, BOM-free, no mojibake)
- typecheck: PASS (tsconfig.json, tsconfig.client.json, tsconfig.test.json)
- tests: PASS (451 pass, 0 fail)
- build: PASS (tsc host, tsc client, tsdown bundle lib/client.js 46.10 kB)

Environment:
- node: v24.13.0
- npm: 11.12.0
- pnpm: 11.7.0
- dsh: 0.1.5-rc.2

## Development log

### Phase 1 — collapsible card (commit f2d8a91)

API evidence used (installed rc.2 tree, not memory):
- Disclosure pattern: `dsh-client-ui-settings-plugins/lib/client.js` PluginCard —
  `<button type="button" aria-expanded>` header, `useState(false)` (collapsed by
  default), conditionally revealed body, card-local presentation state, staged
  edits outlive collapsing.
- Locale boundary: `@deepseek-ai/dsh-client-locale` (present in the global
  rc.2 tree) exposes `ctx.locale.register(ns, { zh, en })` / `bind(ns)` /
  `subscribe`, augments `Context.locale`, and is installed as the renderer's
  locale face (`slots.installLocale`). Slot registrations declaring `locale:`
  receive a typed `t` prop seat (`PropsLocale<N>`, `LocaleNamespaceMap`
  declaration merging in `@deepseek-ai/dsh-client-ui-slots`), and the renderer
  re-renders every outlet on locale revision (`useLocaleRevision`).

Implementation:
- Whole-card disclosure, collapsed by default, component-local `open` state;
  semantic button with `aria-expanded` + `aria-controls`; platform Enter/Space
  activation (no bespoke key handler); `:focus-visible` ring via a once-guarded
  injected stylesheet (pseudo-class cannot be expressed inline).
- Collapsed header summary: Active/Inactive · SMTP configured/not · Questions
  on/off/inherited · Saving…/Sending… while busy. No recipients, SMTP user,
  host, queue detail, or credential material.
- Status block moved to the end of the expanded body under a "Status" heading.
- New dev-only test dependencies: jsdom, @types/jsdom, @testing-library/react,
  @testing-library/dom, @testing-library/user-event. Component tests exercise
  the BUILT `lib/client.js` (rebuilt when stale under a mkdir lock) through a
  mock DSH context, so the real bundle, controller, and component are under test.

Verification this phase: `check:text` PASS (126 files), `typecheck` PASS (three
programs), `npm test` 465/465 pass (451 baseline + 14 new COL tests), `build`
PASS (lib/client.js 50.88 kB). The 14 COL tests passed on their first run;
two compile iterations were needed for the harness (missing `@types/jsdom`; the
`user-event` default import resolves to the module namespace under this
program's interop, so the named `userEvent` export is used).

### Environment incident — concurrent sibling evaluations in one checkout

Between branch creation (verified `eval/mimo-v2.6-flash-v0.3.1-ui` at
`b352c91`, clean tree) and the first commit, an external process created and
switched HEAD to a branch named `gpt-6` (same base `b352c91`) in this shared
checkout; the phase-1 commit therefore landed on `gpt-6`. Recovery: the commit
was verified (parent `b352c91`, only my own file changes), then
`eval/mimo-v2.6-flash-v0.3.1-ui` was fast-forwarded to it.

A second external process (branch `eval/gpt-5.6-sol-v0.3.1-ui`, another model
evaluation running concurrently in the same working tree) then force-checked
out `v0.3.0` and cleaned the tree, deleting all uncommitted phase-2 work from
the canonical checkout (the committed phase-1 work was untouched: branch
`eval/mimo-v2.6-flash-v0.3.1-ui` still pointed at `f2d8a91`).

Recovery: the experiment moved to an isolated local clone of the same
repository (`E:\Projects\DSHarness\dsh-mail-notify-mimo`) checked out on the
evaluation branch. All subsequent work happens there; at completion the branch
is fetched back into the canonical repository by local path fetch (no remote
push). No content of any other experiment's branch was read, checked out, or
copied at any point.

### Phase 2 — localization (commit f7a5df2)

- `src/client/locales.ts`: one typed vocabulary, `en` as key-set source,
  `zh: Record<MailNotifyLocaleKey, string>` (compile-enforced parity), 109
  keys covering chrome, disclosure, collapsed summary, group headings, all 22
  field labels/hints, control options/badges, validation reasons, notices,
  status, and actions; required §14/§15 vocabulary reproduced verbatim.
- `fields.ts`: definitions carry `labelKey`/`hintKey` instead of English
  literals; `parseField` keeps its English diagnostic for tests and adds a
  structured `validation` reason + params localized at render.
- `controller.ts`: notices and test-email outcomes became
  `{kind:'copy', key, params} | {kind:'raw', text}` — plugin-authored copy is
  localized at render, host/wire diagnostics pass through verbatim.
- `Card.tsx`: every string resolves through the framework `t` seat
  (`MailNotifyCardProps = PropsRuntime & PropsLocale<'dsh-mail-notify'> &
  InjectFace<...>`); no `locale === ...` branching anywhere in JSX.
- `contracts.ts`: type-only import of `@deepseek-ai/dsh-client-locale/client`
  plus the `LocaleNamespaceMap['dsh-mail-notify']` merge.
- `index.tsx`: `ctx.locale.register(MAIL_LOCALE_NS, { zh, en })` in its own
  effect (registered before the card effect), `locale:` on the slot
  registration, `'locale'` added to the service gate.
- `package.json`: `@deepseek-ai/dsh-client-locale@0.1.5-rc.2` pinned exact
  devDependency; `dsh.client.inject` gains the locale boot-graph edge first.
- Tests: L10N-01/01b/02/03/04/05/05b/06/07/08/09/10/11 (13 cases) plus a
  packed-bundle dictionary assertion in the tarball suite; COL-13 updated for
  the capitalised On/Off vocabulary.

Verification this phase: check:text PASS, typecheck PASS (three programs,
first attempt), build PASS (67.15 kB), npm test 479/479 (first attempt).

### Phase 3 — version metadata (commit 26dc8ee)

`package.json` + lock → 0.3.1; `scan:secrets` archive name updated. No test
hardcodes the version (the tarball suite derives it from the manifest).

### Phase 4 — probe harness fix (commit 2772173)

First run of `npm run probe:questions` failed with child exit 1, 0 messages:
every `!!js`-NAMED insert row died at `Include.import` with
`name.startsWith is not a function`. Root cause (evidence-driven, all against
the installed tree): the published `@deepseek-ai/cordis-plugin-loader` line
(1.0.1-rc.1 … **1.0.3**, newest published) interpolates `!!js` expressions
only for `disabled` (`disabledOf`) and for config values (`internal/config`
→ `interpolate`), and passes `options.name` to `import()` raw — there is no
name-evaluation site in loader 1.0.2 or 1.0.3, in `cordis-plugin-include`
1.0.7, or in `dsh-app-boot` 0.1.5-rc.2; `anchorInsertedPluginNames` anchors
only STRING names, which is the supported form. The v0.3.0-era probe run
(2026-09-19 00:45 artifacts in the canonical checkout) predates a same-day
01:43 reinstall of the DSH tree, so the overlay dialect feature was never
loadable on the pinned installation. Failure was NOT caused by this
evaluation's diff (the diff touches no host or probe-boot code).

Fix (tooling only): probe insert rows are materialized per run into
`tmp/probe/out/overlay-inserts.yml` with plain absolute string names (JSON
document = valid YAML for the patch dialect), anchored to file URLs by the
parser; the plugin settings travel as a data object in that overlay instead
of through `PROBE_MAIL_CONFIG`; `overlay-base.yml` keeps the id-targeted
config patches whose `!!js` config values DO interpolate.

Verification: `node --check` PASS; probe:questions exit 0 with exactly 2
messages (`[DSH] Input required — Choose Mode`, `[DSH] Task completed —
probe-scripted`), credential contract 0 FAIL / 14 PASS on the real rc.2 file
store; probe:errors exit 0 with `[DSH] Task failed — QUOTA (402)`;
probe:approvals exit 0 with `[DSH] Approval required — probe_request_approval`
before `approval/decided`, privacy sentinel clean on raw SMTP/stderr/stdout.

### Phase 5 — real DSH Web smoke (packed tgz, disposable profile)

Setup: disposable `DSH_HOME=%TEMP%\dshmn-web-home`, profile `mimo031` from
the shipped `web` template, `dsh plugin --profile mimo031 add
dsh-mail-notify-0.3.1.tgz` (bundles auto-appended), profile patch row sets
`enabled: true`, loopback SMTP sink on 127.0.0.1:2525, `dsh --profile mimo031
--port 50131 --no-open`, Chromium via chrome-devtools MCP. The user's own
`DSH_HOME`, profiles, credentials, and browser tabs were untouched; all state
lives in the disposable home.

English smoke:
- Settings → Plugins → Plugin configuration: region "Configure
  email notifications", header `aria-expanded=false`, label "Expand: Mail
  notifications", collapsed height 73 px, zero form controls in the a11y
  tree, Shell/Agent loop/Subagent/Web search cards immediately below.
- Expand: full English form, all group headings and §15 copy present.
- Draft retention: notifyQuestions, SMTP host/port/user, from, to, and the
  password draft all survived collapse → re-expand; Save enabled.
- Save: `settings.yaml` gained exactly the staged user-layer keys,
  `notifyQuestions: true`, **no password anywhere** (PASSWORD-LEAK: NO);
  status moved to `plugin active`, `credential: Configured`,
  `Effective question notifications: On`, `Saved.` shown; password field
  cleared with the "A password is stored…" hint. One intermediate
  configError (`smtpPasswordCredential is required`) is v0.3.0's unchanged
  schema requirement, cleared by setting the credential reference field.
- Keyboard in real Chromium: header focused → Enter collapses
  (`aria-expanded=false`, body unmounted, focus retained) → Space expands.
- Send test email: card reported "Test email sent: the SMTP server accepted
  the message for 1 recipient(s)." and the sink log received the full
  message (From/To/subject `[DSH] dsh-mail-notify test message`, no config
  or credential in the body).

Chinese smoke:
- Language row → 中文; Plugins tab re-rendered: region "配置邮件通知",
  header `展开: 邮件通知`, collapsed summary
  `运行中 · SMTP 已配置 · 提问通知已启用` (matches the §5 target presentation),
  collapsed height still 73 px, no horizontal overflow (document or dialog).
- Expand: 常规/通知类型/需要用户回答/需要用户批准/发送测试邮件/恢复继承值/保存/
  邮件内容/发送与重试/状态/SMTP 服务器/端口/安全连接/隐式 TLS/STARTTLS/密码/
  收件人/发件人/用户名/队列大小/重试次数/最大正文长度/包含元数据/包含用户提示词/
  包含邮件页脚/包含子智能体活动/启用邮件通知/任务完成/任务错误/达到 Token 上限
  all present; `插件运行中`, `凭据：已配置`, `提问通知（生效值）：已启用`;
  English-leak scan negative; expanded height 1788 px, still no overflow.
- A real save under zh reported `已保存。`.

Screenshot capture was denied by the MCP workspace-path policy; the recorded
evidence is the a11y-snapshot/evaluation-script output quoted above.

### Metrics

Task:
v0.3.1 collapsible + Simplified Chinese UI

Result: (filled by the final report below; evidence complete)

Base:
v0.3.0 / b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4

Final branch:
eval/mimo-v2.6-flash-v0.3.1-ui

Implementation commits:
1. f2d8a91 feat: make the mail settings card collapsible
2. f7a5df2 feat: add English and Simplified Chinese localization
3. 26dc8ee chore: bump version to 0.3.1
4. 2772173 test: materialize e2e probe insert rows with string names
5. (docs) RELEASE_NOTES_V0.3.1.md + this document's final metrics

Tests:
- baseline: 451/451 pass (check:text PASS, typecheck PASS, build PASS)
- final: 479/479 pass (see final verification block appended after the last run)
- newly added: 27 (14 COL, 13 L10N incl. vocabulary/copy checks) + 1 packed
  bundle dictionary check = 28 new test cases across 4 suites

Iteration:
- implementation/test cycles: 5 phases; phase-1 compile needed 2 iterations
  (missing `@types/jsdom`; `user-event` default-import interop), phase-2
  compiled and tested first try; no failing test ever ran to completion —
  every COL/L10N/full-suite run passed on first execution
- compile failures: 1 command (`tsc -p tsconfig.client.json`, 4 diagnostics,
  both harness-only causes above; no product code failed to compile)
- test failures encountered: 0 unit/component; 1 runtime e2e failure
  (probe `!!js` name, root-caused to the pinned loader — environment, not
  diff; fixed in tooling)
- runtime/Web failures encountered: 0 in the Web smoke (one `fill` on a
  `<select>` was unsupported by the MCP tool and was driven through a page
  script instead — tool limitation)
- human interventions required: 0

API/tool reliability:
- failed tool calls: 2 (the `mcp__chrome__*` server was disconnected;
  chrome-devtools MCP used throughout), 2 screenshot denials (workspace path
  policy), 1 pwsh inline-quoting parse error, 2 file-write guards (stale/not
  read), 2 external git incidents (foreign branch creation; foreign force
  checkout + clean — recovered as documented above)
- malformed edits: 0
- commands requiring manual recovery: the two git incidents
- incorrect DSH API assumptions: 0 in the shipped implementation — the
  locale boundary, `PropsLocale`/`LocaleNamespaceMap`, the `t` seat, and the
  PluginCard disclosure pattern were all derived from the installed rc.2
  sources before use; one incorrect assumption concerned the project's own
  probe overlay dialect (that `!!js` names were loadable on rc.2), corrected
  against installed loader source

Functional:
- collapse: PASS (COL-01…COL-14 + real-browser Enter/Space/pointer/aria)
- draft retention: PASS (unit + real browser, password draft included)
- English: PASS (real browser, full form + summary + notices)
- Simplified Chinese: PASS (real browser, full required vocabulary, no
  overflow, no English fragments)
- live locale switch: PASS (unit L10N-07 through the outlet revision
  contract; the shell switches section copy on navigation — the settings
  dialog unmounts non-visible sections, so a mounted-card switch in the real
  shell is exercised by the same renderer outlet subscription the unit test
  reproduces)
- notifyQuestions regression: PASS (card save → settings.yaml user layer →
  `Effective … On`; probe:questions delivered the real question mail)
- test email regression: PASS (card → production credential/transport →
  loopback sink receipt)

Packaging:
- build: PASS (lib/client.js 67.15 kB, gzip 19.75 kB)
- pack: PASS (dsh-mail-notify-0.3.1.tgz, 108 entries, 633.7 kB unpacked)
- pack:check: PASS; scan:secrets: PASS (0 credential-shaped hits)
- disposable tgz install: PASS (pnpm add into profile mimo031, bundles
  auto-appended, composed row enabled via profile patch)
- real Web smoke: PASS (English, Chinese, draft/collapse, keyboard, save,
  test email — details in Phase 5)

### Final verification (complete §25 sequence, after all commits' content)

- `npm run check:text`: PASS (126 text files scanned — the count includes
  gitignored `tmp/probe/*` scratch created by the probe runs; the tracked
  surface is 119 + RELEASE_NOTES_V0.3.1.md)
- `npm run typecheck`: PASS (tsconfig.json, tsconfig.client.json,
  tsconfig.test.json)
- `npm test`: 479 tests, 479 pass, 0 fail (duration ~6.1 s)
- `npm run build`: PASS (lib/client.js 67.15 kB, gzip 19.75 kB)
- `npm pack`: dsh-mail-notify-0.3.1.tgz, 108 files, 633.7 kB unpacked
- `npm run pack:check`: PASS (required entries present, none forbidden)
- `npm run scan:secrets`: PASS (108 entries, 633652 bytes, credential-value
  hits=0, shaped-literal hits=0)
- Packed-artifact inspection: `./client` export resolves to
  `./lib/client.js`; bundle carries 邮件通知/需要用户回答/发送测试邮件/
  Mail notifications; require set exactly `["react","react/jsx-runtime"]`;
  no `0.1.0-rc.7` reference; no Windows or `/home/runner` absolute paths;
  loader envelope opens and closes; `exports.apply`/`exports.inject` present;
  locale registration and `aria-expanded` present in the bundle.

Probe regressions against the built 0.3.1 host (loopback SMTP):
- questions: exit 0, 2/2 messages (`[DSH] Input required — Choose Mode`,
  `[DSH] Task completed — probe-scripted`)
- errors: exit 0, 1/1 message (`[DSH] Task failed — QUOTA (402)`)
- approvals: exit 0, 2/2 messages, mail accepted before `approval/decided`,
  tool-argument sentinel clean on raw SMTP/stderr/stdout
- credential contract: 0 FAIL / 14 PASS on every scenario

Git state at completion (reported in the final answer):
branch `eval/mimo-v2.6-flash-v0.3.1-ui`, five commits above `v0.3.0`,
working tree clean, `main` and the `v0.3.0` tag untouched, nothing pushed,
no release published.

