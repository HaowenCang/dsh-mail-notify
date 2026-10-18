# 02 — Plugin-side host-API usage audit (candidate target: DSH `0.2.1-rc.2`)

Status: **read-only audit, no source change made.** This document is the `C1-B` deliverable.

| Field | Value |
| --- | --- |
| Plugin under audit | `dsh-mail-notify` `0.5.0` (published, immutable history) |
| Repo / branch / HEAD | `E:\Projects\DSHarness\dsh-mail-notify` · `compat/dsh-0.2.1-rc.2` · `83a0998a` (`docs: record v0.5.0 release`) |
| Working tree at audit start/end | clean (`git status --porcelain` empty); no commit, tag, lockfile or `package.json` change was made |
| Last verified host | DSH `0.2.0-rc.2` — installed typings in this checkout are exactly `0.2.0-rc.2` (`node_modules/@deepseek-ai/dsh-*`) |
| Candidate target host | DSH `0.2.1-rc.2` — **not installed in this checkout**; its contracts were not independently inspected by this audit |
| Files read | `src/**`, `tests/**`, `scripts/**`, `package.json`, `package-lock.json`, `cordis.patch.yml`, `tsconfig*.json`, `tsdown.config.ts`, `.env.example`, `README.md`, `V0.5.0_COMPAT_REPORT.md`, `docs/DSH_INTEGRATION.md`, `docs/DECISIONS.md` (D022), `00_MASTER.md` (relevant rows) |
| Peer artifact | `docs/compat/01_CONTRACT_DIFF.md` **did not exist at the time of writing** — this report deliberately does not depend on it; the host-side diff is a separate evidence class (`C1-A`) |

## 0. Method, evidence classes, and what this audit does *not* establish

**Evidence classes used here, in decreasing strength:**

1. **Compile-time contract pins** — `tests/compatibility/contracts.compile.ts` (client program) and `scripts/type-probes/host-contracts.compile.ts` (host program). These are *not executed*; they fail `npm run typecheck` when a named DSH contract moves. They are the strongest static statement the repo has.
2. **Mounted-plugin integration tests** — `tests/support/plugin-harness.ts` mounts the real `apply` on a real Cordis `Context`, drives real `ctx.emit('session/event', …)`, and disposes the real fiber. `tests/integration/lifecycle.test.ts`, `queue.test.ts`, `mailer.test.ts`, `timed-question.test.ts`, `attention-notification.test.ts`, `failure-notification.test.ts`, `turn-telemetry.test.ts`.
3. **Real-assembly probe scripts** — `scripts/probe-e2e.mjs` (8 scenarios), `scripts/probe-live-policy.mjs`, `scripts/probe-host-config-write.mjs`, `scripts/probe/browser-e2e.mjs`, plus the schema/volatile/config-check/credential probes. These boot a real isolated DSH profile/Chrome; they are **not** part of `npm test`. Their recorded results live in `V0.5.0_COMPAT_REPORT.md` §5–§14.
4. **Static source reading** — used for every `file:line` below.

**Limitations, stated so this report is not over-read:**

* The test suite and probes were **read, not executed, by this audit session**. The pass/fail figures quoted are the ones recorded in `V0.5.0_COMPAT_REPORT.md` for DSH `0.2.0-rc.2`; the test files themselves are cited as *existing evidence of what is asserted*.
* **DSH `0.2.1-rc.2` release notes were not used as evidence.** Operator statements about changes to hot-reload, credential read priority, and connection mechanisms are treated as *unverified hypotheses* in §4, not as facts.
* This audit does not claim any source-level use of an API that `0.2.1-rc.2` is known to have removed; no such removal was verified here. `C1-A` (host source diff) and `C4-A` (isolated 0.2.1 host) are the authoritative checks.
* The pass/fail of the install gate on `0.2.1-rc.2` is **expected** from the peer declarations (§3.1), not measured here; `C4-A` measures it.

---

## 1. Host/API surface catalog

Every row is a DSH surface the plugin actually touches, with the plugin-side usage evidence and why it matters for a host migration. The two host halves and the client half are catalogued separately because they compile in separate TypeScript programs (`tsconfig.json`, `tsconfig.test.json`, `tsconfig.client.json`) for a documented reason: `ctx.connection` is typed as `HostConnectionHandle` by the connection package's host entry and as `ConnectionHandle` by its client entry, so one program cannot hold both (`scripts/type-probes/host-contracts.compile.ts:1-15`; `tests/compatibility/contracts.compile.ts:14-21`).

### 1.1 Plugin entry, services and Cordis primitives

| # | Host surface | PLUGIN_USAGE evidence | What the plugin expects | Why it matters for `0.2.1-rc.2` |
| --- | --- | --- | --- | --- |
| A1 | Cordis plugin module contract: `name`, `apply(ctx, config)`, `inject`, `Config` export | `src/index.ts:74` (`name`), `:83` (`inject: []`), `:85` (`export { Config }`), `:171` (`apply`) | `apply` receives the Config-resolved **volatile** tree; `inject` is empty so activation never waits on optional services | Any change to plugin activation/inject semantics affects whether the plugin loads at all; `inject: []` is deliberate (`src/index.ts:1-32,76-83`) |
| A2 | `ctx.logger(name)` | `src/index.ts:176`; `src/settings.ts:146`; wrapper contract `src/logger.ts:18-23` | Cordis logger with `error/warn/info/debug`, printf-style single-argument payloads (`src/logger.ts:77-82`) | The single logging exit; `ctx.logger` is called un-guarded in `apply`, so a missing/renamed logger member breaks activation |
| A3 | `ctx.effect(fn, label)` (fiber disposal hook) | `src/index.ts:337-343` (plugin teardown); `src/index.ts:319-334` (route registration scope); `src/client/index.tsx:72` (browser half) | Disposer runs on fiber dispose; returned promise is awaited by Cordis | Uninstall / HMR teardown correctness — release §2 |
| A4 | `ctx.inject(['connection'], cb)` (scoped injection) | `src/index.ts:318` | Callback runs on a child context once the service is available; an `effect` inside owns the routes | Connection absent ⇒ routes silently never registered (status/Test Email degrade, card still renders); a change to scoped-inject semantics affects route publication |
| A5 | `ctx.get('timer')` — optional service `timer.timeout(delayMs): Promise<void>` | `src/index.ts:579-589` (read), `:406` (used as queue sleep) | Optional; structural duck-typing (`typeof timer.timeout === 'function'`) | Backoff that a fiber unload cancels. Absent ⇒ fallback `setTimeout` (`src/queue.ts:69-77`), i.e. degradation, not break |
| A6 | `ctx.get('credentials')` — optional Credential service | `src/credentials.ts:70-81` | Optional; provider object must expose **both** `resolve` and `describe` functions, else it is treated as absent | Absent/renamed provider ⇒ every send fails permanently with a "no Credential service" diagnostic (§1.7) |
| A7 | `ctx.on(event, listener)` → disposer | `src/index.ts:441,446,469`; `src/settings.ts:153` | Registration bound to the plugin's fiber; disposer removes exactly that registration; listeners run synchronously on the session-append path | The three session listeners plus the config listener; release §2 |
| A8 | Plugin `Config` as a **Standard Schema** node | `src/config.ts:206` (`Config = withProductChecks(fieldSchema)`), `:345-452`; `src/config-check.ts:403-431` | Cordis `resolveConfig(fiber.runtime, candidate)` calls `Config['~standard'].validate(candidate)`, throws `ValidationError` on issues; the node is rebuilt from `Config.toJSON()` so it still projects a form | Host pre-persistence refusal and volatile-reference production. Hard import-time throw if Schemastery no longer exposes `~standard` as a prototype getter (`src/config-check.ts:405-411`) |
| A9 | `Volatile<T>` reference protocol | `src/config.ts:272-302` (collapse once per operation); `src/settings.ts:158`; `scripts/type-probes/host-contracts.compile.ts:73-85` | Every Config field is a `Volatile` whose `.get()` returns a frozen snapshot; the Loader updates references **in place** | The entire live-configuration design (`src/index.ts:10-29`) |
| A10 | `session/disposed` event | `src/index.ts:446-448` | Emitted with the live session; used only to release turn state | Leak fallback; absence degrades (state also released at `turn/end`) |
| A11 | `loader/volatile-update` event | declared by the plugin at `src/settings.ts:61-69`; subscribed `:153-155`; consumed at `src/index.ts:196-240` | Signature `(paths: readonly (readonly string[])[]) => void`; emitted by the Loader **after** it commits new reference values, dispatched through a context filtered to the owning fiber (`src/settings.ts:26-35`; test `tests/unit/settings.test.ts:143-171`) | **The** hot-reload signal. Because the event name is declared by the plugin itself, `tsc` cannot detect a host rename — §4 R2 |
| A12 | Bundle manifest `dsh.bundle.patch` | `package.json:19-22` → `cordis.patch.yml:16-20` | Profile bundle layer inserts a Loader row `{id: dsh-mail-notify, name: dsh-mail-notify, config: {enabled: false}}` | Install/compose gate; the patch row's `id` must equal the settings namespace (`src/protocol.ts:37-53`) |
| A13 | Client manifest `dsh.client.platform` / `dsh.client.inject` | `package.json:23-33`; browser-side requirement list `src/client/index.tsx:41-57` | `platform: 'web'`; inject six names (`@deepseek-ai/dsh-client-ui-renderer`, `…-ui-settings`, `…-ui-plugin-manager`, `…-client-connection`, `…-api-remotes`, `…-client-locale`) | Browser-half activation; rename of any package ⇒ card silently absent (§4 R7) |
| A14 | DSH runtime version vs `peerDependencies` | `package.json:77-83` — only `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-session`, both exact `0.2.0-rc.2`; **no `@deepseek-ai/dsh` peer; no `engines.dsh`** | The 0.2.0-era gate compares `@deepseek-ai/dsh` + `@deepseek-ai/dsh-*` peers against the exact runtime version; prereleases participate; missing DSH peers impose no constraint; `engines.dsh` is not read | Blocking install gate on `0.2.1-rc.2` — §3 |

### 1.2 Session event subscriptions and payload field access

Two `session/event` listeners are registered, plus one `session/disposed` listener (`src/index.ts:441-469`; the listener set is asserted exactly in `tests/integration/lifecycle.test.ts:47-62,64-92`). The adapter is the only module that reads a raw DSH payload (`src/runtime-adapter.ts:1-19`), and every access below is shape-checked at runtime because the plugin may load into a bundle whose dependency versions differ from the ones it was built against (`src/runtime-adapter.ts:4-10`).

