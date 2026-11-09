/**
 * The settings page's field table, and the pure conversions between stored
 * values and the draft text a control renders.
 *
 * Kept free of React, of the wire, and of the settings transport: a control
 * shows `format(value)` and stages `parse(text)`, and both directions are
 * decidable without a browser. That is what lets the whole form be tested
 * against the same table the page renders from, rather than against a second
 * copy of the rules embedded in a component.
 *
 * ## How the table is grouped
 *
 * The groups follow the questions a person setting the plugin up actually asks,
 * in the order they ask them — "is it on?", "when will I get mail?", "how is it
 * sent?", "what does the mail contain?", "when should it stay quiet?" — and
 * everything a first-time user never needs to touch sits in one Advanced group
 * the page keeps collapsed. The order of {@link ALL_FIELDS} is the render order.
 *
 * Labels, hints, placeholders, and units are locale keys, not text: the page
 * resolves them at render time through the DSH translate seat, so the same
 * table serves both shipped languages without a branch. A refusal carries both
 * its semantic identity ({@link FieldIssue}, translated at render) and its
 * English rendering (`message`, for callers outside the render path) — never a
 * pre-translated string alone, which would freeze the language at edit time.
 *
 * The numeric bounds and the `fallback` defaults mirror the host schema in
 * `src/config.ts` (`tests/client/fields.test.ts` pins the parity). They are a
 * preview, not a boundary: the host re-validates every write, and a bound that
 * drifted here would produce a rejected save rather than an accepted bad value.
 *
 * @module dsh-mail-notify/client/fields
 */

import { en, formatMailText, type MailNotifyLocaleKey } from './locale.ts'

/** How one control converts between its stored value and its draft text. */
export type FieldKind = 'boolean' | 'natural' | 'text' | 'addresses' | 'lines'

/** One labelled choice of a two-valued field rendered as a select. */
export interface FieldChoice {
  /** The draft text the choice stages (`'true'` / `'false'`). */
  readonly value: 'true' | 'false'
  readonly labelKey: MailNotifyLocaleKey
}

/** One field of the settings namespace, as the page renders it. */
export interface FieldDef {
  /** Key inside the `dsh-mail-notify` settings section. */
  readonly field: string
  readonly kind: FieldKind
  /** Locale key of the control label. */
  readonly labelKey: MailNotifyLocaleKey
  /** Locale key of the guidance under the label. */
  readonly hintKey: MailNotifyLocaleKey
  /** Locale key of an example shown inside an empty control. */
  readonly placeholderKey?: MailNotifyLocaleKey
  /** Locale key of the unit rendered after a numeric control. */
  readonly unitKey?: MailNotifyLocaleKey
  /**
   * Named choices for a boolean whose two values are not "on" and "off" — the
   * encryption mode, say. A boolean without choices renders as a switch.
   */
  readonly choices?: readonly [FieldChoice, FieldChoice]
  /** Inclusive numeric bounds; `natural` only. */
  readonly min?: number
  readonly max?: number
  /**
   * The schema default — what the field resolves to when neither the user nor
   * the deployment's composition layer sets it. Shown as the value a "Restore
   * default" goes back to whenever the composition layer is silent.
   */
  readonly fallback: unknown
  /**
   * Whether the Host refuses a configuration without this field while the
   * plugin is enabled (`config-check.ts`). The page marks these fields and
   * refuses to submit a save that would leave one empty — the Host would refuse
   * it anyway, only later and in English.
   */
  readonly required?: boolean
  /**
   * Whether the field's value is a decision about privacy rather than about
   * delivery.
   *
   * Both such switches are off by default because turning one on sends content
   * the operator did not author — a question's text, or a tool name and its
   * asker's reason — to a third-party mail system. The page renders a note about
   * that next to them.
   */
  readonly privacy?: boolean
}

