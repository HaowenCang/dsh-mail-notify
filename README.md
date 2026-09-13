# dsh-mail-notify

DeepSeek Harness (DSH) host plugin. When a **top-level** Agent turn finishes, it emails that
turn's final user-visible model output over SMTP.

- Plugin name / patch row id: `dsh-mail-notify`
- Version: `0.1.1` (released; `0.1.0` is the previous release)
- Host-only: no browser half, no UI, no Client package
- Requires DSH `0.1.5-rc.1` or `0.1.5-rc.2`, and Node `^22.19.0 || >=24.0.0`
- Requires Nodemailer `10.x` (the only runtime dependency; resolved automatically on install)

**Verified DSH versions.** Both candidates below were tested, not inferred from the peer range. The
`^0.1.5-rc.1` range in `package.json` is a SemVer range, not a compatibility statement, and it does
not assert that later `0.1.5` releases work.

| DSH version | Status | Evidence |
| --- | --- | --- |
| `0.1.5-rc.1` | Verified | Full suite and the runtime contract probe against that installation; isolated install, boot, live turn, and delivery over both a loopback SMTP peer and real SMTP; multi-step turn telemetry |
| `0.1.5-rc.2` | Verified | Full suite and the runtime contract probe against that installation; isolated install, boot, live turn, and delivery over both a loopback SMTP peer and real SMTP; multi-step turn telemetry |

Versions outside this table are untested. See [`PHASE4_1_REPORT.md`](PHASE4_1_REPORT.md),
[`PHASE6_REPORT.md`](PHASE6_REPORT.md), and [`PHASE6_1_REPORT.md`](PHASE6_1_REPORT.md).

**Nodemailer 10.** Phase 6's telemetry release candidate originally retained Nodemailer 7.x; the
pre-release security review upgraded it to the supported major. Nodemailer supports only its current
major for security fixes, and 7.x was inside the affected range of several advisories including
`GHSA-2x7j-588g-ccc2` (a quadratic-time address parser). The range is declared as `^10.0.9`, so a
fresh install cannot resolve back onto an unpatched line and cannot cross to `11` unattended.
Nodemailer 10 ships its own TypeScript declarations, so `@types/nodemailer` is not installed
alongside it — the two together produce conflicting declarations of the same module. The upgrade
changed no source line: the plugin reaches Nodemailer through one file and one call shape. See
[`PHASE6_1_REPORT.md`](PHASE6_1_REPORT.md).


**v0.1.1 released.** It is published as `dsh-mail-notify@0.1.1` on npm, tagged `v0.1.1` at commit
`340ef362`, with the release archive attached to the GitHub Release. The local archive, the npm
registry artifact, and the GitHub asset are byte-identical. It changes what the email's token line
means, so a reader who compares a `0.1.0` message with a `0.1.1` message will see different numbers
for the same turn: `0.1.0` reported the **last model call's** counters, `0.1.1` reports the **whole
turn's** aggregate. See [`RELEASE_V0.1.1.md`](RELEASE_V0.1.1.md), [`PHASE6_REPORT.md`](PHASE6_REPORT.md),
and D017 in [`docs/DECISIONS.md`](docs/DECISIONS.md).

**v0.1.0 released.** The candidate was validated end to end against a real SMTP server: a synthetic
smoke message and a real top-level Agent turn both reached `mail.sent` from the shipped package. See
[`PHASE4_REPORT.md`](PHASE4_REPORT.md). It is published as `dsh-mail-notify@0.1.0` on npm, tagged
`v0.1.0` at commit `02191a4`, with the release archive attached to the GitHub Release. See
[`RELEASE_V0.1.0.md`](RELEASE_V0.1.0.md).

The plugin never reads reasoning text, tool arguments, tool results, the system prompt, or your
own prompt (unless you explicitly enable the last one), and it never puts the SMTP password in a
file it ships.

---

## What it does

At `turn/end` the plugin builds one `NotificationCandidate` — the turn's facts, not a copy of any
runtime object — decides whether that turn deserves an email, and hands it to a bounded queue. A
single background worker resolves the SMTP password from the DSH Credential service for that one
send, renders the message, and transmits it.

Three properties are worth stating plainly, because they are design boundaries rather than
limitations discovered later:

