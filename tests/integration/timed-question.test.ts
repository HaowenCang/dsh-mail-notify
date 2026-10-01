/**
 * L5 contract tests for DSH 0.2's **timed** `ask_user_question` — matrix rows
 * TQ-01…TQ-14.
 *
 * DSH 0.2 offers two question modes under one tool name. The legacy mode blocks:
 * the tool call does not return until a human answers. The opt-in timed mode
 * waits for a foreground answer only until its `timeout`, then returns `pending`
 * and lets the agent continue while the question stays answerable; a human who
 * answers afterwards produces a `user/message` whose `source.kind` is
 * `user-question-reply`.
 *
 * mail-notify observes `tool/call` and nothing else on the question path, so the
 * claim under test is that no timed-specific branch is needed *and* that none of
 * the four steps the mode adds can corrupt an established invariant:
 *
 * - the pending settlement is an ordinary non-error `tool/result`, so it must
 *   add no question notification and must not be read as an explicit tool error;
 * - the late reply is a user-role message, so it must not become the turn's
 *   `includeUserPrompt` content;
 * - the reply must neither consume nor recreate the per-call dedupe key, so a
 *   replayed call still counts as one interaction;
 * - the timed schema's extra `timeout` property must not reach a mail, a job, or
 *   a log line.
 *
 * The whole path is exercised through the real mounted plugin
 * (`tests/support/plugin-harness.ts`): the raw event through the adapter, the
 * allowlist parser, the dedupe identity, the policy gate, the renderer, and the
 * sink. No socket is opened and no credential exists.
 *
 * @module dsh-mail-notify/tests/integration/timed-question
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DedupeCache } from '../../src/notifier.ts'
import type { SessionEventLike, SessionLike } from '../../src/runtime-adapter.ts'
import { renderMail } from '../../src/subject.ts'
import type { MailJob, Notification, QuestionNotification } from '../../src/types.ts'
import {
  assistantMessage,
  questionReplyMessage,
  rootSession,
  stepStart,
  TIMED_QUESTION_TIMEOUT_SENTINEL,
  timedAskUserCall,
  TOOL_ARGUMENT_SECRET_SENTINEL,
  toolResultQuestionAnswered,
  toolResultQuestionPending,
  turnEnd,
  turnStart,
  userMessage,
} from '../fixtures/runtime-shapes.ts'
import { controllableSink, emit, mountPlugin as mount, type PluginHarness } from '../support/plugin-harness.ts'

/** The distinctive digits of the timed `timeout` sentinel, as they would leak. */
const TIMEOUT_DIGITS = String(TIMED_QUESTION_TIMEOUT_SENTINEL)

/** The late answer's text. Distinctive, so a leak is unmistakable. */
const LATE_ANSWER_SENTINEL = 'LATE_ANSWER_SENTINEL-the-human-answered-after-the-timeout'

/** The operator's ordinary prompt text, used as the positive control. */
const ORDINARY_PROMPT_SENTINEL = 'ORDINARY_PROMPT_SENTINEL-the-operator-typed-this'

/**
 * The rendered message of the only job a chain produced.
 *
 * @param harness - the mounted plugin.
 * @param jobs - the jobs the sink received.
 * @returns the rendered subject and body.
 */
function onlyMail(harness: PluginHarness, jobs: readonly MailJob[]): { subject: string; text: string } {
  assert.equal(jobs.length, 1, 'the chain must produce exactly one job')
  const mail = renderMail({ notification: jobs[0]!.notification, render: harness.handle!.config.render, truncated: false })
  return mail
}

/**
 * The question branch of every queued job.
 *
 * Reading the discriminant is what makes a test about questions fail loudly if a
 * turn notification took a question's place.
 *
 * @param jobs - the jobs the sink received.
 * @returns the question notifications, in delivery order.
 */
function questionsOf(jobs: readonly MailJob[]): QuestionNotification[] {
  return jobs
    .map((job): Notification => job.notification)
    .filter((notification): notification is QuestionNotification => notification.kind === 'question')
}

/**
 * The turn branch of every queued job.
 *
 * @param jobs - the jobs the sink received.
 * @returns the turn candidates, in delivery order.
 */
