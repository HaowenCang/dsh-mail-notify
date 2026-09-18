/**
 * L5 end-to-end contract tests for mid-turn human-attention notification —
 * matrix rows QUE-01…QUE-12 and APR-01…APR-08.
 *
 * The unit halves live in `subject.test.ts` (rendering) and the parser's own
 * suite; what these tests add is the whole path a real interaction takes: the
 * raw `tool/call` or `approval/asked` payload through the adapter, the
 * allowlist parser, the per-interaction dedupe identity, the policy gate, the
 * renderer, and the sink. Two properties are only observable on that path.
 * First, the mail must be queued *synchronously* at the moment the call is
 * observed — DSH is blocked on the human right then, and a mail that waited for
 * `turn/end` would arrive after the answer it was asking about. Second, the
 * narrow `ask_user_question` exception must not widen: no other tool's
 * arguments, and no approval's arguments, may reach a body, a subject, or a log
 * line, because DSH's own contract never published them and the plugin must not
 * put them back.
 *
 * The mounted-plugin harness lives in `tests/support/plugin-harness.ts`, so
 * this suite drives the real registration path rather than a re-implementation
 * of it. No socket is opened and no credential exists.
 *
 * @module dsh-mail-notify/tests/integration/attention-notification
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DedupeCache } from '../../src/notifier.ts'
import type { SessionEventLike, SessionLike } from '../../src/runtime-adapter.ts'
import { renderMail } from '../../src/subject.ts'
import type { ApprovalNotification, MailJob, Notification, QuestionNotification } from '../../src/types.ts'
import {
  assistantMessage,
  rootSession,
  stepStart,
  subagentSession,
  TOOL_ARGUMENT_SECRET_SENTINEL,
  toolCall,
  turnEnd,
  turnStart,
} from '../fixtures/runtime-shapes.ts'
import { controllableSink, emit, mountPlugin as mount, type PluginHarness } from '../support/plugin-harness.ts'

/* ── Fixture builders ─────────────────────────────────────────────────── */

/**
 * One `ask_user_question` call, as DSH records it.
 *
 * The existing `toolCall` fixture already takes the name and the raw argument
 * string as its last two parameters, so the call is built through it rather
 * than as an event literal; the fixture's own `call-<turn>-<step>` call id is
 * what the per-call dedupe identity is then tested against.
 *
 * @param turn - the turn number.
 * @param step - the step number.
 * @param time - the event time.
 * @param questions - the raw `questions` array the model emitted.
 * @returns the `tool/call` event.
 */
function askCall(turn: number, step: number, time: number, questions: readonly Record<string, unknown>[]): SessionEventLike {
  return toolCall(turn, step, time, 'ask_user_question', JSON.stringify({ questions }))
}

/**
 * An `approval/asked` audit dispatch, with whatever extra fields a test needs.
 *
 * @param data - the raw audit payload fields.
 * @param time - the event time.
 * @returns the `session/event` payload to dispatch.
 */
function approvalAsked(data: Record<string, unknown>, time = 1_500): SessionEventLike {
  return { type: 'approval/asked', time, data }
}

/* ── Reading the queued mail ──────────────────────────────────────────── */

/**
 * Render every queued job under the mounted plugin's own render switches.
 *
 * @param harness - the mounted plugin.
 * @param jobs - the jobs the sink received.
 * @returns one rendered message per job, in delivery order.
 */
function mailsFor(harness: PluginHarness, jobs: readonly MailJob[]): { subject: string; text: string }[] {
  const handle = harness.handle
  assert.ok(handle !== undefined)
  return jobs.map((job) =>
    renderMail({ notification: job.notification, render: handle.config.render, truncated: job.truncated }),
  )
}

/**
 * The rendered message of the only job a chain produced.
 *
 * @param harness - the mounted plugin.
 * @param jobs - the jobs the sink received.
 * @returns the rendered subject and body.
 */
function onlyMail(harness: PluginHarness, jobs: readonly MailJob[]): { subject: string; text: string } {
  assert.equal(jobs.length, 1, 'the interaction must produce exactly one job')
  const mail = mailsFor(harness, jobs)[0]
  assert.ok(mail !== undefined)
  return mail
}

/**
 * The question branch of the only job a chain produced.
 *
 * Reading the discriminant is what makes a test about questions fail loudly if
 * a turn notification ever took the question's place.
 *
 * @param jobs - the jobs the sink received.
 * @returns the question notification.
 */
