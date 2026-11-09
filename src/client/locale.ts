/**
 * The settings page's locale vocabulary: one typed key set, both shipped
 * dictionaries, and the English fallback used where no render-time translator
 * is present.
 *
 * Every plugin-authored visible string lives here and nowhere else. The page
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
 * ## Writing rules this copy follows
 *
 * - Say what the person gets, in their terms ("Task completed", "Agent asks you
 *   a question"), not what the runtime does ("settled turn", "listener").
 * - A hint answers "what happens if I turn this on / what do I type here", and
 *   names its unit and an example when a number or an address is expected.
 * - No internal vocabulary reaches the page: "composition layer", "override",
 *   "inherit", "envelope", and "code points" are all spelled as what they mean
 *   to the reader ("default", "your change", "sender", "characters").
 * - The question hint stays phase-neutral ("asks you a question"): DSH 0.2's
 *   timed `ask_user_question` can stop waiting while the question stays
 *   answerable, so "is waiting for your answer" would be false for that case.
 *   The approval hint may say "waiting", because the approval chain does block.
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
 * language renders this page in English.
 *
 * @module dsh-mail-notify/client/locale
 */

import type { LocaleDictOf, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BuiltInLocaleId } from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's settings page copy. */
    'dsh-mail-notify': MailNotifyLocaleKey
  }
}

/** The dictionary namespace this plugin owns in the DSH locale registry. */
export const MAIL_NOTIFY_NS = 'dsh-mail-notify'