| # | Event / carrier | Payload fields read — PLUGIN_USAGE evidence | What the plugin does with it | Why it matters |
| --- | --- | --- | --- | --- |
| B1 | `session/event` (turn listener) | `src/index.ts:441-444` → `src/event-handler.ts:533-632` | Every event: translate, classify, accumulate turn state, settle at `turn/end` | The single observation entry point the plugin cannot work without (`docs/DSH_INTEGRATION.md:43-44`) |
| B2 | `session/event` (approval listener) | `src/index.ts:463-469` (`event.type !== 'approval/asked'` at `:466`; `event.data` at `:467`) → `src/event-handler.ts:749-796` | Approval notification only | Separate entry point keeps the approval path visible and cannot claim answer ownership (§11/§20 in source docs) |
| B3 | `turn/start` | `event.type`, `event.seq`, `event.time` (`src/runtime-adapter.ts:299-302`); `data.turn` (`:306,335-336`) → state `sawTurnStart`/`startAt`/`telemetryComplete` (`src/event-handler.ts:373-382`) | Proof that the plugin observed the turn's start; duration and telemetry-completeness derive from it | If 0.2.1 renames/removes it, durations become `null` and telemetry is reported incomplete (not a crash) |
| B4 | `step/start` | `data.turn`, `data.step` (`src/runtime-adapter.ts:306-307,338-339`) | Distinct step count; announces one accountable model call (`src/event-handler.ts:383-390`; `src/telemetry.ts:165-171`) | Drives the "missing usage" accounting |
| B5 | `assistant/message` | `data.turn/step` (`:306-307`); `data.message.content` (`:342-346`); `data.message.id` (`:348`); `data.message.source.kind === 'model'` + `provider`/`model` (`:158-170,347`); `data.usage` **then** `data.stream` chunk-usage fallback (`:349-352,185-196`); `data.seq` (`:301,357`) | Visible text, provider/model, message id, one folded usage sample (`src/event-handler.ts:392-416`; text extraction `src/content.ts`) | The turn's answer text and its per-call token report. Renamed fields ⇒ silence or incomplete telemetry |
| B6 | `assistant/attempt` | `data.turn/step/seq`; `data.stream` only (no `usage` field) (`src/runtime-adapter.ts:367-380`) | Accountable model call with no surface message; counted as a gap when its stream carries no usage (`src/event-handler.ts:418-432`) | Completeness accounting |
| B7 | `llm/retry` | `data.turn/step/seq` only (`src/runtime-adapter.ts:382-386`); `retryId`/`retry`/`failure` deliberately not read | One unobservable failed model call (`src/event-handler.ts:434-442`; `src/telemetry.ts:244-254`) | A retried call makes the turn's usage incomplete rather than silently partial (D017) |
| B8 | `tool/call` | `data.turn/step` (`:306-307`); `data.name` (`:393`); `data.arguments` **as an opaque string** (`:394`); `data.callId` (`:395`) | `toolCallCount`; exact-name match `ask_user_question`, then parser (`src/event-handler.ts:444-449,577-584,677-737`) | Question notifications; the argument string is read only by the allowlist parser |
| B9 | `tool/result` | `data.turn/step`; `data.message.content[0].isError === true` (`:410-413`); `data.error !== undefined` (`:414-415`); `data.error.name`/`.code` (`:417-418`) | `explicitToolErrorCount`; a non-zero shell exit is **not** an error (`src/event-handler.ts:451-457`; test `lifecycle.test.ts:198-217`) | Classification of `completed-clean` vs `completed-with-tool-errors` |
| B10 | `user/message` | payload may be the message itself, else `{message}` fallback (`:212-217`); `content` string or `text` blocks (`:256-271`); `source.kind` as one scalar (`:241-245,318-323`); optional `data.turn` (`:306,321`) | Prompt attribution **by `source.kind`, never by position** (`src/event-handler.ts:86,277-318,558-575`) | `includeUserPrompt` content; a kind change silently re-attributes or drops prompts |
| B11 | `turn/end` | `data.turn`; `data.reason.kind` (`src/runtime-adapter.ts:430-433`); aborted: `reason.reason.kind` + hook `reason.reason.reason` (`src/completion.ts:122-134`); error: `reason.error.code`/`.message` (`src/completion.ts:147-157`), `.status`/`.providerRetryAfterMs` (`:186-207`) | Settlement classification; failure mail. `requestId` is deliberately not copied (`src/completion.ts:171-177`) | The family that carries most mail; a shape change can silence or misclassify it |
| B12 | `approval/asked` | `data.id` read only as a dedupe identity (`src/event-handler.ts:828-833`); `data.toolName`, `data.callId?`, `data.reason?` (`src/human-attention.ts:299-327`) | Approval notification; no tool arguments exist in this payload by host design | A rename here drops approval mail (`approval.unusable` log) without a crash |
| B13 | `approval/decided` / "resolved" | **not registered at all** (`src/index.ts:450-469` comment; `docs/DSH_INTEGRATION.md:153`) | Nothing: a decision means the human already acted | Deliberate absence, not an oversight. A `0.2.1` change to decisions does not affect this plugin |
| B14 | `session/disposed` | `session.id` via `toSessionId` (`src/runtime-adapter.ts:81-86` → `src/event-handler.ts:798-803`) | Release a session's turn state and held prompt | Leak fallback |
| B15 | Events observed-but-not-accumulated | `step/end`, `llm/retry-started` are named in `docs/DSH_INTEGRATION.md:117-137` but have no adapter arm → `{kind:'other'}` (`src/runtime-adapter.ts:466-467`) | Ignored by design | An added `0.2.1` event type is forward-compatible (falls into `other`) |

> Note on `user/message` shape: the payload **is** the message in the installed contract, but a wrapped `{message}` is accepted as fallback (`src/runtime-adapter.ts:198-217`). The resolver keeps determinism: a payload carrying its own message-shaped key wins.

### 1.3 `SessionHeader`, `source.kind`, subagent classification

The plugin reads exactly five `SessionHeader` members and never consults the id for hierarchy (`src/runtime-adapter.ts:71-155`).

| # | Surface | PLUGIN_USAGE evidence | Reads / expects | Why it matters |
| --- | --- | --- | --- | --- |
| C1 | `session.id` | `src/runtime-adapter.ts:81-86` | String or branded string; never inspected for hierarchy | Identity for state and dedupe keys |
| C2 | `session.header.cwd` | `src/runtime-adapter.ts:132-133` | Optional string | `candidate.cwd` and the rendered metadata block |
| C3 | `session.header.agentPreset` | `src/runtime-adapter.ts:134-135` | Optional string; carried on facts | Metadata only |
| C4 | `session.header.parentSession` | `src/runtime-adapter.ts:136-140` | Optional string; lineage **only**, explicitly *not* a subagent criterion (`:99-106`) | A fork the operator asked for is top-level; treating lineage as hierarchy once dropped those notifications (`src/types.ts`/fixture `tests/fixtures/runtime-shapes.ts:115-130`) |
| C5 | `session.header.origin === 'subagent'` | `src/runtime-adapter.ts:141-146` | Exact string equality; records `decidedBy: 'origin'` | Subagent exclusion, all three notification families |
| C6 | `session.header.delegationDepth` | `src/runtime-adapter.ts:148-152` | `typeof === 'number' && Number.isFinite && > 0` exactly — `0` is legal on top-level sessions, truthiness/`Infinity` must not decide | Subagent exclusion; the strict form was adopted after an observed misclassification (`:108-114`) |
| C7 | Unread header members | none | `version`, `isSeeded`, `createdAt` are not read by the plugin | So a session-format bump alone does not change plugin behavior — but format v4 semantics (below) matter |
| C8 | `MessageSource.kind` classification | read: `src/runtime-adapter.ts:220-245,309-326`; consumer: `src/event-handler.ts:78-107,293-318` | Only the **value** `'user'` makes a user-role message the operator's prompt; every other/absent kind is refused and counted (`prompt.attribution-rejected`) | The v4 attribution rule (D021). Both `user` and `user-rpc` carry `kind: 'user'` — matching the member name would drop Web-typed prompts (`scripts/type-probes/host-contracts.compile.ts:306-349`) |
| C9 | `MessageSourceMap['user-question-reply']` | asserted `scripts/type-probes/host-contracts.compile.ts:325-333`; fixture `tests/fixtures/runtime-shapes.ts:40-48`; test `tests/integration/timed-question.test.ts:219-258` | A late answer is a user-role message whose kind is not `'user'`; must never become the prompt | Timed-question correctness without a timed-specific branch |
| C10 | Subagent gate scope | `src/event-handler.ts:544-556` (turn), `:752-757` (approval); the policy section's `includeSubagents` (`src/config.ts:123-126`) | One switch covers all three families; the gate runs before any state is created | If `0.2.1` changes how a subagent is marked, the default could mail subagent turns (privacy) or suppress top-level turns (silence) |

### 1.4 Timed `ask_user_question`: timeout vs error, late answers, dedupe

The plugin has **no timed-specific branch**. It observes `tool/call` and classifies user messages by `source.kind`; the timed contract reaches it only as (a) an ordinary non-error `tool/result` when the foreground wait expires with `pending`, and (b) a `user/message` with `source.kind === 'user-question-reply'` for a late answer (`docs/DECISIONS.md:1345-1356`; `tests/integration/timed-question.test.ts:1-31`).

| # | Surface | PLUGIN_USAGE evidence | Behavior / expectation | Why it matters |
| --- | --- | --- | --- | --- |
| D1 | Tool identity | `QUESTION_TOOL_NAME = 'ask_user_question'` (`src/human-attention.ts:33`); exact match first (`src/event-handler.ts:682`) | No other tool's arguments are ever read | If `0.2.1` renames the tool or routes it differently, question mail stops silently |
| D2 | `tool/call.arguments` contract | `src/runtime-adapter.ts:388-405` (opaque string); parser `src/human-attention.ts:186-277`; asserted `scripts/type-probes/host-contracts.compile.ts:275-280` | Raw JSON string expected; a structured object is accepted as compatibility (`src/human-attention.ts:205-209`) | A change from string to object is tolerated; a rename to e.g. `args` is not |
| D3 | Timeout is **not** an error | no `timeout` read anywhere; explicit-error criterion is `isError === true` or `data.error` present (`src/runtime-adapter.ts:407-418`) | A `pending` settlement is an ordinary successful tool result, so the turn stays `completed-clean` and no "task failed" mail is produced (`tests/integration/timed-question.test.ts:190-215` TQ-04) | If `0.2.1` marked expiry as `isError: true`, every expired question would become a failure mail |
| D4 | Timed-only `timeout` field | not in the allowlist: question fields copied are `id`, `question`, `header`, `multi_select`/`multiSelect`, `options[].label/description` only (`src/human-attention.ts:97-169`); TQ-09/TQ-10/TQ-14 (`tests/integration/timed-question.test.ts:344-528`) | Never reaches a mail, job or log line | Privacy assertion with a distinctive sentinel (`918273645`) |
| D5 | Late reply dedupe | reply message has no arm that touches dedupe; question key is per `callId` (`src/notifier.ts:54-72`; `src/event-handler.ts:713`) | Reply neither consumes nor recreates the question key; a replayed `tool/call` is one interaction (TQ-07, `tests/integration/timed-question.test.ts:280-310`) | Prevents duplicate and prevents the reply looking like a question |
| D6 | Late reply attribution | `sourceKind !== 'user'` ⇒ `'non-user-source'` (`src/event-handler.ts:303`); counted and logged without text (`:334-349`) | Never `includeUserPrompt` content (TQ-05) | The prompt field must not be fed by an agent-steered answer |
| D7 | Pending-answer state vocabulary | `PendingUserQuestion.state` asserted only in the compile probe (`scripts/type-probes/host-contracts.compile.ts:384-402`) | The plugin does not read it | A host-side state rename does not reach this plugin, by design |

### 1.5 Token usage telemetry — candidate `schemaVersion: 2`

| # | Surface | PLUGIN_USAGE evidence | Reads / expects | Why it matters |
| --- | --- | --- | --- | --- |
| E1 | `TokenUsage` buckets | `src/telemetry.ts:59-68` (collector keys), `:112-130` (foldable requires `inputTokens`+`outputTokens`; `cacheReadTokens`/`cacheWriteTokens`/`reasoningTokens` optional); asserted by name `scripts/type-probes/host-contracts.compile.ts:361-368` | Five observable buckets; `totalTokens` is *accepted by the collector but never folded or emitted* (D006: no derivation) | A renamed bucket is silently absent ⇒ `usageComplete: false`, not a crash. The compile probe is the loud gate |
| E2 | Usage carrier on `assistant/message` | `data.usage` preferred, `data.stream` chunk-usage fallback (`src/runtime-adapter.ts:349-352`); asserted `scripts/type-probes/host-contracts.compile.ts:289-295` | Per-call report on the event, same order the DSH token meter reads | Turn-level aggregate must equal the sum of per-call reports |
| E3 | `assistant/attempt` stream-only usage | `src/runtime-adapter.ts:367-380`; asserted `:294` | No `usage` field exists on the payload; only the embedded stream may carry one | Completeness accounting |
| E4 | Retry record | `llm/retry` turn/step/seq (`src/runtime-adapter.ts:382-386`); asserted `:297-303` | No usage observable ⇒ the turn is never claimed complete once a retry is present | Failure-mix transparency |
| E5 | Fold & dedupe | `src/telemetry.ts:183-232` (`seq` identity `:333-337`, one usage-bearing message per step guard `:190-197`), `:286-317` (complete rule) | Durable `event.seq` is the settlement identity; a second usage-bearing message in one step is a duplicate | Replayed/duplicated events cannot double count |
| E6 | Candidate schema v2 | `schemaVersion: 2` (`src/turn-state.ts:224-268`; type `src/types.ts:382-439`); asserted `tests/integration/lifecycle.test.ts:110`, `tests/integration/turn-telemetry.test.ts` | Version 2 changed `usage` from "last per-call sample" to turn aggregate; optional keys are absent, `durationMs: null` means unknown | Consumers distinguish v1 from v2; a 0.2.1 change in per-call semantics would make the aggregate wrong while still rendering |

### 1.6 Credential provider read path and read-priority

The plugin implements **no priority logic**. It treats the provider's `resolve()` as the single authority and reads the value **inside every send attempt**, never caching it (`src/credentials.ts:1-12`; `src/mailer.ts:1-16`).

