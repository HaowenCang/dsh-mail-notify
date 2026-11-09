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
  ADVANCED_FIELDS,
  ALL_FIELDS,
  CREDENTIAL_REF_FIELD,
  ENABLED_FIELD,
  EVENT_FIELDS,
  QUIET_FIELDS,
  SMTP_FIELDS,
  SMTP_PRESETS,
  credentialRefFrom,
  formatField,
  isFilled,
  parseField,
  type FieldDef,
} from '../../src/client/fields.ts'
import { compareFieldSets, hostConfigFieldNames, hostConfigFields, webFieldNames } from '../support/host-fields.ts'

/** Find one field by name, failing loudly when the table lost it. */
function field(name: string): FieldDef {
  const found = ALL_FIELDS.find((entry) => entry.field === name)
  assert.ok(found !== undefined, `${name} must be in the field table`)
  return found
}

test('mute list drafts use newlines and preserve punctuation within paths and session IDs', () => {
  for (const name of ['mutedWorkspaces', 'mutedSessions']) {
    const def = field(name)
    assert.equal(def.kind, 'lines')
    const entries = ['C:\\Work, One; Two', 'session-with,comma;semi']
    assert.equal(formatField(def, entries), entries.join('\n'))
    assert.deepEqual(parseField(def, ` ${entries[0]} \r\n\n ${entries[1]} `), { kind: 'value', value: entries })
    assert.deepEqual(parseField(def, '\n \r\n'), { kind: 'clear' })
    assert.deepEqual(parseField(def, '[]'), { kind: 'value', value: [] })
  }
})

test('FLD-01 the table covers exactly the namespace the host registers', () => {
  // The card edits one settings namespace, and every field that namespace owns
  // must have a control: a field the host accepts but the card cannot reach
  // would be configurable only by hand-editing settings.yaml, which is the
  // outcome this surface exists to remove.
  //
  // The expected set is read from the Host Config's own serialized form rather
  // than restated here. A second handwritten list would pass while the schema
  // and the card drifted together — which is precisely the shape of the defect
  // this row exists to catch.
  const parity = compareFieldSets(hostConfigFieldNames(), webFieldNames(ALL_FIELDS))
  assert.deepEqual(parity.missingFromWeb, [], 'every Host Config field must have a control')
  assert.deepEqual(parity.unknownToHost, [], 'the card must not invent a Config field')
  assert.deepEqual(parity.duplicatedInWeb, [], 'a field may not appear twice in the table')
  assert.deepEqual(parity.duplicatedInHost, [], 'the Host schema may not declare a field twice')
})

test('FLD-01b the suppression threshold is a bounded natural field of the quiet-rules group', () => {
  // Its bounds mirror the Host schema's `.min(0).max(3_600_000)`; it is a policy
  // field, not one of the two privacy switches.
  const def = field('minTurnDurationMs')
  assert.equal(def.kind, 'natural')
  assert.equal(def.min, 0)
  assert.equal(def.max, 3_600_000)
  assert.equal(def.unitKey, 'unitMs', 'a millisecond value must say so next to the control')
  assert.equal(def.privacy, undefined, 'the suppression threshold is not a privacy decision')
  assert.deepEqual(QUIET_FIELDS.map((entry) => entry.field), ['minTurnDurationMs', 'mutedWorkspaces', 'mutedSessions'])
})

test('FLD-02 the two human-attention switches are the privacy pair, adjacent in the events group', () => {
  const privacy = EVENT_FIELDS.filter((entry) => entry.privacy === true).map((entry) => entry.field)
  assert.deepEqual(privacy, ['notifyQuestions', 'notifyApprovals'])
  // Adjacent, so the privacy note the page renders after the second one sits
  // next to exactly the two switches it is about.
  const names = EVENT_FIELDS.map((entry) => entry.field)
  assert.equal(names.indexOf('notifyApprovals'), names.indexOf('notifyQuestions') + 1)
  assert.equal(ENABLED_FIELD.field, 'enabled')
  assert.equal(ALL_FIELDS[0], ENABLED_FIELD, 'the master switch renders first')
})

test('FLD-02b the rarely-changed tuning lives under Advanced, and only there', () => {
  assert.deepEqual(ADVANCED_FIELDS.map((entry) => entry.field), [
    'smtpPasswordCredential',
    'maxBodyChars',
    'queueSize',
    'retryAttempts',
    'retryBaseDelayMs',
    'maxDedupeEntries',
  ])
})

test('FLD-02c fallbacks and bounds mirror the Host schema exactly', () => {
  const host = new Map(hostConfigFields().map((entry) => [entry.field, entry]))
  for (const def of ALL_FIELDS) {
    const declared = host.get(def.field)
    assert.ok(declared !== undefined, `${def.field} must be a Host field`)
    assert.deepEqual(def.fallback, declared.defaultValue, `${def.field} default must match the schema`)
    if (def.kind === 'natural') {
      assert.equal(def.min, declared.min, `${def.field} min must match the schema`)
      assert.equal(def.max, declared.max, `${def.field} max must match the schema`)
    }
  }
})

test('FLD-02d exactly the fields the Host requires while enabled are marked required', () => {
  // `config-check.ts` refuses an enabled configuration without these four.
  assert.deepEqual(
    ALL_FIELDS.filter((entry) => entry.required === true).map((entry) => entry.field),
    ['smtpHost', 'smtpUser', 'from', 'to'],
  )
  assert.equal(isFilled(field('smtpHost'), ''), false)
  assert.equal(isFilled(field('smtpHost'), '  '), false)
  assert.equal(isFilled(field('smtpHost'), 'smtp.example.com'), true)
  assert.equal(isFilled(field('to'), []), false)
  assert.equal(isFilled(field('to'), ['a@b.co']), true)
})

test('FLD-02e every quick-fill preset is a plausible SSL/TLS endpoint', () => {
  assert.ok(SMTP_PRESETS.length > 0)
  for (const preset of SMTP_PRESETS) {
    assert.match(preset.host, /^smtp\.[a-z0-9.-]+\.[a-z]+$/)
    assert.equal(preset.port, 465)
    assert.equal(preset.secure, true)
  }
})

test('FLD-03 every declared numeric bound is an integer pair in ascending order', () => {
  for (const def of ALL_FIELDS) {
    if (def.kind !== 'natural') continue
    assert.ok(def.min !== undefined && def.max !== undefined, `${def.field} must declare both bounds`)
    assert.ok(Number.isSafeInteger(def.min) && Number.isSafeInteger(def.max))
    assert.ok(def.min < def.max, `${def.field} bounds must ascend`)
  }
  assert.ok(SMTP_FIELDS.some((entry) => entry.field === 'smtpPort'))
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
  assert.ok(parsed.kind === 'invalid' && parsed.message.includes('nonsense'))
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
