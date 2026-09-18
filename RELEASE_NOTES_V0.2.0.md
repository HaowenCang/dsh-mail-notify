# dsh-mail-notify v0.2.0

DeepSeek Harness host plugin. When a top-level agent turn finishes, it emails that turn's final
user-visible model output over SMTP.

This release adds the cases where a turn stops and a human is needed but no completion mail would
otherwise be sent: **human-attention and terminal-failure notifications**. Three notification paths
are new or changed, and all three are off by default.

The completion path itself is unchanged, apart from the corrections listed under *Retained
behaviour*.

## Terminal failure

`notifyErrors` now sends a failure email when a turn ends in a **terminal error, even when the turn
produced no final visible assistant output**. Previously the absence of visible text suppressed the
message, so a turn that died before emitting anything notified nobody.

The path covers terminal structured failures, including:

```text
QUOTA
RATE_LIMIT
TIMEOUT
TRANSPORT
```

The subject line names the failure class and the HTTP status where one was reported, for example
`[DSH] Task failed — QUOTA (402)`.

Two boundaries matter for reading this correctly. Only a turn that **actually ends in error** sends
this mail; a failure that DSH retries internally and then recovers from does not, because no
terminal turn outcome exists to report. In particular, **recovered internal retries do not send
failure mail**, and this release does not claim that every `429` immediately generates mail. Mail is
driven by the turn's terminal outcome, not by the transient event that preceded it.

Default: `false`. The default does not change in this release. The corrected semantics make an
existing switch report a state it previously dropped; upgrading never causes a user who had
`notifyErrors: false` to begin sending failure mail.

## Questions

New switch `notifyQuestions`, default `false`.

When enabled, an `ask_user_question` call that blocks the agent can send:

```text
[DSH] Input required
```

The mail contains only allowlisted human-facing question fields — the question text and the offered
options, which are the parts a human is being asked to act on. **Generic tool arguments remain
excluded**: the message is built from the question's own fields, not from the raw argument object.

## Approvals

New switch `notifyApprovals`, default `false`.

When enabled, an `approval/asked` event can send:

```text
[DSH] Approval required
```

The mail includes only safe approval audit fields: the tool name, the call id, and the reason the
requesting party gave. **Approved tool arguments are not sent.** The release probes assert this
directly, by scanning the raw SMTP payload, the plugin's stdout and the plugin's stderr for the
approval's argument values and requiring zero hits.

Approvals are deduplicated by approval id, so a duplicate `approval/asked` for the same request
still produces exactly one approval notification.

## Privacy

The three sensitive paths introduced or corrected here are off by default:

```text
notifyQuestions = false
notifyApprovals = false
notifyErrors    = false
```

This is the privacy-safe default posture and it is a release invariant, not an incidental setting.
Opening any of these switches is a deliberate act that sends the corresponding information — the
question text and options, the pending tool name and reason, or the failure detail — through the
configured mail system, which is normally a third-party service. The switches are independent:
enabling one never enables another.

## Retained behaviour

Unchanged in this release:

* **Turn-level token aggregation.** Usage is still folded across every observed model call in the
  turn and reported as one aggregate, with the body stating whether the aggregate is whole.
* **`schemaVersion 2`.** The candidate schema version does **not** change again in this release.
* **Duration semantics.** Still `turn/end.time - turn/start.time`, spanning the whole turn. A turn
  whose start was never observed still reports an unknown duration rather than zero.
* **Nodemailer 10** (`^10.0.9`).

## Compatibility

Compatibility is stated only for what was actually executed, not for what the peer range permits.

```text
DSH 0.1.5-rc.1   new paths E2E validated
```

The terminal-failure, question and approval paths were validated end to end against
**DSH 0.1.5-rc.1** only, using a scripted provider and a loopback SMTP server so that no real
provider quota was consumed.

**DSH 0.1.5-rc.2 was not independently revalidated for v0.2.0.** The `peerDependencies` range is a
SemVer range and is not a compatibility statement; later DSH releases are untested. These new paths
depend on DSH's event contracts for turn outcomes, questions and approvals, so a DSH release that
changes those contracts can change this behaviour.

## Security

```text
npm audit --omit=dev → 0 vulnerabilities
```

The SMTP password is still never stored in this package. It is supplied as a DSH Credential
reference (`smtpPasswordCredential`) and resolved at send time. No credential value appears in the
source, the patch file, the package, or any log record. SMTP TLS certificate verification still
cannot be disabled through configuration.

The DSH credential store is a file (`$DSH_HOME/.credentials.yaml`) readable by any process running
as the same OS user. That is a file-permission boundary, **not** a cryptographic boundary against a
local agent or any other process under that user.

## Upgrade

```powershell
dsh plugin --profile web add dsh-mail-notify@0.2.0
```

Restart DSH afterwards. The shipped `cordis.patch.yml` sets `enabled: false`, so a fresh install is
inert: nothing is registered and no email can be sent until the profile row is configured.

Existing configurations keep working without changes and keep their current privacy posture. The
two new switches default to `false`, so the new human-attention paths stay silent until enabled
explicitly.

## Known limitations

The still-applicable v0.1.1 limitations are retained:

1. Deduplication applies only within one process: it does not survive a restart, so a replayed turn
   can produce a second message.
2. A mid-turn attach has no recorded start time, so the turn duration is reported as unknown.
3. The send queue is not persistent. When it is full the newest notification is refused and is not
   stored for retry.
4. SMTP acceptance is not mailbox delivery. A message the server accepted can still fail to reach
   the recipient's mailbox.
5. DSH versions later than the one listed above are untested.
6. A retried model call whose usage cannot be observed leaves the turn's token telemetry
   incomplete. The plugin reports that explicitly but cannot recover the missing counters.

Additional limitations specific to this release:

7. Question and approval email are **notification-only**. Email replies cannot answer DSH, and there
   are **no action links and no remote approval callbacks**. A human who receives these messages
   must still act inside DSH.
8. Human-attention notification support depends on the verified DSH event contracts. On a DSH
   release that changes those contracts, these paths can stop firing or change shape.
9. Generic tool arguments remain excluded from every notification path by design, so a message
   explains that attention is required without reproducing the tool's input.

This release does not claim exactly-once delivery, guaranteed mailbox delivery, complete token usage
for every turn, support for untested DSH versions, or zero future vulnerabilities.
