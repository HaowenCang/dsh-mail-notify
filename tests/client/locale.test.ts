/**
 * Localization acceptance tests (L10N-01 … L10N-11).
 *
 * The dictionaries under test are the SOURCE dictionaries (`src/client/locales.ts`)
 * and the copy the BUILT card renders — both matter: the source proves key
 * parity and the required vocabulary, the render proves the card resolves
 * every string through the `t` seat rather than through module-level literals.
 * The locale double mirrors the installed rc.2 `LocaleRuntime` lookup (active
 * chain → English → key), so the fallback assertions test the same rule the
 * shell executes; the live-switch assertion drives the outlet's revision
 * subscription, which is how the real renderer re-renders mounted outlets.
 *
 * @module dsh-mail-notify/tests/client/locale
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { en, zh, type MailNotifyLocaleKey } from '../../src/client/locales.ts'
import { screen, setupUser, renderCard } from './harness/render.ts'
import { chainFor, translate } from './harness/locale.ts'

/** English and Chinese key lists, sorted for order-independent comparison. */
const enKeys = Object.keys(en).sort()
const zhKeys = Object.keys(zh).sort()

test('L10N-01 the English dictionary is complete and free of empty copy', () => {
  assert.ok(enKeys.length >= 90, `expected a full vocabulary, got ${String(enKeys.length)} keys`)
  for (const key of enKeys) {
    const value = en[key as MailNotifyLocaleKey]
    assert.equal(typeof value, 'string', `en[${key}] must be a string`)
    assert.ok(value.trim() !== '', `en[${key}] must not be empty`)
  }
  // Every field definition resolves to real keys — the compile step already
  // enforces this through the typed table; this pins the runtime evidence.
  for (const key of enKeys) {
    assert.ok(key.includes('.'), `keys are dotted and namespaced: ${key}`)
  }
})

