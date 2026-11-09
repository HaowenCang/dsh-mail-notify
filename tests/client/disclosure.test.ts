/**
 * Regression coverage for the settings page's layout and its one disclosure —
 * the collapsed Advanced section — plus the status panel's save boundary and
 * the page's setup guidance.
 *
 * The page lives in the DSH Settings window as its own section, so the everyday
 * form is always on screen; only rarely-changed tuning sits behind the
 * Advanced disclosure. Collapsing it must be a presentation change only: no
 * staged edit, no in-flight operation, and no operation result may be lost
 * because part of the form left the layout. These tests pin that boundary by
 * driving a mounted page and reading the DOM back.
 *
 * ## Keyboard rows (COL-06)
 *
 * jsdom implements pointer activation (`click()`) but not the native Enter/Space
 * activation behavior of buttons, so a synthetic `KeyboardEvent` here would
 * prove nothing. The test therefore pins the semantic prerequisite — the
 * control is a native `<button type="button">`, whose Enter and Space
 * activation is the browser's own default behavior.
 *
 * @module dsh-mail-notify/tests/client/disclosure
 */

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { act } from 'react'
import { ADVANCED_FIELDS } from '../../src/client/fields.ts'
import {
  choose,
  click,
  emptyHost,
  fakeHost,
  mountCard,
  setSwitch,
  settle,
  type,
  type FakeHost,
  type Mounted,
} from './support/dom.ts'
import { createLocaleSeat } from './support/seat.ts'

/**
 * Stage a fresh mounted page with its host facts settled, released when the
 * test ends (the view's status poll holds a timer until its effect cleans up).
 */
async function mountedCard(t: TestContext, host: FakeHost = fakeHost(), locale = 'en'): Promise<{ host: FakeHost; mounted: Mounted }> {
  const mounted = await mountCard(host, createLocaleSeat(locale))
  t.after(() => {
    mounted.unmount()
    mounted.card.dispose()
  })
  await settle(mounted)
  return { host, mounted }
}

/** The names of every control currently in the layout. */
function controlNames(mounted: Mounted): string[] {
  return [...mounted.container.querySelectorAll('input, select, textarea')].map((control) => control.getAttribute('name') ?? '')
}

/** The status panel's "Emails are sent for: …" line. */
function effectiveLine(mounted: Mounted): string {
  const line = mounted.container.querySelector('[data-effective]')
  assert.ok(line !== null, 'the status panel must report which events send mail')
  return line.textContent ?? ''
}

/** The status headline. */
function headline(mounted: Mounted): string {
  return mounted.container.querySelector('[data-summary]')?.textContent ?? ''
}

/** A switch control by field name. */
function switchOf(mounted: Mounted, name: string): HTMLInputElement {
  const control = mounted.field(name) as HTMLInputElement
  assert.equal(control.type, 'checkbox', `${name} must render as a switch`)
  assert.equal(control.getAttribute('role'), 'switch')
  return control
}

/**
 * Save both privacy switches on, so the running configuration and the user
 * layer carry `true` for questions and approvals.
 */
async function saveBothSwitchesOn(host: FakeHost, mounted: Mounted): Promise<void> {
  await setSwitch(switchOf(mounted, 'notifyQuestions'), true)
  await setSwitch(switchOf(mounted, 'notifyApprovals'), true)
  await click(mounted.action('save'))
  await settle(mounted)
  assert.equal(host.mutations.length, 1, 'the switch-on save must land')
  assert.equal(host.user.notifyQuestions, true)
  assert.equal(host.user.notifyApprovals, true)
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

test('PAGE-01 the everyday form is on screen without expanding anything; Advanced starts collapsed', async (t) => {
  const { mounted } = await mountedCard(t)
  const names = new Set(controlNames(mounted))
  for (const name of ['enabled', 'notifyCompleted', 'notifyQuestions', 'smtpHost', 'smtpPasswordSecret', 'to', 'includeMetadata', 'minTurnDurationMs', 'mutedSessions']) {
    assert.ok(names.has(name), `${name} must be on the page without any expansion`)
  }
  for (const def of ADVANCED_FIELDS) {
    assert.equal(names.has(def.field), false, `${def.field} belongs under the collapsed Advanced section`)
  }
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'false')
  assert.equal(mounted.region().hasAttribute('hidden'), true)
  assert.ok(mounted.container.querySelector('[data-savebar]') !== null, 'the page must render its save bar')
})

