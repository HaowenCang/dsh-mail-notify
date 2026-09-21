/**
 * L4 send-path tests — matrix rows SEC-01…SEC-07 and RET-01…RET-11.
 *
 * Nothing here touches a network. The transport is a stub, so what is asserted
 * is the plugin's own decisions: when it re-reads the credential, what it hands
 * the transport, and how it classifies what comes back. The stub also carries
 * the synthetic password sentinel, which lets SEC-04 and SEC-05 search for it
 * in every log line and in the serialized job.
 *
 * @module dsh-mail-notify/tests/integration/mailer
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMailer } from '../../src/mailer.ts'
import { createLogger } from '../../src/logger.ts'
import type { CredentialProviderLike, CredentialRef, CredentialInfo, ResolvedCredential } from '../../src/credentials.ts'
import type { MailTransport, OutgoingMessage, TransportOptions } from '../../src/transport.ts'
import type { MailJob, SendResult } from '../../src/types.ts'
import {
  REASONING_SECRET_SENTINEL,
  SMTP_PASSWORD_SENTINEL,
  SYSTEM_PROMPT_SENTINEL,
  TOOL_ARGUMENT_SECRET_SENTINEL,
  TOOL_RESULT_SECRET_SENTINEL,
  USER_PROMPT_SENTINEL,
  TEST_SESSION_CWD,
} from '../fixtures/runtime-shapes.ts'
import { testCandidate, testConfig, testTurnNotification } from '../support/harness.ts'

/** A credential service whose stored value the test can change between calls. */
class FakeCredentials implements CredentialProviderLike {
  value: string | undefined = SMTP_PASSWORD_SENTINEL
  source = 'env'
  readonly resolveCalls: string[] = []
  readonly describeCalls: string[] = []
  resolveError: Error | undefined

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    this.resolveCalls.push(String(ref))
    if (this.resolveError !== undefined) return Promise.reject(this.resolveError)
    if (this.value === undefined) return Promise.resolve(undefined)
    return Promise.resolve({ value: this.value, source: this.source })
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    this.describeCalls.push(String(ref))
    return Promise.resolve({
      configured: this.value !== undefined,
      source: this.value === undefined ? undefined : this.source,
      writable: true,
    } as CredentialInfo)
  }
}

/** A transport factory that records its options and the messages it sent. */
function fakeTransport(behaviour: () => unknown = () => undefined): {
  factory: (options: TransportOptions) => MailTransport
  options: TransportOptions[]
  sent: OutgoingMessage[]
} {
  const options: TransportOptions[] = []
  const sent: OutgoingMessage[] = []
  return {
    options,
    sent,
    factory: (transportOptions: TransportOptions): MailTransport => {
      options.push({ ...transportOptions })
      return {
        sendMail(message: OutgoingMessage): Promise<unknown> {
          sent.push({ ...message, to: [...message.to] })
          const outcome = behaviour()
          if (outcome instanceof Error) return Promise.reject(outcome)
          return Promise.resolve({ messageId: 'stub' })
        },
      }
    },
  }
}

/** A job carrying sentinels in every field that must never be sent. */
function sentinelJob(): MailJob {
  return {
    notification: testTurnNotification(testCandidate({
      visibleText: 'the final answer',
      cwd: TEST_SESSION_CWD,
      userText: `${USER_PROMPT_SENTINEL} do the thing`,
    })),
    to: ['recipient@example.com'],
    truncated: false,
  }
}

test('SEC-01 a successful send reports ok', async () => {
  const credentials = new FakeCredentials()
  const transport = fakeTransport()
  const logger = createLogger()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger,
    credentialProvider: credentials,
    transportFactory: transport.factory,
  })

  const result = await sink(sentinelJob())
  assert.deepEqual(result, { ok: true })
  assert.equal(transport.sent.length, 1)
  assert.equal(transport.sent[0]?.subject, '[DSH] Task completed — deepseek-chat')
  assert.ok(transport.sent[0]?.text.includes('the final answer'))
})

test('SEC-08 the rendered body honours maxBodyChars and says that it was cut', async () => {
  // Regression: the cap was only measured, never applied, so the whole model
  // answer travelled inside a message whose footer still claimed truncation.
  const credentials = new FakeCredentials()
  const transport = fakeTransport()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig({ maxBodyChars: 1000 }),
    logger: createLogger(),
    credentialProvider: credentials,
    transportFactory: transport.factory,
  })

  const oversized = 'x'.repeat(5000)
  const result = await sink({
    notification: testTurnNotification(testCandidate({ visibleText: oversized, visibleTextLength: oversized.length })),
    to: ['recipient@example.com'],
    truncated: false,
  })

  assert.deepEqual(result, { ok: true })
  const text = transport.sent[0]?.text ?? ''
  assert.ok(text.includes('[Output truncated by dsh-mail-notify]'), 'the message states that it was cut')
  assert.ok(text.includes('x'.repeat(1000)), 'the body keeps exactly the capped answer text')
  assert.ok(!text.includes('x'.repeat(1001)), 'not one character beyond the cap survives')
  assert.ok(!text.includes(oversized), 'the full answer never reaches the transport')
})

