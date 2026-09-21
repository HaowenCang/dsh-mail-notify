/**
 * Unit tests for the user-settings seam.
 *
 * The precedence this module implements is the whole point of the feature:
 * schema defaults, then the composition entry, then the user document. The
 * merge itself belongs to the installed DSH settings service, so what is
 * asserted here is the plugin's own contract with it — that it registers the
 * composition entry as the namespace's base, that it follows whatever source
 * the provider declares authoritative, and that it is authoritative by itself
 * on a deployment that mounts no provider at all.
 *
 * @module dsh-mail-notify/tests/unit/settings
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import type { SettingsSectionHooks } from '@deepseek-ai/dsh-settings'
import { type ConfigValue } from '../../src/config.ts'
import { bindEffectiveConfig, SETTINGS_NAMESPACE } from '../../src/settings.ts'

/** One recorded `installSection` call. */
interface Recorded {
  ns: string
  entry: unknown
  schema: unknown
  hooks: SettingsSectionHooks<ConfigValue>
}

/**
 * The recorder the currently mounted fake provider writes into.
 *
 * Module-scoped rather than static on the class: a static would leak the
 * previous test's registration into the next one, and a test that passes
 * because of a leftover from its predecessor is worse than no test.
 */
let recorder: Recorded[] = []

/**
 * A stand-in for the installed settings provider.
 *
 * It publishes under the real service name so the plugin's scoped `inject`
 * finds it exactly as it would in a deployment, and it records the registration
 * instead of resolving a document. Driving `hooks` directly is then the same
 * act the real provider performs on attach, detach, and commit.
 */
class FakeSettingsProvider extends Service {
  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  installSection<const N extends string, T>(
    owner: Context,
    ns: N,
    schema: z<T>,
    entry: T,
    hooks: SettingsSectionHooks<T>,
  ): void {
    void owner
    recorder.push({ ns, entry, schema, hooks: hooks as unknown as SettingsSectionHooks<ConfigValue> })
  }
}

/**
 * Bind a plugin configuration against a freshly mounted fake provider.
 *
 * The registration is installed through Cordis' scoped `inject`, which settles
 * on a later turn rather than inline, so the wait below is part of the
 * contract being tested rather than test flakiness being papered over.
 *
 * @param entry - the composition entry to register as the namespace base.
 * @returns the binding, the recorded registration, and a disposer.
 */
async function bindWithProvider(entry: ConfigValue): Promise<{
  binding: ReturnType<typeof bindEffectiveConfig>
  recorded: Recorded
  dispose: () => Promise<void>
}> {
  recorder = []
  const ctx = new Context()
  await ctx.plugin(FakeSettingsProvider)
  const child = ctx.extend()
  const binding = bindEffectiveConfig(child as never, entry)
  for (let attempt = 0; attempt < 100 && recorder.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const recorded = recorder[0]
  assert.ok(recorded !== undefined, 'the provider must have received a registration')
  return {
    binding,
    recorded,
    dispose: () => (child as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose(),
  }
}

test('SET-01 the namespace is the name both halves and the card key on', () => {
  assert.equal(SETTINGS_NAMESPACE, 'dsh-mail-notify')
  // The DSH namespace grammar is a lowercase hyphenated identifier: a name that
  // failed it would be refused by the provider at registration.
  assert.match(SETTINGS_NAMESPACE, /^[a-z][a-z0-9-]*$/)
})

test('SET-02 the composition entry is registered as the namespace base', async () => {
  const entry = { enabled: false } as ConfigValue
  const { binding, recorded, dispose } = await bindWithProvider(entry)

  assert.equal(recorded.ns, SETTINGS_NAMESPACE)
  assert.equal(recorded.entry, entry, 'the entry itself is the base layer, not a copy')
  assert.equal(typeof recorded.schema, 'function', 'the namespace schema is the plugin schema')
  // Until the provider declares a source, the entry is what the plugin runs on.
  assert.equal(binding.current(), entry)
  await dispose()
})

test('SET-03 the plugin follows whatever source the provider declares authoritative', async () => {
  const entry = { enabled: false } as ConfigValue
  const { binding, recorded, dispose } = await bindWithProvider(entry)

  // Attach: the provider hands over the resolved section, then announces it.
  let notified = 0
  binding.subscribe(() => {
    notified += 1
  })
  const resolvedSection = { enabled: true, smtpHost: 'smtp.example.com' } as ConfigValue
  recorded.hooks.setSource(() => resolvedSection)
  recorded.hooks.onChange()

  assert.equal(binding.current(), resolvedSection)
  assert.equal(binding.attached(), true)
  assert.equal(notified, 1, 'an attach is announced to every subscriber')

  // A committed change is announced the same way, and the new source wins.
  const next = { enabled: true, smtpHost: 'other.example.com' } as ConfigValue
  recorded.hooks.setSource(() => next)
  recorded.hooks.onChange()
  assert.equal(binding.current(), next)
  assert.equal(notified, 2)

  await dispose()
})

test('SET-04 detach falls back to the composition entry', async () => {
  const entry = { enabled: false } as ConfigValue
  const { binding, recorded, dispose } = await bindWithProvider(entry)

  recorded.hooks.setSource(() => ({ enabled: true }) as ConfigValue)
  recorded.hooks.onChange()
  assert.notEqual(binding.current(), entry)

  // The provider's documented detach sequence: the entry is handed back as the
  // source before the matching announcement.
  recorded.hooks.setSource(() => entry)
  recorded.hooks.onChange()
  assert.equal(binding.current(), entry)
  await dispose()
})

test('SET-05 a throwing subscriber cannot break the settings commit', async () => {
  const entry = { enabled: false } as ConfigValue
  const { binding, recorded, dispose } = await bindWithProvider(entry)

  const seen: string[] = []
  binding.subscribe(() => {
    seen.push('first')
    throw new Error('a broken listener')
  })
  binding.subscribe(() => {
    seen.push('second')
  })

  // The provider is mid-fan-out here: a rejection that escaped would surface as
  // a failure of the user's *write*, not of the plugin that could not react.
  assert.doesNotThrow(() => {
    recorded.hooks.onChange()
  })
  assert.deepEqual(seen, ['first', 'second'])
  await dispose()
})

test('SET-06 a deployment with no settings provider keeps the composition entry', async () => {
  // The unit and integration suites, and any headless profile, mount no
  // provider. The binding must then be inert rather than absent, so the
  // plugin's behaviour is exactly what it was before the namespace existed.
  const ctx = new Context()
  const child = ctx.extend()
  const entry = { enabled: true } as ConfigValue
  const binding = bindEffectiveConfig(child as never, entry)

  assert.equal(binding.current(), entry)
  assert.equal(binding.attached(), false)
  const off = binding.subscribe(() => {
    throw new Error('nothing can move this source, so nothing may be announced')
  })
  off()
  await (child as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
})