test('PAGE-02 the page leads with its title, an introduction, and the status panel', async (t) => {
  const { mounted } = await mountedCard(t)
  const heading = mounted.container.querySelector('h2')
  assert.equal(heading?.textContent, 'Email notifications')
  assert.ok((mounted.container.textContent ?? '').includes('Changes take effect after you click Save'))
  assert.ok(mounted.container.querySelector('[data-group="status"]') !== null)
})

/* ── The Advanced disclosure ────────────────────────────────────────────── */

test('COL-03/04/05 the Advanced disclosure expands and collapses, and aria-expanded tracks it', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'true')
  assert.equal(mounted.region().hasAttribute('hidden'), false)
  for (const def of ADVANCED_FIELDS) mounted.field(def.field)
  mounted.action('reset-all')

  await click(mounted.toggle())
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'false')
  assert.equal(mounted.region().hasAttribute('hidden'), true)
  assert.equal(mounted.region().querySelectorAll('input, select, textarea').length, 0)
})

test('COL-06 the disclosure control is a native button (Enter/Space activation is the browser default)', async (t) => {
  const { mounted } = await mountedCard(t)
  const toggle = mounted.toggle()
  assert.equal(toggle.tagName, 'BUTTON')
  assert.equal(toggle.getAttribute('type'), 'button', 'a button inside no form must not default to submit')
  assert.equal(toggle.disabled, false)
})

test('COL-09 unsaved drafts survive collapsing and re-expanding Advanced', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())
  await type(mounted.field('queueSize') as HTMLInputElement, '42')
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.draft.invalid')
  await type(mounted.field('smtpPasswordSecret') as HTMLInputElement, 'SENTINEL-password-draft')

  await click(mounted.toggle())
  await click(mounted.toggle())

  assert.equal((mounted.field('queueSize') as HTMLInputElement).value, '42')
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.draft.invalid')
  assert.equal((mounted.field('smtpPasswordSecret') as HTMLInputElement).value, 'SENTINEL-password-draft')
})

test('COL-10 a save result survives toggling Advanced mid-save, and the save runs once', async (t) => {
  const { host, mounted } = await mountedCard(t)
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.saved.invalid')

  host.hold()
  await click(mounted.action('save'))
  await click(mounted.toggle())
  await click(mounted.toggle())
  host.release()
  await settle(mounted)

  const notice = mounted.container.querySelector('[data-notice="operation"]')
  assert.ok(notice !== null, 'the save outcome must be reported')
  assert.equal(notice.textContent, 'Saved')
  assert.equal(host.mutations.length, 1, 'the save must run exactly once')
  assert.equal(host.user.smtpHost, 'smtp.saved.invalid')
})

test('COL-11 a delivery-test result is reported once, whatever happens to Advanced meanwhile', async (t) => {
  const { host, mounted } = await mountedCard(t)

  host.hold()
  await click(mounted.action('send-test'))
  await click(mounted.toggle())
  await click(mounted.toggle())
  host.release()
  await settle(mounted)

  const result = mounted.container.querySelector('[data-notice="test-email"]')
  assert.ok(result !== null, 'the delivery-test outcome must be reported')
  assert.ok((result.textContent ?? '').includes('Test email sent'))
  assert.equal(host.rpcCalls.filter((call) => call.endpoint.endsWith('/test-email')).length, 1, 'the delivery test must run exactly once')
})