function onlyQuestion(jobs: readonly MailJob[]): QuestionNotification {
  assert.equal(jobs.length, 1, 'the call must produce exactly one job')
  const notification: Notification | undefined = jobs[0]?.notification
  assert.equal(notification?.kind, 'question')
  assert.ok(notification !== undefined && notification.kind === 'question')
  return notification
}

/**
 * The approval branch of the only job a chain produced.
 *
 * @param jobs - the jobs the sink received.
 * @returns the approval notification.
 */
function onlyApproval(jobs: readonly MailJob[]): ApprovalNotification {
  assert.equal(jobs.length, 1, 'the ask must produce exactly one job')
  const notification: Notification | undefined = jobs[0]?.notification
  assert.equal(notification?.kind, 'approval')
  assert.ok(notification !== undefined && notification.kind === 'approval')
  return notification
}

/**
 * Whether one question call produced a question mail under a given mount.
 *
 * The subagent tests differ only in one configuration switch, so the comparison
 * is written as one helper that both cases call; two hand-written bodies could
 * drift and make the two halves incomparable.
 *
 * @param overrides - the raw configuration for the mount.
 * @param session - the session that asks.
 * @param call - the observed call.
 * @returns the jobs the sink received.
 */
async function questionRun(
  overrides: Record<string, unknown>,
  session: SessionLike,
  call: SessionEventLike,
): Promise<MailJob[]> {
  const sink = controllableSink()
  const harness = await mount(overrides, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, session, [call])
  await handle.queue.settle()
  return sink.jobs
}

/* ── QUE-01…QUE-05: questions ──────────────────────────────────────────── */

test('QUE-01 one question produces one mail that names the question, its options, and what to do', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    askCall(1, 1, 1_100, [
      {
        id: 'language',
        header: 'Pick a language',
        question: 'Which implementation language should the service use?',
        options: [
          { label: 'Go', description: 'Fast to deploy, smaller ecosystem.' },
          { label: 'TypeScript', description: 'One language across the stack.' },
        ],
      },
    ]),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  assert.equal(mail.subject, '[DSH] Input required — Pick a language', 'the header is the subject label')
  assert.ok(mail.text.includes('Which implementation language should the service use?'))
  assert.ok(mail.text.includes('Go'))
  assert.ok(mail.text.includes('Fast to deploy, smaller ecosystem.'), 'the option tradeoff is the reason the human can decide')
  assert.ok(mail.text.includes('TypeScript'))
  assert.ok(mail.text.includes('One language across the stack.'))
  assert.ok(mail.text.includes('Open DSH to answer this request.'), 'the reader must be told how to act on the mail')
  assert.equal(onlyQuestion(sink.jobs).questions.length, 1)
})

test('QUE-02 several questions in one call are carried in one mail', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    askCall(1, 1, 1_100, [
      { id: 'q1', question: 'Which repository should be migrated first?' },
      { id: 'q2', question: 'Should the migration run in one pass or in batches?' },
    ]),
  ])
  await handle.queue.settle()

  // One mail rather than two: the call is one blocked interaction, and splitting
  // it would make the second half unanswerable from the reader's context.
  const mail = onlyMail(harness, sink.jobs)
  assert.equal(mail.subject, '[DSH] Input required — 2 questions', 'the subject states how many answers are wanted')
  assert.ok(mail.text.includes('Which repository should be migrated first?'))
  assert.ok(mail.text.includes('Should the migration run in one pass or in batches?'))
  assert.equal(onlyQuestion(sink.jobs).questions.length, 2)
})

test('QUE-03 two calls in one turn produce one mail each', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    askCall(1, 1, 1_200, [{ id: 'first', question: 'Is the staging database reachable?' }]),
    stepStart(1, 2, 1_300),
    askCall(1, 2, 1_400, [{ id: 'second', question: 'May the migration drop the legacy table?' }]),
    turnEnd(1, 1_500, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  // Two calls are two decisions and two answers; a turn-scoped key would let the
  // second one be swallowed as a duplicate of the first.
  assert.equal(sink.jobs.length, 2)
  const texts = mailsFor(harness, sink.jobs).map((mail) => mail.text)
  assert.ok(texts.some((text) => text.includes('Is the staging database reachable?')))
  assert.ok(texts.some((text) => text.includes('May the migration drop the legacy table?')))
  const callIds = sink.jobs.map((job) => (job.notification.kind === 'question' ? job.notification.callId : undefined))
  assert.deepEqual(callIds, ['call-1-1', 'call-1-2'], 'the DSH-issued call id is the per-call identity')
})

