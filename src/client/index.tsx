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
 * The card is contributed through `ctx.slots.inject` rather than
 * `ctx.slots.register` directly. The `settings.plugin.item` slot is declared by
 * `dsh-client-ui-settings-plugins`, which may load after this plugin; `inject`
 * waits for the declaration and installs the contribution when it arrives, so
 * module load order stops being something this plugin has to be right about.
 *
 * ## Two locale edges, and why both are needed
 *
 * The dictionary travels the same route DSH's own plugin cards use: `register`
 * publishes this plugin's copy under its namespace in every shipped locale, and
 * `locale: LOCALE_NAMESPACE` at the registration site is what makes the
 * renderer synthesize the `t` seat on the card's props. Declaring the namespace
 * only at the registration site is not enough — a registration whose dictionary
 * was never registered renders keys at the user — and registering the
 * dictionary only is not enough either, because nothing would bind it to the
 * component.
 *
 * Neither edge substitutes `navigator.language` for the DSH locale. The active
 * language is whatever `ctx.locale` resolved: an explicit DSH preference when
 * one is stored, the browser's ordered language list only as the service's own
 * provisional fallback, and English when neither names a registered language.
 *
 * @module dsh-mail-notify/client
 */

import { SETTINGS_NAMESPACE } from '../protocol.ts'
import { MailNotifyCard, type MailNotifyCardFace } from './controller.ts'
import { MailNotifyCardView } from './Card.tsx'
import { SETTINGS_PLUGIN_ITEM_SLOT, type ClientContext } from './contracts.ts'
import { en, LOCALE_NAMESPACE, zh } from './locales/index.ts'

/**
 * Client services this plugin's browser half requires before `apply` runs.
 *
 * `slots` is the renderer-owned slot registry the card registers into.
 * `locale` is the browser locale registry the card's copy is registered with
 * and translated through. `settingsScope` is the settings transport the card
 * reads and writes the `dsh-mail-notify` namespace through; without it the card
 * has nothing to edit. `connection` carries the `/api` channel the delivery
 * test and the status read travel over. `remote.credentials` is the write-only
 * credential namespace — listed with its parent so the card cannot activate and
 * then discover that the one surface it writes secrets through is absent.
 *
 * The list is explicit rather than wildcard on purpose: a package dependency
 * edge in `package.json` puts the module on the boot graph, and having the
 * module on the graph does not make the service available.
 */
export const inject: string[] = [
  'slots',
  'locale',
  'settingsScope',
  'connection',
  'remote',
  'remote.credentials',
]

/**
 * Client plugin body invoked by the DSH web boot.
 *
 * One effect owns the whole browser half: the controller, the slot
 * contribution, the dictionary registration, and the credential-invalidation
 * subscription are all released by the same disposer, so the Cordis fiber has
 * exactly one thing to unwind.
 *
 * The dictionary is registered before the slot contribution on purpose. Both
 * are ordinary registrations and the order would not be observable through the
 * renderer's own revision counter, but registering copy first means a reader
 * following the fiber from top to bottom sees the dictionary exist before
 * anything can reference it.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const unregisterDict = ctx.locale.register(LOCALE_NAMESPACE, { zh, en })

    const card = new MailNotifyCard(ctx)
    const unregister = ctx.slots.inject(SETTINGS_PLUGIN_ITEM_SLOT, () =>
      ctx.slots.register(
        {
          name: SETTINGS_PLUGIN_ITEM_SLOT,
          // Keyed by the settings namespace, not by this plugin's package or
          // loader-row identity: the tab pairs a served namespace with a card
          // registered under that same key, and a key outside the served set is
          // never dispatched.
          key: SETTINGS_NAMESPACE,
          // The dictionary namespace. Declaring it is what puts the typed `t`
          // seat on the card's props and what makes the renderer re-derive that
          // seat when the active locale changes, so a language switch re-renders
          // the mounted card in the new language.
          locale: LOCALE_NAMESPACE,
          inject: (): MailNotifyCardFace => ({ card }),
        },
        MailNotifyCardView,
      ),
    )

    return () => {
      unregister()
      unregisterDict()
      card.dispose()
    }
  }, 'dsh-mail-notify: settings card')
}
