/**
 * L1 unit tests for `telemetry.ts` — the turn-level usage fold (D017).
 *
 * Matrix rows USE-10…USE-24. The module exists because DSH reports `TokenUsage`
 * per model call, so every test here is about what a *sequence* of calls folds
 * into, and about the three failure modes that would make the fold dishonest:
 * counting one call twice, inventing a counter the provider never reported, and
 * presenting a partial turn as a complete one.
 *
 * @module dsh-mail-notify/tests/unit/telemetry
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLosslessJson } from '../../src/normalize.ts'
import { collectUsage, TurnUsageAccounting } from '../../src/telemetry.ts'
import { DEEPSEEK_CALL_USAGE, OBSERVED_USAGE, REASONING_CALL_USAGE, UNCACHED_CALL_USAGE } from '../fixtures/runtime-shapes.ts'

/**
 * Fold one usage record as a message settlement.
 *
 * @param ledger - the accounting under test.
 * @param step - the step the call belongs to.
 * @param usage - the raw usage value.
 * @param seq - the durable sequence number; defaults to a unique value.
 * @returns the settlement outcome.
 */
function sample(
  ledger: TurnUsageAccounting,
  step: number,
  usage: unknown,
  seq = step * 10,
): ReturnType<TurnUsageAccounting['addSettlement']> {
  return ledger.addSettlement({ kind: 'message', step, seq, timeMs: 1_000 + step, usage })
}

test('USE-10 three calls aggregate into the turn total', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  ledger.noteStepStarted(3)
  sample(ledger, 1, { inputTokens: 100, outputTokens: 10 })
  sample(ledger, 2, { inputTokens: 200, outputTokens: 20 })
  sample(ledger, 3, { inputTokens: 300, outputTokens: 30 })

  const snapshot = ledger.snapshot(true)
  assert.deepEqual(snapshot.usage, { inputTokens: 600, outputTokens: 60 })
  assert.equal(snapshot.sampleCount, 3)
  assert.equal(snapshot.complete, true, 'every accountable call reported usage')
})

test('USE-11 the last call is not the turn total', () => {
  // The defect this module exists to remove: v0.1.0 kept only the final sample.
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  sample(ledger, 1, { inputTokens: 5_954, outputTokens: 489 })
  sample(ledger, 2, { inputTokens: 3_547, outputTokens: 803 })
  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.usage?.inputTokens, 9_501)
  assert.notEqual(snapshot.usage?.inputTokens, 3_547, 'the final call must not stand in for the turn')
})

test('USE-12 optional buckets fold over the calls that reported them', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  sample(ledger, 1, { ...DEEPSEEK_CALL_USAGE })
  sample(ledger, 2, { ...DEEPSEEK_CALL_USAGE })
  const usage = ledger.snapshot(true).usage
  assert.equal(usage?.cacheReadTokens, 60_928)
  assert.ok(!Object.hasOwn(usage ?? {}, 'cacheWriteTokens'), 'a bucket no call reported stays absent')
  assert.ok(!Object.hasOwn(usage ?? {}, 'reasoningTokens'))
})

test('USE-13 cache write and reasoning buckets fold independently', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  sample(ledger, 1, { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 3, reasoningTokens: 7 })
  sample(ledger, 2, { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 4, reasoningTokens: 8 })
  const usage = ledger.snapshot(true).usage
  assert.deepEqual(usage, {
    inputTokens: 11,
    outputTokens: 22,
    cacheWriteTokens: 7,
    reasoningTokens: 15,
  })
})

test('USE-14 reasoning is never added to output', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  sample(ledger, 1, { ...REASONING_CALL_USAGE })
  const usage = ledger.snapshot(true).usage
  assert.equal(usage?.outputTokens, 252)
  assert.equal(usage?.reasoningTokens, 180)
  assert.notEqual(usage?.outputTokens, 252 + 180, 'reasoning is a subset of output, not a peer bucket')
})

test('USE-15 totalTokens is not folded into the aggregate', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  sample(ledger, 1, { ...DEEPSEEK_CALL_USAGE })
  const usage = ledger.snapshot(true).usage
  assert.ok(usage !== undefined)
  assert.ok(!Object.hasOwn(usage, 'totalTokens'), 'the per-call adapter total is not a turn counter (D017)')
  assert.deepEqual(Object.keys(usage).sort(), ['cacheReadTokens', 'inputTokens', 'outputTokens'])
})

