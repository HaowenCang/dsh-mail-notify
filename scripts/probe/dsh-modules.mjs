/**
 * Resolve a DSH package from the installation a probe is exercising.
 *
 * ## Why a shared helper exists for this
 *
 * Two installation layouts occur and both must work. Through DSH 0.1.5 the
 * launcher's dependencies were hoisted beside it, so a package lived at
 * `<installRoot>/node_modules/@deepseek-ai/<name>`. From 0.1.7 they are nested
 * inside the launcher's own `node_modules`, and the hoisted path does not exist.
 * A probe that assumed either layout would report a missing package, and a
 * missing package reads exactly like a failed contract.
 *
 * The resolution therefore goes through the launcher's own manifest — the one
 * subpath every DSH package exports — and never through a guess about depth.
 *
 * The probe plugins live outside the profile's module root, which is what keeps
 * the plugin under test out of it, so a bare specifier cannot resolve from the
 * plugin file itself. Resolving from the launcher is what a real consumer of the
 * installation gets.
 *
 * @module dsh-mail-notify/scripts/probe/dsh-modules
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The installation root the probe should read from.
 *
 * @returns an absolute directory holding `node_modules`.
 */
export function installRoot() {
  const explicit = process.env['DSH_INSTALL_ROOT']
  if (explicit !== undefined && explicit !== '') return resolve(explicit)
  // The launcher lives at <root>/node_modules/@deepseek-ai/dsh/lib/bin.js.
  return resolve(process.env['DSH_HOME'] ?? join(process.env['USERPROFILE'] ?? '', '.dsh'), '..')
}

/**
 * The launcher's own entry file, used as the resolution base.
 *
 * @returns an absolute path.
 */
function launcherEntry() {
  return join(installRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/**
 * Locate a DSH package directory.
 *
 * @param packageName - the unscoped name below `@deepseek-ai`.
 * @returns the absolute package directory.
 * @throws When the package cannot be located in either layout.
 */
export function packageDirectory(packageName) {
  const specifier = `@deepseek-ai/${packageName}`
  const flat = join(installRoot(), 'node_modules', ...specifier.split('/'))
  const require = createRequire(launcherEntry())
  try {
    return dirname(require.resolve(`${specifier}/package.json`))
  } catch (error) {
    if (existsSync(flat)) return flat
    throw new Error(`cannot locate ${specifier} from ${launcherEntry()}: ${String(error)}`)
  }
}

/**
 * Import a DSH package by name.
 *
 * The package *root* is resolved and then imported, which goes through the
 * package's own `exports` map — the same entry point a real consumer receives.
 *
 * @param packageName - the unscoped name below `@deepseek-ai`.
 * @returns the module namespace.
 */
export async function importDshPackage(packageName) {
  const specifier = `@deepseek-ai/${packageName}`
  const require = createRequire(launcherEntry())
  const resolved = require.resolve(specifier)
  return import(pathToFileURL(resolved).href)
}

/**
 * Read an installed package's declared version.
 *
 * @param packageName - the unscoped name below `@deepseek-ai`.
 * @returns the version, or `undefined` when the package is absent.
 */
export function installedVersion(packageName) {
  try {
    return JSON.parse(readFileSync(join(packageDirectory(packageName), 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}
