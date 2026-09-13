/**
 * L5 end-to-end contract tests — matrix rows ADP-06, SUP-05, QUE-06, LIFE-01…
 * LIFE-07, the pipeline-level halves of TRN-01/TRN-03 and TOOL-05, PRIV-01…PRIV-07
 * in a live pipeline, and E2E-01…E2E-08.
 *
 * The plugin is mounted through a real Cordis context and driven with real
 * `ctx.emit('session/event', …)` dispatches, so listener registration, service
 * lookup, configuration validation, and fiber disposal all take the production
 * path. Only the two environment services are replaced: a fake Credential
 * provider and a fake timer. No socket is opened and no credential exists.
 *
 * @module dsh-mail-notify/tests/integration/lifecycle
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import * as plugin from '../../src/index.ts'
import type { CredentialInfo, CredentialProviderLike, CredentialRef, ResolvedCredential } from '../../src/credentials.ts'
import type { ApplyInternals, MailNotifyHandle } from '../../src/index.ts'
import type { SessionEventLike, SessionLike } from '../../src/runtime-adapter.ts'
import type { MailJob, SendResult } from '../../src/types.ts'
import {
  assistantMessage,
  healthyTurnChain,
  mixedAssistantMessage,
  reasoningOnlyMessage,
  rootSession,
  stepStart,
  subagentSession,
  toolCall,
  toolResultOk,
  turnEnd,
  turnStart,
  userMessage,
  REASONING_SECRET_SENTINEL,
  SMTP_PASSWORD_SENTINEL,
  USER_PROMPT_SENTINEL,
} from '../fixtures/runtime-shapes.ts'
import { VALID_RAW_CONFIG, delay, waitFor } from '../support/harness.ts'

/** The fake credential store, deliberately holding a synthetic value only. */
class FakeCredentials implements CredentialProviderLike {
  value: string | undefined = SMTP_PASSWORD_SENTINEL
  readonly resolveCalls: string[] = []

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    this.resolveCalls.push(String(ref))
    if (this.value === undefined) return Promise.resolve(undefined)
    return Promise.resolve({ value: this.value, source: 'fake' })
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    void ref
    return Promise.resolve({ configured: this.value !== undefined, writable: true } as CredentialInfo)
  }
}

/** A fake Credential service published as `ctx.credentials`. */
class CredentialsService extends Service {
  static staged: FakeCredentials | undefined

  readonly fake: FakeCredentials

  constructor(ctx: Context) {
    super(ctx, 'credentials')
    const staged = CredentialsService.staged
    if (staged === undefined) throw new Error('no FakeCredentials was staged before mounting')
    this.fake = staged
  }

  /** Stage the fake the next mounted instance will publish. */
  static stage(fake: FakeCredentials): void {
    CredentialsService.staged = fake
  }

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return this.fake.resolve(ref)
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    return this.fake.describe(ref)
  }
}

/** A fake timer service published as `ctx.timer`, so a backoff never really waits. */
class TimerService extends Service {
  static delays: number[] = []

  constructor(ctx: Context) {
    super(ctx, 'timer')
  }

  timeout(delayMs: number): Promise<void> {
    TimerService.delays.push(delayMs)
    return Promise.resolve()
  }
}

/** The mounted harness returned by {@link mount}. */
interface Harness {
  ctx: Context
  /** Absent when the plugin refused to mount. */
  handle: MailNotifyHandle | undefined
  credentials: FakeCredentials
  dispose: () => Promise<void>
  /**
   * Every *public* event name with at least one registered listener.
   *
   * Cordis' own `internal/*` hooks are filtered out: they belong to the
   * framework's service plumbing, not to this plugin, and asserting on them
   * would make the test report on Cordis rather than on the plugin.
   */
  listenerNames: () => string[]
  /** The plugin's registered listener callbacks for one event, in order. */
  listenersFor: (name: string) => Array<(...args: never[]) => unknown>
}

