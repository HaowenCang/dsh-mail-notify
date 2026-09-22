/**
 * COL-01…COL-14: the card's disclosure.
 *
 * Every test drives the rendered card through real DOM events, and every one
 * uses the real controller over the fake settings transport in
 * `./support/client-context.ts`. That combination is what makes these tests
 * evidence about the card rather than about a projection a test built by hand:
 * a controller that dropped drafts on every render would fail COL-09 even
 * though the component looked correct in isolation.
 *
 * @module dsh-mail-notify/tests/client/collapse
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  click,
  disclosure,
  h,
  isOpen,
  LOCALE_NAMESPACE,
  mount,
  mountCard,
  press,
  queryAll,
  settle,
  toggle,
  type,
} from './support/dom.ts'
import { MailNotifyCardView } from '../../src/client/Card.tsx'

/** The real form's most distinctive control, used to prove the body is absent. */
const SMTP_HOST_LABEL = 'SMTP host'

/**
 * The card's password input.
 *
 * Found by type rather than by label: the label states the *action* the
 * reference currently affords — "Set password" or "Change password" — so
 * matching on either would make the test depend on the credential's state,
 * which is a different assertion.
 */
function passwordControl(root: ParentNode): HTMLInputElement {
  const found = root.querySelector('input[type="password"]')
  if (found === null) throw new Error('no password control is rendered')
  return found as HTMLInputElement
}

/**
 * Find the labelled control for one field, by its visible label text.
 *
 * @param root - the mounted card's container.
 * @param label - the label text.
 * @returns the control inside that label.
 */
function controlFor(root: ParentNode, label: string): HTMLInputElement | HTMLSelectElement {
  const labels = queryAll<HTMLLabelElement>('label', root)
  for (const element of labels) {
    if (element.textContent?.includes(label) === true) {
      const control = element.querySelector('input, select')
      if (control !== null) return control as HTMLInputElement | HTMLSelectElement
    }
  }
  throw new Error(`no control labelled "${label}"`)
}

/** Find a button anywhere in the card by its exact text. */
function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const buttons = queryAll<HTMLButtonElement>('button', root)
  for (const button of buttons) {
    if (button.textContent?.trim() === text) return button
  }
  throw new Error(`no button reading "${text}"`)
}

test('COL-01 the card starts collapsed', async () => {
  const card = await mountCard()
  assert.equal(isOpen(card.tree.container), false, 'the body must not be rendered on first paint')
  assert.equal(disclosure(card.tree.container).getAttribute('aria-expanded'), 'false')
  await card.tree.unmount()
})

test('COL-02 the full form is absent while collapsed', async () => {
  const card = await mountCard()
  const root = card.tree.container
  assert.equal(isOpen(root), false)
  // Absent, not hidden: the requirement is that the card does not occupy the
  // vertical space, and a `display:none` body would still be laid out by any
  // consumer that overrides display.
  assert.equal(root.querySelector('[role="region"]'), null)
  assert.equal(root.textContent?.includes(SMTP_HOST_LABEL), false, 'no field label may be present')
  assert.equal(root.querySelector('input[type="password"]'), null, 'the password control must be absent')
  assert.equal(root.querySelector('select'), null, 'the boolean controls must be absent')
  await card.tree.unmount()
})

test('COL-03 a click expands the card', async () => {
  const card = await mountCard()
  await toggle(card.tree.container)
  assert.equal(isOpen(card.tree.container), true)
  assert.ok(card.tree.container.textContent?.includes(SMTP_HOST_LABEL))
  await card.tree.unmount()
})

test('COL-04 a second click collapses it again', async () => {
  const card = await mountCard()
  await toggle(card.tree.container)
  await toggle(card.tree.container)
  assert.equal(isOpen(card.tree.container), false)
  assert.equal(disclosure(card.tree.container).getAttribute('aria-expanded'), 'false')
  await card.tree.unmount()
})

test('COL-05 aria-expanded tracks the rendered body in both directions', async () => {
  const card = await mountCard()
  const root = card.tree.container
  const seen: boolean[] = []
  for (let round = 0; round < 3; round += 1) {
    const open = isOpen(root)
    seen.push(open)
    assert.equal(
      disclosure(root).getAttribute('aria-expanded'),
      open ? 'true' : 'false',
      'the announced state must be the rendered state',
    )
    await toggle(root)
  }
  assert.deepEqual(seen, [false, true, false], 'each toggle must flip the state exactly once')
  await card.tree.unmount()
})

