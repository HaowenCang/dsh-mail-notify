#!/usr/bin/env node
/**
 * Turn-telemetry probe: replay a recorded real turn through the plugin.
 *
 * This is the Phase 6 evidence tool, not a product surface. It exists because
 * the two claims this phase had to establish cannot be made from fixtures:
 *
 * 1. **What the runtime actually emits.** The durable session log is the only
 *    record of a real turn's event order, and it is a concatenated Zstandard
 *    container whose frames must be decoded individually — Node's one-shot
 *    decoder stops after the first frame, which is what makes a naive reader
 *    see a session that contains only its header line.
 * 2. **What the plugin actually produces from those events.** The probe feeds
 *    the recorded chain, verbatim, into a chosen build's `createSessionHandlers`
 *    and prints the candidate that comes out, so v0.1.0 and a fixed build can be
 *    compared on the same real input instead of on paraphrases of it.
 *
 * The frame scanner below is the same structural scan the DSH JSONL persistence
 * backend performs (magic, frame header descriptor, block chain, optional
 * checksum); it is re-implemented here because the backend does not export it
 * and pulling in a Cordis context to read one file would make the probe depend
 * on the very thing it is meant to observe.
 *
 * Privacy: the probe prints event types, sequence numbers, times, turn/step
 * numbers, and token counters. It never prints reasoning text, tool arguments,
 * tool result bodies, message text, or anything from a credential store.
 *
 * Usage:
 *   node scripts/turn-telemetry-probe.mjs --log <file.jsonl.zstd> [--turn N] \
 *        [--replay <build-dir>] [--json]
 *   node scripts/turn-telemetry-probe.mjs --sessions <dir> [--session <substr>] [--list-turns]
 *
 * @module dsh-mail-notify/scripts/turn-telemetry-probe
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

/** The Zstandard frame magic, little-endian, as the JSONL container writes it. */
const ZSTD_MAGIC = 4247762216

/**
 * Locate complete Zstandard frames without decompressing them.
 *
 * @param {Buffer} buffer - the complete artifact bytes.
 * @returns {{frames: {start: number, end: number}[], tornStart?: number}} frame ranges plus a torn final frame, if any.
 */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornStart: start }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * Decode a durable session log into its events.
 *
 * @param {string} file - path to `session.*.jsonl.zstd` or a plain `.jsonl`.
 * @returns {{events: object[], frames: number, torn: boolean}} the parsed events.
 */
export function decodeSessionLog(file) {
  const bytes = readFileSync(file)
  let text
  let frames = 0
  let torn = false
  if (file.endsWith('.zstd')) {
    const scanned = scanZstdFrames(bytes)
    frames = scanned.frames.length
    torn = scanned.tornStart !== undefined
    text = scanned.frames.map((frame) => zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8')).join('')
  } else {
    text = bytes.toString('utf8')
  }
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A torn tail line is expected on a log that is still being appended.
    }
  }
  return { events, frames, torn }
}

/** Every `session*.jsonl*` artifact below a sessions root, newest first. */
function listSessionLogs(root) {
  const found = []
  const walk = (directory) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.jsonl(\.zstd)?$/.test(entry.name) && entry.name.startsWith('session')) found.push(path)
    }
  }
  walk(root)
  return found.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
}

/** The usage carried by a stream record list, matching the DSH token meter. */
export function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record === null || typeof record !== 'object' || record.type !== 'chunk') continue
    const chunk = record.chunk
    if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'usage' || chunk.usage === undefined) continue
    return chunk.usage
  }
  return undefined
}

/** The counters a settlement reported, from `data.usage` or its stream. */
export function settlementUsage(data) {
  if (data !== null && typeof data === 'object' && data.usage !== undefined) return data.usage
  return streamUsage(data?.stream)
}

/**
 * Split one session's events into turns.
 *
 * @param {object[]} events - the decoded session events.
 * @returns {Map<number, object[]>} events by turn number, in delivery order.
 */
export function turnsOf(events) {
  const turns = new Map()
  for (const event of events) {
    const turn = event?.data?.turn
    if (typeof turn !== 'number') continue
    let bucket = turns.get(turn)
    if (bucket === undefined) {
      bucket = []
      turns.set(turn, bucket)
    }
    bucket.push(event)
  }
  return turns
}

/** A safe one-line description of one event, free of payload content. */
function describeEvent(event) {
  const data = event.data ?? {}
  const parts = [`seq=${event.seq ?? '-'}`, `time=${event.time ?? '-'}`, `turn=${data.turn ?? '-'}`, `step=${data.step ?? '-'}`]
  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    const usage = settlementUsage(data)
    parts.push(`usage=${usage === undefined ? 'absent' : JSON.stringify(usage)}`)
  }
  if (event.type === 'llm/retry') parts.push(`retry=${data.retry ?? '-'}`)
  if (event.type === 'turn/end') parts.push(`reason=${data.reason?.kind ?? 'unknown'}`)
  return `${event.type.padEnd(20)} ${parts.join(' ')}`
}

