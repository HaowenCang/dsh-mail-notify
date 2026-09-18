# dsh-mail-notify

DeepSeek Harness (DSH) host plugin. It emails a **top-level** Agent turn's final user-visible model
output, that turn's terminal failures, and the mid-turn requests at which the agent blocked waiting
for a person — over SMTP.

- Plugin name / patch row id: `dsh-mail-notify`
- Version: `0.2.0` (released)
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


**v0.2.0 released.** It is published as `dsh-mail-notify@0.2.0` on npm, tagged `v0.2.0` at commit
`713100ac`, with the release archive attached to the GitHub Release. The local archive, the npm
registry artifact, and the GitHub asset are byte-identical (SHA-256
`50d130b57cf8668ff73573fd5ee2e0555f41014531c4d58aae3239c54f6e820d`). What it adds is two notification
lifecycles beside the release that already existed — a **terminal turn failure** and a **mid-turn
human-attention request** — with two new switches, `notifyQuestions` and `notifyApprovals`, both off
by default. `notifyErrors` keeps its `false` default and gains the meaning it always claimed: a failed
turn is mailed even when it produced no visible assistant output. `smtpPasswordCredential` takes
exactly one form — the DSH `CredentialRef` grammar `^[A-Za-z_][A-Za-z0-9_]*$`, an environment-style
name such as `DSH_MAIL_SMTP_PASSWORD`. The new paths were validated only against DSH `0.1.5-rc.1`;
see [`RELEASE_V0.2.0.md`](RELEASE_V0.2.0.md) and
[`RELEASE_NOTES_V0.2.0.md`](RELEASE_NOTES_V0.2.0.md).

