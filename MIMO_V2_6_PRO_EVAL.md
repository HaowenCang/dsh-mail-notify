# MiMo-V2.6-Pro v0.3.1 Evaluation

Model:
mimo-v2.6-pro

Base:
v0.3.0

Base commit:
b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4

Branch:
eval/mimo-v2.6-pro-v0.3.1-ui

DSH:
0.1.5-rc.2

Baseline:
- check:text: PASS (110 text files scanned; strict UTF-8, BOM-free, no mojibake)
- typecheck: PASS (three programs: tsconfig.json --noEmit, tsconfig.client.json, tsconfig.test.json)
- tests: 451 passed / 0 failed / 0 skipped (run after `npm run build`; see ordering note below)
- build: PASS (tsc host emit + tsc client declarations + tsdown client bundle, lib/client.js 46.10 kB)

Baseline ordering note (observable, not a defect): `tests/package/tarball.test.ts` runs
`npm pack` against the working tree and asserts on the packed `lib/` output. Running
`npm test` before `npm run build` on a clean checkout fails exactly 5 package tests
(PKG-01, PKG-01c, PKG-02b, "every relative import…", "the compiled entry point loads…")
with `lib/` missing; the same suite passes 451/451 once `npm run build` has emitted `lib/`.
Both runs were executed and recorded; the effective baseline order is build → test.

Environment (observed):
- node v24.13.0
- npm 11.12.0
- pnpm 11.7.0
- dsh 0.1.5-rc.2
- worktree: E:\Projects\DSHarness\dsh-mail-notify-mimo-pro (created from tag v0.3.0)
- HEAD == merge-base(HEAD, v0.3.0) == b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4 before implementation

Repository-state observations at start:
- The shared repository's main checkout was on branch `eval/gemini-3.8-flash-v0.3.1-ui`
  (clean), and a second worktree `dsh-mail-notify-ds41` existed for
  `eval/deepseek-v4.1-flash-v0.3.1-ui`. No file content from any evaluation branch was
  read; all work happened inside the isolated worktree created from tag v0.3.0.
- v0.3.0 tag resolves to annotated tag object 2ee3141f1d86710f527e831fd34d599a8052fef9
  with commit b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4, matching the expected release
  baseline exactly.

Telemetry: harness exposes no token/cost counters to the model; none are estimated.

---

## Commits (in order)

| SHA | Subject |
| --- | --- |
| `2d19ce3` | docs: record the v0.3.0 baseline for the v0.3.1 evaluation |
| `1c9f11a` | test: establish v0.3.1 UI regression coverage |
| `9413b22` | feat: make mail settings card collapsible |
| `18cf83d` | feat: add English and Simplified Chinese localization |
| `211e6f8` | chore: bump version to 0.3.1 |
| `986c381` | fix: restore dropped characters in Simplified Chinese template copy |
| `28378d3` | docs: prepare v0.3.1 release notes |
| (this commit) | docs: record the v0.3.1 evaluation results |

The `test:` commit is the intentional TDD red round: 14/14 disclosure tests fail against
v0.3.0 with `the card must render a disclosure control with aria-expanded`, observed and
recorded before `feat: make mail settings card collapsible` turned them green.

## Verification results (final tree)

- check:text: PASS — 117 text files.
- typecheck: PASS — three programs (host, client, tests), including the client program's
  check of the real `LocaleRuntime.register(ns, { en, zh })` call and the
  `LocaleNamespaceMap` merge against `@deepseek-ai/dsh-client-locale@0.1.5-rc.2` and
  `@deepseek-ai/dsh-client-ui-slots@0.1.5-rc.2` published declarations.
- tests: **476 passed / 0 failed / 0 skipped** — 451 v0.3.0 tests unchanged and passing,
  COL-01…COL-14, L10N-01…L10N-11. Suites must run after `npm run build` (baseline ordering
  note above).
- build: PASS — `lib/client.js` 66.19 kB; requires exactly `react` + `react/jsx-runtime`.
- pack: `dsh-mail-notify-0.3.1.tgz` — 108 entries, package size 171.4 kB, unpacked 632.4 kB,
  SHA-256 `859c0caea09126277c28c17fd721cc5824d984f2b7fe31b04818b0472faa7cba`.
- pack:check: PASS (required entries present, no forbidden entry).
- scan:secrets: PASS — 8 live credential references compared in UTF-8 and UTF-16LE:
  0 credential-value hits, 0 shaped-literal hits.
- Artifact content: `./client` export resolves (`lib/client.js` + `lib/types/client/index.d.ts`),
  localization shipped (`lib/types/client/locale.d.ts`, both dictionaries in the bundle),
  no unsupported external require, React not duplicated, no rc.7 strings, no local absolute
  paths, no credentials, no profile artifacts, no test-only package in `dependencies`
  (Nodemailer only).
- Clean install (§27): `npm ci` from `package.json` + `package-lock.json` alone in an isolated
  directory — success, full dependency graph resolved. New static imports all declared:
  `jsdom`, `@types/jsdom` (client DOM tests), `@deepseek-ai/dsh-client-locale` (locale
  contract types), `typescript`/`react`/`react-dom` (already present). All dev-only.