/** A registered listener record as Cordis stores it. */
interface HookRecord {
  callback?: (...args: never[]) => unknown
}

/**
 * Mount the plugin on a real context with fake environment services.
 *
 * @param overrides - raw configuration fields merged over a valid base.
 * @param internals - sink, clock, and wait seams.
 * @param options - `credentials: false` mounts no credential service.
 * @returns the harness.
 */
async function mount(
  overrides: Record<string, unknown> = {},
  internals: ApplyInternals = {},
  options: { credentials?: boolean } = {},
): Promise<Harness> {
  const ctx = new Context()
  const credentials = new FakeCredentials()
  if (options.credentials !== false) {
    CredentialsService.stage(credentials)
    await ctx.plugin(CredentialsService)
  }
  TimerService.delays = []
  await ctx.plugin(TimerService)

  // `apply` runs on a child context that shares the parent's service scope, so
  // the plugin resolves `credentials` and `timer` through the normal path while
  // the test keeps a handle to what `apply` returned.
  const child = ctx.extend()
  const handle = plugin.apply(child as never, { ...VALID_RAW_CONFIG, ...overrides } as never, {
    // A real backoff would make the suite slow; the queue gets the seam instead.
    sleep: async (delayMs: number) => {
      TimerService.delays.push(delayMs)
    },
    ...internals,
  })

  const hooks = (): Record<string, HookRecord[]> =>
    (ctx as unknown as { events: { _hooks: Record<string, HookRecord[]> } }).events._hooks

  return {
    ctx,
    handle,
    credentials,
    dispose: () => (child as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose(),
    listenerNames: () => Object.keys(hooks()).filter((entry) => !entry.startsWith('internal/')),
    listenersFor: (name: string) =>
      (hooks()[name] ?? [])
        .map((record) => record.callback)
        .filter((callback): callback is (...args: never[]) => unknown => typeof callback === 'function'),
  }
}

/** Build a sink that records the jobs it received and can be made to fail. */
function controllableSink(failures: SendResult[] = []): {
  sink: (job: MailJob) => Promise<SendResult>
  jobs: MailJob[]
} {
  const jobs: MailJob[] = []
  return {
    jobs,
    sink: async (job: MailJob): Promise<SendResult> => {
      jobs.push(job)
      return failures.shift() ?? { ok: true }
    },
  }
}

/**
 * Emit a chain of session events for one session.
 *
 * The fixtures are structural stand-ins rather than live `Session` instances —
 * building a real session needs the whole agent loop — so the carrier is cast
 * at this single boundary. The payloads the listener reads are unchanged and
 * still type-checked through `SessionEventLike`.
 */
function emit(ctx: Context, session: SessionLike, events: readonly SessionEventLike[]): void {
  for (const event of events) ctx.emit('session/event', session as never, event as never)
}

/** Dispatch `session/disposed` for a structural session stand-in. */
function emitDisposed(ctx: Context, session: SessionLike): void {
  ctx.emit('session/disposed', session as never)
}

/* ── Registration and the master switch ───────────────────────────────── */

test('ADP-06 only session/event and session/disposed are registered', async () => {
  const harness = await mount()
  assert.ok(harness.handle !== undefined)
  assert.deepEqual(harness.listenerNames().sort(), ['session/disposed', 'session/event'])
  for (const forbidden of ['turn/start', 'turn/end', 'assistant/message', 'tool/result', 'tool/call']) {
    assert.equal(harness.listenerNames().includes(forbidden), false, `${forbidden} is not a top-level event here`)
  }
})

test('SUP-05 enabled:false registers no listener at all', async () => {
  const harness = await mount({ enabled: false })
  assert.equal(harness.handle, undefined)
  assert.deepEqual(harness.listenerNames(), [], 'a disabled plugin must not register anything')

  // Emitting anyway must be inert rather than merely suppressed.
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'answer'))
  await delay(20)
  assert.equal(harness.listenerNames().length, 0)
})