function turnsOf(jobs: readonly MailJob[]): MailJob[] {
  return jobs.filter((job) => job.notification.kind === 'turn')
}

/**
 * Render one job under the mounted plugin's own render switches.
 *
 * @param harness - the mounted plugin.
 * @param job - the queued job.
 * @returns the rendered subject and body.
 */
function mailOf(harness: PluginHarness, job: MailJob): { subject: string; text: string } {
  return renderMail({ notification: job.notification, render: harness.handle!.config.render, truncated: job.truncated })
}

/* ── TQ-01…TQ-04: the two modes, and what each settlement means ─────────── */

test('TQ-01 the legacy blocking call still produces exactly one question mail', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    timedAskUserCall(1, 1, 1_200, [{ id: 'legacy', question: 'May the deployment proceed?' }], 120, 'call-legacy-1'),
    stepStart(1, 2, 1_300),
    assistantMessage({ turn: 1, step: 2, time: 1_400, content: [{ type: 'text', text: 'the answer after the question' }] }),
    turnEnd(1, 1_500, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  // The call and the turn are two independent lifecycles: answering the question
  // must not consume the turn's own eligibility, and the turn's settlement must
  // not be mistaken for a second question notification.
  assert.equal(sink.jobs.length, 2, 'one question mail and one turn mail')
  assert.equal(questionsOf(sink.jobs).length, 1)
  assert.equal(turnsOf(sink.jobs).length, 1)
  assert.equal(questionsOf(sink.jobs)[0]?.callId, 'call-legacy-1', 'the durable call id anchors the identity')
})

test('TQ-02 a timed call answered before the timeout produces one mail and no duplicate', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    timedAskUserCall(1, 1, 1_200, [{ id: 'in-window', question: 'Which region should host the primary?' }], 300, 'call-window-1'),
    // The human answers inside the window, so the call settles with an answer
    // batch rather than `pending`. `tool/result` is not a question trigger at
    // all, so this event can add no mail whatever it carries.
    toolResultQuestionAnswered(1, 1, 1_250, [{ id: 'in-window', selected: ['eu-west'] }], 'call-window-1'),
    stepStart(1, 2, 1_300),
    assistantMessage({ turn: 1, step: 2, time: 1_400, content: [{ type: 'text', text: 'provisioning eu-west' }] }),
    turnEnd(1, 1_500, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 2, 'one question mail and one turn mail, never two question mails')
  assert.equal(questionsOf(sink.jobs).length, 1)
  assert.equal(turnsOf(sink.jobs).length, 1, 'the terminal notification stays independently eligible')
  const answer = questionsOf(sink.jobs)[0]
  assert.equal(answer?.questions[0]?.question, 'Which region should host the primary?')
})

test('TQ-03 a timed call whose foreground wait expires sends one mail and no second one on pending', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    timedAskUserCall(1, 1, 1_200, [{ id: 'expires', question: 'Should the cache be warmed at boot?' }], 5, 'call-timeout-1'),
    // The foreground window closed with no answer batch: DSH records `pending`,
    // and the agent continues. The question remains answerable.
    toolResultQuestionPending(1, 1, 6_500, 'call-timeout-1'),
    stepStart(1, 2, 6_600),
    assistantMessage({ turn: 1, step: 2, time: 6_700, content: [{ type: 'text', text: 'continuing with the default' }] }),
    turnEnd(1, 6_800, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  assert.equal(questionsOf(sink.jobs).length, 1, 'exactly one question mail, however the wait ended')
  assert.equal(sink.jobs.length, 2, 'and the turn still notifies on its own')
})

test('TQ-04 the pending settlement is not read as an explicit tool error', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    timedAskUserCall(1, 1, 1_200, [{ id: 'pending', question: 'Which database should be migrated first?' }], 3, 'call-pending-1'),
    toolResultQuestionPending(1, 1, 4_500, 'call-pending-1'),
    stepStart(1, 2, 4_600),
    assistantMessage({ turn: 1, step: 2, time: 4_700, content: [{ type: 'text', text: 'migrating the smaller one first' }] }),
    turnEnd(1, 4_800, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  // A timeout is a delivery fact, not an incident: the tool call returned a
  // well-formed value, so the turn completed cleanly. Reading `pending` as an
  // error would turn every expired question into a "task failed" mail.
  const turnJob = turnsOf(sink.jobs)[0]
  assert.equal(turnJob?.notification.kind, 'turn')
  assert.ok(turnJob !== undefined && turnJob.notification.kind === 'turn')
  assert.equal(turnJob.notification.candidate.status, 'completed-clean')
  assert.equal(turnJob.notification.candidate.explicitToolErrorCount, 0)
})