| # | Surface | PLUGIN_USAGE evidence | Reads / expects | Why it matters |
| --- | --- | --- | --- | --- |
| F1 | Provider acquisition | `ctx.get('credentials')` (`src/credentials.ts:73`); optional with `undefined` check | Object with **`resolve` and `describe` functions** (`:79`) | If either member is renamed/removed, the whole service is treated as absent ⇒ permanent `credential-missing` for every send (loud diagnostic, no retry) |
| F2 | `resolve(ref)` shape | `src/credentials.ts:18-21,116-154` | `{ value: string, source: string }` or `undefined`; empty string counts as unresolved (`:138`) | A changed result shape (e.g. `layer` instead of `source`, or a thrown error for missing) changes only diagnostics for `source`, but a changed *value* property silently becomes "not configured" |
| F3 | `describe(ref)` shape | `src/credentials.ts:23-28,90-103` | `{ configured, source?, writable }`; used for diagnostics **without reading the value** | Named diagnostic when a reference is missing; also the card's status (`src/client/wire.ts:189-199`) |
| F4 | Read priority | none in plugin; host provider ordered env layers (`process`, `project-env`, `user-env`) then file layer — probe records this: `scripts/probe/credential-contract.mjs:63,203-231` (`source === 'file'`, "value absent from every environment layer") | Plugin inherits whatever the host resolves; it only reports `source` | A 0.2.1 priority change is *invisible to the plugin*: a password written from the card could be shadowed (auth failure at send) or an env value could start winning (behavior change). Only the host probe can detect it |
| F5 | Reference grammar | `CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/` (`src/config-check.ts:73`), applied on the field (`src/config.ts:111-116`) and re-checked at the runtime boundary (`src/config-check.ts:238-256`); client default `DSH_MAIL_SMTP_PASSWORD` (`src/client/fields.ts:300-315`); asserted against host helpers by `scripts/type-probes/host-contracts.compile.ts:441-449` | POSIX-style env-var name; `<scope>/<id>` CredentialKey is refused deliberately (D019) | If 0.2.1 widens the grammar, a valid new-style reference would be refused at Save (field path error); if it narrows, an existing config becomes invalid |
| F6 | Write path | browser only: `remote.credentials.describe/set/unset` (`src/client/wire.ts:189-233`); host never writes credentials | Value crosses browser→host once on Save; no read path exists in the Remote | "Browser never receives the password" is a contract property, not a plugin habit |
| F7 | Missing service | `src/credentials.ts:120-126` | A named, actionable diagnostic naming `@deepseek-ai/dsh-credentials-local` | A profile without the service still loads and reports (§1.1 A6) |

### 1.7 Volatile configuration: read, live update, persistence

| # | Surface | PLUGIN_USAGE evidence | What happens | Why it matters |
| --- | --- | --- | --- | --- |
| G1 | Volatile read | every field read through `Volatile.get()` exactly once per operation, collapsed in `snapshotOf` (`src/config.ts:272-302`); binding `src/settings.ts:133-167`; per-sync snapshot `src/index.ts:197` | One operation consumes one consistent snapshot; a mid-operation update cannot mix old and new values | Live behavior; a changed `Volatile` protocol breaks all reads |
| G2 | Live update signal | `src/settings.ts:153-155` → `signal()` `:136-151` → `sync()` `src/index.ts:196-240` | Re-read whole config; structural fingerprint compare (`:198`); stand down if `enabled:false` (`:201-212`); refuse-and-keep-previous if invalid (`:214-224`); else release and remount (`:226-233`) | The mechanism that makes a Web save take effect without restart; failure = save appears to do nothing (silent) |
| G3 | Config write path | plugin never writes; browser stages drafts (`src/client/controller.ts:137-138,224-252,443-457`) and writes one atomic mutation `form.mutate(ops, revision)` (`:306-325`); password write follows the section write (`:327-339`) | Host persists to the profile patch through its own editor; a refused write leaves the file byte-identical and the revision unmoved (`scripts/probe-host-config-write.mjs:424-463`) | "A half-typed SMTP block cannot silently stop notifications" (`src/index.ts:18-22`) |
| G4 | Config field set | 23 fields, all `.volatile()` (`src/config.ts:90-186`); closed snapshot `:229-253`; form projection asserted by `tests/support/host-fields.ts:56-70` | Field names are the settings document's keys | A host form-projection change (Schemastery `toJSON` `{uid,refs}` table) could hide fields from the card — §1.9 |

### 1.8 `configForms` / settings registration, and the actual control count

The task brief asks to verify "23 Config fields + 1 credential password control". **Verified: the count is exactly 23 Config fields and exactly 1 separate write-only credential password control.**

**The 23 Config fields** (Host schema declaration order, `src/config.ts:90-186`; verified programmatically from the schema source; every one is `.volatile()` and every one is in `ConfigSnapshot` `src/config.ts:229-253`):

`enabled`, `smtpHost`, `smtpPort`, `smtpSecure`, `smtpUser`, `smtpPasswordCredential`, `from`, `to`, `includeSubagents`, `notifyCompleted`, `notifyErrors`, `notifyMaxTokens`, `notifyQuestions`, `notifyApprovals`, `minTurnDurationMs`, `maxBodyChars`, `includeMetadata`, `includeUserPrompt`, `includeFooter`, `queueSize`, `retryAttempts`, `retryBaseDelayMs`, `maxDedupeEntries`.

**The Web card's 23 field controls** are the same names in render order (`src/client/fields.ts:60-247`, `ALL_FIELDS:240-247`; verified programmatically: 23 unique `field:` literals). The count equality is a **key-set invariant**, not a tally: `tests/client/config-surface.test.ts:86-119` `PAR-01`/`PAR-02` derives the Host set from `Config.toJSON()` via `tests/support/host-fields.ts:56-70` and compares both directions including duplicates; a bare count was explicitly rejected after a retracted v0.4.0 conclusion (file header `:1-33`).

**The 1 extra control** is a password **value**, not a Config field:

| Item | Evidence | Notes |
| --- | --- | --- |
| `smtpPasswordSecret` write-only control | rendered by `SecretControl` (`src/client/Card.tsx:350-390`; `type="password"`, `name="smtpPasswordSecret"` at `:365-366`); state `SecretState` (`src/client/controller.ts:64-74`); drafts at `:272-276`; write `setCredential` on Save (`:327-339`); removal `clearCredential` `:393-410` | NOT in `ALL_FIELDS` (`src/client/fields.ts:240-247` — the only credential-named entry is `smtpPasswordCredential`, the *reference* field at `:166-171`); deliberately absent so Reset All cannot stage an unset the Host would refuse |
| Count assertions | `PAR-04` (`tests/client/config-surface.test.ts:131-143`): `smtpPasswordSecret` is in neither Host nor `ALL_FIELDS`; `PAR-05` (`:145-169`): exactly 23 Config controls + exactly one password input = 24 labelled controls, counted **separately** | `V0.5.0_COMPAT_REPORT.md:352-400` records the browser E2E as `23/23` Config labels + `1/1` credential label, explicitly never a bare 24 |
| Browser E2E expected lists | `scripts/probe/browser-e2e.mjs:79-122` (`EXPECTED_CONFIG_FIELD_LABELS` 23, `EXPECTED_CREDENTIAL_CONTROL_LABELS = ['Set password']`), assertion `:318-346` | Rendering evidence with the card's own labels; complementary to `PAR-01`'s table comparison |

**Settings/form surfaces used by the card** (client program):

| # | Surface | PLUGIN_USAGE evidence | Expectation | Why it matters |
| --- | --- | --- | --- | --- |
| H1 | `ctx.configForms.get(entryId)` | `src/client/controller.ts:173-179` (`entryId` = `SETTINGS_NAMESPACE` `dsh-mail-notify`, `src/protocol.ts:53`) | Returns a `ConfigForm<Section>` for the profile entry; addressable because an entry id *is* the namespace | Card reads nothing if the address changes |
| H2 | `ConfigFormSnapshot` fields | `src/client/controller.ts:474-506` (`status`, `value`, `base`, `user`, `revision`, `writable`, `mode`); compile-time pin `tests/compatibility/contracts.compile.ts:55-80` | `value` is the composed section; `user` presence marks overridden; `revision` fences writes; `writable` gates controls; `status==='unavailable'` hides the card | A renamed snapshot member is a compile error after a dep bump; a behavior change (e.g. `user` no longer raw layer) changes override semantics |
| H3 | `form.mutate(ops, revision)` | `src/client/controller.ts:306-325`; `SettingsPathOpView` from `@deepseek-ai/dsh-api-remotes/client` (`:25`); compile pin `tests/compatibility/contracts.compile.ts:70-75` | One atomic namespace mutation; stale revision rejected | Save path; the revision fence is what prevents two surfaces overwriting each other |
| H4 | `form.subscribe` / `form.getSnapshot` | `src/client/controller.ts:181-186,475` | Host document changes re-render; staged drafts survive external writes | Multi-surface consistency |
| H5 | `ctx.configForms.whileServed([ns], cb)` | `src/client/index.tsx:75` | Contribution exists only while the Host serves the entry | A disabled/uncomposed row shows no empty card |
| H6 | `ctx.slots.inject` + `ctx.slots.register` into `plugins.bundle.config` keyed by **package** name, with `locale` namespace | `src/client/index.tsx:76-94`; `BUNDLE_CONFIG_SLOT`/`MAIL_NOTIFY_PACKAGE_NAME` `src/client/contracts.ts:114,125`; compile pin `tests/compatibility/contracts.compile.ts:84-98` | Keyed slot resolved by the Plugins page with `entryKey: pkg.name`; page renders `view:'page'` only | A slot rename/key-resolution change makes the card unreachable |
| H7 | `ctx.locale.register(ns, dictionaries)` | `src/client/index.tsx:73`; `src/client/locale.ts` | Dictionary namespace declared on the slot entry; live locale switch re-renders without reload (`tests/client/locale.test.ts:182-201`) | UI copy; failure degrades to raw keys or no card |
| H8 | `ctx.remote.credentials.{describe,set,unset}`, `$on('credentials/reference-updated')` | `src/client/wire.ts:189-247`; invalidation subscription `src/client/controller.ts:187-190`; compile pin `tests/compatibility/contracts.compile.ts:137-148` | Write-only namespace; no read path exists; event carries the reference, never a value | Password management and cross-tab invalidation |
| H9 | `ctx.connection` (browser member) | declared **by the plugin** at `src/client/contracts.ts:98-103` as `ConnectionHandle` from `@deepseek-ai/dsh-client-connection/client`; used at `src/client/wire.ts:151`; compile pin `tests/compatibility/contracts.compile.ts:161-165` | `connection.rpc.call('/api', endpoint, {}, signal)` returns an envelope | Because the client-side augmentation is the plugin's own, a change to *which entry declares it* is invisible to `tsc` (`V0.5.0_COMPAT_REPORT.md:582-588` records the same caveat) |

### 1.9 Connection surface: exact Fetch routes, envelope, status RPC, Test Email, Save

