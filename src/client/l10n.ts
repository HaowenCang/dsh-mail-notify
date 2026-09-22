/**
 * Centralized typed localization vocabulary for dsh-mail-notify.
 *
 * Implements complete English and Simplified Chinese dictionaries with exact
 * key parity. Every plugin-authored string shown in the Web UI is keyed here.
 * Canonical technical terms (DSH, SMTP, TLS, STARTTLS) are preserved across
 * all locales.
 *
 * @module dsh-mail-notify/client/l10n
 */

/** Known supported locale identifiers. */
export type SupportedLocale = 'en' | 'zh'

/** Centralized dictionary keys. */
export type LocaleKey =
  | 'title'
  | 'description'
  | 'headerHint'
  | 'active'
  | 'inactive'
  | 'smtpConfigured'
  | 'smtpNotConfigured'
  | 'questionsOn'
  | 'questionsOff'
  | 'expand'
  | 'collapse'
  | 'groupGeneral'
  | 'groupNotifications'
  | 'groupHumanAttention'
  | 'humanAttentionHint'
  | 'groupSmtp'
  | 'groupCredential'
  | 'groupMessage'
  | 'groupDelivery'
  | 'status'
  | 'field_enabled_label'
  | 'field_enabled_hint'
  | 'field_includeSubagents_label'
  | 'field_includeSubagents_hint'
  | 'field_notifyCompleted_label'
  | 'field_notifyCompleted_hint'
  | 'field_notifyErrors_label'
  | 'field_notifyErrors_hint'
  | 'field_notifyMaxTokens_label'
  | 'field_notifyMaxTokens_hint'
  | 'field_notifyQuestions_label'
  | 'field_notifyQuestions_hint'
  | 'field_notifyApprovals_label'
  | 'field_notifyApprovals_hint'
  | 'field_smtpHost_label'
  | 'field_smtpHost_hint'
  | 'field_smtpPort_label'
  | 'field_smtpPort_hint'
  | 'field_smtpSecure_label'
  | 'field_smtpSecure_hint'
  | 'field_smtpUser_label'
  | 'field_smtpUser_hint'
  | 'field_from_label'
  | 'field_from_hint'
  | 'field_to_label'
  | 'field_to_hint'
  | 'field_smtpPasswordCredential_label'
  | 'field_smtpPasswordCredential_hint'
  | 'field_includeMetadata_label'
  | 'field_includeMetadata_hint'
  | 'field_includeUserPrompt_label'
  | 'field_includeUserPrompt_hint'
  | 'field_includeFooter_label'
  | 'field_includeFooter_hint'
  | 'field_maxBodyChars_label'
  | 'field_maxBodyChars_hint'
  | 'field_queueSize_label'
  | 'field_queueSize_hint'
  | 'field_retryAttempts_label'
  | 'field_retryAttempts_hint'
  | 'field_retryBaseDelayMs_label'
  | 'field_retryBaseDelayMs_hint'
  | 'field_maxDedupeEntries_label'
  | 'field_maxDedupeEntries_hint'
  | 'optionInherit'
  | 'optionOn'
  | 'optionOff'
  | 'badgeInherited'
  | 'buttonReset'
  | 'resetFieldTitle'
  | 'invalidFieldHint'
  | 'passwordLabel'
  | 'passwordPlaceholder'
  | 'clearStoredSecret'
  | 'clearPasswordTitle'
  | 'passwordConfiguredHint'
  | 'passwordEmptyHint'
  | 'statusPluginActive'
  | 'statusPluginNotRunning'
  | 'statusPluginUnknown'
  | 'statusCredConfigured'
  | 'statusCredMissing'
  | 'statusCredUnknown'
  | 'statusQueue'
  | 'effectiveQuestions'
  | 'effectiveApprovals'
  | 'configErrorNotice'
  | 'sendTestEmail'
  | 'sending'
  | 'testEmailSent'
  | 'resetAll'
  | 'resetAllTitle'
  | 'discard'
  | 'save'
  | 'saving'
  | 'saved'
  | 'noticeFixHighlighted'
  | 'noticeNothingToSave'
  | 'noticeSaveFailed'
  | 'noticeSaved'
  | 'noticeResetStaged'
  | 'noticePasswordRemoved'
  | 'valMustBeBoolean'
  | 'valMustBeWholeNumber'
  | 'valOutOfRange'
  | 'valMustBeAtLeast'
  | 'valMustBeAtMost'
  | 'valNotPlausibleEmail'
  | 'testEmailAccepted'
  | 'testEmailRefused'

