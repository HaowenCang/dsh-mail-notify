# dsh-mail-notify v0.1.1 — release report

## Status

```text
PASS — v0.1.1 RELEASED
```

Phase 7 froze the release object, re-verified it, published it to npm, tagged it, created the GitHub
Release, and confirmed that the local archive, the npm registry artifact, and the GitHub Release
asset are byte-identical. No source, test, configuration, or dependency change was made in this
phase.

| Item | Value |
| --- | --- |
| Release source commit | `340ef3624126bc4cf8bd0f2c26394371e4fa7b56` |
| Annotated tag object | `819fde114357cb653d8ad902f74a8fd35d30a0af` |
| Tag target | `340ef3624126bc4cf8bd0f2c26394371e4fa7b56` |
| npm package / version | `dsh-mail-notify@0.1.1` (`latest`) |
| npm `dist.integrity` | `sha512-HcdOS/GaaG9Erk0Yaa9z4CHAzwaNnHsZy+mN7vT6OGjQTcVxIIu7o9eBecyHS+Lw1j6K/EdHQ9KcGyFdhmRLnQ==` |
| npm `dist.shasum` | `4e94e59a2be5c988cedccd206605c040f5e2c8eb` |
| GitHub Release | `dsh-mail-notify v0.1.1`, id `387947899`, published `2026-09-13T15:47:21Z` |
| GitHub Release asset | `dsh-mail-notify-0.1.1.tgz`, 90 405 bytes, asset id `561473929` |
| Previous release | `v0.1.0`, tag object `0d113e70406330c373eb0a1fef6cc8e78a837c30`, target `02191a43894f7cf9323641a1d117ae838c4a0c88` |

## Baseline gate

Execution began from the expected baseline, confirmed rather than assumed:

```text
branch          main
HEAD            340ef3624126bc4cf8bd0f2c26394371e4fa7b56
origin/main     340ef3624126bc4cf8bd0f2c26394371e4fa7b56
ahead/behind    0 0
working tree    clean
v0.1.1 tag      absent
v0.1.0 npm      present (latest)
v0.1.1 npm      absent (E404)
v0.1.1 Git tag  absent
v0.1.1 Release  absent
```

`v0.1.0` was neither moved, deleted, recreated, nor force-updated. It still resolves to the same
annotated tag object and the same target commit.

## Artifact

**Reproduction.** `npm pack` was re-run at `340ef362` after deleting the previous archive. The
resulting SHA-256 is identical to the archive verified in Phase 6.1, so the one-commit delta between
that terminal state and `340ef362` did not enter the archive — as expected, since the delta touched
only a Phase report outside the `files` whitelist. The release therefore publishes the archive whose
contents were already verified, at a commit that is now frozen.

| Stage | SHA-256 | Size |
| --- | --- | --- |
| Local verified tarball | `5b6328d878178b79ff3e83cde1e1596862cea71a076e32bc4ef220821b6f9f9a` | 90 405 B |
| npm registry artifact | `5b6328d878178b79ff3e83cde1e1596862cea71a076e32bc4ef220821b6f9f9a` | 90 405 B |
| GitHub Release asset | `5b6328d878178b79ff3e83cde1e1596862cea71a076e32bc4ef220821b6f9f9a` | 90 405 B |

```text
three-way artifact equality: PASS
```

The npm and GitHub copies were downloaded to a temporary directory and hashed locally; the npm hash
was not inferred from `dist.integrity`, and the GitHub hash was checked both against the API's own
`digest` field (`sha256:5b6328d8…f9f9a`) and by hashing the downloaded asset.

**Archive contents.** 80 entries: 19 `.js`, 19 `.d.ts`, 38 `.map`, plus `package.json`, `README.md`,
`LICENSE`, and `cordis.patch.yml`. No `src/`, `tests/`, `scripts/`, `.credentials`, `.env`, `.tgz`,
`.key`, or `.pem` entry exists in the archive, and the secret scan reported 0 credential-value hits
and 0 credential-shaped-literal hits across all 80 entries.

