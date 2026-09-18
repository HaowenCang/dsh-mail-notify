#!/usr/bin/env node
/**
 * The only entry point in this project that sends a real email.
 *
 * It is never invoked by the test suite or by any automated script: it runs only
 * when a person types `npm run smoke`, and it sends exactly one message with
 * fixed content to the configured recipients. Its purpose is to prove the real
 * credential path and the real SMTP transport work, which a stub transport
 * cannot show.
 *
 * What it refuses to do is as important as what it does. The password is never
 * printed, never accepted on the command line, and never written anywhere: it is
 * resolved through the DSH Credential service for this one send and then dropped
 * with the process. Before sending anything, it reads the credential's
 * *description* — presence, source layer, writability — and exits if the
 * reference is not configured.
 *
 * Configuration comes from the same place the plugin reads it: a profile's
 * `cordis.patch.yml`. The row `dsh-mail-notify` is located by id and its
 * `config:` block is parsed. Only the flat scalar subset that this plugin's own
 * schema uses is supported; nested structures would be a sign the file is not the
 * one expected, and the script stops rather than guessing.
 *
 * Usage:
 *   npm run smoke
 *   npm run smoke -- --profile web
 *   npm run smoke -- --config path/to/cordis.patch.yml
 *   npm run smoke -- --yes
 *
 * Exit codes: 0 sent, 1 failed, 2 misconfigured or refused.
 *
 * @module dsh-mail-notify/scripts/smtp-smoke-test
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '../src/logger.ts'
import { resolveSmtpPassword, describeCredential, getCredentialProvider } from '../src/credentials.ts'
import { renderMail } from '../src/subject.ts'
import { createSmtpTransport } from '../src/transport.ts'
import { resolveConfig } from '../src/config.ts'
import type { NotificationCandidate, ResolvedConfig } from '../src/types.ts'

/** A credential provider backed by the DSH home's managed store and the environment. */
interface SmokeContext {
  get(name: string): unknown
}

/** Parse `--flag value` and `--flag` pairs. */
function parseArgs(argv: readonly string[]): Map<string, string | true> {
  const out = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out.set(key, next)
      index += 1
    } else {
      out.set(key, true)
    }
  }
  return out
}

/** The DSH home directory, matching the launcher's own resolution order. */
function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/**
 * Extract the `dsh-mail-notify` row's flat `config:` block from a patch file.
 *
 * @param text - the patch file's content.
 * @returns the parsed key/value pairs.
 * @throws when the row or its config block is absent, or holds a nested value.
 */
function extractConfigBlock(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/)
  const rowIndex = lines.findIndex((line) => /^\s*-\s*id:\s*dsh-mail-notify\s*$/.test(line))
  if (rowIndex === -1) throw new Error('no `- id: dsh-mail-notify` row was found in this patch file')

  const configIndex = lines.findIndex((line, index) => index > rowIndex && /^\s*config:\s*$/.test(line))
  if (configIndex === -1) throw new Error('the dsh-mail-notify row has no `config:` block')

  const indent = (lines[configIndex] ?? '').match(/^\s*/)?.[0].length ?? 0
  const config: Record<string, unknown> = {}
  for (let index = configIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const lineIndent = line.match(/^\s*/)?.[0].length ?? 0
    if (lineIndent <= indent) break

    const body = line.trim()
    if (body.startsWith('- ')) {
      // A list item belongs to the previous key.
      const key = Object.keys(config).pop()
      if (key === undefined) throw new Error('a list item appeared before any key')
      const existing = config[key]
      const list = Array.isArray(existing) ? existing : []
      list.push(unquote(body.slice(2)))
      config[key] = list
      continue
    }
    const separator = body.indexOf(':')
    if (separator === -1) throw new Error(`unparsable line in the config block: ${body}`)
    const key = body.slice(0, separator).trim()
    const rawValue = body.slice(separator + 1).trim()
    if (rawValue === '') {
      // A nested mapping would need a real YAML parser; refusing is safer than
      // silently treating it as an empty value.
      const next = lines[index + 1] ?? ''
      const nextIndent = next.match(/^\s*/)?.[0].length ?? 0
      if (next.trim() !== '' && nextIndent > indent && !next.trim().startsWith('- ')) {
        throw new Error(`nested mapping under "${key}" is not supported by this smoke test`)
      }
      config[key] = []
      continue
    }
    config[key] = coerce(rawValue)
  }
  return config
}

/** Strip surrounding quotes from a scalar. */
function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Interpret a YAML scalar as the type the schema expects. */
function coerce(raw: string): unknown {
  const value = unquote(raw)
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10)
  return value
}

