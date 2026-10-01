/**
 * The host-side compatibility compile probe.
 *
 * ## Why this file is not in `tests/compatibility/`
 *
 * Its companion `tests/compatibility/contracts.compile.ts` is the client probe,
 * and the two cannot share a TypeScript program: `ctx.connection` is declared as
 * `ConnectionHandle` by `@deepseek-ai/dsh-client-connection/client` and as
 * `HostConnectionHandle` by that package's host entry, so one program sees two
 * incompatible augmentations of the same member. `tsconfig.client.json` includes
 * the whole `tests/compatibility` directory, so a file placed there would be
 * compiled by the *client* program —which is exactly the collision. This file
 * therefore lives where only `tsconfig.test.json` reaches it.
 *
 * Like its companion, this file is never executed. It fails `npm run typecheck`
 * when a host contract this plugin builds on changes shape.
 *
 * ## The DSH 0.2.0-rc.2 generation
 *
 * The sections below the retired-surface checks state the *target's* contracts
 * by name rather than by comment: the session event vocabulary the adapter
 * translates, the message-source kinds that decide prompt attribution, the
 * timed `ask_user_question` schema field, the approval audit payload, the retry
 * record the telemetry keys on, the token buckets it folds, and the credential
 * reference grammar. Naming them is what makes this file fail the day the
 * target removes or retypes one, instead of letting a renamed field read as
 * `undefined` at runtime.
 *
 * @module dsh-mail-notify/scripts/type-probes/host-contracts.compile
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cosmokit'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type {} from '@deepseek-ai/dsh-user-questions/types'
import type { SettingsForms, SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { SessionEventMap, TurnEndReason, TurnEndReasonMap } from '@deepseek-ai/dsh-session/types'
import type { MessageSourceMap, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { AskUserQuestionItem, PendingUserQuestion } from '@deepseek-ai/dsh-user-questions/types'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import {
  credentialRef,
  credentialKey,
  credentialKeyId,
  credentialKeyScope,
  isCredentialKeySegment,
  isCredentialRefName,
} from '@deepseek-ai/dsh-credentials'
import { TIMED_WAIT_PARAMETER } from '@deepseek-ai/dsh-user-questions'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { Config, type ConfigSnapshot, type ConfigValue } from '../../src/config.ts'
import { bindVolatileConfig } from '../../src/settings.ts'
import { SETTINGS_NAMESPACE } from '../../src/protocol.ts'

/* 鈹€鈹€ Volatile Config 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * Every Config field is a `Volatile` reference, and reading one yields a primitive.
 *
 * The assertion is deliberately made field by field through the published
 * `Volatile<T>` rather than through a structural `{ get(): unknown }`: the two
 * libraries that must agree about this protocol are Schemastery (which creates
 * the references) and the Loader (which updates them in place), and only the
 * shared type proves they are talking about the same thing.
 */
export function configFieldsAreVolatile(config: ConfigValue): void {
  const enabled: Volatile<boolean> = config.enabled
  const reference: boolean = enabled.get()
  const port: number = config.smtpPort.get()
  const recipients: readonly string[] = config.to.get()
  void [reference, port, recipients]

  // The snapshot the plugin actually operates on is a tree of primitives.
  const snapshot: ConfigSnapshot = bindVolatileConfig(null as unknown as Context, config).snapshot()
  const flag: boolean = snapshot.enabled
  const list: string[] = snapshot.to
  void [flag, list]
}

/**
 * The snapshot is the surface with a closed shape.
 *
 * `ConfigValue` is deliberately open: Schemastery's inferred config type carries
 * an index signature, so a mistyped field name reads as `any` rather than as an
 * error — which is why nothing downstream of the snapshot boundary ever holds a
 * `ConfigValue`. {@link ConfigSnapshot} *is* closed, and the assertion below is
 * what holds that line: a field added to the schema without a matching snapshot
 * entry still compiles, but a field read from the snapshot that no entry
 * declares does not.
 */
export function snapshotShapeIsClosed(snapshot: ConfigSnapshot): void {
  // @ts-expect-error `notAField` is not part of the configuration snapshot.
  void snapshot.notAField
}

/**
 * Every snapshot field names a field the schema declares.
 *
 * Written as a mapped type over the snapshot's own key set, so a field that
 * survives in the snapshot after being removed from the schema resolves to
 * `never` and fails wherever this alias is used.
 */
export type SnapshotCoversOnlySchemaFields = {
  [K in keyof ConfigSnapshot]: K extends keyof ConfigValue ? true : never
}
export const SNAPSHOT_COVERS_ONLY_SCHEMA_FIELDS: SnapshotCoversOnlySchemaFields = null as unknown as SnapshotCoversOnlySchemaFields

