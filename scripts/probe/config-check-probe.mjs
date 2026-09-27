/**
 * Probe: establish the exact Host pre-persistence validation mechanism that
 * `@deepseek-ai/schemastery 3.18.4` — the release DSH 0.1.7-rc.2 ships, and the
 * release this plugin's peer range names — actually provides.
 *
 * Run with `npm run probe:config-check`. Nothing here is a mock: the probe
 * imports the installed Schemastery, builds the plugin's own Config shape, and
 * drives the two candidates through the exact call the target makes.
 *
 * ## What the target makes
 *
 * `@deepseek-ai/dsh-config-editor`'s `ConfigEditor.edit()` runs, before it
 * touches `cordis.patch.yml`:
 *
 * ```js
 * const resolved = fiber.ctx.waterfall(fiber, "internal/config", next, () => next)
 * resolveConfig(fiber.runtime, resolved)      // imported from '@deepseek-ai/cordis'
 * ```
 *
 * `@deepseek-ai/cordis`'s `resolveConfig(runtime, config)` is:
 *
 * ```js
 * if (!runtime.Config) return config
 * const result = runtime.Config['~standard'].validate(config)
 * if ('then' in result) throw new TypeError('Async config validation is not supported')
 * if (result.issues) throw new ValidationError(result.issues)
 * return result.value
 * ```
 *
 * So the plugin's entire Host pre-persistence validation surface is the
 * **standard-schema** contract on its exported `Config` node — NOT a method
 * named `.check()`. The loader's volatile path
 * (`cordis-plugin-loader` `_commitVolatile`) and the initial mount path
 * (`fiber._resolveConfig`) reach the same `resolveConfig(runtime, ...)`.
 *
 * Section 5 does not paraphrase that function: it imports the installed
 * `@deepseek-ai/cordis` and drives the derived node through the real
 * `resolveConfig`, so the refusal the probe observes is produced by the code the
 * Host actually runs. Pointed at the installed DSH (`SCHEMA_PROBE_MODULES`), both
 * modules under test are the shipped release rather than the checkout's copies.
 *
 * ## Why `.check()` is not used
 *
 * The DSH 0.1.7 cookbook sentence describes a Schemastery capability
 * ("Use `.check()` for cross-field Config validation; these checks run on the
 * Host before persistence and are omitted from serialized form schemas"), but
 * the release actually installed exposes no such method: the probe enumerates
 * `Schema.prototype` and finds `volatile`, `default`, `pattern`, `min`, `max`,
 * `role`, `extra`, `toJSON`, `simplify`, `~standard` and the rest — and no
 * `check`. A plugin cannot call a method the runtime does not have, and
 * `Schema.transform` is explicitly not an acceptable substitute (a root
 * transform node is not the object node the DSH settings form walks). The
 * mechanism that *does* exist at exactly this boundary is the standard-schema
 * validator, so that is what the plugin extends.
 *
 * ## Invariants the probe pins
 *
 * 1. `.check` is absent from the installed Schemastery prototype.
 * 2. `Config` is a standard-schema validator whose `validate()` returns issues
 *    (not a throw) and whose `value` is the resolved volatile tree.
 * 3. A *derived* Config node — `new Schema(Config.toJSON())` with its own
 *    `~standard.validate` layered over the inherited one — still yields the
 *    volatile tree, so `dsh-settings`' `plainConfig`/`volatileForm` keep
 *    working; a product violation becomes a standard-schema issue naming the
 *    field, which `cordis`'s `resolveConfig` turns into a thrown
 *    `ValidationError` — a refusal before any file write.
 * 4. The layered check is invisible to the serialized form: no function ever
 *    enters `toJSON()`, every field survives, and the form sees exactly the
 *    declared field count.
 * 5. `enabled: false` bypasses the cross-field checks; `enabled: true` without
 *    complete SMTP configuration is refused.
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
 * Pointing it at the installed DSH bundle checks the exact shipped release
 * without altering the repository's dependency graph.
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
  (root) => typeof root === 'string' && root !== '' && existsSync(join(root, 'node_modules', '@deepseek-ai', 'schemastery', 'package.json')),
)
const Schema = (await loadSchemastery()).default
const manifest = async (name) =>
  JSON.parse(await readFile(join(moduleRoot, 'node_modules', '@deepseek-ai', name, 'package.json'), 'utf8')).version
console.log(
  `[config-check-probe] schemastery ${await manifest('schemastery')} ` +
    `with cosmokit ${await manifest('cosmokit')} (root: ${moduleRoot})`,
)

/**
 * Import the released `@deepseek-ai/cordis` from the same root.
 *
 * The one link in the chain the probe must not paraphrase is the function that
 * performs the refusal: a hand copy of `resolveConfig` would prove only that the
 * plugin's node satisfies the copy. The real module is imported from the root
 * under test, so the `ValidationError` observed below is the one
 * `dsh-config-editor` would propagate.
 *
 * @returns the module namespace.
 */
