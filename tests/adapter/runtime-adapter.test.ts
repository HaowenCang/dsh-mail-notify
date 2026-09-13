/**
 * L3 adapter tests — matrix rows SES-01…SES-07, ADP-01…ADP-06, and the
 * adapter-side halves of TOOL-01…TOOL-05.
 *
 * Every payload here comes from `tests/fixtures/runtime-shapes.ts`, which
 * mirrors the field paths and value patterns recorded at runtime in Phase 1.
 * That matters more than usual for this module: an adapter test built from a
 * declaration file rather than from observed payloads would pass while the real
 * runtime delivered something else.
 *
 * @module dsh-mail-notify/tests/adapter/runtime-adapter
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toInternalEvent, toSessionFacts, toSessionId } from '../../src/runtime-adapter.ts'
import {
  assistantMessage,
  bareRootSession,
  depthOnlySubagent,
  mixedAssistantMessage,
  parentOnlySubagent,
  rootSession,
  subagentSession,
  toolResultBlockError,
  toolResultEventError,
  toolResultNonZeroExit,
  toolResultOk,
  turnEnd,
  turnStart,
  TURN_END_REASONS,
  OBSERVED_USAGE,
} from '../fixtures/runtime-shapes.ts'

/* ── Session facts (D003) ─────────────────────────────────────────────── */

test('SES-01 a session with no hierarchy fields is top level', () => {
  const facts = toSessionFacts(bareRootSession())
  assert.equal(facts.isSubagent, false)
  assert.equal(facts.decidedBy, null)
})

test('SES-02 a root session carrying delegationDepth 0 is top level', () => {
  // The trap the runtime actually produced: `origin: null`, `parentSession:
  // null`, and `delegationDepth: 0` — a normal top-level session.
  const facts = toSessionFacts(rootSession())
  assert.equal(facts.isSubagent, false, 'delegationDepth 0 must not classify as a subagent')
  assert.equal(facts.decidedBy, null)
})

test('SES-03 origin is the deciding criterion when present', () => {
  const facts = toSessionFacts(subagentSession())
  assert.equal(facts.isSubagent, true)
  assert.equal(facts.decidedBy, 'origin')
})

test('SES-04 parentSession decides when origin is absent', () => {
  const facts = toSessionFacts(parentOnlySubagent())
  assert.equal(facts.isSubagent, true)
  assert.equal(facts.decidedBy, 'parentSession')
})

test('SES-05 a positive delegationDepth decides when the others are absent', () => {
  const facts = toSessionFacts(depthOnlySubagent('session-d', 1))
  assert.equal(facts.isSubagent, true)
  assert.equal(facts.decidedBy, 'delegationDepth')
})

test('SES-06 only a strictly positive delegationDepth counts', () => {
  const zero = toSessionFacts(depthOnlySubagent('session-zero', 0))
  const one = toSessionFacts(depthOnlySubagent('session-one', 1))
  assert.equal(zero.isSubagent, false, 'depth 0 is a legal top-level value')
  assert.equal(zero.decidedBy, null)
  assert.equal(one.isSubagent, true)
})

test('SES-06b a depth arriving as a numeric string or a non-number is not a subagent', () => {
  // The runtime writes a number. A string that merely looks numeric must not be
  // coerced into one, because doing so would invent hierarchy.
  for (const depth of ['1', '0', true, false, null, {}, []]) {
    const facts = toSessionFacts({ id: 'session-x', header: { delegationDepth: depth } })
    assert.equal(facts.isSubagent, false, `delegationDepth ${JSON.stringify(depth)} must not decide`)
  }
})

test('SES-06c a non-positive or non-finite numeric depth is not a subagent', () => {
  for (const depth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const facts = toSessionFacts({ id: 'session-x', header: { delegationDepth: depth } })
    assert.equal(facts.isSubagent, false, `delegationDepth ${String(depth)} must not decide`)
  }
})