/** Print a line, with a prefix that makes the script's own output identifiable. */
function say(message: string): void {
  process.stdout.write(`smtp-smoke-test: ${message}\n`)
}

/** Fail with a reason, without ever echoing a secret. */
function fail(reason: string, code = 2): never {
  process.stderr.write(`smtp-smoke-test: ${reason}\n`)
  process.exit(code)
}

/** The fixed, obviously-synthetic body this script sends. */
const SMOKE_BODY =
  'This is a fixed test message from dsh-mail-notify.\n\n' +
  'It was sent by scripts/smtp-smoke-test.ts, which is the only code path in this project that\n' +
  'transmits a real email. It proves that the configured SMTP host, credentials, and recipients\n' +
  'work end to end. No session data, model output, or credential value is included.'

/** Build the candidate the shared renderer will turn into the message. */
function smokeCandidate(now: number): NotificationCandidate {
  return {
    schemaVersion: 2,
    sessionId: 'smtp-smoke-test',
    turn: 0,
    status: 'completed-clean',
    turnEndKind: 'completed',
    visibleText: SMOKE_BODY,
    visibleTextLength: Array.from(SMOKE_BODY).length,
    explicitToolErrorCount: 0,
    telemetryComplete: false,
    usageSampleCount: 0,
    usageMissingCount: 0,
    usageUnobservableRetries: 0,
    usageComplete: false,
    createdAt: now,
    durationMs: null,
    model: 'dsh-mail-notify smoke test',
  }
}