The end-to-end probe in this repository boots the shipped `headless` profile against a disposable
DSH home, a loopback SMTP server, a scripted model provider, and a human stand-in. Its scenarios were
measured on this machine: `questions` delivered exactly two messages, `[DSH] Input required — Choose
Mode` and `[DSH] Task completed — probe-scripted`, which is what proves a mid-turn question's dedupe
namespace does not consume the turn's; `errors` delivered exactly one, `[DSH] Task failed — QUOTA
(402)`; `approvals` delivered exactly two, with the approval mail observed over SMTP while the
answerer was still withholding its decision, and the printed timeline placing `approval/asked` before
that mail and the mail before `approval/decided`; `approvals-duplicate` published the same approval
id twice and still sent one approval mail; `approvals-rejected` sent one approval mail beside the
turn's own settlement and none at the decision. The `credentials` scenario checks the reference
grammar and resolution against the installed credential store. See
[`PHASE8_1_REPORT.md`](PHASE8_1_REPORT.md).

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
file it ships. From `0.2.0` that rule carries two enumerated exceptions, both off by default: the
presentation fields of an `ask_user_question` call, and the tool name and reason of an approval ask.
Neither exception covers any other tool's arguments. Section *Notification families* below states
exactly what each one carries.

---

## What it does

When a **top-level** Agent turn finishes, the plugin builds one `NotificationCandidate` — the turn's
facts, not a copy of any runtime object — decides whether that turn deserves an email, and hands it
to a bounded queue. The same queue also carries two mid-turn families, produced while the agent is
still blocked: a question the agent asked a human, and an approval it is waiting for. A single
background worker resolves the SMTP password from the DSH Credential service for that one send,
renders the message, and transmits it.

Five properties are worth stating plainly, because they are design boundaries rather than
limitations discovered later:

| Property | Meaning |
| --- | --- |
| **Top-level turns only** | Subagent turns produce nothing by default (`includeSubagents: false`). Since `0.2.0` the same switch covers all three families, so a subagent's question or approval is silent too. |
| **Completed-clean means "DSH reported no explicit tool failure"** | It does **not** mean every shell command succeeded. A `pwsh` non-zero exit is a successful tool result in DSH and is not counted. |
| **Deduplication is in-process only** | At most one email per family lifecycle per DSH process lifetime. Restarting DSH can produce a second email for a replayed turn. |
| **Token usage is the whole turn, or it says it is not** | DSH reports token counters per model call. The plugin sums every call it observed in the turn and states whether that covers all of them (`Token telemetry complete:`). From `0.1.1` onward this is the turn aggregate; `0.1.0` reported only the last model call. |
| **A human-attention mail is notification-only** | A question or an approval mail says that someone is needed. It cannot be answered by reply, and there is no link to click: the plugin never constructs a DSH Web link and never reads or sends a token. |

### Notification families

Three lifecycles are notified, each with its own trigger and its own dedupe key. A mail always
states which one it is, in the subject and in the body.

**A settled turn.** Produced at `turn/end` for a top-level turn, under `notifyCompleted`,
`notifyErrors`, or `notifyMaxTokens`. The body carries the turn's final visible assistant text plus
the metadata block. `aborted`, `blocked`, `interrupted`, and any unrecognised reason have no switch
and never notify.

**A terminal failure.** Also produced at `turn/end`, and only there. What makes it a failure is the
final reason: `turn/end` with `reason.kind === 'error'`. `llm/retry` is a durable record of one
failed model call, not a failure notification — if DSH retries and the turn then completes, no
incident mail is sent, because only the final `turn/end` reason decides. This is the one case where
the old "no visible text means no mail" rule is lifted: a provider failure frequently produces no
assistant output at all, and that is exactly the failure worth knowing about. A *completed* turn with
empty text is still suppressed.

The failure mail names the structured code, and the HTTP status when the provider reported one:

```text
[DSH] Task failed — QUOTA (429)
```

Only `code` classifies anything. The provider's message is carried for a human reader and is never
pattern-matched, so a failure whose text happens to say `"429"` is still classified by its code. The
body gains a `--- Failure ---` section, which writes `not reported` for each fact the runtime did not
supply rather than a default value. Output produced before the failure keeps its own heading,
`--- Partial model output before failure ---`, so partial text is never read as the final answer;
when there was none, the mail says so instead of leaving a gap.

**A mid-turn human-attention request.** Two triggers, both durable session events, and neither is a
waterfall. A question is produced by observing the `tool/call` event whose name is exactly
`ask_user_question`; an approval is produced by observing the `approval/asked` audit event. The
plugin registers neither `user-questions/request` nor `approval/request`: those are answer-ownership
chains, and a notification plugin must not join one. `approval/decided` produces no mail, because the
human has already acted and a second "you are needed" message at that point would be false. These
notifications are enqueued synchronously on the event, while DSH is still blocked on the human, and
they never wait for `turn/end`.

```text
[DSH] Input required — Choose Mode
[DSH] Approval required — bash
```

A question's subject names the question's own header when the call carried one, or the question count
when it carried several. An approval's subject names the exact tool awaiting the decision, and its
body states plainly that the approved tool's arguments are not published by DSH and are not in the
message. Both bodies end by saying to open DSH to answer, and that the message cannot be answered by
reply.

### Configuration switches and content

| Switch | Default | What enabling it sends to the mail system |
| --- | --- | --- |
| `notifyCompleted` | `true` | The turn's final visible assistant output and the metadata block |
| `notifyMaxTokens` | `true` | The same, for a turn truncated at the token limit |
| `notifyErrors` | `false` | The turn's failure code, HTTP status, provider retry delay, and provider message, plus whatever partial output preceded the failure |
| `notifyQuestions` | `false` | The question text, its id, its header, its option labels and descriptions, and whether it accepts more than one choice |
| `notifyApprovals` | `false` | The tool name awaiting a decision and the asker's reason |

**Turning any interaction notification on sends that content to a third-party mail system.** A
question's text is written by the model and may quote your task, your file paths, or a business
identifier; an approval's reason is written by whichever component raised the ask. Both leave this
machine and are stored by your mail provider. Read [`docs/SECURITY.md`](docs/SECURITY.md) before
enabling either.

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

A human-attention body carries a shorter metadata block, because a mid-turn request has no duration
and no token aggregate to report:

```text
Status:    Waiting for a human
Session:   session-7abf8371-0583-4160-967d-df591b335d66
Turn:      1
Step:      1
Workspace: E:\Projects\DSHarness\dsh-mail-notify
Observed:  2026-09-18T15:33:11.596Z
```

After that block comes either `--- Question ---` or `--- Approval ---`, and the mail ends by saying
to open DSH to answer because the message cannot be answered by reply.

---

## Install

The plugin ships as a DSH bundle: `package.json` declares `dsh.bundle.patch`, so installing the
package also mounts it.

```powershell
dsh plugin --profile web add dsh-mail-notify@0.2.0
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
    notifyQuestions: false
    notifyApprovals: false

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
| `smtpPasswordCredential` | — required | A credential **reference name**, never a password. Exactly the DSH `CredentialRef` grammar, `^[A-Za-z_][A-Za-z0-9_]*$` — an environment-style name such as `DSH_MAIL_SMTP_PASSWORD`. A `<scope>/<id>` value is a `CredentialKey`, which `resolve()` cannot read, so it is refused at mount with an explanation (D019). |
| `from` | — required | Envelope sender. |
| `to` | — required | One or more addresses. An empty or entirely invalid list refuses to mount. |
| `includeSubagents` | `false` | Turning this on sends subagent output, subagent questions, and subagent approvals too; read the security section first. |
| `notifyCompleted` | `true` | Covers `completed-clean` and `completed-with-tool-errors`. |
| `notifyErrors` | `false` | Covers `status === 'error'`. A terminal failure is mailed **even when the turn produced no visible assistant output**; a completed turn with empty text is still suppressed. |
| `notifyMaxTokens` | `true` | Covers `status === 'max-tokens'`. |
| `notifyQuestions` | `false` | Covers an agent blocked on `ask_user_question`. Off by default; enabling it sends the question's text and options to the mail system. |
| `notifyApprovals` | `false` | Covers an agent blocked on an approval decision. Off by default; enabling it sends the tool name and the asker's reason to the mail system. The approved tool's arguments are never sent. |
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
switch and never notify. There is also no option to send a *completion* mail with an empty body: a
completed or max-tokens turn with no visible text is skipped regardless of the notification
switches. A **terminal failure** is the one exception — it is mailed even with no visible output,
because the failure itself is the message.

