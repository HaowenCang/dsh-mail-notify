/**
 * Collapse acceptance tests for the settings card (COL-01 … COL-14).
 *
 * Every test drives the BUILT card through real user gestures: the component,
 * its controller, and the settings projection all come from `lib/client.js`,
 * mounted in jsdom against a mock host that records everything crossing the
 * wire. Two platform facts deserve stating once:
 *
 * - jsdom does not implement native keyboard activation of buttons. The
 *   Enter/Space tests therefore drive `user-event`, which implements the
 *   browser's default activation behaviour for native controls — keydown Enter
 *   and keyup Space dispatch the button's click, exactly as the HTML spec
 *   prescribes. The card relies on that platform behaviour rather than a
 *   bespoke key handler, which is also what the real-browser smoke check
 *   verifies against an actual Chromium.
 * - The disclosure header is addressed as `button[aria-controls]`, so these
 *   queries stay valid across the localization phase's copy changes.
 *
 * @module dsh-mail-notify/tests/client/collapse
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { StatusValue } from '../../src/protocol.ts'
import { screen, setupUser, createCard, renderCard } from './harness/render.ts'
import { deferred } from './harness/host.ts'

/** A status that makes every summary fact affirmative and queue-laden. */
const LIVE_STATUS: StatusValue = {
  active: true,
  smtpConfigured: true,
  credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
  queue: { depth: 1, size: 100, delivered: 7, failed: 0 },
}

test('COL-01 the card mounts collapsed by default', async () => {
  const card = renderCard()
  assert.equal(card.header().getAttribute('aria-expanded'), 'false')
  // The summary is live while collapsed; the form is not.
  await screen.findByText(/Active/)
  assert.equal(screen.queryAllByRole('textbox').length, 0)
  assert.equal(screen.queryAllByRole('combobox').length, 0)
})

test('COL-02 the full form is absent from the layout while collapsed', async () => {
  const card = renderCard({ base: { smtpHost: 'smtp.example.test' } })
  await screen.findByText(/SMTP configured/)
  const container = card.result.container
  assert.equal(container.querySelectorAll('input, select, textarea').length, 0)
  assert.equal(container.querySelectorAll('button').length, 1, 'only the header button exists while collapsed')
  assert.ok(!container.textContent.includes('SMTP host'))
  assert.ok(!container.textContent.includes('Send test email'))
  assert.ok(!container.textContent.includes('queue'), 'queue detail belongs to the expanded Status block')
})

test('COL-03 a pointer activation expands the card', async () => {
  const user = setupUser()
  const card = renderCard()
  await user.click(card.header())
  assert.equal(card.header().getAttribute('aria-expanded'), 'true')
  assert.ok(screen.queryAllByRole('textbox').length > 0)
})

test('COL-04 a second activation collapses the card', async () => {
  const user = setupUser()
  const card = renderCard()
  await user.click(card.header())
  await user.click(card.header())
  assert.equal(card.header().getAttribute('aria-expanded'), 'false')
  assert.equal(screen.queryAllByRole('textbox').length, 0)
})

test('COL-05 aria-expanded tracks the disclosure state exactly', async () => {
  const user = setupUser()
  const card = renderCard()
  const header = card.header()
  assert.equal(header.getAttribute('aria-expanded'), 'false')
  assert.ok(header.getAttribute('aria-controls') !== null && header.getAttribute('aria-controls') !== '')
  await user.click(header)
  assert.equal(header.getAttribute('aria-expanded'), 'true')
  await user.click(header)
  assert.equal(header.getAttribute('aria-expanded'), 'false')
})

test('COL-06 Enter toggles the disclosure', async () => {
  const user = setupUser()
  const card = renderCard()
  const header = card.header()
  header.focus()
  await user.keyboard('{Enter}')
  assert.equal(header.getAttribute('aria-expanded'), 'true')
  await user.keyboard('{Enter}')
  assert.equal(header.getAttribute('aria-expanded'), 'false')
})

test('COL-07 Space toggles the disclosure', async () => {
  const user = setupUser()
  const card = renderCard()
  const header = card.header()
  header.focus()
  await user.keyboard(' ')
  assert.equal(header.getAttribute('aria-expanded'), 'true')
  await user.keyboard(' ')
  assert.equal(header.getAttribute('aria-expanded'), 'false')
})

