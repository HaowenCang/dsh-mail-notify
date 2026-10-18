# 05 — Host-assembly probe matrix: `dsh-mail-notify@0.5.1` on isolated DSH `0.2.1-rc.2` (C4-C)

**Task:** C4-C (probe-verifier). **Repo branch:** `compat/dsh-0.2.1-rc.2`.
**Verdict: PASS for the C4-C scope** — the full real-assembly probe matrix (13 scenarios) passes on an
isolated **DSH `0.2.1-rc.2`** host against the **FINAL** candidate artifact
`dsh-mail-notify-0.5.1.tgz`, SHA-256 `BFB91D4F91F004EF590FD2E4758CC41BF13BB65F0BB06A1ED3F03AEC85A2F6FF`.
No assertion was weakened and no plugin code was touched. Two **test-harness adaptations** were required by
the target host — approved by the Lead, committed as `2a5063b`, and documented in §3 — because
DSH `0.2.1-rc.2`'s shipped `headless` bundle newly disables the interactive credential store, and because the
mandated isolation root lives outside the checkout that `probe:host-write` was written to run under.
One telemetry-coverage limitation is recorded in §6; the host-profile consequence for real headless users is
recorded in §8.

| | |
|---|---|
| OLD host (previous line) | DSH `0.2.0-rc.2` — the host `V0.5.0_COMPAT_REPORT.md` §14 was produced on |
| NEW host under test | DSH `0.2.1-rc.2`, isolated install root `E:\Projects\DSHarness\_phase051-compat\host` |
| Candidate artifact | `E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.1.tgz` — 204 061 bytes, 113 files, SHA-256 `BFB91D4F…F6FF` |
| Artifact under test | installed into every scenario's disposable profile through the real `dsh plugin --profile … add`; installed copy reported `0.5.1`, `engines.dsh: 0.2.1-rc.2`, no `compatibility.json`, no exemption |
| Probe root | `E:\Projects\DSHarness\_phase051-compat\verify-probes` (evidence); per-scenario trees `…\scenarios\<scenario>` |
| Profiles | non-shipped `mail-notify-v051-*` names, created from the shipped `headless` template by the launcher |
| Scripted inputs | model tokens (`scripts/probe/scripted-provider.mjs`), the human (`auto-answer` / drivers), loopback SMTP on an OS-chosen port. Real: agent loop, tool registry, session log, `ctx.questions`/`ctx.approval`, credential store, the plugin's listeners/queue/mailer, the SMTP conversation |
| Matrix command surface | `npm run probe:*` aliases, executed as their underlying `node scripts/…` command (§1.2) |
| Date | 2026-10-17 (America/Los_Angeles) |

---

## 1. Method, pinning and isolation

### 1.1 What the probes prove

Each scenario boots a real profile from the shipped `headless` template inside a fresh disposable
`DSH_HOME` under the isolation root, installs the packed artifact through the real plugin manager, applies one
generated overlay, and runs one scripted task. It then reports what the loopback SMTP server actually received,
plus the harness timeline. The plugin is loaded the ordinary way from the profile's bundle list; the three
substituted things are named in every run's output: the model's tokens, the human, and the SMTP peer's identity.

### 1.2 Invocation: `node scripts/…`, not `npm run …`

