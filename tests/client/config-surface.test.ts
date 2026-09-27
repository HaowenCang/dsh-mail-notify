/**
 * The Host/Web configuration-surface parity invariant — matrix rows PAR-01 …
 * PAR-06, plus the Reset-coverage rows RST-01 … RST-05.
 *
 * ## Why this file exists
 *
 * A release-candidate browser smoke once counted 23 labelled controls on the
 * expanded card and reported the configuration surface as complete. The count
 * was right and the conclusion was wrong: the card rendered **22** Config
 * controls beside the write-only password control, and the one Config field it
 * omitted — `minTurnDurationMs` — was invisible to a test that counted controls.
 *
 * The defect was not a missing field. It was a missing *invariant*: nothing
 * compared the card's field table against the Host's, so a field could be added
 * to the schema and never reach the form as long as no test named it. The
 * comparison below is that invariant, and it is stated as a key-set equality
 * over both sides rather than as a count, so it cannot be satisfied by a
 * coincidence between two numbers.
 *
 * ## What is derived, and from where
 *
 * The Host side is read from `Config.toJSON()` by `tests/support/host-fields.ts`
 * — the same `{ uid, refs }` table `dsh-settings` walks to recover field names.
 * No handwritten list of field names appears on either side of the comparison,
 * because a second list is a second thing to forget to update.
 *
 * The one deliberate exclusion in this file is the **password**: it is a
 * Credential value written through the `credentials` domain, not a Config field,
 * so it is compared against the credential reference control's *identity* rather
 * than against the Config key set.
 *
 * @module dsh-mail-notify/tests/client/config-surface
 */

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { ALL_FIELDS, CREDENTIAL_REF_FIELD } from '../../src/client/fields.ts'
import { compareFieldSets, hostConfigFields, hostConfigFieldNames, webFieldNames } from '../support/host-fields.ts'
import { click, fakeHost, mountCard, settle, type, type FakeHost, type Mounted } from './support/dom.ts'

/** Stage a mounted card with its host facts settled, released when the test ends. */
async function mountedCard(t: TestContext, host: FakeHost = fakeHost()): Promise<{ host: FakeHost; mounted: Mounted }> {
  const mounted = await mountCard(host)
  t.after(() => {
    mounted.unmount()
    mounted.card.dispose()
  })
  await settle(mounted)
  return { host, mounted }
}

/**
 * A host whose composition layer carries the schema's own default for the
 * suppression threshold, and whose user layer carries an override of 60 000 ms.
 *
 * Both assignments happen before the card is mounted, because the controller
 * reads one snapshot at construction; seeding afterwards would describe a host
 * nobody asked it to render. The composition layer is seeded explicitly because
 * this fake applies no schema defaults of its own: an `unset` reveals what the
 * layers below hold, and `minTurnDurationMs: 0` is what a real profile shows
 * once the override is gone.
 *
 * @returns the seeded fake host.
 */
function seededHost(): FakeHost {
  const host = fakeHost()
  host.base.minTurnDurationMs = 0
  host.seedUser({ minTurnDurationMs: 60_000 })
  return host
}

/** Every control the expanded card renders, by the `name` attribute it carries. */
function controlNames(mounted: Mounted): string[] {
  return [...mounted.container.querySelectorAll('input, select, textarea')].map(
    (control) => control.getAttribute('name') ?? '',
  )
}

/** The per-field Reset control for one field, if the card rendered one. */
function resetButton(mounted: Mounted, field: string): HTMLButtonElement | null {
  return mounted.container.querySelector<HTMLButtonElement>(`button[data-action="reset-field"][data-field="${field}"]`)
}

/* ── The parity invariant ──────────────────────────────────────────────── */

