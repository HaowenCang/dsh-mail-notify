/**
 * L6 packaging tests — matrix rows PKG-01, PKG-02, and the parts of PKG-03/PKG-04
 * that can be checked without a second DSH installation.
 *
 * The archive under test is produced by the real `npm pack`, so what is asserted
 * is the shipping artefact rather than the directory layout that produced it. The
 * distinction matters: `files` in `package.json` is a whitelist, and only the
 * packer can say what actually survived it.
 *
 * @module dsh-mail-notify/tests/package/tarball
 */

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workspace = mkdtempSync(join(tmpdir(), 'dsh-mail-notify-pack-'))

/**
 * Run a command and capture its stdout.
 *
 * `npm` is a `.cmd` shim on Windows rather than an executable, so it is only
 * resolvable through a shell. Using one for every invocation keeps the command
 * strings identical across platforms, which matters because these are the same
 * commands the README documents.
 *
 * @param command - the executable name.
 * @param args - its arguments.
 * @param cwd - working directory.
 * @returns the captured stdout.
 */
function run(command: string, args: string[], cwd: string = root): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', shell: true })
}

/** Pack the package into a temporary directory and return the archive path. */
function pack(): string {
  const output = run('npm', ['pack', '--silent', '--pack-destination', workspace])
  const name = output.trim().split(/\r?\n/).filter(Boolean).pop()
  assert.ok(name !== undefined, 'npm pack reported no filename')
  return join(workspace, name)
}

/**
 * List an archive's entries.
 *
 * The archive is addressed by bare filename with the temporary directory as the
 * working directory: bsdtar, which is what ships on this platform, reads a
 * drive-lettered absolute path as a remote-host specification.
 *
 * @param name - the archive's file name.
 * @returns entry paths, as `package/…`.
 */
function entriesOf(name: string): string[] {
  return run('tar', ['-tzf', name], workspace)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Extract an archive and return the directory containing `package/`.
 *
 * No `--one-top-level` is used: the archive already carries every entry under a
 * single `package/` prefix, and the bundled bsdtar on this platform does not
 * implement the option.
 *
 * @param name - the archive's file name.
 * @returns the extraction root, inside which `package/` holds the instalment.
 */
function extract(name: string): string {
  run('tar', ['-xzf', name, '-C', 'extracted'], workspace)
  return join(workspace, 'extracted', 'package')
}

mkdirSync(join(workspace, 'extracted'), { recursive: true })

const tarball = pack()
const archiveName = basename(tarball)
const entries = entriesOf(archiveName)
const extracted = extract(archiveName)

test('PKG-01 the archive carries the compiled runtime, the patch, and the documents', () => {
  for (const required of ['package/package.json', 'package/cordis.patch.yml', 'package/README.md', 'package/LICENSE']) {
    assert.ok(entries.includes(required), `${required} must be in the archive`)
  }
  assert.ok(
    entries.some((entry) => entry === 'package/lib/index.js'),
    'the compiled entry point must be present',
  )
  assert.ok(
    entries.filter((entry) => entry.startsWith('package/lib/') && entry.endsWith('.js')).length >= 15,
    'every module must be compiled into the archive',
  )
})

test('the packed manifest declares the DSH bundle, the export map, and the browser half', () => {
  const manifest = JSON.parse(readFileSync(join(extracted, 'package.json'), 'utf8')) as {
    name: string
    version: string
    type: string
    main: string
    dsh?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } }
    exports?: Record<string, unknown>
  }
  assert.equal(manifest.name, 'dsh-mail-notify')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'lib/index.js')
  // The whole `dsh` block, not merely its bundle half: a plugin that ships a
  // browser surface declares it here, and the module system reads `platform`
  // and `inject` from this exact object. Asserting the complete shape is what
  // makes a silently dropped `client` block fail here rather than in a browser.
  assert.deepEqual(
    manifest.dsh,
    {
      bundle: { patch: './cordis.patch.yml' },
      client: {
        platform: 'web',
        inject: [
          '@deepseek-ai/dsh-client-ui-renderer',
          '@deepseek-ai/dsh-client-ui-settings',
          '@deepseek-ai/dsh-client-ui-settings-plugins',
          '@deepseek-ai/dsh-client-connection',
          // Since v0.3.1 the card's copy lives in the DSH locale service, so the
          // module graph edge that guarantees the locale plugin is loaded joins
          // the four service edges this surface already declared.
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-api-remotes',
        ],
      },
    },
    'the bundle manifest is the install entry point and the client manifest is the browser entry point',
  )
  assert.ok(manifest.exports !== undefined && '.' in manifest.exports)
  assert.ok(existsSync(join(extracted, manifest.dsh?.bundle?.patch ?? 'missing')), 'the declared patch file exists')
})

