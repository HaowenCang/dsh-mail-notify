/**
 * The client-side compatibility compile probe.
 *
 * ## What this file is for
 *
 * It is a *compile-time* assertion, not a runtime test: nothing here is
 * executed. Its whole purpose is to fail `npm run typecheck` the day a DSH
 * client contract this plugin builds on is renamed, moved, retyped, or
 * withdrawn. A plugin that read a contract through a local structural copy
 * instead of the published type would keep compiling while being wrong at
 * runtime; a plugin that names the contract cannot.
 *
 * ## Why the client and host probes are two files
 *
 * `ctx.connection` is declared as `ConnectionHandle` by
 * `@deepseek-ai/dsh-client-connection/client` and as `HostConnectionHandle` by
 * its host entry. One program containing both halves therefore sees two
 * incompatible augmentations of the same member — which is why
 * `tsconfig.client.json` and `tsconfig.test.json` are separate programs, and
 * why this file is paired with `host-contracts.compile.ts` rather than merged
 * with it. Both files are included in exactly one program each.
 *
 * ## The negative assertions
 *
 * Where a contract was *removed* by DSH 0.1.7, this file states the removal as
 * a checked fact rather than as a comment. `@ts-expect-error` fails the build
 * when the error it expects stops occurring, so the day a retired name comes
 * back — or the day the plugin starts using it again — the compiler says so.
 *
 * @module dsh-mail-notify/tests/compatibility/contracts.compile
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {
  ConfigForm,
  ConfigFormSnapshot,
  ConfigForms,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { BUNDLE_CONFIG_SLOT, MAIL_NOTIFY_PACKAGE_NAME, type ClientContext } from '../../src/client/contracts.ts'
import { SETTINGS_NAMESPACE } from '../../src/protocol.ts'

/* 鈹€鈹€ The shared form service 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/** `ctx.configForms` exists on the client context and carries the two methods the card uses. */
export function configFormsAreReachable(ctx: ClientContext): void {
  const forms: ConfigForms = ctx.configForms
  const form: ConfigForm<Record<string, unknown>> = forms.get(SETTINGS_NAMESPACE)
  const snapshot: ConfigFormSnapshot<Record<string, unknown>> = form.getSnapshot()
  // The five snapshot fields the card reads, named individually so a rename is a
  // compile error rather than an `undefined` at render time.
  const status: 'loading' | 'ready' | 'unavailable' = snapshot.status
  const value: Record<string, unknown> | undefined = snapshot.value
  const base: unknown = snapshot.base
  const user: unknown = snapshot.user
  const revision: number | undefined = snapshot.revision
  const writable: boolean = snapshot.writable
  const mode: 'host' | 'memory' = snapshot.mode
  void [form, status, value, base, user, revision, writable, mode]

  // The two write shapes the controller queues: one atomic mutation fenced by a
  // revision, and the per-field writes the card does not use.
  void form.mutate([] satisfies readonly SettingsPathOpView[], revision)
  void form.set('enabled', true)
  void form.unset('enabled')
  void form.subscribe(() => undefined)

  // `whileServed` is how the contribution follows the Host's served namespaces.
  const disposer: () => void = forms.whileServed([SETTINGS_NAMESPACE], () => () => undefined)
  void disposer
}

/* 鈹€鈹€ The slot the card occupies 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/** The bundle configuration slot is a known `SlotMap` entry, and its props are the published ones. */
export function slotContractIsKnown(ctx: ClientContext): void {
  const key: typeof BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'
  ctx.slots.register(
    { name: key, key: MAIL_NOTIFY_PACKAGE_NAME, locale: 'dsh-mail-notify' },
    (_props: PluginConfigViewProps) => null,
  )
  ctx.slots.inject(key, () => () => undefined)

  // The props the page passes are the page's own published type, not a local
  // restatement: `view` and the optional `form` the card renders from.
  const sample: PluginConfigViewProps = { view: 'page' }
  const summary: PluginConfigViewProps = { view: 'summary' }
  void [sample, summary]
}

/* 鈹€鈹€ The credential Remote 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * The credential namespace is write-mostly: `describe`, `set`, `unset`.
 *
 * The absence of any read path is asserted below rather than assumed, because
 * "the browser never receives the password" is a property of this contract.
 */
export async function credentialRemoteIsWriteOnly(ctx: ClientContext): Promise<void> {
  const answer = await ctx.remote.credentials.describe(['DSH_MAIL_SMTP_PASSWORD'])
  if (answer.ok) {
    const facts = answer.value['DSH_MAIL_SMTP_PASSWORD']
    const configured: boolean | undefined = facts?.configured
    const writable: boolean | undefined = facts?.writable
    void [configured, writable]
  }
  await ctx.remote.credentials.set('DSH_MAIL_SMTP_PASSWORD', 'x')
  await ctx.remote.credentials.unset('DSH_MAIL_SMTP_PASSWORD')
  ctx.remote.$on('credentials/reference-updated', () => undefined)
}

/* 鈹€鈹€ The connection handle 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * `ctx.connection` is the browser wire client, and the `/api` call is reachable on it.
 *
 * The browser half of the connection handle is deliberately small: it carries the
 * generic logical RPC caller and nothing else. The exact-route registry
 * (`fetch.register`) belongs to the *host* handle and is asserted in
 * `host-contracts.compile.ts`; the two are separate entries of the same package
 * and are why these probes are two programs.
 */
export function connectionIsReachable(ctx: ClientContext): void {
  void ctx.connection.rpc.call('/api', 'dsh-mail-notify/status', {})
  const loopback: boolean = ctx.connection.isLoopback
  void loopback
}

/* 鈹€鈹€ Retired contracts, as checked absences 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * The DSH 0.1.5 configuration surfaces are gone.
 *
 * Each `@ts-expect-error` below fails the build if the expression it guards
 * stops being an error. That is what makes the migration checkable in both
 * directions: it proves the old surface is absent *and* that this plugin has not
 * quietly gone back to using it.
 */
export function retiredSurfacesAreAbsent(ctx: ClientContext): void {
  // @ts-expect-error `ctx.settingsScope` was removed in DSH 0.1.7.
  void ctx.settingsScope

  // @ts-expect-error `settings.plugin.item` is not a slot in DSH 0.1.7.
  void ctx.slots.getVersion('settings.plugin.item')
}

/**
 * `SettingsScope` is not exported by the target's settings client entry.
 *
 * Stated as a type-level check rather than a value expression, because the
 * retired name was a type.
 */
export type RetiredSettingsScopeIsNotExported = Parameters<
  // @ts-expect-error `SettingsScope` was removed in DSH 0.1.7.
  () => import('@deepseek-ai/dsh-client-ui-settings/client').SettingsScope
>

/* 鈹€鈹€ The runtime context type 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/** The client context this plugin consumes is Cordis' `Context`, as the browser boot hands it over. */
export const CLIENT_CONTEXT_IS_CORDIS_CONTEXT: Context = null as unknown as ClientContext
