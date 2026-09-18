/**
 * The credential-contract proof for the Phase 8.1 probe.
 *
 * The plugin's `smtpPasswordCredential` is validated against a pattern the
 * plugin itself carries, and Phase 8 changed that pattern on a diagnosis that
 * turned out to be wrong. A grammar test against the plugin's own copy cannot
 * catch that class of error, because the copy is what was wrong.
 *
 * So this plugin asks the **installed, shipped** credential service — the same
 * `ctx.credentials` the mailer resolves through, over the disposable probe
 * home's document — the questions the pattern depends on, and compares the
 * answers with DSH's own helper functions:
 *
 * ```text
 * does the reference grammar the plugin validates match credentialRef()?
 * does the document hold the reference, and which layer supplies it?
 * does resolve() return a value, and describe() report it configured?
 * is the value reachable from any environment layer? (it must not be)
 * does a <scope>/<id> CredentialKey resolve? (it must not)
 * does the document parser accept a CredentialKey in `refs`? (it must not)
 * ```
 *
 * Two properties keep this honest. The disposable probe home is the only
 * credential source, and the checker asserts the value is absent from every
 * environment layer before it accepts a source of `file` — so "it resolved"
 * cannot be a coincidence of ambient state. And no branch here ever writes the
 * value: the report carries presence, layer, and length only (§15).
 *
 * @module dsh-mail-notify/scripts/probe/credential-contract
 */

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-credential-contract'

/**
 * Required services.
 *
 * `inject` is what makes the fiber wait: the credential service and the
 * launcher's environment snapshot are both read synchronously below, and
 * reading either before it is published would silently skip the check it
 * belongs to. Declaring them is also how the probe states which services the
 * contract actually depends on.
 */
export const inject = ['credentials', 'launchEnvironment']

/** The reference under test; the plugin's own default and `.env.example` name. */
const REF = 'DSH_MAIL_SMTP_PASSWORD'
/**
 * The synthetic value the disposable document carries.
 *
 * It arrives through the environment rather than being restated here, so the
 * comparison is against the value the probe actually wrote. A second copy in
 * this file could drift from that one and turn a resolution failure into a
 * string-comparison failure that looks like one. It is a synthetic probe value,
 * never a real secret, and no branch below writes it out (§15).
 */
const VALUE = process.env['PROBE_CREDENTIAL_VALUE'] ?? ''
/** The layer names every environment check is run against. */
const ENV_LAYERS = ['process', 'project-env', 'user-env']

/**
 * The harness installation root, as this booted app sees it.
 *
 * @returns the directory holding `node_modules/@deepseek-ai`.
 */
function installRoot() {
  const explicit = process.env['DSH_INSTALL_ROOT']
  if (explicit !== undefined && explicit !== '') return explicit
  return join(process.env['DSH_HOME'] ?? '', '..')
}

/**
 * Import a package from the operator's DSH installation by absolute path.
 *
 * The probe plugins live outside the profile's module root — that is what keeps
 * the plugin under test out of it — so a bare specifier cannot resolve here.
 * Resolving through the installation root is the same device `dev-boot-probe`
 * uses for the harness modules themselves, and resolving the package root
 * rather than a file inside it goes through the package's own `exports` map,
 * which is what a real consumer gets.
 *
 * @param packageName - the package name below `@deepseek-ai`.
 * @returns the module namespace.
 */
function importHarness(packageName) {
  const require = createRequire(join(installRoot(), 'noop.cjs'))
  const resolved = require.resolve(`@deepseek-ai/${packageName}`)
  return import(pathToFileURL(resolved).href)
}

/**
 * Ask one question and record the answer.
 *
 * @param lines - the report accumulator.
 * @param label - the question, as one line.
 * @param ok - whether the answer is the expected one.
 * @param detail - the observed facts, never a credential value.
 */
function record(lines, label, ok, detail) {
  lines.push(`${ok ? 'PASS' : 'FAIL'} | ${label} | ${detail}`)
}

/**
 * Read the version out of an installed package manifest.
 *
 * @param packageName - the package directory below `@deepseek-ai`.
 * @returns the declared version, or `unknown`.
 */
