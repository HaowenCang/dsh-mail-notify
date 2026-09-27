/**
 * The live-configuration seam.
 *
 * ## What replaced the old settings bridge
 *
 * Through DSH 0.1.5 this module bound the plugin to `ctx.settings.installSection`
 * — a namespace the plugin registered, whose base layer was the composition
 * entry and whose overrides lived in the DSH user settings document. DSH 0.1.7
 * removed that seam: `ctx.settings` is now `SettingsForms`, a schema-driven form
 * service over each entry's own Config, and it exposes no `installSection`. The
 * plugin's editable configuration is therefore its Config schema
 * (`src/config.ts`), the profile patch is where edits are persisted, and the
 * Loader commits a volatile-only change into the running fiber's references
 * without a remount.
 *
 * There is deliberately no compatibility shim that pretends `installSection`
 * exists. A shim would have to reimplement the merge that the settings service
 * used to own, giving the plugin a second opinion about the same document — and
 * the plugin would still be reading nothing, because the form the user edits is
 * generated from the Config schema rather than from a registered namespace.
 *
 * ## What this module owns
 *
 * One thing: the change signal. A committed volatile update calls
 * `updateVolatile` on each changed reference and then emits
 * `loader/volatile-update` with the paths it moved. Config fields are stable
 * references whose `get()` always answers current, so a reader needs no event to
 * see new values — but it does need to know *when* to re-read them, because
 * mounting or standing down a runtime is a decision, not a read. This module
 * turns that event into a subscription the plugin can hang its remount on.
 *
 * The event arrives on the plugin's own fiber: the Loader dispatches it through
 * a context filtered to the owning fiber, so a plugin never observes another
 * plugin's configuration change.
 *
 * @module dsh-mail-notify/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { type ConfigSnapshot, type ConfigValue, snapshotOf } from './config.ts'
import { SETTINGS_NAMESPACE } from './protocol.ts'

/**
 * The Loader's committed-configuration-change event.
 *
 * `@deepseek-ai/cordis-plugin-loader` declares this on Cordis' `Events`
 * interface, and the declaration is what makes `ctx.on` checkable. That package
 * is not published to npm — it ships inside the DSH installation — so it cannot
 * be added as a dependency, and this module restates the signature instead.
 *
 * The restatement is deliberate and narrow. It gives the event name a type, so a
 * listener cannot be registered under a misspelling and silently never run,
 * which is the failure mode an untyped string would produce. The parameters are
 * the emitted `paths` — the config paths the Loader moved — and this plugin
 * ignores them: it re-reads the whole configuration rather than tracking which
 * fields moved, because a partial read is exactly what the snapshot boundary
 * exists to prevent. `tests/compatibility/contracts.compile.ts` asserts the
 * shape, so a change upstream fails a build rather than a runtime.
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile configuration values were committed into the running fiber.
     * @param paths - the config paths whose references were updated.
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * The settings namespace this plugin owns.
 *
 * Declared in `protocol.ts` because the browser half must not reach a host
 * module to learn it. Since DSH 0.1.7 a namespace *is* a profile entry id: the
 * configuration form is addressed as `ctx.configForms.get(entryId)`, so this
 * constant and the bundle patch row's `id` must agree. The compatibility suite
 * asserts that they do, against the shipped `cordis.patch.yml`.
 */
export { SETTINGS_NAMESPACE }

/**
 * How this plugin reaches its currently authoritative configuration.
 *
 * The configuration is live by construction — the references Cordis validated
 * are updated in place — so this interface carries no `current()` reader. A
 * caller that wants values calls {@link VolatileConfigBinding.snapshot}, which
 * collapses the whole tree at one instant; a caller that wants to *decide*
 * something on a change subscribes.
 */
export interface VolatileConfigBinding {
  /**
   * Read the whole configuration as one consistent snapshot of primitives.
   *
   * Every field is read exactly once, so an update landing between two reads
   * cannot produce a snapshot that contains both the old and the new value of a
   * single decision — `enabled`, most visibly.
   *
   * @returns the primitive snapshot.
   */
  snapshot(): ConfigSnapshot
  /**
   * Observe a committed volatile configuration change.
   *
   * @param listener - invoked after the Loader has committed new values into
   *   the references. Called synchronously from the Loader's own dispatch, so a
   *   listener must not block; a throwing listener is contained here.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Apply one committed configuration change.
   *
   * The Loader's event handler calls exactly this, and it is stated on the
   * interface so that behaviour which depends on a change — mounting, standing
   * down, rebuilding the queue — can be driven directly. A test that instead
   * re-emitted the raw event name would be exercising its own guess at the
   * dispatch rather than the handler the plugin actually installs.
   */
  signal(): void
}

/**
 * Bind the plugin's live configuration.
 *
 * @param ctx - the plugin's fiber context. The listener is attached to this
 *   fiber, so unloading the plugin removes it and no later volatile update can
 *   reach a disposed runtime.
 * @param config - the volatile configuration Cordis resolved from
 *   {@link import('./config.ts').Config}; the reference tree the Loader updates.
 * @returns the binding.
 */
export function bindVolatileConfig(ctx: Context, config: ConfigValue): VolatileConfigBinding {
  const listeners = new Set<() => void>()

  const signal = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        // The Loader calls its dispatch inside a `try` that logs and then
        // returns `true`, so a failure raised here would be swallowed there
        // rather than surfacing as a failed write. Containing it keeps the
        // guarantee explicit: a listener that cannot act on a valid
        // configuration reports it and leaves the write committed.
        ctx.logger('dsh-mail-notify').warn('settings.listener-failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  ctx.on('loader/volatile-update', () => {
    signal()
  })

  return {
    snapshot: () => snapshotOf(config),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    signal,
  }
}
