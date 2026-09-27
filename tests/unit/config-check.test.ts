/**
 * L1 unit tests for the shared product rules and the Host boundary they back.
 *
 * The property under test is not any single rule but *agreement*: the Host's
 * refusal (`Config['~standard'].validate`, which cordis's `resolveConfig` turns
 * into a thrown `ValidationError` before `cordis.patch.yml` is written) and the
 * runtime's refusal (`config.ts::resolveConfig`, the defence in depth a
 * hand-edited patch still reaches) must be the same sentences for the same
 * candidate. A second copy of the rules would satisfy every rule test here and
 * still fail the equivalence test, which is why that test is the centre of this
 * file.
 *
 * The mechanism itself is asserted, not assumed: `.check()` must really be
 * absent from the pinned Schemastery, and the cordis call must be the installed
 * function rather than a copy of it.
 *
 * @module dsh-mail-notify/tests/unit/config-check
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ValidationError as CordisValidationError, resolveConfig as cordisResolveConfig } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  ADDRESS_PATTERN,
  CREDENTIAL_REF_PATTERN,
  checkCredentialReference,
  checkProductConfig,
  collapseVolatile,
  dedupeAddresses,
  normalizeRecipients,
  readEnabled,
} from '../../src/config-check.ts'
import { Config, resolveConfig, snapshotOf } from '../../src/config.ts'
import { VALID_RAW_CONFIG } from '../support/harness.ts'

/** The primitive candidate the runtime and the Host both check. */
function primitive(overrides: Record<string, unknown> = {}) {
  return snapshotOf(Config({ ...VALID_RAW_CONFIG, ...overrides } as never))
}

/** One standard-schema issue, as the Host reports it. */
interface HostIssue {
  readonly message: string
  readonly path?: readonly unknown[]
}

/**
 * The synchronous half of a standard-schema result.
 *
 * `StandardSchemaV1.Props['validate']` also admits a promise, which cordis
 * explicitly refuses; cordis's own `resolveConfig` narrows it with a `'then' in
 * result` test. The tests do the same narrow once, here, so every assertion
 * below is about a resolved result.
 */
interface HostResult {
  readonly value?: Record<string, { get(): unknown } | undefined>
  readonly issues?: readonly HostIssue[]
}

/**
 * Read one reference out of the resolved volatile tree.
 *
 * @param result - a passing Host result.
 * @param name - the configuration field.
 * @returns the field's `Volatile` reference.
 */
function volatileField(result: HostResult, name: string): { get(): unknown } {
  const field = result.value?.[name]
  assert.ok(field !== undefined, `${name} is missing from the resolved configuration`)
  return field
}

/**
 * Drive a candidate through the compiled Host contract.
 *
 * @param candidate - a raw configuration document.
 * @returns the standard-schema result cordis would act on.
 */
function hostValidate(candidate: unknown): HostResult {
  const result = Config['~standard'].validate(candidate)
  assert.equal('then' in result, false, 'the Host contract must stay synchronous')
  return result as unknown as HostResult
}

/* ── The mechanism ─────────────────────────────────────────────────────── */

test('the pinned Schemastery exposes no .check(), so the standard-schema validator is the mechanism', () => {
  // The cookbook sentence describes a Schemastery capability the pinned release
  // does not have. Calling it would be a TypeError at import time, so the claim
  // is pinned here: the day a `.check()` appears, this test says so rather than
  // the plugin silently keeping to the older mechanism.
  assert.equal(Object.getOwnPropertyNames(Schema.prototype).includes('check'), false)
  assert.equal(typeof (Schema.prototype as unknown as Record<string, unknown>)['check'], 'undefined')
})

test('the Host node answers through an own standard-schema override', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Config, '~standard')
  assert.ok(descriptor !== undefined, 'the derived node must carry its own validator')
  assert.equal(descriptor?.configurable, true)
  assert.equal(typeof descriptor?.value, 'object')
  assert.equal(Config['~standard'].version, 1)
  assert.equal(Config['~standard'].vendor, 'dsh-mail-notify')
})

/* ── The shared rule set ───────────────────────────────────────────────── */

test('a product-valid candidate passes every rule and keeps its recipients', () => {
  const check = checkProductConfig(primitive({ to: ['a@example.com', 'A@Example.com', 'b@example.com'] }))
  assert.deepEqual(check.errors, [])
  assert.deepEqual(check.issues, [])
  assert.deepEqual(check.warnings, [])
  assert.deepEqual([...check.recipients], ['a@example.com', 'b@example.com'])
})

test('smtpHost must be present and free of whitespace', () => {
  const missing = checkProductConfig(primitive({ smtpHost: '   ' }))
  assert.deepEqual(missing.issues, [
    { message: 'smtpHost is required and must be a non-empty host name', path: ['smtpHost'] },
  ])

  const spaced = checkProductConfig(primitive({ smtpHost: 'smtp example com' }))
  assert.deepEqual(spaced.issues, [{ message: 'smtpHost must not contain whitespace', path: ['smtpHost'] }])
})