test('L10N-02 the Simplified Chinese dictionary has an identical key domain', () => {
  assert.deepEqual(zhKeys, enKeys, 'zh and en must declare exactly the same keys')
  for (const key of zhKeys) {
    const value = zh[key as MailNotifyLocaleKey]
    assert.ok(value.trim() !== '', `zh[${key}] must not be empty`)
  }
  // No dictionary value may leak English prose into the Chinese UI: a zh value
  // containing Latin letters must be one of the canonical technical terms
  // (DSH, SMTP, TLS, STARTTLS, Token), a template/parameter form, or one of
  // the handful of source-language words kept verbatim (true/false, agent,
  // schema, base).
  const latinAllowed = /(\{|DSH|SMTP|TLS|STARTTLS|Token|true|false|agent|schema|base)/u
  for (const key of zhKeys) {
    const value = zh[key as MailNotifyLocaleKey]
    if (/[A-Za-z]/u.test(value)) {
      assert.ok(latinAllowed.test(value), `zh[${key}] carries unexpected Latin prose: ${value}`)
    }
  }
})

/** The required §14/§15 vocabulary pairs that must exist as exact values. */
const EXACT_VOCABULARY: ReadonlyArray<readonly [string, string]> = [
  ['Mail notifications', '邮件通知'],
  ['Configure email notifications', '配置邮件通知'],
  ['Active', '运行中'],
  ['Inactive', '未运行'],
  ['Configured', '已配置'],
  ['Not configured', '未配置'],
  ['On', '已启用'],
  ['Off', '已关闭'],
  ['Expand', '展开'],
  ['Collapse', '折叠'],
  ['General', '常规'],
  ['Notifications', '通知类型'],
  ['Message content', '邮件内容'],
  ['Delivery', '发送与重试'],
  ['Status', '状态'],
  ['Enable mail notifications', '启用邮件通知'],
  ['Include subagent activity', '包含子智能体活动'],
  ['Completed turns', '任务完成'],
  ['Errors', '任务错误'],
  ['Token-limit termination', '达到 Token 上限'],
  ['Questions requiring input', '需要用户回答'],
  ['Approval requests', '需要用户批准'],
  ['SMTP host', 'SMTP 服务器'],
  ['Port', '端口'],
  ['Security', '安全连接'],
  ['Username', '用户名'],
  ['Password', '密码'],
  ['Change password', '修改密码'],
  ['Set password', '设置密码'],
  ['From', '发件人'],
  ['Recipients', '收件人'],
  ['Include metadata', '包含元数据'],
  ['Include user prompt', '包含用户提示词'],
  ['Include footer', '包含邮件页脚'],
  ['Maximum body length', '最大正文长度'],
  ['Queue size', '队列大小'],
  ['Retry attempts', '重试次数'],
  ['Send test email', '发送测试邮件'],
  ['Reset', '恢复继承值'],
  ['Save', '保存'],
  ['Saving…', '正在保存…'],
  ['Sending…', '正在发送…'],
]

/** Pairs that live inside a longer label or hint rather than as a whole value. */
const CONTAINED_VOCABULARY: ReadonlyArray<readonly [string, string]> = [
  ['Implicit TLS', '隐式 TLS'],
  ['STARTTLS', 'STARTTLS'],
  ['Retry base delay', '重试基础延迟'],
  ['Saved', '已保存'],
  ['Test email sent', '测试邮件已发送'],
]

test('L10N-01b every required §14 vocabulary pair exists in both dictionaries', () => {
  const enValues = Object.values(en)
  const zhValues = Object.values(zh)
  for (const [enPhrase, zhPhrase] of EXACT_VOCABULARY) {
    assert.ok(enValues.includes(enPhrase), `an English value must be exactly "${enPhrase}"`)
    assert.ok(zhValues.includes(zhPhrase), `a Chinese value must be exactly "${zhPhrase}"`)
  }
  for (const [enPhrase, zhPhrase] of CONTAINED_VOCABULARY) {
    assert.ok(
      enValues.some((value) => value.includes(enPhrase)),
      `an English value must contain "${enPhrase}"`,
    )
    assert.ok(
      zhValues.some((value) => value.includes(zhPhrase)),
      `a Chinese value must contain "${zhPhrase}"`,
    )
  }
})

test('L10N-05b the two human-attention switches carry the required §15 copy', () => {
  assert.equal(en['field.notifyQuestions.hint'], 'Send an email immediately when DSH is waiting for your answer.')
  assert.equal(zh['field.notifyQuestions.hint'], '当 DSH 正在等待你的回答时立即发送邮件。')
  assert.equal(en['field.notifyApprovals.hint'], 'Send an email immediately when DSH is waiting for your approval.')
  assert.equal(zh['field.notifyApprovals.hint'], '当 DSH 正在等待你的批准决定时立即发送邮件。')
  assert.equal(en['field.notifyQuestions.label'], 'Questions requiring input')
  assert.equal(zh['field.notifyQuestions.label'], '需要用户回答')
  assert.equal(en['field.notifyApprovals.label'], 'Approval requests')
  assert.equal(zh['field.notifyApprovals.label'], '需要用户批准')
})

test('L10N-03 the English title renders', async () => {
  renderCard({}, 'en')
  await screen.findByText('Mail notifications')
})

test('L10N-04 the Chinese title renders 邮件通知', async () => {
  renderCard({}, 'zh')
  await screen.findByText('邮件通知')
  // The collapsed summary follows too — same dictionary, same seat.
  await screen.findByText(/运行中/)
})

test('L10N-05 Chinese renders 需要用户回答 in the expanded form', async () => {
  const user = setupUser()
  const card = renderCard({}, 'zh')
  await user.click(card.header())
  await screen.findByText('需要用户回答')
})

test('L10N-06 Chinese renders 需要用户批准 in the expanded form', async () => {
  const user = setupUser()
  const card = renderCard({}, 'zh')
  await user.click(card.header())
  await screen.findByText('需要用户批准')
})

test('L10N-07 an active DSH locale switch updates the mounted card', async () => {
  const card = renderCard({}, 'en')
  await screen.findByText('Mail notifications')
  // The outlet subscribes to the locale revision exactly as the renderer's
  // outlets do; no test-level rerender happens here.
  card.host.locale.setLocale('zh')
  await screen.findByText('邮件通知')
  assert.equal(screen.queryByText('Mail notifications'), null, 'the English copy must be gone')
  card.host.locale.setLocale('en')
  await screen.findByText('Mail notifications')
  assert.equal(screen.queryByText('邮件通知'), null)
})

test('L10N-08 an unknown locale falls back to English', async () => {
  const card = renderCard({}, 'zh')
  await screen.findByText('邮件通知')
  // `ja` is not a shipped locale of this plugin: the DSH lookup chain for any
  // non-built-in active locale terminates at English, so every key resolves
  // from the en dictionary — never as a raw key.
  card.host.locale.setLocale('ja')
  await screen.findByText('Mail notifications')
  const header = card.header()
  assert.ok(!(header.textContent ?? '').includes('card.title'), 'no raw key may surface')
  assert.deepEqual(chainFor('ja'), ['ja', 'en'])
  assert.equal(translate({ 'dsh-mail-notify': { en } }, 'ja', 'card.title'), 'Mail notifications')
})

test('L10N-09 validation messages are localized', async () => {
  const user = setupUser()
  const card = renderCard({}, 'zh')
  await user.click(card.header())
  const port = screen.getByRole('textbox', { name: /端口/i })
  await user.type(port, 'abc')
  await screen.findByText('端口 必须为整数')
  await screen.findByText('此值会导致保存被拒绝。')
  // The same draft in English is the same rule in English.
  card.host.locale.setLocale('en')
  await screen.findByText('Port must be a whole number')
  await screen.findByText('This value will block the save.')
})

test('L10N-10 save and test-email state messages are localized', async () => {
  const user = setupUser()
  const card = renderCard({ base: { smtpHost: 'smtp.example.test' } }, 'zh')
  await user.click(card.header())
  await user.type(screen.getByRole('textbox', { name: /SMTP 服务器/i }), '.cn')
  await user.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('已保存。')
  await user.click(screen.getByRole('button', { name: '发送测试邮件' }))
  await screen.findByText(/测试邮件已发送/)
})

test('L10N-11 SMTP/TLS technical labels stay canonical in Chinese', async () => {
  const user = setupUser()
  const card = renderCard({}, 'zh')
  await user.click(card.header())
  await screen.findByText('SMTP 服务器')
  await screen.findByText('端口')
  await screen.findByText('安全连接')
  // Both hints, addressed by their full copy: a partial regex would match the
  // same terms in several hints at once.
  await screen.findByText('STARTTLS 用 587，隐式 TLS 用 465。')
  await screen.findByText('开启为隐式 TLS（通常 465 端口）；关闭则允许 STARTTLS 升级（通常 587 端口）。')
})
