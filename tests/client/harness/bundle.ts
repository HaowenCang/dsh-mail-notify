/**
 * Loads the BUILT client bundle — the exact artifact `npm run build` produces
 * and `npm pack` ships — and hands back its exports.
 *
 * The bundle is one classic script that calls
 * `window.__ModuleLoader__.load({ id, factory })`. Evaluating it against a
 * stand-in loader installed on the jsdom window captures the factory, and
 * invoking that factory with a `require` resolved from this repository's own
 * `package.json` is the same arrangement the shell's seed module table
 * provides: `react` and `react/jsx-runtime` resolve to the single instances
 * the tests themselves use, which is what makes a rendered component and its
 * controller the real ones rather than a re-implementation. Testing the built
 * artifact also means the tests cannot pass against source the bundle does not
 * actually contain.
 *
 * Freshness matters for the same reason: a bundle older than `src/client` is
 * rebuilt here before any test reads it, under an atomic `mkdir` lock so two
 * test processes never build concurrently. When the build is needed and fails,
 * the tests fail with that status rather than against a stale artifact.
 *
 * @module dsh-mail-notify/tests/client/harness/bundle
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MockContext } from './host.ts'

/** The repository root, above `tests/client/harness`. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The built browser bundle. */
const BUNDLE_PATH = join(ROOT, 'lib', 'client.js')

/** Source whose modification time governs the bundle's freshness. */
const SOURCE_DIRS = [join(ROOT, 'src', 'client')]
const SOURCE_FILES = [join(ROOT, 'src', 'protocol.ts')]

/** The build lock, taken with atomic `mkdir`. */
const LOCK_PATH = join(ROOT, 'lib', '.client-build.lock')

/** What the loader envelope's factory returns. */
export interface ClientModule {
  inject: string[]
  apply(ctx: MockContext): void
}

let cached: ClientModule | undefined

/** The newest mtime among the client sources and the shared wire module. */
function newestSourceMtime(): number {
  let newest = 0
  for (const file of SOURCE_FILES) {
    if (existsSync(file)) newest = Math.max(newest, statSync(file).mtimeMs)
  }
  for (const dir of SOURCE_DIRS) {
    for (const name of readdirSync(dir)) {
      newest = Math.max(newest, statSync(join(dir, name)).mtimeMs)
    }
  }
  return newest
}

/** Whether the bundle exists and is newer than every source it bundles. */
function bundleIsFresh(): boolean {
  if (!existsSync(BUNDLE_PATH)) return false
  return statSync(BUNDLE_PATH).mtimeMs >= newestSourceMtime()
}

/** Sleep synchronously — the harness has no event loop to await on. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Run the real build; throw with the status when it fails. */
function build(): void {
  const result = spawnSync('npm', ['run', 'build'], { cwd: ROOT, shell: true, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`lib/client.js is stale and "npm run build" failed with status ${String(result.status)}`)
  }
}

/** Rebuild the bundle when stale, serialised across test processes. */
function ensureBundle(): void {
  if (bundleIsFresh()) return
  // The lock lives inside `lib/`, which a fresh checkout does not have yet.
  mkdirSync(join(ROOT, 'lib'), { recursive: true })
  let locked = false
  try {
    mkdirSync(LOCK_PATH)
    locked = true
  } catch {
    // Another process is building. Wait for it rather than racing it.
    for (let waited = 0; waited < 180_000 && !bundleIsFresh(); waited += 500) sleep(500)
    if (!bundleIsFresh()) throw new Error('timed out waiting for a concurrent client bundle build')
    return
  }
  try {
    if (locked) build()
  } finally {
    try {
      rmdirSync(LOCK_PATH)
    } catch {
      // A failed build may have left the lock; the freshness check above is
      // the authority, and a leaked lock only ever costs one rebuild wait.
    }
  }
}

/**
 * Load the built client bundle once per test process.
 *
 * @returns the bundle's `inject` and `apply` exports.
 * @throws when the bundle is absent or stale and the build fails.
 */
export function loadClientBundle(): ClientModule {
  if (cached !== undefined) return cached

  ensureBundle()

  const source = readFileSync(BUNDLE_PATH, 'utf8')
  let captured: { id: string; factory: (require: (id: string) => unknown) => unknown } | undefined
  const globalWindow = globalThis.window as { __ModuleLoader__?: unknown }
  // The envelope addresses the loader exactly as the shell does: through the
  // global window's `__ModuleLoader__.load`.
  globalWindow.__ModuleLoader__ = {
    load(spec: { id: string; factory: (require: (id: string) => unknown) => unknown }): void {
      captured = spec
    },
  }
  try {
    const evaluate = new Function('window', 'document', `${source}\n//# sourceURL=dsh-mail-notify/client.js`)
    evaluate(globalThis.window, globalThis.document)
  } finally {
    delete globalWindow.__ModuleLoader__
  }
  if (captured === undefined) throw new Error('the bundle did not reach window.__ModuleLoader__.load')

  const requireFromRoot = createRequire(join(ROOT, 'package.json'))
  cached = captured.factory(requireFromRoot) as ClientModule
  return cached
}