test('PAR-01 the Web field set equals the Host Config field set, in both directions', () => {
  const host = hostConfigFieldNames()
  const web = webFieldNames(ALL_FIELDS)
  const parity = compareFieldSets(host, web)

  // Reported one direction at a time: a Host field with no control is a setting
  // the operator cannot reach, while a control with no Host field stages a write
  // the Host refuses. They are different defects and must not collapse into one
  // "the sets differ" message.
  assert.deepEqual(parity.missingFromWeb, [], 'the Host declares fields the Web form does not expose')
  assert.deepEqual(parity.unknownToHost, [], 'the Web form exposes fields the Host does not declare')
  assert.deepEqual(parity.duplicatedInWeb, [], 'the Web field table declares a field twice')
  assert.deepEqual(parity.duplicatedInHost, [], 'the Host Config declares a field twice')
  assert.deepEqual([...web].sort(), [...host].sort())
})

test('PAR-02 the parity comparison is not vacuous, and the expected size is 23', () => {
  const host = hostConfigFieldNames()
  const web = webFieldNames(ALL_FIELDS)

  // A comparison against an empty or truncated side would pass while the card
  // rendered nothing at all, so both sides are asserted to be the size the
  // shipped schema and card actually have. The number is a second, independent
  // statement about *this* release; the invariant itself remains the key-set
  // equality above, which no count can satisfy on its own.
  assert.equal(host.length, 23, 'the Host Config declares 23 fields')
  assert.equal(new Set(host).size, 23)
  assert.equal(web.length, 23, 'the Web card exposes 23 Config fields')
  assert.equal(new Set(web).size, 23)

  // The specific field the omission defect removed. Named here because the
  // count-based smoke proved unable to see it.
  assert.ok(web.includes('minTurnDurationMs'), 'the suppression threshold must be exposed')
})

test('PAR-03 every Host field is volatile, so a Web edit reaches the running plugin', () => {
  // A non-volatile field would still appear in the form and still pass a key-set
  // comparison, but a save would require a restart to take effect. The invariant
  // is only meaningful for fields the Loader applies live.
  const notVolatile = hostConfigFields()
    .filter((entry) => !entry.volatile)
    .map((entry) => entry.field)
  assert.deepEqual(notVolatile, [], 'every editable Config field must be volatile')
})

test('PAR-04 the write-only password is a credential, not a 24th Config field', () => {
  // The distinction the previous smoke conflated. `smtpPasswordCredential` is a
  // Config field — a reference *name* — and the card exposes it like any other.
  assert.ok(hostConfigFieldNames().includes(CREDENTIAL_REF_FIELD.field))
  assert.ok(webFieldNames(ALL_FIELDS).includes(CREDENTIAL_REF_FIELD.field))
  assert.equal(CREDENTIAL_REF_FIELD.kind, 'text')

  // The password itself is a separate control, and its name is deliberately not
  // a Config key: `ALL_FIELDS` must not carry it, or Reset All would stage an
  // unset for a field the Host would refuse.
  assert.equal(webFieldNames(ALL_FIELDS).includes('smtpPasswordSecret'), false)
  assert.equal(hostConfigFieldNames().includes('smtpPasswordSecret'), false)
})

test('PAR-05 the expanded card renders one control per Config field, plus the password control', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())

  const rendered = new Set(controlNames(mounted))
  const config = webFieldNames(ALL_FIELDS)
  const missing = config.filter((field) => !rendered.has(field))
  assert.deepEqual(missing, [], 'every Config field in the table must render a control')

  // The two categories are counted separately. A bare control count is not
  // evidence of completeness: 23 Config controls and 24 labelled controls with
  // the password among them are different statements, and only the first one is
  // about the configuration surface.
  const configControls = [...rendered].filter((name) => config.includes(name))
  const passwordControls = [...rendered].filter((name) => name === 'smtpPasswordSecret')
  assert.equal(configControls.length, 23, 'exactly 23 Config controls')
  assert.deepEqual(passwordControls, ['smtpPasswordSecret'], 'exactly one write-only password control')
  assert.equal(mounted.container.querySelectorAll('input[type="password"]').length, 1)
  assert.equal(configControls.length + passwordControls.length, 24)

  // The credential reference control is one of the 23 and is a text field; the
  // password control is the only password input on the card.
  const reference = mounted.field(CREDENTIAL_REF_FIELD.field)
  assert.equal(reference.getAttribute('type'), 'text')
})

