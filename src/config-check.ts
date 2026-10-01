/**
 * Product-level configuration rules, and the Host boundary that enforces them.
 *
 * ## Why the rules live in a module of their own
 *
 * Two boundaries ask the same question about the same document. The **Host**
 * asks it before anything is persisted: `@deepseek-ai/cordis`'s
 * `resolveConfig(fiber.runtime, candidate)` calls
 * `candidate.Config['~standard'].validate(candidate)` and throws a
 * `ValidationError` when the result carries issues — `dsh-config-editor` runs it
 * before it writes the profile patch, and the Loader's mount and update paths
 * run the same function. The **plugin** asks it again at runtime
 * (`config.ts::resolveConfig`), because a hand-edited patch reaches the plugin
 * without passing any editor. Two copies of the rules would be two opinions
 * about one document; {@link checkProductConfig} is therefore the single copy,
 * and both boundaries call it.
 *
 * ## What "product" means here
 *
 * The field schemas in `config.ts` decide whether a value is *well formed* — a
 * port inside 1–65535, a credential reference matching the CredentialRef
 * grammar, a boolean flag. The rules below decide whether a well-formed document
 * can be acted on at all: an SMTP host and user to authenticate with, a sender
 * the server will accept, and at least one recipient that survived the address
 * rule. They run only while `enabled` is true, so a plugin that is switched off
 * stays editable however incomplete the rest of the document is.
 *
 * The split also fixes where a refusal appears. Every issue names the field it
 * came from ({@link ProductIssue.path}), so the `ValidationError` the Host throws
 * reads `- smtpHost is required and must be a non-empty host name (at smtpHost)`
 * and `config.ts::resolveConfig` reports the identical sentence. The credential
 * reference is deliberately not one of these rules: the field schema already
 * governs it, and a cross-field duplicate would report the same refusal twice.
 *
 * ## Why the mechanism is the standard-schema validator
 *
 * The pinned Schemastery — 3.18.4, the release both this checkout and the
 * installed DSH 0.2.0-rc.2 carry — has no `.check()` method: `Schema.prototype`
 * exposes `volatile`, `default`, `pattern`, `min`, `max`, `role`, `simplify`,
 * `toJSON` and `~standard`, and nothing else. A root `Schema.transform` is not an
 * alternative either: the settings form walks an object node's `dict`, so a
 * transform root would hide every field from the form. What the Host actually
 * calls is the standard-schema contract, so that is what {@link withProductChecks}
 * extends. `scripts/probe/config-check-probe.mjs` pins all of it against the
 * installed copy.
 *
 * @module dsh-mail-notify/config-check
 */

import Schema from '@deepseek-ai/schemastery'

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
 *
 * Re-exported from `config.ts` so the published import path is unchanged.
 */
export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Deliberately permissive address check: the SMTP server is the real judge. */
export const ADDRESS_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/**
 * One refusal, addressed to the field it came from.
 *
 * The shape is the standard-schema issue shape on purpose: this object is handed
 * to the Host unchanged, so the field path it carries is the path cordis prints
 * in its `ValidationError`.
 */
export interface ProductIssue {
  readonly message: string
  readonly path: readonly string[]
}

/** The outcome of every product rule over one primitive candidate. */
export interface ProductCheck {
  /** The refusal messages in rule order; non-empty means the plugin must not mount. */
  readonly errors: readonly string[]
  /** The same refusals, each with the field path the Host reports. */
  readonly issues: readonly ProductIssue[]
  /** Oddities that are reported but never block: an unusual port pairing, or silence. */
  readonly warnings: readonly string[]
  /** Recipients that survived the address rule and the dedupe rule, in input order. */
  readonly recipients: readonly string[]
  /** The trimmed SMTP host, or `''` when the document carries none. */
  readonly smtpHost: string
  readonly smtpUser: string
  readonly from: string
  readonly credentialRef: string
}

/** The notification switches that decide whether any mail can ever be sent. */
const NOTIFICATION_SWITCHES = ['notifyCompleted', 'notifyErrors', 'notifyMaxTokens', 'notifyQuestions', 'notifyApprovals'] as const