test('SES-07 the session id format never influences the decision', () => {
  const lookalike = toSessionFacts({ id: 'session-subagent-0000', header: {} })
  assert.equal(lookalike.isSubagent, false, 'a name that reads like a subagent is still just a name')
  const plainSubagent = toSessionFacts({ id: 's', header: { origin: 'subagent' } })
  assert.equal(plainSubagent.isSubagent, true)
})

test('SES-07b an empty parentSession string is not a hierarchy signal', () => {
  const facts = toSessionFacts({ id: 'session-x', header: { parentSession: '' } })
  assert.equal(facts.isSubagent, false)
})

test('session metadata is read when present and omitted when absent', () => {
  const withMeta = toSessionFacts(rootSession())
  assert.equal(withMeta.cwd, 'E:\\Projects\\DSHarness\\dsh-mail-notify')
  assert.equal(withMeta.agentPreset, 'standard')
  const bare = toSessionFacts(bareRootSession())
  assert.equal(bare.cwd, undefined)
  assert.equal(bare.agentPreset, undefined)
  assert.equal(bare.sessionId, 'session-bare')
})

test('a malformed session is described rather than throwing', () => {
  const cases: unknown[] = [{}, { id: 42 }, { id: null }, { id: 'x', header: 'not an object' }, { id: 'x', header: [] }]
  for (const value of cases) {
    const facts = toSessionFacts(value as never)
    assert.equal(typeof facts.sessionId, 'string')
    assert.equal(facts.isSubagent, false)
  }
  assert.equal(toSessionId({ id: 42 } as never), '42')
  assert.equal(toSessionId({} as never), 'unknown-session')
})

/* ── Event adaptation (D001) ──────────────────────────────────────────── */

test('ADP-01 a complete assistant message maps every field', () => {
  const event = assistantMessage({
    turn: 3,
    step: 4,
    time: 1_750_000_000_500,
    content: [{ type: 'text', text: 'answer' }],
    id: 'message-abc',
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    usage: { ...OBSERVED_USAGE },
  })
  const internal = toInternalEvent(event)
  assert.equal(internal.kind, 'assistant-message')
  if (internal.kind !== 'assistant-message') return
  assert.equal(internal.turn, 3)
  assert.equal(internal.step, 4)
  assert.equal(internal.timeMs, 1_750_000_000_500)
  assert.equal(internal.messageId, 'message-abc')
  assert.equal(internal.provider, 'deepseek-official')
  assert.equal(internal.model, 'deepseek-chat')
  assert.deepEqual(internal.usage, { ...OBSERVED_USAGE })
  assert.equal(internal.blocks.length, 1)
})

test('ADP-02 a missing or non-numeric turn degrades to other', () => {
  for (const data of [{}, { turn: null }, { turn: '3' }, { turn: Number.NaN }, { turn: undefined }]) {
    const internal = toInternalEvent({ type: 'turn/start', time: 1, data })
    assert.equal(internal.kind, 'other', `data ${JSON.stringify(data)} must not produce a turn`)
    if (internal.kind === 'other') assert.equal(internal.turn, undefined, 'no turn 0 or NaN fallback may appear')
  }
  assert.equal(toInternalEvent({ type: 'turn/end', time: 1 }).kind, 'other')
})

test('ADP-02b an assistant message without a step still adapts its turn', () => {
  const internal = toInternalEvent({
    type: 'assistant/message',
    time: 5,
    data: { turn: 2, message: { content: [{ type: 'text', text: 'x' }] } },
  })
  assert.equal(internal.kind, 'assistant-message')
  if (internal.kind === 'assistant-message') assert.equal(internal.step, 0)
})

