/**
 * Prompt-attribution tests — the source-based rule of DSH 0.1.7 (D021).
 *
 * A turn's prompt is the most recent `user/message` of that turn whose
 * `source.kind` is exactly `user`. Everything else DSH writes as a user-role
 * message — the runtime-context snapshot, the skill catalogue, the
 * agent-instruction baseline, tool-job notices, goal continuations, agent
 * messages — carries its own kind and must never claim or replace the prompt,
 * whatever its text and wherever it sits in the turn.
 *
 * The suite drives the mounted plugin rather than a bare handler because
 * attribution is only observable where it is used: the `userText` a candidate
 * carries. The harness is the same real registration and dispatch path the
 * integration suites use, so a test here cannot pass against a handler the
 * plugin does not actually run.
 *
 * The reordering case is the one that matters most. The recorded corpus happens
 * to write the prompt before its injected context, so a rule keyed on position
 * would pass today; these tests permute the order deliberately, because DSH
 * promises the kind and not the order.
 *
 * @module dsh-mail-notify/tests/unit/prompt-attribution
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionEventLike, SessionLike } from '../../src/runtime-adapter.ts'
import type { MailJob } from '../../src/types.ts'
import {
  assistantMessage,
  injectedUserMessage,
  rootSession,
  stepStart,
  turnEnd,
  turnStart,
  userMessage,
  userMessageWithSource,
  AGENT_INSTRUCTIONS_SOURCE_KIND,
  GOAL_SOURCE_KIND,
  RUNTIME_CONTEXT_SOURCE_KIND,
  SKILL_CATALOG_SOURCE_KIND,
  TOOL_JOBS_SOURCE_KIND,
} from '../fixtures/runtime-shapes.ts'
import { controllableSink, emit, mountPlugin, type PluginHarness } from '../support/plugin-harness.ts'
import { turn } from '../support/harness.ts'

/** Sentinels used to prove a source payload or an injected text never travels. */
const SOURCE_PAYLOAD_SENTINEL = 'SOURCE_PAYLOAD_SENTINEL'
const INJECTED_TEXT_SENTINEL = 'INJECTED_TEXT_SENTINEL'

interface Attributed {
  harness: PluginHarness
  jobs: MailJob[]
  /** The prompt the candidate carried, or `undefined` when none was attributed. */
  userTextOf: (index: number) => string | undefined
  /** Rejection records, by reason. */
  rejections: () => Array<{ reason: string; sourceKind: unknown; textLength: unknown }>
}

/**
 * Mount the plugin with the prompt switch on, emit one or more chains, settle.
 *
 * @param chains - one or more event sequences; all are emitted on one session
 *   unless `sessions` supplies a stand-in per chain.
 * @param options - per-test overrides: `includeUserPrompt` and the session list.
 * @returns the harness plus the assertions helpers the cases share.
 */
async function attribute(
  chains: readonly (readonly SessionEventLike[])[],
  options: { includeUserPrompt?: boolean; sessions?: readonly SessionLike[] } = {},
): Promise<Attributed> {
  const sink = controllableSink()
  const harness = await mountPlugin(
    { includeUserPrompt: options.includeUserPrompt ?? true },
    { sink: sink.sink },
  )
  const handle = harness.handle
  if (handle === undefined) throw new Error('the plugin refused to mount, so nothing can be attributed')
  chains.forEach((chain, index) => {
    emit(harness.ctx, options.sessions?.[index] ?? rootSession('session-attribution'), chain)
  })
  await handle.queue.settle()

  return {
    harness,
    jobs: sink.jobs,
    userTextOf: (index) => turn(sink.jobs[index])?.userText,
    rejections: () =>
      handle.logger
        .getRecords()
        .filter((record) => record.event === 'prompt.attribution-rejected')
        .map((record) => ({
          reason: String(record.fields['reason']),
          sourceKind: record.fields['sourceKind'],
          textLength: record.fields['textLength'],
        })),
  }
}

/**
 * One turn chain whose user-role messages are supplied in the given order.
 *
 * @param turnNumber - the turn to open.
 * @param messages - the user-role events, in delivery order.
 * @param answer - the assistant text that settles the turn.
 * @returns the event sequence.
 */
