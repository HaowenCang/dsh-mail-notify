/**
 * The credential provider for the Phase 8 end-to-end probe.
 *
 * The probe must exercise the production credential path — resolve inside the
 * send attempt, never cache, never re-read the value — without putting a real
 * secret anywhere near the loopback server. It publishes the same
 * `credentials` service shape the shipped provider publishes, backed by one
 * environment variable, so the plugin's own code path (including its
 * `credential-missing` diagnostic and its per-attempt resolution) is unchanged.
 *
 * This is the same seam `tests/support/plugin-harness.ts` uses; the probe needs
 * it in-process because the run is a real booted DSH tree rather than a mounted
 * plugin under a test context.
 *
 * @module dsh-mail-notify/scripts/probe/fake-credentials
 */

import { Service } from '@deepseek-ai/cordis'

/** The one reference the probe's configuration names. */
const REF = 'credentials/smtp-password'
/** The environment variable holding the synthetic value. */
const ENV_NAME = 'PROBE_SMTP_PASSWORD'

/** Credential service double: resolves the probe reference from the environment. */
class ProbeCredentials extends Service {
  /** How many times the value was resolved; the probe reports it. */
  resolveCount = 0

  constructor(ctx) {
    super(ctx, 'credentials')
  }

  /**
   * Resolve one reference the way the shipped store resolves it.
   *
   * @param ref - the reference name from configuration.
   * @returns the value and its provenance layer, or `undefined` when unset.
   */
  resolve(ref) {
    if (String(ref) !== REF) return Promise.resolve(undefined)
    const value = process.env[ENV_NAME]
    if (value === undefined || value === '') return Promise.resolve(undefined)
    this.resolveCount += 1
    return Promise.resolve({ value, source: 'probe-environment' })
  }

  /**
   * Describe a reference without reading its value.
   *
   * @param ref - the reference name from configuration.
   * @returns the presence and writability facts.
   */
  describe(ref) {
    const configured = String(ref) === REF && (process.env[ENV_NAME] ?? '') !== ''
    return Promise.resolve({ configured, source: 'probe-environment', writable: false })
  }
}

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-credentials'

/**
 * Publish the provider on the plugin's own fiber.
 *
 * @param ctx - the plugin's fiber context.
 */
export function apply(ctx) {
  ctx.plugin(ProbeCredentials)
}