- Packed-artifact install + real Web smoke (§28): see below.

## Real DSH Web verification (§28), disposable profile `mmp031`

Installed `dsh-mail-notify-0.3.1.tgz` (the exact archive hashed above) into a disposable
`--from-default-profile web` profile under DSH `0.1.5-rc.2`; verified `dsh-mail-notify@0.3.1`
in the profile's dependency list and the row in `--dump-config`. Evidence below is DOM
measurements and screenshots from the real browser against the running Web UI.

English smoke: card starts collapsed (`aria-expanded="false"`, region `hidden`, 0 form
controls; collapsed text = title + summary only: "Active · SMTP configured · Questions on");
Shell / Agent loop / Subagent / Web search rows immediately reachable; expand reveals the full
English form (23 controls, mandated labels/buttons); staged `notifyQuestions` + SMTP host +
password drafts survive collapse/re-expansion; pointer activation toggles both ways; native
Enter collapsed and native Space expanded (real CDP key events on the focused native button);
`:focus-visible` matched with no outline suppression.

Chinese smoke: DSH language switched to 中文 in-place (no reload) — the shell retranslated
live; the card renders 邮件通知 with summary 运行中 · SMTP 已配置 · 提问通知已关闭/已启用, the
full Chinese form (常规, 通知类型, 状态, 需要用户回答, 需要用户批准 with the §15 hints verbatim,
发送测试邮件, 恢复继承值, 保存), canonical terms (DSH, SMTP, STARTTLS, 隐式 TLS) intact, zero
English leftovers, no horizontal page overflow. The operation notice created while the UI was
English ("Reset staged: …") rendered as 已暂存重置：… after the switch: the controller's stored
identity, translated at render (the tab's section switch remounts the card view, and the same
controller state re-rendered in the new language — the mounted-card live translation itself is
covered by L10N-07 through the seat-contract model; the renderer's own re-render trigger is the
`(namespace, revision)` seat derivation documented in the installed renderer types).

Narrow viewport (420 px): no horizontal page overflow, summary wraps across lines, labels
readable, recipients input 176 px usable, action buttons reachable; the form area scrolls
internally (the v0.3.0 label minimum), recorded as a known limitation.

Regression smoke: `notifyQuestions=true` saved through the card (notice 已保存; shared
`settings.yaml` user layer confirmed); one real `ask_user_question` turn in the profile (model:
MiMo V2.6 Pro) fired a real question → exactly one question notification (queue line 队列
0/100 · 已投递 1 · 失败 0) and the mail arrived at the configured mailbox (user confirmation:
"已接收到邮件"); **Send test email** reported 测试邮件已发送。SMTP 服务器已接受该邮件，共 1 个
收件人。 through the production credential/transport path; the credential surface stayed
write-only (blank masked field, `Change password` state, stored password used host-side only).

State restoration: shared `settings.yaml` diffed byte-identical against its pre-test backup
(language preference `zh` restored, `dsh-mail-notify` section unchanged); credential store
untouched; disposable profile removed; temp backups removed.

## Defects found and fixed during this run

1. **Chinese copy lost one character in 11 template entries** (found by real-browser copy
   review, after all automated checks had passed). Root cause: a colon-normalization sweep was
   invoked from a double-quoted PowerShell string, so `$1` was interpolated away by the shell
   and the replacement consumed the character before each ASCII colon (已暂存重置 → 已暂存重,
   插件 → 插, …). Fixed in `986c381`; the exact strings are now pinned in the L10N-02 mandated
   table. Automated parity checks could not have caught this: both dictionaries remained
   complete and key-parallel throughout.
2. **Test-harness: React `onChange` never fired in the DOM tests** (4 test failures, COL-09/10/
   12/14). Root cause: `react-dom`'s ChangeEventPlugin chooses its change-detection strategy at
   module evaluation; the harness loaded it before any DOM global existed, locking in the legacy
   path. Fixed by publishing jsdom globals before the dynamic `react-dom` import. Production
   code was never involved.

## Iterations (§25, observable)

- implementation/test cycles: 5 (TDD red scaffolding; collapse; localization; version/packaging;
  copy fix).
- compile failures: 0 (every `npm run typecheck` run exited 0).
- test assertion failures: one intentional red round (14/14 by design) and one genuine round
  (4 failures, harness cause above); every other run 476/476 or its phase-equivalent green.
- runtime/browser failures and environment incidents: `node --test` cannot import `.tsx`
  (discovered by probe, solved with a `node:module` load hook over `transpileModule`);
  `globalThis.navigator` assignment rejected (getter-only, fixed with `defineProperty`);
  `dsh --profile x --from-default-profile web --help` boots instead of printing help (timed
  out, killed); a same-version `dsh plugin add` did not replace package content (needed
  remove + add); reloading the user's webmail tab invalidated its session (left at the login
  page — mailbox-side confirmation replaced by the user's own confirmation).
