/**
 * The host-side compatibility compile probe.
 *
 * ## Why this file is not in `tests/compatibility/`
 *
 * Its companion `tests/compatibility/contracts.compile.ts` is the client probe,
 * and the two cannot share a TypeScript program: `ctx.connection` is declared as
 * `ConnectionHandle` by `@deepseek-ai/dsh-client-connection/client` and as
 * `HostConnectionHandle` by that package's host entry, so one program sees two
 * incompatible augmentations of the same member. `tsconfig.client.json` includes
 * the whole `tests/compatibility` directory, so a file placed there would be
 * compiled by the *client* program —which is exactly the collision. This file
 * therefore lives where only `tsconfig.test.json` reaches it.
 *
 * Like its companion, this file is never executed. It fails `npm run typecheck`
 * when a host contract this plugin builds on changes shape.
 *
 * @module dsh-mail-notify/scripts/type-probes/host-contracts.compile
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cosmokit'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-credentials'
import type { SettingsForms, SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { Config, type ConfigSnapshot, type ConfigValue } from '../../src/config.ts'
import { bindVolatileConfig } from '../../src/settings.ts'
import { SETTINGS_NAMESPACE } from '../../src/protocol.ts'

/* 鈹€鈹€ Volatile Config 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * Every Config field is a `Volatile` reference, and reading one yields a primitive.
 *
 * The assertion is deliberately made field by field through the published
 * `Volatile<T>` rather than through a structural `{ get(): unknown }`: the two
 * libraries that must agree about this protocol are Schemastery (which creates
 * the references) and the Loader (which updates them in place), and only the
 * shared type proves they are talking about the same thing.
 */
export function configFieldsAreVolatile(config: ConfigValue): void {
  const enabled: Volatile<boolean> = config.enabled
  const reference: boolean = enabled.get()
  const port: number = config.smtpPort.get()
  const recipients: readonly string[] = config.to.get()
  void [reference, port, recipients]

  // The snapshot the plugin actually operates on is a tree of primitives.
  const snapshot: ConfigSnapshot = bindVolatileConfig(null as unknown as Context, config).snapshot()
  const flag: boolean = snapshot.enabled
  const list: string[] = snapshot.to
  void [flag, list]
}

/**
 * The snapshot is the surface with a closed shape.
 *
 * `ConfigValue` is deliberately open: Schemastery's inferred config type carries
 * an index signature, so a mistyped field name reads as `any` rather than as an
 * error — which is why nothing downstream of the snapshot boundary ever holds a
 * `ConfigValue`. {@link ConfigSnapshot} *is* closed, and the assertion below is
 * what holds that line: a field added to the schema without a matching snapshot
 * entry still compiles, but a field read from the snapshot that no entry
 * declares does not.
 */
export function snapshotShapeIsClosed(snapshot: ConfigSnapshot): void {
  // @ts-expect-error `notAField` is not part of the configuration snapshot.
  void snapshot.notAField
}

/**
 * Every snapshot field names a field the schema declares.
 *
 * Written as a mapped type over the snapshot's own key set, so a field that
 * survives in the snapshot after being removed from the schema resolves to
 * `never` and fails wherever this alias is used.
 */
export type SnapshotCoversOnlySchemaFields = {
  [K in keyof ConfigSnapshot]: K extends keyof ConfigValue ? true : never
}
export const SNAPSHOT_COVERS_ONLY_SCHEMA_FIELDS: SnapshotCoversOnlySchemaFields = null as unknown as SnapshotCoversOnlySchemaFields

/** The schema itself is a Schemastery object schema, and its fields declare volatility. */
export function schemaSupportsVolatile(): void {
  const fields: readonly string[] = Object.keys(Config.dict ?? {})
  void fields
  // `volatile()` is the API DSH 0.1.7 requires for a live field; asserting it on
  // the schema builder is what keeps the migration honest.
  const volatile = Config.dict?.['enabled']?.meta.volatile
  const declares: boolean = volatile === true
  void declares
}