The packed manifest declares `version 0.1.1`, exactly one runtime dependency (`nodemailer: ^10.0.9`),
and no `@types/nodemailer` in any dependency class. The shipped `cordis.patch.yml` carries
`enabled: false` and no credential reference value.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Text integrity | `npm run check:text` | PASS — 70 text files, strict UTF-8, BOM-free, no mojibake |
| Typecheck | `npm run typecheck` | Exit 0 (`tsc --noEmit` over sources, then over sources + tests + scripts) |
| Test suite | `npm test` | **336 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo** |
| Build | `npm run build` | Exit 0 |
| Archive audit | `npm run pack:check` | PASS — required entries present, no forbidden entry |
| Secret scan | `npm run scan:secrets` | PASS — 80 entries, 341 774 bytes, 0 hits |
| Production audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Runtime dependency | `npm ls nodemailer` | `nodemailer@10.0.9`, satisfying the declared `^10.0.9` |
| Legacy types | `npm ls @types/nodemailer` | Empty — not declared and not installed |

The 336/0/0/0 figure matches the Phase 6.1 terminal record (that report's §9; the "337" appearing in
one sentence of `00_MASTER.md` is a transcription slip in the roadmap, not a test-count change).
No snapshot was updated, no test was skipped or modified, and no source file was touched.

## Registry fresh install

An isolated headless profile (`mnrel011h`, created from the shipped `headless` template) was created
with no prior state, and the package was installed **from the registry** by specifier rather than
from the local tarball:

```powershell
dsh plugin --profile mnrel011h add dsh-mail-notify@0.1.1
```

| Property | Result |
| --- | --- |
| Package installed | `dsh-mail-notify@0.1.1` in the profile's `dependencies` |
| Bundle recognised | `dsh-mail-notify` appended to `dsh.profile.bundles` |
| Nodemailer 10 present | `nodemailer@10.0.9` alongside the package |
| `@types/nodemailer` absent | No `@types` directory anywhere in the profile's `node_modules` |
| Shipped patch inert | `--dump-config` shows `enabled: false` and no SMTP or credential configuration |
| Plugin imports and mounts | `plugin.ready` emitted with the validated configuration |
| Controlled turn | One real top-level turn ran to completion (`durationMs: 2531`) |

The controlled turn was pointed at a loopback SMTP peer on `127.0.0.1:2525`, which received and
recorded a complete SMTP conversation. The released artifact's own production path ran end to end:

```text
plugin.ready          -> mount and configuration validation
candidate.produced    -> {"schemaVersion":2,"status":"completed-clean","durationMs":2531,
                          "usageSampleCount":1,"usageMissingCount":0,"usageComplete":true,
                          "telemetryComplete":true,"sawTurnStart":true}
notification.enqueued
mail.sent             -> bodyChars 18, recipientCount 1
notification.outcome  -> attempts 1, ok true
```

The captured body carries the turn aggregate and the explicit completeness claim:

```text
Duration:  2.5 s
Telemetry complete: yes
Token usage (turn aggregate): inputTokens=3887, outputTokens=8, cacheReadTokens=7168, cacheWriteTokens=not reported, reasoningTokens=not reported
Token telemetry complete: yes (1 model call observed, each reporting usage)
```

`cacheWriteTokens` is rendered as `not reported` rather than `0`, which is the behaviour D017
requires for a counter no call reported. The body contains no reasoning text, no tool arguments, no
tool results, and no credential value; `includeUserPrompt` is `false`, so the prompt is absent.

The loopback conversation also shows the credential being resolved at send time and the envelope
being accepted:

```text
EHLO [127.0.0.1] -> AUTH PLAIN <received, not recorded> -> MAIL FROM -> RCPT TO -> DATA -> 250
```

