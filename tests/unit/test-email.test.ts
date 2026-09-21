/**
 * Unit tests for the Web UI's test-email action.
 *
 * The action exists to answer "does this deployment's SMTP configuration
 * actually deliver?", so what is asserted here is that it composes a message
 * from the *effective* configuration, refuses before reading a credential when
 * no message can be addressed, and reports an outcome that carries no secret.
 *
 * @module dsh-mail-notify/tests/unit/test-email
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLogger } from '../../src/logger.ts'
import { composeTestEmailBody, sendTestEmail, toTestEmailValue, TEST_EMAIL_SUBJECT } from '../../src/test-email.ts'
import type { DeliveryRequest, Deliverer } from '../../src/mailer.ts'
import type { SendResult } from '../../src/types.ts'
import { VALID_RAW_CONFIG } from '../support/harness.ts'
import { resolveConfig } from '../../src/config.ts'

/** Build a logger that writes nowhere. */
function quietLogger(): ReturnType<typeof createLogger> {
  return createLogger()
}

/** A deliverer that records what it was asked to send. */
function recordingDeliverer(result: SendResult): { deliver: Deliverer; requests: DeliveryRequest[] } {
  const requests: DeliveryRequest[] = []
  return {
    requests,
    deliver: (request) => {
      requests.push(request)
      return Promise.resolve(result)
    },
  }
}

test('TST-01 the production configuration is addressed through the real deliverer', async () => {
  const { resolved } = resolveConfig({ ...VALID_RAW_CONFIG })
  const { deliver, requests } = recordingDeliverer({ ok: true })
  const outcome = await sendTestEmail({ deliver, config: resolved, logger: quietLogger(), now: () => 0 })

  assert.deepEqual(outcome, { delivered: true, recipientCount: resolved.smtp.to.length })
  assert.equal(requests.length, 1)
  const request = requests[0]
  assert.ok(request !== undefined)
  assert.equal(request.subject, TEST_EMAIL_SUBJECT)
  assert.deepEqual([...request.to], [...resolved.smtp.to])
  // The identifying projection names the family and carries nothing else, so a
  // test message is distinguishable in the log without any message content.
  assert.deepEqual(request.log, { notificationKind: 'test-email' })
})

test('TST-02 an unusable configuration is refused before the credential is read', async () => {
  const { resolved } = resolveConfig({ ...VALID_RAW_CONFIG, to: [] })
  const { deliver, requests } = recordingDeliverer({ ok: true })
  const outcome = await sendTestEmail({ deliver, config: resolved, logger: quietLogger() })

  assert.equal(outcome.delivered, false)
  assert.equal(outcome.category, 'config-incomplete')
  assert.equal(outcome.recipientCount, 0)
  // A send that cannot be addressed must not consume a credential lookup: that
  // is the whole reason the refusal is decided here rather than in the mailer.
  assert.deepEqual(requests, [])
})

test('TST-03 a failed send reports the mailer classification, not a new one', async () => {
  const { resolved } = resolveConfig({ ...VALID_RAW_CONFIG })
  const { deliver } = recordingDeliverer({
    ok: false,
    class: 'permanent',
    category: 'authentication',
    message: '535 authentication failed',
  })
  const outcome = await sendTestEmail({ deliver, config: resolved, logger: quietLogger() })
  assert.deepEqual(outcome, {
    delivered: false,
    recipientCount: resolved.smtp.to.length,
    category: 'authentication',
    message: '535 authentication failed',
  })
})

test('TST-04 the projection carries no field a secret could occupy', () => {
  const sent = toTestEmailValue({ ok: true }, 3)
  assert.deepEqual(Object.keys(sent).sort(), ['delivered', 'recipientCount'])
  const failedValue = toTestEmailValue({ ok: false, class: 'retry', category: 'c', message: 'm' }, 0)
  assert.deepEqual(Object.keys(failedValue).sort(), ['category', 'delivered', 'message', 'recipientCount'])
})

test('TST-05 the body is fixed text, stamps the clock, and restates no configuration', () => {
  const body = composeTestEmailBody(0)
  assert.ok(body.includes('1970-01-01T00:00:00.000Z'), 'the body must carry the clock it was given')
  assert.ok(body.includes('No configuration value and no credential is included in this message.'))
  for (const leaked of ['smtp.', '@', 'password']) {
    assert.equal(body.toLowerCase().includes(leaked), false, `the body must not mention ${leaked}`)
  }
})
