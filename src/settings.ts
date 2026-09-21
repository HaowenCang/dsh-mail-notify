/**
 * The user-settings seam.
 *
 * The plugin's configuration has three layers, and this module exists to state
 * their precedence in one place rather than leaving it implicit in whichever
 * object happens to be read:
 *
 * 1. the `Config` schema defaults;
 * 2. the composition entry — the row a profile's `cordis.patch.yml` (or this
 *    package's own bundle layer) supplies;
 * 3. the DSH user settings document, written through the Web UI.
 *
 * Layers 2 and 3 are owned by the installed DSH settings service, not by this
 * plugin: `installSection` registers the composition entry as the namespace's
 * *base* layer and lets the provider resolve `base` under the stored user
 * section. Reproducing that merge here would give the plugin a second opinion
 * about the same document.
 *
 * The service is optional. A deployment that mounts no settings provider — the
 * unit and integration suites among them — keeps exactly the composition entry,
 * which is the behaviour this plugin had before the namespace existed.
 *
 * @module dsh-mail-notify/settings
 */

import type { Context } from '@deepseek-ai/cordis'
// Declaration-merge import: `@deepseek-ai/dsh-settings` augments Cordis' `Context`
// with `settings: SettingsProvider` and declares the `settings/*` events. It is
// the only reason `settingsCtx.settings` below type-checks.
import type {} from '@deepseek-ai/dsh-settings'
import { Config, type ConfigValue } from './config.ts'
import { SETTINGS_NAMESPACE } from './protocol.ts'

/**
 * The settings namespace this plugin owns.
 *
 * Declared in `protocol.ts` because both halves must agree on it and the
 * browser bundle must not reach a host module to learn it. Re-exported here so
 * that host-side callers read it beside the registration that uses it.
 */
export { SETTINGS_NAMESPACE }

/** How this plugin reaches its currently authoritative configuration. */
export interface EffectiveConfigBinding {
  /**
   * The raw configuration to validate and mount from.
   *
   * Returns the settings-resolved section while the namespace is attached, and
   * the composition entry otherwise. Never `undefined`: an unattached binding
   * answers with the entry it was constructed from.
   */
  current(): ConfigValue
  /**
   * Whether the DSH settings namespace is attached.
   *
   * Reported to the Web UI as a status fact. It is deliberately not used to
   * decide behaviour — {@link current} already answers correctly either way.
   */
  attached(): boolean
  /**
   * Observe a change of the authoritative configuration.
   * @param listener - invoked after the source is replaced.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Bind this plugin's configuration to the installed DSH settings namespace.
 *
 * The returned binding is live: once the provider attaches, `current()` follows
 * the settings-resolved section, and a committed write invokes every subscriber.
 *
 * @param ctx - the plugin's fiber context; also the namespace's owner, so the
 *   registration is removed when this plugin unloads.
 * @param entry - the composition entry, used as the namespace's base layer and
 *   as the answer while no provider is attached.
 * @returns the binding.
 */
export function bindEffectiveConfig(ctx: Context, entry: ConfigValue): EffectiveConfigBinding {
  // The composition entry is authoritative until the provider says otherwise.
  // `installSection` calls `setSource` at attach AND at detach (with the entry),
  // so this single assignment is the whole fallback mechanism.
  let source: () => ConfigValue = () => entry
  let attached = false
  const listeners = new Set<() => void>()

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, entry, {
      setSource: (current) => {
        source = current
      },
      onChange: () => {
        attached = true
        // A throwing subscriber must not corrupt the settings commit that
        // produced the change: the provider is mid-fan-out here, and a rejected
        // observer would surface as a failure of the *write* rather than of the
        // plugin that could not react to it.
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            ctx.logger('dsh-mail-notify').warn('settings.listener-failed', {
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
      },
    })
  })

  return {
    current: () => source(),
    attached: () => attached,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
