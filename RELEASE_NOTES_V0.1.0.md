# dsh-mail-notify v0.1.0

DeepSeek Harness host plugin. When a top-level agent turn finishes, it emails that turn's final
user-visible model output over SMTP.

## Highlights

* Send the final user-visible output of completed top-level DSH turns by SMTP.
* Host-only DSH bundle: no browser half, no UI, no Client package.
* Bounded asynchronous queue: a full queue refuses the newest notification instead of growing.
* In-process deduplication: at most one message per `(sessionId, turn)` per process lifetime.
* Credential values resolved through the DSH Credential Service, once per send attempt and never cached.
* Reasoning, tool arguments, tool results and system prompts are excluded.
* SMTP TLS certificate verification cannot be disabled through configuration.

## Verified environments

```text
DSH 0.1.5-rc.1
DSH 0.1.5-rc.2
Node ^22.19.0 || >=24.0.0
```

Both DSH versions were tested rather than inferred from the peer range. **Later DSH releases are
untested.** The `^0.1.5-rc.1` range in `package.json` is a SemVer range, not a compatibility
statement.

## Install

```powershell
dsh plugin --profile web add dsh-mail-notify@0.1.0
```

Restart DSH afterwards. The shipped `cordis.patch.yml` sets `enabled: false`, so a fresh install is
inert: nothing is registered and no email can be sent until the row is configured.

## Security

The SMTP password is never stored in this package. It is supplied as a DSH Credential reference
(`smtpPasswordCredential`) and resolved at send time. No credential value appears in the source, the
patch file, the package, or any log record.

The DSH credential store is a file (`$DSH_HOME/.credentials.yaml`) readable by any process running
as the same OS user. That is a file-permission boundary, **not** a cryptographic boundary against a
local agent or any other process under that user.

## Known limitations

1. Deduplication does not survive a process restart: a replayed turn can produce a second message.
2. A mid-turn attach has no recorded start time, so the turn duration is reported as unknown.
3. Some non-`completed` `turn/end` reasons are recognised but not yet live-triggered.
4. When the queue is full the newest notification is refused and is not persisted for retry.
5. A headless profile that exits immediately after a turn completes may end before the asynchronous
   queue sends.
6. Nodemailer 7.0.13 currently carries an audit advisory. Reachability of the affected path for this
   plugin's actual usage was analysed during release-candidate validation; upgrading to 10.x is left
   to a separate version.

This release does not claim support for all DSH versions, zero vulnerabilities, exactly-once
delivery, or guaranteed mailbox delivery.
