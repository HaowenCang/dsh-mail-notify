/**
 * Credential conflict test: precedence, fallback and rotation, separately.
 *
 * The earlier `probe:credentials` run had the value only in the managed file and
 * asserted it was absent from every environment layer. That proves the file
 * layer can supply a value; it cannot prove which layer wins when both do. This
 * test creates the conflict on purpose:
 *
 * - the parent writes synthetic value A to an isolated `$DSH_HOME/.credentials.yaml`;
 * - it spawns a child whose inherited environment carries a different synthetic
 *   value B for the same `CredentialRef`;
 * - the child mounts the **installed** `@deepseek-ai/dsh-credentials-local`
 *   (the exact version declared in `devDependencies`, i.e. the package
 *   generation the verified target host ships) and resolves three times:
 *   A wins over B (`source: file`), removing A reveals B (`source: env`), and a
 *   new stored value C is seen by the next resolve (`source: file`).
 *
 * The three properties are asserted by three separate tests, not folded into a
 * single pass, and each phase also checks `describe()`'s `configured`, `source`
 * and `writable`. The report is scanned to prove no synthetic value was written
 * to it.
 *
 * The expected provider version is not a literal. It is derived from the exact
 * `@deepseek-ai/dsh-*` version declared in `devDependencies` (the compile and
 * verification baseline), may be overridden with `DSH_COMPAT_EXPECTED_VERSION`
 * for an ad-hoc probe, and is always required to fall inside the host range the
 * manifest declares in `engines.dsh`. Moving the baseline therefore moves the
 * expectation instead of leaving a stale release asserted.
 *
 * @module dsh-mail-notify/tests/integration/credential-precedence
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

/** Synthetic values; none is a real password and none is printed. */
const A = 'SYNTHETIC_CREDENTIAL_FILE_A_NOT_A_REAL_PASSWORD_9f2c'
const B = 'SYNTHETIC_CREDENTIAL_ENV_B_NOT_A_REAL_PASSWORD_4a71'
const C = 'SYNTHETIC_CREDENTIAL_ROTATED_C_NOT_A_REAL_PASSWORD_e63d'
const REF = 'DSH_MAIL_SMTP_PASSWORD'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..', '..')
/** Every writable path this test uses lives below this gitignored root. */
const scratchRoot = join(projectRoot, 'tmp', 'phase051-r1', 'credential-precedence-tests')
const childPath = join(projectRoot, 'tests', 'support', 'credential-precedence-child.mjs')

/** The parts of the manifest this test verifies its expectation against. */
interface Manifest {
  version: string
  engines: { dsh?: string }
  devDependencies: Record<string, string>
}

/** The manifest as declared in the repository, not as installed. */
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as Manifest

/**
 * The declared compile and verification baseline for the DSH packages.
 *
 * Reading it from `devDependencies` rather than restating a literal is what
 * keeps the expectation from going stale when the baseline moves.
 */
const declaredBaselineVersion = manifest.devDependencies['@deepseek-ai/dsh-credentials-local'] ?? ''

/** The one host range the manifest claims support for. */
const declaredHostRange = manifest.engines.dsh ?? ''

/**
 * An optional ad-hoc override for probing another installed provider build.
 *
 * It does not weaken the check: the version it names is still required to fall
 * inside `declaredHostRange`, so it cannot be used to assert an unsupported
 * provider.
 */
const versionOverride = process.env['DSH_COMPAT_EXPECTED_VERSION'] ?? ''
const expectedVersion = versionOverride === '' ? declaredBaselineVersion : versionOverride

/** A parsed `major.minor.patch[-prerelease]` version. */
interface ParsedVersion {
  core: [number, number, number]
  prerelease: string[]
}

/** Parse the version shape the engine range is written in, rejecting anything else. */
function parseVersion(version: string): ParsedVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version)
  if (match === null) throw new Error(`not a supported version literal: ${version}`)
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Compare two versions by SemVer 2.0.0 precedence.
 *
 * The manifest's range is written in SemVer syntax, so the test has to evaluate
 * it with the same ordering rules the host gate uses rather than comparing
 * strings.
 */
function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < a.core.length; index += 1) {
    const delta = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (delta !== 0) return delta
  }
  // A release ranks above any of its prereleases.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    // A shorter prerelease ranks below a longer one with an equal prefix.
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      const delta = Number(x) - Number(y)
      if (delta !== 0) return delta
      continue
    }
    // Numeric identifiers rank below alphanumeric ones.
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * Whether `version` satisfies a declared two-sided host range such as
 * `>=0.2.1-rc.2 <0.2.2-0`.
 *
 * The shape is asserted rather than guessed: if the manifest stops expressing
 * the range as a lower and an upper bound, this fails loudly instead of
 * silently approving the version.
 */
function satisfiesDeclaredRange(version: string, range: string): boolean {
  const bounds = range.split(' ')
  const lowerText = bounds[0]
  const upperText = bounds[1]
  if (
    bounds.length !== 2 ||
    lowerText === undefined ||
    upperText === undefined ||
    !lowerText.startsWith('>=') ||
    !upperText.startsWith('<')
  ) {
    throw new Error(`the declared engines.dsh range is not a two-sided bound: ${range}`)
  }
  return compareVersions(version, lowerText.slice(2)) >= 0 && compareVersions(version, upperText.slice(1)) < 0
}

/** One phase as the child records it. */
interface PhaseReport {
  phase: string
  pass: boolean
  source: string | null
  valueLength: number
  valueMatches: boolean
  configured: boolean
  describedSource: string | null
  writable: boolean
}