The npm aliases and the underlying commands are identical (`package.json`): e.g.
`probe:questions` = `node scripts/probe-e2e.mjs questions "probe: question notification"`. The matrix was
launched through the underlying `node` command rather than `npm run`, because **npm prepends
`<repo>/node_modules/.bin` to `PATH` for script children**, and that directory contains a `dsh` shim (the
checkout's peer-installed launcher). The task requires the isolated host's `dsh` to be **first** in `PATH` for
every invocation, so running through npm would have silently resolved `dsh` from the checkout instead of
`E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin`. The difference was verified before committing
to the method: `where.exe dsh` under the pinned environment lists the host launcher first
(`…\host\node_modules\.bin\dsh`, `…\dsh.cmd`, then the operator global `C:\Users\20659\AppData\Roaming\npm\dsh`,
which is `0.2.0-rc.2`). Every scenario is run by one reusable wrapper
(`…\verify-probes\run-scenario.ps1`) that sets the environment, records the proofs below, runs the probe with
complete stdout+stderr capture, and re-records the artifact hash and proofs afterwards.

### 1.3 Environment pinning — proven before and after every scenario

The wrapper writes these facts into each scenario's runner log (`…\verify-probes\logs\<scenario>.log`)
**before** the run and repeats the relevant ones **after** it:

| Fact | Value (every scenario) |
|---|---|
| `PATH[0]` | `E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin` |
| `where dsh` (first 3) | host `dsh`/`dsh.cmd`, then global `C:\Users\20659\AppData\Roaming\npm\dsh` (never used) |
| `DSH_INSTALL_ROOT` | `E:\Projects\DSHarness\_phase051-compat\host` |
| `dsh --version` (before and after) | `0.2.1-rc.2` |
| host `@deepseek-ai/dsh` / `dsh-app-boot` package versions | `0.2.1-rc.2` / `0.2.1-rc.2` |
| shell `DSH_HOME` | `…\verify-probes\_env\shell-home` (under the isolation root; probes override it per child) |
| artifact SHA-256 pre / post | `BFB91D4F…F6FF` / `BFB91D4F…F6FF`, `unchanged=True` |

Additional launcher-version proof: `…\verify-probes\version\launcher-modules-proof.log` imports the exact module
the boot probe imports — `importHarness`-style `<DSH_INSTALL_ROOT>/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`
— and records `app-boot version from the imported install tree: 0.2.1-rc.2`, `boot() exported: true`.
The boot probe (`scripts/dev-boot-probe.mjs`) resolves every harness module through `DSH_INSTALL_ROOT` in the
same way (its `importHarness()` tries `<root>/node_modules/@deepseek-ai/<pkg>` first, exactly the layout the
isolated host uses). A profile does not carry its own `dsh-app-boot` copy — the launcher always supplies harness
modules from the install root — so the profile-side version evidence is different and also present: the
credential contract printed inside every e2e scenario reports the installed
`dsh-credentials 0.2.1-rc.2` and `dsh-credentials-local 0.2.1-rc.2`, and each profile's `package.json`/`pnpm-lock.yaml`
records the exact candidate tarball plus `installed plugin version: 0.5.1` / `engines.dsh: 0.2.1-rc.2`.

### 1.4 Isolation

- Every writable DSH path lives under the isolation root: probe tree, `DSH_HOME`, credential document, session
  store, profile, plugin-manager logs, SMTP receipts and probe artifacts. Each scenario starts from a
  guarded, freshly deleted-and-recreated `…\scenarios\<scenario>` (the guard refuses a delete whose resolved
  path is not under `…\verify-probes\scenarios\`).
- `C:\Users\20659\.dsh` was never used as `DSH_HOME`: every `dsh` invocation in every runner log records the
  disposable home, and no probe writes outside its own tree. The only fixture outside the per-scenario tree is
  the untracked `…\verify-probes\node_modules\@deepseek-ai` junction described in §3.3.
- SMTP is loopback-only (`127.0.0.1`, OS-chosen port, no TLS, no auth, no relay); every recipient is
  `recipient@example.invalid`; the SMTP password is synthetic and lives only in the disposable credential
  document; the model is scripted and reports no external calls.
- No `allow-version` / `--accept-risk` / compatibility exemption was used or created anywhere.

---

## 2. Artifact

| Property | Value |
|---|---|
| File | `E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.1.tgz` |
| SHA-256 | `BFB91D4F91F004EF590FD2E4758CC41BF13BB65F0BB06A1ED3F03AEC85A2F6FF` (FINAL; recorded pre **and** post in every scenario log) |
| Size / entries | 204 061 bytes / 113 files |
| Installed copy | `0.5.1`, `engines.dsh: 0.2.1-rc.2`, peers `dsh-credentials`/`dsh-session` exact `0.2.1-rc.2`; installed through the real CLI, no `compatibility.json`, no exemption |
| Rebuilt? | Never. The artifact was not rebuilt, repacked, or edited by this task. |

Timeline of the candidate under test: the Lead replaced the first candidate
`50FE12B384A0541487F5C237A91D1FEA898DD84D2B9456B219E6D778CA383000` (204 061-byte predecessor, 203 187 bytes)
with the FINAL artifact during the work. The matrix that this report certifies was re-run end-to-end against the
FINAL hash after the replacement; the earlier `50FE…` runs are kept, clearly labelled, under
`…\verify-probes\preliminary-50FE-evidence\` (their scenario dirs plus runner logs), and the pre-harness-fix
runs (see §3.1) under `…\verify-probes\pre-fix-evidence\`. The superseded
`D6383C83…110BF` artifact was never part of a delivered result; its one run was deleted before any reportable
evidence was produced.

---

## 3. Host-assembly delta and the approved harness adaptations

### 3.1 The delta: `0.2.1-rc.2`'s `headless` bundle disables the credential store

Source evidence, exact tags (`E:\Projects\DSHarness\dsh-v0.2.0-rc.2-source`):

```
$ git diff dsh-v0.2.0-rc.2 dsh-v0.2.1-rc.2 -- packages/bundle/headless/cordis.patch.yml
@@ -32,3 +31,13 @@
 - id: hmr
   disabled: true
+
+# One-shot jobs use launch-time credentials instead of the interactive store.
+- id: credentials
+  disabled: true
+
+- id: authorization
+  disabled: true
+
+- id: deepseek-account
+  disabled: true
```

`0.2.0-rc.2` has no such rows; the shipped headless profile kept the interactive store. `0.2.1-rc.2`'
`@deepseek-ai/dsh-headless` README §"Credentials" documents the change as intended and gives the restore recipe:

> The shipped headless profile disables the managed credential store and its authorization and DeepSeek account
> consumers. … To restore stored authentication, add these rows to
> `$DSH_HOME/profiles/headless/cordis.patch.yml` or a `--patch` overlay: `- id: credentials / disabled: false` …

The probe overlays retargeted the `credentials` row's config but never re-enabled it, so the composed profile had
**no Credential service at all**. The plugin correctly refused: `notification.outcome … "ok":false,
"category":"credential-missing"` and `probe-credential-contract … pending (waiting for service: credentials)`.
Composed `--dump-config` before the fix, verbatim:

```
# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-headless, <probe overlay>
- id: credentials
  name: '@deepseek-ai/dsh-credentials-local'
  disabled: true
  config: { path: <probe home>\.credentials.yaml, watch: true }
```

**Pre-fix evidence (kept):** first matrix run `questions` → probe exit **1**, child exit 0,
`messages received: 0`, `credential contract: NO REPORT WRITTEN`;
full run log `…\verify-probes\pre-fix-evidence\questions.runner.log` and scenario tree
`…\verify-probes\pre-fix-evidence\questions\`. This is a harness/composition incompatibility on the 0.2.1 host,
not a plugin-code failure: the plugin activated and the gate admitted it, and its refusal is the designed
fail-safe for a missing credential service.

### 3.2 Adaptation 1 — restore the credential row in the two mail probes (committed `2a5063b`)

`scripts/probe-e2e.mjs` (`writeOverlay`) and `scripts/probe-live-policy.mjs` (its overlay generator) now emit the
host-documented restore row, still retargeting the store to the disposable home:

```diff
     '- id: credentials',
+    '  disabled: false',
     '  config:',
     `    path: ${JSON.stringify(paths.credentialsFile)}`,
     '    watch: true',
```

plus a comment naming the source (`dsh-headless` README, "Credentials"; the `disabled: true` rows added after
`dsh-v0.2.0-rc.2`). No assertion, scenario script, scripted provider, SMTP server, or plugin file changed. After
the fix the composed dump shows the effective row enabled with the probe's path (evidence
`…\scenarios\questions\out\dump-config-questions.log`):

```
- id: credentials
  name: '@deepseek-ai/dsh-credentials-local'
  disabled: false
  config:
    path: >-
      E:\Projects\DSHarness\_phase051-compat\verify-probes\scenarios\questions\home\.credentials.yaml
    watch: true
```

### 3.3 Adaptation 2 — `probe:host-write` package resolution and an isolation-root fixture (committed `2a5063b`)

`probe:host-write` composes the app itself instead of using the launcher, and it used to locate the shipped
credential provider through two hard-coded path guesses: first the checkout tree, then the pre-0.1.7 **nested**
install layout (`<DSH_INSTALL_ROOT>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-credentials-local`).
On the isolated host both guesses miss: the checkout has no `dsh-credentials-local`, and the isolated 0.2.1 host
is a **flat** npm install (the real path is
`<host>\node_modules\@deepseek-ai\dsh-credentials-local\lib\index.js`). The probe therefore died before any
write-path assertion. Fixed by adopting the project's shared resolver, which exists precisely because "a probe
that assumed either layout would report a missing package, and a missing package reads exactly like a failed
contract" (`scripts/probe/dsh-modules.mjs` header):

```diff
-import { boot, loadLayeredEnv, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
+import { boot, loadLayeredEnv, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
+import { packageDirectory } from './probe/dsh-modules.mjs'
…
 function resolveCredentialsEntry() {
-  const candidates = [ …checkout…, …nested install… ]
-  const found = candidates.find((candidate) => existsSync(candidate))
-  if (found === undefined) throw new Error( …cannot locate… )
-  return found
+  return join(packageDirectory('dsh-credentials-local'), 'lib', 'index.js')
 }
```

The probe now loads `dsh-credentials-local@0.2.1-rc.2` from the install root — **the same release the host under
test installs**, not a checkout copy.

That fix exposed a second, environment-only gap: the profile-installed row's own ESM import of
`@deepseek-ai/schemastery` walks up from `<probe home>/profiles/probe/node_modules/dsh-mail-notify/lib/config.js`
and cannot see the repo tree. The probe was written to run under the checkout (its default root was
`<repo>/tmp/host-config-write`, where the checkout's ancestor `node_modules` supplied the peer; confirmed against
the leftover `0.5.0` profile in `tmp/host-config-write`). The mandated isolation root is outside the checkout, so
the same ancestor provision was recreated as an **untracked environment fixture under the isolation root** — not a
repo, probe, or plugin change:

```
E:\Projects\DSHarness\_phase051-compat\verify-probes\node_modules\@deepseek-ai
    -> junction -> E:\Projects\DSHarness\_phase051-compat\host\node_modules\@deepseek-ai
```

The junction points at the host's own `0.2.1-rc.2` packages (verified `schemastery 3.18.5` through it; Node
resolves `@deepseek-ai/schemastery` from the profile path). The plugin under test remains the profile-installed
`0.5.1` archive and the row remains the probe wrapper; only the missing peer-resolution ancestor was restored.
The fixture is removed by deleting the junction; it is not part of the repository.

### 3.4 What was not changed

No plugin source, `lib/`, `src/`, `tests/`, `package.json`, artifact, probe assertion, SMTP/sentinel, scenario
script, or timing changed. The committed adaptation is 27 insertions / 23 deletions across the three probe files
and is **test tooling only** (`git show --stat 2a5063b`). Every scenario assertion and expectation in task C4-C
remains exactly as specified.

---

## 4. Matrix results (FINAL artifact `BFB91D4F…F6FF`)

All 13 scenarios ran to completion on the isolated `0.2.1-rc.2` host; every log records the artifact SHA-256
pre/post (`unchanged=True`), `dsh --version 0.2.1-rc.2`, host `dsh`/`app-boot` versions, the probe root and the
profile (§1.3). "Assertions" counts are the probe's own printed PASS/FAIL lines plus the scenario's stated
message-count/subject expectations.

| # | Scenario (`npm run`) | Exit | Messages (count + subjects) | Assertions | Verdict | Evidence |
|---|---|---|---|---|---|---|
| 1 | `probe:questions` | 0 | 2: `[DSH] Input required — Choose Mode`, `[DSH] Task completed — probe-scripted` | expected 2/2; question + completion namespaces separate; credential contract 14 PASS / 0 FAIL | **PASS** | `logs\questions.log`, `scenarios\questions\out\` |
| 2 | `probe:errors` | 0 | 1: `[DSH] Task failed — QUOTA (402)` | exactly one terminal-failure mail; no completion mail for the failed turn; credential 14/0 | **PASS** | `logs\errors.log`, `scenarios\errors\out\` |
| 3 | `probe:approvals` | 0 | 2: `[DSH] Approval required — probe_request_approval`, `[DSH] Task completed — probe-scripted` | 2/2 mails; approval mail on the wire at +3533 ms, answerer released `by=mail-observed` at +3550 ms, decision at +3551 ms (mail arrived while pending); 1 `approval/asked` record, 1 distinct id; tool-arg sentinel absent from raw SMTP, stderr and stdout | **PASS** | `logs\approvals.log`, `scenarios\approvals\out\{stderr,smtp-approvals.json,timeline-approvals.log}` |
| 4 | `probe:approvals-duplicate` | 0 | 2: same approval + completion pair | a real replayed `approval/asked` with the same service id is present (`records for id …: 2`, distinct ids: 1) and produced **no** second mail; sentinel clean ×3 | **PASS** | `logs\approvals-duplicate.log`, `scenarios\approvals-duplicate\out\` |
| 5 | `probe:approvals-rejected` | 0 | 2: approval + completion | `approval/decided … outcome="rejected"` at +3715 ms; exactly one approval mail; no second approval mail at the decision (only the +3756 ms completion); raw session JSONL shows the tool result as an error (`message.isError: true`, text "the decision was rejected…"); sentinel clean ×3 | **PASS** | `logs\approvals-rejected.log`, `scenarios\approvals-rejected\out\`, raw session `home\sessions\…\session.v4.jsonl.zstd` |
| 6 | `probe:credentials` | 0 | 1: `[DSH] Task completed — probe-scripted` | **credential contract 0 FAIL / 14 PASS**; installed `dsh-credentials 0.2.1-rc.2`, `dsh-credentials-local 0.2.1-rc.2`; `resolve()` → stored value from the **file** layer (exact match), value absent from all environment layers; `describe()` → `configured:true source:file writable:true` | **PASS** | `logs\credentials.log`, `scenarios\credentials\out\credentials-credentials.txt` |
| 7 | `probe:user-prompt` | 0 | 2 completions, body 1 carries prompt A only, body 2 prompt B only | **8 PASS / 0 FAIL** (both prompts attributed to the right Turn; completion texts matched; prompt section marker present; bodies distinguishable); driver stages show two Turns settled in one process | **PASS** | `logs\user-prompt.log`, `scenarios\user-prompt\out\smtp-user-prompt.json` |
| 8 | `probe:timed-questions` | 0 | 3: `[DSH] Input required — Expiring Window`, `[DSH] Input required — Answered In Window`, `[DSH] Task completed — probe-scripted` | **10 PASS / 0 FAIL**: two question mails, one per timed call; timeout settled `pending` as a non-error; late reply entered the session as a `user/message` but is carried by no body and heads no user-prompt section; `2147483` reaches no body; no raw pending payload in any body; completion body present so the negative scans are non-vacuous | **PASS** | `logs\timed-questions.log`, `scenarios\timed-questions\out\` |
| 9 | `probe:live-policy` | 0 | 1: `[DSH] Input required — QUESTION_WHILE_ON_should_be_mailed` | **8 PASS / 0 FAIL** (the probe's current check set prints 8; V0.5.0 §7 said 7 — see §7.2): boot clean; question asked while switch OFF produced no mail; the same listener produced exactly one mail after the in-process volatile switch was turned on; completion switch stayed off; exactly one question notification in the whole run | **PASS** | `logs\live-policy.log`, `scenarios\live-policy\out\` |
| 10 | `probe:host-write` | 0 | n/a (write path; one Test Email delivered to loopback) | **74 PASS / 0 FAIL**, `PASS: probe-host-config-write`; every refusal raised, left `cordis.patch.yml` byte-identical (`6f7dcef1f3d5f009 → same`, `e614fd5d27c49053 → same`), did not advance the revision (`0→0`, `2→2`), did not move the committed config; legal disabled writes accepted; complete enable accepted; runtime active and Test Email delivered (`1 message(s)` at the sink); loaded `dsh-credentials-local@0.2.1-rc.2` | **PASS** | `logs\host-write.log`, `scenarios\host-write\` |
| 11 | `probe:schema` | 0 | n/a | **16 PASS / 0 FAIL** (`PASS: schema-probe`); schemastery 3.18.5 / cosmokit 1.8.6 | **PASS** | `logs\schema.log` |
| 12 | `probe:volatile` | 0 | n/a | 16 shape cases, all as expected: 12 `OK` / 4 expected `THROW` | **PASS** | `logs\volatile.log` |
| 13 | `probe:config-check` | 0 | n/a | **44 PASS / 0 FAIL** (`PASS: config-check-probe`); installed schemastery 3.18.5, cordis 4.0.5; `.check` absent; standard-schema `resolveConfig` refusal path proven | **PASS** | `logs\config-check.log` |

**13 / 13 PASS, 0 FAIL.** Sum of explicit probe assertion lines across the matrix: **160 PASS, 0 FAIL**
(74 host-write + 44 config-check + 16 schema + 10 timed-questions + 8 user-prompt + 8 live-policy), plus the
message-list expectations for the seven mail scenarios and the 14/14 credential contract checked inside each e2e
run.

---

## 5. Per-scenario detail

The raw combined stdout+stderr of every run is at `…\verify-probes\logs\<scenario>.log` (runner header + complete
raw output) and `…\verify-probes\scenarios\<scenario>\run.combined.log`; each scenario also carries
`EVIDENCE-ARTIFACT.txt` naming the final artifact hash, host versions and runner log.

### 5.1 `questions` — dedupe namespace separation

2 messages, exactly the two expected subjects. The question mail and the turn mail used separate dedupe
namespaces (the README's stated purpose of the scenario); the turn notified after the question was answered.
Child exit 0; probe exit 0.

### 5.2 `errors` — terminal failure only

1 message: `[DSH] Task failed — QUOTA (402)`, with the failure section rendered from the scripted provider's
terminal failure. The scenario script produces exactly one terminal failure; the "retried and recovered" branch
is not exercised by this script (same as in the `0.5.0` matrix — it is covered by the unit/integration suite).
No completion mail was sent for the failed turn.

### 5.3 `approvals` — mail while the approval is pending

The timeline proves the notification happened **before** the decision: SMTP accepted the approval mail at
+3533 ms; the answerer withheld and then released at +3550 ms with `by=mail-observed`; `approval/decided`
followed at +3551 ms. Exactly one `approval/asked` audit record and one distinct approval id were published.
The tool-argument sentinel (`PROBE_TOOL_ARGUMENT_SENTINEL_9f2c41`) was absent from all three privacy surfaces
(raw SMTP payloads, plugin stderr, plugin stdout).

### 5.4 `approvals-duplicate` — a real replay, no second mail

The probe appends a second `approval/asked` with the same service-issued id through the real `Session.append()`
after the decision: the run reports `approval/asked records for id …: 2` and `distinct approval ids published: 1`.
The mail system received exactly the same two messages as `approvals` — the replay produced no second mail, so
the dedupe result is not vacuous.

### 5.5 `approvals-rejected` — one mail, rejected outcome

One approval mail; `approval/decided` with `outcome="rejected"`; no second "approval required" mail at the
decision — the next wire event is the completion mail 41 ms later. The probe tool refuses to do its work without
a grant (it throws for a non-`allowed-once` outcome); the raw durable session log records that as
`tool/result … "message": { …, "isError": true, content: [{ type: "text", text: "Error: probe_request_approval:
the decision was \"rejected\", so the requested action was not performed" }] }`, matching the V0.5.0 claim that
the tool result is marked as an error. (The probe's printed timeline renders `isError=false` because its
renderer reads `data.message.content[0].isError` while DSH stores the flag at `data.message.isError`; this is a
probe-rendering path, no assertion depends on it — see §7.3.)

### 5.6 `credentials` — the contract on the installed 0.2.1 store

**0 FAIL / 14 PASS.** Installed releases reported by the probe: `dsh-credentials 0.2.1-rc.2`,
`dsh-credentials-local 0.2.1-rc.2`. Grammar checks passed (`DSH_MAIL_SMTP_PASSWORD`/`DEEPSEEK_API_KEY`/`_x`
accepted; dashed, path-shaped and digit-leading names rejected; the `CredentialRef`/`CredentialKey` split holds
both ways; the document admits the ref in `refs` and rejects a key). The live resolution path was exercised
against the disposable `.credentials.yaml`: the value is absent from every environment layer, `resolve()`
returns the exact stored value `source: file`, and `describe()` returns `configured: true, source: file,
writable: true`. That is the `0.2.1` **file-over-env priority inversion** observed at runtime, and it shows the
plugin's named-reference resolution still works with no plugin code change. No value is printed, only
presence/layer/length.

### 5.7 `user-prompt` — two-turn attribution

Two completion mails in one booted process. **8 PASS / 0 FAIL**: mail 1 carries prompt A and not B, mail 2
carries prompt B and not A, each body names its own completion, the `--- User prompt ---` marker is present in
both, and the two bodies differ. That is `source.kind`-based attribution holding on the 0.2.1 session surface.
The two-turn driver's stages show both prompts appended and settled in the same process, in order.

### 5.8 `timed-questions` — timed modes and the late reply

3 messages: the two timed calls each produced exactly one question mail (the expiring wait that settles
`pending` did **not** produce a second), and the turn settled independently into one completion mail.
**10 PASS / 0 FAIL**. The late reply reached the session as a real `user/message` (1 event carrying
`answer_to_pending_question`) but appears in **no** mail body and heads no user-prompt section; the timed
`timeout` value `2147483` reaches no body; no body carries a raw `pending` payload. The unmistakable values make
the negative scans non-vacuous, and the completion body proves the mails were actually rendered.

### 5.9 `live-policy` — in-process volatile switch off → on

One booted process, two Turns. **8 PASS / 0 FAIL**: the question asked while `notifyQuestions=false` produced
no mail; the question asked after the switch was turned on inside the running process produced exactly one
mail; exactly one question notification was sent in the whole run; no completion mail (that switch stayed off).
No duplicate mail or duplicate-listener effect was observed across the toggle — the "exactly one" check is the
duplicate-listener counter-proof for this path.

### 5.10 `host-write` — the real Host write path

**74 PASS / 0 FAIL**, `PASS: probe-host-config-write`. With the credential provider mounted from the isolated
host's `0.2.1-rc.2` install (see §3.3), the probe drove
`SettingsForms.update → ConfigEditor.edit → cordis resolveConfig → plugin Config`:

- field-schema refusal (port 99999) raised, revision unchanged, patch byte-identical;
- disabled-with-incomplete-SMTP documents accepted and visible to the entry;
- product-invalid enables refused with the product rule named in the error (empty host/user/from/recipients,
  whitespace host, implausible address), each leaving `cordis.patch.yml` byte-identical and the revision and
  committed config unmoved;
- warning-only rules (STARTTLS port pairing, all switches off) accepted, not turned into errors;
- a complete enable accepted, mounted an active runtime, and the Test Email path delivered exactly one message
  to the loopback SMTP sink.

The accepted/refused persistence evidence is in the probe's output: two distinct patch hashes
(`6f7dcef1f3d5f009`, `e614fd5d27c49053`) are printed before and after each refusal and never move on a refusal.

### 5.11 `schema`, `volatile`, `config-check`

- `probe:schema`: 16 PASS — root-transform refusal for volatile fields, object-root shape, refusals, and the
  DSH settings projection.
- `probe:volatile`: the 16-case shape matrix behaves exactly as on the previous line (12 acceptable `OK` shapes,
  4 expected `THROW`s, including the volatile-within-transform refusal).
- `probe:config-check`: 44 PASS — `.check()` is absent from the installed schemastery; the plugin's Config is a
  standard-schema validator whose refusals become issues naming the field and are turned into a thrown
  `ValidationError` by the installed cordis `resolveConfig`; the serialized form is unaffected and every
  declared field is visible to the settings form.

---

## 6. Token telemetry schema v2 on `0.2.1` — observed, and its coverage limit

The plugin's schema-v2 candidate shape **is** visible in the probe run logs, but **no probe exercises a positive
usage aggregate on `0.2.1`** (the scripted provider's usage report is not folded by the plugin in this
composition), so the positive aggregate invariant is not runtime-verified here. Precisely:

- Every e2e scenario logs a `candidate.produced` line with the schema-v2 counters. Representative
  (`scenarios\questions\out\stderr-questions.log`, turn 1):
  `{"schemaVersion":2,…,"telemetryComplete":true,"usageSampleCount":0,"usageMissingCount":2,
  "usageUnobservableRetries":0,"usageComplete":false,"steps":2,…}`.
  The completion mail's metadata section renders the same facts — `Telemetry complete: yes`,
  `Token usage (turn aggregate): none observed`, `Token telemetry complete: no (2 model calls without a usable
  usage report)` — so absent counters stay absent rather than being zero-filled, and the turn-level
  completeness verdict is a fold over calls, not a per-call sample.
- The scripted provider *does* report the counters (it emits `finish` chunks carrying
  `usage: {inputTokens: 120, outputTokens: 30, totalTokens: 150}`), but on the `0.2.1` durable event the
  counters appear only inside `assistant/message.data.stream[].chunk.usage` on a `finish` chunk; the plugin's
  compatibility reader looks for a `chunk.type === "usage"` record, and its primary source
  (`data.usage` on the event) is absent. All 10 scenario sessions therefore show
  `assistant/message` events with no `data.usage` and no foldable stream usage chunk. No probe on this host
  produces a second usage-bearing call, so the "turn aggregate over multiple calls, never the last call"
  property cannot be observed in real assembly here.
- The negative direction that *is* observable holds: absent optional fields are absent (the candidate and body
  carry no zero-filled counters, no invented `cacheReadTokens`, no placeholder usage object), and
  `usageSampleCount`/`usageMissingCount`/`usageUnobservableRetries` are carried through to the candidate and to
  rendering.
- The positive direction is covered by the C3 suite on the same dependency set:
  `tests/integration/turn-telemetry.test.ts` (and `tests/unit/telemetry.test.ts`) passed in the 575/575 run
  recorded in `V0.5.1_COMPAT_REPORT.md` §5. The source-level contract comparison (`docs/compat/01_CONTRACT_DIFF.md`
  §2.3/§2.10) reports `assistant/message.usage` and `TokenUsage` unchanged between the tags.
- **Residual risk to record, not a failure:** verifying positive usage folding on `0.2.1` needs a provider whose
  durable event carries `data.usage` (or a `chunk.type === "usage"` stream record). That requires a real model
  adapter call, which this phase's no-model-spend rule excludes. The scripted composition's shape is a probe
  fixture property; nothing in this matrix proves or disproves how the DeepSeek adapter populates usage on
  `0.2.1`.

---

## 7. Deviations from `V0.5.0_COMPAT_REPORT.md` §14, and their explanations

### 7.1 A host-assembly delta required a harness adaptation before any scenario could pass

V0.5.0's matrix ran on `0.2.0-rc.2`, where the headless profile kept the interactive credential store. On
`0.2.1-rc.2` the same probe composition has no Credential service, so the plugin's designed refusal
(`credential-missing`) produced zero mails and the probe exited 1. This is a **host-profile behavior change, not
a plugin regression**, and it is why §3.2's restore row exists. Pre-fix evidence is retained (§3.1). After the
adaptation every expected message reappears with the same subjects.

### 7.2 `probe:live-policy` prints 8 PASS, not 7

V0.5.0 §7 reported "7 PASS / 0 FAIL". The probe's current check set prints **8 PASS / 0 FAIL** (the extra line is
the explicit "the run booted and exited cleanly" check; the probe source is unchanged by this task except the
credential restore row). Nothing failed and no assertion was added or removed by the adaptation; the count
difference is the report's older count of the probe's own check list.

### 7.3 `approvals-rejected`: the probe's printed `isError=false` vs the durable error flag

V0.5.0 §10 says "the tool result is marked as an error". The raw `0.2.1` durable session log confirms
`message.isError: true` (with the rejection text) and the plugin's mail is the single approval mail. The probe's
timeline renderer prints `isError=false` because it reads `data.message.content[0].isError`, while the installed
contract stores the flag at `data.message.isError` (`dsh-session` types at `0.2.1-rc.2`: `ToolResultMessage`
carries `isError`; `tool/result.error` is "allowed only when the message has `isError: true`"). This is a
probe-rendering path, not a product difference; no assertion depends on the rendered value.

### 7.4 Duplicated plugin log records in the `user-prompt` run

In `scenarios\user-prompt\out\stderr-user-prompt.log` every `dsh-mail-notify` record after activation appears
**twice**, byte-identical (e.g. the same `mail.sent` line for turn 1 twice), while the SMTP server received
exactly **2** messages with the correct attribution and all 8 assertions passed. `mail.sent` records therefore
are 4 for 2 delivered messages in that scenario; `notification.enqueued` behaves the same way. The duplicates
are identical records, the two bodies are distinct and correctly attributed, and the replay the dev boot probe
arms unconditionally (`replaying a full turn chain twice for …`) is visible in this scenario's stderr. The other
10 scenarios show one record per wire event. This is a probe-harness logging artifact (the dev boot probe's
exporter/replay wrapper), not duplicate delivery; it is recorded so the raw logs are not misread as four mails.

### 7.5 `host-write` cannot run from the mandated isolation root without §3.3's fixture

Explained in §3.3. V0.5.0 ran it under the checkout (implicit ancestor `node_modules`); the mandated root is
outside it, and the host is a flat npm install, so the old two guesses missed. The adaptation is fixture-only and
the write-path assertions are byte-for-byte the same. The probe now loads the host's own
`dsh-credentials-local@0.2.1-rc.2`; because this probe mounts the credential provider explicitly in its own
composition, **the 0.2.1 headless-store caveat does not affect it**.

### 7.6 No other deviations

Every other expected result in V0.5.0 §14 — message counts, subjects, credential 14/14, user-prompt 8/8,
timed-questions 10/10, host-write all PASS, the three shape probes exit 0 — reproduced on `0.2.1-rc.2` with the
FINAL artifact.

---

## 8. Real-user consequence of the `0.2.1` headless credential change (release caveat)

On a stock `0.2.1-rc.2` **headless / one-shot** profile, `dsh-mail-notify` configured with a
`smtpPasswordCredential` reference cannot resolve it, because the profile intentionally mounts no interactive
credential store; the plugin refuses with its `credential-missing` diagnostic and sends nothing (fail-safe, no
silent leak). This was observed directly before the harness adaptation (§3.1) and is documented by the host's
own `dsh-headless` README. Web/desktop profiles keep the service, so the Web configuration path is unaffected
(and is covered by `docs/compat/04_WEB_RUNTIME_VERIFICATION.md`). The remedy is the host-documented profile patch:

```yaml
# $DSH_HOME/profiles/<headless-profile>/cordis.patch.yml, or a --patch overlay
- id: credentials
  disabled: false
```

(and, only if the deployment needs the other consumers, `authorization` / `deepseek-account`). The report and
release notes record this as a host-profile behaviour change with a documented remedy; it is not a plugin defect
and requires no code change.

---

## 9. Isolation and version proof per run

Every scenario's proof is in its runner log and `EVIDENCE-ARTIFACT.txt`; the table names the trees.

| Scenario | Probe root (`DSH_MAIL_NOTIFY_PROBE_ROOT`) | Profile | Completion evidence |
|---|---|---|---|
| questions | `…\scenarios\questions` | `mail-notify-v051-questions` | `logs\questions.log`, `…\out\smtp-questions.json` |
| errors | `…\scenarios\errors` | `mail-notify-v051-errors` | `logs\errors.log`, `…\out\smtp-errors.json` |
| approvals | `…\scenarios\approvals` | `mail-notify-v051-approvals` | `logs\approvals.log`, `…\out\timeline-approvals.log` |
| approvals-duplicate | `…\scenarios\approvals-duplicate` | `mail-notify-v051-appdup` | `logs\approvals-duplicate.log`, `…\out\approval-trace-approvals-duplicate.log` |
| approvals-rejected | `…\scenarios\approvals-rejected` | `mail-notify-v051-apprej` | `logs\approvals-rejected.log`, raw session `…\home\sessions\…\session.v4.jsonl.zstd` |
| credentials | `…\scenarios\credentials` | `mail-notify-v051-credentials` | `logs\credentials.log`, `…\out\credentials-credentials.txt` |
| user-prompt | `…\scenarios\user-prompt` | `mail-notify-v051-userprompt` | `logs\user-prompt.log`, `…\out\smtp-user-prompt.json` |
| timed-questions | `…\scenarios\timed-questions` | `mail-notify-v051-timedquestions` | `logs\timed-questions.log`, `…\out\smtp-timed-questions.json` |
| live-policy | `…\scenarios\live-policy` | `mail-notify-v051-livepolicy` | `logs\live-policy.log`, `…\out\smtp.json` |
| host-write | `…\scenarios\host-write` | profile `probe` inside the disposable home | `logs\host-write.log` |
| schema | `…\scenarios\schema` | n/a (no profile boot) | `logs\schema.log` |
| volatile | `…\scenarios\volatile` | n/a (no profile boot) | `logs\volatile.log` |
| config-check | `…\scenarios\config-check` | n/a (no profile boot) | `logs\config-check.log` |

Cross-run proofs (in `…\verify-probes\version\`): `launcher-modules-proof.log` (§1.3); per-scenario runner logs
contain the pre/post artifact hash, `PATH[0]`, `where dsh`, `dsh --version` before/after, host
`dsh`/`dsh-app-boot` versions, profile path, profile `package.json`, installed plugin version/`engines.dsh` and
`pnpm-lock.yaml` head. Preliminary `50FE…` runs and the pre-fix runs are kept separately (§2, §3.1). The operator
`C:\Users\20659\.dsh` was never a `DSH_HOME` for any command in this task; every command's home is printed in its
log and lies under `E:\Projects\DSHarness\_phase051-compat\verify-probes\`.

---

## 10. Reproduce

From `E:\Projects\DSHarness\dsh-mail-notify`, in a PowerShell with the pinned environment, e.g. for one
scenario:

```powershell
$root   = 'E:\Projects\DSHarness\_phase051-compat\verify-probes'
$env:PATH = 'E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin;' + $env:PATH
$env:DSH_INSTALL_ROOT = 'E:\Projects\DSHarness\_phase051-compat\host'
$env:DSH_HOME = "$root\_env\shell-home"
$env:DSH_MAIL_NOTIFY_PROBE_ROOT = "$root\scenarios\questions"
$env:DSH_MAIL_NOTIFY_PROBE_PROFILE = 'mail-notify-v051-questions'
dsh --version                        # must print 0.2.1-rc.2
node scripts/probe-e2e.mjs questions "probe: question notification"
```

The full matrix (all 13 rows) was executed by `…\verify-probes\run-scenario.ps1` with the same environment; it
deletes/recreates `scenarios\<scenario>`, records the proofs of §1.3, and captures complete stdout+stderr. The
`…\verify-probes\node_modules\@deepseek-ai` junction of §3.3 must exist for `probe:host-write` under this
isolation root (it is an untracked fixture; remove it by deleting the junction).

---

## 11. Known limitations / residual risk

1. **Token-telemetry positive path not exercised** on `0.2.1` real assembly (§6) — covered by the unit/integration
   suite on the same dependency set; a real-provider run would be required to close it.
2. **Headless profile only.** The C4-C matrix composes the shipped `headless` template, as the probes are
   designed to; the Web half (browser UI, config form, live update) is C4-B /
   `docs/compat/04_WEB_RUNTIME_VERIFICATION.md`. Both together cover the two supported assemblies.
3. **The probes were written for the checkout layout.** Running them under the mandated isolation root required
   §3.2/§3.3's test-tooling adaptations. They are committed as test tooling; no product code changed.
4. **Probe-harness log duplication in `user-prompt`** (§7.4) and the rejected-approval renderer field (§7.3) are
   probe-rendering artifacts, noted so raw logs are read correctly; neither affects the assertions or the wire.
5. **No real model spend / external mail / real credentials / exemptions** were used anywhere; SMTP is
   loopback-only and the model is scripted.
6. The isolated host's **`dsh --version` is the only claimed runtime identity**: it printed `0.2.1-rc.2` before
   and after every scenario, the imported `dsh-app-boot` from `DSH_INSTALL_ROOT` is `0.2.1-rc.2`, and the
   probe's credential contract reported the installed `dsh-credentials`/`-local` at `0.2.1-rc.2`.

---

## 12. Evidence index

Repo file changed by this task: **this document only** (`docs/compat/05_HOST_ASSEMBLY_PROBES.md`). All evidence
lives under `E:\Projects\DSHarness\_phase051-compat\verify-probes\`:

- `run-scenario.ps1` — the per-scenario runner (§1.2).
- `logs\<scenario>.log` — complete runner header (proofs §1.3), raw stdout+stderr, post-run profile facts, per-scenario.
- `scenarios\<scenario>\` — that run's probe artifacts (`out\*.log`, `out\smtp-*.json`, overlays, scripts,
  session store, profile, credential document) + `EVIDENCE-ARTIFACT.txt`.
- `version\launcher-modules-proof.log` — launcher/app-boot version proof (§1.3).
- `matrix-summary.json` — machine summary of the matrix (parsed from the runner logs).
- `pre-fix-evidence\` — the pre-adaptation failure (§3.1): missing credential service, 0 mails, verbatim child log.
- `preliminary-50FE-evidence\` — earlier candidate runs, labelled, kept for traceability.
- `node_modules\@deepseek-ai` — the untracked version-resolution fixture junction (§3.3).

Committed test-tooling change: `2a5063b test(probes): adapt the isolated-host fixtures to DSH 0.2.1-rc.2`
(3 probe scripts, 27 insertions / 23 deletions; no assertion changed). The artifact
`BFB91D4F…F6FF` was not rebuilt, edited, or re-packed by this task.