| Property | Meaning |
| --- | --- |
| **Top-level turns only** | Subagent turns produce nothing by default (`includeSubagents: false`). |
| **Completed-clean means "DSH reported no explicit tool failure"** | It does **not** mean every shell command succeeded. A `pwsh` non-zero exit is a successful tool result in DSH and is not counted. |
| **Deduplication is in-process only** | At most one email per `(sessionId, turn)` per DSH process lifetime. Restarting DSH can produce a second email for a replayed turn. |
| **Token usage is the whole turn, or it says it is not** | DSH reports token counters per model call. The plugin sums every call it observed in the turn and states whether that covers all of them (`Token telemetry complete:`). From `0.1.1` onward this is the turn aggregate; `0.1.0` reported only the last model call. |

The metadata block of the body looks like this:

```text
Status:    Task completed (completed-clean)
Session:   session-7abf8371-0583-4160-967d-df591b335d66
Turn:      2
Duration:  6 min 55 s
Provider:  command-goat
Model:     deepseek/deepseek-v4.1-flash
Workspace: E:\Projects\DSHarness\dsh-mail-notify
Tool errors reported by DSH: 0
Telemetry complete: yes
Token usage (turn aggregate): inputTokens=272069, outputTokens=18151, cacheReadTokens=2430720, cacheWriteTokens=not reported, reasoningTokens=not reported
Token telemetry complete: yes (19 model calls observed, each reporting usage)
```

`Duration` is `turn/end` minus `turn/start` and therefore covers model time, tool time, and every
wait in between. `Token usage` is a sum of per-call counters: `cacheWriteTokens=not reported` means
no call in that turn reported the bucket, which is not the same as `0`. `Token telemetry complete:
no` means at least one model call of the turn reported no usage — a retried call, for instance —
and the numbers above cover only the rest. The plugin never derives a total, a cost, or a missing
counter.

---

## Install

The plugin ships as a DSH bundle: `package.json` declares `dsh.bundle.patch`, so installing the
package also mounts it.

```powershell
dsh plugin --profile web add dsh-mail-notify@0.1.1
```

For development, or on a machine without registry access, install the packed archive instead:

```powershell
# From the directory holding the packed archive:
dsh plugin --profile web add ./dsh-mail-notify-<version>.tgz
```

Verify that the bundle was recognised — the package name must appear in `dsh.profile.bundles`:

```powershell
dsh plugin --profile web list
dsh --profile web --dump-config | Select-String -Pattern 'dsh-mail-notify' -Context 0,3
```

The shipped `cordis.patch.yml` sets `enabled: false`, so a fresh install is inert. Nothing is
registered and no email can be sent until you configure it. That is deliberate: installing a
notification plugin should not start emailing you before you have told it where to send.

Restart DSH after installing. This profile uses `patchReload: startup`, so a new row takes effect
on the next boot.

## Configure

Add a row to the profile's own patch file (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`). A
patch **replaces** the targeted row's whole `config`, so restate every key you rely on; omitted
keys fall back to the schema defaults.

```yaml
- id: dsh-mail-notify
  config:
    enabled: true

    smtpHost: smtp.example.com
    smtpPort: 587
    smtpSecure: false
    smtpUser: notify@example.com
    smtpPasswordCredential: DSH_MAIL_SMTP_PASSWORD

    from: notify@example.com
    to:
      - you@example.com

    includeSubagents: false
    notifyCompleted: true
    notifyErrors: false
    notifyMaxTokens: true

    minTurnDurationMs: 0
    maxBodyChars: 100000

    includeMetadata: true
    includeUserPrompt: false
    includeFooter: true

    queueSize: 100
    retryAttempts: 3
    retryBaseDelayMs: 1000
    maxDedupeEntries: 1000
```

