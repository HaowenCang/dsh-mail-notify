/**
 * Regression coverage for the card's localization contract — matrix rows
 * L10N-01 … L10N-11.
 *
 * The card must follow the DSH UI language with complete English and Simplified
 * Chinese copy, translate at render time (so a visible notice changes language
 * live), and keep canonical technical terms. The dictionary's key parity is a
 * compile-time property; these tests pin the runtime half: what actually
 * renders, in which language, and what happens on a locale switch.
 *
 * ## Scope of the locale model
 *
 * The card consumes one locale surface — the `t` seat the renderer derives from
 * `LocaleRuntime.bind(namespace)` per `(namespace, revision)` — and the seat in
 * `support/seat.ts` models exactly that published contract (entry-namespace
 * lookup with English fallback, a new translate identity per revision, change
 * notification to mounted outlets). L10N-07 and L10N-08 therefore prove the
 * card's half of the integration; the real service's half (registration into
 * `@deepseek-ai/dsh-client-locale@0.1.5-rc.2`, the preference, the fallback
 * chain, and the live switch in a mounted page) is verified against the
 * installed DSH in the real-browser run recorded in `MIMO_V2_6_PRO_EVAL.md`.
 * The plugin's registration call itself is checked by the compiler against the
 * real `LocaleRuntime` signatures in `src/client/index.tsx`.
 *
 * @module dsh-mail-notify/tests/client/locale
 */

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { act } from 'react'
import { en, zh, type MailNotifyLocaleKey } from '../../src/client/locale.ts'
import { click, fakeHost, mountCard, settle, type, type FakeHost, type Mounted } from './support/dom.ts'
import { createLocaleSeat, type LocaleSeat } from './support/seat.ts'

/** Stage a mounted card in one language, released when the test ends. */
async function mountedIn(t: TestContext, locale: string): Promise<{
  host: FakeHost
  mounted: Mounted
  seat: LocaleSeat
}> {
  const host = fakeHost()
  const seat = createLocaleSeat(locale)
  const mounted = await mountCard(host, seat)
  t.after(() => {
    mounted.unmount()
    mounted.card.dispose()
  })
  await settle(mounted)
  return { host, mounted, seat }
}

/** The card's visible text, collapsed or not. */
function textOf(mounted: Mounted): string {
  return mounted.container.textContent ?? ''
}

test('L10N-01 the English dictionary is complete', () => {
  for (const [key, value] of Object.entries(en)) {
    assert.notEqual(value.trim(), '', `${key} must have English copy`)
  }
  // Every `{param}` an entry mentions must be one the renderers actually pass;
  // a typo here would render as a bare placeholder in the UI.
  const passed = new Set(['field', 'min', 'max', 'entries', 'state', 'value', 'message', 'count', 'depth', 'size', 'delivered', 'failed', 'implicit', 'starttls'])
  for (const [key, value] of Object.entries(en)) {
    for (const match of value.matchAll(/\{(\w+)\}/g)) {
      const name = match[1]
      assert.ok(name !== undefined && passed.has(name), `${key} mentions unknown template param {${name}}`)
    }
  }
})