test('COL-12 the password draft is masked and never rendered as text', async (t) => {
  const { mounted } = await mountedCard(t)
  const secret = mounted.field('smtpPasswordSecret') as HTMLInputElement
  assert.equal(secret.type, 'password', 'the draft must never render as visible text')
  await type(secret, 'SENTINEL-never-rendered')

  assert.equal(mounted.container.textContent?.includes('SENTINEL-never-rendered'), false)
  for (const control of mounted.container.querySelectorAll('input, select, textarea')) {
    if (control.getAttribute('name') === 'smtpPasswordSecret') continue
    assert.notEqual((control as HTMLInputElement).value, 'SENTINEL-never-rendered')
  }
})

test('COL-13 the status headline and fact lines expose no sensitive content', async (t) => {
  const host = fakeHost()
  host.status = {
    active: true,
    smtpConfigured: true,
    credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
    queue: { depth: 3, size: 100, delivered: 9, failed: 1 },
  }
  const { mounted } = await mountedCard(t, host)
  await type(mounted.field('to') as HTMLInputElement, 'victim@example.invalid')
  await type(mounted.field('smtpUser') as HTMLInputElement, 'SENTINEL-username')
  await type(mounted.field('smtpPasswordSecret') as HTMLInputElement, 'SENTINEL-password')
  await settle(mounted)

  const panel = mounted.container.querySelector('[data-group="status"]')
  assert.ok(panel !== null)
  const text = panel.textContent ?? ''
  for (const leaked of ['victim@example.invalid', 'reader@example.invalid', 'SENTINEL-username', 'sender@example.invalid', 'SENTINEL-password', 'DSH_MAIL_SMTP_PASSWORD']) {
    assert.equal(text.includes(leaked), false, `the status panel must not expose ${leaked}`)
  }
  assert.equal(mounted.container.querySelector('[data-stats]')?.textContent, 'Sent 9 · Failed 1 · Waiting 3 (limit 100)')
})

test('COL-14 an actual component unmount keeps drafts; only discard drops them', async (t) => {
  const { mounted } = await mountedCard(t)
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.unmount.invalid')
  assert.equal(mounted.card.getSnapshot().dirty, true)
  assert.ok(mounted.container.querySelector('[data-unsaved]') !== null, 'the save bar must say there are unsaved changes')

  mounted.unmount()
  await mounted.remount()
  await settle(mounted)
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.unmount.invalid')

  await act(async () => {
    mounted.card.discard()
  })
  await settle(mounted)
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.base.invalid', 'discard is what drops staged edits')
  assert.equal(mounted.card.getSnapshot().dirty, false)
  assert.equal(mounted.container.querySelector('[data-unsaved]'), null)
})

test('per-instance disclosure ids: two mounted pages never duplicate a region id', async (t) => {
  const first = await mountCard(fakeHost())
  t.after(() => {
    first.unmount()
    first.card.dispose()
  })
  await settle(first)
  const second = await mountCard(fakeHost(), undefined, { reuseDom: true })
  t.after(() => {
    second.unmount()
    second.card.dispose()
  })
  await settle(second)

  const firstId = first.toggle().getAttribute('aria-controls')
  const secondId = second.toggle().getAttribute('aria-controls')
  assert.ok(firstId && secondId)
  assert.notEqual(firstId, secondId, 'two instances must not share a disclosure region id')
  assert.ok(first.container.contains(first.region()))
  assert.ok(second.container.contains(second.region()))
  assert.equal(first.container.contains(second.region()), false)
  for (const id of [firstId, secondId]) {
    assert.equal(document.querySelectorAll(`[id="${id}"]`).length, 1, `id ${id} must occur exactly once`)
  }
})

/* ── The status panel reports the saved configuration only ─────────────── */

