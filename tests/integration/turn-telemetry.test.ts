/**
 * L5 integration tests for turn-level telemetry — matrix rows TEL-01…TEL-14.
 *
 * The unit fold is covered in `telemetry.test.ts`; what these tests add is the
 * whole path a real turn takes: raw DSH event payloads through the adapter, the
 * turn map, the candidate, the policy, the renderer, and the sink. Both defects
 * this phase fixes are only visible on that path, because the fold is correct
 * in isolation either way — what was wrong was which events reached it.
 *
 * The chains are the runtime's own order, taken from recorded session logs:
 * `turn/start`, then per step `step/start` → `assistant/message` (with `usage`)
 * → `tool/call` → `tool/result` → `step/end`, then `turn/end`.
 *
 * @module dsh-mail-notify/tests/integration/turn-telemetry
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderMail } from '../../src/subject.ts'
import type { NotificationCandidate } from '../../src/types.ts'
import {
  assistantAttempt,
  assistantMessage,
  DEEPSEEK_CALL_USAGE,
  llmRetry,
  llmRetryStarted,
  multiStepTurnChain,
  REASONING_CALL_USAGE,
  reasoningOnlyMessage,
  rootSession,
  stepStart,
  toolCall,
  toolResultOk,
  turnEnd,
  turnStart,
  UNCACHED_CALL_USAGE,
  REASONING_SECRET_SENTINEL,
  TOOL_ARGUMENT_SECRET_SENTINEL,
  TOOL_RESULT_SECRET_SENTINEL,
} from '../fixtures/runtime-shapes.ts'
import { testTurnNotification, turn } from '../support/harness.ts'
import { controllableSink, emit, mountPlugin as mount } from '../support/plugin-harness.ts'

/** Mount the plugin over a recording sink and settle one emitted chain. */
async function runChain(
  events: Parameters<typeof emit>[2],
  overrides: Record<string, unknown> = {},
): Promise<NotificationCandidate> {
  const sink = controllableSink()
  const harness = await mount(overrides, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), events)
  await handle.queue.settle()
  const job = sink.jobs[0]
  assert.ok(job !== undefined, 'the chain must produce a job')
  const candidate = turn(job)
  assert.ok(candidate !== undefined)
  return candidate
}

/** Render the mail a candidate would produce under the default render switches. */
function mailFor(candidate: NotificationCandidate): string {
  return renderMail({
    notification: testTurnNotification(candidate),
    render: { maxBodyChars: 100_000, includeMetadata: true, includeUserPrompt: false, includeFooter: true },
    truncated: false,
  }).text
}

/* ── Duration (D015, §18 of the phase brief) ──────────────────────────── */

test('TEL-01 the duration is the turn boundary interval, not a step latency', async () => {
  // The frozen fixture: turn/start at 1 000; assistant messages at 2 000,
  // 8 000, and 14 000 with tool results at 5 000 and 12 000; turn/end at 16 000.
  const events = [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_500),
    assistantMessage({ turn: 1, step: 1, time: 2_000, content: [{ type: 'text', text: 'first' }], usage: { inputTokens: 100, outputTokens: 10 } }),
    toolCall(1, 1, 3_000),
    toolResultOk(1, 1, 5_000),
    stepStart(1, 2, 7_000),
    assistantMessage({ turn: 1, step: 2, time: 8_000, content: [{ type: 'text', text: 'second' }], usage: { inputTokens: 200, outputTokens: 20 } }),
    toolCall(1, 2, 9_000),
    toolResultOk(1, 2, 12_000),
    stepStart(1, 3, 13_000),
    assistantMessage({ turn: 1, step: 3, time: 14_000, content: [{ type: 'text', text: 'the final answer' }], usage: { inputTokens: 300, outputTokens: 30 } }),
    turnEnd(1, 16_000),
  ]
  const candidate = await runChain(events)
  assert.equal(candidate.durationMs, 15_000)
  for (const wrong of [2_000, 8_000, 14_000, 16_000 - 14_000, 3_000 + 4_000 + 1_000]) {
    assert.notEqual(candidate.durationMs, wrong)
  }
  assert.ok(mailFor(candidate).includes('Duration:  15.0 s'))
})

