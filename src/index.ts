/**
 * Cordis plugin entry: assembly only.
 *
 * Nothing here dispatches events, reads `event.data`, classifies a turn, or
 * speaks SMTP. The module resolves configuration, builds the logger, queue,
 * sink, and handler, and registers exactly three listeners — two on
 * `session/event` and one on `session/disposed` — on the plugin's own fiber, so
 * unloading removes all three and stops the queue.
 *
 * ## Configuration is live
 *
 * `apply` resolves the effective configuration through
 * {@link bindEffectiveConfig} and mounts a runtime from it. When the DSH user
 * settings document changes, the binding fires and the runtime is torn down and
 * rebuilt from the new values — which is what makes a switch flipped in the Web
 * UI take effect without a restart.
 *
 * A configuration that cannot be acted on never replaces one that can: an
 * invalid edit is logged and reported to the Web UI, and the previous runtime
 * keeps running, so a half-typed SMTP block cannot silently stop notifications.
 * A switch that turns the plugin off does stand the runtime down, and says so.
 *
 * `credentials` and `timer` are deliberately absent from `inject`. Declaring
 * them would make them hard dependencies, and a profile that mounts neither
 * would never activate this plugin at all. Both are read with `ctx.get()` and an
 * `undefined` check instead, so a missing service produces a named, actionable
 * diagnostic at send time rather than a plugin that silently fails to load.
 * `settings` and `connection` are reached through scoped `ctx.inject` for the
 * same reason: each narrows behaviour when absent rather than preventing
 * activation.
 *
 * @module dsh-mail-notify
 */

import type { Context } from '@deepseek-ai/cordis'
// Declaration-merge import: `@deepseek-ai/dsh-session` augments Cordis' `Events`
// interface with `session/event` and `session/disposed`. Importing it for types
// only is what makes `ctx.on` accept those names, and it is also the only place
// this plugin touches a DSH type outside `runtime-adapter.ts`.
import type {} from '@deepseek-ai/dsh-session'
// Declaration-merge import: `@deepseek-ai/dsh-client-connection` augments
// Cordis' `Context` with `connection`, the endpoint registry this plugin
// publishes its two Web routes through.
import type {} from '@deepseek-ai/dsh-client-connection'
import { Config, resolveConfig, type ConfigValue } from './config.ts'
import { getCredentialProvider } from './credentials.ts'
import { createDebugSink, type DebugSink } from './debug-sink.ts'
import { createSessionHandlers, type SessionHandlers } from './event-handler.ts'
import { createLogger, type PluginLogger } from './logger.ts'
import { createDeliverer, createMailer } from './mailer.ts'
import { DedupeCache } from './notifier.ts'
import {
  STATUS_ENDPOINT,
  STATUS_ROUTE,
  TEST_EMAIL_ENDPOINT,
  TEST_EMAIL_ROUTE,
  type StatusValue,
} from './protocol.ts'
import { createMailQueue, defaultSleep, type MailQueue } from './queue.ts'
import type { SessionEventLike, SessionLike } from './runtime-adapter.ts'
import { bindEffectiveConfig } from './settings.ts'
import { sendTestEmail } from './test-email.ts'
import type { MailSink, Notification, ResolvedConfig } from './types.ts'
import type { TransportFactory } from './transport.ts'
import { createRouteHandler, failure, type RpcOutcome } from './web-rpc.ts'

/** Plugin display name; also the logger name and the patch row's `id`. */
export const name = 'dsh-mail-notify'

/**
 * Required services.
 *
 * Empty on purpose: every DSH interface this plugin uses is optional, and a
 * missing one narrows behaviour with a diagnostic instead of preventing
 * activation.
 */
export const inject: string[] = []

export { Config }

