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
 * The numeric bounds mirror the host schema in `src/config.ts`. They are a
 * preview, not a boundary: the host re-validates every write, and a bound that
 * drifted here would produce a rejected save rather than an accepted bad value.
 *
 * @module dsh-mail-notify/client/fields
 */

/** How one control converts between its stored value and its draft text. */
export type FieldKind = 'boolean' | 'natural' | 'text' | 'addresses'

/** One field of the settings namespace, as the card renders it. */
export interface FieldDef {
  /** Key inside the `dsh-mail-notify` settings section. */
  readonly field: string
  readonly kind: FieldKind
  /** Control label. */
  readonly label: string
  /** One line of guidance under the control. */
  readonly hint: string
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
    label: 'Plugin enabled',
    hint: 'While off, the plugin registers no listener and reads no credential.',
  },
  {
    field: 'includeSubagents',
    kind: 'boolean',
    label: 'Include subagent turns',
    hint: 'Whether delegated subagent turns are notified as well as top-level turns.',
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
    label: 'Notify when the agent asks a question',
    hint: 'Sends the question text and its options. Off by default; the text may quote your task.',
    privacy: true,
  },
  {
    field: 'notifyApprovals',
    kind: 'boolean',
    label: 'Notify when the agent needs an approval',
    hint: 'Sends the tool name and the asker’s reason, never the tool’s arguments. Off by default.',
    privacy: true,
  },
  {
    field: 'notifyCompleted',
    kind: 'boolean',
    label: 'Notify on completed turns',
    hint: 'A top-level turn that finished normally.',
  },
  {
    field: 'notifyErrors',
    kind: 'boolean',
    label: 'Notify on failed turns',
    hint: 'A turn that ended with a terminal error, including one that produced no visible output.',
  },
  {
    field: 'notifyMaxTokens',
    kind: 'boolean',
    label: 'Notify on truncated turns',
    hint: 'A turn that stopped because it reached the token limit.',
  },
]

/** SMTP delivery settings. */
export const SMTP_FIELDS: readonly FieldDef[] = [
  { field: 'smtpHost', kind: 'text', label: 'SMTP host', hint: 'Host name of the SMTP server.' },
  {
    field: 'smtpPort',
    kind: 'natural',
    min: 1,
    max: 65535,
    label: 'SMTP port',
    hint: '587 for STARTTLS, 465 for implicit TLS.',
  },
  {
    field: 'smtpSecure',
    kind: 'boolean',
    label: 'Implicit TLS',
    hint: 'On selects implicit TLS (normally port 465); off allows a STARTTLS upgrade (normally 587).',
  },
  { field: 'smtpUser', kind: 'text', label: 'SMTP user', hint: 'Authentication user name.' },
  {
    field: 'from',
    kind: 'text',
    label: 'From address',
    hint: 'Envelope sender. Some servers require this to match the authenticated account.',
  },
  {
    field: 'to',
    kind: 'addresses',
    label: 'Recipients',
    hint: 'One or more addresses, separated by commas or new lines.',
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
  label: 'Credential reference',
  hint: 'Name of the credential the password is read from. A name, never the password itself.',
}

/** Message composition. */
export const MESSAGE_FIELDS: readonly FieldDef[] = [
  {
    field: 'includeMetadata',
    kind: 'boolean',
    label: 'Include the metadata block',
    hint: 'Session, workspace, model, and timing.',
  },
  {
    field: 'includeUserPrompt',
    kind: 'boolean',
    label: 'Include the last user message',
    hint: 'Off by default: the prompt may carry content you did not intend to mail.',
  },
  {
    field: 'includeFooter',
    kind: 'boolean',
    label: 'Include the footer',
    hint: 'The generator footer and the truncation marker.',
  },
  {
    field: 'maxBodyChars',
    kind: 'natural',
    min: 1000,
    max: 1000000,
    label: 'Body length cap',
    hint: 'Maximum visible-text length, counted in code points.',
  },
]

/** Queue and retry. */
export const DELIVERY_FIELDS: readonly FieldDef[] = [
  {
    field: 'queueSize',
    kind: 'natural',
    min: 1,
    max: 10000,
    label: 'Queue size',
    hint: 'Waiting-job cap; the worker holds one more.',
  },
  {
    field: 'retryAttempts',
    kind: 'natural',
    min: 0,
    max: 10,
    label: 'Retry attempts',
    hint: 'Total attempts are one plus this.',
  },
  {
    field: 'retryBaseDelayMs',
    kind: 'natural',
    min: 100,
    max: 60000,
    label: 'Retry base delay (ms)',
    hint: 'Retry n waits base × 3^(n−1), capped at 30 s.',
  },
  {
    field: 'maxDedupeEntries',
    kind: 'natural',
    min: 10,
    max: 100000,
    label: 'Dedupe cache size',
    hint: 'How many recently notified events are remembered.',
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
  message: string
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
      return { kind: 'invalid', message: `${def.label} must be true or false` }

    case 'natural': {
      if (!/^\d+$/.test(trimmed)) {
        return { kind: 'invalid', message: `${def.label} must be a whole number` }
      }
      const value = Number(trimmed)
      if (!Number.isSafeInteger(value)) {
        return { kind: 'invalid', message: `${def.label} is out of range` }
      }
      if (def.min !== undefined && value < def.min) {
        return { kind: 'invalid', message: `${def.label} must be at least ${String(def.min)}` }
      }
      if (def.max !== undefined && value > def.max) {
        return { kind: 'invalid', message: `${def.label} must be at most ${String(def.max)}` }
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
        return { kind: 'invalid', message: `not a plausible email address: ${malformed.join(', ')}` }
      }
      return { kind: 'value', value: addresses }
    }
  }
}
