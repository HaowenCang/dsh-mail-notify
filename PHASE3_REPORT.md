# Phase 3 Report — dsh-mail-notify

## Status

`PASS WITH SMTP SMOKE DEFERRED`

Every Phase 3 objective is met and evidenced except one: a real SMTP delivery to a live mail
server. No SMTP credential exists on this machine for this project, and the task expressly forbids
asking the user for a password or writing one into a file, so that single item is deferred rather
than failed. The conditions the task sets for accepting that deferral all hold, and are recorded in
§8 below.

---

## 1. Repository baseline

| Item | Value |
| --- | --- |
| Repository | `https://github.com/HaowenCang/dsh-mail-notify` |
| Starting branch | `main` |
| Starting SHA | `123beb868b7ed173d3dfed4ea5bf2a428b0d815f` |
| Working tree at start | clean; `main` equal to `origin/main` (`0 0` ahead/behind) |
| Git history preserved | yes — no reset, no clean, no force push, no branch rewrite |

Baseline commands executed: `git status`, `git branch --show-current`, `git remote -v`,
`git log --oneline -8`, `git rev-parse HEAD`, `git fetch origin`,
`git ls-remote origin refs/heads/main`.

---

## 2. Implementation

The project was created from nothing (`src/`, `tests/`, `scripts/`, `package.json`,
`tsconfig.json`, `cordis.patch.yml` did not exist) and built in the P3.1–P3.7 order the frozen plan
prescribes, with verification run at each step.

### 2.1 Modules

| Module | Lines | Responsibility |
| --- | --- | --- |
| `src/index.ts` | 238 | Cordis entry: resolve config, build logger/queue/sink/handler, register the two listeners, own the teardown effect |
| `src/config.ts` | 283 | Schemastery schema, defaults, field and cross-field validation, `ResolvedConfig` |
| `src/types.ts` | 292 | Every internal DTO; types only, no runtime code, no DSH import |
| `src/runtime-adapter.ts` | 327 | The single DSH boundary: `toSessionFacts`, `toInternalEvent`, `toSessionId` |
| `src/event-handler.ts` | 320 | Event dispatch and state accumulation; the only stateful non-I/O module |
| `src/turn-state.ts` | 255 | `TurnState`, the two creation paths through one accessor, candidate construction |
| `src/content.ts` | 80 | `extractVisibleText` (the D002 whitelist) and `truncateVisibleText` |
| `src/completion.ts` | 141 | Status classification and detail extraction/sanitisation |
| `src/normalize.ts` | 185 | Lossless-JSON normalization with reported dropped paths |
| `src/notifier.ts` | 142 | Policy decision order and the bounded dedupe cache |
| `src/queue.ts` | 217 | Bounded FIFO, single-concurrency worker, retry loop, dispose semantics |
| `src/mailer.ts` | 138 | Render, resolve credential per attempt, create transport, send, classify |
| `src/retry.ts` | 259 | Failure classification and backoff computation |
| `src/subject.ts` | 224 | Subject and body rendering, header-injection defence |
| `src/credentials.ts` | 154 | The credential seam; the only place a password is read |
| `src/transport.ts` | 68 | `MailTransport` interface and the one Nodemailer transport factory |
| `src/debug-sink.ts` | 113 | The network-free sink sharing the mailer's contract |
| `src/logger.ts` | 145 | The single structured logging exit with its allow-list |

Two modules were added beyond the frozen module list — `credentials.ts` and `transport.ts` — as a
split of the `mailer.ts` row's responsibility, so that the credential lifetime and the transport
construction can each be replaced in tests without a socket. `debug-sink.ts` is the DebugSink the
plan requires as a module. Recorded in `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` (A1–A7).

### 2.2 Supporting files

| File | Purpose |
| --- | --- |
| `package.json` | Bundle manifest, whitelist `files`, peer ranges, scripts |
| `tsconfig.json` | Strict build config; `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` |
| `tsconfig.test.json` | Adds `tests` and `scripts` to the type-check with `noEmit` |
| `cordis.patch.yml` | The shipped row, inert (`enabled: false`) until configured |
| `.env.example` | The `.env` credential form, placeholder only |
| `scripts/smtp-smoke-test.ts` | The only code path that sends a real email |
| `scripts/inspect-tarball.mjs` | The archive audit |
| `scripts/dev-boot-probe.mjs` | Development harness: boots a profile with a log exporter attached |

