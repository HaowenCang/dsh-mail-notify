/**
 * Cordis plugin entry: assembly only.
 *
 * Nothing here dispatches events, reads `event.data`, classifies a turn, or
 * speaks SMTP. The module resolves configuration, builds the logger, queue,
 * sink, and handler, and registers exactly two listeners — `session/event` and
 * `session/disposed` — on the plugin's own fiber, so unloading removes both and
 * stops the queue.
 *
 * `credentials` and `timer` are deliberately absent from `inject`. Declaring
 * them would make them hard dependencies, and a profile that mounts neither
 * would never activate this plugin at all. Both are read with `ctx.get()` and
 * an `undefined` check instead, so a missing service produces a named,
 * actionable diagnostic at send time rather than a plugin that silently fails
 * to load.
 *
 * @module dsh-mail-notify
 */

import type { Context } from '@deepseek-ai/cordis'
// Declaration-merge import: `@deepseek-ai/dsh-session` augments Cordis' `Events`
// interface with `session/event` and `session/disposed`. Importing it for types
// only is what makes `ctx.on` accept those names, and it is also the only place
// this plugin touches a DSH type outside `runtime-adapter.ts`.
import type {} from '@deepseek-ai/dsh-session'
import { Config, resolveConfig, type ConfigValue } from './config.ts'
import { getCredentialProvider } from './credentials.ts'
import { createDebugSink, type DebugSink } from './debug-sink.ts'
import { createSessionHandlers, type SessionHandlers } from './event-handler.ts'
import { createLogger, type PluginLogger } from './logger.ts'
import { createMailer } from './mailer.ts'
import { DedupeCache } from './notifier.ts'
import { createMailQueue, defaultSleep, type MailQueue } from './queue.ts'
import type { SessionEventLike, SessionLike } from './runtime-adapter.ts'
import type { MailSink, ResolvedConfig } from './types.ts'
import type { TransportFactory } from './transport.ts'

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

/**
 * Register the plugin on a context.
 *
 * @param ctx - the plugin's fiber context.
 * @param rawConfig - configuration already validated and defaulted by Cordis
 *   against the exported {@link Config} schema.
 * @param internals - test seams; omitted in production.
 * @returns the live instance when the plugin activated, or `undefined` when it
 *   refused to mount or was disabled.
 */
export function apply(ctx: Context, rawConfig?: ConfigValue, internals?: ApplyInternals): MailNotifyHandle | undefined {
  const { resolved: config, errors, warnings } = resolveConfig(rawConfig)

  // Read before anything else is built: `apply` runs with an active fiber, so
  // the timer service's own disposers attach to it and a backoff in progress
  // is cancelled on unload rather than outliving the plugin.
  const timer = readTimerService(ctx)
  const logger = createLogger(ctx.logger(name), internals?.logBufferSize ?? 500)

  if (!config.enabled) {
    // Short circuit before any resource exists. "Off" therefore means off in
    // behaviour as well as in resource use: no listener, no queue, no timer,
    // and no credential read. The single log line is what makes the difference
    // between "disabled" and "not working" observable.
    logger.info('plugin.disabled', { reason: 'enabled is false' })
    return undefined
  }

  if (errors.length > 0) {
    logger.error('plugin.config-invalid', { errors, warnings })
    // Refuse to mount. There is no partial-activation mode: a message sent to
    // an unknown recipient is worse than no message.
    return undefined
  }

  for (const warning of warnings) logger.warn('plugin.config-warning', { warning })

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
        sessionId: job.candidate.sessionId,
        turn: job.candidate.turn,
        status: job.candidate.status,
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
        sessionId: job.candidate.sessionId,
        turn: job.candidate.turn,
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

  ctx.on('session/event', (session: SessionLike, event: SessionEventLike) => {
    // Synchronous by contract; see the module docblock.
    handlers.onSessionEvent(session, event)
  })

  ctx.on('session/disposed', (session: SessionLike) => {
    handlers.onSessionDisposed(session)
  })

  ctx.effect(
    () => () => {
      // Order is deliberate. The handler is cleared first so no further job can
      // be produced, then the queue is disposed so the in-flight send settles
      // and the dedupe cache and turn map are released.
      handlers.clear()
      dedupe.clear()
      return queue.dispose()
    },
    'dsh-mail-notify teardown',
  )

  logger.info('plugin.ready', {
    includeSubagents: config.policy.includeSubagents,
    notifyCompleted: config.policy.notifyCompleted,
    notifyErrors: config.policy.notifyErrors,
    notifyMaxTokens: config.policy.notifyMaxTokens,
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

  return handle
}

/** The shape of the Cordis timer service this plugin uses. */
interface TimerLike {
  timeout(delayMs: number): Promise<void>
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
