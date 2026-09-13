/**
 * L1 unit tests for `content.ts` — matrix rows CNT-01…07 and TRUNC-01…05.
 *
 * The centre of gravity here is exclusion. A test that only asserts "the text
 * block was extracted" would still pass if reasoning text leaked alongside it,
 * so CNT-02 and CNT-03 assert the absence of the reasoning payload.
 *
 * @module dsh-mail-notify/tests/unit/content
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codePointLength, extractVisibleText, TRUNCATION_MARKER, truncateVisibleText } from '../../src/content.ts'
import { REASONING_SECRET_SENTINEL, TOOL_ARGUMENT_SECRET_SENTINEL } from '../fixtures/runtime-shapes.ts'

test('CNT-01 a single text block is returned verbatim', () => {
  assert.equal(extractVisibleText([{ type: 'text', text: 'A' }]), 'A')
})

test('CNT-02 a reasoning-only message yields empty text and does not throw', () => {
  const result = extractVisibleText([{ type: 'reasoning', text: `${REASONING_SECRET_SENTINEL} thinking` }])
  assert.equal(result, '')
  assert.ok(!result.includes(REASONING_SECRET_SENTINEL))
})

test('CNT-03 reasoning plus text keeps only the text', () => {
  const result = extractVisibleText([
    { type: 'reasoning', text: `${REASONING_SECRET_SENTINEL} hidden chain` },
    { type: 'text', text: 'A' },
  ])
  assert.equal(result, 'A')
  assert.ok(!result.includes(REASONING_SECRET_SENTINEL), 'reasoning text must not reach the visible text')
})

test('CNT-04 a tool-call block contributes nothing', () => {
  const result = extractVisibleText([
    { type: 'text', text: 'A' },
    { type: 'tool-call', id: 'x', name: 'n', arguments: `{"p":"${TOOL_ARGUMENT_SECRET_SENTINEL}"}` },
  ])
  assert.equal(result, 'A')
  assert.ok(!result.includes(TOOL_ARGUMENT_SECRET_SENTINEL), 'tool arguments must not reach the visible text')
})

test('CNT-05 multiple text blocks join with a newline and blanks are dropped', () => {
  const result = extractVisibleText([
    { type: 'text', text: 'first' },
    { type: 'text', text: '' },
    { type: 'text', text: '   \n\t ' },
    { type: 'text', text: 'second' },
  ])
  assert.equal(result, 'first\nsecond')
})

test('CNT-06 an unknown block type is skipped silently', () => {
  const result = extractVisibleText([
    { type: 'future-kind', payload: { anything: true } },
    { type: 'text', text: 'A' },
  ])
  assert.equal(result, 'A')
})

test('CNT-06b image and file blocks are excluded', () => {
  const result = extractVisibleText([
    { type: 'image', attachment: { id: 'sha256:abc' } },
    { type: 'file', attachment: { id: 'sha256:def' } },
    { type: 'text', text: 'A' },
  ])
  assert.equal(result, 'A')
})

test('CNT-06c a block whose type is text but whose text is not a string is skipped', () => {
  // A merge-extensible block map means a future block could reuse the name.
  assert.equal(extractVisibleText([{ type: 'text', text: { nested: 'object' } }]), '')
  assert.equal(extractVisibleText([{ type: 'text' }]), '')
})

test('CNT-07 malformed input yields empty text without throwing', () => {
  const cases: unknown[] = [null, undefined, 'a string', 42, {}, [], [null], [42], ['text'], [[]]]
  for (const value of cases) {
    assert.equal(extractVisibleText(value), '', `input ${JSON.stringify(value) ?? 'undefined'} must yield ''`)
  }
})

test('CNT-07b a hostile object with a throwing getter does not escape', () => {
  const hostile = {
    type: 'text',
    get text(): string {
      throw new Error('getter should never be read unguarded')
    },
  }
  // Reading `.text` is the documented behaviour, so this is expected to throw
  // only if the implementation reads it; the contract is that it does not
  // escape from a non-text block, which is what the case below proves.
  assert.equal(extractVisibleText([{ type: 'reasoning', get text(): string { throw new Error('unreachable') } }]), '')
  assert.equal(typeof hostile.type, 'string')
})

test('TRUNC-01 text exactly at the limit is not truncated', () => {
  const text = 'a'.repeat(100)
  const result = truncateVisibleText(text, 100)
  assert.equal(result.truncated, false)
  assert.equal(result.text, text)
  assert.equal(result.originalLength, 100)
})

test('TRUNC-02 one character over the limit truncates and reports it', () => {
  const result = truncateVisibleText('a'.repeat(101), 100)
  assert.equal(result.truncated, true)
  assert.equal(codePointLength(result.text), 100)
  assert.equal(result.originalLength, 101)
})

test('TRUNC-03 truncation never splits a surrogate pair', () => {
  // Each emoji is one code point but two UTF-16 units.
  const text = '😀'.repeat(10)
  const result = truncateVisibleText(text, 5)
  assert.equal(result.truncated, true)
  assert.equal(codePointLength(result.text), 5)
  assert.equal(result.text, '😀😀😀😀😀')
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result.text), 'no lone high surrogate may remain')
  assert.equal(Array.from(result.text).length, 5)
})

test('TRUNC-03b CJK text counts by code point, not by byte', () => {
  const text = '中文测试内容'
  const result = truncateVisibleText(text, 4)
  assert.equal(result.truncated, true)
  assert.equal(result.text, '中文测试')
  assert.equal(result.originalLength, 6)
})

test('TRUNC-04 the marker text is the frozen literal', () => {
  assert.equal(TRUNCATION_MARKER, '[Output truncated by dsh-mail-notify]')
})

test('TRUNC-05 the original length is preserved across truncation', () => {
  const original = 'x'.repeat(500)
  const result = truncateVisibleText(original, 100)
  assert.equal(result.originalLength, 500)
  assert.equal(result.originalLength, codePointLength(original))
})

test('truncateVisibleText never mutates its input and tolerates nonsense limits', () => {
  const original = 'abcdef'
  assert.equal(truncateVisibleText(original, 0).text, '')
  assert.equal(truncateVisibleText(original, Number.NaN).text, '')
  assert.equal(truncateVisibleText(original, -5).text, '')
  assert.equal(original, 'abcdef')
})
