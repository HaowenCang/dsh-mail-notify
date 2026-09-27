/**
 * The glue between the pure core and the live runtime.
 *
 * This is the only stateful, non-I/O module: it owns the per-session turn map,
 * accumulates events into it, and at `turn/end` drives completion,
 * construction, policy, and enqueue. Everything it decides is delegated —
 * content extraction, classification, policy, and rendering all live in pure
 * modules — so that what remains here is sequencing.
 *
 * The `session/event` listener is synchronous and returns `undefined`. That is
 * not a style choice: the runtime invokes listeners on the synchronous path of
 * `Session.append()` and never awaits what they return, so an `async` listener
 * with an `await` inside would stall session-log commits. Sending is therefore
 * never attempted here; the furthest this module goes is `queue.enqueue()`.
 *
 * @module dsh-mail-notify/event-handler
 */

import { extractVisibleText } from './content.ts'
import {
  decideApprovalNotification,
  decideQuestionNotification,
  parseAskUserQuestionArguments,
  QUESTION_TOOL_NAME,
} from './human-attention.ts'
import type { MailQueue } from './queue.ts'
import type { PluginLogger } from './logger.ts'
import { DedupeCache, decideNotification } from './notifier.ts'
import {
  toApprovalObservation,
  toInternalEvent,
  toSessionFacts,
  toSessionId,
  type SessionEventLike,
  type SessionLike,
} from './runtime-adapter.ts'
import { createCandidate, TurnStateStore } from './turn-state.ts'
import type {
  InternalEvent,
  MailJob,
  Notification,
  NotificationCandidate,
  QuestionNotification,
  QuestionParseResult,
  ResolvedConfig,
} from './types.ts'

/** Dependencies the handler needs. */
export interface EventHandlerOptions {
  config: ResolvedConfig
  logger: PluginLogger
  queue: MailQueue
  dedupe: DedupeCache
  /** Injected for deterministic tests; defaults to `Date.now`. */
  now?: () => number
}

/** The listener set `index.ts` registers on the plugin's fiber. */
export interface SessionHandlers {
  onSessionEvent(session: SessionLike, event: SessionEventLike): void
  onSessionDisposed(session: SessionLike): void
  /**
   * Observe one `approval/asked` audit event.
   *
   * Registered by `index.ts` as its own Cordis listener rather than folded into
   * `onSessionEvent`, because the approval audit pair is delivered through
   * `session/event` with its own type and no turn envelope; keeping the entry
   * point separate makes the observation path explicit at the registration site.
   */
  onApprovalAsked(session: SessionLike, data: unknown): void
  /** Turn-map sizes, for lifecycle assertions. */
  stateSizes(): { sessions: number; turns: number; stepSets: number }
  /** Release every retained turn; called from the plugin's disposer. */
  clear(): void
}

/**
 * The `MessageSource.kind` DSH reserves for a direct human message.
 *
 * `MessageSourceMap` declares this value in its base contract — `user: { kind:
 * 'user' }` — while every other producer declares its own kind by module
 * augmentation, so it is the only positive evidence that a user-role message
 * carries the operator's own words. The browser prompt path (`user-rpc`) sets the
 * same kind, which is correct: a human typed it.
 */
const DIRECT_HUMAN_SOURCE_KIND = 'user'

/**
 * Why a user-role message did not become the turn's prompt.
 *
 * Both members are facts about the message itself, not about its position in the
 * turn — which is the whole point of the rule. `non-user-source` covers every
 * producer other than a direct human one: DSH's runtime-context snapshot, the
 * skill catalogue, the agent-instruction baseline, tool-job notices, an agent
 * message, a webhook delivery, a goal continuation, and equally a message whose
 * `source` was missing or malformed. An unrecognised kind is refused rather than
 * guessed at, so a future producer cannot silently become "the user's prompt".
 *
 * `empty-prompt` is a direct-human message whose text is only whitespace. It is
 * not a source mismatch — the operator really did send it — but it is not a
 * prompt either, and it must neither claim nor replace one.
 *
 * Both are counted rather than silently dropped: a change in what DSH injects as
 * a user message would otherwise re-attribute prompts with nothing in the log to
 * show for it.
 */
