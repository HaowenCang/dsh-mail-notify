/**
 * Unit tests for the browser-side narrowing of the two wire surfaces.
 *
 * The card renders whatever these readers return, so a shape that changed under
 * it must be refused here rather than surface as a crash inside the Plugins tab.
 *
 * @module dsh-mail-notify/tests/client/wire
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  describeCredential,
  readRuntimeStatus,
  readStatusValue,
  readTestEmailValue,
  requestTestEmail,
  setCredential,
  unsetCredential,
} from '../../src/client/wire.ts'
import type { ClientContext } from '../../src/client/contracts.ts'

test('WIR-01 a complete status body is accepted field for field', () => {
  const value = readStatusValue({
    active: true,
    smtpConfigured: true,
    credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
    queue: { depth: 1, size: 100, delivered: 4, failed: 2 },
    configError: 'smtpHost is required',
  })
  assert.deepEqual(value, {
    active: true,
    smtpConfigured: true,
    credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
    queue: { depth: 1, size: 100, delivered: 4, failed: 2 },
    configError: 'smtpHost is required',
  })
})

test('WIR-02 optional members are absent rather than present-and-undefined', () => {
  const value = readStatusValue({ active: false, smtpConfigured: false, credentialRef: '' })
  assert.ok(value !== undefined)
  assert.equal(Object.hasOwn(value, 'queue'), false)
  assert.equal(Object.hasOwn(value, 'configError'), false)
})

test('WIR-03 a body missing the reference is refused', () => {
  // `credentialRef` is the one member with no sensible default, so its absence
  // is what distinguishes "a status this plugin did not send" from a status
  // that merely reports nothing.
  assert.equal(readStatusValue({ active: true, smtpConfigured: true }), undefined)
  assert.equal(readStatusValue(undefined), undefined)
  assert.equal(readStatusValue('{}'), undefined)
  assert.equal(readStatusValue([]), undefined)
})

test('WIR-04 a malformed queue block is dropped, not half-read', () => {
  const value = readStatusValue({
    active: true,
    smtpConfigured: true,
    credentialRef: 'R',
    queue: { depth: 1, size: 'lots' },
  })
  assert.ok(value !== undefined)
  assert.equal(Object.hasOwn(value, 'queue'), false)
})

test('WIR-05 a delivery-test body must carry both required members', () => {
  assert.deepEqual(readTestEmailValue({ delivered: true, recipientCount: 2 }), {
    delivered: true,
    recipientCount: 2,
  })
  assert.deepEqual(readTestEmailValue({ delivered: false, recipientCount: 0, category: 'auth', message: 'no' }), {
    delivered: false,
    recipientCount: 0,
    category: 'auth',
    message: 'no',
  })
  assert.equal(readTestEmailValue({ delivered: 'yes', recipientCount: 1 }), undefined)
  assert.equal(readTestEmailValue({ delivered: true }), undefined)
})

/** The smallest context the readers touch, with the two wire surfaces faked. */
interface FakeWire {
  ctx: ClientContext
  calls: Array<{ channel: string; endpoint: string; payload: unknown }>
  credentialCalls: string[]
  respond: (result: unknown) => void
  respondCredentials: (result: unknown) => void
}

/**
 * Build a context whose Connection and Remote surfaces answer from the test.
 *
 * @returns the fake context and its recorded calls.
 */
function fakeWire(): FakeWire {
  const calls: FakeWire['calls'] = []
  const credentialCalls: string[] = []
  let next: unknown = { ok: true, value: {} }
  let nextCredentials: unknown = { ok: true, value: {} }
  const ctx = {
    connection: {
      rpc: {
        call: (channel: string, endpoint: string, payload: unknown) => {
          calls.push({ channel, endpoint, payload })
          return Promise.resolve(next)
        },
      },
    },
    remote: {
      credentials: {
        describe: (refs: string[]) => {
          credentialCalls.push(`describe:${refs.join(',')}`)
          return Promise.resolve(nextCredentials)
        },
        set: (ref: string, value: string) => {
          credentialCalls.push(`set:${ref}:${value}`)
          return Promise.resolve(nextCredentials)
        },
        unset: (ref: string) => {
          credentialCalls.push(`unset:${ref}`)
          return Promise.resolve(nextCredentials)
        },
      },
    },
  } as unknown as ClientContext
  return {
    ctx,
    calls,
    credentialCalls,
    respond: (result) => {
      next = result
    },
    respondCredentials: (result) => {
      nextCredentials = result
    },
  }
}

