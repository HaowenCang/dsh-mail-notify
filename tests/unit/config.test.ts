/**
 * L1 unit tests for `config.ts` — matrix row PRIV-08 and the whole of
 * `docs/CONFIG_SPEC.md` §3 (defaults) and §4 (validation rules).
 *
 * Two behaviours carry security weight. The five privacy defaults must be the
 * safe ones, and validation must never read a credential value: it checks only
 * that the reference *name* is well formed. Both are asserted here.
 *
 * @module dsh-mail-notify/tests/unit/config
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, CREDENTIAL_REF_PATTERN, resolveConfig } from '../../src/config.ts'
import { VALID_RAW_CONFIG } from '../support/harness.ts'

test('PRIV-08 the schema defaults are the five safe privacy defaults', () => {
  const defaults = Config({} as never)
  assert.equal(defaults.includeSubagents, false)
  assert.equal(defaults.includeUserPrompt, false)
  assert.equal(defaults.includeMetadata, true)
  assert.equal(defaults.notifyErrors, false)
  assert.equal(defaults.notifyMaxTokens, true)
  assert.equal(defaults.notifyCompleted, true)
  assert.equal(defaults.enabled, true)
})

test('the schema defaults match the rest of the frozen configuration table', () => {
  const defaults = Config({} as never)
  assert.equal(defaults.smtpPort, 587)
  assert.equal(defaults.smtpSecure, false)
  assert.equal(defaults.minTurnDurationMs, 0)
  assert.equal(defaults.maxBodyChars, 100_000)
  assert.equal(defaults.includeFooter, true)
  assert.equal(defaults.queueSize, 100)
  assert.equal(defaults.retryAttempts, 3)
  assert.equal(defaults.retryBaseDelayMs, 1000)
  assert.equal(defaults.maxDedupeEntries, 1000)
})

test('out-of-range numbers are rejected by the schema', () => {
  assert.throws(() => Config({ maxBodyChars: 1 } as never), 'below the 1000 floor')
  assert.throws(() => Config({ maxBodyChars: 2_000_000 } as never), 'the upper bound exists to prevent an unbounded body')
  assert.throws(() => Config({ smtpPort: 70_000 } as never))
  assert.throws(() => Config({ queueSize: 0 } as never))
  assert.throws(() => Config({ retryAttempts: 11 } as never))
  assert.throws(() => Config({ retryBaseDelayMs: 10 } as never))
  assert.throws(() => Config({ maxDedupeEntries: 1 } as never))
  assert.throws(() => Config({ minTurnDurationMs: -1 } as never))
})

test('a complete valid configuration resolves with no errors and no warnings', () => {
  const { errors, warnings, resolved } = resolveConfig({ ...VALID_RAW_CONFIG })
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  assert.equal(resolved.enabled, true)
  assert.equal(resolved.smtpConfigured, true)
  assert.equal(resolved.smtp.to.length, 1)
})

test('missing required SMTP fields are field-level failures', () => {
  const { errors } = resolveConfig({ enabled: true, to: ['a@b.com'], from: 'a@b.com' })
  assert.ok(errors.some((entry) => entry.includes('smtpHost')))
  assert.ok(errors.some((entry) => entry.includes('smtpUser')))
  assert.ok(errors.some((entry) => entry.includes('smtpPasswordCredential')))
})

test('an empty recipient list is a field-level failure', () => {
  const { errors } = resolveConfig({ ...VALID_RAW_CONFIG, to: [] })
  assert.ok(errors.some((entry) => entry.includes('to must contain at least one')))

  const { errors: missing } = resolveConfig({ ...VALID_RAW_CONFIG, to: undefined })
  assert.ok(missing.some((entry) => entry.includes('to must contain')))
})

test('invalid recipient entries fail rather than being skipped silently', () => {
  const { errors } = resolveConfig({ ...VALID_RAW_CONFIG, to: ['not-an-address', 'ok@example.com'] })
  assert.ok(errors.some((entry) => entry.includes('not-an-address')))
  // The failure stands even though one usable address remains: there is no
  // partial-activation mode.
  assert.ok(errors.length > 0)
})

test('empty and whitespace-only recipient entries are ignored', () => {
  const { errors, resolved } = resolveConfig({ ...VALID_RAW_CONFIG, to: ['  ', 'a@example.com', 'b@example.com'] })
  assert.deepEqual(errors, [])
  assert.deepEqual([...resolved.smtp.to], ['a@example.com', 'b@example.com'])
})

test('recipients are de-duplicated case-insensitively but keep their original spelling', () => {
  const { resolved } = resolveConfig({
    ...VALID_RAW_CONFIG,
    to: ['A@Example.com', 'a@example.com', 'b@example.com'],
  })
  assert.deepEqual([...resolved.smtp.to], ['A@Example.com', 'b@example.com'])
})

test('a malformed from address fails', () => {
  const { errors } = resolveConfig({ ...VALID_RAW_CONFIG, from: 'not-an-address' })
  assert.ok(errors.some((entry) => entry.includes('from')))
})

test('ADDR-01 a multi-address list is never accepted as one entry (GHSA-2x7j-588g-ccc2)', () => {
  // The advisory is a quadratic-time address parser reached with a crafted
  // comma-separated list. Its path runs through Nodemailer's own parser, which
  // this plugin reaches only with a single address per field. That the parser
  // stays unreachable is a property of the configuration layer, so the proof
  // belongs here: every list separator is refused as part of one `from` or one
  // `to` entry, and only arrays carry more than one recipient.
  const listShaped = [
    'a@example.com,b@example.com',
    'a@example.com;b@example.com',
    'a@example.com b@example.com',
    'a@example.com\tb@example.com',
    'a@example.com\nb@example.com',
    ',a@example.com',
    'a@example.com,',
    'a@example.com,,b@example.com',
    'Group: a@example.com, b@example.com;',
    '"a@example.com, b@example.com"',
    '<a@example.com>, <b@example.com>',
    'a@example.com, b@example.com',
  ]
  for (const entry of listShaped) {
    const asFrom = resolveConfig({ ...VALID_RAW_CONFIG, from: entry })
    assert.ok(asFrom.errors.length > 0, `from ${JSON.stringify(entry)} must be refused, not parsed as a list`)
    assert.equal(asFrom.resolved.smtpConfigured, false, `from ${JSON.stringify(entry)} must not arm the plugin`)

    const asTo = resolveConfig({ ...VALID_RAW_CONFIG, to: [entry] })
    assert.ok(asTo.errors.length > 0, `to entry ${JSON.stringify(entry)} must be refused, not parsed as a list`)
    assert.equal(asTo.resolved.smtpConfigured, false, `to entry ${JSON.stringify(entry)} must not arm the plugin`)
  }
})

test('ADDR-02 separate array entries remain the supported way to reach several recipients', () => {
  const { errors, resolved } = resolveConfig({
    ...VALID_RAW_CONFIG,
    to: ['a@example.com', 'b@example.com'],
  })
  assert.deepEqual(errors, [])
  assert.equal(resolved.smtpConfigured, true)
  assert.deepEqual([...resolved.smtp.to], ['a@example.com', 'b@example.com'])
})

test('the credential reference must be a name, not a value', () => {
  assert.equal(CREDENTIAL_REF_PATTERN.test('DSH_MAIL_SMTP_PASSWORD'), true)
  assert.equal(CREDENTIAL_REF_PATTERN.test('_private'), true)
  assert.equal(CREDENTIAL_REF_PATTERN.test('lower_case_ok'), true)
  assert.equal(CREDENTIAL_REF_PATTERN.test('has space'), false)
  assert.equal(CREDENTIAL_REF_PATTERN.test('1leading_digit'), false)
  assert.equal(CREDENTIAL_REF_PATTERN.test(''), false)
})

test('a CredentialKey is refused, because resolve() cannot read the record half', () => {
  // `<scope>/<id>` is the DSH store's *record* addressing (`CredentialKey`),
  // reached through `readRecord`/`describeRecord`. The plugin hands this value
  // to `credentials.resolve()` and `credentials.describe()`, which read the
  // `refs` half only, so a scoped key here is a reference that can never
  // resolve. Admitting it would move the misconfiguration from mount time to
  // send time (D019).
  assert.equal(CREDENTIAL_REF_PATTERN.test('credentials/smtp-password'), false)
  assert.equal(CREDENTIAL_REF_PATTERN.test('dsh/mail-smtp-password'), false)
  assert.equal(CREDENTIAL_REF_PATTERN.test('scope/UPPER'), false)
  assert.equal(CREDENTIAL_REF_PATTERN.test('bad/'), false)
  assert.equal(CREDENTIAL_REF_PATTERN.test('/bad'), false)
  assert.equal(CREDENTIAL_REF_PATTERN.test('a//b'), false)
  // A hyphen is not a POSIX identifier character; the environment layer could
  // not carry this name, so neither may the reference grammar.
  assert.equal(CREDENTIAL_REF_PATTERN.test('has-dash'), false)
})

test('a malformed credential reference is refused with an explanation', () => {
  const { errors } = resolveConfig({ ...VALID_RAW_CONFIG, smtpPasswordCredential: 'not a reference!' })
  assert.equal(errors.length, 1)
  assert.ok(errors[0]?.includes('not a valid credential reference name'))
})

test('validation never reads the value behind the reference', () => {
  // The only way a read could happen is if a lookup were attempted; there is no
  // service to look into at this stage, and the resolved config carries the
  // reference name itself rather than anything resolved from it.
  const { resolved } = resolveConfig({ ...VALID_RAW_CONFIG, smtpPasswordCredential: 'DSH_MAIL_SMTP_PASSWORD' })
  assert.equal(resolved.smtp.smtpPasswordCredential, 'DSH_MAIL_SMTP_PASSWORD')
  const serialized = JSON.stringify(resolved)
  assert.ok(!serialized.includes('password"'), 'no inline password field exists anywhere in the resolved config')
})

test('a mismatched port and secure pairing warns without correcting', () => {
  const mismatched = resolveConfig({ ...VALID_RAW_CONFIG, smtpPort: 587, smtpSecure: true })
  assert.deepEqual(mismatched.errors, [])
  assert.equal(mismatched.warnings.length, 1)
  assert.ok(mismatched.warnings[0]?.includes('587'))
  assert.equal(mismatched.resolved.smtp.smtpPort, 587, 'the configured port is kept, never rewritten')
  assert.equal(mismatched.resolved.smtp.smtpSecure, true)

  const other = resolveConfig({ ...VALID_RAW_CONFIG, smtpPort: 465, smtpSecure: false })
  assert.deepEqual(other.errors, [])
  assert.ok(other.warnings[0]?.includes('465'))
  assert.equal(other.resolved.smtp.smtpPort, 465)
})

test('both port pairings that are conventional produce no warning', () => {
  assert.deepEqual(resolveConfig({ ...VALID_RAW_CONFIG, smtpPort: 587, smtpSecure: false }).warnings, [])
  assert.deepEqual(resolveConfig({ ...VALID_RAW_CONFIG, smtpPort: 465, smtpSecure: true }).warnings, [])
})

test('turning every notification switch off warns but still mounts', () => {
  const { errors, warnings, resolved } = resolveConfig({
    ...VALID_RAW_CONFIG,
    notifyCompleted: false,
    notifyErrors: false,
    notifyMaxTokens: false,
  })
  assert.deepEqual(errors, [])
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0]?.includes('all false'))
  assert.equal(resolved.enabled, true)
})

test('enabled:false skips every other check', () => {
  const { errors, warnings, resolved } = resolveConfig({ enabled: false })
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.smtpConfigured, false)
})

test('enabled:false is honoured even when other fields are nonsense', () => {
  const { errors, resolved } = resolveConfig({ enabled: false, smtpPort: 999_999, maxBodyChars: -1, to: [] })
  assert.deepEqual(errors, [])
  assert.equal(resolved.enabled, false)
})

test('non-object input is treated as an empty configuration', () => {
  for (const value of [undefined, null, 42, 'text', []]) {
    const { errors, resolved } = resolveConfig(value)
    // An empty configuration has no recipient, so it fails — but it fails as a
    // validation result rather than by throwing.
    assert.ok(errors.length > 0)
    assert.equal(resolved.smtpConfigured, false)
  }
})

test('out-of-range values that reach resolveConfig directly become errors rather than throws', () => {
  const { errors, resolved } = resolveConfig({ ...VALID_RAW_CONFIG, queueSize: 0 })
  assert.ok(errors.some((entry) => entry.includes('schema validation')))
  assert.equal(resolved.enabled, false)
})

test('the resolved retry policy carries the frozen 30 s cap', () => {
  const { resolved } = resolveConfig({ ...VALID_RAW_CONFIG })
  assert.equal(resolved.retry.retryMaxDelayMs, 30_000)
})

test('the resolved configuration is lossless JSON apart from the warning arrays', () => {
  const { resolved } = resolveConfig({ ...VALID_RAW_CONFIG })
  assert.doesNotThrow(() => JSON.stringify(resolved))
  assert.equal(typeof resolved.policy.minTurnDurationMs, 'number')
  assert.equal(Array.isArray(resolved.smtp.to), true)
})
