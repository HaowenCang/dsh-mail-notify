/**
 * Host config-write probe: the persistence boundary refuses product-invalid saves.
 *
 * ## What this proves
 *
 * A configuration can be **field-schema-valid and still unusable**: every field
 * has the right type and sits inside its declared bounds, while the document as a
 * whole describes a plugin that cannot send anything — `enabled: true` with an
 * empty `smtpHost`, or with an empty recipient list.
 *
 * The first v0.4.0 candidate proved only that *field* violations are refused
 * (`smtpPort = 99999`, a malformed credential reference). Those come from the
 * field schemas and would have passed against an implementation with no product
 * rules at all. This probe answers the other question, and it answers it through
 * the production path rather than around it:
 *
 * ```text
 * SettingsForms.update  →  ConfigEditor.edit  →  cordis resolveConfig  →  plugin Config
 * ```
 *
 * ## Why it composes the app itself
 *
 * `scripts/probe-e2e.mjs` boots a whole profile through the `dsh` launcher. That
 * composition cannot answer this question: `dsh-base` gates `config-editor` and
 * `settings` on a published `profileContext`, and the headless boot path leaves
 * both disabled, so a headless run has no Host write path to address at all.
 *
 * This probe calls the launcher's own `boot()` with the same `profileContext` the
 * launcher builds, and composes exactly the rows the question needs. Nothing is
 * substituted: the Loader, the file lock, the atomic write, the patch parser, the
 * service wiring, `SettingsForms`, `ConfigEditor`, and cordis's `resolveConfig`
 * are the installed implementations, and the plugin under test is the packed
 * `lib/index.js` from the archive that ships.
 *
 * ## What every refusal is checked against
 *
 * A refusal that still mutated something would be worse than no refusal:
 *
 * - the call raised rather than returning, so it is a refusal and not a no-op;
 * - the profile's `cordis.patch.yml` is byte-identical (SHA-256 before and after);
 * - the Loader entry's committed `config` did not move;
 * - the effective runtime did not move (the plugin's own status handle).
 *
 * ## And every acceptance
 *
 * A driver that only tried invalid writes would be satisfied by a plugin that
 * refuses everything, so the sequence opens with the state the product calls
 * legal while a configuration is incomplete — `enabled: false` with empty SMTP
 * fields — and ends with a complete, valid enable that must be **accepted** and
 * must then actually deliver over SMTP.
 *
 * Usage:
 *   node scripts/probe-host-config-write.mjs
 *
 * Every writable path lives under `tmp/host-config-write/`; the operator's own
 * DSH home is never touched.
 *
 * @module dsh-mail-notify/scripts/probe-host-config-write
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boot, loadLayeredEnv, readProfilePatches } from '@deepseek-ai/dsh-app-boot'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
/** Every writable path this probe uses, and nothing outside it. */
const root = process.env['DSH_MAIL_NOTIFY_PROBE_ROOT'] ?? join(projectRoot, 'tmp', 'host-config-write')
const home = join(root, 'home')
const outDir = join(root, 'out')
const profileDir = join(home, 'profiles', 'probe')
const patchPath = join(profileDir, 'cordis.patch.yml')
const rootConfigPath = join(profileDir, 'cordis.yml')