test('TEL-02 a turn whose start was never observed keeps an unknown duration', async () => {
  const candidate = await runChain([
    stepStart(4, 1, 10),
    assistantMessage({ turn: 4, step: 1, time: 20, content: [{ type: 'text', text: 'partial' }], usage: { inputTokens: 1, outputTokens: 1 } }),
    turnEnd(4, 30),
  ])
  assert.equal(candidate.durationMs, null)
  assert.equal(candidate.sawTurnStart, false)
  assert.equal(candidate.telemetryComplete, false)
})

/* ── Turn usage aggregation (D017, §19 of the phase brief) ────────────── */

test('TEL-03 three model calls aggregate into one turn total', async () => {
  const candidate = await runChain(
    multiStepTurnChain(1, [
      { inputTokens: 100, outputTokens: 10 },
      { inputTokens: 200, outputTokens: 20 },
      { inputTokens: 300, outputTokens: 30 },
    ]),
  )
  assert.equal(candidate.schemaVersion, 2)
  assert.deepEqual(candidate.usage, { inputTokens: 600, outputTokens: 60 })
  assert.equal(candidate.usageSampleCount, 3)
  assert.equal(candidate.usageMissingCount, 0)
  assert.equal(candidate.usageComplete, true)
  assert.equal(candidate.status, 'completed-clean')
})

test('TEL-03b the last call is never presented as the turn', async () => {
  // The exact v0.1.0 defect, on the same shape of chain: it reported 300/30.
  const candidate = await runChain(
    multiStepTurnChain(1, [
      { inputTokens: 100, outputTokens: 10 },
      { inputTokens: 200, outputTokens: 20 },
      { inputTokens: 300, outputTokens: 30 },
    ]),
  )
  assert.notDeepEqual(candidate.usage, { inputTokens: 300, outputTokens: 30 })
})

test('TEL-04 cache and reasoning buckets fold across the calls that reported them', async () => {
  const candidate = await runChain(
    multiStepTurnChain(1, [{ ...DEEPSEEK_CALL_USAGE }, { ...REASONING_CALL_USAGE }, { ...UNCACHED_CALL_USAGE }]),
  )
  assert.deepEqual(candidate.usage, {
    inputTokens: 5_954 + 1_425 + 3_661,
    outputTokens: 489 + 252 + 60,
    cacheReadTokens: 30_464 + 56_064,
    reasoningTokens: 180,
  })
  assert.equal(candidate.usageSampleCount, 3)
  assert.equal(candidate.usageComplete, true)
})

test('TEL-05 reasoning is a subset of output and is never added to it', async () => {
  const candidate = await runChain(multiStepTurnChain(1, [{ ...REASONING_CALL_USAGE }]))
  assert.equal(candidate.usage?.outputTokens, 252)
  assert.equal(candidate.usage?.reasoningTokens, 180)
  assert.ok(!Object.hasOwn(candidate.usage ?? {}, 'totalTokens'))
})

test('TEL-06 a call that reported no usage leaves the turn incomplete', async () => {
  const candidate = await runChain([
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    assistantMessage({ turn: 1, step: 1, time: 2_000, content: [{ type: 'text', text: 'first' }], usage: { inputTokens: 100, outputTokens: 10 } }),
    stepStart(1, 2, 3_000),
    assistantMessage({ turn: 1, step: 2, time: 4_000, content: [{ type: 'text', text: 'the final answer' }] }),
    turnEnd(1, 5_000),
  ])
  assert.deepEqual(candidate.usage, { inputTokens: 100, outputTokens: 10 }, 'the observed part is still reported')
  assert.equal(candidate.usageSampleCount, 1)
  assert.equal(candidate.usageMissingCount, 1)
  assert.equal(candidate.usageComplete, false)
  const text = mailFor(candidate)
  assert.ok(text.includes('Token telemetry complete: no'))
  assert.ok(text.includes('1 model call without a usable usage report'))
})

