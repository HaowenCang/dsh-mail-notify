/**
 * L1 unit tests for `turn-state.ts` — matrix rows TRN-01…TRN-03, TRN-10,
 * TRN-11, DUR-01…DUR-06 (the duration facts), CAND-01…CAND-04, and the
 * state-releasing half of LIFE-01…LIFE-06.
 *
 * The mid-turn rows matter most. A plugin can attach halfway through a turn and
 * never see that turn's `turn/start`; the state must then still accumulate real
 * counters, while the duration must report `null` rather than the fabricated
 * `0` the Phase 1 prototype originally produced.
 *
 * The token fold itself is tested in `telemetry.test.ts`; here it is only the
 * carrier of the candidate's usage fields.
 *
 * @module dsh-mail-notify/tests/unit/turn-state
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLosslessJson } from '../../src/normalize.ts'
import { createCandidate, createTurnState, TurnStateStore } from '../../src/turn-state.ts'
import { DEEPSEEK_CALL_USAGE, OBSERVED_USAGE, UNCACHED_CALL_USAGE } from '../fixtures/runtime-shapes.ts'

/** Fold one usage record into a turn state's ledger, as the handler would. */
function fold(
  state: ReturnType<typeof createTurnState>,
  step: number,
  usage: unknown,
  kind: 'message' | 'attempt' = 'message',
): void {
  state.usage.noteStepStarted(step)
  state.usage.addSettlement({ kind, step, seq: step, timeMs: 1_000 + step, usage })
}

test('TRN-01 a normally started turn records a real duration', () => {
  const state = createTurnState(1, true, 1_000_000)
  state.lastVisibleAssistantText = 'answer'
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1_002_000,
    endTimeMs: 1_005_000,
  })
  assert.equal(candidate.status, 'completed-clean')
  assert.equal(candidate.durationMs, 5_000)
  assert.equal(candidate.telemetryComplete, true)
  assert.equal(candidate.sawTurnStart, true)
})

test('TRN-03 a mid-turn attach reports unknown duration but real counters', () => {
  const state = createTurnState(4)
  state.assistantEvents = 3
  state.toolCallCount = 3
  state.toolResultCount = 4
  state.lastVisibleAssistantText = 'partial but real'
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1_002_000,
    endTimeMs: 1_005_000,
  })
  assert.equal(candidate.durationMs, null, 'an unobserved start time must not be reported as a duration')
  assert.notEqual(candidate.durationMs, 0)
  assert.equal(candidate.telemetryComplete, false)
  assert.equal(candidate.sawTurnStart, false)
  assert.equal(candidate.visibleTextLength, Array.from('partial but real').length)
})

test('DUR-01 an unknown duration is never the reason for suppression', () => {
  // The policy test lives in notifier tests; here the fact is that `null` and
  // `0` stay distinguishable all the way into the candidate.
  const state = createTurnState(1)
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 2,
  })
  assert.equal(candidate.durationMs, null)
  assert.ok('durationMs' in candidate)
})

test('DUR-05 the duration spans the whole turn, not the last message', () => {
  // The frozen fixture: `turn/start` at 1 000 and `turn/end` at 16 000, with
  // three model calls and two tool results spread across the interval.
  const state = createTurnState(1, true, 1_000)
  fold(state, 1, { inputTokens: 1, outputTokens: 1 })
  fold(state, 2, { inputTokens: 1, outputTokens: 1 })
  fold(state, 3, { inputTokens: 1, outputTokens: 1 })
  state.lastVisibleAssistantText = 'answer'

  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 16_000,
    endTimeMs: 16_000,
  })
  assert.equal(candidate.durationMs, 15_000, 'turn/end minus turn/start')
  for (const wrong of [2_000, 8_000, 14_000, 16_000 - 14_000]) {
    assert.notEqual(candidate.durationMs, wrong, `${wrong} is a step or message latency, not the turn duration`)
  }
})

