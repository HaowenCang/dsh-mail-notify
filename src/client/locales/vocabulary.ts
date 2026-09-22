/**
 * The card's locale key vocabulary — the single declaration of every browser
 * string this plugin authors.
 *
 * The union below is the *source of truth for the key set*, and both shipped
 * dictionaries are declared as `Record<MailNotifyLocaleKey, string>`. A key
 * added here without copy in either language is therefore a compile error, and
 * a key removed from one dictionary while the other keeps it is a compile
 * error too. That is what "exact key parity between en and zh" means as a
 * property of the build rather than as a review promise.
 *
 * Keys are dotted and grouped by the surface that renders them, not by the
 * field table: a reader looking for the collapsed summary finds `summary.*`
 * together, and the grouping survives the field table being reordered.
 *
 * ## What deliberately does not live here
 *
 * `DSH`, `SMTP`, `TLS`, and `STARTTLS` are canonical technical terms and stay
 * verbatim in both dictionaries. Host-authored text — a save refusal composed
 * by the settings provider, a redacted SMTP diagnostic — never enters this
 * table either: this plugin did not author it, does not know its language, and
 * passes it through unchanged in both locales.
 *
 * @module dsh-mail-notify/client/locales/vocabulary
 */

/** Every locale key this plugin's browser half renders. */
export type MailNotifyLocaleKey =
  // Card chrome.
  | 'title'
  | 'subtitle'
  | 'description'
  | 'summary.expand'
  | 'summary.collapse'
  // Collapsed summary: three safe facts, nothing else.
  | 'summary.active'
  | 'summary.inactive'
  | 'summary.smtpConfigured'
  | 'summary.smtpMissing'
  | 'summary.questionsOn'
  | 'summary.questionsOff'
  | 'summary.unsaved'
  // Field-value words shared by the status strip and the boolean control.
  | 'value.on'
  | 'value.off'
  | 'value.inherit'
  | 'value.unknown'
  | 'value.configured'
  | 'value.notConfigured'
  // Group titles.
  | 'group.status'
  | 'group.general'
  | 'group.notifications'
  | 'group.humanAttention'
  | 'group.smtp'
  | 'group.credential'
  | 'group.message'
  | 'group.delivery'
  // Human-attention block.
  | 'attention.intro'
  // Field labels.
  | 'field.enabled'
  | 'field.includeSubagents'
  | 'field.notifyQuestions'
  | 'field.notifyApprovals'
  | 'field.notifyCompleted'
  | 'field.notifyErrors'
  | 'field.notifyMaxTokens'
  | 'field.smtpHost'
  | 'field.smtpPort'
  | 'field.smtpSecure'
  | 'field.smtpUser'
  | 'field.from'
  | 'field.to'
  | 'field.credentialRef'
  | 'field.includeMetadata'
  | 'field.includeUserPrompt'
  | 'field.includeFooter'
  | 'field.maxBodyChars'
  | 'field.queueSize'
  | 'field.retryAttempts'
  | 'field.retryBaseDelayMs'
  | 'field.maxDedupeEntries'
  // Field hints.
  | 'hint.enabled'
  | 'hint.includeSubagents'
  | 'hint.notifyQuestions'
  | 'hint.notifyApprovals'
  | 'hint.notifyCompleted'
  | 'hint.notifyErrors'
  | 'hint.notifyMaxTokens'
  | 'hint.smtpHost'
  | 'hint.smtpPort'
  | 'hint.smtpSecure'
  | 'hint.smtpUser'
  | 'hint.from'
  | 'hint.to'
  | 'hint.credentialRef'
  | 'hint.includeMetadata'
  | 'hint.includeUserPrompt'
  | 'hint.includeFooter'
  | 'hint.maxBodyChars'
  | 'hint.queueSize'
  | 'hint.retryAttempts'
  | 'hint.retryBaseDelayMs'
  | 'hint.maxDedupeEntries'
  // Per-control affordances.
  | 'control.reset'
  | 'control.resetTitle'
  | 'control.inherited'
  | 'control.invalid'
  | 'control.boolean'
  // Credential control.
  | 'secret.label'
  | 'secret.placeholder'
  | 'secret.set'
  | 'secret.change'
  | 'secret.clear'
  | 'secret.clearTitle'
  | 'secret.stored'
  | 'secret.absent'
  // Status strip.
  | 'status.pluginLabel'
  | 'status.credentialLabel'
  | 'status.queue'
  | 'status.queueDepth'
  | 'status.effectiveQuestions'
  | 'status.effectiveApprovals'
  | 'status.configError'
  // Action row.
  | 'action.sendTest'
  | 'action.sending'
  | 'action.testSent'
  | 'action.testRefused'
  | 'action.reset'
  | 'action.resetTitle'
  | 'action.discard'
  | 'action.save'
  | 'action.saving'
  // Action notices.
  | 'notice.saved'
  | 'notice.nothingToSave'
  | 'notice.fixInvalid'
  | 'notice.resetStaged'
  | 'notice.passwordRemoved'
  | 'notice.saveRefused'
  | 'notice.testAccepted'
  // Validation refusals.
  | 'validation.boolean'
  | 'validation.wholeNumber'
  | 'validation.outOfRange'
  | 'validation.atLeast'
  | 'validation.atMost'
  | 'validation.badAddress'

/** The dictionary shape both shipped locales must satisfy, key for key. */
export type MailNotifyDictionary = Record<MailNotifyLocaleKey, string>