- tool-call failures (counted from this transcript): 14 — 1 MCP connect failure (fell back to
  the second browser channel), 5 shell quoting/probe failures, 3 edit-tool rejections of
  identical old/new strings (no file change), 3 edit-tool stale-file retries, 1 timeout
  (grep over the full DSH tree), 1 `npm test` pipeline timeout caused by an uncleaned poll
  timer (fixed with per-test cleanup).
- malformed edits: 1 damaging (the PowerShell `$1` corruption above) + 3 no-op (identical
  strings, rejected before write).
- incorrect API assumptions: 3 (jsdom does not emulate native keyboard activation;
  react-dom's load-time feature detection; pnpm same-version `add` replacing content).
- human interventions: 1 (the user's "已接收到邮件" mail-receipt confirmation).

## Diff (v0.3.0..final)

- total: 16 files changed, 3199 insertions, 252 deletions (`git diff --shortstat v0.3.0..HEAD`).
- production (src/client only): 6 files, 979 insertions, 237 deletions (Card.tsx, controller.ts,
  fields.ts, locale.ts (new), index.tsx, contracts.ts).
- production changes outside `src/client`: none (`src/**` host half untouched —
  settings.ts, protocol.ts, web-rpc.ts, test-email.ts and the whole notification engine are
  byte-identical to v0.3.0).
- tests/harness/docs/tooling: 10 files, 2220 insertions, 15 deletions —
  tests/client/{disclosure,locale}.test.ts (new), tests/client/support/{dom,seat}.ts (new),
  tests/package/tarball.test.ts (manifest expectation +1 inject edge),
  package.json/package-lock.json (2 devDeps + locale inject edge + version), README.md,
  RELEASE_NOTES_V0.3.1.md (new), this file.

---

## Result matrix (§30)

Task:
v0.3.1 collapsible + Simplified Chinese UI

Result:
PASS

Model:
mimo-v2.6-pro

Base:
v0.3.0 / b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4

Branch:
eval/mimo-v2.6-pro-v0.3.1-ui

Final HEAD:
the commit carrying this file (subject: docs: record the v0.3.1 evaluation results); exact
SHA reported in the run's final git state

Timing:
- wall time: unavailable to the model (no harness clock); the session ran to completion in
  one continuous working block
- unavailable if not observable

Tokens:
- uncached input: unavailable (harness exposes no token counters)
- cached input/read: unavailable
- output: unavailable
- cache hit: unavailable

Cost:
- unavailable unless directly provided (none provided)

Iterations:
- implementation/test cycles: 5
- compile failures: 0
- test failures: 18 (14 intentional TDD red + 4 harness-caused; all resolved)
- browser/runtime failures: 6 environment incidents (enumerated above), 0 product defects
  escaping to the final artifact other than the copy defect, which was found and fixed before
  the final pack
- incorrect API assumptions: 3
- human interventions: 1

Tool use:
- total calls: ≈165 (counted from this transcript: ≈50 shell, ≈40 browser, ≈28 edits,
  ≈22 reads, ≈7 writes, ≈7 searches, ≈11 job/skill/other)
- failed calls: 14
- malformed edits: 1 damaging + 3 no-op
- recovery incidents: 4 (tsx loader hook; react-dom load-order fix; remove+add reinstall;
  copy-defect fix with pinned strings)

Diff:
- total files changed: 16
- total insertions: 3199
- total deletions: 252
- production files changed: 6
- production-code insertions: 979
- production-code deletions: 237
- test/harness/docs files changed: 10 (2220 insertions, 15 deletions)

Functional:
- collapse: PASS (starts collapsed, compact row, form absent from layout)
- draft retention: PASS (edits, password draft, in-flight ops, results survive collapse)
- English: PASS (full form, mandated copy)
- Simplified Chinese: PASS (full form, mandated copy verbatim, no English leftovers)
- live locale: PASS (DSH switch without reload; card copy and existing notice follow)
- existing notice live retranslation: PASS (identity-stored notice re-rendered translated;
  in-place mounted-card retranslation proven at the seat-contract level, L10N-07)
- notifyQuestions: PASS (saved through the card; one real ask_user_question → one mail)
- test email: PASS (production path; accepted for 1 recipient)

Architecture:
- DSH native locale integration: PASS (LocaleRuntime.register + LocaleNamespaceMap +
  `locale:` seat + `dsh-client-locale` inject edge + `locale` service gate)
- typed locale vocabulary: PASS (closed MailNotifyLocaleKey union, Record parity enforced)
- controller locale coupling: none (stores semantic identities only)
- undeclared dependencies: none
- production changes outside src/client: none

Packaging:
- build: PASS
- pack: PASS
- pack:check: PASS
- scan:secrets: PASS
- clean install: PASS (npm ci from manifest + lockfile)
- packed artifact install: PASS (disposable profile, dsh-mail-notify@0.3.1)
- real Web smoke: PASS (English + Chinese + keyboard + narrow + regression)

Do not provide subjective benchmark scores.