test('EFF-01 the "emails are sent for" line lists the saved switches by their labels', async (t) => {
  const { mounted } = await mountedCard(t)
  // Schema defaults: completed and output-limit on, the rest off.
  assert.equal(effectiveLine(mounted), 'Emails are sent for: Task completed, Output limit reached')
})

test('EFF-02 an unsaved staged "off" never moves the effective line', async (t) => {
  const { host, mounted } = await mountedCard(t)
  await saveBothSwitchesOn(host, mounted)
  assert.ok(effectiveLine(mounted).includes('Agent asks you a question'))
  assert.ok(effectiveLine(mounted).includes('Agent needs your approval'))

  await setSwitch(switchOf(mounted, 'notifyQuestions'), false)
  await setSwitch(switchOf(mounted, 'notifyApprovals'), false)
  await settle(mounted)

  assert.equal(switchOf(mounted, 'notifyQuestions').checked, false, 'the control shows the draft')
  assert.equal(mounted.card.getSnapshot().dirty, true)
  assert.ok(effectiveLine(mounted).includes('Agent asks you a question'), 'a staged "off" must not claim questions are off')
  assert.ok(effectiveLine(mounted).includes('Agent needs your approval'))
  assert.equal(host.mutations.length, 1, 'staging edits must not write')
})

test('EFF-03 an unsaved staged Restore default never moves the effective line', async (t) => {
  const { host, mounted } = await mountedCard(t)
  await saveBothSwitchesOn(host, mounted)

  for (const field of ['notifyQuestions', 'notifyApprovals']) {
    const reset = mounted.container.querySelector<HTMLButtonElement>(`button[data-action="reset-field"][data-field="${field}"]`)
    assert.ok(reset !== null, `a changed ${field} must offer Restore default`)
    await click(reset)
  }
  await settle(mounted)

  // The controls preview the default the save will restore…
  assert.equal(switchOf(mounted, 'notifyQuestions').checked, false)
  assert.ok(mounted.container.querySelector('[data-pending-reset="notifyQuestions"]') !== null)
  // …the effective line still reports the running configuration.
  assert.ok(effectiveLine(mounted).includes('Agent asks you a question'))
  assert.equal(host.mutations.length, 1)
})

test('EFF-04 once a staged "off" is saved, the effective line follows', async (t) => {
  const { host, mounted } = await mountedCard(t)
  await saveBothSwitchesOn(host, mounted)
  await setSwitch(switchOf(mounted, 'notifyQuestions'), false)
  await setSwitch(switchOf(mounted, 'notifyApprovals'), false)
  await click(mounted.action('save'))
  await settle(mounted)

  assert.equal(host.mutations.length, 2)
  assert.equal(host.user.notifyQuestions, false)
  assert.equal(effectiveLine(mounted).includes('Agent asks you a question'), false)
  assert.equal(effectiveLine(mounted).includes('Agent needs your approval'), false)
})

test('EFF-05 the Chinese effective line follows the same save boundary', async (t) => {
  const { host, mounted } = await mountedCard(t, fakeHost(), 'zh')
  await saveBothSwitchesOn(host, mounted)
  assert.equal(effectiveLine(mounted), '会发送邮件的情况：任务完成、达到输出上限、智能体向你提问、智能体等待你批准')

  await setSwitch(switchOf(mounted, 'notifyQuestions'), false)
  await settle(mounted)
  assert.ok(effectiveLine(mounted).includes('智能体向你提问'), 'an unsaved staged "off" must not move the Chinese line')

  await click(mounted.action('save'))
  await settle(mounted)
  assert.equal(effectiveLine(mounted).includes('智能体向你提问'), false)
})

test('EFF-06 with every event switch off, the line says nothing will be sent', async (t) => {
  const host = fakeHost()
  host.seedUser({ notifyCompleted: false, notifyMaxTokens: false })
  const { mounted } = await mountedCard(t, host)
  assert.equal(effectiveLine(mounted), 'Emails are sent for: nothing — every notification type is off')
})

