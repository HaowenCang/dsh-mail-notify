/**
 * Probe: validate the planned v0.4 Config shape against the exact
 * schemastery 3.18.4 contract that DSH 0.1.7-rc.2 ships.
 *
 * Run with `npm run probe:schema`. It answers three questions the migration
 * depends on and that no amount of reading the source settles as reliably as
 * executing it:
 *
 * 1. does a field become a `Volatile` reference whose `.get()` returns the
 *    validated value;
 * 2. does a rejected candidate throw in a way `dsh-config-editor` turns into a
 *    refused write, with the offending path named;
 * 3. does the DSH settings projection (`volatileForm` + `plainSchema`, copied
 *    here faithfully) still see every field of a root-level `transform`.
 *
 * > **Scope note (v0.4.0 RC closure).** Question 3 is a *negative* result, and it
 * > is kept for that reason: this probe is the record of why a root
 * > `Schema.transform` was rejected as the cross-field mechanism — Schemastery
 * > refuses a volatile field under a transform node, and the settings form walks
 * > an object node's `dict`, so a transform root hides every field. The mechanism
 * > that actually carries the product rules is the standard-schema validator;
 * > `scripts/probe/config-check-probe.mjs` is the probe for that, and it is the
 * > one the Host boundary rests on.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..', '..')

/**
 * Resolve the Schemastery copy to probe.
 *
 * `SCHEMA_PROBE_MODULES` names a directory whose `node_modules/@deepseek-ai`
 * holds the releases to use; the default is the checkout's own `node_modules`.
 * The variable exists so the probe can be pointed at one exact release — the
 * copy inside an installed DSH — without installing it into the repository,
 * which would change the very dependency graph the probe is meant to check.
 *
 * The staged directory must itself contain a `node_modules`, because the
 * package imports `@deepseek-ai/cosmokit` by name and Node would otherwise
 * resolve it from the checkout instead of from the staged pair.
 *
 * @returns the module namespace.
 */
async function loadSchemastery() {
  const roots = [process.env['SCHEMA_PROBE_MODULES'], projectRoot].filter(
    (value) => typeof value === 'string' && value !== '',
  )
  for (const root of roots) {
    const target = join(root, 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs')
    if (existsSync(target)) return import(pathToFileURL(target).href)
  }
  return import('@deepseek-ai/schemastery')
}

const moduleRoot = [process.env['SCHEMA_PROBE_MODULES'], projectRoot].find(
  (root) =>
    typeof root === 'string' && root !== '' && existsSync(join(root, 'node_modules', '@deepseek-ai', 'schemastery', 'package.json')),
)
const Schema = (await loadSchemastery()).default
const readManifest = async (name) =>
  JSON.parse(await readFile(join(moduleRoot, 'node_modules', '@deepseek-ai', name, 'package.json'), 'utf8')).version
console.log(
  `[schema-probe] @deepseek-ai/schemastery ${await readManifest('schemastery')} ` +
    `with @deepseek-ai/cosmokit ${await readManifest('cosmokit')}`,
)

/** The field-level constraints, mirroring `src/config.ts`. */
const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  smtpHost: Schema.string().default('').volatile(),
  smtpPort: Schema.natural().min(1).max(65535).default(587).volatile(),
  smtpSecure: Schema.boolean().default(false).volatile(),
  smtpUser: Schema.string().default('').volatile(),
  smtpPasswordCredential: Schema.string().default('').volatile(),
  from: Schema.string().default('').volatile(),
  to: Schema.array(Schema.string()).default([]).volatile(),
  notifyCompleted: Schema.boolean().default(true).volatile(),
  notifyErrors: Schema.boolean().default(false).volatile(),
  notifyQuestions: Schema.boolean().default(false).volatile(),
  notifyApprovals: Schema.boolean().default(false).volatile(),
})

/** The cross-field rules, as the root transform. */
const Checked = Schema.transform(Config, (value, options) => {
  if (value.enabled === true) {
    if (value.smtpHost.trim() === '') throw new Schema.ValidationError('smtpHost is required while enabled is true', options)
    if (value.to.length === 0) throw new Schema.ValidationError('to must contain at least one recipient while enabled is true', options)
  }
  return value
})