| Field | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | `false` registers **nothing**: no listener, no queue, no credential read. |
| `smtpHost` | — required | Non-empty, no whitespace. |
| `smtpPort` | `587` | Integer 1–65535. |
| `smtpSecure` | `false` | `true` = implicit TLS (normally 465); `false` allows a STARTTLS upgrade (normally 587). |
| `smtpUser` | — required | Authentication user name. |
| `smtpPasswordCredential` | — required | A credential **reference name**, never a password. Matches `^[A-Za-z_][A-Za-z0-9_]*$`. |
| `from` | — required | Envelope sender. |
| `to` | — required | One or more addresses. An empty or entirely invalid list refuses to mount. |
| `includeSubagents` | `false` | Turning this on sends subagent output too; read the security section first. |
| `notifyCompleted` | `true` | Covers `completed-clean` and `completed-with-tool-errors`. |
| `notifyErrors` | `false` | Covers `status === 'error'`. |
| `notifyMaxTokens` | `true` | Covers `status === 'max-tokens'`. |
| `minTurnDurationMs` | `0` | Suppresses turns shorter than this. An **unknown** duration is never suppressed. |
| `maxBodyChars` | `100000` | Visible-text cap in code points, 1000–1000000. |
| `includeMetadata` | `true` | Session id, workspace, model, timing, status block. |
| `includeUserPrompt` | `false` | Adds the turn's last user message. Off by default. |
| `includeFooter` | `true` | Generator footer **and** the truncation marker. |
| `queueSize` | `100` | Waiting jobs; the worker holds one more. Full queue refuses the newest. |
| `retryAttempts` | `3` | Retries; total attempts are `1 + this`. `0` means try once. |
| `retryBaseDelayMs` | `1000` | Retry *n* waits `base × 3^(n−1)`, capped at 30 s. |
| `maxDedupeEntries` | `1000` | Dedupe cache capacity. |

`aborted`, `blocked`, `interrupted`, and any unrecognised `turn/end` reason have **no** enabling
switch and never notify. There is also no option to send an email with an empty body: a turn with
no visible text is skipped regardless of the notification switches.

## Credential

Put the password in one of the layers the DSH Credential service reads, naming it with the value
you gave `smtpPasswordCredential`:

```text
inherited process environment                 (read-only, wins)
$DSH_HOME/.credentials.yaml                   (provider-managed, writable)
<invocation cwd>/.env                         (read-only fallback)
$DSH_HOME/.env                                (read-only fallback)
```

`.env.example` in this repository shows the `.env` form. The name must match exactly; an empty
stored value counts as absent, so a blank line configures nothing.

The password is resolved **inside every send attempt** and never cached; the Credential service
handle is looked up per attempt for the same reason. Rotating the password therefore takes effect
for the next email with no DSH restart. The plugin also never logs the value — only the reference
name and the `describe()` result (`configured`, `source`, `writable`).

What `$DSH_HOME/.credentials.yaml` does and does not give you: it keeps the secret out of ordinary
configuration files, out of this package's tarball, and out of logs. It is not a cryptographic
boundary. The file is plain YAML whose readability is decided by filesystem permissions, so any
process running as the same OS user — including an agent working in a shell — can read it. Treat the
file as a hygiene measure, not as protection against a compromised or curious local process.

## Start

Restart the profile after changing the patch file, then watch the log for one of three lines:

| Log line | Meaning |
| --- | --- |
| `plugin.disabled {"reason":"enabled is false"}` | Configured off. Nothing is registered. |
| `plugin.ready {…}` | Active. Sends unless a turn is suppressed. |
| `plugin.config-invalid {…}` | Refused to mount; the payload lists every failing field. |

With `enabled: true` and a valid configuration, the plugin does not need a DSH restart after a
**credential** change, only after a **configuration** change.

## Test the mail path

The automated suite never sends mail. One script does, and only when you run it:

```powershell
# Read the configuration and report what it would do, without sending:
npm run smoke

# Explicitly send one fixed test message:
npm run smoke -- --yes

# Point at another profile or an explicit patch file:
npm run smoke -- --profile headless
npm run smoke -- --config C:\path\to\cordis.patch.yml --yes
```

Before sending, the script checks that the credential reference is **configured** (through
`describe()`, never `resolve()`) and exits with code 2 and the reference name if it is not. It
prints no secret, accepts none on the command line, and uses the same `mailer`/`transport` code
path as production.

## Test the plugin itself

```powershell
npm install
npm run typecheck     # tsc --noEmit, sources and tests
npm test              # node --test, no network
npm run build         # tsc -> lib/
npm pack              # dsh-mail-notify-0.1.1.tgz
npm run pack:check    # audit the archive's contents
```

The suite is offline by construction: unit and adapter tests use plain fixtures, integration
tests use the built-in debug sink or a stub transport, and no test opens a socket.

## Update