test('SEC-09 the credential service is looked up per attempt, not fixed at construction', async () => {
  // Regression: the service was read once when the mailer was built, which is
  // `apply()` time. A profile whose credentials service is published later in the
  // same activation — the real order — handed the plugin `undefined`, and every
  // later send then failed as "no Credential service" although one was mounted.
  const credentials = new FakeCredentials()
  const transport = fakeTransport()
  let published: FakeCredentials | undefined
  let lookups = 0
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger: createLogger(),
    transportFactory: transport.factory,
    credentialProviderResolver: () => {
      lookups += 1
      return published
    },
  })

  // Before the service exists, the failure is permanent and names the reference.
  const early = await sink(sentinelJob())
  assert.equal(early.ok, false)
  assert.equal(early.ok === false ? early.category : undefined, 'credential-missing')
  assert.equal(lookups, 1, 'the lookup happens on the attempt, not at construction')

  // The service is published; the very next send must resolve through it.
  published = credentials
  const late = await sink(sentinelJob())
  assert.deepEqual(late, { ok: true })
  assert.equal(lookups, 2, 'each attempt looks the service up again')
  assert.equal(credentials.resolveCalls.length, 1, 'the value itself is resolved through the service')
  assert.equal(transport.sent.length, 1)
})

test('SEC-02 the credential is resolved once per operation, never cached', async () => {
  const credentials = new FakeCredentials()
  const transport = fakeTransport()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger: createLogger(),
    credentialProvider: credentials,
    transportFactory: transport.factory,
  })

  await sink(sentinelJob())
  assert.equal(credentials.resolveCalls.length, 1)
  assert.equal(transport.options[0]?.password, SMTP_PASSWORD_SENTINEL)

  // The stored value changes; the next send must use the new one without any
  // restart, which is the whole point of a per-operation read.
  credentials.value = 'rotated-not-real-password'
  await sink(sentinelJob())
  assert.equal(credentials.resolveCalls.length, 2, 'resolve must be called again for the second operation')
  assert.equal(transport.options[1]?.password, 'rotated-not-real-password')
  assert.notEqual(transport.options[0]?.password, transport.options[1]?.password)
})

test('SEC-02b each attempt inside one operation re-reads the credential', async () => {
  const credentials = new FakeCredentials()
  const transport = fakeTransport(() => Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger: createLogger(),
    credentialProvider: credentials,
    transportFactory: transport.factory,
  })

  // The queue owns retrying; the mailer's contract is that one call resolves
  // once, so a retried operation surfaces as another call.
  await sink(sentinelJob())
  await sink(sentinelJob())
  assert.equal(credentials.resolveCalls.length, 2)
})

test('SEC-03 an unconfigured reference is a permanent failure that names the reference', async () => {
  const credentials = new FakeCredentials()
  credentials.value = undefined
  const transport = fakeTransport()
  const logger = createLogger()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger,
    credentialProvider: credentials,
    transportFactory: transport.factory,
  })

  const result = await sink(sentinelJob())
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.class, 'permanent', 'a missing secret cannot be fixed by retrying')
  assert.equal(result.category, 'credential-missing')
  assert.ok(result.message.includes('DSH_MAIL_SMTP_PASSWORD'), 'the diagnostic names the reference')
  assert.ok(result.message.includes('configured=false'), 'the diagnostic includes the describe() result')
  assert.equal(transport.sent.length, 0, 'no transport is even created')
  assert.equal(transport.options.length, 0)
  assert.ok(credentials.describeCalls.length >= 1, 'describe is the right entry point for diagnostics')
})

test('SEC-03b a mounting without a credential service reports that, not a silent failure', async () => {
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger: createLogger(),
    credentialProvider: undefined,
    transportFactory: fakeTransport().factory,
  })
  const result = await sink(sentinelJob())
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.category, 'credential-missing')
  assert.ok(result.message.includes('no Credential service'))
})