test('COL-06 the header is a native button, so Enter activates it', async () => {
  // Enter activation on a `<button>` is the user agent's own default action; a
  // synthetic `KeyboardEvent` cannot trigger it, because that action is defined
  // only for trusted events. The property that *is* testable here is therefore
  // the precondition for it: the header really is a native button, nothing
  // suppresses its default action, and a key press dispatched at it reaches it.
  // The keypress itself is then exercised against a real browser in the packed
  // Web smoke test, which is the only place it can be observed.
  const card = await mountCard()
  const header = disclosure(card.tree.container)
  assert.equal(header.tagName, 'BUTTON', 'the header must be a native button')
  assert.equal(header.getAttribute('type'), 'button', 'the default submit action must be suppressed')
  assert.equal(
    header.getAttribute('tabindex'),
    null,
    'a native button is already in the tab order; an explicit tabindex would change it',
  )
  assert.equal(header.hasAttribute('disabled'), false)

  // A key press reaches the element: no ancestor handler consumes it first.
  let seen: string[] = []
  header.addEventListener('keydown', (event) => {
    seen = [...seen, (event as unknown as { key: string }).key]
  })
  await press(header, 'Enter')
  assert.deepEqual(seen, ['Enter'], 'the key press must reach the header')
  await card.tree.unmount()
})

test('COL-06b the button, once activated, expands', async () => {
  // What the user agent does with Enter or Space is dispatch a click. This is
  // that click, and it is the same code path the browser takes.
  const card = await mountCard()
  const header = disclosure(card.tree.container)
  await click(header)
  await settle()
  assert.equal(header.getAttribute('aria-expanded'), 'true')
  await click(header)
  await settle()
  assert.equal(header.getAttribute('aria-expanded'), 'false')
  await card.tree.unmount()
})

test('COL-07 Space activation is not suppressed by a key handler', async () => {
  // Space is the other key a native button activates with. Two things could
  // break it, and both are checked: an ancestor `keydown` that calls
  // `preventDefault` on Space (there is no such handler, and the event arrives
  // un-cancelled), and a key handler that scrolls the page instead.
  const card = await mountCard()
  const header = disclosure(card.tree.container)
  let cancelled: boolean | undefined
  header.addEventListener('keydown', (event) => {
    cancelled = (event as unknown as { defaultPrevented: boolean }).defaultPrevented
  })
  await press(header, ' ')
  await settle()
  assert.equal(cancelled, false, 'nothing may cancel the default action of Space on the header')
  assert.equal(header.getAttribute('aria-expanded'), 'false', 'no key handler may toggle on its own')
  await card.tree.unmount()
})

test('COL-07b the header is the only interactive element while collapsed', async () => {
  // A collapsed card must be one control, not a fieldset the user can tab into.
  const card = await mountCard()
  const root = card.tree.container
  const focusable = queryAll<HTMLElement>('button, input, select, textarea, a[href]', root)
  assert.equal(focusable.length, 1, 'a collapsed card must expose exactly one control')
  assert.equal(focusable[0], disclosure(root))

  // And it is reachable without a pointer.
  const disclosureButton = disclosure(root)
  disclosureButton.focus()
  assert.equal(disclosureButton.ownerDocument.activeElement, disclosureButton)
  await card.tree.unmount()
})

test('COL-08 an inner control does not toggle the card', async () => {
  const card = await mountCard()
  const root = card.tree.container
  await toggle(root)
  assert.equal(isOpen(root), true)

  // Stage an edit so Save is enabled, then press it. A card that toggled from
  // any descendant click would collapse here and lose the very form the user
  // was still filling in.
  await type(controlFor(root, SMTP_HOST_LABEL), 'smtp.example.com')
  const save = buttonByText(root, 'Save')
  assert.equal(save.disabled, false, 'Save must be enabled once something is staged')
  await click(save)
  await settle(4)
  assert.equal(isOpen(root), true, 'the card must stay open after an inner button is pressed')
  assert.equal(disclosure(root).getAttribute('aria-expanded'), 'true')

  // The same for a control that is not a button: typing into a field must not
  // reach the header either.
  await type(controlFor(root, SMTP_HOST_LABEL), 'smtp2.example.com')
  assert.equal(isOpen(root), true)
  await card.tree.unmount()
})

