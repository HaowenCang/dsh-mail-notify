# dsh-mail-notify v0.2.0 — release report

## Status

```text
PASS — v0.2.0 RELEASED
```

Phase 9 advanced `main` to the validated v0.2.0 release candidate, froze that commit as the release
source, reproduced the archive from it, verified it, published it to npm, tagged it, created the
GitHub Release, and confirmed that the local archive, the npm registry artifact, and the GitHub
Release asset are byte-identical. No source, test, configuration, or dependency change was made.

| Item | Value |
| --- | --- |
| Release source commit | `713100ac882b55911c1de28027d5e1f3d2f21d5f` |
| Annotated tag object | `22d99218230e6c6dd739d0a571a94b09b9906ca4` |
| Tag target | `713100ac882b55911c1de28027d5e1f3d2f21d5f` |
| npm package / version | `dsh-mail-notify@0.2.0` (`latest`) |
| npm `dist.integrity` | `sha512-xkmDCFIQmqJf0vk4QChhQkl5li5j8dippoBhjMgGzngz1toXZd+8sZeQ5suyVB6uB6rGEW0ThZpV1+7zi4w7PA==` |
| npm `dist.shasum` | `aefa75e4af37c7a2955e1cfee2d34c0e1766a31b` |
| npm published | `2026-09-18T16:57:21.378Z` |
| GitHub Release | `dsh-mail-notify v0.2.0`, REST id `391642504`, node_id `RE_kwDOUYyDC84XV_2I`, published `2026-09-18T17:02:31Z` |
| GitHub Release asset | `dsh-mail-notify-0.2.0.tgz`, 123 390 bytes, asset id `573061736` |
| Previous release | `v0.1.1`, tag object `819fde114357cb653d8ad902f74a8fd35d30a0af`, target `340ef3624126bc4cf8bd0f2c26394371e4fa7b56` |

## Baseline gate

Phase 9 began from the expected baseline, confirmed rather than assumed. The first attempt stopped at
the authentication preflight with `PARTIAL — RELEASE BLOCKED — authentication unavailable`; Phase 9R
resumed after npm authentication was restored, and re-ran the guard before continuing.

```text
branch                             main
origin/main                        713100ac882b55911c1de28027d5e1f3d2f21d5f
origin/feat/v0.2.0-human-attention 713100ac882b55911c1de28027d5e1f3d2f21d5f
ahead/behind (main...feature)      0 15
working tree                       clean
v0.2.0 tag                         absent
v0.2.0 npm version                 absent
v0.2.0 GitHub Release              absent
```

`v0.1.0` and `v0.1.1` were neither moved, deleted, recreated, nor force-updated. Both still resolve
to the same annotated tag objects and the same target commits, before and after this release.

## Main fast-forward

Because the feature branch was 0 behind and 15 ahead, `main` was advanced by fast-forward only:

```text
2296375..713100a  main -> main
```

`git rev-list --parents -n 1 HEAD` reports exactly one parent (`1369799`), so the result is neither a
merge commit nor a squash commit. The tree is identical to the feature branch tip:

```text
HEAD^{tree}                                      f450bc782397d4d37905b20a59835c75612d8cb0
origin/feat/v0.2.0-human-attention^{tree}        f450bc782397d4d37905b20a59835c75612d8cb0
```

The Phase 8.2 documentation commits `5af8d91`, `1369799` and `713100a` were preserved as-is. No
squash, no rebase, and no force push was performed at any point.

## Artifact

**Reproduction.** The stale `dsh-mail-notify-0.2.0.tgz` from Phase 8 was deleted and `npm pack` was
re-run at `713100ac` from a clean working tree. The resulting archive is the release artifact; no
Phase 8 tarball hash was reused.

