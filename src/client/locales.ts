/**
 * The card's complete copy, in English and Simplified Chinese.
 *
 * This module is the single source of every user-visible string the settings
 * card renders — chrome, disclosure, summary, labels, hints, options, badges,
 * validation, notices, status, and actions. The DSH locale service registers
 * both dictionaries under {@link MAIL_LOCALE_NS} at plugin activation, the
 * renderer's `t` seat (declared through the registration's `locale:` option)
 * resolves keys against the ACTIVE DSH locale at call time, and English
 * terminates the lookup chain, so an unknown locale falls back to English.
 *
 * Key parity is enforced twice: at compile time, because
 * `LocaleNamespaceMap['dsh-mail-notify']` is {@link MailNotifyLocaleKey} and
 * `zh` is typed `Record<MailNotifyLocaleKey, string>` — a missing or extra key
 * is a type error — and again at runtime by `tests/client/locale.test.ts`.
 *
 * Technical terms (DSH, SMTP, TLS, STARTTLS, STARTTLS ports) stay canonical in
 * both languages; only natural-language framing is translated.
 *
 * @module dsh-mail-notify/client/locales
 */

/** The dictionary namespace this plugin's card copy is registered under. */
export const MAIL_LOCALE_NS = 'dsh-mail-notify'

/** English copy — the key-set source of truth and the fallback language. */
export const en = {
  // Card chrome and disclosure.
  'card.title': 'Mail notifications',
  'card.aria': 'Configure email notifications',
  'header.expand': 'Expand',
  'header.collapse': 'Collapse',

  // Collapsed summary — safe operational facts only.
  'summary.active': 'Active',
  'summary.inactive': 'Inactive',
  'summary.unknownStatus': 'Status unknown',
  'summary.smtpConfigured': 'SMTP configured',
  'summary.smtpUnconfigured': 'SMTP not configured',
  'summary.smtpUnknown': 'SMTP unknown',
  'summary.questions': 'Questions {state}',
  'state.on': 'On',
  'state.off': 'Off',
  'state.inherited': 'inherited',

  // Group headings.
  'group.humanAttention': 'Human attention',
  'group.general': 'General',
  'group.notifications': 'Notifications',
  'group.smtp': 'SMTP',
  'group.credential': 'Credential',
  'group.message': 'Message content',
  'group.delivery': 'Delivery',
  'group.status': 'Status',
  'hint.humanAttention':
    'These two are the reason a notification exists: an agent that has stopped and is waiting for you. Both are off by default.',

  // General.
  'field.enabled.label': 'Enable mail notifications',
  'field.enabled.hint': 'While off, the plugin registers no listener and reads no credential.',
  'field.includeSubagents.label': 'Include subagent activity',
  'field.includeSubagents.hint': 'Whether delegated subagent turns are notified as well as top-level turns.',

  // Notifications — the two human-attention switches lead.
  'field.notifyQuestions.label': 'Questions requiring input',
  'field.notifyQuestions.hint': 'Send an email immediately when DSH is waiting for your answer.',
  'field.notifyApprovals.label': 'Approval requests',
  'field.notifyApprovals.hint': 'Send an email immediately when DSH is waiting for your approval.',
  'field.notifyCompleted.label': 'Completed turns',
  'field.notifyCompleted.hint': 'A top-level turn that finished normally.',
  'field.notifyErrors.label': 'Errors',
  'field.notifyErrors.hint': 'A turn that ended with a terminal error, including one that produced no visible output.',
  'field.notifyMaxTokens.label': 'Token-limit termination',
  'field.notifyMaxTokens.hint': 'A turn that stopped because it reached the token limit.',

  // SMTP.
  'field.smtpHost.label': 'SMTP host',
  'field.smtpHost.hint': 'Host name of the SMTP server.',
  'field.smtpPort.label': 'Port',
  'field.smtpPort.hint': '587 for STARTTLS, 465 for implicit TLS.',
  'field.smtpSecure.label': 'Security',
  'field.smtpSecure.hint': 'Implicit TLS when on (normally port 465); a STARTTLS upgrade when off (normally port 587).',
  'field.smtpUser.label': 'Username',
  'field.smtpUser.hint': 'Authentication user name.',
  'field.from.label': 'From',
  'field.from.hint': 'Envelope sender. Some servers require this to match the authenticated account.',
  'field.to.label': 'Recipients',
  'field.to.hint': 'One or more addresses, separated by commas or new lines.',

  // Credential reference.
  'field.smtpPasswordCredential.label': 'Credential reference',
  'field.smtpPasswordCredential.hint':
    'Name of the credential the password is read from. A name, never the password itself.',

  // Message content.
  'field.includeMetadata.label': 'Include metadata',
  'field.includeMetadata.hint': 'Session, workspace, model, and timing.',
  'field.includeUserPrompt.label': 'Include user prompt',
  'field.includeUserPrompt.hint': 'Off by default: the prompt may carry content you did not intend to mail.',
  'field.includeFooter.label': 'Include footer',
  'field.includeFooter.hint': 'The generator footer and the truncation marker.',
  'field.maxBodyChars.label': 'Maximum body length',
  'field.maxBodyChars.hint': 'Maximum visible-text length, counted in code points.',

  // Delivery.
  'field.queueSize.label': 'Queue size',
  'field.queueSize.hint': 'Waiting-job cap; the worker holds one more.',
  'field.retryAttempts.label': 'Retry attempts',
  'field.retryAttempts.hint': 'Total attempts are one plus this.',
  'field.retryBaseDelayMs.label': 'Retry base delay (ms)',
  'field.retryBaseDelayMs.hint': 'Retry n waits base × 3^(n−1), capped at 30 s.',
  'field.maxDedupeEntries.label': 'Dedupe cache size',
  'field.maxDedupeEntries.hint': 'How many recently notified events are remembered.',

  // Controls: options, badges, validation.
  'option.inherit': 'inherit',
  'validation.blocking': 'This value will block the save.',
  'validation.boolean': '{field} must be true or false',
  'validation.integer': '{field} must be a whole number',
  'validation.range': '{field} is out of range',
  'validation.min': '{field} must be at least {min}',
  'validation.max': '{field} must be at most {max}',
  'validation.address': 'not a plausible email address: {list}',

  // Write-only password control.
  'secret.label': 'Password',
  'secret.placeholderChange': 'Change password',
  'secret.placeholderSet': 'Set password',
  'secret.clear': 'clear stored password',
  'secret.clearTitle': 'Remove the stored value for this reference',
  'secret.hintConfigured':
    'A password is stored for this reference. It is never sent to the browser; typing a new one replaces it.',
  'secret.hintUnconfigured':
    'No password is stored for this reference yet. Typing one stores it without it ever being read back.',

  // Status block.
  'status.pluginActive': 'plugin active',
  'status.pluginInactive': 'plugin not running',
  'status.pluginUnknown': 'plugin status unknown',
  'status.credential': 'credential: {state}',
  'status.configured': 'Configured',
  'status.notConfigured': 'Not configured',
  'status.unknown': 'Unknown',
  'status.queue': 'queue {depth}/{size} · {delivered} delivered · {failed} failed',
  'status.effectiveQuestions': 'Effective question notifications: {state}',
  'status.effectiveApprovals': 'Effective approval notifications: {state}',
  'status.configError':
    'The saved configuration cannot be applied, so the previous settings are still in effect: {detail}',

  // Actions.
  'action.test': 'Send test email',
  'action.sending': 'Sending…',
  'action.saving': 'Saving…',
  'action.save': 'Save',
  'action.discard': 'Discard',
  'action.reset': 'Reset',
  'action.resetField': 'reset',
  'action.resetTitle':
    'Remove every override this plugin owns, so the composition values and schema defaults apply again',
  'action.resetFieldTitle': 'Remove this override so the field re-inherits the composition value',

  // Card-authored notices and delivery-test outcomes.
  'notice.fixInvalid': 'Fix the highlighted fields before saving.',
  'notice.nothingToSave': 'Nothing to save.',
  'notice.resetStaged': 'Reset staged: every field will go back to the composition values when you save.',
  'notice.saved': 'Saved.',
  'notice.saveFailed': 'The host did not accept the save.',
  'notice.credentialRemoved': 'The stored password was removed.',
  'test.delivered': 'Test email sent: the SMTP server accepted the message for {count} recipient(s).',
  'test.refused': 'The SMTP server refused the message.',
}