/** Normalize an unknown value into a trimmed non-empty string, or `undefined`. */
export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** De-duplicate addresses case-insensitively, keeping first-seen order and spelling. */
export function dedupeAddresses(values: readonly string[]): string[] {
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
 * Whether the document switches the plugin on.
 *
 * An absent value means the schema default — the plugin is enabled — so only an
 * explicit `false` disables it. This is the single predicate both boundaries
 * use, which is what keeps "disabled" from meaning one thing to the Host and
 * another to the runtime.
 *
 * @param candidate - the primitive candidate, or any document-shaped value.
 * @returns whether the product rules apply.
 */
export function readEnabled(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) return true
  const value = (candidate as Record<string, unknown>)['enabled']
  return value === undefined ? true : value !== false
}

/**
 * The SMTP host rule: present, and free of whitespace.
 *
 * A host name with a space in it is not a host name, and Nodemailer would fail
 * on it only after the first notification was already due.
 *
 * @param value - the candidate `smtpHost`.
 * @returns the refusal, or `undefined` when the value is usable.
 */
export function checkSmtpHost(value: unknown): ProductIssue | undefined {
  const host = asNonEmptyString(value)
  if (host === undefined) {
    return { message: 'smtpHost is required and must be a non-empty host name', path: ['smtpHost'] }
  }
  if (/\s/.test(host)) return { message: 'smtpHost must not contain whitespace', path: ['smtpHost'] }
  return undefined
}

/**
 * The SMTP user rule.
 *
 * @param value - the candidate `smtpUser`.
 * @returns the refusal, or `undefined` when the value is usable.
 */
export function checkSmtpUser(value: unknown): ProductIssue | undefined {
  if (asNonEmptyString(value) !== undefined) return undefined
  return { message: 'smtpUser is required and must be a non-empty user name', path: ['smtpUser'] }
}

/**
 * The sender rule: a non-empty address under {@link ADDRESS_PATTERN}.
 *
 * @param value - the candidate `from`.
 * @returns the refusal, or `undefined` when the value is usable.
 */
export function checkFromAddress(value: unknown): ProductIssue | undefined {
  const from = asNonEmptyString(value)
  if (from === undefined) return { message: 'from is required and must be a non-empty address', path: ['from'] }
  if (!ADDRESS_PATTERN.test(from)) return { message: `from "${from}" is not a plausible email address`, path: ['from'] }
  return undefined
}

/** What the recipient rules accepted, and the entries they refused. */
export interface NormalizedRecipients {
  /** The accepted addresses, de-duplicated case-insensitively, in input order. */
  readonly accepted: readonly string[]
  /** The non-empty entries the address rule refused, in input order. */
  readonly refused: readonly string[]
}

/**
 * Apply the address rule and the dedupe rule to the recipient list.
 *
 * Blank entries are ignored rather than refused: an empty form row is an
 * unfinished edit, not a misconfiguration. Every non-empty entry that is not a
 * plausible address is refused explicitly, because the alternative — silently
 * dropping it — is what would let a message reach the wrong set of people.
 *
 * @param value - the candidate `to`.
 * @returns the accepted and refused entries.
 */
export function normalizeRecipients(value: unknown): NormalizedRecipients {
  const entries = Array.isArray(value) ? value : []
  const accepted: string[] = []
  const refused: string[] = []
  for (const entry of entries) {
    const address = asNonEmptyString(entry)
    if (address === undefined) continue
    if (!ADDRESS_PATTERN.test(address)) {
      refused.push(address)
      continue
    }
    accepted.push(address)
  }
  return { accepted: dedupeAddresses(accepted), refused }
}

/**
 * The credential-reference rule, for the runtime boundary only.
 *
 * Under the native-Config path the field schema in `config.ts` already applies
 * {@link CREDENTIAL_REF_PATTERN} and `.default('DSH_MAIL_SMTP_PASSWORD')`, so the
 * Host refuses a malformed reference before any product rule is consulted. This
 * function exists for the path that still needs it — `config.ts::resolveConfig`,
 * reached by a raw document that never passed the schema — and it must never be
 * added to {@link checkProductConfig}, or the same refusal would be reported
 * twice at the Host.
 *
 * @param value - the candidate `smtpPasswordCredential`.
 * @returns the refusal, or `undefined` when the value is a usable reference.
 */