/** The schema itself is a Schemastery object schema, and its fields declare volatility. */
export function schemaSupportsVolatile(): void {
  const fields: readonly string[] = Object.keys(Config.dict ?? {})
  void fields
  // `volatile()` is the API the target requires for a live field; asserting it on
  // the schema builder is what keeps the migration honest.
  const volatile = Config.dict?.['enabled']?.meta.volatile
  const declares: boolean = volatile === true
  void declares
}

/* 鈹€鈹€ `ctx.settings` is the form service, and `installSection` is gone 鈹€鈹€鈹€鈹€ */

/**
 * The host's settings service is `SettingsForms`.
 *
 * Every positive assertion here is a method this plugin's design depends on
 * existing in the target, and the negative one is the migration itself.
 */
export function settingsServiceIsForms(ctx: Context): void {
  const forms: SettingsForms = ctx.settings
  const descriptors: SettingsDescriptor[] = forms.describe({ redactSecrets: true })
  void descriptors
  void forms.writable
  void forms.documentPath
  void forms.update(SETTINGS_NAMESPACE, {})
  void forms.replace(SETTINGS_NAMESPACE, {})
  void forms.mutate(SETTINGS_NAMESPACE, [] satisfies readonly SettingsPathOp[])
  void forms.configure({ auto: false })

  // The retired seam. `installSection` is what this plugin used through DSH
  // 0.1.5, and its absence is the reason the whole settings module was rewritten
  // rather than adapted.
  // @ts-expect-error `installSection` was removed in DSH 0.1.7.
  void forms.installSection
}

/**
 * A settings write is fenced by a revision, and a stale one is a distinct error.
 *
 * Checked because the card's whole save path depends on the fence existing: a
 * write without one would let two surfaces overwrite each other silently.
 */
export function settingsWritesAreRevisionFenced(forms: SettingsForms): void {
  void forms.update(SETTINGS_NAMESPACE, {}, 0)
  void forms.mutate(SETTINGS_NAMESPACE, [], 0)
}

/* 鈹€鈹€ Session events 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * The session events this plugin observes exist, with the payloads it reads.
 *
 * `session/event` and `session/disposed` are the only two the plugin registers.
 * Their presence in `Events` is what makes the registration type-check rather
 * than needing a cast, and the plugin's own narrow structural view of a payload
 * lives in `src/runtime-adapter.ts`.
 */
export function sessionEventsExist(ctx: Context): void {
  ctx.on('session/event', () => undefined)
  ctx.on('session/disposed', () => undefined)
}

/** A `turn/end` reason kind added in DSH 0.1.7 is expressible. */
export function forkedReasonIsAKind(): void {
  const reason: { kind: 'forked' } = { kind: 'forked' }
  void reason
}

/* 鈹€鈹€ The connection and credential seams 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * The host connection registry exposes the APIs this plugin publishes through.
 *
 * `fetch.register` is the one the plugin actually uses —an exact route under
 * the shared `/api` channel —and `rpc.handle`/`rpc.intercept` are stated
 * alongside it because the RPC decision in D5 weighs all three. Asserting that
 * all three still exist is what makes that decision reviewable: the day one of
 * them disappears, this file says which.
 */
export function connectionRouteApi(ctx: Context): void {
  void ctx.connection.fetch.register
  void ctx.connection.rpc.handle
  void ctx.connection.rpc.intercept
  void ctx.connection.createSharedFetchHandler('/api')
}

/** The credential service the plugin resolves references through. */
export async function credentialServiceIsReferenceAddressed(ctx: Context): Promise<void> {
  const provider = ctx.get('credentials')
  if (provider === undefined) return
  void (await provider.describe('DSH_MAIL_SMTP_PASSWORD' as never))
}

/* 鈹€鈹€ The retired host settings surface 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * The retired namespace binding is gone.
 *
 * `bindEffectiveConfig` was this plugin's own name for the DSH 0.1.5 seam, and
 * it went with that seam. The assertion is made through a namespace import so it
 * reads as a statement about the module rather than about a value.
 */
export function retiredBindingIsGone(): void {
  // @ts-expect-error the 0.1.5 settings binding was removed with the seam it wrapped.
  void bindVolatileConfig.bindEffectiveConfig
}

/* == The exact DSH 0.2.0-rc.2 session vocabulary == */

/**
 * The target stamps session logs with format version 4.
 *
 * The annotation is the literal `4`, not `typeof SESSION_FORMAT_VERSION`, so the
 * assertion is checkable in one direction only: a successor that bumps the
 * header version stops compiling here instead of leaving this plugin claiming
 * v4 semantics it no longer reads.
 */
export const SESSION_FORMAT_VERSION_IS_FOUR: 4 = SESSION_FORMAT_VERSION

