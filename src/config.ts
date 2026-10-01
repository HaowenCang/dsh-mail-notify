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
 * names the field it came from. The cross-field rules live in
 * {@link import('./config-check.ts')}, and the two boundaries that enforce them
 * call that one copy.
 *
 * The Host boundary is the standard-schema contract on the exported
 * {@link Config} node. `@deepseek-ai/cordis`'s `resolveConfig(fiber.runtime,
 * candidate)` — the function `dsh-config-editor` runs before it writes the
 * profile patch, and the one the Loader's mount and update paths run as well —
 * calls `candidate.Config['~standard'].validate(candidate)` and throws a
 * `ValidationError` when the result carries issues. {@link withProductChecks}
 * therefore layers the product rules onto a node derived from the schema below,
 * and a product-invalid save is refused before `cordis.patch.yml` is touched.
 * A root `Schema.transform` is not an alternative: the settings form walks an
 * object node's `dict`, so a transform root would hide every field from it.
 *
 * `config.ts::resolveConfig` — the local function of that name further down,
 * unrelated to cordis's — runs the same rules through the same module as
 * runtime defence in depth, because a hand-edited patch reaches the plugin
 * without ever passing the editor. It is not the Host validator, and cordis's
 * `resolveConfig` never calls it.
 *
 * The mechanism is the standard-schema validator rather than a Schemastery
 * cross-field hook because the pinned release has none: `.check()` is absent
 * from `Schema.prototype` in 3.18.4, in both this checkout's copy and the one
 * the installed DSH 0.2.0-rc.2 ships.
 * `scripts/probe/config-check-probe.mjs` pins both facts against whichever copy
 * it is pointed at.
 *
 * Nothing here reads a credential: validation confirms only that
 * `smtpPasswordCredential` is a well-formed reference *name*. Whether that
 * reference is configured is a runtime fact, decided per send operation through
 * the Credential service (D010).
 *
 * @module dsh-mail-notify/config
 */

import Schema from '@deepseek-ai/schemastery'
import {
  CREDENTIAL_REF_PATTERN,
  checkCredentialReference,
  checkProductConfig,
  readEnabled,
  withProductChecks,
} from './config-check.ts'
import type { RawConfig, ResolvedConfig } from './types.ts'
import { RETRY_MAX_DELAY_MS } from './retry.ts'

// The rules themselves live in `config-check.ts`, which both boundaries call;
// this re-export keeps the published import path (`src/config.ts`) unchanged.
export { CREDENTIAL_REF_PATTERN }

/**
 * The field-level plugin configuration schema.
 *
 * Every field is a volatile scalar with a default, so the schema can resolve a
 * completely absent configuration and the form always has a value to render.
 * The defaults are the frozen safe defaults of `docs/CONFIG_SPEC.md §3`.
 */
const fieldSchema = Schema.object({
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
 * Plugin configuration schema: the fields above, plus the product rules the Host
 * enforces before it persists a candidate.
 *
 * The exported node is a *derived* one — `withProductChecks` rebuilds it from
 * the field schema's own serialization and layers the standard-schema validator
 * on top — so it answers `simplify`, `toJSON`, `dict`, `meta` and the prototype
 * `~standard` getter exactly as the field schema does, and adds only the
 * pre-persistence refusal. Deriving rather than mutating is what keeps the
 * settings form honest: `dsh-settings` projects the form from `toJSON()`, and
 * that projection carries no product checks, so the user can still open and
 * repair a document that the Host would refuse to write.
 *
 * The annotation on the left is not decoration. `typeof fieldSchema` is what
 * {@link ConfigValue} is derived from, so stating it here is what makes a field
 * added to the schema appear in the resolved type — and a field added without a
 * matching {@link ConfigSnapshot} entry still fails to compile.
 */
export const Config: typeof fieldSchema = withProductChecks(fieldSchema)

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
 * The rules are not restated here. {@link checkProductConfig} holds the single
 * copy, and this function feeds it the same primitive shape the Host's
 * standard-schema validator feeds it, so a candidate the editor would refuse is
 * a candidate this function reports — which is what the
 * `Host refusal and runtime refusal` test asserts. This path remains necessary
 * on its own: it is the only one a hand-edited patch reaches.
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

  // Read from either a flat document or any object carrying `enabled`, so the
  // shape Cordis validates and the shape a test hands over both work.
  if (!readEnabled(input)) {
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

  // The shared product rules. `validated` is the same primitive shape
  // `collapseVolatile` produces from the Host's resolved value, so the two
  // boundaries cannot disagree about a candidate.
  const check = checkProductConfig(validated)

  // The credential rule is deliberately not part of `check`: the Host enforces
  // it on the field schema, where a refusal names the field. It is repeated here
  // because this is the boundary that also sees documents the schema never
  // touched.
  const credentialIssue = checkCredentialReference(check.credentialRef)

  const errors: string[] = credentialIssue === undefined ? [...check.errors] : [...check.errors, credentialIssue.message]
  const warnings: string[] = [...check.warnings]

  const resolved: ResolvedConfig = {
    enabled: true,
    smtp: {
      smtpHost: check.smtpHost,
      smtpPort: validated.smtpPort,
      smtpSecure: validated.smtpSecure,
      smtpUser: check.smtpUser,
      smtpPasswordCredential: check.credentialRef,
      from: check.from,
      to: [...check.recipients],
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
