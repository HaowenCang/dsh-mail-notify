/**
 * Configuration schema, defaulting, and validation.
 *
 * ## Two layers, one boundary
 *
 * DSH 0.1.7 makes a plugin's own Config the editable configuration document:
 * the Plugins page renders a form from this schema, `SettingsForms` writes the
 * user's edits into the profile patch, and a field declared with `.volatile()`
 * is applied to the *running* plugin without a remount. Everything the Web card
 * can edit is therefore declared here, once.
 *
 * The fields are volatile, which means the value Cordis validates and hands to
 * `apply` is a tree of `Volatile<T>` references rather than plain data. Reading
 * one of those returns an immutable snapshot. This module owns the single place
 * where that tree is collapsed into primitives — {@link snapshotOf} — so that
 * the mailer, the queue, the policy, and the event handler never hold a live
 * reference whose value could change underneath an operation in progress. One
 * operation consumes one consistent snapshot.
 *
 * ## Why the fields are flat
 *
 * Schemastery refuses a volatile field that has a volatile ancestor or that
 * lives under a container node, so a volatile field path must be a fixed
 * top-level key. The schema is consequently flat and every field is volatile;
 * the nested `smtp`/`policy`/`render`/`retry` groups exist only in
 * {@link ResolvedConfig}, where they are derived, not stored.
 *
 * ## What is checked where
 *
 * Field-level constraints — the port range, the counters' bounds, the
 * credential-reference grammar — live on the field schemas, so a rejected edit
 * names the field it came from. Cross-field rules live in {@link resolveConfig}
 * and are reached through `dsh-config-editor`, which resolves a candidate
 * through this schema *before* it persists it: an invalid save is refused
 * before the profile patch is written. Runtime resolution stays in place as
 * defence in depth, because a hand-edited patch reaches the plugin without ever
 * passing the editor.
 *
 * Nothing here reads a credential: validation confirms only that
 * `smtpPasswordCredential` is a well-formed reference *name*. Whether that
 * reference is configured is a runtime fact, decided per send operation through
 * the Credential service (D010).
 *
 * @module dsh-mail-notify/config
 */

import Schema from '@deepseek-ai/schemastery'
import type { RawConfig, ResolvedConfig } from './types.ts'
import { RETRY_MAX_DELAY_MS } from './retry.ts'

/**
 * Reference-name grammar accepted for `smtpPasswordCredential` (D010).
 *
 * This is the installed DSH 0.1.7 `CredentialRef` grammar, character for
 * character: a POSIX-style environment-variable name. Both the Host Remote
 * (`@deepseek-ai/dsh-api-settings-controller`) and the provider build every
 * reference through `credentialRef()`, which throws unless the candidate matches
 * this pattern, and the file-backed provider admits only that grammar into the
 * `refs` section of `.credentials.yaml` — the section its `resolve()` and
 * `describe()` read.
 *
 * The `<scope>/<id>` spelling is a different key space, `CredentialKey`, which
 * addresses the provider-managed `records` section through
 * `readRecord`/`describeRecord`. It is deliberately **not** accepted here: the
 * plugin passes this value to `resolve()` and `describe()`, which know nothing
 * about the record half, so admitting it would validate a reference that can
 * never resolve and would move the misconfiguration from mount time to send
 * time. See D019.
 */
export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Deliberately permissive address check: the SMTP server is the real judge. */
const ADDRESS_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/**
 * Plugin configuration schema.
 *
 * Every field is a volatile scalar with a default, so the schema can resolve a
 * completely absent configuration and the form always has a value to render.
 * The defaults are the frozen safe defaults of `docs/CONFIG_SPEC.md §3`.
 */
