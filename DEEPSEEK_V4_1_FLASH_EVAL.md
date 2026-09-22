# dsh-mail-notify v0.3.1 — evaluation record

**Model:** deepseek-v4.1-flash
**Base:** v0.3.0 / `b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4`
**Branch:** `eval/deepseek-v4.1-flash-v0.3.1-ui`
**DSH:** `0.1.5-rc.2`
**Task:** v0.3.1 collapse + Simplified Chinese

---

## 1. Branch management and incident record

| Step | Result |
| --- | --- |
| `git fetch origin --tags` | OK — all four tags present (`v0.1.0`, `v0.1.1`, `v0.2.0`, `v0.3.0`) |
| `git status --short` (shared checkout) | **clean** |
| `git branch --show-current` (shared checkout) | `eval/gemini-3.8-flash-v0.3.1-ui` |
| `git rev-parse v0.3.0^{commit}` | `b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4` — **matches the expected baseline** |

`v0.3.0` is an annotated tag whose object is `2ee3141f1d86710f527e831fd34d599a8052fef9` and whose
target is exactly the expected commit. Verified.

### Incident: the shared checkout was occupied

The shared checkout at `E:\Projects\DSHarness\dsh-mail-notify` was checked out on
`eval/gemini-3.8-flash-v0.3.1-ui` at `aada8e8` (HEAD subject: `docs: complete
GEMINI_3_8_FLASH_EVAL.md`), and `git branch -a` also listed `eval/gpt-5.6-sol-v0.3.1-ui` at
`b352c91` and `eval/mimo-v2.6-flash-v0.3.1-ui` at `7b0d23b`. The working tree was clean, so nothing
uncommitted was at risk, but switching branches in place would have moved another model's active
checkout.

**Action taken:** the experiment was moved to an isolated worktree created directly from the
released tag, leaving the shared checkout on its original branch, at its original commit, with its
working tree untouched:

```
git worktree add -b eval/deepseek-v4.1-flash-v0.3.1-ui \
  E:/Projects/DSHarness/dsh-mail-notify-ds41 v0.3.0^{commit}
```

| Check | Result |
| --- | --- |
| `git rev-parse HEAD` (worktree) | `b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4` |
| `git merge-base HEAD v0.3.0` | `b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4` |
| `git status --short` (worktree, at creation) | clean |

The three sibling branches were **not** inspected: no log of theirs was read, no diff of theirs was
read, and no commit of theirs was merged or cherry-picked. The only fact recorded about them is
their existence and commit hash, which is what `git branch -a` prints.

The initial `git rev-parse v0.3.0^{commit}` invocation through the PowerShell call reported
`fatal: ambiguous argument` — a **tool-call failure**, not a repository fault: `^{commit}` is a
caret-prefixed expression that PowerShell mangles when passing it through its command shim. Quoting
the argument resolved it. Recorded because it cost one cycle.

---

## 2. Baseline record

```
git rev-parse HEAD         b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4   (v0.3.0)
node --version             v24.13.0
npm --version              11.12.0
pnpm --version             11.7.0
dsh --version              0.1.5-rc.2
```

A fresh worktree has no `node_modules`; `npm ci` was required before any script would run
(`tsc: not recognized`). The first baseline attempt therefore reported failures that were purely
environmental. After `npm ci`:

| Check | v0.3.0 baseline result |
| --- | --- |
| `npm run check:text` | **PASS** — 110 files, strict UTF-8, BOM-free, no mojibake |
| `npm run typecheck` | **PASS** — host, client, and test programs |
| `npm test` | **PASS** — 451 tests, 0 failures |
| `npm run build` | **PASS** — `lib/client.js` 46.10 kB (gzip 13.07 kB) |

Experiment start time and initial token/cost counters: **unavailable** — the harness exposes no
such counter, and none was invented.

---

## 3. Inspection performed before editing