test('PAR-06 the suppression threshold renders its English and Chinese label and hint', async (t) => {
  const english = await mountedCard(t)
  await click(english.mounted.toggle())
  const englishText = english.mounted.container.textContent ?? ''
  assert.ok(englishText.includes('Minimum turn duration'), 'the English label must render')
  assert.ok(
    englishText.includes('0 disables duration filtering'),
    'the English hint must state that 0 disables duration filtering',
  )
  assert.ok(
    englishText.includes('an unknown duration is never suppressed'),
    'the English hint must state that an unknown duration is not suppressed',
  )
  assert.ok(
    englishText.includes('settled Turn notifications'),
    'the English hint must say which notifications the setting applies to',
  )
  assert.ok(
    englishText.includes('Question and approval notifications ignore it'),
    'the English hint must state that the attention notifications ignore it',
  )
  // It is a text control of the numeric kind, so a draft is typed rather than
  // chosen, and it is not one of the two privacy switches.
  const control = english.mounted.field('minTurnDurationMs')
  assert.equal(control.tagName, 'INPUT')
  assert.equal(control.getAttribute('inputmode'), 'numeric')

  const chinese = await mountedCard(t, fakeHost())
  chinese.mounted.seat.setLocale('zh')
  await click(chinese.mounted.toggle())
  const chineseText = chinese.mounted.container.textContent ?? ''
  assert.ok(chineseText.includes('最短任务时长'), 'the Chinese label must render')
  assert.ok(chineseText.includes('0 表示不按耗时过滤'), 'the Chinese hint must state that 0 disables filtering')
  assert.ok(chineseText.includes('耗时未知时不抑制'), 'the Chinese hint must state that an unknown duration is not suppressed')
  assert.ok(chineseText.includes('已结算任务通知'), 'the Chinese hint must say which notifications apply')
  assert.ok(chineseText.includes('提问与批准通知不受该项影响'), 'the Chinese hint must exclude the attention notifications')
})

/* ── Reset coverage ────────────────────────────────────────────────────── */

test('RST-01 Reset All stages an unset for the suppression threshold override', async (t) => {
  const host = seededHost()
  const { mounted } = await mountedCard(t, host)
  await click(mounted.toggle())

  // The override is visible before anything is staged: the control shows the
  // user layer's value and offers a per-field Reset, which is what "overridden"
  // means on this card.
  const control = mounted.field('minTurnDurationMs') as HTMLInputElement
  assert.equal(control.value, '60000')
  assert.ok(resetButton(mounted, 'minTurnDurationMs') !== null, 'an overridden field must offer Reset')

  await click(mounted.action('reset-all'))

  // Staged, not written: a reset is destructive and Save is the confirmation.
  assert.equal(host.mutations.length, 0, 'Reset All must not write before Save')
  assert.equal(host.user.minTurnDurationMs, 60_000, 'the running document is untouched until Save')
  assert.equal(mounted.card.getSnapshot().dirty, true)

  await click(mounted.action('save'))
  await settle(mounted)

  assert.equal(host.mutations.length, 1, 'the save must land exactly once')
  const ops = host.mutations[0] ?? []
  const unsetPaths = ops
    .filter((op) => op['op'] === 'unset')
    .map((op) => (op['path'] as string[])[0])
    .sort()
  assert.deepEqual(unsetPaths, [...webFieldNames(ALL_FIELDS)].sort(), 'Reset All must unset every field it owns')
  assert.ok(unsetPaths.includes('minTurnDurationMs'), 'the staged operation must include unset ["minTurnDurationMs"]')
})