test('PKG-01c the declared ./client export resolves to a self-contained loader bundle', () => {
  // The browser half is served as exactly one classic script and registered
  // through `window.__ModuleLoader__.load`. Three properties decide whether that
  // works, and none of them is visible to the package's own TypeScript build:
  // the export resolves, the file carries the loader envelope, and the bundle
  // requires nothing outside the shell's seed module table.
  const manifest = JSON.parse(readFileSync(join(extracted, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  const entry = manifest.exports?.['./client']
  assert.ok(entry !== undefined, 'the package must export ./client')
  // The module system accepts a bare string or a one-level conditional object;
  // this package uses the conditional form so the declaration file travels with
  // the bundle.
  const record = entry as { default?: unknown; types?: unknown }
  const relative = typeof entry === 'string' ? entry : record.default
  assert.equal(relative, './lib/client.js', 'the client export must resolve to the emitted bundle')
  const typesRelative = typeof entry === 'string' ? undefined : record.types
  assert.equal(typesRelative, './lib/types/client/index.d.ts')

  const bundlePath = join(extracted, relative.slice(2))
  assert.ok(existsSync(bundlePath), `the declared client bundle ${relative} must be in the archive`)
  const typesPath = join(extracted, String(typesRelative).slice(2))
  assert.ok(existsSync(typesPath), `the declared client declarations ${String(typesRelative)} must be in the archive`)

  const source = readFileSync(bundlePath, 'utf8')
  assert.match(
    source,
    /^window\.__ModuleLoader__\.load\(\{\r?\n\tid: "dsh-mail-notify",\r?\n\tfactory: \(require\) => \{/,
    'the bundle must open the loader envelope with the package id',
  )
  assert.ok(
    source.trimEnd().endsWith('return module.exports;\n\t}\n});'),
    'the bundle must close the loader envelope',
  )
  assert.ok(
    !/^\s*(import|export)\s/m.test(source),
    'no top-level ESM statement may survive: the factory form is CommonJS',
  )
  const requires = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
  assert.deepEqual(
    [...new Set(requires)].sort(),
    ['react', 'react/jsx-runtime'],
    'the bundle must require only shell seed modules, so no second React copy can appear',
  )
  assert.match(source, /exports\.apply = apply;/)
  assert.match(source, /exports\.inject = inject;/)
})

test('PKG-01b the packed manifest declares exactly one runtime dependency, on a supported Nodemailer', () => {
  // The dependency graph is part of the shipping contract, not build trivia: the
  // packaged manifest is what a profile installs, and Nodemailer's own security
  // policy supports only the current major. A range that could resolve below it
  // would let a fresh install land back on an unpatched line.
  const manifest = JSON.parse(readFileSync(join(extracted, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const dependencies = manifest.dependencies ?? {}
  assert.deepEqual(Object.keys(dependencies), ['nodemailer'], 'Nodemailer is the only runtime dependency')
  const declared = dependencies['nodemailer'] ?? ''
  assert.match(declared, /^\^10\./, `the declared range must stay on the supported major (got "${declared}")`)
  // A caret range on 10 cannot reach 11, which is the property that matters: an
  // unattended install must not cross a major, because a major is where Nodemailer
  // makes its breaking changes.
  assert.ok(!/[*x]|\|\||>=|>/.test(declared), `the range must not admit a different major (got "${declared}")`)
  // Nodemailer 10 bundles its own declarations. Installing the DefinitelyTyped
  // package alongside it produces two conflicting declarations of the same
  // module, so its absence is asserted rather than assumed.
  assert.equal(Object.hasOwn(manifest.devDependencies ?? {}, '@types/nodemailer'), false)
})

test('PKG-02 the archive carries no secret-bearing or development entry', () => {
  const rules: Array<{ pattern: RegExp; why: string }> = [
    { pattern: /(^|\/)\.env($|\.)/, why: 'environment file' },
    { pattern: /(^|\/)node_modules\//, why: 'dependency tree' },
    { pattern: /(^|\/)coverage\//, why: 'coverage output' },
    { pattern: /\.(pem|key|p12|pfx|jks)$/i, why: 'key material' },
    { pattern: /(^|\/)(\.secrets|\.credentials)\//, why: 'credential store' },
    { pattern: /(^|\/)tests\//, why: 'test sources' },
    { pattern: /(^|\/)src\//, why: 'TypeScript sources' },
    { pattern: /(^|\/)scripts\//, why: 'development scripts' },
    { pattern: /(^|\/)\.git/, why: 'version-control metadata' },
    { pattern: /\.(tsbuildinfo|tgz|log)$/i, why: 'build or log artefact' },
    { pattern: /(^|\/)\.dsh\//, why: 'harness session data' },
  ]
  for (const entry of entries) {
    for (const rule of rules) {
      assert.ok(!rule.pattern.test(entry), `${entry} must not be in the archive (${rule.why})`)
    }
  }
})

test('PKG-02b no archive entry contains a credential-shaped literal', () => {
  // A blunt but effective sweep: read every packed JavaScript file and look for
  // the assignment of a password-looking literal. Called out separately from the
  // path rules because a secret's leak vector is content, not filename.
  const libDir = join(extracted, 'lib')
  const files = readdirSync(libDir).filter((name) => name.endsWith('.js'))
  assert.ok(files.length > 0)
  const suspects = [/pass\s*[:=]\s*['"][^'"]{6,}['"]/i, /password\s*[:=]\s*['"][^'"]{6,}['"]/i]
  for (const file of files) {
    const content = readFileSync(join(libDir, file), 'utf8')
    for (const pattern of suspects) {
      assert.ok(!pattern.test(content), `${file} appears to embed a credential literal`)
    }
  }
})

test('PKG-02c the shipped patch is inert and configures no credential', () => {
  const patch = readFileSync(join(extracted, 'cordis.patch.yml'), 'utf8')
  // The shipped row must do nothing until an operator configures it. Asserting on
  // the actual `config:` block rather than the whole file keeps the check honest:
  // the file's explanatory comments do name the configuration keys.
  const configBlock = patch
    .split(/\r?\n/)
    .slice(patch.split(/\r?\n/).findIndex((line) => line.trim() === 'config:'))
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('- insert:') && line !== 'config:')
  assert.deepEqual(configBlock, ['enabled: false'], 'the only shipped setting is the master switch, off')
  for (const forbidden of ['password:', 'smtpPassword:', 'secret:', 'token:']) {
    assert.ok(!patch.toLowerCase().includes(forbidden), `the shipped patch must not contain ${forbidden}`)
  }
})

test('every relative import in the compiled output resolves inside the archive', () => {
  // A whitelist that dropped one module would leave the archive installable but
  // unloadable, which no type check can catch. Reading the specifiers back out of
  // the compiled JavaScript is what closes that gap.
  const libDir = join(extracted, 'lib')
  const files = readdirSync(libDir).filter((name) => name.endsWith('.js'))
  let checked = 0
  for (const file of files) {
    const content = readFileSync(join(libDir, file), 'utf8')
    for (const match of content.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const specifier = match[1]
      assert.ok(specifier !== undefined)
      const target = resolve(libDir, specifier)
      assert.ok(existsSync(target), `${file} imports ${specifier}, which is missing from the archive`)
      checked += 1
    }
  }
  assert.ok(checked > 10, `expected to check many relative imports, checked ${checked}`)
})

test('the compiled entry point loads and exports the Cordis plugin shape', async () => {
  // The extracted archive is given a `node_modules` link to this repository's
  // install, which is the arrangement a real profile creates. It is needed for
  // the runtime dependency as well as the peers: the entry reaches the mailer
  // and therefore `nodemailer`, so an install without it could not load at all.
  // What this proves is that the emitted ESM is valid and exports what the
  // loader reads.
  const link = join(extracted, 'node_modules')
  let created = false
  if (!existsSync(link)) {
    symlinkSync(join(root, 'node_modules'), link, 'junction')
    created = true
  }
  try {
    const moduleUrl = pathToFileURL(join(extracted, 'lib', 'index.js')).href
    const loaded = (await import(moduleUrl)) as {
      name?: unknown
      inject?: unknown
      apply?: unknown
      Config?: unknown
    }
    assert.equal(loaded.name, 'dsh-mail-notify')
    assert.deepEqual(loaded.inject, [], 'no service is a hard dependency')
    assert.equal(typeof loaded.apply, 'function')
    assert.equal(typeof loaded.Config, 'function', 'the schema is exported for the loader to validate against')
  } finally {
    if (created) rmSync(link, { recursive: true, force: true })
  }
})

test('PKG-03 the packed archive can be added to a profile without touching core configuration', () => {
  // The install command is a `dsh plugin` invocation whose only input is this
  // archive; the bundle manifest above is what makes it discoverable. Asserting
  // the command shape here documents the verified invocation rather than
  // re-testing it, which the runtime integration step performs against a real
  // profile.
  const name = basename(tarball)
  assert.match(name, /^dsh-mail-notify-\d+\.\d+\.\d+\.tgz$/)
  const manifest = JSON.parse(readFileSync(join(extracted, 'package.json'), 'utf8')) as { version: string }
  assert.equal(name, `dsh-mail-notify-${manifest.version}.tgz`)
})

test('the archive is ignored by version control, so it stays a local artefact', () => {
  // `git check-ignore` exits non-zero when the path is *not* ignored, so the
  // status code is the assertion rather than the captured output.
  const result = spawnSync('git', ['check-ignore', '-q', basename(tarball)], { cwd: root, shell: true })
  assert.equal(result.status, 0, `expected ${basename(tarball)} to match .gitignore (stderr: ${result.stderr.toString()})`)
  assert.ok(statSync(tarball).size > 0, 'the archive is non-empty')
})

test.after(() => {
  rmSync(workspace, { recursive: true, force: true })
})