/** The master switch, rendered on its own at the top of the page. */
export const ENABLED_FIELD: FieldDef = {
  field: 'enabled',
  kind: 'boolean',
  labelKey: 'labelEnable',
  hintKey: 'hintEnable',
  fallback: true,
}

/**
 * Which events send an email.
 *
 * The three settled-turn outcomes come first, in the order a turn can end; the
 * two human-attention switches follow as a pair, so the privacy note the page
 * renders under them sits next to exactly the two switches it is about.
 */
export const EVENT_FIELDS: readonly FieldDef[] = [
  {
    field: 'notifyCompleted',
    kind: 'boolean',
    labelKey: 'labelCompleted',
    hintKey: 'hintCompleted',
    fallback: true,
  },
  {
    field: 'notifyErrors',
    kind: 'boolean',
    labelKey: 'labelErrors',
    hintKey: 'hintErrors',
    fallback: false,
  },
  {
    field: 'notifyMaxTokens',
    kind: 'boolean',
    labelKey: 'labelMaxTokens',
    hintKey: 'hintMaxTokens',
    fallback: true,
  },
  {
    field: 'notifyQuestions',
    kind: 'boolean',
    labelKey: 'labelQuestions',
    hintKey: 'hintQuestions',
    fallback: false,
    privacy: true,
  },
  {
    field: 'notifyApprovals',
    kind: 'boolean',
    labelKey: 'labelApprovals',
    hintKey: 'hintApprovals',
    fallback: false,
    privacy: true,
  },
  {
    field: 'includeSubagents',
    kind: 'boolean',
    labelKey: 'labelIncludeSubagents',
    hintKey: 'hintIncludeSubagents',
    fallback: false,
  },
]

/**
 * The sending account.
 *
 * The password is not here: it is a credential, written through its own
 * write-only control, which the page renders between the user name and the
 * sender address because that is where a person filling in an account expects
 * it.
 */
export const SMTP_FIELDS: readonly FieldDef[] = [
  {
    field: 'smtpHost',
    kind: 'text',
    labelKey: 'labelSmtpHost',
    hintKey: 'hintSmtpHost',
    placeholderKey: 'placeholderSmtpHost',
    fallback: '',
    required: true,
  },
  {
    field: 'smtpPort',
    kind: 'natural',
    min: 1,
    max: 65535,
    labelKey: 'labelSmtpPort',
    hintKey: 'hintSmtpPort',
    fallback: 587,
  },
  {
    field: 'smtpSecure',
    kind: 'boolean',
    labelKey: 'labelSecure',
    hintKey: 'hintSecure',
    choices: [
      { value: 'true', labelKey: 'optionSecureTls' },
      { value: 'false', labelKey: 'optionSecureStartTls' },
    ],
    fallback: false,
  },
  {
    field: 'smtpUser',
    kind: 'text',
    labelKey: 'labelSmtpUser',
    hintKey: 'hintSmtpUser',
    placeholderKey: 'placeholderAddress',
    fallback: '',
    required: true,
  },
  {
    field: 'from',
    kind: 'text',
    labelKey: 'labelFrom',
    hintKey: 'hintFrom',
    placeholderKey: 'placeholderAddress',
    fallback: '',
    required: true,
  },
  {
    field: 'to',
    kind: 'addresses',
    labelKey: 'labelRecipients',
    hintKey: 'hintRecipients',
    placeholderKey: 'placeholderRecipients',
    fallback: [],
    required: true,
  },
]

/** What the email contains. */
export const MESSAGE_FIELDS: readonly FieldDef[] = [
  {
    field: 'includeMetadata',
    kind: 'boolean',
    labelKey: 'labelIncludeMetadata',
    hintKey: 'hintIncludeMetadata',
    fallback: true,
  },
  {
    field: 'includeUserPrompt',
    kind: 'boolean',
    labelKey: 'labelIncludeUserPrompt',
    hintKey: 'hintIncludeUserPrompt',
    fallback: false,
  },
  {
    field: 'includeFooter',
    kind: 'boolean',
    labelKey: 'labelIncludeFooter',
    hintKey: 'hintIncludeFooter',
    fallback: true,
  },
]

