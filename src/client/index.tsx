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
 * @module dsh-mail-notify/client
 */

import 'react/jsx-runtime'
import { SETTINGS_NAMESPACE } from '../protocol.ts'
import { MailNotifyCard, type MailNotifyCardFace } from './controller.ts'
import { MailNotifyCardView } from './Card.ts'
import { SETTINGS_PLUGIN_ITEM_SLOT, type ClientContext } from './contracts.ts'

/**
 * Client services this plugin's browser half requires before `apply` runs.
 *
 * `slots` is the renderer-owned slot registry the card registers into.
 * `settingsScope` is the settings transport the card reads and writes the
 * `dsh-mail-notify` namespace through; without it the card has nothing to edit.
 * `connection` carries the `/api` channel the delivery test and the status read
 * travel over. `remote.credentials` is the write-only credential namespace —
 * listed with its parent so the card cannot activate and then discover that the
 * one surface it writes secrets through is absent.
 *
 * The list is explicit rather than wildcard on purpose: a package dependency
 * edge in `package.json` puts the module on the boot graph, and having the
 * module on the graph does not make the service available.
 */
export const inject: string[] = ['slots', 'settingsScope', 'connection', 'remote', 'remote.credentials', 'locale']

/**
 * Client plugin body invoked by the DSH web boot.
 *
 * One effect owns the whole browser half: the controller, the slot
 * contribution, and the credential-invalidation subscription are all released
 * by the same disposer, so the Cordis fiber has exactly one thing to unwind.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
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
          inject: (): MailNotifyCardFace => ({ card }),
        },
        MailNotifyCardView,
      ),
    )

    return () => {
      unregister()
      card.dispose()
    }
  }, 'dsh-mail-notify: settings card')
}