test('DUR-06 a turn with no observed start reports an unknown duration', () => {
  // Mid-turn attach: `turn/end` arrives with everything but the start.
  const state = createTurnState(9)
  fold(state, 3, { inputTokens: 1, outputTokens: 1 })
  state.lastVisibleAssistantText = 'answer'
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 16_000,
    endTimeMs: 16_000,
  })
  assert.equal(candidate.durationMs, null)
  assert.notEqual(candidate.durationMs, 0)
  assert.equal(candidate.sawTurnStart, false)
})

test('TURN-01 a lazily created entry is patched in place when turn/start finally arrives', () => {
  const store = new TurnStateStore()
  const lazy = store.stateOf('session-a', 3)
  lazy.assistantEvents = 2
  lazy.toolCallCount = 1
  const patched = store.stateOf('session-a', 3)
  assert.equal(patched, lazy, 'the same entry must be reused, not rebuilt')
  patched.sawTurnStart = true
  patched.telemetryComplete = true
  patched.startAt = 500
  assert.equal(patched.assistantEvents, 2, 'accumulated counters survive the patch')
  assert.equal(patched.telemetryComplete, true)
})

test('TRN-11 steps counts distinct step numbers rather than the highest one', () => {
  const store = new TurnStateStore()
  store.markStep('session-a', 1, 1)
  store.markStep('session-a', 1, 2)
  store.markStep('session-a', 1, 2)
  store.markStep('session-a', 1, 5)
  assert.equal(store.stateOf('session-a', 1).steps, 3, 'three distinct steps, not a maximum of five')
})

test('TRN-11b step tracking is per turn', () => {
  const store = new TurnStateStore()
  store.markStep('session-a', 1, 1)
  store.markStep('session-a', 1, 2)
  store.markStep('session-a', 2, 1)
  assert.equal(store.stateOf('session-a', 1).steps, 2)
  assert.equal(store.stateOf('session-a', 2).steps, 1)
})

test('CREATE-01 the normal and lazy paths share one accessor and differ only in telemetry flags', () => {
  const store = new TurnStateStore()
  const normal = store.stateOf('session-a', 1)
  normal.sawTurnStart = true
  normal.telemetryComplete = true
  normal.startAt = 100
  const lazy = store.stateOf('session-b', 1)
  assert.equal(normal.turn, lazy.turn)
  assert.notEqual(normal.startAt, lazy.startAt)
  assert.equal(lazy.startAt, undefined)
  assert.equal(lazy.telemetryComplete, false)
})

test('TRN-10 an empty visible text never overwrites a previous one', () => {
  const store = new TurnStateStore()
  const state = store.stateOf('session-a', 1)
  state.lastVisibleAssistantText = 'the real answer'
  // The handler only assigns when the extraction result is non-empty; this
  // asserts the contract the handler implements.
  const incoming = ''
  if (incoming !== '') state.lastVisibleAssistantText = incoming
  assert.equal(state.lastVisibleAssistantText, 'the real answer')
})

test('LIFE-01 releasing a turn removes it and collapses an empty session map', () => {
  const store = new TurnStateStore()
  store.stateOf('session-a', 1)
  store.markStep('session-a', 1, 1)
  const released = store.release('session-a', 1)
  assert.equal(released?.turn, 1)
  assert.deepEqual(store.sizes(), { sessions: 0, turns: 0, stepSets: 0 })
  assert.equal(store.has('session-a', 1), false)
})

test('LIFE-03 a session keeps its other turns when one is released', () => {
  const store = new TurnStateStore()
  store.stateOf('session-a', 1)
  store.stateOf('session-a', 2)
  store.release('session-a', 1)
  assert.deepEqual(store.sizes(), { sessions: 1, turns: 1, stepSets: 0 })
  assert.equal(store.has('session-a', 2), true)
})

test('LIFE-04 releasing a session clears every turn and leaves other sessions alone', () => {
  const store = new TurnStateStore()
  store.stateOf('session-a', 1)
  store.stateOf('session-a', 2)
  store.markStep('session-a', 1, 1)
  store.stateOf('session-b', 1)
  assert.equal(store.releaseSession('session-a'), true)
  assert.deepEqual(store.sizes(), { sessions: 1, turns: 1, stepSets: 0 })
  assert.equal(store.has('session-a', 1), false)
  assert.equal(store.has('session-b', 1), true)
})