test('QUE-04 a re-delivered call does not produce a second mail', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  const call = askCall(1, 1, 1_100, [{ id: 'dup', question: 'Should the retry policy stay as it is?' }])
  emit(harness.ctx, rootSession(), [call])
  emit(harness.ctx, rootSession(), [call])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'the same durable call id is the same interaction')
  const duplicates = handle.logger
    .getRecords()
    .filter((record) => record.event === 'notification.suppressed' && record.fields['suppressedReason'] === 'duplicate')
  assert.equal(duplicates.length, 1, 'the second observation is reported as a duplicate, not silently ignored')
})

test('QUE-05 the mail is queued synchronously on the call event', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  // Only the call is emitted: no turn/result, no turn/end, and no answer. DSH is
  // blocked on the human *right now*, which is the whole point — a notification
  // that waited for the turn to settle would arrive after the human had already
  // answered, or never arrive at all because the turn is still open.
  emit(harness.ctx, rootSession(), [askCall(1, 1, 1_100, [{ id: 'now', question: 'May the deployment proceed?' }])])

  const enqueued = handle.logger.getRecords().filter((record) => record.event === 'notification.enqueued')
  assert.equal(enqueued.length, 1, 'the enqueue happened before any settle was awaited')
  assert.equal(enqueued[0]?.fields['notificationKind'], 'question')
  assert.equal(handle.dedupe.size, 1, 'the call id was marked at enqueue time')
  await handle.queue.settle()
  assert.equal(sink.jobs.length, 1)
})

test('QUE-06 notifyQuestions:false sends nothing and logs disabled-by-policy', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [askCall(1, 1, 1_100, [{ id: 'off', question: 'Should this question be mailed?' }])])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 0, 'the question text is the operator’s own task content, so the default is off')
  const suppressions = handle.logger
    .getRecords()
    .filter((record) => record.event === 'notification.suppressed' && record.fields['suppressedReason'] === 'disabled-by-policy')
  assert.equal(suppressions.length, 1)
  assert.equal(suppressions[0]?.fields['notificationKind'], 'question')
})

/* ── QUE-07…QUE-10: the narrow exception stays narrow ──────────────────── */

test('QUE-07 no other tool’s arguments reach a mail, a job, or a log', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true }, { sink: sink.sink, logBufferSize: 2_000 })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  const names = ['bash', 'pwsh', 'read', 'write', 'subagent', 'web_search', 'mcp__server__tool']
  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    ...names.map((name, index) =>
      toolCall(1, index + 1, 1_100 + index, name, `{"command":"${TOOL_ARGUMENT_SECRET_SENTINEL}"}`),
    ),
    stepStart(1, names.length + 1, 1_900),
    assistantMessage({ turn: 1, step: names.length + 1, time: 2_000, content: [{ type: 'text', text: 'the ordinary answer' }] }),
    turnEnd(1, 2_100, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'only the completed turn notifies; no generic call is a question')
  assert.equal(sink.jobs[0]?.notification.kind, 'turn')
  assert.equal(
    handle.logger.getRecords().some((record) => record.event === 'question.unparsable'),
    false,
    'a non-matching name is never even interpreted as a question call',
  )
  const rendered = handle.logger.render()
  assert.ok(rendered.length > 500, 'the log buffer is not empty, so the negative assertions below are meaningful')
  assert.equal(rendered.includes(TOOL_ARGUMENT_SECRET_SENTINEL), false, 'no log line may carry a tool argument')
  assert.equal(JSON.stringify(sink.jobs).includes(TOOL_ARGUMENT_SECRET_SENTINEL), false, 'no job may carry a tool argument')
  const mail = onlyMail(harness, sink.jobs)
  assert.equal(mail.text.includes(TOOL_ARGUMENT_SECRET_SENTINEL), false, 'no body may carry a tool argument')
})