Repository (v0.3.0 source, all read in full): `src/client/index.tsx`, `Card.tsx`, `controller.ts`,
`fields.ts`, `contracts.ts`, `wire.ts`, `src/settings.ts`, `src/protocol.ts`, `package.json`,
`tsconfig.json`, `tsconfig.client.json`, `tsconfig.client.build.json`, `tsconfig.test.json`,
`tsdown.config.ts`, `tests/client/`, `tests/support/`, `tests/package/tarball.test.ts`,
`README.md`, `RELEASE_NOTES_V0.3.0.md`, `CLIENT_RUNTIME_RESOLUTION.md`, `scripts/inspect-tarball.mjs`.
`src/test-email.ts` and `src/web-rpc.ts` were read by name only — they are host-side and the diff
proved they were never touched.

Installed DSH `0.1.5-rc.2` (authoritative):

| Contract | Finding |
| --- | --- |
| `settings.plugin.item` | Keyed slot, scope `root`, owner props empty; declared by `dsh-client-ui-settings-plugins` |
| Owner props | `SettingsPluginItemOwnerProps` carries only `children?: never` |
| Locale service | `ctx.locale` is a `LocaleRuntime` with `register`, `bind`, `getSnapshot`, `subscribe`, `setLocale`, `addLanguage` |
| Locale registration | `register(ns, { zh, en })` typed overload requires **every** built-in locale and checks each against `LocaleNamespaceMap[ns]` — asymmetric key sets are compile errors |
| `t` seat | `locale: NS` at the registration site makes the renderer synthesize `PropsLocale<NS>`, re-derived from `(ns, revision)` on every locale change |
| Lookup chain | active language → its `fallback` → English → shared `common` namespace → the key itself |
| Fallback | `FALLBACK_LOCALE = 'en'`; `resolveInitialLocale` = browser detection ?? `'en'`; a Host preference overrides both; unknown/unregistered ids are **refused** by `setLocale` |
| UI primitives | `dsh-client-ui-primitives` is in the shell seed table, but reaching it would have added a runtime require; not used |
| Existing disclosure | DSH's own `PluginCard` uses `<button type="button" aria-expanded aria-label={collapse|expand}: {title}>` with the body conditionally rendered, and its copy comes from a locale namespace — the same shape this card now uses |

**Key architectural decision:** the entire change is client-only. `cordis.patch.yml` and every host
module are byte-identical to v0.3.0 (proven below), so no host change was demonstrably required and
none was made.

---

## 4. Implementation/test cycles and observable failures