| # | Surface | PLUGIN_USAGE evidence | Expectation | Why it matters |
| --- | --- | --- | --- | --- |
| I1 | `connection.fetch.register(route)` | `src/index.ts:318-335` — scoped `ctx.inject(['connection'])`, one `connectionCtx.effect` registering two routes with `{ path, methods: ['POST'], requestBody: 'buffered', fetch: handler }` (`:321-328`) | Exact routes under the shared `/api` channel are consulted before the single-occupant interceptor; the route inherits `/api`'s Host/Origin trust fence and browser-session auth (`src/protocol.ts:8-31`; `src/web-rpc.ts:1-18`) | The only plugin-hosted HTTP surface. A signature/route-semantics change breaks status + Test Email (Save is unaffected — it uses host Remotes) |
| I2 | Route paths | `STATUS_ROUTE = /api/dsh-mail-notify/status`, `TEST_EMAIL_ROUTE = /api/dsh-mail-notify/test-email` (`src/protocol.ts:56-73`); channel `/api` `:35`; namespace `dsh-mail-notify` `:56` | Channel-relative endpoint segments match `[A-Za-z0-9_$.-]+` (`:59-63`) | If 0.2.1 changes channel-relative path rules or the auth fence, the card's two calls fail |
| I3 | `connection.rpc.call(channel, endpoint, payload, signal)` (browser) | `src/client/wire.ts:141-155`; compile pin `tests/compatibility/contracts.compile.ts:161-165` | Generic logical RPC caller; both halves must agree on channel/endpoint strings | A call-signature or channel change breaks status/Test Email |
| I4 | RPC envelope codec (hand-implemented) | `src/web-rpc.ts:20-122`: request `{type:'client-request', rpcId, method, payload}` (`:51-58`), response `{type:'server-response', rpcId, result:{ok:true,value}|{ok:false,error:{code,message,details}}}` (`:80-85`); transport faults 404/415/400 (`:103-122`); HTTP always 200 for endpoint outcomes (`:72-80`) | Connection's own `rpcFetchHandler` codec, reproduced because an exact route bypasses it. Browser caller validates `type`, `rpcId`, `result.ok`, failure `code`/`message`/`details` before accepting (`src/client/wire.ts:126-139`) | Any envelope-literal change in 0.2.1 is a **transport failure**, not an endpoint refusal — the card shows "the host returned no decodable response" |
| I5 | Status RPC | host: `dispatch(STATUS_ENDPOINT)` → `status()` (`src/index.ts:290-292,261-280`); client: `readRuntimeStatus` (`src/client/wire.ts:164-166`), polled every 5 s while the card is visible (`src/client/Card.tsx:57-64,421-429`) | Status facts: `active`, `smtpConfigured`, `credentialRef` (a name, never a value), optional `queue{depth,size,delivered,failed}`, optional `configError` (`src/protocol.ts:75-110`) | The card's only live view of the running plugin |
| I6 | Test Email | host: `dispatch(TEST_EMAIL_ENDPOINT)` → `sendTestEmail` (`src/index.ts:293-302`); path itself `src/test-email.ts:52-116` (fixed subject `:25`, body `:39-50`, delivery through the same `Deliverer` the notifications use `src/mailer.ts:91-159`); client: `requestTestEmail` (`src/client/wire.ts:175-177`), button `src/client/Card.tsx:566-578` | A real SMTP delivery through the effective config; response is `{delivered, recipientCount, category?, message?}` (no config echo, no credential) (`src/protocol.ts:112-129`) | End-to-end proof that credential + transport + config work; breaks if either the route or the envelope changes |
| I7 | Save (config persistence) — **not** a plugin route | browser: `form.mutate(ops, revision)` (`src/client/controller.ts:306-325`) + password `remote.credentials.set` (`:327-339`); host: `SettingsForms.update/mutate → ConfigEditor.edit → cordis resolveConfig → plugin Config` (`scripts/probe-host-config-write.mjs:1-58,424-463`); Standard-Schema boundary pinned by `scripts/probe/config-check-probe.mjs:1-72` | A refused save raises, leaves the patch byte-identical, does not advance the revision, and does not move the running runtime | Save failure is a *host settings* regression, not a connection-route regression; the two failure domains must be diagnosed separately |

### 1.10 Client-side imports/peers that must match the host release

The client bundle is one self-contained classic script; everything it says about DSH beyond React is a **type-only** import erased at build time (`src/client/index.tsx:1-10`; `package.json:13-16` selects `lib/client.js`). At runtime it requires exactly `react` and `react/jsx-runtime`, both supplied by the shell's seed table.

| # | Surface | PLUGIN_USAGE evidence | Must match host because |
| --- | --- | --- | --- |
| J1 | Six augmentation/import packages (type-only) | `src/client/contracts.ts:49-81`: `@deepseek-ai/dsh-client-ui-renderer/client`, `dsh-client-ui-slots`, `dsh-client-ui-settings/client`, `dsh-client-ui-plugin-manager/client`, `dsh-api-remotes/client`, `dsh-api-settings-controller/remote`, `dsh-client-locale/client`, plus `dsh-client-connection/client` (`ConnectionHandle`) and type imports of `PluginConfigViewProps`, `ConfigForm`, `ConfigFormSnapshot` | A moved/renamed entry point fails `tsc` after a dev-dependency bump; a type-only change that keeps the name but changes semantics is caught only by the browser run |
| J2 | Same packages as exact devDependencies | `package.json:94-101`: `dsh-api-remotes`, `dsh-api-settings-controller`, `dsh-client-connection`, `dsh-client-locale`, `dsh-client-ui-plugin-manager`, `dsh-client-ui-renderer`, `dsh-client-ui-settings`, `dsh-client-ui-slots` — all `0.2.0-rc.2` | The compile probe can only assert against the release installed; these must be `0.2.1-rc.2` to make the probe a statement about the target |
| J3 | Runtime client service requirements | `src/client/index.tsx:57`: `['slots', 'configForms', 'connection', 'remote', 'remote.credentials', 'locale']` | If 0.2.1 renames/re-scopes one service, the browser plugin's `inject` never satisfies ⇒ **card silently never applies** (no visible error on the page; loader-side log only) |
| J4 | Two-program split | `tsconfig.client.json:15-28`; `tsconfig.test.json:14-24`; reason `scripts/type-probes/host-contracts.compile.ts:1-15`, `tests/compatibility/contracts.compile.ts:14-21` | A future contract that stops the two entries disagreeing could allow merging; until then both probes must stay in separate programs |
| J5 | Host-client parity of the slot contract | `tests/compatibility/contracts.compile.ts:84-98` asserts `plugins.bundle.config` is a `SlotMap` entry and `PluginConfigViewProps` shape; `:100-127` asserts the owner-supplied `form` prop stays optional and the card does not rely on it | A page-contract change that supplies `form` differently, or drops the slot, is caught statically (slot) or by the browser run (rendering) |

### 1.11 Manifest/bundle metadata the host consumes

| # | Surface | PLUGIN_USAGE evidence | Expectation |
| --- | --- | --- | --- |
| K1 | Package entry points | `package.json:6-18` (`.` → `lib/index.js` + types; `./client` → `lib/client.js`; `./package.json`) | Loader imports the host entry; web boot loads the client entry |
| K2 | Bundle patch | `package.json:19-22`; `cordis.patch.yml:1-20` | `insert:` one row `{id, name, config:{enabled:false}}`; the row is inert by default and the config patch replaces the whole `config` (comment `:8-11`) |
| K3 | Client declaration | `package.json:23-34` | `platform:'web'` + six inject names |
| K4 | Published file list | `package.json:35-40` (`lib`, `cordis.patch.yml`, `README.md`, `LICENSE`) | The build output and the patch row must be in the archive; asserted by `tests/package/tarball.test.ts` |
| K5 | Node engine | `package.json:41-43` (`^22.19.0 || >=24.0.0`); **no `engines.dsh`** | `engines.dsh` is not part of the recorded 0.2.0 gate; adding it would not help and could be misleading unless 0.2.1's gate reads it |
| K6 | Package identity | `tests/package/tarball.test.ts:107-142` asserts the exact `dsh` block (bundle patch path, client platform, the six inject names) from the packed archive | An edit to `package.json`'s `dsh` block without updating this test fails the suite; a host-side package rename requires both |

---

## 2. Lifecycle / hot-reload audit

### 2.1 Start path (one `apply`, three listeners, two routes)

`apply` runs in this order (`src/index.ts:171-360`):

1. **Read the optional timer first**, before anything is built — so its disposers attach to the plugin fiber and an in-progress backoff is cancelled on unload (`:172-175`; `readTimerService` `:579-589`).
2. Build the logger (`:176`).
3. `bindVolatileConfig(ctx, config)` (`:177`) — registers the `loader/volatile-update` listener on the plugin fiber (`src/settings.ts:133-167`). **This registration exists even when the plugin is disabled**, because it is the only way a later enable can take effect without a restart (asserted `tests/integration/lifecycle.test.ts:64-76`).
4. `sync()` (`:196-234`, first call `:236`): resolve config → structural fingerprint compare → (a) disabled: release and log `plugin.disabled` (`:201-212`); (b) invalid: **refuse to mount but keep any previous runtime**, log `plugin.config-invalid` (`:214-224`); (c) valid: release old and mount (`:226-233`).
5. `binding.subscribe(sync)` (`:240`).
6. Publish the two exact Fetch routes in a scoped `ctx.inject(['connection'])` + `ctx.effect` (`:318-335`) — **registered regardless of `enabled`**, so the card can always read status.
7. Register the plugin teardown effect (`:337-343`).
8. Return the test/live surface (`status`, `sendTestEmail`) if a runtime mounted, else `undefined` (`:345-360`).

`startRuntime` (`:380-528`) builds: sink (production default = mailer; injected sink/debug sink only for tests, `:387-400`), bounded single-worker queue (`:402-429`; sleep uses the Cordis timer when present `:406`), dedupe cache (`:431`), session handlers (`:433-439`), then registers:
* `ctx.on('session/event', turn listener)` (`:441-444`),
* `ctx.on('session/disposed', …)` (`:446-448`),
* `ctx.on('session/event', approval listener)` (`:463-469`),
and logs `plugin.ready` with a projection of the effective config that carries no secret (`:471-493`).

### 2.2 Listener registration/disposal and duplicate-listener risk

| Question | Answer (evidence) |
| --- | --- |
| How many listeners? | Exactly three: two on `session/event`, one on `session/disposed`. Asserted exactly, including the absence of any per-turn top-level listener: `tests/integration/lifecycle.test.ts:47-62` (`ADP-06`); when disabled only `loader/volatile-update` remains: `:64-76` (`SUP-05`), `:78-82`; a missing credential service changes nothing: `:84-92`. |
| Disposal order | `handlers.clear()` → `dedupe.clear()` → remove three listeners → `queue.dispose()`; idempotent via a `released` flag (`src/index.ts:510-527`). The comment states the order: no further job can be produced, then listeners go, then the queue settles and state is released (`:517-519`). |
| Binding disposal | `unsubscribe()` then `release(mounted)` in the plugin teardown effect (`src/index.ts:337-343`); the config binding's own listener is removed with the fiber (`tests/unit/settings.test.ts:160-171` `CFG-09`). |
| Remount (live config change) | Old runtime released **before** the new one starts, listeners removed synchronously (`src/index.ts:226-233`). The release promise is deliberately not awaited (`void release`), so a config commit is never blocked by an in-flight SMTP send; the old queue's already-dequeued job may finish, and its pending jobs are dropped. **No listener can be duplicated by this path.** |
| Routes on remount | Registered once per `apply`, outside `startRuntime` — so a config remount does **not** re-register routes, and unload removes them via the `ctx.effect` disposer (`src/index.ts:318-335`). |
| Browser half | One effect owns the locale registration, the `MailNotifyCard` controller (form subscription + credential-invalidation subscription), and the slot contribution; disposer order is unregister slot → unregister dictionaries → `card.dispose()` (`src/client/index.tsx:72-101`; controller dispose `src/client/controller.ts:213-217`). |
| Residual risk | There is **no module-level re-entry guard**. Safety depends entirely on Cordis' contract that a fiber's `apply` runs once and that disposing a fiber removes its registrations. If `0.2.1` hot-reload semantics re-apply a plugin on the *same* fiber without disposing (or re-use a disposed fiber), listeners and queue would duplicate and each settled turn would be mailed twice. There is no test for that scenario (§2.8). |

### 2.3 Timers / queues / transports

| Resource | Lifecycle | Evidence |
| --- | --- | --- |
| Queue | Bounded FIFO, single worker; `enqueue` is synchronous and returns `boolean`; the newest job is refused at capacity and counted/logged; `dispose` refuses new jobs, clears pending, lets the in-flight job finish | `src/queue.ts:85-217`; `tests/integration/queue.test.ts:46-337` (`QUE-01…07`, retry rows); `tests/integration/lifecycle.test.ts:301-367` (`E2E-08`, refused-enqueue-leaves-key) |
| Backoff timer | Uses `timer.timeout` when the service exists (cancelled with the fiber), else a `setTimeout` macrotask; a dispose during a backoff ends the wait and settles the job as `disposed` | `src/index.ts:406`; `src/queue.ts:69-77,128-144`; tests `queue.test.ts:288-310` (`RET-11`), `lifecycle.test.ts:594-632` (injected wait + a real timer-service test asserting `[1000, 3000, 9000]`) |
| Transport | **A fresh Nodemailer transport per send attempt**, built after the credential is resolved inside that attempt; never pooled or cached; TLS verification cannot be disabled (no `tls`/`rejectUnauthorized` key anywhere) | `src/mailer.ts:101-159`; `src/transport.ts:39-68`; tests `mailer.test.ts:176-216` (`SEC-02`, `SEC-02b`), `:375-408` (`SEC-06`) |
| Credential lifetime | Resolved per attempt and handed straight to the transport; no long-lived object holds the secret; a rotated value reaches the next attempt | `src/mailer.ts:1-16,112-135`; `mailer.test.ts:141-198` (`SEC-09`, `SEC-02`) |
| In-memory state | Per-session/per-turn maps released at settlement, `session/disposed`, and plugin dispose; dedupe capped; held prompt TTL | `src/turn-state.ts:26-153`; `src/event-handler.ts:148,171,211,625-631,798-808`; tests `lifecycle.test.ts:435-592` (`LIFE-01…07`), `:514-534` (300 sessions → baseline) |
| Disk state | **None.** The plugin writes no file: no config, no queue, no domain storage, no session data. The only persistence is the host profile patch (host-owned) and the host credential store (host-owned) | `src/**` contains no `writeFile`/`Storage`/domain usage; `tests/package/tarball.test.ts:227-231` excludes `.dsh` session data from the archive |

