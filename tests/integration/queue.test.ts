/**
 * L2 queue tests — matrix rows QUE-01…QUE-07.
 *
 * QUE-06 and QUE-07 together are the only automatable judgement on architecture
 * invariant three: the listener path must not wait for I/O. They are asserted
 * with a hanging sink and a wall-clock bound, because a queue that quietly
 * awaited its worker would still pass every ordering test.
 *
 * @module dsh-mail-notify/tests/integration/queue
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMailQueue, defaultSleep, type QueueOutcome } from '../../src/queue.ts'
import type { MailJob, MailSink, RetryPolicy, SendResult } from '../../src/types.ts'
import { testCandidate, testTurnNotification, turn, waitFor } from '../support/harness.ts'

const POLICY: RetryPolicy = { retryAttempts: 0, retryBaseDelayMs: 100, retryMaxDelayMs: 30_000 }
const RETRYING_POLICY: RetryPolicy = { retryAttempts: 3, retryBaseDelayMs: 100, retryMaxDelayMs: 30_000 }

/** A job labelled by turn so ordering can be observed. */
function job(turn: number): MailJob {
  return { notification: testTurnNotification(testCandidate({ turn })), to: ['r@example.com'], truncated: false }
}

/** A sink that records what it received and resolves on demand. */
function recordingSink(): { sink: MailSink; seen: number[]; concurrent: () => number; peak: () => number } {
  const seen: number[] = []
  let inFlight = 0
  let peak = 0
  return {
    seen,
    concurrent: () => inFlight,
    peak: () => peak,
    sink: async (mailJob: MailJob): Promise<SendResult> => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await defaultSleep(1)
      seen.push(turn(mailJob).turn)
      inFlight -= 1
      return { ok: true }
    },
  }
}

test('QUE-01 jobs are delivered in FIFO order', async () => {
  const recorder = recordingSink()
  const queue = createMailQueue({ size: 10, sink: recorder.sink, policy: POLICY })
  for (const turn of [1, 2, 3]) assert.equal(queue.enqueue(job(turn)), true)
  await queue.settle()
  assert.deepEqual(recorder.seen, [1, 2, 3])
  await queue.dispose()
})

test('QUE-02 at most one send is ever in flight', async () => {
  const recorder = recordingSink()
  const queue = createMailQueue({ size: 10, sink: recorder.sink, policy: POLICY })
  for (let turn = 1; turn <= 8; turn += 1) queue.enqueue(job(turn))
  await queue.settle()
  assert.equal(recorder.peak(), 1, 'concurrency is 1')
  assert.equal(recorder.seen.length, 8)
  await queue.dispose()
})

test('QUE-03 a full queue refuses the newest job and counts it', async () => {
  const outcomes: QueueOutcome[] = []
  const dropped: number[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const sink: MailSink = async (mailJob: MailJob): Promise<SendResult> => {
    if (turn(mailJob).turn === 1) await gate
    return { ok: true }
  }

  const queue = createMailQueue({
    size: 2,
    sink,
    policy: POLICY,
    onOutcome: (outcome) => outcomes.push(outcome),
    onDropped: (mailJob) => dropped.push(turn(mailJob).turn),
  })

  // Turn 1 occupies the worker; turns 2 and 3 fill the two waiting slots.
  assert.equal(queue.enqueue(job(1)), true)
  await waitFor(() => queue.stats().inFlight, 'the worker to pick up turn 1')
  assert.equal(queue.enqueue(job(2)), true)
  assert.equal(queue.enqueue(job(3)), true)
  assert.equal(queue.stats().depth, 2)

  // Turns 4 and 5 arrive with no room: refused, newest first, and visible.
  assert.equal(queue.enqueue(job(4)), false)
  assert.equal(queue.enqueue(job(5)), false)
  assert.deepEqual(dropped, [4, 5])
  assert.equal(queue.stats().droppedCount, 2)
  assert.equal(queue.stats().depth, 2, 'a refused job does not enter the queue')

  release?.()
  await queue.settle()
  assert.deepEqual(
    outcomes.map((outcome) => turn(outcome.job).turn),
    [1, 2, 3],
  )
  assert.equal(queue.stats().processed, 3)
  await queue.dispose()
})

test('QUE-04 a rejecting sink neither crashes the worker nor leaks a rejection', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)

  const outcomes: QueueOutcome[] = []
  const seen: number[] = []
  const sink: MailSink = async (mailJob: MailJob): Promise<SendResult> => {
    seen.push(turn(mailJob).turn)
    if (turn(mailJob).turn === 2) throw Object.assign(new Error('sink exploded'), { code: 'EAUTH' })
    return { ok: true }
  }

  try {
    const queue = createMailQueue({ size: 5, sink, policy: RETRYING_POLICY, onOutcome: (outcome) => outcomes.push(outcome) })
    queue.enqueue(job(1))
    queue.enqueue(job(2))
    queue.enqueue(job(3))
    await queue.settle()

    assert.deepEqual(seen, [1, 2, 3], 'the worker continued past the throwing job')
    const failed = outcomes.find((outcome) => turn(outcome.job).turn === 2)
    assert.ok(failed !== undefined)
    assert.equal(failed.result.ok, false)
    assert.equal(failed.failure?.category, 'smtp-auth')
    assert.equal(failed.attempts, 1, 'a permanent classification is not retried')
    assert.equal(queue.stats().failed, 1)
    assert.equal(queue.stats().processed, 3)
    await queue.dispose()
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }

  await defaultSleep(10)
  assert.deepEqual(unhandled, [], 'no unhandled rejection may escape the worker')
})

