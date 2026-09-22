/**
 * Acceptance and regression tests for settings card collapse behavior.
 *
 * Covers requirements COL-01 through COL-14.
 *
 * @module dsh-mail-notify/tests/client/collapse
 */

import assert from 'node:assert/strict'
import { act } from 'react'
import { test } from 'node:test'
import { MailNotifyCard } from '../../src/client/controller.ts'
import { createFakeClientContext, mountCard } from './harness.ts'

test('COL-01 default collapsed', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    assert.equal(mounted.isExpanded(), false, 'the card must start collapsed by default')
    assert.equal(mounted.getHeaderButton().getAttribute('aria-expanded'), 'false')
  } finally {
    await mounted.unmount()
  }
})

test('COL-02 full form absent when collapsed', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    const inputs = mounted.container.querySelectorAll('input')
    const selects = mounted.container.querySelectorAll('select')
    assert.equal(inputs.length, 0, 'no form inputs should be present in collapsed state')
    assert.equal(selects.length, 0, 'no form selects should be present in collapsed state')
  } finally {
    await mounted.unmount()
  }
})

test('COL-03 click expands', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    assert.equal(mounted.isExpanded(), false)
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), true, 'clicking header button must expand the card')

    const inputs = mounted.container.querySelectorAll('input')
    assert.ok(inputs.length > 0, 'form inputs must be present after expansion')
  } finally {
    await mounted.unmount()
  }
})

test('COL-04 click collapses', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), true)

    await mounted.toggle()
    assert.equal(mounted.isExpanded(), false, 'clicking header button again must collapse the card')
    assert.equal(mounted.container.querySelectorAll('input').length, 0)
  } finally {
    await mounted.unmount()
  }
})

test('COL-05 aria-expanded', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    const btn = mounted.getHeaderButton()
    assert.equal(btn.getAttribute('aria-expanded'), 'false')

    await mounted.toggle()
    assert.equal(btn.getAttribute('aria-expanded'), 'true')

    await mounted.toggle()
    assert.equal(btn.getAttribute('aria-expanded'), 'false')
  } finally {
    await mounted.unmount()
  }
})

test('COL-06 Enter key toggles disclosure', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    assert.equal(mounted.isExpanded(), false)
    await mounted.pressKey('Enter')
    assert.equal(mounted.isExpanded(), true, 'Enter key on header button must expand')

    await mounted.pressKey('Enter')
    assert.equal(mounted.isExpanded(), false, 'Enter key on header button must collapse')
  } finally {
    await mounted.unmount()
  }
})

test('COL-07 Space key toggles disclosure', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    assert.equal(mounted.isExpanded(), false)
    await mounted.pressKey(' ')
    assert.equal(mounted.isExpanded(), true, 'Space key on header button must expand')

    await mounted.pressKey(' ')
    assert.equal(mounted.isExpanded(), false, 'Space key on header button must collapse')
  } finally {
    await mounted.unmount()
  }
})

test('COL-08 inner controls safe from collapsing parent', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), true)

    // Interacting with an inner input or button must not toggle the card
    const input = mounted.container.querySelector('input')
    assert.ok(input !== null)
    await act(async () => {
      input.click()
    })
    assert.equal(mounted.isExpanded(), true, 'inner control interaction must not collapse the card')
  } finally {
    await mounted.unmount()
  }
})

test('COL-09 drafts survive collapse and re-expand', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), true)

    // Stage an edit inside act
    await act(async () => {
      card.edit('smtpHost', 'smtp.custom-domain.org')
    })
    assert.equal(card.getSnapshot().fields.find((f) => f.def.field === 'smtpHost')?.text, 'smtp.custom-domain.org')

    // Collapse
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), false)

    // Controller retains draft while collapsed
    assert.equal(card.getSnapshot().fields.find((f) => f.def.field === 'smtpHost')?.text, 'smtp.custom-domain.org')

    // Re-expand
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), true)

    // Verify draft survived in rendered field
    const hostInput = Array.from(mounted.container.querySelectorAll('input')).find(
      (inp) => inp.value === 'smtp.custom-domain.org',
    )
    assert.ok(hostInput !== undefined, 'staged draft must survive collapse and re-expand')
  } finally {
    await mounted.unmount()
  }
})

test('COL-10 save result survives collapse and re-expand', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()
    await act(async () => {
      card.edit('smtpHost', 'smtp.save-test.org')
      await card.save()
    })

    assert.equal(card.getSnapshot().notice, 'Saved.')

    // Collapse and re-expand
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), false)

    await mounted.toggle()
    assert.equal(mounted.isExpanded(), true)

    assert.equal(card.getSnapshot().notice, 'Saved.')
    assert.ok(mounted.container.textContent?.includes('Saved.'))
  } finally {
    await mounted.unmount()
  }
})

test('COL-11 test-email result survives collapse and re-expand', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()
    await act(async () => {
      await card.sendTestEmail()
    })

    const resultMsg = card.getSnapshot().testEmail?.message
    assert.ok(resultMsg !== undefined)

    // Collapse
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), false)

    // Re-expand
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), true)

    assert.equal(card.getSnapshot().testEmail?.message, resultMsg)
    assert.ok(mounted.container.textContent?.includes(resultMsg!))
  } finally {
    await mounted.unmount()
  }
})

test('COL-12 credentials secure across collapse and re-expand', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()
    await act(async () => {
      card.setSecretDraft('super-secret-password-xyz')
    })
    assert.equal(card.getSnapshot().secret.draft, 'super-secret-password-xyz')

    // Collapse
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), false)

    // Password must NEVER appear in collapsed summary or DOM
    assert.equal(mounted.container.textContent?.includes('super-secret-password-xyz'), false)

    // Re-expand
    await mounted.toggle()
    assert.equal(mounted.isExpanded(), true)

    // Password draft retained in password input
    const passwordInput = mounted.container.querySelector('input[type="password"]') as HTMLInputElement
    assert.equal(passwordInput?.value, 'super-secret-password-xyz')
  } finally {
    await mounted.unmount()
  }
})

test('COL-13 collapsed summary safe', async () => {
  const env = createFakeClientContext({
    status: {
      active: true,
      smtpConfigured: true,
      credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
    },
    scope: {
      value: {
        to: ['secret-recipient@confidential.com'],
        includeUserPrompt: true,
      },
    },
  })
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    const summary = mounted.getSummaryText()
    // Shows safe facts only
    assert.ok(summary.includes('Active'))
    assert.ok(summary.includes('SMTP configured'))
    assert.ok(summary.includes('Questions off') || summary.includes('Questions on'))

    // Does NOT leak recipients, prompts, credentials
    assert.equal(summary.includes('secret-recipient@confidential.com'), false)
    assert.equal(summary.includes('DSH_MAIL_SMTP_PASSWORD'), false)
  } finally {
    await mounted.unmount()
  }
})

test('COL-14 unmount behavior unchanged', async () => {
  const env = createFakeClientContext()
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  await mounted.unmount()
  // Card can still be disposed cleanly without errors
  card.dispose()
})