export type UserTextRejection = 'non-user-source' | 'empty-prompt'

/** One turn's prompt attribution, as the handler tracks it. */
interface PromptAttribution {
  /**
   * Whether the turn has taken a direct-human prompt.
   *
   * This is not a reserved slot: a later direct-human message replaces the text.
   * The flag exists so that the pre-turn buffer cannot overwrite a prompt the
   * turn has already taken, and so that "this turn has an attribution" is one
   * explicit fact rather than an inference from a non-empty string.
   */
  hasDirectPrompt: boolean
}

/** Counters the handler keeps for observability. */
interface HandlerCounters {
  eventsSeen: number
  candidatesProduced: number
  suppressed: Record<string, number>
  enqueued: number
  enqueueRejected: number
  subagentSkipped: number
  /** Question calls observed, whether or not they produced a notification. */
  questionCallsObserved: number
  /** Approval asks observed, whether or not they produced a notification. */
  approvalAsksObserved: number
  /** Interaction observations that could not be parsed into anything sendable. */
  attentionUnparsable: number
  /** User-role messages that were not the turn's prompt, by reason. */
  userMessagesRejected: Partial<Record<UserTextRejection, number>>
}

/**
 * How long a collected user prompt stays eligible for the turn that follows it.
 *
 * The runtime writes `user/message` before the turn it belongs to opens — and,
 * since session format v4, may also write it *after* the turn has opened. The
 * bound keeps a prompt from attaching to a turn that starts much later for an
 * unrelated reason.
 */
export const PENDING_USER_TEXT_TTL_MS = 120_000

/**
 * Build the session handlers.
 *
 * @param options - resolved configuration, logger, queue, dedupe cache, clock.
 * @returns the handler pair plus its lifecycle helpers.
 */
