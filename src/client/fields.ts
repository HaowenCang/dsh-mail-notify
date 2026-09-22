/**
 * The card's field table, and the pure conversions between stored values and
 * the draft text a control renders.
 *
 * Kept free of React, of the wire, and of the settings transport: a control
 * shows `format(value)` and stages `parse(text)`, and both directions are
 * decidable without a browser. That is what lets the whole form be tested
 * against the same table the card renders from, rather than against a second
 * copy of the rules embedded in a component.
 *
 * Labels and hints are locale keys, not text: the card resolves them at render
 * time through the DSH translate seat, so the same table serves both shipped
 * languages without a branch. A refusal carries both its semantic identity
 * ({@link FieldIssue}, translated at render) and its English rendering
 * (`message`, for callers outside the render path) — never a pre-translated
 * string alone, which would freeze the language at edit time.
 *
 * The numeric bounds mirror the host schema in `src/config.ts`. They are a
 * preview, not a boundary: the host re-validates every write, and a bound that
 * drifted here would produce a rejected save rather than an accepted bad value.
 *
 * @module dsh-mail-notify/client/fields
 */

import { en, formatMailText, type MailNotifyLocaleKey } from './locale.ts'

/** How one control converts between its stored value and its draft text. */
export type FieldKind = 'boolean' | 'natural' | 'text' | 'addresses'

/** One field of the settings namespace, as the card renders it. */
export interface FieldDef {
  /** Key inside the `dsh-mail-notify` settings section. */
  readonly field: string
  readonly kind: FieldKind
  /** Locale key of the control label. */
  readonly labelKey: MailNotifyLocaleKey
  /** Locale key of the one line of guidance under the control. */
  readonly hintKey: MailNotifyLocaleKey
  /**
   * Template params for the hint whose values are other locale keys, resolved
   * through the same translate seat at render time.
   */
  readonly hintTerms?: Readonly<Record<string, MailNotifyLocaleKey>>
  /** Inclusive numeric bounds; `natural` only. */
  readonly min?: number
  readonly max?: number
  /**
   * Whether the field's value is a decision about privacy rather than about
   * delivery.
   *
   * The card renders these together and above the rest: both are off by
   * default because turning one on sends content the operator did not author —
   * a question's text, or a tool name and its asker's reason — to a third-party
   * mail system.
   */
  readonly privacy?: boolean
}

/** General behaviour. */
export const GENERAL_FIELDS: readonly FieldDef[] = [
  {
    field: 'enabled',
    kind: 'boolean',
    labelKey: 'labelEnable',
    hintKey: 'hintEnable',
  },
  {
    field: 'includeSubagents',
    kind: 'boolean',
    labelKey: 'labelIncludeSubagents',
    hintKey: 'hintIncludeSubagents',
  },
]

/**
 * Notification switches.
 *
 * The two human-attention switches lead the list and are rendered as the
 * card's prominent block: they are the switches that decide whether the
 * operator learns that an agent is blocked and waiting for a person.
 */
export const NOTIFICATION_FIELDS: readonly FieldDef[] = [
  {
    field: 'notifyQuestions',
    kind: 'boolean',
    labelKey: 'labelQuestions',
    hintKey: 'hintQuestions',
    privacy: true,
  },
  {
    field: 'notifyApprovals',
    kind: 'boolean',
    labelKey: 'labelApprovals',
    hintKey: 'hintApprovals',
    privacy: true,
  },
  {
    field: 'notifyCompleted',
    kind: 'boolean',
    labelKey: 'labelCompleted',
    hintKey: 'hintCompleted',
  },
  {
    field: 'notifyErrors',
    kind: 'boolean',
    labelKey: 'labelErrors',
    hintKey: 'hintErrors',
  },
  {
    field: 'notifyMaxTokens',
    kind: 'boolean',
    labelKey: 'labelMaxTokens',
    hintKey: 'hintMaxTokens',
  },
]