| Property | Value |
| --- | --- |
| Filename | `dsh-mail-notify-0.2.0.tgz` |
| Size | 123 390 bytes |
| Entries | 84 |
| `.js` | 20 |
| `.d.ts` | 20 |
| `.map` | 40 (20 `.js.map` + 20 `.d.ts.map`) |
| Other | 4 (`package.json`, `README.md`, `LICENSE`, `cordis.patch.yml`) |
| SHA-256 | `50d130b57cf8668ff73573fd5ee2e0555f41014531c4d58aae3239c54f6e820d` |

**Archive contents.** The published surface is exactly `lib/` plus the four root files permitted by
`package.json.files`. No `src/`, `tests/`, `scripts/`, `tmp/`, `PHASE*.md`, `.credentials*`, `.env*`,
`*.key`, `*.pem`, nested `*.tgz`, or probe artifact is present. The secret scan reported 0
credential-value hits and 0 credential-shaped-literal hits across all 84 entries.

The packed manifest declares `name dsh-mail-notify`, `version 0.2.0`, exactly one runtime dependency
(`nodemailer: ^10.0.9`), and the reviewed DSH peer dependencies (`@deepseek-ai/cordis ^4.0.2`,
`@deepseek-ai/dsh-credentials ^0.1.5-rc.1`, `@deepseek-ai/dsh-session ^0.1.5-rc.1`,
`@deepseek-ai/schemastery ^3.18.2`). The shipped `cordis.patch.yml` carries `enabled: false` and no
credential value.

## Three-way artifact equality

| Stage | SHA-256 | Size |
| --- | --- | --- |
| Local verified tarball | `50d130b57cf8668ff73573fd5ee2e0555f41014531c4d58aae3239c54f6e820d` | 123 390 B |
| npm registry artifact | `50d130b57cf8668ff73573fd5ee2e0555f41014531c4d58aae3239c54f6e820d` | 123 390 B |
| GitHub Release asset | `50d130b57cf8668ff73573fd5ee2e0555f41014531c4d58aae3239c54f6e820d` | 123 390 B |

```text
three-way artifact equality: PASS
```

The npm and GitHub copies were downloaded to a temporary directory and hashed locally. The npm hash
was not inferred from `dist.integrity`, and the GitHub hash was checked both against the API's own
`digest` field (`sha256:50d130b5…6e820d`) and by hashing the downloaded asset. The npm `dist.shasum`
(`aefa75e4…6a31b`, SHA-1) and `fileCount` 84 independently match the local archive.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Text integrity | `npm run check:text` | PASS — 97 text files, strict UTF-8, BOM-free, no mojibake |
| Typecheck | `npm run typecheck` | Exit 0 (sources, then sources + tests + scripts) |
| Test suite | `npm test` | **409 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo** |
| Build | `npm run build` | Exit 0 |
| Archive audit | `npm run pack:check` | PASS — required entries present, no forbidden entry |
| Secret scan | `npm run scan:secrets` | PASS — 84 entries, 470 856 bytes, 0 hits |
| Production audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Runtime dependency | `npm ls nodemailer` | `nodemailer@10.0.9`, satisfying the declared `^10.0.9` |
| Legacy types | `@types/nodemailer` | Absent from `devDependencies` and from `node_modules` |

No snapshot was updated, no test was skipped or modified, and no source file was touched in this
phase.

## E2E release probes

All six probes were repeated from the frozen release-source commit, using the scripted provider and
loopback SMTP mechanism. No real provider quota was consumed and no credential was damaged.

| Probe | Required semantic result | Observed |
| --- | --- | --- |
| `probe:questions` | question → answer → completion mail | PASS — `[DSH] Input required — Choose Mode`, then `[DSH] Task completed — probe-scripted` |
| `probe:errors` | exactly one failure mail | PASS — `[DSH] Task failed — QUOTA (402)`, 1 message |
| `probe:approvals` | approval mail while pending → allowed-once → completion | PASS — mail accepted 12 ms after `approval/asked` and 29 ms before the decision; `approval/decided outcome="allowed-once"`, then completion |
| `probe:approvals-duplicate` | duplicate `approval/asked` still yields exactly one notification | PASS — 2 `approval/asked` records, 1 distinct approval id published, 1 approval mail |
| `probe:approvals-rejected` | one approval-required mail → rejected → no second approval-required mail | PASS — 1 `approval/asked`, `outcome="rejected"`, no second approval mail |
| `probe:credentials` | CredentialRef contract PASS | PASS — 0 FAIL, 14 PASS |

