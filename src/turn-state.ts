/**
 * `TurnState` lifecycle and candidate construction.
 *
 * The two creation paths — a real `turn/start`, and lazy initialization on any
 * other event carrying a turn number — share one accessor. That sharing is the
 * point: the Phase 1 prototype's worst defect was a `turn/end` fallback that
 * built an empty state, which reported a turn with 44 steps and a real tool
 * error as `completed-clean` with zeroed counters. A classification error, not
 * merely missing statistics.
 *
 * @module dsh-mail-notify/turn-state
 */

import { classifyCompletion, sanitizeDetail } from './completion.ts'
import { normalize } from './normalize.ts'
import { TurnUsageAccounting } from './telemetry.ts'
import type { NormalizeResult, NotificationCandidate, TurnEndKind, TurnState } from './types.ts'

/**
 * Mutable per-session state container.
 *
 * `Set` semantics for the step index matter: `steps` is the count of distinct
 * step numbers observed, which is not the highest step number when the plugin
 * attached mid-turn and missed the first steps.
 */
export class TurnStateStore {
  private readonly sessions = new Map<string, Map<number, TurnState>>()
  private readonly stepsSeen = new Map<string, Set<number>>()

  /**
   * Fetch the state for one turn, creating it lazily when absent.
   *
   * @param sessionId - the owning session.
   * @param turn - the turn number from the event.
   * @returns the live state entry, already registered.
   */
  stateOf(sessionId: string, turn: number): TurnState {
    let turns = this.sessions.get(sessionId)
    if (turns === undefined) {
      turns = new Map<number, TurnState>()
      this.sessions.set(sessionId, turns)
    }
    let state = turns.get(turn)
    if (state === undefined) {
      state = createTurnState(turn)
      turns.set(turn, state)
    }
    return state
  }

  /** Whether a state entry exists for one `(sessionId, turn)` pair. */
  has(sessionId: string, turn: number): boolean {
    return this.sessions.get(sessionId)?.has(turn) === true
  }

  /**
   * Record a distinct step number for one turn.
   *
   * @param sessionId - the owning session.
   * @param turn - the turn number.
   * @param step - the step number reported by the runtime.
   */
  markStep(sessionId: string, turn: number, step: number): void {
    const key = `${sessionId}:${turn}`
    let seen = this.stepsSeen.get(key)
    if (seen === undefined) {
      seen = new Set<number>()
      this.stepsSeen.set(key, seen)
    }
    if (seen.has(step)) return
    seen.add(step)
    this.stateOf(sessionId, turn).steps = seen.size
  }

  /**
   * Release one turn entry, collapsing the session map when it empties.
   *
   * Called after every `turn/end` settlement — including suppressed and
   * short-circuited ones — so a suppressed turn cannot linger forever.
   *
   * @param sessionId - the owning session.
   * @param turn - the turn to release.
   * @returns the state that was released, when there was one.
   */
  release(sessionId: string, turn: number): TurnState | undefined {
    this.stepsSeen.delete(`${sessionId}:${turn}`)
    const turns = this.sessions.get(sessionId)
    if (turns === undefined) return undefined
    const state = turns.get(turn)
    turns.delete(turn)
    if (turns.size === 0) this.sessions.delete(sessionId)
    return state
  }

  /**
   * Release every turn of one session; the `session/disposed` path.
   *
   * @param sessionId - the session leaving the store.
   * @returns whether anything was released.
   */
  releaseSession(sessionId: string): boolean {
    const turns = this.sessions.get(sessionId)
    let released = turns !== undefined
    if (turns !== undefined) {
      for (const turn of turns.keys()) this.stepsSeen.delete(`${sessionId}:${turn}`)
      this.sessions.delete(sessionId)
    }
    for (const key of this.stepsSeen.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.stepsSeen.delete(key)
        released = true
      }
    }
    return released
  }

  /** Release everything; the plugin-dispose path. */
  clear(): void {
    this.sessions.clear()
    this.stepsSeen.clear()
  }

  /**
   * Observable sizes, for tests and for the bounded-growth assertion.
   *
   * @returns the current entry counts at each level.
   */
  sizes(): { sessions: number; turns: number; stepSets: number } {
    let turns = 0
    for (const inner of this.sessions.values()) turns += inner.size
    return { sessions: this.sessions.size, turns, stepSets: this.stepsSeen.size }
  }
}