/** Dictionary structure mapping every key to its localized text template. */
export type LocalizationDict = Readonly<Record<LocaleKey, string>>

/** English dictionary. */
export const EN_DICT: LocalizationDict = {
  title: 'Mail notifications',
  description: 'Configure email notifications',
  headerHint: 'Emails a top-level turn’s final output, its terminal failures, and its mid-turn requests for a person over SMTP.',

  active: 'Active',
  inactive: 'Inactive',
  smtpConfigured: 'SMTP configured',
  smtpNotConfigured: 'SMTP not configured',
  questionsOn: 'Questions on',
  questionsOff: 'Questions off',

  expand: 'Expand',
  collapse: 'Collapse',

  groupGeneral: 'General',
  groupNotifications: 'Notifications',
  groupHumanAttention: 'Questions requiring input',
  humanAttentionHint: 'Send an email immediately when DSH is waiting for your answer.',
  groupSmtp: 'SMTP',
  groupCredential: 'Credential',
  groupMessage: 'Message content',
  groupDelivery: 'Delivery',
  status: 'Status',

  field_enabled_label: 'Enable mail notifications',
  field_enabled_hint: 'While off, the plugin registers no listener and reads no credential.',
  field_includeSubagents_label: 'Include subagent activity',
  field_includeSubagents_hint: 'Whether delegated subagent turns are notified as well as top-level turns.',
  field_notifyCompleted_label: 'Completed turns',
  field_notifyCompleted_hint: 'A top-level turn that finished normally.',
  field_notifyErrors_label: 'Errors',
  field_notifyErrors_hint: 'A turn that ended with a terminal error, including one that produced no visible output.',
  field_notifyMaxTokens_label: 'Token-limit termination',
  field_notifyMaxTokens_hint: 'A turn that stopped because it reached the token limit.',
  field_notifyQuestions_label: 'Questions requiring input',
  field_notifyQuestions_hint: 'Send an email immediately when DSH is waiting for your answer.',
  field_notifyApprovals_label: 'Approval requests',
  field_notifyApprovals_hint: 'Send an email immediately when DSH is waiting for your approval.',
  field_smtpHost_label: 'SMTP host',
  field_smtpHost_hint: 'Host name of the SMTP server.',
  field_smtpPort_label: 'Port',
  field_smtpPort_hint: '587 for STARTTLS, 465 for implicit TLS.',
  field_smtpSecure_label: 'Implicit TLS',
  field_smtpSecure_hint: 'On selects implicit TLS (normally port 465); off allows a STARTTLS upgrade (normally 587).',
  field_smtpUser_label: 'Username',
  field_smtpUser_hint: 'Authentication user name.',
  field_from_label: 'From',
  field_from_hint: 'Envelope sender. Some servers require this to match the authenticated account.',
  field_to_label: 'Recipients',
  field_to_hint: 'One or more addresses, separated by commas or new lines.',
  field_smtpPasswordCredential_label: 'Credential reference',
  field_smtpPasswordCredential_hint: 'Name of the credential the password is read from. A name, never the password itself.',
  field_includeMetadata_label: 'Include metadata',
  field_includeMetadata_hint: 'Session, workspace, model, and timing.',
  field_includeUserPrompt_label: 'Include user prompt',
  field_includeUserPrompt_hint: 'Off by default: the prompt may carry content you did not intend to mail.',
  field_includeFooter_label: 'Include footer',
  field_includeFooter_hint: 'The generator footer and the truncation marker.',
  field_maxBodyChars_label: 'Maximum body length',
  field_maxBodyChars_hint: 'Maximum visible-text length, counted in code points.',
  field_queueSize_label: 'Queue size',
  field_queueSize_hint: 'Waiting-job cap; the worker holds one more.',
  field_retryAttempts_label: 'Retry attempts',
  field_retryAttempts_hint: 'Total attempts are one plus this.',
  field_retryBaseDelayMs_label: 'Retry base delay',
  field_retryBaseDelayMs_hint: 'Retry n waits base × 3^(n−1), capped at 30 s.',
  field_maxDedupeEntries_label: 'Dedupe cache size',
  field_maxDedupeEntries_hint: 'How many recently notified events are remembered.',

  optionInherit: 'inherit',
  optionOn: 'on',
  optionOff: 'off',
  badgeInherited: 'inherited',
  buttonReset: 'reset',
  resetFieldTitle: 'Remove this override so the field re-inherits the composition value',
  invalidFieldHint: 'This value will block the save.',

  passwordLabel: 'Password',
  passwordPlaceholder: 'leave blank to keep the current password',
  clearStoredSecret: 'clear stored password',
  clearPasswordTitle: 'Remove the stored value for this reference',
  passwordConfiguredHint: 'A password is stored for this reference. It is never sent to the browser; typing a new one replaces it.',
  passwordEmptyHint: 'No password is stored for this reference yet. Typing one stores it without it ever being read back.',

  statusPluginActive: 'plugin active',
  statusPluginNotRunning: 'plugin not running',
  statusPluginUnknown: 'plugin unknown',
  statusCredConfigured: 'credential configured',
  statusCredMissing: 'credential missing',
  statusCredUnknown: 'credential unknown',
  statusQueue: 'queue {depth}/{size} · {delivered} delivered · {failed} failed',
  effectiveQuestions: 'Effective question notifications: {status}',
  effectiveApprovals: 'Effective approval notifications: {status}',
  configErrorNotice: 'The saved configuration cannot be applied, so the previous settings are still in effect: {error}',

  sendTestEmail: 'Send test email',
  sending: 'Sending…',
  testEmailSent: 'Test email sent',
  resetAll: 'Reset',
  resetAllTitle: 'Remove every override this plugin owns, so the composition values and schema defaults apply again',
  discard: 'Discard',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',

  noticeFixHighlighted: 'Fix the highlighted fields before saving.',
  noticeNothingToSave: 'Nothing to save.',
  noticeSaveFailed: 'The host did not accept the save.',
  noticeSaved: 'Saved.',
  noticeResetStaged: 'Reset staged: every field will go back to the composition values when you save.',
  noticePasswordRemoved: 'The stored password was removed.',

  valMustBeBoolean: '{label} must be true or false',
  valMustBeWholeNumber: '{label} must be a whole number',
  valOutOfRange: '{label} is out of range',
  valMustBeAtLeast: '{label} must be at least {min}',
  valMustBeAtMost: '{label} must be at most {max}',
  valNotPlausibleEmail: 'not a plausible email address: {addresses}',

  testEmailAccepted: 'The SMTP server accepted the message for {count} recipient(s).',
  testEmailRefused: 'The SMTP server refused the message.',
}

