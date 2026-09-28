# dsh-mail-notify

DeepSeek Harness (DSH) host plugin. It emails a **top-level** Agent turn's final user-visible model
output, that turn's terminal failures, and the mid-turn requests at which the agent blocked waiting
for a person — over SMTP.

- Plugin name / patch row id: `dsh-mail-notify`
- Version: `0.4.0`
- Host plugin plus a browser half: a configuration card on the DSH Plugins page
- Requires DSH `0.1.7-rc.2`, and Node `^22.19.0 || >=24.0.0`
- Requires Nodemailer `10.x` (the only runtime dependency; resolved automatically on install)

**Verified DSH version.** Exactly one release has been exercised against this plugin, and it is the
only one this document claims.

| DSH version | Status | Evidence |
| --- | --- | --- |
| `0.1.7-rc.2` | Verified | Full suite; both compatibility compile probes; six real-assembly end-to-end probes (questions, errors, approvals, approval dedupe, approval rejection, credential contract) plus the two-Turn user-prompt attribution probe; the live-policy probe; isolated `npm pack` install into a disposable web profile with browser verification of the configuration card, Save/Reset, credential badge, Test Email, live activation without restart, and Host rejection of invalid writes |

`0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6`, a hypothetical `0.1.7` final, and every later release are
**untested with `0.4.0`**. They are not merely unclaimed: the configuration surface this version is
built on (`ctx.configForms`, `plugins.bundle.config`, volatile Config) does not exist in the
`0.1.5` generation, and the `0.1.5` surface it replaced (`ctx.settings.installSection`,
`settings.plugin.item`, `ctx.settingsScope`) does not exist in `0.1.7`. The break is bidirectional, so
there is no shared-support range to advertise and no dual-generation shim in the source.

The `peerDependencies` ranges are pinned to the validated release for that reason: a range wide
enough to admit an untested prerelease would be a compatibility claim this repository cannot
evidence. See [`V0.4.0_COMPAT_REPORT.md`](V0.4.0_COMPAT_REPORT.md).

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
the metadata block. `aborted`, `blocked`, `interrupted`, `forked`, and any unrecognised reason have no
switch and never notify.

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
Workspace: C:\Users\you\projects\my-app
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
Workspace: C:\Users\you\projects\my-app
Observed:  2026-09-18T15:33:11.596Z
```

After that block comes either `--- Question ---` or `--- Approval ---`, and the mail ends by saying
to open DSH to answer because the message cannot be answered by reply.

---

## Install

The plugin ships as a DSH bundle: `package.json` declares `dsh.bundle.patch`, so installing the
package also mounts it.

```powershell
dsh plugin --profile web add dsh-mail-notify@0.4.0
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

## Configure in the Web UI

`Settings → Plugins → dsh-mail-notify` shows a **dsh-mail-notify** card, titled **Mail
notifications** (邮件通知). Every value in the patch example below can be set there instead; the card
needs no YAML editing and takes effect without restarting DSH. Your edits are persisted into the
profile's own `cordis.patch.yml`, which is the only configuration document a plugin has.

The form carries exactly the Host Config's **23 fields** as 23 controls, plus **one separate
write-only password control**. The password is not a 24th Config field: it is a Credential value
written through the `credentials` domain, and the card's editable field table deliberately excludes
it, so nothing in the form ever reads it back or resets it as configuration. The field list is not
maintained by hand on either side — the card's table and the Host schema are compared field for field
by `tests/client/config-surface.test.ts`, which fails if the schema gains a field the form omits, if
the form invents a Config field the Host does not declare, or if either side lists a name twice.

Only the fields you actually change are written: a Save records the fields you edited, and the rest
keep inheriting the composition layer. An invalid value is refused by the **host** before anything is
written — the clause that refuses it is the plugin's own Config schema, resolved by DSH's config
editor ahead of persistence — so a rejected save leaves both your profile file and the running
notification runtime exactly as they were.

The card is one collapsible disclosure, collapsed by default so a single plugin cannot push the rest
of Settings off the screen. Collapsed, it occupies one compact row: its title, and one line of safe
operational facts — runtime state, SMTP readiness, and the question switch's effective state.
Expanding reveals the full form; collapsing again discards nothing — staged edits, a password draft,
an in-flight save, and operation results all stay until you save or discard them. The expansion is
presentation state only and is never persisted.