function turnWith(
  turnNumber: number,
  messages: readonly SessionEventLike[],
  answer = 'the answer',
): SessionEventLike[] {
  const base = turnNumber * 1_000
  return [
    turnStart(turnNumber, base),
    stepStart(turnNumber, 1, base + 1),
    ...messages,
    assistantMessage({ turn: turnNumber, step: 1, time: base + 50, content: [{ type: 'text', text: answer }] }),
    turnEnd(turnNumber, base + 60),
  ]
}

/* ── The two orderings that must agree ────────────────────────────────── */

test('ATT-01 injected context before the prompt: the prompt wins', async () => {
  const result = await attribute([
    turnWith(1, [
      injectedUserMessage('Current runtime context.', RUNTIME_CONTEXT_SOURCE_KIND),
      injectedUserMessage('The skill catalogue.', SKILL_CATALOG_SOURCE_KIND),
      userMessage('PROMPT the operator typed'),
    ]),
  ])
  assert.equal(result.jobs.length, 1)
  assert.equal(result.userTextOf(0), 'PROMPT the operator typed')
})

test('ATT-02 the prompt followed by injected context: the prompt still wins', async () => {
  // The case a positional rule gets wrong: the operator's message arrives first
  // and every later user-role message is platform context.
  const result = await attribute([
    turnWith(1, [
      userMessage('PROMPT the operator typed'),
      injectedUserMessage('Current runtime context.', RUNTIME_CONTEXT_SOURCE_KIND),
      injectedUserMessage('The skill catalogue.', SKILL_CATALOG_SOURCE_KIND),
      injectedUserMessage('Workspace instructions.', AGENT_INSTRUCTIONS_SOURCE_KIND),
      injectedUserMessage('A tool-job notice.', TOOL_JOBS_SOURCE_KIND),
    ]),
  ])
  assert.equal(result.userTextOf(0), 'PROMPT the operator typed')
  const serialized = JSON.stringify(result.jobs[0])
  assert.ok(!serialized.includes('Current runtime context'), 'no injected text may reach the mail')
  assert.ok(!serialized.includes('skill catalogue'), 'nor the catalogue')
})

test('ATT-03 reordering the injected messages changes nothing', async () => {
  // Same three kinds, three permutations. The attributed prompt is identical in
  // every one, which is the property the implementation must hold if DSH ever
  // reorders what it injects.
  const permutations: string[][] = [
    [RUNTIME_CONTEXT_SOURCE_KIND, SKILL_CATALOG_SOURCE_KIND, AGENT_INSTRUCTIONS_SOURCE_KIND],
    [SKILL_CATALOG_SOURCE_KIND, AGENT_INSTRUCTIONS_SOURCE_KIND, RUNTIME_CONTEXT_SOURCE_KIND],
    [AGENT_INSTRUCTIONS_SOURCE_KIND, RUNTIME_CONTEXT_SOURCE_KIND, SKILL_CATALOG_SOURCE_KIND],
  ]
  for (const order of permutations) {
    const injected = order.map((kind, index) => injectedUserMessage(`injected ${index} (${kind})`, kind, 100 + index))
    const result = await attribute([turnWith(1, [...injected, userMessage('PROMPT in every order')])])
    assert.equal(result.userTextOf(0), 'PROMPT in every order', `order ${order.join(' > ')}`)
  }
})

test('ATT-04 the prompt is attributed wherever it sits among the injected messages', async () => {
  const before = await attribute([
    turnWith(1, [userMessage('PROMPT first'), injectedUserMessage('context', RUNTIME_CONTEXT_SOURCE_KIND)]),
  ])
  const middle = await attribute([
    turnWith(1, [
      injectedUserMessage('context', RUNTIME_CONTEXT_SOURCE_KIND),
      userMessage('PROMPT middle'),
      injectedUserMessage('catalogue', SKILL_CATALOG_SOURCE_KIND),
    ]),
  ])
  const after = await attribute([
    turnWith(1, [injectedUserMessage('context', RUNTIME_CONTEXT_SOURCE_KIND), userMessage('PROMPT last')]),
  ])
  assert.equal(before.userTextOf(0), 'PROMPT first')
  assert.equal(middle.userTextOf(0), 'PROMPT middle')
  assert.equal(after.userTextOf(0), 'PROMPT last')
})

/* ── Which message is the prompt ──────────────────────────────────────── */