test('a configuration failure refuses to mount and registers nothing', async () => {
  const harness = await mount({ smtpHost: '' })
  assert.equal(harness.handle, undefined)
  assert.deepEqual(harness.listenerNames(), [])
})

test('a profile without a Credential service still loads and registers', async () => {
  const harness = await mount({}, {}, { credentials: false })
  assert.ok(harness.handle !== undefined, 'a missing optional service must not prevent activation')
  assert.deepEqual(harness.listenerNames().sort(), ['session/disposed', 'session/event'])
})

/* ── The candidate pipeline ───────────────────────────────────────────── */

test('E2E-01 a complete turn produces exactly one job with real telemetry', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink, now: () => 1_750_000_000_999 })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'the final answer'))
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1)
  const job = sink.jobs[0]
  assert.ok(job !== undefined)
  assert.equal(job.candidate.schemaVersion, 1)
  assert.equal(job.candidate.turn, 1)
  assert.equal(job.candidate.status, 'completed-clean')
  assert.equal(job.candidate.visibleText, 'the final answer')
  assert.equal(job.candidate.telemetryComplete, true)
  assert.equal(job.candidate.sawTurnStart, true)
  assert.equal(typeof job.candidate.durationMs, 'number')
  assert.equal(job.candidate.provider, 'deepseek-official')
  assert.equal(job.candidate.model, 'deepseek-chat')
  assert.equal(job.candidate.cwd, 'E:\\Projects\\DSHarness\\dsh-mail-notify')
  assert.equal(job.truncated, false)
  assert.deepEqual([...job.to], ['recipient@example.com'])
})

test('E2E-02 a mid-turn attach produces one job with an unknown duration and real counters', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  // No turn/start: the plugin attached after the turn had already begun.
  emit(harness.ctx, rootSession(), [
    stepStart(4, 1, 10),
    mixedAssistantMessage(4, 1, 20, 'partial'),
    toolCall(4, 1, 30),
    toolResultOk(4, 1, 40),
    stepStart(4, 2, 50),
    mixedAssistantMessage(4, 2, 60, 'the real answer'),
    toolResultOk(4, 2, 70),
    turnEnd(4, 80),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1)
  const candidate = sink.jobs[0]?.candidate
  assert.ok(candidate !== undefined)
  assert.equal(candidate.durationMs, null, 'an unobserved start must not become a duration')
  assert.notEqual(candidate.durationMs, 0)
  assert.equal(candidate.telemetryComplete, false)
  assert.equal(candidate.visibleText, 'the real answer')
  assert.equal(candidate.sawTurnStart, false)
  assert.equal(handle.dedupe.size, 1)
})

test('E2E-03 in a mixed session population only the top-level turn notifies', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  const top = rootSession()
  emit(harness.ctx, top, healthyTurnChain(1, 'top-level answer'))
  for (const id of ['session-sub-1', 'session-sub-2', 'session-sub-3']) {
    emit(harness.ctx, subagentSession(id), healthyTurnChain(1, `subagent ${id} answer`))
  }
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'three subagent turns must produce nothing')
  assert.equal(sink.jobs[0]?.candidate.sessionId, top.id)
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
})

test('E2E-03b includeSubagents:true lets subagent turns through', async () => {
  const sink = controllableSink()
  const harness = await mount({ includeSubagents: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'top'))
  emit(harness.ctx, subagentSession('session-sub'), healthyTurnChain(1, 'sub'))
  await handle.queue.settle()
  assert.equal(sink.jobs.length, 2)
})

test('E2E-04 a turn with an explicit tool error is classified and marked as such', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'answer despite a tool failure', { toolError: true }))
  await handle.queue.settle()

  const candidate = sink.jobs[0]?.candidate
  assert.ok(candidate !== undefined)
  assert.equal(candidate.status, 'completed-with-tool-errors')
  assert.equal(candidate.explicitToolErrorCount, 1)
  assert.equal(candidate.turnEndKind, 'completed')
})

