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
import type { PluginLogger } from './logger.ts'
import { classifyError, permanentFailure } from './retry.ts'
import { renderMail } from './subject.ts'
import { createSmtpTransport, type TransportFactory } from './transport.ts'
import type { MailJob, MailSink, ResolvedConfig, SendResult } from './types.ts'

/** Dependencies the mailer needs; all injectable so tests bind doubles. */
export interface MailerOptions {
  ctx: ContextServices
  config: ResolvedConfig
  logger: PluginLogger
  /** Transport construction; replaced by a stub in tests. */
  transportFactory?: TransportFactory
  /** Credential service override; tests inject a fake without a context. */
  credentialProvider?: CredentialProviderLike | undefined
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
  // The provider is resolved once because it is a service handle; the *value*
  // it returns is resolved inside every attempt below and never retained.
  const provider =
    'credentialProvider' in options
      ? options.credentialProvider
      : getCredentialProvider(options.ctx)

  return async function send(job: MailJob): Promise<SendResult> {
    const rendered = renderMail({ candidate: job.candidate, render: config.render, truncated: job.truncated })

    logger.debug('mail.render', {
      sessionId: job.candidate.sessionId,
      turn: job.candidate.turn,
      status: job.candidate.status,
      subjectLength: Array.from(rendered.subject).length,
      bodyChars: rendered.bodyTextLength,
      recipientCount: job.to.length,
      truncated: job.truncated,
    })

    const credential = await resolveSmtpPassword(provider, config.smtp.smtpPasswordCredential)
    if (credential.value === undefined) {
      // A reference that does not resolve is permanent by definition: repeating
      // the attempt cannot create a stored secret. No retry, and the diagnostic
      // names the reference without ever reading its value.
      const failure = permanentFailure('credential-missing', credential.message ?? 'the credential was not resolved')
      logger.warn('mail.credential-missing', {
        sessionId: job.candidate.sessionId,
        turn: job.candidate.turn,
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
        sessionId: job.candidate.sessionId,
        turn: job.candidate.turn,
        status: job.candidate.status,
        bodyChars: rendered.bodyTextLength,
        recipientCount: job.to.length,
      })
      return { ok: true }
    } catch (error) {
      const failure = classifyError(error)
      logger.warn('mail.failed', {
        sessionId: job.candidate.sessionId,
        turn: job.candidate.turn,
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
