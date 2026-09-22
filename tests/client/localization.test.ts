/**
 * Acceptance and regression tests for English and Simplified Chinese localization.
 *
 * Covers requirements L10N-01 through L10N-11.
 *
 * @module dsh-mail-notify/tests/client/localization
 */

import assert from 'node:assert/strict'
import { act } from 'react'
import { test } from 'node:test'
import { MailNotifyCard } from '../../src/client/controller.ts'
import { ALL_FIELDS, parseField } from '../../src/client/fields.ts'
import { EN_DICT, ZH_DICT, translate, type LocaleKey } from '../../src/client/l10n.ts'
import { createFakeClientContext, mountCard } from './harness.ts'

test('L10N-01 English dictionary complete', () => {
  const keys = Object.keys(EN_DICT) as LocaleKey[]
  assert.ok(keys.length >= 60, 'English dictionary must contain all required vocabulary entries')
  for (const key of keys) {
    assert.ok(typeof EN_DICT[key] === 'string' && EN_DICT[key].trim() !== '', `key ${key} must not be empty in EN_DICT`)
  }
})

test('L10N-02 zh key parity', () => {
  const enKeys = Object.keys(EN_DICT).sort()
  const zhKeys = Object.keys(ZH_DICT).sort()
  assert.deepEqual(zhKeys, enKeys, 'ZH_DICT must possess exact key parity with EN_DICT')
  for (const key of zhKeys as LocaleKey[]) {
    assert.ok(typeof ZH_DICT[key] === 'string' && ZH_DICT[key].trim() !== '', `key ${key} must not be empty in ZH_DICT`)
  }
})

test('L10N-03 English title', async () => {
  assert.equal(EN_DICT.title, 'Mail notifications')
  const env = createFakeClientContext({ locale: 'en' })
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    assert.equal(mounted.getTitleText(), 'Mail notifications')
  } finally {
    await mounted.unmount()
  }
})

test('L10N-04 邮件通知', async () => {
  assert.equal(ZH_DICT.title, '邮件通知')
  const env = createFakeClientContext({ locale: 'zh' })
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    assert.equal(mounted.getTitleText(), '邮件通知')
  } finally {
    await mounted.unmount()
  }
})

test('L10N-05 需要用户回答', async () => {
  assert.equal(ZH_DICT.field_notifyQuestions_label, '需要用户回答')
  assert.equal(ZH_DICT.field_notifyQuestions_hint, '当 DSH 正在等待你的回答时立即发送邮件。')

  const env = createFakeClientContext({ locale: 'zh' })
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()
    const content = mounted.container.textContent ?? ''
    assert.ok(content.includes('需要用户回答'), 'must render Chinese label for questions')
    assert.ok(content.includes('当 DSH 正在等待你的回答时立即发送邮件。'), 'must render Chinese hint for questions')
  } finally {
    await mounted.unmount()
  }
})

test('L10N-06 需要用户批准', async () => {
  assert.equal(ZH_DICT.field_notifyApprovals_label, '需要用户批准')
  assert.equal(ZH_DICT.field_notifyApprovals_hint, '当 DSH 正在等待你的批准决定时立即发送邮件。')

  const env = createFakeClientContext({ locale: 'zh' })
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()
    const content = mounted.container.textContent ?? ''
    assert.ok(content.includes('需要用户批准'), 'must render Chinese label for approvals')
    assert.ok(content.includes('当 DSH 正在等待你的批准决定时立即发送邮件。'), 'must render Chinese hint for approvals')
  } finally {
    await mounted.unmount()
  }
})

test('L10N-07 live locale update when supported', async () => {
  const env = createFakeClientContext({ locale: 'en' })
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    assert.equal(mounted.getTitleText(), 'Mail notifications')
    assert.ok(mounted.getSummaryText().includes('Active'))

    // Switch DSH locale live to Chinese
    await act(async () => {
      env.setLocale('zh-CN')
    })

    assert.equal(mounted.getTitleText(), '邮件通知')
    assert.ok(mounted.getSummaryText().includes('运行中'))

    // Switch back live to English
    await act(async () => {
      env.setLocale('en-US')
    })

    assert.equal(mounted.getTitleText(), 'Mail notifications')
    assert.ok(mounted.getSummaryText().includes('Active'))
  } finally {
    await mounted.unmount()
  }
})