test('QUE-08 unparsable arguments produce no mail, are logged, and never leak their text', async () => {
  const rawArguments = '{not json'
  const sink = controllableSink()
  // A large buffer matters here: the subject of this test is what the *log* may
  // not contain, and an empty buffer would make that assertion vacuous.
  const harness = await mount({ notifyQuestions: true, notifyCompleted: true }, { sink: sink.sink, logBufferSize: 2_000 })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_050),
    // The model's argument string is not JSON at all — a truncated stream is the
    // ordinary cause. It must degrade to "nothing to notify", never to a throw
    // on the session-append path.
    toolCall(1, 1, 1_100, 'ask_user_question', rawArguments),
    stepStart(1, 2, 1_200),
    assistantMessage({ turn: 1, step: 2, time: 1_300, content: [{ type: 'text', text: 'the answer after the question call' }] }),
    turnEnd(1, 1_400, { kind: 'completed' }),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'the malformed call produces no question mail')
  assert.equal(sink.jobs[0]?.notification.kind, 'turn', 'and the turn still completes normally')
  const enqueued = handle.logger.getRecords().filter((record) => record.event === 'notification.enqueued')
  assert.equal(enqueued.length, 1)
  assert.equal(enqueued[0]?.fields['notificationKind'], 'turn')

  const unparsable = handle.logger.getRecords().filter((record) => record.event === 'question.unparsable')
  assert.equal(unparsable.length, 1, 'a malformed call is reported rather than swallowed')
  assert.equal(unparsable[0]?.fields['argumentsReadable'], false, 'the log says the JSON itself was unreadable')
  assert.equal(unparsable[0]?.fields['dropReason'], 'unreadable-arguments')
  // Neither the argument string nor any fragment of it may appear in a log: the
  // reason is stated, the text never is (§13, §36).
  assert.ok(handle.logger.render().includes('question.unparsable'), 'the guard below is made against a filled buffer')
  assert.equal(handle.logger.render().includes(rawArguments), false)
})

test('QUE-09 fields the allowlist does not name are dropped, never rendered', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    askCall(1, 1, 1_100, [
      {
        id: 'leaky',
        question: 'Which credential profile should the deployment use?',
        secret: 'TOKEN_SENTINEL',
        options: [{ label: 'the staging profile', description: 'read-only access', tooltip: 'TOOLTIP_SENTINEL' }],
      },
    ]),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  assert.ok(mail.text.includes('Which credential profile should the deployment use?'), 'the question itself is carried')
  assert.ok(mail.text.includes('the staging profile'))
  assert.equal(mail.text.includes('TOKEN_SENTINEL'), false, 'a field the allowlist does not name cannot reach the body')
  assert.equal(mail.text.includes('TOOLTIP_SENTINEL'), false)
  assert.equal(mail.text.includes('secret'), false, 'not even the extra property’s name is reproduced')
  assert.equal(mail.text.includes('tooltip'), false)
  assert.equal(handle.logger.render().includes('TOKEN_SENTINEL'), false, 'nor a log line')
  assert.equal(
    Object.hasOwn(sink.jobs[0]?.notification ?? {}, 'secret'),
    false,
    'the notification is built field by field, so no spread could have carried it',
  )
})

test('QUE-10 an oversized question is bounded and the mail is still produced', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyQuestions: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  const longQuestion = `Bounded? ${'x'.repeat(5_000)}`
  emit(harness.ctx, rootSession(), [askCall(1, 1, 1_100, [{ id: 'oversized', question: longQuestion }])])
  await handle.queue.settle()

  // A question a model made enormous is still a question the human is blocked
  // on, so it must be bounded rather than dropped: the bound is the parser's,
  // applied before the body exists, which is why `truncated` stays false here.
  const mail = onlyMail(harness, sink.jobs)
  assert.ok(mail.text.includes('Bounded?'), 'the readable beginning of the question is still there')
  assert.equal(mail.text.includes('x'.repeat(100)), true)
  assert.equal(sink.jobs[0]?.truncated, false, 'the parser bounded the text, not maxBodyChars')
  const carried = onlyQuestion(sink.jobs).questions[0]
  assert.ok(carried !== undefined)
  assert.equal(Array.from(carried.question).length, 2_000, 'the carried text is the parser’s own bound')
  assert.ok(Array.from(carried.question).length < Array.from(longQuestion).length)
})

test('QUE-11 a subagent question is silent until subagents are included', async () => {
  const call = askCall(1, 1, 1_100, [{ id: 'sub', question: 'Should the delegated agent keep going?' }])
  const session = subagentSession('session-sub-question')

  // DSH may well prevent a delegated agent from asking at all; that is a runtime
  // fact this suite cannot manufacture. What is asserted here is the plugin's
  // own gate, which must hold whichever way the runtime behaves: with
  // `includeSubagents: false` a subagent's question never mails, and the same
  // call in the same session does mail once the operator opts in.
  const excluded = await questionRun({ notifyQuestions: true, includeSubagents: false }, session, call)
  assert.equal(excluded.length, 0, 'an excluded session must produce no question mail')

  const included = await questionRun({ notifyQuestions: true, includeSubagents: true }, session, call)
  assert.equal(included.length, 1, 'the opt-in is what decides, not the session shape')
  assert.equal(included[0]?.notification.kind, 'question')
})