/** Every key the card may render. */
export type MailNotifyLocaleKey = keyof typeof en

/** Simplified Chinese copy — same key domain, enforced by the type above. */
export const zh: Record<MailNotifyLocaleKey, string> = {
  // Card chrome and disclosure.
  'card.title': '邮件通知',
  'card.aria': '配置邮件通知',
  'header.expand': '展开',
  'header.collapse': '折叠',

  // Collapsed summary.
  'summary.active': '运行中',
  'summary.inactive': '未运行',
  'summary.unknownStatus': '状态未知',
  'summary.smtpConfigured': 'SMTP 已配置',
  'summary.smtpUnconfigured': 'SMTP 未配置',
  'summary.smtpUnknown': 'SMTP 状态未知',
  'summary.questions': '提问通知{state}',
  'state.on': '已启用',
  'state.off': '已关闭',
  'state.inherited': '已继承',

  // Group headings.
  'group.humanAttention': '需要你响应',
  'group.general': '常规',
  'group.notifications': '通知类型',
  'group.smtp': 'SMTP',
  'group.credential': '凭据',
  'group.message': '邮件内容',
  'group.delivery': '发送与重试',
  'group.status': '状态',
  'hint.humanAttention': '这两个开关是通知存在的理由：agent 已停下、正在等你。默认均为关闭。',

  // General.
  'field.enabled.label': '启用邮件通知',
  'field.enabled.hint': '关闭时，插件不注册任何监听器，也不读取任何凭据。',
  'field.includeSubagents.label': '包含子智能体活动',
  'field.includeSubagents.hint': '委派的子智能体任务是否与顶级任务一样发送通知。',

  // Notifications.
  'field.notifyQuestions.label': '需要用户回答',
  'field.notifyQuestions.hint': '当 DSH 正在等待你的回答时立即发送邮件。',
  'field.notifyApprovals.label': '需要用户批准',
  'field.notifyApprovals.hint': '当 DSH 正在等待你的批准决定时立即发送邮件。',
  'field.notifyCompleted.label': '任务完成',
  'field.notifyCompleted.hint': '正常结束的顶级任务。',
  'field.notifyErrors.label': '任务错误',
  'field.notifyErrors.hint': '以终结性错误结束的任务，包括未产生任何可见输出的情况。',
  'field.notifyMaxTokens.label': '达到 Token 上限',
  'field.notifyMaxTokens.hint': '因达到 Token 上限而停止的任务。',

  // SMTP.
  'field.smtpHost.label': 'SMTP 服务器',
  'field.smtpHost.hint': 'SMTP 服务器的主机名。',
  'field.smtpPort.label': '端口',
  'field.smtpPort.hint': 'STARTTLS 用 587，隐式 TLS 用 465。',
  'field.smtpSecure.label': '安全连接',
  'field.smtpSecure.hint': '开启为隐式 TLS（通常 465 端口）；关闭则允许 STARTTLS 升级（通常 587 端口）。',
  'field.smtpUser.label': '用户名',
  'field.smtpUser.hint': '用于认证的用户名。',
  'field.from.label': '发件人',
  'field.from.hint': '信封发件人；部分服务器要求与认证账户一致。',
  'field.to.label': '收件人',
  'field.to.hint': '一个或多个地址，用逗号或换行分隔。',

  // Credential reference.
  'field.smtpPasswordCredential.label': '凭据引用',
  'field.smtpPasswordCredential.hint': '密码读取自该名称对应的凭据；这里只填名称，绝不是密码本身。',

  // Message content.
  'field.includeMetadata.label': '包含元数据',
  'field.includeMetadata.hint': '会话、工作区、模型与时间信息。',
  'field.includeUserPrompt.label': '包含用户提示词',
  'field.includeUserPrompt.hint': '默认关闭：提示词可能包含你并不想通过邮件发送的内容。',
  'field.includeFooter.label': '包含邮件页脚',
  'field.includeFooter.hint': '生成器页脚与截断标记。',
  'field.maxBodyChars.label': '最大正文长度',
  'field.maxBodyChars.hint': '可见正文的最大长度，按码点计。',

  // Delivery.
  'field.queueSize.label': '队列大小',
  'field.queueSize.hint': '等待队列上限；工作进程另持有 1 个。',
  'field.retryAttempts.label': '重试次数',
  'field.retryAttempts.hint': '总尝试次数为该值加一。',
  'field.retryBaseDelayMs.label': '重试基础延迟（毫秒）',
  'field.retryBaseDelayMs.hint': '第 n 次重试等待 base × 3^(n−1)，上限 30 秒。',
  'field.maxDedupeEntries.label': '去重缓存大小',
  'field.maxDedupeEntries.hint': '记住最近多少条已通知事件。',

  // Controls: options, badges, validation.
  'option.inherit': '继承',
  'validation.blocking': '此值会导致保存被拒绝。',
  'validation.boolean': '{field} 必须为 true 或 false',
  'validation.integer': '{field} 必须为整数',
  'validation.range': '{field} 超出取值范围',
  'validation.min': '{field} 不能小于 {min}',
  'validation.max': '{field} 不能大于 {max}',
  'validation.address': '不是有效的邮箱地址：{list}',

  // Write-only password control.
  'secret.label': '密码',
  'secret.placeholderChange': '修改密码',
  'secret.placeholderSet': '设置密码',
  'secret.clear': '清除已存储密码',
  'secret.clearTitle': '移除该凭据引用下存储的口令',
  'secret.hintConfigured': '该凭据引用已存储口令。口令绝不会发送到浏览器；输入新口令即将其替换。',
  'secret.hintUnconfigured': '该凭据引用尚未存储口令。输入口令即完成存储，且不会被读回。',

  // Status block.
  'status.pluginActive': '插件运行中',
  'status.pluginInactive': '插件未运行',
  'status.pluginUnknown': '插件状态未知',
  'status.credential': '凭据：{state}',
  'status.configured': '已配置',
  'status.notConfigured': '未配置',
  'status.unknown': '未知',
  'status.queue': '队列 {depth}/{size} · 已投递 {delivered} · 失败 {failed}',
  'status.effectiveQuestions': '提问通知（生效值）：{state}',
  'status.effectiveApprovals': '批准通知（生效值）：{state}',
  'status.configError': '已保存的配置无法生效，仍在使用之前的设置：{detail}',

  // Actions.
  'action.test': '发送测试邮件',
  'action.sending': '正在发送…',
  'action.saving': '正在保存…',
  'action.save': '保存',
  'action.discard': '放弃修改',
  'action.reset': '恢复继承值',
  'action.resetField': '恢复继承值',
  'action.resetTitle': '移除本插件的全部用户层覆盖，使组合值与 schema 默认值重新生效',
  'action.resetFieldTitle': '移除该覆盖，使字段重新继承组合层的值',

  // Card-authored notices and delivery-test outcomes.
  'notice.fixInvalid': '请先修正标记为无效的字段再保存。',
  'notice.nothingToSave': '没有需要保存的修改。',
  'notice.resetStaged': '已暂存恢复操作：保存后所有字段将回到组合层的值。',
  'notice.saved': '已保存。',
  'notice.saveFailed': '宿主未接受本次保存。',
  'notice.credentialRemoved': '已存储的口令被移除。',
  'test.delivered': '测试邮件已发送：SMTP 服务器已接受该邮件（{count} 个收件人）。',
  'test.refused': 'SMTP 服务器拒绝了该邮件。',
}
