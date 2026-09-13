/**
 * Turn-level token telemetry accounting.
 *
 * DSH reports `TokenUsage` per model call: `assistant/message` carries the
 * usage of the call that produced it, and a call that produced no surface
 * message settles as `assistant/attempt`. A turn is a sequence of such calls,
 * so the turn's usage is a fold over the calls — never the last call's sample.
 * That fold is the whole job of this module (D017).
 *
 * Three properties are load-bearing and each is enforced here rather than by
 * convention:
 *
 * - **No derivation.** Buckets are summed; nothing is computed from them. The
 *   input buckets are disjoint and stay separate, `reasoningTokens` is never
 *   added to `outputTokens`, and a counter no sample reported stays absent
 *   instead of becoming a known `0`.
 * - **No double counting.** A settlement is identified by the durable session
 *   sequence number, with a second, evidence-backed guard for the one
 *   settlement kind that the runtime emits at most once per step.
 * - **No silent partial statistics.** Every accountable call that produced no
 *   usable report is counted, and the turn is only `complete` when that count
 *   is zero.
 *
 * Nothing here knows a DSH payload shape: samples arrive as `unknown` and are
 * copied counter by counter.
 *
 * @module dsh-mail-notify/telemetry
 */

import type {
  RawUsage,
  RetryInput,
  SettlementInput,
  SettlementOutcome,
  TurnUsage,
  TurnUsageLedger,
  TurnUsageSnapshot,
} from './types.ts'

/**
 * Bound on the distinct step numbers one turn may account for.
 *
 * The largest turn observed in a real log held 2 611 steps, so the bound is far
 * above anything the runtime produces; it exists so a pathological event stream
 * cannot make one turn's accounting grow without limit. Exceeding it does not
 * truncate silently — it forces `complete: false`.
 */
export const MAX_ACCOUNTED_STEPS = 65_536

/**
 * Bound on the distinct settlement identities one turn may account for.
 *
 * Same reasoning as {@link MAX_ACCOUNTED_STEPS}: retries and attempts add a
 * small constant per step in practice.
 */
export const MAX_ACCOUNTED_SETTLEMENTS = 65_536

/** Whether a property name is one of the six `RawUsage` counters. */
function isUsageKey(key: string): key is keyof RawUsage {
  return (
    key === 'inputTokens' ||
    key === 'outputTokens' ||
    key === 'totalTokens' ||
    key === 'cacheReadTokens' ||
    key === 'cacheWriteTokens' ||
    key === 'reasoningTokens'
  )
}

/** Whether a value is a non-negative safe-integer count. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Copy only the counters the runtime actually reported.
 *
 * Writing a key per known counter would emit `undefined` for every counter a
 * provider omitted, which is exactly what made the Phase 1 probe unreadable.
 * No counter is derived, zero-filled, corrected, or interpreted (D006).
 *
 * @param usage - the runtime usage value; its shape is not trusted.
 * @returns a counter set, or `undefined` when nothing numeric was reported.
 */
export function collectUsage(usage: unknown): RawUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const out: RawUsage = {}
  let any = false
  for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
    if (!isUsageKey(key)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out[key] = value
    any = true
  }
  return any ? out : undefined
}

/** A checked sum, or `undefined` when the result left the safe-integer range. */
function safeAdd(left: number, right: number): number | undefined {
  const sum = left + right
  return Number.isSafeInteger(sum) ? sum : undefined
}

/**
 * A sample proven to carry the required `inputTokens`/`outputTokens` pair.
 *
 * The pair is what makes a report foldable at all: DSH declares both as
 * required on `TokenUsage`, so a report missing either is not a counter set
 * this plugin can sum, and inventing the missing side would be exactly the
 * derivation D006 forbids.
 */
