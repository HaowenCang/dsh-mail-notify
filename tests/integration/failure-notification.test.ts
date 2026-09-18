/**
 * L5 end-to-end contract tests for terminal-failure notification — matrix rows
 * FNL-01…FNL-11.
 *
 * The unit halves live in `completion.test.ts` (fact extraction) and
 * `notifier.test.ts` (the `notifyErrors` policy gate). What these tests add is
 * the whole path a failing turn really takes: raw DSH `session/event` payloads
 * through the adapter, the turn map, the candidate, the policy, the renderer,
 * and the sink. That path is the only place the two properties this phase
 * depends on are jointly observable — that a failure which committed no visible
 * message still reaches the operator, and that a failure DSH already recovered
 * from never does. The unit suite can prove either half in isolation and still
 * let the pair be wired together wrongly.
 *
 * The mounted-plugin harness lives in `tests/support/plugin-harness.ts`, so
 * this suite drives the real registration and disposal path rather than a
 * re-implementation of it. No socket is opened and no credential exists.
 *
 * @module dsh-mail-notify/tests/integration/failure-notification
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderMail } from '../../src/subject.ts'
import type { SessionEventLike } from '../../src/runtime-adapter.ts'
import type { MailJob, NotificationCandidate } from '../../src/types.ts'
import {
  assistantAttempt,
  assistantMessage,
  llmRetry,
  REASONING_SECRET_SENTINEL,
  reasoningOnlyMessage,
  rootSession,
  stepStart,
  TOOL_ARGUMENT_SECRET_SENTINEL,
  TOOL_RESULT_SECRET_SENTINEL,
  toolCall,
  toolResultOk,
  turnEnd,
  turnStart,
} from '../fixtures/runtime-shapes.ts'
import { turn } from '../support/harness.ts'
import { controllableSink, emit, mountPlugin as mount, type PluginHarness } from '../support/plugin-harness.ts'

/* ── Rendering and emission helpers ───────────────────────────────────── */

/**
 * The rendered subject and body of one queued job.
 *
 * The render switches are read off the live handle rather than hand-written, so
 * a test renders what the configured plugin would, not what a test author
 * assumed the defaults were.
 *
 * @param job - the queued job, or `undefined` when the queue produced none.
 * @param harness - the mounted plugin the job came from.
 * @returns the subject and body, or `undefined` when there is no job.
 */
function mailFor(
  job: MailJob | undefined,
  harness: PluginHarness,
): { subject: string; text: string; bodyTextLength: number } | undefined {
  const handle = harness.handle
  assert.ok(handle !== undefined)
  if (job === undefined) return undefined
  return renderMail({ notification: job.notification, render: handle.config.render, truncated: job.truncated })
}

/**
 * The rendered subject and body of the only job a chain produced.
 *
 * @param harness - the mounted plugin.
 * @param jobs - every job the sink received.
 * @returns the rendered message parts.
 */
function onlyMail(harness: PluginHarness, jobs: readonly MailJob[]): { subject: string; text: string } {
  assert.equal(jobs.length, 1, 'the chain must produce exactly one job')
  const mail = mailFor(jobs[0], harness)
  assert.ok(mail !== undefined)
  return mail
}

/**
 * The candidate of the only job a chain produced.
 *
 * @param jobs - every job the sink received.
 * @returns the settled turn's candidate.
 */
function onlyCandidate(jobs: readonly MailJob[]): NotificationCandidate {
  assert.equal(jobs.length, 1, 'the chain must produce exactly one job')
  const candidate = turn(jobs[0])
  assert.ok(candidate !== undefined)
  return candidate
}

/**
 * A terminal `turn/end` whose reason is the runtime's provider-error branch.
 *
 * Built inline rather than through a fixture so the test states the exact DSH
 * shape under test: `data.reason = { kind: 'error', error: { … } }`.
 *
 * @param turnNumber - the turn number.
 * @param time - the event time.
 * @param error - the `LlmFailure` payload fields.
 * @returns the `turn/end` event.
 */