export function checkCredentialReference(value: unknown): ProductIssue | undefined {
  const reference = asNonEmptyString(value)
  if (reference === undefined) {
    return {
      message: 'smtpPasswordCredential is required; give the credential reference name, never the password itself',
      path: ['smtpPasswordCredential'],
    }
  }
  if (!CREDENTIAL_REF_PATTERN.test(reference)) {
    return {
      message:
        `smtpPasswordCredential "${reference}" is not a valid credential reference name ` +
        `(expected ${CREDENTIAL_REF_PATTERN.source}, the DSH CredentialRef grammar; ` +
        'a `<scope>/<id>` CredentialKey addresses the record half of the store and cannot be resolved here)',
      path: ['smtpPasswordCredential'],
    }
  }
  return undefined
}

/**
 * The port/`secure` pairing and the all-switches-off warnings.
 *
 * Both are reported, never corrected: rewriting the port would make the operator
 * believe the configured value took effect (SECURITY.md §3), and an operator who
 * turned every switch off is more likely to have made a mistake than to have
 * meant it. Neither may ever become an error — a plugin that mounts silently is
 * still better than a profile that refuses to load.
 *
 * @param input - the primitive candidate.
 * @returns the warning messages, in rule order.
 */
function productWarnings(input: Record<string, unknown>): string[] {
  const warnings: string[] = []
  const port = input['smtpPort']
  const secure = input['smtpSecure']
  if (typeof port === 'number' && typeof secure === 'boolean') {
    if (secure && port === 587) {
      warnings.push('smtpSecure is true while smtpPort is 587: port 587 normally expects STARTTLS (smtpSecure: false)')
    }
    if (!secure && port === 465) {
      warnings.push('smtpSecure is false while smtpPort is 465: port 465 normally expects implicit TLS (smtpSecure: true)')
    }
  }
  if (NOTIFICATION_SWITCHES.every((key) => input[key] === false)) {
    warnings.push(
      'notifyCompleted, notifyErrors, notifyMaxTokens, notifyQuestions, and notifyApprovals are all false: no email can ever be sent',
    )
  }
  return warnings
}

/**
 * Run every product rule over one primitive candidate.
 *
 * This is the whole rule set, in one place, for one document shape: the
 * primitives a resolved configuration reduces to, whether they were read from
 * the volatile tree Cordis produced or from a raw document the schema
 * normalized. {@link collapseVolatile} produces the first, `snapshotOf` the
 * second, and the two agree field for field — which is what makes the Host's
 * refusal and the runtime's identical.
 *
 * @param candidate - the primitive configuration, or a document-shaped value.
 * @returns the refusals, the warnings, and the values the resolution uses.
 */
export function checkProductConfig(candidate: unknown): ProductCheck {
  const input = (typeof candidate === 'object' && candidate !== null ? candidate : {}) as Record<string, unknown>

  if (!readEnabled(input)) {
    return { errors: [], issues: [], warnings: [], recipients: [], smtpHost: '', smtpUser: '', from: '', credentialRef: '' }
  }

  const issues: ProductIssue[] = []
  const host = checkSmtpHost(input['smtpHost'])
  if (host !== undefined) issues.push(host)
  const user = checkSmtpUser(input['smtpUser'])
  if (user !== undefined) issues.push(user)
  const from = checkFromAddress(input['from'])
  if (from !== undefined) issues.push(from)

  const recipients = normalizeRecipients(input['to'])
  for (const refused of recipients.refused) {
    issues.push({ message: `to entry "${refused}" is not a plausible email address`, path: ['to'] })
  }
  if (recipients.accepted.length === 0) {
    issues.push({ message: 'to must contain at least one valid recipient address', path: ['to'] })
  }

  return {
    // Derived rather than restated: a message can never appear in the string
    // list without the field path that goes with it.
    errors: issues.map((issue) => issue.message),
    issues,
    warnings: productWarnings(input),
    recipients: recipients.accepted,
    smtpHost: asNonEmptyString(input['smtpHost']) ?? '',
    smtpUser: asNonEmptyString(input['smtpUser']) ?? '',
    from: asNonEmptyString(input['from']) ?? '',
    credentialRef: asNonEmptyString(input['smtpPasswordCredential']) ?? '',
  }
}

