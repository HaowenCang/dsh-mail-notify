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
 * Every package on this graph is pinned to one exact `0.1.5-rc.2` release in
 * `devDependencies`. The pins matter because the whole `0.1.5-rc.2` client
 * family is published but *not* the `latest` dist-tag of these packages: an
 * unpinned install resolves an older client family into the same program, and
 * the two disagree about `SlotMap` and about the renderer's slot contract. The
 * contract probe in `tests/compatibility/contracts.compile.ts` fails to compile
 * if any contract below is renamed, moved, or withdrawn.
 *
 * The imports are type-only, so none of them reaches the emitted bundle: the
 * browser half requires exactly two modules at runtime — `react` and
 * `react/jsx-runtime` — both of which the shell's seed table supplies.
 *
 * @module dsh-mail-notify/client/contracts
 */

// `ctx.slots` — the renderer-owned slot registry — and the `slots/changed`
// event. Declared by this package's `client` entry.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// `PropsRuntime` plus the `SlotMap` declaration-merging table the slot contract
// is composed from.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// `ctx.settingsScope` — the per-namespace settings transport — and the
// `SettingsScope` / `SettingsScopeSnapshot` contracts the card reads through.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// `ctx.locale` — the browser locale registry — and the `LocaleNamespaceMap`
// merge point. This import is load-bearing twice over: it declares the service
// member the plugin's `inject` edge waits for, and it brings the merge table
// this file extends below into the program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// The `settings.plugin.item` SlotMap entry. Registering into a slot the program
// does not know is a compile error, so this import is what makes the card's
// registration site checkable rather than merely plausible.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// `ctx.remote` itself.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// The `credentials` Remote namespace: `describe`, `set`, `unset`, and the
// forwarded `credentials/reference-updated` invalidation. There is deliberately
// no read path in this namespace, which is what makes "the browser never reads
// the password" a property of the contract rather than of this plugin's care.
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MailNotifyLocaleKey } from './locales/vocabulary.ts'

/**
 * The card's dictionary namespace, declared into the locale merge table.
 *
 * Declaring it is what authorizes `locale: LOCALE_NAMESPACE` at the slot
 * registration site, which is in turn what makes the renderer synthesize the
 * `t` seat on the card's props. The seat and this declaration therefore cannot
 * disagree: `MailNotifyCardView` reads its translate function from its props,
 * and a registration that failed to declare this namespace would not compile
 * against that component.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the `dsh-mail-notify` plugin card. */
    'dsh-mail-notify': MailNotifyLocaleKey
  }
}

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
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The browser wire client, including the generic `/api` RPC channel. */
    connection: ConnectionHandle
  }
}

/** The slot key one plugin card occupies inside the plugin configuration tab. */
export const SETTINGS_PLUGIN_ITEM_SLOT = 'settings.plugin.item'

/** The client root context type this plugin's browser half consumes. */
export type ClientContext = Context

/** The card's props share supplied by the tab, plus the registrant's own face. */
export type SettingsPluginItemProps = PropsRuntime<typeof SETTINGS_PLUGIN_ITEM_SLOT>

/** The bound settings scope type for one namespace. */
export type { SettingsScope }