test('TEL-07 a mid-turn attach reports both telemetry flags as incomplete', async () => {
  const candidate = await runChain([
    stepStart(9, 3, 10),
    assistantMessage({ turn: 9, step: 3, time: 20, content: [{ type: 'text', text: 'joined late' }], usage: { inputTokens: 100, outputTokens: 10 } }),
    turnEnd(9, 30),
  ])
  assert.equal(candidate.telemetryComplete, false)
  assert.equal(candidate.usageComplete, false)
  assert.equal(candidate.usageSampleCount, 1, 'the part that was observed is still folded')
  assert.equal(candidate.usageMissingCount, 0)
  const text = mailFor(candidate)
  assert.ok(text.includes('Telemetry complete: no (plugin attached mid-turn)'))
  assert.ok(text.includes('Token telemetry complete: no (the turn was not observed from its start)'))
})

/* ── Duplicate delivery and retries (D017, §12 of the phase brief) ────── */

test('TEL-08 an event delivered twice does not double count', async () => {
  const message = assistantMessage({
    turn: 1,
    step: 1,
    time: 2_000,
    seq: 11,
    content: [{ type: 'text', text: 'answer' }],
    usage: { inputTokens: 100, outputTokens: 10 },
  })
  const second = assistantMessage({
    turn: 1,
    step: 2,
    time: 3_000,
    seq: 12,
    content: [{ type: 'text', text: 'the final answer' }],
    usage: { inputTokens: 200, outputTokens: 20 },
  })
  const candidate = await runChain([
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    message,
    message,
    stepStart(1, 2, 2_100),
    second,
    second,
    turnEnd(1, 4_000),
  ])
  assert.deepEqual(candidate.usage, { inputTokens: 300, outputTokens: 30 })
  assert.equal(candidate.usageSampleCount, 2)
  assert.equal(candidate.usageComplete, true)
})

test('TEL-09 a whole turn replayed through the listener produces one job', async () => {
  const chain = multiStepTurnChain(1, [{ inputTokens: 100, outputTokens: 10 }])
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), chain)
  await handle.queue.settle()
  emit(harness.ctx, rootSession(), chain)
  await handle.queue.settle()
  assert.equal(sink.jobs.length, 1, 'the dedupe key is (sessionId, turn) and the replay is the same turn')
  const replayed = sink.jobs[0]
  assert.ok(replayed !== undefined, 'the replayed turn must produce exactly one job')
  assert.equal(turn(replayed).usageSampleCount, 1)
})

test('TEL-10 a retried call keeps the aggregate but marks it incomplete', async () => {
  // The recorded ordering: an attempt that committed no message, the retry
  // record, then the successful attempt's message.
  const candidate = await runChain([
    turnStart(1, 1_000),
    stepStart(1, 7, 1_100),
    assistantAttempt({ turn: 1, step: 7, time: 1_200, seq: 65 }),
    llmRetry(1, 7, 1_201, 66),
    llmRetryStarted(1, 7, 1_700, 67),
    assistantMessage({
      turn: 1,
      step: 7,
      time: 2_000,
      seq: 68,
      content: [{ type: 'text', text: 'the final answer' }],
      usage: { inputTokens: 100, outputTokens: 10 },
    }),
    turnEnd(1, 3_000),
  ])
  assert.deepEqual(candidate.usage, { inputTokens: 100, outputTokens: 10 })
  assert.equal(candidate.usageSampleCount, 1)
  assert.equal(candidate.usageMissingCount, 1)
  assert.equal(candidate.usageUnobservableRetries, 1)
  assert.equal(candidate.usageComplete, false)
  const text = mailFor(candidate)
  assert.ok(text.includes('1 retried model call whose usage was not reported'))
})