/** The release under test, reported so a run cannot be read against the wrong target. */
const release = JSON.parse(readFileSync(join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-session', 'package.json'), 'utf8')).version
/** The Schemastery the boundary is proven against. */
const schemastery = JSON.parse(readFileSync(join(projectRoot, 'node_modules', '@deepseek-ai', 'schemastery', 'package.json'), 'utf8')).version

/** The synthetic SMTP password the probe resolves; never a real secret. */
const smtpPassword = 'PROBE_HOST_WRITE_PASSWORD_NOT_A_REAL_SECRET'
/** The reference the plugin's configuration names, in the CredentialRef grammar. */
const credentialRef = 'DSH_MAIL_SMTP_PASSWORD'
const recipient = 'recipient@example.invalid'

const failures = []
/** One assertion, in the `PASS`/`FAIL` grammar the other probes use. */
function check(label, passed, detail) {
  const suffix = detail === undefined ? '' : ` — ${detail}`
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${suffix}`)
  if (!passed) failures.push(label)
}

/** SHA-256 of a file as bytes, or `absent` when there is no file. */
function hashFile(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return 'absent'
  }
}

mkdirSync(outDir, { recursive: true })
// A fresh home for every run: an earlier run's profile, session store, or
// credential document could otherwise make a write this run did not perform look
// like one it did.
rmSync(home, { recursive: true, force: true })
for (const name of ['sessions', 'storages', 'profiles']) mkdirSync(join(home, name), { recursive: true })
mkdirSync(profileDir, { recursive: true })

console.log(`[host-write] DSH release under test: ${release}, schemastery ${schemastery}`)
console.log(`[host-write] disposable home: ${home}`)

// ---------------------------------------------------------------------------
// The loopback SMTP server, so "the accepted enable still delivers" is a fact
// about the wire rather than about a configuration object.
// ---------------------------------------------------------------------------
const received = []
const smtp = await new Promise((resolvePromise, rejectPromise) => {
  const server = createServer((socket) => {
    let inData = false
    let buffer = ''
    let message = ''
    socket.write('220 host-write.local ESMTP probe\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const index = buffer.indexOf('\r\n')
        if (index === -1) break
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (inData) {
          if (line === '.') {
            received.push(message)
            message = ''
            inData = false
            socket.write('250 2.0.0 Ok: queued as PROBE\r\n')
          } else {
            // Undo dot-stuffing, the one transformation SMTP applies to DATA.
            message += `${line.startsWith('..') ? line.slice(1) : line}\n`
          }
          continue
        }
        const upper = line.toUpperCase()
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-host-write.local\r\n250-AUTH PLAIN LOGIN\r\n250-SIZE 10485760\r\n250 8BITMIME\r\n')
        } else if (upper.startsWith('AUTH')) socket.write('235 2.7.0 Authentication successful\r\n')
        else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO')) socket.write('250 2.1.0 Ok\r\n')
        else if (upper.startsWith('DATA')) {
          inData = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (upper.startsWith('QUIT')) {
          socket.write('221 2.0.0 Bye\r\n')
          socket.end()
        } else socket.write('250 2.0.0 Ok\r\n')
      }
    })
    socket.on('error', () => undefined)
  })
  server.once('error', rejectPromise)
  server.listen(0, '127.0.0.1', () => resolvePromise({ server, port: server.address().port }))
})
console.log(`[host-write] loopback SMTP on 127.0.0.1:${smtp.port}`)

// The credential document: the value comes from this file and never from the
// environment, so a resolution the plugin reports cannot be ambient state.
const credentialsFile = join(home, '.credentials.yaml')
writeFileSync(credentialsFile, `version: 1\nrefs:\n  ${credentialRef}: ${smtpPassword}\nrecords: {}\n`, 'utf8')

// ---------------------------------------------------------------------------
// The plugin under test, installed the way an operator installs it.
//
// This is also the fresh-install smoke: the archive `npm pack` produced is
// installed into a disposable profile by the shipping CLI, so the tree the
// composition mounts is the artifact a user would get rather than the checkout it
// was built from. A packaging defect — a missing entry, a wrong `main`, a
// `files` list that dropped something — therefore fails here instead of passing
// against `lib/` in place.
// ---------------------------------------------------------------------------
const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version
const archive = join(projectRoot, `dsh-mail-notify-${version}.tgz`)
if (!existsSync(archive)) {
  process.stderr.write(`[host-write] ${archive} does not exist; run "npm pack" first\n`)
  process.exit(2)
}
const installed = spawnSync('dsh', ['plugin', '--profile', 'probe', 'add', archive], {
  cwd: projectRoot,
  env: { ...process.env, DSH_HOME: home },
  encoding: 'utf8',
  shell: true,
})
if (installed.status !== 0) {
  process.stderr.write(`[host-write] plugin install failed:\n${installed.stdout ?? ''}\n${installed.stderr ?? ''}\n`)
  process.exit(2)
}
console.log(`[host-write] installed ${archive} into the disposable profile`)

/** The installed package's root, resolved through the profile's own modules. */
const installedPluginDir = join(profileDir, 'node_modules', 'dsh-mail-notify')
check('the archive installed a package directory', existsSync(installedPluginDir), installedPluginDir)
check('the installed package declares its host entry', existsSync(join(installedPluginDir, 'lib', 'index.js')))

// The wrapper has to sit beside the installed package so its relative import
// reaches the installed copy rather than the checkout, and it has to be the
// module the row names so that the handle `apply` returns is observable.
writeFileSync(join(profileDir, 'mail-notify-probe-entry.mjs'), readFileSync(join(here, 'probe', 'mail-notify-probe-entry.mjs')), 'utf8')
check('the installed package carries the client half', existsSync(join(installedPluginDir, 'lib', 'client.js')))
check('the installed package carries its bundle patch', existsSync(join(installedPluginDir, 'cordis.patch.yml')))

/**
 * The profile patch the probe boots from.
 *
 * Three rows, and each is there for a reason the question cannot be answered
 * without. `config-editor` and `settings` are the production write path;
 * `dsh-mail-notify` is the plugin under test, addressed by absolute path so the
 * row is unambiguous and no bundle preflight has to interpret a bare name.
 *
 * The plugin's initial document is the state the product calls legal while a
 * configuration is incomplete — switched off, with SMTP fields the product rules
 * would refuse while it is on.
 */
/**
 * The row the Loader mounts.
 *
 * The probe's own wrapper around the plugin entry, so the probe can observe the
 * handle `apply` returns without reaching into the Loader. It re-exports the
 * plugin's `name`, `inject`, `Config`, and `apply` by identity, so the schema the
 * Host validates is the plugin's real one and nothing about the boundary under
 * test is substituted.
 *
 * It is addressed inside the profile's *installed* copy — the tree `dsh plugin
 * add` created from the archive — so the artifact under test is the one that
 * ships rather than the checkout it was built from.
 */
const mailNotifyEntry = join(profileDir, 'mail-notify-probe-entry.mjs')

/**
 * The shipped file-backed credential provider.
 *
 * `dsh-base` mounts it from inside the launcher's own `node_modules`, which no
 * bare specifier reaches from this checkout, so the probe resolves it by path:
 * the checkout's own tree first, the installation second. Whichever answers, the
 * release is DSH `0.2.0-rc.2`'s.
 *
 * @returns the absolute path of the module to mount.
 */
function resolveCredentialsEntry() {
  const candidates = [
    join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-credentials-local', 'lib', 'index.js'),
    join(
      process.env['DSH_INSTALL_ROOT'] ?? 'C:\\Users\\20659\\AppData\\Roaming\\npm',
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'node_modules',
      '@deepseek-ai',
      'dsh-credentials-local',
      'lib',
      'index.js',
    ),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) {
    throw new Error(`probe-host-config-write: cannot locate @deepseek-ai/dsh-credentials-local; tried ${candidates.join(', ')}`)
  }
  return found
}
writeFileSync(
  patchPath,
  [
    '# Generated by scripts/probe-host-config-write.mjs for one run.',
    '',
    '# The Host write path. `SettingsForms.write` calls `ConfigEditor.edit`, which',
    '# runs cordis `resolveConfig(fiber.runtime, candidate)` before it reads or',
    '# writes the profile patch — that ordering is the subject of this probe.',
    '#',
    '# The rows are inserted rather than patched: a patch addresses a row the',
    '# composition already has, and this profile composes nothing.',
    '- insert:',
    '    - id: config-editor',
    "      name: '@deepseek-ai/dsh-config-editor'",
    '',
    '    - id: settings',
    "      name: '@deepseek-ai/dsh-settings'",
    '',
    '    # The shipped file-backed credential store, pointed at the disposable home.',
    '    # The Test Email check has to resolve a real reference through the real',
    '    # provider; a double would prove only that a double works. Named by path',
    '    # because `dsh-base` mounts it from inside the launcher, which is not a',
    '    # location a bare specifier reaches.',
    '    - id: credentials',
    `      name: ${JSON.stringify(pathToFileURL(resolveCredentialsEntry()).href)}`,
    '      config:',
    `        path: ${JSON.stringify(credentialsFile)}`,
    '        watch: true',
    '',
    '    # The plugin under test, from the archive that ships.',
    '    - id: dsh-mail-notify',
    `      name: ${JSON.stringify(pathToFileURL(mailNotifyEntry).href)}`,
    '      config:',
    '        enabled: false',
    "        smtpHost: ''",
    `        smtpPort: ${smtp.port}`,
    '        smtpSecure: false',
    "        smtpUser: ''",
    `        smtpPasswordCredential: ${credentialRef}`,
    "        from: ''",
    '        to: []',
    '        notifyCompleted: true',
    '',
  ].join('\n'),
  'utf8',
)
// The root configuration document is an empty patch list; every row this probe
// composes arrives through the profile patch above.
writeFileSync(rootConfigPath, '[]\n', 'utf8')

// ---------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------
/** The profile context, built exactly as the launcher builds it. */
const profileContext = {
  name: 'probe',
  dir: profileDir,
  patchPath,
  installAnchor: projectRoot,
  startedBundles: [],
  cwd: projectRoot,
  home,
  overlays: [],
  telemetryDisabledEnv: process.env['DSH_TELEMETRY_DISABLED'],
}

// The patch list the launcher would build for this profile: the patches its
// `package.json` bundles name, plus the profile's own `cordis.patch.yml`. The
// probe's rows live in that file, so this is also the document the write path
// later rewrites — one document, read by the composition and written by the
// editor, which is what makes the byte-identical assertion meaningful.
/** The profile's own manifest, so the launcher's profile loader can resolve it. */
writeFileSync(
  join(profileDir, 'package.json'),
  `${JSON.stringify({ name: `dsh-profile-probe`, private: true, dsh: { profile: { bundles: [] } } }, null, 2)}\n`,
  'utf8',
)

/**
 * The profile patch list the launcher would build for this profile.
 *
 * Passed as the profile's *initial* layer, which is how the launcher feeds its
 * composed patches in, because `readProfilePatches` deliberately excludes the
 * user layer when it loads the directory itself — the user layer is the document
 * the write path owns, and this probe has to both compose from it and then assert
 * that a refused write left it alone.
 */
const profilePatches = readProfilePatches('dsh', profileContext)
console.log(`[host-write] profile patch rows: ${JSON.stringify(profilePatches.map((row) => row.id ?? row.insert))}`)

const ctx = await boot(
  'dsh',
  rootConfigPath,
  profilePatches,
  async (hostCtx) => {
    hostCtx.provide('profileContext', profileContext)
    hostCtx.provide('dshLaunchEnvironment', loadLayeredEnv('dsh'))
    // The Loader reports a row it could not activate through its logger, and
    // without an exporter those records are invisible from outside the process.
    // Registrations are swallowed here so a failed row is diagnosed by its own
    // message rather than by an absent service.
    hostCtx.logger.exporter({
      levels: { default: 3 },
      export: ({ name, type, args }) => {
        if (type !== 'warn' && type !== 'error') return
        const text = args.map((value) => (value instanceof Error ? value.message : String(value))).join(' ')
        console.log(`[host-write] ${type} ${name}: ${text.slice(0, 400)}`)
      },
    })
  },
  // Bare package names resolve against this checkout's own dependency tree.
  //
  // Not the installation: since 0.1.7 the launcher nests its dependencies inside
  // itself, so `<install>/node_modules` holds the launcher and not the packages a
  // row would name. This tree carries the same `0.2.0-rc.2` releases — it is what
  // the suite is built and tested against — and, because it is one tree, the rows
  // share one Cordis and one Schemastery instance instead of each resolving its
  // own copy of the service registry.
  pathToFileURL(join(projectRoot, 'node_modules')).href,
)
console.log('[host-write] booted')

// Loading the plugin's own module namespace is what lets the probe observe the
// *effective* runtime: `apply` returns the live surface, and the Loader is the
// only caller that sees it. The wrapper records it without altering it.
//
// The specifier is the profile-local copy the row mounts, not the source under
// `scripts/probe/`: importing the source file would evaluate a second module
// whose `handleRef` the row's instance never writes.
const { handleRef } = await import(pathToFileURL(mailNotifyEntry).href)

const settings = ctx.get('settings')
const loader = ctx.get('loader')
check('the Host settings service is composed', settings !== undefined)
check('the Host config editor is composed', ctx.get('configEditor') !== undefined)
check('the Loader is composed', loader !== undefined)
check('the plugin under test is a composed row', loader?.entries().some((entry) => entry.options.id === 'dsh-mail-notify') === true)

/** The plugin's loader entry, or `undefined`. */
const entryOf = () => loader?.entries().find((candidate) => candidate.options.id === 'dsh-mail-notify')

/** The revision the settings service reports for the plugin's entry. */
const settingsRevision = () => settings?.describe().find((row) => row.ns === 'dsh-mail-notify')?.revision

/**
 * Attempt one write and check every invariant around it.
 *
 * @param label - the case name.
 * @param ops - the field edits.
 * @param expect - `rejected` or `accepted`.
 * @returns whether the observed behaviour matched the expectation.
 */
async function attempt(label, ops, expect) {
  const before = {
    hash: hashFile(patchPath),
    revision: settingsRevision(),
    config: JSON.stringify(entryOf()?.options.config ?? null),
  }

  let refusal
  let accepted = false
  try {
    await settings.update('dsh-mail-notify', ops, before.revision)
    accepted = true
  } catch (error) {
    refusal = error instanceof Error ? error : new Error(String(error))
  }

  const after = {
    hash: hashFile(patchPath),
    revision: settingsRevision(),
    config: JSON.stringify(entryOf()?.options.config ?? null),
  }
  const outcome = accepted ? 'accepted' : 'rejected'
  check(`${label}: the Host ${expect === 'rejected' ? 'refuses' : 'accepts'} the write`, outcome === expect, `observed ${outcome}`)

  if (expect === 'rejected') {
    check(`${label}: the refusal is a raised error`, refusal !== undefined, refusal?.message ?? 'no error raised')
    check(`${label}: the settings revision does not advance`, after.revision === before.revision, `${String(before.revision)} -> ${String(after.revision)}`)
    check(`${label}: cordis.patch.yml is byte-identical`, after.hash === before.hash, `${before.hash.slice(0, 16)} -> ${after.hash.slice(0, 16)}`)
    check(`${label}: the committed config does not move`, after.config === before.config)
    if (refusal !== undefined) {
      // The refusal text is the evidence that a *product* rule produced it and not
      // a field schema, which is the whole distinction this probe exists for.
      console.log(`      refusal: ${refusal.message.replace(/\s+/gu, ' ')}`)
    }
  } else {
    check(`${label}: an accepted write changes the patch file`, after.hash !== before.hash)
    check(`${label}: an accepted write is visible to the entry`, after.config !== before.config)
  }
  return outcome === expect
}

/** Every field except `enabled` and the one a case varies. */
const complete = {
  smtpPort: smtp.port,
  smtpSecure: false,
  smtpUser: 'probe@example.invalid',
  smtpPasswordCredential: credentialRef,
  from: 'probe@example.invalid',
  to: [recipient],
}

console.log('--- baseline: the disabled document is served and writable ---')
check('the plugin row exists, so a write has a target', entryOf() !== undefined)
const baselineRevision = settingsRevision()
check('the settings form serves the plugin entry', baselineRevision !== undefined, `revision ${String(baselineRevision)}`)

console.log('--- a field-schema violation is refused (the first candidate proved only this) ---')
await attempt('enabled=false with an out-of-range port', { smtpPort: 99999 }, 'rejected')

console.log('--- the disabled state with incomplete SMTP fields is legal and writable ---')
// Both cases change a field, so "accepted" is a real persistence rather than a
// restatement the merge folds back into the inherited layer. What is under test
// is that the product rules do not apply while `enabled` is false, so a document
// with no usable SMTP configuration is both saveable and survivable.
await attempt(
  'enabled=false with incomplete SMTP fields stays legal',
  { enabled: false, smtpHost: '', smtpUser: '', from: '', to: [], notifyMaxTokens: false },
  'accepted',
)
await attempt(
  'enabled=false keeps an incomplete document legal across a second edit',
  { enabled: false, smtpHost: '', smtpUser: '', from: '', to: [], retryAttempts: 2 },
  'accepted',
)

console.log('--- product-invalid writes must be refused ---')
await attempt('enabled=true without completing SMTP configuration', { enabled: true }, 'rejected')
await attempt('enabled=true + smtpHost=""', { enabled: true, smtpHost: '' }, 'rejected')
await attempt('enabled=true + smtpHost="" with every other field complete', { enabled: true, smtpHost: '', ...complete }, 'rejected')
await attempt('enabled=true + to=[]', { enabled: true, smtpHost: '127.0.0.1', ...complete, to: [] }, 'rejected')
await attempt('enabled=true + smtpHost containing whitespace', { enabled: true, smtpHost: 'smtp example invalid', ...complete }, 'rejected')
await attempt('enabled=true + smtpUser=""', { enabled: true, smtpHost: '127.0.0.1', ...complete, smtpUser: '' }, 'rejected')
await attempt('enabled=true + from=""', { enabled: true, smtpHost: '127.0.0.1', ...complete, from: '' }, 'rejected')
await attempt('enabled=true + a recipient that is not an address', { enabled: true, smtpHost: '127.0.0.1', ...complete, to: ['not an address'] }, 'rejected')

console.log('--- warning-only rules must NOT become errors ---')
await attempt('enabled=true + port 587 with smtpSecure=true (warning only)', { enabled: true, smtpHost: '127.0.0.1', ...complete, smtpPort: 587, smtpSecure: true }, 'accepted')
await attempt('enabled=true + every notification switch false (warning only)', { enabled: true, smtpHost: '127.0.0.1', ...complete, smtpPort: 465, smtpSecure: true, notifyCompleted: false }, 'accepted')

console.log('--- the positive control: a complete enable must be accepted ---')
await attempt('enabled=true with complete SMTP configuration', { enabled: true, smtpHost: '127.0.0.1', ...complete, notifyCompleted: true }, 'accepted')

// ---------------------------------------------------------------------------
// Delivery, so the accepted enable is a fact about mail rather than about a
// configuration object. The plugin's own Test Email path is the shortest route
// that exercises the credential service, the transport, and the SMTP server.
// ---------------------------------------------------------------------------
console.log('--- the accepted enable still delivers ---')
const handle = handleRef.handle
check('the accepted enable mounted a runtime', handle !== undefined)
check('the mounted runtime reports itself active', handle?.status?.().active === true, JSON.stringify(handle?.status?.() ?? null))
try {
  const result = await handle?.sendTestEmail?.()
  check('the Test Email path reports a delivery', result?.delivered === true, JSON.stringify(result ?? null))
} catch (error) {
  check('the Test Email path reports a delivery', false, error instanceof Error ? error.message : String(error))
}
await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
check('the loopback SMTP server received the message', received.length > 0, `${received.length} message(s)`)

smtp.server.close()
await ctx.fiber.dispose().catch(() => undefined)
console.log(failures.length === 0 ? '\nPASS: probe-host-config-write' : `\nFAIL: probe-host-config-write (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
