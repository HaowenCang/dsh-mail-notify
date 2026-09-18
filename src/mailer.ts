/**
 * Rendered job to delivered message.
 *
 * The mailer is deliberately the only module that creates a transport, and it
 * creates a fresh one for every send attempt after resolving the credential
 * inside that attempt. Reusing a transport across attempts would mean holding a
 * resolved password in a long-lived object, which is precisely what the
 * Credential service's per-call contract exists to avoid.
 *
 * Failures come back as values, never as rejections: a rejected promise on this
 * path would be a background rejection the plugin could not classify, log, or
 * count. Classification itself lives in `retry.ts`; this module only decides
 * which failures never reach the network at all.
 *
 * @module dsh-mail-notify/mailer
 */

import { resolveSmtpPassword, type CredentialProviderLike, type ContextServices } from './credentials.ts'
import { getCredentialProvider } from './credentials.ts'
import { truncateVisibleText } from './content.ts'
import type { PluginLogger } from './logger.ts'
import { classifyError, permanentFailure } from './retry.ts'
import { renderMail } from './subject.ts'
import { createSmtpTransport, type TransportFactory } from './transport.ts'
import type { MailJob, MailSink, Notification, ResolvedConfig, SendResult } from './types.ts'

/** Dependencies the mailer needs; all injectable so tests bind doubles. */
export interface MailerOptions {
  ctx: ContextServices
  config: ResolvedConfig
  logger: PluginLogger
  /** Transport construction; replaced by a stub in tests. */
  transportFactory?: TransportFactory
  /** Credential service override; tests inject a fake without a context. */
  credentialProvider?: CredentialProviderLike | undefined
  /**
   * Late credential lookup, used when no provider is bound.
   *
   * Reading the service once here — at `apply()` — is early: activation order
   * gives a plugin no guarantee that a service mounted later in the same tree is
   * published yet, and an early `undefined` would disarm every later send. The
   * production assembly therefore passes the lookup itself.
   */
  credentialProviderResolver?: () => CredentialProviderLike | undefined
}

/** Maximum characters of a failure message that reach a log line. */
const FAILURE_MESSAGE_LIMIT = 500

/**
 * Collapse a failure into a single bounded line.
 *
 * SMTP reply text is external input. Written verbatim into a line-oriented log
 * it could forge additional log lines, so control characters are removed and
 * the length is capped.
 *
 * @param value - the raw message.
 * @returns a single-line, bounded string.
 */
function oneLine(value: string): string {
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  const points = Array.from(flat)
  return points.length <= FAILURE_MESSAGE_LIMIT ? flat : `${points.slice(0, FAILURE_MESSAGE_LIMIT).join('')}…`
}

/**
 * Build the sink that renders and delivers one job.
 *
 * @param options - context, resolved configuration, logger, and test seams.
 * @returns the send function; it never rejects.
 */
export function createMailer(options: MailerOptions): MailSink {
  const transportFactory = options.transportFactory ?? createSmtpTransport
  const { config, logger } = options
  // A bound provider is what tests use. Otherwise the service is looked up on
  // every attempt rather than captured now: it is a service *handle*, while the
  // value behind the reference is resolved per attempt and never retained.
  const resolveProvider =
    'credentialProvider' in options
      ? () => options.credentialProvider
      : (options.credentialProviderResolver ?? (() => getCredentialProvider(options.ctx)))

  return async function send(job: MailJob): Promise<SendResult> {
    const provider = resolveProvider()
    // The cap is applied here, once, and its own answer is what marks the job:
    // rendering the full text while claiming truncation would let an unbounded
    // model answer through under a marker that says it was bounded.
    //
    // Only a turn notification has an unbounded body. A human-attention
    // notification was already bounded by the parser at the point where its
    // fields were allowlisted, so applying `maxBodyChars` to it would mean
    // re-truncating text that is by construction already inside the bound.
    const notification = renderNotification(job, config)
    const rendered = renderMail({
      notification: notification.value,
      render: config.render,
      truncated: notification.truncated,
    })

    logger.debug('mail.render', {
      ...logFieldsFor(job),
      subjectLength: Array.from(rendered.subject).length,
      bodyChars: rendered.bodyTextLength,
      recipientCount: job.to.length,
      truncated: notification.truncated,
    })

    const credential = await resolveSmtpPassword(provider, config.smtp.smtpPasswordCredential)
    if (credential.value === undefined) {
      // A reference that does not resolve is permanent by definition: repeating
      // the attempt cannot create a stored secret. No retry, and the diagnostic
      // names the reference without ever reading its value.
      const failure = permanentFailure('credential-missing', credential.message ?? 'the credential was not resolved')
      logger.warn('mail.credential-missing', {
        ...logFieldsFor(job),
        credentialRef: config.smtp.smtpPasswordCredential,
        category: failure.category,
        message: failure.message,
      })
      return { ok: false, class: failure.retryClass, category: failure.category, message: failure.message }
    }

    const transport = transportFactory({
      host: config.smtp.smtpHost,
      port: config.smtp.smtpPort,
      secure: config.smtp.smtpSecure,
      user: config.smtp.smtpUser,
      password: credential.value,
    })

    try {
      await transport.sendMail({
        from: config.smtp.from,
        to: job.to,
        subject: rendered.subject,
        text: rendered.text,
      })
      logger.info('mail.sent', {
        ...logFieldsFor(job),
        bodyChars: rendered.bodyTextLength,
        recipientCount: job.to.length,
      })
      return { ok: true }
    } catch (error) {
      const failure = classifyError(error)
      logger.warn('mail.failed', {
        ...logFieldsFor(job),
        category: failure.category,
        retryClass: failure.retryClass,
        code: failure.code ?? null,
        responseCode: failure.responseCode ?? null,
        message: oneLine(failure.message),
      })
      return { ok: false, class: failure.retryClass, category: failure.category, message: oneLine(failure.message) }
    }
  }
}

/**
 * The log scalars identifying one job, per notification family.
 *
 * A question's text and an approval's reason are never among them: they are the
 * body, and the log records only which notification was sent and for what
 * session, turn, or tool.
 *
 * @param job - the job being delivered.
 * @returns the log fields, without any notification body content.
 */
function logFieldsFor(job: MailJob): Record<string, unknown> {
  const notification = job.notification
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
      step: notification.step ?? null,
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
 * Apply the body cap to a notification, or leave it alone.
 *
 * @param job - the job being delivered.
 * @param config - the resolved configuration.
 * @returns the notification to render and whether its visible text was cut.
 */
function renderNotification(job: MailJob, config: ResolvedConfig): { value: Notification; truncated: boolean } {
  if (job.notification.kind !== 'turn') return { value: job.notification, truncated: false }
  const bounded = truncateVisibleText(job.notification.candidate.visibleText, config.render.maxBodyChars)
  return {
    value: { kind: 'turn', candidate: { ...job.notification.candidate, visibleText: bounded.text } },
    truncated: bounded.truncated,
  }
}