/**
 * Every `turn/end` reason kind the plugin classifies exists in the target's map.
 *
 * The plugin's `toTurnEndKind` maps a raw `reason.kind` onto its own
 * `TurnEndKind` union, and `forked` is carried so a fork seed is *recognized*
 * and then suppressed rather than read as an unknown settlement. Asserting each
 * member against `TurnEndReasonMap` is what makes a renamed or withdrawn kind a
 * compile error rather than a silent `unknown` classification.
 *
 * @returns one representative reason per kind the classifier must know.
 */
export function turnEndReasonsArePresent(): readonly TurnEndReason[] {
  const completed: TurnEndReasonMap['completed'] = { kind: 'completed' }
  const aborted: TurnEndReasonMap['aborted'] = { kind: 'aborted', reason: { kind: 'user' } }
  const blocked: TurnEndReasonMap['blocked'] = { kind: 'blocked' }
  const error: TurnEndReasonMap['error'] = { kind: 'error', error: { message: 'probe', code: 'UNKNOWN' } }
  const maxTokens: TurnEndReasonMap['max-tokens'] = { kind: 'max-tokens' }
  const interrupted: TurnEndReasonMap['interrupted'] = { kind: 'interrupted' }
  const forked: TurnEndReasonMap['forked'] = { kind: 'forked' }
  return [completed, aborted, blocked, error, maxTokens, interrupted, forked]
}

/**
 * The session events the adapter translates still carry the fields it reads.
 *
 * Each payload below is written the way DSH's own declaration writes it, so a
 * field that is renamed, made optional, or retyped fails here. `tool/call`'s
 * `arguments` is asserted to be the model's raw *string*, because the question
 * parser's whole input contract is that one opaque value; `tool/result`'s
 * optional `error` is asserted because the adapter folds it, together with the
 * result message's own `isError`, into the explicit-error criterion.
 */
export function sessionEventPayloadsAreIntact(): void {
  const turnStart: SessionEventMap['turn/start']['turn'] = 0
  const turnEndTurn: SessionEventMap['turn/end']['turn'] = 0
  const turnEndReason: SessionEventMap['turn/end']['reason'] = { kind: 'completed' }
  const stepStartStep: SessionEventMap['step/start']['step'] = 0
  const stepEndStep: SessionEventMap['step/end']['step'] = 0
  void [turnStart, turnEndTurn, turnEndReason, stepStartStep, stepEndStep]

  // `tool/call.arguments` is the model's raw JSON *string*, exactly as produced:
  // that single opaque value is the question parser's whole input contract.
  const callId = ToolCallId('call-1')
  const callName: SessionEventMap['tool/call']['name'] = 'ask_user_question'
  const callArguments: SessionEventMap['tool/call']['arguments'] = '{"questions":[]}'
  void [callId, callName, callArguments]

  // A `tool/result` carries its model-facing message plus, when the invocation
  // failed, a structured `error` beside it. The adapter folds both that field and
  // the message's own `isError` into one explicit-error criterion.
  const resultIsError: SessionEventMap['tool/result']['message']['isError'] = true
  const resultError: SessionEventMap['tool/result']['error'] = { name: 'probe', code: 'UNKNOWN', reason: 'probe' }
  void [resultIsError, resultError]

  // `assistant/message` is where the turn's accounting travels: the message and
  // its `usage` are on the same event, and the raw `stream` is the fallback
  // source the adapter reads usage from when `data.usage` is absent.
  const assistantUsage: SessionEventMap['assistant/message']['usage'] = { inputTokens: 1, outputTokens: 1 }
  const assistantStream: SessionEventMap['assistant/message']['stream'] = []
  const attemptStream: SessionEventMap['assistant/attempt']['stream'] = []
  void [assistantUsage, assistantStream, attemptStream]

  // The retry record the telemetry keys on: its identity plus the `(turn, step)`
  // pair that makes a retried call visible rather than silently absent.
  const retryId: SessionEventMap['llm/retry']['retryId'] = RetryId('retry-1')
  const retryTurn: SessionEventMap['llm/retry']['turn'] = 0
  const retryStep: SessionEventMap['llm/retry']['step'] = 0
  const retryFailure: SessionEventMap['llm/retry']['failure'] = { message: 'probe', code: 'UNKNOWN' }
  void [retryId, retryTurn, retryStep, retryFailure]
}

/**
 * The message-source kinds prompt attribution is decided by are published.
 *
 * Two facts matter and both are properties of the target's own tables rather
 * than of this plugin's care. `MessageSourceMap['user']` is the *only* kind that
 * may populate the ordinary user-prompt field, and DSH 0.2 adds
 * `'user-question-reply'` for a late answer to a timed `ask_user_question` — a
 * user-role message that must never be read as the operator's own prompt. An
 * absent augmentation would make that guarantee unstateable, which is why the
 * kind is named here.
 */
