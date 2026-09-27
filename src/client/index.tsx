/**
 * Browser entry of `dsh-mail-notify` (`exports "./client"`).
 *
 * The DSH web boot loads this bundle through `window.__ModuleLoader__.load` and
 * activates the exported `apply` once the services named in `inject` are
 * available. The bundle is one self-contained classic script: it requires
 * exactly `react` and `react/jsx-runtime` at runtime, both of which the shell's
 * seed module table supplies, and everything it says about DSH beyond that is a
 * type-only import erased at build time.
 *
 * ## Where the card is contributed
 *
 * The card is a *bundle's* configuration, so it registers into
 * `plugins.bundle.config` — the keyed slot the Plugins page resolves with
 * `entryKey: pkg.name` — rather than into `plugins.item`. `plugins.item` is the
 * list slot of standalone cards in the page's Official group, whose entries are
 * occupied by one companion package per host-plane namespace; a bundle's
 * configuration belongs on the bundle's own page, and putting it anywhere else
 * would leave the form unreachable from the row it configures.
 *
 * The registration is wrapped in `ctx.configForms.whileServed`, so the
 * contribution exists only while the Host actually serves this entry's
 * configuration. A deployment that installs the package but disables the row
 * then shows no configuration section at all, rather than an empty one — which
 * is what keeps the page honest about what is loaded.
 *
 * `ctx.slots.inject` wraps `ctx.slots.register` because `dsh-client-ui-plugin-manager`
 * may load after this plugin; `inject` waits for the slot declaration and
 * installs the contribution when it arrives, so module load order stops being
 * something this plugin has to be right about.
 *
 * @module dsh-mail-notify/client
 */

import { SETTINGS_NAMESPACE } from '../protocol.ts'
import { MailNotifyCard, type MailNotifyCardFace } from './controller.ts'
import { MailNotifyCardView } from './Card.tsx'
import { BUNDLE_CONFIG_SLOT, MAIL_NOTIFY_PACKAGE_NAME, type ClientContext } from './contracts.ts'
import { MAIL_NOTIFY_NS, mailNotifyDictionaries } from './locale.ts'

/**
 * Client services this plugin's browser half requires before `apply` runs.
 *
 * `slots` is the renderer-owned slot registry the card registers into.
 * `configForms` is the shared form service the card reads and writes this
 * entry's configuration through; without it the card has nothing to edit.
 * `connection` carries the `/api` channel the delivery test and the status read
 * travel over. `remote.credentials` is the write-only credential namespace —
 * listed with its parent so the card cannot activate and then discover that the
 * one surface it writes secrets through is absent. `locale` is the DSH locale
 * registry the card's dictionaries register into and its `t` seat derives from.
 *
 * The list is explicit rather than wildcard on purpose: a package dependency
 * edge in `package.json` puts the module on the boot graph, and having the
 * module on the graph does not make the service available.
 */
export const inject: string[] = ['slots', 'configForms', 'connection', 'remote', 'remote.credentials', 'locale']

/**
 * Client plugin body invoked by the DSH web boot.
 *
 * One effect owns the whole browser half: the locale registration, the
 * controller, the slot contribution, and the credential-invalidation
 * subscription are all released by the same disposer, so the Cordis fiber has
 * exactly one thing to unwind. The dictionaries register before the card does:
 * the slot entry declares `locale: MAIL_NOTIFY_NS`, and rendering it requires
 * the namespace to be present in the registry.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const unregisterDictionaries = ctx.locale.register(MAIL_NOTIFY_NS, mailNotifyDictionaries)
    const card = new MailNotifyCard(ctx)
    const unregister = ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
      ctx.slots.inject(BUNDLE_CONFIG_SLOT, () =>
        ctx.slots.register(
          {
            name: BUNDLE_CONFIG_SLOT,
            // Keyed by the *package* name, because that is what the Plugins page
            // passes as `entryKey` when it resolves this slot for a bundle. The
            // entry id is not the key here — the two strings coincide today and
            // neither is derived from the other.
            key: MAIL_NOTIFY_PACKAGE_NAME,
            // Declaring the dictionary namespace is what puts the framework's
            // typed `t` seat on the card's props, re-derived per locale revision
            // so a language switch re-renders the mounted card.
            locale: MAIL_NOTIFY_NS,
            inject: (): MailNotifyCardFace => ({ card }),
          },
          MailNotifyCardView,
        ),
      ),
    )

    return () => {
      unregister()
      unregisterDictionaries()
      card.dispose()
    }
  }, 'dsh-mail-notify: configuration card')
}
