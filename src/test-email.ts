/**
 * The Web UI's test-email action, host half.
 *
 * A test message exists to answer one question — "does this deployment's SMTP
 * configuration actually deliver?" — so it must travel the *production* path
 * end to end: the same credential reference resolution, the same transport
 * construction, the same failure classification. {@link Deliverer} is that path,
 * already extracted for the notification sink; this module composes a subject
 * and a body for it and maps the outcome onto the wire.
 *
 * Nothing here reads a settings document. The caller resolves configuration
 * through the same effective-config binding the notification path uses, so a
 * test message sent from the Web UI exercises exactly the values a real
 * notification would.
 *
 * @module dsh-mail-notify/test-email
 */

import type { Deliverer } from './mailer.ts'
import type { PluginLogger } from './logger.ts'
import type { TestEmailValue } from './protocol.ts'
import type { ResolvedConfig, SendResult } from './types.ts'

/** The subject of a test message; fixed text, no user content. */
export const TEST_EMAIL_SUBJECT = '[DSH] dsh-mail-notify test message'

/**
 * Compose the test message body.
 *
 * The body carries the timestamp and the delivery facts an operator needs to
 * recognise the message, and nothing else. It deliberately does not echo the
 * SMTP host, the user name, or any part of the configuration: the point of the
 * test is that the message arrived, and a body that restated configuration
 * would put deployment details into a mail store for no diagnostic gain.
 *
 * @param now - the clock reading to stamp, in epoch milliseconds.
 * @returns the plain-text body.
 */
export function composeTestEmailBody(now: number): string {
  return [
    'This is a test message from dsh-mail-notify.',
    '',
    'It was sent from the DeepSeek Harness Web UI after a successful credential',
    'lookup and SMTP handshake, using the same path a real notification takes.',
    '',
    `Sent at: ${new Date(now).toISOString()}`,
    '',
    'No configuration value and no credential is included in this message.',
  ].join('\n')
}

/** Everything a delivery test needs, bound to the currently effective config. */
export interface TestEmailDeps {
  deliver: Deliverer
  config: ResolvedConfig
  logger: PluginLogger
  /** Clock, injectable for deterministic tests. */
  now?: () => number
}

/**
 * Send one test message through the production delivery path.
 *
 * Refusals that the mail path itself would classify are returned as values. The
 * one case decided here is a configuration that cannot address a message at
 * all, which is refused before the credential is read — a send that cannot
 * succeed must not consume a credential lookup.
 *
 * @param deps - the bound deliverer, the effective configuration, and the logger.
 * @returns the safe, browser-facing outcome.
 */
export async function sendTestEmail(deps: TestEmailDeps): Promise<TestEmailValue> {
  const { config, logger } = deps
  const recipients = config.smtp.to

  if (!config.smtpConfigured || recipients.length === 0) {
    logger.warn('test-email.refused', { reason: 'the effective configuration cannot address a message' })
    return {
      delivered: false,
      recipientCount: 0,
      category: 'config-incomplete',
      message:
        'the effective configuration has no usable SMTP section; fill in the SMTP host, user, sender, ' +
        'recipients, and credential reference, save, and try again',
    }
  }

  const now = deps.now ?? Date.now
  const result = await deps.deliver({
    to: recipients,
    subject: TEST_EMAIL_SUBJECT,
    text: composeTestEmailBody(now()),
    // The identifying projection for this path. It carries no message content
    // and no configured value beyond the reference name the mailer adds itself.
    log: { notificationKind: 'test-email' },
  })

  return toTestEmailValue(result, recipients.length)
}

/**
 * Project a send outcome onto the browser-facing result.
 *
 * @param result - the delivery outcome.
 * @param recipientCount - how many recipients the message was addressed to.
 * @returns the safe result.
 */
export function toTestEmailValue(result: SendResult, recipientCount: number): TestEmailValue {
  if (result.ok) return { delivered: true, recipientCount }
  return {
    delivered: false,
    recipientCount,
    category: result.category,
    message: result.message,
  }
}
