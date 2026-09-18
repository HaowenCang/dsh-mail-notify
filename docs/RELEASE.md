# RELEASE — building, packing, installing, updating, rolling back

Everything below has been executed on this machine. Where a command's output matters for trust,
the expected result is stated next to it.

## 1. Prerequisites

| Requirement | Value used |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` (`v24.13.0` used) |
| npm | `11.12.0` used |
| DSH | `0.1.5-rc.1` installed and on `PATH` as `dsh` |
| Runtime dependency | `nodemailer@10.0.9` (declared `^10.0.9`; the only runtime dependency) |
| Peer packages resolvable from the profile | `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-credentials` |

Nodemailer's own security policy supports only its current major, so the declared range stays on
`10.x`: `^10.0.9` cannot reach `11` unattended, and its lower bound is the patched line rather than
`10.0.0`. Nodemailer 10 bundles its TypeScript declarations, so `@types/nodemailer` must not be
installed beside it — the two declare the same module and conflict. `npm ls nodemailer` should report
exactly one entry, and Nodemailer reports zero runtime dependencies of its own.

The peers are declared with wide ranges (`^4.0.2`, `^3.18.2`, `^0.1.5-rc.1`) on purpose: the plugin
must share one Cordis and one Schemastery instance with the host. Pinning exact versions invites a
second copy of either, which means two mutually invisible service registries.

## 2. Build

```powershell
npm install
npm run typecheck
npm test
npm run build
```

| Step | Command | Expected |
| --- | --- | --- |
| Install | `npm install` | `node_modules` created; `nodemailer` is the only runtime dependency |
| Typecheck | `npm run typecheck` | Exit 0, no output. Runs `tsc --noEmit` over `src` and again over `src` + `tests` + `scripts` |
| Test | `npm test` | `node --test "tests/**/*.test.ts"`; all tests pass, nothing skipped, no network |
| Build | `npm run build` | Exit 0; `lib/*.js` plus `lib/types/*.d.ts` emitted |

There is no lint step: the frozen specification does not require one and this repository declares no
linter configuration, so no lint claim is made.

## 3. Pack

```powershell
npm pack                    # -> dsh-mail-notify-<version>.tgz, e.g. dsh-mail-notify-0.2.0.tgz
npm run pack:check          # audits the archive
```

`package.json` uses `files` as a **whitelist**: `lib`, `cordis.patch.yml`, `README.md`, `LICENSE`.
Anything not listed cannot enter the archive, which is how `.env`, key material, tests, and
development scripts are excluded structurally rather than by remembering to exclude them.

`npm run pack:check` re-derives that whitelist, confirms each declared entry is present, checks that
a compiled runtime exists under `lib/`, and matches every archive path against a deny list of
secret-bearing and development patterns. It prints the full entry list and ends with `PASS` or a
`FAIL` block naming each problem.

`*.tgz` is ignored by git, so the archive is a local verification artefact and is never committed.

## 4. Install

From the registry:

```powershell
dsh plugin --profile <profile> add dsh-mail-notify@<version>
```

Or from a local archive:

```powershell
dsh plugin --profile <profile> add ./dsh-mail-notify-<version>.tgz
```

This forwards to pnpm inside the profile directory, installs the package, and — because
`package.json` declares `dsh.bundle.patch` — appends the package name to `dsh.profile.bundles`.

Verify:

```powershell
dsh plugin --profile <profile> list
# dsh-mail-notify must appear in the dependency list

dsh --profile <profile> --dump-config | Select-String -Pattern 'dsh-mail-notify' -Context 0,3
# the row must appear with the config from the package's own cordis.patch.yml
```

The shipped row sets `enabled: false`, so a fresh install registers nothing until configured. A row
is inert by default and cannot mail an unconfigured recipient.

**Restart the profile.** The `web` and `headless` profiles set `patchReload: startup`, so a new row
takes effect on the next boot rather than live. A custom profile may default to `live`, in which
case editing its patch file is enough.

## 5. Configure and verify

Add the row described in [`../README.md`](../README.md#configure) to the profile's own
`cordis.patch.yml`, restart, and look for `plugin.ready` in the log. Because the `dsh` command line
registers no log exporter, the plugin's lines are only visible with an exporter attached; the
development probe in this repository does that without modifying the harness:

```powershell
node scripts/dev-boot-probe.mjs --profile <profile> --only dsh-mail-notify -- "<a short task>"
```

Delete the row and restart to remove the configuration.

### 5.1 The notification-family release gate (added for 0.2.0)

From `0.2.0` the plugin has three notification families, and two of them cannot be exercised by a
scripted turn alone. The end-to-end probe covers them without spending provider quota:

```powershell
npm run probe:questions             # ask_user_question, then completion
npm run probe:errors                # one terminal provider failure
npm run probe:approvals             # one in-Turn approval, allowed once
npm run probe:approvals-duplicate   # the same, with the audit record replayed
npm run probe:approvals-rejected    # the same, with the answerer rejecting
npm run probe:credentials           # the credential-reference contract
```

Each script is `node scripts/probe-e2e.mjs <scenario> "<task>"`; the tasks are fixed so a run is
reproducible. `scripts/probe/README.md` documents what each scenario composes and asserts.

| Scenario | Expected | Measured on this machine |
| --- | --- | --- |
| `questions` | 2 messages: `[DSH] Input required — Choose Mode`, then a completion message | 2 — `[DSH] Input required — Choose Mode` and `[DSH] Task completed — probe-scripted` |
| `errors` | 1 message: `[DSH] Task failed — …` | 1 — `[DSH] Task failed — QUOTA (402)` |
| `approvals` | 2 messages: `[DSH] Approval required — probe_request_approval`, then a completion message | 2, with the approval mail observed over SMTP while the answerer was still withholding its decision |
| `approvals-duplicate` | 2 messages, with the same approval id published twice in the log | 2 — one approval id, two `approval/asked` records, one approval mail |
| `approvals-rejected` | 1 approval mail, `approval/decided` `rejected`, no second "approval required" | 2 — the approval mail, then a completion-with-tool-errors mail; the rejection produced no second approval mail |
| `credentials` | every contract check `PASS` | 14 PASS, 0 FAIL against the installed store |

**A terminal-failure notification cannot be exercised against a real provider without spending
quota.** Triggering `turn/end` with `reason.kind === 'error'` for real means exhausting a quota or
letting a request fail terminally, and the failure's shape would then be the provider's choice rather
than the test's. That is why the `errors` scenario uses the probe's scripted provider: the failure
object is declared by the script, the rest of the path is production. The same reasoning applies to
the question family, which needs a model willing to stop and ask at a chosen moment, and to the
approval family, which needs a human willing to answer at a chosen moment.

The approval scenarios need their own composition note: `dsh-base` derives the approval policy from
`DSH_PERMISSION_MODE`, and this machine's preset is `danger-full-access`, whose policy is `never`. A
`never` policy rejects every ask deterministically before any answerer is consulted, so no
`approval/asked` record exists to notify about. The probe overlay therefore pins `approval.policy:
ask` explicitly, and the answerer withholds its answer until the probe has seen the approval mail
arrive over SMTP — which is what makes "the notification happened while the approval was pending" a
measured fact rather than an assumption about timing.

## 6. Update

```powershell
npm pack
dsh plugin --profile <profile> add ./dsh-mail-notify-<version>.tgz
```

pnpm replaces the installed copy; the profile's own patch file is not touched. Restart afterwards.

Bump `version` in `package.json` before packing an update: the archive name carries it, and two
different builds sharing one version number cannot be told apart in a profile listing.

## 7. Roll back

Three levels, in increasing scope:

| Scope | Action |
| --- | --- |
| Stop sending, keep the installation | Set `enabled: false` in the profile patch and restart. No listener, no queue, no credential read. |
| Undo a configuration change | Restore the previous `cordis.patch.yml` (back it up before editing) and restart. |
| Remove the plugin | `dsh plugin --profile <profile> remove dsh-mail-notify`, then restart. Confirm the row is gone from `--dump-config`. |

Nothing in this plugin writes outside its own process. It holds no files, opens no database, and
persists no state, so a rollback leaves nothing behind beyond the configuration you edited.

Rolling back a **development injection** is different: if the plugin was loaded through the
super-injector rather than installed as a package, use the injector's own uninstall path. That path
removes the loader entry, deletes the profile junction, and records a `disabled: true` row for the
id in the profile patch so a later refresh cannot re-add it. That disabled row is written by the
injector; a normal `dsh plugin add` install does not create one.

## 8. Release checklist

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` passes with zero skipped
- [ ] `npm run build` exits 0
- [ ] `npm pack` produces the expected filename
- [ ] `npm run pack:check` prints `PASS`
- [ ] the archive's `lib/**` matches the current build byte for byte
- [ ] the archive contains no secret-bearing or development entry
- [ ] installing the archive into a fresh profile makes the row appear in `--dump-config`
- [ ] `enabled: false` produces `plugin.disabled` and registers nothing
- [ ] `enabled: true` produces `candidate.produced` for a real top-level turn
- [ ] `candidate.produced` reports `usageSampleCount` equal to the turn's model-call count
- [ ] uninstalling leaves no row and no residual state
- [ ] `git status` shows no credential, no `.env`, and no archive
- [ ] the published tarball, the npm registry artifact, and the GitHub Release asset have the same SHA-256
- [ ] `npm audit --omit=dev` reports 0 vulnerabilities

### 8.1 What 0.2.0 adds to this checklist

The list above is the standing procedure and stays as it is. The following are the `0.2.0`-specific
points a releaser must apply when running it:

| Point | What changes |
| --- | --- |
| Tarball name | `dsh-mail-notify-0.2.0.tgz`. `npm pack` takes the name from `package.json`, so bump the version before packing; two builds sharing one version cannot be told apart in a profile listing. |
| Package shape | The archive now contains `lib/human-attention.js` and its declaration. `scripts/probe-e2e.mjs` and `scripts/probe/` must **not** appear in it — the `files` whitelist already excludes `scripts/`, and `npm run pack:check` re-derives that. |
| Failure-path evidence | A terminal-failure notification cannot be exercised against a real provider without spending quota, so this path is verified with the scripted provider of `npm run probe:errors` (1 message, `[DSH] Task failed — QUOTA (402)`), not against a live account. Record it as probe evidence, not as real-provider evidence. |
| Question-path evidence | `npm run probe:questions` must deliver exactly 2 messages. Exactly 2 is the assertion: it is what shows the question's dedupe namespace did not consume the turn's. |
| Approval-path evidence | `npm run probe:approvals`, `npm run probe:approvals-duplicate` and `npm run probe:approvals-rejected` must each deliver the expected count, and the printed timeline must place `approval/asked` before the approval mail and the mail before `approval/decided`. The offline suite (`APR-*`) pins the parser and policy behaviour; the probe is what shows the chain in a real assembly. |
| Configuration surface | Two switches were added (`notifyQuestions`, `notifyApprovals`), both defaulting to `false`. `smtpPasswordCredential` takes exactly one form — the DSH `CredentialRef` grammar `^[A-Za-z_][A-Za-z0-9_]*$` (D019) — so a profile patch written for `0.1.1` keeps working unchanged and a `<scope>/<id>` value is refused at mount with an explanation. The shipped `cordis.patch.yml` still sets `enabled: false`. |
| Publication scope | This phase produced a release candidate and **did not publish**: no `npm publish`, no `v0.2.0` tag, no GitHub Release. Do not report the candidate as released, and do not move the `v0.1.1` tag. |
| Credential-reference contract | Before packing, re-run `npm run probe:credentials`. It boots the **installed** file-backed provider over a disposable document and prints an exact-value, source-layer, and grammar comparison; a `FAIL` there means the plugin's `CREDENTIAL_REF_PATTERN` and the store's `credentialRef()` have diverged, which is a release blocker (D019). |

## 9. Version history

| Version | Status | Substance |
| --- | --- | --- |
| `0.1.0` | released | First release. `schemaVersion: 1`; `usage` carried the last observed per-call sample. Nodemailer `^7.0.13`. |
| `0.1.1` | released | `usage` is the turn-level aggregate of observable per-call counters; `schemaVersion: 2`; `usageComplete` added; body labels the aggregate as such (D017); Nodemailer raised to `^10.0.9` and `npm audit --omit=dev` reports 0 vulnerabilities. No configuration field changed, so an existing profile patch needs no edit. |
| `0.2.0` | **release candidate — not published** | Three notification families instead of one: a settled turn, a terminal turn failure, and a mid-turn human-attention request. A failure mail is produced even when the turn yielded no visible assistant output, which is the one place the old "no visible text ⇒ never notify" rule is lifted; `notifyErrors` keeps its `false` default. New switches `notifyQuestions` and `notifyApprovals`, both `false` by default. New rendering: a `--- Failure ---` section, `--- Question ---` and `--- Approval ---` sections, and the subjects `[DSH] Task failed — QUOTA (429)`, `[DSH] Input required — …`, `[DSH] Approval required — …`. Dedupe keys gained `turn:` / `question:` / `approval:` namespaces. `CREDENTIAL_REF_PATTERN` is exactly the DSH `CredentialRef` grammar `^[A-Za-z_][A-Za-z0-9_]*$` (D019; a Phase 8 widening to `<scope>/<id>` was withdrawn in Phase 8.1). `schemaVersion` stays `2`. Tarball: `dsh-mail-notify-0.2.0.tgz`. Probe evidence: `questions` = 2 messages, `errors` = 1, `approvals` = 2, `approvals-duplicate` = 2 with one approval id published twice, `approvals-rejected` = 2, `credentials` = 14 PASS / 0 FAIL against the installed store; no tag, no npm publication, no GitHub Release. |

A `0.1.0` candidate record and a `0.1.1` candidate record for the same turn usually carry
**different** `usage` values and always carry different `schemaVersion` values. The version field is
the discriminator; a reader that ignores it will read a v2 aggregate as a v1 last-call sample.

`0.2.0` does not change `schemaVersion`: the candidate is unchanged, and only the envelope that
carries it became a discriminated union. A `0.1.1` and a `0.2.0` record for the same turn are
therefore distinguishable by their `notificationKind` and by which log lines appear, not by
`schemaVersion`.