/** When the plugin stays quiet. */
export const QUIET_FIELDS: readonly FieldDef[] = [
  {
    field: 'minTurnDurationMs',
    kind: 'natural',
    min: 0,
    max: 3_600_000,
    labelKey: 'labelMinTurnDuration',
    hintKey: 'hintMinTurnDuration',
    unitKey: 'unitMs',
    fallback: 0,
  },
  {
    field: 'mutedWorkspaces',
    kind: 'lines',
    labelKey: 'labelMutedWorkspaces',
    hintKey: 'hintMutedWorkspaces',
    placeholderKey: 'placeholderMutedWorkspaces',
    fallback: [],
  },
  {
    field: 'mutedSessions',
    kind: 'lines',
    labelKey: 'labelMutedSessions',
    hintKey: 'hintMutedSessions',
    placeholderKey: 'placeholderMutedSessions',
    fallback: [],
  },
]

/**
 * The credential reference control.
 *
 * Deliberately separate from {@link SMTP_FIELDS}: this field is a *name*, and
 * the password it names is written through the credentials domain and never
 * rides a settings response. Almost nobody needs to change it, which is why the
 * page renders it under Advanced.
 */
export const CREDENTIAL_REF_FIELD: FieldDef = {
  field: 'smtpPasswordCredential',
  kind: 'text',
  labelKey: 'labelCredentialRef',
  hintKey: 'hintCredentialRef',
  fallback: 'DSH_MAIL_SMTP_PASSWORD',
}

/** Tuning a first-time user never needs; rendered collapsed. */
export const ADVANCED_FIELDS: readonly FieldDef[] = [
  CREDENTIAL_REF_FIELD,
  {
    field: 'maxBodyChars',
    kind: 'natural',
    min: 1000,
    max: 1000000,
    labelKey: 'labelMaxBody',
    hintKey: 'hintMaxBody',
    unitKey: 'unitChars',
    fallback: 100_000,
  },
  {
    field: 'queueSize',
    kind: 'natural',
    min: 1,
    max: 10000,
    labelKey: 'labelQueueSize',
    hintKey: 'hintQueueSize',
    fallback: 100,
  },
  {
    field: 'retryAttempts',
    kind: 'natural',
    min: 0,
    max: 10,
    labelKey: 'labelRetryAttempts',
    hintKey: 'hintRetryAttempts',
    fallback: 3,
  },
  {
    field: 'retryBaseDelayMs',
    kind: 'natural',
    min: 100,
    max: 60000,
    labelKey: 'labelRetryBaseDelay',
    hintKey: 'hintRetryBaseDelay',
    unitKey: 'unitMs',
    fallback: 1000,
  },
  {
    field: 'maxDedupeEntries',
    kind: 'natural',
    min: 10,
    max: 100000,
    labelKey: 'labelDedupe',
    hintKey: 'hintDedupe',
    fallback: 1000,
  },
]

/** Every field the namespace owns, in render order. */
export const ALL_FIELDS: readonly FieldDef[] = [
  ENABLED_FIELD,
  ...EVENT_FIELDS,
  ...SMTP_FIELDS,
  ...MESSAGE_FIELDS,
  ...QUIET_FIELDS,
  ...ADVANCED_FIELDS,
]

/** The settled-turn and human-attention switches, in the order the status line lists them. */
export const EVENT_SWITCHES: readonly FieldDef[] = EVENT_FIELDS.filter((def) => def.field.startsWith('notify'))

/**
 * Look one field up by name.
 *
 * @param field - the field name.
 * @returns its definition, or `undefined` for a name the namespace does not own.
 */
export function fieldDef(field: string): FieldDef | undefined {
  return ALL_FIELDS.find((entry) => entry.field === field)
}