/** Test seams; production callers omit the argument entirely. */
export interface ApplyInternals {
  /** Replaces the whole sink; used by integration tests. */
  sink?: MailSink
  /**
   * Replaces the SMTP transport below the mailer.
   *
   * The default sink is the mailer, so this is the seam that keeps the suite
   * offline while still exercising the real render, credential, and classify
   * path; `sink` replaces that path wholesale.
   */
  transportFactory?: TransportFactory
  /**
   * Forces the network-free debug sink as the default sink.
   *
   * Only the debug sink's own test uses this: production must deliver mail, so
   * the fallback below is the mailer.
   */
  debugSink?: boolean
  /** Replaces the clock. */
  now?: () => number
  /** Replaces the backoff wait. */
  sleep?: (delayMs: number) => Promise<void>
  /** Extra records retained by the in-memory logger. */
  logBufferSize?: number
}

/** The live plugin instance, exposed for integration tests. */
export interface MailNotifyHandle {
  config: ResolvedConfig
  logger: PluginLogger
  queue: MailQueue
  dedupe: DedupeCache
  handlers: SessionHandlers
  /** Present only while the debug sink is in use (i.e. under test). */
  debugSink?: DebugSink
  /** Records and counters, for assertions. */
  counters(): Record<string, unknown>
}

/** The shape of the Cordis timer service this plugin uses. */
interface TimerLike {
  timeout(delayMs: number): Promise<void>
}

/** One mounted runtime: the live objects plus the way to release them. */
interface MountedRuntime {
  handle: MailNotifyHandle
  /** Releases the three listeners and disposes the queue. Idempotent. */
  teardown: () => Promise<void>
}

/**
 * Register the plugin on a context.
 *
 * @param ctx - the plugin's fiber context.
 * @param rawConfig - configuration already validated and defaulted by Cordis
 *   against the exported {@link Config} schema. It is the composition layer: the
 *   DSH user settings document overrides it once a settings provider is
 *   attached.
 * @param internals - test seams; omitted in production.
 * @returns the live instance when the plugin activated, or `undefined` when it
 *   refused to mount or was disabled.
 */
