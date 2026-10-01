/**
 * Probe: which schema shapes accept `.volatile()`, under the exact
 * schemastery 3.18.4 that DSH 0.2.0-rc.2 ships.
 *
 * Schemastery refuses a volatile field that sits under another volatile field
 * or under a container node. The rule decides how a Config must be shaped, so
 * it is established by execution rather than by reading the validator.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..', '..')
const moduleRoot = [process.env['SCHEMA_PROBE_MODULES'], projectRoot].find(
  (root) =>
    typeof root === 'string' && root !== '' && existsSync(join(root, 'node_modules', '@deepseek-ai', 'schemastery', 'package.json')),
)
const Schema = (
  await import(
    pathToFileURL(join(moduleRoot, 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs')).href
  )
).default

const cases = {
  'scalar boolean': () => Schema.object({ a: Schema.boolean().default(true).volatile() }),
  'scalar with min/max': () => Schema.object({ a: Schema.natural().min(1).max(10).default(5).volatile() }),
  'array of scalars': () => Schema.object({ a: Schema.array(Schema.string()).default([]).volatile() }),
  'array of scalars, no default': () => Schema.object({ a: Schema.array(Schema.string()).volatile() }),
  'nested object field': () =>
    Schema.object({ a: Schema.object({ b: Schema.string().default('').volatile() }) }),
  'array of objects, element volatile': () =>
    Schema.object({ a: Schema.array(Schema.object({ b: Schema.string().default('').volatile() })).default([]) }),
  'array of objects, array volatile': () =>
    Schema.object({ a: Schema.array(Schema.object({ b: Schema.string().default('') })).default([]).volatile() }),
  'union scalar': () => Schema.object({ a: Schema.union(['x', 'y']).default('x').volatile() }),
  'root transform over volatile object': () =>
    Schema.transform(Schema.object({ a: Schema.boolean().default(true).volatile() }), (value) => value),
  'root transform, transform NOT volatile': () =>
    Schema.transform(Schema.object({ a: Schema.boolean().default(true).volatile() }), (value) => value),
  'plain root object, volatile fields': () =>
    Schema.object({ a: Schema.boolean().default(true).volatile(), b: Schema.string().default('').volatile() }),
  'plain root object, all fields plain': () =>
    Schema.object({ a: Schema.boolean().default(true), b: Schema.string().default('') }),
  'transform declared NOT volatile, checked': () => {
    const inner = Schema.object({ a: Schema.boolean().default(true).volatile() })
    const outer = Schema.transform(inner, (value) => value)
    return outer
  },
  'union of object members, volatile scalar': () =>
    Schema.object({ a: Schema.union([Schema.string(), Schema.number()]).default('x').volatile() }),
  'string with pattern (correct match)': () =>
    Schema.object({ a: Schema.string().pattern(/^[A-Za-z_]\w*$/).default('ABC').volatile() }),
  'array of objects at root, array volatile': () =>
    Schema.object({ a: Schema.array(Schema.object({ b: Schema.string().default('') })).default([]).volatile() }),
}

for (const [label, build] of Object.entries(cases)) {
  try {
    const schema = build()
    const parsed = schema({})
    const field = parsed.a
    const reference = typeof field?.get === 'function'
    let snapshot
    try {
      snapshot = JSON.stringify(field?.get?.())
    } catch (error) {
      snapshot = `<get() threw: ${error.message}>`
    }
    console.log(`OK    ${label.padEnd(38)} volatile=${String(reference).padEnd(5)} get()=${snapshot}`)
  } catch (error) {
    console.log(`THROW ${label.padEnd(38)} ${error.message}`)
  }
}