test('RST-02 after Save the user layer no longer carries the field and it re-inherits', async (t) => {
  const host = seededHost()
  const { mounted } = await mountedCard(t, host)
  await click(mounted.toggle())
  await click(mounted.action('reset-all'))
  await click(mounted.action('save'))
  await settle(mounted)

  assert.equal(Object.prototype.hasOwnProperty.call(host.user, 'minTurnDurationMs'), false, 'the user layer must lose the entry')
  assert.equal(host.section.minTurnDurationMs, 0, 'the effective value re-inherits the composition layer')
  assert.equal((mounted.field('minTurnDurationMs') as HTMLInputElement).value, '0', 'the control shows the inherited value')
  assert.ok(mounted.container.textContent?.includes('inherited'), 'the field reports itself as inherited again')
})

test('RST-03 the field Reset removes the same override, with the same re-inheritance', async (t) => {
  const host = seededHost()
  const { mounted } = await mountedCard(t, host)
  await click(mounted.toggle())

  const reset = resetButton(mounted, 'minTurnDurationMs')
  assert.ok(reset !== null, 'the overridden field must offer Reset')
  await click(reset)
  await click(mounted.action('save'))
  await settle(mounted)

  assert.equal(host.mutations.length, 1)
  assert.deepEqual(host.mutations[0], [{ op: 'unset', path: ['minTurnDurationMs'] }], 'Reset stages exactly this field')
  assert.equal(Object.prototype.hasOwnProperty.call(host.user, 'minTurnDurationMs'), false)
  assert.equal(host.section.minTurnDurationMs, 0)
  assert.equal((mounted.field('minTurnDurationMs') as HTMLInputElement).value, '0')
  assert.equal(resetButton(mounted, 'minTurnDurationMs'), null, 'an inherited field offers no Reset')
})

test('RST-04 an edited threshold saves as a number and is reported as overridden', async (t) => {
  const host = fakeHost()
  host.base.minTurnDurationMs = 0
  const { mounted } = await mountedCard(t, host)
  await click(mounted.toggle())

  const control = mounted.field('minTurnDurationMs') as HTMLInputElement
  await type(control, '60000')
  await click(mounted.action('save'))
  await settle(mounted)

  assert.equal(host.mutations.length, 1)
  assert.deepEqual(host.mutations[0], [{ op: 'set', path: ['minTurnDurationMs'], value: 60_000 }], 'the draft is staged as a number')
  assert.equal(host.user.minTurnDurationMs, 60_000)
  assert.equal((mounted.field('minTurnDurationMs') as HTMLInputElement).value, '60000')
  assert.ok(resetButton(mounted, 'minTurnDurationMs') !== null, 'a saved override offers Reset')
})

test('RST-05 a draft outside the declared bounds is refused and blocks the save', async (t) => {
  const host = fakeHost()
  const { mounted } = await mountedCard(t, host)
  await click(mounted.toggle())

  const control = mounted.field('minTurnDurationMs') as HTMLInputElement
  await type(control, '3600001')
  const refusal = mounted.container.querySelector('[data-field-invalid="minTurnDurationMs"]')
  assert.ok(refusal !== null, 'the out-of-range draft must be refused')
  assert.ok((refusal.textContent ?? '').includes('3600000'), 'the refusal must name the upper bound')
  assert.equal(mounted.card.getSnapshot().invalid, true)

  await click(mounted.action('save'))
  await settle(mounted)
  assert.equal(host.mutations.length, 0, 'an invalid draft must never reach the Host')

  // The lower bound is a legal value, so 0 is accepted — it is the documented
  // "no duration filtering" state rather than an empty draft.
  await type(control, '0')
  await click(mounted.action('save'))
  await settle(mounted)
  assert.equal(host.mutations.length, 1)
  assert.deepEqual(host.mutations[0], [{ op: 'set', path: ['minTurnDurationMs'], value: 0 }])
})