test('COL-09 a staged draft survives collapse and re-expansion', async () => {
  const card = await mountCard()
  const root = card.tree.container
  await toggle(root)

  // Typing into the select is what a user does to a boolean field, and typing
  // into the text input is what they do to a string field. Both must come back.
  await type(controlFor(root, 'Questions requiring input'), 'true')
  await type(controlFor(root, SMTP_HOST_LABEL), 'smtp.example.com')
  assert.equal(card.card.getSnapshot().dirty, true, 'both edits must be staged')

  await toggle(root)
  assert.equal(isOpen(root), false)

  await toggle(root)
  assert.equal(isOpen(root), true)
  assert.equal(
    controlFor(root, 'Questions requiring input').value,
    'true',
    'the boolean draft must survive the collapse',
  )
  assert.equal(
    controlFor(root, SMTP_HOST_LABEL).value,
    'smtp.example.com',
    'the text draft must survive the collapse',
  )

  // The stronger statement: collapsing performed no write at all. A disclosure
  // that committed staged edits, or dropped them, would have to talk to the
  // host to do it.
  assert.deepEqual(
    card.double.calls.filter((call) => call.method === 'settings.mutate'),
    [],
    'collapsing must not write settings',
  )
  await card.tree.unmount()
})

test('COL-10 a save result survives collapse and re-expansion', async () => {
  const card = await mountCard()
  const root = card.tree.container
  await toggle(root)
  await type(controlFor(root, SMTP_HOST_LABEL), 'smtp.example.com')
  await click(buttonByText(root, 'Save'))
  await settle(4)
  assert.ok(root.textContent?.includes('Saved'), 'the save must report its outcome')

  await toggle(root)
  assert.equal(isOpen(root), false)
  await toggle(root)
  assert.ok(root.textContent?.includes('Saved'), 'the outcome must still be on screen after re-expansion')
  await card.tree.unmount()
})

test('COL-11 a delivery-test result survives collapse and re-expansion', async () => {
  const card = await mountCard()
  const root = card.tree.container
  await toggle(root)
  await click(buttonByText(root, 'Send test email'))
  await settle(4)
  assert.ok(
    root.textContent?.includes('The SMTP server accepted the message'),
    'the delivery test must report its outcome',
  )

  await toggle(root)
  assert.equal(isOpen(root), false)
  await toggle(root)
  assert.ok(
    root.textContent?.includes('The SMTP server accepted the message'),
    'the delivery outcome must still be on screen after re-expansion',
  )
  await card.tree.unmount()
})

test('COL-12 a credential draft survives collapse and never leaves the password control', async () => {
  const secret = 'hunter2-not-a-real-password'
  const card = await mountCard()
  const root = card.tree.container
  await toggle(root)

  await type(passwordControl(root), secret)
  assert.equal(card.card.getSnapshot().secret.draft, secret)

  await toggle(root)
  assert.equal(isOpen(root), false)
  // Collapsed, the value is nowhere in the document. The input it lived in is
  // unmounted, so there is no element holding it and nothing to read back.
  assert.equal(root.textContent?.includes(secret), false, 'a collapsed card must not render the password')
  assert.equal(root.innerHTML.includes(secret), false, 'a collapsed card must not carry the password in markup')

  await toggle(root)
  assert.equal(isOpen(root), true)
  assert.equal(
    passwordControl(root).value,
    secret,
    'the credential draft must survive the collapse',
  )
  // The draft is still a draft: nothing was written to the credential domain.
  assert.deepEqual(card.double.writtenSecrets, [], 'collapsing must not write a credential')

  // It still writes when asked, and only then.
  await type(controlFor(root, SMTP_HOST_LABEL), 'smtp.example.com')
  await click(buttonByText(root, 'Save'))
  await settle(4)
  assert.deepEqual(card.double.writtenSecrets, [secret], 'Save is the only path that writes the password')
  await card.tree.unmount()
})