/** Every plugin-authored string the page can render, as one closed union. */
export type MailNotifyLocaleKey =
  // Navigation, page chrome, and the pointer left on the plugin's detail page.
  | 'navLabel'
  | 'pageTitle'
  | 'pageIntro'
  | 'movedNotice'
  | 'loading'
  | 'readOnly'
  // Status and setup progress.
  | 'statusHeading'
  | 'stateLoading'
  | 'stateDisabled'
  | 'disabledHintSetup'
  | 'disabledHintReady'
  | 'stateSetupNeeded'
  | 'stateConfigError'
  | 'stateActive'
  | 'stateInactive'
  | 'configErrorDetails'
  | 'configErrorBody'
  | 'setupHeading'
  | 'stepServer'
  | 'stepAccount'
  | 'stepAddresses'
  | 'stepTest'
  | 'stepDone'
  | 'stepTodo'
  | 'activeEvents'
  | 'activeEventsNone'
  | 'listSeparator'
  | 'statsLine'
  // Test email.
  | 'actionSendTest'
  | 'actionSending'
  | 'hintTestEmail'
  | 'hintTestEmailDirty'
  | 'hintTestEmailNeedsSetup'
  | 'testEmailSent'
  | 'testEmailRefused'
  | 'testEmailServerMessage'
  | 'testEmailFailed'
  // Master switch.
  | 'labelEnable'
  | 'hintEnable'
  // When to send.
  | 'groupEvents'
  | 'hintEvents'
  | 'labelCompleted'
  | 'hintCompleted'
  | 'labelErrors'
  | 'hintErrors'
  | 'labelMaxTokens'
  | 'hintMaxTokens'
  | 'labelQuestions'
  | 'hintQuestions'
  | 'labelApprovals'
  | 'hintApprovals'
  | 'privacyNote'
  | 'labelIncludeSubagents'
  | 'hintIncludeSubagents'
  // Sending account.
  | 'groupSmtp'
  | 'hintSmtp'
  | 'requiredNote'
  | 'labelPreset'
  | 'hintPreset'
  | 'presetPlaceholder'
  | 'presetQq'
  | 'preset163'
  | 'preset126'
  | 'presetExmail'
  | 'presetGmail'
  | 'presetCustom'
  | 'autoFilledFromUser'
  | 'suggestPreset'
  | 'actionUsePreset'
  | 'guideShowAgain'
  | 'guideTitleCode'
  | 'guideTitleGoogle'
  | 'guideTitleExmail'
  | 'guideTitleGeneric'
  | 'guideOpenWebmail'
  | 'guideOpenAppPasswords'
  | 'guideQq1'
  | 'guideQq2'
  | 'guideQq3'
  | 'guideQq4'
  | 'guideQqNote'
  | 'guideNetease1'
  | 'guideNetease2'
  | 'guideNetease3'
  | 'guideNetease4'
  | 'guideNeteaseNote'
  | 'guideExmail1'
  | 'guideExmail2'
  | 'guideExmail3'
  | 'guideGmail1'
  | 'guideGmail2'
  | 'guideGmail3'
  | 'guideGmailNote'
  | 'guideGeneric1'
  | 'guideGeneric2'
  | 'guideGeneric3'
  | 'guideGeneric4'
  | 'guideGenericNote'
  | 'labelSmtpHost'
  | 'hintSmtpHost'
  | 'placeholderSmtpHost'
  | 'labelSmtpPort'
  | 'hintSmtpPort'
  | 'labelSecure'
  | 'hintSecure'
  | 'optionSecureTls'
  | 'optionSecureStartTls'
  | 'warnPort465StartTls'
  | 'warnPort587Tls'
  | 'labelSmtpUser'
  | 'hintSmtpUser'
  | 'placeholderAddress'
  | 'labelSecret'
  | 'hintSecretStored'
  | 'hintSecretMissing'
  | 'hintSecretReadOnly'
  | 'passwordPlaceholderKeep'
  | 'passwordPlaceholderNew'
  | 'passwordClear'
  | 'passwordClearTitle'
  | 'labelFrom'
  | 'hintFrom'
  | 'actionUseUsername'
  | 'labelRecipients'
  | 'hintRecipients'
  | 'placeholderRecipients'
  // Email content.
  | 'groupMessage'
  | 'labelIncludeMetadata'
  | 'hintIncludeMetadata'
  | 'labelIncludeUserPrompt'
  | 'hintIncludeUserPrompt'
  | 'labelIncludeFooter'
  | 'hintIncludeFooter'
  // Quiet rules.
  | 'groupQuiet'
  | 'labelMinTurnDuration'
  | 'hintMinTurnDuration'
  | 'labelMutedWorkspaces'
  | 'hintMutedWorkspaces'
  | 'placeholderMutedWorkspaces'
  | 'labelMutedSessions'
  | 'hintMutedSessions'
  | 'placeholderMutedSessions'
  | 'hintListClearDefault'
  // Advanced.
  | 'groupAdvanced'
  | 'hintAdvanced'
  | 'labelCredentialRef'
  | 'hintCredentialRef'
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
  | 'labelResetAll'
  | 'hintResetAll'
  | 'actionResetAll'
  // Units.
  | 'unitMs'
  | 'unitChars'
  // Control vocabulary.
  | 'factOn'
  | 'factOff'
  | 'requiredMark'
  | 'requiredMissing'
  | 'actionResetField'
  | 'resetFieldTitle'
  | 'pendingReset'
  | 'defaultValue'
  | 'emptyValue'
  | 'invalidBlocksSave'
  // Validation refusals (rendered with `field`, `min`, `max`, `entries` params).
  | 'invalidTrueFalse'
  | 'invalidWholeNumber'
  | 'invalidNumberRange'
  | 'invalidMin'
  | 'invalidMax'
  | 'invalidAddress'
  // Save bar.
  | 'unsavedChanges'
  | 'actionDiscard'
  | 'actionSave'
  | 'actionSaving'
  // Operation messages (semantic identities the controller stores).
  | 'noticeFixInvalid'
  | 'noticeFillRequired'
  | 'noticeNothingToSave'
  | 'noticeResetStaged'
  | 'noticeSaved'
  | 'noticeSaveRefused'
  | 'noticeSaveRefusedDefault'
  | 'noticeCredentialRemoved'
  | 'noticeCredentialRefused'

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
  navLabel: 'Email alerts',
  pageTitle: 'Email notifications',
  pageIntro:
    'Get an email when an agent finishes a task, fails, or needs your input, so you do not have to keep watching DSH. Changes take effect after you click Save.',
  movedNotice:
    'These settings have moved to the Settings window: open Settings and choose "Email alerts" in the left navigation.',
  loading: 'Loading settings…',
  readOnly: 'These settings are read-only in this environment.',

  statusHeading: 'Status',
  stateLoading: 'Checking status…',
  stateDisabled: 'Off — no emails will be sent',
  disabledHintSetup: 'To start: turn on the switch below, fill in the sending account, then click Save.',
  disabledHintReady: 'Your sending account is set up. Turn on the switch below and click Save to start.',
  stateSetupNeeded: 'Setup needed — fill in the sending account below',
  stateConfigError: 'The saved settings could not be applied',
  stateActive: 'Running',
  stateInactive: 'Not running',
  configErrorDetails: 'Show details',
  configErrorBody: 'The last settings that worked are still in use. Reason reported by DSH: {message}',
  setupHeading: 'Setup steps',
  stepServer: 'Enter the SMTP server',
  stepAccount: 'Enter the username and save the password (authorization code)',
  stepAddresses: 'Enter the sender and at least one recipient',
  stepTest: 'Send a test email and check that it arrives',
  stepDone: 'Done',
  stepTodo: 'To do',
  activeEvents: 'Emails are sent for: {value}',
  activeEventsNone: 'nothing — every notification type is off',
  listSeparator: ', ',
  statsLine: 'Sent {delivered} · Failed {failed} · Waiting {depth} (limit {size})',

  actionSendTest: 'Send test email',
  actionSending: 'Sending…',
  hintTestEmail: 'Sends a short message to every recipient, using the saved settings.',
  hintTestEmailDirty: 'You have unsaved changes. The test uses the last saved settings — save first to test your changes.',
  hintTestEmailNeedsSetup: 'Fill in and save the sending account first.',
  testEmailSent: 'Test email sent: the SMTP server accepted it for {count} recipient(s). Check the inbox (and the spam folder).',
  testEmailRefused: 'The SMTP server rejected the test email.',
  testEmailServerMessage: 'The SMTP server rejected the test email: {message}',
  testEmailFailed: 'The test email could not be sent: {message}',

  labelEnable: 'Email notifications',
  hintEnable: 'When off, nothing is sent and the password is not read. Your settings are kept.',

  groupEvents: 'When to send',
  hintEvents: 'Choose which events send you an email.',
  labelCompleted: 'Task completed',
  hintCompleted: 'An agent finished a task normally. The email contains its final reply.',
  labelErrors: 'Task failed',
  hintErrors: 'A task stopped with an error, even if the agent produced no reply.',
  labelMaxTokens: 'Output limit reached',
  hintMaxTokens: 'A task stopped because it hit the token limit, so the reply may be incomplete.',
  labelQuestions: 'Agent asks you a question',
  hintQuestions: 'Sent as soon as DSH asks you a question. The email includes the question and its options.',
  labelApprovals: 'Agent needs your approval',
  hintApprovals: 'Sent as soon as DSH is waiting for your approval. The email includes the tool name and the reason given.',
  privacyNote: 'These two are off by default: turning one on sends the question or the approval details to your mail provider.',
  labelIncludeSubagents: 'Include subagents',
  hintIncludeSubagents:
    'Also email about tasks the agent delegates to subagents. By default only your own top-level tasks are reported.',

  groupSmtp: 'Sending account (SMTP)',
  hintSmtp:
    'Emails are sent from your own mailbox. Most providers (QQ, 163, Gmail, …) require you to turn on SMTP in their web settings first and to use the authorization code or app password they give you instead of your login password.',
  requiredNote: 'Fields marked * are required while email notifications are on.',
  labelPreset: 'Quick fill',
  hintPreset:
    'Fills in the server, port, and encryption for a common provider, and shows how to get its authorization code. You can still edit them before saving.',
  presetPlaceholder: 'Choose a provider…',
  presetQq: 'QQ Mail',
  preset163: 'NetEase 163 Mail',
  preset126: 'NetEase 126 Mail',
  presetExmail: 'Tencent Exmail',
  presetGmail: 'Gmail',
  presetCustom: 'Other (entered by hand)',
  autoFilledFromUser:
    'Recognized a {name} address, so its server, port, and encryption were filled in. Check them, then click Save.',
  suggestPreset: 'The username is a {name} address, but the server is not {host}.',
  actionUsePreset: 'Use {name} settings',
  guideShowAgain: 'How do I get a new one?',
  guideTitleCode: 'How to get the {name} authorization code',
  guideTitleGoogle: 'How to get a {name} app password',
  guideTitleExmail: 'Which password {name} needs',
  guideTitleGeneric: 'How to get the authorization code',
  guideOpenWebmail: 'Open {name} in the browser',
  guideOpenAppPasswords: 'Open the Google app passwords page',
  guideQq1: 'Sign in to QQ Mail on the web and open Settings → Account (Account & Security in the new layout).',
  guideQq2: 'Find "POP3/IMAP/SMTP/Exchange/CardDAV service" and turn on the SMTP service.',
  guideQq3: 'Complete the security check it asks for; a 16-character authorization code is then shown.',
  guideQq4: 'Paste the code into the field above without spaces, then click Save.',
  guideQqNote: 'The code is shown only once. Changing your QQ password invalidates codes generated before.',
  guideNetease1: 'Sign in to {name} on the web and open Settings → POP3/SMTP/IMAP at the top.',
  guideNetease2: 'Turn on "IMAP/SMTP service" (or "POP3/SMTP service") and complete the SMS verification.',
  guideNetease3: 'Copy the authorization code that appears.',
  guideNetease4: 'Paste it into the field above, then click Save.',
  guideNeteaseNote: 'The code is shown only once and cannot be looked up later; if you lose it, generate a new one.',
  guideExmail1: 'Sign in to {name} on the web and make sure IMAP/SMTP is turned on in the client settings.',
  guideExmail2:
    'If your account uses secure login (WeChat verification), generate a client-specific password and use it here; otherwise use your mailbox password.',
  guideExmail3: 'Use your full company email address as the username, paste the password into the field above, then click Save.',
  guideGmail1: 'Turn on 2-Step Verification for your Google Account — app passwords require it.',
  guideGmail2: 'Open the app passwords page, enter a name such as DSH, and click Create.',
  guideGmail3: 'Copy the 16-character password (spaces can be left out), paste it into the field above, then click Save.',
  guideGmailNote: 'Work and school accounts may have app passwords turned off by their administrator.',
  guideGeneric1: 'Sign in to your mailbox on the web and open its settings.',
  guideGeneric2: 'Find the SMTP service (often listed as POP3/IMAP/SMTP) and turn it on.',
  guideGeneric3: 'Complete any verification it asks for, then copy the authorization code or app password it gives you.',
  guideGeneric4: 'Paste it into the field above, then click Save.',
  guideGenericNote: 'Tip: choose your provider under Quick fill above to see its exact steps.',
  labelSmtpHost: 'SMTP server',
  hintSmtpHost: 'The outgoing mail server, for example smtp.qq.com or smtp.163.com.',
  placeholderSmtpHost: 'smtp.example.com',
  labelSmtpPort: 'Port',
  hintSmtpPort: 'Usually 465 (SSL/TLS) or 587 (STARTTLS).',
  labelSecure: 'Encryption',
  hintSecure: 'Must match the port: SSL/TLS for 465, STARTTLS for 587.',
  optionSecureTls: 'SSL/TLS',
  optionSecureStartTls: 'STARTTLS',
  warnPort465StartTls: 'Port 465 normally needs SSL/TLS. With STARTTLS the connection will most likely fail.',
  warnPort587Tls: 'Port 587 normally needs STARTTLS. With SSL/TLS the connection will most likely fail.',
  labelSmtpUser: 'Username',
  hintSmtpUser:
    'The account used to sign in to the SMTP server — usually your full email address. A QQ, 163, 126, or Gmail address fills in the server for you.',
  placeholderAddress: 'you@example.com',
  labelSecret: 'Password / authorization code',
  hintSecretStored: 'Saved. For your security it is never shown again; type a new one to replace it.',
  hintSecretMissing:
    'Not saved yet. Use the authorization code or app password from your mail provider. It is kept in the DSH credential store and never sent back to the browser.',
  hintSecretReadOnly: 'The password cannot be changed from this page in this environment.',
  passwordPlaceholderKeep: 'Leave blank to keep the saved password',
  passwordPlaceholderNew: 'Enter the password or authorization code',
  passwordClear: 'Delete saved password',
  passwordClearTitle: 'Delete the saved password right away (no Save needed)',
  labelFrom: 'Sender address',
  hintFrom: 'The address the emails come from. Most providers require it to be the same as the username.',
  actionUseUsername: 'Same as username',
  labelRecipients: 'Recipients',
  hintRecipients: 'Who receives the notifications. Separate several addresses with commas or new lines.',
  placeholderRecipients: 'me@example.com',

  groupMessage: 'Email content',
  labelIncludeMetadata: 'Include task details',
  hintIncludeMetadata: 'Session, workspace, model, and how long the task took.',
  labelIncludeUserPrompt: 'Include your message',
  hintIncludeUserPrompt:
    'Adds the last message you sent the agent. Off by default, because it may contain things you would rather not email.',
  labelIncludeFooter: 'Include footer',
  hintIncludeFooter: 'A short signature line, and a note when a long reply was shortened.',

  groupQuiet: 'Quiet rules',
  labelMinTurnDuration: 'Skip quick tasks',
  hintMinTurnDuration:
    'No completed / failed / output-limit email for tasks that finished faster than this (60000 = 1 minute). 0 sends them all. Questions and approvals are always sent, and so are tasks whose duration is unknown.',
  labelMutedWorkspaces: 'Muted workspaces',
  hintMutedWorkspaces:
    'Sessions in these folders send no automatic emails. One absolute folder path per line; it must match the workspace folder exactly (case-insensitive on Windows).',
  placeholderMutedWorkspaces: 'D:\\Projects\\demo',
  labelMutedSessions: 'Muted sessions',
  hintMutedSessions:
    'These sessions send no automatic emails. One complete session ID per line (case-sensitive). Test emails are not affected.',
  placeholderMutedSessions: 'Paste a session ID',
  hintListClearDefault: 'To mute nothing at all instead of using the default list, enter [].',

  groupAdvanced: 'Advanced',
  hintAdvanced: 'Rarely needs changing.',
  labelCredentialRef: 'Password storage name',
  hintCredentialRef:
    'The name the password is stored under in the DSH credential store — not the password itself. Change it only to share one stored password with other tools.',
  labelMaxBody: 'Maximum email length',
  hintMaxBody: 'Longer replies are cut off at this many characters.',
  labelQueueSize: 'Send queue length',
  hintQueueSize:
    'How many emails may wait to be sent at once. When the queue is full, new notifications are dropped (and logged).',
  labelRetryAttempts: 'Retries after a failed send',
  hintRetryAttempts: 'How many more times to try a failed send (total attempts = this + 1).',
  labelRetryBaseDelay: 'First retry delay',
  hintRetryBaseDelay: 'Wait before the first retry. Each later retry waits three times longer, up to 30 seconds.',
  labelDedupe: 'Duplicate guard size',
  hintDedupe: 'How many recent events are remembered so the same notification is never sent twice.',
  labelResetAll: 'Restore all defaults',
  hintResetAll: 'Undoes every change made on this page. Takes effect after Save; the saved password is kept.',
  actionResetAll: 'Restore defaults',

  unitMs: 'ms',
  unitChars: 'characters',

  factOn: 'On',
  factOff: 'Off',
  requiredMark: 'required',
  requiredMissing: 'Required while email notifications are on.',
  actionResetField: 'Restore default',
  resetFieldTitle: 'Undo your change and use the default ({value})',
  pendingReset: 'The default ({value}) will be restored when you save.',
  defaultValue: 'Default: {value}',
  emptyValue: 'empty',
  invalidBlocksSave: 'Fix this before saving.',

  invalidTrueFalse: '{field} must be true or false.',
  invalidWholeNumber: '{field} must be a whole number.',
  invalidNumberRange: '{field} is too large.',
  invalidMin: '{field} must be at least {min}.',
  invalidMax: '{field} must be at most {max}.',
  invalidAddress: 'Not a valid email address: {entries}',

  unsavedChanges: 'You have unsaved changes',
  actionDiscard: 'Discard',
  actionSave: 'Save',
  actionSaving: 'Saving…',

  noticeFixInvalid: 'Some fields need fixing before you can save.',
  noticeFillRequired: 'Fill in the fields marked * first, or turn email notifications off.',
  noticeNothingToSave: 'Nothing to save.',
  noticeResetStaged: 'Every field is set back to its default. Click Save to apply.',
  noticeSaved: 'Saved',
  noticeSaveRefused: 'Could not save: {message}',
  noticeSaveRefusedDefault: 'Could not save. Check the fields and try again.',
  noticeCredentialRemoved: 'The saved password was deleted.',
  noticeCredentialRefused: 'Could not change the password: {message}',
}

