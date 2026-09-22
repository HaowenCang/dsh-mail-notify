/**
 * Regression coverage for the card's disclosure contract — matrix rows
 * COL-01 … COL-14.
 *
 * The card must be collapsible so one plugin's configuration cannot occupy the
 * whole Settings page, and collapsing must be a presentation change only: no
 * staged edit, no in-flight operation, and no operation result may be lost
 * because the form body left the layout. These tests pin that boundary by
 * driving a mounted card and reading the DOM back.
 *
 * ## Keyboard rows (COL-06, COL-07)
 *
 * jsdom implements pointer activation (`click()`) but not the native Enter/Space
 * activation behavior of buttons, so a synthetic `KeyboardEvent` here would
 * prove nothing: dispatching one does not run the browser's default activation,
 * and calling `.click()` after it would only prove `.click()`. The two tests
 * therefore pin the semantic prerequisite — the control is a native
 * `<button type="button">`, whose Enter and Space activation is the browser's
 * own default behavior — and the real-browser run records the activation
 * itself (see `MIMO_V2_6_PRO_EVAL.md`, "native Enter/Space smoke").
 *
 * @module dsh-mail-notify/tests/client/disclosure
 */

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { act } from 'react'
import { choose, click, fakeHost, mountCard, settle, type, type FakeHost, type Mounted } from './support/dom.ts'

/**
 * Stage a fresh mounted card with its host facts settled, released when the
 * test ends (the view's status poll holds a timer until its effect cleans up).
 */
async function mountedCard(t: TestContext): Promise<{ host: FakeHost; mounted: Mounted }> {
  const host = fakeHost()
  const mounted = await mountCard(host)
  t.after(() => {
    mounted.unmount()
    mounted.card.dispose()
  })
  await settle(mounted)
  return { host, mounted }
}

/** The number of form controls currently in the layout. */
function formControls(mounted: Mounted): number {
  return mounted.container.querySelectorAll('input, select, textarea').length
}

test('COL-01 the card starts collapsed', async (t) => {
  const { mounted } = await mountedCard(t)
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'false')
  assert.equal(mounted.region().hasAttribute('hidden'), true, 'the disclosure region must be hidden initially')
  assert.equal(formControls(mounted), 0)
})

test('COL-02 the full form is absent from the layout while collapsed', async (t) => {
  const { mounted } = await mountedCard(t)
  // Two properties together: the region that would hold the form is hidden, and
  // no control exists at all — a collapsed card cannot leak fields into the
  // page's layout or its tab order.
  assert.equal(mounted.region().hasAttribute('hidden'), true)
  assert.equal(mounted.container.querySelectorAll('label').length, 0)
  assert.equal(formControls(mounted), 0)
  await click(mounted.toggle())
  assert.ok(formControls(mounted) > 10, 'the expanded card must render the whole form')
})

test('COL-03 pointer activation expands the card', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'true')
  assert.equal(mounted.region().hasAttribute('hidden'), false)
  assert.ok(formControls(mounted) > 0)
})

test('COL-04 a second activation collapses the card again', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())
  await click(mounted.toggle())
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'false')
  assert.equal(mounted.region().hasAttribute('hidden'), true)
  assert.equal(formControls(mounted), 0)
})

test('COL-05 aria-expanded tracks the disclosure state exactly', async (t) => {
  const { mounted } = await mountedCard(t)
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'false')
  await click(mounted.toggle())
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'true')
  await click(mounted.toggle())
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'false')
})

test('COL-06 the disclosure control is a native button (Enter activation is the browser default)', async (t) => {
  // See the module comment: jsdom has no native keyboard activation, so what is
  // assertable here is the semantics Enter activation requires. The activation
  // itself is proved in the real browser run.
  const { mounted } = await mountedCard(t)
  const toggle = mounted.toggle()
  assert.equal(toggle.tagName, 'BUTTON', 'Enter activation is native only on a real button element')
  assert.equal(toggle.getAttribute('type'), 'button', 'a button inside no form must not default to submit')
  assert.equal(toggle.disabled, false)
})

test('COL-07 the disclosure control is a native button (Space activation is the browser default)', async (t) => {
  // Same prerequisite as COL-06, for the Space key's activation behavior.
  const { mounted } = await mountedCard(t)
  const toggle = mounted.toggle()
  assert.equal(toggle.tagName, 'BUTTON')
  assert.equal(toggle.getAttribute('type'), 'button')
  assert.equal(toggle.disabled, false)
})

test('COL-08 inner form controls do not toggle the parent disclosure', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())
  const select = mounted.field('notifyQuestions') as HTMLSelectElement
  await choose(select, 'true')
  const input = mounted.field('smtpHost') as HTMLInputElement
  await click(input)
  await type(input, 'smtp.example.invalid')
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'true', 'interacting with the form must not collapse the card')
  assert.equal(formControls(mounted) > 0, true)
})

test('COL-09 unsaved drafts survive collapse and re-expansion', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())
  await choose(mounted.field('notifyQuestions') as HTMLSelectElement, 'true')
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.draft.invalid')
  await type(mounted.field('smtpPasswordSecret') as HTMLInputElement, 'SENTINEL-password-draft')

  await click(mounted.toggle())
  await click(mounted.toggle())

  assert.equal((mounted.field('notifyQuestions') as HTMLSelectElement).value, 'true')
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.draft.invalid')
  assert.equal(
    (mounted.field('smtpPasswordSecret') as HTMLInputElement).value,
    'SENTINEL-password-draft',
    'the password draft is an unsaved edit like any other',
  )
})