test('TOOL-05 end to end: a non-zero shell exit leaves the turn completed-clean', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), [
    turnStart(1, 1000),
    stepStart(1, 1, 1010),
    toolCall(1, 1, 1020),
    toolResultOk(1, 1, 1030, 'a failing command\n[exit code: 1]'),
    assistantMessage({ turn: 1, step: 2, time: 1040, content: [{ type: 'text', text: 'the answer' }] }),
    turnEnd(1, 1050),
  ])
  await handle.queue.settle()

  const candidate = sink.jobs[0]?.candidate
  assert.ok(candidate !== undefined)
  assert.equal(candidate.explicitToolErrorCount, 0)
  assert.equal(candidate.status, 'completed-clean')
})

test('E2E-05 a repeated turn/end yields exactly one job', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  const session = rootSession()
  const chain = healthyTurnChain(1, 'the answer')
  emit(harness.ctx, session, chain)
  emit(harness.ctx, session, chain)
  emit(harness.ctx, session, [turnEnd(1, 999_999)])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'duplicate delivery must not produce a second message')
  // The requirement is `!== 2 jobs`; the stronger, useful assertion is that the
  // duplicate *decision* was reached and reported rather than silently ignored.
  const duplicates = handle.logger
    .getRecords()
    .filter((record) => record.event === 'notification.suppressed' && record.fields['suppressedReason'] === 'duplicate')
  assert.ok(duplicates.length >= 1, 'a duplicate settlement is reported, not silently swallowed')
  const enqueued = handle.logger.getRecords().filter((record) => record.event === 'notification.enqueued')
  assert.equal(enqueued.length, 1)
})

test('E2E-06 a turn with no visible text produces no job and says why', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), [
    turnStart(1, 1000),
    stepStart(1, 1, 1010),
    reasoningOnlyMessage(1, 1, 1020),
    toolCall(1, 1, 1030),
    toolResultOk(1, 1, 1040),
    turnEnd(1, 1050),
  ])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 0)
  const records = handle.logger.getRecords()
  const candidate = records.find((record) => record.event === 'candidate.produced')
  assert.ok(candidate !== undefined)
  assert.equal(candidate.fields['visibleTextLength'], 0)
  const suppressed = records.find((record) => record.event === 'notification.suppressed')
  assert.ok(suppressed !== undefined)
  assert.equal(suppressed.fields['suppressedReason'], 'no-visible-text')
})

test('E2E-07 the listener returns undefined and no rejection escapes', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    const sink = controllableSink()
    const harness = await mount({}, { sink: sink.sink })
    const handle = harness.handle
    assert.ok(handle !== undefined)
    const session = rootSession()

    // QUE-06: the registered listener's return value is undefined, never a
    // promise. Reading it off the real registration is what makes this a test
    // of the plugin rather than of a helper.
    const [registered] = harness.listenersFor('session/event')
    assert.ok(registered !== undefined)
    const returned = (registered as (s: SessionLike, e: SessionEventLike) => unknown)(session, turnStart(1, 1000))
    assert.equal(returned, undefined, 'the listener must return undefined')
    assert.ok(!(returned !== null && typeof returned === 'object' && 'then' in returned), 'and not a thenable')

    emit(harness.ctx, session, healthyTurnChain(2, 'answer'))
    await handle.queue.settle()
    assert.equal(sink.jobs.length, 1)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }

  await delay(20)
  assert.deepEqual(unhandled, [])
})

