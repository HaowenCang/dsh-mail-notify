/**
 * The card's locale vocabulary: one typed key set, both shipped dictionaries,
 * and the English fallback used where no render-time translator is present.
 *
 * Every plugin-authored visible string lives here and nowhere else. The card
 * renders `t(key, params)`; it never chooses between languages inline, and no
 * component ever sees a language id. Key parity is a compile-time property:
 * both dictionaries are `Record<MailNotifyLocaleKey, string>`, so a missing or
 * extra key in either language fails the build rather than surfacing as a bare
 * key in someone's settings page.
 *
 * Messages the controller produces (operation outcomes, validation refusals)
 * are stored as their semantic identity ({@link LocalizedMessage}) and
 * translated at render time. That is what lets a notice already on screen
 * change language when the DSH locale changes: the notice holds `noticeSaved`,
 * not its English spelling.
 *
 * ## Integration with the DSH locale service
 *
 * `@deepseek-ai/dsh-client-locale/client` publishes `LocaleRuntime` — a typed
 * `register(ns, { en, zh })`, a `bind(ns)` translate, and the LocaleFace
 * revision the renderer derives each entry's `t` seat from. This module merges
 * `'dsh-mail-notify'` into `LocaleNamespaceMap` so those typed entry points
 * accept this namespace, and `src/client/index.tsx` registers both
 * dictionaries under it. Lookup and fallback are the service's own: the active
 * language's fallback chain is consulted in this namespace first, then the
 * shared `common` namespace, then the key itself — which is how an unsupported
 * language renders this card in English.
 *
 * @module dsh-mail-notify/client/locale
 */

import type { LocaleDictOf, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BuiltInLocaleId } from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's settings card copy. */
    'dsh-mail-notify': MailNotifyLocaleKey
  }
}

/** The dictionary namespace this plugin owns in the DSH locale registry. */
export const MAIL_NOTIFY_NS = 'dsh-mail-notify'

/** Every plugin-authored string the card can render, as one closed union. */
export type MailNotifyLocaleKey =
  // Card chrome and the collapsed summary.
  | 'cardTitle'
  | 'cardSubtitle'
  | 'actionExpand'
  | 'actionCollapse'
  | 'summaryActive'
  | 'summaryInactive'
  | 'summarySmtpConfigured'
  | 'summarySmtpMissing'
  | 'summaryQuestionsOn'
  | 'summaryQuestionsOff'
  | 'summaryBusy'
  // Reusable operational facts.
  | 'factActive'
  | 'factInactive'
  | 'factConfigured'
  | 'factNotConfigured'
  | 'factOn'
  | 'factOff'
  | 'factUnknown'
  // Section titles and standing copy.
  | 'groupStatus'
  | 'groupAttention'
  | 'hintAttention'
  | 'groupGeneral'
  | 'groupNotifications'
  | 'groupSmtp'
  | 'groupCredential'
  | 'groupMessage'
  | 'groupDelivery'
  // Field labels and hints.
  | 'labelEnable'
  | 'hintEnable'
  | 'labelIncludeSubagents'
  | 'hintIncludeSubagents'
  | 'labelQuestions'
  | 'hintQuestions'
  | 'labelApprovals'
  | 'hintApprovals'
  | 'labelCompleted'
  | 'hintCompleted'
  | 'labelErrors'
  | 'hintErrors'
  | 'labelMaxTokens'
  | 'hintMaxTokens'
  | 'labelSmtpHost'
  | 'hintSmtpHost'
  | 'labelSmtpPort'
  | 'hintSmtpPort'
  | 'labelSecure'
  | 'hintSecure'
  | 'termImplicitTls'
  | 'termStartTls'
  | 'labelSmtpUser'
  | 'hintSmtpUser'
  | 'labelFrom'
  | 'hintFrom'
  | 'labelRecipients'
  | 'hintRecipients'
  | 'labelCredentialRef'
  | 'hintCredentialRef'
  | 'labelIncludeMetadata'
  | 'hintIncludeMetadata'
  | 'labelIncludeUserPrompt'
  | 'hintIncludeUserPrompt'
  | 'labelIncludeFooter'
  | 'hintIncludeFooter'
  | 'labelMaxBody'
  | 'hintMaxBody'
  | 'labelQueueSize'
  | 'hintQueueSize'
  | 'labelRetryAttempts'
  | 'hintRetryAttempts'
  | 'labelRetryBaseDelay'
  | 'hintRetryBaseDelay'
  | 'labelDedupe'
  | 'hintDedupe'
  // The write-only credential control.
  | 'labelSecret'
  | 'passwordSet'
  | 'passwordChange'
  | 'passwordPlaceholderKeep'
  | 'passwordPlaceholderNew'
  | 'passwordClear'
  | 'passwordClearTitle'
  | 'hintSecretStored'
  | 'hintSecretMissing'
  // Control vocabulary.
  | 'optionInherit'
  | 'inheritedBadge'
  | 'resetFieldTitle'
  | 'invalidBlocksSave'
  // Validation refusals (rendered with `field`, `min`, `max`, `entries` params).
  | 'invalidTrueFalse'
  | 'invalidWholeNumber'
  | 'invalidNumberRange'
  | 'invalidMin'
  | 'invalidMax'
  | 'invalidAddress'
  // Status strip.
  | 'statusPlugin'
  | 'statusCredential'
  | 'statusQueue'
  | 'statusEffectiveQuestions'
  | 'statusEffectiveApprovals'
  | 'statusConfigError'
  // Actions.
  | 'actionSendTest'
  | 'actionSending'
  | 'actionReset'
  | 'actionResetAllTitle'
  | 'actionDiscard'
  | 'actionSave'
  | 'actionSaving'
  // Operation messages (semantic identities the controller stores).
  | 'noticeFixInvalid'
  | 'noticeNothingToSave'
  | 'noticeResetStaged'
  | 'noticeSaved'
  | 'noticeSaveRefused'
  | 'noticeSaveRefusedDefault'
  | 'noticeCredentialRemoved'
  | 'noticeCredentialRefused'
  | 'testEmailSent'
  | 'testEmailRefused'
  | 'testEmailServerMessage'
  | 'testEmailFailed'