interface FoldableSample {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** Read one settlement's usage as a foldable sample, or `undefined`. */
function foldableSample(usage: unknown): FoldableSample | undefined {
  const sample = collectUsage(usage)
  if (sample === undefined) return undefined
  if (!isCount(sample.inputTokens) || !isCount(sample.outputTokens)) return undefined
  const out: FoldableSample = { inputTokens: sample.inputTokens, outputTokens: sample.outputTokens }
  if (isCount(sample.cacheReadTokens)) out.cacheReadTokens = sample.cacheReadTokens
  if (isCount(sample.cacheWriteTokens)) out.cacheWriteTokens = sample.cacheWriteTokens
  if (isCount(sample.reasoningTokens)) out.reasoningTokens = sample.reasoningTokens
  return out
}

/**
 * Per-turn fold of provider-reported model-call usage.
 *
 * One instance belongs to one `(sessionId, turn)` and is released with the turn
 * state, so its memory is bounded by the turn's own size.
 */
export class TurnUsageAccounting implements TurnUsageLedger {
  private inputTokens = 0
  private outputTokens = 0
  private cacheReadTokens: number | undefined
  private cacheWriteTokens: number | undefined
  private reasoningTokens: number | undefined

  /** Identities of settlements already folded or already counted as missing. */
  private readonly settlements = new Set<string>()
  /** Steps that already contributed a usage-bearing `assistant/message`. */
  private readonly sampledMessageSteps = new Set<number>()
  /** Steps whose model call was announced. */
  private readonly startedSteps = new Set<number>()
  /** Steps that produced at least one settlement. */
  private readonly settledSteps = new Set<number>()

  private samples = 0
  private missing = 0
  private retries = 0
  private overflowed = false
  private capped = false

  /**
   * Record that a step opened, which is the runtime's announcement of a model call.
   *
   * @param step - the step number.
   */
  noteStepStarted(step: number): void {
    if (this.startedSteps.size >= MAX_ACCOUNTED_STEPS) {
      this.capped = true
      return
    }
    this.startedSteps.add(step)
  }

  /**
   * Fold one model-call settlement.
   *
   * A settlement whose usage is absent, unreadable, or missing the required
   * `inputTokens`/`outputTokens` pair is counted as an accountable call without
   * a usable report. It is never zero-filled and never dropped in silence.
   *
   * @param input - the settlement, identified by sequence number when present.
   * @returns what the settlement contributed.
   */
  addSettlement(input: SettlementInput): SettlementOutcome {
    const sample = foldableSample(input.usage)
    const usable = sample !== undefined

    const key = settlementKey(input)
    if (this.settlements.has(key)) return 'duplicate'

    // The runtime emits at most one usage-bearing assistant message per step:
    // 0 of 30 187 observed messages shared a step with another. That bound is a
    // second, independent guard in front of the sequence identity, so a replayed
    // turn whose events carry fresh sequence numbers still cannot double count.
    // It applies only to a message that actually carries a foldable sample, so a
    // usage-free message in the same step is still counted as its own call
    // rather than silently absorbed.
    if (usable && input.kind === 'message' && this.sampledMessageSteps.has(input.step)) return 'duplicate'

    if (this.settlements.size >= MAX_ACCOUNTED_SETTLEMENTS) {
      this.capped = true
      return 'duplicate'
    }
    this.settlements.add(key)
    this.settledSteps.add(input.step)

    if (!usable) {
      this.missing += 1
      return 'unusable'
    }

    const nextInput = safeAdd(this.inputTokens, sample.inputTokens)
    const nextOutput = safeAdd(this.outputTokens, sample.outputTokens)
    if (nextInput === undefined || nextOutput === undefined) {
      // A sum outside the safe-integer range is not a number this plugin may
      // present, and it cannot be repaired by clamping. The aggregate is
      // withheld rather than emitted wrong, and the call that could not be
      // folded is counted like any other call that produced no usable report.
      this.overflowed = true
      this.missing += 1
      return 'unusable'
    }
    this.inputTokens = nextInput
    this.outputTokens = nextOutput

    this.cacheReadTokens = this.foldOptional(this.cacheReadTokens, sample.cacheReadTokens)
    this.cacheWriteTokens = this.foldOptional(this.cacheWriteTokens, sample.cacheWriteTokens)
    this.reasoningTokens = this.foldOptional(this.reasoningTokens, sample.reasoningTokens)

    if (input.kind === 'message') this.sampledMessageSteps.add(input.step)
    this.samples += 1
    return 'sampled'
  }