export function apply(ctx: Context, rawConfig?: ConfigValue, internals?: ApplyInternals): MailNotifyHandle | undefined {
  const entry = (rawConfig ?? {}) as ConfigValue

  // Read before anything else is built: `apply` runs with an active fiber, so
  // the timer service's own disposers attach to it and a backoff in progress
  // is cancelled on unload rather than outliving the plugin.
  const timer = readTimerService(ctx)
  const logger = createLogger(ctx.logger(name), internals?.logBufferSize ?? 500)
  const binding = bindEffectiveConfig(ctx, entry)

  let mounted: MountedRuntime | undefined
  /**
   * The effective configuration as last acted on.
   *
   * Kept outside {@link mounted} because a refused configuration still counts as
   * "seen": without it, every settings commit would re-log the same refusal.
   */
  let effective: ResolvedConfig | undefined
  let fingerprint: string | undefined

  /**
   * Re-read the effective configuration and mount, remount, or stand down.
   *
   * The comparison is structural over the *resolved* configuration, so a
   * settings commit that changes nothing this plugin reads does not disturb a
   * running queue.
   */
  const sync = (): void => {
    const { resolved } = resolveConfig(binding.current())
    const next = JSON.stringify(resolved)
    if (next === fingerprint) return

    if (!resolved.enabled) {
      // Short circuit before any resource exists. "Off" therefore means off in
      // behaviour as well as in resource use: no listener, no queue, no timer,
      // and no credential read. The single log line is what makes the difference
      // between "disabled" and "not working" observable.
      void release(mounted)
      mounted = undefined
      effective = resolved
      fingerprint = next
      logger.info('plugin.disabled', { reason: 'enabled is false' })
      return
    }

    if (resolved.errors.length > 0) {
      // Refuse to mount. There is no partial-activation mode: a message sent to
      // an unknown recipient is worse than no message. What is already running
      // keeps running — an edit that cannot be acted on must not silence a
      // working mail path — and the refusal is both logged and reported to the
      // Web UI, so a save that appears to do nothing has a visible reason.
      effective = resolved
      fingerprint = next
      logger.error('plugin.config-invalid', { errors: resolved.errors, warnings: resolved.warnings })
      return
    }

    void release(mounted)
    mounted = undefined
    effective = resolved
    fingerprint = next

    for (const warning of resolved.warnings) logger.warn('plugin.config-warning', { warning })

    mounted = startRuntime({ ctx, config: resolved, internals, logger, timer })
  }

  sync()

  // The settings binding is the only thing that can move the effective
  // configuration after activation, so it is also the only remount trigger.
  const unsubscribe = binding.subscribe(sync)

  /** The delivery path for the configuration currently in effect. */
  const makeDeliverer = (config: ResolvedConfig) =>
    createDeliverer({
      ctx,
      config,
      logger,
      // Passed as a lookup rather than a captured provider: the credential
      // service may be published after this plugin activates, and an early
      // `undefined` would disarm every later send.
      credentialProviderResolver: () => getCredentialProvider(ctx),
      ...(internals?.transportFactory !== undefined ? { transportFactory: internals.transportFactory } : {}),
    })

  /**
   * Answer a status read.
   *
   * @returns the plugin's live facts, with the queue block present only while a
   *   runtime is mounted.
   */
  const status = (): StatusValue => {
    const config = effective ?? resolveConfig(binding.current()).resolved
    const stats = mounted?.handle.queue.stats()
    return {
      active: mounted !== undefined,
      smtpConfigured: config.smtpConfigured,
      credentialRef: config.smtp.smtpPasswordCredential,
      ...(stats === undefined
        ? {}
        : {
            queue: {
              depth: stats.depth,
              size: config.queueSize,
              delivered: Math.max(0, stats.processed - stats.failed),
              failed: stats.failed,
            },
          }),
      ...(config.errors.length > 0 ? { configError: config.errors.join('; ') } : {}),
    }
  }

  /**
   * Route one decoded endpoint call.
   *
   * Both endpoints answer through the *currently effective* configuration rather
   * than through whatever was effective when the runtime mounted, so a delivery
   * test taken before a save and one taken after it cannot disagree with what a
   * notification would do.
   */
  const dispatch = async (method: string, payload: unknown): Promise<RpcOutcome<unknown>> => {
    void payload
    if (method === STATUS_ENDPOINT) return { ok: true, value: status() }
    if (method === TEST_EMAIL_ENDPOINT) {
      const config = effective ?? resolveConfig(binding.current()).resolved
      const value = await sendTestEmail({
        deliver: makeDeliverer(config),
        config,
        logger,
        ...(internals?.now !== undefined ? { now: internals.now } : {}),
      })
      return { ok: true, value }
    }
    // Unreachable through this plugin's own routes, which publish exactly the
    // two endpoints above. Answered rather than thrown so a future rename
    // surfaces as a refused call the card can render.
    return { ok: false, error: failure('not-found', `unknown endpoint ${method}`) }
  }

  const handler = createRouteHandler(dispatch)

  // The two endpoints are exact Fetch routes under the shared `/api` channel.
  // `intercept` on `/api` is single-occupant and already claimed by the Typert
  // gateway, and `rpc.handle` fails in this release; see the protocol module for
  // the full account of the three candidate contracts. An exact route is
  // consulted before the interceptor and still sits behind `/api`'s Host/Origin
  // trust fence and browser-session authentication, so it is neither unguarded
  // nor in anyone else's way.
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(
      () => {
        const disposers = [STATUS_ROUTE, TEST_EMAIL_ROUTE].map((path) =>
          connectionCtx.connection.fetch.register({
            path,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: handler,
          }),
        )
        return () => {
          for (const dispose of disposers) void dispose()
        }
      },
      'dsh-mail-notify: web configuration routes',
    )
  })

  ctx.effect(
    () => () => {
      unsubscribe()
      return release(mounted)
    },
    'dsh-mail-notify teardown',
  )

  return mounted?.handle
}

