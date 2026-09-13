/**
 * L1 unit tests for `completion.ts` — matrix rows TRN-04…TRN-09 (classification
 * and detail extraction) plus USE-05's "usage does not decide status".
 *
 * @module dsh-mail-notify/tests/unit/completion
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifyCompletion,
  describeAbort,
  describeError,
  REASON_DETAIL_LIMIT,
  sanitizeDetail,
  toTurnEndKind,
} from '../../src/completion.ts'
import { TURN_END_REASONS } from '../fixtures/runtime-shapes.ts'

test('TRN-04 completed with no explicit tool error is completed-clean', () => {
  assert.equal(classifyCompletion('completed', 0), 'completed-clean')
})

test('TRN-05 completed with an explicit tool error is completed-with-tool-errors', () => {
  assert.equal(classifyCompletion('completed', 1), 'completed-with-tool-errors')
  assert.equal(classifyCompletion('completed', 7), 'completed-with-tool-errors')
})

test('TRN-06 max-tokens keeps its own status regardless of tool errors', () => {
  assert.equal(classifyCompletion('max-tokens', 0), 'max-tokens')
  assert.equal(classifyCompletion('max-tokens', 3), 'max-tokens')
})

test('TRN-07 the error kind classifies as error', () => {
  assert.equal(classifyCompletion('error', 0), 'error')
})

test('TRN-08 aborted, blocked, and interrupted each keep their own status', () => {
  assert.equal(classifyCompletion('aborted', 0), 'aborted')
  assert.equal(classifyCompletion('blocked', 2), 'blocked')
  assert.equal(classifyCompletion('interrupted', 0), 'interrupted')
})

test('TRN-09 an unconfirmed kind is unknown and never throws', () => {
  assert.equal(classifyCompletion('unknown', 0), 'unknown')
  assert.equal(classifyCompletion('unknown', 5), 'unknown')
})

test('all six confirmed kinds are recognised and nothing else is', () => {
  for (const kind of ['completed', 'max-tokens', 'error', 'aborted', 'blocked', 'interrupted']) {
    assert.equal(toTurnEndKind(kind), kind)
  }
  for (const value of ['future-kind', '', 'COMPLETED', 42, null, undefined, {}]) {
    assert.equal(toTurnEndKind(value), 'unknown', `${String(value)} must narrow to unknown`)
  }
})

test('TRN-08b the aborted cause kind becomes the detail', () => {
  assert.deepEqual(describeAbort(TURN_END_REASONS['aborted']), {
    detail: 'user',
    reasonDetail: 'the user cancelled the turn',
  })
  assert.equal(describeAbort({ kind: 'aborted', reason: { kind: 'disposed' } }).detail, 'disposed')
  assert.equal(describeAbort({ kind: 'aborted' }).detail, undefined)
})

test('TRN-08c the hook abort cause carries its reason string', () => {
  const described = describeAbort(TURN_END_REASONS['aborted-hook'])
  assert.equal(described.detail, 'hook')
  assert.ok(described.reasonDetail?.includes('budget exceeded'))
})

test('TRN-07b the error code becomes the detail and the message becomes the reason', () => {
  const described = describeError(TURN_END_REASONS['error'])
  assert.equal(described.detail, 'LLM_UNAVAILABLE')
  assert.equal(described.reasonDetail, 'upstream unavailable')
})

test('TRN-07c provider error text is cleaned and truncated', () => {
  const longMessage = 'x'.repeat(REASON_DETAIL_LIMIT + 250)
  const described = describeError({
    kind: 'error',
    error: { message: `first line\r\nforged: injected\n${longMessage}`, code: 'E\nX' },
  })
  assert.ok(described.reasonDetail !== undefined)
  assert.ok(!described.reasonDetail.includes('\n'), 'newlines must not survive into a mail body line')
  assert.ok(!described.reasonDetail.includes('\r'))
  assert.ok(Array.from(described.reasonDetail).length <= REASON_DETAIL_LIMIT)
  assert.equal(described.detail, 'E X', 'the code is cleaned too')
})

test('reason detail extraction tolerates every malformed reason shape', () => {
  for (const reason of [null, undefined, 'text', 42, {}, { kind: 'error' }, { kind: 'error', error: null }]) {
    assert.deepEqual(describeError(reason), {})
  }
  for (const reason of [null, undefined, 'text', 42, {}, { kind: 'aborted' }, { kind: 'aborted', reason: 'nope' }]) {
    assert.deepEqual(describeAbort(reason), {})
  }
})

test('sanitizeDetail returns undefined rather than an empty string', () => {
  assert.equal(sanitizeDetail('   \n\t '), undefined)
  assert.equal(sanitizeDetail(42), undefined)
  assert.equal(sanitizeDetail('ok'), 'ok')
})

test('USE-05 usage never participates in classification', () => {
  // The recorded inconsistency from Phase 1 is carried through unchanged; the
  // classification inputs here are the reason kind and the error count only.
  const status = classifyCompletion('completed', 0)
  assert.equal(status, 'completed-clean')
  // There is no code path from a usage value into classifyCompletion: its
  // second parameter is the explicit tool error count, and the arity is fixed.
  assert.equal(classifyCompletion.length, 2)
})
