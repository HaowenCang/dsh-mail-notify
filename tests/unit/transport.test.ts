/**
 * L1 unit tests for `transport.ts` — the Nodemailer boundary.
 *
 * Every other test in the suite drives the send path through a stubbed
 * transport factory, which is the right shape for asserting the plugin's own
 * decisions but leaves one question unasked: what does this plugin actually hand
 * Nodemailer, and what does it let Nodemailer send? That question is answered
 * here, against the real `createSmtpTransport`, with a fake `Transporter` in
 * place of the one `nodemailer.createTransport` would return.
 *
 * The assertions are deliberately exhaustive rather than representative. The
 * transport invariant is a closed set — four connection fields and four message
 * fields — so anything outside that set is a regression by definition, and only
 * an exact comparison can say so.
 *
 * @module dsh-mail-notify/tests/unit/transport
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { createSmtpTransport, type MailTransport, type OutgoingMessage, type TransportOptions } from '../../src/transport.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const sentinelOptions: TransportOptions = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'smtp-user@example.com',
  password: 'sentinel-password-not-a-real-credential',
}

const sentinelMessage: OutgoingMessage = {
  from: 'sender@example.com',
  to: ['first@example.com', 'second@example.com'],
  subject: 'a subject',
  text: 'a body',
}

/**
 * Run the real `createSmtpTransport` against a fake Nodemailer factory.
 *
 * `nodemailer.createTransport` is the only thing replaced. Everything under test
 * — which keys are assembled, how `sendMail` is invoked, what the returned
 * `MailTransport` exposes — is the shipped code path.
 *
 * @param message - the message to send through the resulting transport.
 * @returns the call the code under test made, and the transport it returned.
 */
async function runCreateSmtpTransport(message: OutgoingMessage = sentinelMessage): Promise<{
  transporterOptions: unknown
  sentMailArgs: unknown[]
  returnedKeys: string[]
  callCount: number
}> {
  const sentMailArgs: unknown[] = []
  let transporterOptions: unknown
  let callCount = 0
  const descriptor = Object.getOwnPropertyDescriptor(nodemailer, 'createTransport')
  assert.ok(descriptor !== undefined, 'nodemailer exposes createTransport as an own property')

  // A property assignment rather than a `node:test` module mock: the latter
  // still needs an experimental flag, while the module namespace is already the
  // live object the code under test imports.
  Object.defineProperty(nodemailer, 'createTransport', {
    value: (options: unknown) => {
      transporterOptions = options
      callCount += 1
      return {
        sendMail: (...args: unknown[]) => {
          sentMailArgs.push(args[0])
          return Promise.resolve({ messageId: 'fake' })
        },
      } as unknown as Transporter
    },
    configurable: true,
    writable: true,
  })

  try {
    const transport: MailTransport = createSmtpTransport(sentinelOptions)
    await transport.sendMail(message)
    return { transporterOptions, sentMailArgs, returnedKeys: Object.keys(transport), callCount }
  } finally {
    if (descriptor !== undefined) Object.defineProperty(nodemailer, 'createTransport', descriptor)
  }
}

test('TRN-01 the transport is built from exactly host, port, secure, and auth', async () => {
  const { transporterOptions } = await runCreateSmtpTransport()
  // An exact shape, not a subset check. A fifth key — `tls`, `rejectUnauthorized`,
  // `pool`, `proxy`, `getSocket` — is precisely the regression this asserts against,
  // and a subset check could not see it.
  assert.deepEqual(transporterOptions, {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'smtp-user@example.com', pass: 'sentinel-password-not-a-real-credential' },
  })
  assert.deepEqual(Object.keys(transporterOptions as object).sort(), ['auth', 'host', 'port', 'secure'])
  assert.deepEqual(Object.keys((transporterOptions as { auth: object }).auth).sort(), ['pass', 'user'])
})

test('TRN-02 the message is built from exactly from, to, subject, and text', async () => {
  const { sentMailArgs } = await runCreateSmtpTransport()
  assert.equal(sentMailArgs.length, 1)
  assert.deepEqual(sentMailArgs[0], {
    from: 'sender@example.com',
    to: ['first@example.com', 'second@example.com'],
    subject: 'a subject',
    text: 'a body',
  })
  // Attachments, html, raw, and envelope carry the historical advisory paths
  // (file resolution, URL resolution, raw passthrough). Their absence is the
  // property, so it is asserted rather than described.
  for (const forbidden of ['attachments', 'html', 'raw', 'envelope', 'alternatives', 'icalEvent', 'dkim', 'headers']) {
    assert.equal(Object.hasOwn(sentMailArgs[0] as object, forbidden), false, `${forbidden} must not reach Nodemailer`)
  }
})

test('TRN-03 the recipient array is copied, not aliased to the caller', async () => {
  const message: OutgoingMessage = { ...sentinelMessage, to: ['first@example.com'] }
  const { sentMailArgs } = await runCreateSmtpTransport(message)
  const handed = (sentMailArgs[0] as { to: string[] }).to
  assert.notEqual(handed, message.to, 'the caller keeps no handle on the array Nodemailer is given')
  assert.deepEqual(handed, ['first@example.com'])
  // Mutating the original afterwards must not change what Nodemailer holds.
  ;(message.to as string[]).push('injected@example.com')
  assert.deepEqual(handed, ['first@example.com'])
})

test('TRN-04 the returned transport exposes sendMail and nothing else', async () => {
  const { returnedKeys, callCount } = await runCreateSmtpTransport()
  assert.deepEqual(returnedKeys, ['sendMail'])
  assert.equal(callCount, 1, 'one transport per factory call')
  // The transporter itself is not reachable from the returned value, so a later
  // caller cannot reach `close`, `verify`, or the underlying transport options.
  const transport = createSmtpTransport(sentinelOptions)
  assert.equal(typeof transport.sendMail, 'function')
  assert.equal(Object.hasOwn(transport, 'transporter'), false)
})

test('TRN-05 the option shape carries no TLS override at all', async () => {
  // `rejectUnauthorized` is a Node TLS option rather than a Nodemailer top-level
  // key, and it only takes effect inside a `tls` block. TRN-01's exact-shape
  // comparison already excludes both; this test states the mechanism, and checks
  // that the installed major still exposes the API surface the transport uses.
  assert.equal(typeof nodemailer.createTransport, 'function')
  const { transporterOptions } = await runCreateSmtpTransport()
  assert.equal(Object.hasOwn(transporterOptions as object, 'tls'), false)
  assert.equal(Object.hasOwn(transporterOptions as object, 'rejectUnauthorized'), false)
})

test('TRN-06 transport.ts is the only module that imports Nodemailer', () => {
  // The blast radius of a Nodemailer advisory is bounded by this fact, which is
  // what makes the dependency auditable: one file to read, one seam to stub.
  const sources = readFileSync(join(root, 'src', 'transport.ts'), 'utf8')
  assert.match(sources, /from 'nodemailer'/)

  const importers = readdirSync(join(root, 'src'))
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => /from\s+'nodemailer'/.test(readFileSync(join(root, 'src', name), 'utf8')))
  assert.deepEqual(importers, ['transport.ts'])
})