/** SMTP delivery settings. */
export const SMTP_FIELDS: readonly FieldDef[] = [
  { field: 'smtpHost', kind: 'text', labelKey: 'labelSmtpHost', hintKey: 'hintSmtpHost' },
  {
    field: 'smtpPort',
    kind: 'natural',
    min: 1,
    max: 65535,
    labelKey: 'labelSmtpPort',
    hintKey: 'hintSmtpPort',
  },
  {
    field: 'smtpSecure',
    kind: 'boolean',
    labelKey: 'labelSecure',
    hintKey: 'hintSecure',
    hintTerms: { implicit: 'termImplicitTls', starttls: 'termStartTls' },
  },
  { field: 'smtpUser', kind: 'text', labelKey: 'labelSmtpUser', hintKey: 'hintSmtpUser' },
  {
    field: 'from',
    kind: 'text',
    labelKey: 'labelFrom',
    hintKey: 'hintFrom',
  },
  {
    field: 'to',
    kind: 'addresses',
    labelKey: 'labelRecipients',
    hintKey: 'hintRecipients',
  },
]

/**
 * The credential reference control.
 *
 * Deliberately separated from {@link SMTP_FIELDS}: this field is a *name*, and
 * the password it names is written through the credentials domain and never
 * rides a settings response. Keeping the two apart in the table is what keeps
 * that distinction visible at the render site.
 */
export const CREDENTIAL_REF_FIELD: FieldDef = {
  field: 'smtpPasswordCredential',
  kind: 'text',
  labelKey: 'labelCredentialRef',
  hintKey: 'hintCredentialRef',
}

/** Message composition. */
export const MESSAGE_FIELDS: readonly FieldDef[] = [
  {
    field: 'includeMetadata',
    kind: 'boolean',
    labelKey: 'labelIncludeMetadata',
    hintKey: 'hintIncludeMetadata',
  },
  {
    field: 'includeUserPrompt',
    kind: 'boolean',
    labelKey: 'labelIncludeUserPrompt',
    hintKey: 'hintIncludeUserPrompt',
  },
  {
    field: 'includeFooter',
    kind: 'boolean',
    labelKey: 'labelIncludeFooter',
    hintKey: 'hintIncludeFooter',
  },
  {
    field: 'maxBodyChars',
    kind: 'natural',
    min: 1000,
    max: 1000000,
    labelKey: 'labelMaxBody',
    hintKey: 'hintMaxBody',
  },
]

/** Queue and retry. */
export const DELIVERY_FIELDS: readonly FieldDef[] = [
  {
    field: 'queueSize',
    kind: 'natural',
    min: 1,
    max: 10000,
    labelKey: 'labelQueueSize',
    hintKey: 'hintQueueSize',
  },
  {
    field: 'retryAttempts',
    kind: 'natural',
    min: 0,
    max: 10,
    labelKey: 'labelRetryAttempts',
    hintKey: 'hintRetryAttempts',
  },
  {
    field: 'retryBaseDelayMs',
    kind: 'natural',
    min: 100,
    max: 60000,
    labelKey: 'labelRetryBaseDelay',
    hintKey: 'hintRetryBaseDelay',
  },
  {
    field: 'maxDedupeEntries',
    kind: 'natural',
    min: 10,
    max: 100000,
    labelKey: 'labelDedupe',
    hintKey: 'hintDedupe',
  },
]

/** Every field the namespace owns, in render order. */
export const ALL_FIELDS: readonly FieldDef[] = [
  ...GENERAL_FIELDS,
  ...NOTIFICATION_FIELDS,
  ...SMTP_FIELDS,
  CREDENTIAL_REF_FIELD,
  ...MESSAGE_FIELDS,
  ...DELIVERY_FIELDS,
]

/** A draft that is a value this field accepts. */
export interface ParsedValue {
  kind: 'value'
  value: unknown
}

/** A draft that is empty, and therefore stages a clear rather than a write. */
export interface ParsedClear {
  kind: 'clear'
}

/**
 * Why a draft is refused, as semantic identity.
 *
 * Rendered through the translate seat as `t(issue.key, { field, ...params })`;
 * the `field` param is supplied at render so the label follows the active
 * language too.
 */
