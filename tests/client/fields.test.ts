/**
 * Unit tests for the card's field table.
 *
 * The conversions are pure, so they are tested directly rather than through a
 * rendered control: a rule asserted here is the same rule the control applies,
 * because the control calls these functions.
 *
 * @module dsh-mail-notify/tests/client/fields
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALL_FIELDS,
  CREDENTIAL_REF_FIELD,
  DELIVERY_FIELDS,
  GENERAL_FIELDS,
  MESSAGE_FIELDS,
  NOTIFICATION_FIELDS,
  SMTP_FIELDS,
  credentialRefFrom,
  formatField,
  parseField,
  type FieldDef,
} from '../../src/client/fields.ts'

/** Find one field by name, failing loudly when the table lost it. */
function field(name: string): FieldDef {
  const found = ALL_FIELDS.find((entry) => entry.field === name)
  assert.ok(found !== undefined, `${name} must be in the field table`)
  return found
}

test('FLD-01 the table covers exactly the namespace the host registers', () => {
  // The card edits one settings namespace, and every field that namespace owns
  // must have a control: a field the host accepts but the card cannot reach
  // would be configurable only by hand-editing settings.yaml, which is the
  // outcome this surface exists to remove.
  assert.deepEqual(
    ALL_FIELDS.map((entry) => entry.field).sort(),
    [
      'enabled',
      'from',
      'includeFooter',
      'includeMetadata',
      'includeSubagents',
      'includeUserPrompt',
      'maxBodyChars',
      'maxDedupeEntries',
      'notifyApprovals',
      'notifyCompleted',
      'notifyErrors',
      'notifyMaxTokens',
      'notifyQuestions',
      'queueSize',
      'retryAttempts',
      'retryBaseDelayMs',
      'smtpHost',
      'smtpPasswordCredential',
      'smtpPort',
      'smtpSecure',
      'smtpUser',
      'to',
    ],
  )
})

test('FLD-02 the two human-attention switches are the prominent ones', () => {
  const privacy = NOTIFICATION_FIELDS.filter((entry) => entry.privacy === true).map((entry) => entry.field)
  assert.deepEqual(privacy, ['notifyQuestions', 'notifyApprovals'])
  // They lead their group, so the block the card renders from this table is the
  // block a reader sees first.
  assert.deepEqual(
    NOTIFICATION_FIELDS.slice(0, 2).map((entry) => entry.field),
    ['notifyQuestions', 'notifyApprovals'],
  )
})

test('FLD-03 every declared numeric bound is an integer pair in ascending order', () => {
  for (const def of [...GENERAL_FIELDS, ...SMTP_FIELDS, ...MESSAGE_FIELDS, ...DELIVERY_FIELDS]) {
    if (def.kind !== 'natural') continue
    assert.ok(def.min !== undefined && def.max !== undefined, `${def.field} must declare both bounds`)
    assert.ok(Number.isSafeInteger(def.min) && Number.isSafeInteger(def.max))
    assert.ok(def.min < def.max, `${def.field} bounds must ascend`)
  }
})

test('FLD-04 an absent value formats as the empty draft for every kind', () => {
  // The empty draft is the control's "inherit" state, so it must be reachable
  // from the stored layer rather than produced by a special case per kind.
  for (const def of ALL_FIELDS) {
    assert.equal(formatField(def, undefined), '', `${def.field} must format undefined as empty`)
    assert.equal(formatField(def, null), '', `${def.field} must format null as empty`)
  }
})

test('FLD-05 formatting renders only values of the field own kind', () => {
  assert.equal(formatField(field('enabled'), true), 'true')
  assert.equal(formatField(field('enabled'), false), 'false')
  // A string where a boolean belongs is not coerced into one.
  assert.equal(formatField(field('enabled'), 'true'), 'false')
  assert.equal(formatField(field('smtpPort'), 465), '465')
  assert.equal(formatField(field('smtpPort'), '465'), '')
  assert.equal(formatField(field('smtpHost'), 'smtp.example.com'), 'smtp.example.com')
  assert.equal(formatField(field('to'), ['a@b.co', 'c@d.co']), 'a@b.co, c@d.co')
  assert.equal(formatField(field('to'), 'a@b.co'), '')
})

test('FLD-06 an empty draft stages a clear rather than an empty value', () => {
  for (const def of ALL_FIELDS) {
    assert.deepEqual(parseField(def, ''), { kind: 'clear' }, `${def.field} must clear on an empty draft`)
    assert.deepEqual(parseField(def, '   '), { kind: 'clear' }, `${def.field} must clear on a blank draft`)
  }
})