/**
 * How a person obtains the password a provider wants for SMTP.
 *
 * Every provider listed here refuses the ordinary login password over SMTP:
 * the Chinese providers issue an "authorization code" (授权码), Gmail an "app
 * password", Tencent Exmail a "client password" when secure login is on. The
 * steps are written against what the provider's own help pages name, and they
 * name the setting rather than a full menu path wherever the provider has been
 * moving its menus, so a redesign leaves them true.
 */
export interface SmtpPresetGuide {
  /** Title of the guide, rendered with `{ name }`. */
  readonly titleKey: MailNotifyLocaleKey
  /** The steps in order, each rendered with `{ name }`. */
  readonly stepKeys: readonly MailNotifyLocaleKey[]
  /** A caveat shown under the steps, if the provider has one worth knowing. */
  readonly noteKey?: MailNotifyLocaleKey
  /** Where the first step starts. Opened in a new tab. */
  readonly url: string
  /** Label of the link to {@link url}, rendered with `{ name }`. */
  readonly linkKey: MailNotifyLocaleKey
}

/**
 * A common mail provider's SMTP endpoint, for the page's quick-fill control.
 *
 * Every entry is the provider's published SSL/TLS endpoint on port 465. The
 * quick fill only stages drafts — nothing is written until Save — so a provider
 * that changes its endpoint costs the user an edit, not a broken save.
 */
export interface SmtpPreset {
  readonly id: string
  readonly labelKey: MailNotifyLocaleKey
  readonly host: string
  readonly port: number
  readonly secure: boolean
  /**
   * Address domains this provider serves, lower case. A username at one of
   * them identifies the provider. Empty for a provider that hosts other
   * people's domains (Exmail), which no address can identify.
   */
  readonly domains: readonly string[]
  /** How to get the SMTP password from this provider. */
  readonly guide: SmtpPresetGuide
}

/** Steps shared by NetEase's 163 and 126 mailboxes, which have the same settings page. */
const NETEASE_STEPS: readonly MailNotifyLocaleKey[] = ['guideNetease1', 'guideNetease2', 'guideNetease3', 'guideNetease4']

/** The quick-fill presets, in the order the control lists them. */
export const SMTP_PRESETS: readonly SmtpPreset[] = [
  {
    id: 'qq',
    labelKey: 'presetQq',
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    domains: ['qq.com', 'foxmail.com'],
    guide: {
      titleKey: 'guideTitleCode',
      stepKeys: ['guideQq1', 'guideQq2', 'guideQq3', 'guideQq4'],
      noteKey: 'guideQqNote',
      url: 'https://mail.qq.com/',
      linkKey: 'guideOpenWebmail',
    },
  },
  {
    id: '163',
    labelKey: 'preset163',
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    domains: ['163.com'],
    guide: {
      titleKey: 'guideTitleCode',
      stepKeys: NETEASE_STEPS,
      noteKey: 'guideNeteaseNote',
      url: 'https://mail.163.com/',
      linkKey: 'guideOpenWebmail',
    },
  },
  {
    id: '126',
    labelKey: 'preset126',
    host: 'smtp.126.com',
    port: 465,
    secure: true,
    domains: ['126.com'],
    guide: {
      titleKey: 'guideTitleCode',
      stepKeys: NETEASE_STEPS,
      noteKey: 'guideNeteaseNote',
      url: 'https://mail.126.com/',
      linkKey: 'guideOpenWebmail',
    },
  },
  {
    id: 'exmail',
    labelKey: 'presetExmail',
    host: 'smtp.exmail.qq.com',
    port: 465,
    secure: true,
    domains: [],
    guide: {
      titleKey: 'guideTitleExmail',
      stepKeys: ['guideExmail1', 'guideExmail2', 'guideExmail3'],
      url: 'https://exmail.qq.com/',
      linkKey: 'guideOpenWebmail',
    },
  },
  {
    id: 'gmail',
    labelKey: 'presetGmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    domains: ['gmail.com', 'googlemail.com'],
    guide: {
      titleKey: 'guideTitleGoogle',
      stepKeys: ['guideGmail1', 'guideGmail2', 'guideGmail3'],
      noteKey: 'guideGmailNote',
      url: 'https://myaccount.google.com/apppasswords',
      linkKey: 'guideOpenAppPasswords',
    },
  },
]