test('WIR-06 both endpoints are addressed on the shared /api channel', async () => {
  const wire = fakeWire()
  wire.respond({ ok: true, value: { active: true, smtpConfigured: true, credentialRef: 'R' } })
  const status = await readRuntimeStatus(wire.ctx)
  assert.equal(status.ok, true)
  assert.deepEqual(wire.calls, [{ channel: '/api', endpoint: 'dsh-mail-notify/status', payload: {} }])

  wire.respond({ ok: true, value: { delivered: true, recipientCount: 1 } })
  await requestTestEmail(wire.ctx)
  assert.equal(wire.calls[1]?.endpoint, 'dsh-mail-notify/test-email')
})

test('WIR-07 a transport rejection becomes a refusal, not a throw', async () => {
  const wire = fakeWire()
  const { ctx } = wire
  const broken = {
    ...ctx,
    connection: {
      rpc: {
        call: () => Promise.reject(new Error('HTTP 403')),
      },
    },
  } as unknown as ClientContext
  const status = await readRuntimeStatus(broken)
  assert.deepEqual(status, { ok: false, message: 'HTTP 403' })
})

test('WIR-08 a host-side envelope failure carries the host message through', async () => {
  const wire = fakeWire()
  wire.respond({ ok: false, error: { code: 'not-found', message: 'unknown endpoint', details: {} } })
  const status = await readRuntimeStatus(wire.ctx)
  assert.deepEqual(status, { ok: false, message: 'unknown endpoint' })
})

test('WIR-09 the credential surface is reached by reference and never returns a value', async () => {
  const wire = fakeWire()
  wire.respondCredentials({ ok: true, value: { MY_REF: { configured: true, writable: true } } })
  const described = await describeCredential(wire.ctx, 'MY_REF')
  assert.deepEqual(described, { ok: true, value: { configured: true, writable: true } })
  assert.deepEqual(wire.credentialCalls, ['describe:MY_REF'])

  wire.respondCredentials({ ok: true, value: undefined })
  const written = await setCredential(wire.ctx, 'MY_REF', 'SENTINEL-not-a-real-password')
  // The write reports only that it was accepted: the result type has no slot a
  // secret could occupy, and the fake's own record is the only place the
  // sentinel appears.
  assert.deepEqual(written, { ok: true, value: undefined })
  assert.deepEqual(wire.credentialCalls[1], 'set:MY_REF:SENTINEL-not-a-real-password')

  wire.respondCredentials({ ok: true, value: undefined })
  assert.deepEqual(await unsetCredential(wire.ctx, 'MY_REF'), { ok: true, value: undefined })
  assert.deepEqual(wire.credentialCalls[2], 'unset:MY_REF')
})

test('WIR-10 a reference the host does not describe is a refusal, not a default', async () => {
  const wire = fakeWire()
  wire.respondCredentials({ ok: true, value: {} })
  const described = await describeCredential(wire.ctx, 'MISSING')
  assert.equal(described.ok, false)
  assert.ok(described.ok === false && described.message.includes('MISSING'))
})

test('WIR-11 a refused credential write reports the host message', async () => {
  const wire = fakeWire()
  wire.respondCredentials({ ok: false, error: { code: 'credential/rejected', message: 'read-only source' } })
  const written = await setCredential(wire.ctx, 'MY_REF', 'x')
  assert.deepEqual(written, { ok: false, message: 'read-only source' })
})

test('WIR-12 the module imports no read path for a credential', async () => {
  // The browser must never be able to obtain the password. The guarantee is the
  // published namespace's own shape, and this assertion is what keeps a future
  // edit from reaching for a method that does not exist yet looks plausible.
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../src/client/wire.ts', import.meta.url), 'utf8'),
  )
  for (const forbidden of ['credentials.resolve', 'credentials.read', 'credentials.get', 'credentials.list']) {
    assert.equal(source.includes(forbidden), false, `wire.ts must not reach ${forbidden}`)
  }
})