| # | Cycle | Observable outcome |
| --- | --- | --- |
| 1 | Baseline `npm ci` in the fresh worktree | `tsc`/tests failed purely because `node_modules` was absent; resolved by installing, not by changing anything |
| 2 | Attempted `@deepseek-ai/dsh-client-test-runtime@0.1.5-rc.2` for the browser harness | **npm ERESOLVE**: it peer-requires `dsh-api-session-controller@^0.1.5-rc.2`, which resolves `0.1.5-rc.3` and then demands `dsh-session@^0.1.5-rc.3` — incompatible with this project's exact rc.2 pins. **Rejected rather than `--force`d**; a forced install would have put two releases of the same packages in one tree |
| 3 | Attempted to load the real `LocaleRuntime` under Node | Its browser entry is a `window.__ModuleLoader__.load({ factory })` envelope whose factory requires `dsh-client-ui-primitives` and `dsh-client-store`; those packages' published `latest` dist-tags resolve to `0.0.1-rc.1` and `0.1.2-alpha.2`, neither of which exists at `0.1.5-rc.2`. **Rejected**: installing the stale family is the exact trap the project's pins exist to prevent. Replaced by `TestLocaleRuntime`, which implements the published contract and lookup chain; the real service is exercised in the browser smoke test |
| 4 | First DOM test run | `ERR_INVALID_TYPESCRIPT_SYNTAX: Expected '>', got 'card'` — Node's native type stripping does not transform JSX |
| 5 | Added `tsx` as the test loader, renamed the test to `.tsx` | Next failure: `does not provide an export named 'LocaleRuntime'` (cycle 3) |
| 6 | Replaced the locale import with the contract double | `TypeError: Cannot set property navigator of #<Object> which has only a getter` — Node 24 declares `navigator` as a getter-only global. Fixed by `Object.defineProperty` |
| 7 | Converted tests to `createElement` to avoid JSX in tests | Still `ReferenceError: React is not defined`, now inside `src/client/Card.tsx` — esbuild compiled it with the **classic** runtime because `tsconfig.json` had no `jsx` option |
| 8 | Tried `tsx --tsconfig`, `TSX_TSCONFIG_PATH`, `npx tsx --test` | None changed the JSX runtime; one attempt under `NODE_ENV=production` did switch to the automatic runtime but then failed with `act(...) is not supported in production builds of React` |
| 9 | Published React as a global from the harness module | **Smoke test passed.** `Card.tsx` keeps its production form (the real build uses `jsx: react-jsx`, where importing React would be dead weight that `noUnusedLocals` rejects) |
| 10 | First full collapse-suite run | 16/18 passed. COL-06 and COL-07 failed: a **synthetic `KeyboardEvent` does not activate a native button** — Enter/Space activation is defined only for trusted events. The tests were restructured to assert the precondition that makes it true (the header is a native `button`, `type=button`, no `tabindex` override, nothing cancels the default action, the key event reaches it, and a click — the action the UA performs — toggles), and the keypress itself was verified with a real `Input.dispatchKeyEvent` in the browser (§7) |
| 11 | First localization-suite run | 20/22 passed. Two **real product gaps** found: (a) the required string `配置邮件通知` / `Configure email notifications` had no home — added as a `subtitle` key and rendered; (b) `group.status` was declared but never rendered — the status strip had no group title. Both were defects in my implementation, not in the tests |
| 12 | Next run | `zh.secret.clear` was `清除已存密码` where the specification requires `修改密码`, and `设置密码` / `Change password` had no home. Added `secret.set` and `secret.change`, and made the credential control's **label** track what the reference holds (`Set password` when empty, `Change password` when stored) while the separate `Clear stored password` button appears only when there is something to remove. The write/removal semantics of v0.3.0 are unchanged; only the wording moved |
| 13 | `check:text` after a PowerShell `Set-Content` round-trip on `controller.ts` | **FAIL** — 3 mojibake hits: `-replace` plus `Set-Content` had re-encoded em-dashes through a legacy code page. Fixed with the file tool, not with another shell round-trip. The guard did its job |
| 14 | Full suite after all fixes | **494 tests, 0 failures** |

Malformed edits: one (cycle 13). Incorrect API assumptions: three (the test-runtime peer graph, the
`LocaleRuntime` module shape, and synthetic keyboard activation). Human interventions requested: one
(§7, mail-arrival confirmation).

---

## 5. Final verification

| Command | Result |
| --- | --- |
| `npm run check:text` | **PASS** — 121 files, strict UTF-8, BOM-free, no mojibake |
| `npm run typecheck` | **PASS** — all three programs (host, client, test) |
| `npm test` | **PASS** — 494 tests, 0 failures, 0 skipped (v0.3.0: 451) |
| `npm run build` | **PASS** — `lib/client.js` 70.6 kB, gzip 20.62 kB |
| `npm pack` | **PASS** — `dsh-mail-notify-0.3.1.tgz`, 174.5 kB packed / 644.5 kB unpacked, 112 files, sha512 `kUjoW5CA1GNR8…RPTG5hl95dmoA==` |
| `npm run pack:check` | **PASS** — required entries present, no forbidden entry |
| `npm run scan:secrets` | **PASS** — 112 entries, 0 credential-value hits, 0 shaped-literal hits |

### Tarball inspection (`dsh-mail-notify-0.3.1.tgz`, extracted)