/* ── APR-01…APR-08: approvals ──────────────────────────────────────────── */

test('APR-01 an approval ask is mailed with its tool name and reason', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyApprovals: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    approvalAsked({ id: 'approval-1', toolName: 'bash', callId: 'call-9-1', reason: 'the command writes to the production database' }),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  assert.equal(mail.subject, '[DSH] Approval required — bash')
  assert.ok(mail.text.includes('bash'), 'the reader must know which tool is waiting')
  assert.ok(mail.text.includes('the command writes to the production database'), 'the asker’s reason is the decision input')
  // The instruction line is the renderer's own wording, read off `subject.ts`;
  // an approval mail that did not tell the reader where to act would be a dead end.
  assert.ok(mail.text.includes('Open DSH to answer this request.'))
  assert.ok(mail.text.includes('Tool arguments: not published by DSH and not included in this message.'))
  assert.equal(onlyApproval(sink.jobs).callId, 'call-9-1', 'the exact call id is the dedupe anchor')
})

test('APR-02 notifyApprovals:false sends nothing and logs disabled-by-policy', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [approvalAsked({ id: 'approval-off', toolName: 'bash', reason: 'a write operation' })])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 0, 'an approval interrupt is off by default')
  const suppressions = handle.logger
    .getRecords()
    .filter((record) => record.event === 'notification.suppressed' && record.fields['suppressedReason'] === 'disabled-by-policy')
  assert.equal(suppressions.length, 1)
  assert.equal(suppressions[0]?.fields['notificationKind'], 'approval')
})

test('APR-03 a re-delivered approval ask does not produce a second mail', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyApprovals: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  const asked = approvalAsked({ id: 'approval-dup', toolName: 'write', reason: 'the file is outside the workspace' })
  emit(harness.ctx, rootSession(), [asked])
  emit(harness.ctx, rootSession(), [asked])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'the service-issued approval id is the identity, so a replay is one interaction')
  const duplicates = handle.logger
    .getRecords()
    .filter((record) => record.event === 'notification.suppressed' && record.fields['suppressedReason'] === 'duplicate')
  assert.equal(duplicates.length, 1)
})

test('APR-04 a decided approval sends no second “you are needed” mail', async () => {
  for (const outcome of ['allowed-once', 'rejected']) {
    const sink = controllableSink()
    const harness = await mount({ notifyApprovals: true }, { sink: sink.sink })
    const handle = harness.handle
    assert.ok(handle !== undefined)

    const id = `approval-${outcome}`
    emit(harness.ctx, rootSession(`session-decided-${outcome}`), [
      approvalAsked({ id, toolName: 'bash', callId: 'call-1-1', reason: 'a write operation' }),
      // The decision arriving means the human already acted; the task is no
      // longer blocked on anybody, so a second "you are needed" mail would be
      // false rather than merely redundant.
      { type: 'approval/decided', time: 1_600, data: { id, callId: 'call-1-1', outcome } },
    ])
    await handle.queue.settle()

    assert.equal(sink.jobs.length, 1, `an ${outcome} decision must not enqueue anything`)
    assert.equal(sink.jobs[0]?.notification.kind, 'approval')
    assert.equal(handle.dedupe.size, 1, 'only the ask spent a dedupe key')
  }
})

test('APR-05 an approval with no call id and no reason is still mailed', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyApprovals: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  const sessionId = 'session-minimal-approval'
  const session = rootSession(sessionId)
  const asked = approvalAsked({ id: 'approval-minimal', toolName: 'pwsh' })
  emit(harness.ctx, session, [asked])
  emit(harness.ctx, session, [asked])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  assert.equal(mail.subject, '[DSH] Approval required — pwsh', 'the tool name is the only label the runtime guaranteed')
  // An asker that supplied no reason is an observation, and the body says so
  // rather than leaving a blank line that reads like a rendering fault.
  assert.ok(mail.text.includes('Reason: not reported'))
  assert.equal(mail.text.includes('undefined'), false, 'an absent optional field is stated, never printed as a value')
  assert.equal(onlyApproval(sink.jobs).reason, undefined)
  assert.equal(onlyApproval(sink.jobs).callId, undefined, 'the payload carried no call id to claim')
  // The service-issued id is still the key even though the notification carries
  // no id of its own: with no key at all, the re-observed ask would mail twice.
  assert.equal(handle.dedupe.has(DedupeCache.approvalKeyFor(sessionId, 'approval-minimal')), true)
})