/**
 * Fold a turn's usage samples independently of the plugin.
 *
 * This is the "expected" column of the evidence table: it applies only the
 * published semantics — sum the disjoint buckets over the distinct settled
 * model calls — so a disagreement with the plugin's own candidate is a finding
 * rather than a tautology.
 *
 * @param {object[]} turnEvents - the turn's events, in delivery order.
 * @returns {object} samples, the expected aggregate, and the coverage facts.
 */
export function expectedFold(turnEvents) {
  const samples = []
  const keys = new Set()
  const messageSteps = new Set()
  let missingCount = 0
  let retries = 0
  let sawTurnStart = false
  const startedSteps = new Set()
  const settledSteps = new Set()
  const totals = { inputTokens: 0, outputTokens: 0 }
  const optional = { cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined }

  for (const event of turnEvents) {
    const data = event.data ?? {}
    if (event.type === 'turn/start') {
      sawTurnStart = true
      continue
    }
    if (event.type === 'step/start') {
      startedSteps.add(data.step)
      continue
    }
    if (event.type === 'llm/retry') {
      const key = `retry:${event.seq}`
      if (!keys.has(key)) {
        keys.add(key)
        retries += 1
      }
      continue
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue

    const key = event.seq === undefined ? `${event.type}:${data.step}:${event.time}` : `seq:${event.seq}`
    if (keys.has(key)) continue
    const usage = settlementUsage(data)
    const usable =
      usage !== undefined && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens)
    if (event.type === 'assistant/message') {
      if (usable && messageSteps.has(data.step)) continue
      if (usable) messageSteps.add(data.step)
    }
    keys.add(key)
    settledSteps.add(data.step)
    if (!usable) {
      missingCount += 1
      continue
    }
    samples.push({ step: data.step, seq: event.seq, time: event.time, usage })
    totals.inputTokens += usage.inputTokens
    totals.outputTokens += usage.outputTokens
    for (const bucket of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
      if (!Number.isSafeInteger(usage[bucket])) continue
      optional[bucket] = (optional[bucket] ?? 0) + usage[bucket]
    }
  }

  for (const step of startedSteps) if (!settledSteps.has(step)) missingCount += 1

  const aggregate = { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens }
  for (const [bucket, value] of Object.entries(optional)) if (value !== undefined) aggregate[bucket] = value

  return {
    samples,
    sampleCount: samples.length,
    aggregate: samples.length === 0 ? undefined : aggregate,
    missingCount,
    unobservableRetries: retries,
    usageComplete:
      sawTurnStart && retries === 0 && missingCount === 0 && samples.length > 0,
    sawTurnStart,
  }
}

/**
 * Run DSH's own turn-usage derivation over the same recorded events.
 *
 * This is the strongest available cross-check: `deriveTurnTokenUsage` is the
 * official fold, written independently of this plugin and shipped with the
 * harness. It is stricter than the plugin on purpose — any attempt without a
 * usage report, any retry, or any lifecycle gap makes it return `undefined`
 * rather than a partial number — so agreement on a clean turn corroborates the
 * plugin's aggregate, and disagreement is a finding either way.
 *
 * @param {object[]} turnEvents - the recorded durable events of one turn.
 * @param {string} installRoot - a DSH installation root (holds `node_modules/@deepseek-ai`).
 * @returns {Promise<{value?: object, error?: string}>} the meter's verdict.
 */