Every probe additionally reported that the approval's tool arguments are absent from the raw SMTP
payloads, the plugin's stderr, and the plugin's stdout.

## Local and registry fresh installs

**From the exact local tarball.** A clean temporary environment installed
`./dsh-mail-notify-0.2.0.tgz`. The package loaded with exports `Config`, `apply`, `inject`, `name`
and `name = "dsh-mail-notify"`; version `0.2.0`; `nodemailer@10.0.10` satisfying `^10.0.9`; no
`@types/nodemailer`; and the resolved defaults `notifyErrors = false`, `notifyQuestions = false`,
`notifyApprovals = false`. With the shipped patch's `enabled: false`, `apply()` returned before
creating any resource, touching nothing beyond reading `ctx.logger` — no listener, no queue, no
timer, no credential read.

**From the npm registry.** An isolated DSH home was created with no prior state and the package was
installed **from the registry** by specifier rather than from the local tarball:

```powershell
dsh plugin --profile mnrel020h add dsh-mail-notify@0.2.0
dsh plugin --profile headless  add dsh-mail-notify@0.2.0
```

| Property | Result |
| --- | --- |
| Package installed | `dsh-mail-notify@0.2.0` in the profile's `dependencies` |
| Bundle recognised | `dsh-mail-notify` appended to `dsh.profile.bundles` |
| Nodemailer 10 present | `nodemailer@10.0.10` alongside the package |
| `@types/nodemailer` absent | No `@types` directory anywhere in the profile's `node_modules` |
| New config switches present | `notifyErrors`, `notifyQuestions`, `notifyApprovals` all resolve to `false` |
| Shipped patch inert | `enabled: false` with no SMTP or credential configuration |

**Published-package runtime check.** The registry-installed copy — not the working tree — was the row
under test in a real `headless` boot with the Phase 8 probe composition, a loopback SMTP peer, and a
scripted provider. The published artifact's own production path ran end to end:

```text
plugin.ready          -> mount and configuration validation, notifyQuestions true
notification.enqueued -> {"notificationKind":"question","questionCount":1,"droppedQuestions":0}
mail.sent             -> question, bodyChars 36, recipientCount 1
notification.outcome  -> attempts 1, ok true
candidate.produced    -> {"schemaVersion":2,"status":"completed-clean","telemetryComplete":true}
notification.enqueued -> {"notificationKind":"turn","status":"completed-clean"}
mail.sent             -> turn, bodyChars 24, recipientCount 1
notification.outcome  -> attempts 1, ok true
```

The loopback server accepted exactly two messages:

```text
1. [DSH] Input required — Choose Mode
2. [DSH] Task completed — probe-scripted
```

This exercises the v0.2.0 envelope rather than the legacy completion path alone. No real message was
sent to a real mailbox in this phase; the release's SMTP evidence is loopback acceptance, which is
recorded as acceptance and not as mailbox delivery.

## Verified DSH versions

```text
DSH 0.1.5-rc.1     new v0.2.0 paths re-verified on the published 0.2.0 artifact in this phase
                   (isolated registry install, real headless boot, question path, completion path,
                   loopback SMTP acceptance)
DSH 0.1.5-rc.2     not revalidated for v0.2.0; the human-attention paths were never tested on it
Node ^22.19.0 || >=24.0.0
```

The three new paths in this release — terminal-failure, question, and approval notifications —
depend on DSH's event contracts for turn outcomes, questions and approvals, and were validated only
against `0.1.5-rc.1`. That is the version actually installed and executed; it is also the only DSH
version this project has ever installed. The v0.1.1 statement that covered `0.1.5-rc.2` was about
the turn-completion and telemetry paths on that release's archive, and it is deliberately **not**
carried over: a peer dependency range is a SemVer range, not a compatibility statement.