/* ── Setup guidance ────────────────────────────────────────────────────── */

test('GUIDE-01 a fresh install shows "setup needed" and the numbered steps, none done', async (t) => {
  const host = emptyHost()
  host.status = { active: false, smtpConfigured: false, credentialRef: 'DSH_MAIL_SMTP_PASSWORD', configError: 'smtpHost is required' }
  const { mounted } = await mountedCard(t, host)
  assert.equal(headline(mounted), 'Setup needed — fill in the sending account below')
  const steps = [...mounted.container.querySelectorAll('[data-step]')].map((step) => [step.getAttribute('data-step'), step.getAttribute('data-done')])
  assert.deepEqual(steps, [
    ['server', 'false'],
    ['account', 'false'],
    ['addresses', 'false'],
    ['test', 'false'],
  ])
  const test = mounted.action('send-test')
  assert.equal(test.disabled, true, 'a test email cannot be sent before the account is saved')
  assert.ok((mounted.container.textContent ?? '').includes('Fill in and save the sending account first.'))
})

test('GUIDE-02 the steps follow the saved account and the test result, then step aside', async (t) => {
  const host = fakeHost()
  host.credentials.DSH_MAIL_SMTP_PASSWORD = { configured: true, writable: true }
  const { mounted } = await mountedCard(t, host)
  assert.equal(headline(mounted), 'Running')
  const done = (id: string): string | null =>
    mounted.container.querySelector(`[data-step="${id}"]`)?.getAttribute('data-done') ?? null
  assert.equal(done('server'), 'true')
  assert.equal(done('account'), 'true')
  assert.equal(done('addresses'), 'true')
  assert.equal(done('test'), 'false')

  await click(mounted.action('send-test'))
  await settle(mounted)
  assert.equal(mounted.container.querySelector('[data-step]'), null, 'once every step is done the list goes away')
})

test('GUIDE-03 a missing password keeps the account step open and the headline at setup', async (t) => {
  const host = fakeHost()
  host.credentials.DSH_MAIL_SMTP_PASSWORD = { configured: false, writable: true }
  const { mounted } = await mountedCard(t, host)
  assert.equal(headline(mounted), 'Setup needed — fill in the sending account below')
  assert.equal(mounted.container.querySelector('[data-step="account"]')?.getAttribute('data-done'), 'false')
})

test('GUIDE-04 a host-reported configuration error is a headline, with the reason one click away', async (t) => {
  const host = fakeHost()
  host.credentials.DSH_MAIL_SMTP_PASSWORD = { configured: true, writable: true }
  host.status = { active: true, smtpConfigured: true, credentialRef: 'DSH_MAIL_SMTP_PASSWORD', configError: 'SENTINEL-detail' }
  const { mounted } = await mountedCard(t, host)
  assert.equal(headline(mounted), 'The saved settings could not be applied')
  const details = mounted.container.querySelector('details')
  assert.ok(details !== null)
  assert.ok((details.textContent ?? '').includes('SENTINEL-detail'))
  assert.equal(headline(mounted).includes('SENTINEL-detail'), false)
})

test('GUIDE-05 turning notifications off reports "Off" and hides the steps', async (t) => {
  const host = emptyHost()
  host.seedUser({ enabled: false })
  const { mounted } = await mountedCard(t, host)
  assert.equal(headline(mounted), 'Off — no emails will be sent')
  assert.equal(mounted.container.querySelector('[data-step]'), null)
  assert.equal(
    mounted.container.querySelector('[data-disabled-hint]')?.textContent,
    'To start: turn on the switch below, fill in the sending account, then click Save.',
    'an off page with no account says how to start',
  )
})

