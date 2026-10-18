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
 *   (`0.2.1-rc.2`, the target host's provider) and resolves three times:
 *   A wins over B (`source: file`), removing A reveals B (`source: env`), and a
 *   new stored value C is seen by the next resolve (`source: file`).
 *
 * The three properties are asserted by three separate tests, not folded into a
 * single pass, and each phase also checks `describe()`'s `configured`, `source`
 * and `writable`. The report is scanned to prove no synthetic value was written
 * to it.
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

describe('credential conflict on the installed 0.2.1 provider', () => {
  it('ran on the target provider in an isolated child', () => {
    assert.equal(report.versions.credentialsLocal, '0.2.1-rc.2')
    assert.equal(report.versions.launchEnvironment, '0.2.1-rc.2')
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