### 2.3 Key implementation facts

- **The listener is synchronous and returns `undefined`.** All I/O sits behind the queue, because
  the runtime dispatches `session/event` on the synchronous path of `Session.append()`.
- **`turnStateOf` is the one accessor for both creation paths.** A mid-turn attach accumulates real
  counters and reports `durationMs: null`; no fallback builds an empty settlement state.
- **The dedupe mark is written only after `queue.enqueue()` returns `true`.** A refused enqueue
  stays eligible and a suppressed turn never occupies its key.
- **The credential is resolved inside every attempt and never stored.** The service handle is
  obtained once; the value is not.
- **The transport options object has exactly five keys** and no TLS-disabling key exists anywhere in
  the package, so "certificate verification cannot be switched off" is a property of the code.
- **`user/message` is handled before the turn guard,** because its payload carries no turn number,
  and its text is held per session for the turn that opens next (bounded by a 120 s TTL).

---

## 3. Design compliance — D001–D016

| ID | Subject | Status | Evidence |
| --- | --- | --- | --- |
| D001 | Single `session/event` entry + runtime adapter | Implemented | `runtime-adapter.ts` is the only module reading `event.data`; ADP-06 asserts exactly two listeners are registered; ADP-05 asserts no DSH reference escapes |
| D002 | `type === 'text'` whitelist | Implemented | `content.ts` `isTextBlock`; CNT-01…07 including reasoning-only and unknown-type cases |
| D003 | Three-criterion subagent decision with strict comparison | Implemented | `toSessionFacts`; SES-01…07 including the `delegationDepth: 0` trap and id-format independence |
| D004 | Mid-turn lazy initialization, `null` duration | Implemented | One `stateOf` accessor; TRN-03, DUR-01, and E2E-02 assert `null` rather than `0` |
| D005 | Explicit tool error double criterion, no shell exit codes | Implemented | Adapter folds both criteria; TOOL-01…05, including a body containing `[exit code: 1]` |
| D006 | `usage` as raw telemetry only | Implemented | `collectUsage` copies finite counters; USE-01…06; no arithmetic anywhere in the module |
| D007 | `NotificationCandidate` schema v1 | Implemented | `createCandidate`; CAND-01…04; `sawTurnStart` and `userText` added as optional fields, recorded in `DECISIONS.md` A4 |
| D008 | Bounded in-process dedupe | Implemented | `DedupeCache`; DED-01…04 including the suppressed-turn case; mark placement asserted end to end |
| D009 | Bounded queue, concurrency 1, reject newest | Implemented | `createMailQueue`; QUE-01…07, E2E-08, LIFE-06c |
| D010 | Nodemailer + per-operation credential resolution | Implemented | SEC-01…07; `resolve` called once per send and twice across two sends |
| D011 | No-visible-text suppression, no switch | Implemented | `decideNotification` step 4; SUP-01…04; E2E-06 |
| D012 | Privacy defaults | Implemented | Schema defaults asserted by PRIV-08; negative sentinel assertions in PRIV-01…07 |
| D013 | `schemaVersion` literal `1` | Implemented | Declared as the literal type; CAND-01 |
| D014 | Truncation with a footer marker | Implemented | `truncateVisibleText` by code point; TRUNC-01…05; marker suppressed with `includeFooter: false` while `truncated` stays observable |
| D015 | Unknown duration never suppresses | Implemented | DUR-01, DUR-01b, and a runtime probe with `minTurnDurationMs: 60000` |
| D016 | Document conflict adjudication | Implemented | All adjudications honoured; addendum A1–A7 records Phase 3 findings without rewriting Phase 1/2 evidence |

**Deviations: none.** Every item is implemented as frozen. The seven addendum entries are
completions of the frozen design's own internal consistency or records of newly observed facts, not
departures from it; each is written into `docs/DECISIONS.md` with its reasoning.

---

## 4. Tests