test('GUIDE-06 with the account already set up, the off page says the switch and Save are all that is left', async (t) => {
  const host = fakeHost()
  host.credentials.DSH_MAIL_SMTP_PASSWORD = { configured: true, writable: true }
  host.seedUser({ enabled: false })
  const { mounted } = await mountedCard(t, host)
  assert.equal(headline(mounted), 'Off — no emails will be sent')
  assert.equal(
    mounted.container.querySelector('[data-disabled-hint]')?.textContent,
    'Your sending account is set up. Turn on the switch below and click Save to start.',
  )
})

test('GUIDE-07 an enabled page shows no off-state hint', async (t) => {
  const { mounted } = await mountedCard(t, emptyHost())
  assert.equal(mounted.container.querySelector('[data-disabled-hint]'), null)
})

test('REQ-01 with notifications on, an empty required field is marked and the save is refused locally', async (t) => {
  const { host, mounted } = await mountedCard(t, emptyHost())
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.example.invalid')
  for (const field of ['smtpUser', 'from', 'to']) {
    assert.ok(mounted.container.querySelector(`[data-field-missing="${field}"]`) !== null, `${field} must be marked as missing`)
    assert.equal(mounted.field(field).getAttribute('aria-required'), 'true')
  }
  assert.equal(mounted.container.querySelector('[data-field-missing="smtpHost"]'), null, 'a filled field is not marked')

  await click(mounted.action('save'))
  await settle(mounted)
  assert.equal(host.mutations.length, 0, 'a save the Host would refuse is never sent')
  assert.equal(
    mounted.container.querySelector('[data-notice="operation"]')?.textContent,
    'Fill in the fields marked * first, or turn email notifications off.',
  )
})

test('REQ-02 turning notifications off lifts the requirement, so the switch-off can be saved', async (t) => {
  const { host, mounted } = await mountedCard(t, emptyHost())
  await setSwitch(switchOf(mounted, 'enabled'), false)
  assert.equal(mounted.container.querySelector('[data-field-missing]'), null)
  await click(mounted.action('save'))
  await settle(mounted)
  assert.deepEqual(host.mutations, [[{ op: 'set', path: ['enabled'], value: false }]])
})

test('ASSIST-01 quick fill stages a provider endpoint without saving it', async (t) => {
  const { host, mounted } = await mountedCard(t)
  await choose(mounted.field('smtpPreset') as HTMLSelectElement, '163')
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.163.com')
  assert.equal((mounted.field('smtpPort') as HTMLInputElement).value, '465')
  assert.equal((mounted.field('smtpSecure') as HTMLSelectElement).value, 'true')
  assert.equal((mounted.field('smtpPreset') as HTMLSelectElement).value, '163', 'the picker shows the provider the server now is')
  assert.equal(host.mutations.length, 0)
  assert.equal(mounted.container.querySelector('[data-port-warning]'), null, '465 with SSL/TLS is the matching pair')

  await click(mounted.action('save'))
  await settle(mounted)
  assert.equal(host.user.smtpHost, 'smtp.163.com')
  assert.equal(host.user.smtpPort, 465)
  assert.equal(host.user.smtpSecure, true)
})

test('ASSIST-02 a port and encryption that do not match are warned about, without blocking', async (t) => {
  const { mounted } = await mountedCard(t)
  await type(mounted.field('smtpPort') as HTMLInputElement, '465')
  await choose(mounted.field('smtpSecure') as HTMLSelectElement, 'false')
  const warning = mounted.container.querySelector('[data-port-warning]')
  assert.ok(warning !== null)
  assert.ok((warning.textContent ?? '').includes('Port 465 normally needs SSL/TLS'))
  assert.equal(mounted.card.getSnapshot().invalid, false, 'a warning is not a refusal')
})

test('ASSIST-03 "Same as username" copies the username into the sender address', async (t) => {
  const { mounted } = await mountedCard(t)
  await type(mounted.field('smtpUser') as HTMLInputElement, 'me@example.invalid')
  await click(mounted.action('use-username'))
  assert.equal((mounted.field('from') as HTMLInputElement).value, 'me@example.invalid')
  assert.equal(mounted.container.querySelector('[data-action="use-username"]'), null, 'nothing to copy once they match')
})

