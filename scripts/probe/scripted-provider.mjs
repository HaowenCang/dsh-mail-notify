/**
 * The scripted model for the Phase 8 end-to-end probe.
 *
 * It is a real LLM provider plugin registered through `ctx.llm.registerAdapter`,
 * so the agent loop, the request assembly, the tool dispatch, the session log,
 * and the plugin under test all take the production path. Only the tokens come
 * from a table instead of a network call, which is what §34 asks for: construct
 * a terminal failure without spending a real plan's quota, and answer the
 * question without a real person.
 *
 * The script is read once from `PROBE_SCRIPT`, a JSON array whose entries are
 * either a tool call or the final answer text.
 *
 * @module dsh-mail-notify/scripts/probe/scripted-provider
 */

import { readFileSync } from 'node:fs'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-scripted-provider'

/** The one service this provider needs. */
export const inject = ['llm']

/** The provider route the probe's `agent-default-model` points at. */
const PROVIDER = 'probe'
/** The single advertised model. */
const MODEL = 'probe-scripted'
/** Token counts the loop records; fixed so a mail's telemetry is predictable. */
const USAGE = { inputTokens: 120, outputTokens: 30, totalTokens: 150 }

/**
 * Read the scripted turns.
 *
 * @returns one entry per model call, in order.
 */
function readScript() {
  const path = process.env['PROBE_SCRIPT']
  if (path === undefined || path === '') return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    process.stderr.write(`[probe-provider] could not read the script: ${String(error)}\n`)
    return []
  }
}

/** The scripted entries, consumed once each across the run. */
const script = readScript()
/** How many model calls have been served; the script's cursor. */
let callIndex = 0
/** The call ids handed out, so a tool result can be correlated if needed. */
let callCounter = 0

/**
 * Yield one entry as a chunk stream.
 *
 * The chunk vocabulary is block-oriented: a block opens with `block-start`, its
 * content arrives as deltas, and the assembled block is committed by
 * `block-end`. Emitting only `block-end` — as this function first did — leaves
 * the stream accumulator with an unreachable variant, so the sequence below is
 * the minimum a real adapter has to produce.
 *
 * @param entry - the scripted entry: a string or `{ say }` for text,
 *   `{ tool, arguments }` for a tool call, or `{ fail }` for a provider failure.
 * @returns the chunk list, ending in the finish chunk the loop expects.
 */
function chunksFor(entry) {
  if (entry !== null && typeof entry === 'object' && typeof entry.fail === 'object' && entry.fail !== null) {
    // A terminal provider failure: the adapter reports it as an `error` finish
    // reason carrying the `LlmFailure` facts, which is what the agent loop
    // flattens into `turn/end.reason.error`.
    return [{ type: 'finish', reason: { kind: 'error', failure: entry.fail } }]
  }

  if (entry !== null && typeof entry === 'object' && typeof entry.tool === 'string') {
    callCounter += 1
    const id = `probe-call-${callCounter}`
    const args = typeof entry.arguments === 'string' ? entry.arguments : '{}'
    return [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id, name: entry.tool, argumentsDelta: args },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: entry.tool, arguments: args } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
  }

  const text = typeof entry === 'string' ? entry : String(entry?.say ?? '')
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    // The counters travel on the finish chunk, which is where the loop reads the
    // call's accounting from; a probe that omitted them would make every mail
    // report incomplete telemetry for a reason that is an artefact of the probe.
    { type: 'finish', reason: { kind: 'stop' }, usage: USAGE },
  ]
}

/** The scripted provider's adapter over the harness stream vocabulary. */
class ScriptedAdapter extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: 'Probe scripted provider' }
  }

  listModels(provider) {
    return Promise.resolve([{ provider, id: MODEL, name: 'Probe scripted' }])
  }

  /**
   * Describe the one scripted model.
   *
   * The metadata must satisfy the harness's own exact-model validator, so it
   * carries the identity triple every `LlmModelInfo` requires and the context
   * capacity the loop reads to size its request.
   *
   * @param provider - the registered route.
   * @param model - the model id.
   * @returns the model metadata.
   */
  resolveModel(provider, model) {
    return Promise.resolve({
      provider,
      id: model,
      name: 'Probe scripted',
      context: { contextWindow: 200000 },
      defaultMaxTokens: 4096,
    })
  }

  /**
   * Stream one scripted call.
   *
   * The async generator yields the entry's chunks and then returns, which is the
   * whole contract the only required method has to satisfy.
   *
   * @param _options - the assembled request; the probe ignores it.
   * @returns the chunk stream.
   */
  async *stream(_options) {
    const entry = callIndex < script.length ? script[callIndex] : 'The script is exhausted.'
    callIndex += 1
    for (const chunk of chunksFor(entry)) yield chunk
  }
}

/**
 * Register the provider route on the plugin's own fiber.
 *
 * @param ctx - the plugin's fiber context.
 */
export function apply(ctx) {
  ctx.llm.registerAdapter([PROVIDER], new ScriptedAdapter())
  process.stderr.write(`[probe-provider] registered route "${PROVIDER}" with ${script.length} scripted call(s)\n`)
}