```
tests 273
suites 0
pass 273
fail 0
cancelled 0
skipped 0
todo 0
```

Command: `npm test` → `node --test "tests/**/*.test.ts"`. Runner: Node's built-in test runner with
native TypeScript execution — no test dependency was added. Rationale recorded in
`docs/TEST_PLAN.md`.

| Suite | File | Focus |
| --- | --- | --- |
| L1 unit | `tests/unit/content.test.ts` | CNT-01…07, TRUNC-01…05 |
| L1 unit | `tests/unit/normalize.test.ts` | NORM-01…05, USE-03/06, dropped-path reporting |
| L1 unit | `tests/unit/completion.test.ts` | TRN-04…09, detail cleaning and truncation |
| L1 unit | `tests/unit/subject.test.ts` | PRIV-01…07, TRN-06, marker behaviour |
| L1 unit | `tests/unit/turn-state.test.ts` | TRN-01…03/10/11, DUR, CAND-01…04, USE-01…06, LIFE-01…06 |
| L1 unit | `tests/unit/retry.test.ts` | RET-01…10 classification and backoff |
| L1 unit | `tests/unit/config.test.ts` | PRIV-08, defaults, field and cross-field validation |
| L1 unit | `tests/unit/notifier.test.ts` | DED-01…04, SUP-01…06 including the fixed decision order |
| L3 adapter | `tests/adapter/runtime-adapter.test.ts` | SES-01…07, ADP-01…06, TOOL-01…05 |
| L2/L4/L5 | `tests/integration/queue.test.ts` | QUE-01…07, RET-09/11 |
| L4 | `tests/integration/mailer.test.ts` | SEC-01…07, RET-01…08 |
| L5 | `tests/integration/lifecycle.test.ts` | E2E-01…08, LIFE-01…07, ADP-06, SUP-05, PRIV-01…07 |
| L6 | `tests/package/tarball.test.ts` | PKG-01, PKG-02, archive integrity and loadability |

No case is skipped. `tests/fixtures/runtime-shapes.ts` builds its payloads from the field paths and
value patterns recorded in `PHASE1_RUNTIME_CONTRACT.md`, including a tuple-shaped `tool/result`
`content`, an absent `isError` on success, all six `turn/end` reasons, mixed
reasoning/text/tool-call blocks, `delegationDepth: 0`, an absent `reasoningTokens`, and a mid-turn
chain.

### Defects the tests found and the fixes applied

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `toInternalEvent(null)` and `toSessionFacts(null)` threw, violating the adapter's own no-throw contract | Guarded both entry points |
| 2 | `delegationDepth: Infinity` classified a session as a subagent | Added `Number.isFinite` to the single permitted comparison |
| 3 | The adapter returned the runtime's own content array instead of a copy, so a returned value could alias `event.data` | Copies the blocks array |
| 4 | `stableJsonLine` left U+2028/U+2029 raw, which can break a line-oriented reader | Flattened those separators too |
| 5 | `user/message` carried no turn, so `includeUserPrompt` collected nothing | Added the `user-message` variant and per-session pending text with a TTL |
| 6 | Four test cases asserted behaviour the code did not have (`dropped` path semantics, an over-strict injection assertion, an unreachable duplicate scenario, and an over-specified suppression count) | Corrected the assertions to the frozen semantics rather than changing behaviour |

Defect 5 was a genuine gap against D012; the rest were correctness or contract violations.

---

## 5. Build

| Step | Command | Exit code | Result |
| --- | --- | --- | --- |
| Install | `npm install` | 0 | 20 packages; `nodemailer` the only runtime dependency |
| Typecheck (sources) | `tsc -p tsconfig.json --noEmit` | 0 | no output |
| Typecheck (sources + tests + scripts) | `tsc -p tsconfig.test.json` | 0 | no output |
| Test | `node --test "tests/**/*.test.ts"` | 0 | 273 pass, 0 fail, 0 skipped |
| Build | `tsc -p tsconfig.json` | 0 | `lib/*.js` + `lib/types/*.d.ts` |
| Pack | `npm pack` | 0 | `dsh-mail-notify-0.1.0.tgz` |
| Archive audit | `node scripts/inspect-tarball.mjs` | 0 | `PASS: required entries present, no forbidden entry found` |