`minTurnDurationMs` applies only to the settled-turn notification. It is never applied to a question
or an approval: an agent that asks something two seconds into a turn is exactly the case the mail
exists for, and a turn-length floor would suppress it.

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
stored value counts as absent, so a blank line configures nothing. A password kept in
`$DSH_HOME/.credentials.yaml` belongs in that document's `refs:` section under the same
environment-style name — that section is the one `resolve()` reads, and its keys are validated
against the `CredentialRef` grammar. The store's `<scope>/<id>` keys belong to the separate
`records:` section, which this plugin never reads, so `smtpPasswordCredential` does not accept that
form (D019).

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
npm pack              # dsh-mail-notify-0.2.0.tgz
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
| A failed turn produced no email | `notifyErrors` is `false` by default, and the log line will read `suppressedReason":"disabled-by-policy"`. |
| No question email arrived | `notifyQuestions` is `false` by default. `notification.suppressed {"notificationKind":"question"}` names the reason. |
| A question call produced no email although the switch is on | Look for `question.unparsable`, which carries `dropReason` and `argumentsReadable` and nothing else — the argument text is deliberately not logged. |
| No approval email arrived | `notifyApprovals` is `false` by default. Check that the ask actually appended an `approval/asked` audit event: nothing is mailed from `approval/request`, and nothing at all from `approval/decided`. |

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
4. `includeSubagents: true` sends intermediate, often half-formed subagent output, and the same
   applies to a subagent's question or approval.
5. `notifyQuestions: true` and `notifyApprovals: true` send the model's own question text, the
   option labels and descriptions it wrote, the name of the tool awaiting approval, and the asker's
   reason. That content is written by the agent, not by the plugin, and it can quote your task or
   your workspace.
6. The plugin never builds a DSH Web link, never reads a token, and never puts one in a message. A
   human-attention mail is notification-only: it cannot be answered by reply, and it carries no
   credential, session secret, or deep link.
7. TLS certificate verification is **always on**. There is no setting to disable it, and
   `rejectUnauthorized: false` appears nowhere in the package. A self-signed certificate must be
   solved with a real trust chain.
