/**
 * Unit tests for the live-configuration seam.
 *
 * DSH 0.1.7 replaced the registered settings namespace with each entry's own
 * Config: the fields are `Volatile` references the Loader updates in place, and
 * `loader/volatile-update` is the signal that it committed them. What this
 * module owns is therefore no longer a merge — the settings service used to own
 * that — but the change signal and the snapshot boundary.
 *
 * The invariant the whole design rests on is asserted here as a structural
 * property rather than as a value: after a committed update, a snapshot taken
 * from the *same* binding returns the new value. A plugin that cached a copy at
 * mount time, or that re-read one field per consumer, would fail this and still
 * pass every notification test.
 *
 * @module dsh-mail-notify/tests/unit/settings
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../../src/config.ts'
import { SETTINGS_NAMESPACE } from '../../src/protocol.ts'
import { bindVolatileConfig } from '../../src/settings.ts'
import { commitVolatile } from '../support/plugin-harness.ts'
import { VALID_RAW_CONFIG } from '../support/harness.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Every field the Web card edits, in schema declaration order.
 *
 * Stated once and used by both projection tests below: the schema-derivation
 * test walks the serialized form, the settings test drives the installed
 * `volatileForm` over the live node, and a field that reaches one projection
 * but not the other must fail rather than pass in both.
 */
const EDITABLE_FIELDS = [
  'enabled',
  'smtpHost',
  'smtpPort',
  'smtpSecure',
  'smtpUser',
  'smtpPasswordCredential',
  'from',
  'to',
  'includeSubagents',
  'notifyCompleted',
  'notifyErrors',
  'notifyMaxTokens',
  'notifyQuestions',
  'notifyApprovals',
  'minTurnDurationMs',
  'maxBodyChars',
  'includeMetadata',
  'includeUserPrompt',
  'includeFooter',
  'queueSize',
  'retryAttempts',
  'retryBaseDelayMs',
  'maxDedupeEntries',
]

/** One node of a serialized Schemastery schema, resolved out of its ref table. */
interface SchemaNode {
  meta?: { volatile?: boolean }
  dict?: Record<string, number>
}

/** Build one volatile configuration from raw fields. */
function volatileConfig(overrides: Record<string, unknown> = {}) {
  return Config({ ...VALID_RAW_CONFIG, ...overrides } as never)
}

/* ── The snapshot boundary ─────────────────────────────────────────────── */

test('CFG-01 the snapshot carries every field as a primitive', () => {
  const binding = bindVolatileConfig(new Context(), volatileConfig())
  const snapshot = binding.snapshot()
  assert.equal(typeof snapshot.enabled, 'boolean')
  assert.equal(typeof snapshot.smtpPort, 'number')
  assert.equal(typeof snapshot.smtpHost, 'string')
  assert.equal(Array.isArray(snapshot.to), true)
  for (const [key, value] of Object.entries(snapshot)) {
    assert.notEqual(typeof value, 'function', `${key} reached the snapshot as a reference`)
    assert.equal(
      value === null || typeof value !== 'object' || Array.isArray(value),
      true,
      `${key} reached the snapshot as a live object`,
    )
  }
})

test('CFG-02 the snapshot is detached from the live references', () => {
  const config = volatileConfig()
  const binding = bindVolatileConfig(new Context(), config)
  const before = binding.snapshot()
  commitVolatile(config, volatileConfig({ smtpPort: 2525 }))
  assert.equal(before.smtpPort, 587, 'an earlier snapshot must not move under its reader')
  assert.equal(binding.snapshot().smtpPort, 2525)
})

test('CFG-03 the recipient array is copied, not aliased', () => {
  const binding = bindVolatileConfig(new Context(), volatileConfig({ to: ['a@example.com'] }))
  const snapshot = binding.snapshot()
  snapshot.to.push('injected@example.com')
  assert.deepEqual([...binding.snapshot().to], ['a@example.com'])
})

test('CFG-04 the safe defaults survive a configuration that names nothing', () => {
  // The schema resolves an absent document, which is what makes the plugin
  // mountable from a patch row that carries only `enabled: false`.
  const binding = bindVolatileConfig(new Context(), Config({ enabled: false } as never))
  const snapshot = binding.snapshot()
  assert.equal(snapshot.enabled, false)
  assert.equal(snapshot.notifyErrors, false)
  assert.equal(snapshot.notifyQuestions, false)
  assert.equal(snapshot.notifyApprovals, false)
  assert.equal(snapshot.includeSubagents, false)
  assert.equal(snapshot.includeUserPrompt, false)
  assert.equal(snapshot.notifyCompleted, true)
  assert.equal(snapshot.notifyMaxTokens, true)
})

/* ── The change signal ─────────────────────────────────────────────────── */

test('CFG-05 a committed volatile update signals every subscriber', () => {
  const config = volatileConfig()
  const binding = bindVolatileConfig(new Context(), config)
  let calls = 0
  binding.subscribe(() => {
    calls += 1
  })
  commitVolatile(config, volatileConfig({ notifyQuestions: true }))
  binding.signal()
  assert.equal(calls, 1)
  assert.equal(binding.snapshot().notifyQuestions, true)
})

test('CFG-06 an unsubscribed listener is not called', () => {
  const binding = bindVolatileConfig(new Context(), volatileConfig())
  let calls = 0
  const off = binding.subscribe(() => {
    calls += 1
  })
  off()
  binding.signal()
  assert.equal(calls, 0)
})

test('CFG-07 one throwing subscriber does not stop the others', () => {
  const binding = bindVolatileConfig(new Context(), volatileConfig())
  let reached = 0
  binding.subscribe(() => {
    throw new Error('subscriber refused to react')
  })
  binding.subscribe(() => {
    reached += 1
  })
  binding.signal()
  assert.equal(reached, 1, 'the second subscriber must still be told')
})