### 2.4 Duplicate-send guards (and where they stop)

| Guard | Behavior | Evidence |
| --- | --- | --- |
| Per-turn key `turn:<sessionId>:<turn>` | Marked **only after** the queue accepts the job; a refused enqueue leaves no mark so the turn stays eligible | `src/notifier.ts:43-52,95-111`; `src/event-handler.ts:506-531,635-657`; tests `lifecycle.test.ts:335-367` |
| Repeated `turn/end` | The second settlement is suppressed as `duplicate` and reported; exactly one mail | `tests/integration/lifecycle.test.ts:219-240` (`E2E-05`) |
| Question key `question:<sessionId>:<callId>` | Per durable call id (fallback `(turn,step)`); a replayed append is one interaction | `src/notifier.ts:54-72`; `tests/integration/timed-question.test.ts:280-310` (`TQ-07`), `:312-340` (`TQ-08`) |
| Approval key `approval:<sessionId>:<id>` | Service-issued `ApprovalRequestId`, fallback `tool:<toolName>`; a replayed audit record is one mail | `src/notifier.ts:74-83`; `src/event-handler.ts:768-796`; probe `approvals-duplicate` (`V0.5.0_COMPAT_REPORT.md:438-444`) |
| Namespace separation | Three independent namespaces so a question cannot consume its turn's key | `src/notifier.ts:28-33`; `TQ-01` (`timed-question.test.ts:115-138`) |
| Bound | Insertion-ordered eviction at `maxDedupeEntries`; keys are **process-lifetime only** — nothing persisted (documented decision D008) | `src/notifier.ts:17-27,104-111`; `tests/integration/lifecycle.test.ts:569-581` (`LIFE-06b`) |
| **Gap** | A config remount/unload clears the cache (`src/index.ts:521`), so a *replayed* event after a remount can legally produce a second mail; and a config save mid-turn clears turn state, so a later `turn/end` builds an empty candidate and is suppressed for no visible text (a lost mail, not a duplicate) | `src/index.ts:196-240,510-527`; `docs/DSH_INTEGRATION.md:249-257` records the duplicate-`turn/end` observation |

### 2.5 Configuration persistence and remount

* The plugin **never writes configuration**. The Web card stages drafts (staged map + separate secret draft, `src/client/controller.ts:137-138,224-276`); Save performs one atomic `form.mutate(ops, revision)` and then, if a password draft exists, `remote.credentials.set` under the reference the section now names — section first, secret second, because the secret is addressed by the reference (`src/client/controller.ts:278-353`).
* The Host persists through its own editor; a refused write raises before touching `cordis.patch.yml`, leaves the file byte-identical, does not advance the settings revision and does not move the running runtime — proven by the real write-path probe (`scripts/probe-host-config-write.mjs:416-463`, recorded `V0.5.0_COMPAT_REPORT.md:243-276`).
* On a committed volatile change the Loader updates references in place and emits `loader/volatile-update`; the plugin re-reads the whole config and remounts or stands down (`src/index.ts:196-240`). An invalid edit cannot replace a working runtime (`:214-224`), and the refusal is reported to the card through `status().configError` (`:278`; `src/protocol.ts:102-109`).
* The profile patch outlives disable/enable and uninstall/reinstall; the plugin holds no copy.

### 2.6 Uninstall + re-enable

| Action | What happens |
| --- | --- |
| Disable (`enabled:false`) via live config | `sync()` short-circuits before any resource exists: releases the mounted runtime, no session listener, no queue, no timer use, no credential read; logs `plugin.disabled` (`src/index.ts:201-212`; asserted `tests/integration/lifecycle.test.ts:64-76`). The config listener and the two routes remain, by design. |
| Re-enable (`enabled:true`) | The next `loader/volatile-update` re-reads, mounts a fresh runtime, logs `plugin.ready` (`src/index.ts:226-233,471-493`). Dedupe and turn state start empty (D008). |
| Uninstall (fiber dispose) | Binding listener removed with the fiber; `ctx.effect` teardown unsubscribes and releases the runtime (`src/index.ts:337-343`); route effect disposes both routes (`:319-334`); client effect disposes slot contribution, locale dictionaries and controller (`src/client/index.tsx:96-100`). No on-disk state to clean. |
| Re-install | A fresh `apply` on a new fiber; config comes from the profile patch; credentials from the host store. No plugin-owned migration needed. |
| Upgrade / hot-reload of the package | Same as uninstall + install for plugin state. The risk is not the plugin's teardown (all registrations are fiber-owned) but whether the host disposes the old fiber before applying the new module — §4 R2. |

### 2.7 Test evidence inventory (what is proven, and where)

| Lifecycle claim | Test evidence |
| --- | --- |
| Exact listener set, no per-turn top-level listeners | `tests/integration/lifecycle.test.ts:47-62` |
| Disabled ⇒ no runtime, no session listener, inert emits | `:64-76` |
| Invalid config ⇒ refuses to mount, no session listener | `:78-82` |
| Missing credential service does not block activation | `:84-92` |
| One turn ⇒ one job with schema-v2 telemetry | `:96-122` |
| Repeated `turn/end` ⇒ one mail, duplicate reported | `:219-240` |
| Listener returns `undefined`, no rejection escapes | `:267-299` |
| Full queue synchronous refusal, counted and logged | `:301-333` |
| Refused enqueue leaves the turn eligible (no dedupe spend) | `:335-367` |
| Turn state released at settlement / session dispose / plugin dispose | `:435-501`, `:583-592` |
| Disposed plugin inert; no work scheduled after unload | `:503-512` |
| Long run returns maps to baseline; dedupe bounded | `:514-534`, `:569-581` |
| Queue: FIFO, concurrency 1, capacity refusal, sink throw containment, dispose semantics, no unhandled rejections, backoff policy, dispose-during-backoff | `tests/integration/queue.test.ts:46-337` |
| Per-attempt credential lookup and rotation | `tests/integration/mailer.test.ts:141-198` |
| Credential missing / provider absent / provider throws are permanent + named | `:218-273`; `tests/integration/credential-contract.test.ts` |
| Password never in logs/jobs/rendered mail | `:275-373`; `lifecycle.test.ts:413-431` |
| TLS verification cannot be disabled | `:375-408` |
| Client effect disposal / controller disposal / unmount semantics | `tests/client/disclosure.test.ts:307-343`; `tests/client/locale.test.ts:182-280`; `tests/client/config-surface.test.ts:42-50` |

### 2.8 Gaps: lifecycle behavior with **no** automated test

These are real gaps in evidence, not necessarily defects. Each is a candidate test to add before or with the `0.2.1` claim.

1. **`apply.sync()` remount is never driven by an automated test.** The harness seam exists — `reconfigure(next)` in `tests/support/plugin-harness.ts:108,176-180` (it re-resolves through the real `Config`, copies changed volatile references via the `cosmokit.volatile.write` symbol, and emits `loader/volatile-update`) — but **no test file calls it** (grep: only the definition). Unit tests cover the binding signal (`tests/unit/settings.test.ts:106-171`); the real-assembly probe `scripts/probe-live-policy.mjs` covers one direction (switch off→on) but is not part of `npm test`. Missing assertions: listener set unchanged after remount; old runtime released exactly once; valid→invalid edit keeps the old runtime; invalid→valid recovers; disable→enable; remount generates no duplicate mail for the same turn.
2. **No test asserts listener count after unload + re-enable** (only before first mount).
3. **No test for duplicate-send absence across a remount or an upgrade** (e.g., a replayed `turn/end` after a remount). The documented D008 limitation means a duplicate is *possible*; that should be pinned as an explicit expected-behavior test rather than left implicit.
4. **No test for pending-job loss on remount**: `sync()` releases the queue (dropping pending jobs) with no counter/log, unlike capacity refusal. Whether that is acceptable should be an explicit decision/test.
5. **No integration test for the `connection.fetch.register` route lifecycle** (registration, exact-route dispatch, disposal on unload). `tests/unit/web-rpc.test.ts` exercises the envelope only; the routes are exercised only by the browser E2E probe.
6. **No test for the timer-service-absent path** (`readTimerService` fallback to `setTimeout`); only the present-service path has a test.
7. **No test for the client plugin's `apply` effect** (slot contribution removal on dispose). Client tests dispose the controller manually.
8. **No test binds the peer declarations to the validated host baseline.** `tests/package/tarball.test.ts` asserts the manifest's `dsh` block and the single runtime dependency but not the DSH peer versions, so a stale peer can survive a source-level "migration" and only the host gate would notice.

---

## 3. Metadata gate audit

### 3.1 The recorded gate mechanism, and why `0.2.1-rc.2` blocks the published package

The repo records the DSH 0.2.0-rc.2 admission rule as: **before a profile imports a plugin, DSH compares the plugin's `peerDependencies` on `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` against the single runtime version returned by `getDshRuntimeVersion()`; every declared range must match; prereleases participate; missing DSH peers impose no constraint; invalid ranges are incompatible; and the check uses peer declarations, not `engines.dsh`.** Source: the rule text quoted from the installed `dsh-app-boot/README.md` in `V0.5.0_COMPAT_REPORT.md:23-43`, restated with consequences in `docs/DECISIONS.md:1332-1339` (D022). It was then *observed* live: v0.4.0 (peers `0.1.7-rc.2`) refused by DSH `0.2.0-rc.2`, and v0.5.0 (peers `0.2.0-rc.2`) installed with no exemption (`V0.5.0_COMPAT_REPORT.md:107-147`).

Consequences for the candidate target, stated as expectations to be *measured* by `C4-A`, not as facts about 0.2.1:

* `v0.5.0` as published declares peers `@deepseek-ai/dsh-credentials@0.2.0-rc.2` and `@deepseek-ai/dsh-session@0.2.0-rc.2` (`package.json:79-80`). Under the recorded rule, a `0.2.1-rc.2` runtime does **not** satisfy either range ⇒ installation is expected to be **refused**, naming both peers. This is the same class of result as §4.1 of the v0.5.0 report.
* **Do not widen these ranges** to admit both releases. The recorded rule matches one exact runtime version; a range admitting `0.2.0-rc.2` and `0.2.1-rc.2` would not be refused — it would be accepted, silently loading a plugin whose "verified" status is only `0.2.0-rc.2` (`docs/DECISIONS.md:1339`; `V0.5.0_COMPAT_REPORT.md:100-105`).
* Whether the **0.2.1** gate still reads only peers (and not `engines.dsh`, or a manifest field added since) is **not established by this audit**; it is exactly what `C1-A`'s gate-source comparison must verify. If the rule changed, this section's "must change" set changes with it.
* Runtime probing of the *unmodified* published artifact on `0.2.1-rc.2` therefore requires an exemption (`allow-version`/`--accept-risk`) and would not be admissible evidence; the candidate build must bump the metadata first (task constraint: no exemptions).

### 3.2 Inventory of weight-bearing metadata (grep-verified)

Grep basis: `0\.2\.0-rc\.2` and `deepseek-ai` across tracked text files, excluding `node_modules/`, `.git/`, `tmp/`, `.jspace/` and the build-output `lib/`; plus `0\.1\.[0-9]` for stale historical comments. Raw counts are reproduced in Appendix A.

#### A. MUST CHANGE for an honest `0.2.1-rc.2` candidate