8. Uninstalling or setting `enabled: false` is the only complete stop.

The full boundary — threat model, credential lifecycle, log redaction rules, the enumerated
human-attention exceptions, and the list of content that no configuration can send — is in
[`docs/SECURITY.md`](docs/SECURITY.md).

## Test the notification families

The automated suite never sends mail and never boots DSH. One probe does both, and only when you run
it. `scripts/probe-e2e.mjs` with `scripts/probe/` starts a loopback SMTP server on an OS-chosen port,
boots the shipped `headless` profile against a disposable DSH home, and runs one task. It replaces
exactly three things, all named in its output: the model provider (a scripted provider, so the run
consumes no real quota and needs no credential), the human (a stand-in that answers the question or
approval request the profile raises), and the SMTP peer's identity (loopback, no TLS, no
authentication, nothing forwarded). The credential service is **not** replaced: the shipped
file-backed store is retargeted at the disposable home, so its real resolution path runs.

```powershell
npm run probe:questions             # ask_user_question, then completion
npm run probe:errors                # one terminal provider failure
npm run probe:approvals             # one in-Turn approval, allowed once
npm run probe:approvals-duplicate   # the same, with the audit record replayed
npm run probe:approvals-rejected    # the same, with the answerer rejecting
npm run probe:credentials           # the credential-reference contract
```

Everything else is the production path: the real agent loop, the real tool registry, the real session
log, `ctx.approval`, the plugin's own listeners, queue, and mailer, and a real SMTP conversation. The
probe prints the subject of every message the server accepted plus an ordered timeline, and writes
the full messages, the child's stdout, and the child's stderr under `tmp/probe/out/`.

| Scenario | Switch set | Measured result |
| --- | --- | --- |
| `questions` | `notifyQuestions: true`, `notifyCompleted: true` | Exactly 2 messages: `[DSH] Input required — Choose Mode` and `[DSH] Task completed — probe-scripted`. Two rather than one is the point: the question's dedupe namespace did not consume the turn's. |
| `errors` | `notifyErrors: true`, `notifyCompleted: true` | Exactly 1 message: `[DSH] Task failed — QUOTA (402)`. The scripted provider declares no failure policy, so the failure is terminal rather than retried, and the failed turn produced no visible output. |
| `approvals` | `notifyApprovals: true`, `notifyCompleted: true` | Exactly 2 messages: `[DSH] Approval required — probe_request_approval` and `[DSH] Task completed — probe-scripted`. The printed timeline places `approval/asked` before the approval mail and the mail before `approval/decided`; the answerer withheld its answer until the probe had seen that mail over SMTP, so "the notification happened while the approval was pending" is measured rather than assumed. |
| `approvals-duplicate` | same | Exactly 2 messages while the same approval id was published twice in the log: the duplicate audit record did not produce a second approval mail, and the approval key did not consume the turn's. |
| `approvals-rejected` | same, answerer returns `rejected` | The approval mail once, `approval/decided` with `rejected`, a tool result marked as an error, and no second "approval required" at the decision. The turn's own later settlement is recorded as observed: here it completed with a tool error and mailed `[DSH] Task completed with tool errors — probe-scripted`. |
| `credentials` | no notification switch | 14 contract checks, 0 FAIL, against the **installed** file-backed provider over a disposable document: reference grammar, the `CredentialRef`/`CredentialKey` split, the `refs` section, an exact-value resolution from the `file` layer, and the absence of the value from all three environment layers. |

Each scenario enables only the switch it is about; the other two interaction switches stay off, so a
message can only have come from the family under test. The same switch set is the one the probe
prints before booting, so what took effect and what was reported cannot diverge.

## Known limitations

- **Deduplication does not survive a restart.** It is a bounded in-memory cache with a deliberately
  narrow guarantee: one email per lifecycle key per process lifetime, where the key is namespaced
  `turn:`, `question:`, or `approval:` so a mid-turn question cannot consume the turn's key.
- **A question mail cannot be answered from the mail.** There is no reply channel, no action link,
  and no approval button. The message says to open DSH, and that is the only way to answer.