test('E2E-08 a full queue still answers synchronously and counts the refusal', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const jobs: MailJob[] = []
  const sink = async (job: MailJob): Promise<SendResult> => {
    jobs.push(job)
    await gate
    return { ok: true }
  }

  const harness = await mount({ queueSize: 1 }, { sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession('session-a'), healthyTurnChain(1, 'first'))
  await waitFor(() => handle.queue.stats().inFlight, 'the worker to take the first job')

  const startedAt = Date.now()
  emit(harness.ctx, rootSession('session-b'), healthyTurnChain(1, 'second'))
  emit(harness.ctx, rootSession('session-c'), healthyTurnChain(1, 'third'))
  const elapsed = Date.now() - startedAt
  assert.ok(elapsed < 200, `emitting into a full queue must not wait (took ${elapsed} ms)`)

  assert.equal(handle.queue.stats().droppedCount, 1)
  const warnings = handle.logger.getRecords().filter((record) => record.event === 'queue.rejected')
  assert.equal(warnings.length, 1, 'a refused job is reported structurally')
  assert.equal(warnings[0]?.fields['queueSize'], 1)

  release?.()
  await handle.queue.settle()
})

test('a refused enqueue leaves the turn eligible rather than marking it sent', async () => {
  // The queue holds one waiting job and the worker holds one in flight; the
  // third arrival is what gets refused, and it is the refused one that must not
  // spend a dedupe key.
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const sink = async (): Promise<SendResult> => {
    await gate
    return { ok: true }
  }
  const harness = await mount({ queueSize: 1 }, { sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  emit(harness.ctx, rootSession('session-a'), healthyTurnChain(1, 'in flight'))
  emit(harness.ctx, rootSession('session-b'), healthyTurnChain(1, 'waiting'))
  emit(harness.ctx, rootSession('session-c'), healthyTurnChain(1, 'refused'))

  assert.equal(handle.queue.stats().droppedCount, 1)
  assert.equal(handle.queue.stats().depth, 1)
  assert.equal(handle.dedupe.has('session-a:1'), true, 'the in-flight turn spent its key')
  assert.equal(handle.dedupe.has('session-b:1'), true, 'the waiting turn spent its key')
  assert.equal(handle.dedupe.has('session-c:1'), false, 'the refused turn must stay eligible for a later delivery')

  release?.()
  await handle.queue.settle()
})

test('PRIV-06 subagents produce no candidate and no state', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, subagentSession('session-sub'), healthyTurnChain(1, `${REASONING_SECRET_SENTINEL} answer`))
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 0)
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
  const skipped = handle.logger.getRecords().filter((record) => record.event === 'turn.subagent-skipped')
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0]?.fields['decidedBy'], 'origin')
})

test('the includeUserPrompt switch is what carries the prompt, and nothing else does', async () => {
  const withSwitch = controllableSink()
  const first = await mount({ includeUserPrompt: true }, { sink: withSwitch.sink })
  assert.ok(first.handle !== undefined)
  emit(first.ctx, rootSession('session-prompt'), [
    turnStart(1, 1000),
    userMessage(`${USER_PROMPT_SENTINEL} please summarise the repository`),
    mixedAssistantMessage(1, 1, 1020, 'the answer'),
    turnEnd(1, 1030),
  ])
  await first.handle.queue.settle()
  assert.equal(withSwitch.jobs[0]?.candidate.userText?.includes(USER_PROMPT_SENTINEL), true)

  const withoutSwitch = controllableSink()
  const second = await mount({}, { sink: withoutSwitch.sink })
  assert.ok(second.handle !== undefined)
  emit(second.ctx, rootSession('session-prompt-2'), [
    turnStart(1, 1000),
    userMessage(`${USER_PROMPT_SENTINEL} please summarise the repository`),
    mixedAssistantMessage(1, 1, 1020, 'the answer'),
    turnEnd(1, 1030),
  ])
  await second.handle.queue.settle()
  const candidate = withoutSwitch.jobs[0]?.candidate
  assert.ok(candidate !== undefined)
  assert.equal(candidate.userText, undefined)
  assert.equal(JSON.stringify(candidate).includes(USER_PROMPT_SENTINEL), false)
})

