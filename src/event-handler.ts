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
import type { MailQueue } from './queue.ts'
import type { PluginLogger } from './logger.ts'
import type { DedupeCache } from './notifier.ts'
import { decideNotification } from './notifier.ts'
import { toInternalEvent, toSessionFacts, toSessionId, type SessionEventLike, type SessionLike } from './runtime-adapter.ts'
import { createCandidate, TurnStateStore } from './turn-state.ts'
import type { InternalEvent, MailJob, NotificationCandidate, ResolvedConfig } from './types.ts'

/** Dependencies the handler needs. */
export interface EventHandlerOptions {
  config: ResolvedConfig
  logger: PluginLogger
  queue: MailQueue
  dedupe: DedupeCache
  /** Injected for deterministic tests; defaults to `Date.now`. */
  now?: () => number
}

/** The listener pair `index.ts` registers on the plugin's fiber. */
export interface SessionHandlers {
  onSessionEvent(session: SessionLike, event: SessionEventLike): void
  onSessionDisposed(session: SessionLike): void
  /** Turn-map sizes, for lifecycle assertions. */
  stateSizes(): { sessions: number; turns: number; stepSets: number }
  /** Release every retained turn; called from the plugin's disposer. */
  clear(): void
}

/** Counters the handler keeps for observability. */
interface HandlerCounters {
  eventsSeen: number
  candidatesProduced: number
  suppressed: Record<string, number>
  enqueued: number
  enqueueRejected: number
  subagentSkipped: number
}

/**
 * How long a collected user prompt stays eligible for the turn that follows it.
 *
 * The runtime writes `user/message` before the turn it belongs to opens, so the
 * text has to be held briefly. The bound keeps a prompt from attaching to a
 * turn that starts much later for an unrelated reason.
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
   * User text collected before its turn opened, by session.
   *
   * `includeUserPrompt`'s collection always runs and only its rendering is
   * switched, so the collection path has one shape rather than two (D012).
   */
  const pendingUserText = new Map<string, { text: string; at: number }>()

  const counters: HandlerCounters = {
    eventsSeen: 0,
    candidatesProduced: 0,
    suppressed: {},
    enqueued: 0,
    enqueueRejected: 0,
    subagentSkipped: 0,
  }

  /** Attach a collected prompt to a turn, if one is waiting and still fresh. */
  const seedUserText = (sessionId: string, state: { lastUserText?: string }): void => {
    if (state.lastUserText !== undefined) return
    const pending = pendingUserText.get(sessionId)
    if (pending === undefined) return
    if (now() - pending.at > PENDING_USER_TEXT_TTL_MS) {
      pendingUserText.delete(sessionId)
      return
    }
    state.lastUserText = pending.text
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
        seedUserText(sessionId, state)
        return
      }
      case 'step-start': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, state)
        store.markStep(sessionId, event.turn, event.step)
        // The runtime's announcement that this step will make a model call. The
        // announcement is what makes a missing usage report detectable at all.
        state.usage.noteStepStarted(event.step)
        return
      }
      case 'assistant-message': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, state)
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
        seedUserText(sessionId, state)
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
        seedUserText(sessionId, state)
        state.usage.noteRetry({
          step: event.step,
          ...(event.seq !== undefined ? { seq: event.seq } : {}),
          timeMs: event.timeMs,
        })
        return
      }
      case 'tool-call': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, state)
        state.toolCallCount += 1
        store.markStep(sessionId, event.turn, event.step)
        return
      }
      case 'tool-result': {
        const state = store.stateOf(sessionId, event.turn)
        seedUserText(sessionId, state)
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

  const onSessionEvent = (session: SessionLike, event: SessionEventLike): void => {
    counters.eventsSeen += 1

    const internal = toInternalEvent(event)
    if (internal.kind === 'other') return

    // Subagents are excluded before any state exists, so an excluded session
    // costs no memory at all. `session/disposed` still runs for it; that path
    // simply finds nothing to release.
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
      // `includeUserPrompt`, so the collection path has one shape. A message that
      // already names its turn is written straight onto that turn's state; one
      // that does not is held for the turn that opens next.
      if (internal.turn !== undefined) {
        const state = store.stateOf(facts.sessionId, internal.turn)
        if (internal.text !== '') state.lastUserText = internal.text
        return
      }
      if (internal.text !== '') pendingUserText.set(facts.sessionId, { text: internal.text, at: now() })
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
      pendingUserText.delete(facts.sessionId)
    }
  }

  /** Apply policy, then enqueue and mark — marking only on an accepted enqueue. */
  const settleTurn = (sessionId: string, candidate: NotificationCandidate): void => {
    const key = `${sessionId}:${candidate.turn}`
    const decision = decideNotification(candidate, config, dedupe.has(key))
    if (!decision.notify) {
      noteSuppressed(decision.reason)
      logger.info('notification.suppressed', {
        sessionId,
        turn: candidate.turn,
        status: candidate.status,
        suppressedReason: decision.reason,
        detail: decision.detail ?? null,
      })
      return
    }

    const job: MailJob = {
      candidate,
      to: config.smtp.to,
      truncated: Array.from(candidate.visibleText).length > config.render.maxBodyChars,
    }

    if (!queue.enqueue(job)) {
      // Refused at capacity. No dedupe mark is written, so this turn stays
      // eligible should it be delivered again, and the refusal is counted
      // rather than dropped in silence.
      counters.enqueueRejected += 1
      logger.warn('notification.rejected', {
        sessionId,
        turn: candidate.turn,
        status: candidate.status,
        queueDepth: queue.stats().depth,
        droppedCount: queue.stats().droppedCount,
      })
      return
    }

    dedupe.mark(key)
    counters.enqueued += 1
    logger.info('notification.enqueued', {
      sessionId,
      turn: candidate.turn,
      status: candidate.status,
      queueDepth: queue.stats().depth,
      truncated: job.truncated,
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
    stateSizes: () => store.sizes(),
    clear: () => {
      store.clear()
      pendingUserText.clear()
      logger.debug('handler.cleared', { ...counters })
    },
  }
}