function installedVersion(packageName) {
  try {
    const require = createRequire(join(installRoot(), 'noop.cjs'))
    const manifest = require.resolve(`@deepseek-ai/${packageName}/package.json`)
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Run the contract checks on the plugin's own fiber.
 *
 * @param ctx - the plugin's fiber context.
 */
export async function apply(ctx) {
  const reportPath = process.env['PROBE_CREDENTIAL_REPORT']
  const lines = []

  const credentialsModule = await importHarness('dsh-credentials')
  const localModule = await importHarness('dsh-credentials-local')
  const { credentialRef, isCredentialRefName, credentialKey, parseCredentialKey } = credentialsModule
  const { parseCredentialsDocument } = localModule

  lines.push(`installed dsh-credentials        ${installedVersion('dsh-credentials')}`)
  lines.push(`installed dsh-credentials-local  ${installedVersion('dsh-credentials-local')}`)

  // 1. The grammar. The plugin validates `smtpPasswordCredential` against its
  //    own copy of the pattern; that copy must agree with the helper the
  //    provider itself uses to admit a key into the `refs` section.
  const candidates = [
    'DSH_MAIL_SMTP_PASSWORD',
    'DEEPSEEK_API_KEY',
    '_x',
    'has-dash',
    'credentials/smtp-password',
    '1abc',
  ]
  for (const candidate of candidates) {
    let helper
    try {
      helper = credentialRef(candidate) === candidate
    } catch {
      helper = false
    }
    record(
      lines,
      `credentialRef(${JSON.stringify(candidate)})`,
      helper === isCredentialRefName(candidate),
      `credentialRef accepts: ${helper}, isCredentialRefName: ${isCredentialRefName(candidate)}`,
    )
  }

  // 2. The two key spaces are disjoint, and the plugin's field belongs to the
  //    reference half only.
  const key = credentialKey('credentials', 'smtp-password')
  let keyAsRef = true
  try {
    credentialRef(key)
  } catch {
    keyAsRef = false
  }
  let refAsKey = true
  try {
    parseCredentialKey(REF)
  } catch {
    refAsKey = false
  }
  record(
    lines,
    'a CredentialKey is not a CredentialRef',
    keyAsRef === false,
    `credentialKey -> ${key}; credentialRef accepts it: ${keyAsRef}`,
  )
  record(
    lines,
    'a CredentialRef is not a CredentialKey',
    refAsKey === false,
    `parseCredentialKey("${REF}") is accepted: ${refAsKey}`,
  )

  // 3. The document parser is the authority on what the store can hold. A
  //    reference is admitted; a record key in the same section is not.
  const home = process.env['DSH_HOME']
  if (home === undefined) {
    record(lines, 'isolated DSH_HOME', false, 'DSH_HOME is not set, so no disposable document can be assumed')
  } else {
    const refDocument = `version: 1\nrefs:\n  ${REF}: ${VALUE}\nrecords: {}\n`
    let refDocumentAccepted = true
    let refDocumentDetail
    try {
      const parsed = parseCredentialsDocument(refDocument, '<probe>')
      refDocumentDetail = `refs entries: ${parsed.refs.size}, records entries: ${parsed.records.size}`
    } catch (error) {
      refDocumentAccepted = false
      refDocumentDetail = String(error?.message ?? error)
    }
    record(lines, 'the document admits this reference in `refs`', refDocumentAccepted, refDocumentDetail)

    const scopedDocument = `version: 1\nrefs:\n  ${key}: ${VALUE}\nrecords: {}\n`
    let scopedRejected = false
    let scopedDetail = 'the parser ACCEPTED a CredentialKey in `refs`'
    try {
      parseCredentialsDocument(scopedDocument, '<probe>')
    } catch (error) {
      scopedRejected = true
      scopedDetail = `rejected: ${String(error?.message ?? error)}`
    }
    record(lines, 'the document refuses a CredentialKey in `refs`', scopedRejected, scopedDetail)

    // 4. The live service — the one the mailer resolves through.
    const provider = ctx.get('credentials')
    const resolved = await provider.resolve(credentialRef(REF))
    const described = await provider.describe(credentialRef(REF))

    // The proof that `file` is the real source: the value is unreachable from
    // every environment layer the provider consults before it.
    const layers = ENV_LAYERS.map((layer) => [layer, ctx.launchEnvironment?.getFrom?.(REF, [layer]) !== undefined])
    const envSilent = layers.every(([, present]) => present === false)
    record(
      lines,
      'the value is absent from every environment layer',
      envSilent,
      layers.map(([layer, present]) => `${layer}=${present}`).join(' '),
    )

    const valueMatches = resolved !== undefined && VALUE !== '' && resolved.value === VALUE
    record(
      lines,
      `resolve(${REF}) returns the stored value from the file layer`,
      valueMatches && resolved.source === 'file',
      `resolved: ${resolved !== undefined} exact value match: ${valueMatches} source: ${resolved?.source ?? 'n/a'} length: ${resolved?.value?.length ?? 0}`,
    )
    record(
      lines,
      'describe() reports the reference configured without exposing it',
      described.configured === true && described.source === 'file',
      `configured: ${described.configured} source: ${described.source ?? 'n/a'} writable: ${described.writable}`,
    )

    // 5. The reference the Phase 8 grammar wrongly admitted: the same service
    //    cannot find it, which is the whole argument for rejecting it at mount
    //    time instead of at send time.
    const scopedResolved = await provider.resolve(key)
    const scopedDescribed = await provider.describe(key)
    record(
      lines,
      'resolve() cannot read a CredentialKey reference',
      scopedResolved === undefined && scopedDescribed.configured === false,
      `resolve("${key}") -> ${scopedResolved === undefined ? 'undefined' : 'a value'}; describe configured: ${scopedDescribed.configured}`,
    )
  }

  const text = `${lines.join('\n')}\n`
  if (reportPath !== undefined && reportPath !== '') {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, text, 'utf8')
  }
  process.stderr.write(`[probe-credential-contract] ${lines.length} checks recorded\n${text}`)
}
