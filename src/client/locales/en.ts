/**
 * English copy for the `dsh-mail-notify` configuration card.
 *
 * Declared as {@link MailNotifyDictionary}, so this file cannot compile with a
 * key the vocabulary does not declare or without a key it does.
 *
 * @module dsh-mail-notify/client/locales/en
 */

import type { MailNotifyDictionary } from './vocabulary.ts'

/** English dictionary. */
export const en: MailNotifyDictionary = {
  title: 'Mail notifications',
  subtitle: 'Configure email notifications',
  description:
    'Emails a top-level turn’s final output, its terminal failures, and its mid-turn requests for a person over SMTP.',

  'summary.expand': 'Expand',
  'summary.collapse': 'Collapse',
  'summary.active': 'Active',
  'summary.inactive': 'Not running',
  'summary.smtpConfigured': 'SMTP configured',
  'summary.smtpMissing': 'SMTP not configured',
  'summary.questionsOn': 'Questions on',
  'summary.questionsOff': 'Questions off',
  'summary.unsaved': 'Unsaved changes',

  'value.on': 'On',
  'value.off': 'Off',
  'value.inherit': 'Inherited',
  'value.unknown': 'Unknown',
  'value.configured': 'Configured',
  'value.notConfigured': 'Not configured',

  'group.status': 'Status',
  'group.general': 'General',
  'group.notifications': 'Notifications',
  'group.humanAttention': 'Questions and approvals',
  'group.smtp': 'SMTP',
  'group.credential': 'Credential',
  'group.message': 'Message content',
  'group.delivery': 'Delivery',

  'attention.intro':
    'These two are the reason a notification exists: an agent that has stopped and is waiting for you. Both are off by default.',

  'field.enabled': 'Enable mail notifications',
  'field.includeSubagents': 'Include subagent activity',
  'field.notifyQuestions': 'Questions requiring input',
  'field.notifyApprovals': 'Approval requests',
  'field.notifyCompleted': 'Completed turns',
  'field.notifyErrors': 'Errors',
  'field.notifyMaxTokens': 'Token-limit termination',
  'field.smtpHost': 'SMTP host',
  'field.smtpPort': 'Port',
  'field.smtpSecure': 'Security',
  'field.smtpUser': 'Username',
  'field.from': 'From',
  'field.to': 'Recipients',
  'field.credentialRef': 'Credential reference',
  'field.includeMetadata': 'Include metadata',
  'field.includeUserPrompt': 'Include user prompt',
  'field.includeFooter': 'Include footer',
  'field.maxBodyChars': 'Maximum body length',
  'field.queueSize': 'Queue size',
  'field.retryAttempts': 'Retry attempts',
  'field.retryBaseDelayMs': 'Retry base delay',
  'field.maxDedupeEntries': 'Dedupe cache size',

  'hint.enabled': 'While off, the plugin registers no listener and reads no credential.',
  'hint.includeSubagents': 'Whether delegated subagent turns are notified as well as top-level turns.',
  'hint.notifyQuestions': 'Send an email immediately when DSH is waiting for your answer.',
  'hint.notifyApprovals': 'Send an email immediately when DSH is waiting for your approval.',
  'hint.notifyCompleted': 'A top-level turn that finished normally.',
  'hint.notifyErrors': 'A turn that ended with a terminal error, including one that produced no visible output.',
  'hint.notifyMaxTokens': 'A turn that stopped because it reached the token limit.',
  'hint.smtpHost': 'Host name of the SMTP server.',
  'hint.smtpPort': '587 for STARTTLS, 465 for implicit TLS.',
  'hint.smtpSecure': 'On selects implicit TLS (normally port 465); off allows a STARTTLS upgrade (normally 587).',
  'hint.smtpUser': 'Authentication user name.',
  'hint.from': 'Envelope sender. Some servers require this to match the authenticated account.',
  'hint.to': 'One or more addresses, separated by commas or new lines.',
  'hint.credentialRef': 'Name of the credential the password is read from. A name, never the password itself.',
  'hint.includeMetadata': 'Session, workspace, model, and timing.',
  'hint.includeUserPrompt': 'Off by default: the prompt may carry content you did not intend to mail.',
  'hint.includeFooter': 'The generator footer and the truncation marker.',
  'hint.maxBodyChars': 'Maximum visible-text length, counted in code points.',
  'hint.queueSize': 'Waiting-job cap; the worker holds one more.',
  'hint.retryAttempts': 'Total attempts are one plus this.',
  'hint.retryBaseDelayMs': 'Retry n waits base × 3^(n−1), capped at 30 s.',
  'hint.maxDedupeEntries': 'How many recently notified events are remembered.',

  'control.reset': 'Reset',
  'control.resetTitle': 'Remove this override so the field re-inherits the composition value',
  'control.inherited': 'inherited',
  'control.invalid': 'This value will block the save.',
  'control.boolean': 'Inherit, on, or off. Inherit removes the override.',

  'secret.label': 'Password',
  'secret.placeholder': 'leave blank to keep the current password',
  'secret.set': 'Set password',
  'secret.change': 'Change password',
  'secret.clear': 'Clear stored password',
  'secret.clearTitle': 'Remove the stored value for this reference',
  'secret.stored':
    'A password is stored for this reference. It is never sent to the browser; typing a new one replaces it.',
  'secret.absent':
    'No password is stored for this reference yet. Typing one stores it without it ever being read back.',

  'status.pluginLabel': 'plugin',
  'status.credentialLabel': 'credential',
  'status.queue': 'queue',
  'status.queueDepth': '{depth}/{size} · {delivered} delivered · {failed} failed',
  'status.effectiveQuestions': 'Effective question notifications',
  'status.effectiveApprovals': 'Effective approval notifications',
  'status.configError':
    'The saved configuration cannot be applied, so the previous settings are still in effect: {reason}',

  'action.sendTest': 'Send test email',
  'action.sending': 'Sending…',
  'action.testSent': 'Test email sent',
  'action.testRefused': 'Test email refused',
  'action.reset': 'Reset',
  'action.resetTitle':
    'Remove every override this plugin owns, so the composition values and schema defaults apply again',
  'action.discard': 'Discard',
  'action.save': 'Save',
  'action.saving': 'Saving…',

  'notice.saved': 'Saved',
  'notice.nothingToSave': 'Nothing to save.',
  'notice.fixInvalid': 'Fix the highlighted fields before saving.',
  'notice.resetStaged': 'Reset staged: every field will go back to the composition values when you save.',
  'notice.passwordRemoved': 'The stored password was removed.',
  'notice.saveRefused': 'The host did not accept the save.',
  'notice.testAccepted': 'The SMTP server accepted the message for {count} recipient(s).',

  'validation.boolean': '{label} must be true or false',
  'validation.wholeNumber': '{label} must be a whole number',
  'validation.outOfRange': '{label} is out of range',
  'validation.atLeast': '{label} must be at least {min}',
  'validation.atMost': '{label} must be at most {max}',
  'validation.badAddress': 'not a plausible email address: {addresses}',
}