| Requirement | Evidence |
| --- | --- |
| `./client` resolves | `package/lib/client.js` present and `package/lib/types/client/index.d.ts` present; both declared in `exports["."].client` |
| Locale code included | `邮件通知`, `常规`, `通知类型`, `需要用户回答`, `需要用户批准`, `发送测试邮件`, `恢复继承值`, `保存`, `展开`, `折叠`, `运行中` all present verbatim in `lib/client.js` |
| No unsupported external require | External `require` set is exactly `react` and `react/jsx-runtime`, both answered by the shell's seed module table |
| No duplicated React | No bundled React internals; the only `createElement` occurrence is `document.createElement("style")` for the focus rule |
| No rc.7 contamination | Zero occurrences of `0.1.0-rc.7` or `rc.7` in any packed module |
| No local paths | Zero occurrences of `E:\`, `E:/`, `C:\Users`, or the machine user id in `lib/client.js` or `lib/index.js` |
| No credentials | Secret scan: 0 hits; the packed `package.json` declares no credential, and no `.env`, key, or credential-store entry is present |
| No test-profile data | No `tests/`, `scripts/`, or `src/` entry in the archive; the profile name `mnv031` does not appear |

### Invariance checks

```
git diff --stat v0.3.0..HEAD -- cordis.patch.yml   (empty)
git diff --stat v0.3.0..HEAD -- src ':!src/client' (empty)
```

`cordis.patch.yml` and **every** host-side module are byte-identical to v0.3.0.

---

## 6. Required-collapse test coverage

`tests/client/collapse.test.ts` — 18 tests, all driving the rendered card through real DOM events
over the real controller.

| ID | Test | Result |
| --- | --- | --- |
| COL-01 | starts collapsed | PASS |
| COL-02 | full form absent while collapsed (no region, no field labels, no password input, no selects) | PASS |
| COL-03 | click expands | PASS |
| COL-04 | second click collapses | PASS |
| COL-05 | `aria-expanded` matches the rendered body in both directions over three toggles | PASS |
| COL-06 | header is a native `button` with `type=button`, no `tabindex` override, no `disabled`, and the key event reaches it | PASS |
| COL-06b | the click the user agent performs on Enter/Space expands, and a second collapses | PASS |
| COL-07 | nothing cancels the default action of Space, and no key handler toggles on its own | PASS |
| COL-07b | exactly one focusable element while collapsed, and it is the header | PASS |
| COL-08 | inner controls (Save, then a text input) do not toggle the card | PASS |
| COL-09 | drafts in a boolean **and** a text field survive collapse and re-expansion, **and collapsing performed no settings write at all** | PASS |
| COL-10 | a save result survives collapse and re-expansion | PASS |
| COL-11 | a delivery-test result survives collapse and re-expansion | PASS |
| COL-12 | a credential draft survives collapse, is absent from the collapsed document (text and markup), and is written only by Save | PASS |
| COL-13 | the collapsed summary carries no password, recipient, SMTP user, or SMTP host — and does state the three safe facts | PASS |
| COL-13b | the collapsed summary follows live host facts rather than a stale snapshot | PASS |
| COL-14 | unmounting writes nothing, and `Discard` is still the only thing that drops staged edits | PASS |
| COL-14b | the body is rebuilt from the controller on every one of three expansions | PASS |

`aria-controls` correctness (the attribute equals the rendered region's id) is asserted in the
browser smoke test, where the DOM id namespace is real.

### Expansion state is presentation-only

`tests/client/localization.test.ts` L10N-00 asserts the observable form of the prohibition: three
toggles produce **zero** `settings.mutate`, `credentials.set`, and `credentials.unset` calls. There
is therefore no channel through which the state could reach `settings.yaml`, `cordis.patch.yml`,
credentials, or the plugin settings namespace.

---

## 7. Required-localization test coverage

`tests/client/localization.test.ts` — 22 tests.

| ID | Test | Result |
| --- | --- | --- |
| L10N-01 | the English dictionary carries every required English string exactly | PASS |
| L10N-02 | key domains are identical, and every required Chinese string is exact | PASS |
| L10N-02b | no Chinese entry is left in English (allow-list of technical terms only) | PASS |
| L10N-03 | the mounted card renders the English title | PASS |
| L10N-04 | every field label and hint reaches the screen, and no locale key is rendered as text | PASS |
| L10N-04b | all eight group titles render | PASS |
| L10N-05 | switching to zh renders 邮件通知 plus the required group and action labels | PASS |
| L10N-05b | 需要用户回答 / 需要用户批准 render with their full Chinese descriptions | PASS |
| L10N-05c | the disclosure's accessible name is 展开 / 折叠 in Chinese and Expand / Collapse in English | PASS |
| L10N-06 | a language switch reaches the **mounted** card and is reversible | PASS |
| L10N-06b | a validation refusal already on screen switches language | PASS |
| L10N-06c | a save result already on screen switches language | PASS |
| L10N-07 | an unshipped language falls back to English; an unregistered id is refused without moving the active locale | PASS |
| L10N-08 | no dictionary entry is empty, so the plugin cannot defeat the fallback chain | PASS |
| L10N-09 | validation copy is localized **including the field name it quotes** (`端口 必须是整数` ↔ `Port must be at least 1`) | PASS |
| L10N-10 | the save and delivery-test states are localized end to end | PASS |
| L10N-10b | a host diagnostic is quoted verbatim in both languages while the frame around it switches | PASS |
| L10N-11 | `DSH`, `SMTP`, `TLS`, `STARTTLS` stay canonical in both dictionaries | PASS |
| L10N-11b | the mounted Chinese card shows `SMTP 服务器`, `隐式 TLS`, `STARTTLS` untranslated | PASS |
| L10N-11c | no required English string leaks into the Chinese card | PASS |
| L10N-11d | the Chinese card is not the English card with one heading changed | PASS |
| L10N-00 | the expansion state is never persisted | PASS |

L10N-07's fallback claim is bounded and stated as such: the harness's locale double implements the
**published** chain (active language → English → `common` → key) and the real service is exercised
in the browser (§8). What the tests prove is that this plugin's layer does not defeat that chain.

---

## 8. Real DSH Web verification

A disposable rc.2 profile was created from the shipped template and the packed tarball installed
into it:

```
dsh --profile mnv031 --from-default-profile web
dsh plugin --profile mnv031 add "file:…/dsh-mail-notify-0.3.1.tgz"
# installed version verified: 0.3.1
dsh --profile mnv031 --no-open --port 50777 --host 127.0.0.1
```

The profile's `package.json` records bundles `dsh-base`, `dsh-web-app`, `dsh-mail-notify` and the
dependency on the packed tarball. The instance was left in place for reproducibility; its server was
stopped after verification.

### English

| Step | Observed |
| --- | --- |
| Settings → Plugins → Plugin configuration | Card present, `aria-label="Mail notifications"` |
| Starts collapsed | `aria-expanded="false"`, no `[role="region"]`, **card height 60 px**, exactly 1 focusable element |
| Other settings immediately reachable | Terminal / Agent loop / Subagent / Web search cards all visible on the same screen as the collapsed card, no scrolling (screenshot) |
| Expand | Full English form: title, subtitle, description, Status, Questions and approvals, General, Notifications, SMTP, Credential, Message content, Delivery |
| Edit without saving | `SMTP host = smtp.retention-probe.example.com`, `Questions requiring input = On`; `Unsaved changes` badge appears |
| Collapse | `aria-expanded="false"`, region gone, summary reads `Mail notifications Active · SMTP configured · Questions on Unsaved changes ▸` (60 px) — matching the specified summary exactly |
| Collapse leaked nothing | The staged SMTP host is **absent from the collapsed card's markup** (`innerHTML.includes(...) === false`) |
| Re-expand | **Both drafts intact**, badge still present |
| Keyboard: real `Enter` | `aria-expanded="false"` → `"true"`; label `Expand: Mail notifications` → `Collapse: Mail notifications`; `aria-controls` equals the rendered region's id |
| Keyboard: real `Space` | `aria-expanded="true"` → `"false"`, height back to 60 px |
| Focus indicator | Visible focus ring rendered on the header (screenshot) |
| Overflow | Expanded card: `scrollWidth === clientWidth` (555 px) — no horizontal overflow |

### Simplified Chinese

| Step | Observed |
| --- | --- |
| DSH UI language 中文, card **mounted** and open | Card switched to Chinese **in place**, without a reload |
| Required strings | 邮件通知 (title and `aria-label`), 配置邮件通知, 状态, 常规, 通知类型, 需要用户回答, 需要用户批准, 发送测试邮件, 恢复继承值, 保存, 邮件内容, 发送与重试, SMTP 服务器, 安全连接, 隐式 TLS, STARTTLS all rendered |
| Summary | 运行中 · SMTP 已配置 · 提问通知已启用 with 展开: 邮件通知 as the accessible name |
| Human-attention emphasis | 需要用户回答 / 需要用户批准 render first and in their own bordered block, with the full Chinese descriptions |
| Overflow | None (`scrollWidth === clientWidth`) |
| English leakage | None in any field label, hint, group title, control, or message |

### Regression against real SMTP

The profile inherited the operator's real SMTP configuration (`smtp.163.com`, real recipient,
credential configured). No secret was read or displayed at any point.

| Step | Observed |
| --- | --- |
| `notifyQuestions` effective value | `On` (inherited, not written) |
| **Send test email** | Card reported `The SMTP server accepted the message for 1 recipient(s).`; **operator confirmed arrival** |
| Save `notifyQuestions=true` | Left at its existing effective value; no write was needed and none was made |
| Trigger a real `ask_user_question` | A real session asked `Colour?` with options Red and Blue; the session entered `Waiting for answer` |
| Question notification | The plugin's live queue counter moved to **`1 delivered · 0 failed`**, and the **operator confirmed the notification email arrived** |
| State restored | The staged probe edits were reverted with `Discard`; the form returned to the host's real values (`smtp.163.com`, `canghu…@foxmail.com`, `Questions requiring input = On`), and the disposable instance was stopped |

Mail arrival is the one claim that cannot be established from inside DSH, so it was confirmed
directly by the operator rather than inferred.

---

## 9. Final evaluation metrics

```
Task:        v0.3.1 collapse + Simplified Chinese
Result:      PASS

