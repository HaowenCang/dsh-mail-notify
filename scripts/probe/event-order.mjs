/**
 * Record the raw `session/event` order for one probe run.
 *
 * The user-prompt attribution scenario has to answer a question about *order*:
 * which `user/message` arrives before which `turn/start`, and whether either
 * carries a turn number of its own. Reading that out of a notification would
 * mean reasoning backwards from the very behaviour under test, so this plugin
 * records the events themselves.
 *
 * Only the fields that decide attribution are written — the event type, its
 * turn number when it has one, and the first characters of a user message's
 * text. Nothing else is recorded, and the text is truncated so a session's
 * prompt cannot end up wholesale in a trace file.
 *
 * @module dsh-mail-notify/scripts/probe/event-order
 */

import { appendFileSync } from 'node:fs'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-event-order'

/** The one service this observer needs. */
export const inject = ['sessions']

/** Where the trace goes; absent means the observer records nothing. */
const tracePath = process.env['PROBE_EVENT_ORDER']

/** The event types that decide attribution, plus the settled bounds of a turn. */
const WATCHED = new Set(['turn/start', 'turn/end', 'user/message', 'assistant/message', 'step/start'])

/**
 * Write one trace line.
 *
 * @param line - the line, without its newline.
 */
function record(line) {
  if (tracePath === undefined || tracePath === '') return
  try {
    appendFileSync(tracePath, `${line}\n`, 'utf8')
  } catch {
    // An unwritable trace leaves the run's other evidence intact; the probe
    // reports the missing file rather than failing here.
  }
}

/**
 * Summarize a user message's text without copying it whole.
 *
 * @param data - the event payload.
 * @returns the leading characters, or an empty marker.
 */
function textHead(data) {
  const message = data?.message ?? data
  const content = message?.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        text += block.text
        break
      }
    }
  }
  return text.slice(0, 48).replace(/\s+/g, ' ')
}

/**
 * Observe every session event on this fiber.
 *
 * @param ctx - the plugin's fiber context.
 */
export function apply(ctx) {
  record('--- observer attached ---')
  ctx.on('session/event', (session, event) => {
    if (!WATCHED.has(event?.type)) return
    const turn = event.data?.turn
    const step = event.data?.step
    const parts = [
      `seq=${String(event.seq).padStart(4)}`,
      `type=${event.type}`,
      `turn=${turn === undefined ? '-' : turn}`,
      `step=${step === undefined ? '-' : step}`,
      `session=${String(session?.id ?? '?').slice(0, 24)}`,
    ]
    if (event.type === 'user/message') parts.push(`text="${textHead(event.data)}"`)
    if (event.type === 'turn/end') parts.push(`reason=${event.data?.reason?.kind ?? '-'}`)
    record(parts.join(' '))
  })
}