/* ── TQ-05…TQ-08: the late answer ──────────────────────────────────────── */

test('TQ-05 a late reply never becomes includeUserPrompt content', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true, includeUserPrompt: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    timedAskUserCall(1, 1, 1_200, [{ id: 'late', question: 'Should the retry budget grow?' }], 4, 'call-late-1'),
    toolResultQuestionPending(1, 1, 5_200, 'call-late-1'),
    // The agent already continued; the human answers afterwards. DSH steers the
    // answer in as a user-role message whose source kind is `user-question-reply`.
    questionReplyMessage(LATE_ANSWER_SENTINEL, 'call-late-1'),
    stepStart(1, 2, 5_300),
    assistantMessage({ turn: 1, step: 2, time: 5_400, content: [{ type: 'text', text: 'applying the late answer' }] }),
    turnEnd(1, 5_500, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  const turnJob = turnsOf(sink.jobs)[0]
  assert.ok(turnJob !== undefined && turnJob.notification.kind === 'turn')
  assert.equal(
    turnJob.notification.candidate.userText,
    undefined,
    'only source.kind === "user" may populate the ordinary user-prompt field',
  )
  const rendered = mailOf(harness, turnJob)
  assert.equal(rendered.text.includes(LATE_ANSWER_SENTINEL), false, 'the late reply must not appear under --- User prompt ---')

  // The refusal is counted rather than silent: a change in what DSH steers in
  // must show up in the log instead of re-attributing prompts quietly.
  const rejections = handle.logger
    .getRecords()
    .filter((record) => record.event === 'prompt.attribution-rejected')
  assert.equal(rejections.length, 1, 'the late reply is reported as a non-prompt user message')
  assert.equal(rejections[0]?.fields['reason'], 'non-user-source')
  assert.equal(rejections[0]?.fields['sourceKind'], 'user-question-reply')
  assert.equal(handle.logger.render().includes(LATE_ANSWER_SENTINEL), false, 'and its text is never logged')
})

test('TQ-06 an ordinary prompt in the same turn is still attributed, as the positive control', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true, includeUserPrompt: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    userMessage(ORDINARY_PROMPT_SENTINEL),
    stepStart(1, 1, 1_100),
    assistantMessage({ turn: 1, step: 1, time: 1_200, content: [{ type: 'text', text: 'working on it' }] }),
    turnEnd(1, 1_300, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  assert.ok(mail.text.includes(ORDINARY_PROMPT_SENTINEL), 'a direct human message is still the prompt')
  assert.ok(mail.text.includes('--- User prompt ---'))
})

test('TQ-07 a late reply neither consumes nor recreates a question-notification key', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  const session: SessionLike = rootSession()
  const sessionId = String(session.id)
  const questionKey = DedupeCache.questionKeyFor(sessionId, 'call-key-1', 1, 1)
  const call = timedAskUserCall(1, 1, 1_200, [{ id: 'key', question: 'Is the staging cluster reachable?' }], 7, 'call-key-1')

  emit(harness.ctx, session, [call])
  await handle.queue.settle()
  assert.equal(sink.jobs.length, 1, 'the call produces one mail')
  assert.equal(handle.dedupe.has(questionKey), true, 'and exactly the per-call key is marked')
  const keysAfterQuestion = handle.dedupe.size

  // The late reply is a different lifecycle entirely. It must not touch the
  // question namespace: consuming the mark would let a replay notify twice, and
  // creating one would make the reply itself look like a question.
  emit(harness.ctx, session, [questionReplyMessage(LATE_ANSWER_SENTINEL, 'call-key-1')])
  await handle.queue.settle()
  assert.equal(handle.dedupe.size, keysAfterQuestion, 'the reply adds no key of its own')
  assert.equal(handle.dedupe.has(questionKey), true, 'and does not clear the question key')
  assert.equal(sink.jobs.length, 1, 'and produces no mail')

  // A replayed append of the same call is still one interaction.
  emit(harness.ctx, session, [call])
  await handle.queue.settle()
  assert.equal(sink.jobs.length, 1, 'the replay is suppressed as a duplicate')
})

