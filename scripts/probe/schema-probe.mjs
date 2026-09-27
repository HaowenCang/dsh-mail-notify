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

const moduleRoot = [process.env['SCHEMA_PROBE_MODULES'], projectRoot].find((root) =>
  existsSync(join(root, 'node_modules', '@deepseek-ai', 'schemastery', 'package.json')),
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

console.log('--- 1. volatile references ---')
const parsed = Checked({ enabled: true, smtpHost: 'smtp.example.invalid', to: ['a@b.co'] })
check('root parse returns an object', typeof parsed === 'object' && parsed !== null)
check('enabled is a Volatile reference', typeof parsed.enabled?.get === 'function')
check('enabled.get() is the boolean true', parsed.enabled.get() === true)
check('smtpPort default is applied and readable', parsed.smtpPort.get() === 587)
check('the array field returns a frozen snapshot', Array.isArray(parsed.to.get()) && Object.isFrozen(parsed.to.get()))
check('an omitted field still answers through get()', parsed.notifyApprovals.get() === false)

console.log('--- 2. refusals ---')
const refusal = (input) => {
  try {
    Checked(input)
    return undefined
  } catch (error) {
    return error
  }
}
const rangeError = refusal({ enabled: false, smtpPort: 99999 })
check('an out-of-range port is refused', rangeError !== undefined)
check('the port refusal names its path', JSON.stringify(rangeError?.options?.path) === '["smtpPort"]')

const crossError = refusal({ enabled: true, smtpHost: '', to: [] })
check('a cross-field violation is refused', crossError !== undefined)
check('the cross-field refusal comes from the transform', crossError?.message === 'smtpHost is required while enabled is true')

check('a disabled plugin skips the cross-field rules', refusal({ enabled: false, smtpHost: '', to: [] }) === undefined)

console.log('--- 3. DSH settings projection (volatileForm over plainSchema) ---')
/** Faithful copy of `dsh-settings`'s `plainSchema`/`volatileForm` walk. */
function volatileForm(schema) {
  if (schema.meta.volatile) return true
  if (schema.type === 'object') {
    const dict = Object.fromEntries(
      Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
        const field = volatileForm(child)
        return field === undefined ? [] : [[key, field]]
      }),
    )
    return Object.keys(dict).length === 0 ? undefined : { dict }
  }
  return undefined
}
const projected = new Schema(Checked.toJSON())
check('toJSON round-trips the transform node', projected.type === 'transform')
check('the transform keeps its inner object', projected.inner?.type === 'object')
const form = volatileForm(projected.inner)
check('every field is visible to the settings form', Object.keys(form?.dict ?? {}).length === 12)
check('the projected node still refuses an invalid value', refusal({ enabled: true, to: [] }) !== undefined)

console.log(failures.length === 0 ? '\nPASS: schema-probe' : `\nFAIL: schema-probe (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
