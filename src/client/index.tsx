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
 * ## Where the settings are contributed
 *
 * The settings page registers into `settings.section` — the Settings window's
 * page list (Ctrl+, in the desktop app; Ctrl+Alt+, in the browser) — as its own
 * navigation entry ("Email alerts" / "邮件通知") beside General and Models.
 * That is where DSH features keep their settings, and where a person looks for
 * them. An envelope icon goes into `settings.section.icon` under the same id.
 *
 * The page used to live in `plugins.bundle.config`, the configuration section
 * of the plugin's own Plugins → Installed detail page, three clicks deep. That
 * slot now carries only a one-line note pointing to the Settings page, so
 * anyone who still looks there is sent to the right place.
 *
 * Every registration is wrapped in `ctx.configForms.whileServed`, so the
 * contributions exist only while the Host actually serves this entry's
 * configuration. A deployment that installs the package but disables the row
 * then shows no settings page at all, rather than an empty one — which is what
 * keeps the Settings window honest about what is loaded.
 *
 * `ctx.slots.inject` wraps `ctx.slots.register` because the Settings shell and
 * `dsh-client-ui-plugin-manager` may load after this plugin; `inject` waits for
 * the slot declaration and installs the contribution when it arrives, so module
 * load order stops being something this plugin has to be right about.
 *
 * @module dsh-mail-notify/client
 */

import { SETTINGS_NAMESPACE } from '../protocol.ts'
import { MailNotifyCard, type MailNotifyCardFace } from './controller.ts'
import { MailNotifyCardView, MailNotifyMovedNotice, MailNotifyNavIcon } from './Card.tsx'
import {
  BUNDLE_CONFIG_SLOT,
  MAIL_NOTIFY_PACKAGE_NAME,
  SETTINGS_SECTION_ICON_SLOT,
  SETTINGS_SECTION_ID,
  SETTINGS_SECTION_ORDER,
  SETTINGS_SECTION_SLOT,
  type ClientContext,
} from './contracts.ts'
import { MAIL_NOTIFY_NS, mailNotifyDictionaries } from './locale.ts'

/**
 * Client services this plugin's browser half requires before `apply` runs.
 *
 * `slots` is the renderer-owned slot registry the page registers into.
 * `configForms` is the shared form service the page reads and writes this
 * entry's configuration through; without it the page has nothing to edit.
 * `connection` carries the `/api` channel the delivery test and the status read
 * travel over. `remote.credentials` is the write-only credential namespace —
 * listed with its parent so the page cannot activate and then discover that the
 * one surface it writes secrets through is absent. `locale` is the DSH locale
 * registry the page's dictionaries register into, its `t` seat derives from,
 * and its navigation label is translated through.
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
 * controller, the slot contributions, and the credential-invalidation
 * subscription are all released by the same disposer, so the Cordis fiber has
 * exactly one thing to unwind. The dictionaries register before the page does:
 * the slot entries declare `locale: MAIL_NOTIFY_NS`, and rendering them
 * requires the namespace to be present in the registry.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const unregisterDictionaries = ctx.locale.register(MAIL_NOTIFY_NS, mailNotifyDictionaries)
    // `bind` returns a translate that reads the active locale at call time, so
    // the navigation label thunk below follows a language switch without the
    // section being registered again.
    const translate = ctx.locale.bind(MAIL_NOTIFY_NS)
    const card = new MailNotifyCard(ctx)
    const face = (): MailNotifyCardFace => ({ card })

    const unregister = ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => {
      const offSection = ctx.slots.inject(SETTINGS_SECTION_SLOT, () =>
        ctx.slots.register(
          {
            name: SETTINGS_SECTION_SLOT,
            id: SETTINGS_SECTION_ID,
            order: SETTINGS_SECTION_ORDER,
            label: () => translate('navLabel'),
            // Declaring the dictionary namespace is what puts the framework's
            // typed `t` seat on the page's props, re-derived per locale revision
            // so a language switch re-renders the mounted page.
            locale: MAIL_NOTIFY_NS,
            inject: face,
          },
          MailNotifyCardView,
        ),
      )
      const offIcon = ctx.slots.inject(SETTINGS_SECTION_ICON_SLOT, () =>
        ctx.slots.register(
          {
            name: SETTINGS_SECTION_ICON_SLOT,
            // Must equal the section id: that is how the shell pairs them.
            id: SETTINGS_SECTION_ID,
          },
          MailNotifyNavIcon,
        ),
      )
      const offNotice = ctx.slots.inject(BUNDLE_CONFIG_SLOT, () =>
        ctx.slots.register(
          {
            name: BUNDLE_CONFIG_SLOT,
            // Keyed by the *package* name, because that is what the Plugins page
            // passes as `entryKey` when it resolves this slot for a bundle.
            key: MAIL_NOTIFY_PACKAGE_NAME,
            locale: MAIL_NOTIFY_NS,
          },
          MailNotifyMovedNotice,
        ),
      )
      return () => {
        offNotice()
        offIcon()
        offSection()
      }
    })

    return () => {
      unregister()
      unregisterDictionaries()
      card.dispose()
    }
  }, 'dsh-mail-notify: settings page')
}