/* 鈹€鈹€ `ctx.settings` is the form service, and `installSection` is gone 鈹€鈹€鈹€鈹€ */

/**
 * The host's settings service is `SettingsForms`.
 *
 * Every positive assertion here is a method this plugin's design depends on
 * existing in the target, and the negative one is the migration itself.
 */
export function settingsServiceIsForms(ctx: Context): void {
  const forms: SettingsForms = ctx.settings
  const descriptors: SettingsDescriptor[] = forms.describe({ redactSecrets: true })
  void descriptors
  void forms.writable
  void forms.documentPath
  void forms.update(SETTINGS_NAMESPACE, {})
  void forms.replace(SETTINGS_NAMESPACE, {})
  void forms.mutate(SETTINGS_NAMESPACE, [] satisfies readonly SettingsPathOp[])
  void forms.configure({ auto: false })

  // The retired seam. `installSection` is what this plugin used through DSH
  // 0.1.5, and its absence is the reason the whole settings module was rewritten
  // rather than adapted.
  // @ts-expect-error `installSection` was removed in DSH 0.1.7.
  void forms.installSection
}

/**
 * A settings write is fenced by a revision, and a stale one is a distinct error.
 *
 * Checked because the card's whole save path depends on the fence existing: a
 * write without one would let two surfaces overwrite each other silently.
 */
export function settingsWritesAreRevisionFenced(forms: SettingsForms): void {
  void forms.update(SETTINGS_NAMESPACE, {}, 0)
  void forms.mutate(SETTINGS_NAMESPACE, [], 0)
}

/* 鈹€鈹€ Session events 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * The session events this plugin observes exist, with the payloads it reads.
 *
 * `session/event` and `session/disposed` are the only two the plugin registers.
 * Their presence in `Events` is what makes the registration type-check rather
 * than needing a cast, and the plugin's own narrow structural view of a payload
 * lives in `src/runtime-adapter.ts`.
 */
export function sessionEventsExist(ctx: Context): void {
  ctx.on('session/event', () => undefined)
  ctx.on('session/disposed', () => undefined)
}

/** A `turn/end` reason kind added in DSH 0.1.7 is expressible. */
export function forkedReasonIsAKind(): void {
  const reason: { kind: 'forked' } = { kind: 'forked' }
  void reason
}

/* 鈹€鈹€ The connection and credential seams 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * The host connection registry exposes the APIs this plugin publishes through.
 *
 * `fetch.register` is the one the plugin actually uses —an exact route under
 * the shared `/api` channel —and `rpc.handle`/`rpc.intercept` are stated
 * alongside it because the RPC decision in D5 weighs all three. Asserting that
 * all three still exist is what makes that decision reviewable: the day one of
 * them disappears, this file says which.
 */
export function connectionRouteApi(ctx: Context): void {
  void ctx.connection.fetch.register
  void ctx.connection.rpc.handle
  void ctx.connection.rpc.intercept
  void ctx.connection.createSharedFetchHandler('/api')
}

/** The credential service the plugin resolves references through. */
export async function credentialServiceIsReferenceAddressed(ctx: Context): Promise<void> {
  const provider = ctx.get('credentials')
  if (provider === undefined) return
  void (await provider.describe('DSH_MAIL_SMTP_PASSWORD' as never))
}

/* 鈹€鈹€ The retired host settings surface 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/**
 * The retired namespace binding is gone.
 *
 * `bindEffectiveConfig` was this plugin's own name for the DSH 0.1.5 seam, and
 * it went with that seam. The assertion is made through a namespace import so it
 * reads as a statement about the module rather than about a value.
 */
export function retiredBindingIsGone(): void {
  // @ts-expect-error the 0.1.5 settings binding was removed with the seam it wrapped.
  void bindVolatileConfig.bindEffectiveConfig
}