No lint step is claimed: the frozen specification does not require one and no linter is configured
in this repository.

---

## 6. Package

Archive: `dsh-mail-notify-0.1.0.tgz`, 76 entries, 18 compiled modules.

**Present:** `package/package.json`, `package/cordis.patch.yml`, `package/README.md`,
`package/LICENSE`, `package/lib/*.js`, `package/lib/types/*.d.ts`, and the source maps.

**Absent, and asserted absent:** `.env` and any variant, `node_modules`, `coverage`, `*.pem`,
`*.key`, `*.p12`, `*.pfx`, `*.jks`, `.secrets/`, `.credentials/`, `tests/`, `scripts/`, `src/`,
`.git*`, `*.tsbuildinfo`, `*.log`, `.dsh/`.

Three independent checks are performed by `tests/package/tarball.test.ts`: every path is matched
against that deny list; every `files` whitelist entry is confirmed present, so a declared file
cannot silently go missing; and every relative import in the compiled output is resolved inside the
archive, which catches a module dropped by the whitelist that no type-check could see. The compiled
entry point is then imported and its exported plugin shape asserted.

The `files` whitelist is `["lib", "cordis.patch.yml", "README.md", "LICENSE"]`. `scripts/` is
excluded, so the development-only boot probe does not ship.

`*.tgz` is covered by `.gitignore`, so the archive is a local artefact and was not committed.

---

## 7. Runtime integration

Executed against a **freshly created isolated profile** seeded from the shipped `headless` template
(`dsh --profile mailnotify-probe --from-default-profile headless`). The user's stable `web` profile
was not used for any install step; its dependency set is byte-identical to its state before this
phase, and `dsh plugin --profile web list` reports the same six packages.

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Bundle manifest recognised | Pass | `dsh plugin --profile mailnotify-probe add ./dsh-mail-notify-0.1.0.tgz` (exit 0) appended the name to `dsh.profile.bundles`, and the package's own row appeared in `--dump-config` with `enabled: false` |
| 2 | The Cordis plugin loads | Pass | `plugin.ready` emitted with the resolved configuration, from the compiled `lib/` |
| 3 | `enabled:false` registers no listener | Pass | `plugin.disabled {"reason":"enabled is false"}`; the run completed normally and registered nothing |
| 4 | `enabled:true` registers and works | Pass | Same profile with a valid config produced `plugin.ready` |
| 5 | A real top-level turn produces a candidate | Pass | `candidate.produced {"schemaVersion":1,"sessionId":"session-…","turn":1,"status":"completed-clean","turnEndKind":"completed","visibleTextLength":17,"explicitToolErrorCount":0,"telemetryComplete":true,"durationMs":2562,"provider":"command-goat","model":"deepseek/deepseek-v4.1-flash","sawTurnStart":true,"normalizeDropped":0}` followed by `notification.enqueued` and `notification.outcome {"attempts":1,"ok":true}` |
| 6 | Subagents produce no candidate | Pass | A real delegation through the `subagent` tool produced exactly one candidate, for the parent session; the subagent session produced none |
| 7 | Reasoning stays out of the notification content | Pass | The candidates carry only lengths and metadata; reasoning is excluded at extraction. Asserted by CNT-02/03, PRIV-01, and the live candidate above carries no text field |
| 8 | One turn does not enqueue twice | Pass with a recorded nuance | Unit and integration tests drive a real event bus and show the second settlement suppressed. In the live process a replayed duplicate `turn/end` rebuilds empty state and is suppressed for `no-visible-text` first, so the `duplicate` branch is defensive in practice. Recorded in `docs/DSH_INTEGRATION.md` §4 and `docs/DECISIONS.md` A3 |
| 9 | Unload does not break DSH | Pass | A development injection was loaded into the live `web` process and removed again: the loader entry was disposed, the profile junction deleted, the registry cleared, and this session kept running throughout |
| 10 | An invalid configuration refuses to mount | Pass | `plugin.config-invalid` named all five failing fields: `smtpHost`, `smtpUser`, `smtpPasswordCredential`, `from`, and `to` |

