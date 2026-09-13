/**
 * The credential seam.
 *
 * The DSH Credential service resolves a reference once per call, and that
 * per-call read is the mechanism by which a rotated password reaches the next
 * send without a restart. Caching a resolved value would break that mechanism
 * and would also extend the secret's lifetime inside the process, so this
 * module exposes only operations that resolve and immediately hand the value to
 * the caller's own scope.
 *
 * @module dsh-mail-notify/credentials
 */

/** The DSH credential reference type; a branded string. */
export type CredentialRef = string & { readonly __credentialRef?: unique symbol }

/** Value plus provenance layer, as `credentials.resolve` returns it. */
export interface ResolvedCredential {
  value: string
  source: string
}

/** Presence and writability facts, as `credentials.describe` returns them. */
export interface CredentialInfo {
  configured: boolean
  source?: string
  writable: boolean
}

/**
 * The part of the DSH Credential service this plugin uses.
 *
 * Structural rather than imported so the seam can be faked in tests without
 * instantiating the real service.
 */
export interface CredentialProviderLike {
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
  describe(ref: CredentialRef): Promise<CredentialInfo>
}

/** The part of `ctx` this plugin reads. */
export interface ContextServices {
  get(name: string): unknown
}

/** Outcome of one credential lookup, in a shape that never carries the value. */
export interface CredentialOutcome {
  /** The secret, present only on success and used only within one send attempt. */
  value?: string
  /** Human-readable diagnostics naming the reference and its described state. */
  message?: string
}

/** What `credentials.describe` reported, reduced to loggable scalars. */
export interface CredentialDescription {
  configured: boolean
  source?: string
  writable: boolean
}

/**
 * Read the Credential service from a context.
 *
 * The service is an optional dependency: a profile without it must still load
 * this plugin and report a clear diagnostic, rather than fail to activate.
 *
 * @param ctx - the plugin context.
 * @returns the service, or `undefined` when this profile mounts none.
 */
export function getCredentialProvider(ctx: ContextServices): CredentialProviderLike | undefined {
  let candidate: unknown
  try {
    candidate = ctx.get('credentials')
  } catch {
    return undefined
  }
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const provider = candidate as Partial<CredentialProviderLike>
  if (typeof provider.resolve !== 'function' || typeof provider.describe !== 'function') return undefined
  return provider as CredentialProviderLike
}

/**
 * Describe a reference without reading its value.
 *
 * @param provider - the credential service.
 * @param ref - the reference name.
 * @returns the described state, or `undefined` when even the description failed.
 */
export async function describeCredential(
  provider: CredentialProviderLike,
  ref: string,
): Promise<CredentialDescription | undefined> {
  try {
    const info = await provider.describe(ref as CredentialRef)
    if (typeof info !== 'object' || info === null) return undefined
    const out: CredentialDescription = { configured: info.configured === true, writable: info.writable === true }
    if (typeof info.source === 'string') out.source = info.source
    return out
  } catch {
    return undefined
  }
}

/**
 * Resolve the SMTP password for exactly one send attempt.
 *
 * Called inside the attempt, never before it and never reused afterwards. On
 * failure the diagnostics name the reference and include the `describe()`
 * result — the configured state and its source layer — and never the value.
 *
 * @param provider - the credential service, or `undefined` when absent.
 * @param ref - the reference name from configuration.
 * @returns the secret and its source, or diagnostics explaining its absence.
 */
export async function resolveSmtpPassword(
  provider: CredentialProviderLike | undefined,
  ref: string,
): Promise<CredentialOutcome> {
  if (provider === undefined) {
    return {
      message:
        `this profile mounts no Credential service, so the reference "${ref}" cannot be resolved; ` +
        'mount @deepseek-ai/dsh-credentials-local (the dsh-base bundle does) and configure the reference there',
    }
  }

  let resolved: ResolvedCredential | undefined
  try {
    resolved = await provider.resolve(ref as CredentialRef)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      message: `resolving the credential reference "${ref}" failed: ${detail.replace(/[\r\n]+/g, ' ')}`,
    }
  }

  if (resolved === undefined || typeof resolved.value !== 'string' || resolved.value === '') {
    const described = await describeCredential(provider, ref)
    const state =
      described === undefined
        ? 'describe() could not report its state'
        : `configured=${String(described.configured)}` +
          (described.source === undefined ? '' : ` source=${described.source}`) +
          ` writable=${String(described.writable)}`
    return {
      message:
        `the credential reference "${ref}" is not configured (${state}); ` +
        'set it in the process environment, in the provider-managed store, or in a .env file',
    }
  }

  return { value: resolved.value, message: `resolved from ${resolved.source}` }
}