test('L10N-02 the Simplified Chinese dictionary has exact key parity', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const [key, value] of Object.entries(zh)) {
    assert.notEqual(value.trim(), '', `${key} must have Chinese copy`)
  }
  // The mandated vocabulary, pair by pair (task §14).
  const mandated: ReadonlyArray<readonly [MailNotifyLocaleKey, string, string]> = [
    ['cardTitle', 'Mail notifications', '邮件通知'],
    ['cardSubtitle', 'Configure email notifications', '配置邮件通知'],
    ['factActive', 'Active', '运行中'],
    ['factInactive', 'Inactive', '未运行'],
    ['factConfigured', 'Configured', '已配置'],
    ['factNotConfigured', 'Not configured', '未配置'],
    ['factOn', 'On', '已启用'],
    ['factOff', 'Off', '已关闭'],
    ['actionExpand', 'Expand', '展开'],
    ['actionCollapse', 'Collapse', '折叠'],
    ['groupGeneral', 'General', '常规'],
    ['groupNotifications', 'Notifications', '通知类型'],
    ['groupMessage', 'Message content', '邮件内容'],
    ['groupDelivery', 'Delivery', '发送与重试'],
    ['groupStatus', 'Status', '状态'],
    ['labelEnable', 'Enable mail notifications', '启用邮件通知'],
    ['labelIncludeSubagents', 'Include subagent activity', '包含子智能体活动'],
    ['labelCompleted', 'Completed turns', '任务完成'],
    ['labelErrors', 'Errors', '任务错误'],
    ['labelMaxTokens', 'Token-limit termination', '达到 Token 上限'],
    ['labelQuestions', 'Questions requiring input', '需要用户回答'],
    ['labelApprovals', 'Approval requests', '需要用户批准'],
    ['labelSmtpHost', 'SMTP host', 'SMTP 服务器'],
    ['labelSmtpPort', 'Port', '端口'],
    ['labelSecure', 'Security', '安全连接'],
    ['termImplicitTls', 'Implicit TLS', '隐式 TLS'],
    ['termStartTls', 'STARTTLS', 'STARTTLS'],
    ['labelSmtpUser', 'Username', '用户名'],
    ['labelSecret', 'Password', '密码'],
    ['passwordChange', 'Change password', '修改密码'],
    ['passwordSet', 'Set password', '设置密码'],
    ['labelFrom', 'From', '发件人'],
    ['labelRecipients', 'Recipients', '收件人'],
    ['labelIncludeMetadata', 'Include metadata', '包含元数据'],
    ['labelIncludeUserPrompt', 'Include user prompt', '包含用户提示词'],
    ['labelIncludeFooter', 'Include footer', '包含邮件页脚'],
    ['labelMaxBody', 'Maximum body length', '最大正文长度'],
    ['labelQueueSize', 'Queue size', '队列大小'],
    ['labelRetryAttempts', 'Retry attempts', '重试次数'],
    ['labelRetryBaseDelay', 'Retry base delay', '重试基础延迟'],
    ['actionSendTest', 'Send test email', '发送测试邮件'],
    ['actionReset', 'Reset', '恢复继承值'],
    ['actionSave', 'Save', '保存'],
    ['actionSaving', 'Saving…', '正在保存…'],
    ['noticeSaved', 'Saved', '已保存'],
    ['actionSending', 'Sending…', '正在发送…'],
    ['testEmailSent', 'Test email sent. The SMTP server accepted the message for {count} recipient(s).', '测试邮件已发送。SMTP 服务器已接受该邮件，共 {count} 个收件人。'],
  ]
  for (const [key, english, chinese] of mandated) {
    assert.equal(en[key], english, `the English copy of ${key} is mandated`)
    assert.equal(zh[key], chinese, `the Chinese copy of ${key} is mandated`)
  }
  // §15's human-attention copy is mandated verbatim in both languages.
  assert.equal(en.labelQuestions, 'Questions requiring input')
  assert.equal(en.hintQuestions, 'Send an email immediately when DSH is waiting for your answer.')
  assert.equal(zh.labelQuestions, '需要用户回答')
  assert.equal(zh.hintQuestions, '当 DSH 正在等待你的回答时立即发送邮件。')
  assert.equal(en.labelApprovals, 'Approval requests')
  assert.equal(en.hintApprovals, 'Send an email immediately when DSH is waiting for your approval.')
  assert.equal(zh.labelApprovals, '需要用户批准')
  assert.equal(zh.hintApprovals, '当 DSH 正在等待你的批准决定时立即发送邮件。')
})

test('L10N-03 the English card title renders', async (t) => {
  const { mounted } = await mountedIn(t, 'en')
  assert.ok(textOf(mounted).includes('Mail notifications'))
})

test('L10N-04 the Chinese card title renders: 邮件通知', async (t) => {
  const { mounted } = await mountedIn(t, 'zh')
  assert.ok(textOf(mounted).includes('邮件通知'), 'the collapsed card must carry the Chinese title')
})

test('L10N-05 the Chinese form renders: 需要用户回答', async (t) => {
  const { mounted } = await mountedIn(t, 'zh')
  await click(mounted.toggle())
  assert.ok(textOf(mounted).includes('需要用户回答'))
})

test('L10N-06 the Chinese form renders: 需要用户批准', async (t) => {
  const { mounted } = await mountedIn(t, 'zh')
  await click(mounted.toggle())
  assert.ok(textOf(mounted).includes('需要用户批准'))
})

