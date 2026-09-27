/**
 * Probe-side wrapper around the plugin under test.
 *
 * The plugin's `apply` returns its live runtime handle but does not publish it as
 * a Cordis service — the Web routes close over it, so nothing else needs to look
 * it up. A probe that wants to observe the *effective* runtime (rather than the
 * configuration document that describes it) therefore has to hold the return
 * value itself, and the only place that value is observable is the module whose
 * `apply` the Loader calls.
 *
 * This module is that place. It re-exports the plugin's own `name`, `inject`,
 * `Config`, and `apply` unchanged — the Loader sees exactly the module it would
 * have seen — and records what `apply` returns in `handleRef`. The recorder is
 * passive: it never calls into the runtime except in `capture()`, which the probe
 * invokes explicitly.
 *
 * Because `Config` is re-exported by identity, the Host boundary under test is
 * the plugin's real exported schema node, product checks included. A wrapper that
 * rebuilt the schema would be measuring itself.
 *
 * @module dsh-mail-notify/scripts/probe/mail-notify-probe-entry
 */

/**
 * The installed plugin, addressed relative to *this* file.
 *
 * This module is copied into the disposable profile beside the installed
 * package, so a relative specifier reaches the artifact the archive delivered
 * without depending on how a bare name would resolve from a probe directory.
 */
import { apply as pluginApply, Config, inject, name } from './node_modules/dsh-mail-notify/lib/index.js'

export { Config, inject, name }

/**
 * What the probe observes about the mounted runtime.
 *
 * `status` is read from the plugin's own status surface and `sendTestEmail`
 * performs one real delivery through the credential service and the transport;
 * both are the same calls the Web routes make on behalf of the browser.
 */
export const handleRef = {
  /** The handle `apply` returned, or `undefined` when it refused to mount. */
  handle: undefined,
}

/**
 * Mount the plugin under test, recording the handle it returns.
 *
 * @param ctx - the fiber context the Loader created for this row.
 * @param config - the resolved volatile configuration, as the Loader passes it.
 * @param internals - the plugin's own test seams; the probe supplies none.
 * @returns whatever the plugin's own `apply` returned.
 */
export function apply(ctx, config, internals) {
  const handle = pluginApply(ctx, config, internals)
  handleRef.handle = handle
  return handle
}
