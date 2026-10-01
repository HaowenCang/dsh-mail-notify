/**
 * The late answerer for the timed `ask_user_question` probe scenario.
 *
 * A timed question that expires leaves the agent free to continue while the
 * question stays answerable. A person answering afterwards is a real DSH 0.2
 * lifecycle: `UserQuestionService.answer(agent, callId, batch)` steers a
 * user-role message whose `source.kind` is `user-question-reply` into the agent,
 * and that message — not this tool — is what the mail side has to classify
 * correctly.
 *
 * The tool exists because the late answer must be produced from inside a live
 * agent execution: `answer()` asserts that the supplied agent is the runtime's
 * exact live root, and `exec.agent` is that object. The call id is read from the
 * service's own projection rather than guessed, so the reply names the question
 * DSH actually recorded as answerable.
 *
 * It records only what it did — counts, ids, and whether the service accepted the
 * batch. The answer text is a synthetic sentinel the probe searches the delivered
 * mails for; copying it into a trace would defeat the check it exists for.
 *
 * @module dsh-mail-notify/scripts/probe/late-answer-tool
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-late-answer-tool'

/** The two services the tool needs. */
export const inject = ['tools', 'userQuestions']

/** The one tool the scripted model may call to deliver a late answer. */
const TOOL_NAME = 'probe_late_answer'

/** Where the tool records its own progress, when the probe asks it to. */
const tracePath = process.env['PROBE_LATE_ANSWER_TRACE']

/**
 * Append one line to this tool's trace.
 *
 * @param line - the line to record, without a trailing newline.
 */
function trace(line) {
  if (tracePath === undefined || tracePath === '') return
  mkdirSync(dirname(tracePath), { recursive: true })
  appendFileSync(tracePath, `${line}\n`, 'utf8')
}

/**
 * Build a complete answer batch for one recorded question.
 *
 * DSH requires one entry per question of the call, and refuses a batch that
 * names them anything but exactly once. The first option label is used when a
 * question offers options, and the probe's own free-text sentinel otherwise.
 *
 * @param questions - the questions the call recorded as answerable.
 * @returns the structured answer batch.
 */
function batchFor(questions) {
  return {
    answers: questions.map((question) => {
      const first = Array.isArray(question?.options) ? question.options[0] : undefined
      const label = typeof first?.label === 'string' ? first.label : ''
      return label === ''
        ? { id: String(question?.id ?? ''), selected: [], custom: LATE_ANSWER_SENTINEL }
        : { id: String(question?.id ?? ''), selected: [label], custom: LATE_ANSWER_SENTINEL }
    }),
  }
}

/**
 * The free-text sentinel carried by the late reply.
 *
 * Distinctive so the probe can search every delivered body for it: the property
 * under test is that `includeUserPrompt` does not present this text as the
 * operator's ordinary prompt, and a generic answer could not distinguish that
 * from an off-by-one attribution. It travels through the environment so the
 * assertion and the value live in the same file — the probe — rather than in two
 * that could drift.
 */
const LATE_ANSWER_SENTINEL = process.env['PROBE_LATE_ANSWER_TEXT'] ?? 'PROBE_LATE_ANSWER_SENTINEL_4b7d02'

/**
 * Register the tool on the plugin's own fiber.
 *
 * @param ctx - the plugin's fiber context.
 */
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description:
        'Probe-only tool: answer a timed ask_user_question whose foreground wait already expired, through the real user-questions service.',
      parameters: {
        note: {
          type: 'string',
          description: 'Probe-only: a note recorded in the trace. It never reaches a mail.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answered: { type: 'boolean', required: true },
            callId: { type: 'string', required: true },
            questionCount: { type: 'number', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute(_args, exec) {
        const agent = exec.agent
        if (agent === undefined) {
          // Without the live root agent the service would refuse the reply, and
          // a probe that skipped the assertion would be measuring its own stub.
          throw new Error(`${TOOL_NAME}: the registry supplied no calling agent`)
        }

        const continued = ctx.userQuestions.continued(agent)
        trace(`continued questions visible to the probe: ${String(continued.length)}`)
        const target = continued[0]
        if (target === undefined) {
          trace('no continued question is answerable; nothing to answer late')
          return { answered: false, callId: '', questionCount: 0 }
        }

        const batch = batchFor(target.questions)
        const accepted = ctx.userQuestions.answer(agent, target.callId, batch)
        trace(
          `late reply for callId=${String(target.callId)} accepted=${String(accepted)} ` +
            `questions=${String(target.questions.length)}`,
        )
        return { answered: accepted, callId: String(target.callId), questionCount: target.questions.length }
      },
    }),
  )
  trace('late-answer tool registered')
}