function failureTurnEnd(turnNumber: number, time: number, error: Record<string, unknown>): ReturnType<typeof turnEnd> {
  return turnEnd(turnNumber, time, { kind: 'error', error })
}

/**
 * The chain a failing turn really produces: an announced step, a model call
 * that committed no surface message, then the terminal error.
 *
 * `assistant/attempt` is how DSH records a call that produced nothing visible;
 * observed attempts carry no usage in their stream, which is why the mail for
 * this chain reports incomplete token telemetry rather than claiming coverage.
 *
 * @param error - the `LlmFailure` payload fields.
 * @returns the event sequence, in delivery order.
 */
function silentFailureChain(error: Record<string, unknown>): SessionEventLike[] {
  return [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    assistantAttempt({ turn: 1, step: 1, time: 1_200 }),
    failureTurnEnd(1, 1_300, error),
  ]
}

/* ── FNL-01…FNL-03: delivery and classification ────────────────────────── */

test('FNL-01 a terminal failure that produced no visible output is mailed when enabled', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyErrors: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  // The `notifyErrors: true` mount is the whole point of this row: the default
  // is off, and a failure whose model committed no message is precisely the one
  // whose absence would be silent.
  emit(harness.ctx, rootSession(), silentFailureChain({ message: 'the provider refused the request', code: 'QUOTA', status: 429 }))
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'the failure is the entire message, so empty visible text cannot suppress it')
  const mail = onlyMail(harness, sink.jobs)
  assert.ok(mail.text.includes('Task failed'), 'the mail names the failure rather than the turn')
  assert.ok(mail.text.includes('QUOTA'), 'the structured code reaches the reader')
  assert.ok(mail.text.includes('429'), 'the provider status reaches the reader')
  assert.ok(
    mail.text.includes('No model output was produced before this failure'),
    'an absent body must be stated as an observation, never left as an empty section',
  )
})

test('FNL-02 the default notifyErrors:false sends nothing and logs why', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), silentFailureChain({ message: 'the provider refused the request', code: 'QUOTA', status: 429 }))
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 0, 'the default configuration declares no interest in failures')
  const suppressions = handle.logger
    .getRecords()
    .filter((record) => record.event === 'notification.suppressed' && record.fields['suppressedReason'] === 'disabled-by-policy')
  assert.equal(suppressions.length, 1, 'a suppressed failure is reported structurally, not swallowed')
  assert.equal(suppressions[0]?.fields['status'], 'error')
})