/** The guide for a server no preset matches: what every provider has in common. */
export const GENERIC_GUIDE: Omit<SmtpPresetGuide, 'url' | 'linkKey'> = {
  titleKey: 'guideTitleGeneric',
  stepKeys: ['guideGeneric1', 'guideGeneric2', 'guideGeneric3', 'guideGeneric4'],
  noteKey: 'guideGenericNote',
}

/**
 * The preset whose server this is, compared without case or surrounding space.
 *
 * @param host - a server name, staged or saved.
 * @returns the matching preset, if any.
 */
export function presetForHost(host: unknown): SmtpPreset | undefined {
  if (typeof host !== 'string') return undefined
  const wanted = host.trim().toLowerCase()
  if (wanted === '') return undefined
  return SMTP_PRESETS.find((preset) => preset.host === wanted)
}

/**
 * The preset whose mailboxes this address belongs to, by its domain.
 *
 * @param address - an email address, typically the SMTP username.
 * @returns the matching preset, if the domain is one a preset serves.
 */
export function presetForAddress(address: unknown): SmtpPreset | undefined {
  if (typeof address !== 'string') return undefined
  const at = address.lastIndexOf('@')
  if (at <= 0) return undefined
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
  if (domain === '') return undefined
  return SMTP_PRESETS.find((preset) => preset.domains.includes(domain))
}

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

/**
 * Read the credential reference the section names, or the well-known default.
 *
 * The default is the same name the bundle's own documentation uses, so a page
 * with an empty section shows the reference a send would actually resolve
 * rather than a blank control that hides it.
 *
 * @param value - the section's stored value for the field.
 * @returns the reference name in effect.
 */
export function credentialRefFrom(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : (CREDENTIAL_REF_FIELD.fallback as string)
}

/**
 * Render a stored value as the control's draft text.
 *
 * An absent value renders as the empty string for every kind: the control then
 * reads as "default", which is exactly what the field will do until it is
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
    case 'lines':
      return Array.isArray(value)
        ? value.length === 0
          ? '[]'
          : value.filter((entry) => typeof entry === 'string').join('\n')
        : ''
  }
}

/**
 * Read a draft as the write it stages.
 *
 * An empty draft is a *clear*, not an empty value: clearing a control and
 * saving is the same gesture as restoring the default, and the host removes the
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

    case 'lines':
      return {
        kind: 'value',
        value:
          trimmed === '[]'
            ? []
            : trimmed
                .split(/\r?\n|\r/)
                .map((entry) => entry.trim())
                .filter(Boolean),
      }

    case 'addresses': {
      const addresses = trimmed
        .split(/[,;\r\n]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
      if (addresses.length === 0) return { kind: 'clear' }
      const malformed = addresses.filter((entry) => !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(entry))
      if (malformed.length > 0) {
        return invalid(def, 'invalidAddress', {
          entries: malformed.join(', '),
        })
      }
      return { kind: 'value', value: addresses }
    }
  }
}

/**
 * Whether a value satisfies a required field's presence rule.
 *
 * Mirrors `config-check.ts`: a non-empty trimmed string for the text fields, at
 * least one entry for the recipient list. Address *shape* is the parser's
 * concern, not this one's.
 *
 * @param def - the field definition.
 * @param value - the value the field would hold after a save.
 * @returns whether the value counts as filled in.
 */
export function isFilled(def: FieldDef, value: unknown): boolean {
  if (def.kind === 'addresses' || def.kind === 'lines') {
    return Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry.trim() !== '')
  }
  if (typeof value === 'string') return value.trim() !== ''
  return value !== undefined && value !== null
}