test('QUE-05 dispose stops intake, settles the in-flight job, and leaves nothing pending', async () => {
  const outcomes: QueueOutcome[] = []
  const seen: number[] = []
  const sink: MailSink = async (mailJob: MailJob): Promise<SendResult> => {
    await defaultSleep(5)
    seen.push(turn(mailJob).turn)
    return { ok: true }
  }
  const queue = createMailQueue({ size: 10, sink, policy: POLICY, onOutcome: (outcome) => outcomes.push(outcome) })
  queue.enqueue(job(1))
  queue.enqueue(job(2))
  await waitFor(() => queue.stats().inFlight, 'the worker to start')

  await queue.dispose()
  assert.equal(queue.disposed, true)
  assert.equal(queue.enqueue(job(3)), false, 'a disposed queue accepts nothing')
  assert.deepEqual(queue.pending(), [], 'pending jobs are released rather than left dangling')
  assert.deepEqual(seen, [1], 'the in-flight job was allowed to finish')
  assert.equal(outcomes.length, 1)
})

test('QUE-05b dispose while idle resolves immediately', async () => {
  const queue = createMailQueue({ size: 1, sink: async () => ({ ok: true }), policy: POLICY })
  await queue.dispose()
  assert.equal(queue.disposed, true)
})

test('QUE-06 enqueue is synchronous and returns a boolean', () => {
  const queue = createMailQueue({ size: 1, sink: async () => ({ ok: true }), policy: POLICY })
  const accepted: unknown = queue.enqueue(job(1))
  assert.equal(typeof accepted, 'boolean')
  assert.ok(!(accepted instanceof Promise), 'enqueue must not return a promise')
  assert.equal(accepted, true)
  // A full queue also answers synchronously and in the same tick.
  queue.enqueue(job(2))
  const refused: unknown = queue.enqueue(job(3))
  assert.equal(refused, false)
})

test('QUE-07 a hanging sink never blocks enqueue', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const queue = createMailQueue({
    size: 3,
    sink: async () => {
      await gate
      return { ok: true }
    },
    policy: POLICY,
  })

  queue.enqueue(job(1))
  await waitFor(() => queue.stats().inFlight, 'the worker to block on the hanging sink')

  const startedAt = Date.now()
  for (const turn of [2, 3]) queue.enqueue(job(turn))
  const elapsed = Date.now() - startedAt
  assert.ok(elapsed < 50, `enqueue must return without waiting on the sink (took ${elapsed} ms)`)
  assert.equal(queue.stats().depth, 2)

  release?.()
  await queue.settle()
  await queue.dispose()
})