test('PRIV-01/02/03 no job, log record, or candidate carries a sentinel', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink, logBufferSize: 2000 })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'the answer', { toolError: true }))
  await handle.queue.settle()

  const job = sink.jobs[0]
  assert.ok(job !== undefined)
  const serializedJob = JSON.stringify(job)
  const rendered = handle.logger.render()
  for (const sentinel of [REASONING_SECRET_SENTINEL, USER_PROMPT_SENTINEL, SMTP_PASSWORD_SENTINEL]) {
    assert.ok(!serializedJob.includes(sentinel), `${sentinel} must not be in the job`)
    assert.ok(!rendered.includes(sentinel), `${sentinel} must not be in a log line`)
  }
  assert.ok(rendered.length > 500, 'the log buffer is not empty, so the negative assertions are meaningful')
  assert.equal(harness.credentials.resolveCalls.length, 0, 'the debug sink resolves no credential at all')
})

/* ── Lifecycle and memory ─────────────────────────────────────────────── */

test('LIFE-01 a settled turn is released from the map', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'answer'))
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
  await handle.queue.settle()
})

test('LIFE-02 a suppressed turn is released too', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), [turnStart(1, 1000), reasoningOnlyMessage(1, 1, 1010), turnEnd(1, 1020)])
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
  assert.equal(sink.jobs.length, 0)
})

test('LIFE-03 the inner map collapses when its last turn settles', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  const session = rootSession()
  emit(harness.ctx, session, [turnStart(1, 1000), mixedAssistantMessage(1, 1, 1010, 'one')])
  emit(harness.ctx, session, [turnStart(2, 2000), mixedAssistantMessage(2, 1, 2010, 'two')])
  assert.equal(handle.handlers.stateSizes().turns, 2)
  emit(harness.ctx, session, [turnEnd(1, 1020)])
  assert.equal(handle.handlers.stateSizes().turns, 1)
  emit(harness.ctx, session, [turnEnd(2, 2020)])
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
  await handle.queue.settle()
  assert.equal(sink.jobs.length, 2)
})

test('LIFE-04 session/disposed releases everything for that session', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  const session = rootSession()
  emit(harness.ctx, session, [turnStart(1, 1000), mixedAssistantMessage(1, 1, 1010, 'in flight')])
  assert.equal(handle.handlers.stateSizes().turns, 1)

  harness.ctx.emit('session/disposed', session as never)
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })

  // A disposition for a session that never produced state is a no-op.
  emitDisposed(harness.ctx, rootSession('session-never-seen'))
})

test('LIFE-05 plugin dispose releases the map, the dedupe cache, and the queue', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'answer'))
  await handle.queue.settle()
  assert.equal(handle.dedupe.size, 1)

  await harness.dispose()
  assert.equal(handle.dedupe.size, 0, 'the dedupe cache is cleared')
  assert.equal(handle.queue.disposed, true)
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
})

test('LIFE-05b a disposed plugin no longer reacts to events', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  assert.ok(harness.handle !== undefined)
  await harness.dispose()

  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'after unload'))
  await delay(20)
  assert.equal(sink.jobs.length, 0, 'an unloaded plugin must schedule no work')
})