test('FNL-03 every retryable code and an outside-vocabulary code classify by their own value', async () => {
  const codes = ['RATE_LIMIT', 'QUOTA', 'TIMEOUT', 'TRANSPORT', 'SERVER', 'UNKNOWN', 'AUTH']
  const sink = controllableSink()
  const harness = await mount({ notifyErrors: true, queueSize: 100 }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  // One session per code, so neither the turn dedupe key nor the per-turn state
  // can make a later code's absence look like a policy decision.
  codes.forEach((code, index) => {
    emit(
      harness.ctx,
      rootSession(`session-code-${index}`),
      silentFailureChain({ message: `failure reported as ${code}`, code }),
    )
  })
  await handle.queue.settle()

  assert.equal(sink.jobs.length, codes.length, 'every code produces exactly one job')
  const subjects = sink.jobs.map((job) => mailFor(job, harness)?.subject)
  for (const [index, code] of codes.entries()) {
    assert.equal(subjects[index], `[DSH] Task failed — ${code}`, `${code} must name itself in the subject`)
    const candidate = turn(sink.jobs[index])
    assert.equal(candidate?.failure?.code, code)
    assert.ok(mailFor(sink.jobs[index], harness)?.text.includes(`Failure code: ${code}`), `${code} must be named in the body`)
  }
})

/* ── FNL-04…FNL-06: how the failure is reported ─────────────────────────── */

test('FNL-04 classification reads the structured code and never the message text', async () => {
  // The messages below are deliberately misleading: each one names the code the
  // *other* failure carries. Matching text against "429", "quota", or "timeout"
  // is forbidden (§5); `HarnessError.code`'s own contract requires routing on
  // the code, because a provider message is prose and may say anything at all,
  // including a superseded limit, a quoted user string, or a different request.
  const cases = [
    { code: 'QUOTA', message: '429 rate limit exceeded for this key' },
    { code: 'RATE_LIMIT', message: 'quota exceeded for the month' },
  ]

  for (const [index, entry] of cases.entries()) {
    const sink = controllableSink()
    const harness = await mount({ notifyErrors: true }, { sink: sink.sink })
    const handle = harness.handle
    assert.ok(handle !== undefined)
    emit(
      harness.ctx,
      rootSession(`session-misleading-${index}`),
      silentFailureChain({ message: entry.message, code: entry.code }),
    )
    await handle.queue.settle()

    const mail = onlyMail(harness, sink.jobs)
    assert.equal(mail.subject, `[DSH] Task failed — ${entry.code}`, 'the subject states the runtime code, not the prose')
    assert.ok(mail.text.includes(`Failure code: ${entry.code}`))
    assert.equal(
      mail.subject.includes('429') || mail.text.includes('Failure code: 429'),
      false,
      'an HTTP status is reported only when the runtime reported one',
    )
    for (const forbidden of cases.filter((other) => other.code !== entry.code)) {
      assert.equal(
        mail.text.includes(`Failure code: ${forbidden.code}`),
        false,
        `the mail must not claim ${forbidden.code}, which only the message text suggested`,
      )
    }
  }
})

test('FNL-05 status and Retry-After appear only when the provider reported them', async () => {
  const reported = controllableSink()
  const first = await mount({ notifyErrors: true }, { sink: reported.sink })
  assert.ok(first.handle !== undefined)
  emit(
    first.ctx,
    rootSession('session-status-KNOWN'),
    silentFailureChain({ message: 'the upstream is unavailable', code: 'SERVER', status: 503, providerRetryAfterMs: 2_500 }),
  )
  await first.handle.queue.settle()

  const withStatus = onlyMail(first, reported.jobs)
  assert.equal(withStatus.subject, '[DSH] Task failed — SERVER (503)', 'the status is a routing fact worth the subject')
  assert.ok(withStatus.text.includes('HTTP status: 503'))
  assert.ok(withStatus.text.includes('Retry-After: 2500 ms'), 'the provider delay is reported with its unit')

  const absent = controllableSink()
  const second = await mount({ notifyErrors: true }, { sink: absent.sink })
  assert.ok(second.handle !== undefined)
  emit(second.ctx, rootSession('session-status-ABSENT'), silentFailureChain({ message: 'the connection was reset', code: 'TRANSPORT' }))
  await second.handle.queue.settle()

  const withoutStatus = onlyMail(second, absent.jobs)
  assert.equal(withoutStatus.subject, '[DSH] Task failed — TRANSPORT', 'no status means no status tag')
  // An unreported value and a zero value are different facts; printing a
  // default would state one the runtime never reported.
  assert.ok(withoutStatus.text.includes('HTTP status: not reported'))
  assert.ok(withoutStatus.text.includes('Retry-After: not reported'))
})

test('FNL-06 output produced before the failure is labelled as partial', async () => {
  const text = 'the analysis reached the third repository before the provider failed'
  const sink = controllableSink()
  const harness = await mount({ notifyErrors: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    assistantMessage({ turn: 1, step: 1, time: 1_200, content: [{ type: 'text', text }] }),
    turnEnd(1, 1_300, { kind: 'error', error: { message: 'the provider dropped the stream', code: 'TRANSPORT' } }),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  const heading = '--- Partial model output before failure ---'
  assert.ok(mail.text.includes(heading), 'partial output must carry its own heading')
  assert.ok(mail.text.includes(text), 'the partial text is what the operator needs to judge the failure')
  assert.ok(mail.text.indexOf(text) > mail.text.indexOf(heading), 'the text appears under the heading, not before it')
  assert.equal(
    mail.text.includes(`\n\n${text}`),
    false,
    'an unlabelled paragraph would read as the model’s final answer rather than as a fragment',
  )
})

/* ── FNL-07…FNL-09: retries, single delivery, telemetry ─────────────────── */

test('FNL-07 a recovered retry sends no failure mail at all', async () => {
  // The single most important negative test in this file. `llm/retry` is the
  // session event DSH writes when *one model call* failed and a later attempt
  // succeeded; it is not a terminal turn failure. A plugin that treated it as
  // one would mail on every transient provider hiccup — the exact noise the
  // operator would then learn to ignore. The turn's own ended-completed
  // settlement is the only thing that may notify here.
  const sink = controllableSink()
  const harness = await mount({ notifyErrors: true, notifyCompleted: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    llmRetry(1, 1, 1_200),
    assistantMessage({ turn: 1, step: 1, time: 1_700, content: [{ type: 'text', text: 'the answer, after a retry' }] }),
    turnEnd(1, 1_800, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'exactly one mail, and it is the completion')
  const candidate = onlyCandidate(sink.jobs)
  assert.equal(candidate.status, 'completed-clean', 'a recovered retry leaves the turn completed')
  assert.equal(candidate.failure, undefined, 'no failure facts exist for a turn that ended completed')
  const mail = onlyMail(harness, sink.jobs)
  assert.ok(mail.text.includes('Task completed'))
  assert.equal(mail.text.includes('Task failed'), false, 'zero failure mails: the subject never names a failure')
  assert.equal(mail.text.includes('--- Failure ---'), false)
})

test('FNL-08 several retries and then a terminal error produce exactly one failure mail', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyErrors: true, notifyCompleted: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    llmRetry(1, 1, 1_200),
    stepStart(1, 2, 2_000),
    llmRetry(1, 2, 2_100),
    stepStart(1, 3, 3_000),
    llmRetry(1, 3, 3_100),
    failureTurnEnd(1, 3_200, { message: 'every attempt was refused', code: 'TRANSPORT' }),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'a retry is not a settlement; only the turn/end enqueues')
  assert.equal(onlyCandidate(sink.jobs).status, 'error')
  const enqueued = handle.logger.getRecords().filter((record) => record.event === 'notification.enqueued')
  assert.equal(enqueued.length, 1, 'one enqueue decision for the whole turn')
})

test('FNL-09 the failure mail carries the usage observed before the failure', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyErrors: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    assistantMessage({
      turn: 1,
      step: 1,
      time: 1_200,
      content: [{ type: 'text', text: 'a first step that did report usage' }],
      usage: { inputTokens: 100, outputTokens: 10 },
    }),
    stepStart(1, 2, 1_300),
    assistantAttempt({ turn: 1, step: 2, time: 1_400 }),
    failureTurnEnd(1, 1_500, { message: 'the provider refused the second call', code: 'QUOTA' }),
  ])
  await handle.queue.settle()

  const candidate = onlyCandidate(sink.jobs)
  assert.deepEqual(candidate.usage, { inputTokens: 100, outputTokens: 10 }, 'the call that did report is still folded')
  assert.equal(candidate.usageSampleCount, 1)
  const mail = onlyMail(harness, sink.jobs)
  assert.ok(mail.text.includes('Token usage (turn aggregate):'))
  assert.ok(mail.text.includes('inputTokens=100'), 'what was observed is stated as a value')
  assert.ok(mail.text.includes('cacheReadTokens=not reported'), 'a bucket no call reported is stated as unreported')

  // The same mail for a failure whose only call reported nothing: the plugin
  // must say the telemetry is incomplete rather than present an empty aggregate
  // as coverage.
  const silent = controllableSink()
  const second = await mount({ notifyErrors: true }, { sink: silent.sink })
  assert.ok(second.handle !== undefined)
  emit(second.ctx, rootSession('session-silent-usage'), silentFailureChain({ message: 'refused immediately', code: 'QUOTA' }))
  await second.handle.queue.settle()

  const silentMail = onlyMail(second, silent.jobs)
  const completeness = silentMail.text.split('\n').find((line) => line.startsWith('Token telemetry complete:'))
  assert.ok(completeness !== undefined, 'the mail states completeness for a failure too')
  assert.ok(completeness.startsWith('Token telemetry complete: no'), 'no observed call reported usage, so it cannot claim yes')
  assert.equal(completeness.includes('yes'), false)
  assert.ok(silentMail.text.includes('Token usage (turn aggregate): none observed'))
})

