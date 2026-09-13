# dsh-mail-notify v0.1.1

DeepSeek Harness host plugin. When a top-level agent turn finishes, it emails that turn's final
user-visible model output over SMTP.

This release fixes the token accounting in that email. No other behaviour changed.

## Fix: token usage is now a turn aggregate

In v0.1.0 the notification body reported token usage for a single model call. When a turn made
several model calls, the numbers shown were those of the last call, and the body did not say so.
The figures looked like a turn total while being a single sample.

v0.1.1 accumulates every observed model call in the turn and reports a **turn-level aggregate**:
input, output, cache-read, cache-write and reasoning counters are folded across all calls that
reported usage, and the body states the number of calls the aggregate covers.

The body now states explicitly whether that aggregate is whole, on a line labelled
`Token telemetry complete:`. Two distinct claims are rendered separately:

* `usageComplete` — every accountable model call reported a usable usage record.
* `telemetryComplete` — the plugin observed the turn from its `turn/start`.

A call that reported no usage makes the aggregate **incomplete**, and the body names the gap
(`n model calls without a usable usage report`). A retried model call whose usage could not be
observed is counted the same way (`n retried model calls whose usage was not reported`). When a
turn is incomplete, the body says so rather than presenting a partial sum as a total. A turn with
no observed usage at all is stated as such instead of omitting the line.

Reasoning tokens remain a subset of output tokens and are never added to them. A sum that left the
safe-integer range withholds the aggregate rather than reporting a wrapped value.

## Duration

The duration algorithm was investigated during this cycle and was **already correct**; no duration
defect was found and none was fixed. Its definition is unchanged:

```text
turn/end.time - turn/start.time
```

The interval spans the whole turn, not the last message. A turn whose start was never observed
still reports an unknown duration, which is stated as unknown rather than as zero.

## Schema

`NotificationCandidate.schemaVersion` changes from `1` to `2`. The reason is that the `usage` field
changed meaning: it previously carried one model call's counters, and now carries a turn-level
aggregate. Consumers that read `schemaVersion` will see the change rather than misreading the new
semantics as the old ones.

## Security

Nodemailer is upgraded from 7 to 10 (`^10.0.9`). The v0.1.0 release carried an audit advisory
against Nodemailer 7.0.13; this release removes it.

```text
npm audit --omit=dev → 0 vulnerabilities
```

`@types/nodemailer` is not a dependency of this package, in any dependency class.

The SMTP password is still never stored in this package. It is supplied as a DSH Credential
reference (`smtpPasswordCredential`) and resolved at send time. No credential value appears in the
source, the patch file, the package, or any log record. Unchanged from v0.1.0: SMTP TLS certificate
verification cannot be disabled through configuration.

The DSH credential store is a file (`$DSH_HOME/.credentials.yaml`) readable by any process running
as the same OS user. That is a file-permission boundary, **not** a cryptographic boundary against a
local agent or any other process under that user.

## Verified environment

```text
DSH 0.1.5-rc.1
DSH 0.1.5-rc.2
Node ^22.19.0 || >=24.0.0
```

Both DSH versions were tested rather than inferred from the peer range. **Later DSH releases are
untested.** The peer range in `package.json` is a SemVer range, not a compatibility statement.

## Upgrade

```powershell
dsh plugin --profile web add dsh-mail-notify@0.1.1
```

Restart DSH afterwards. The shipped `cordis.patch.yml` sets `enabled: false`, so a fresh install is
inert: nothing is registered and no email can be sent until the profile row is configured.

Configurations do not need to change for this upgrade. Because `usage` changed meaning, anything
outside this plugin that consumes the notification candidate should treat `schemaVersion: 2` as a
different shape from `schemaVersion: 1`.

## Known limitations

1. Deduplication applies only within one process: it does not survive a restart, so a replayed turn
   can produce a second message.
2. A mid-turn attach has no recorded start time, so the turn duration is reported as unknown.
3. The send queue is not persistent. When it is full the newest notification is refused and is not
   stored for retry.
4. SMTP acceptance is not mailbox delivery. A message the server accepted can still fail to reach
   the recipient's mailbox.
5. Later DSH versions than those listed above are untested.
6. A retried model call whose usage cannot be observed leaves the turn's token telemetry
   incomplete. v0.1.1 reports that explicitly, but it cannot recover the missing counters.

This release does not claim support for all DSH versions, exactly-once delivery, guaranteed mailbox
delivery, complete token usage for every turn, or zero future vulnerabilities.
