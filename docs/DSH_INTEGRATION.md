# DSH_INTEGRATION — the interfaces this plugin actually uses

This file records the DSH interfaces `dsh-mail-notify` depends on, the version they were verified
against, and where each fact came from. It is deliberately narrower than
[`../PHASE1_RUNTIME_CONTRACT.md`](../PHASE1_RUNTIME_CONTRACT.md): that document is the full runtime
contract gathered during Phase 1, while this one is the dependency surface of the shipped plugin.

Verified against:

| Item | Value |
| --- | --- |
| DSH | `0.1.5-rc.1` and `0.1.5-rc.2` |
| Cordis | `4.0.2` (identical under both DSH versions) |
| Schemastery | `3.18.2` (identical under both DSH versions) |
| Node | `v24.13.0` |
| Evidence | Phase 1 Inspect + live prototype; Phase 3 source inspection and live composition; Phase 6 telemetry inspection of 858 recorded session logs (1 432 completed turns, 503 208 events) |

## 1. Interfaces used

| Interface | How it is reached | Used for | Required? |
| --- | --- | --- | --- |
| `session/event` (Cordis event) | `ctx.on('session/event', (session, event) => …)` | The only event observation entry point | Yes — the plugin is pointless without it |
| `session/disposed` (Cordis event) | `ctx.on('session/disposed', (session) => …)` | Releasing a session's turn state | No, but registered unconditionally |
| `credentials.resolve(ref)` | `ctx.get('credentials')`, then `undefined` check | Reading the SMTP password, once per send attempt | No |
| `credentials.describe(ref)` | Same handle | Building a diagnostic that names the reference without its value | No |
| `timer.timeout(delayMs)` | `ctx.get('timer')`, then `undefined` check | A retry backoff that a plugin unload cancels | No |
| `ctx.logger(name)` | `ctx.logger('dsh-mail-notify')` | The single structured logging exit | Yes |
| `ctx.on` | Registration | Listener ownership and disposal with the fiber | Yes |
| `ctx.effect(fn, label)` | Disposal hook | Releasing the queue and state on unload | Yes |

`inject` is deliberately empty. Declaring `credentials` or `timer` there would make them hard
dependencies, and a profile mounting neither would never activate the plugin at all. Both are read
optionally instead, so a missing service produces a named diagnostic at send time. A profile
without `credentials` still loads, still observes turns, and reports
`this profile mounts no Credential service` when a send is attempted.

**Not used:** the `sessions` service (a root-level listener already receives every session's
events, so reverse lookup would add coupling for no information), any Slot or Client-side
interface, and any path that modifies harness configuration.

## 2. Event payload paths

`turn/start`, `step/start`, `assistant/message`, `assistant/attempt`, `llm/retry`,
`llm/retry-started`, `tool/call`, `tool/result`, `user/message`, and `turn/end` are
not top-level Cordis events. They are members of the `SessionEvent` union delivered through the
single `session/event` event, so every field access descends through `event.data`.

| Fact | Path |
| --- | --- |
| Event type, time, sequence | `event.type`, `event.time`, `event.seq` |
| Payload root | `event.data` |
| Session id | `session.id` |
| Workspace, preset | `session.header.cwd`, `session.header.agentPreset` |
| Subagent, primary criterion | `session.header.origin === 'subagent'` |
| Subagent, redundant criteria | `session.header.parentSession`, `session.header.delegationDepth > 0` |
| Turn, step | `event.data.turn`, `event.data.step` |
| Content blocks | `event.data.message.content` |
| User-visible text | `…content[i].text` **only when** `.type === 'text'` |
| Message id | `event.data.message.id` |
| Provider, model | `event.data.message.source.provider` / `.model`, when `.source.kind === 'model'` |
| Per-call token counters | `event.data.usage` on `assistant/message`; else the last `{ type: 'chunk', chunk: { type: 'usage', usage } }` record in `event.data.stream` |
| Per-call counters, attempt | `event.data.stream` only — an `assistant/attempt` payload has no `usage` field |
| Retry identity | `event.data.turn`, `event.data.step`, `event.data.retryId`, `event.data.retry`, `event.data.failure`; **no usage field exists** |
| Tool failure, criterion A | `event.data.message.content[0].isError === true` |
| Tool failure, criterion B | `event.data.error !== undefined` |
| Turn end reason | `event.data.reason.kind` |
| Abort cause | `event.data.reason.reason.kind` |
| Provider error | `event.data.reason.error.code` / `.message` |
| Provider error, structured | `event.data.reason.error.status` / `.providerRetryAfterMs`; `.requestId` is read by nobody |
| Tool name, per call | `event.data.name` on `tool/call`; matched exactly before any argument is looked at |
| Tool call id | `event.data.callId` on `tool/call`; the question notification's dedupe identity |
| Tool arguments | `event.data.arguments` on `tool/call`; read by `human-attention.ts` only, and only when the name matched |
| Approval identity | `event.data.id` on `approval/asked`; used as a dedupe identity, never rendered |
| Approval target | `event.data.toolName`, `event.data.callId?`, `event.data.reason?` on `approval/asked`; the payload carries no `turn` and no `session`, and no tool arguments |