Model:       deepseek-v4.1-flash
Base:        v0.3.0 / b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4
Branch:      eval/deepseek-v4.1-flash-v0.3.1-ui
Final HEAD:  9e3fe46145b53bfa62a10f10a98ae2a1256c6f55
```

### Timing

```
wall time:   unavailable
```

The harness exposes no wall-clock counter, and the session's start timestamp was not captured in a
form that can be reported as a measurement. Not estimated.

### Tokens

```
input:    unavailable
cached:   unavailable
output:   unavailable
cost:     unavailable
```

No token or cost counter is exposed by this harness. Per the task's instruction, these are recorded
as unavailable rather than invented.

### Tool use

```
total calls:   unavailable as an exact count
failed calls:  unavailable as an exact count
```

Reported qualitatively instead, from the session transcript: **8 tool-level failures**, all
diagnosed and recovered within the session and all enumerated in §4 —

1. `git rev-parse v0.3.0^{commit}` — PowerShell mangled the caret expression (quoting fixed it).
2. `npm ci` absent in the fresh worktree, so the first baseline script run failed on `tsc`.
3. `npm install @deepseek-ai/dsh-client-test-runtime` — ERESOLVE, deliberately not forced.
4. Node type stripping on JSX — `ERR_INVALID_TYPESCRIPT_SYNTAX`.
5. `tsx` import of `LocaleRuntime` — the module does not export it.
6. `navigator` is a getter-only global in Node 24.
7. `React is not defined` inside `Card.tsx` under the test loader.
8. `check:text` mojibake after a PowerShell string round-trip on `controller.ts`.

Three further command invocations produced no useful output for environmental reasons (a
`Select-String` over a nonexistent path, and two `node --test` runs whose redirected output did not
settle) and were replaced rather than retried.

### Iterations

```
implementation/test cycles:      14 (enumerated in §4)
compile failures:                 9 (cycles 4, 7, 8, 13 plus five intermediate
                                    tsc runs during refactoring)