test('USE-16 a call that reported no usage makes the turn incomplete', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  sample(ledger, 1, { inputTokens: 100, outputTokens: 10 })
  const outcome = ledger.addSettlement({ kind: 'message', step: 2, seq: 20, timeMs: 2_000, usage: undefined })
  assert.equal(outcome, 'unusable')
  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.sampleCount, 1)
  assert.equal(snapshot.missingCount, 1)
  assert.equal(snapshot.complete, false, 'a partial turn may not be presented as complete')
  assert.deepEqual(snapshot.usage, { inputTokens: 100, outputTokens: 10 }, 'the observed part is still reported')
})

test('USE-17 a usage record missing the required pair is not zero-filled', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  sample(ledger, 1, { inputTokens: 100 })
  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.usage, undefined, 'no aggregate is invented from a counter set that cannot be summed')
  assert.equal(snapshot.missingCount, 1)
  assert.equal(snapshot.complete, false)
})

test('USE-18 a mid-turn attach is never complete', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(4)
  sample(ledger, 4, { inputTokens: 100, outputTokens: 10 })
  const snapshot = ledger.snapshot(false)
  assert.equal(snapshot.sampleCount, 1)
  assert.equal(snapshot.missingCount, 0)
  assert.equal(snapshot.complete, false, 'the calls before the attach were never observed')
})

test('USE-19 a replayed settlement does not double count', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  const first = sample(ledger, 1, { inputTokens: 100, outputTokens: 10 }, 42)
  const replayed = sample(ledger, 1, { inputTokens: 100, outputTokens: 10 }, 42)
  assert.equal(first, 'sampled')
  assert.equal(replayed, 'duplicate')
  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.sampleCount, 1)
  assert.deepEqual(snapshot.usage, { inputTokens: 100, outputTokens: 10 })
})

test('USE-20 a replayed turn carrying fresh sequence numbers still does not double count', () => {
  // Replay is the case the sequence identity cannot catch on its own, so the
  // per-step message bound is a second guard. It rests on a measured fact: 0 of
  // 30 187 real assistant messages shared a step with another message.
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  sample(ledger, 1, { inputTokens: 100, outputTokens: 10 }, 1)
  const second = sample(ledger, 1, { inputTokens: 100, outputTokens: 10 }, 9_001)
  assert.equal(second, 'duplicate')
  assert.equal(ledger.snapshot(true).sampleCount, 1)
})

test('USE-21 a retried call is counted as unobservable and keeps the turn incomplete', () => {
  // The real ordering, taken from a recorded log: an attempt that committed no
  // message, the retry record, then the successful attempt's message.
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(7)
  const attempt = ledger.addSettlement({ kind: 'attempt', step: 7, seq: 65, timeMs: 1_000, usage: undefined })
  const retried = ledger.noteRetry({ step: 7, seq: 66, timeMs: 1_001 })
  const message = ledger.addSettlement({
    kind: 'message',
    step: 7,
    seq: 68,
    messageId: 'message-7',
    timeMs: 2_000,
    usage: { inputTokens: 100, outputTokens: 10 },
  })
  assert.equal(attempt, 'unusable')
  assert.equal(retried, true)
  assert.equal(message, 'sampled')

  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.sampleCount, 1)
  assert.equal(snapshot.missingCount, 1)
  assert.equal(snapshot.unobservableRetries, 1)
  assert.equal(snapshot.complete, false, 'a failed call whose usage was never reported cannot be claimed as covered')
  assert.deepEqual(snapshot.usage, { inputTokens: 100, outputTokens: 10 })
})

test('USE-21b a retry record that carried no attempt event is still counted', () => {
  // The other recorded retry ordering: no assistant/attempt at all, just the
  // retry record between two stream attempts.
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(11)
  ledger.noteRetry({ step: 11, seq: 1_745, timeMs: 1_000 })
  sample(ledger, 11, { inputTokens: 10, outputTokens: 1 }, 1_760)
  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.unobservableRetries, 1)
  assert.equal(snapshot.missingCount, 0)
  assert.equal(snapshot.complete, false)
})

