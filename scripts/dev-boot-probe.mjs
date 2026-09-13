#!/usr/bin/env node
/**
 * Boot a DSH profile in-process with a Cordis log exporter attached.
 *
 * This is a development harness, not a product surface. It exists because the
 * `dsh` command line registers no log exporter: Cordis keeps its last 1000
 * records in an in-memory ring and prints nothing, so a plugin's own structured
 * logging is invisible from outside the process. Without a way to read those
 * records, "the plugin ran in a real composition" cannot be observed at all.
 *
 * Nothing about the harness is modified. The launcher's own `runProfile` is
 * called, and the only intervention is a wrapper around
 * `LoggerService.prototype.exporter` that additionally registers a sink writing
 * to stderr and, when `--log` is given, to a file. The plugin under test is
 * loaded the ordinary way: from the profile's `dsh.profile.bundles`, through its
 * bundle patch.
 *
 * The harness modules are located by absolute path because they belong to the
 * DSH installation rather than to this package, and are deliberately reached
 * through `DSH_INSTALL_ROOT` when the default does not fit.
 *
 * Usage:
 *   node scripts/dev-boot-probe.mjs --profile <name> [--patch <file>]... \
 *        [--log <file>] [--only <substring>]... -- <app arguments...>
 *
 * Everything after `--` is forwarded verbatim as the app's arguments, which is
 * how a headless profile receives its task.
 *
 * @module dsh-mail-notify/scripts/dev-boot-probe
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Parse the probe's own flags; everything after `--` belongs to the app. */
function parseArgs(argv) {
  const separator = argv.indexOf('--')
  const own = separator === -1 ? argv : argv.slice(0, separator)
  const rest = separator === -1 ? [] : argv.slice(separator + 1)
  const options = { profile: undefined, patches: [], log: undefined, only: [], replayDuplicate: false, rest }
  for (let index = 0; index < own.length; index += 1) {
    const token = own[index]
    const value = own[index + 1]
    if (token === '--profile' && value !== undefined) {
      options.profile = value
      index += 1
    } else if (token === '--patch' && value !== undefined) {
      options.patches.push(value)
      index += 1
    } else if (token === '--log' && value !== undefined) {
      options.log = value
      index += 1
    } else if (token === '--only' && value !== undefined) {
      options.only.push(value)
      index += 1
    } else if (token === '--replay-duplicate') {
      options.replayDuplicate = true
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
if (options.profile === undefined) {
  process.stderr.write('dev-boot-probe: --profile <name> is required\n')
  process.exit(2)
}

const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
process.env['DSH_HOME'] = dshHome

/** The DSH installation root: the directory holding `node_modules/@deepseek-ai`. */
function resolveInstallRoot() {
  const explicit = process.env['DSH_INSTALL_ROOT']
  if (explicit !== undefined && explicit !== '') return explicit
  // The launcher lives at <root>/node_modules/@deepseek-ai/dsh/lib/bin.js.
  return join(dshHome, '..')
}

const installRoot = resolveInstallRoot()
const dshModules = join(installRoot, 'node_modules', '@deepseek-ai')

/**
 * Import a harness module by absolute path.
 *
 * @param relative - the path below `@deepseek-ai`, e.g. `dsh-app-boot/lib/index.js`.
 * @returns the module namespace.
 */
async function importHarness(relative) {
  const target = join(dshModules, ...relative.split('/'))
  return import(pathToFileURL(target).href)
}

/** Render one Cordis log message without trusting its argument shapes. */
function renderMessage(message) {
  const args = (message.args ?? [])
    .map((value) => {
      if (typeof value === 'string') return value
      if (value instanceof Error) return `${value.name}: ${value.message}`
      try {
        return JSON.stringify(value)
      } catch {
        return '[unserializable]'
      }
    })
    .join(' ')
  return `${message.type.toUpperCase().padEnd(5)} ${message.name} ${args}`
}

/** Attach the probe's exporter alongside whatever the app registers. */
async function installExporter() {
  const cordis = await importHarness('cordis/lib/index.js')
  const { LoggerService } = cordis
  if (typeof LoggerService?.prototype?.exporter !== 'function') {
    process.stderr.write('dev-boot-probe: LoggerService.exporter was not found; the probe cannot observe logs\n')
    return
  }

  if (options.log !== undefined) mkdirSync(dirname(resolve(options.log)), { recursive: true })

  const original = LoggerService.prototype.exporter
  LoggerService.prototype.exporter = function patched(exporter) {
    // The first exporter registration happens on the boot context, which is the
    // root of the whole tree. Capturing it is what makes the duplicate-turn
    // replay below possible without reaching into the harness at all.
    if (capturedRoot === undefined && this?.ctx?.root !== undefined) capturedRoot = this.ctx.root
    const wrapped = {
      ...exporter,
      export(message) {
        exporter.export(message)
        const line = renderMessage(message)
        if (options.only.length === 0 || options.only.some((needle) => line.includes(needle))) {
          process.stderr.write(`[probe] ${line}\n`)
          if (options.log !== undefined) appendFileSync(resolve(options.log), `${line}\n`, 'utf8')
        }
        observe(message)
      },
    }
    return original.call(this, wrapped)
  }
}

/** The boot context, captured for the duplicate-turn replay. */
let capturedRoot
/** The plugin's `session/event` listener, captured for the duplicate-turn replay. */
let capturedListener
/** The last `(sessionId, turn)` a candidate was produced for, and its event time. */
let lastCandidate

/** Wrap the `session/event` registration so the plugin's own listener is reachable. */
async function instrumentListenerRegistration() {
  if (!options.replayDuplicate) return
  const cordis = await importHarness('cordis/lib/index.js')
  const { EventsService } = cordis
  const original = EventsService.prototype.on
  EventsService.prototype.on = function patched(name, listener, eventOptions) {
    // Several plugins observe this event, so the registration is matched by the
    // owning fiber's name rather than by being first.
    if (capturedListener === undefined && name === 'session/event') {
      let fiberName
      try {
        fiberName = this?.ctx?.fiber?.name
      } catch {
        fiberName = undefined
      }
      if (fiberName === 'dsh-mail-notify') capturedListener = listener
    }
    return original.call(this, name, listener, eventOptions)
  }
}

/**
 * Remember the first produced candidate and arm the duplicate replay.
 *
 * The plugin logs one argument holding the event name followed by the
 * normalized payload as JSON, so the turn facts are read back out of that line
 * rather than from a structured argument. The replay is armed from here rather
 * than from listener registration because the first candidate is the earliest
 * moment at which the turn to duplicate is known.
 */
function observe(message) {
  if (message.name !== 'dsh-mail-notify') return
  const line = message.args?.[0]
  if (typeof line !== 'string') return
  const match = /^candidate\.produced\s+(\{.*\})$/.exec(line.trim())
  if (match?.[1] === undefined) return
  if (lastCandidate !== undefined) return
  try {
    const payload = JSON.parse(match[1])
    if (typeof payload.sessionId === 'string' && typeof payload.turn === 'number') {
      lastCandidate = { sessionId: payload.sessionId, turn: payload.turn }
      // The queue is single-concurrency, so the first job is already in flight;
      // waiting lets it settle so the replayed turn meets a written dedupe mark.
      setTimeout(() => {
        replayDuplicate()
        setTimeout(() => process.exit(0), 500)
      }, 3000)
    }
  } catch {
    // A payload the probe cannot parse simply leaves the replay unarmed.
  }
}

/**
 * Replay one complete turn chain twice for the turn a candidate was already
 * produced for.
 *
 * The chain is replayed rather than a bare `turn/end`, because the handler
 * releases a turn's state as soon as it settles: a duplicate `turn/end` on its
 * own would lazily re-create an empty state, be suppressed for having no
 * visible text, and never reach the deduplication rule. Replaying
 * `turn/start` + `assistant/message` + `turn/end` gives the second settlement
 * the same visible text as the first, which is what a duplicate delivery of a
 * real turn looks like.
 */
function replayDuplicate() {
  const root = capturedRoot
  const candidate = lastCandidate
  if (root === undefined || candidate === undefined) {
    process.stderr.write('[probe] duplicate replay skipped: nothing captured yet\n')
    return
  }
  const session = { id: candidate.sessionId, header: {} }
  const time = Date.now()
  const chain = [
    { type: 'turn/start', seq: 900_001, time, data: { turn: candidate.turn } },
    {
      type: 'assistant/message',
      seq: 900_002,
      time: time + 1,
      data: {
        turn: candidate.turn,
        step: 1,
        message: {
          id: 'probe-replay-message',
          content: [{ type: 'text', text: 'replayed visible text for the duplicate probe' }],
          source: { kind: 'model', provider: 'probe', model: 'probe' },
        },
      },
    },
    { type: 'turn/end', seq: 900_003, time: time + 2, data: { turn: candidate.turn, reason: { kind: 'completed' } } },
  ]
  process.stderr.write(`[probe] replaying a full turn chain twice for ${candidate.sessionId}:${candidate.turn}\n`)
  const emit = typeof root.emit === 'function' ? root.emit.bind(root) : undefined
  if (emit === undefined) {
    process.stderr.write('[probe] replay skipped: the captured context exposes no emit\n')
    return
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const event of chain) {
      try {
        // Dispatched through the context so the harness's own listener container
        // runs, which is also what keeps a throwing listener from aborting the
        // replay silently.
        emit('session/event', session, event)
      } catch (error) {
        process.stderr.write(`[probe] replay threw on ${event.type}: ${error?.message ?? String(error)}\n`)
      }
    }
  }
}

/**
 * Resolve the launcher's `runProfile`.
 *
 * The boot module's filename carries a content hash, so it is found by scanning
 * the launcher's `lib` directory for the module that actually exports
 * `runProfile`, rather than by hard-coding a hash that a harness upgrade would
 * invalidate.
 *
 * @returns the `runProfile` function.
 */
async function loadRunProfile() {
  const { readdirSync } = await import('node:fs')
  const libDir = join(dshModules, 'dsh', 'lib')
  for (const name of readdirSync(libDir)) {
    if (!name.startsWith('profile-boot-') || !name.endsWith('.js')) continue
    const candidate = await importHarness(`dsh/lib/${name}`)
    if (typeof candidate.runProfile === 'function') return candidate.runProfile
  }
  throw new Error(`dev-boot-probe: no module exporting runProfile was found under ${libDir}`)
}

const runProfile = await loadRunProfile()
// The launcher passes a layered environment map rather than `process.env`, and
// the proxy installer reads it with `env.get`. Building it the same way keeps
// this probe on the launcher's own path.
const { loadLayeredEnv } = await importHarness('dsh-app-boot/lib/index.js')

await installExporter()
await instrumentListenerRegistration()

process.stderr.write(`dev-boot-probe: booting profile "${options.profile}" with ${options.patches.length} overlay(s)\n`)

await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: options.profile,
  fromDefaultProfile: undefined,
  patchFiles: options.patches.map((entry) => resolve(entry)),
  args: options.rest,
})
