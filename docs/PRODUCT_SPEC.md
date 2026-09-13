# PRODUCT_SPEC — dsh-mail-notify

## 1. Purpose

Notify a person, by email, that a DeepSeek Harness agent turn has finished — and include what the
agent said.

The plugin exists because a long agent turn is exactly the situation in which a person stops
watching. The value it delivers is the turn's **final user-visible output**, delivered to a channel
that reaches a phone. It is not a progress stream, not a monitoring system, and not a log shipper.

## 2. Functional scope

### 2.1 What triggers a notification

A top-level session's `turn/end` event, subject to four independent conditions:

1. **Scope.** The session is top-level. A subagent's turn notifies only under
   `includeSubagents: true`.
2. **Status.** The turn's status has an enabled switch. `completed-clean` and
   `completed-with-tool-errors` are governed by `notifyCompleted`; `error` by `notifyErrors`;
   `max-tokens` by `notifyMaxTokens`. `aborted`, `blocked`, `interrupted`, and any unrecognised
   reason have no switch and never notify.
3. **Content.** The turn produced non-whitespace visible text. A turn that produced only reasoning,
   only tool calls, or nothing at all is skipped. This condition has no configuration switch.
4. **Thresholds.** The turn's duration, when known, is not below `minTurnDurationMs`; and the
   `(sessionId, turn)` pair has not already produced a queued notification.

The first condition that fails decides the recorded `suppressedReason`, and that order is fixed
because it determines what an operator sees for a turn that fails several at once.

### 2.2 What the email contains

| Content | Default | Controllable |
| --- | --- | --- |
| The turn's final user-visible text (`type === 'text'` blocks only) | Included | No — it is the point |
| Completion status, rendered as a phrase and as the machine value | Included | No |
| Session id, turn number, duration | Included | Via `includeMetadata` |
| Workspace path (`cwd`), provider, model | Included | Via `includeMetadata` |
| Explicit tool error count, telemetry-completeness flag | Included | Via `includeMetadata` |
| Raw token counters, exactly as reported | Included when present | Via `includeMetadata` |
| Turn-end detail (abort cause, provider error code and message) | Included when present | Via `includeMetadata` |
| The turn's last user message | **Excluded** | `includeUserPrompt` |
| Generator footer and truncation marker | Included | `includeFooter` |

Subject lines are generated from the status and the model name, never contain CR or LF, and are
capped at 200 characters with the status prefix preserved.

### 2.3 Delivery behaviour

| Property | Value |
| --- | --- |
| Transport | SMTP through Nodemailer; STARTTLS or implicit TLS according to `smtpSecure` |
| Certificate verification | Always on; there is no setting to disable it |
| Credential | A reference name resolved through the DSH Credential service inside every send attempt |
| Queue | Bounded FIFO, single-concurrency worker, `reject newest` at capacity with a counted warning |
| Retry | Transient failures only, exponential backoff, `retryAttempts + 1` attempts total |
| Deduplication | One notification per `(sessionId, turn)` per process lifetime |
| Ordering | Emails are enqueued in turn order and sent one at a time, so they arrive in order |

## 3. Explicit non-goals

These are absent by decision, not by omission. Each is recorded with its reasoning in
[`DECISIONS.md`](DECISIONS.md).

| Not implemented | Reason |
| --- | --- |
| Attachments of any kind, including an over-long body moved to an attachment | Attachments escape the body's content review and add MIME complexity |
| HTML templates or a theme engine | Plain text carries the same information with no rendering surface |
| A reply channel back into the harness | Notifications are one-way by design |
| Multi-recipient routing by turn type | No user requirement; would multiply the privacy surface |
| Progress or per-step notifications | The core semantic is the final output, not activity |
| Notifications for `aborted`, `blocked`, `interrupted` | These produce no output the user was meant to read |
| An "email me even with an empty body" switch | Produces a stream of content-free mail that trains the recipient to ignore the channel |
| Detection of failed shell commands from their output text | `explicitToolErrorCount` deliberately excludes it; a shell non-zero exit is a successful tool result in DSH |
| Cost accounting or quota alerts from `usage` | The counters' semantics are unconfirmed; deriving from them would present a guess as a fact |
| Cross-process deduplication | Requires persistence, corruption recovery, and a product answer to "should a replayed turn re-notify" |
| A browser or Client-side surface | Host-only plugin; there is no UI to build |
| Any modification to the DeepSeek Harness source | Delivery requirement |

## 4. Deliberate semantic boundaries

Three statements the product makes, and what they do and do not claim:

**"Task completed"** means the harness reported the turn as `completed` and reported no explicitly
failed tool call. It does **not** mean the commands the agent ran succeeded. A `pwsh` invocation
that exits non-zero is, in DSH, a successful tool call whose output happens to say so. The plugin
will not claim more than the harness reported, and no configuration makes it claim more.

**"Duration unknown"** means the plugin attached after the turn had already started, so the turn's
start time was never observed. The body says so, the candidate records `durationMs: null`, and the
duration threshold is not applied — an unknown duration is not a short duration.

**"Token counters (as reported)"** is a verbatim quotation. The counters are not summed, converted,
reconciled, or priced, because the recorded observation includes a pair — `inputTokens: 255` beside
`totalTokens: 187638` — whose relationship the project has not established.

## 5. Operational expectations

- **Volume.** One email per qualifying top-level turn. A typical interactive session produces one
  email per completed request plus one per token-limit truncation.
- **Latency.** Delivery is asynchronous and off the agent's path; the listener returns in constant
  time regardless of SMTP behaviour. An email typically arrives within seconds of the turn ending.
- **Failure visibility.** Every suppression, refusal, retry, and failure is a structured log line.
  Nothing is dropped silently: a full queue increments a counter, and a suppressed turn records its
  reason.
- **Failure isolation.** No send failure can reach the agent loop. A send path that throws is
  classified, logged, counted, and absorbed.
- **Footprint.** No files, no database, no persistent state. Memory is bounded: the turn map is
  released as turns settle, and the dedupe cache has a hard capacity.

## 6. Intended user

Someone already running DSH who wants to walk away from a long agent turn and be told, on their
phone, what it concluded — and who accepts that the conclusion leaves the machine. The security
implications of that acceptance are set out in [`SECURITY.md`](SECURITY.md) §8, because they are a
precondition of using the plugin rather than a caveat attached to it.
