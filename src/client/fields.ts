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
 * Copy lives in `locales.ts`, not here: each definition carries the *keys* of
 * its label and hint, and the rendered text is resolved against the active DSH
 * locale at render time. The one English string this module still composes is
 * `ParsedInvalid.message`, which is a diagnostic for tests and logs — the card
 * renders the localized {@link ParsedInvalid.validation} reason instead.
 *
 * The numeric bounds mirror the host schema in `src/config.ts`. They are a
 * preview, not a boundary: the host re-validates every write, and a bound that
 * drifted here would produce a rejected save rather than an accepted bad value.
 *
 * @module dsh-mail-notify/client/fields
 */

import type { MailNotifyLocaleKey } from './locales.ts'

/** How one control converts between its stored value and its draft text. */
export type FieldKind = 'boolean' | 'natural' | 'text' | 'addresses'

/** The label-key domain of a field definition. */
type FieldLabelKey = Extract<MailNotifyLocaleKey, `field.${string}.label`>

/** The hint-key domain of a field definition. */
type FieldHintKey = Extract<MailNotifyLocaleKey, `field.${string}.hint`>

/** The localized validation-reason domain. */
export type ValidationKey = Extract<MailNotifyLocaleKey, `validation.${string}`>

/** One field of the settings namespace, as the card renders it. */
export interface FieldDef {
  /** Key inside the `dsh-mail-notify` settings section. */
  readonly field: string
  readonly kind: FieldKind
  /** Locale key of the control label. */
  readonly labelKey: FieldLabelKey
  /** Locale key of the one line of guidance under the control. */
  readonly hintKey: FieldHintKey
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
    labelKey: 'field.enabled.label',
    hintKey: 'field.enabled.hint',
  },
  {
    field: 'includeSubagents',
    kind: 'boolean',
    labelKey: 'field.includeSubagents.label',
    hintKey: 'field.includeSubagents.hint',
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
    labelKey: 'field.notifyQuestions.label',
    hintKey: 'field.notifyQuestions.hint',
    privacy: true,
  },
  {
    field: 'notifyApprovals',
    kind: 'boolean',
    labelKey: 'field.notifyApprovals.label',
    hintKey: 'field.notifyApprovals.hint',
    privacy: true,
  },
  {
    field: 'notifyCompleted',
    kind: 'boolean',
    labelKey: 'field.notifyCompleted.label',
    hintKey: 'field.notifyCompleted.hint',
  },
  {
    field: 'notifyErrors',
    kind: 'boolean',
    labelKey: 'field.notifyErrors.label',
    hintKey: 'field.notifyErrors.hint',
  },
  {
    field: 'notifyMaxTokens',
    kind: 'boolean',
    labelKey: 'field.notifyMaxTokens.label',
    hintKey: 'field.notifyMaxTokens.hint',
  },
]

/** SMTP delivery settings. */
export const SMTP_FIELDS: readonly FieldDef[] = [
  { field: 'smtpHost', kind: 'text', labelKey: 'field.smtpHost.label', hintKey: 'field.smtpHost.hint' },
  {
    field: 'smtpPort',
    kind: 'natural',
    min: 1,
    max: 65535,
    labelKey: 'field.smtpPort.label',
    hintKey: 'field.smtpPort.hint',
  },
  {
    field: 'smtpSecure',
    kind: 'boolean',
    labelKey: 'field.smtpSecure.label',
    hintKey: 'field.smtpSecure.hint',
  },
  { field: 'smtpUser', kind: 'text', labelKey: 'field.smtpUser.label', hintKey: 'field.smtpUser.hint' },
  { field: 'from', kind: 'text', labelKey: 'field.from.label', hintKey: 'field.from.hint' },
  { field: 'to', kind: 'addresses', labelKey: 'field.to.label', hintKey: 'field.to.hint' },
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
  labelKey: 'field.smtpPasswordCredential.label',
  hintKey: 'field.smtpPasswordCredential.hint',
}

/** Message composition. */
export const MESSAGE_FIELDS: readonly FieldDef[] = [
  {
    field: 'includeMetadata',
    kind: 'boolean',
    labelKey: 'field.includeMetadata.label',
    hintKey: 'field.includeMetadata.hint',
  },
  {
    field: 'includeUserPrompt',
    kind: 'boolean',
    labelKey: 'field.includeUserPrompt.label',
    hintKey: 'field.includeUserPrompt.hint',
  },
  {
    field: 'includeFooter',
    kind: 'boolean',
    labelKey: 'field.includeFooter.label',
    hintKey: 'field.includeFooter.hint',
  },
  {
    field: 'maxBodyChars',
    kind: 'natural',
    min: 1000,
    max: 1000000,
    labelKey: 'field.maxBodyChars.label',
    hintKey: 'field.maxBodyChars.hint',
  },
]

/** Queue and retry. */
export const DELIVERY_FIELDS: readonly FieldDef[] = [
  {
    field: 'queueSize',
    kind: 'natural',
    min: 1,
    max: 10000,
    labelKey: 'field.queueSize.label',
    hintKey: 'field.queueSize.hint',
  },
  {
    field: 'retryAttempts',
    kind: 'natural',
    min: 0,
    max: 10,
    labelKey: 'field.retryAttempts.label',
    hintKey: 'field.retryAttempts.hint',
  },
  {
    field: 'retryBaseDelayMs',
    kind: 'natural',
    min: 100,
    max: 60000,
    labelKey: 'field.retryBaseDelayMs.label',
    hintKey: 'field.retryBaseDelayMs.hint',
  },
  {
    field: 'maxDedupeEntries',
    kind: 'natural',
    min: 10,
    max: 100000,
    labelKey: 'field.maxDedupeEntries.label',
    hintKey: 'field.maxDedupeEntries.hint',
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

/** A draft that is not a value this field accepts. */
export interface ParsedInvalid {
  kind: 'invalid'
  /** English diagnostic for tests and logs; the card renders `validation`. */
  message: string
  /** The locale key of the reason, resolved at render time. */
  validation: ValidationKey
  /** Template parameters for the reason (`min`, `max`, `list`). */
  params?: Record<string, unknown>
}

/** The outcome of reading one draft. */
export type ParsedField = ParsedValue | ParsedClear | ParsedInvalid

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
      return { kind: 'invalid', message: `${def.field} must be true or false`, validation: 'validation.boolean' }

    case 'natural': {
      if (!/^\d+$/.test(trimmed)) {
        return { kind: 'invalid', message: `${def.field} must be a whole number`, validation: 'validation.integer' }
      }
      const value = Number(trimmed)
      if (!Number.isSafeInteger(value)) {
        return { kind: 'invalid', message: `${def.field} is out of range`, validation: 'validation.range' }
      }
      if (def.min !== undefined && value < def.min) {
        return {
          kind: 'invalid',
          message: `${def.field} must be at least ${String(def.min)}`,
          validation: 'validation.min',
          params: { min: def.min },
        }
      }
      if (def.max !== undefined && value > def.max) {
        return {
          kind: 'invalid',
          message: `${def.field} must be at most ${String(def.max)}`,
          validation: 'validation.max',
          params: { max: def.max },
        }
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
        const list = malformed.join(', ')
        return {
          kind: 'invalid',
          message: `not a plausible email address: ${list}`,
          validation: 'validation.address',
          params: { list },
        }
      }
      return { kind: 'value', value: addresses }
    }
  }
}