test failures:                    6 distinct assertions
                                    - COL-06, COL-07        synthetic keyboard activation cannot
                                                            trigger a native button
                                    - L10N-02               zh.secret.clear wording + missing
                                                            secret.set / secret.change
                                    - L10N-04b              group.status was never rendered
                                    - L10N-01 / L10N-02     the required 配置邮件通知 /
                                                            Configure email notifications string
                                                            had no home
runtime/browser failures:         0
incorrect API assumptions:        3
                                    - the DSH client test runtime's peer graph resolves
                                      0.1.5-rc.3 against this project's rc.2 pins
                                    - @deepseek-ai/dsh-client-locale/client exports no
                                      LocaleRuntime at runtime (loader envelope only)
                                    - a synthetic KeyboardEvent does not activate a native
                                      <button>
human interventions:              1 (mail-arrival confirmation, §8)
```

### Diff

```
production files changed:        10
test/harness/docs files changed: 13
total insertions:                3860
total deletions:                 263
production-code insertions:      1215
production-code deletions:       245
```

Production: `src/client/{Card.tsx, contracts.ts, controller.ts, fields.ts, index.tsx, message.ts,
locales/{index,en,zh,vocabulary}.ts}`.
Test/harness: `tests/client/{card-render,collapse,localization,fields}.test.ts`,
`tests/client/support/{dom,client-context}.ts`, `tests/package/tarball.test.ts`.
Other: `README.md`, `RELEASE_NOTES_V0.3.1.md`, `package.json`, `package-lock.json`,
`tsconfig.json`, `tsconfig.client.json`.

### Functional

| | |
| --- | --- |
| collapse | PASS — whole card, default collapsed, 60 px, semantic button, aria, pointer + Enter + Space, visible focus, no nested-control toggle |
| draft retention | PASS — boolean and text drafts, save result, test-email result, and credential draft all survive; toggling writes nothing |
| English | PASS — complete, no key rendered as text |
| Simplified Chinese | PASS — complete, exact required vocabulary, no English leakage, `SMTP`/`TLS`/`STARTTLS`/`DSH` canonical |
| locale switch | PASS — live, in place, including messages already on screen; reversible |
| notifyQuestions | PASS — real `ask_user_question` produced one delivered mail |
| test email | PASS — production mail path, SMTP accepted, arrival confirmed |

### Packaging

| | |
| --- | --- |
| build | PASS — `lib/client.js` 70.6 kB / gzip 20.62 kB |
| pack | PASS — `dsh-mail-notify-0.3.1.tgz`, 112 entries, sha512 `kUjoW5CA1GNR8…RPTG5hl95dmoA==` |
| real packed install | PASS — `pnpm add` of the tgz into a disposable rc.2 profile; installed version 0.3.1 |
| real Web smoke | PASS — English, Chinese, live locale switch, keyboard activation, draft retention, test email, question notification |

---

## 10. Branch integrity

| | |
| --- | --- |
| main modified | **no** — `main` is still `b352c91`; this branch was created from the tag in an isolated worktree |
| v0.3.0 modified | **no** — the tag object `2ee3141f…` still targets `b352c911…`; nothing was moved, deleted, or re-created |
| another model implementation inspected | **no** — `eval/gemini-3.8-flash-v0.3.1-ui`, `eval/gpt-5.6-sol-v0.3.1-ui`, and `eval/mimo-v2.6-flash-v0.3.1-ui` were never read, diffed, merged, or cherry-picked |
| rebase | **no** |
| force push | **no** |
| push | **no** |
| tag created | **no** — `v0.3.1` does not exist |
| release created | **no** |

The shared checkout remains on `eval/gemini-3.8-flash-v0.3.1-ui` at `aada8e8`; the experiment lives
entirely in the worktree `E:\Projects\DSHarness\dsh-mail-notify-ds41`.

---

## 11. Final git state

```
$ git status --short
(clean)

