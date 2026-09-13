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
 * turn — so evicting the oldest key needs no access bookkeeping, and the cache
 * cannot grow without bound in a long-lived process. The guarantee it provides
 * is deliberately narrow: at most one enqueue per `(sessionId, turn)` within
 * one process lifetime. Nothing is persisted, so a restarted DSH may notify a
 * replayed turn a second time (D008).
 */
export class DedupeCache {
  private readonly keys = new Set<string>()
  private readonly capacity: number

  /** @param capacity - maximum retained keys; must be at least 1. */
  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity))
  }

  /**
   * Build the key for one turn.
   *
   * @param sessionId - the owning session.
   * @param turn - the turn number.
   * @returns the dedupe key.
   */
  static keyFor(sessionId: string, turn: number): string {
    return `${sessionId}:${turn}`
  }

  /**
   * Whether this key has already produced a queued job.
   *
   * @param key - a key from {@link DedupeCache.keyFor}.
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
   * @param key - a key from {@link DedupeCache.keyFor}.
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
  // length. This rule has no configuration switch (D011).
  if (candidate.visibleText.trim() === '') {
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