test('LIFE-06 a long run of sessions returns the map to its baseline', async () => {
  const sink = controllableSink()
  // A queue large enough that no turn is refused, so this test measures map and
  // cache growth rather than the documented `reject newest` behaviour.
  const harness = await mount({ queueSize: 1000 }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  for (let index = 0; index < 300; index += 1) {
    emit(harness.ctx, rootSession(`session-${index}`), healthyTurnChain(1, `answer ${index}`))
  }
  assert.equal(
    handle.handlers.stateSizes().sessions,
    0,
    'every turn settles immediately, so no session state accumulates',
  )
  await handle.queue.settle()
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
  assert.equal(handle.dedupe.size, 300, 'the cache holds one key per notified turn, under its 1000 cap')
  assert.equal(sink.jobs.length, 300)
  assert.equal(handle.queue.stats().droppedCount, 0)
})

test('LIFE-06c a queue smaller than the arrival rate refuses the newest turns, visibly', async () => {
  // The worker is held on the first job so the waiting slots fill up; every
  // later arrival is then refused by the bound rather than queued. Each refusal
  // must be counted and logged, never silently dropped.
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const harness = await mount({ queueSize: 4 }, {
    sink: async () => {
      await gate
      return { ok: true }
    },
  })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  for (let index = 0; index < 12; index += 1) {
    emit(harness.ctx, rootSession(`session-${index}`), healthyTurnChain(1, `answer ${index}`))
  }

  const stats = handle.queue.stats()
  assert.equal(stats.depth, 4, 'the waiting slots are all occupied')
  assert.equal(stats.droppedCount, 7, 'the remaining arrivals were refused')
  const warnings = handle.logger.getRecords().filter((record) => record.event === 'notification.rejected')
  assert.equal(warnings.length, stats.droppedCount, 'every refusal is counted and logged')
  assert.equal(handle.dedupe.size, 5, 'the in-flight and the four waiting turns spent keys; the refused ones did not')

  release?.()
  await handle.queue.settle()
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
})

test('LIFE-06b the dedupe cache stops growing at its configured bound', async () => {
  const sink = controllableSink()
  const harness = await mount({ maxDedupeEntries: 10 }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  for (let index = 0; index < 25; index += 1) {
    emit(harness.ctx, rootSession(`session-${index}`), healthyTurnChain(1, `answer ${index}`))
  }
  await handle.queue.settle()
  assert.equal(handle.dedupe.size, 10)
  assert.equal(handle.dedupe.has('session-0:1'), false, 'the oldest key was evicted')
  assert.equal(handle.dedupe.has('session-24:1'), true)
})

test('LIFE-07 an excluded subagent never creates a state entry', async () => {
  const harness = await mount()
  const handle = harness.handle
  assert.ok(handle !== undefined)
  const sub = subagentSession('session-sub')
  emit(harness.ctx, sub, [turnStart(1, 1000), mixedAssistantMessage(1, 1, 1010, 'sub text')])
  emit(harness.ctx, sub, [turnEnd(1, 1020)])
  assert.deepEqual(handle.handlers.stateSizes(), { sessions: 0, turns: 0, stepSets: 0 })
  assert.equal(handle.dedupe.size, 0, 'no dedupe key is spent on a session that never notifies')
})

test('LIFE-03c a retry uses the injected wait, so no test really sleeps', async () => {
  const delays: number[] = []
  let attempts = 0
  const harness = await mount(
    {},
    {
      sink: async () => {
        attempts += 1
        if (attempts === 1) return { ok: false, class: 'retry' as const, category: 'code-ETIMEDOUT', message: 't' }
        return { ok: true as const }
      },
      sleep: async (delayMs: number) => {
        delays.push(delayMs)
      },
    },
  )
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'answer'))
  await handle.queue.settle()

  assert.equal(attempts, 2)
  assert.deepEqual(delays, [1000], 'the default policy waits 1 s before the first retry')
})

test('a real timer service, when mounted, is used and its waits are recorded', async () => {
  const harness = await mount(
    {},
    {
      sink: async () => ({ ok: false, class: 'retry' as const, category: 'code-ETIMEDOUT', message: 't' }),
    },
  )
  const handle = harness.handle
  assert.ok(handle !== undefined)
  // No sleep seam is supplied here, so the queue takes the Cordis timer path.
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'answer'))
  await handle.queue.settle()
  assert.deepEqual(TimerService.delays, [1000, 3000, 9000])
})

/* ── Policy through the pipeline ──────────────────────────────────────── */

test('a minTurnDurationMs floor suppresses a fast turn but not an unknown-duration one', async () => {
  const sink = controllableSink()
  const harness = await mount({ minTurnDurationMs: 60_000 }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)

  // A real one-second turn is below the floor.
  emit(harness.ctx, rootSession('session-fast'), healthyTurnChain(1, 'fast answer'))
  // A mid-turn attach has an unknown duration and must not be suppressed.
  emit(harness.ctx, rootSession('session-mid'), [mixedAssistantMessage(5, 1, 10, 'mid-turn answer'), turnEnd(5, 20)])
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1)
  assert.equal(sink.jobs[0]?.candidate.sessionId, 'session-mid')
  assert.equal(sink.jobs[0]?.candidate.durationMs, null)
})