Every path in this table is read behind a runtime shape check, because the plugin may be loaded
from a bundle whose dependency versions differ from the ones it was compiled against. A `turn`
that is missing or not a number degrades the event to `other`; it is never defaulted to `0` or
`NaN`.

### 2.1 Turn telemetry event support

Phase 6 verified which telemetry events the two supported DSH versions emit, and how often, by
decoding every recorded session log on this machine.

| Event | `0.1.5-rc.1` | `0.1.5-rc.2` | Observed occurrences | Accumulated into turn state |
| --- | --- | --- | --- | --- |
| `turn/start` | present | present | 1 456 | start time, `telemetryComplete` |
| `step/start` | present | present | 30 335 | announces one accountable model call |
| `assistant/message` | present, `usage?` per call | identical declaration | 30 227 (30 224 with usage) | one folded usage sample |
| `assistant/attempt` | present, no `usage` field | identical declaration | 83 (0 with stream usage) | one settlement; unusable usage counts as a gap |
| `llm/retry` | present, no usage field | identical declaration | 376 (261 distinct steps) | one unobservable failed call |
| `llm/retry-started` | present | identical declaration | 376 | deliberately not accumulated |
| `step/end` | present | present | 30 318 | not read |
| `turn/end` | present | present | 1 432 | settlement |

The declarations are byte-identical between the two versions for `dsh-session`, `dsh-llm`,
`dsh-llm-retry`, and `dsh-token-meter`, so this plugin carries **no version branch**: the same
`runtime-adapter.ts` path serves both. The observed ordering of a retried step is
`step/start → assistant/attempt? → llm/retry → llm/retry-started → assistant/message`, and a
retried failure may also be recorded with no `assistant/attempt` at all; both orderings are
covered by fixtures and by the L5 telemetry suite.

`llm/retry-started` is recognised by the adapter only so that its shape is pinned in one place. It
is not accumulated, because the call it announces a replacement for is already counted at
`llm/retry`, and the replacement settles through its own `assistant/message` or
`assistant/attempt`.

### 2.2 Human-attention event support

`0.2.0` added two triggers, and both are durable events rather than waterfalls. Phase 8 re-read the
installed declarations for this, because a wrong trigger would either claim an answer it must not
claim or miss the interaction entirely.

| Item | `0.1.5-rc.1` | `0.1.5-rc.2` | Trigger used | Not used, and why |
| --- | --- | --- | --- | --- |
| Ask a human (`tool/call`, name `ask_user_question`) | present | not re-verified in this phase | the `session/event` member `tool/call`, exact name match first | — |
| `tool/call` payload | `{ turn, step, callId, name, arguments }`, all required, `arguments` an unparsed JSON string | identical declaration | all four fields read | — |
| `user-questions/request` | present, `@mode waterfall` | not re-verified in this phase | **not registered** | returning from it claims the request and would displace the official answerer (D018 §6) |
| Approval ask (`approval/asked`) | present, log-only audit, no `surfaceOp` | not re-verified in this phase | the `session/event` member `approval/asked` | — |
| `approval/asked` payload | `{ id, toolName, callId?, reason? }`; no `turn`, no `session`, no arguments | identical declaration | `toolName`, `callId`, `reason` | the payload's own omission of tool arguments is what keeps them out of the mail |
| `approval/decided` | present, log-only audit | not re-verified in this phase | nothing | a decision means the human already acted, so a second "you are needed" mail would be false |
| `approval/request` | present, `@mode waterfall` | not re-verified in this phase | **not registered** | same ownership reason as `user-questions/request` (D018 §8) |