/**
 * Whether a value is a `Volatile` reference.
 *
 * Detected structurally — an own enumerable `get` function, which is exactly how
 * `cosmokit.createVolatile` builds one — rather than by importing
 * `isVolatile` from `@deepseek-ai/cosmokit`. That package is a peer of
 * Schemastery and not one of this plugin's declared dependencies, and the
 * reference shape is already the contract `snapshotOf` reads through.
 *
 * @param value - the candidate.
 * @returns whether the value is a volatile reference.
 */
function isVolatileReference(value: unknown): value is { get: () => unknown } {
  if (typeof value !== 'object' || value === null) return false
  const descriptor = Object.getOwnPropertyDescriptor(value, 'get')
  return descriptor !== undefined && descriptor.enumerable === true && typeof descriptor.value === 'function'
}

/**
 * Collapse a resolved volatile configuration tree into plain primitives.
 *
 * The untyped twin of `config.ts`'s {@link import('./config.ts').snapshotOf}:
 * same reads, same order, but usable where the tree arrives as `unknown` — from
 * a standard-schema result, whose type the Host contract does not describe. It
 * exists so the product rules can be run over the *resolved* tree rather than
 * over the raw candidate, which is what makes the Host's verdict a statement
 * about the values the plugin would actually read (defaults included) instead of
 * about what the caller happened to send.
 *
 * @param value - the resolved value, or any nested part of it.
 * @returns the same shape with every reference replaced by its snapshot.
 */
export function collapseVolatile(value: unknown): unknown {
  if (isVolatileReference(value)) return collapseVolatile(value.get())
  if (Array.isArray(value)) return value.map((entry) => collapseVolatile(entry))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, collapseVolatile(child)]))
  }
  return value
}

/**
 * Derive a schema node that carries the product rules into the Host contract.
 *
 * The node is rebuilt from the base schema's own serialized description — the
 * same reconstruction `@deepseek-ai/dsh-settings`'s `plainSchema` performs — and
 * the standard-schema validator is declared as an own data property on that
 * *derived* node, shadowing the inherited getter. Three consequences matter:
 *
 * - the base schema is untouched, so the exported `Config` is one node and the
 *   form projection (`toJSON` → `plainSchema` → `volatileForm`) sees an ordinary
 *   field-level schema with all of its fields and no product checks;
 * - the inherited validator is still the one that runs first, so a field-level
 *   violation is reported by the field schema, with the path Schemastery
 *   computed, and the product rules are consulted only when that result is
 *   clean;
 * - on success the inherited result is returned unchanged, so the value the
 *   Loader commits is still the resolved volatile tree — the references
 *   `dsh-settings`' `plainConfig` calls `.get()` on.
 *
 * @param base - the field-level schema.
 * @returns the derived node, with the same shape as `base`.
 */
export function withProductChecks<T extends Schemastery>(base: T): T {
  const node = new Schema(base.toJSON())
  const inherited = Object.getOwnPropertyDescriptor(Schema.prototype, '~standard')?.get
  if (inherited === undefined) {
    // The mechanism the whole Host boundary rests on. Failing here, at import
    // time, is the honest outcome: continuing would silently drop every product
    // rule from the pre-persistence path.
    throw new TypeError('@deepseek-ai/schemastery no longer exposes ~standard as a prototype getter')
  }

  Object.defineProperty(node, '~standard', {
    configurable: true,
    value: {
      version: 1,
      vendor: 'dsh-mail-notify',
      validate: (candidate: unknown) => {
        const result = inherited.call(node).validate(candidate)
        // An async validator cannot be awaited by cordis, which rejects it with
        // a TypeError of its own; passing it through keeps that behaviour.
        if ('then' in result) return result
        if (result.issues !== undefined) return result
        const issues = checkProductConfig(collapseVolatile(result.value)).issues
        return issues.length === 0 ? result : { issues: [...issues] }
      },
    },
  })

  return node as unknown as T
}