export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .volatile()
    .description('Master switch. While false the plugin registers no listener at all.'),

  smtpHost: Schema.string()
    .default('')
    .volatile()
    .description('SMTP server host name. Required whenever `enabled` is true.'),
  smtpPort: Schema.natural()
    .min(1)
    .max(65535)
    .default(587)
    .volatile()
    .description('SMTP port.'),
  smtpSecure: Schema.boolean()
    .default(false)
    .volatile()
    .description('true selects implicit TLS (normally port 465); false allows a STARTTLS upgrade (normally 587).'),
  smtpUser: Schema.string().default('').volatile().description('SMTP authentication user name.'),
  smtpPasswordCredential: Schema.string()
    .default('DSH_MAIL_SMTP_PASSWORD')
    .pattern(CREDENTIAL_REF_PATTERN)
    .role('credential-ref')
    .volatile()
    .description('Credential reference name resolved per send operation, never the password itself.'),
  from: Schema.string().default('').volatile().description('Envelope sender address.'),
  to: Schema.array(Schema.string())
    .default([])
    .volatile()
    .description('Recipient addresses; at least one is required while `enabled` is true.'),

  includeSubagents: Schema.boolean()
    .default(false)
    .volatile()
    .description('Whether subagent turns are notified too.'),
  notifyCompleted: Schema.boolean().default(true).volatile().description('Notify on completed turns.'),
  notifyErrors: Schema.boolean()
    .default(false)
    .volatile()
    .description(
      'Notify on turns that ended with a terminal error, including errors that produced no visible assistant output.',
    ),
  notifyMaxTokens: Schema.boolean().default(true).volatile().description('Notify on turns truncated at the token limit.'),
  notifyQuestions: Schema.boolean()
    .default(false)
    .volatile()
    .description(
      'Notify when the agent blocks on ask_user_question. Sends the question text and options to the mail system.',
    ),
  notifyApprovals: Schema.boolean()
    .default(false)
    .volatile()
    .description('Notify when the agent blocks on an approval decision. Sends the tool name and reason to the mail system.'),

  minTurnDurationMs: Schema.natural()
    .min(0)
    .max(3_600_000)
    .default(0)
    .volatile()
    .description('Suppress turns shorter than this. 0 disables the filter; an unknown duration is never suppressed.'),
  maxBodyChars: Schema.natural()
    .min(1000)
    .max(1_000_000)
    .default(100_000)
    .volatile()
    .description('Visible-text length cap, counted in code points.'),

  includeMetadata: Schema.boolean()
    .default(true)
    .volatile()
    .description('Include the session, workspace, model, and timing block.'),
  includeUserPrompt: Schema.boolean()
    .default(false)
    .volatile()
    .description('Include the turn’s last user message. Off by default.'),
  includeFooter: Schema.boolean()
    .default(true)
    .volatile()
    .description('Include the generator footer and the truncation marker.'),

  queueSize: Schema.natural().min(1).max(10_000).default(100).volatile().description('Waiting-job cap; the worker holds one more.'),
  retryAttempts: Schema.natural()
    .min(0)
    .max(10)
    .default(3)
    .volatile()
    .description('Retry count; total attempts are 1 + this.'),
  retryBaseDelayMs: Schema.natural()
    .min(100)
    .max(60_000)
    .default(1000)
    .volatile()
    .description('Backoff base; retry n waits base × 3^(n−1), capped at 30 s.'),
  maxDedupeEntries: Schema.natural().min(10).max(100_000).default(1000).volatile().description('Dedupe cache capacity.'),
})

/**
 * The validated configuration Cordis hands to {@link import('./index.ts').apply}.
 *
 * Every field is a `Volatile` reference. The type is derived from the schema
 * rather than restated, so a field renamed here is a compile error at every
 * read site.
 */
export type ConfigValue = ReturnType<typeof Config>

/**
 * The primitive configuration snapshot one operation reads.
 *
 * Spelled as a closed interface rather than derived from the schema through a
 * conditional type. The mapped form is not assignable from `VolatileSnapshot`
 * for the array-valued fields — a deeply readonly array does not reduce to
 * `string[]` through `infer` — and a `type` assertion would have bought
 * silence at the cost of the check. Stating the shape keeps the check: the
 * compiler still requires {@link snapshotOf} to produce exactly these fields
 * with exactly these types, so a schema field added, renamed, or retyped
 * without a matching entry here fails to compile.
 */