export function createSessionHandlers(options: EventHandlerOptions): SessionHandlers {
  const { config, logger, queue, dedupe } = options
  const now = options.now ?? (() => Date.now())
  const store = new TurnStateStore()

  /**
   * A direct-human prompt collected before its turn opened, by session.
   *
   * Only a message whose `source.kind` is exactly `user` is ever held here: an
   * injected context message that arrives while the session is idle is refused
   * and counted, because it is not a prompt that a later turn is waiting for.
   *
   * `includeUserPrompt`'s collection always runs and only its rendering is
   * switched, so the collection path has one shape rather than two (D012).
   */
  const pendingUserText = new Map<string, { text: string; at: number }>()

  /**
   * Whether each open turn has taken its prompt, by session then turn.
   *
   * ## The rule this map serves
   *
   * DSH writes a user-role message for the operator's prompt and for every piece
   * of context it injects, and an injected message's text can sit in the same
   * `user/message` event type with no turn number of its own. Position therefore
   * carries no information: an implementation that took the first non-whitespace
   * user message of a turn, or the last one, would be encoding an ordering DSH
   * does not promise, and would render platform boilerplate wherever the
   * operator's words belong (or lose the prompt entirely) as soon as that
   * ordering changed.
   *
   * What does distinguish them is `source.kind`. `MessageSourceMap` declares
   * `user: { kind: 'user' }` for a direct human message, and each other producer
   * declares its own kind by module augmentation — `runtime-context`,
   * `skill-catalog`, `agent-instructions`, `tool-jobs`, `goal`, `agent-message`,
   * `subagent-settled`, and the browser prompt path `user-rpc`, which sets
   * `kind: 'user'` because it is a human typing. So:
   *
   * - a message with `sourceKind === 'user'` is the prompt, and the most recent
   *   one in the turn wins, because a second direct message is a correction;
   * - a message with any other or absent `sourceKind` never claims and never
   *   replaces the prompt, whatever its text and whenever it arrives.
   *
   * ## The invariance this buys
   *
   * The result depends only on `source.kind`, so it is unchanged if DSH reorders
   * its injected context, or starts emitting a new injection kind. That property
   * is a requirement, not an accident: any future edit here that reintroduces a
   * positional or counting rule breaks the contract this module exists to hold,
   * and the reordering tests in `tests/unit/prompt-attribution.test.ts` fail on
   * exactly that change.
   *
   * The record is per `(session, turn)` and is dropped when the turn is released,
   * so it cannot grow with a session's lifetime.
   */
  const promptAttribution = new Map<string, Map<number, PromptAttribution>>()

  /** This session's per-turn attribution records. */
  const attributionOf = (sessionId: string): Map<number, PromptAttribution> => {
    const existing = promptAttribution.get(sessionId)
    if (existing !== undefined) return existing
    const created = new Map<number, PromptAttribution>()
    promptAttribution.set(sessionId, created)
    return created
  }

  /** Forget one turn's attribution, and the session's map once it is empty. */
  const releaseAttribution = (sessionId: string, turn: number): void => {
    const turns = promptAttribution.get(sessionId)
    if (turns === undefined) return
    turns.delete(turn)
    if (turns.size === 0) promptAttribution.delete(sessionId)
  }

  const counters: HandlerCounters = {
    eventsSeen: 0,
    candidatesProduced: 0,
    suppressed: {},
    enqueued: 0,
    enqueueRejected: 0,
    subagentSkipped: 0,
    questionCallsObserved: 0,
    approvalAsksObserved: 0,
    attentionUnparsable: 0,
    userMessagesRejected: {},
  }

  /**
   * Attach a held prompt to a turn, if one is waiting and still fresh.
   *
   * The buffer holds a direct-human prompt that arrived before its turn opened.
   * A prompt the turn takes later replaces the seeded text, which is why seeding
   * only marks attribution rather than protecting it: the newest direct-human
   * message of the turn is the prompt, whether it arrived before or after
   * `turn/start`.
   *
   * @param sessionId - the session whose held text may apply.
   * @param turn - the turn being seeded.
   * @param state - the turn's state, written to in place.
   */
  const seedUserText = (sessionId: string, turn: number, state: { lastUserText?: string }): void => {
    const pending = pendingUserText.get(sessionId)
    if (pending === undefined) return
    // The held prompt is consumed by whichever comes first: a turn that takes it,
    // or its own expiry. Expiry is therefore evaluated before the early return
    // below, because an entry left by a turn that already took a direct prompt
    // would otherwise never be examined again and would stay resident for the
    // life of the session — the one place this module could retain text
    // indefinitely.
    if (now() - pending.at > PENDING_USER_TEXT_TTL_MS) {
      pendingUserText.delete(sessionId)
      return
    }
    const turns = attributionOf(sessionId)
    // The flag is read, not merely the key: a turn that has already taken a
    // direct prompt must not have it overwritten by the pre-turn buffer.
    if (turns.get(turn)?.hasDirectPrompt === true) return
    turns.set(turn, { hasDirectPrompt: true })
    state.lastUserText = pending.text
  }

  /**
   * Offer one user-role message to a turn as its prompt.
   *
   * Selection is by `source.kind`, never by position. Only the exact direct-human
   * kind is accepted; every other kind, and an absent or malformed one, is
   * refused before its text is even examined. A message that is accepted either
   * becomes the turn's prompt — replacing an earlier one, because the most recent
   * direct-human message is the current one — or, when no turn is open yet, is
   * held for the turn that opens next.
   *
   * @param sessionId - the session the message arrived in.
   * @param turn - the open turn it belongs to, or `undefined` when none is open.
   * @param text - the message's text.
   * @param sourceKind - the payload's `MessageSource.kind`, when it had one.
   * @returns `undefined` when the message was taken or held, or why it was not.
   */
  const offerUserText = (
    sessionId: string,
    turn: number | undefined,
    text: string,
    sourceKind: string | undefined,
  ): UserTextRejection | undefined => {
    // Injected context, goal continuations, agent messages, and a source that
    // was missing or malformed all stop here. An unknown kind is not a licence
    // to guess, which is what keeps a future DSH producer from silently taking
    // the operator's place in the mail.
    if (sourceKind !== DIRECT_HUMAN_SOURCE_KIND) return 'non-user-source'
    // A whitespace-only message is not a prompt and must not claim the turn
    // either: doing so would let an empty first message lock out the real prompt
    // that follows it, which is worse than rendering nothing.
    const prompt = text.trim()
    if (prompt === '') return 'empty-prompt'
    if (turn === undefined) {
      // No turn is open yet, so the prompt is held — bounded by the TTL — for the
      // turn that opens next. This is the only path that holds text at all.
      pendingUserText.set(sessionId, { text: prompt, at: now() })
      return undefined
    }
    attributionOf(sessionId).set(turn, { hasDirectPrompt: true })
    store.stateOf(sessionId, turn).lastUserText = prompt
    return undefined
  }

  /**
   * Record one refused user-role message under its reason.
   *
   * The refused text itself is never logged, only its length, and the kind is a
   * producer name rather than payload: that is enough for an operator to see
   * *which* injection took the slot that `includeUserPrompt` would have rendered
   * without putting session content into the log (§13).
   *
   * @param sessionId - the session the message arrived in.
   * @param turn - the turn it addressed, when one was known.
   * @param rejection - why it was refused.
   * @param sourceKind - the producer kind, when the payload carried one.
   * @param textLength - the message's length in UTF-16 units.
   */
  const noteUserTextRejection = (
    sessionId: string,
    turn: number | undefined,
    rejection: UserTextRejection,
    sourceKind: string | undefined,
    textLength: number,
  ): void => {
    counters.userMessagesRejected[rejection] = (counters.userMessagesRejected[rejection] ?? 0) + 1
    logger.debug('prompt.attribution-rejected', {
      sessionId,
      turn: turn ?? null,
      reason: rejection,
      sourceKind: sourceKind ?? null,
      textLength,
    })
  }

  /**
   * Attribute one user-role message to a turn, counting a refusal when it loses.
   *
   * @param sessionId - the session the message arrived in.
   * @param turn - the turn it addresses, or `undefined` when none is open.
   * @param text - the message's text.
   * @param sourceKind - the payload's `MessageSource.kind`, when it had one.
   */
  const attributeUserText = (
    sessionId: string,
    turn: number | undefined,
    text: string,
    sourceKind: string | undefined,
  ): void => {
    const rejected = offerUserText(sessionId, turn, text, sourceKind)
    if (rejected === undefined) return
    noteUserTextRejection(sessionId, turn, rejected, sourceKind, text.length)
  }

  /** Accumulate one internal event into turn state. */
  const accumulate = (sessionId: string, event: InternalEvent): void => {
    switch (event.kind) {
      case 'turn-start': {
        // The one place a real start time exists. If lazy initialization already
        // created the entry, patch it in place and keep the accumulated counts.
        const state = store.stateOf(sessionId, event.turn)
        state.sawTurnStart = true
        state.telemetryComplete = true
        state.startAt = event.timeMs
        seedUserText(sessionId, event.turn, state)
        return
      }
      case 'step-start': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, event.turn, state)
        store.markStep(sessionId, event.turn, event.step)
        // The runtime's announcement that this step will make a model call. The
        // announcement is what makes a missing usage report detectable at all.
        state.usage.noteStepStarted(event.step)
        return
      }
      case 'assistant-message': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, event.turn, state)
        state.assistantEvents += 1
        store.markStep(sessionId, event.turn, event.step)
        const visible = extractVisibleText(event.blocks)
        // An empty result must not overwrite an earlier message's text. A
        // reasoning-only message therefore cannot erase the last real answer.
        if (visible !== '') {
          state.lastVisibleAssistantText = visible
          if (event.messageId !== undefined) state.lastAssistantMessageId = event.messageId
        }
        if (event.provider !== undefined) state.provider = event.provider
        if (event.model !== undefined) state.model = event.model
        // Folded, not assigned: this message is one model call of the turn, and
        // the last one was never the turn's total (D017).
        state.usage.addSettlement({
          kind: 'message',
          step: event.step,
          ...(event.seq !== undefined ? { seq: event.seq } : {}),
          ...(event.messageId !== undefined ? { messageId: event.messageId } : {}),
          timeMs: event.timeMs,
          usage: event.usage,
        })
        return
      }
      case 'assistant-attempt': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, event.turn, state)
        store.markStep(sessionId, event.turn, event.step)
        // A model call that produced no surface message. It is still an
        // accountable call: with no usage in its stream it becomes a counted
        // gap rather than an invisible one.
        state.usage.addSettlement({
          kind: 'attempt',
          step: event.step,
          ...(event.seq !== undefined ? { seq: event.seq } : {}),
          timeMs: event.timeMs,
          usage: event.usage,
        })
        return
      }
      case 'llm-retry': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, event.turn, state)
        state.usage.noteRetry({
          step: event.step,
          ...(event.seq !== undefined ? { seq: event.seq } : {}),
          timeMs: event.timeMs,
        })
        return
      }
      case 'tool-call': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, event.turn, state)
        state.toolCallCount += 1
        store.markStep(sessionId, event.turn, event.step)
        return
      }
      case 'tool-result': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, event.turn, state)
        state.toolResultCount += 1
        if (event.explicitError) state.explicitToolErrorCount += 1
        store.markStep(sessionId, event.turn, event.step)
        return
      }
      case 'turn-end':
        // Counters are not updated at turn end; settlement reads them.
        return
      default:
        return
    }
  }

  /** Build the candidate for one settled turn. */
  const buildCandidate = (
    sessionId: string,
    turn: number,
    event: Extract<InternalEvent, { kind: 'turn-end' }>,
    cwd: string | undefined,
  ): { candidate: NotificationCandidate; dropped: readonly string[] } => {
    const state = store.stateOf(sessionId, turn)
    const result = createCandidate(state, {
      sessionId,
      turnEndKind: event.turnEndKind,
      ...(event.detail !== undefined ? { turnEndDetail: event.detail } : {}),
      ...(event.reasonDetail !== undefined ? { reasonDetail: event.reasonDetail } : {}),
      ...(event.failure !== undefined ? { failure: event.failure } : {}),
      createdAt: now(),
      endTimeMs: event.timeMs,
      ...(cwd !== undefined ? { cwd } : {}),
      includeUserText: config.render.includeUserPrompt,
    })
    return { candidate: result.value, dropped: result.dropped }
  }

  /** Record a suppression under its reason, so absences stay visible. */
  const noteSuppressed = (reason: string): void => {
    counters.suppressed[reason] = (counters.suppressed[reason] ?? 0) + 1
  }

  /**
   * Enqueue one notification, marking its dedupe key only on acceptance.
   *
   * One path for all three notification families, so the accepted-enqueue rule
   * cannot drift between them: a refused job leaves no mark and stays eligible,
   * and a rejection is counted rather than dropped in silence.
   *
   * @param key - the namespaced dedupe key for this notification.
   * @param notification - the envelope to deliver.
   * @param truncated - whether the turn's visible text was cut.
   * @param subjectFields - log scalars identifying the notification.
   */
  const enqueueNotification = (
    key: string,
    notification: Notification,
    truncated: boolean,
    subjectFields: Record<string, unknown>,
  ): void => {
    const job: MailJob = { notification, to: config.smtp.to, truncated }

    if (!queue.enqueue(job)) {
      counters.enqueueRejected += 1
      logger.warn('notification.rejected', {
        ...subjectFields,
        queueDepth: queue.stats().depth,
        droppedCount: queue.stats().droppedCount,
      })
      return
    }

    dedupe.mark(key)
    counters.enqueued += 1
    logger.info('notification.enqueued', {
      ...subjectFields,
      queueDepth: queue.stats().depth,
      truncated,
    })
  }

  const onSessionEvent = (session: SessionLike, event: SessionEventLike): void => {
    counters.eventsSeen += 1

    const internal = toInternalEvent(event)
    if (internal.kind === 'other') return

    // Subagents are excluded before any state exists, so an excluded session
    // costs no memory at all. `session/disposed` still runs for it; that path
    // simply finds nothing to release. The exclusion covers every notification
    // family, so a subagent's question or approval never mails unless the
    // operator opted in.
    const facts = toSessionFacts(session)
    if (facts.isSubagent && !config.policy.includeSubagents) {
      if (internal.kind === 'turn-end') {
        counters.subagentSkipped += 1
        noteSuppressed('subagent-excluded')
        logger.debug('turn.subagent-skipped', {
          sessionId: facts.sessionId,
          turn: internal.turn,
          decidedBy: facts.decidedBy ?? null,
        })
      }
      return
    }

    if (internal.kind === 'user-message') {
      // Collected for every session in scope and rendered only under
      // `includeUserPrompt`, so the collection path has one shape (D012).
      //
      // Which turn owns the message is positional; which message is the prompt is
      // not. A numbered message belongs to its own turn, an unnumbered one to the
      // turn that is currently open, and — only when it is a direct human prompt —
      // an unnumbered message arriving with no turn open is held for the next one.
      // Everything else is refused by kind, so an injected context message that
      // arrives while the session is idle cannot become the next turn's prompt.
      attributeUserText(
        facts.sessionId,
        internal.turn ?? store.currentTurn(facts.sessionId),
        internal.text,
        internal.sourceKind,
      )
      return
    }

    if (internal.kind === 'tool-call') {
      // Accumulated first so `toolCallCount` counts every call, questions
      // included; then observed, because a question call is a mid-turn attention
      // event rather than turn telemetry.
      accumulate(facts.sessionId, internal)
      observeToolCall(facts.sessionId, facts.cwd, internal)
      return
    }

    if (internal.kind !== 'turn-end') {
      accumulate(facts.sessionId, internal)
      return
    }

    // Settlement. Every exit path below releases the turn entry: a suppressed
    // turn that stayed resident would be an unbounded leak.
    const settled = store.stateOf(facts.sessionId, internal.turn)
    const { candidate, dropped } = buildCandidate(facts.sessionId, internal.turn, internal, facts.cwd)
    counters.candidatesProduced += 1
    logger.info('candidate.produced', {
      schemaVersion: candidate.schemaVersion,
      sessionId: candidate.sessionId,
      turn: candidate.turn,
      status: candidate.status,
      turnEndKind: candidate.turnEndKind,
      visibleTextLength: candidate.visibleTextLength,
      explicitToolErrorCount: candidate.explicitToolErrorCount,
      telemetryComplete: candidate.telemetryComplete,
      durationMs: candidate.durationMs ?? null,
      provider: candidate.provider ?? null,
      model: candidate.model ?? null,
      sawTurnStart: candidate.sawTurnStart ?? null,
      // The failure code and status are structured, bounded scalars; the failure
      // message is provider text and stays in the mail body, never in the log
      // (SECURITY.md §8).
      failureCode: candidate.failure?.code ?? null,
      failureStatus: candidate.failure?.status ?? null,
      // Telemetry shape only: sample counts and the completeness verdict are
      // safe scalars, while the counters themselves stay in the mail body and
      // out of the log (SECURITY.md §4).
      usageSampleCount: candidate.usageSampleCount,
      usageMissingCount: candidate.usageMissingCount,
      usageUnobservableRetries: candidate.usageUnobservableRetries,
      usageComplete: candidate.usageComplete,
      steps: settled.steps,
      normalizeDropped: dropped.length,
    })

    try {
      settleTurn(facts.sessionId, candidate)
    } finally {
      store.release(facts.sessionId, internal.turn)
      releaseAttribution(facts.sessionId, internal.turn)
      pendingUserText.delete(facts.sessionId)
    }
  }

  /** Apply policy, then enqueue and mark — marking only on an accepted enqueue. */
  const settleTurn = (sessionId: string, candidate: NotificationCandidate): void => {
    const key = DedupeCache.keyFor(sessionId, candidate.turn)
    const decision = decideNotification(candidate, config, dedupe.has(key))
    if (!decision.notify) {
      noteSuppressed(decision.reason)
      logger.info('notification.suppressed', {
        notificationKind: 'turn',
        sessionId,
        turn: candidate.turn,
        status: candidate.status,
        suppressedReason: decision.reason,
        detail: decision.detail ?? null,
      })
      return
    }

    enqueueNotification(
      key,
      { kind: 'turn', candidate },
      Array.from(candidate.visibleText).length > config.render.maxBodyChars,
      { notificationKind: 'turn', sessionId, turn: candidate.turn, status: candidate.status },
    )
  }

  /**
   * Turn one observed `tool/call` into a question notification, if it is one.
   *
   * The exact tool-name comparison happens before the arguments value is looked
   * at, and the value is then handed straight to the parser: this function never
   * inspects it, never logs it, and never stores it. A call whose name is not
   * `ask_user_question` — `bash`, `pwsh`, `fs`, `web`, `subagent`, anything —
   * returns here with its arguments untouched and unread (§12).
   *
   * The notification is built and enqueued immediately, without waiting for
   * `tool/result`, `turn/end`, or the human's answer. That is the point: DSH is
   * blocked on the human right now, which is exactly when the mail is useful
   * (§16).
   *
   * @param sessionId - the owning session.
   * @param cwd - the workspace directory, when the session header carried one.
   * @param event - the observed call.
   */
  const observeToolCall = (
    sessionId: string,
    cwd: string | undefined,
    event: Extract<InternalEvent, { kind: 'tool-call' }>,
  ): void => {
    if (event.name !== QUESTION_TOOL_NAME) return
    counters.questionCallsObserved += 1

    const parsed: QuestionParseResult = parseAskUserQuestionArguments(event.rawArguments)
    if (parsed.questions.length === 0) {
      counters.attentionUnparsable += 1
      logger.info('question.unparsable', {
        sessionId,
        turn: event.turn,
        step: event.step,
        // Counts and reasons only. Neither the argument string nor any fragment
        // of it may appear here (§13, §36).
        dropReason: parsed.dropReason ?? 'unknown',
        argumentsReadable: parsed.argumentsReadable,
      })
      return
    }

    const payload: QuestionNotification = {
      kind: 'question',
      sessionId,
      turn: event.turn,
      step: event.step,
      ...(event.callId !== undefined ? { callId: event.callId } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      observedAt: now(),
      questions: parsed.questions,
      droppedQuestions: parsed.droppedQuestions,
      ...(parsed.argumentsReadable ? {} : { argumentsUnreadable: true }),
    }

    const key = DedupeCache.questionKeyFor(sessionId, event.callId, event.turn, event.step)
    const decision = decideQuestionNotification(config, dedupe.has(key))
    if (!decision.notify) {
      noteSuppressed(decision.reason)
      logger.info('notification.suppressed', {
        notificationKind: 'question',
        sessionId,
        turn: event.turn,
        step: event.step,
        suppressedReason: decision.reason,
        detail: decision.detail ?? null,
      })
      return
    }

    enqueueNotification(key, payload, false, {
      notificationKind: 'question',
      sessionId,
      turn: event.turn,
      step: event.step,
      questionCount: payload.questions.length,
      droppedQuestions: payload.droppedQuestions,
      droppedFieldCount: parsed.droppedFields.length,
    })
  }

  /**
   * Observe one `approval/asked` audit event and notify the operator.
   *
   * `approval/decided` is deliberately not handled: its arrival means the human
   * already acted, and a second "you are needed" mail at that point would be
   * false. This phase sends no "you approved it" status mail either (§32).
   *
   * @param session - the live session, viewed structurally.
   * @param data - the raw audit payload; its shape is not trusted.
   */
  const onApprovalAsked = (session: SessionLike, data: unknown): void => {
    counters.approvalAsksObserved += 1

    const facts = toSessionFacts(session)
    if (facts.isSubagent && !config.policy.includeSubagents) {
      noteSuppressed('subagent-excluded')
      logger.debug('approval.subagent-skipped', { sessionId: facts.sessionId, decidedBy: facts.decidedBy ?? null })
      return
    }

    const observation = toApprovalObservation(session, data, now())
    if (observation === undefined) {
      counters.attentionUnparsable += 1
      // The audit payload carried no usable tool name. Nothing else in it is
      // read, so no reason, argument, or identifier reaches the log.
      logger.info('approval.unusable', { sessionId: facts.sessionId })
      return
    }

    const { notification } = observation
    // The service-issued approval id is the identity anchor, read from the raw
    // payload rather than taken from the notification: the notification
    // deliberately carries no request identity, so nothing downstream can render
    // one. The fallback keeps a re-observed append of the same event
    // deduplicated even when the id was unusable.
    const approvalId = readApprovalId(data) ?? `tool:${notification.toolName}`
    const key = DedupeCache.approvalKeyFor(facts.sessionId, approvalId)
    const decision = decideApprovalNotification(config, dedupe.has(key))
    if (!decision.notify) {
      noteSuppressed(decision.reason)
      logger.info('notification.suppressed', {
        notificationKind: 'approval',
        sessionId: facts.sessionId,
        toolName: notification.toolName,
        suppressedReason: decision.reason,
        detail: decision.detail ?? null,
      })
      return
    }

    enqueueNotification(key, notification, false, {
      notificationKind: 'approval',
      sessionId: facts.sessionId,
      toolName: notification.toolName,
      hasReason: notification.reason !== undefined,
      hasCallId: notification.callId !== undefined,
    })
  }

  const onSessionDisposed = (session: SessionLike): void => {
    const sessionId = toSessionId(session)
    const released = store.releaseSession(sessionId)
    pendingUserText.delete(sessionId)
    logger.debug('session.disposed', { sessionId, released })
  }

  return {
    onSessionEvent,
    onSessionDisposed,
    onApprovalAsked,
    stateSizes: () => store.sizes(),
    clear: () => {
      store.clear()
      pendingUserText.clear()
      logger.debug('handler.cleared', { ...counters })
    },
  }
}

/**
 * Read the approval request id out of a raw audit payload.
 *
 * Kept as a narrow standalone helper rather than folded into the payload
 * adapter, because the id is a dedupe identity and not mail content: the adapter
 * deliberately drops it, so nothing downstream can render one by accident.
 *
 * @param data - the raw `approval/asked` payload; its shape is not trusted.
 * @returns the id as a bounded string, or `undefined` when it was unusable.
 */
function readApprovalId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const raw = (data as Record<string, unknown>)['id']
  if (typeof raw === 'string') return raw === '' ? undefined : Array.from(raw).slice(0, 200).join('')
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return undefined
}
