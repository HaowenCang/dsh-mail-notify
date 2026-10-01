/**
 * The single statement of which DSH client contracts this plugin consumes.
 *
 * Every `import type {} from …` below is load-bearing. The DSH client surfaces
 * declare themselves by augmenting shared tables — `@deepseek-ai/cordis`
 * `Context` for services, `@deepseek-ai/dsh-client-ui-slots` `SlotMap` for
 * slots, `@deepseek-ai/dsh-typert-protocol` `TypertRemoteNamespaceMap` for
 * Remote namespaces — and TypeScript applies an augmentation only when the
 * declaring module is part of the program. Importing the declaring module is
 * therefore how a plugin states, in one auditable place, exactly which DSH
 * contracts it builds on.
 *
 * Every package on this graph is pinned to one exact `0.2.0-rc.2` release in
 * `devDependencies`. The pins matter because the whole `0.2.0-rc.2` client
 * family is published but *not* the `latest` dist-tag of these packages: an
 * unpinned install resolves an older client family into the same program, and
 * the two disagree about `SlotMap` and about the form service. The contract
 * probe in `tests/compatibility/contracts.compile.ts` fails to compile if any
 * contract below is renamed, moved, or withdrawn.
 *
 * The imports are type-only, so none of them reaches the emitted bundle: the
 * browser half requires exactly two modules at runtime — `react` and
 * `react/jsx-runtime` — both of which the shell's seed table supplies.
 *
 * ## What changed for DSH 0.1.7, and what did not change for DSH 0.2.0-rc.2
 *
 * `ctx.settingsScope` and the `settings.plugin.item` slot were removed in
 * `0.1.7-rc.2`. The card reads and writes through `ctx.configForms` — the shared
 * form service over the Host's describe mirror — and registers into the Plugins
 * page's bundle configuration slot. Both replacements are declared by packages
 * this module imports for their augmentations, so the registration site below is
 * checked against the installed contract rather than against a local
 * restatement.
 *
 * The `0.2.0-rc.2` migration changed no client contract this module names. The
 * form types, the slots package's `SlotMap`, the connection handle, the locale
 * registry, and the settings-controller Remote are identical to `0.1.7-rc.2`,
 * and the Plugins-page owner props differ only in type-only assembly imports.
 * The `form` prop on `PluginConfigViewProps` is — and already was — optional;
 * this card consequently reads its values from `ctx.configForms.get(...)` rather
 * than from the page's optional owner-supplied form, and the compile probe
 * states both the optionality and the field it does read. What *did* change in
 * `0.2.0-rc.2` is the Host-side session and interaction vocabulary, which the
 * companion probe `scripts/type-probes/host-contracts.compile.ts` asserts.
 *
 * @module dsh-mail-notify/client/contracts
 */

// `ctx.slots` — the renderer-owned slot registry — and the `slots/changed`
// event. Declared by this package's `client` entry.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// `PropsRuntime` plus the `SlotMap` declaration-merging table the slot contract
// is composed from.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// `ctx.configForms` — the shared form service over the Host describe mirror —
// and the `ConfigForm` / `ConfigFormSnapshot` contracts the card reads and
// writes through. Also the `plugins.*` slot contract is composed against the
// `ConfigForm` declared here, so this import is what makes the two agree.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// The `plugins.bundle.config` SlotMap entry. Registering into a slot the program
// does not know is a compile error, so this import is what makes the card's
// registration site checkable rather than merely plausible.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// `ctx.remote` itself.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// The `credentials` Remote namespace: `describe`, `set`, `unset`, and the
// forwarded `credentials/reference-updated` invalidation. There is deliberately
// no read path in this namespace, which is what makes "the browser never reads
// the password" a property of the contract rather than of this plugin's care.
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
// `ctx.locale` — the DSH locale registry (`LocaleRuntime`) and the
// `locale/change` event. Its `register`/`bind` entry points are the typed
// locale boundary this plugin's dictionary pair registers through, and the
// `LocaleNamespaceMap` merge in `locale.ts` is what makes them type-check
// against this plugin's own key union.
import type {} from '@deepseek-ai/dsh-client-locale/client'

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * The client root context DSH hands to a plugin's browser `apply`.
 *
 * The instance also carries `ctx.connection`, provided by
 * `@deepseek-ai/dsh-client-connection`'s browser half through
 * `ctx.provide('connection', handle)`. That package declares the service on
 * `Context` for its *host* entry only, so the client-side member is stated here.
 * The member type is the package's own published `ConnectionHandle` rather than
 * a restatement: a renamed method must break this file, not silently keep
 * compiling against a stale local copy.
 *
 * `configForms` needs no statement here: `@deepseek-ai/dsh-client-ui-settings/client`
 * declares it on `Context` directly, so this plugin consumes the published
 * member rather than a structural clone of it.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The browser wire client, including the generic `/api` RPC channel. */
    connection: ConnectionHandle
  }
}

/**
 * The slot one bundle's configuration occupies inside the Plugins page.
 *
 * A keyed slot: the page resolves it with `entryKey: pkg.name`, so the
 * registration must supply `key` — the *package* name — rather than `id`. The
 * page renders the entry with `view: 'page'` only; a bundle has no one-liner
 * position in this contract, and a registration that answered `view: 'summary'`
 * with content would never be drawn.
 */
export const BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'

/**
 * The npm package name this bundle is installed under.
 *
 * The Plugins page keys `plugins.bundle.config` by the *package* name, so this
 * constant is that key's only source. It is stated literally rather than read
 * from `package.json` because the browser bundle must not import a JSON manifest
 * at runtime, and the release check in `tests/package/tarball.test.ts` asserts
 * that the literal and the published `name` field agree.
 */
export const MAIL_NOTIFY_PACKAGE_NAME = 'dsh-mail-notify'

/** The client root context type this plugin's browser half consumes. */
export type ClientContext = Context

/**
 * The props the bundle configuration slot renders its entry with.
 *
 * Taken from the slot contract itself rather than restated, so a change to what
 * the page passes is a compile error at the card's signature. The card reads
 * `view` and `form`; `form.state` is the same `ConfigFormSnapshot` the
 * controller renders from, and `form.mutate` the same write the controller
 * queues —which is what lets the shared form and this plugin's staged drafts
 * agree without either restating the other.
 */
export type BundleConfigSlotProps = PluginConfigViewProps

/**
 * The shared form contract for one Host plugin entry.
 *
 * Re-exported under this plugin's own vocabulary so the controller and the
 * fields module do not each import the same two names from the DSH package; the
 * types themselves are the published ones.
 */
export type { ConfigForm, ConfigFormSnapshot }
