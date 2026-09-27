#!/usr/bin/env node
/**
 * Tarball audit: inspect a packed `.tgz` against the packaging contract.
 *
 * Two independent checks are performed. The `files` whitelist in `package.json`
 * decides what `npm pack` includes, so the audit first re-derives that list and
 * fails if any entry is missing from the archive. Second, every path in the
 * archive is matched against a deny list of secret-bearing and development
 * patterns, so an entry that slipped past the whitelist is still caught.
 *
 * Usage:
 *   node scripts/inspect-tarball.mjs [path/to/package.tgz]
 *
 * With no argument the newest `*.tgz` in the current directory is used, and
 * `npm pack` is run first if there is none.
 *
 * @module dsh-mail-notify/scripts/inspect-tarball
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Archive entries that must be present. */
const REQUIRED = ['package/package.json', 'package/cordis.patch.yml', 'package/README.md', 'package/LICENSE']

/** Archive entry patterns that must be absent. */
const FORBIDDEN = [
  { pattern: /(^|\/)\.env($|\.)/, why: 'environment file' },
  { pattern: /(^|\/)node_modules\//, why: 'installed dependency tree' },
  { pattern: /(^|\/)coverage\//, why: 'coverage output' },
  { pattern: /\.(pem|key|p12|pfx|jks)$/i, why: 'key material' },
  { pattern: /(^|\/)(\.secrets|\.credentials)\//, why: 'credential store' },
  { pattern: /(^|\/)tests\//, why: 'test sources' },
  { pattern: /(^|\/)scripts\//, why: 'development scripts' },
  { pattern: /(^|\/)src\//, why: 'TypeScript sources' },
  { pattern: /(^|\/)\.git/, why: 'version-control metadata' },
  { pattern: /\.(tsbuildinfo|log)$/i, why: 'build or log artefact' },
  { pattern: /(^|\/)\.dsh\//, why: 'harness session data' },
]

/**
 * List the archive's entries.
 *
 * @param tarball - absolute path to the `.tgz`.
 * @returns entry paths, as `package/…`.
 */
function listEntries(tarball) {
  const output = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Pack the package and return the archive path.
 *
 * @returns the absolute path of the produced `.tgz`.
 */
function pack() {
  const output = execFileSync('npm', ['pack', '--silent'], { cwd: root, encoding: 'utf8' })
  const name = output.trim().split(/\r?\n/).filter(Boolean).pop()
  if (name === undefined) throw new Error('npm pack produced no output')
  return join(root, name)
}

/**
 * Find the archive for the current version, or pack one.
 *
 * The archive is named after the *declared* version rather than chosen by
 * modification time. A `.tgz` left in the working directory by an earlier
 * release is then never audited as if it were this one, which is the failure a
 * newest-file rule cannot see.
 *
 * @param argument - the explicit path, when one was given.
 * @returns the absolute path of the archive to inspect.
 */
function resolveTarball(argument) {
  if (argument !== undefined) return resolve(argument)
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const derived = join(root, `dsh-mail-notify-${version}.tgz`)
  return existsSync(derived) ? derived : pack()
}

const failures = []
const tarball = resolveTarball(process.argv[2])
const entries = listEntries(tarball)

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const whitelist = manifest.files ?? []

for (const required of REQUIRED) {
  if (!entries.includes(required)) failures.push(`missing required entry: ${required}`)
}

// Every whitelisted top-level entry must appear in the archive.
for (const entry of whitelist) {
  const prefix = `package/${entry.replace(/^\.\//, '')}`
  const present = entries.some((candidate) => candidate === prefix || candidate.startsWith(`${prefix}/`))
  if (!present) failures.push(`declared in "files" but absent from the archive: ${entry}`)
}

for (const entry of entries) {
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(entry)) failures.push(`forbidden entry (${rule.why}): ${entry}`)
  }
}

const compiled = entries.filter((entry) => entry.startsWith('package/lib/') && entry.endsWith('.js'))
if (compiled.length === 0) failures.push('no compiled runtime is present under lib/')

console.log(`tarball: ${basename(tarball)}`)
console.log(`entries: ${entries.length}`)
console.log(`compiled modules: ${compiled.length}`)
for (const entry of entries) console.log(`  ${entry}`)

if (failures.length > 0) {
  console.error('\nFAIL')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nPASS: required entries present, no forbidden entry found')
}