| # | Location | Current | Required change | Gate-bearing? |
| --- | --- | --- | --- | --- |
| M1 | `package.json:79` | peer `@deepseek-ai/dsh-credentials: "0.2.0-rc.2"` | `"0.2.1-rc.2"` (exact; do not widen) | **YES — install gate** |
| M2 | `package.json:80` | peer `@deepseek-ai/dsh-session: "0.2.0-rc.2"` | `"0.2.1-rc.2"` (exact) | **YES — install gate** |
| M3 | `package.json:94-108` | 15 `@deepseek-ai/dsh-*` devDependencies at `0.2.0-rc.2`: `dsh-api-remotes`, `dsh-api-settings-controller`, `dsh-client-connection`, `dsh-client-locale`, `dsh-client-ui-plugin-manager`, `dsh-client-ui-renderer`, `dsh-client-ui-settings`, `dsh-client-ui-slots`, `dsh-credentials`, `dsh-llm`, `dsh-llm-retry`, `dsh-session`, `dsh-settings`, `dsh-user-approval`, `dsh-user-questions` | `0.2.1-rc.2` for all of them, so the compile probes assert against the target typings | No (but required for evidence; `npm run typecheck` is the loud gate) |
| M4 | `package-lock.json` root `packages[""]` | `.devDependencies` (15) and `.peerDependencies` (2) mirror the `0.2.0-rc.2` values; 38 `node_modules/@deepseek-ai/dsh-*` lock entries carry `version: 0.2.0-rc.2` (plus the root entry, which carries the same strings in its peer/dev maps; 0 non-DSH package entries carry the version) | Regenerate by installing the target dependency set; **never hand-edit** the lockfile | Indirect (npm/pnpm resolution of peers); the lock is not read by the gate |
| M5 | `README.md:10,13-18,20-23,25-36,589` | "Requires DSH `0.2.0-rc.2`"; verified-version table with a single `0.2.0-rc.2` row; "only release claimed"; troubleshooting "check that DSH is `0.2.0-rc.2`" | Update to state the new claim (or keep the 0.2.0 claim *and* add the 0.2.1 claim as a separate verified row), and update the evidence sentence. This is a truthfulness requirement for the deliverable, not a build gate | No (but a false claim in the shipped README is a release-quality defect) |
| M6 | `00_MASTER.md:57` (Phase 11 row) and `:59` (present-tense baseline) | "current DSH compatibility baseline is **0.2.0-rc.2** (v0.5.0)" | Append a new phase row for the 0.2.1 work and update the *present-tense* baseline line. **Do not rewrite the Phase 11 row** — it is the historical record of the v0.5.0 phase | No |
| M7 | `docs/DSH_INTEGRATION.md:8-16` (verified-against table) | Says `0.1.7-rc.2` — already stale for v0.5.0 | Update to the new target when the claim is made; add the new evidence class rather than overwriting history (the doc itself is a "current dependency surface" doc, not a historical report) | No |
| M8 | Current-target comments in source/probes: `src/client/contracts.ts:13-14,25,35,43`; `src/config.ts:56`; `src/config-check.ts:38`; `scripts/type-probes/host-contracts.compile.ts:18,223,338`; `scripts/probe/config-check-probe.mjs:3`; `scripts/probe/schema-probe.mjs:3`; `scripts/probe/volatile-shape-probe.mjs:3`; `scripts/probe-e2e.mjs:249`; `scripts/probe-host-config-write.mjs:247,386` | Statements of the form "the installed DSH 0.2.0-rc.2 ships X" | Restate against the target release, or reword as "the release this probe was last verified against". No executable behavior changes | No |
| M9 | Stale version comments **not** about the current target: `tsconfig.client.json:9` ("pinned to an exact `0.1.5-rc.2`"); `tests/client/support/seat.ts:15`; `tests/client/locale.test.ts:19` (both `@deepseek-ai/dsh-client-locale@0.1.5-rc.2`); `tests/fixtures/runtime-shapes.ts:11` ("exactly six reason kinds" — seven since 0.1.7), `:74` (`version: 3` in the fixture header, while the compile probe asserts host format 4) | Correct while touching these files; `version: 3` is unread by the plugin so it is not a behavioral defect, but the fixture claims to mirror the runtime | No |

#### B. MUST NOT REWRITE — historical evidence/release artifacts

| Location | Reason |
| --- | --- |
| `V0.5.0_COMPAT_REPORT.md` (40 occurrences of `0.2.0-rc.2`) | The v0.5.0 result against `0.2.0-rc.2`; it is the evidence for the previous claim, not a current statement |
| `RELEASE_V0.5.0.md` (8), `RELEASE_NOTES_V0.5.0.md` (6) | Release report and published release notes — published text must remain byte-faithful to what was released |
| `docs/DECISIONS.md:1326-1386` (D022) | Historical decision record. A `0.2.1` migration must **supersede** it with a new decision entry, not edit it |
| `00_MASTER.md` Phase 8/9/11 rows | Phase ledger; append-only |
| All earlier reports/notes (`V0.4.0_COMPAT_REPORT.md`, `RELEASE_V0.1.x/0.2.0/0.4.0.md`, `PHASE*_REPORT.md`, `BLOCKERS_V0.3.0.md`, `CLIENT_RUNTIME_RESOLUTION.md`, `MIMO_V2_6_PRO_EVAL.md`) | Historical records; the `0.1.x`/`0.2.0` strings in them are facts about past work |
| `lib/**` | Build output; gitignored (0 tracked files, `.gitignore:7`), regenerated by `npm run build`. It carries the same comments via `.d.ts` but must not be hand-edited |
| `docs/RELEASE.md` `0.2.0` rows | Those are **plugin** release versions, not DSH versions; no change needed |

#### C. No DSH version is asserted in tests/scripts (grep-verified)

* `tests/` contains **zero** occurrences of `0.2.0-rc.2`. No test asserts a DSH version string. The closest things are contract pins: `SESSION_FORMAT_VERSION_IS_FOUR: 4` (`scripts/type-probes/host-contracts.compile.ts:233`), the session vocabulary assertions (`:246-449`), and `Config['~standard'].version === 1` (`tests/unit/config-check.test.ts:102`, the Standard Schema version, not DSH).
* `scripts/` has no hardcoded version **assertion**: probe scripts read the installed version dynamically (`scripts/probe/dsh-modules.mjs:85-96`; `scripts/probe-host-config-write.mjs:80`) and the `0.2.0-rc.2` mentions are comments only (M8).
* `tests/package/tarball.test.ts:107-142` asserts the **shape** of the `dsh` manifest block and the six client inject names — no versions. It must change only if a host-side package rename changes those names.
* No version appears in `cordis.patch.yml`, `.env.example`, `tsconfig*.json` (beyond comments), or `tsdown.config.ts`.

**Bottom line for §3:** exactly **two** declarations gate installation — the two DSH peers in `package.json`. Everything else in group A is required for an honest, evidence-backed candidate (devDeps for the compile probes, lockfile resolution, README/docs claims, stale comments). Nothing in group B may be rewritten.

---

## 4. Ranked candidate runtime-incompatibility suspects

Ranked by (probability of being hit) × (silent damage if hit). `R1` is a *pre-runtime* gate blocker and is stated first because nothing else can be measured until it is handled. All runtime suspects are **unverified hypotheses**; the host-side diff (`C1-A`) and isolated host (`C4-A`) are the authoritative checks. Each row names a concrete confirm/refute method.

### R1 — Install gate rejects the unmodified package on `0.2.1-rc.2` (pre-runtime; **definite** under the recorded rule)

* **Reasoning:** peers are exact `0.2.0-rc.2` (`package.json:79-80`); the recorded gate matches every `@deepseek-ai/dsh*` peer against the single runtime version (`V0.5.0_COMPAT_REPORT.md:23-43`; `docs/DECISIONS.md:1332-1339`). Under that rule, `0.2.1-rc.2` cannot satisfy them, so `dsh plugin add dsh-mail-notify-0.5.0.tgz` is expected to be refused with the two peers named — same class as §4.1 of the v0.5.0 report.
* **Plugin refs:** `package.json:77-83`, `:94-108`; `package-lock.json` root; no `engines.dsh`.
* **Confirm/refute:** `C4-A` runs the real plugin manager against `0.2.1-rc.2` with a fresh isolated `DSH_HOME` and the **published** `0.5.0` tarball (integrity-verified), no exemption; capture verbatim refusal. Refuted if the gate accepts (which would mean the gate semantics changed — then `C1-A` must be re-read before deciding metadata).
* **Action if confirmed:** bump M1/M2 (+M3/M4), rebuild, re-test install — expected to succeed with no exemption.

### R2 — Hot-reload contract changed: `loader/volatile-update` / in-place volatile commit

* **Reasoning:** the plugin's only mechanism for applying a Web-UI save to the running process is: Config fields are Cordis `Volatile` references that the Loader updates **in place**, then it emits `loader/volatile-update` on the owning fiber; the plugin re-reads and remounts (`src/index.ts:10-29,196-240`; `src/settings.ts:1-37,133-167`). Two structural weaknesses make a change here dangerous:
  1. **The event name is declared by the plugin itself** (`src/settings.ts:61-69`), so the compile probes cannot detect a host rename or moved dispatch — a stale local declaration keeps compiling.
  2. Failure is **silent**: no exception, no log line; the profile shows new values while the running plugin keeps the old ones (`plugin.ready` was logged only at mount). The operator sees "save did nothing".