test('ATT-05 the most recent direct prompt of a turn wins', async () => {
  const result = await attribute([
    turnWith(1, [
      userMessage('PROMPT_FIRST'),
      injectedUserMessage('context between them', RUNTIME_CONTEXT_SOURCE_KIND),
      userMessage('PROMPT_SECOND'),
    ]),
  ])
  assert.equal(result.userTextOf(0), 'PROMPT_SECOND', 'a second direct message is a correction, not context')
})

test('ATT-06 a turn with no direct-human message renders no prompt', async () => {
  const result = await attribute([
    turnWith(1, [
      injectedUserMessage('Current runtime context.', RUNTIME_CONTEXT_SOURCE_KIND),
      injectedUserMessage('The skill catalogue.', SKILL_CATALOG_SOURCE_KIND),
    ]),
  ])
  const candidate = turn(result.jobs[0])
  assert.ok(candidate !== undefined, 'the turn still settles and notifies')
  assert.equal(candidate.userText, undefined)
  assert.ok(!Object.hasOwn(candidate, 'userText'), 'absence is an absent key, not an empty string')
})

test('ATT-07 a goal continuation is never the operator prompt', async () => {
  // A goal round is written as a `user/message` and carries the objective text,
  // which reads like an instruction and must still not be rendered as the
  // operator's own words.
  const result = await attribute([
    turnWith(1, [injectedUserMessage('continue working towards the objective', GOAL_SOURCE_KIND)]),
  ])
  assert.equal(result.userTextOf(0), undefined)
  assert.equal(JSON.stringify(result.jobs[0]).includes('continue working towards the objective'), false)
})

test('ATT-08 two sequential turns keep their own prompts', async () => {
  const result = await attribute([
    turnWith(1, [userMessage('PROMPT_ALPHA first'), injectedUserMessage('context one', RUNTIME_CONTEXT_SOURCE_KIND)]),
    turnWith(2, [userMessage('PROMPT_BETA second'), injectedUserMessage('context two', RUNTIME_CONTEXT_SOURCE_KIND)]),
  ])
  assert.equal(result.jobs.length, 2)
  assert.equal(result.userTextOf(0), 'PROMPT_ALPHA first')
  assert.equal(result.userTextOf(1), 'PROMPT_BETA second')
})

test('ATT-09 a whitespace-only direct message neither claims nor replaces a prompt', async () => {
  const blankThenReal = await attribute([turnWith(1, [userMessage('   '), userMessage('PROMPT after the blank')])])
  assert.equal(blankThenReal.userTextOf(0), 'PROMPT after the blank')

  const realThenBlank = await attribute([turnWith(1, [userMessage('PROMPT before the blank'), userMessage('\n\t ')])])
  assert.equal(realThenBlank.userTextOf(0), 'PROMPT before the blank', 'a blank later message must not erase the prompt')

  const blankOnly = await attribute([turnWith(1, [userMessage('   ')])])
  assert.equal(blankOnly.userTextOf(0), undefined)
  assert.deepEqual(
    blankOnly.rejections().map((entry) => entry.reason),
    ['empty-prompt'],
    'the blank message is refused under its own reason, not folded into the source mismatch',
  )
})

/* ── Failing closed ───────────────────────────────────────────────────── */

test('ATT-10 an absent or malformed source fails closed', async () => {
  const sources: unknown[] = [undefined, null, 'user', 42, [], {}, { kind: null }, { kind: 42 }, { kind: '' }, { kind: {} }]
  for (const source of sources) {
    const result = await attribute([
      turnWith(1, [
        userMessageWithSource(`looks like a prompt (${JSON.stringify(source)})`, source),
        injectedUserMessage('and here is some context', RUNTIME_CONTEXT_SOURCE_KIND),
      ]),
    ])
    assert.equal(result.userTextOf(0), undefined, `source ${JSON.stringify(source)} must not be attributed`)
  }
})

test('ATT-11 a refused message is counted and its kind logged, never its text', async () => {
  const result = await attribute([
    turnWith(1, [injectedUserMessage(INJECTED_TEXT_SENTINEL, RUNTIME_CONTEXT_SOURCE_KIND)]),
  ])
  assert.deepEqual(result.rejections(), [
    { reason: 'non-user-source', sourceKind: RUNTIME_CONTEXT_SOURCE_KIND, textLength: INJECTED_TEXT_SENTINEL.length },
  ])
  // The kind is a producer name and is safe to log; the text is session content
  // and is not (§13).
  assert.ok(result.harness.handle !== undefined)
  assert.equal(result.harness.handle.logger.render().includes(INJECTED_TEXT_SENTINEL), false)
})

