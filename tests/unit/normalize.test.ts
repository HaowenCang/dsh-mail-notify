/**
 * L1 unit tests for `normalize.ts` — matrix rows NORM-01…05 and USE-02/03/06.
 *
 * NORM-05 is the row with a history: in Phase 1 a single `undefined` optional
 * counter made the prototype's entire probe response unreadable, which removed
 * the only evidence channel available at the time. These tests encode that
 * failure as a regression.
 *
 * @module dsh-mail-notify/tests/unit/normalize
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeShape, isLosslessJson, normalize, stableJsonLine } from '../../src/normalize.ts'

test('NORM-01 a nested undefined is dropped and its path reported', () => {
  const { value, dropped } = normalize({ a: { b: undefined, c: 1 } })
  assert.deepEqual(value, { a: { c: 1 } })
  assert.ok(dropped.includes('a.b'), `expected a.b among ${JSON.stringify(dropped)}`)
  assert.ok(!Object.hasOwn((value as { a: Record<string, unknown> }).a, 'b'))
})

test('NORM-02 an array drops omitted slots and keeps the rest in order', () => {
  const { value } = normalize([1, undefined, 2])
  assert.deepEqual(value, [1, 2])
})

test('NORM-03 non-plain objects are omitted whole, without throwing', () => {
  class Custom {
    readonly field = 1
  }
  const { value, dropped } = normalize({
    when: new Date(0),
    map: new Map([['k', 'v']]),
    set: new Set([1]),
    custom: new Custom(),
    kept: 'yes',
  })
  assert.deepEqual(value, { kept: 'yes' })
  for (const path of ['when', 'map', 'set', 'custom']) {
    assert.ok(dropped.includes(path), `expected ${path} to be reported as dropped`)
  }
})

test('NORM-03b a null-prototype object is plain and is preserved', () => {
  const bare = Object.create(null) as Record<string, unknown>
  bare['kept'] = 1
  assert.deepEqual(normalize({ bare }).value, { bare: { kept: 1 } })
})

test('NORM-04 function, symbol, and bigint values are omitted and reported', () => {
  const { value, dropped } = normalize({
    fn: () => undefined,
    sym: Symbol('s'),
    big: 10n,
    kept: 1,
  })
  assert.deepEqual(value, { kept: 1 })
  for (const path of ['fn', 'sym', 'big']) {
    assert.ok(dropped.includes(path), `expected ${path} to be reported`)
  }
})

test('NORM-04b NaN and Infinity are omitted and reported; finite numbers survive', () => {
  const { value, dropped, droppedCount } = normalize({
    nan: Number.NaN,
    inf: Number.POSITIVE_INFINITY,
    neg: Number.NEGATIVE_INFINITY,
    ok: 0,
  })
  assert.deepEqual(value, { ok: 0 })
  assert.equal(droppedCount, 3)
  for (const path of ['nan', 'inf', 'neg']) {
    assert.ok(dropped.includes(path), `expected ${path} to be reported`)
  }
})

test('NORM-05 one bad record does not make a batch unreadable', () => {
  // The exact Phase 1 failure: three optional counters, one of them absent.
  const batch = [
    { usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: undefined } },
    { usage: { inputTokens: 11, outputTokens: 21 } },
    { usage: { inputTokens: 255, outputTokens: 759, totalTokens: 187638, cacheReadTokens: 186624 } },
  ]
  const normalized = batch.map((record) => normalize(record).value)
  assert.equal(normalized.length, 3)
  for (const record of normalized) {
    assert.ok(isLosslessJson(record), 'every record must be readable after normalization')
    assert.ok(JSON.stringify(record).length > 0)
  }
})

test('a top-level undefined is absorbed rather than thrown on', () => {
  assert.equal(normalize(undefined).value, undefined)
  assert.equal(normalize(undefined).droppedCount, 1)
})

test('normalization does not coerce types', () => {
  const { value } = normalize({ numericString: '42', booleanString: 'true', zero: 0, empty: '' })
  assert.deepEqual(value, { numericString: '42', booleanString: 'true', zero: 0, empty: '' })
})

test('the dropped-path list is bounded while the count stays exact', () => {
  const wide: Record<string, unknown> = {}
  for (let index = 0; index < 200; index += 1) wide[`k${index}`] = undefined
  const { dropped, droppedCount } = normalize(wide)
  assert.ok(dropped.length <= 64, `path list must be bounded, saw ${dropped.length}`)
  assert.equal(droppedCount, 200)
})

test('describeShape reports structure without content', () => {
  assert.deepEqual(describeShape(null), { type: 'null' })
  assert.deepEqual(describeShape([1, 2, 3]), { type: 'array', length: 3 })
  assert.deepEqual(describeShape({ secret: 'value' }), { type: 'object', keys: ['secret'] })
  assert.equal(describeShape('text').type, 'string')
  assert.equal(describeShape(new Date(0)).type, 'Date')
})

test('stableJsonLine collapses control characters into one line', () => {
  const line = stableJsonLine({ message: 'line one\nline two\r\nforged: true' })
  assert.ok(!line.includes('\n'), 'no literal LF may survive')
  assert.ok(!line.includes('\r'), 'no literal CR may survive')
  // JSON.stringify escapes the newline, so the payload stays on one physical
  // line while remaining recoverable.
  assert.ok(line.includes('line one\\nline two'))
})

test('stableJsonLine flattens the Unicode line separators JSON leaves raw', () => {
  const line = stableJsonLine({ message: 'a\u2028b\u2029c' })
  assert.ok(!line.includes('\u2028'))
  assert.ok(!line.includes('\u2029'))
})

test('lossless detection rejects every non-JSON shape', () => {
  assert.equal(isLosslessJson({ a: [1, { b: null }] }), true)
  assert.equal(isLosslessJson({ a: undefined }), false)
  assert.equal(isLosslessJson([1, Number.NaN]), false)
  assert.equal(isLosslessJson(new Date(0)), false)
  assert.equal(isLosslessJson(() => undefined), false)
})
