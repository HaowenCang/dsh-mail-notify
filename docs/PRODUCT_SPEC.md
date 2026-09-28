# PRODUCT_SPEC — dsh-mail-notify

## 1. Purpose

Notify a person, by email, that a DeepSeek Harness agent turn has finished — and include what the
agent said.

The plugin exists because a long agent turn is exactly the situation in which a person stops
watching. The value it delivers is the turn's **final user-visible output**, delivered to a channel
that reaches a phone. It is not a progress stream, not a monitoring system, and not a log shipper.
Two further lifecycles cover the obverse case: an agent that is still inside a turn and cannot
proceed without a person.

## 2. Functional scope

### 2.1 The three notification lifecycles

Version `0.4.0` notifies three distinct lifecycles. Each has its own trigger, its own content rule,
and its own deduplication identity, and a mail always states in its subject and body which one it is.

#### 2.1.1 The settled Turn notification

Produced at `turn/end` for a top-level session, subject to four independent conditions:

1. **Scope.** The session is top-level. A subagent's turn notifies only under
   `includeSubagents: true`.
2. **Status.** The turn's status has an enabled switch. `completed-clean` and
   `completed-with-tool-errors` are governed by `notifyCompleted`; `error` by `notifyErrors`;
   `max-tokens` by `notifyMaxTokens`. `aborted`, `blocked`, `interrupted`, `forked`, and any
   unrecognised reason have no switch and never notify.
3. **Content.** See §2.2.
4. **Thresholds.** The turn's duration, when known, is not below `minTurnDurationMs`, and the turn's
   own deduplication key is unmarked.

The first condition that fails decides the recorded `suppressedReason`, and that order is fixed
because it determines what an operator sees for a turn that fails several at once.

#### 2.1.2 The question notification

Produced by observing the `tool/call` event whose tool name is exactly `ask_user_question`, while
the agent is blocked waiting for a human answer. It is governed by `notifyQuestions`, which defaults
to `false`.

This lifecycle does not depend on the turn's final assistant text and does not wait for `turn/end`.
The notification is enqueued synchronously on the event, at the moment DSH is still blocked on the
human, which is precisely when the mail is useful. The plugin registers no `user-questions/request`
handler: that is an answer-ownership chain, and a notification plugin must not join one.

#### 2.1.3 The approval notification

Produced by observing the `approval/asked` audit event, while the agent is blocked waiting for an
approval decision. It is governed by `notifyApprovals`, which defaults to `false`.

As with a question, this lifecycle does not depend on final assistant text or on `turn/end`. Nothing
is mailed from `approval/request`, and nothing is mailed at `approval/decided` — by the time that
event exists the human has already acted, and a second "you are needed" message would be false.

Both human-attention lifecycles may fire more than once inside a single Turn. A turn that asks two
distinct questions can produce two question notifications before it settles.

### 2.2 The terminal Turn content rule

The visible-text requirement is not global. It is conditional on the terminal status:

```text
completed / max-tokens:
    visible assistant text required

terminal error:
    visible assistant text NOT required
```

A completed or max-tokens turn whose visible text is empty or whitespace-only is skipped under
`no-visible-text`, because a mail whose body would carry nothing but metadata tells the reader less
than its own subject already did. A terminal error is exempt from that rule, because the failure is
itself the message and a provider failure is exactly the case in which the model produced no visible
output at all; requiring text there would silence the failures most worth knowing about. A failure
notification may therefore be produced solely from the structured failure facts.

Neither human-attention lifecycle has a visible-text rule. Their content is the question or the
approval ask, not the model's final answer, and neither passes through the settled-Turn decision
path at all.

### 2.3 What the email contains

| Content | Default | Controllable |
| --- | --- | --- |
| The turn's final user-visible text (`type === 'text'` blocks only) | Included | No — it is the point |
| Completion status, rendered as a phrase and as the machine value | Included | No |
| Session id, turn number, duration | Included | Via `includeMetadata` |
| Workspace path (`cwd`), provider, model | Included | Via `includeMetadata` |
| Explicit tool error count, telemetry-completeness flag | Included | Via `includeMetadata` |
| The Turn's aggregated token usage, per bucket, with a completeness flag | Included when present | Via `includeMetadata` |
| Turn-end detail (abort cause, provider error code and message) | Included when present | Via `includeMetadata` |
| The most recent direct-human `user/message` in the Turn (`source.kind === 'user'`) | **Excluded** | `includeUserPrompt` |
| A question's text, id, header, option labels and descriptions, and whether it accepts several choices | **Excluded** | `notifyQuestions` |
| The name of the tool awaiting a decision, and the asker's reason | **Excluded** | `notifyApprovals` |
| Generator footer and truncation marker | Included | `includeFooter` |