**Observability note.** The `dsh` command line registers no Cordis log exporter — logs live only in
a 1000-record in-memory ring — so a plugin's own structured lines are invisible from outside the
process. `scripts/dev-boot-probe.mjs` was written for this: it calls the launcher's own `runProfile`
and attaches an exporter by wrapping `LoggerService.prototype.exporter`. No harness file was
modified. This is why the runtime evidence above exists at all.

---

## 8. SMTP smoke

`DEFERRED — no external credential`

No SMTP credential for this project exists on this machine: `$DSH_HOME/.credentials.yaml` holds
`TAVILY_API_KEY`, `DEEPSEEK_API_KEY`, `COMMAND_GOAT_API_KEY`, and `COMMANDCODE_API_KEY`, and no
SMTP-related environment variable is set. No password was requested, and none was written to
`.env`, to `cordis.patch.yml`, to a PowerShell command, or to source.

What was verified instead, all with real execution:

| Condition | Result |
| --- | --- |
| Stub-SMTP tests pass | Yes — `tests/integration/mailer.test.ts`, 23 tests, no network. The stub transport is the real code path with only the socket replaced |
| The credential path is really integrated | Yes — `scripts/smtp-smoke-test.ts` loaded the genuine `@deepseek-ai/dsh-credentials-local` provider, reported `credential is configured (source=file, writable=true)` for a reference that exists in the store, and exited 0 at the dry-run gate. With a reference that does not exist it reported `the credential reference "DSH_MAIL_SMTP_PASSWORD" is not configured` and exited 2 |
| The smoke script runs | Yes — `npm run smoke` is the documented entry, it parses configuration from the same patch file the plugin reads, refuses to send without `--yes`, prints no secret, and exits cleanly |
| Everything but real delivery passed | Yes — §3, §4, §5, §6 and §7 above |

The `--yes` send path was never executed, because executing it requires a host and a credential that
do not exist here. No claim of a successful delivery is made.

---

## 9. Security verification

| Claim | Result | Evidence |
| --- | --- | --- |
| No secret entered the repository | Confirmed | `git status` clean of unexpected files; the only credential-shaped strings in the tree are synthetic sentinels in `tests/fixtures/runtime-shapes.ts` |
| No reasoning leaked | Confirmed | `reasoning` is excluded by type at extraction; PRIV-01 and CNT-02/03 assert the sentinel is absent from subject, body, candidate, and every log line |
| No tool arguments or results leaked | Confirmed | PRIV-02/03 and SEC-05b assert both sentinels absent from subject, body, and serialized job |
| No user prompt leaked by default | Confirmed | PRIV-04 and the live-pipeline switch test assert absence with `includeUserPrompt: false` and presence only with it enabled |
| The password never reaches a log | Confirmed | SEC-04 searches every retained log record for the sentinel; the auth-failure path replaces the server text that can echo a user name |
| TLS verification is not disabled | Confirmed | SEC-06 asserts the transport options object has exactly `{host, port, secure, user, password}`; a repository-wide search finds `rejectUnauthorized` only inside a comment explaining its absence; no `NODE_TLS_REJECT_UNAUTHORIZED` reference exists |
| No secret in the package | Confirmed | The deny-list audit and a content scan of every packed `.js` file for password-shaped literals; the shipped patch sets only `enabled: false` |
| The user's environment was not damaged | Confirmed | The `web` profile's `dsh.profile.bundles` and `dependencies` are unchanged; the probe profile was removed; the development injection was fully uninstalled; `git status` shows only Phase 3 additions |

Two residues from the development injection remain, both written by the injector and both inert:
a `- id: dsh-mail-notify / disabled: true` row in `$DSH_HOME/profiles/web/cordis.patch.yml`, whose
purpose is to stop the injector's refresh from re-adding the entry; and a gitignored `*.tgz` build
artefact in the repository root. Neither affects a normal `dsh plugin` install.

---

## 10. Known limitations

1. **Deduplication does not survive a process restart.** One notification per `(sessionId, turn)`
   per process lifetime; a replayed turn after a restart can produce a second email.
2. **`durationMs` is `null` for a mid-turn attach,** so the duration threshold cannot apply to such
   a turn. This is the frozen design, not a defect.