/** Simplified Chinese copy. Complete against the same key union. */
export const zh: Record<MailNotifyLocaleKey, string> = {
  navLabel: '邮件通知',
  pageTitle: '邮件通知',
  pageIntro: '当智能体完成任务、出错或需要你介入时发邮件提醒你，不必一直守在 DSH 前。修改后需点击「保存」才会生效。',
  movedNotice: '本插件的设置已移至设置窗口：打开「设置」，在左侧导航中选择「邮件通知」。',
  loading: '正在加载设置…',
  readOnly: '当前环境下这些设置为只读。',

  statusHeading: '运行状态',
  stateLoading: '正在检查状态…',
  stateDisabled: '已关闭：不会发送任何邮件',
  disabledHintSetup: '开始使用：打开下方的总开关，填写发信账号，然后点击「保存」。',
  disabledHintReady: '发信账号已设置好。打开下方的总开关并点击「保存」即可开始。',
  stateSetupNeeded: '待完成设置：请先填写下方的发信账号',
  stateConfigError: '已保存的设置未能生效',
  stateActive: '运行中',
  stateInactive: '未运行',
  configErrorDetails: '查看原因',
  configErrorBody: '目前仍在使用上一次有效的设置。DSH 报告的原因：{message}',
  setupHeading: '设置步骤',
  stepServer: '填写 SMTP 服务器',
  stepAccount: '填写用户名并保存密码（授权码）',
  stepAddresses: '填写发件人和至少一个收件人',
  stepTest: '发送测试邮件，确认能正常收到',
  stepDone: '已完成',
  stepTodo: '未完成',
  activeEvents: '会发送邮件的情况：{value}',
  activeEventsNone: '无（所有通知类型均已关闭）',
  listSeparator: '、',
  statsLine: '已发送 {delivered} · 失败 {failed} · 等待发送 {depth}（上限 {size}）',

  actionSendTest: '发送测试邮件',
  actionSending: '正在发送…',
  hintTestEmail: '使用已保存的设置，向全部收件人发送一封简短的测试邮件。',
  hintTestEmailDirty: '你有未保存的更改，测试邮件会使用上次保存的设置。如需测试新设置，请先保存。',
  hintTestEmailNeedsSetup: '请先填写并保存发信账号。',
  testEmailSent: '测试邮件已发出：SMTP 服务器已接收，共 {count} 个收件人。请查看收件箱（以及垃圾邮件文件夹）。',
  testEmailRefused: 'SMTP 服务器拒收了测试邮件。',
  testEmailServerMessage: 'SMTP 服务器拒收了测试邮件：{message}',
  testEmailFailed: '测试邮件发送失败：{message}',

  labelEnable: '邮件通知',
  hintEnable: '关闭后不会发送任何邮件，也不会读取密码；已填写的设置会保留。',

  groupEvents: '何时发送',
  hintEvents: '选择哪些情况会给你发邮件。',
  labelCompleted: '任务完成',
  hintCompleted: '智能体正常完成一项任务，邮件中包含它的最终回复。',
  labelErrors: '任务出错',
  hintErrors: '任务因错误而中止，即使智能体没有给出任何回复也会发送。',
  labelMaxTokens: '达到输出上限',
  hintMaxTokens: '任务因达到 Token 上限而停止，回复可能不完整。',
  labelQuestions: '智能体向你提问',
  hintQuestions: 'DSH 向你提问时立即发送，邮件中包含问题及选项。',
  labelApprovals: '智能体等待你批准',
  hintApprovals: 'DSH 正在等待你批准某项操作时立即发送，邮件中包含工具名称及申请理由。',
  privacyNote: '这两项默认关闭：开启后，问题或审批的具体内容会发送到你的邮件服务商。',
  labelIncludeSubagents: '包含子智能体',
  hintIncludeSubagents: '智能体委派给子智能体的任务也发送邮件。默认只通知你直接发起的顶层任务。',

  groupSmtp: '发信账号（SMTP）',
  hintSmtp:
    '邮件从你自己的邮箱发出。QQ、163、Gmail 等大多数邮箱需要先在网页版设置中开启 SMTP 服务，并使用邮箱提供的「授权码」或「应用专用密码」代替登录密码。',
  requiredNote: '开启邮件通知时，带 * 的项为必填。',
  labelPreset: '快速填写',
  hintPreset: '为常见邮箱自动填好服务器、端口和加密方式，并显示获取授权码的步骤。保存前仍可修改。',
  presetPlaceholder: '选择邮箱服务商…',
  presetQq: 'QQ 邮箱',
  preset163: '网易 163 邮箱',
  preset126: '网易 126 邮箱',
  presetExmail: '腾讯企业邮箱',
  presetGmail: 'Gmail',
  presetCustom: '其他（手动填写）',
  autoFilledFromUser: '已识别为{name}地址，自动填好了服务器、端口和加密方式。请检查后点击「保存」。',
  suggestPreset: '用户名是{name}地址，但服务器不是 {host}。',
  actionUsePreset: '改用{name}的设置',
  guideShowAgain: '如何重新获取？',
  guideTitleCode: '如何获取{name}授权码',
  guideTitleGoogle: '如何获取 {name} 应用专用密码',
  guideTitleExmail: '{name}应填写哪种密码',
  guideTitleGeneric: '如何获取授权码',
  guideOpenWebmail: '在浏览器中打开{name}',
  guideOpenAppPasswords: '打开 Google 应用专用密码页面',
  guideQq1: '登录 QQ 邮箱网页版，进入「设置」→「账号」（新版界面为「账号与安全」）。',
  guideQq2: '找到「POP3/IMAP/SMTP/Exchange/CardDAV 服务」，开启 SMTP 服务。',
  guideQq3: '按提示完成安全验证，页面会显示一个 16 位授权码。',
  guideQq4: '将授权码（不含空格）粘贴到上方输入框，然后点击「保存」。',
  guideQqNote: '授权码只显示一次；修改 QQ 密码后，之前生成的授权码会全部失效。',
  guideNetease1: '登录{name}网页版，点击顶部「设置」→「POP3/SMTP/IMAP」。',
  guideNetease2: '开启「IMAP/SMTP 服务」（或「POP3/SMTP 服务」），按提示完成短信验证。',
  guideNetease3: '复制页面显示的授权码。',
  guideNetease4: '粘贴到上方输入框，然后点击「保存」。',
  guideNeteaseNote: '授权码只显示一次，之后无法查看；丢失后只能重新生成。',
  guideExmail1: '登录{name}网页版，在客户端设置中确认已开启 IMAP/SMTP 服务。',
  guideExmail2: '如果账号开启了安全登录（微信验证），需生成「客户端专用密码」并填在这里；否则填写邮箱登录密码。',
  guideExmail3: '用户名填写完整的企业邮箱地址，把密码粘贴到上方输入框，然后点击「保存」。',
  guideGmail1: '为 Google 账号开启「两步验证」——应用专用密码要求先开启它。',
  guideGmail2: '打开应用专用密码页面，输入一个名称（例如 DSH），点击「创建」。',
  guideGmail3: '复制生成的 16 位密码（可去掉空格），粘贴到上方输入框，然后点击「保存」。',
  guideGmailNote: '工作或学校账号的管理员可能关闭了应用专用密码。',
  guideGeneric1: '登录邮箱网页版，打开邮箱设置。',
  guideGeneric2: '找到 SMTP 服务（通常写作 POP3/IMAP/SMTP），将其开启。',
  guideGeneric3: '按提示完成验证，复制邮箱提供的授权码或应用专用密码。',
  guideGeneric4: '粘贴到上方输入框，然后点击「保存」。',
  guideGenericNote: '提示：在上方「快速填写」中选择你的邮箱，可查看对应的具体步骤。',
  labelSmtpHost: 'SMTP 服务器',
  hintSmtpHost: '发信服务器地址，例如 smtp.qq.com、smtp.163.com。',
  placeholderSmtpHost: 'smtp.example.com',
  labelSmtpPort: '端口',
  hintSmtpPort: '通常为 465（SSL/TLS）或 587（STARTTLS）。',
  labelSecure: '加密方式',
  hintSecure: '需与端口对应：465 端口选 SSL/TLS，587 端口选 STARTTLS。',
  optionSecureTls: 'SSL/TLS',
  optionSecureStartTls: 'STARTTLS',
  warnPort465StartTls: '465 端口通常需要 SSL/TLS，选择 STARTTLS 很可能无法连接。',
  warnPort587Tls: '587 端口通常需要 STARTTLS，选择 SSL/TLS 很可能无法连接。',
  labelSmtpUser: '用户名',
  hintSmtpUser: '登录 SMTP 服务器所用的账号，通常是完整的邮箱地址。填写 QQ、163、126 或 Gmail 地址时会自动填好服务器。',
  placeholderAddress: 'you@example.com',
  labelSecret: '密码 / 授权码',
  hintSecretStored: '已保存。出于安全考虑不会再显示；如需更换，直接输入新的即可。',
  hintSecretMissing: '尚未保存。请填写邮箱提供的授权码（或应用专用密码），它保存在 DSH 凭据库中，不会回传到浏览器。',
  hintSecretReadOnly: '当前环境不允许在此页面修改密码。',
  passwordPlaceholderKeep: '留空则保留已保存的密码',
  passwordPlaceholderNew: '输入密码或授权码',
  passwordClear: '删除已保存的密码',
  passwordClearTitle: '立即删除已保存的密码（无需点击保存）',
  labelFrom: '发件人地址',
  hintFrom: '邮件显示的发件地址。大多数邮箱要求它与用户名一致。',
  actionUseUsername: '与用户名相同',
  labelRecipients: '收件人',
  hintRecipients: '接收通知的邮箱，多个地址用逗号或换行分隔。',
  placeholderRecipients: 'me@example.com',

  groupMessage: '邮件内容',
  labelIncludeMetadata: '附带任务信息',
  hintIncludeMetadata: '会话、工作区、模型以及任务耗时。',
  labelIncludeUserPrompt: '附带你的消息',
  hintIncludeUserPrompt: '附上你发给智能体的最后一条消息。默认关闭，因为其中可能有你不想通过邮件发送的内容。',
  labelIncludeFooter: '附带页脚',
  hintIncludeFooter: '邮件末尾的简短署名，以及长回复被截断时的提示。',

  groupQuiet: '免打扰',
  labelMinTurnDuration: '忽略短任务',
  hintMinTurnDuration:
    '耗时短于该值的任务不发送完成、出错或达到上限的邮件（60000 即 1 分钟）。0 表示全部发送。提问和批准通知始终发送，耗时未知的任务也照常发送。',
  labelMutedWorkspaces: '免通知的工作区',
  hintMutedWorkspaces:
    '这些文件夹中的会话不发送任何自动邮件。每行一个绝对路径，需与工作区文件夹完全一致（Windows 下不区分大小写）。',
  placeholderMutedWorkspaces: 'D:\\Projects\\demo',
  labelMutedSessions: '免通知的会话',
  hintMutedSessions: '这些会话不发送任何自动邮件。每行一个完整的会话 ID（区分大小写）。不影响测试邮件。',
  placeholderMutedSessions: '粘贴会话 ID',
  hintListClearDefault: '如果不想使用默认列表、而是一个都不屏蔽，请输入 []。',

  groupAdvanced: '高级设置',
  hintAdvanced: '通常无需修改。',
  labelCredentialRef: '密码存储名称',
  hintCredentialRef: '密码在 DSH 凭据库中的存储名称（不是密码本身）。只有需要与其他工具共用同一份密码时才需修改。',
  labelMaxBody: '邮件正文长度上限',
  hintMaxBody: '超过该字符数的回复会被截断。',
  labelQueueSize: '发送队列长度',
  hintQueueSize: '最多可同时排队等待发送的邮件数。队列已满时，新的通知会被丢弃（并记录日志）。',
  labelRetryAttempts: '发送失败重试次数',
  hintRetryAttempts: '发送失败后最多再尝试几次（总尝试次数 = 该值 + 1）。',
  labelRetryBaseDelay: '首次重试等待',
  hintRetryBaseDelay: '第一次重试前的等待时间，之后每次重试等待时间乘以 3，最长 30 秒。',
  labelDedupe: '去重记录数',
  hintDedupe: '记住最近多少个事件，确保同一条通知不会重复发送。',
  labelResetAll: '全部恢复默认',
  hintResetAll: '撤销本页面上的所有修改，点击「保存」后生效；已保存的密码不受影响。',
  actionResetAll: '恢复默认',

  unitMs: '毫秒',
  unitChars: '字符',

  factOn: '开启',
  factOff: '关闭',
  requiredMark: '必填',
  requiredMissing: '开启邮件通知时此项必填。',
  actionResetField: '恢复默认',
  resetFieldTitle: '撤销你的修改，改用默认值（{value}）',
  pendingReset: '保存后将恢复为默认值（{value}）。',
  defaultValue: '默认：{value}',
  emptyValue: '空',
  invalidBlocksSave: '请修正后再保存。',

  invalidTrueFalse: '「{field}」只能是 true 或 false。',
  invalidWholeNumber: '「{field}」必须是整数。',
  invalidNumberRange: '「{field}」数值过大。',
  invalidMin: '「{field}」不能小于 {min}。',
  invalidMax: '「{field}」不能大于 {max}。',
  invalidAddress: '邮箱地址格式不正确：{entries}',

  unsavedChanges: '有未保存的更改',
  actionDiscard: '放弃更改',
  actionSave: '保存',
  actionSaving: '正在保存…',

  noticeFixInvalid: '部分字段需要修正后才能保存。',
  noticeFillRequired: '请先填写带 * 的必填项，或关闭邮件通知后再保存。',
  noticeNothingToSave: '没有需要保存的更改。',
  noticeResetStaged: '所有字段已恢复为默认值，点击「保存」后生效。',
  noticeSaved: '已保存',
  noticeSaveRefused: '保存失败：{message}',
  noticeSaveRefusedDefault: '保存失败，请检查填写内容后重试。',
  noticeCredentialRemoved: '已删除保存的密码。',
  noticeCredentialRefused: '密码修改失败：{message}',
}

/**
 * Both shipped dictionaries, keyed exactly as `LocaleRuntime.register`'s typed
 * form requires — the `Record<BuiltInLocaleId, …>` shape is what enforces
 * bilingual balance at the registration site.
 */
export const mailNotifyDictionaries: Record<BuiltInLocaleId, LocaleDictOf<typeof MAIL_NOTIFY_NS>> = { en, zh }

/** The translate seat the framework injects for this namespace. */
export type MailNotifyTranslate = TranslateNS<typeof MAIL_NOTIFY_NS>