/** Everything {@link startRuntime} needs to build one mounted runtime. */
interface StartRuntimeInput {
  ctx: Context
  config: ResolvedConfig
  internals: ApplyInternals | undefined
  logger: PluginLogger
  timer: TimerLike | undefined
}

/**
 * Build the listeners, queue, and sink for one resolved configuration.
 *
 * Split out of {@link apply} so that a settings change can rebuild exactly this
 * and nothing else: the logger's buffer and the settings binding outlive it.
 *
 * @param input - context, configuration, test seams, logger, and timer.
 * @returns the mounted runtime, including its teardown.
 */
function startRuntime(input: StartRuntimeInput): MountedRuntime {
  const { ctx, config, internals, logger, timer } = input

  // The production path is the mailer: an injected sink replaces it wholesale,
  // and `debugSink` forces the network-free double for the suite. Anything else
  // must really deliver, because a sink that only answers `{ok: true}` would
  // make an unmounted mail path indistinguishable from a delivered message.
  const debugSink = internals?.sink === undefined && internals?.debugSink === true ? createDebugSink(logger) : undefined
  const sink: MailSink =
    internals?.sink ??
    (debugSink?.sink ??
      createMailer({
        ctx,
        config,
        logger,
        // Passed as a lookup rather than a captured provider: at this point in
        // activation the credential service may not be published yet, and an
        // early `undefined` would disarm every later send.
        credentialProviderResolver: () => getCredentialProvider(ctx),
        ...(internals?.transportFactory !== undefined ? { transportFactory: internals.transportFactory } : {}),
      }))

  const queue = createMailQueue({
    size: config.queueSize,
    sink,
    policy: config.retry,
    sleep: internals?.sleep ?? (timer === undefined ? defaultSleep : (delayMs) => timer.timeout(delayMs)),
    onOutcome: (outcome) => {
      const { job, result, attempts, failure, delaysMs } = outcome
      const fields: Record<string, unknown> = {
        ...identify(job.notification),
        attempts,
        ok: result.ok,
        delaysMs: [...delaysMs],
      }
      if (!result.ok) {
        fields.category = result.category
        fields.retryClass = result.class
        fields.message = failure?.message ?? result.message
      }
      logger.info('notification.outcome', fields)
    },
    onDropped: (job, depth) => {
      logger.warn('queue.rejected', {
        ...identify(job.notification),
        queueDepth: depth,
        queueSize: config.queueSize,
      })
    },
  })

  const dedupe = new DedupeCache(config.maxDedupeEntries)

  const handlers = createSessionHandlers({
    config,
    logger,
    queue,
    dedupe,
    ...(internals?.now !== undefined ? { now: internals.now } : {}),
  })

  const offSessionEvent = ctx.on('session/event', (session: SessionLike, event: SessionEventLike) => {
    // Synchronous by contract; see the module docblock.
    handlers.onSessionEvent(session, event)
  })

  const offSessionDisposed = ctx.on('session/disposed', (session: SessionLike) => {
    handlers.onSessionDisposed(session)
  })

  // A second listener rather than a branch inside the first, because the two
  // registrations answer different questions: the one above maintains turn state
  // for every event, while this one observes exactly one durable audit type.
  // Keeping them apart makes the approval path visible at the registration site
  // — and note which event is observed. `approval/asked` is a log-only audit
  // record; the `approval/request` waterfall owns the answer and is deliberately
  // not registered here (§11, §20).
  //
  // The cast is the same boundary the turn listener crosses, stated explicitly:
  // the plugin's own structural view of a session event is deliberately narrower
  // than DSH's declaration, so the registration function is typed against the
  // structural signature and the runtime passes the real event through. Nothing
  // in the body reads a field the structural view does not declare.
  const onApprovalEvent = ((session: SessionLike, event: SessionEventLike): void => {
    // Synchronous by contract, exactly like the turn listener above: the handler
    // enqueues and returns, and never awaits SMTP on the append path.
    if (event?.type !== 'approval/asked') return
    handlers.onApprovalAsked(session, event.data)
  }) as unknown as (session: unknown, event: unknown) => void
  const offApprovalEvent = ctx.on('session/event', onApprovalEvent)

  logger.info('plugin.ready', {
    includeSubagents: config.policy.includeSubagents,
    notifyCompleted: config.policy.notifyCompleted,
    notifyErrors: config.policy.notifyErrors,
    notifyMaxTokens: config.policy.notifyMaxTokens,
    notifyQuestions: config.policy.notifyQuestions,
    notifyApprovals: config.policy.notifyApprovals,
    minTurnDurationMs: config.policy.minTurnDurationMs,
    maxBodyChars: config.render.maxBodyChars,
    includeMetadata: config.render.includeMetadata,
    includeUserPrompt: config.render.includeUserPrompt,
    includeFooter: config.render.includeFooter,
    queueSize: config.queueSize,
    retryAttempts: config.retry.retryAttempts,
    retryBaseDelayMs: config.retry.retryBaseDelayMs,
    maxDedupeEntries: config.maxDedupeEntries,
    smtpHost: config.smtp.smtpHost,
    smtpPort: config.smtp.smtpPort,
    smtpSecure: config.smtp.smtpSecure,
    credentialRef: config.smtp.smtpPasswordCredential,
    recipientCount: config.smtp.to.length,
    timerService: timer !== undefined,
  })

  const handle: MailNotifyHandle = {
    config,
    logger,
    queue,
    dedupe,
    handlers,
    ...(debugSink !== undefined ? { debugSink } : {}),
    counters: () => ({
      ...queue.stats(),
      dedupeEntries: dedupe.size,
      state: handlers.stateSizes(),
      logLines: logger.emitted,
    }),
  }

  let released = false

  return {
    handle,
    teardown: async () => {
      if (released) return
      released = true
      // Order is deliberate. The handler is cleared first so no further job can
      // be produced, then the listeners go, then the queue is disposed so the
      // in-flight send settles and the dedupe cache and turn map are released.
      handlers.clear()
      dedupe.clear()
      offSessionEvent()
      offSessionDisposed()
      offApprovalEvent()
      await queue.dispose()
    },
  }
}