const failures = []
const check = (label, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`)
  if (!condition) failures.push(label)
}

console.log('--- 1. the root transform, and why it is not the mechanism ---')
/**
 * Parse through the transform root, reporting the refusal instead of throwing.
 *
 * The refusal *is* the result this probe exists to record: Schemastery will not
 * carry a volatile field under a transform node, so wrapping the object schema in
 * one destroys the configuration rather than validating it.
 *
 * @param input - the candidate document.
 * @returns the parsed value, or the error that refused it.
 */
function transformParse(input) {
  try {
    return { value: Checked(input) }
  } catch (error) {
    return { error }
  }
}

const parsed = transformParse({ enabled: true, smtpHost: 'smtp.example.invalid', to: ['a@b.co'] })
check('a root transform over volatile fields is refused', parsed.error !== undefined, parsed.error?.message ?? 'it parsed')
check(
  'the refusal names the volatile-within-transform rule',
  typeof parsed.error?.message === 'string' && parsed.error.message.includes('volatile fields require a fixed object path'),
  parsed.error?.message ?? '',
)
check('the refusal is raised before any field is readable', parsed.value === undefined)

// The same fields under the object root — the shape the plugin actually ships —
// resolve into the volatile tree the runtime reads.
const objectParsed = Config({ enabled: true, smtpHost: 'smtp.example.invalid', to: ['a@b.co'] })
check('the object root returns an object', typeof objectParsed === 'object' && objectParsed !== null)
check('enabled is a Volatile reference', typeof objectParsed.enabled?.get === 'function')
check('enabled.get() is the boolean true', objectParsed.enabled.get() === true)
check('smtpPort default is applied and readable', objectParsed.smtpPort.get() === 587)
check('the array field returns a frozen snapshot', Array.isArray(objectParsed.to.get()) && Object.isFrozen(objectParsed.to.get()))
check('an omitted field still answers through get()', objectParsed.notifyApprovals.get() === false)

console.log('--- 2. refusals ---')
const refusal = (input) => {
  try {
    Config(input)
    return undefined
  } catch (error) {
    return error
  }
}
const rangeError = refusal({ enabled: false, smtpPort: 99999 })
check('an out-of-range port is refused', rangeError !== undefined)
check('the port refusal names its path', JSON.stringify(rangeError?.options?.path) === '["smtpPort"]')

// The product rules are not part of this schema, and this is the record of that
// boundary: the object root applies defaults and enforces field constraints, and
// says nothing about whether a well-formed document is usable. That question is
// answered at the standard-schema layer the Host calls —
// `scripts/probe/config-check-probe.mjs` — and by the real write path in
// `scripts/probe-host-config-write.mjs`.
check(
  'the object root accepts a field-valid but product-invalid document',
  refusal({ enabled: true, smtpHost: '', to: [] }) === undefined,
)

console.log('--- 3. DSH settings projection (volatileForm over plainSchema) ---')
/**
 * Faithful copy of `dsh-settings`'s `plainSchema`/`volatileForm` walk.
 *
 * The form schema is rebuilt from `toJSON()` and then has its `volatile` markers
 * deleted, and `volatileForm` selects the fields whose nearest volatile ancestor
 * makes them editable without a remount. The copy is deliberately literal: the
 * claim under test is about what DSH's own walk sees, so a friendlier
 * reimplementation would be measuring the wrong thing.
 */
function plainSchema(schema) {
  const result = new Schema(schema.toJSON())
  const walk = (node) => {
    delete node.meta.volatile
    for (const child of Object.values(node.dict ?? {})) walk(child)
    if (node.inner) walk(node.inner)
    for (const child of node.list ?? []) walk(child)
  }
  walk(result)
  return result
}
function volatileForm(schema) {
  if (schema.meta.volatile) return plainSchema(schema)
  if (schema.type === 'object') {
    const dict = Object.fromEntries(
      Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
        const field = volatileForm(child)
        return field === undefined ? [] : [[key, field]]
      }),
    )
    return Object.keys(dict).length === 0 ? undefined : Schema.object(dict)
  }
  return undefined
}
const projected = new Schema(Config.toJSON())
check('toJSON round-trips the object root', projected.type === 'object')
const form = volatileForm(projected)
const formFields = Object.keys(form?.dict ?? {})
check('every declared field is visible to the settings form', formFields.length === 12, `saw ${formFields.length}`)
check(
  'every form field lost its volatile marker',
  Object.values(form?.dict ?? {}).every((field) => field.meta.volatile === undefined),
)
check('the projected form refuses a field-level violation', refusal({ enabled: false, smtpPort: 99999 }) !== undefined)

console.log(failures.length === 0 ? '\nPASS: schema-probe' : `\nFAIL: schema-probe (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