test('TEL-10b a retry with no attempt record is still counted', async () => {
  // The other recorded ordering: no `assistant/attempt` at all, just the retry
  // record between two streaming attempts.
  const candidate = await runChain([
    turnStart(1, 1_000),
    stepStart(1, 11, 1_100),
    llmRetry(1, 11, 1_744, 1_745),
    llmRetryStarted(1, 11, 2_100, 1_746),
    assistantMessage({
      turn: 1,
      step: 11,
      time: 3_000,
      seq: 1_747,
      content: [{ type: 'text', text: 'the final answer' }],
      usage: { inputTokens: 100, outputTokens: 10 },
    }),
    turnEnd(1, 4_000),
  ])
  assert.equal(candidate.usageSampleCount, 1)
  assert.equal(candidate.usageUnobservableRetries, 1)
  assert.equal(candidate.usageComplete, false)
})

/* ── Privacy and rendering (D006, D017, §20–§23) ──────────────────────── */

test('TEL-11 the mail states a turn aggregate and never a raw single-call sample', async () => {
  const candidate = await runChain(multiStepTurnChain(1, [{ ...DEEPSEEK_CALL_USAGE }, { ...DEEPSEEK_CALL_USAGE }]))
  const text = mailFor(candidate)
  const usageLine = text.split('\n').find((line) => line.startsWith('Token usage (turn aggregate):'))
  assert.ok(usageLine !== undefined)
  assert.ok(usageLine.includes(`inputTokens=${5_954 * 2}`))
  assert.ok(usageLine.includes(`cacheReadTokens=${30_464 * 2}`))
  assert.ok(usageLine.includes('cacheWriteTokens=not reported'))
  assert.ok(text.includes('Token telemetry complete: yes (2 model calls observed, each reporting usage)'))
  assert.ok(!text.includes('as reported'))
  assert.ok(!text.includes('totalTokens'))
})

test('TEL-12 reasoning text and tool payloads never reach the mail or the log', async () => {
  const candidate = await runChain([
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    // A reasoning-only settlement first, then the answered one. They carry
    // distinct identities, which is what a real step's two messages would have.
    reasoningOnlyMessage(1, 1, 1_500),
    assistantMessage({
      turn: 1,
      step: 1,
      time: 2_000,
      seq: 202,
      id: 'message-answered',
      content: [
        { type: 'reasoning', text: `${REASONING_SECRET_SENTINEL} thinking` },
        { type: 'text', text: 'the final answer' },
        { type: 'tool-call', id: 'call-a', name: 'pwsh', arguments: `{"command":"${TOOL_ARGUMENT_SECRET_SENTINEL}"}` },
      ],
      usage: { ...DEEPSEEK_CALL_USAGE },
    }),
    toolCall(1, 1, 2_100),
    toolResultOk(1, 1, 2_200, TOOL_RESULT_SECRET_SENTINEL),
    turnEnd(1, 3_000),
  ])
  const text = mailFor(candidate)
  assert.ok(text.includes('the final answer'))
  for (const sentinel of [REASONING_SECRET_SENTINEL, TOOL_ARGUMENT_SECRET_SENTINEL, TOOL_RESULT_SECRET_SENTINEL]) {
    assert.ok(!text.includes(sentinel), `${sentinel} must not reach the mail`)
  }
  // The answered call is folded; the reasoning-only settlement is counted as a
  // call that reported no usage rather than being silently absorbed.
  assert.deepEqual(candidate.usage, {
    inputTokens: DEEPSEEK_CALL_USAGE['inputTokens'],
    outputTokens: DEEPSEEK_CALL_USAGE['outputTokens'],
    cacheReadTokens: DEEPSEEK_CALL_USAGE['cacheReadTokens'],
  })
  assert.equal(candidate.usageMissingCount, 1)
  assert.equal(candidate.usageComplete, false)
})