test('CFG-08 the signal is scoped to the plugin fiber that registered it', async () => {
  // The Loader emits through a context filtered to the owning fiber, so a
  // binding created on one fiber must not answer another fiber's dispatch.
  const owner = new Context()
  const outsider = new Context()
  const config = volatileConfig()
  const binding = bindVolatileConfig(owner, config)
  let calls = 0
  binding.subscribe(() => {
    calls += 1
  })
  outsider.emit('loader/volatile-update', [])
  assert.equal(calls, 0, 'a sibling fiber must not move this binding')
  owner.emit('loader/volatile-update', [])
  assert.equal(calls, 1)
})

test('CFG-09 disposing the owning fiber stops the signal', async () => {
  const ctx = new Context()
  const child = ctx.extend()
  const binding = bindVolatileConfig(child as never, volatileConfig())
  let calls = 0
  binding.subscribe(() => {
    calls += 1
  })
  await (child as unknown as { fiber: { dispose: () => Promise<void> } }).fiber.dispose()
  ctx.emit('loader/volatile-update', [])
  assert.equal(calls, 0, 'an unloaded plugin must not react to configuration changes')
})

/* ── The namespace / entry-id contract ─────────────────────────────────── */

test('CFG-10 the settings namespace is the profile entry id the bundle declares', () => {
  assert.equal(SETTINGS_NAMESPACE, 'dsh-mail-notify')
  assert.match(SETTINGS_NAMESPACE, /^[a-z][a-z0-9-]*$/)
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(
    patch,
    new RegExp(`^\\s*- id: ${SETTINGS_NAMESPACE}$`, 'm'),
    'the bundle patch must declare a row under the namespace the card binds to',
  )
})

test('CFG-11 the schema exposes every field the Web card edits', () => {
  // `toJSON()` serializes shared and recursive references as a `{ uid, refs }`
  // table, and a child node appears in its parent as the *number* of its uid
  // rather than inline. The Host's projection resolves that table the same way,
  // so walking it here is what makes this test a statement about the form the
  // page renders rather than about the schema object in memory.
  const serialized = Config.toJSON() as unknown as { uid: number; refs: Record<number, SchemaNode> }
  const form = serialized.refs[serialized.uid]
  const fields = Object.keys(form?.dict ?? {})
  assert.deepEqual(fields.sort(), [...EDITABLE_FIELDS].sort())
  for (const field of fields) {
    assert.equal(
      serialized.refs[form?.dict?.[field] as number]?.meta?.volatile,
      true,
      `${field} is not volatile, so a Web edit could not reach the running plugin without a restart`,
    )
  }
})

test('CFG-13 the installed settings projection still sees every field of the checked Config', async () => {
  // `Config` is not the plain field schema: `withProductChecks` derives the
  // exported node so the Host can refuse a product-invalid save. This test drives
  // the *installed* `dsh-settings` walk over that node rather than a copy of it,
  // because the walk is what the Plugins page renders from and what
  // `SettingsForms.write` projects a patch through. The module is reached by path
  // because the package's export map publishes only `.` and `./types`, and the
  // projection helpers are not re-exported from either.
  const schemaModule = join(root, 'node_modules', '@deepseek-ai', 'dsh-settings', 'lib', 'types', 'schema.js')
  const settings = (await import(pathToFileURL(schemaModule).href)) as {
    plainConfig(value: unknown): Record<string, unknown>
    volatileForm(schema: unknown): Record<string, unknown> | undefined
    isVolatilePath(schema: unknown, path: readonly string[]): boolean
  }

  const form = settings.volatileForm(Config) as { dict?: Record<string, unknown>; '~standard': { validate(value: unknown): { issues?: unknown } } }
  assert.ok(form !== undefined, 'a Config whose fields were not volatile would render no form at all')
  assert.deepEqual(Object.keys(form.dict ?? {}).sort(), [...EDITABLE_FIELDS].sort())
  assert.equal(
    Object.values(form.dict ?? {}).every((field) => (field as { meta?: { volatile?: unknown } }).meta?.volatile === undefined),
    true,
    'the form schema must be the field-level projection, with the volatile markers stripped',
  )

  // The form is not the enforcement point. A document the Host would refuse has
  // to stay renderable, or the user could not repair what the Host rejected.
  assert.equal(form['~standard'].validate({ enabled: true, smtpHost: '', to: [] }).issues, undefined)
  assert.ok(Array.isArray(form['~standard'].validate({ enabled: false, smtpPort: 99_999 }).issues))

  // The values the form is filled from are the volatile tree's primitives.
  const plain = settings.plainConfig(Config({ ...VALID_RAW_CONFIG } as never))
  assert.deepEqual(Object.keys(plain).sort(), [...EDITABLE_FIELDS].sort())
  assert.equal(plain['smtpHost'], 'smtp.example.com')

  assert.equal(settings.isVolatilePath(Config, ['smtpHost']), true)
  assert.equal(settings.isVolatilePath(Config, ['notAField']), false)
})

test('CFG-12 the retired settings seam is not reachable from this plugin', async () => {
  // The prohibition is a fact about the installed DSH, not about this plugin's
  // care: `installSection` does not exist on the service, so a shim could only
  // pretend. Asserting it here means the day DSH changes its mind, a test says
  // so rather than a runtime error in someone's profile.
  const settings = await import('@deepseek-ai/dsh-settings')
  const prototype = settings.SettingsForms.prototype as unknown as Record<string, unknown>
  assert.equal(typeof prototype['installSection'], 'undefined')
  for (const present of ['describe', 'update', 'replace', 'mutate', 'configure']) {
    assert.equal(typeof prototype[present], 'function', `${present} is missing from the target seam`)
  }
})