/** The child's JSON report, with no credential value in it. */
interface ChildReport {
  versions: { credentialsLocal: string; launchEnvironment: string }
  conflictPresent: boolean
  dshHomeIsolated: boolean
  phases: { precedence: PhaseReport; fallback: PhaseReport; rotation: PhaseReport }
}

let caseDir = ''
let reportText = ''
let report: ChildReport

before(() => {
  mkdirSync(scratchRoot, { recursive: true })
  caseDir = mkdtempSync(join(scratchRoot, 'case-'))
  const home = join(caseDir, 'home')
  const reportPath = join(caseDir, 'out', 'report.json')
  mkdirSync(home, { recursive: true })

  writeFileSync(
    join(home, '.credentials.yaml'),
    `version: 1\nrefs:\n  ${REF}: ${A}\nrecords: {}\n`,
    'utf8',
  )

  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env['DSH_MAIL_SMTP_PASSWORD']
  delete env['DSH_PROFILE']
  delete env['DSH_PROFILE_DIR']
  delete env['DSH_SESSION_ID']
  for (const name of Object.keys(env)) {
    if (name.startsWith('PROBE_')) delete env[name]
  }
  env['DSH_HOME'] = home
  env['DSH_MAIL_SMTP_PASSWORD'] = B
  env['PROBE_EXPECT_A'] = A
  env['PROBE_EXPECT_B'] = B
  env['PROBE_EXPECT_C'] = C
  env['PROBE_EXPECTED_HOME'] = home
  env['PROBE_REPORT'] = reportPath

  const child = spawnSync(process.execPath, [childPath], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  })
  assert.equal(
    child.status,
    0,
    `the isolated provider child failed\nstdout: ${child.stdout}\nstderr: ${child.stderr}`,
  )
  reportText = readFileSync(reportPath, 'utf8')
  report = JSON.parse(reportText) as ChildReport
  // Optional evidence copy: the value-free report, kept outside the scratch
  // case so a release run can archive it.
  const evidenceReport = process.env['PROBE_REPORT_COPY']
  if (evidenceReport !== undefined && evidenceReport !== '') {
    mkdirSync(dirname(evidenceReport), { recursive: true })
    writeFileSync(evidenceReport, reportText, 'utf8')
  }
})

after(() => {
  if (caseDir === '') return
  // Verify the normalized absolute target before any recursive deletion.
  const resolvedCase = resolve(caseDir)
  const resolvedRoot = resolve(scratchRoot)
  const inside = resolvedCase === resolvedRoot || resolvedCase.startsWith(resolvedRoot + sep)
  assert.ok(inside, `refusing to remove a path outside the test scratch root: ${resolvedCase}`)
  rmSync(resolvedCase, { recursive: true, force: true })
})

describe('credential conflict on the declared target provider', () => {
  it('declares a derivable expected version inside the declared host range', () => {
    assert.notEqual(declaredBaselineVersion, '', 'package.json declares no @deepseek-ai/dsh-credentials-local baseline')
    assert.equal(
      manifest.devDependencies['@deepseek-ai/dsh-credentials'],
      declaredBaselineVersion,
      'the two provider devDependencies must share one exact compile baseline',
    )
    assert.equal(
      manifest.devDependencies['@deepseek-ai/dsh-launch-environment'],
      declaredBaselineVersion,
      'the launch-environment devDependency must share the provider compile baseline',
    )
    assert.notEqual(declaredHostRange, '', 'package.json declares no engines.dsh range')
    assert.equal(
      satisfiesDeclaredRange(declaredBaselineVersion, declaredHostRange),
      true,
      `the declared baseline ${declaredBaselineVersion} is outside the declared host range ${declaredHostRange}`,
    )
    assert.equal(
      satisfiesDeclaredRange(expectedVersion, declaredHostRange),
      true,
      `the expected version ${expectedVersion} is outside the declared host range ${declaredHostRange}`,
    )
  })

  it('ran on the declared target provider in an isolated child', () => {
    assert.equal(report.versions.credentialsLocal, expectedVersion)
    assert.equal(report.versions.launchEnvironment, expectedVersion)
    assert.equal(report.dshHomeIsolated, true)
    assert.equal(report.conflictPresent, true, 'the child did not inherit the conflicting environment value')
  })

  it('PRECEDENCE: the managed file value A wins over the inherited environment value B', () => {
    const phase = report.phases.precedence
    assert.equal(phase.valueMatches, true, 'resolve() did not return the stored value A')
    assert.equal(phase.source, 'file')
    assert.equal(phase.configured, true)
    assert.equal(phase.describedSource, 'file')
    assert.equal(phase.writable, true)
    assert.equal(phase.pass, true)
  })

  it('FALLBACK: removing the stored value reveals the inherited environment value B', () => {
    const phase = report.phases.fallback
    assert.equal(phase.valueMatches, true, 'resolve() did not fall back to the environment value B')
    assert.equal(phase.source, 'env')
    assert.equal(phase.configured, true)
    assert.equal(phase.describedSource, 'env')
    assert.equal(phase.writable, true)
    assert.equal(phase.pass, true)
  })

  it('ROTATION: a newly stored value C is seen by the next resolve()', () => {
    const phase = report.phases.rotation
    assert.equal(phase.valueMatches, true, 'resolve() did not return the rotated stored value C')
    assert.equal(phase.source, 'file')
    assert.equal(phase.configured, true)
    assert.equal(phase.describedSource, 'file')
    assert.equal(phase.writable, true)
    assert.equal(phase.pass, true)
  })

  it('the report carries no credential value', () => {
    for (const value of [A, B, C]) {
      assert.equal(reportText.includes(value), false, 'a synthetic credential value leaked into the report')
    }
  })
})