- **An approval mail cannot be answered from the mail.** As with a question, there is no reply
  channel and no approval button; the message says to open DSH.
- **The approval scenarios need an `ask` permission policy.** `dsh-base` derives the approval policy
  from `DSH_PERMISSION_MODE`, and the `danger-full-access` preset sets it to `never`, under which no
  `approval/asked` record exists to notify about. The probe pins `approval.policy: ask` in its own
  overlay; on a machine running the `never` preset, a real approval notification cannot be observed
  at all. That is a property of the composition, not of the plugin.
- **Duration is unknown for a mid-turn attach.** If the plugin loads after a turn has started, that
  turn's `durationMs` is `null` (not `0`), so `minTurnDurationMs` cannot suppress it.
- **Four of the six `turn/end` reasons have not been observed on a live turn.** `completed` is
  verified end to end in a real composition, and `error` was exercised by the probe's `errors`
  scenario against a scripted provider. `max-tokens`, `aborted`, `blocked`, and `interrupted` are
  verified against the recorded payload shapes and the frozen classification table, but triggering
  them live depends on model and provider behaviour.
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
| [`PHASE8_REPORT.md`](PHASE8_REPORT.md) | Phase 8 report: the three notification lifecycles (`D018`), the runtime evidence behind each trigger, the two defects found and fixed during the work, the full gate results, and the one evidence path this phase did not close |
| [`PHASE8_1_REPORT.md`](PHASE8_1_REPORT.md) | Phase 8.1 report: the approval end-to-end chain in a real assembly (allowed-once, dedupe, rejected), the credential-reference reconciliation and its evidence (`D019`), the `content-limit` and `parentSession` dispositions, and the full release-candidate gate results |
| [`PHASE8_2_REPORT.md`](PHASE8_2_REPORT.md) | Phase 8.2 report: the commit-sequence record for the Phase 8.2 documentation set |
| [`RELEASE_V0.2.0.md`](RELEASE_V0.2.0.md) | v0.2.0 release report: release source, main fast-forward, tag object, verification results, the six E2E probes, npm and GitHub publication records, the three-way artifact hashes, and the registry fresh-install plus published-package runtime check |
| [`RELEASE_NOTES_V0.2.0.md`](RELEASE_NOTES_V0.2.0.md) | The release notes published on the v0.2.0 GitHub Release |
| [`RELEASE_V0.1.1.md`](RELEASE_V0.1.1.md) | v0.1.1 release report: source commit, tag object, verification results, npm and GitHub publication records, the three-way artifact hashes, and the registry fresh-install result |
| [`RELEASE_NOTES_V0.1.1.md`](RELEASE_NOTES_V0.1.1.md) | The release notes published on the v0.1.1 GitHub Release |
| [`RELEASE_V0.1.0.md`](RELEASE_V0.1.0.md) | v0.1.0 release report: source commit, verification results, npm and GitHub publication records, and the release artifact hashes |
| [`RELEASE_NOTES_V0.1.0.md`](RELEASE_NOTES_V0.1.0.md) | The release notes published on the GitHub Release |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | D001–D019 decision records with reasons, rejected alternatives, and consequences |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module layout and per-module responsibility boundaries |
| [`docs/CONFIG_SPEC.md`](docs/CONFIG_SPEC.md) | Configuration specification: fields, defaults, validation, failure behaviour |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, credential lifecycle, TLS constraint, log redaction, privacy defaults |
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) | Test matrix across six levels |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | P3.1–P3.7 execution plan with per-step verification and failure conditions |
| [`docs/DSH_INTEGRATION.md`](docs/DSH_INTEGRATION.md) | The DSH interfaces this plugin actually uses, and the versions they were verified against |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Build, pack, install, update, and rollback |
| [`scripts/probe/README.md`](scripts/probe/README.md) | What each end-to-end probe scenario asserts, and why the probe's switch set lives in one place |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Functional scope and explicit non-goals |
| [`00_MASTER.md`](00_MASTER.md) | Original project design and the execution roadmap |

## License

MIT, see [`LICENSE`](LICENSE).