A failure body gains a `--- Failure ---` section that writes `not reported` for each fact the runtime
did not supply, and output produced before the failure keeps its own heading so that partial text is
never read as the final answer. A human-attention body carries a shorter metadata block — a mid-turn
request has no duration and no token aggregate to report — followed by either `--- Question ---` or
`--- Approval ---`, and ends by stating that the message must be answered in DSH rather than by
reply.

The approval body carries the tool name and the asker's reason and nothing else about the call. The
approval id, the call id, and the approved tool's arguments are not included; DSH's approval contract
does not publish the arguments, and the renderer has no field that could hold them (D018, D019).
Neither the SMTP credential value nor any reasoning text is ever part of a body, under any
configuration.

Subject lines are generated from the status and the model name, never contain CR or LF, and are
capped at 200 characters with the status prefix preserved.

### 2.4 Delivery behaviour

| Property | Value |
| --- | --- |
| Transport | SMTP through Nodemailer; STARTTLS or implicit TLS according to `smtpSecure` |
| Certificate verification | Always on; there is no setting to disable it |
| Credential | A reference name resolved through the DSH Credential service inside every send attempt |
| Queue | Bounded FIFO, single-concurrency worker, `reject newest` at capacity with a counted warning |
| Retry | Transient failures only, exponential backoff, `retryAttempts + 1` attempts total |
| Deduplication | One notification per lifecycle identity per process lifetime, under three namespaced keys (§2.5) |
| Ordering | Emails are enqueued in turn order and sent one at a time, so they arrive in order |

### 2.5 Deduplication identity

The dedupe cache carries three independent namespaces, and the namespaces are what keep the
lifecycles apart. A question that fires mid-turn must not consume the key of the turn it fired
inside, or the turn's own settlement would be swallowed as a duplicate after the human answers.

```text
turn:${sessionId}:${turn}
question:${sessionId}:${callId}          — falls back to question:${sessionId}:t${turn}:s${step}
                                           when the observed call carried no id
approval:${sessionId}:${approvalRequestId}
```

The DSH-issued call id is the question lifecycle's primary identity, so two questions inside one turn
produce two keys and two mails, while a re-observed append of the same call produces one. A key is
marked only after its job has been accepted by the queue, so a refused enqueue leaves no mark and
stays eligible for a later attempt.

The guarantee is **process-local**. Nothing is persisted: a restarted DSH may notify a replayed turn
or a replayed call a second time.

### 2.6 Token telemetry

The candidate's `schemaVersion` is `2`, and its usage block is a Turn aggregate rather than a single
sample. The contract is:

- usage is aggregated across **every observed accountable model call in the Turn** — an
  `assistant/message` that carries a usage report, and an `assistant/attempt` that settles a call
  which produced no surface message;