test('L10N-08 fallback English', async () => {
  // Unknown locale e.g. German, French, Japanese must fall back to English
  for (const unknownLocale of ['de', 'fr', 'ja', 'unknown-lang']) {
    const env = createFakeClientContext({ locale: unknownLocale })
    const card = new MailNotifyCard(env.ctx)
    const mounted = await mountCard(card)

    try {
      assert.equal(mounted.getTitleText(), 'Mail notifications', `unknown locale ${unknownLocale} must fall back to English`)
      assert.ok(mounted.getSummaryText().includes('Active'))
    } finally {
      await mounted.unmount()
    }
  }
})

test('L10N-09 localized validation', () => {
  const boolDef = ALL_FIELDS.find((f) => f.field === 'notifyQuestions')!
  const portDef = ALL_FIELDS.find((f) => f.field === 'smtpPort')!
  const toDef = ALL_FIELDS.find((f) => f.field === 'to')!

  const tZh = (key: LocaleKey, params?: Record<string, unknown>) => translate('zh', key, params)
  const tEn = (key: LocaleKey, params?: Record<string, unknown>) => translate('en', key, params)

  // Boolean validation
  const badBoolZh = parseField(boolDef, 'invalid-boolean', tZh)
  assert.equal(badBoolZh.kind, 'invalid')
  if (badBoolZh.kind === 'invalid') {
    assert.ok(badBoolZh.message.includes('必须为 true 或 false'))
  }

  const badBoolEn = parseField(boolDef, 'invalid-boolean', tEn)
  assert.equal(badBoolEn.kind, 'invalid')
  if (badBoolEn.kind === 'invalid') {
    assert.ok(badBoolEn.message.includes('must be true or false'))
  }

  // Numeric validation
  const badPortZh = parseField(portDef, '70000', tZh)
  assert.equal(badPortZh.kind, 'invalid')
  if (badPortZh.kind === 'invalid') {
    assert.ok(badPortZh.message.includes('不能大于 65535'))
  }

  const notNumberZh = parseField(portDef, 'abc', tZh)
  assert.equal(notNumberZh.kind, 'invalid')
  if (notNumberZh.kind === 'invalid') {
    assert.ok(notNumberZh.message.includes('必须为整数'))
  }

  // Address validation
  const badAddrZh = parseField(toDef, 'bad-email-format', tZh)
  assert.equal(badAddrZh.kind, 'invalid')
  if (badAddrZh.kind === 'invalid') {
    assert.ok(badAddrZh.message.includes('不是有效的邮箱地址'))
  }
})

test('L10N-10 localized operation states', async () => {
  const env = createFakeClientContext({ locale: 'zh' })
  const card = new MailNotifyCard(env.ctx)
  const mounted = await mountCard(card)

  try {
    await mounted.toggle()

    // Test Save button
    const buttons = Array.from(mounted.container.querySelectorAll('button'))
    const saveBtn = buttons.find((b) => b.textContent?.includes('保存'))
    assert.ok(saveBtn !== undefined, 'Save button must say 保存')

    const resetBtn = buttons.find((b) => b.textContent?.includes('恢复继承值'))
    assert.ok(resetBtn !== undefined, 'Reset button must say 恢复继承值')

    const sendTestBtn = buttons.find((b) => b.textContent?.includes('发送测试邮件'))
    assert.ok(sendTestBtn !== undefined, 'Send test email button must say 发送测试邮件')

    // Perform save to verify localized notice
    await act(async () => {
      card.edit('smtpHost', 'smtp.zh-test.org')
      await card.save()
    })
    assert.equal(card.getSnapshot().notice, '已保存。')

    // Perform test email to verify localized notice
    await act(async () => {
      await card.sendTestEmail()
    })
    assert.ok(card.getSnapshot().testEmail?.message.includes('SMTP 服务器已接受测试邮件'))
  } finally {
    await mounted.unmount()
  }
})

test('L10N-11 SMTP/TLS correctness', () => {
  // DSH, SMTP, TLS, STARTTLS must remain canonical across dictionaries
  for (const dict of [EN_DICT, ZH_DICT]) {
    assert.ok(dict.field_smtpHost_label.includes('SMTP'))
    assert.ok(dict.field_smtpPort_hint.includes('STARTTLS') && dict.field_smtpPort_hint.includes('TLS'))
    assert.ok(dict.field_smtpSecure_label.includes('TLS'))
    assert.ok(dict.field_smtpSecure_hint.includes('TLS') && dict.field_smtpSecure_hint.includes('STARTTLS'))
    assert.ok(dict.field_notifyQuestions_hint.includes('DSH'))
    assert.ok(dict.field_notifyApprovals_hint.includes('DSH'))
  }
})