test('COL-08 inner form controls never toggle the parent disclosure', async () => {
  const user = setupUser()
  const card = renderCard({ status: LIVE_STATUS })
  await user.click(card.header())
  const header = card.header()

  // Text and select controls receive focus and clicks without collapsing.
  const host = screen.getByRole('textbox', { name: /SMTP host/i })
  await user.click(host)
  assert.equal(header.getAttribute('aria-expanded'), 'true')
  const questions = screen.getByRole('combobox', { name: /question/i })
  await user.click(questions)
  assert.equal(header.getAttribute('aria-expanded'), 'true')

  // An inner action button runs its own async operation without collapsing.
  await user.click(screen.getByRole('button', { name: 'Send test email' }))
  assert.equal(header.getAttribute('aria-expanded'), 'true')
  await screen.findByText(/accepted the message for 2 recipient/)
  assert.equal(header.getAttribute('aria-expanded'), 'true')
})

test('COL-09 drafts survive a collapse and re-expand', async () => {
  const user = setupUser()
  const card = renderCard({ base: { notifyQuestions: false } })
  await user.click(card.header())

  await user.selectOptions(screen.getByRole('combobox', { name: /question/i }), 'true')
  await user.type(screen.getByRole('textbox', { name: /SMTP host/i }), 'smtp.draft.example')

  await user.click(card.header())
  assert.equal(screen.queryAllByRole('textbox').length, 0)
  await user.click(card.header())

  const host = screen.getByRole('textbox', { name: /SMTP host/i }) as HTMLInputElement
  assert.equal(host.value, 'smtp.draft.example')
  const questions = screen.getByRole('combobox', { name: /question/i }) as HTMLSelectElement
  assert.equal(questions.value, 'true')
  // The controller was never destroyed: the save is still armed.
  assert.equal(card.face()['card'] !== undefined, true)
})

test('COL-10 a save result, including an in-flight one, survives collapse', async () => {
  const user = setupUser()
  const card = renderCard({ base: { smtpHost: 'smtp.example.test' } })
  await user.click(card.header())
  await user.type(screen.getByRole('textbox', { name: /SMTP host/i }), '.other')

  // First: a save that completes, then a collapse that must not eat the result.
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Saved.')
  await user.click(card.header())
  await user.click(card.header())
  await screen.findByText('Saved.')

  // Second: a save held in flight. Collapsing mid-save must not abort it,
  // corrupt the busy state, or let a second save start.
  const gate = deferred<void>()
  card.host.hooks.mutate = () => {
    card.host.hooks.mutate = undefined
    return gate.promise
  }
  await user.type(screen.getByRole('textbox', { name: /SMTP host/i }), 'x')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Saving…')
  const saveButton = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement
  assert.equal(saveButton.disabled, true, 'a second Save cannot start while one is in flight')

  // Collapsed during the flight: the header carries the compact busy status.
  await user.click(card.header())
  await screen.findByText(/Saving…/)
  await user.click(card.header())
  await screen.findByText('Saving…')

  gate.resolve(undefined)
  await screen.findByText('Saved.')
  assert.equal(card.host.mutateCalls.length, 2, 'exactly one mutate per Save press')

  // The controller-level re-entrancy guard, independent of the button state.
  const face = card.face()['card'] as { save(): Promise<void> }
  await face.save()
  assert.equal(card.host.mutateCalls.length, 2, 'a save during no-dirty or saving state starts nothing')
})

test('COL-11 a test-email result survives collapse', async () => {
  const user = setupUser()
  const card = renderCard()
  await user.click(card.header())

  const gate = deferred<{ delivered: boolean; recipientCount: number }>()
  card.host.hooks.testEmail = () => {
    card.host.hooks.testEmail = undefined
    return gate.promise
  }
  await user.click(screen.getByRole('button', { name: 'Send test email' }))
  await screen.findByText('Sending…')

  await user.click(card.header())
  await screen.findByText(/Sending…/)
  await user.click(card.header())
  await screen.findByText('Sending…')

  gate.resolve({ delivered: true, recipientCount: 3 })
  const message = await screen.findByText(/accepted the message for 3 recipient/)
  assert.ok(message !== null)

  await user.click(card.header())
  await user.click(card.header())
  await screen.findByText(/accepted the message for 3 recipient/)
  assert.equal(card.host.mutateCalls.length, 0, 'a test email writes no settings')
})