export interface ConfigSnapshot {
  enabled: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPasswordCredential: string
  from: string
  to: string[]
  includeSubagents: boolean
  notifyCompleted: boolean
  notifyErrors: boolean
  notifyMaxTokens: boolean
  notifyQuestions: boolean
  notifyApprovals: boolean
  minTurnDurationMs: number
  maxBodyChars: number
  includeMetadata: boolean
  includeUserPrompt: boolean
  includeFooter: boolean
  queueSize: number
  retryAttempts: number
  retryBaseDelayMs: number
  maxDedupeEntries: number
}

/**
 * Collapse a volatile Config tree into one immutable snapshot of primitives.
 *
 * This is the plugin's single snapshot boundary. Every field is read exactly
 * once, in declaration order, and the result is a fresh plain object, so a
 * volatile update landing mid-operation cannot make one read of the
 * configuration disagree with another (or with a provider that changes
 * behaviour when `enabled` flips).
 *
 * Reads are deliberately not defensive against a raw object: a caller that
 * hands over plain data instead of a volatile tree is a programming error at
 * the seam, and silently accepting it would let the live-reference contract be
 * violated without anything noticing.
 *
 * @param config - the volatile configuration Cordis resolved for this plugin.
 * @returns the primitive snapshot.
 */
export function snapshotOf(config: ConfigValue): ConfigSnapshot {
  return {
    enabled: config.enabled.get(),
    smtpHost: config.smtpHost.get(),
    smtpPort: config.smtpPort.get(),
    smtpSecure: config.smtpSecure.get(),
    smtpUser: config.smtpUser.get(),
    smtpPasswordCredential: config.smtpPasswordCredential.get(),
    from: config.from.get(),
    // `Volatile.get()` freezes its result deeply, so the array arrives readonly
    // and is copied here. The copy is the contract, not an optimisation: a
    // snapshot is a detached plain value this plugin owns, and nothing
    // downstream may hold a reference into the live configuration.
    to: [...config.to.get()],
    includeSubagents: config.includeSubagents.get(),
    notifyCompleted: config.notifyCompleted.get(),
    notifyErrors: config.notifyErrors.get(),
    notifyMaxTokens: config.notifyMaxTokens.get(),
    notifyQuestions: config.notifyQuestions.get(),
    notifyApprovals: config.notifyApprovals.get(),
    minTurnDurationMs: config.minTurnDurationMs.get(),
    maxBodyChars: config.maxBodyChars.get(),
    includeMetadata: config.includeMetadata.get(),
    includeUserPrompt: config.includeUserPrompt.get(),
    includeFooter: config.includeFooter.get(),
    queueSize: config.queueSize.get(),
    retryAttempts: config.retryAttempts.get(),
    retryBaseDelayMs: config.retryBaseDelayMs.get(),
    maxDedupeEntries: config.maxDedupeEntries.get(),
  }
}

/** Outcome of resolving raw configuration. */
export interface ConfigResolution {
  resolved: ResolvedConfig
  /** Non-empty means the plugin must not mount. */
  errors: readonly string[]
  warnings: readonly string[]
}