export interface FieldIssue {
  readonly key: MailNotifyLocaleKey
  readonly params: Readonly<Record<string, unknown>>
}

/** A draft that is not a value this field accepts. */
export interface ParsedInvalid {
  kind: 'invalid'
  /** English rendering, for callers outside the localized render path. */
  message: string
  /** Semantic identity, translated at render time. */
  issue: FieldIssue
}

/** The outcome of reading one draft. */
export type ParsedField = ParsedValue | ParsedClear | ParsedInvalid

/**
 * Build one refusal: its English rendering and its semantic identity.
 *
 * @param def - the refused field.
 * @param key - the refusal's locale key.
 * @param params - template values beyond the field label.
 * @returns the refusal.
 */
function invalid(def: FieldDef, key: MailNotifyLocaleKey, params: Readonly<Record<string, unknown>> = {}): ParsedInvalid {
  return {
    kind: 'invalid',
    message: formatMailText(en[key], { field: en[def.labelKey], ...params }),
    issue: { key, params },
  }
}

/** Key used by the credential reference when no section value is present. */
const DEFAULT_CREDENTIAL_REF = 'DSH_MAIL_SMTP_PASSWORD'

/**
 * Read the credential reference the section names, or the well-known default.
 *
 * The default is the same name the bundle's own documentation uses, so a card
 * with an empty section shows the reference a send would actually resolve
 * rather than a blank control that hides it.
 *
 * @param value - the section's stored value for the field.
 * @returns the reference name in effect.
 */
export function credentialRefFrom(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_CREDENTIAL_REF
}

/**
 * Render a stored value as the control's draft text.
 *
 * An absent value renders as the empty string for every kind: the control then
 * reads as "inherit", which is exactly what the field will do until it is
 * written.
 *
 * @param def - the field definition.
 * @param value - the stored value, which may be `undefined`.
 * @returns the draft text.
 */
export function formatField(def: FieldDef, value: unknown): string {
  if (value === undefined || value === null) return ''
  switch (def.kind) {
    case 'boolean':
      return value === true ? 'true' : 'false'
    case 'natural':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
    case 'text':
      return typeof value === 'string' ? value : ''
    case 'addresses':
      return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string').join(', ') : ''
  }
}

/**
 * Read a draft as the write it stages.
 *
 * An empty draft is a *clear*, not an empty value: clearing a control and
 * saving is the same gesture as resetting the field, and the host removes the
 * user-layer entry so the field re-inherits the composition layer.
 *
 * @param def - the field definition.
 * @param text - the control's draft text.
 * @returns the staged write, a clear, or the reason the draft is refused.
 */
export function parseField(def: FieldDef, text: string): ParsedField {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'clear' }

  switch (def.kind) {
    case 'boolean':
      if (trimmed === 'true') return { kind: 'value', value: true }
      if (trimmed === 'false') return { kind: 'value', value: false }
      return invalid(def, 'invalidTrueFalse')

    case 'natural': {
      if (!/^\d+$/.test(trimmed)) {
        return invalid(def, 'invalidWholeNumber')
      }
      const value = Number(trimmed)
      if (!Number.isSafeInteger(value)) {
        return invalid(def, 'invalidNumberRange')
      }
      if (def.min !== undefined && value < def.min) {
        return invalid(def, 'invalidMin', { min: def.min })
      }
      if (def.max !== undefined && value > def.max) {
        return invalid(def, 'invalidMax', { max: def.max })
      }
      return { kind: 'value', value }
    }

    case 'text':
      return { kind: 'value', value: trimmed }

    case 'addresses': {
      const addresses = trimmed
        .split(/[,;\r\n]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
      if (addresses.length === 0) return { kind: 'clear' }
      const malformed = addresses.filter((entry) => !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(entry))
      if (malformed.length > 0) {
        return invalid(def, 'invalidAddress', { entries: malformed.join(', ') })
      }
      return { kind: 'value', value: addresses }
    }
  }
}