* **Failure shapes to distinguish:** (a) event renamed/removed/moved → no remount at all; (b) event emitted but references not updated / `equalExceptVolatile` semantics changed → remount reads stale values; (c) event no longer fiber-filtered → extra remounts on other plugins' writes (clears dedupe/queue; queued mail lost); (d) hot-reload re-applies on the same fiber without disposal → duplicate listeners/queues → **duplicate mails** per settled turn; (e) remount-oriented hot-reload no longer calls `apply` with volatile refs → `Volatile.get()` throws at first access (loud).
* **Plugin refs:** `src/settings.ts:61-69,133-167`; `src/index.ts:171-240,337-343`; `tests/unit/settings.test.ts:104-171` (binding only, not the host).
* **Confirm/refute:**
  1. **Existing real-assembly probe, re-run on 0.2.1:** `scripts/probe-live-policy.mjs` (or the in-host half `scripts/probe/live-policy.mjs`) commits a config change through the Loader (`entry.update({config})`) inside a booted process and asserts the *second* turn's question mail arrives while the first was suppressed (`scripts/probe-live-policy.mjs:1-38,435-465`; `scripts/probe/live-policy.mjs:103-149`). Assertions to watch: `switch-on-committed`, exactly one question mail. Refuted if the mail never arrives or the plugin remounts without behavior change.
  2. **New automated test (gap 2.8 #1):** use the existing `reconfigure` seam (`tests/support/plugin-harness.ts:108,176-180`) to drive `notifyQuestions:false→true` and assert (i) behavior changes, (ii) `listenerNames()` still exactly the 3+1 set after remount, (iii) queue replaced exactly once, (iv) old runtime released. This turns the silent failure into a test failure.
  3. **New host-source probe:** a script that reads the installed `cordis-plugin-loader`'s declared `Events` for `loader/volatile-update` and its emit site (the package ships inside the DSH install, not npm — `src/settings.ts:44-60`), asserting the name and the owning-fiber dispatch still exist. `C1-A` should answer this from the host diff; the plugin-side probe keeps it checkable locally.
  4. **HMR duplicate-send test:** dispose + re-apply the plugin (or simulate re-apply on a reused context) and assert one mail per turn and listener count stable.

### R3 — Credential provider API / read-priority change

* **Reasoning:** operator-flagged. The plugin is deliberately priority-agnostic: it calls `resolve()` inside every attempt and treats the result as authoritative (`src/credentials.ts:1-12,116-154`; `src/mailer.ts:101-159`). That means a *priority* change (which layer wins: process env vs project/user env vs the file store vs records) is invisible to the plugin — no code change needed, but behavior can change both ways: a password written from the Web card (file layer) may be shadowed by an environment layer, causing SMTP auth failures that the plugin correctly classifies as permanent (`smtp-auth`); or an environment value may start winning over a rotated file value. **API-shape** changes are worse: `getCredentialProvider` requires both `resolve` and `describe` to be functions (`src/credentials.ts:79`), so renaming/removing either makes the provider look absent → every send fails permanently with "this profile mounts no Credential service" (a misleading diagnostic); a changed result shape (`{value, source}` expected, `:18-21,138`) makes a present secret read as unconfigured. The hardcoded `CREDENTIAL_REF_PATTERN` must stay aligned with the host's `credentialRef()` grammar (`src/config-check.ts:73`; probe `scripts/probe/credential-contract.mjs:120-144`).
* **Plugin refs:** `src/credentials.ts:14-154`; `src/config.ts:111-116`; `src/config-check.ts:73,238-256`; `src/client/wire.ts:189-247`; `src/client/fields.ts:300-315`.
* **Confirm/refute:**
  1. **Typecheck against target:** bump M3, run `npm run typecheck`; the host compile probe names `credentialRef`, `credentialKey`, `credentialKeyId`, `credentialKeyScope`, `isCredentialKeySegment`, `isCredentialRefName` (`scripts/type-probes/host-contracts.compile.ts:46-57,441-449`). A moved/renamed export fails loudly.
  2. **Real provider contract on 0.2.1:** `npm run probe:credentials` → `scripts/probe/credential-contract.mjs` (14 checks against the installed provider: grammar parity with `credentialRef()`, CredentialRef vs CredentialKey split, document parser `refs`, live `resolve()` from the file layer with the value absent from every env layer, `describe()` configured/writable, scoped key unresolvable). Any failure is a direct hit on R3.
  3. **Read-priority test (new):** in an isolated 0.2.1 home, store a synthetic password in `.credentials.yaml`, set a *different* synthetic value in `DSH_MAIL_SMTP_PASSWORD` in the process env, send via Test Email with a loopback SMTP server that records the AUTH line, and assert which value the provider chose. This converts "priority changed" into an observable fact. Also assert rotation: rewrite the file between two sends and require the second to use the new value (the plugin's per-attempt contract; unit analogue `mailer.test.ts:176-198`).
  4. **Config grammar:** `tests/unit/config-check.test.ts` + a new case that runs the *installed* `isCredentialRefName()` over the plugin's accepted set (the compile probe pins the helper, the unit test pins the pattern).

### R4 — Connection mechanism change (host `fetch.register` / browser `rpc.call` / envelope)

* **Reasoning:** operator-flagged. The plugin publishes two exact Fetch routes through `ctx.connection.fetch.register` and the browser calls them through `ctx.connection.rpc.call('/api', endpoint, {}, signal)` with an envelope the plugin re-implements by hand (`src/index.ts:318-335`; `src/client/wire.ts:141-155`; `src/web-rpc.ts:20-122`). Any of the following breaks **status and Test Email** (and only those; Save uses host Remotes): a changed `register()` route-descriptor (methods/requestBody/path rules), a changed channel (`/api`) or auth/trust-fence behavior, a changed client call signature, a changed envelope literal (`client-request`/`server-response`/`rpcId`/`result.ok`/`error.code`), or exact routes no longer being consulted before the interceptor. **Failure shape is contained:** the card reports "the host returned no decodable response" / unknown status; no mail path is affected. A 0.2.1 that removes exact-route registration entirely (e.g. forces `rpc.handle`, which the plugin's own protocol note records as broken in 0.2.0 because it reads `owner.webServer` without injecting it — `src/protocol.ts:13-31`) would leave no supported publication path: that is a **feature-loss** finding, not a crash.
* **Plugin refs:** `src/index.ts:309-335`; `src/protocol.ts:1-129`; `src/web-rpc.ts:1-122`; `src/client/wire.ts:141-177`.
* **Confirm/refute:**
  1. **Typecheck against target:** the host compile probe asserts `ctx.connection.fetch.register`, `rpc.handle`, `rpc.intercept`, `createSharedFetchHandler('/api')` all still exist (`scripts/type-probes/host-contracts.compile.ts:186-200`); the client probe asserts `ctx.connection.rpc.call` and `isLoopback` (`tests/compatibility/contracts.compile.ts:152-165`). A member change fails loudly after the bump.
  2. **New host probe (no browser):** boot the app the way `scripts/probe-host-config-write.mjs` does (`boot()` + `profileContext`), register a POST route under `/api`, call it through the host's shared Fetch handler and/or the browser `ConnectionHandle`, and assert the envelope round-trips. This is the minimal direct refutation.
  3. **Existing browser E2E on 0.2.1:** `scripts/probe/browser-e2e.mjs` asserts the card renders 23+1 labels, the Save commit envelope is `ok:true`, the `/api/dsh-mail-notify/status` route answers 200 with a decodable body, and Test Email actually delivers over loopback SMTP (recorded route table `V0.5.0_COMPAT_REPORT.md:297-311`). This is end-to-end confirmation, not just a unit assertion.

### R5 — Session-event vocabulary drift with silent suppression (payload shapes / `SessionHeader`)

* **Reasoning:** the adapter is deliberately *tolerant*: missing or renamed fields degrade to `other`/absent instead of throwing (`src/runtime-adapter.ts:1-19,294-332`; `src/event-handler.ts:537`). That tolerance is a safety feature at runtime and a **risk under migration**: the most plausible 0.2.1 contract drift produces *no mail at all* with only internal log lines (`notification.suppressed`, `prompt.attribution-rejected`, `approval.unusable`, `question.unparsable`). The compile probes are the loud gate — but only for the members they name, and there are notable omissions:
  * `SessionHeader` is **not asserted anywhere** (`origin`, `delegationDepth`, `parentSession`, `cwd`, `agentPreset` appear in the type probe only as prose/comments; grep of `host-contracts.compile.ts` shows no `SessionHeader` import). A 0.2.1 header change therefore has no static gate.
  * The event payload assertions cover `turn/start`, `turn/end`, `step/start`, `step/end`, `tool/call`, `tool/result`, `assistant/message`, `assistant/attempt`, `llm/retry`, `user/message` (`:267-304`), the source-kind table (`:306-349`), telemetry buckets (`:361-368`), timed-question (`:384-402`), approval (`:419-430`) — good coverage, but no `session/disposed` payload and no `turn/end` *error nested* field assertions beyond `code`.
* **Grouped failure shapes and blast radius:**
  1. `MessageSourceMap` semantics change for `'user'` / `'user-question-reply'` → prompts mis-attributed; late replies may become prompts (privacy) or prompts dropped (`includeUserPrompt` empty). Predicted observable: `prompt.attribution-rejected` count changes; `includeUserPrompt` bodies wrong.
  2. `turn/end.reason` shape change (e.g. error nesting, new kind) → `status: unknown` for a real settlement, which policy suppresses (`src/notifier.ts:162-174`) → completed/error mail silently stops. Predicted observable: `notification.suppressed` reason `disabled-by-policy` with "no switch exists for status unknown".
  3. `assistant/message.usage` / bucket names change → turn still mails, `usageComplete:false` and counters absent. Lowest damage.
  4. `tool/call.name`/`arguments` change → question mail stops (`question.unparsable` / no match). `tool/result` error criteria change → `completed-with-tool-errors` undercounts.
  5. `approval/asked` fields change → approval mail stops (`approval.unusable`).
  6. `SessionHeader.origin`/`delegationDepth` meaning change → subagent turns mailed (privacy) or top-level turns suppressed (silence). This is the one with **no static gate**.
  7. New `SessionEvent` member → falls into `other`; harmless. A `SESSION_FORMAT_VERSION` bump from 4 fails `npm run typecheck` loudly (`host-contracts.compile.ts:233`) — a *good* gate, and a signal to re-read session semantics.
* **Plugin refs:** §1.2/§1.3 tables; `src/runtime-adapter.ts`; `src/completion.ts`; `src/human-attention.ts`; `src/event-handler.ts`.
* **Confirm/refute:**
  1. **Add the missing static pins first** (new lines in `scripts/type-probes/host-contracts.compile.ts`): `SessionHeader.origin`/`delegationDepth`/`parentSession`/`cwd`/`agentPreset` types and optionality; `session/disposed` payload; `turn/end.reason.error` nesting; then `npm run typecheck` against M3-bumped deps. This converts R5-6 into a loud gate.
  2. **Real-assembly matrix on 0.2.1** (the strongest behavioral evidence): `probe:questions`, `probe:errors`, `probe:approvals`, `probe:approvals-duplicate`, `probe:approvals-rejected`, `probe:credentials`, `probe:user-prompt`, `probe:timed-questions` — the scenario matrix already asserts exact mail counts and subjects (`V0.5.0_COMPAT_REPORT.md:428-447`).
  3. **Recorded-log replay:** point `scripts/turn-telemetry-probe.mjs` at a 0.2.1 session log (the probe decodes durable session logs and folds a turn independently; `docs/DSH_INTEGRATION.md:274-277`), and add a *new* recorded 0.2.1 log as a fixture source. If 0.2.1 writes the same shapes, the fixtures are validated by construction.
  4. **Subagent positive control:** extend the probe matrix with a real delegation and assert exactly one mail (parent only) with `decidedBy:'origin'`, and a fork with `parentSession` asserting it is top-level — the two misclassification failure modes observed historically.

### R6 — Config schema / Schemastery / settings-form projection drift

* **Reasoning:** the Host validates and persists through the standard-schema node derived from Schemastery (`src/config.ts:37-58`; `src/config-check.ts:1-48,403-431`); the form is projected from `Config.toJSON()`'s `{uid, refs}` table (`tests/support/host-fields.ts:1-70`; probes `scripts/probe/schema-probe.mjs`, `scripts/probe/volatile-shape-probe.mjs`, `scripts/probe/config-check-probe.mjs`). Failure shapes: (a) Schemastery prototype loses `~standard` → **import-time throw**, plugin refuses to load (loud, correct); (b) volatile rules change (e.g. a field shape stops being accepted) → `Config({})` throws at mount/load (loud); (c) `toJSON()` uid/refs representation changes → the card's form projection sees no fields (silent in production, caught by `PAR-01`/`PAR-02` in tests once the schema is rebuilt, and by the browser E2E rendered labels); (d) host `resolveConfig` becomes async or changes issue shape → the derived validator passes through async results (`src/config-check.ts:418-426`) and the Host's refusal path may misbehave (probe `config-check-probe.mjs:271-293` is the check).
* **Plugin refs:** `src/config.ts` (whole), `src/config-check.ts` (whole), `src/client/controller.ts:474-534`, `tests/support/host-fields.ts`, `tests/unit/settings.test.ts:186-254`, `tests/client/config-surface.test.ts:86-143`.
* **Confirm/refute:** run the three schema probes **pointed at the 0.2.1 install**, not the checkout: `SCHEMA_PROBE_MODULES=<0.2.1 install tree> node scripts/probe/schema-probe.mjs`, `…/volatile-shape-probe.mjs`, `…/config-check-probe.mjs`; then `scripts/probe-host-config-write.mjs` (real write path: refusal invariants, byte-identical patch, accepted enable, Test Email delivery); then the browser E2E (23+1 rendered labels).

### R7 — Client-half activation drift (service names, slot, locale, seed modules)

* **Reasoning:** the browser plugin only activates when all six injected services exist (`src/client/index.tsx:57`), and its card only exists while `configForms.whileServed` holds and the `plugins.bundle.config` slot is known (`:75-94`). A renamed service, a moved slot, or a changed web-boot seed table makes the card **silently absent** (a page-level loader log at most). Type-only imports mean no runtime module resolution failure would even be reported to the plugin. The `ctx.connection` browser member is declared by the plugin itself (`src/client/contracts.ts:98-103`), so this one wiring change is invisible to `tsc`.
* **Plugin refs:** `src/client/index.tsx:41-101`; `src/client/contracts.ts:49-103`; `src/client/controller.ts:173-194`; `package.json:23-33`.
* **Confirm/refute:** (1) `npm run typecheck` after M3 (compile probes name the slot, the form service and the connection handle); (2) browser E2E on 0.2.1 asserting exactly one `section[data-plugin-config]`, 23+1 labels, no console error, Save `ok:true`, Test Email delivered (`scripts/probe/browser-e2e.mjs`; recorded `V0.5.0_COMPAT_REPORT.md:346-411`); (3) if the card is absent, a DevTools console/loader-error capture distinguishes "inject never satisfied" from "slot missing".

### R8 — Timer service drift (degradation only)

* **Reasoning:** `timer` is optional and duck-typed; an absent/changed `timeout` falls back to `setTimeout` (`src/index.ts:579-589`; `src/queue.ts:69-77`). Mails still retry; the lost property is that a backoff wait is no longer cancelled by unload, so a detached timer can outlive the plugin briefly. No duplicate/loss beyond the queue-dispose rules already in §2.4.
* **Confirm/refute:** type probe extended to name the timer service contract, or a real-host assertion that `ctx.get('timer')` is truthy with `timeout`; `lifecycle.test.ts:619-632` shows the intended use with a mounted service. Low priority.

### R9 — Bundle manifest / web-boot loading drift

* **Reasoning:** installation depends on `dsh.bundle.patch` and the row it inserts (`package.json:19-22`; `cordis.patch.yml:16-20`); the browser half is loaded as one classic script through the shell's module loader with only `react`/`react/jsx-runtime` externalized (`src/client/index.tsx:1-10`; `tsdown.config.ts`). If 0.2.1 changed the bundle-manifest schema or the client module envelope, install/compose or the card fails. `tests/package/tarball.test.ts` pins the emitted envelope and the `dsh` block, so a plugin-side build change is caught, but a host-side loader change is only caught by the host run.
* **Confirm/refute:** `C4-A/C4-B` install + web boot of the candidate archive; browser E2E. Low residual risk because the previous host generation only changed *which* services are injected, not the mechanism (recorded `V0.5.0_COMPAT_REPORT.md:149-162`).

### R10 — Standard-Schema/`resolveConfig` host-write behavior (persistence boundary)

* **Reasoning:** the plugin's entire pre-persistence refusal rides on `Config['~standard']` and cordis's `resolveConfig` (`src/config-check.ts:8-16,403-431`). If 0.2.1 changed issue shape, async handling, or the editor's call order, a product-invalid save could be accepted (worst case: a half-configured plugin persisted) or a valid save refused. This is host-side behavior, not plugin code, but the plugin's derived node is the thing under test.
* **Confirm/refute:** `scripts/probe-host-config-write.mjs` on 0.2.1 asserts: refusals raise; patch byte-identical; revision unmoved; committed config unmoved; warnings do not become errors; complete enable accepted and delivers. That probe is the complete refutation for R10.

### Explicitly *not* suspected (no plugin code depends on them)

* `approval/decided` / approval resolution path — not registered (`src/index.ts:450-469`).
* `user-questions/request` and `approval/request` waterfalls — deliberately not registered to avoid answer ownership (`docs/DSH_INTEGRATION.md:146-155`).
* Session persistence/query services (`sessions` service) — not used; a root listener already receives every session's events (`docs/DSH_INTEGRATION.md:58-60`).
* Slots other than `plugins.bundle.config`, and any interface that could render mail content in the browser — unused.
* `engines.dsh` — absent and not part of the recorded gate; adding it is not a substitute for peer bumps.

---

## 5. Recommended verification sequence for the candidate build

Ordered so that the loud gates fire before the expensive real-host runs. All host runs must use isolated `DSH_HOME`/profiles per the repo's isolation convention (`scripts/probe/README.md:72-114`; `docs/DECISIONS.md:1371-1375`); no exemption, no real profile, no real credentials.

| Step | Command / artifact | What it proves | Refutes |
| --- | --- | --- | --- |
| 1 | Update M1–M4 in the candidate; `npm install`; `npm run typecheck` (three programs, both compile probes) | Every named host/client contract still exists in `0.2.1-rc.2` typings; all Config fields still volatile; both probe programs split correctly | R2 (part), R3, R4, R5 (named members only), R6 (part), R7 (types) |
| 2 | Add the §2.8 missing tests (remount via `reconfigure`, listener stability, no duplicate mail across remount, route lifecycle) **before** host runs | The silent failure modes become test failures | R2, R4 (host side) |
| 2b | Extend the host compile probe with `SessionHeader` members and `session/disposed` payload (§4 R5-6) | Removes the only *ungated* session-contract surface | R5-6 |
| 3 | `npm test` on the 0.2.1 dependency set | Behavioral regressions in the mounted-plugin harness | R3, R5 (behavioral fixtures), R6 |
| 4 | `SCHEMA_PROBE_MODULES=<0.2.1 install> node scripts/probe/{schema,volatile,config-check}-probe.mjs` | Schemastery/Standard-Schema/volatile mechanics of the *target* install | R6 |
| 5 | `node scripts/probe-host-config-write.mjs` on the 0.2.1 install | Real host write path: refusals, byte-identical patch, accepted enable, Test Email delivery | R10, R6 (part) |
| 6 | `npm run probe:credentials`; `npm run probe:live-policy` | Real credential contract + live config commit reaching the running engine | R3, R2 |
| 7 | Real-assembly matrix: `probe:questions`, `probe:errors`, `probe:approvals`, `probe:approvals-duplicate`, `probe:approvals-rejected`, `probe:user-prompt`, `probe:timed-questions` | All three notification families + prompt attribution + timed questions on the target host | R5 |
| 8 | Isolated 0.2.1 web: install candidate archive via real plugin manager (no exemption); boot; run `scripts/probe/browser-e2e.mjs` | Install/compose, one card, 23+1 labels, Save envelope, status route, Test Email delivered, no console errors | R1 (candidate), R4, R7, R9 |
| 9 | Lifecycle on the isolated host: disable→enable live; uninstall→reinstall; upgrade/hot-reload mid-turn and between turns; observe exactly one mail per turn and no duplicates | The HMR/duplicate-send question in a real host, which no current automated test covers | R2 (d), §2.4 gap |

---

## 6. Bottom line

1. **The plugin's host surface is narrow and almost entirely "durable event observation + optional services".** It subscribes to `session/event` (twice) and `session/disposed`, reads `loader/volatile-update`, optionally reads `timer` and `credentials`, publishes two exact Fetch routes and calls them from the browser, and uses the host's Form/Remote/credential surfaces for its configuration card. It writes no files, owns no domain, and stores nothing outside memory.
2. **The only definite blocker on `0.2.1-rc.2` is metadata, not runtime:** two exact DSH peers at `0.2.0-rc.2` (`package.json:79-80`) fail the recorded admission gate. Dev-dependency bump, lockfile regeneration and README/doc claims follow from it (§3). Nothing in the historical release evidence may be rewritten.
3. **The three operator-flagged areas are the right suspects, in this order:** hot-reload (`loader/volatile-update` + in-place volatile commit — silent failure, event name self-declared), credential provider API/read-priority (shape changes produce permanent "credential-missing"; priority changes are invisible by design), connection mechanisms (status RPC + Test Email only; envelope hand-implemented). Session-vocabulary drift is the widest *silent* risk area and has one ungated corner (`SessionHeader`).
4. **The strongest existing refutation tools are already in the repo** (both compile probes, the mounted-plugin harness, eight real-assembly scenarios, live-policy, host-write, schema probes, browser E2E); the largest **test gap** is that the live remount path has a ready-made seam (`harness.reconfigure`) that no automated test uses, and there is no route-lifecycle test at all. Those two additions are the cheapest way to convert the top silent risks into loud failures before the expensive host verification.
5. **This audit found no definite runtime-breaking usage by inspection.** The environment cannot settle host-side behavior; `C1-A` (exact-tag diff) and `C4-A`/`C4-B` (isolated 0.2.1 host) are the authoritative checks, and this catalog is the plugin-side map they should be applied against.

---

## Appendix A — grep methodology and counts

Commands run read-only from the repo root (PowerShell 7, no repo mutation):

* Files searched for version strings: tracked text files (`*.ts,*.tsx,*.mjs,*.js,*.json,*.yml,*.yaml,*.md`), excluding `node_modules/`, `.git/`, `tmp/`, `.jspace/`, `lib/` (build output, gitignored) and the `*.tgz` archives.
* `0\.2\.0-rc\.2`: **17 files, 297 occurrences** (198 in `package-lock.json`, 99 in 16 other files) outside `lib/` (the build output repeats the source comments but is regenerated, not edited). Breakdown: `package-lock.json` 198; `V0.5.0_COMPAT_REPORT.md` 40; `package.json` 17; `RELEASE_V0.5.0.md` 8; `docs/DECISIONS.md` 6; `RELEASE_NOTES_V0.5.0.md` 6; `src/client/contracts.ts` 5; `README.md` 4; `scripts/type-probes/host-contracts.compile.ts` 3; `scripts/probe-host-config-write.mjs` 2; `00_MASTER.md` 2; `scripts/probe/{schema,config-check,volatile-shape}-probe.mjs` 1 each; `src/config-check.ts` 1; `src/config.ts` 1; `scripts/probe-e2e.mjs` 1. **Tests: 0 occurrences.**
* `deepseek-ai`: present in every file that imports a DSH package; the gate-relevant subset is `package.json` peers (2), devDependencies (15), `package-lock.json` resolved entries (38 `node_modules/@deepseek-ai/dsh-*` lock entries at `0.2.0-rc.2`; 0 non-DSH lock entries carry the string), and the compile probes' import lists.
* Lockfile facts (via a read-only `node -e` parse): `lockfileVersion 3`; root `name/version = dsh-mail-notify 0.5.0`; root `.dependencies = {nodemailer: ^10.0.9}`; root `.devDependencies` 15 DSH entries at `0.2.0-rc.2`; root `.peerDependencies = {@deepseek-ai/cordis: ^4.0.4, @deepseek-ai/dsh-credentials: 0.2.0-rc.2, @deepseek-ai/dsh-session: 0.2.0-rc.2, @deepseek-ai/schemastery: ^3.18.4, react: ^18.2.0}`; root `.engines = {node: ^22.19.0 || >=24.0.0}`.
* Installed typings backing the previous claim: the whole `node_modules/@deepseek-ai/` tree is 44 packages — 38 `dsh-*` at `0.2.0-rc.2`, plus `cordis@4.0.4` with its three loader/group/include plugins, `schemastery@3.18.4`, and `cosmokit@1.8.5`.
* Config count cross-check (read-only `node -e` over the source): 23 field keys in `src/config.ts`'s `fieldSchema`; 23 unique `field:` literals in `src/client/fields.ts`; `smtpPasswordSecret` appears in neither set (it is the separate password control).
* `0\.1\.[0-9]` sweep: 25 occurrences in `README.md`, 16 in `docs/DSH_INTEGRATION.md`, 17 in `docs/DECISIONS.md`, 5 in `tests/compatibility/contracts.compile.ts`, 5 in `scripts/type-probes/host-contracts.compile.ts`, plus scattered historical comments in `src/`, `tests/`, `scripts/` and historical reports. None is a version *assertion* except the historical prose; the actionable stale ones are listed in §3 M8/M9.

## Appendix B — files that constitute the evidence base

* Host half: `src/index.ts`, `src/runtime-adapter.ts`, `src/event-handler.ts`, `src/human-attention.ts`, `src/completion.ts`, `src/telemetry.ts`, `src/turn-state.ts`, `src/notifier.ts`, `src/queue.ts`, `src/mailer.ts`, `src/transport.ts`, `src/credentials.ts`, `src/config.ts`, `src/config-check.ts`, `src/settings.ts`, `src/protocol.ts`, `src/web-rpc.ts`, `src/test-email.ts`, `src/logger.ts`, `src/types.ts`.
* Client half: `src/client/{contracts,controller,fields,wire,index,Card,locale}.ts(x)`.
* Compile pins: `tests/compatibility/contracts.compile.ts`; `scripts/type-probes/host-contracts.compile.ts`.
* Test harness + suites: `tests/support/plugin-harness.ts`, `tests/support/host-fields.ts`, `tests/support/harness.ts`, `tests/fixtures/runtime-shapes.ts`, `tests/integration/{lifecycle,queue,mailer,timed-question,attention-notification,failure-notification,turn-telemetry,credential-contract}.test.ts`, `tests/client/{config-surface,disclosure,locale,fields,wire}.test.ts`, `tests/unit/settings.test.ts`, `tests/package/tarball.test.ts`.
* Probes: `scripts/probe-e2e.mjs`, `scripts/probe-live-policy.mjs`, `scripts/probe-host-config-write.mjs`, `scripts/probe/{schema,volatile-shape,config-check,credential-contract,event-order,dsh-modules}.mjs`, `scripts/probe/browser-e2e.mjs`, `scripts/turn-telemetry-probe.mjs`, `scripts/dev-boot-probe.mjs`, `scripts/probe/README.md`.
* Recorded prior evidence: `V0.5.0_COMPAT_REPORT.md`, `docs/DSH_INTEGRATION.md`, `docs/DECISIONS.md` (D022), `README.md`, `00_MASTER.md`.
* Manifest/metadata: `package.json`, `package-lock.json`, `cordis.patch.yml`, `tsconfig*.json`, `tsdown.config.ts`, `.env.example`, `.gitignore`.

## Appendix C — limitations of this audit

1. **No host was booted and no test suite was run by this session**; the audit is static reading plus the repository's recorded results. Every "test would confirm" statement names an existing artifact; new tests are marked as new.
2. **`0.2.1-rc.2`'s contracts were not read here** (not installed in this checkout), and its release notes were not treated as evidence. Any statement about *what* 0.2.1 changed is deliberately absent; only the plugin-side exposure and the detection method are stated.
3. **`docs/compat/01_CONTRACT_DIFF.md` did not exist when this report was written.** When it lands, §4's suspect list should be re-scored against it: a `breaking`/`compatible` class from the host diff is authoritative where this report only ranks hypotheses, and any host-side fact it establishes should replace the corresponding "unverified" caveat here.
4. The audit did not inspect `node_modules/@deepseek-ai` declaration *contents* beyond version enumeration; the compile probes are the designated check for those contents.
5. `package-lock.json` was parsed read-only; no install, build, pack, or host command was executed.