Two facts about the question path are worth stating because they bound what any observer can do.
`ctx.userQuestions.ask` throws `DELEGATED_CALLER` for a delegated caller, so whether a subagent can
ask at all depends on the composition; the plugin's `includeSubagents` gate is therefore asserted
independently of that ability. And `dsh-tool-ask-user` maps the model-facing `multi_select` argument
onto the service-side `multiSelect`, so the parser accepts both spellings and the notification does
not depend on which side of that mapping it is reading.

Phase 8 verified the two new surfaces against the `0.1.5-rc.1` installation only, which is the one
present on this machine. The two versions were shown byte-identical for the packages Phase 6
checked; that check was not repeated for `dsh-user-questions`, `dsh-user-approval`, or
`dsh-tool-ask-user`, so `0.1.5-rc.2` is **unverified for the human-attention surfaces** rather than
known-good or known-bad. If a shape difference exists there, the compatibility branch belongs in
`runtime-adapter.ts` and nowhere else.

### 2.3 Feature availability

No supported version lacks any capability this plugin uses. `ask_user_question` requires the
`dsh-tool-ask-user` row to be mounted, and approval notifications require `dsh-user-approval`; a
profile that mounts neither still loads this plugin, and the corresponding switch simply never has
an event to act on. That is availability of a row in a profile, not a DSH version boundary, and it
is reported by the plugin's own `plugin.ready` line rather than assumed.

## 3. Wire-level facts that shape the code

| Fact | Consequence |
| --- | --- |
| `session/event` is dispatched synchronously on the `Session.append()` path and its return value is never awaited | The listener is synchronous and returns `undefined`; all I/O lives behind the queue |
| A listener throwing is contained per listener by the harness | The plugin must still not throw; the containment is not relied upon |
| Root-level listeners receive every session's events (scope filtering lets untagged listeners through) | No `sessions` service lookup is needed for global observation |
| `event.data` is snapshotted and deep-frozen before delivery, while `session` stays a live object | Payload fields are safe to read directly; the returned DTOs still copy rather than alias |
| `TurnEndReasonMap` has exactly six kinds | `unknown` exists only as forward-compatibility cover for a seventh |
| `tool/result` message content is a single-element tuple and `isError` is absent on success | The criterion is `=== true`, never a truthiness test |
| A non-zero shell exit is a successful tool result | It is not an error, and no output text is parsed |
| `delegationDepth: 0` is a legal value on top-level sessions | The only permitted comparison is `typeof === 'number' && Number.isFinite(d) && d > 0` |
| `ContentBlockMap` is merge-extensible | Unknown block types are a normal event; the whitelist excludes them silently |
| A `reasoning` block carries a `text` field exactly like a `text` block | Extraction keys on `type`, never on the field name |
| `TokenUsage` counts are disjoint: `inputTokens` is uncached input, cached input is `cacheReadTokens`/`cacheWriteTokens` | The three input buckets are never summed into one, and `reasoningTokens` (a subset of `outputTokens`) is never added to it |
| `event.seq` is a contiguous, monotonic per-session sequence number, present on every durable event | It is the settlement identity used to keep a replayed or duplicated event from being folded twice |
| At most one `assistant/message` is emitted per `(turn, step)` — 0 of 30 227 observed messages shared a step | A second usage-bearing message for a step is treated as a duplicate, which is what makes a replayed turn with fresh sequence numbers safe |
| A failed model call's usage is not reported anywhere: `llm/retry` has no usage field, and no observed `assistant/attempt` carried a stream usage record | A retry makes the turn's usage incomplete rather than silently partial (D017) |
| An optional bucket's absence means the provider reported none for that call, not that the call was skipped — `opencode-go/hy3` omits `cacheReadTokens` when nothing was cached, `deepseek-official` always reports it | Optional buckets are summed over the samples that reported them; they are never zero-filled, and they are not dropped because one call omitted them |

## 4. Verified runtime integration

Performed against a freshly created profile seeded from the shipped `headless` template, into which
the packed archive was installed with the documented command. The composition was then booted both
by the `dsh` launcher and by `scripts/dev-boot-probe.mjs`, which attaches a Cordis log exporter so
the plugin's own structured lines become observable.

