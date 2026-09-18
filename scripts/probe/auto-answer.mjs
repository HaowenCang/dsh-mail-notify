/**
 * The human stand-in for the Phase 8 end-to-end probe.
 *
 * This plugin answers `user-questions/request` and `approval/request` so a real
 * headless DSH run can proceed past an interaction that would otherwise wait for
 * a person. It exists only in the probe: it is never loaded by a product profile.
 *
 * The two registrations are the answer-ownership side of the interaction, which
 * is exactly the side `dsh-mail-notify` refuses to touch (D018). Keeping the
 * stand-in separate from the plugin under test is what makes the separation
 * observable: the plugin only ever observes `tool/call` and `approval/asked`.
 *
 * @module dsh-mail-notify/scripts/probe/auto-answer
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-auto-answer'

/** The services the answerer needs before it can answer anything. */
export const inject = ['userQuestions', 'approval']

/** Where the answerer records what it was asked, when the probe asks it to. */
const tracePath = process.env['PROBE_ANSWER_TRACE']

/**
 * Append one line to the answerer trace.
 *
 * @param line - the line to record, without a trailing newline.
 */
function trace(line) {
  if (tracePath === undefined || tracePath === '') return
  mkdirSync(dirname(tracePath), { recursive: true })
  appendFileSync(tracePath, `${line}\n`, 'utf8')
}

/**
 * Answer one question request the way a person choosing the recommended option
 * would: the first option of every question, or free text when none is offered.
 *
 * @param request - the pending question request.
 * @returns the structured answer the UI provider would have returned.
 */
function answer(request) {
  const questions = Array.isArray(request?.questions) ? request.questions : []
  const answers = questions.map((question) => {
    const options = Array.isArray(question?.options) ? question.options : []
    const first = options[0]
    const label = typeof first?.label === 'string' ? first.label : ''
    trace(`question ${JSON.stringify(String(question?.id ?? ''))} answered with ${JSON.stringify(label)}`)
    return label === ''
      ? { id: String(question?.id ?? ''), selected: [], custom: 'probe free-text answer' }
      : { id: String(question?.id ?? ''), selected: [label] }
  })
  return { answers }
}

/**
 * Register the answerers on the plugin's own fiber.
 *
 * Both registrations answer for the *agent's* side of the interaction, which is
 * the side `dsh-mail-notify` deliberately never touches. The approval answerer
 * grants one-shot permission so a tool call can actually proceed; without an
 * answerer, DSH fails closed with `unavailable` and the task would stop before
 * producing the completion mail the probe is looking for.
 *
 * @param ctx - the plugin's fiber context.
 */
export function apply(ctx) {
  ctx.on('user-questions/request', (request) => Promise.resolve(answer(request)))
  ctx.on('approval/request', (request) => {
    trace(`approval ${JSON.stringify(String(request?.toolName ?? ''))} answered allowed-once`)
    return Promise.resolve('allowed-once')
  })
  trace('auto-answer registered')
}
