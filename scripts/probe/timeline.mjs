/**
 * The event observe for the Phase 8.1 approval timeline.
 *
 * The booted app's session log is a compressed, versioned store; reading it
 * back from outside the process would mean decompressing a private format. But
 * the timeline the approval test needs is not the file's — it is the sequence
 * the runtime actually published, with the timestamps it stamped.
 *
 * So this plugin subscribes to the same `session/event` Cordis event every
 * other observer uses and appends one line per event, before the plugin under
 * test is ever consulted about ordering. It is a probe: it reads event types,
 * turn and step numbers, tool names, and — for approval records only — the
 * request id and outcome.
 *
 * What it deliberately does **not** write down is anything the probe is trying
 * to prove absent from the mail: no tool arguments, no tool result content, no
 * assistant message text, no user message text. A timeline that carried those
 * would be a new copy of exactly the material the privacy assertions exist to
 * keep contained.
 *
 * @module dsh-mail-notify/scripts/probe/timeline
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-timeline'

/** Where the observe writes its lines, when the probe asks it to. */
const timelinePath = process.env['PROBE_TIMELINE']

/**
 * Append one timestamped line to the timeline.
 *
 * The timestamp is taken here rather than read off the event: the event's own
 * `time` is the runtime's clock for the same moment, and the probe reports both
 * so the two can be compared rather than assumed equal.
 *
 * @param line - the event, without a trailing newline.
 */
function append(line) {
  if (timelinePath === undefined || timelinePath === '') return
  mkdirSync(dirname(timelinePath), { recursive: true })
  appendFileSync(timelinePath, `T+${Date.now()} ${line}\n`, 'utf8')
}

/**
 * Reduce one session event to the facts a timeline needs.
 *
 * @param event - the published session event.
 * @returns the line to record.
 */
function describe(event) {
  const type = typeof event?.type === 'string' ? event.type : 'unknown'
  const data = typeof event?.data === 'object' && event.data !== null ? event.data : {}
  const parts = [type]
  if (typeof event?.seq === 'number') parts.push(`seq=${event.seq}`)
  if (typeof event?.time === 'number') parts.push(`time=${event.time}`)
  if (typeof data.turn === 'number') parts.push(`turn=${data.turn}`)
  if (typeof data.step === 'number') parts.push(`step=${data.step}`)
  // Tool identity, never tool arguments: `data.name` on `tool/call` and
  // `data.toolName` on `approval/asked` are labels, and the arguments field is
  // deliberately not read.
  if (typeof data.name === 'string') parts.push(`tool=${JSON.stringify(data.name)}`)
  if (typeof data.toolName === 'string') parts.push(`tool=${JSON.stringify(data.toolName)}`)
  if (typeof data.callId === 'string') parts.push(`callId=${JSON.stringify(data.callId)}`)
  if (type.startsWith('approval/')) {
    if (typeof data.id === 'string') parts.push(`id=${JSON.stringify(data.id)}`)
    if (typeof data.outcome === 'string') parts.push(`outcome=${JSON.stringify(data.outcome)}`)
    if (typeof data.reason === 'string') parts.push(`reason=${JSON.stringify(data.reason)}`)
  }
  if (type === 'turn/end' && typeof data.reason?.kind === 'string') parts.push(`kind=${data.reason.kind}`)
  if (type === 'assistant/message') {
    const blocks = Array.isArray(data.message?.content) ? data.message.content : []
    // Block types only — the count says a message was produced and what it was
    // made of, without copying a single character of its content.
    const kinds = blocks.map((block) => (typeof block?.type === 'string' ? block.type : '?')).join(',')
    parts.push(`blocks=[${kinds}]`)
    const source = data.message?.source
    if (typeof source?.provider === 'string') parts.push(`provider=${JSON.stringify(source.provider)}`)
  }
  if (type === 'tool/result') {
    parts.push(`isError=${data.message?.content?.[0]?.isError === true ? 'true' : 'false'}`)
  }
  return parts.join(' ')
}

/**
 * Register the observe on the plugin's own fiber.
 *
 * @param ctx - the plugin's fiber context.
 */
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    const sessionId = typeof session?.id === 'string' ? session.id : 'unknown-session'
    append(`session=${JSON.stringify(sessionId)} ${describe(event)}`)
  })
  ctx.on('session/disposed', (session) => {
    const sessionId = typeof session?.id === 'string' ? session.id : 'unknown-session'
    append(`session=${JSON.stringify(sessionId)} session/disposed`)
  })
  append('timeline observer registered')
}