export async function dshMeterFold(turnEvents, installRoot) {
  try {
    const entry = pathToFileURL(
      resolve(installRoot, 'node_modules', '@deepseek-ai', 'dsh-token-meter', 'lib', 'types', 'turn-usage.js'),
    ).href
    const { deriveTurnTokenUsage } = await import(entry)
    return { value: deriveTurnTokenUsage(turnEvents) ?? null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Replay one recorded turn through a built plugin and return its candidate.
 *
 * @param {object[]} turnEvents - the recorded events, in delivery order.
 * @param {string} buildDir - a directory holding the build's `lib/`.
 * @param {string} sessionId - the recorded session id.
 * @param {string} [cwd] - the recorded session working directory.
 * @returns {Promise<{candidate: object|undefined, logRecords: object[], error?: string}>}
 */
export async function replayThroughPlugin(turnEvents, buildDir, sessionId, cwd) {
  const lib = (name) => pathToFileURL(resolve(buildDir, 'lib', name)).href
  let handlers
  let queue
  let logger
  try {
    const { resolveConfig } = await import(lib('config.js'))
    const { createLogger } = await import(lib('logger.js'))
    const { createMailQueue } = await import(lib('queue.js'))
    const { DedupeCache } = await import(lib('notifier.js'))
    const { createSessionHandlers } = await import(lib('event-handler.js'))

    const raw = {
      enabled: true,
      smtpHost: 'smtp.example.invalid',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'probe@example.com',
      smtpPasswordCredential: 'PROBE_CREDENTIAL_REFERENCE',
      from: 'probe@example.com',
      to: ['probe-recipient@example.com'],
      includeSubagents: false,
      notifyCompleted: true,
      notifyErrors: true,
      notifyMaxTokens: true,
      minTurnDurationMs: 0,
      maxBodyChars: 100000,
      includeMetadata: true,
      includeUserPrompt: false,
      includeFooter: true,
      queueSize: 16,
      retryAttempts: 1,
      retryBaseDelayMs: 100,
      maxDedupeEntries: 16,
    }
    const { resolved, errors } = resolveConfig(raw)
    if (errors.length > 0) return { candidate: undefined, logRecords: [], error: `config invalid: ${errors.join('; ')}` }

    const jobs = []
    logger = createLogger(undefined, 200)
    queue = createMailQueue({
      size: resolved.queueSize,
      policy: resolved.retry,
      sink: async (job) => {
        jobs.push(job)
        return { ok: true }
      },
      sleep: async () => {},
    })
    handlers = createSessionHandlers({ config: resolved, logger, queue, dedupe: new DedupeCache(16), now: () => 0 })
    const session = { id: sessionId, header: { cwd: cwd ?? '', delegationDepth: 0 } }
    for (const event of turnEvents) handlers.onSessionEvent(session, event)
    await queue.settle()
    const records = logger.getRecords().map((record) => ({ level: record.level, event: record.event, fields: record.fields }))
    // The mail the candidate would produce, rendered by the same build's own
    // renderer, so the evidence shows what a recipient would read rather than a
    // second implementation's idea of it.
    let mail
    const job = jobs[0]
    if (job !== undefined) {
      const { renderMail } = await import(lib('subject.js'))
      mail = renderMail({
        candidate: job.candidate,
        render: resolved.render,
        truncated: job.truncated,
        droppedFields: [],
      })
    }
    return { candidate: job?.candidate, mail, logRecords: records }
  } catch (error) {
    return { candidate: undefined, logRecords: [], error: error instanceof Error ? error.message : String(error) }
  } finally {
    try {
      await queue?.dispose()
    } catch {
      // A probe that already produced its evidence must not fail on teardown.
    }
  }
}

/** Parse the probe's own flags. */
function parseArgs(argv) {
  const options = {
    log: undefined,
    sessions: undefined,
    session: undefined,
    turn: undefined,
    replay: [],
    meter: [],
    json: false,
    listTurns: false,
    chain: false,
    mail: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const value = argv[index + 1]
    if (token === '--log' && value !== undefined) options.log = value
    else if (token === '--sessions' && value !== undefined) options.sessions = value
    else if (token === '--session' && value !== undefined) options.session = value
    else if (token === '--turn' && value !== undefined) options.turn = Number(value)
    else if (token === '--replay' && value !== undefined) options.replay.push(value)
    else if (token === '--meter' && value !== undefined) options.meter.push(value)
    else if (token === '--json') options.json = true
    else if (token === '--chain') options.chain = true
    else if (token === '--mail') options.mail = true
    else if (token === '--list-turns') options.listTurns = true
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  let file = options.log
  if (file === undefined && options.sessions !== undefined) {
    const candidates = listSessionLogs(options.sessions)
    const match = options.session === undefined ? candidates : candidates.filter((path) => path.includes(options.session))
    file = match[0]
  }
  if (file === undefined) {
    process.stderr.write('turn-telemetry-probe: --log <file> or --sessions <dir> is required\n')
    process.exitCode = 2
    return
  }

  const { events, frames, torn } = decodeSessionLog(file)
  const header = events.find((event) => event.type === 'session')
  const sessionId = header?.id ?? 'unknown-session'
  const turns = turnsOf(events)

  if (options.listTurns) {
    for (const [turn, turnEvents] of turns) {
      const expected = expectedFold(turnEvents)
      process.stdout.write(
        `turn ${turn}: events=${turnEvents.length} samples=${expected.sampleCount} missing=${expected.missingCount} retries=${expected.unobservableRetries} duration=${expected.sawTurnStart ? turnEvents.find((event) => event.type === 'turn/end')?.time - turnEvents.find((event) => event.type === 'turn/start')?.time : 'unknown'}\n`,
      )
    }
    return
  }

  const turnNumbers = [...turns.keys()]
  const turn = options.turn ?? turnNumbers[turnNumbers.length - 1]
  const turnEvents = turns.get(turn)
  if (turnEvents === undefined) {
    process.stderr.write(`turn-telemetry-probe: session ${sessionId} has no turn ${turn}\n`)
    process.exitCode = 2
    return
  }

  const startEvent = turnEvents.find((event) => event.type === 'turn/start')
  const endEvent = turnEvents.find((event) => event.type === 'turn/end')
  const expected = expectedFold(turnEvents)

  if (options.chain) {
    process.stdout.write(`chain for ${sessionId} turn ${turn} (${turnEvents.length} events)\n`)
    for (const event of turnEvents) process.stdout.write(`  ${describeEvent(event)}\n`)
  }

  const replays = []
  for (const buildDir of options.replay) {
    const result = await replayThroughPlugin(turnEvents, buildDir, sessionId, header?.cwd)
    replays.push({ build: buildDir, ...result })
  }

  const meters = []
  for (const installRoot of options.meter) {
    meters.push({ installRoot, ...(await dshMeterFold(turnEvents, installRoot)) })
  }

  const evidence = {
    file,
    frames,
    tornTail: torn,
    sessionId,
    cwd: header?.cwd ?? null,
    turn,
    eventCount: turnEvents.length,
    turnStartTime: startEvent?.time ?? null,
    turnEndTime: endEvent?.time ?? null,
    turnEndReason: endEvent?.data?.reason?.kind ?? null,
    expectedDurationMs: startEvent !== undefined && endEvent !== undefined ? endEvent.time - startEvent.time : null,
    expected: {
      samples: expected.samples.map((sample) => ({ step: sample.step, seq: sample.seq, time: sample.time, usage: sample.usage })),
      aggregate: expected.aggregate ?? null,
      sampleCount: expected.sampleCount,
      missingCount: expected.missingCount,
      unobservableRetries: expected.unobservableRetries,
      usageComplete: expected.usageComplete,
      sawTurnStart: expected.sawTurnStart,
    },
    replays: replays.map((entry) => ({
      build: entry.build,
      error: entry.error ?? null,
      candidate: entry.candidate ?? null,
      mail: entry.mail ?? null,
      candidateProduced: entry.logRecords.find((record) => record.event === 'candidate.produced')?.fields ?? null,
    })),
    meters,
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    return
  }

  process.stdout.write(`session   ${sessionId}\n`)
  process.stdout.write(`file      ${file} (${frames} zstd frames, tornTail=${torn})\n`)
  process.stdout.write(`turn      ${turn}, ${turnEvents.length} events, end reason ${evidence.turnEndReason}\n`)
  process.stdout.write(`start/end ${evidence.turnStartTime} / ${evidence.turnEndTime} -> expected duration ${evidence.expectedDurationMs} ms\n`)
  for (const sample of expected.samples) {
    process.stdout.write(`  sample step=${sample.step} seq=${sample.seq} ${JSON.stringify(sample.usage)}\n`)
  }
  process.stdout.write(`expected  aggregate=${JSON.stringify(expected.aggregate)} samples=${expected.sampleCount} missing=${expected.missingCount} retries=${expected.unobservableRetries} complete=${expected.usageComplete}\n`)
  for (const entry of evidence.replays) {
    if (entry.error !== null) {
      process.stdout.write(`replay ${entry.build}: FAILED ${entry.error}\n`)
      continue
    }
    const candidate = entry.candidate ?? {}
    process.stdout.write(
      `replay ${entry.build}: schemaVersion=${candidate.schemaVersion} durationMs=${candidate.durationMs} usage=${JSON.stringify(candidate.usage ?? null)} sampleCount=${candidate.usageSampleCount ?? '-'} complete=${candidate.usageComplete ?? '-'}\n`,
    )
  }
  for (const entry of meters) {
    if (entry.error !== undefined) {
      process.stdout.write(`dsh-token-meter ${entry.installRoot}: FAILED ${entry.error}\n`)
      continue
    }
    process.stdout.write(`dsh-token-meter ${entry.installRoot}: ${JSON.stringify(entry.value)}\n`)
  }
  if (options.mail) {
    for (const entry of evidence.replays) {
      if (entry.mail === null || entry.mail === undefined) continue
      process.stdout.write(`--- mail via ${entry.build} ---\n`)
      process.stdout.write(`Subject: ${entry.mail.subject}\n\n${entry.mail.text}\n`)
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
