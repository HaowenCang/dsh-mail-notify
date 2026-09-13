/**
 * L1 unit tests for `retry.ts` — matrix rows RET-01…RET-10's classification and
 * backoff halves.
 *
 * The rule under test is asymmetric on purpose: an unrecognised failure is
 * permanent. Retrying something unclassified four times multiplies load against
 * a server that has already refused, without making success more likely.
 *
 * @module dsh-mail-notify/tests/unit/retry
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  backoffDelayMs,
  backoffSequence,
  classifyError,
  decideRetry,
  permanentFailure,
  redactMessage,
  RETRY_BACKOFF_FACTOR,
} from '../../src/retry.ts'
import type { RetryPolicy } from '../../src/types.ts'

const POLICY: RetryPolicy = { retryAttempts: 3, retryBaseDelayMs: 1000, retryMaxDelayMs: 30_000 }

test('RET-01 ETIMEDOUT is retryable', () => {
  const failure = classifyError(Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT' }))
  assert.equal(failure.retryClass, 'retry')
  assert.equal(failure.category, 'code-ETIMEDOUT')
  assert.equal(failure.code, 'ETIMEDOUT')
})

test('RET-02 ECONNRESET is retryable', () => {
  assert.equal(classifyError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).retryClass, 'retry')
})

test('RET-03 EAI_AGAIN is retryable but ENOTFOUND is not', () => {
  assert.equal(classifyError(Object.assign(new Error('temporary dns'), { code: 'EAI_AGAIN' })).retryClass, 'retry')
  const notFound = classifyError(Object.assign(new Error('no such host'), { code: 'ENOTFOUND' }))
  assert.equal(notFound.retryClass, 'permanent')
  assert.equal(notFound.category, 'dns-not-found')
})

test('RET-04 a transient SMTP 4xx reply is retryable', () => {
  const failure = classifyError(Object.assign(new Error('try later'), { responseCode: 451 }))
  assert.equal(failure.retryClass, 'retry')
  assert.equal(failure.category, 'smtp-4xx')
  assert.equal(failure.responseCode, 451)
})

test('RET-05 EAUTH and 535 are permanent', () => {
  const auth = classifyError(Object.assign(new Error('invalid login'), { code: 'EAUTH', responseCode: 535 }))
  assert.equal(auth.retryClass, 'permanent')
  assert.equal(auth.category, 'smtp-auth')
  // The raw text can echo the user name, so it is replaced rather than carried.
  assert.ok(!auth.message.includes('invalid login'))
  assert.equal(classifyError(Object.assign(new Error('x'), { responseCode: 535 })).retryClass, 'permanent')
})

test('RET-05b the 4xx reply codes that mean bad authentication are permanent too', () => {
  for (const code of [530, 534, 454]) {
    const failure = classifyError(Object.assign(new Error('auth'), { responseCode: code }))
    assert.equal(failure.retryClass, 'permanent', `${code} must not be retried`)
    assert.equal(failure.category, 'smtp-auth')
  }
})

test('RET-06 EENVELOPE and 550 are permanent', () => {
  const envelope = classifyError(Object.assign(new Error('bad recipient'), { code: 'EENVELOPE', responseCode: 550 }))
  assert.equal(envelope.retryClass, 'permanent')
  assert.equal(envelope.category, 'envelope-rejected')
  assert.equal(classifyError(Object.assign(new Error('no such user'), { responseCode: 550 })).retryClass, 'permanent')
})

test('RET-07 any SMTP 5xx is permanent', () => {
  for (const code of [500, 501, 502, 503, 504, 554, 599]) {
    const failure = classifyError(Object.assign(new Error('policy'), { responseCode: code }))
    assert.equal(failure.retryClass, 'permanent', `${code} must not be retried`)
  }
})

test('RET-07b a refused connection is permanent', () => {
  const failure = classifyError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
  assert.equal(failure.retryClass, 'permanent', 'nothing is listening; four attempts will not change that')
})

test('RET-08 an unrecognised failure defaults to permanent and says so', () => {
  for (const error of [new Error('something odd'), { weird: true }, null, undefined, 'a string', 42]) {
    const failure = classifyError(error)
    assert.equal(failure.retryClass, 'permanent', `${String(error)} must default to permanent`)
    assert.equal(failure.category, 'unknown-error')
  }
})

test('RET-08b a numeric string responseCode and a response line are both read', () => {
  assert.equal(classifyError({ responseCode: '451' }).retryClass, 'retry')
  assert.equal(classifyError({ response: '421 4.7.0 try again later' }).retryClass, 'retry')
  assert.equal(classifyError({ response: '550 5.1.1 no such user' }).retryClass, 'permanent')
})

test('RET-09 the attempt budget is retryAttempts plus one', () => {
  const failure = classifyError(Object.assign(new Error('t'), { code: 'ETIMEDOUT' }))
  assert.deepEqual(decideRetry(failure, 1, POLICY), { retry: true, delayMs: 1000, attemptNumber: 1 })
  assert.deepEqual(decideRetry(failure, 2, POLICY), { retry: true, delayMs: 3000, attemptNumber: 2 })
  assert.deepEqual(decideRetry(failure, 3, POLICY), { retry: true, delayMs: 9000, attemptNumber: 3 })
  assert.deepEqual(decideRetry(failure, 4, POLICY), { retry: false }, 'four attempts is the cap for retryAttempts: 3')
})

test('RET-09b retryAttempts: 0 means a single attempt', () => {
  const failure = classifyError(Object.assign(new Error('t'), { code: 'ETIMEDOUT' }))
  assert.deepEqual(decideRetry(failure, 1, { ...POLICY, retryAttempts: 0 }), { retry: false })
})

test('RET-09c a permanent failure is never retried, whatever the budget', () => {
  const failure = classifyError(Object.assign(new Error('auth'), { code: 'EAUTH' }))
  for (const attempts of [1, 2, 3]) {
    assert.deepEqual(decideRetry(failure, attempts, POLICY), { retry: false })
  }
})

test('RET-10 the backoff sequence is base × 3^(n−1)', () => {
  const policy: RetryPolicy = { retryAttempts: 3, retryBaseDelayMs: 100, retryMaxDelayMs: 30_000 }
  assert.deepEqual(backoffSequence(policy), [100, 300, 900])
  assert.equal(backoffDelayMs(1, policy), 100)
  assert.equal(backoffDelayMs(2, policy), 100 * RETRY_BACKOFF_FACTOR)
  assert.equal(backoffDelayMs(3, policy), 900)
})

test('RET-10b the default policy produces 1 s, 3 s, 9 s', () => {
  assert.deepEqual(backoffSequence(POLICY), [1000, 3000, 9000])
})

test('the backoff is capped', () => {
  const policy: RetryPolicy = { retryAttempts: 10, retryBaseDelayMs: 1000, retryMaxDelayMs: 30_000 }
  assert.equal(backoffDelayMs(5, policy), 30_000)
  assert.equal(backoffDelayMs(10, policy), 30_000)
})

test('permanentFailure builds a classified, redacted record', () => {
  const failure = permanentFailure('credential-missing', 'the reference "X" is not configured\nsecond line')
  assert.equal(failure.retryClass, 'permanent')
  assert.equal(failure.category, 'credential-missing')
  assert.ok(!failure.message.includes('\n'))
})

test('redactMessage bounds length and strips control characters', () => {
  assert.equal(redactMessage('line one\nline two'), 'line one line two')
  assert.equal(redactMessage(''), 'no message')
  assert.equal(redactMessage(undefined), 'no message')
  assert.equal(redactMessage(42), 'no message')
  assert.ok(Array.from(redactMessage('x'.repeat(2000))).length <= 501)
})