/**
 * Create a state entry.
 *
 * @param turn - the turn number.
 * @param sawTurnStart - whether this turn's `turn/start` was observed.
 * @param startAt - the observed start time, present only on the normal path.
 * @returns a zeroed state.
 */
export function createTurnState(turn: number, sawTurnStart = false, startAt?: number): TurnState {
  const state: TurnState = {
    turn,
    sawTurnStart,
    telemetryComplete: sawTurnStart,
    lastVisibleAssistantText: '',
    steps: 0,
    assistantEvents: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    explicitToolErrorCount: 0,
    usage: new TurnUsageAccounting(),
  }
  if (startAt !== undefined) state.startAt = startAt
  return state
}

/** Settlement facts supplied by the event handler at `turn/end`. */
export interface CandidateInput {
  sessionId: string
  turnEndKind: TurnEndKind
  turnEndDetail?: string
  reasonDetail?: string
  /** Epoch ms at which the candidate is constructed. */
  createdAt: number
  /** Epoch ms of the `turn/end` event, used to derive the duration. */
  endTimeMs: number
  cwd?: string
  /** Whether the collected user prompt should be carried on the candidate. */
  includeUserText?: boolean
}

/**
 * Build a schema-v2 candidate from one settled turn.
 *
 * Optional keys are written only when a value exists, so `'key' in candidate`
 * is a truthful presence test and `durationMs: null` stays distinguishable from
 * an absent `durationMs`. The result also passes through the lossless-JSON
 * normalizer: the runtime data behind these fields is untyped, and a single
 * unreadable value must not escape the plugin.
 *
 * `usage` is the turn-level aggregate of the per-call samples folded while the
 * turn was open, and it is accompanied by the coverage counters that say how
 * much of the turn those samples cover (D017). Version 1 reported the last
 * observed per-call sample under the same key, which readers could not tell
 * apart from a turn aggregate; the version bump is what makes the difference
 * visible (D013).
 *
 * @param state - the accumulated turn state.
 * @param input - settlement facts.
 * @returns the candidate and the paths normalization had to omit.
 */
export function createCandidate(state: TurnState, input: CandidateInput): NormalizeResult<NotificationCandidate> {
  const status = classifyCompletion(input.turnEndKind, state.explicitToolErrorCount)
  const telemetry = state.usage.snapshot(state.sawTurnStart)

  const draft: NotificationCandidate = {
    schemaVersion: 2,
    sessionId: input.sessionId,
    turn: state.turn,
    status,
    turnEndKind: input.turnEndKind,
    visibleText: state.lastVisibleAssistantText,
    visibleTextLength: Array.from(state.lastVisibleAssistantText).length,
    explicitToolErrorCount: state.explicitToolErrorCount,
    telemetryComplete: state.telemetryComplete,
    usageSampleCount: telemetry.sampleCount,
    usageMissingCount: telemetry.missingCount,
    usageUnobservableRetries: telemetry.unobservableRetries,
    usageComplete: telemetry.complete,
    createdAt: input.createdAt,
  }

  const turnEndDetail = sanitizeDetail(input.turnEndDetail, 120)
  if (turnEndDetail !== undefined) draft.turnEndDetail = turnEndDetail
  const reasonDetail = sanitizeDetail(input.reasonDetail)
  if (reasonDetail !== undefined) draft.reasonDetail = reasonDetail
  if (state.provider !== undefined) draft.provider = state.provider
  if (state.model !== undefined) draft.model = state.model
  if (state.lastAssistantMessageId !== undefined) draft.assistantMessageId = state.lastAssistantMessageId
  // `null` is an observation ("unknown"), not a missing value, so it is always
  // written. `turn/start` is the only proof of a start time; without it the
  // duration is unrecoverable and must not be fabricated as `0` (D004).
  draft.durationMs = state.sawTurnStart && state.startAt !== undefined ? input.endTimeMs - state.startAt : null
  if (telemetry.usage !== undefined) draft.usage = telemetry.usage
  if (input.cwd !== undefined) draft.cwd = input.cwd
  if (input.includeUserText === true && state.lastUserText !== undefined) draft.userText = state.lastUserText
  draft.sawTurnStart = state.sawTurnStart

  return normalize<NotificationCandidate>(draft)
}