test('smtpUser must be a non-empty user name', () => {
  const check = checkProductConfig(primitive({ smtpUser: ' ' }))
  assert.deepEqual(check.issues, [{ message: 'smtpUser is required and must be a non-empty user name', path: ['smtpUser'] }])
})

test('from must be a plausible non-empty address', () => {
  const empty = checkProductConfig(primitive({ from: '' }))
  assert.deepEqual(empty.issues, [{ message: 'from is required and must be a non-empty address', path: ['from'] }])

  const malformed = checkProductConfig(primitive({ from: 'not-an-address' }))
  assert.deepEqual(malformed.issues, [{ message: 'from "not-an-address" is not a plausible email address', path: ['from'] }])
})

test('to must yield at least one recipient after the address and dedupe rules', () => {
  const empty = checkProductConfig(primitive({ to: [] }))
  assert.deepEqual(empty.issues, [{ message: 'to must contain at least one valid recipient address', path: ['to'] }])

  // A refused entry is reported per entry, exactly as the runtime always has:
  // dropping it silently is what would let a message reach the wrong set.
  const refused = checkProductConfig(primitive({ to: ['nope'] }))
  assert.deepEqual(refused.issues, [
    { message: 'to entry "nope" is not a plausible email address', path: ['to'] },
    { message: 'to must contain at least one valid recipient address', path: ['to'] },
  ])
  assert.deepEqual([...refused.recipients], [])
})

test('blank recipient entries are ignored rather than refused', () => {
  const check = checkProductConfig(primitive({ to: ['  ', 'a@example.com'] }))
  assert.deepEqual(check.errors, [])
  assert.deepEqual([...check.recipients], ['a@example.com'])
})

test('a disabled plugin is never asked for SMTP configuration', () => {
  const check = checkProductConfig({ enabled: false, smtpHost: '', smtpUser: '', from: '', to: [] })
  assert.deepEqual(check.errors, [])
  assert.deepEqual(check.warnings, [])
  assert.deepEqual([...check.recipients], [])

  assert.equal(hostValidate({ enabled: false, smtpHost: '', smtpUser: '', from: '', to: [] }).issues, undefined)
})

test('readEnabled treats only an explicit false as off', () => {
  assert.equal(readEnabled({}), true)
  assert.equal(readEnabled({ enabled: undefined }), true)
  assert.equal(readEnabled({ enabled: false }), false)
  assert.equal(readEnabled(null), true)
  assert.equal(readEnabled('text'), true)
})

test('the port pairing and the silent-switch cases warn without becoming errors', () => {
  const secured587 = checkProductConfig(primitive({ smtpPort: 587, smtpSecure: true }))
  assert.deepEqual(secured587.errors, [])
  assert.equal(secured587.warnings.length, 1)
  assert.ok(secured587.warnings[0]?.includes('587'))

  const plain465 = checkProductConfig(primitive({ smtpPort: 465, smtpSecure: false }))
  assert.deepEqual(plain465.errors, [])
  assert.ok(plain465.warnings[0]?.includes('465'))

  const silent = checkProductConfig(
    primitive({ notifyCompleted: false, notifyErrors: false, notifyMaxTokens: false, notifyQuestions: false, notifyApprovals: false }),
  )
  assert.deepEqual(silent.errors, [])
  assert.equal(silent.warnings.length, 1)
  assert.ok(silent.warnings[0]?.includes('all false'))

  assert.deepEqual(checkProductConfig(primitive({ smtpPort: 465, smtpSecure: true })).warnings, [])
})

test('smtpPasswordCredential is not a product rule', () => {
  // The field schema governs it (pattern + DSH_MAIL_SMTP_PASSWORD default), so a
  // cross-field duplicate would report the same refusal twice at the Host. The
  // candidate is built around the schema here because the empty and malformed
  // spellings never survive it.
  const base = primitive()
  for (const credential of ['', 'not a reference!', 'scope/id']) {
    const check = checkProductConfig({ ...base, smtpPasswordCredential: credential })
    assert.equal(
      check.issues.some((issue) => issue.path[0] === 'smtpPasswordCredential'),
      false,
      `checkProductConfig must not rule on ${JSON.stringify(credential)}`,
    )
  }
  // It is still a rule — for the boundary that has no field schema in front of it.
  assert.equal(checkCredentialReference('')?.message.includes('smtpPasswordCredential'), true)
  assert.equal(checkCredentialReference('not a reference!')?.message.includes(CREDENTIAL_REF_PATTERN.source), true)
  assert.equal(checkCredentialReference('DSH_MAIL_SMTP_PASSWORD'), undefined)
})