```powershell
dsh plugin --profile web add dsh-mail-notify@<new-version>
```

For a locally packed archive, `npm pack` followed by
`dsh plugin --profile web add ./dsh-mail-notify-<new-version>.tgz` works the same way.

Restart DSH afterwards. An update replaces the installed copy; your patch file is untouched.

## Uninstall

```powershell
dsh plugin --profile web remove dsh-mail-notify
```

Then restart DSH. To stop emails **without** uninstalling, set `enabled: false` — that is the only
complete stop, because the notification switches still leave the listener and state accumulation in
place. If the plugin was injected through a development tool rather than installed as a package,
remove that injection instead.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No email, no plugin log line at all | The row is not mounted, or `enabled` is false. Check `dsh --profile <p> --dump-config` for the row. |
| `plugin.config-invalid` | The log payload names every failing field and its reason. `to` and the SMTP fields are the common ones. |
| `credential-missing` in the log | The reference name in `smtpPasswordCredential` is not configured in any credential layer, or the value is empty. The log line names the reference and its `describe()` state. |
| `notification.suppressed {"suppressedReason":"no-visible-text"}` | The turn produced no user-visible text. This is the most common reason for "nothing happened", and it is not an error. |
| `suppressedReason":"below-min-duration"` | `minTurnDurationMs` is set above the turn's real duration. |
| `suppressedReason":"disabled-by-policy"` | The status has no switch, or its switch is off. |
| `suppressedReason":"subagent-excluded"` | The turn was a subagent turn and `includeSubagents` is false. |
| `queue.rejected` | The queue was full; the newest turn was refused and counted. Raise `queueSize`, or investigate why sends are slow. |
| `mail.failed {"category":"unknown-error"}` | The SMTP failure was unrecognised, so it is treated as permanent and not retried. The line carries `code`/`responseCode`. |
| `mail.failed {"category":"smtp-auth"}` | Authentication was rejected. The password is never printed; re-check the credential value. |
| A turn finished but no candidate appears in the log | The plugin attached mid-turn: `durationMs` will be `null` and the counters only cover what it saw. That is expected and does not suppress the email. |
| The token numbers look far too small | You are reading a `0.1.0` message. That version reported the last model call's counters, not the turn's. Check `schemaVersion` in the log line; `2` is the aggregate. Both versions are still distinguishable this way after the v0.1.1 release. |
| `Token telemetry complete: no` | At least one model call of the turn reported no usable usage — a retried call is the usual cause. `candidate.produced` carries `usageMissingCount` and `usageUnobservableRetries` with the counts. |

**To see the plugin's own structured log lines** you need an exporter: Cordis buffers logs in
memory and prints nothing by itself. The `dsh` command line registers no exporter, which is why
this repository includes a development probe that boots a profile with one attached:

```powershell
node scripts/dev-boot-probe.mjs --profile web --only dsh-mail-notify -- --help
```

That probe is a development harness. It does not modify the harness and is not needed to use the
plugin.

## Security warnings

Enabling this plugin means the agent's final output leaves this machine and is stored by whichever
mail provider you configure. Before turning it on, consider:

1. Bodies can contain workspace paths, file fragments, and business identifiers.
2. If a recipient is a shared mailbox or a mailing list, everyone on it can read the content. The
   plugin cannot restrict that.
3. `includeUserPrompt: true` sends your own prompt text as well.
4. `includeSubagents: true` sends intermediate, often half-formed subagent output.
5. TLS certificate verification is **always on**. There is no setting to disable it, and
   `rejectUnauthorized: false` appears nowhere in the package. A self-signed certificate must be
   solved with a real trust chain.
6. Uninstalling or setting `enabled: false` is the only complete stop.

The full boundary — threat model, credential lifecycle, log redaction rules, and the list of
content that no configuration can send — is in [`docs/SECURITY.md`](docs/SECURITY.md).

## Known limitations

- **Deduplication does not survive a restart.** It is a bounded in-memory cache with a deliberately
  narrow guarantee: one email per `(sessionId, turn)` per process lifetime.
- **Duration is unknown for a mid-turn attach.** If the plugin loads after a turn has started, that
  turn's `durationMs` is `null` (not `0`), so `minTurnDurationMs` cannot suppress it.