| Check | Result |
| --- | --- |
| `dsh plugin --profile <p> add ./dsh-mail-notify-0.1.0.tgz` recognises the bundle manifest | Passed — the package was appended to `dsh.profile.bundles` and its row appeared in `--dump-config` |
| The compiled plugin loads in a real composition | Passed — `plugin.ready` was emitted with the resolved configuration |
| `enabled: false` registers no listener | Passed — `plugin.disabled` was emitted and the run behaved identically to a composition without the plugin |
| `enabled: true` observes a real top-level turn | Passed — `candidate.produced` for a live session, then `notification.enqueued` and an `ok` outcome |
| Subagent turns produce no candidate | Passed — a real delegation produced exactly one candidate, for the parent session |
| An invalid configuration refuses to mount | Passed — `plugin.config-invalid` named all five failing fields |
| The Agent Loop is unaffected | Passed — every probed turn completed and printed its answer |

Phase 6 repeated the composition checks under both supported versions, and added a telemetry
cross-check that does not depend on this plugin at all:

| Check | Result |
| --- | --- |
| The packed archive installs and loads under `0.1.5-rc.1` and `0.1.5-rc.2` | Passed — `plugin.ready`, `candidate.produced`, `notification.enqueued`, `mail.sent`, and an `ok` outcome in both |
| A real multi-step turn aggregates every model call | Passed — `usageSampleCount` equalled the number of `assistant/message` events in the turn, and the aggregate equals an independent fold of the recorded events |
| The aggregate agrees with DSH's own `deriveTurnTokenUsage` | Passed — on the 967 of 1 432 recorded turns where the official meter returns a disclosure, `inputTokens` and `outputTokens` matched **967/967**; the meter declines the rest under its stricter all-or-nothing bucket rule |
| Duration equals the turn boundary interval | Passed — `candidate.durationMs === event.time(turn/end) − event.time(turn/start)` on every turn examined; no duration defect was reproduced |
| `scripts/turn-telemetry-probe.mjs` reproduces the pre-fix behaviour | Passed — replaying a recorded 63-step turn through the v0.1.0 build yields the last call's counters, and through the current build the turn aggregate |

A duplicate `turn/end` replayed into the live process produced a *fresh* candidate rather than a
`duplicate` suppression, and that observation is recorded here because it is informative rather
than a defect: the handler releases a turn's state as soon as the turn settles, so a later
`turn/end` for the same turn number rebuilds empty state and is suppressed for having no visible
text before the deduplication rule is reached. In the live runtime the duplicate rule is therefore
defensive. Its behaviour is covered by the L1/L2 tests, which drive the real event bus. The
duplicate scenario that *is* reachable inside a live turn — the same settlement delivered twice,
or a replayed turn with fresh sequence numbers — is handled inside the usage fold (D017), and is
covered by the L1 telemetry suite and the L5 chain tests.

## 5. Maintenance points

The DSH boundary is one file: `src/runtime-adapter.ts`. Its two entry points are
`toSessionFacts(session)` and `toInternalEvent(event)`, and nothing outside that module reads
`event.data`, a `Session`, or a `SessionHeader`.

On a harness upgrade, review in this order:

1. `SessionHeader` — did `origin`, `parentSession`, or `delegationDepth` change meaning?
2. `SessionEventMap` — did a payload gain a wrapper or rename a field?
3. `TurnEndReasonMap` — did a seventh reason appear, or a detail field move?
4. `ContentBlockMap` — did a new block type land that should or should not be treated as visible?
5. `CredentialProvider` — is `resolve` still per-call, and does `describe` still avoid the value?
6. The `timer` service — is there still a fiber-scoped `timeout(delayMs)`?
7. `TokenUsage` and the telemetry lifecycle — is `assistant/message.usage` still per call? Do
   `assistant/attempt` / `llm/retry` still exist, and does a retry still expose no usage? Compare
   against `@deepseek-ai/dsh-token-meter`'s `deriveTurnTokenUsage`, which is the authoritative
   independent fold, using `node scripts/turn-telemetry-probe.mjs --meter <install-root>`.

`tests/adapter/` is where those shapes are pinned. Its fixtures mirror the recorded runtime payload
shapes deliberately; a fixture invented from a declaration file would let the adapter pass while
the runtime delivered something else. `scripts/turn-telemetry-probe.mjs` is the complementary
check that operates on real recorded turns rather than on fixtures: it decodes a durable session
log, folds a turn independently, replays it through a chosen build, and can compare the result with
the official meter.