/**
 * A plugin-authored message as semantic identity: which copy, and the data to
 * fill it with. Params carry host-provided data (an error message, a count) —
 * never already-translated text — so rendering can change language at any time.
 */
export interface LocalizedMessage {
  readonly key: MailNotifyLocaleKey
  readonly params?: Readonly<Record<string, unknown>>
}

/**
 * Substitute `{name}` template params into one dictionary entry.
 *
 * Matches the published `Translate` contract's template form, and is also the
 * English fallback for callers outside the render path (the field parser's
 * refusal messages).
 *
 * @param template - the dictionary entry.
 * @param params - template values.
 * @returns the rendered string.
 */
export function formatMailText(template: string, params?: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params === undefined ? undefined : params[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * English rendering of one message identity.
 *
 * @param message - the semantic message.
 * @returns the English text.
 */
export function mailNotifyText(message: LocalizedMessage): string {
  return formatMailText(en[message.key], message.params)
}

/** English copy. Complete against the key union; a gap is a compile error. */
export const en: Record<MailNotifyLocaleKey, string> = {
  cardTitle: 'Mail notifications',
  cardSubtitle: 'Configure email notifications',
  actionExpand: 'Expand',
  actionCollapse: 'Collapse',
  summaryActive: 'Active',
  summaryInactive: 'Inactive',
  summarySmtpConfigured: 'SMTP configured',
  summarySmtpMissing: 'SMTP not configured',
  summaryQuestionsOn: 'Questions on',
  summaryQuestionsOff: 'Questions off',
  summaryBusy: 'Working…',
  factActive: 'Active',
  factInactive: 'Inactive',
  factConfigured: 'Configured',
  factNotConfigured: 'Not configured',
  factOn: 'On',
  factOff: 'Off',
  factUnknown: 'unknown',
  groupStatus: 'Status',
  groupAttention: 'Human attention',
  hintAttention:
    'These two are the reason a notification exists: an agent that has stopped and is waiting for you. Both are off by default.',
  groupGeneral: 'General',
  groupNotifications: 'Notifications',
  groupSmtp: 'SMTP',
  groupCredential: 'Credential',
  groupMessage: 'Message content',
  groupDelivery: 'Delivery',
  labelEnable: 'Enable mail notifications',
  hintEnable: 'While off, the plugin registers no listener and reads no credential.',
  labelIncludeSubagents: 'Include subagent activity',
  hintIncludeSubagents: 'Whether delegated subagent turns are notified as well as top-level turns.',
  labelQuestions: 'Questions requiring input',
  hintQuestions: 'Send an email immediately when DSH is waiting for your answer.',
  labelApprovals: 'Approval requests',
  hintApprovals: 'Send an email immediately when DSH is waiting for your approval.',
  labelCompleted: 'Completed turns',
  hintCompleted: 'A top-level turn that finished normally.',
  labelErrors: 'Errors',
  hintErrors: 'A turn that ended with a terminal error, including one that produced no visible output.',
  labelMaxTokens: 'Token-limit termination',
  hintMaxTokens: 'A turn that stopped because it reached the token limit.',
  labelSmtpHost: 'SMTP host',
  hintSmtpHost: 'Host name of the SMTP server.',
  labelSmtpPort: 'Port',
  hintSmtpPort: '587 for STARTTLS, 465 for implicit TLS.',
  labelSecure: 'Security',
  hintSecure: 'On selects {implicit} (normally port 465); off allows a {starttls} upgrade (normally 587).',
  termImplicitTls: 'Implicit TLS',
  termStartTls: 'STARTTLS',
  labelSmtpUser: 'Username',
  hintSmtpUser: 'Authentication user name.',
  labelFrom: 'From',
  hintFrom: 'Envelope sender. Some servers require this to match the authenticated account.',
  labelRecipients: 'Recipients',
  hintRecipients: 'One or more addresses, separated by commas or new lines.',
  labelCredentialRef: 'Credential reference',
  hintCredentialRef: 'Name of the credential the password is read from. A name, never the password itself.',
  labelIncludeMetadata: 'Include metadata',
  hintIncludeMetadata: 'Session, workspace, model, and timing.',
  labelIncludeUserPrompt: 'Include user prompt',
  hintIncludeUserPrompt: 'Off by default: the prompt may carry content you did not intend to mail.',
  labelIncludeFooter: 'Include footer',
  hintIncludeFooter: 'The generator footer and the truncation marker.',
  labelMaxBody: 'Maximum body length',
  hintMaxBody: 'Maximum visible-text length, counted in code points.',
  labelQueueSize: 'Queue size',
  hintQueueSize: 'Waiting-job cap; the worker holds one more.',
  labelRetryAttempts: 'Retry attempts',
  hintRetryAttempts: 'Total attempts are one plus this.',
  labelRetryBaseDelay: 'Retry base delay',
  hintRetryBaseDelay: 'Retry n waits base × 3^(n−1), capped at 30 s.',
  labelDedupe: 'Dedupe cache size',
  hintDedupe: 'How many recently notified events are remembered.',
  labelSecret: 'Password',
  passwordSet: 'Set password',
  passwordChange: 'Change password',
  passwordPlaceholderKeep: 'leave blank to keep the current password',
  passwordPlaceholderNew: 'type the password to store',
  passwordClear: 'Clear stored password',
  passwordClearTitle: 'Remove the stored value for this reference',
  hintSecretStored:
    'A password is stored for this reference. It is never sent to the browser; typing a new one replaces it.',
  hintSecretMissing:
    'No password is stored for this reference yet. Typing one stores it without it ever being read back.',
  optionInherit: 'inherit',
  inheritedBadge: 'inherited',
  resetFieldTitle: 'Remove this override so the field re-inherits the composition value',
  invalidBlocksSave: 'This value will block the save.',
  invalidTrueFalse: '{field} must be true or false',
  invalidWholeNumber: '{field} must be a whole number',
  invalidNumberRange: '{field} is out of range',
  invalidMin: '{field} must be at least {min}',
  invalidMax: '{field} must be at most {max}',
  invalidAddress: 'Not a plausible email address: {entries}',
  statusPlugin: 'Plugin: {state}',
  statusCredential: 'Credential: {state}',
  statusQueue: 'queue {depth}/{size} · {delivered} delivered · {failed} failed',
  statusEffectiveQuestions: 'Effective question notifications: {value}',
  statusEffectiveApprovals: 'Effective approval notifications: {value}',
  statusConfigError:
    'The saved configuration cannot be applied, so the previous settings are still in effect: {message}',
  actionSendTest: 'Send test email',
  actionSending: 'Sending…',
  actionReset: 'Reset',
  actionResetAllTitle:
    'Remove every override this plugin owns, so the composition values and schema defaults apply again',
  actionDiscard: 'Discard',
  actionSave: 'Save',
  actionSaving: 'Saving…',
  noticeFixInvalid: 'Fix the highlighted fields before saving.',
  noticeNothingToSave: 'Nothing to save.',
  noticeResetStaged: 'Reset staged: every field will go back to the composition values when you save.',
  noticeSaved: 'Saved',
  noticeSaveRefused: 'The host did not accept the save: {message}',
  noticeSaveRefusedDefault: 'The host did not accept the save.',
  noticeCredentialRemoved: 'The stored password was removed.',
  noticeCredentialRefused: 'The password change was refused: {message}',
  testEmailSent: 'Test email sent. The SMTP server accepted the message for {count} recipient(s).',
  testEmailRefused: 'The SMTP server refused the message.',
  testEmailServerMessage: 'The SMTP server refused the message: {message}',
  testEmailFailed: 'The delivery test failed: {message}',
}

/** Simplified Chinese copy. Complete against the same key union. */
export const zh: Record<MailNotifyLocaleKey, string> = {
  cardTitle: '邮件通知',
  cardSubtitle: '配置邮件通知',
  actionExpand: '展开',
  actionCollapse: '折叠',
  summaryActive: '运行中',
  summaryInactive: '未运行',
  summarySmtpConfigured: 'SMTP 已配置',
  summarySmtpMissing: 'SMTP 未配置',
  summaryQuestionsOn: '提问通知已启用',
  summaryQuestionsOff: '提问通知已关闭',
  summaryBusy: '处理中…',
  factActive: '运行中',
  factInactive: '未运行',
  factConfigured: '已配置',
  factNotConfigured: '未配置',
  factOn: '已启用',
  factOff: '已关闭',
  factUnknown: '未知',
  groupStatus: '状态',
  groupAttention: '等待人工处理',
  hintAttention: '这两项是通知存在的理由：智能体已停止，正在等待人工处理。两项默认关闭。',
  groupGeneral: '常规',
  groupNotifications: '通知类型',
  groupSmtp: 'SMTP',
  groupCredential: '凭据',
  groupMessage: '邮件内容',
  groupDelivery: '发送与重试',
  labelEnable: '启用邮件通知',
  hintEnable: '关闭时插件不注册监听器，也不读取凭据。',
  labelIncludeSubagents: '包含子智能体活动',
  hintIncludeSubagents: '除顶层任务外，委派的子智能体任务是否也发送通知。',
  labelQuestions: '需要用户回答',
  hintQuestions: '当 DSH 正在等待你的回答时立即发送邮件。',
  labelApprovals: '需要用户批准',
  hintApprovals: '当 DSH 正在等待你的批准决定时立即发送邮件。',
  labelCompleted: '任务完成',
  hintCompleted: '正常结束的顶层任务。',
  labelErrors: '任务错误',
  hintErrors: '以终止错误结束的任务，包括没有可见输出的情况。',
  labelMaxTokens: '达到 Token 上限',
  hintMaxTokens: '因达到 Token 上限而停止的任务。',
  labelSmtpHost: 'SMTP 服务器',
  hintSmtpHost: 'SMTP 服务器的主机名。',
  labelSmtpPort: '端口',
  hintSmtpPort: 'STARTTLS 通常使用 587 端口，隐式 TLS 通常使用 465 端口。',
  labelSecure: '安全连接',
  hintSecure: '开启即{implicit}（通常 465 端口）；关闭允许 {starttls} 升级（通常 587 端口）。',
  termImplicitTls: '隐式 TLS',
  termStartTls: 'STARTTLS',
  labelSmtpUser: '用户名',
  hintSmtpUser: '用于认证的用户名。',
  labelFrom: '发件人',
  hintFrom: '信封发件人。部分服务器要求与认证账号一致。',
  labelRecipients: '收件人',
  hintRecipients: '一个或多个地址，用逗号或换行分隔。',
  labelCredentialRef: '凭据引用',
  hintCredentialRef: '读取密码所用凭据的名称。只是名称，不是密码本身。',
  labelIncludeMetadata: '包含元数据',
  hintIncludeMetadata: '会话、工作区、模型与耗时信息。',
  labelIncludeUserPrompt: '包含用户提示词',
  hintIncludeUserPrompt: '默认关闭：提示词可能包含你不希望外发的内容。',
  labelIncludeFooter: '包含邮件页脚',
  hintIncludeFooter: '生成器页脚与截断标记。',
  labelMaxBody: '最大正文长度',
  hintMaxBody: '正文可见文本的最大长度，按码点计。',
  labelQueueSize: '队列大小',
  hintQueueSize: '等待任务上限；工作线程另持有一条。',
  labelRetryAttempts: '重试次数',
  hintRetryAttempts: '总尝试次数为该值加一。',
  labelRetryBaseDelay: '重试基础延迟',
  hintRetryBaseDelay: '第 n 次重试等待 基础值 × 3^(n−1)，上限 30 秒。',
  labelDedupe: '去重缓存大小',
  hintDedupe: '记录多少个最近已通知的事件。',
  labelSecret: '密码',
  passwordSet: '设置密码',
  passwordChange: '修改密码',
  passwordPlaceholderKeep: '留空以保留当前密码',
  passwordPlaceholderNew: '输入要保存的密码',
  passwordClear: '清除已保存的密码',
  passwordClearTitle: '删除该引用已保存的值',
  hintSecretStored: '该引用已保存密码。密码不会发送到浏览器；输入新密码将替代旧密码。',
  hintSecretMissing: '该引用尚未保存密码。输入的密码只写入、不会被读回。',
  optionInherit: '继承',
  inheritedBadge: '继承值',
  resetFieldTitle: '移除该覆盖值，让字段重新继承组合配置值',
  invalidBlocksSave: '该值会导致保存失败。',
  invalidTrueFalse: '{field} 必须为 true 或 false',
  invalidWholeNumber: '{field} 必须为整数',
  invalidNumberRange: '{field} 超出可表示范围',
  invalidMin: '{field} 不能小于 {min}',
  invalidMax: '{field} 不能大于 {max}',
  invalidAddress: '不是有效的邮件地址：{entries}',
  statusPlugin: '插件：{state}',
  statusCredential: '凭据：{state}',
  statusQueue: '队列 {depth}/{size} · 已投递 {delivered} · 失败 {failed}',
  statusEffectiveQuestions: '提问通知实际生效：{value}',
  statusEffectiveApprovals: '批准通知实际生效：{value}',
  statusConfigError: '已保存的配置无法应用，之前的设置仍然生效：{message}',
  actionSendTest: '发送测试邮件',
  actionSending: '正在发送…',
  actionReset: '恢复继承值',
  actionResetAllTitle: '移除本插件的全部覆盖值，恢复组合配置与架构默认值',
  actionDiscard: '放弃更改',
  actionSave: '保存',
  actionSaving: '正在保存…',
  noticeFixInvalid: '请先修正标记的字段，然后再保存。',
  noticeNothingToSave: '没有需要保存的更改。',
  noticeResetStaged: '已暂存重置：保存后所有字段将恢复为组合配置值。',
  noticeSaved: '已保存',
  noticeSaveRefused: '宿主未接受本次保存：{message}',
  noticeSaveRefusedDefault: '宿主未接受本次保存。',
  noticeCredentialRemoved: '已保存的密码已删除。',
  noticeCredentialRefused: '密码更改被拒绝：{message}',
  testEmailSent: '测试邮件已发送。SMTP 服务器已接受该邮件，共 {count} 个收件人。',
  testEmailRefused: 'SMTP 服务器拒绝了该邮件。',
  testEmailServerMessage: 'SMTP 服务器拒绝了该邮件：{message}',
  testEmailFailed: '测试邮件发送失败：{message}',
}

/**
 * Both shipped dictionaries, keyed exactly as `LocaleRuntime.register`'s typed
 * form requires — the `Record<BuiltInLocaleId, …>` shape is what enforces
 * bilingual balance at the registration site.
 */
export const mailNotifyDictionaries: Record<BuiltInLocaleId, LocaleDictOf<typeof MAIL_NOTIFY_NS>> = { en, zh }

/** The translate seat the framework injects for this namespace. */
export type MailNotifyTranslate = TranslateNS<typeof MAIL_NOTIFY_NS>