test('ADP-03 a non-model source omits provider and model without throwing', () => {
  for (const kind of ['user', 'plugin', 'tool', undefined, 42]) {
    const internal = toInternalEvent({
      type: 'assistant/message',
      time: 5,
      data: {
        turn: 1,
        step: 1,
        message: { id: 'm', source: { kind, provider: 'x', model: 'y' }, content: [] },
      },
    })
    assert.equal(internal.kind, 'assistant-message')
    if (internal.kind !== 'assistant-message') return
    assert.equal(internal.provider, undefined, `source.kind ${String(kind)} must not yield a provider`)
    assert.equal(internal.model, undefined)
  }
})

test('ADP-03b a missing source or a missing message does not throw', () => {
  for (const message of [undefined, null, 'text', 42, {}, { source: 'nope' }]) {
    const internal = toInternalEvent({ type: 'assistant/message', time: 5, data: { turn: 1, step: 1, message } })
    assert.equal(internal.kind, 'assistant-message')
    if (internal.kind === 'assistant-message') {
      assert.deepEqual([...internal.blocks], [])
      assert.equal(internal.provider, undefined)
    }
  }
})

test('ADP-04 an unknown event type degrades to other and keeps its type label', () => {
  for (const type of ['step/end', 'agent/inbox/spliced', 'subagent/catalog', 'future/kind']) {
    const internal = toInternalEvent({ type, time: 7, data: { turn: 2, step: 1 } })
    assert.equal(internal.kind, 'other')
    if (internal.kind === 'other') {
      assert.equal(internal.type, type)
      assert.equal(internal.turn, 2, 'a usable turn number is still reported')
    }
  }
})

test('ADP-04b structurally impossible events do not throw', () => {
  const cases: unknown[] = [null, undefined, 42, 'turn/start', [], { type: 42 }, { type: 'turn/start', data: [] }]
  for (const value of cases) {
    const internal = toInternalEvent(value as never)
    assert.equal(typeof internal.kind, 'string')
  }
})

test('ADP-05 no returned value references the input objects', () => {
  const session = rootSession()
  const event = mixedAssistantMessage(1, 1, 100, 'answer')
  const facts = toSessionFacts(session)
  const internal = toInternalEvent(event)

  /** Recursively look for an identity match against the given roots. */
  const references = (value: unknown, roots: readonly unknown[], seen = new Set<unknown>()): boolean => {
    if (typeof value !== 'object' || value === null) return false
    if (seen.has(value)) return false
    seen.add(value)
    // Identity only: `Array.includes` uses SameValueZero and is correct here,
    // while a substring or membership helper would match inherited members.
    if (roots.some((root) => root === value)) return true
    return Object.values(value as Record<string, unknown>).some((child) => references(child, roots, seen))
  }

  const roots = [session, session.header, event, event.data, (event.data as { message: unknown }).message]
  assert.equal(references(facts, roots), false, 'SessionFacts must not retain a DSH object')
  assert.equal(references(internal, roots), false, 'InternalEvent must not retain a DSH object')

  // The content array is the one deliberate exception: it is a copy of the
  // blocks array, not the live array, so mutating the original cannot reach it.
  if (internal.kind === 'assistant-message') {
    assert.notEqual(internal.blocks, (event.data as { message: { content: unknown } }).message.content)
  }
})

test('ADP-05b the returned event is JSON-serializable', () => {
  const internal = toInternalEvent(mixedAssistantMessage(1, 1, 100, 'answer'))
  assert.doesNotThrow(() => JSON.stringify(internal))
  assert.ok(JSON.stringify(internal).length > 0)
})

test('turn/start and tool/call adapt their turn and step', () => {
  assert.deepEqual(toInternalEvent(turnStart(4, 1000)), { kind: 'turn-start', turn: 4, timeMs: 1000 })
  const call = toInternalEvent({ type: 'tool/call', time: 20, data: { turn: 2, step: 3, callId: 'c', name: 'pwsh', arguments: '{}' } })
  assert.deepEqual(call, { kind: 'tool-call', turn: 2, step: 3, timeMs: 20 })
})