test('COL-13 the collapsed summary exposes no sensitive state', async () => {
  const secret = 'collapsed-secret-value'
  const recipient = 'private-recipient@example.com'
  const card = await mountCard({
    section: {
      to: [recipient],
      smtpUser: 'private-user@example.com',
      smtpHost: 'smtp.internal.example.com',
      notifyQuestions: true,
    },
  })
  const root = card.tree.container
  await toggle(root)
  await type(passwordControl(root), secret)
  await toggle(root)
  assert.equal(isOpen(root), false)

  const markup = root.innerHTML
  const text = root.textContent ?? ''
  for (const forbidden of [secret, recipient, 'private-user@example.com', 'smtp.internal.example.com']) {
    assert.equal(markup.includes(forbidden), false, `the collapsed card must not carry ${forbidden}`)
    assert.equal(text.includes(forbidden), false, `the collapsed card must not display ${forbidden}`)
  }

  // What it does state is three already-public facts.
  assert.ok(text.includes('Active'), 'the summary must state whether the runtime is mounted')
  assert.ok(text.includes('SMTP configured'), 'the summary must state whether SMTP is configured')
  assert.ok(text.includes('Questions on'), 'the summary must state whether question notifications are on')
  await card.tree.unmount()
})

test('COL-13b the collapsed summary follows the live facts, not a snapshot of them', async () => {
  // A collapsed card that stopped reading the host would describe the moment
  // Settings was opened rather than the moment the user is reading it.
  const card = await mountCard()
  const root = card.tree.container
  assert.ok((root.textContent ?? '').includes('Active'))
  assert.ok((root.textContent ?? '').includes('SMTP configured'))

  card.double.setStatus({ active: false, smtpConfigured: false, credentialRef: 'R' })
  await card.card.refresh()
  await settle()
  assert.ok((root.textContent ?? '').includes('Not running'), 'a stopped runtime must be reported while collapsed')
  assert.ok((root.textContent ?? '').includes('SMTP not configured'))
  await card.tree.unmount()
})

test('COL-14 unmounting the card writes nothing and the existing discard semantics still hold', async () => {
  // The disclosure introduced no new way to lose or commit a draft, and no new
  // way to clear one. Only `Discard` drops staged edits, as in v0.3.0.
  const first = await mountCard()
  await toggle(first.tree.container)
  await type(controlFor(first.tree.container, 'SMTP host'), 'smtp.example.com')

  // A real unmount, not a collapse: the controller is not owned by the
  // component, so the draft is still there afterwards.
  await first.tree.unmount()
  assert.equal(first.card.getSnapshot().dirty, true, 'an unmount must not drop a staged draft')
  assert.deepEqual(
    first.double.calls.filter((call) => call.method === 'settings.mutate'),
    [],
    'an unmount must not write settings',
  )

  // Remounting the very same controller on a fresh container shows the draft
  // again — the controller, not the DOM, is where the draft lives.
  const remounted = await mount(h(MailNotifyCardView, { card: first.card, t: first.locale.bind(LOCALE_NAMESPACE) }))
  await settle()
  await toggle(remounted.container)
  assert.equal(controlFor(remounted.container, 'SMTP host').value, 'smtp.example.com')
  await click(buttonByText(remounted.container, 'Discard'))
  await settle()
  assert.equal(first.card.getSnapshot().dirty, false, 'Discard must still drop every staged edit')
  await remounted.unmount()
})

test('COL-14b the body is rebuilt from the controller on every expansion', async () => {
  // The body is unmounted while collapsed and re-created on expansion, so a
  // control that read its value from anywhere but the controller would come
  // back blank. Three round trips is what makes that a repeatable property
  // rather than a first-render coincidence.
  const card = await mountCard()
  const root = card.tree.container
  await toggle(root)
  await type(controlFor(root, 'Port'), '465')

  const observed: boolean[] = []
  for (let round = 0; round < 3; round += 1) {
    await toggle(root)
    assert.equal(isOpen(root), false, `round ${String(round)} must collapse`)
    await toggle(root)
    assert.equal(isOpen(root), true, `round ${String(round)} must expand`)
    observed.push(controlFor(root, 'Port').value === '465')
  }
  assert.deepEqual(observed, [true, true, true], 'the draft must come back on every expansion')
  await card.tree.unmount()
})