The card follows the DSH interface language (Settings → General → Language) and is fully translated
into English and Simplified Chinese; a language the plugin ships no copy for falls back to English.
A language switch retranslates the mounted card immediately, notices already on screen included.

The card is registered into the Plugins page's `plugins.bundle.config` slot under the key
`dsh-mail-notify` — the plugin's **package name**, which is what the page resolves a bundle's
configuration by. It is *not* registered into `plugins.item`: that slot is the page's Official group
of standalone cards, and a bundle's configuration is rendered on the bundle's own page, which is also
where the enable switch and the component list live. The host side of the same configuration is the
plugin's Cordis `Config` schema, addressed by the profile entry id `dsh-mail-notify`.

How the layers compose:

```
Config schema defaults  →  bundle layer (this package's cordis.patch.yml)
                        →  profile layer (your cordis.patch.yml)
                        →  what runs
```

Every field in the form is a **volatile** Config field. A committed change is applied to the running
plugin in place: the Loader copies the new values into the references the plugin reads, the plugin
re-reads the whole configuration as one snapshot, and the notification runtime is rebuilt from it.
That is why a Save takes effect without restarting DSH, and why a change to the master switch stands
the runtime down or brings it up immediately.

The card shows the **effective** value of every field — what a notification would actually use — and
marks each one `inherited` (no entry in your layer) or with a `Reset` button (an entry exists).
**Reset removes the entry**; it does not write the default back, so the field re-inherits the
composition layer and any later change to the patch is picked up again. `Reset` at the bottom stages
that removal for every field the plugin owns, and `Save` applies it.

An override is detected by the **presence** of a key in your layer, never by comparing values: an
override that happens to equal the composition default is still an override, and a value comparison
could not see it.

| Card region | Fields |
| --- | --- |
| Human attention | `notifyQuestions`, `notifyApprovals` — rendered apart because they are the switches that decide whether you learn an agent is blocked |
| General | `enabled`, `includeSubagents` |
| Notifications | `notifyCompleted`, `notifyErrors`, `notifyMaxTokens`, `minTurnDurationMs` |
| SMTP | `smtpHost`, `smtpPort`, `smtpSecure`, `smtpUser`, `from`, `to` |
| Credential | `smtpPasswordCredential` (a reference **name**), and the write-only password control |
| Message content | `includeMetadata`, `includeUserPrompt`, `includeFooter`, `maxBodyChars` |
| Delivery | `queueSize`, `retryAttempts`, `retryBaseDelayMs`, `maxDedupeEntries` |
| Status | live host facts: whether the runtime is mounted, whether the credential reference is configured, the queue depth and counters, and — prominently — the **effective** `notifyQuestions` and `notifyApprovals` values |

The field rows above are the complete set: 23 Config fields, each rendered as exactly one control. The
two switches that decide whether you learn an agent is blocked — `notifyQuestions` and
`notifyApprovals` — form the Human attention group and appear nowhere else; the Notifications group
carries the four turn-level policy fields, `notifyCompleted`, `notifyErrors`, `notifyMaxTokens`, and
`minTurnDurationMs`. The password control is the one extra control on the card and belongs to no Config
field: it is a write-only Credential control, not a 24th Config field. `minTurnDurationMs` sits in the
Notifications group rather than in the human-attention block, because it applies only to settled Turn
notifications.

The status facts are re-read every five seconds while the card is on screen. If a saved
configuration cannot be applied, the card says so instead of silently doing nothing; the previously
running configuration stays in effect.

**Send test email** delivers one fixed message through the *same* credential lookup, transport
construction, and failure classification a real notification uses, so a success there is evidence
about the notification path rather than merely about connectivity. The message body restates no
configuration and contains no credential.

### The password

The browser never reads the SMTP password. The only credential operations the card performs are
`describe` (is a value stored, and is it writable), `set`, and `unset`; the installed DSH
credentials namespace has no read path at all. The password field starts blank every time the card
renders, a stored password is reported only as *configured*, typing a replacement is write-only,
and a successful save clears the local draft. A custom `smtpPasswordCredential` reference is
preserved as you typed it.

## Configure by patch file