/* ── Tool results (D005) ──────────────────────────────────────────────── */

test('TOOL-01 criterion A alone marks an explicit error', () => {
  const internal = toInternalEvent(toolResultBlockError(1, 1, 100))
  assert.equal(internal.kind, 'tool-result')
  if (internal.kind !== 'tool-result') return
  assert.equal(internal.explicitError, true)
})

test('TOOL-02 criterion B alone marks an explicit error and carries its name and code', () => {
  const internal = toInternalEvent(toolResultEventError(1, 1, 100))
  assert.equal(internal.kind, 'tool-result')
  if (internal.kind !== 'tool-result') return
  assert.equal(internal.explicitError, true)
  assert.equal(internal.errorName, 'FsError')
  assert.equal(internal.errorCode, 'FS_NOT_FOUND')
})

test('TOOL-03 both criteria at once still yield a single folded flag', () => {
  const event = toolResultBlockError(1, 1, 100)
  ;(event.data as Record<string, unknown>)['error'] = { name: 'FsError', code: 'FS_NOT_FOUND' }
  const internal = toInternalEvent(event)
  assert.equal(internal.kind, 'tool-result')
  if (internal.kind !== 'tool-result') return
  assert.equal(internal.explicitError, true)
  // The folding happens here, so there is no second flag downstream to double-count.
  assert.deepEqual(Object.keys(internal).sort(), ['errorCode', 'errorName', 'explicitError', 'kind', 'step', 'timeMs', 'turn'])
})

test('TOOL-04 an explicit isError:false is not an error', () => {
  const event = toolResultOk(1, 1, 100)
  ;((event.data as { message: { content: unknown[] } }).message.content[0] as Record<string, unknown>)['isError'] = false
  const internal = toInternalEvent(event)
  assert.equal(internal.kind, 'tool-result')
  if (internal.kind === 'tool-result') assert.equal(internal.explicitError, false)
})

test('TOOL-04b a successful result omits the error fields entirely', () => {
  const internal = toInternalEvent(toolResultOk(1, 1, 100))
  assert.equal(internal.kind, 'tool-result')
  if (internal.kind !== 'tool-result') return
  assert.equal(internal.explicitError, false)
  assert.equal(internal.errorName, undefined)
  assert.equal(internal.errorCode, undefined)
  assert.ok(!Object.hasOwn(internal, 'errorName'), 'a successful result must not carry an empty error name')
})

test('TOOL-05 a non-zero shell exit is not an error', () => {
  // The single most important semantic line in this project: DSH reports a
  // non-zero shell exit as a successful tool result, with the code only in the
  // text. Counting it as an error would misreport ordinary command failure as a
  // harness tool failure.
  const internal = toInternalEvent(toolResultNonZeroExit(1, 1, 100))
  assert.equal(internal.kind, 'tool-result')
  if (internal.kind !== 'tool-result') return
  assert.equal(internal.explicitError, false, '[exit code: 1] in the text must not be parsed into an error')
})

test('TOOL-05b hostile text in a result body cannot manufacture an error', () => {
  for (const text of ['[exit code: 1]', 'Error: failed', 'exit code 127', '{"isError":true}', 'stderr: boom']) {
    const internal = toInternalEvent(toolResultOk(1, 1, 100, text))
    assert.equal(internal.kind, 'tool-result')
    if (internal.kind === 'tool-result') {
      assert.equal(internal.explicitError, false, `${JSON.stringify(text)} must not be interpreted`)
    }
  }
})

test('TOOL-05c a non-object error payload still counts as the event-level signal', () => {
  const event = toolResultOk(1, 1, 100)
  ;(event.data as Record<string, unknown>)['error'] = 'boom'
  const internal = toInternalEvent(event)
  assert.equal(internal.kind, 'tool-result')
  if (internal.kind !== 'tool-result') return
  assert.equal(internal.explicitError, true)
  assert.equal(internal.errorName, undefined, 'a non-object error has no name to report')
})