/** Load configuration from the patch file the plugin itself reads. */
function loadConfig(args: Map<string, string | true>): { config: ResolvedConfig; origin: string } {
  const explicit = args.get('config')
  let path: string
  let origin: string
  if (typeof explicit === 'string') {
    path = isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit)
    origin = path
  } else {
    const profile = typeof args.get('profile') === 'string' ? (args.get('profile') as string) : 'web'
    path = join(dshHome(), 'profiles', profile, 'cordis.patch.yml')
    origin = `${profile} profile (${path})`
  }

  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let raw: Record<string, unknown>
  try {
    raw = extractConfigBlock(text)
  } catch (error) {
    fail(`${origin}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const { resolved, errors, warnings } = resolveConfig(raw)
  if (errors.length > 0) fail(`${origin} is not a valid dsh-mail-notify configuration: ${errors.join('; ')}`)
  for (const warning of warnings) say(`warning: ${warning}`)
  if (resolved.smtp.to.length === 0) fail(`${origin} configures no recipient`)
  return { config: resolved, origin }
}

/**
 * Import a module that may not be installed beside this package.
 *
 * The DSH credential provider is a peer of the harness rather than of this
 * package, so it is absent from this project's own dependency tree and is only
 * resolvable from a DSH installation. Candidates are tried in order: the plain
 * specifier, then the installation directories this machine's harness layouts
 * use. The result is treated as `unknown`.
 *
 * @param specifier - the module specifier.
 * @returns the module namespace, or `undefined` when nothing resolved.
 */
async function tryImport(specifier: string): Promise<unknown> {
  try {
    return (await import(specifier)) as unknown
  } catch {
    // Fall through to the filesystem candidates below.
  }

  const roots = [
    process.env['DSH_NODE_MODULES'],
    join(dshHome(), '..', 'node_modules'),
    join(dshHome(), 'node_modules'),
    join(process.cwd(), 'node_modules'),
  ].filter((entry): entry is string => typeof entry === 'string' && entry !== '')

  for (const root of roots) {
    const candidate = join(root, ...specifier.split('/'), 'lib', 'index.js')
    try {
      return (await import(pathToFileURL(candidate).href)) as unknown
    } catch {
      // Try the next root.
    }
  }
  return undefined
}

/** The default export of a module namespace, when it is a constructor. */
function defaultExport(module: unknown): (new (ctx: unknown) => unknown) | undefined {
  if (typeof module !== 'object' || module === null) return undefined
  const candidate = (module as { default?: unknown }).default
  return typeof candidate === 'function' ? (candidate as new (ctx: unknown) => unknown) : undefined
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const { config, origin } = loadConfig(args)

  say(`configuration read from the ${origin}`)
  say(`host ${config.smtp.smtpHost}:${config.smtp.smtpPort} secure=${String(config.smtp.smtpSecure)}`)
  say(`from ${config.smtp.from}`)
  say(`to ${config.smtp.to.length} recipient(s)`)
  say(`credential reference ${config.smtp.smtpPasswordCredential} (the value is never read into this script's output)`)

  // The credential service normally comes from DSH. Under Node it is reached
  // through the same provider the harness mounts, so this script exercises the
  // real resolution path rather than a fixture.
  const cordis = await tryImport('@deepseek-ai/cordis')
  const ContextCtor =
    typeof cordis === 'object' && cordis !== null
      ? (cordis as { Context?: new () => unknown }).Context
      : undefined
  if (ContextCtor === undefined) fail('@deepseek-ai/cordis is not resolvable from here; run this from the plugin directory')

  let ProviderCtor: (new (ctx: unknown) => unknown) | undefined
  for (const specifier of ['@deepseek-ai/dsh-credentials-local', '@deepseek-ai/dsh-credentials']) {
    ProviderCtor = defaultExport(await tryImport(specifier))
    if (ProviderCtor !== undefined) break
  }
  if (ProviderCtor === undefined) {
    fail(
      'no DSH credential provider is resolvable from here, so the credential cannot be resolved; ' +
        'run this script from a checkout whose dependencies include the harness packages',
    )
  }

  const cordisInstance = new ContextCtor()
  const providerFork = await (cordisInstance as { plugin: (plugin: unknown) => Promise<unknown> }).plugin(ProviderCtor)
  const ctx = cordisInstance as SmokeContext

  try {
    await runSmoke(args, config, origin, ctx)
  } finally {
    // The provider watches the credentials document, and that watcher holds the
    // event loop open. Disposing the fork stops it, so this script exits on its
    // own rather than appearing to hang after it has finished.
    await disposeFork(providerFork)
  }
}

/** Dispose a Cordis fork scope, tolerating a runtime without a disposer. */
async function disposeFork(fork: unknown): Promise<void> {
  const disposer = (fork as { dispose?: () => Promise<void> | void } | undefined)?.dispose
  if (typeof disposer !== 'function') return
  try {
    await disposer.call(fork)
  } catch {
    // A disposal failure must not change the smoke test's outcome.
  }
}

/** Resolve the credential, gate on the dry-run flag, and send. */
async function runSmoke(
  args: Map<string, string | true>,
  config: ResolvedConfig,
  origin: string,
  ctx: SmokeContext,
): Promise<void> {
  void origin
  const provider = getCredentialProvider(ctx)
  if (provider === undefined) {
    fail('the DSH Credential service is not available in this process, so no password can be resolved')
  }

  // Presence is checked before anything is sent, using the description rather
  // than the value. An unconfigured reference is reported by name and stops here.
  const described = await describeCredential(provider, config.smtp.smtpPasswordCredential)
  if (described === undefined || !described.configured) {
    fail(
      `the credential reference "${config.smtp.smtpPasswordCredential}" is not configured` +
        (described === undefined ? '' : ` (source=${described.source ?? 'unknown'})`) +
        '; set it in the process environment, in the provider-managed store, or in a .env file',
    )
  }
  say(`credential is configured (source=${described.source ?? 'unknown'}, writable=${String(described.writable)})`)

  const outcome = await resolveSmtpPassword(provider, config.smtp.smtpPasswordCredential)
  if (outcome.value === undefined) fail(outcome.message ?? 'the credential could not be resolved')

  if (args.get('yes') !== true) {
    // A real send is a deliberate act; without --yes the script states what it
    // would do and stops.
    say('dry run: re-run with --yes to send the message')
    return
  }

  const rendered = renderMail({
    notification: { kind: 'turn', candidate: smokeCandidate(Date.now()) },
    render: { ...config.render, includeMetadata: false, includeFooter: true },
    truncated: false,
  })
  say(`subject: ${rendered.subject}`)

  const transport = createSmtpTransport({
    host: config.smtp.smtpHost,
    port: config.smtp.smtpPort,
    secure: config.smtp.smtpSecure,
    user: config.smtp.smtpUser,
    password: outcome.value,
  })

  // The logger is the plugin's own, so this send takes the identical logging path
  // the plugin takes. It is a real logger here, so the operator sees the outcome.
  const logger = createLogger({
    error: (format: unknown) => process.stderr.write(`${String(format)}\n`),
    warn: (format: unknown) => process.stderr.write(`${String(format)}\n`),
    info: (format: unknown) => say(String(format)),
    debug: () => undefined,
  })

  try {
    await transport.sendMail({
      from: config.smtp.from,
      to: config.smtp.to,
      subject: rendered.subject,
      text: rendered.text,
    })
    logger.info('mail.sent {}')
    say(`sent one test message to ${config.smtp.to.length} recipient(s)`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(`the send failed: ${message.replace(/[\r\n]+/g, ' ')}`, 1)
  }
}

await main()