Add a row to the profile's own patch file (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`). A patch
**replaces** the targeted row's whole `config`, so restate every key you rely on; omitted keys fall
back to the schema defaults.

This remains fully supported, and the two routes are the *same* document: the Web card writes this
file, so a hand edit and a Save are indistinguishable afterwards, and a hand edit is what a Save will
show as that field's override. Every key in the example below is one of the 23 the card exposes, so
the whole document is configurable from the Web UI.

```yaml
- id: dsh-mail-notify
  name: dsh-mail-notify
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

| Field | Schema default | Notes |
| --- | --- | --- |
| `enabled` | `true` | a fresh install runs with `false`; see the note below the table. While false the plugin registers **nothing**: no listener, no queue, no credential read. |
| `smtpHost` | `''` | Semantically required while `enabled: true`: non-empty, no whitespace. `''` is the "not configured yet" placeholder, not a host name. |
| `smtpPort` | `587` | Integer 1–65535. |
| `smtpSecure` | `false` | `true` = implicit TLS (normally 465); `false` allows a STARTTLS upgrade (normally 587). |
| `smtpUser` | `''` | Semantically required while `enabled: true`: a non-empty user name. `''` means not configured yet. |
| `smtpPasswordCredential` | `DSH_MAIL_SMTP_PASSWORD` | A credential **reference name**, never a password. Exactly the DSH `CredentialRef` grammar, `^[A-Za-z_][A-Za-z0-9_]*$` — an environment-style name. The default is a name because the field-level `pattern()` cannot admit `''`; a `<scope>/<id>` value is a `CredentialKey`, which `resolve()` cannot read, so it is refused at mount with an explanation (D019). The **password** it names is not a configuration value: it lives in the credential store and is written through the card's separate write-only control. |
| `from` | `''` | Semantically required while `enabled: true`: a non-empty, plausible address. `''` means not configured yet. |
| `to` | `[]` | Semantically required while `enabled: true`: after the address rule and deduplication, at least one recipient. An empty or entirely invalid list refuses to mount. |
| `includeSubagents` | `false` | Turning this on sends subagent output, subagent questions, and subagent approvals too; read the security section first. |
| `notifyCompleted` | `true` | Covers `completed-clean` and `completed-with-tool-errors`. |
| `notifyErrors` | `false` | Covers `status === 'error'`. A terminal failure is mailed **even when the turn produced no visible assistant output**; a completed turn with empty text is still suppressed. |
| `notifyMaxTokens` | `true` | Covers `status === 'max-tokens'`. |
| `notifyQuestions` | `false` | Covers an agent blocked on `ask_user_question`. Off by default; enabling it sends the question's text and options to the mail system. |
| `notifyApprovals` | `false` | Covers an agent blocked on an approval decision. Off by default; enabling it sends the tool name and the asker's reason to the mail system. The approved tool's arguments are never sent. |
| `minTurnDurationMs` | `0` | Suppresses settled Turn notifications whose known duration is **strictly below** this many milliseconds. `0` disables duration filtering, and an **unknown** duration is never suppressed. Question and approval notifications ignore it. |
| `maxBodyChars` | `100000` | Visible-text cap in code points, 1000–1000000. |
| `includeMetadata` | `true` | Session id, workspace, model, timing, status block. |
| `includeUserPrompt` | `false` | Adds the most recent direct-human `user/message` in the Turn — the one whose `source.kind === 'user'`. Injected runtime context, skills, goals, agent instructions, agent-to-agent messages, and every other non-user source are excluded, whatever their text and whenever they arrive. Off by default. |
| `includeFooter` | `true` | Generator footer **and** the truncation marker. |
| `queueSize` | `100` | Waiting jobs; the worker holds one more. Full queue refuses the newest. |
| `retryAttempts` | `3` | Retries; total attempts are `1 + this`. `0` means try once. |
| `retryBaseDelayMs` | `1000` | Retry *n* waits `base × 3^(n−1)`, capped at 30 s. |
| `maxDedupeEntries` | `1000` | Dedupe cache capacity. |

The **Schema default** column is what the Config schema resolves when a key is absent — it is not the
same thing as the effective value of a fresh install. `enabled` is the one field where the two
differ, and the three values are deliberately distinct:

```text
schema default           enabled = true     what an absent key resolves to
bundle composition       enabled = false    this package's own cordis.patch.yml row
fresh install effective  enabled = false    the schema default is shadowed by the layer above it
```

The bundle layer ships `enabled: false` so that installing a notification plugin does not start
emailing before the operator has said where to send. Resetting the field in the Web UI removes the
profile-layer override and therefore reveals the **bundle** value, `false` — not the schema default
`true`. To turn the plugin on, set the field explicitly. This design is unchanged; the distinction
between a schema default (`''`, `[]`, `true`) and an effective fresh-install value (`false`) is what
the column above is now careful to keep.

Four fields have an empty-schema-default that is nonetheless semantically required while
`enabled: true`: `smtpHost` (`''`), `smtpUser` (`''`), `from` (`''`), and `to` (`[]`). They are not
"required" at the schema level — an incomplete document stays renderable and saveable, which is what
lets you configure the plugin field by field, or park it with `enabled: false` — but the product
rules refuse to mount a working mail path until each is filled in. `docs/CONFIG_SPEC.md` §2.2–§2.3
is the normative statement of the same rule.

`aborted`, `blocked`, `interrupted`, `forked`, and any unrecognised `turn/end` reason have **no**
enabling switch and never notify. There is also no option to send a *completion* mail with an empty
body: a completed or max-tokens turn with no visible text is skipped regardless of the notification
switches. A **terminal failure** is the one exception — it is mailed even with no visible output,
because the failure itself is the message.

The example above is a **profile** patch, so it also sets `enabled: true` and the resolved value is
`true` — that is the other half of why a patch restates every key it relies on.

`minTurnDurationMs` applies only to the settled-turn notification, and only when the turn's duration
is known. It is never applied to a question or an approval: an agent that asks something two seconds
into a turn is exactly the case the mail exists for, and a turn-length floor would suppress it.

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
npm pack              # dsh-mail-notify-0.4.0.tgz
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
| A Save is refused and says the configuration is invalid | The message names the offending field, e.g. `$.smtpPort expected number <= 65535`. Nothing was written and the running configuration is untouched. Fix the value and Save again. |
| The configuration card is missing from the plugin's page | The Host is not serving this entry's configuration. Check that the row is mounted at all (`dsh --profile <p> --dump-config`) and that DSH is `0.1.7-rc.2`; the card is contributed only while the entry is composed. |
| A `settings.yaml` from an older release | DSH `0.1.7` imports its sections into the profile automatically at boot and renames the file to `settings.yaml.imported`. The original is never deleted, and no migration step is needed. See below. |

### Upgrading from a `0.3.x` install

`0.3.x` stored Web overrides in `$DSH_HOME/settings.yaml` under a `dsh-mail-notify` section. DSH
`0.1.7` migrates that file itself: at boot, once the Loader has settled, it renames
`settings.yaml` to `settings.yaml.imported` and writes each section's values into the profile entry
it names — so a `dsh-mail-notify` section becomes that row's `config` in the profile's
`cordis.patch.yml`. A section the running composition rejects is logged and left only in the renamed
file.

The plugin does nothing for this and duplicates nothing. Verify it if you want to: the renamed file
is the evidence, the profile patch is the result, and deleting `settings.yaml.imported` afterwards is
safe once you have read it. The file that is **not** removed is the original, and it is not removed
because a partial import must remain recoverable. See
[`V0.4.0_COMPAT_REPORT.md`](V0.4.0_COMPAT_REPORT.md) for the disposable-home test that established
this.

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
- **Five of the seven `turn/end` reasons have not been observed on a live turn.** `completed` is
  verified end to end in a real composition, and `error` was exercised by the probe's `errors`
  scenario against a scripted provider. `max-tokens`, `aborted`, `blocked`, and `interrupted` are
  verified against the recorded payload shapes and the frozen classification table, but triggering
  them live depends on model and provider behaviour. `forked` is verified the same way and is
  unreachable from a live run by upstream design: only fork-seed construction writes it, never the
  agent loop.
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
| [`RELEASE_NOTES_V0.3.1.md`](RELEASE_NOTES_V0.3.1.md) | v0.3.1 release notes: the collapsible settings card and the English/Simplified Chinese localization |
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