test('the address rule refuses list separators and the dedupe rule is case-insensitive', () => {
  assert.equal(ADDRESS_PATTERN.test('a@example.com'), true)
  assert.equal(ADDRESS_PATTERN.test('a@example.com,b@example.com'), false)
  assert.equal(ADDRESS_PATTERN.test('a@example.com;b@example.com'), false)
  assert.equal(ADDRESS_PATTERN.test('a@example.com b@example.com'), false)
  assert.equal(ADDRESS_PATTERN.test('a@example.com,b@example.com'.replace(',', ' ')), false)
  assert.deepEqual(dedupeAddresses(['A@Example.com', 'a@example.com', 'b@example.com']), ['A@Example.com', 'b@example.com'])
  assert.deepEqual(normalizeRecipients(['  ', 'ok@example.com', 'bad']), { accepted: ['ok@example.com'], refused: ['bad'] })
  assert.deepEqual(normalizeRecipients('not-an-array'), { accepted: [], refused: [] })
})

/* ── The Host contract ─────────────────────────────────────────────────── */

test('the Host gets the resolved volatile tree back when the product rules pass', () => {
  const result = hostValidate({ ...VALID_RAW_CONFIG })
  assert.equal(result.issues, undefined)
  assert.equal(typeof volatileField(result, 'enabled').get, 'function')
  assert.equal(volatileField(result, 'enabled').get(), true)
  assert.equal(volatileField(result, 'smtpPort').get(), 587, 'defaults are applied before the product rules run')
  assert.equal(Object.isFrozen(volatileField(result, 'to').get()), true)
})

test('a product-invalid candidate is refused with the offending field path', () => {
  const result = hostValidate({ enabled: true, smtpHost: '', smtpUser: 'ops', from: 'n@example.com', to: ['ops@example.com'] })
  assert.ok(Array.isArray(result.issues))
  assert.deepEqual(result.issues?.[0]?.path, ['smtpHost'])
  assert.ok(result.issues?.[0]?.message.includes('smtpHost'))
})

test('a field-level violation is still reported by the field schema, not by the product rules', () => {
  const result = hostValidate({ enabled: false, smtpPort: 99_999 })
  assert.deepEqual(
    result.issues?.map((issue) => issue.path),
    [['smtpPort']],
  )
})

test('the product rules are not consulted when the field schema already refused', () => {
  // `enabled: false` plus a valid document; only the field violation may appear,
  // which is what proves the delegation happens before the product rules.
  const result = hostValidate({ enabled: false, smtpPort: 99_999 })
  assert.equal(result.issues?.length, 1)
})

test('the installed cordis turns the refusal into a ValidationError before any write', () => {
  const runtime = { Config }
  const outcome = (() => {
    try {
      cordisResolveConfig(runtime as never, { enabled: true, smtpHost: '', to: [] })
      return undefined
    } catch (error) {
      return error
    }
  })()
  assert.ok(outcome instanceof CordisValidationError, 'the refusal must be the error dsh-config-editor propagates')
  assert.ok(outcome.message.includes('(at smtpHost)'), outcome.message)
  assert.doesNotThrow(() => cordisResolveConfig(runtime as never, { enabled: false }))
})

/* ── One rule set, two boundaries ──────────────────────────────────────── */

test('the Host refusal and the runtime refusal are the same sentences', () => {
  // The candidate has no field-level violation, so both boundaries reach their
  // product rules. Any drift between them — a rule added on one side, a message
  // reworded on the other — fails here.
  const candidate = {
    enabled: true,
    smtpHost: 'bad host',
    smtpUser: '',
    from: 'not-an-address',
    to: ['also-not-an-address'],
  }
  const issues = hostValidate(candidate).issues ?? []
  const { errors } = resolveConfig({ ...candidate })
  assert.deepEqual(
    issues.map((issue) => issue.message),
    [...errors],
  )
  assert.ok(errors.length > 0, 'the candidate must actually fail, or the comparison proves nothing')
})

test('the Host accepts what the runtime resolves, for every complete document', () => {
  const candidate = { ...VALID_RAW_CONFIG, notifyQuestions: true, minTurnDurationMs: 250 }
  assert.equal(hostValidate(candidate).issues, undefined)
  assert.deepEqual(resolveConfig(candidate).errors, [])
})

/* ── Derivation leaves the rest of the node alone ──────────────────────── */

test('the derived node still reduces to the non-default fields', () => {
  // `simplify` is what the patch writer uses to avoid persisting defaults; a
  // derivation that lost it, or the per-field defaults it reads, would silently
  // start writing every default into the profile patch.
  const simplified = Config.simplify(Config({ ...VALID_RAW_CONFIG, smtpPort: 2525 } as never))
  assert.equal(simplified.smtpPort, 2525)
  assert.equal(simplified.queueSize, undefined)
  assert.equal(simplified.smtpHost, 'smtp.example.com')
})

test('the volatile tree survives collapsing into primitives', () => {
  const collapsed = collapseVolatile(Config({ ...VALID_RAW_CONFIG } as never)) as Record<string, unknown>
  assert.equal(collapsed['enabled'], true)
  assert.deepEqual(collapsed['to'], ['recipient@example.com'])
  assert.equal(Object.keys(collapsed).length, 23)
})