$ git log --oneline --decorate v0.3.0..HEAD
9e3fe46 (HEAD -> eval/deepseek-v4.1-flash-v0.3.1-ui) chore: bump version to 0.3.1 and prepare release notes
47ab4ef feat(client): make the settings card collapsible and fully localized
245407c feat: add a typed English and Simplified Chinese locale layer
d80051a test: establish the browser test harness for the v0.3.1 UI work

$ git diff --stat v0.3.0..HEAD
23 files changed, 3860 insertions(+), 263 deletions(-)
```

Commit SHAs:

```
d80051ad2aee468c5bf21041e68a4b6d917ca4c5  test: establish the browser test harness for the v0.3.1 UI work
245407c52826313efb1214f5e669f288c33250ea  feat: add a typed English and Simplified Chinese locale layer
47ab4efcfdc0c451293fdc71313c546080045262  feat(client): make the settings card collapsible and fully localized
9e3fe46145b53bfa62a10f10a98ae2a1256c6f55  chore: bump version to 0.3.1 and prepare release notes
```

---

## 12. Known limitations

Bounded, evidence-backed:

1. **Enter/Space activation is proven in the browser, not in Node.** A synthetic `KeyboardEvent`
   cannot trigger a native `<button>`'s activation behaviour, and no DOM library changes that. The
   Node tests therefore assert the precondition (native button, default action not cancelled, event
   delivered) and the browser test performs the real keypress. Stated rather than papered over.
2. **The Node locale tests run against a contract double, not DSH's shipped runtime.** Loading the
   real `LocaleRuntime` under Node would require installing `dsh-client-ui-primitives@0.0.1-rc.1`
   and `dsh-client-store@0.1.2-alpha.2` — neither exists at `0.1.5-rc.2`, and installing that family
   is precisely what this project's exact pins avoid. The plugin's side of the boundary is fully
   tested; DSH's side is verified in the browser.
3. **Token, cost, and wall-clock metrics are unavailable.** The harness exposes no such counters;
   none was estimated.
4. **L10N-07's "unknown locale" case is DSH's refusal, not a silent English render.** The service
   refuses to activate an unregistered locale id, so the only reachable fallback is a registered
   language for which this plugin shipped no dictionary — tested via a registered `fr` with no
   plugin dictionary. Both behaviours are asserted.
5. **The `tsx`, `happy-dom` development dependencies were added** to `devDependencies` only. They do
   not enter the tarball (verified: 112 entries, no `node_modules`) and the built bundle still
   requires exactly `react` and `react/jsx-runtime`.
6. **The disposable verification profile `mnv031` remains on disk** under `~/.dsh/profiles/`, holding
   a `file:` dependency on the packed tarball in this worktree. It is inert unless booted, and it is
   recorded here so it can be removed deliberately.
7. **`README.md` documents `group.status` and the expanded region table as shipped**, but no
   documentation file was rewritten for the collapse beyond the sections changed; the older phase
   reports under the repository root still describe the v0.3.0 card. They are historical records and
   were deliberately left untouched.

---

## 13. Recommendation

**v0.3.1 candidate readiness: YES.**

Both primary goals are implemented and independently verified: the card is a single disclosure that
starts collapsed at 60 px with correct semantics, full keyboard operation, no nested-control toggle,
and complete draft/result/credential retention; and the Web UI is completely localized in English
and Simplified Chinese through DSH's own locale service, including validation copy, action states,
and live language switching. Every v0.3.0 behaviour is preserved — proven structurally by
`cordis.patch.yml` and every host module being byte-identical to the base, and empirically by the
451 baseline tests still passing alongside 43 new ones, plus a real end-to-end mail regression
against live SMTP.

No tag was created and no release was published; that decision is the operator's.

**STOP.**
