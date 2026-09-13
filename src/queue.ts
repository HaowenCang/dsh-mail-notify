/**
 * Bounded FIFO queue with a single-concurrency worker.
 *
 * The queue exists because the runtime calls its listeners on the synchronous
 * path of `Session.append()` and never awaits what they return. Sending from a
 * listener would therefore stall session-log commits, so the listener only
 * enqueues and returns; every wait, retry, and socket operation happens here,
 * off that path.
 *
 * `enqueue` is synchronous and returns a boolean so the caller can record an
 * accepted enqueue in the dedupe cache and decline to record a rejected one.
 * When the queue is full the *newest* job is refused: under sustained pressure
 * the most recent turn is the one still in the operator's field of view, and
 * either way the refusal is counted and logged rather than dropped silently.
 *
 * @module dsh-mail-notify/queue
 */

import type { FailureInfo } from './retry.ts'
import { classifyError, decideRetry, permanentFailure } from './retry.ts'
import type { MailJob, MailSink, RetryPolicy, SendResult } from './types.ts'

/** Structured record handed to the queue's observer after each job settles. */
export interface QueueOutcome {
  job: MailJob
  result: SendResult
  /** Total attempts made, including the successful or final failing one. */
  attempts: number
  /** Classification of the final failure, when there was one. */
  failure?: FailureInfo
  /** Backoff waits actually slept, in order. */
  delaysMs: readonly number[]
}

/** Counters and hooks the queue owner supplies. */
export interface QueueOptions {
  size: number
  sink: MailSink
  policy: RetryPolicy
  /**
   * Cancellable wait. The default resolves on the next macrotask; the plugin
   * passes the Cordis timer so a fiber unload ends a backoff immediately
   * instead of leaving a detached timer behind.
   */
  sleep?: (delayMs: number) => Promise<void>
  /** Called after each job settles, successful or not. */
  onOutcome?: (outcome: QueueOutcome) => void
  /** Called when a job is refused because the queue is at capacity. */
  onDropped?: (job: MailJob, depth: number) => void
}

/** The queue's observable surface. */
export interface MailQueue {
  /** Queue a job; `true` when accepted, `false` when refused at capacity. */
  enqueue(job: MailJob): boolean
  /** Resolve once no job is in flight and none is pending. */
  settle(): Promise<void>
  /** Refuse new jobs, let the in-flight one finish, and resolve. */
  dispose(): Promise<void>
  /** Current counters. */
  stats(): { depth: number; inFlight: boolean; droppedCount: number; processed: number; failed: number }
  /** Whether `dispose()` has run. */
  readonly disposed: boolean
  /** The FIFO contents, oldest first; for diagnostics and tests. */
  pending(): readonly MailJob[]
}

/** The default wait: one macrotask, used when no cancellable timer is supplied. */
export function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (delayMs <= 0) {
      resolve()
      return
    }
    setTimeout(resolve, delayMs)
  })
}

/**
 * Create the mail queue.
 *
 * @param options - capacity, sink, retry policy, and observer hooks.
 * @returns the queue.
 */
export function createMailQueue(options: QueueOptions): MailQueue {
  const pending: MailJob[] = []
  const sleep = options.sleep ?? defaultSleep
  let inFlight: Promise<void> | undefined
  let disposed = false
  let droppedCount = 0
  let processed = 0
  let failed = 0

  const drainWaiters: Array<() => void> = []

  const notifyDrained = (): void => {
    if (inFlight !== undefined || pending.length > 0) return
    for (const resolve of drainWaiters.splice(0, drainWaiters.length)) resolve()
  }

  /** Send one job, retrying only failures classified as retryable. */
  const runJob = async (job: MailJob): Promise<QueueOutcome> => {
    const delaysMs: number[] = []
    let attempts = 0
    for (;;) {
      attempts += 1
      let result: SendResult
      try {
        result = await options.sink(job)
      } catch (error) {
        // A sink that throws is a bug in the sink, not a transport verdict.
        // It is classified, logged, and counted rather than allowed to escape
        // as an unhandled rejection.
        const failure = classifyError(error)
        result = { ok: false, class: failure.retryClass, category: failure.category, message: failure.message }
      }

      if (result.ok) return { job, result, attempts, delaysMs }

      const failure: FailureInfo = {
        retryClass: result.class,
        category: result.category,
        message: result.message,
      }
      const decision = decideRetry(failure, attempts, options.policy)
      if (!decision.retry) return { job, result, attempts, failure, delaysMs }

      delaysMs.push(decision.delayMs)
      await sleep(decision.delayMs)
      if (disposed) {
        return {
          job,
          result: {
            ok: false,
            class: 'permanent',
            category: 'disposed',
            message: 'the plugin unloaded while the send was backing off',
          },
          attempts,
          failure: permanentFailure('disposed', 'the plugin unloaded while the send was backing off'),
          delaysMs,
        }
      }
    }
  }

  /** Pull jobs until the queue empties; one worker, started on first enqueue. */
  const runWorker = async (): Promise<void> => {
    try {
      for (;;) {
        const job = pending.shift()
        if (job === undefined) return
        const outcome = await runJob(job)
        processed += 1
        if (!outcome.result.ok) failed += 1
        try {
          options.onOutcome?.(outcome)
        } catch {
          // An observer throwing must not kill the worker.
        }
      }
    } finally {
      inFlight = undefined
      notifyDrained()
    }
  }

  const ensureWorker = (): void => {
    if (inFlight !== undefined || pending.length === 0) return
    inFlight = runWorker()
  }

  return {
    enqueue(job: MailJob): boolean {
      if (disposed) return false
      if (pending.length >= options.size) {
        droppedCount += 1
        options.onDropped?.(job, pending.length)
        return false
      }
      pending.push(job)
      ensureWorker()
      return true
    },

    settle(): Promise<void> {
      if (inFlight === undefined && pending.length === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        drainWaiters.push(resolve)
      })
    },

    async dispose(): Promise<void> {
      disposed = true
      pending.length = 0
      const active = inFlight
      if (active !== undefined) {
        // The in-flight job is allowed to finish; its own retry loop already
        // checks `disposed` before sleeping again.
        await active.catch(() => undefined)
      }
      notifyDrained()
    },

    stats() {
      return { depth: pending.length, inFlight: inFlight !== undefined, droppedCount, processed, failed }
    },

    get disposed() {
      return disposed
    },

    pending() {
      return [...pending]
    },
  }
}