test('TQ-08 two distinct timed calls in one turn produce one mail each', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    timedAskUserCall(1, 1, 1_200, [{ id: 'a', question: 'May the first migration run?' }], 5, 'call-a'),
    toolResultQuestionPending(1, 1, 6_200, 'call-a'),
    stepStart(1, 2, 6_300),
    timedAskUserCall(1, 2, 6_400, [{ id: 'b', question: 'May the second migration run?' }], 5, 'call-b'),
    toolResultQuestionPending(1, 2, 11_400, 'call-b'),
    stepStart(1, 3, 11_500),
    assistantMessage({ turn: 1, step: 3, time: 11_600, content: [{ type: 'text', text: 'both queued' }] }),
    turnEnd(1, 11_700, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  const asked = questionsOf(sink.jobs)
  assert.equal(asked.length, 2, 'each durable call id is its own interaction')
  assert.deepEqual(
    asked.map((notification) => notification.callId),
    ['call-a', 'call-b'],
  )
  assert.equal(handle.dedupe.has(DedupeCache.questionKeyFor(String(rootSession().id), 'call-a', 1, 1)), true)
  assert.equal(handle.dedupe.has(DedupeCache.questionKeyFor(String(rootSession().id), 'call-b', 1, 2)), true)
})

/* ── TQ-09…TQ-12: privacy of the timed-only field ──────────────────────── */

test('TQ-09 the timed timeout parameter never reaches a mail, a job, or a log', async () => {
  const sink = controllableSink()
  // A large buffer is the point: the assertion is about what the log may not
  // contain, and an empty buffer would make it vacuous.
  const harness = await mount(
    { notifyQuestions: true, notifyCompleted: true },
    { sink: sink.sink, logBufferSize: 4_000 },
  )
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    timedAskUserCall(1, 1, 1_200, [{ id: 'privacy', question: 'Should the migration window stay open?' }], TIMED_QUESTION_TIMEOUT_SENTINEL, 'call-privacy-1'),
    toolResultQuestionPending(1, 1, 1_300, 'call-privacy-1'),
    stepStart(1, 2, 1_400),
    assistantMessage({ turn: 1, step: 2, time: 1_500, content: [{ type: 'text', text: 'the turn continues' }] }),
    turnEnd(1, 1_600, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 2, 'the chain notified, so the negative scans below are meaningful')
  const rendered = handle.logger.render()
  assert.ok(rendered.length > 200, 'the log buffer is not empty')

  for (const job of sink.jobs) {
    const mail = mailOf(harness, job)
    assert.equal(mail.subject.includes(TIMEOUT_DIGITS), false, 'no subject may carry the timed wait')
    assert.equal(mail.text.includes(TIMEOUT_DIGITS), false, 'no body may carry the timed wait')
    assert.equal(JSON.stringify(job).includes(TIMEOUT_DIGITS), false, 'no queued job may carry the timed wait')
  }
  assert.equal(rendered.includes(TIMEOUT_DIGITS), false, 'no log line may carry the timed wait')
})

test('TQ-10 unknown fields on a question item are dropped, not carried', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    // A hostile model can put anything in its own argument string. The allowlist
    // names the fields it copies, so every unnamed key here must be dropped — at
    // the container level, where DSH's timed schema puts `timeout`, and inside a
    // question item, where nothing legal has that shape.
    timedAskUserCall(
      1,
      1,
      1_200,
      [
        {
          id: 'hostile',
          question: 'Should the job run now?',
          timeout: TIMED_QUESTION_TIMEOUT_SENTINEL,
          deadline: TIMEOUT_DIGITS,
          secret: TOOL_ARGUMENT_SECRET_SENTINEL,
          context: { file: TOOL_ARGUMENT_SECRET_SENTINEL },
        },
      ],
      TIMED_QUESTION_TIMEOUT_SENTINEL,
      'call-hostile-1',
    ),
  ])
  await handle.queue.settle()

  const question = questionsOf(sink.jobs)[0]
  assert.ok(question !== undefined)
  assert.equal(question.questions.length, 1)
  assert.deepEqual(
    Object.keys(question.questions[0] ?? {}).sort(),
    ['id', 'question'],
    'only the allowlisted fields survive',
  )
  const mail = onlyMail(harness, sink.jobs)
  assert.equal(mail.text.includes(TIMEOUT_DIGITS), false, 'the container-level timeout is dropped')
  assert.equal(mail.text.includes(TOOL_ARGUMENT_SECRET_SENTINEL), false, 'and so is every unnamed field')
  assert.equal(JSON.stringify(sink.jobs).includes(TOOL_ARGUMENT_SECRET_SENTINEL), false)
  assert.equal(handle.logger.render().includes(TOOL_ARGUMENT_SECRET_SENTINEL), false)
})