## Changes in v0.2.0

**Terminal failure notifications.** `notifyErrors = true` now sends a failure email when a turn ends
in a terminal error even when no final visible assistant output exists; the earlier rule suppressed
that case, so a turn that died before emitting text notified nobody. Terminal structured failures
(`QUOTA`, `RATE_LIMIT`, `TIMEOUT`, `TRANSPORT`, and others) are classified from the structured
`code`, never from message text. Only a turn that actually ends in error sends this mail: recovered
internal retries do not, because no terminal turn outcome exists to report, and this release does not
claim that every `429` generates mail. The default remains `false`, so the corrected semantics do not
make an existing `notifyErrors: false` configuration start sending failure mail.

**Question notifications.** New switch `notifyQuestions`, default `false`. When enabled, an
`ask_user_question` call that blocks the agent can send `[DSH] Input required`. Only allowlisted
human-facing question fields are included — the question text and its options — while generic tool
arguments remain excluded.

**Approval notifications.** New switch `notifyApprovals`, default `false`. When enabled, an
`approval/asked` event can send `[DSH] Approval required`. Mail carries only safe approval audit
fields (tool name, call id, reason); approved tool arguments are not sent. Notifications are
deduplicated by approval id, so a duplicate `approval/asked` produces exactly one notification.

**Privacy-safe defaults.** `notifyQuestions = false`, `notifyApprovals = false` and
`notifyErrors = false` remain the default posture for the sensitive paths. Opening any switch is a
deliberate act that sends the corresponding information through the configured mail system. The
switches are independent: enabling one never enables another.

**Retained behaviour.** Turn-level token aggregation, `schemaVersion 2`, duration semantics
(`turn/end.time - turn/start.time`), and Nodemailer 10 are unchanged. `schemaVersion` does not change
again in this release.

## Known limitations

The still-applicable v0.1.1 limitations are retained:

1. **Deduplication is per process only.** It does not survive a restart, so a replayed turn can
   produce a second message.
2. **A mid-turn duration is unknown.** Attaching after `turn/start` leaves no start time, so the
   duration is reported as unknown rather than reconstructed.
3. **The queue is not persistent.** When it is full the newest notification is refused and counted,
   not stored.
4. **SMTP acceptance is not mailbox delivery.** A message the server accepted can still fail to reach
   the recipient's mailbox, and this plugin cannot observe that.
5. **Later DSH versions are untested.** Only `0.1.5-rc.1` was verified for the v0.2.0 paths.
6. **An unobservable retry can make token telemetry incomplete.** The plugin reports that
   incompleteness explicitly but cannot recover the missing counters.

Additional limitations specific to this release:

7. **Question and approval email are notification-only.** Email replies cannot answer DSH, and there
   are no action links and no remote approval callbacks. A human who receives these messages must
   still act inside DSH.
8. **Human-attention notification support depends on the verified DSH event contracts.** On a DSH
   release that changes those contracts, these paths can stop firing or change shape.
9. **Generic tool arguments remain excluded** from every notification path by design, so a message
   explains that attention is required without reproducing the tool's input.

This release does not claim exactly-once delivery, guaranteed mailbox delivery, complete token usage
for every turn, support for untested DSH versions, or zero future vulnerabilities.

## Post-release documentation

The release source commit `713100ac` is immutable; `v0.2.0` will not be moved to any later commit.
Documentation updates after publication are a separate commit on `main`:

```text
docs: record v0.2.0 release
```

Files created or updated by that commit: `RELEASE_V0.2.0.md`, `RELEASE_NOTES_V0.2.0.md`,
`README.md`, `00_MASTER.md`, `docs/RELEASE.md`. Their commit hash is recorded in the final Phase 9
report rather than here, because a file cannot name the commit that contains it.