test('notifyErrors gates an error turn while notifyMaxTokens lets a truncated one through', async () => {
  const sink = controllableSink()
  const harness = await mount({}, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  const errorChain = healthyTurnChain(1, 'error text')
  errorChain[errorChain.length - 1] = turnEnd(1, 1_750_000_020_000, {
    kind: 'error',
    error: { message: 'upstream unavailable', code: 'LLM_UNAVAILABLE' },
  })
  emit(harness.ctx, rootSession('session-error'), errorChain)

  const truncatedChain = healthyTurnChain(1, 'partial answer')
  truncatedChain[truncatedChain.length - 1] = turnEnd(1, 1_750_000_020_000, { kind: 'max-tokens' })
  emit(harness.ctx, rootSession('session-truncated'), truncatedChain)
  await handle.queue.settle()

  assert.equal(sink.jobs.length, 1, 'error is off by default; max-tokens is on')
  assert.equal(sink.jobs[0]?.candidate.status, 'max-tokens')
})

test('the switchless termination kinds produce nothing even with every switch on', async () => {
  const sink = controllableSink()
  const harness = await mount({ notifyCompleted: true, notifyErrors: true, notifyMaxTokens: true }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  for (const [index, kind] of ['aborted', 'blocked', 'interrupted'].entries()) {
    const chain = healthyTurnChain(1, `${kind} answer`)
    chain[chain.length - 1] = turnEnd(1, 1_750_000_020_000 + index, { kind })
    emit(harness.ctx, rootSession(`session-${kind}`), chain)
  }
  await handle.queue.settle()
  assert.equal(sink.jobs.length, 0)
})

test('the debug sink records safe summaries and never the visible text', async () => {
  const harness = await mount({}, { logBufferSize: 2000 })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'a distinctive answer body'))
  await handle.queue.settle()

  const debugSink = handle.debugSink
  assert.ok(debugSink !== undefined, 'the default sink in the absence of a seam is the debug sink')
  const records = debugSink.records()
  assert.equal(records.length, 1)
  const record = records[0]
  assert.ok(record !== undefined)
  assert.equal(record.status, 'completed-clean')
  assert.equal(record.visibleTextLength, Array.from('a distinctive answer body').length)
  assert.equal(record.explicitToolErrorCount, 0)
  assert.equal(record.durationMs !== null, true)
  assert.ok(!JSON.stringify(record).includes('a distinctive answer body'), 'the sink records lengths, not text')
  assert.ok(!handle.logger.render().includes('a distinctive answer body'), 'and neither does the log')
})

test('a truncated body is marked as truncated on the job', async () => {
  const sink = controllableSink()
  const harness = await mount({ maxBodyChars: 1000 }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, 'x'.repeat(5000)))
  await handle.queue.settle()
  assert.equal(sink.jobs[0]?.truncated, true)
  assert.equal(sink.jobs[0]?.candidate.visibleTextLength, 5000, 'the candidate keeps the pre-truncation length')
})

test('TRUNC-05 the candidate length is measured before truncation', async () => {
  const sink = controllableSink()
  const harness = await mount({ maxBodyChars: 1000 }, { sink: sink.sink })
  const handle = harness.handle
  assert.ok(handle !== undefined)
  const long = '中'.repeat(2500)
  emit(harness.ctx, rootSession(), healthyTurnChain(1, long))
  await handle.queue.settle()
  const candidate = sink.jobs[0]?.candidate
  assert.ok(candidate !== undefined)
  assert.equal(candidate.visibleTextLength, 2500)
  assert.equal(Array.from(candidate.visibleText).length, 2500, 'the candidate text itself is not truncated')
})
