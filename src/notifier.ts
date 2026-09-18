/**
 * Notification policy: candidate in, send-or-suppress decision out.
 *
 * The decision order is part of the contract, because it determines which
 * `suppressedReason` an operator sees for a turn that satisfies several
 * suppression conditions at once. The other load-bearing detail is that the
 * deduplication mark is *not* written here: a suppressible turn must not
 * permanently occupy its key, or a later, legitimately different settlement of
 * the same turn would be swallowed as a duplicate.
 *
 * @module dsh-mail-notify/notifier
 */

import { policySwitchFor } from './subject.ts'
import type { NotificationCandidate, ResolvedConfig, SuppressionReason } from './types.ts'

/**
 * Bounded insertion-ordered key set implementing the dedupe cache.
 *
 * Insertion order is the recency order for this workload — one mark per settled
 * turn and, at most, one per observed interaction — so evicting the oldest key
 * needs no access bookkeeping, and the cache cannot grow without bound in a
 * long-lived process. The guarantee it provides is deliberately narrow: at most
 * one enqueue per key within one process lifetime. Nothing is persisted, so a
 * restarted DSH may notify a replayed turn or replayed call a second time
 * (D008).
 *
 * Since D018 the cache carries three independent namespaces, and the namespaces
 * are what keep the lifecycles apart. A `question:` key must not be able to
 * collide with the `turn:` key of the same `(sessionId, turn)`: the question
 * fires mid-turn while the turn is still open, and the turn's own completion or
 * failure notification must remain eligible after the human has answered.
 */
export class DedupeCache {
  private readonly keys = new Set<string>()
  private readonly capacity: number

  /** @param capacity - maximum retained keys; must be at least 1. */
  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity))
  }

  /**
   * Build the key for one settled turn.
   *
   * @param sessionId - the owning session.
   * @param turn - the turn number.
   * @returns the `turn:`-namespaced dedupe key.
   */
  static keyFor(sessionId: string, turn: number): string {
    return `turn:${sessionId}:${turn}`
  }

  /**
   * Build the key for one observed `ask_user_question` call.
   *
   * The DSH-issued `callId` is the primary identity, so two questions inside one
   * turn produce two keys and two mails, while a re-observed append of the same
   * call produces one. The `(turn, step)` pair is the fallback for the rare
   * payload that carried no call id.
   *
   * @param sessionId - the owning session.
   * @param callId - the durable tool-call id, when the event carried one.
   * @param turn - the turn number.
   * @param step - the step number.
   * @returns the `question:`-namespaced dedupe key.
   */
  static questionKeyFor(sessionId: string, callId: string | undefined, turn: number, step: number): string {
    return callId !== undefined
      ? `question:${sessionId}:${callId}`
      : `question:${sessionId}:t${turn}:s${step}`
  }

  /**
   * Build the key for one observed `approval/asked` event.
   *
   * @param sessionId - the owning session.
   * @param approvalId - the service-issued `ApprovalRequestId`.
   * @returns the `approval:`-namespaced dedupe key.
   */
  static approvalKeyFor(sessionId: string, approvalId: string): string {
    return `approval:${sessionId}:${approvalId}`
  }

  /**
   * Whether this key has already produced a queued job.
   *
   * @param key - a key from one of the `keyFor` builders.
   * @returns true when the key is marked.
   */
  has(key: string): boolean {
    return this.keys.has(key)
  }

  /**
   * Mark a key, evicting the oldest entry when at capacity.
   *
   * Called only after a job is known to have been accepted by the queue, so a
   * rejected enqueue leaves no mark behind and stays eligible for a later
   * attempt (D008).
   *
   * @param key - a key from one of the `keyFor` builders.
   */
  mark(key: string): void {
    if (this.keys.has(key)) return
    if (this.keys.size >= this.capacity) {
      const oldest = this.keys.values().next()
      if (!oldest.done) this.keys.delete(oldest.value)
    }
    this.keys.add(key)
  }

  /** Current retained key count. */
  get size(): number {
    return this.keys.size
  }

  /** Drop every key; the plugin-dispose path. */
  clear(): void {
    this.keys.clear()
  }
}

/** What to do with one candidate. */
export type NotifyDecision =
  | { notify: true }
  | { notify: false; reason: SuppressionReason; detail?: string }

/**
 * Apply the frozen policy order to one candidate.
 *
 * The order is: master switch, subagent scope, status switch, empty visible
 * text, duration floor, duplicate. `aborted`, `blocked`, `interrupted`, and the
 * defensive `unknown` have no enabling switch at all, so they always land on
 * `disabled-by-policy`.
 *
 * The empty-visible-text rule is conditional since D018. A *completed*
 * notification still requires something for the reader to read: a mail whose
 * body would be empty apart from metadata tells the operator less than the
 * subject already did. A *failure* notification does not, because the fact that
 * the task failed is itself the entire message, and a terminal provider failure
 * is exactly the case in which the model produced no visible output at all.
 * Suppressing on empty text there would silence the failures most worth
 * knowing about. The rule still applies to `max-tokens`, which is a delivery
 * question rather than an incident.
 *
 * The duration floor is likewise a turn-level rule only; the mid-turn
 * notifications do not pass through this function at all (§28).
 *
 * @param candidate - the settled turn, as a DTO.
 * @param config - the resolved configuration.
 * @param isDuplicate - whether this `(sessionId, turn)` already produced a job.
 * @returns the decision; this function never enqueues and never marks.
 */
export function decideNotification(
  candidate: NotificationCandidate,
  config: ResolvedConfig,
  isDuplicate: boolean,
): NotifyDecision {
  if (!config.enabled) return { notify: false, reason: 'disabled' }

  const statusSwitch = policySwitchFor(candidate.status)
  if (statusSwitch === undefined) {
    return { notify: false, reason: 'disabled-by-policy', detail: `no switch exists for status ${candidate.status}` }
  }
  const enabledByPolicy =
    statusSwitch === 'completed'
      ? config.policy.notifyCompleted
      : statusSwitch === 'error'
        ? config.policy.notifyErrors
        : config.policy.notifyMaxTokens
  if (!enabledByPolicy) {
    return { notify: false, reason: 'disabled-by-policy', detail: `status ${candidate.status} is switched off` }
  }

  // Whitespace-only text is as unreadable in a mail client as empty text, so
  // the test is on the trimmed value while `visibleTextLength` keeps the raw
  // length. The failure status is exempt: see the docblock above (D018).
  if (candidate.status !== 'error' && candidate.visibleText.trim() === '') {
    return { notify: false, reason: 'no-visible-text' }
  }

  // An unknown duration is not a short duration. Suppressing here would
  // systematically drop exactly the turns a mid-turn attach produces (D015).
  const duration = candidate.durationMs
  if (duration !== null && duration !== undefined && duration < config.policy.minTurnDurationMs) {
    return { notify: false, reason: 'below-min-duration', detail: `${duration} < ${config.policy.minTurnDurationMs}` }
  }

  if (isDuplicate) return { notify: false, reason: 'duplicate' }

  return { notify: true }
}
