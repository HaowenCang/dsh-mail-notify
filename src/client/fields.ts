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
 * The table is also free of *language*. Every user-visible string it used to
 * carry is now a locale key, resolved by the card through the live `t` — a
 * table holding English labels could not follow a language switch, and two
 * tables (one per language) would be two key sets that can drift.
 *
 * The numeric bounds mirror the host schema in `src/config.ts`. They are a
 * preview, not a boundary: the host re-validates every write, and a bound that
 * drifted here would produce a rejected save rather than an accepted bad value.
 *
 * @module dsh-mail-notify/client/fields
 */

import type { LocaleKey } from './locales/index.ts'

/** How one control converts between its stored value and its draft text. */
export type FieldKind = 'boolean' | 'natural' | 'text' | 'addresses'

/** One field of the settings namespace, as the card renders it. */
export interface FieldDef {
  /** Key inside the `dsh-mail-notify` settings section. */
  readonly field: string
  readonly kind: FieldKind
  /** Locale key of the control's label. */
  readonly labelKey: LocaleKey
  /** Locale key of the one line of guidance under the control. */
  readonly hintKey: LocaleKey
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
    labelKey: 'field.enabled',
    hintKey: 'hint.enabled',
  },
  {
    field: 'includeSubagents',
    kind: 'boolean',
    labelKey: 'field.includeSubagents',
    hintKey: 'hint.includeSubagents',
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
    labelKey: 'field.notifyQuestions',
    hintKey: 'hint.notifyQuestions',
    privacy: true,
  },
  {
    field: 'notifyApprovals',
    kind: 'boolean',
    labelKey: 'field.notifyApprovals',
    hintKey: 'hint.notifyApprovals',
    privacy: true,
  },
  {
    field: 'notifyCompleted',
    kind: 'boolean',
    labelKey: 'field.notifyCompleted',
    hintKey: 'hint.notifyCompleted',
  },
  {
    field: 'notifyErrors',
    kind: 'boolean',
    labelKey: 'field.notifyErrors',
    hintKey: 'hint.notifyErrors',
  },
  {
    field: 'notifyMaxTokens',
    kind: 'boolean',
    labelKey: 'field.notifyMaxTokens',
    hintKey: 'hint.notifyMaxTokens',
  },
]

/** SMTP delivery settings. */
export const SMTP_FIELDS: readonly FieldDef[] = [
  { field: 'smtpHost', kind: 'text', labelKey: 'field.smtpHost', hintKey: 'hint.smtpHost' },
  {
    field: 'smtpPort',
    kind: 'natural',
    min: 1,
    max: 65535,
    labelKey: 'field.smtpPort',
    hintKey: 'hint.smtpPort',
  },
  {
    field: 'smtpSecure',
    kind: 'boolean',
    labelKey: 'field.smtpSecure',
    hintKey: 'hint.smtpSecure',
  },
  { field: 'smtpUser', kind: 'text', labelKey: 'field.smtpUser', hintKey: 'hint.smtpUser' },
  {
    field: 'from',
    kind: 'text',
    labelKey: 'field.from',
    hintKey: 'hint.from',
  },
  {
    field: 'to',
    kind: 'addresses',
    labelKey: 'field.to',
    hintKey: 'hint.to',
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
  labelKey: 'field.credentialRef',
  hintKey: 'hint.credentialRef',
}

/** Message composition. */
export const MESSAGE_FIELDS: readonly FieldDef[] = [
  {
    field: 'includeMetadata',
    kind: 'boolean',
    labelKey: 'field.includeMetadata',
    hintKey: 'hint.includeMetadata',
  },
  {
    field: 'includeUserPrompt',
    kind: 'boolean',
    labelKey: 'field.includeUserPrompt',
    hintKey: 'hint.includeUserPrompt',
  },
  {
    field: 'includeFooter',
    kind: 'boolean',
    labelKey: 'field.includeFooter',
    hintKey: 'hint.includeFooter',
  },
  {
    field: 'maxBodyChars',
    kind: 'natural',
    min: 1000,
    max: 1000000,
    labelKey: 'field.maxBodyChars',
    hintKey: 'hint.maxBodyChars',
  },
]

/** Queue and retry. */
export const DELIVERY_FIELDS: readonly FieldDef[] = [
  {
    field: 'queueSize',
    kind: 'natural',
    min: 1,
    max: 10000,
    labelKey: 'field.queueSize',
    hintKey: 'hint.queueSize',
  },
  {
    field: 'retryAttempts',
    kind: 'natural',
    min: 0,
    max: 10,
    labelKey: 'field.retryAttempts',
    hintKey: 'hint.retryAttempts',
  },
  {
    field: 'retryBaseDelayMs',
    kind: 'natural',
    min: 100,
    max: 60000,
    labelKey: 'field.retryBaseDelayMs',
    hintKey: 'hint.retryBaseDelayMs',
  },
  {
    field: 'maxDedupeEntries',
    kind: 'natural',
    min: 10,
    max: 100000,
    labelKey: 'field.maxDedupeEntries',
    hintKey: 'hint.maxDedupeEntries',
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
 * A draft that is not a value this field accepts.
 *
 * The refusal is recorded as a locale key plus its parameters rather than as a
 * finished sentence: the label it names is itself localized, and the control
 * renders the sentence through the live `t`, so a refusal already on screen
 * follows a language switch like every other string.
 */
export interface ParsedInvalid {
  kind: 'invalid'
  reason: ValidationReason
}

/** One refusal, as the copy key that renders it and the values it interpolates. */
export interface ValidationReason {
  readonly key: LocaleKey
  readonly params: Record<string, string | number>
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
 * A refusal is returned as its copy key and parameters; the label it names is
 * supplied by the same locale layer the control's label came from, so the two
 * cannot disagree about which field was refused.
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
      return { kind: 'invalid', reason: { key: 'validation.boolean', params: { label: def.labelKey } } }

    case 'natural': {
      if (!/^\d+$/.test(trimmed)) {
        return { kind: 'invalid', reason: { key: 'validation.wholeNumber', params: { label: def.labelKey } } }
      }
      const value = Number(trimmed)
      if (!Number.isSafeInteger(value)) {
        return { kind: 'invalid', reason: { key: 'validation.outOfRange', params: { label: def.labelKey } } }
      }
      if (def.min !== undefined && value < def.min) {
        return {
          kind: 'invalid',
          reason: { key: 'validation.atLeast', params: { label: def.labelKey, min: def.min } },
        }
      }
      if (def.max !== undefined && value > def.max) {
        return {
          kind: 'invalid',
          reason: { key: 'validation.atMost', params: { label: def.labelKey, max: def.max } },
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
        return {
          kind: 'invalid',
          reason: { key: 'validation.badAddress', params: { addresses: malformed.join(', ') } },
        }
      }
      return { kind: 'value', value: addresses }
    }
  }
}

/**
 * Render one refusal through a translate function.
 *
 * @param t - the live translate function for this namespace.
 * @param reason - the refusal's copy key and parameters.
 * @returns the refusal sentence.
 */
export function composeValidation(t: (key: LocaleKey, params?: Record<string, unknown>) => string, reason: ValidationReason): string {
  const params = reason.params
  // The label parameter is a *key*, resolved here rather than at the parse
  // site: `parseField` runs without a locale, and interpolating the raw key
  // into the sentence would print `field.smtpPort` at the user.
  const resolved: Record<string, unknown> = { ...params }
  const label = resolved.label
  if (typeof label === 'string') resolved.label = t(label as LocaleKey)
  return t(reason.key, resolved)
}