test('ATT-12 the raw source object never reaches a job or a log line', async () => {
  const result = await attribute([
    turnWith(1, [
      userMessageWithSource('PROMPT with a decorated source', {
        kind: 'user',
        rpcId: SOURCE_PAYLOAD_SENTINEL,
        clientTimeZone: SOURCE_PAYLOAD_SENTINEL,
      }),
      userMessageWithSource('injected with a decorated source', {
        kind: 'webhook',
        provider: SOURCE_PAYLOAD_SENTINEL,
        deliveryId: SOURCE_PAYLOAD_SENTINEL,
      }),
    ]),
  ])
  assert.equal(result.userTextOf(0), 'PROMPT with a decorated source')
  assert.ok(result.harness.handle !== undefined)
  const rendered = result.harness.handle.logger.render()
  assert.ok(!JSON.stringify(result.jobs).includes(SOURCE_PAYLOAD_SENTINEL), 'no source payload in a job')
  assert.ok(!rendered.includes(SOURCE_PAYLOAD_SENTINEL), 'no source payload in a log line')
  assert.ok(rendered.length > 0, 'the log is not empty, so the negative assertion is meaningful')
})

/* ── Pre-turn buffering, and what may use it ──────────────────────────── */

test('ATT-13 a direct prompt arriving before its turn opens is still attributed to it', async () => {
  const result = await attribute([
    [
      userMessage('PROMPT queued before the turn opened'),
      turnStart(1, 1_000),
      stepStart(1, 1, 1_001),
      assistantMessage({ turn: 1, step: 1, time: 1_010, content: [{ type: 'text', text: 'the answer' }] }),
      turnEnd(1, 1_020),
    ],
  ])
  assert.equal(result.userTextOf(0), 'PROMPT queued before the turn opened')
})

test('ATT-14 injected context arriving while the session is idle is not held for the next turn', async () => {
  // The buffer exists for a prompt the operator typed before the turn opened.
  // Holding injected context there would make the next turn render platform
  // boilerplate as the operator's words.
  const result = await attribute([
    [
      injectedUserMessage(INJECTED_TEXT_SENTINEL, RUNTIME_CONTEXT_SOURCE_KIND),
      turnStart(1, 1_000),
      stepStart(1, 1, 1_001),
      assistantMessage({ turn: 1, step: 1, time: 1_010, content: [{ type: 'text', text: 'the answer' }] }),
      turnEnd(1, 1_020),
    ],
  ])
  assert.equal(result.userTextOf(0), undefined)
  assert.equal(result.rejections()[0]?.reason, 'non-user-source')
  assert.equal(result.rejections()[0]?.sourceKind, RUNTIME_CONTEXT_SOURCE_KIND)
})

test('ATT-15 the switch decides rendering while collection always runs', async () => {
  const withSwitch = await attribute([turnWith(1, [userMessage('PROMPT collected and rendered')])])
  assert.equal(withSwitch.userTextOf(0), 'PROMPT collected and rendered')

  const withoutSwitch = await attribute([turnWith(1, [userMessage('PROMPT collected but not rendered')])], {
    includeUserPrompt: false,
  })
  const candidate = turn(withoutSwitch.jobs[0])
  assert.ok(candidate !== undefined)
  assert.equal(candidate.userText, undefined)
  assert.equal(JSON.stringify(candidate).includes('PROMPT collected but not rendered'), false)
})

test('ATT-16 attribution state is released with the turn, so nothing is inherited', async () => {
  const result = await attribute([
    turnWith(1, [userMessage('PROMPT_ONE')]),
    turnWith(2, [userMessage('PROMPT_TWO')]),
    turnWith(3, []),
  ])
  assert.equal(result.jobs.length, 3)
  assert.equal(result.userTextOf(0), 'PROMPT_ONE')
  assert.equal(result.userTextOf(1), 'PROMPT_TWO')
  assert.equal(result.userTextOf(2), undefined, 'turn 3 has no direct message and must not inherit turn 2')
})