test('L10N-07 a live locale switch updates a mounted card, notice included, without a reload', async (t) => {
  const { host, mounted, seat } = await mountedIn(t, 'en')
  await click(mounted.toggle())
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.saved.invalid')
  await click(mounted.action('save'))
  await settle(mounted)
  const notice = mounted.container.querySelector('[data-notice="operation"]')
  assert.ok(notice !== null)
  assert.ok((notice.textContent ?? '').includes('Saved'), 'the English notice is on screen')

  // The very same DOM nodes must come back in Chinese: the seat's revision
  // re-rendered the mounted card, and the notice is retranslated because the
  // controller stored its identity rather than its English text.
  const section = mounted.container.querySelector('section')
  const noticeNode = notice
  seat.setLocale('zh')
  await act(async () => {
    /* the seat notification re-renders; this flushes it */
  })
  assert.equal(mounted.container.querySelector('section'), section, 'the card must not remount')
  assert.equal(mounted.container.querySelector('[data-notice="operation"]'), noticeNode)
  assert.ok(textOf(mounted).includes('邮件通知'))
  assert.ok((noticeNode.textContent ?? '').includes('已保存'), 'the visible notice switched language live')
  assert.ok(seat.revision > 0, 'the switch advanced the seat revision')
  // And back again, with the same guarantee.
  seat.setLocale('en')
  await act(async () => {
    /* flush */
  })
  assert.ok((noticeNode.textContent ?? '').includes('Saved'))
  assert.equal(host.mutations.length, 1, 'a locale switch must not re-save anything')
})

test('L10N-08 an unsupported locale falls back to English', async (t) => {
  const { mounted, seat } = await mountedIn(t, 'en')
  await click(mounted.toggle())
  seat.setLocale('fr')
  await act(async () => {
    /* flush */
  })
  // `fr` is not a language this plugin ships a dictionary for; the lookup
  // chain's terminal behaviour is the English copy, never a bare key.
  const text = textOf(mounted)
  assert.ok(text.includes('Mail notifications'))
  assert.ok(!text.includes('cardTitle'), 'a missing key must never render as itself')
  assert.equal(seat.active, 'fr')
})

test('L10N-09 validation refusals are localized', async (t) => {
  const { mounted } = await mountedIn(t, 'zh')
  await click(mounted.toggle())
  await type(mounted.field('smtpPort') as HTMLInputElement, 'abc')
  const refusal = mounted.container.querySelector('[data-field-invalid="smtpPort"]')
  assert.ok(refusal !== null, 'the field must report its refusal')
  const text = refusal.textContent ?? ''
  assert.ok(text.includes('端口 必须为整数'), `the refusal must name the localized field and rule (got "${text}")`)
  assert.ok(text.includes('该值会导致保存失败。'))

  // The same edit in English renders the English rule through the same
  // identity, with the field label localized too.
  mounted.seat.setLocale('en')
  await act(async () => {
    /* flush */
  })
  const english = mounted.container.querySelector('[data-field-invalid="smtpPort"]')?.textContent ?? ''
  assert.ok(english.includes('Port must be a whole number'), `got "${english}"`)
})

test('L10N-10 save and delivery-test operation messages are localized', async (t) => {
  const { mounted } = await mountedIn(t, 'zh')
  await click(mounted.toggle())
  await type(mounted.field('smtpHost') as HTMLInputElement, 'smtp.saved.invalid')
  await click(mounted.action('save'))
  await settle(mounted)
  const notice = mounted.container.querySelector('[data-notice="operation"]')?.textContent ?? ''
  assert.ok(notice.includes('已保存'), `the save outcome must render in Chinese (got "${notice}")`)

  await click(mounted.action('send-test'))
  await settle(mounted)
  const result = mounted.container.querySelector('[data-notice="test-email"]')?.textContent ?? ''
  assert.ok(result.includes('测试邮件已发送'), `the delivery-test outcome must render in Chinese (got "${result}")`)
})

test('L10N-11 the canonical technical terms stay correct in both languages', async (t) => {
  const chinese = await mountedIn(t, 'zh')
  await click(chinese.mounted.toggle())
  const zhText = textOf(chinese.mounted)
  assert.ok(zhText.includes('隐式 TLS'), 'the security hint names implicit TLS in Chinese')
  assert.ok(zhText.includes('STARTTLS'), 'STARTTLS keeps its canonical spelling')
  assert.ok(zhText.includes('SMTP 服务器'), 'SMTP stays SMTP in the Chinese label')
  assert.ok(zhText.includes('当 DSH 正在等待你的回答时立即发送邮件。'), 'DSH stays DSH in the Chinese hint')
  assert.ok(!zhText.includes('TLS升级'), 'no glued pseudo-term replaces the canonical spacing')
  chinese.mounted.unmount()
  chinese.mounted.card.dispose()

  const english = await mountedIn(t, 'en')
  await click(english.mounted.toggle())
  const enText = textOf(english.mounted)
  assert.ok(enText.includes('Implicit TLS'))
  assert.ok(enText.includes('STARTTLS'))
  assert.ok(enText.includes('SMTP host'))
})