test('ASSIST-04 the test-email hint warns that unsaved changes are not tested', async (t) => {
  const { mounted } = await mountedCard(t)
  assert.ok((mounted.container.textContent ?? '').includes('using the saved settings'))
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.other.invalid')
  assert.ok((mounted.container.textContent ?? '').includes('The test uses the last saved settings'))
})

test('ASSIST-05 Save with a refused Advanced draft explains the refusal and opens Advanced', async (t) => {
  const { host, mounted } = await mountedCard(t)
  await click(mounted.toggle())
  await type(mounted.field('queueSize') as HTMLInputElement, '0')
  await click(mounted.toggle())
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'false')
  assert.equal(mounted.container.querySelector('[data-field-invalid]'), null, 'the refusal is hidden inside the collapsed region')

  const save = mounted.action('save')
  assert.equal(save.disabled, false, 'Save stays pressable so it can explain itself')
  await click(save)
  await settle(mounted)

  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'true', 'Advanced opens to show the field to fix')
  assert.ok(mounted.container.querySelector('[data-field-invalid="queueSize"]') !== null)
  assert.equal(mounted.container.querySelector('[data-notice="operation"]')?.textContent, 'Some fields need fixing before you can save.')
  assert.equal(host.mutations.length, 0)
})

/** A fresh install whose password can be set but is not yet: what a person sees on first setup. */
function freshHost(): ReturnType<typeof emptyHost> {
  const host = emptyHost()
  host.credentials.DSH_MAIL_SMTP_PASSWORD = { configured: false, writable: true }
  return host
}

test('ASSIST-06 the quick-fill picker shows what the server already is', async (t) => {
  const custom = await mountedCard(t)
  assert.equal((custom.mounted.field('smtpPreset') as HTMLSelectElement).value, 'custom', 'an unlisted server reads as entered by hand')
  const empty = await mountedCard(t, emptyHost())
  assert.equal((empty.mounted.field('smtpPreset') as HTMLSelectElement).value, '', 'no server yet: the picker invites a choice')
  await type(empty.mounted.field('smtpHost') as HTMLInputElement, ' SMTP.QQ.com ')
  assert.equal((empty.mounted.field('smtpPreset') as HTMLSelectElement).value, 'qq', 'matched without case or surrounding space')
})

test('ASSIST-07 a QQ username fills an empty server in, and says so until the server is edited', async (t) => {
  const { host, mounted } = await mountedCard(t, freshHost())
  await type(mounted.field('smtpUser') as HTMLInputElement, 'me@qq.com')
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.qq.com')
  assert.equal((mounted.field('smtpPort') as HTMLInputElement).value, '465')
  assert.equal((mounted.field('smtpSecure') as HTMLSelectElement).value, 'true')
  assert.equal(mounted.container.querySelector('[data-autofilled]')?.getAttribute('data-autofilled'), 'qq')
  assert.equal(mounted.container.querySelector('[data-secret-guide]')?.getAttribute('data-secret-guide'), 'qq')
  assert.equal(host.mutations.length, 0, 'filled in as drafts, not saved')

  await type(mounted.field('smtpPort') as HTMLInputElement, '587')
  assert.equal(mounted.container.querySelector('[data-autofilled]'), null, 'a hand edit ends the auto-filled note')
})

test('ASSIST-08 a username at another provider never overwrites a filled server; it offers a one-click switch', async (t) => {
  const host = fakeHost()
  host.credentials.DSH_MAIL_SMTP_PASSWORD = { configured: false, writable: true }
  const { mounted } = await mountedCard(t, host)
  await type(mounted.field('smtpUser') as HTMLInputElement, 'me@gmail.com')
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.base.invalid', 'the saved server is left alone')
  const suggestion = mounted.container.querySelector('[data-suggest-preset]')
  assert.equal(suggestion?.getAttribute('data-suggest-preset'), 'gmail')
  assert.ok((suggestion?.textContent ?? '').includes('smtp.gmail.com'))

  await click(mounted.action('use-preset'))
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.gmail.com')
  assert.equal(mounted.container.querySelector('[data-suggest-preset]'), null)
  assert.equal(mounted.container.querySelector('[data-secret-guide]')?.getAttribute('data-secret-guide'), 'gmail')
})