test('a retryable failure is retried and the waits follow the policy', async () => {
  const outcomes: QueueOutcome[] = []
  let attempts = 0
  const sink: MailSink = async (): Promise<SendResult> => {
    attempts += 1
    if (attempts === 1) return { ok: false, class: 'retry', category: 'code-ETIMEDOUT', message: 'timeout' }
    return { ok: true }
  }
  const delays: number[] = []
  const queue = createMailQueue({
    size: 1,
    sink,
    policy: RETRYING_POLICY,
    sleep: async (delayMs) => {
      delays.push(delayMs)
    },
    onOutcome: (outcome) => outcomes.push(outcome),
  })
  queue.enqueue(job(1))
  await queue.settle()

  assert.equal(attempts, 2)
  assert.deepEqual(delays, [100])
  const outcome = outcomes[0]
  assert.ok(outcome !== undefined)
  assert.equal(outcome.result.ok, true)
  assert.equal(outcome.attempts, 2)
  assert.deepEqual([...outcome.delaysMs], [100])
  await queue.dispose()
})

test('RET-09 a persistently retryable failure stops at the attempt budget', async () => {
  const outcomes: QueueOutcome[] = []
  let attempts = 0
  const delays: number[] = []
  const queue = createMailQueue({
    size: 1,
    policy: RETRYING_POLICY,
    sink: async () => {
      attempts += 1
      return { ok: false, class: 'retry', category: 'code-ETIMEDOUT', message: 'timeout' }
    },
    sleep: async (delayMs) => {
      delays.push(delayMs)
    },
    onOutcome: (outcome) => outcomes.push(outcome),
  })
  queue.enqueue(job(1))
  await queue.settle()

  assert.equal(attempts, 4, 'retryAttempts: 3 means four total attempts')
  assert.deepEqual(delays, [100, 300, 900])
  assert.equal(outcomes[0]?.result.ok, false)
  assert.equal(queue.stats().failed, 1)
  await queue.dispose()
})

test('a permanent failure is attempted exactly once', async () => {
  let attempts = 0
  const queue = createMailQueue({
    size: 1,
    policy: RETRYING_POLICY,
    sink: async () => {
      attempts += 1
      return { ok: false, class: 'permanent', category: 'smtp-auth', message: 'rejected' }
    },
  })
  queue.enqueue(job(1))
  await queue.settle()
  assert.equal(attempts, 1)
  await queue.dispose()
})

test('RET-11 a dispose during a backoff ends the wait and settles the job', async () => {
  const outcomes: QueueOutcome[] = []
  let observedDisposal = false
  const queue = createMailQueue({
    size: 1,
    policy: RETRYING_POLICY,
    sink: async () => ({ ok: false, class: 'retry', category: 'code-ETIMEDOUT', message: 'timeout' }),
    // Stands in for the Cordis timer: the wait resolves only when disposed.
    sleep: async () => {
      await waitFor(() => queue.disposed, 'the plugin to unload during the backoff')
      observedDisposal = true
    },
    onOutcome: (outcome) => outcomes.push(outcome),
  })
  queue.enqueue(job(1))
  await waitFor(() => queue.stats().inFlight, 'the first attempt')
  await queue.dispose()

  assert.equal(observedDisposal, true)
  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0]?.result.ok, false)
  assert.equal(outcomes[0]?.result.ok === false ? outcomes[0].result.category : '', 'disposed')
})

test('an observer that throws cannot kill the worker', async () => {
  const seen: number[] = []
  const queue = createMailQueue({
    size: 5,
    policy: POLICY,
    sink: async (mailJob: MailJob) => {
      seen.push(turn(mailJob).turn)
      return { ok: true }
    },
    onOutcome: () => {
      throw new Error('observer failure')
    },
  })
  queue.enqueue(job(1))
  queue.enqueue(job(2))
  await queue.settle()
  assert.deepEqual(seen, [1, 2])
  await queue.dispose()
})

test('settle resolves immediately when nothing is queued', async () => {
  const queue = createMailQueue({ size: 1, sink: async () => ({ ok: true }), policy: POLICY })
  await queue.settle()
  assert.equal(queue.stats().processed, 0)
  await queue.dispose()
})
