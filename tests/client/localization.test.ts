/**
 * L10N-01…L10N-11: the card's English and Simplified Chinese copy.
 *
 * Three kinds of claim are made here, and they are kept apart on purpose.
 *
 * - **Vocabulary claims** are made against the two dictionaries directly. They
 *   assert key parity and the exact required translations, which is a statement
 *   about the locale layer.
 * - **Rendering claims** are made against the mounted card. They assert that
 *   what the user sees in each language is the required copy, which is a
 *   statement about the wiring: a dictionary can be perfect and still never
 *   reach the screen.
 * - **Fallback claims** are made about the lookup chain. An unknown locale must
 *   resolve to English, and the shared technical terms must stay verbatim in
 *   both languages.
 *
 * @module dsh-mail-notify/tests/client/localization
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { en, LOCALE_NAMESPACE, zh, type MailNotifyLocaleKey } from '../../src/client/locales/index.ts'
import { ALL_FIELDS } from '../../src/client/fields.ts'
import {
  click,
  isOpen,
  makeLocale,
  mountCard,
  queryAll,
  settle,
  toggle,
  type,
} from './support/dom.ts'

/**
 * The vocabulary the task requires, as key-to-pair.
 *
 * Written as the requirement states it rather than as the dictionaries happen
 * to read, so a dictionary edit that breaks a required translation fails here
 * instead of redefining the requirement.
 */
const REQUIRED: ReadonlyArray<readonly [MailNotifyLocaleKey, string, string]> = [
  ['title', 'Mail notifications', '邮件通知'],
  ['subtitle', 'Configure email notifications', '配置邮件通知'],
  ['summary.active', 'Active', '运行中'],
  ['summary.inactive', 'Not running', '未运行'],
  ['value.configured', 'Configured', '已配置'],
  ['value.notConfigured', 'Not configured', '未配置'],
  ['value.on', 'On', '已启用'],
  ['value.off', 'Off', '已关闭'],
  ['summary.expand', 'Expand', '展开'],
  ['summary.collapse', 'Collapse', '折叠'],
  ['group.general', 'General', '常规'],
  ['group.notifications', 'Notifications', '通知类型'],
  ['group.message', 'Message content', '邮件内容'],
  ['group.delivery', 'Delivery', '发送与重试'],
  ['group.status', 'Status', '状态'],
  ['field.enabled', 'Enable mail notifications', '启用邮件通知'],
  ['field.includeSubagents', 'Include subagent activity', '包含子智能体活动'],
  ['field.notifyCompleted', 'Completed turns', '任务完成'],
  ['field.notifyErrors', 'Errors', '任务错误'],
  ['field.notifyMaxTokens', 'Token-limit termination', '达到 Token 上限'],
  ['field.notifyQuestions', 'Questions requiring input', '需要用户回答'],
  ['field.notifyApprovals', 'Approval requests', '需要用户批准'],
  ['field.smtpHost', 'SMTP host', 'SMTP 服务器'],
  ['field.smtpPort', 'Port', '端口'],
  ['field.smtpSecure', 'Security', '安全连接'],
  ['field.smtpUser', 'Username', '用户名'],
  ['secret.label', 'Password', '密码'],
  ['secret.change', 'Change password', '修改密码'],
  ['secret.set', 'Set password', '设置密码'],
  ['secret.clear', 'Clear stored password', '清除已存密码'],
  ['field.from', 'From', '发件人'],
  ['field.to', 'Recipients', '收件人'],
  ['field.includeMetadata', 'Include metadata', '包含元数据'],
  ['field.includeUserPrompt', 'Include user prompt', '包含用户提示词'],
  ['field.includeFooter', 'Include footer', '包含邮件页脚'],
  ['field.maxBodyChars', 'Maximum body length', '最大正文长度'],
  ['field.queueSize', 'Queue size', '队列大小'],
  ['field.retryAttempts', 'Retry attempts', '重试次数'],
  ['field.retryBaseDelayMs', 'Retry base delay', '重试基础延迟'],
  ['action.sendTest', 'Send test email', '发送测试邮件'],
  ['action.reset', 'Reset', '恢复继承值'],
  ['action.save', 'Save', '保存'],
  ['action.saving', 'Saving…', '正在保存…'],
  ['notice.saved', 'Saved', '已保存'],
  ['action.sending', 'Sending…', '正在发送…'],
  ['action.testSent', 'Test email sent', '测试邮件已发送'],
]

/**
 * The two human-attention controls, whose labels *and* descriptions the task
 * fixes verbatim.
 */