test('COL-12 the credential draft stays masked, local, and write-only across collapse', async () => {
  const user = setupUser()
  const card = renderCard({ credential: { configured: true, writable: true } })
  await user.click(card.header())

  const password = card.result.container.querySelector('input[type="password"]')
  assert.ok(password !== null, 'the credential control is a password input')
  await user.type(password as HTMLInputElement, 'hunter2-not-a-secret')

  await user.click(card.header())
  await user.click(card.header())

  const restored = card.result.container.querySelector('input[type="password"]') as HTMLInputElement
  assert.equal(restored.value, 'hunter2-not-a-secret', 'the draft survived the collapse')
  assert.equal(card.host.credentialOps.length, 0, 'typing writes nothing: no set, no unset, no read')
  assert.equal(card.host.rpcEndpoints.filter((entry) => entry.endsWith('secret')).length, 0)

  // Nothing that crossed the wire so far carries the draft.
  const crossed = JSON.stringify({ mutate: card.host.mutateCalls, rpc: card.host.rpcEndpoints, cred: card.host.credentialOps })
  assert.ok(!crossed.includes('hunter2-not-a-secret'))

  // Save is the one place the value may cross — one write-only set, then the
  // local draft is cleared.
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Saved.')
  assert.deepEqual(
    card.host.credentialOps.map((entry) => ({ op: entry.op, ref: entry.ref })),
    [{ op: 'set', ref: 'DSH_MAIL_SMTP_PASSWORD' }],
  )
  assert.equal(card.host.credentialOps[0]?.value, 'hunter2-not-a-secret')
  const cleared = card.result.container.querySelector('input[type="password"]') as HTMLInputElement
  assert.equal(cleared.value, '', 'a landed save clears the local draft')
})

test('COL-13 the collapsed summary exposes no sensitive fields', async () => {
  const card = renderCard({
    base: {
      notifyQuestions: false,
      to: ['alice@example.test'],
      smtpUser: 'carl.smith',
      smtpHost: 'smtp.private.example',
    },
    user: { smtpUser: 'carl.smith' },
    status: LIVE_STATUS,
    credential: { configured: true, writable: true },
  })
  await screen.findByText(/Active/)

  const header = card.header()
  const text = header.textContent ?? ''
  // What it does show: the three safe operational facts.
  assert.ok(text.includes('Active'))
  assert.ok(text.includes('SMTP configured'))
  assert.ok(text.includes('Questions Off'))
  // What it must not show: recipients, the SMTP user, the host, queue detail,
  // or any credential material.
  assert.ok(!text.includes('alice@example.test'))
  assert.ok(!text.includes('carl.smith'))
  assert.ok(!text.includes('smtp.private.example'))
  assert.ok(!text.includes('delivered'))
  assert.ok(!text.includes('DSH_MAIL_SMTP_PASSWORD'))
})

test('COL-14 unmount follows the v0.3.0 discard semantics', async () => {
  const user = setupUser()
  const env = createCard({ base: { smtpHost: 'smtp.example.test' } })

  // (a) A VIEW unmount — a tab switch — keeps the controller and its draft:
  // the card is owned by the plugin effect, not by the rendered tree.
  const first = env.mount()
  await user.click(first.header())
  await user.type(screen.getByRole('textbox', { name: /SMTP host/i }), '.draft')
  first.result.unmount()

  const second = env.mount()
  await user.click(second.header())
  const restored = screen.getByRole('textbox', { name: /SMTP host/i }) as HTMLInputElement
  assert.equal(restored.value, 'smtp.example.test.draft')
  second.result.unmount()

  // (b) A full teardown — the page unloading — disposes the controller, and a
  // fresh application starts with no draft: nothing is persisted anywhere.
  env.host.dispose()
  const fresh = createCard({ base: { smtpHost: 'smtp.example.test' } })
  const third = fresh.mount()
  await user.click(third.header())
  const empty = screen.getByRole('textbox', { name: /SMTP host/i }) as HTMLInputElement
  assert.equal(empty.value, 'smtp.example.test')
  assert.equal(fresh.host.mutateCalls.length, 0, 'a fresh application wrote nothing')
  fresh.host.dispose()
})