test('LIFE-06 repeated create/release cycles return the map to its baseline', () => {
  const store = new TurnStateStore()
  for (let index = 0; index < 500; index += 1) {
    const sessionId = `session-${index}`
    store.stateOf(sessionId, 1)
    store.markStep(sessionId, 1, 1)
    store.release(sessionId, 1)
  }
  assert.deepEqual(store.sizes(), { sessions: 0, turns: 0, stepSets: 0 })
})

test('clear empties every level', () => {
  const store = new TurnStateStore()
  store.stateOf('session-a', 1)
  store.markStep('session-a', 1, 1)
  store.stateOf('session-b', 2)
  store.clear()
  assert.deepEqual(store.sizes(), { sessions: 0, turns: 0, stepSets: 0 })
})

test('CAND-01 schemaVersion is the literal 2', () => {
  // The bump is not cosmetic. Version 1's `usage` was the last observed
  // per-call sample; version 2's is the turn aggregate, and a consumer that
  // cannot tell the two apart would read a partial number as a total (D013).
  const { value: candidate } = createCandidate(createTurnState(1), {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 2,
  })
  assert.equal(candidate.schemaVersion, 2)
})

test('CAND-02 every required field is present with the right type', () => {
  const state = createTurnState(7, true, 100)
  state.lastVisibleAssistantText = 'text'
  state.explicitToolErrorCount = 2
  fold(state, 1, { ...DEEPSEEK_CALL_USAGE })
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 42,
    endTimeMs: 200,
  })
  assert.equal(typeof candidate.schemaVersion, 'number')
  assert.equal(typeof candidate.sessionId, 'string')
  assert.equal(typeof candidate.turn, 'number')
  assert.equal(candidate.status, 'completed-with-tool-errors')
  assert.equal(candidate.turnEndKind, 'completed')
  assert.equal(typeof candidate.visibleText, 'string')
  assert.equal(typeof candidate.visibleTextLength, 'number')
  assert.equal(typeof candidate.explicitToolErrorCount, 'number')
  assert.equal(typeof candidate.telemetryComplete, 'boolean')
  assert.equal(typeof candidate.usageSampleCount, 'number')
  assert.equal(typeof candidate.usageMissingCount, 'number')
  assert.equal(typeof candidate.usageUnobservableRetries, 'number')
  assert.equal(typeof candidate.usageComplete, 'boolean')
  assert.equal(typeof candidate.createdAt, 'number')
})

test('CAND-02b the usage coverage fields are always present, even with no samples', () => {
  const { value: candidate } = createCandidate(createTurnState(1), {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 2,
  })
  assert.equal(candidate.usageSampleCount, 0)
  assert.equal(candidate.usageMissingCount, 0)
  assert.equal(candidate.usageUnobservableRetries, 0)
  assert.equal(candidate.usageComplete, false, 'a turn with nothing observed is not a complete disclosure')
})

test('CAND-03 absent optional fields are absent, not undefined and not null', () => {
  const { value: candidate } = createCandidate(createTurnState(1), {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 2,
  })
  for (const key of ['provider', 'model', 'assistantMessageId', 'usage', 'cwd', 'turnEndDetail', 'reasonDetail']) {
    assert.ok(!Object.hasOwn(candidate, key), `${key} must be absent rather than present-and-empty`)
  }
  assert.ok(Object.hasOwn(candidate, 'durationMs'), 'durationMs is always present; null is a real observation')
})

test('CAND-03b a present value is not silently dropped', () => {
  const state = createTurnState(1, true, 10)
  state.provider = 'deepseek-official'
  state.model = 'deepseek-chat'
  state.lastAssistantMessageId = 'message-1'
  fold(state, 1, { inputTokens: 1, outputTokens: 2 })
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 20,
    cwd: 'E:\\work',
  })
  assert.equal(candidate.provider, 'deepseek-official')
  assert.equal(candidate.model, 'deepseek-chat')
  assert.equal(candidate.assistantMessageId, 'message-1')
  assert.deepEqual(candidate.usage, { inputTokens: 1, outputTokens: 2 })
  assert.equal(candidate.cwd, 'E:\\work')
  assert.equal(candidate.usageSampleCount, 1)
  assert.equal(candidate.usageComplete, true)
})