const REQUIRED_ATTENTION: ReadonlyArray<readonly [MailNotifyLocaleKey, MailNotifyLocaleKey, string, string, string, string]> = [
  [
    'field.notifyQuestions',
    'hint.notifyQuestions',
    'Questions requiring input',
    '需要用户回答',
    'Send an email immediately when DSH is waiting for your answer.',
    '当 DSH 正在等待你的回答时立即发送邮件。',
  ],
  [
    'field.notifyApprovals',
    'hint.notifyApprovals',
    'Approval requests',
    '需要用户批准',
    'Send an email immediately when DSH is waiting for your approval.',
    '当 DSH 正在等待你的批准决定时立即发送邮件。',
  ],
]

/** Terms that must stay verbatim in both dictionaries. */
const CANONICAL_TERMS = ['DSH', 'SMTP', 'TLS', 'STARTTLS'] as const

/** The card's rendered text, with collapsed whitespace. */
function textOf(root: ParentNode): string {
  return (root.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Expand the card and return its text. */
async function expandedText(card: Awaited<ReturnType<typeof mountCard>>): Promise<string> {
  await toggle(card.tree.container)
  return textOf(card.tree.container)
}

test('L10N-01 the English dictionary carries every required English string exactly', async () => {
  for (const [key, expected] of REQUIRED.map(([k, enText]) => [k, enText] as const)) {
    assert.equal(en[key], expected, `en.${key}`)
  }
  for (const [labelKey, hintKey, expectedLabel, , expectedHint] of REQUIRED_ATTENTION) {
    assert.equal(en[labelKey], expectedLabel)
    assert.equal(en[hintKey], expectedHint)
  }
  assert.ok(en.description.length > 0, 'the description line must be present')
})

test('L10N-02 the Chinese dictionary has exactly the same key domain, with no English left behind', async () => {
  const enKeys = Object.keys(en).sort()
  const zhKeys = Object.keys(zh).sort()
  assert.deepEqual(zhKeys, enKeys, 'the two dictionaries must declare the same keys')

  for (const [key, , expected] of REQUIRED) {
    assert.equal(zh[key], expected, `zh.${key}`)
  }
  for (const [labelKey, hintKey, , expectedLabel, , expectedHint] of REQUIRED_ATTENTION) {
    assert.equal(zh[labelKey], expectedLabel)
    assert.equal(zh[hintKey], expectedHint)
  }
})

test('L10N-02b no Chinese entry is left in English', async () => {
  // A key that was added to `zh` by copying `en` is the failure this catches.
  // Proper nouns and the canonical technical terms are the only permitted
  // exceptions, and they are enumerated rather than pattern-matched.
  const allowed = new Set([
    'field.smtpHost',
    'field.smtpSecure',
    'field.smtpUser',
    'group.smtp',
    'hint.smtpHost',
    'hint.smtpPort',
    'hint.smtpSecure',
    'status.pluginLabel',
    'status.credentialLabel',
    'secret.label',
    'notice.testAccepted',
    'action.sending',
    'action.saving',
    'summary.unsaved',
  ])
  const suspicious: string[] = []
  for (const key of Object.keys(zh) as MailNotifyLocaleKey[]) {
    if (allowed.has(key)) continue
    const value = zh[key]
    if (/[a-z]{3,}/.test(value) && !/[\u4e00-\u9fff]/.test(value)) suspicious.push(`${key} = ${value}`)
  }
  assert.deepEqual(suspicious, [], 'these entries look like untranslated English')
})

test('L10N-03 the mounted card renders the English title', async () => {
  const card = await mountCard()
  const root = card.tree.container
  assert.equal(root.querySelector('section')?.getAttribute('aria-label'), 'Mail notifications')
  assert.ok(textOf(root).includes('Mail notifications'))
  await card.tree.unmount()
})

test('L10N-04 every control, group, and hint reaches the screen without leaking a key', async () => {
  // The end-to-end claim the dictionary tests cannot make: the keys the field
  // table names are the keys the locale layer holds, so nothing renders as
  // `field.smtpHost` and nothing is missing.
  const card = await mountCard()
  const text = await expandedText(card)
  assert.equal(/field\.|hint\.|group\.|action\.|notice\.|secret\.|validation\./.test(text), false, `a locale key was rendered as text: ${text}`)
  for (const def of ALL_FIELDS) {
    assert.ok(text.includes(en[def.labelKey]), `the label "${en[def.labelKey]}" must be rendered`)
    assert.ok(text.includes(en[def.hintKey]), `the hint for ${def.field} must be rendered`)
  }
  for (const [labelKey, hintKey] of REQUIRED_ATTENTION) {
    assert.ok(text.includes(en[labelKey]))
    assert.ok(text.includes(en[hintKey]))
  }
  assert.ok(text.includes(en['secret.change']) || text.includes(en['secret.set']))
  assert.ok(text.includes(en['action.sendTest']))
  assert.ok(text.includes(en['action.reset']))
  assert.ok(text.includes(en['action.save']))
  await card.tree.unmount()
})

test('L10N-04b every group title is rendered', async () => {
  const card = await mountCard()
  const text = await expandedText(card)
  for (const key of [
    'group.status',
    'group.general',
    'group.notifications',
    'group.humanAttention',
    'group.smtp',
    'group.credential',
    'group.message',
    'group.delivery',
  ] as const) {
    assert.ok(text.includes(en[key]), `${key} must be rendered`)
  }
  await card.tree.unmount()
})

test('L10N-05 switching to Simplified Chinese renders 邮件通知 and the required labels', async () => {
  const card = await mountCard()
  const root = card.tree.container
  assert.ok(textOf(root).includes('Mail notifications'), 'the card opens in the active locale')

  card.locale.setLocale('zh')
  await settle()

  assert.ok(textOf(root).includes('邮件通知'), 'the title must follow the locale')
  assert.equal(root.querySelector('section')?.getAttribute('aria-label'), '邮件通知')
  const text = await expandedText(card)
  for (const key of [
    'group.general',
    'group.notifications',
    'group.message',
    'group.delivery',
    'action.sendTest',
    'action.reset',
    'action.save',
  ] as const) {
    assert.ok(text.includes(zh[key]), `${key} must render as ${zh[key]}`)
  }
  await card.tree.unmount()
})

test('L10N-05b 需要用户回答 and 需要用户批准 are prominent, with their localised descriptions', async () => {
  const card = await mountCard()
  card.locale.setLocale('zh')
  await settle()
  const text = await expandedText(card)
  assert.ok(text.includes('需要用户回答'))
  assert.ok(text.includes('当 DSH 正在等待你的回答时立即发送邮件。'))
  assert.ok(text.includes('需要用户批准'))
  assert.ok(text.includes('当 DSH 正在等待你的批准决定时立即发送邮件。'))
  await card.tree.unmount()
})

test('L10N-05c the collapse control is announced in the active locale', async () => {
  const card = await mountCard()
  const header = card.tree.container.querySelector('section > button')
  assert.ok(header !== null)
  assert.equal(header.getAttribute('aria-label'), 'Expand: Mail notifications')
  card.locale.setLocale('zh')
  await settle()
  assert.equal(header.getAttribute('aria-label'), '展开: 邮件通知')
  await toggle(card.tree.container)
  assert.equal(header.getAttribute('aria-label'), '折叠: 邮件通知')
  await card.tree.unmount()
})

test('L10N-06 a language switch reaches the card while it is mounted', async () => {
  // DSH re-derives each entry's `t` from (namespace, revision); the harness's
  // wrapper subscribes to the same snapshot the renderer does, so this is the
  // mounted-card half of that mechanism.
  const card = await mountCard()
  const root = card.tree.container
  assert.ok(textOf(root).includes('Active'))

  card.locale.setLocale('zh')
  await settle()
  assert.ok(textOf(root).includes('运行中'), 'the collapsed summary must follow the switch')
  assert.equal(textOf(root).includes('Active'), false, 'the previous language must be gone')

  card.locale.setLocale('en')
  await settle()
  assert.ok(textOf(root).includes('Active'), 'the switch must be reversible')
  await card.tree.unmount()
})

test('L10N-06b a refusal already on screen follows a language switch', async () => {
  // The projection carries copy keys rather than finished sentences, which is
  // what makes this possible without replaying the action.
  const card = await mountCard()
  const root = card.tree.container
  await toggle(root)
  const labels = queryAll<HTMLLabelElement>('label', root)
  const portLabel = labels.find((element) => element.textContent?.includes('Port'))
  assert.ok(portLabel !== undefined)
  const port = portLabel.querySelector('input')
  assert.ok(port !== null)
  await type(port, 'abc')
  assert.ok(textOf(root).includes('Port must be a whole number'), 'the refusal must be reported in English')

  card.locale.setLocale('zh')
  await settle()
  assert.ok(textOf(root).includes('端口 必须是整数'), 'the same refusal must be re-rendered in Chinese')
  assert.equal(textOf(root).includes('must be a whole number'), false)
  await card.tree.unmount()
})

test('L10N-06c a save result already on screen follows a language switch', async () => {
  const card = await mountCard()
  const root = card.tree.container
  await toggle(root)
  const labels = queryAll<HTMLLabelElement>('label', root)
  const hostLabel = labels.find((element) => element.textContent?.includes('SMTP host'))
  assert.ok(hostLabel !== undefined)
  const host = hostLabel.querySelector('input')
  assert.ok(host !== null)
  await type(host, 'smtp.example.com')
  const save = queryAll<HTMLButtonElement>('button', root).find((button) => button.textContent?.trim() === 'Save')
  assert.ok(save !== undefined)
  await click(save)
  await settle(4)
  assert.ok(textOf(root).includes('Saved'))

  card.locale.setLocale('zh')
  await settle()
  assert.ok(textOf(root).includes('已保存'), 'the save outcome must be re-rendered in Chinese')
  await card.tree.unmount()
})

test('L10N-07 an unknown locale falls back to English', async () => {
  // Two distinct cases, both required.
  //
  // The first is the language-pack case: DSH has a registered language for
  // which this plugin shipped no dictionary. The service resolves the active
  // language, so its own chain reaches English — but only if the plugin's layer
  // does not defeat that by registering a blank or partial zh/en pair. The
  // dictionaries register whole, so the chain resolves.
  const packed = makeLocale(['fr'])
  packed.locale.setLocale('fr')
  const fr = packed.locale.bind(LOCALE_NAMESPACE)
  assert.equal(packed.locale.getSnapshot().active, 'fr')
  assert.equal(fr('title', undefined), 'Mail notifications', 'an unshipped language must read English')
  assert.equal(fr('action.save', undefined), 'Save')

  // The plugin's own dictionaries are unaffected by the extra language.
  packed.locale.setLocale('zh')
  assert.equal(fr('title', undefined), '邮件通知')

  // The second case is an id no language registered at all. The service refuses
  // it outright rather than activating a language nothing supports, which is
  // what keeps the UI out of an unsupported state.
  const { locale } = makeLocale()
  assert.throws(() => {
    locale.setLocale('de')
  }, /unknown locale/)
  assert.equal(locale.getSnapshot().active, 'en', 'a refused switch must not move the active locale')
})

test('L10N-08 a key absent from the active language resolves from English', async () => {
  // The locale service walks the active language, then English, then the shared
  // common namespace, then the key itself. The plugin depends on the first two
  // steps; this pins that its own layer does not defeat them by shipping a
  // dictionary that overrides English with blanks.
  for (const key of Object.keys(en) as MailNotifyLocaleKey[]) {
    assert.notEqual(zh[key], '', `zh.${key} must not be empty`)
    assert.notEqual(en[key], '', `en.${key} must not be empty`)
  }
})

test('L10N-09 validation copy is localised, including the field name it quotes', async () => {
  const card = await mountCard()
  card.locale.setLocale('zh')
  await settle()
  const root = card.tree.container
  await toggle(root)

  const labels = queryAll<HTMLLabelElement>('label', root)
  const portLabel = labels.find((element) => element.textContent?.includes('端口'))
  assert.ok(portLabel !== undefined, 'the port field must be labelled in Chinese')
  const port = portLabel.querySelector('input')
  assert.ok(port !== null)
  await type(port, 'abc')
  assert.ok(textOf(root).includes('端口 必须是整数'), 'the refusal must use the Chinese field name')

  await type(port, '0')
  assert.ok(textOf(root).includes('端口 不能小于 1'), 'a bound refusal must interpolate the bound')

  card.locale.setLocale('en')
  await settle()
  assert.ok(textOf(root).includes('Port must be at least 1'), 'the same refusal must follow the switch back')
  await card.tree.unmount()
})

test('L10N-10 the save and delivery-test states are localised', async () => {
  const card = await mountCard()
  card.locale.setLocale('zh')
  await settle()
  const root = card.tree.container
  await toggle(root)
  const text = textOf(root)
  assert.ok(text.includes('保存'))
  assert.ok(text.includes('发送测试邮件'))
  assert.ok(text.includes('恢复继承值'))

  await click(queryAll<HTMLButtonElement>('button', root).find((b) => b.textContent?.trim() === '发送测试邮件') as HTMLButtonElement)
  await settle(4)
  assert.ok(textOf(root).includes('SMTP 服务器已接受该邮件'), 'the delivery outcome must be Chinese')
  await card.tree.unmount()
})

test('L10N-10b a host diagnostic is passed through unchanged in both locales', async () => {
  // The plugin did not author the settings provider's refusal, does not know
  // its language, and must not pretend to translate it.
  const card = await mountCard()
  const root = card.tree.container

  // Make the transport refuse, then attempt a save.
  const scope = (card.double.ctx as { settingsScope: { mutate: unknown } }).settingsScope
  scope.mutate = async () => {
    throw new Error('document revision moved')
  }
  await toggle(root)
  const labels = queryAll<HTMLLabelElement>('label', root)
  const hostLabel = labels.find((element) => element.textContent?.includes('SMTP host'))
  assert.ok(hostLabel !== undefined)
  const host = hostLabel.querySelector('input')
  assert.ok(host !== null)
  await type(host, 'smtp.example.com')
  await click(queryAll<HTMLButtonElement>('button', root).find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement)
  await settle(4)
  assert.ok(textOf(root).includes('The host did not accept the save.'), 'the frame is plugin copy')
  assert.ok(textOf(root).includes('document revision moved'), 'the diagnostic is quoted verbatim')

  card.locale.setLocale('zh')
  await settle()
  assert.ok(textOf(root).includes('宿主没有接受这次保存。'), 'the frame follows the locale')
  assert.ok(textOf(root).includes('document revision moved'), 'the diagnostic does not')
  await card.tree.unmount()
})

test('L10N-11 SMTP, TLS, STARTTLS, and DSH stay verbatim in both languages', async () => {
  for (const dictionary of [en, zh]) {
    for (const term of CANONICAL_TERMS) {
      const carrying = Object.entries(dictionary).filter(([, value]) => value.includes(term))
      assert.ok(carrying.length > 0, `${term} must appear in the dictionary`)
      for (const [key, value] of carrying) {
        assert.ok(
          new RegExp(`${term}(?![A-Za-z])`).test(value) || term === value,
          `${key} must spell ${term} canonically, not as a translation: ${value}`,
        )
      }
    }
  }
  // The three settings the task names explicitly, in both languages.
  assert.equal(`${zh['hint.smtpHost']}`.includes('SMTP'), true)
  assert.equal(`${zh['field.smtpSecure']}`, '安全连接')
  assert.ok(zh['hint.smtpPort'].includes('STARTTLS'))
  assert.ok(zh['hint.smtpPort'].includes('TLS'))
  assert.ok(zh['hint.smtpSecure'].includes('TLS'))
  assert.ok(zh['hint.smtpSecure'].includes('STARTTLS'))
})

test('L10N-11b the mounted Chinese card shows SMTP and TLS untranslated', async () => {
  const card = await mountCard()
  card.locale.setLocale('zh')
  await settle()
  const text = await expandedText(card)
  assert.ok(text.includes('SMTP 服务器'))
  assert.ok(text.includes('安全连接'))
  assert.ok(text.includes('STARTTLS'))
  assert.ok(text.includes('隐式 TLS'))
  await card.tree.unmount()
})

test('L10N-11c no English label leaks into the Chinese card', async () => {
  const card = await mountCard()
  card.locale.setLocale('zh')
  await settle()
  const text = await expandedText(card)
  const leaked: string[] = []
  for (const [, enText, zhText] of REQUIRED) {
    if (enText === '' || enText === zhText) continue
    // A term that is also a canonical technical word is expected to appear.
    if (CANONICAL_TERMS.some((term) => enText.includes(term))) continue
    if (text.includes(enText)) leaked.push(enText)
  }
  assert.deepEqual(leaked, [], 'these English strings must not appear in the Chinese card')
  await card.tree.unmount()
})

test('L10N-11d the Chinese card is not merely the English card with a different heading', async () => {
  const card = await mountCard()
  const english = await expandedText(card)
  card.locale.setLocale('zh')
  await settle()
  const chinese = await expandedText(card)
  assert.notEqual(english, chinese)
  // Most of the visible copy must differ, not a single heading.
  const englishLabels = ALL_FIELDS.map((def) => en[def.labelKey]).filter((label) => !CANONICAL_TERMS.some((t) => label.includes(t)))
  const stillEnglish = englishLabels.filter((label) => chinese.includes(label))
  assert.deepEqual(stillEnglish, [], 'every non-technical field label must be Chinese')
  await card.tree.unmount()
})

test('L10N-00 the expansion state is presentation-only and never persisted', async () => {
  // The requirement is a prohibition, and this is the observable form of it:
  // toggling the card performs no settings write, no credential call, and no
  // RPC, so there is no channel through which the state could be stored.
  const card = await mountCard()
  await toggle(card.tree.container)
  await toggle(card.tree.container)
  await toggle(card.tree.container)
  const writes = card.double.calls.filter(
    (call) => call.method === 'settings.mutate' || call.method === 'credentials.set' || call.method === 'credentials.unset',
  )
  assert.deepEqual(writes, [], 'the disclosure must not write anything')
  assert.equal(isOpen(card.tree.container), true)
  await card.tree.unmount()
})