/** Normalize an unknown value into a trimmed non-empty string, or `undefined`. */
function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** De-duplicate addresses while preserving order. */
function dedupeAddresses(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/**
 * Resolve a configuration snapshot into a fully-populated config.
 *
 * Two failure modes are distinguished. Field-level failures produce a
 * non-empty `errors` list and the plugin refuses to mount: a message sent to an
 * unknown recipient is worse than no message. Cross-field oddities — an
 * unusual port/`secure` pairing, or every notification switch turned off —
 * produce warnings and still mount, because silently correcting them would let
 * an operator believe a setting took effect.
 *
 * With `enabled: false` no cross-field validation runs at all. Turning the
 * plugin off should not be blocked by unrelated required fields.
 *
 * The input is a {@link ConfigSnapshot}: the schema has already applied
 * defaults and rejected out-of-range values, so this function reports the
 * *sense* of a configuration rather than re-checking its shape. It is still
 * tolerant of partial input, because a caller outside the Cordis path (a test,
 * or a resumed session replayed against a newer schema) may hand over less.
 *
 * @param raw - the primitive configuration snapshot, or any raw document a
 *   caller outside the Cordis path produced. Deliberately typed `unknown`: this
 *   is the plugin's outermost validation boundary, and a caller that reached it
 *   with a malformed document must get diagnostics rather than a type error it
 *   cannot act on.
 * @returns the resolved configuration plus field-level diagnostics.
 */
export function resolveConfig(raw: RawConfig | ConfigSnapshot | unknown): ConfigResolution {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  // `enabled` is honoured from either the flat input or a nested `policy`/`smtp`
  // block, so the shape Cordis validates and the shape a test hands over both work.
  const enabled = input['enabled'] === undefined ? true : input['enabled'] !== false

  if (!enabled) {
    return {
      resolved: {
        enabled: false,
        smtp: {
          smtpHost: '',
          smtpPort: 587,
          smtpSecure: false,
          smtpUser: '',
          smtpPasswordCredential: '',
          from: '',
          to: [],
        },
        policy: { ...disabledPolicy() },
        render: {
          maxBodyChars: 100_000,
          includeMetadata: true,
          includeUserPrompt: false,
          includeFooter: true,
        },
        retry: { retryAttempts: 3, retryBaseDelayMs: 1000, retryMaxDelayMs: RETRY_MAX_DELAY_MS },
        queueSize: 100,
        maxDedupeEntries: 1000,
        smtpConfigured: false,
        warnings: [],
        errors: [],
      },
      errors: [],
      warnings: [],
    }
  }

  // `Config()` both applies defaults and rejects out-of-range numbers. Under the
  // native-Config path the caller has already resolved through this schema, so
  // a throw here means a raw, unvalidated document reached the runtime — a
  // hand-edited patch, or a caller that skipped the schema. Its message is
  // converted into the same diagnostics shape as the checks below.
  let validated: ConfigSnapshot
  try {
    validated = snapshotOf(Config(input as never))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      resolved: emptyResolved(),
      errors: [`configuration failed schema validation: ${message}`],
      warnings: [],
    }
  }

  const errors: string[] = []
  const warnings: string[] = []

  const smtpHost = asNonEmptyString(validated.smtpHost)
  if (smtpHost === undefined) errors.push('smtpHost is required and must be a non-empty host name')
  else if (/\s/.test(smtpHost)) errors.push('smtpHost must not contain whitespace')

  const smtpUser = asNonEmptyString(validated.smtpUser)
  if (smtpUser === undefined) errors.push('smtpUser is required and must be a non-empty user name')

  const credentialRef = asNonEmptyString(validated.smtpPasswordCredential)
  if (credentialRef === undefined) {
    errors.push('smtpPasswordCredential is required; give the credential reference name, never the password itself')
  } else if (!CREDENTIAL_REF_PATTERN.test(credentialRef)) {
    errors.push(
      `smtpPasswordCredential "${credentialRef}" is not a valid credential reference name ` +
        `(expected ${CREDENTIAL_REF_PATTERN.source}, the DSH CredentialRef grammar; ` +
        'a `<scope>/<id>` CredentialKey addresses the record half of the store and cannot be resolved here)',
    )
  }

  const from = asNonEmptyString(validated.from)
  if (from === undefined) errors.push('from is required and must be a non-empty address')
  else if (!ADDRESS_PATTERN.test(from)) errors.push(`from "${from}" is not a plausible email address`)

  const rawTo = Array.isArray(validated.to) ? validated.to : []
  const accepted: string[] = []
  for (const entry of rawTo) {
    const address = asNonEmptyString(entry)
    if (address === undefined) continue
    if (!ADDRESS_PATTERN.test(address)) {
      errors.push(`to entry "${address}" is not a plausible email address`)
      continue
    }
    accepted.push(address)
  }
  const to = dedupeAddresses(accepted)
  if (to.length === 0) errors.push('to must contain at least one valid recipient address')

  // Cross-field: a port/`secure` pairing that is almost certainly a mistake is
  // reported, never corrected. Silently rewriting it would make the operator
  // believe the configured port took effect (SECURITY.md §3).
  if (validated.smtpSecure && validated.smtpPort === 587) {
    warnings.push('smtpSecure is true while smtpPort is 587: port 587 normally expects STARTTLS (smtpSecure: false)')
  }
  if (!validated.smtpSecure && validated.smtpPort === 465) {
    warnings.push('smtpSecure is false while smtpPort is 465: port 465 normally expects implicit TLS (smtpSecure: true)')
  }
  if (
    !validated.notifyCompleted &&
    !validated.notifyErrors &&
    !validated.notifyMaxTokens &&
    !validated.notifyQuestions &&
    !validated.notifyApprovals
  ) {
    warnings.push(
      'notifyCompleted, notifyErrors, notifyMaxTokens, notifyQuestions, and notifyApprovals are all false: no email can ever be sent',
    )
  }

  const resolved: ResolvedConfig = {
    enabled: true,
    smtp: {
      smtpHost: smtpHost ?? '',
      smtpPort: validated.smtpPort,
      smtpSecure: validated.smtpSecure,
      smtpUser: smtpUser ?? '',
      smtpPasswordCredential: credentialRef ?? '',
      from: from ?? '',
      to,
    },
    policy: {
      includeSubagents: validated.includeSubagents,
      notifyCompleted: validated.notifyCompleted,
      notifyErrors: validated.notifyErrors,
      notifyMaxTokens: validated.notifyMaxTokens,
      notifyQuestions: validated.notifyQuestions,
      notifyApprovals: validated.notifyApprovals,
      minTurnDurationMs: validated.minTurnDurationMs,
    },
    render: {
      maxBodyChars: validated.maxBodyChars,
      includeMetadata: validated.includeMetadata,
      includeUserPrompt: validated.includeUserPrompt,
      includeFooter: validated.includeFooter,
    },
    retry: {
      retryAttempts: validated.retryAttempts,
      retryBaseDelayMs: validated.retryBaseDelayMs,
      retryMaxDelayMs: RETRY_MAX_DELAY_MS,
    },
    queueSize: validated.queueSize,
    maxDedupeEntries: validated.maxDedupeEntries,
    smtpConfigured: errors.length === 0,
    warnings,
    errors,
  }

  return { resolved, errors, warnings }
}

/** A disabled-shaped resolved config, used when schema validation throws. */
function emptyResolved(): ResolvedConfig {
  return {
    enabled: false,
    smtp: { smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', smtpPasswordCredential: '', from: '', to: [] },
    policy: { ...disabledPolicy() },
    render: { maxBodyChars: 100_000, includeMetadata: true, includeUserPrompt: false, includeFooter: true },
    retry: { retryAttempts: 3, retryBaseDelayMs: 1000, retryMaxDelayMs: RETRY_MAX_DELAY_MS },
    queueSize: 100,
    maxDedupeEntries: 1000,
    smtpConfigured: false,
    warnings: [],
    errors: [],
  }
}

/**
 * The default policy switches, shared by every non-validated construction path.
 *
 * Defined once so the disabled and failed-validation shapes cannot drift from
 * the schema defaults: a reader comparing them sees one source of truth.
 *
 * @returns a fresh policy object with the frozen safe defaults.
 */
function disabledPolicy(): ResolvedConfig['policy'] {
  return {
    includeSubagents: false,
    notifyCompleted: true,
    notifyErrors: false,
    notifyMaxTokens: true,
    notifyQuestions: false,
    notifyApprovals: false,
    minTurnDurationMs: 0,
  }
}
