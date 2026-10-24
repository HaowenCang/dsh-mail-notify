/**
 * Child half of the credential-conflict test.
 *
 * It runs in its own process with an isolated `DSH_HOME` and a synthetic
 * `DSH_MAIL_SMTP_PASSWORD` B inherited from its parent. The parent has already
 * written a different synthetic value A to `$DSH_HOME/.credentials.yaml`. The
 * child then mounts the **installed** `@deepseek-ai/dsh-credentials-local`
 * provider — the package generation the verified target host ships, at the
 * exact version the repository declares in `devDependencies` — and asks it to
 * resolve the reference three times:
 *
 * ```text
 * 1. file A + env B        → A, source file     (precedence)
 * 2. unset the file entry  → B, source env      (fallback)
 * 3. set C                 → C, source file     (rotation, next resolve)
 * ```
 *
 * The three results are recorded separately. No branch prints or writes a
 * credential value: the report carries booleans, layer names, lengths and
 * version strings only. The values exist in the process environment / provider
 * document and are carried into the child as `PROBE_EXPECT_A/B/C` for in-memory
 * comparison.
 *
 * This file is not a test by itself; `credential-precedence.test.ts` spawns it.
 */

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'

const REF = 'DSH_MAIL_SMTP_PASSWORD'
const A = process.env['PROBE_EXPECT_A'] ?? ''
const B = process.env['PROBE_EXPECT_B'] ?? ''
const C = process.env['PROBE_EXPECT_C'] ?? ''
const reportPath = process.env['PROBE_REPORT']
const expectedHome = process.env['PROBE_EXPECTED_HOME']
const home = process.env['DSH_HOME']

/** Fail without ever echoing a credential value. */
function fail(message) {
  throw new Error(message)
}

/** Assert a condition with a value-free message. */
function ensure(condition, message) {
  if (!condition) fail(message)
}

/** Read a package version without printing any part of the environment. */
function versionOf(packageName) {
  const require = createRequire(import.meta.url)
  return JSON.parse(readFileSync(require.resolve(`${packageName}/package.json`), 'utf8')).version
}

/** Record one phase exactly as the parent will assert it. */
function phase(name, expectedValue, expectedSource, resolved, described) {
  return {
    phase: name,
    pass:
      resolved !== undefined &&
      resolved.value === expectedValue &&
      resolved.source === expectedSource &&
      described.configured === true &&
      described.source === expectedSource &&
      described.writable === true,
    source: resolved?.source ?? null,
    valueLength: resolved?.value?.length ?? 0,
    valueMatches: resolved !== undefined && resolved.value === expectedValue,
    configured: described.configured,
    describedSource: described.source ?? null,
    writable: described.writable,
  }
}

async function main() {
  ensure(A !== '' && B !== '' && C !== '', 'the synthetic values were not supplied')
  ensure(A !== B && B !== C && A !== C, 'the synthetic values must differ')
  ensure(typeof home === 'string' && home !== '', 'DSH_HOME is not set')
  ensure(expectedHome !== undefined && home === expectedHome, 'DSH_HOME is not the isolated home')
  ensure(process.env['DSH_MAIL_SMTP_PASSWORD'] === B, 'the inherited environment does not carry the conflicting value')

  const document = readFileSync(`${home}/.credentials.yaml`, 'utf8')
  ensure(document.includes(REF), 'the isolated credential document does not name the reference')

  const ctx = new Context()
  // The launcher normally publishes this snapshot; without a launcher the real
  // provider falls back to `process.env` anyway, but publishing the real
  // factory's snapshot states the layer explicitly.
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]))
  await ctx.plugin(LocalCredentialProvider, { watch: false })
  const provider = ctx.get('credentials')
  ensure(provider !== undefined, 'the installed provider did not publish ctx.credentials')

  // 1. Precedence: both layers carry a value; the managed file must win.
  const precedenceResolved = await provider.resolve(REF)
  const precedenceDescribed = await provider.describe(REF)
  const precedence = phase('precedence', A, 'file', precedenceResolved, precedenceDescribed)

  // 2. Fallback: remove the managed value; the inherited environment applies.
  await provider.unset(REF)
  const fallbackResolved = await provider.resolve(REF)
  const fallbackDescribed = await provider.describe(REF)
  const fallback = phase('fallback', B, 'env', fallbackResolved, fallbackDescribed)

  // 3. Rotation: store a new value; the very next resolve must see it.
  await provider.set(REF, C)
  const rotationResolved = await provider.resolve(REF)
  const rotationDescribed = await provider.describe(REF)
  const rotation = phase('rotation', C, 'file', rotationResolved, rotationDescribed)

  await ctx.fiber.dispose()

  const report = {
    versions: {
      credentialsLocal: versionOf('@deepseek-ai/dsh-credentials-local'),
      launchEnvironment: versionOf('@deepseek-ai/dsh-launch-environment'),
    },
    // Presence only: no value, and no value prefix/suffix.
    conflictPresent: process.env[REF] === B,
    dshHomeIsolated: home === expectedHome,
    phases: { precedence, fallback, rotation },
  }
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const failed = Object.values(report.phases).filter((entry) => !entry.pass).map((entry) => entry.phase)
  if (failed.length > 0) {
    process.stderr.write(`credential-precedence: failed phases: ${failed.join(', ')}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write('credential-precedence: 3 phases executed, 3 passed\n')
}

main().catch((error) => {
  // The error message is deliberately generic; the provider never quotes a
  // value, and this layer must not start doing so on a failure path.
  process.stderr.write(`credential-precedence: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