/** Simplified Chinese dictionary. */
export const ZH_DICT: LocalizationDict = {
  title: '邮件通知',
  description: '配置邮件通知',
  headerHint: '通过 SMTP 发送顶层轮次的最终输出、致命错误以及需要人工介入的请求。',

  active: '运行中',
  inactive: '未运行',
  smtpConfigured: 'SMTP 已配置',
  smtpNotConfigured: 'SMTP 未配置',
  questionsOn: '提问通知已启用',
  questionsOff: '提问通知已关闭',

  expand: '展开',
  collapse: '折叠',

  groupGeneral: '常规',
  groupNotifications: '通知类型',
  groupHumanAttention: '需要用户回答',
  humanAttentionHint: '当 DSH 正在等待你的回答时立即发送邮件。',
  groupSmtp: 'SMTP',
  groupCredential: '凭据',
  groupMessage: '邮件内容',
  groupDelivery: '发送与重试',
  status: '状态',

  field_enabled_label: '启用邮件通知',
  field_enabled_hint: '关闭时，插件不注册监听器且不读取凭据。',
  field_includeSubagents_label: '包含子智能体活动',
  field_includeSubagents_hint: '是否同时通知委托的子智能体轮次与顶层轮次。',
  field_notifyCompleted_label: '任务完成',
  field_notifyCompleted_hint: '正常完成的顶层轮次。',
  field_notifyErrors_label: '任务错误',
  field_notifyErrors_hint: '以致命错误结束的轮次，包括未产生可见输出的轮次。',
  field_notifyMaxTokens_label: '达到 Token 上限',
  field_notifyMaxTokens_hint: '因达到 Token 上限而停止的轮次。',
  field_notifyQuestions_label: '需要用户回答',
  field_notifyQuestions_hint: '当 DSH 正在等待你的回答时立即发送邮件。',
  field_notifyApprovals_label: '需要用户批准',
  field_notifyApprovals_hint: '当 DSH 正在等待你的批准决定时立即发送邮件。',
  field_smtpHost_label: 'SMTP 服务器',
  field_smtpHost_hint: 'SMTP 服务器主机名。',
  field_smtpPort_label: '端口',
  field_smtpPort_hint: 'STARTTLS 通常为 587，隐式 TLS 通常为 465。',
  field_smtpSecure_label: '隐式 TLS',
  field_smtpSecure_hint: '开启则使用隐式 TLS（通常端口 465）；关闭则允许 STARTTLS 升级（通常端口 587）。',
  field_smtpUser_label: '用户名',
  field_smtpUser_hint: '认证用户名。',
  field_from_label: '发件人',
  field_from_hint: '信封发件人。部分服务器要求此项与认证账户一致。',
  field_to_label: '收件人',
  field_to_hint: '一个或多个邮箱地址，用逗号或换行分隔。',
  field_smtpPasswordCredential_label: '凭据引用',
  field_smtpPasswordCredential_hint: '读取密码的凭据名称。仅为名称，绝非密码本身。',
  field_includeMetadata_label: '包含元数据',
  field_includeMetadata_hint: '会话、工作区、模型及耗时。',
  field_includeUserPrompt_label: '包含用户提示词',
  field_includeUserPrompt_hint: '默认关闭：提示词可能包含不宜通过邮件发送的内容。',
  field_includeFooter_label: '包含邮件页脚',
  field_includeFooter_hint: '生成器页脚及截断标记。',
  field_maxBodyChars_label: '最大正文长度',
  field_maxBodyChars_hint: '可见文本最大长度（按码点计数）。',
  field_queueSize_label: '队列大小',
  field_queueSize_hint: '等待任务上限；发送处理中可额外容纳一个。',
  field_retryAttempts_label: '重试次数',
  field_retryAttempts_hint: '总尝试次数为此值加一。',
  field_retryBaseDelayMs_label: '重试基础延迟',
  field_retryBaseDelayMs_hint: '第 n 次重试等待 base × 3^(n−1)，上限 30 秒。',
  field_maxDedupeEntries_label: '去重缓存大小',
  field_maxDedupeEntries_hint: '记忆最近通知事件的数量上限。',

  optionInherit: '恢复继承值',
  optionOn: '已启用',
  optionOff: '已关闭',
  badgeInherited: '已继承',
  buttonReset: '恢复继承值',
  resetFieldTitle: '移除此覆盖项，使该字段重新继承组合层的值',
  invalidFieldHint: '此值无效，将阻止保存。',

  passwordLabel: '密码',
  passwordPlaceholder: '留空以保留当前密码',
  clearStoredSecret: '清除已存密码',
  clearPasswordTitle: '移除此引用对应的存储值',
  passwordConfiguredHint: '该引用已存储密码。密码绝不会发送到浏览器；输入新密码将直接替换。',
  passwordEmptyHint: '该引用尚未存储密码。输入密码即可保存，且绝不会被反向读取。',

  statusPluginActive: '插件运行中',
  statusPluginNotRunning: '插件未运行',
  statusPluginUnknown: '插件状态未知',
  statusCredConfigured: '凭据已配置',
  statusCredMissing: '凭据未配置',
  statusCredUnknown: '凭据状态未知',
  statusQueue: '队列 {depth}/{size} · 已发送 {delivered} · 失败 {failed}',
  effectiveQuestions: '提问通知生效状态：{status}',
  effectiveApprovals: '批准通知生效状态：{status}',
  configErrorNotice: '保存的配置无法生效，当前仍使用先前的设置：{error}',

  sendTestEmail: '发送测试邮件',
  sending: '正在发送…',
  testEmailSent: '测试邮件已发送',
  resetAll: '恢复继承值',
  resetAllTitle: '移除本插件的所有覆盖项，使组合层的值和 schema 默认值重新生效',
  discard: '放弃修改',
  save: '保存',
  saving: '正在保存…',
  saved: '已保存',

  noticeFixHighlighted: '请在保存前修正高亮字段。',
  noticeNothingToSave: '没有需要保存的内容。',
  noticeSaveFailed: '宿主拒绝了保存操作。',
  noticeSaved: '已保存。',
  noticeResetStaged: '已暂存恢复操作：保存后所有字段将恢复为组合层的值。',
  noticePasswordRemoved: '已移除存储的密码。',

  valMustBeBoolean: '{label} 必须为 true 或 false',
  valMustBeWholeNumber: '{label} 必须为整数',
  valOutOfRange: '{label} 超出范围',
  valMustBeAtLeast: '{label} 不能小于 {min}',
  valMustBeAtMost: '{label} 不能大于 {max}',
  valNotPlausibleEmail: '不是有效的邮箱地址：{addresses}',

  testEmailAccepted: 'SMTP 服务器已接受测试邮件，收件人数量：{count}。',
  testEmailRefused: 'SMTP 服务器拒绝了测试邮件。',
}

/** All dictionaries registered by locale tag. */
export const DICTIONARIES: Readonly<Record<SupportedLocale, LocalizationDict>> = {
  en: EN_DICT,
  zh: ZH_DICT,
}

/**
 * Format a template with named parameters ({key}).
 *
 * @param template - the template string with `{name}` placeholders.
 * @param params - key-value pairs to substitute.
 * @returns the interpolated string.
 */
export function formatTemplate(template: string, params?: Record<string, unknown>): string {
  if (params === undefined) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = params[key]
    return value !== undefined ? String(value) : match
  })
}

/**
 * Resolve a translation for the requested locale, falling back to English for unknown locales.
 *
 * @param locale - BCP 47 language tag or prefix (e.g. 'zh', 'zh-CN', 'en').
 * @param key - the typed dictionary key.
 * @param params - optional substitution parameters.
 * @returns the localized string.
 */
export function translate(locale: string | undefined, key: LocaleKey, params?: Record<string, unknown>): string {
  const normalized: SupportedLocale = typeof locale === 'string' && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const dict = DICTIONARIES[normalized] ?? EN_DICT
  const template = dict[key] ?? EN_DICT[key] ?? key
  return formatTemplate(template, params)
}