  /**
   * Record one retried model call.
   *
   * A retry record is the durable evidence that a call failed. Its usage is not
   * part of any observed payload, so the turn cannot claim to have folded every
   * call once a retry is present.
   *
   * @param input - the retry record.
   * @returns true when this retry had not been counted before.
   */
  noteRetry(input: RetryInput): boolean {
    const key = `retry:${input.seq !== undefined ? `seq:${input.seq}` : `t:${input.step}:${input.timeMs}`}`
    if (this.settlements.has(key)) return false
    if (this.settlements.size >= MAX_ACCOUNTED_SETTLEMENTS) {
      this.capped = true
      return false
    }
    this.settlements.add(key)
    this.retries += 1
    return true
  }

  /**
   * Fold one optional bucket.
   *
   * An absent bucket is not a zero: it is left absent until a sample reports
   * one, and samples that omit it simply do not contribute. Real providers do
   * exactly this — `cacheReadTokens` is reported only once a cache exists — so
   * summing the samples that reported a bucket reconstructs that bucket's turn
   * total without inventing coverage.
   *
   * @param current - the accumulated value, or `undefined` while none was seen.
   * @param value - the sample's value, when it reported one.
   * @returns the new accumulated value.
   */
  private foldOptional(current: number | undefined, value: number | undefined): number | undefined {
    if (!isCount(value)) return current
    if (current === undefined) return value
    const sum = safeAdd(current, value)
    if (sum === undefined) {
      this.overflowed = true
      return current
    }
    return sum
  }

  /**
   * The turn's coverage so far, computed against whether the turn's start was seen.
   *
   * @param sawTurnStart - whether `turn/start` was observed for this turn.
   * @returns the aggregate and its coverage.
   */
  snapshot(sawTurnStart: boolean): TurnUsageSnapshot {
    let unsettled = 0
    for (const step of this.startedSteps) {
      if (!this.settledSteps.has(step)) unsettled += 1
    }

    const missingCount = this.missing + unsettled
    const complete =
      sawTurnStart &&
      !this.overflowed &&
      !this.capped &&
      this.retries === 0 &&
      missingCount === 0 &&
      this.samples > 0

    const snapshot: TurnUsageSnapshot = {
      sampleCount: this.samples,
      missingCount,
      unobservableRetries: this.retries,
      complete,
    }

    if (this.samples > 0 && !this.overflowed) {
      const usage: TurnUsage = { inputTokens: this.inputTokens, outputTokens: this.outputTokens }
      if (this.cacheReadTokens !== undefined) usage.cacheReadTokens = this.cacheReadTokens
      if (this.cacheWriteTokens !== undefined) usage.cacheWriteTokens = this.cacheWriteTokens
      if (this.reasoningTokens !== undefined) usage.reasoningTokens = this.reasoningTokens
      snapshot.usage = usage
    }

    return snapshot
  }
}

/**
 * The identity of one settlement, from the strongest evidence available.
 *
 * `seq` is the durable session sequence number: unique within a session and
 * present on every settlement event observed in 30 187 real assistant messages,
 * 83 attempts, and 376 retry records. The message id is the next strongest
 * identity. The time-based fallback exists only for a hand-built event that
 * carries neither, and it is deliberately derived from the event's own fields
 * rather than from a counter that a replay would reset.
 *
 * @param input - the settlement.
 * @returns a collision-free key within one turn.
 */
function settlementKey(input: SettlementInput): string {
  if (typeof input.seq === 'number' && Number.isSafeInteger(input.seq)) return `seq:${input.seq}`
  if (input.messageId !== undefined && input.messageId !== '') return `msg:${input.messageId}`
  return `${input.kind}:${input.step}:${input.timeMs}`
}