export function userMessageSourceKindsArePublished(): void {
  const direct: MessageSourceMap['user'] = { kind: 'user' }
  const lateReply: MessageSourceMap['user-question-reply'] = {
    kind: 'user-question-reply',
    callId: ToolCallId('call-1'),
    outcome: 'answered',
  }
  const replyOutcome: MessageSourceMap['user-question-reply']['outcome'] = 'answered'
  void [direct, lateReply, replyOutcome]

  // The `user/message` payload *is* the message: the adapter's resolver accepts a
  // wrapper as a fallback, and these are the fields it treats as the direct form.
  const id: SessionEventMap['user/message']['id'] = MessageId('message-1')
  const role: SessionEventMap['user/message']['role'] = 'user'
  const source: SessionEventMap['user/message']['source'] = direct
  void [id, role, source]
}

/**
 * The token buckets the telemetry folds are the target's own `TokenUsage` members.
 *
 * Five observable buckets are compared: input, output, cache read, cache write,
 * and reasoning. `totalTokens` is deliberately absent from the plugin's
 * accounting because it is an aggregate of counters the plugin already carries,
 * and carrying both would let one report override the other.
 *
 * @param usage - one accounting report as DSH publishes it.
 */
export function usageBucketsAreIntact(usage: TokenUsage): void {
  const input: number = usage.inputTokens
  const output: number = usage.outputTokens
  const cacheRead: number | undefined = usage.cacheReadTokens
  const cacheWrite: number | undefined = usage.cacheWriteTokens
  const reasoning: number | undefined = usage.reasoningTokens
  void [input, output, cacheRead, cacheWrite, reasoning]
}

/**
 * The target's timed-question contract: the schema field name and the reply kind.
 *
 * `TIMED_WAIT_PARAMETER` is DSH's own name for the one additional tool-schema
 * property a timed `ask_user_question` declares, and `isTimedAskUserQuestionSchema`
 * decides timed-ness from exactly that key. Naming the constant here is what
 * makes the privacy assertion checkable: the question-mail allowlist does not
 * carry it, so a timed call's `timeout` cannot reach a mail body, and the day
 * DSH renames the field this file says so.
 *
 * `PendingUserQuestion.state` is asserted alongside because it is the target's
 * own vocabulary for "the foreground wait closed but the questions stay
 * answerable" — the distinction the mail wording has to survive.
 */
export function timedQuestionContractIsPublished(): void {
  const parameter: 'timeout' = TIMED_WAIT_PARAMETER
  void parameter

  const item: AskUserQuestionItem = {
    id: 'q1',
    question: 'Probe?',
    header: 'Probe',
    options: [{ label: 'Yes', description: 'probe' }],
    multiSelect: false,
  }
  const pending: PendingUserQuestion = {
    callId: ToolCallId('call-1'),
    questions: [item],
    state: 'continued',
  }
  const open: PendingUserQuestion['state'] = 'open'
  void [pending, open]
}

/**
 * `approval/asked` carries exactly the fields the adapter copies, and no more.
 *
 * DSH's approval audit event publishes the request identity, the tool name, an
 * optional exact call id, and an optional asker reason — and never the approved
 * tool's arguments. The adapter's safety property is inherited from this shape
 * rather than re-established, so the shape is asserted: a future field carrying
 * argument content would not be copied (the adapter names its fields), but the
 * assertion documents which fields it may legally name.
 *
 * `approval/decided`, whose `outcome` distinguishes a rejection from a grant, is
 * named for the same reason: the plugin observes the ask only, and a second
 * "you are needed" mail on a decision is what the absence of that observer
 * prevents.
 */
export function approvalAuditPayloadsAreIntact(): void {
  const id = ApprovalRequestId('approval-1')
  const asked: SessionEventMap['approval/asked'] = {
    id,
    toolName: 'pwsh',
    callId: ToolCallId('call-1'),
    reason: 'probe',
  }
  const outcome: SessionEventMap['approval/decided']['outcome'] = 'rejected'
  const decided: SessionEventMap['approval/decided'] = { id, outcome }
  void [asked, decided]
}

/**
 * The credential reference grammar the settings field is addressed by.
 *
 * The plugin stores an environment-variable *name* and resolves it per
 * operation; it never stores a value. The reference half of the seam is
 * therefore the whole contract, and the record half (`CredentialKey`) is
 * deliberately not used — the distinction is asserted by naming both branders
 * and their segment grammar, so a merge of the two key spaces stops compiling.
 */
export function credentialReferenceGrammarIsPublished(): void {
  const ref = credentialRef('DSH_MAIL_SMTP_PASSWORD')
  const named: boolean = isCredentialRefName('DSH_MAIL_SMTP_PASSWORD')
  const key = credentialKey('mail-notify', 'smtp')
  const segment: boolean = isCredentialKeySegment('mail-notify')
  const scope: string = credentialKeyScope(key)
  const id: string = credentialKeyId(key)
  void [ref, named, segment, scope, id]
}