/* ── FNL-10…FNL-11: what a failure mail may never carry ─────────────────── */

test('FNL-10 a failure mail carries no request identity, no stack, and no fixture sentinel', async () => {
  const requestId = 'req-8f2c41d0-cb19-4f6e-9a3d-2f0b7c55e111'
  const sink = controllableSink()
  // A large buffer, so the absence assertions below are made against a log that
  // really was filled rather than against an empty one.
  const harness = await mount({ notifyErrors: true }, { sink: sink.sink, logBufferSize: 2_000 })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    reasoningOnlyMessage(1, 1, 1_200),
    toolCall(1, 1, 1_300, 'pwsh', `{"command":"${TOOL_ARGUMENT_SECRET_SENTINEL}"}`),
    toolResultOk(1, 1, 1_400, TOOL_RESULT_SECRET_SENTINEL),
    failureTurnEnd(1, 1_500, {
      message: 'the request failed after the tool call',
      code: 'SERVER',
      status: 500,
      requestId,
    }),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  assert.ok(mail.text.includes('the request failed after the tool call'), 'the provider message itself is carried')
  // §8 excludes the provider-issued request identifier: it is a diagnostic
  // artefact for the provider's own support channel, not something the reader
  // of a notification mail can act on, and it names a session's request.
  assert.equal(mail.text.includes(requestId), false, 'the requestId value must not reach the body')
  assert.equal(mail.subject.includes(requestId), false)
  // A stack trace is process internals and can name filesystem paths; the
  // renderer has no field for one, so this asserts the property rather than a
  // formatting choice.
  assert.equal(mail.text.includes('    at '), false, 'no stack-trace line may appear in the body')
  for (const sentinel of [REASONING_SECRET_SENTINEL, TOOL_ARGUMENT_SECRET_SENTINEL, TOOL_RESULT_SECRET_SENTINEL]) {
    assert.equal(mail.text.includes(sentinel), false, `${sentinel} must not reach the failure body`)
    assert.equal(mail.subject.includes(sentinel), false, `${sentinel} must not reach the subject`)
  }
  const rendered = handle.logger.render()
  assert.ok(rendered.length > 500, 'the log buffer is not empty, so the negative assertions above are meaningful')
  for (const sentinel of [REASONING_SECRET_SENTINEL, TOOL_ARGUMENT_SECRET_SENTINEL, TOOL_RESULT_SECRET_SENTINEL, requestId]) {
    assert.equal(rendered.includes(sentinel), false, `${sentinel} must not reach a log line`)
  }
})

test('FNL-11 an aborted turn is not a failure mail, even with every switch on', async () => {
  const sink = controllableSink()
  const harness = await mount(
    { notifyCompleted: true, notifyErrors: true, notifyMaxTokens: true, notifyQuestions: true, notifyApprovals: true },
    { sink: sink.sink },
  )
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    assistantAttempt({ turn: 1, step: 1, time: 1_200 }),
    turnEnd(1, 1_300, { kind: 'aborted', reason: { kind: 'user' } }),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 0, 'a cancellation is not an incident: no switch exists that could enable it')
  const suppressions = handle.logger
    .getRecords()
    .filter((record) => record.event === 'notification.suppressed' && record.fields['suppressedReason'] === 'disabled-by-policy')
  assert.equal(suppressions.length, 1, 'the decision is reported, not silent')
})