test('TQ-11 the allowlisted question fields are still carried in full', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    timedAskUserCall(
      1,
      1,
      1_200,
      [
        {
          id: 'full',
          header: 'Confirm scope',
          question: 'Which services are in scope for the migration?',
          multi_select: true,
          options: [
            { label: 'API only', description: 'Lowest risk.' },
            { label: 'API and workers', description: 'One coordinated cutover.' },
          ],
          timeout: TIMED_QUESTION_TIMEOUT_SENTINEL,
        },
      ],
      TIMED_QUESTION_TIMEOUT_SENTINEL,
      'call-full-1',
    ),
  ])
  await handle.queue.settle()

  const question = questionsOf(sink.jobs)[0]?.questions[0]
  assert.ok(question !== undefined)
  assert.deepEqual(Object.keys(question).sort(), ['header', 'id', 'multiSelect', 'options', 'question'])
  assert.equal(question.header, 'Confirm scope')
  assert.equal(question.multiSelect, true)
  assert.equal(question.options?.length, 2)
  const mail = onlyMail(harness, sink.jobs)
  assert.equal(mail.subject, '[DSH] Input required — Confirm scope')
  assert.ok(mail.text.includes('Select one or more.'), 'the multi-select intent is rendered')
  assert.ok(mail.text.includes('One coordinated cutover.'))
})

/* ── TQ-12…TQ-14: the wording the two modes share ──────────────────────── */

test('TQ-12 the question subject prefix is phase-neutral', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    timedAskUserCall(1, 1, 1_200, [{ id: 'wording', question: 'Should the queue be drained first?' }], 5, 'call-wording-1'),
    toolResultQuestionPending(1, 1, 6_200, 'call-wording-1'),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  assert.equal(mail.subject, '[DSH] Input required', 'the constant prefix alone; no phase-dependent suffix')
})

test('TQ-13 the attention status line does not claim the agent is still blocked', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    timedAskUserCall(1, 1, 1_200, [{ id: 'status', question: 'Should the batch be retried?' }], 5, 'call-status-1'),
    toolResultQuestionPending(1, 1, 6_200, 'call-status-1'),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  // The mail is rendered after the foreground wait has already expired, so any
  // wording asserting that DSH is *still* waiting would be false here. The line
  // states the request instead, which stays true in every phase.
  assert.ok(mail.text.includes('Status:    Human input requested'))
  assert.equal(mail.text.includes('Waiting for a human'), false, 'the superseded blocking claim is gone')
  assert.equal(mail.text.includes('blocked'), false, 'and no other line claims the agent is blocked')
})

test('TQ-14 a timed question keeps its narrow exception narrow for other tools', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink, logBufferSize: 2_000 })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  const call = timedAskUserCall(1, 1, 1_200, [{ id: 'ok', question: 'Proceed?' }], 5, 'call-narrow-1')
  const other: SessionEventLike[] = [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    call,
  ]
  emit(harness.ctx, rootSession(), other)
  await handle.queue.settle()

  assert.equal(questionsOf(sink.jobs).length, 1)
  // The timed parameter is a property of the *schema*, not a licence to read
  // more of the argument object: the parser still copies two fields plus the
  // allowlisted extras and nothing else.
  const notification = questionsOf(sink.jobs)[0]
  assert.deepEqual(Object.keys(notification?.questions[0] ?? {}).sort(), ['id', 'question'])
  assert.equal(handle.logger.render().includes('918273645'), false)
})