test('COL-10 a save result survives collapse and re-expansion, and collapsing mid-save cancels nothing', async (t) => {
  const { host, mounted } = await mountedCard(t)
  await click(mounted.toggle())
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.saved.invalid')

  host.hold()
  await click(mounted.action('save'))
  // Collapse and re-expand while the save is still crossing the wire: the
  // operation is owned by the controller, not by the form body.
  await click(mounted.toggle())
  assert.equal(mounted.toggle().getAttribute('aria-expanded'), 'false')
  await click(mounted.toggle())
  host.release()
  await settle(mounted)

  const notice = mounted.container.querySelector('[data-notice="operation"]')
  assert.ok(notice !== null, 'the save outcome must be reported after re-expansion')
  assert.notEqual(notice.textContent?.trim(), '')
  assert.equal(host.mutations.length, 1, 'the save must run exactly once')

  const reported = notice.textContent
  await click(mounted.toggle())
  await click(mounted.toggle())
  assert.equal(mounted.container.querySelector('[data-notice="operation"]')?.textContent, reported)
})

test('COL-11 a delivery-test result survives collapse and re-expansion', async (t) => {
  const { host, mounted } = await mountedCard(t)
  await click(mounted.toggle())

  host.hold()
  await click(mounted.action('send-test'))
  await click(mounted.toggle())
  await click(mounted.toggle())
  host.release()
  await settle(mounted)

  const result = mounted.container.querySelector('[data-notice="test-email"]')
  assert.ok(result !== null, 'the delivery-test outcome must be reported after re-expansion')
  assert.notEqual(result.textContent?.trim(), '')
  assert.equal(
    host.rpcCalls.filter((call) => call.endpoint.endsWith('/test-email')).length,
    1,
    'the delivery test must run exactly once',
  )

  const reported = result.textContent
  await click(mounted.toggle())
  await click(mounted.toggle())
  assert.equal(mounted.container.querySelector('[data-notice="test-email"]')?.textContent, reported)
})

test('COL-12 the credential draft stays secure and survives collapse', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())
  const secret = mounted.field('smtpPasswordSecret') as HTMLInputElement
  assert.equal(secret.type, 'password', 'the draft must never render as visible text')
  await type(secret, 'SENTINEL-never-rendered')

  // Expanded: the secret exists in exactly one place — its own masked input —
  // and appears in no rendered text and no other control's value.
  assert.equal(mounted.container.textContent?.includes('SENTINEL-never-rendered'), false)
  for (const control of mounted.container.querySelectorAll('input, select')) {
    if (control.getAttribute('name') === 'smtpPasswordSecret') continue
    assert.notEqual((control as HTMLInputElement).value, 'SENTINEL-never-rendered')
  }

  await click(mounted.toggle())
  assert.equal(mounted.container.textContent?.includes('SENTINEL-never-rendered'), false, 'the collapsed card renders no draft at all')

  await click(mounted.toggle())
  assert.equal(
    (mounted.field('smtpPasswordSecret') as HTMLInputElement).value,
    'SENTINEL-never-rendered',
    'the draft survives collapse and is never destroyed by presentation state',
  )
})

test('COL-13 the collapsed summary exposes no sensitive content', async (t) => {
  const host = fakeHost()
  host.status = {
    active: true,
    smtpConfigured: true,
    credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
    queue: { depth: 3, size: 100, delivered: 9, failed: 1 },
    configError: 'SENTINEL-config-error-detail',
  }
  const mounted = await mountCard(host)
  t.after(() => {
    mounted.unmount()
    mounted.card.dispose()
  })
  await settle(mounted)
  await click(mounted.toggle())
  await type(mounted.field('to') as HTMLInputElement, 'victim@example.invalid')
  await type(mounted.field('smtpUser') as HTMLInputElement, 'SENTINEL-username')
  await type(mounted.field('smtpPasswordSecret') as HTMLInputElement, 'SENTINEL-password')
  await click(mounted.toggle())
  await settle(mounted)

  const summary = mounted.container.querySelector('[data-summary]')
  assert.ok(summary !== null, 'the collapsed card must render a summary')
  const text = summary.textContent ?? ''
  for (const leaked of ['victim@example.invalid', 'SENTINEL-username', 'SENTINEL-password', 'SENTINEL-config-error-detail', 'DSH_MAIL_SMTP_PASSWORD']) {
    assert.equal(text.includes(leaked), false, `the summary must not expose ${leaked}`)
  }
  // Compactness: operational facts, one separator apart — never a paragraph.
  const segments = text
    .split('·')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  assert.ok(segments.length > 0 && segments.length <= 3, `the summary must stay to a few facts (got ${segments.length})`)
  assert.ok(text.length <= 120, `the summary must stay compact (got ${text.length} characters)`)
  // The collapsed card renders the disclosure row and the summary, nothing else.
  assert.equal(mounted.container.querySelectorAll('label').length, 0)
  assert.equal(formControls(mounted), 0)
})

test('COL-14 an actual component unmount keeps the existing discard semantics', async (t) => {
  const { mounted } = await mountedCard(t)
  await click(mounted.toggle())
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.unmount.invalid')
  assert.equal(mounted.card.getSnapshot().dirty, true)

  // The view is disposable; the controller is not. Unmounting the component
  // (leaving the tab, say) has never discarded drafts — only `discard()` does —
  // and collapsing must not be conflated with either one.
  mounted.unmount()
  await mounted.remount()
  await settle(mounted)
  await click(mounted.toggle())
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, 'smtp.unmount.invalid')

  await act(async () => {
    mounted.card.discard()
  })
  await settle(mounted)
  assert.equal((mounted.field('smtpHost') as HTMLInputElement).value, '', 'discard is what drops staged edits')
  assert.equal(mounted.card.getSnapshot().dirty, false)
})