/* ── Turn end reasons ─────────────────────────────────────────────────── */

test('all six confirmed turn/end reasons adapt without loss', () => {
  const expectations: [string, string][] = [
    ['completed', 'completed'],
    ['max-tokens', 'max-tokens'],
    ['error', 'error'],
    ['aborted', 'aborted'],
    ['blocked', 'blocked'],
    ['interrupted', 'interrupted'],
  ]
  for (const [fixture, expected] of expectations) {
    const internal = toInternalEvent(turnEnd(1, 100, TURN_END_REASONS[fixture] ?? {}))
    assert.equal(internal.kind, 'turn-end')
    if (internal.kind === 'turn-end') assert.equal(internal.turnEndKind, expected)
  }
})

test('an unconfirmed turn/end reason becomes unknown without throwing', () => {
  const internal = toInternalEvent(turnEnd(1, 100, TURN_END_REASONS['future'] ?? {}))
  assert.equal(internal.kind, 'turn-end')
  if (internal.kind === 'turn-end') {
    assert.equal(internal.turnEndKind, 'unknown')
    assert.equal(internal.detail, undefined)
  }
})

test('a missing or malformed reason becomes unknown', () => {
  for (const reason of [undefined, null, 'completed', 42, {}, []]) {
    const internal = toInternalEvent({ type: 'turn/end', time: 1, data: { turn: 1, reason } })
    assert.equal(internal.kind, 'turn-end')
    if (internal.kind === 'turn-end') assert.equal(internal.turnEndKind, 'unknown', `${JSON.stringify(reason)}`)
  }
})

test('aborted and error carry their detail through adaptation', () => {
  const aborted = toInternalEvent(turnEnd(1, 100, TURN_END_REASONS['aborted'] ?? {}))
  if (aborted.kind === 'turn-end') {
    assert.equal(aborted.detail, 'user')
    assert.ok(aborted.reasonDetail?.includes('user cancelled'))
  }
  const failed = toInternalEvent(turnEnd(1, 100, TURN_END_REASONS['error'] ?? {}))
  if (failed.kind === 'turn-end') {
    assert.equal(failed.detail, 'LLM_UNAVAILABLE')
    assert.equal(failed.reasonDetail, 'upstream unavailable')
  }
})

test('a usage object with a missing counter adapts to a partial counter set', () => {
  const internal = toInternalEvent(
    assistantMessage({
      turn: 1,
      step: 1,
      time: 1,
      content: [],
      usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: undefined },
    }),
  )
  assert.equal(internal.kind, 'assistant-message')
  if (internal.kind !== 'assistant-message') return
  assert.deepEqual(internal.usage, { inputTokens: 10, outputTokens: 20 })
})

test('a malformed usage object yields no usage rather than a broken one', () => {
  for (const usage of [null, 'usage', 42, [], {}, { inputTokens: 'ten' }]) {
    const internal = toInternalEvent(assistantMessage({ turn: 1, step: 1, time: 1, content: [], usage: usage as never }))
    assert.equal(internal.kind, 'assistant-message')
    if (internal.kind === 'assistant-message') assert.equal(internal.usage, undefined)
  }
})

test('a missing event time becomes 0 rather than NaN', () => {
  const internal = toInternalEvent({ type: 'turn/start', data: { turn: 1 } })
  assert.equal(internal.kind, 'turn-start')
  if (internal.kind === 'turn-start') {
    assert.equal(internal.timeMs, 0)
    assert.ok(Number.isFinite(internal.timeMs))
  }
})

test('the adapter is pure: adapting the same event twice yields equal results', () => {
  const event = mixedAssistantMessage(2, 3, 500, 'answer')
  assert.deepEqual(toInternalEvent(event), toInternalEvent(event))
  const session = subagentSession()
  assert.deepEqual(toSessionFacts(session), toSessionFacts(session))
})