No real message was sent to a real mailbox for this verification. The v0.1.0 and v0.1.1 candidates
were previously validated against real SMTP during Phases 4 and 6.1; this phase's contribution is
that the *published* artifact reproduces that behaviour from the registry. As before, SMTP
acceptance is recorded as acceptance and not as mailbox delivery.

## Verified DSH versions

```text
DSH 0.1.5-rc.1     re-verified on the published 0.1.1 artifact in this phase (isolated registry install,
                   mount, controlled turn, loopback SMTP acceptance)
DSH 0.1.5-rc.2     verified during Phases 6 and 6.1 on the identical archive at the same source state
Node ^22.19.0 || >=24.0.0
```

The archive is byte-identical to the one verified against `0.1.5-rc.2`, so that result carries over
to the released artifact unchanged. Later DSH versions remain untested, and the `^0.1.5-rc.1` peer
range in `package.json` is a SemVer range rather than a compatibility statement.

## Changes in v0.1.1

**Token telemetry is a turn aggregate.** In v0.1.0 the email's usage line carried the counters of
one model call — the last call that reported usage — while reading as though it described the turn.
v0.1.1 folds every observed call's counters into a turn-level aggregate and states the number of
calls it covers. The body renders two separate completeness claims: `usageComplete` (every
accountable model call reported usage) and `telemetryComplete` (the plugin saw the turn from its
`turn/start`). A call without a usable usage report, and a retried call whose usage could not be
observed, both mark the aggregate incomplete and are named in the body. Reasoning tokens remain a
subset of output tokens and are never added to them; an unreported bucket stays unreported rather
than becoming zero; a sum leaving the safe-integer range withholds the aggregate.

**`schemaVersion` 1 → 2.** The `usage` field changed meaning, so the discriminator changed with it
(D013/D017). A consumer reading a v2 aggregate as a v1 last-call sample would be wrong by
construction, and the version field is what prevents that.

**Duration: investigated, unchanged.** The duration algorithm was examined against the same real
turn population used for the telemetry work and was found **already correct**; no defect was
reproduced and no line was changed. Its definition remains `turn/end.time - turn/start.time`. A
turn whose start was never observed still reports an unknown duration.

**Security uplift.** Nodemailer 7 → 10 (`^10.0.9`), removing the advisory that applied to
`nodemailer@7.0.13`; `@types/nodemailer` removed because Nodemailer 10 ships its own declarations
and the two conflict. `npm audit --omit=dev` reports 0 vulnerabilities. The upgrade changed no
source line: the plugin reaches Nodemailer through one module and one call shape.

## Known limitations

Unchanged from v0.1.0. The release does not widen any existing guarantee.

1. **Deduplication is per process only.** At most one email per `(sessionId, turn)` per DSH process
   lifetime. A restart can produce a second message for a replayed turn.
2. **A mid-turn duration is unknown.** Attaching after `turn/start` leaves no start time, so the
   duration is reported as unknown rather than reconstructed.
3. **The queue is not persistent.** When it is full the newest notification is refused and counted,
   not stored.
4. **SMTP acceptance is not mailbox delivery.** A message the server accepted can still fail to
   reach the recipient's mailbox, and this plugin cannot observe that.
5. **Later DSH versions are untested.** Only `0.1.5-rc.1` and `0.1.5-rc.2` were verified.
6. **An unobservable retry can make token telemetry incomplete.** v0.1.1 reports that incompleteness
   explicitly but cannot recover the missing counters.

This release does not claim exactly-once delivery, support for all DSH versions, complete token
usage for every turn, or zero future vulnerabilities.

## Post-release documentation

The release source commit `340ef362` is immutable; `v0.1.1` will not be moved to any later commit.
Documentation updates after publication are a separate commit on `main`:

```text
docs: record v0.1.1 release
```

Files created or updated by that commit: `RELEASE_V0.1.1.md`, `RELEASE_NOTES_V0.1.1.md`,
`README.md`, `00_MASTER.md`, `docs/RELEASE.md`. Their commit hash is recorded in the final Phase 7
report rather than here, because a file cannot name the commit that contains it.