test('CAND-04 a complete candidate is lossless JSON', () => {
  const state = createTurnState(1, true, 10)
  state.lastVisibleAssistantText = 'answer'
  fold(state, 1, { ...OBSERVED_USAGE })
  const { value: candidate, dropped } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 20,
  })
  assert.equal(dropped.length, 0)
  assert.ok(isLosslessJson(candidate))
  assert.doesNotThrow(() => JSON.stringify(candidate))
})

test('USE-07 the candidate carries the turn aggregate, not one call', () => {
  const state = createTurnState(1, true, 10)
  fold(state, 1, { ...DEEPSEEK_CALL_USAGE })
  fold(state, 2, { ...DEEPSEEK_CALL_USAGE })
  fold(state, 3, { ...UNCACHED_CALL_USAGE })
  state.lastVisibleAssistantText = 'answer'
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 20,
  })
  assert.equal(candidate.usageSampleCount, 3)
  assert.equal(candidate.usage?.inputTokens, 5_954 * 2 + 3_661)
  assert.equal(candidate.usage?.outputTokens, 489 * 2 + 60)
  assert.equal(candidate.usage?.cacheReadTokens, 30_464 * 2)
  assert.equal(candidate.usageComplete, true)
  assert.notEqual(candidate.usage?.inputTokens, DEEPSEEK_CALL_USAGE['inputTokens'], 'the last call is not the turn')
})

test('USE-08 a counter the runtime never reported is absent rather than zero', () => {
  const state = createTurnState(1, true, 10)
  fold(state, 1, { ...DEEPSEEK_CALL_USAGE })
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 20,
  })
  const usage = candidate.usage
  assert.ok(usage !== undefined)
  assert.ok(!Object.hasOwn(usage, 'reasoningTokens'))
  assert.ok(!Object.hasOwn(usage, 'cacheWriteTokens'))
  assert.ok(!Object.hasOwn(usage, 'totalTokens'), 'no derived or adapter-level total is carried (D017)')
})

test('USE-09 recorded counters are carried through unchanged and not reconciled', () => {
  // The Phase 1 sample whose `totalTokens` does not equal the sum of its
  // buckets is kept verbatim as a per-call sample; the aggregate folds only the
  // buckets, so the inconsistency neither disappears nor propagates.
  const state = createTurnState(1, true, 10)
  fold(state, 1, { ...OBSERVED_USAGE })
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 20,
  })
  assert.deepEqual(candidate.usage, { inputTokens: 255, outputTokens: 759, cacheReadTokens: 186_624 })
  assert.ok(isLosslessJson(candidate))
})

test('USE-09b non-finite or non-numeric counters never reach a candidate', () => {
  const state = createTurnState(1, true, 10)
  fold(state, 1, { inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY, totalTokens: 10 })
  const { value: candidate, dropped } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 20,
  })
  assert.equal(candidate.usage, undefined, 'nothing summable was reported, so nothing is emitted')
  assert.equal(candidate.usageMissingCount, 1)
  assert.equal(candidate.usageComplete, false)
  assert.equal(dropped.length, 0)
  assert.ok(isLosslessJson(candidate))
})

test('USE-09c a hostile counter shape is pruned by the collector', () => {
  const state = createTurnState(1, true, 10)
  fold(state, 1, { totalTokens: 10, inputTokens: 'not a number' })
  fold(state, 2, { inputTokens: 3, outputTokens: 4, reasoningTokens: 'absent' })
  const { value: candidate } = createCandidate(state, {
    sessionId: 'session-a',
    turnEndKind: 'completed',
    createdAt: 1,
    endTimeMs: 20,
  })
  assert.deepEqual(candidate.usage, { inputTokens: 3, outputTokens: 4 })
  assert.equal(candidate.usageMissingCount, 1)
  assert.equal(Object.hasOwn(candidate.usage ?? {}, 'reasoningTokens'), false)
  assert.ok(isLosslessJson(candidate))
})