/**
 * Release a mounted runtime, tolerating its absence.
 *
 * @param runtime - the runtime to release, or `undefined`.
 * @returns settlement after the runtime reached quiescence.
 */
function release(runtime: MountedRuntime | undefined): Promise<void> {
  return runtime === undefined ? Promise.resolve() : runtime.teardown()
}

/**
 * The log scalars that identify a notification, per family.
 *
 * A question's text and an approval's reason never appear: the log records which
 * notification was produced, not what it said.
 *
 * @param notification - the delivered notification.
 * @returns fields safe to log.
 */
function identify(notification: Notification): Record<string, unknown> {
  if (notification.kind === 'turn') {
    return {
      notificationKind: 'turn',
      sessionId: notification.candidate.sessionId,
      turn: notification.candidate.turn,
      status: notification.candidate.status,
    }
  }
  if (notification.kind === 'question') {
    return {
      notificationKind: 'question',
      sessionId: notification.sessionId,
      turn: notification.turn ?? null,
      questionCount: notification.questions.length,
    }
  }
  return {
    notificationKind: 'approval',
    sessionId: notification.sessionId,
    toolName: notification.toolName,
  }
}

/**
 * Read the optional timer service.
 *
 * @param ctx - the plugin context.
 * @returns the service, or `undefined` when this profile mounts none.
 */
function readTimerService(ctx: Context): TimerLike | undefined {
  let candidate: unknown
  try {
    candidate = ctx.get('timer')
  } catch {
    return undefined
  }
  if (candidate === null || typeof candidate !== 'object') return undefined
  const timer = candidate as Partial<TimerLike>
  return typeof timer.timeout === 'function' ? (timer as TimerLike) : undefined
}