test('ASSIST-09 choosing a provider fills an empty sender with the username, and leaves a filled one alone', async (t) => {
  const empty = await mountedCard(t, emptyHost())
  await type(empty.mounted.field('smtpUser') as HTMLInputElement, 'me@corp.invalid')
  await choose(empty.mounted.field('smtpPreset') as HTMLSelectElement, 'exmail')
  assert.equal((empty.mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.exmail.qq.com')
  assert.equal((empty.mounted.field('from') as HTMLInputElement).value, 'me@corp.invalid')

  const filled = await mountedCard(t)
  const before = (filled.mounted.field('from') as HTMLInputElement).value
  await choose(filled.mounted.field('smtpPreset') as HTMLSelectElement, 'qq')
  assert.equal((filled.mounted.field('from') as HTMLInputElement).value, before)
})

test('GUIDE-08 without a saved password, the page shows step-by-step instructions for getting one', async (t) => {
  const { mounted } = await mountedCard(t, freshHost())
  const generic = mounted.container.querySelector('[data-secret-guide]')
  assert.equal(generic?.getAttribute('data-secret-guide'), 'generic')
  assert.equal(generic?.querySelectorAll('li').length, 4)
  assert.ok((generic?.textContent ?? '').includes('choose your provider under Quick fill'))
  assert.equal(generic?.querySelector('[data-guide-link]'), null, 'no provider, no link to guess')

  await choose(mounted.field('smtpPreset') as HTMLSelectElement, 'qq')
  const qq = mounted.container.querySelector('[data-secret-guide]')
  assert.equal(qq?.getAttribute('data-secret-guide'), 'qq')
  assert.ok((qq?.textContent ?? '').includes('How to get the QQ Mail authorization code'))
  assert.ok((qq?.textContent ?? '').includes('POP3/IMAP/SMTP/Exchange/CardDAV'))
  const link = qq?.querySelector('[data-guide-link]') as HTMLAnchorElement | null
  assert.equal(link?.getAttribute('href'), 'https://mail.qq.com/')
  assert.equal(link?.getAttribute('target'), '_blank')
  assert.equal(link?.getAttribute('rel'), 'noopener noreferrer')

  await choose(mounted.field('smtpPreset') as HTMLSelectElement, 'gmail')
  const gmail = mounted.container.querySelector('[data-secret-guide]')
  assert.ok((gmail?.textContent ?? '').includes('2-Step Verification'))
  assert.equal(gmail?.querySelector('[data-guide-link]')?.getAttribute('href'), 'https://myaccount.google.com/apppasswords')
})

test('GUIDE-09 once a password is saved, the instructions fold away behind one link', async (t) => {
  const host = fakeHost()
  host.credentials.DSH_MAIL_SMTP_PASSWORD = { configured: true, writable: true }
  const { mounted } = await mountedCard(t, host)
  const fold = mounted.container.querySelector('[data-secret-guide-fold]') as HTMLDetailsElement | null
  assert.ok(fold !== null)
  assert.equal(fold.open, false)
  assert.equal(fold.querySelector('summary')?.textContent, 'How do I get a new one?')
  assert.ok(fold.querySelector('[data-secret-guide]') !== null)
})

test('GUIDE-10 where the password cannot be changed, no instructions for getting one are shown', async (t) => {
  const { mounted } = await mountedCard(t, emptyHost())
  assert.equal(mounted.container.querySelector('[data-secret-guide]'), null)
})