test('APR-06 arguments a hostile payload adds to the ask never appear', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyApprovals: true }, { sink: sink.sink, logBufferSize: 2_000 })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  // DSH's own approval contract publishes the tool name, the call id, and the
  // asker's reason, and never the approved tool's arguments. This payload adds
  // an `arguments` field anyway — a forward-compatible or hostile one — and the
  // plugin must not add it back: the adapter copies named fields only, so there
  // is no path from that field to a body, a subject, or a log line.
  emit(harness.ctx, rootSession(), [
    approvalAsked({
      id: 'approval-hostile',
      toolName: 'bash',
      callId: 'call-7-1',
      reason: 'the command needs write access',
      arguments: `{"command":"cat /etc/shadow && ${TOOL_ARGUMENT_SECRET_SENTINEL}"}`,
    }),
  ])
  await handle.queue.settle()

  const mail = onlyMail(harness, sink.jobs)
  assert.ok(mail.text.includes('the command needs write access'))
  assert.equal(mail.text.includes(TOOL_ARGUMENT_SECRET_SENTINEL), false, 'no body may carry an approval argument')
  assert.equal(mail.subject.includes(TOOL_ARGUMENT_SECRET_SENTINEL), false)
  const rendered = handle.logger.render()
  assert.ok(rendered.length > 500, 'the log buffer is not empty, so the negative assertion below is meaningful')
  assert.equal(rendered.includes(TOOL_ARGUMENT_SECRET_SENTINEL), false, 'no log line may carry an approval argument')
  assert.equal(JSON.stringify(sink.jobs).includes(TOOL_ARGUMENT_SECRET_SENTINEL), false, 'no job may carry one either')
  assert.equal(
    Object.hasOwn(onlyApproval(sink.jobs), 'arguments'),
    false,
    'the notification has no field for the arguments at all',
  )
})

test('APR-07 a subagent approval is silent until subagents are included', async () => {
  const session = subagentSession('session-sub-approval')
  const asked = approvalAsked({ id: 'approval-sub', toolName: 'bash', reason: 'a delegated agent wants to write' })

  const excluded = await questionRun({ notifyApprovals: true, includeSubagents: false }, session, asked)
  assert.equal(excluded.length, 0, 'an excluded session must produce no approval mail')

  const included = await questionRun({ notifyApprovals: true, includeSubagents: true }, session, asked)
  assert.equal(included.length, 1)
  assert.equal(included[0]?.notification.kind, 'approval')
})

test('QUE-12/APR-08 the duration floor never suppresses a mid-turn interaction', async () => {
  const sink = controllableSink()
  // A ten-minute floor, and a turn that has just started: `minTurnDurationMs`
  // governs a *settled turn's* importance, and applying it to a mid-turn
  // interaction would silence exactly the case the mail exists for — an agent
  // that stopped two seconds in to ask a person something.
  const harness = await mount(
    { minTurnDurationMs: 600_000, notifyQuestions: true, notifyApprovals: true, notifyCompleted: true },
    { sink: sink.sink },
  )
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), [
    turnStart(1, 1_000),
    stepStart(1, 1, 1_100),
    askCall(1, 1, 1_150, [{ id: 'mid', header: 'Blocked on you', question: 'Which environment should this run against?' }]),
    approvalAsked({ id: 'approval-mid', toolName: 'bash', reason: 'the command deletes a directory' }, 1_200),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 2, 'both interactions are mailed while the turn is still open')
  assert.deepEqual(
    sink.jobs.map((job) => job.notification.kind).sort(),
    ['approval', 'question'],
    'one mail per interaction family, not one per turn',
  )
  const mails = mailsFor(harness, sink.jobs)
  assert.equal(
    mails.some((mail) => mail.subject === '[DSH] Input required — Blocked on you'),
    true,
    'the question subject is the question header',
  )
  assert.equal(
    mails.some((mail) => mail.subject === '[DSH] Approval required — bash'),
    true,
    'the approval subject is the tool name',
  )
  assert.equal(
    handle.logger
      .getRecords()
      .some((record) => record.fields['suppressedReason'] === 'below-min-duration'),
    false,
    'the floor is a turn-level rule and never reaches the mid-turn decision',
  )
})