test('FLD-07 a boolean draft accepts exactly two spellings', () => {
  const def = field('notifyQuestions')
  assert.deepEqual(parseField(def, 'true'), { kind: 'value', value: true })
  assert.deepEqual(parseField(def, 'false'), { kind: 'value', value: false })
  for (const refused of ['TRUE', 'yes', '1', 'on']) {
    assert.equal(parseField(def, refused).kind, 'invalid', `${refused} must be refused`)
  }
})

test('FLD-08 a numeric draft enforces the declared bounds', () => {
  const port = field('smtpPort')
  assert.deepEqual(parseField(port, '465'), { kind: 'value', value: 465 })
  for (const refused of ['0', '65536', '-1', '4.5', '465px', '']) {
    const parsed = parseField(port, refused)
    // The empty draft is the documented clear; everything else is refused.
    assert.equal(parsed.kind, refused === '' ? 'clear' : 'invalid', `${refused} must not become a value`)
  }
  const retries = field('retryAttempts')
  assert.deepEqual(parseField(retries, '0'), { kind: 'value', value: 0 })
  assert.equal(parseField(retries, '11').kind, 'invalid')
})

test('FLD-09 a recipient draft splits on commas, semicolons, and new lines', () => {
  const to = field('to')
  assert.deepEqual(parseField(to, 'a@b.co, c@d.co'), { kind: 'value', value: ['a@b.co', 'c@d.co'] })
  assert.deepEqual(parseField(to, 'a@b.co\nc@d.co'), { kind: 'value', value: ['a@b.co', 'c@d.co'] })
  assert.deepEqual(parseField(to, 'a@b.co; c@d.co'), { kind: 'value', value: ['a@b.co', 'c@d.co'] })
  // Blanks between separators are dropped rather than carried as empty entries.
  assert.deepEqual(parseField(to, 'a@b.co, , c@d.co'), { kind: 'value', value: ['a@b.co', 'c@d.co'] })
})

test('FLD-10 a malformed recipient is refused with the offending entry named', () => {
  const parsed = parseField(field('to'), 'a@b.co, nonsense')
  assert.equal(parsed.kind, 'invalid')
  // The refusal is carried as copy plus parameters, not as a finished sentence:
  // the sentence is composed at render time so it follows the active locale.
  assert.ok(parsed.kind === 'invalid')
  assert.equal(parsed.reason.key, 'validation.badAddress')
  assert.ok(String(parsed.reason.params.addresses).includes('nonsense'))
})

test('FLD-10b every refusal names the field by locale key, never by English text', () => {
  // A refusal that baked in the English label would stay English after a
  // language switch, and would print a stale label if the field were renamed.
  for (const name of ['smtpPort', 'notifyQuestions', 'maxBodyChars']) {
    const def = field(name)
    const parsed = parseField(def, 'not-a-value')
    assert.equal(parsed.kind, 'invalid')
    assert.ok(parsed.kind === 'invalid')
    assert.equal(parsed.reason.params.label, def.labelKey)
  }
})

test('FLD-10c the numeric refusals distinguish unparsable and out-of-bounds', () => {
  // A draft that is not a number at all and a draft that is a number outside
  // the declared range are different mistakes, and the copy says which.
  const port = field('smtpPort')
  const notANumber = parseField(port, 'abc')
  assert.ok(notANumber.kind === 'invalid')
  assert.equal(notANumber.reason.key, 'validation.wholeNumber')

  const tooSmall = parseField(port, '0')
  assert.ok(tooSmall.kind === 'invalid')
  assert.equal(tooSmall.reason.key, 'validation.atLeast')
  assert.equal(tooSmall.reason.params.min, 1)

  const tooLarge = parseField(port, '65536')
  assert.ok(tooLarge.kind === 'invalid')
  assert.equal(tooLarge.reason.key, 'validation.atMost')
  assert.equal(tooLarge.reason.params.max, 65535)
})

test('FLD-11 the credential reference falls back to the documented default', () => {
  assert.equal(credentialRefFrom('MY_REF'), 'MY_REF')
  assert.equal(credentialRefFrom('  MY_REF  '), 'MY_REF')
  assert.equal(credentialRefFrom(undefined), 'DSH_MAIL_SMTP_PASSWORD')
  assert.equal(credentialRefFrom(''), 'DSH_MAIL_SMTP_PASSWORD')
  assert.equal(credentialRefFrom(42), 'DSH_MAIL_SMTP_PASSWORD')
  // The control is a reference NAME; the password never appears in the table.
  assert.equal(CREDENTIAL_REF_FIELD.kind, 'text')
  assert.equal(CREDENTIAL_REF_FIELD.field, 'smtpPasswordCredential')
})
