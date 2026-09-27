/**
 * The mounted-plugin harness shared by the integration suites.
 *
 * The plugin is mounted through a real Cordis context and driven with real
 * `ctx.emit('session/event', …)` dispatches, so listener registration, service
 * lookup, configuration validation, and fiber disposal all take the production
 * path. Only the two environment services are replaced: a fake Credential
 * provider and a fake timer. No socket is opened and no credential exists.
 *
 * The harness lives here rather than in one suite because a second suite that
 * re-implemented it could pass while the production path behaved differently —
 * the same reason `support/harness.ts` builds its configuration through the real
 * `resolveConfig`.
 *
 * @module dsh-mail-notify/tests/support/plugin-harness
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import * as plugin from '../../src/index.ts'
import type { CredentialInfo, CredentialProviderLike, CredentialRef, ResolvedCredential } from '../../src/credentials.ts'
import type { ApplyInternals, MailNotifyHandle } from '../../src/index.ts'
import type { ConfigValue } from '../../src/config.ts'
import type { SessionEventLike, SessionLike } from '../../src/runtime-adapter.ts'
import type { MailJob, SendResult } from '../../src/types.ts'
import { VALID_RAW_CONFIG } from './harness.ts'

/** The fake credential store, deliberately holding a synthetic value only. */
export class FakeCredentials implements CredentialProviderLike {
  value: string | undefined = 'SMTP_PASSWORD_SENTINEL-not-a-real-password'
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
export class CredentialsService extends Service {
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
export class TimerService extends Service {
  static delays: number[] = []

  constructor(ctx: Context) {
    super(ctx, 'timer')
  }

  timeout(delayMs: number): Promise<void> {
    TimerService.delays.push(delayMs)
    return Promise.resolve()
  }
}

/** The mounted harness returned by {@link mountPlugin}. */
export interface PluginHarness {
  ctx: Context
  /** Absent when the plugin refused to mount. */
  handle: MailNotifyHandle | undefined
  credentials: FakeCredentials
  dispose: () => Promise<void>
  /**
   * Commit a new configuration the way the Loader does, and signal it.
   *
   * This is not a shortcut around the seam under test — it *is* the seam. The
   * Loader resolves the candidate through the plugin's own schema, copies each
   * changed reference's value into the running fiber's reference, and then emits
   * `loader/volatile-update`. Skipping any of the three would test a plugin that
   * reacts to something the real Loader never does.
   *
   * The candidate is resolved first, so an invalid configuration throws here
   * exactly as it would abort a Host write — which is what lets the lifecycle
   * tests assert that a refused write leaves the running runtime alone.
   *
   * @param next - raw configuration fields, merged over the currently mounted ones.
   */
  reconfigure: (next: Record<string, unknown>) => void
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
export async function mountPlugin(
  overrides: Record<string, unknown> = {},
  internals: ApplyInternals = {},
  options: { credentials?: boolean } = {},
): Promise<PluginHarness> {
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
  //
  // The configuration is resolved through the plugin's own schema first, because
  // that is what Cordis does before it calls `apply`: `Config(raw)` is what turns
  // a document into the tree of `Volatile` references `apply` is typed against.
  // Handing `apply` the raw object instead would compile — `ConfigValue` is an
  // object type — and then fail at the first `.get()`, which is exactly the
  // mistake this resolution step exists to prevent.
  const config: ConfigValue = plugin.Config({ ...VALID_RAW_CONFIG, ...overrides } as never)
  const child = ctx.extend()
  const handle = plugin.apply(child as never, config, {
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
    reconfigure: (next) => {
      const candidate = plugin.Config({ ...VALID_RAW_CONFIG, ...overrides, ...next } as never)
      commitVolatile(config, candidate)
      ctx.emit('loader/volatile-update', [])
    },
    listenerNames: () => Object.keys(hooks()).filter((entry) => !entry.startsWith('internal/')),
    listenersFor: (name: string) =>
      (hooks()[name] ?? [])
        .map((record) => record.callback)
        .filter((callback): callback is (...args: never[]) => unknown => typeof callback === 'function'),
  }
}

/** The shared volatile-reference protocol `@deepseek-ai/cosmokit` installs. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Copy every changed reference from `source` into `target`.
 *
 * The traversal mirrors the Loader's own: references are leaves, and neither
 * side is descended into beyond them. The write symbol is reached through
 * `Symbol.for` rather than by importing `cosmokit` deliberately — that library
 * is a transitive dependency of the schema validator, not a declared dependency
 * of this plugin, and a test that imported it would make an undeclared edge look
 * supported. `tests/compatibility/contracts.compile.ts` asserts the symbol
 * protocol itself, so a change upstream fails a compile rather than turning the
 * live-update tests into tests of nothing.
 *
 * @param target - the running configuration's reference tree.
 * @param source - the newly resolved candidate tree.
 */
export function commitVolatile(target: unknown, source: unknown): void {
  if (target === null || typeof target !== 'object') return
  const write = (target as Record<symbol, unknown>)[VOLATILE_WRITE]
  if (typeof write === 'function') {
    const read = (source as { get?: () => unknown }).get
    if (typeof read !== 'function') throw new TypeError('volatile candidate carries no get()')
    ;(write as (this: unknown, value: unknown) => void).call(target, read.call(source))
    return
  }
  for (const [key, value] of Object.entries(target)) {
    commitVolatile(value, (source as Record<string, unknown>)[key])
  }
}

/** Build a sink that records the jobs it received and can be made to fail. */
export function controllableSink(failures: SendResult[] = []): {
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
export function emit(ctx: Context, session: SessionLike, events: readonly SessionEventLike[]): void {
  for (const event of events) ctx.emit('session/event', session as never, event as never)
}

/** Dispatch `session/disposed` for a structural session stand-in. */
export function emitDisposed(ctx: Context, session: SessionLike): void {
  ctx.emit('session/disposed', session as never)
}