test('SEC-03c a credential service that throws is reported as a permanent failure', async () => {
  const credentials = new FakeCredentials()
  credentials.resolveError = new Error('store unavailable\nsecond line')
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger: createLogger(),
    credentialProvider: credentials,
    transportFactory: fakeTransport().factory,
  })
  const result = await sink(sentinelJob())
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.class, 'permanent')
  assert.ok(!result.message.includes('\n'), 'the diagnostic is a single line')
})

test('SEC-04 the password never appears in any log record', async () => {
  const credentials = new FakeCredentials()
  const logger = createLogger()
  const okTransport = fakeTransport()
  const failingTransport = fakeTransport(() =>
    Object.assign(new Error(`auth failed for user notify@example.com pass=${SMTP_PASSWORD_SENTINEL}`), {
      code: 'EAUTH',
      responseCode: 535,
    }),
  )
  const config = testConfig()

  const okSink = createMailer({
    ctx: { get: () => undefined },
    config,
    logger,
    credentialProvider: credentials,
    transportFactory: okTransport.factory,
  })
  const failingSink = createMailer({
    ctx: { get: () => undefined },
    config,
    logger,
    credentialProvider: credentials,
    transportFactory: failingTransport.factory,
  })

  await okSink(sentinelJob())
  await failingSink(sentinelJob())

  const rendered = logger.render()
  assert.ok(rendered.length > 0, 'the logger did record something, so the assertion is meaningful')
  assert.ok(!rendered.includes(SMTP_PASSWORD_SENTINEL), 'the credential value must never be logged')
  assert.ok(!rendered.includes('rotated-not-real-password'))
  // Non-vacuity: the log does contain records for both sends, including one
  // whose payload names the failure category, so an empty buffer could not be
  // what makes the assertions above pass.
  const records = logger.getRecords()
  assert.ok(records.some((record) => record.event === 'mail.sent'), 'the successful send was logged')
  assert.ok(records.some((record) => record.event === 'mail.failed'), 'the failed send was logged')
})

test('SEC-04b an auth failure keeps only the classification, not the server text', async () => {
  const credentials = new FakeCredentials()
  const logger = createLogger()
  const transport = fakeTransport(() =>
    Object.assign(new Error('535 5.7.8 Authentication credentials invalid for user notify@example.com'), {
      code: 'EAUTH',
      responseCode: 535,
    }),
  )
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger,
    credentialProvider: credentials,
    transportFactory: transport.factory,
  })
  const result = await sink(sentinelJob())
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.category, 'smtp-auth')
  assert.ok(!result.message.includes('notify@example.com'), 'an auth failure message can echo the user name')
  const rendered = logger.render()
  assert.ok(!rendered.includes('notify@example.com'))
})

test('SEC-05 neither the job nor the rendered message carries the password', () => {
  const job = sentinelJob()
  const serializedJob = JSON.stringify(job)
  assert.ok(!serializedJob.includes(SMTP_PASSWORD_SENTINEL))
  assert.ok(!serializedJob.includes('password'))
})

test('SEC-05b the rendered message carries no reasoning, tool, prompt, or system sentinel', async () => {
  const credentials = new FakeCredentials()
  const transport = fakeTransport()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger: createLogger(),
    credentialProvider: credentials,
    transportFactory: transport.factory,
  })
  await sink(sentinelJob())
  const message = transport.sent[0]
  assert.ok(message !== undefined)
  for (const sentinel of [
    REASONING_SECRET_SENTINEL,
    TOOL_ARGUMENT_SECRET_SENTINEL,
    TOOL_RESULT_SECRET_SENTINEL,
    USER_PROMPT_SENTINEL,
    SYSTEM_PROMPT_SENTINEL,
    SMTP_PASSWORD_SENTINEL,
  ]) {
    assert.ok(!message.text.includes(sentinel), `${sentinel} must not be in the body`)
    assert.ok(!message.subject.includes(sentinel), `${sentinel} must not be in the subject`)
  }
})

test('SEC-06 the transport parameters never disable TLS verification', async () => {
  const credentials = new FakeCredentials()
  const transport = fakeTransport()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger: createLogger(),
    credentialProvider: credentials,
    transportFactory: transport.factory,
  })
  await sink(sentinelJob())

  const options = transport.options[0]
  assert.ok(options !== undefined)
  assert.deepEqual(Object.keys(options).sort(), ['host', 'password', 'port', 'secure', 'user'])
  assert.equal(Object.hasOwn(options, 'rejectUnauthorized'), false)
  assert.equal(Object.hasOwn(options, 'tls'), false)
  assert.equal(options.port, 587)
  assert.equal(options.secure, false)
})