test('USE-21c a replayed retry record is counted once', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  assert.equal(ledger.noteRetry({ step: 1, seq: 7, timeMs: 5 }), true)
  assert.equal(ledger.noteRetry({ step: 1, seq: 7, timeMs: 5 }), false)
  assert.equal(ledger.snapshot(true).unobservableRetries, 1)
})

test('USE-22 a step that never settled is counted as a missing call', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  sample(ledger, 1, { inputTokens: 100, outputTokens: 10 })
  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.missingCount, 1)
  assert.equal(snapshot.complete, false)
})

test('USE-23 a turn that produced nothing at all is not complete', () => {
  const ledger = new TurnUsageAccounting()
  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.usage, undefined)
  assert.equal(snapshot.sampleCount, 0)
  assert.equal(snapshot.complete, false, 'an empty disclosure is not a complete one')
})

test('USE-24 a sum leaving the safe-integer range withholds the aggregate', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  sample(ledger, 1, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 })
  const outcome = sample(ledger, 2, { inputTokens: 1, outputTokens: 1 })
  assert.equal(outcome, 'unusable')
  const snapshot = ledger.snapshot(true)
  assert.equal(snapshot.usage, undefined, 'a number that cannot be represented is not clamped or emitted')
  assert.equal(snapshot.missingCount, 1)
  assert.equal(snapshot.complete, false)
})

test('USE-25 the aggregate is lossless JSON', () => {
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  sample(ledger, 1, { ...REASONING_CALL_USAGE })
  sample(ledger, 2, { ...UNCACHED_CALL_USAGE })
  const snapshot = ledger.snapshot(true)
  assert.ok(isLosslessJson(snapshot))
  assert.ok(isLosslessJson(snapshot.usage))
  assert.doesNotThrow(() => JSON.stringify(snapshot))
})

test('USE-25b an uncached call does not remove a bucket another call reported', () => {
  // Both shapes were recorded inside one real turn: a route with no cache in
  // play reports the required pair only. Absence there is "this call had none",
  // so the cached calls' bucket must survive.
  const ledger = new TurnUsageAccounting()
  ledger.noteStepStarted(1)
  ledger.noteStepStarted(2)
  sample(ledger, 1, { ...UNCACHED_CALL_USAGE })
  sample(ledger, 2, { ...DEEPSEEK_CALL_USAGE })
  const usage = ledger.snapshot(true).usage
  assert.equal(usage?.cacheReadTokens, 30_464)
  assert.equal(usage?.inputTokens, 3_661 + 5_954)
})

test('collectUsage keeps every reported counter and derives none', () => {
  const usage = collectUsage({
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
    cacheReadTokens: 4,
    cacheWriteTokens: 5,
    reasoningTokens: 6,
  })
  assert.deepEqual(usage, {
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
    cacheReadTokens: 4,
    cacheWriteTokens: 5,
    reasoningTokens: 6,
  })
})

test('collectUsage drops a key it cannot read and keeps the rest', () => {
  assert.deepEqual(collectUsage({ inputTokens: 255, outputTokens: 759, reasoningTokens: undefined }), {
    inputTokens: 255,
    outputTokens: 759,
  })
  assert.deepEqual(collectUsage({ ...OBSERVED_USAGE }), { ...OBSERVED_USAGE })
  assert.deepEqual(collectUsage({ inputTokens: Number.NaN, totalTokens: 10 }), { totalTokens: 10 })
  assert.deepEqual(collectUsage({ totalTokens: 10, inputTokens: 'not a number' }), { totalTokens: 10 })
})

test('collectUsage yields nothing for a value that is not a counter set', () => {
  assert.equal(collectUsage({ somethingElse: 1 }), undefined)
  assert.equal(collectUsage({ inputTokens: '255' }), undefined)
  assert.equal(collectUsage(null), undefined)
  assert.equal(collectUsage(undefined), undefined)
  assert.equal(collectUsage(42), undefined)
  assert.equal(collectUsage([]), undefined)
})

test('collectUsage output is lossless JSON', () => {
  assert.ok(isLosslessJson({ usage: collectUsage({ ...OBSERVED_USAGE }) }))
  // A value with nothing numeric in it yields no counter set at all, which is
  // absence rather than a key whose value JSON cannot carry.
  assert.equal(collectUsage({ reasoningTokens: 'absent' }), undefined)
})
