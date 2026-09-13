/**
 * Configuration schema, defaulting, and validation.
 *
 * The schema carries the §3 safety defaults from `docs/CONFIG_SPEC.md`; the
 * cross-field rules live in {@link resolveConfig} because they involve more
 * than one key. Nothing here reads a credential: validation confirms only that
 * `smtpPasswordCredential` is a well-formed reference *name*. Whether that
 * reference is configured is a runtime fact, decided per send operation
 * through the Credential service (D010).
 *
 * @module dsh-mail-notify/config
 */

import Schema from '@deepseek-ai/schemastery'
import type { ResolvedConfig } from './types.ts'
import { RETRY_MAX_DELAY_MS } from './retry.ts'

/** Reference-name grammar accepted for `smtpPasswordCredential` (D010). */
export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Deliberately permissive address check: the SMTP server is the real judge. */
const ADDRESS_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/** Plugin configuration schema; the defaults are the frozen safe defaults. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('Master switch. While false the plugin registers no listener at all.'),

  smtpHost: Schema.string().description('SMTP server host name. Required whenever `enabled` is true.'),
  smtpPort: Schema.natural().min(1).max(65535).default(587).description('SMTP port.'),
  smtpSecure: Schema.boolean()
    .default(false)
    .description('true selects implicit TLS (normally port 465); false allows a STARTTLS upgrade (normally 587).'),
  smtpUser: Schema.string().description('SMTP authentication user name.'),
  smtpPasswordCredential: Schema.string()
    .description('Credential reference name resolved per send operation, never the password itself.'),
  from: Schema.string().description('Envelope sender address.'),
  to: Schema.array(Schema.string()).default([]).description('Recipient addresses; at least one is required.'),

  includeSubagents: Schema.boolean().default(false).description('Whether subagent turns are notified too.'),
  notifyCompleted: Schema.boolean().default(true).description('Notify on completed turns.'),
  notifyErrors: Schema.boolean().default(false).description('Notify on turns that ended with an error.'),
  notifyMaxTokens: Schema.boolean().default(true).description('Notify on turns truncated at the token limit.'),

  minTurnDurationMs: Schema.natural()
    .min(0)
    .max(3_600_000)
    .default(0)
    .description('Suppress turns shorter than this. 0 disables the filter; an unknown duration is never suppressed.'),
  maxBodyChars: Schema.natural()
    .min(1000)
    .max(1_000_000)
    .default(100_000)
    .description('Visible-text length cap, counted in code points.'),

  includeMetadata: Schema.boolean().default(true).description('Include the session, workspace, model, and timing block.'),
  includeUserPrompt: Schema.boolean().default(false).description('Include the turn’s last user message. Off by default.'),
  includeFooter: Schema.boolean().default(true).description('Include the generator footer and the truncation marker.'),

  queueSize: Schema.natural().min(1).max(10_000).default(100).description('Waiting-job cap; the worker holds one more.'),
  retryAttempts: Schema.natural().min(0).max(10).default(3).description('Retry count; total attempts are 1 + this.'),
  retryBaseDelayMs: Schema.natural()
    .min(100)
    .max(60_000)
    .default(1000)
    .description('Backoff base; retry n waits base × 3^(n−1), capped at 30 s.'),
  maxDedupeEntries: Schema.natural().min(10).max(100_000).default(1000).description('Dedupe cache capacity.'),
})

/** The validated configuration type Cordis hands to {@link import('./index.ts').apply}. */
export type ConfigValue = ReturnType<typeof Config>

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
 * Resolve raw plugin configuration into a fully-populated config.
 *
 * Two failure modes are distinguished. Field-level failures produce a
 * non-empty `errors` list and the plugin refuses to mount: a message sent to an
 * unknown recipient is worse than no message. Cross-field oddities — an
 * unusual port/`secure` pairing, or every notification switch turned off —
 * produce warnings and still mount, because silently correcting them would let
 * an operator believe a setting took effect.
 *
 * With `enabled: false` no other validation runs at all. Turning the plugin off
 * should not be blocked by unrelated required fields.
 *
 * @param raw - the raw configuration object from the bundle patch.
 * @returns the resolved configuration plus field-level diagnostics.
 */
export function resolveConfig(raw: unknown): ConfigResolution {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  // `enabled` is honoured from either the flat input or a nested `policy`/`smtp`
  // block, so the shape Cordis validates and the shape a test hands over both work.
  const enabled = input.enabled === undefined ? true : input.enabled !== false

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
        policy: {
          includeSubagents: false,
          notifyCompleted: true,
          notifyErrors: false,
          notifyMaxTokens: true,
          minTurnDurationMs: 0,
        },
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

  // `Config()` both applies defaults and rejects out-of-range numbers. Its throw
  // is converted into the same diagnostics shape as the manual checks below.
  let validated: ConfigValue
  try {
    validated = Config(input as never)
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
      `smtpPasswordCredential "${credentialRef}" is not a valid credential reference name (expected ${CREDENTIAL_REF_PATTERN.source})`,
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
  if (!validated.notifyCompleted && !validated.notifyErrors && !validated.notifyMaxTokens) {
    warnings.push('notifyCompleted, notifyErrors, and notifyMaxTokens are all false: no email can ever be sent')
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
    policy: {
      includeSubagents: false,
      notifyCompleted: true,
      notifyErrors: false,
      notifyMaxTokens: true,
      minTurnDurationMs: 0,
    },
    render: { maxBodyChars: 100_000, includeMetadata: true, includeUserPrompt: false, includeFooter: true },
    retry: { retryAttempts: 3, retryBaseDelayMs: 1000, retryMaxDelayMs: RETRY_MAX_DELAY_MS },
    queueSize: 100,
    maxDedupeEntries: 1000,
    smtpConfigured: false,
    warnings: [],
    errors: [],
  }
}