- **Five of the six `turn/end` reasons have not been observed on a live turn.** `completed` is
  verified end to end in a real composition; `max-tokens`, `error`, `aborted`, `blocked`, and
  `interrupted` are verified against the recorded payload shapes and the frozen classification
  table, but triggering them live depends on model and provider behaviour.
- **`session/disposed` rarely fires.** DSH keeps sessions loaded for the life of the process, so the
  dominant release path is the per-turn cleanup, not that event.
- **Token counters are reported and folded, never interpreted.** `usage` is the sum of the per-call
  counters the runtime reported for the turn (D017). No cost, no unit conversion, no derived total,
  no zero-filling of a counter no call reported, and no reconciliation of an individual call's
  internal inconsistency.
- **A retried model call makes the token line incomplete.** Its usage is not part of any payload DSH
  writes, so the aggregate covers only the calls that reported counters and the email says so. The
  missing amount is not estimated.
- **A refused enqueue is not retried.** When the queue is full the newest turn is dropped and
  logged; the deduplication key is not spent, but nothing re-delivers that turn either.
- **Logs are only visible with an exporter attached.** See the troubleshooting note above.

## Documentation

| File | Contents |
| --- | --- |
| [`PHASE1_RUNTIME_CONTRACT.md`](PHASE1_RUNTIME_CONTRACT.md) | Runtime contract: the DSH services, events, and field paths confirmed by Inspect and by a live prototype |
| [`PHASE1_REPORT.md`](PHASE1_REPORT.md) | Phase 1 report: verification results, evidence levels, confirmed event flow, risks |
| [`PHASE2_REPORT.md`](PHASE2_REPORT.md) | Phase 2 report: the design freeze |
| [`PHASE3_REPORT.md`](PHASE3_REPORT.md) | Phase 3 report: implementation, verification results, packaging, runtime integration, git sync |
| [`PHASE4_REPORT.md`](PHASE4_REPORT.md) | Phase 4 report: real SMTP end-to-end validation and the v0.1.0 release candidate audit, including the four defects found and fixed |
| [`PHASE4_1_REPORT.md`](PHASE4_1_REPORT.md) | Phase 4.1 report: SMTP credential rotation, DSH `0.1.5-rc.2` compatibility verification, secret history scan, and the release-readiness decision |
| [`PHASE6_REPORT.md`](PHASE6_REPORT.md) | Phase 6 report: the turn-level token telemetry defect (`BUG-TEL-001`), the runtime evidence behind it, the duration investigation, the schema v2 migration, and the v0.1.1 release-candidate verification |
| [`PHASE6_1_REPORT.md`](PHASE6_1_REPORT.md) | Phase 6.1 report: the Nodemailer 7 → 10 security uplift, removal of `@types/nodemailer`, and the re-verification performed on the upgraded dependency |
| [`RELEASE_V0.1.1.md`](RELEASE_V0.1.1.md) | v0.1.1 release report: source commit, tag object, verification results, npm and GitHub publication records, the three-way artifact hashes, and the registry fresh-install result |
| [`RELEASE_NOTES_V0.1.1.md`](RELEASE_NOTES_V0.1.1.md) | The release notes published on the v0.1.1 GitHub Release |
| [`RELEASE_V0.1.0.md`](RELEASE_V0.1.0.md) | v0.1.0 release report: source commit, verification results, npm and GitHub publication records, and the release artifact hashes |
| [`RELEASE_NOTES_V0.1.0.md`](RELEASE_NOTES_V0.1.0.md) | The release notes published on the GitHub Release |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | D001–D017 decision records with reasons, rejected alternatives, and consequences |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module layout and per-module responsibility boundaries |
| [`docs/CONFIG_SPEC.md`](docs/CONFIG_SPEC.md) | Configuration specification: fields, defaults, validation, failure behaviour |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, credential lifecycle, TLS constraint, log redaction, privacy defaults |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) | Test matrix across six levels |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | P3.1–P3.7 execution plan with per-step verification and failure conditions |
| [`docs/DSH_INTEGRATION.md`](docs/DSH_INTEGRATION.md) | The DSH interfaces this plugin actually uses, and the versions they were verified against |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Build, pack, install, update, and rollback |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Functional scope and explicit non-goals |
| [`00_MASTER.md`](00_MASTER.md) | Original project design and the execution roadmap |

## License

MIT, see [`LICENSE`](LICENSE).