- the `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and `reasoningTokens`
  buckets are summed independently, each over the samples that reported it;
- `reasoningTokens` is never added to `outputTokens`; the buckets are disjoint and stay separate;
- `totalTokens` is not emitted, and no total is derived from the other buckets;
- a call whose usage is absent, unreadable, or missing the required `inputTokens`/`outputTokens`
  pair makes the Turn's usage incomplete — the missing amount is counted, the flag reports the
  incompleteness, and the numbers on the mail cover only the calls that did report;
- a bucket no sample reported stays `not reported` rather than becoming a known `0`;
- the plugin never invents a missing counter and never derives a cost.

> **Historical.** Version `0.1.0` reported the counters of the **last model call** verbatim under the
> label `Token counters (as reported)`, and summed nothing. Version `0.1.1` introduced the Turn
> aggregate and the `schemaVersion` 2 candidate; the label became `Token usage (turn aggregate)`.
> Everything in this section describes `0.1.1` and later, `0.4.0` included.

## 3. Explicit non-goals

These are absent by decision, not by omission. Each is recorded with its reasoning in
[`DECISIONS.md`](DECISIONS.md).

| Not implemented | Reason |
| --- | --- |
| Attachments of any kind, including an over-long body moved to an attachment | Attachments escape the body's content review and add MIME complexity |
| HTML templates or a theme engine | Plain text carries the same information with no rendering surface |
| A reply channel back into the harness | Notifications are one-way by design |
| An action link or any remote callback in a message | The plugin never constructs a DSH Web link, never reads a token, and never sends one |
| Multi-recipient routing by turn type | No user requirement; would multiply the privacy surface |
| Progress, per-step, or streaming notifications | The notified lifecycles are settlement and human-attention blocks, not activity |
| Notifications for `aborted`, `blocked`, `interrupted`, `forked` | These produce no output the user was meant to read, or close a turn that never settled |
| An "email me even with an empty body" switch | Produces a stream of content-free mail that trains the recipient to ignore the channel. The terminal-error exemption of §2.2 is not this switch: it is a status-specific content rule with no configuration of its own |
| Answering a question or an approval from the mail | Both are notification-only; the human acts in DSH |
| Detection of failed shell commands from their output text | `explicitToolErrorCount` deliberately excludes it; a shell non-zero exit is a successful tool result in DSH |
| Cost accounting or quota alerts from `usage` | The plugin derives nothing from the counters, so a cost figure would present a guess as a fact |
| Cross-process deduplication | Requires persistence, corruption recovery, and a product answer to "should a replayed turn re-notify" |
| ~~A browser or Client-side surface~~ | **Superseded in v0.4.0.** The original entry read "Host-only plugin; there is no UI to build". DSH `0.1.7` replaced the namespace-registration seam with schema-derived forms, and a plugin's configuration surface became a browser contribution, so v0.4.0 ships a client bundle with a Plugins-page configuration form (`docs/ARCHITECTURE.md` §10.1). Still non-goals: an in-conversation notification card, a mail history view, and any surface that renders mail bodies in the browser |
| Any modification to the DeepSeek Harness source | Delivery requirement |

## 4. Deliberate semantic boundaries

Four statements the product makes, and what they do and do not claim:

**"Task completed"** means the harness reported the turn as `completed` and reported no explicitly
failed tool call. It does **not** mean the commands the agent ran succeeded. A `pwsh` invocation
that exits non-zero is, in DSH, a successful tool call whose output happens to say so. The plugin
will not claim more than the harness reported, and no configuration makes it claim more.

**"Duration unknown"** means the plugin attached after the turn had already started, so the turn's
start time was never observed. The body says so, the candidate records `durationMs: null`, and the
duration threshold is not applied — an unknown duration is not a short duration.

**"Token usage (turn aggregate)"** is a sum over the model calls the plugin observed, not a verbatim
quotation of any one report. What it claims is bounded by four facts: only accountable calls are
folded; every bucket is summed independently; a call that reported nothing usable is counted as
missing rather than zero-filled; and the completeness flag states whether the fold covers all of
them. Version `0.1.0` did quote a single report verbatim; that is history, recorded in §2.6, not
current behaviour.

**"Waiting for a human"** means the plugin observed an `ask_user_question` call or an
`approval/asked` record, not that a person has seen the mail or that the request is still pending.
The mail is notification-only: it has no reply channel and no action link, and the only way to answer
is to open DSH.

## 5. Operational expectations

- **Volume.** More than one email per qualifying top-level turn is normal, because each lifecycle
  deduplicates independently. A single Turn can legitimately produce one or more distinct question
  notifications, one or more distinct approval notifications, and one terminal Turn notification.
  Deduplication applies within each lifecycle identity (§2.5), never across them.
- **Latency.** Delivery is asynchronous and off the agent's path; the listener returns in constant
  time regardless of SMTP behaviour. A settled-Turn email typically arrives within seconds of the
  turn ending, and a human-attention email is enqueued while DSH is still blocked on the answer.
- **Failure visibility.** Every suppression, refusal, retry, and failure is a structured log line.
  Nothing is dropped silently: a full queue increments a counter, and a suppressed candidate records
  its reason.
- **Failure isolation.** No send failure can reach the agent loop. A send path that throws is
  classified, logged, counted, and absorbed.
- **Footprint.** No files, no database, no persistent state. Memory is bounded: the turn map is
  released as turns settle, the per-turn prompt attribution is dropped with its turn, and the dedupe
  cache has a hard capacity.

## 6. Intended user

Someone already running DSH who wants to walk away from a long agent turn and be told, on their
phone, what it concluded — and who accepts that the conclusion leaves the machine. The same person is
the one an agent is waiting for when it blocks on a question or an approval, which is why those two
lifecycles exist and why both are off by default: the content they carry is written by the agent, and
enabling them is a separate decision from enabling completion mail. The security implications of that
acceptance are set out in [`SECURITY.md`](SECURITY.md) §8, because they are a precondition of using
the plugin rather than a caveat attached to it.