async function loadCordis() {
  const target = join(moduleRoot, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')
  if (existsSync(target)) return import(pathToFileURL(target).href)
  return import('@deepseek-ai/cordis')
}

const cordis = await loadCordis()
console.log(`[config-check-probe] cordis ${await manifest('cordis')}`)

const failures = []
const check = (label, condition, detail) => {
  const suffix = detail === undefined ? '' : ` — ${detail}`
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${suffix}`)
  if (!condition) failures.push(label)
}

console.log('--- 1. does the installed Schemastery expose .check()? ---')
const prototypeMethods = Object.getOwnPropertyNames(Schema.prototype).filter((name) => name !== 'constructor')
check('.check is absent from Schema.prototype', !prototypeMethods.includes('check'))
check('typeof Schema.prototype.check is undefined', typeof Schema.prototype.check === 'undefined')
console.log(`      prototype methods: ${prototypeMethods.join(', ')}`)

console.log('--- 2. the exact Config shape under test (mirrors src/config.ts) ---')
/** Field-level constraints only, exactly as the plugin declares them. */
const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  smtpHost: Schema.string().default('').volatile(),
  smtpPort: Schema.natural().min(1).max(65535).default(587).volatile(),
  smtpSecure: Schema.boolean().default(false).volatile(),
  smtpUser: Schema.string().default('').volatile(),
  smtpPasswordCredential: Schema.string()
    .default('DSH_MAIL_SMTP_PASSWORD')
    .pattern(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .volatile(),
  from: Schema.string().default('').volatile(),
  to: Schema.array(Schema.string()).default([]).volatile(),
  notifyCompleted: Schema.boolean().default(true).volatile(),
})

/** One shared pure validator, exactly as `src/config.ts` runs it. */
const ADDRESS_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
function productIssues(value) {
  if (value.enabled !== true) return []
  const issues = []
  const smtpHost = typeof value.smtpHost === 'string' ? value.smtpHost.trim() : ''
  if (smtpHost === '') issues.push({ message: 'smtpHost is required and must be non-empty while enabled is true', path: ['smtpHost'] })
  else if (/\s/.test(smtpHost)) issues.push({ message: 'smtpHost must not contain whitespace', path: ['smtpHost'] })
  const from = typeof value.from === 'string' ? value.from.trim() : ''
  if (from === '' || !ADDRESS_PATTERN.test(from)) issues.push({ message: 'from must be a plausible address', path: ['from'] })
  const to = Array.isArray(value.to) ? value.to.filter((entry) => typeof entry === 'string' && ADDRESS_PATTERN.test(entry.trim())) : []
  if (to.length === 0) issues.push({ message: 'to must contain at least one valid recipient', path: ['to'] })
  return issues
}

/** Collapse a volatile tree into the primitive candidate the checks read. */
function plain(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.get === 'function') return plain(value.get())
  if (Array.isArray(value)) return value.map(plain)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)]))
}

/**
 * Derive a Config node carrying the product checks, without mutating the
 * exported schema and without a root transform.
 *
 * `new Schema(Config.toJSON())` rebuilds an ordinary Schemastery node from the
 * schema's own serialized description — the same reconstruction
 * `@deepseek-ai/dsh-settings`'s `plainSchema` performs. `~standard` is declared
 * as an own data property on that *derived* node, shadowing the inherited
 * getter, so the exported `Config` keeps answering through Schemastery's own
 * prototype getter.
 *
 * @param base - the field-level Config schema.
 * @returns the derived node.
 */
function withProductChecks(base) {
  const node = new Schema(base.toJSON())
  const inherited = Object.getOwnPropertyDescriptor(Schema.prototype, '~standard').get
  Object.defineProperty(node, '~standard', {
    configurable: true,
    value: {
      version: 1,
      vendor: 'dsh-mail-notify',
      validate: (value) => {
        const result = inherited.call(node).validate(value)
        if ('then' in result) return result
        if (result.issues) return result
        const issues = productIssues(plain(result.value))
        return issues.length === 0 ? result : { issues }
      },
    },
  })
  return node
}

const Checked = withProductChecks(Config)

console.log('--- 3. the standard-schema contract the Host calls ---')
const base = Config['~standard'].validate({ enabled: true, smtpHost: 'smtp.example.invalid', to: ['a@b.co'], from: 'n@b.co' })
check('base validate() returns a result object', typeof base === 'object' && base !== null)
check('a valid candidate reports no issues', base.issues === undefined)
check('the value is the resolved volatile tree', typeof base.value?.enabled?.get === 'function')
check('volatile .get() reads the resolved primitive', base.value.enabled.get() === true)
check('defaults are applied inside the value', base.value.smtpPort.get() === 587)
check('the array field is a frozen snapshot', Object.isFrozen(base.value.to.get()))

const rangeResult = Checked['~standard'].validate({ enabled: false, smtpPort: 99999 })
check('an out-of-range field becomes an issue, not a throw', Array.isArray(rangeResult.issues))
check('the issue names the offending path', JSON.stringify(rangeResult.issues?.[0]?.path) === '["smtpPort"]')

console.log('--- 4. product invariants ride the same contract ---')
const semantic = Checked['~standard'].validate({
  enabled: true,
  smtpHost: '',
  smtpUser: 'ops',
  from: 'noreply@example.invalid',
  to: ['ops@example.invalid'],
})
check('enabled=true + smtpHost="" is an issue', Array.isArray(semantic.issues))
check('the product issue keeps its own message', semantic.issues?.[0]?.message?.includes('smtpHost') === true)
check('the product issue keeps a field path', JSON.stringify(semantic.issues?.[0]?.path) === '["smtpHost"]')

const emptyTo = Checked['~standard'].validate({
  enabled: true,
  smtpHost: 'smtp.example.invalid',
  smtpUser: 'ops',
  from: 'noreply@example.invalid',
  to: [],
})
check('enabled=true + to=[] is an issue', Array.isArray(emptyTo.issues), JSON.stringify(emptyTo.issues?.[0] ?? null))

const whitespaceHost = Checked['~standard'].validate({
  enabled: true,
  smtpHost: 'smtp example invalid',
  smtpUser: 'ops',
  from: 'noreply@example.invalid',
  to: ['ops@example.invalid'],
})
check('enabled=true + smtpHost with whitespace is an issue', Array.isArray(whitespaceHost.issues))

const disabled = Checked['~standard'].validate({ enabled: false, smtpHost: '', smtpUser: '', from: '', to: [] })
check('enabled=false keeps incomplete SMTP fields legal', disabled.issues === undefined)

const incompleteEnable = Checked['~standard'].validate({ enabled: true })
check('enabling without completing SMTP configuration is refused', Array.isArray(incompleteEnable.issues))

console.log('--- 5. `cordis.resolveConfig` on this node is a pre-write refusal ---')
const { resolveConfig: cordisResolveConfig, ValidationError: CordisValidationError } = cordis
check('the installed cordis exports resolveConfig', typeof cordisResolveConfig === 'function')
check('the installed cordis exports ValidationError', typeof CordisValidationError === 'function')
const runtime = { Config: Checked }
const refusal = (input) => {
  try {
    cordisResolveConfig(runtime, input)
    return undefined
  } catch (error) {
    return error
  }
}
const refused = refusal({ enabled: true, smtpHost: '', to: [] })
check('resolveConfig throws for a product-invalid candidate', refused !== undefined)
check('the throw is the cordis ValidationError shape', refused?.name === 'ValidationError')
check('the throw is an instance of the exported class', refused instanceof CordisValidationError)
check('its message names the field path', refused?.message?.includes('(at smtpHost)') === true, JSON.stringify(refused?.message))
const settled = refusal({ enabled: false })
check('resolveConfig returns the validated value for a legal candidate', settled === undefined)
const accepted = cordisResolveConfig(runtime, { enabled: true, smtpHost: 'smtp.example.invalid', smtpUser: 'ops', from: 'n@b.co', to: ['a@b.co'] })
check('the returned value is the resolved volatile tree', typeof accepted?.enabled?.get === 'function')
check('a field-level violation is still refused by cordis', refusal({ enabled: false, smtpPort: 99999 })?.message?.includes('(at smtpPort)') === true)

console.log('--- 6. the serialized form is unaffected ---')
const serialized = Checked.toJSON()
check('toJSON returns a plain description', typeof serialized === 'object' && serialized !== null)
check('no function survives serialization', !JSON.stringify(serialized, (_key, value) => (typeof value === 'function' ? '__fn__' : value)).includes('__fn__'))
check('the derived node still reports a type', typeof Checked.type === 'string')
check('simplify is inherited from Schemastery', typeof Checked.simplify === 'function')

/**
 * Faithful copy of `@deepseek-ai/dsh-settings`'s `plainSchema`, followed by the
 * schema-returning half of its `volatileForm`.
 *
 * `plainSchema` rebuilds the node from `schema.toJSON()` and then deletes the
 * `volatile` marker from every descendant, so the form schema is an ordinary
 * Schemastery node set. `volatileForm` is the walk that selects editable
 * fields; for an object node it rebuilds a `Schema.object` from each child's
 * own form schema, which is the shape the browser receives.
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
const projected = new Schema(Checked.toJSON())
check('the projection round-trips the node type', projected.type === 'object')
const form = volatileForm(projected)
const formFields = Object.entries(form?.dict ?? {})
check('every declared field is visible to the settings form', formFields.length === 9, `saw ${formFields.length}: ${formFields.map(([key]) => key).join(', ')}`)
check('the form node carries no ~standard override', !Object.hasOwn(form, '~standard') || Object.getOwnPropertyDescriptor(form, '~standard')?.get !== undefined)
check('the form node carries no product checks', form['~standard'].validate({ enabled: true, smtpHost: '', to: [] }).issues === undefined)
check(
  'the form still refuses a field-level violation',
  Array.isArray(form['~standard'].validate({ enabled: false, smtpPort: 99999 }).issues),
)
check('every field is a usable form node with its volatile marker stripped', formFields.every(([, field]) => typeof field.type === 'string' && field.meta.volatile === undefined))
check('the derived node keeps its own volatile markers', Checked.dict.enabled.meta.volatile === true)

console.log('--- 7. the exported Config is untouched ---')
const ownStandard = Object.getOwnPropertyDescriptor(Config, '~standard')
check('the exported node still answers through the prototype getter', ownStandard === undefined || ownStandard.get !== undefined)
check('the exported node carries no product checks', Config['~standard'].validate({ enabled: true, smtpHost: '', to: [] }).issues === undefined)

console.log('--- 8. derivation changes nothing the schema already answered ---')
const sample = { enabled: false, smtpPort: 2525, to: ['a@b.co'] }
check(
  'simplify reduces a derived tree exactly as it reduces the base tree',
  JSON.stringify(Checked.simplify(Checked(sample))) === JSON.stringify(Config.simplify(Config(sample))),
  JSON.stringify(Checked.simplify(Checked(sample))),
)
const derivedStandard = Object.getOwnPropertyDescriptor(Checked, '~standard')
check('the override is an own, configurable data property', derivedStandard?.get === undefined && derivedStandard?.configurable === true)
check('the override names this plugin as its vendor', Checked['~standard'].vendor === 'dsh-mail-notify')
check('the override keeps the standard-schema version', Checked['~standard'].version === 1)
check('the derived node still describes the base schema', Checked.toString() === Config.toString(), Checked.toString())

console.log(failures.length === 0 ? '\nPASS: config-check-probe' : `\nFAIL: config-check-probe (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