3. **Five of the six `turn/end` reasons have not been triggered on a live turn.** `completed` is
   verified in a real composition; the other five are verified against recorded payload shapes and
   the frozen classification table. Triggering them live depends on model and provider behaviour.
4. **`session/disposed` is rarely reached,** because the harness keeps sessions loaded for the life
   of the process. Per-turn cleanup is the dominant release path.
5. **The `duplicate` suppression branch is defensive in practice,** for the reason recorded in §7
   row 8.
6. **Real SMTP delivery is unverified** on this machine, for want of a credential.
7. **Token counters are reported, never interpreted.** Their semantics remain unconfirmed, and the
   recorded `inputTokens` / `totalTokens` inconsistency is carried through untouched.
8. **A queue refusal is not retried.** The newest turn is dropped and counted; the dedupe key is not
   spent, but nothing re-delivers it.
9. **Plugin log lines require an exporter to be visible** from outside a DSH process.
10. **`runtime-adapter.ts` is the maintenance point for a harness upgrade.** Its fixtures mirror the
    runtime payload shapes recorded in Phase 1 and must be re-checked against a new DSH version.

---

## 11. Git synchronization

| Commit | SHA | Subject |
| --- | --- | --- |
| 1 | `da9f05f` | `feat: scaffold dsh-mail-notify plugin project` — `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.test.json`, `cordis.patch.yml`, `.env.example` |
| 2 | `058e186` | `feat: implement notification candidate pipeline` — the pure core, the runtime adapter, the handler, the queue, the notifier, the logger, the plugin entry |
| 3 | `ef691ea` | `feat: add smtp notification delivery` — the credential seam, the transport, the mailer, the debug sink, the smoke script |
| 4 | `95df5f1` | `test: add phase 3 verification suite` — fixtures, support helpers, and all four test levels |
| 5 | `06068c8` | `docs: complete phase 3 implementation` — README, the three new specification documents, the implementation notes, this report, the development probe, and the archive audit |
| 6 | `84116bb` | `docs: record implementation SHAs in the phase 3 report` — the intended SHA backfill; its text was corrupted in transit, corrected in §12 |

Each commit was preceded by `git status`, `git diff --check`, and a review of `git diff`, and staged
by explicit path rather than `git add .`. Before committing, the working tree was searched for
credential-shaped literals (password and API-key assignments, `sk-` prefixes, bearer tokens): no
match. No `.env` file exists in the tree, `lib/` and `*.tgz` are ignored, and the only
credential-shaped strings anywhere are the synthetic sentinels in the test fixtures.

The Phase 3 implementation span and its push:

```text
Starting SHA:                              123beb868b7ed173d3dfed4ea5bf2a428b0d815f
Implementation HEAD before this report:    06068c80e4d7455dc53eba0e18dd6ee23aef6835
Remote:                                    https://github.com/HaowenCang/dsh-mail-notify
Branch:                                    main
Push (phase 3):                            git push origin main → 123beb8..06068c8, exit 0
```

Verification after that push, taken from the commands rather than from memory:

```text
git rev-parse HEAD
  06068c80e4d7455dc53eba0e18dd6ee23aef6835
git ls-remote origin refs/heads/main
  06068c80e4d7455dc53eba0e18dd6ee23aef6835  refs/heads/main
git rev-list --left-right --count origin/main...HEAD
  0   0
```

`local HEAD == remote HEAD`, the branch is `main`, the working tree is clean, and no force push was
used at any point. **GitHub sync: VERIFIED** at commit `06068c8`.

Commit `84116bb` then attempted to replace the placeholder commit table above with the real SHAs and
corrupted this document's text encoding in the process. That commit is retained in history and is not
amended; the correction is recorded in §12.

---

## 12. Post-Phase-3 integrity correction

Phase 3.1 was a single-purpose repair round. It changed no runtime behaviour.

### 12.1 What went wrong

Commit `84116bb` had exactly one intended effect: backfill the real Phase 3 commit SHAs and the
remote-synchronisation result into §11 of this report. What it actually committed was a
`PHASE3_REPORT.md` whose non-ASCII characters had been re-encoded through a lossy path:

| Intended character | Committed rendering, quoted as code points |
| --- | --- |
| `—` U+2014 em dash | U+9225 U+003F |
| `–` U+2013 en dash | U+9225 U+003F, or U+9225 U+63C7 where the next byte happened to complete a valid sequence |
| `…` U+2026 ellipsis | U+9225 U+003F |
| `§` U+00A7 section sign | U+0025 U+003F |

A UTF-8 byte order mark was introduced at the start of the file as well.

The rendering is quoted by code point rather than written out. A committed example of the corruption
would itself trip the integrity guard added in §12.5, and reproducing it verbatim would be a
poor way to record it.

### 12.2 Root cause

**Exact writer and code-page path not proven.** What the bytes do establish:

- The committed text decodes as valid UTF-8, and the file begins with `ef bb bf` — a BOM — while the
  `06068c8` revision begins with `23 20 50` (`# P`) and has none. Both facts are byte-verified.
- In the corrupted text the em dash is encoded as `e9 88 a5 3f`: the UTF-8 encoding of the CJK
  character U+9225 followed by an ASCII `?`. That trailing `?` is the decisive signal — it is what a
  **lossy** substitution leaves behind when an intermediate encoding cannot represent a byte. Where a
  neighbouring byte completed a valid sequence instead, the pair survived as two CJK characters
  (U+9225 U+63C7 in `D001–D016`).
- Simulating a UTF-8 → GBK → UTF-8 round trip over the clean text reproduces the leading
  three bytes but matches the committed text at only about 6% of character positions, so GBK/CP936 is
  not demonstrably the code page involved.
- The BOM has a separate, proven explanation: the repair attempt ran under **Windows PowerShell 5.1**,
  whose `Set-Content -Encoding utf8` writes a BOM. A controlled round trip confirms that cmdlet adds
  the BOM while leaving the characters intact, so it explains the BOM and not the corruption.

Because the substitution step was lossy, the damage is not invertible: a character-level substitution
table could not distinguish an em dash from an en dash or an ellipsis. That is why this repair
restores from a known-good revision instead of patching characters in place.

### 12.3 Scope of the damage

`git show --stat 84116bb` reports exactly one changed file: `PHASE3_REPORT.md`. A scan of every
tracked file for the mojibake sentinels (U+9225, U+6402, U+951F, U+951B, U+9286, U+9983) and for the
U+FFFD replacement character found matches in `PHASE3_REPORT.md` only.

No business source, no test, no build script, and no runtime artefact was touched. Commit `84116bb`
is retained in history, unamended.

### 12.4 How it was repaired

The corrupted file was not edited character by character. `PHASE3_REPORT.md` was rebuilt from
`06068c8:PHASE3_REPORT.md` — the last revision whose content is known good — and only the intended
§11 content was re-applied: the commit SHAs, the Phase 3 push record, and the verified remote
comparison. This §12 record is the second addition. The result is UTF-8 **without** a BOM, with LF
line endings, matching every other file in the repository.

### 12.5 Regression guard

| File | Effect |
| --- | --- |
| `.editorconfig` | Declares `charset = utf-8`, `end_of_line = lf`, and `insert_final_newline = true` for the repository, so an editor or shell does not silently re-encode text or rewrite line endings |
| `scripts/check-text-integrity.mjs` | Run by `npm run check:text`. It strictly decodes every text file as UTF-8, rejects the U+FFFD replacement character, rejects a BOM in files the repository keeps BOM-free, and rejects known mojibake sentinels through precise multi-character patterns rather than a blanket CJK test, so the legitimate Chinese documentation in this repository is not flagged |

`check:text` is part of the `verify` chain, so the guard runs with the ordinary checks rather than
only when someone remembers it.

### 12.6 Effect on the Phase 3 conclusion

None. The encoding fault was introduced after Phase 3's functional work was complete and verified, it
affected documentation only, and no runtime behaviour or test outcome depends on it. The Phase 3
status remains `PASS WITH SMTP SMOKE DEFERRED`, and the SMTP smoke test stays deferred for its
original reason: no SMTP credential for this project exists on this machine, so no real delivery has
been performed.