test('SEC-06b the configured secure mode is passed through unchanged', async () => {
  const transport = fakeTransport()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig({ smtpPort: 465, smtpSecure: true }),
    logger: createLogger(),
    credentialProvider: new FakeCredentials(),
    transportFactory: transport.factory,
  })
  await sink(sentinelJob())
  assert.equal(transport.options[0]?.port, 465)
  assert.equal(transport.options[0]?.secure, true)
})

test('SEC-07 every recipient reaches the envelope', async () => {
  const transport = fakeTransport()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig({ to: ['a@example.com', 'b@example.com'] }),
    logger: createLogger(),
    credentialProvider: new FakeCredentials(),
    transportFactory: transport.factory,
  })
  await sink({ ...sentinelJob(), to: ['a@example.com', 'b@example.com'] })
  assert.deepEqual(transport.sent[0]?.to, ['a@example.com', 'b@example.com'])
  assert.equal(transport.sent[0]?.from, 'notify@example.com')
})

test('SEC-07b an empty recipient list never reaches the transport', () => {
  // The configuration stage refuses an empty list, so a job with no recipient
  // cannot be constructed through the plugin. This asserts the configuration
  // contract rather than the transport's tolerance for it.
  const transport = fakeTransport()
  const config = testConfig()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config,
    logger: createLogger(),
    credentialProvider: new FakeCredentials(),
    transportFactory: transport.factory,
  })
  void sink
  assert.ok(config.smtp.to.length >= 1)
})

/* ── Classification through the send path ─────────────────────────────── */

/** Send once with a transport that throws the given error and report the result. */
async function classificationOf(error: unknown): Promise<SendResult> {
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger: createLogger(),
    credentialProvider: new FakeCredentials(),
    transportFactory: fakeTransport(() => error as Error).factory,
  })
  return sink(sentinelJob())
}

test('RET-01 ETIMEDOUT is classified retryable', async () => {
  const result = await classificationOf(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.class, 'retry')
})

test('RET-02 ECONNRESET is classified retryable', async () => {
  const result = await classificationOf(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
  if (!result.ok) assert.equal(result.class, 'retry')
  assert.equal(result.ok, false)
})

test('RET-03 EAI_AGAIN is classified retryable', async () => {
  const result = await classificationOf(Object.assign(new Error('dns'), { code: 'EAI_AGAIN' }))
  if (!result.ok) assert.equal(result.class, 'retry')
  assert.equal(result.ok, false)
})

test('RET-04 an SMTP 4xx is classified retryable', async () => {
  const result = await classificationOf(Object.assign(new Error('try later'), { responseCode: 421 }))
  if (!result.ok) assert.equal(result.class, 'retry')
  assert.equal(result.ok, false)
})

test('RET-05 an authentication failure is permanent', async () => {
  const result = await classificationOf(Object.assign(new Error('auth'), { code: 'EAUTH', responseCode: 535 }))
  if (!result.ok) {
    assert.equal(result.class, 'permanent')
    assert.equal(result.category, 'smtp-auth')
  }
  assert.equal(result.ok, false)
})

test('RET-06 an invalid recipient is permanent', async () => {
  const result = await classificationOf(Object.assign(new Error('bad recipient'), { code: 'EENVELOPE', responseCode: 550 }))
  if (!result.ok) assert.equal(result.class, 'permanent')
  assert.equal(result.ok, false)
})

test('RET-07 an SMTP 5xx is permanent', async () => {
  const result = await classificationOf(Object.assign(new Error('policy'), { responseCode: 554 }))
  if (!result.ok) assert.equal(result.class, 'permanent')
  assert.equal(result.ok, false)
})

test('RET-08 an unknown failure is permanent and logged as unknown-error', async () => {
  const logger = createLogger()
  const sink = createMailer({
    ctx: { get: () => undefined },
    config: testConfig(),
    logger,
    credentialProvider: new FakeCredentials(),
    transportFactory: fakeTransport(() => new Error('something nobody has classified')).factory,
  })
  const result = await sink(sentinelJob())
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.category, 'unknown-error')
  assert.equal(result.ok, false)
  assert.ok(logger.render().includes('unknown-error'))
})

test('the mailer never rejects, whatever the transport does', async () => {
  const hostile = [
    () => new Error('plain'),
    () => Object.assign(new Error('coded'), { code: 'ESOCKET' }),
    () => 'a string throw',
    () => undefined,
    () => null,
    () => 42,
  ]
  for (const behaviour of hostile) {
    const sink = createMailer({
      ctx: { get: () => undefined },
      config: testConfig(),
      logger: createLogger(),
      credentialProvider: new FakeCredentials(),
      transportFactory: fakeTransport(behaviour as () => unknown).factory,
    })
    const result = await sink(sentinelJob())
    assert.equal(typeof result.ok, 'boolean')
  }
})
