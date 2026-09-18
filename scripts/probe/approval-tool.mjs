/**
 * The approval-requesting tool for the Phase 8.1 end-to-end probe.
 *
 * The shipped approval path is reached only by tools that legitimately ask for
 * a decision — the sandboxed shell tools on an escalated retry, and the `tools`
 * pipeline's own policy step. Neither is reachable from a scripted model in a
 * disposable home: the sandbox has nothing to escalate, and a policy step asks
 * before the tool body runs, so it cannot be aimed at a chosen moment.
 *
 * This tool therefore supplies the missing trigger and nothing else. It is an
 * ordinary registered tool: the real agent loop decides to call it, the real
 * registry validates its arguments and dispatches it, and its body calls the
 * real `ctx.approval.request()` from **inside** the open Turn — which is the
 * precondition DSH enforces (an out-of-turn ask throws before auditing
 * anything, as three earlier probe attempts demonstrated).
 *
 * What is scripted is only the human: `probe-auto-answer` owns the
 * `approval/request` waterfall and returns the outcome. `dsh-mail-notify` never
 * registers on that waterfall; it observes the durable `approval/asked` audit
 * record the service appends.
 *
 * One further affordance exists for the dedupe case. When
 * `PROBE_REPLAY_APPROVAL` names a file, the tool reads the service-issued
 * approval id from it and appends a second, durable `approval/asked` record
 * with that same id through the real `Session.append()` path. The duplicate is
 * therefore a real log entry the runtime itself wrote, not a fabricated event
 * pushed at the plugin: the plugin must recognise it as one interaction and
 * send exactly one approval mail.
 *
 * It is probe-only: it is never loaded by a product profile, and `scripts/` is
 * outside the package's `files` whitelist.
 *
 * @module dsh-mail-notify/scripts/probe/approval-tool
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-approval-tool'

/**
 * The tool-definition helper, loaded from the DSH installation.
 *
 * This file lives outside the profile's module root — that is what keeps the
 * plugin under test out of it — so a bare `@deepseek-ai/dsh-tools` specifier
 * cannot resolve here. Resolving through the installation root is the same
 * device `dev-boot-probe` uses for the harness modules themselves, and it is
 * what keeps the tool definition going through the registry's real
 * `defineTool` rather than a hand-rolled shape.
 */
const require = createRequire(join(process.env['DSH_INSTALL_ROOT'] ?? join(process.env['DSH_HOME'] ?? '', '..'), 'noop.cjs'))
const { defineTool } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href)

/** The services the tool needs before it can ask for a decision. */
export const inject = ['tools', 'approval']

/** The registered tool name the scripted model calls. */
const TOOL_NAME = 'probe_request_approval'

/** Where the tool records its own view of the interaction, when asked to. */
const tracePath = process.env['PROBE_APPROVAL_TRACE']

/** Where the answerer leaves the service-issued approval id, when replaying. */
const replayIdPath = process.env['PROBE_REPLAY_APPROVAL']

/** The closed outcome vocabulary this tool accepts from the service. */
const OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/** How long the tool waits for the answerer's id file before giving up. */
const REPLAY_ID_TIMEOUT_MS = 10_000

/**
 * Append one line to the tool trace.
 *
 * @param line - the line to record, without a trailing newline.
 */
function trace(line) {
  if (tracePath === undefined || tracePath === '') return
  mkdirSync(dirname(tracePath), { recursive: true })
  appendFileSync(tracePath, `${line}\n`, 'utf8')
}

/**
 * Read the service-issued approval id the answerer recorded.
 *
 * The read is bounded in time and in size: one short line, one file. It never
 * touches a credential or a tool argument.
 *
 * @returns the id, or `undefined` when the answerer never recorded one.
 */
async function readReplayId() {
  if (replayIdPath === undefined || replayIdPath === '') return undefined
  const deadline = Date.now() + REPLAY_ID_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const text = readFileSync(replayIdPath, 'utf8').trim()
      if (text !== '') return text.split('\n')[0]
    } catch {
      // Not written yet; the answerer is still inside `approval.request`.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  return undefined
}

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
        'Probe-only tool: request a one-shot approval decision from the configured answerer while the turn is open.',
      parameters: {
        reason: {
          type: 'string',
          required: true,
          description: 'Human-readable explanation of why a decision is needed.',
        },
        argSentinel: {
          type: 'string',
          description:
            'Probe-only: an arbitrary tool argument that must never reach a mail body or a log line. DSH deliberately omits tool arguments from the approval contract, and this parameter is what shows it.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            outcome: { type: 'string', required: true },
            resumed: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) {
          // Without the calling agent there is no session to audit against and
          // no owner for the question; failing loudly is the only honest path.
          throw new Error('probe_request_approval: the registry supplied no calling agent')
        }

        trace(`asking tool=${TOOL_NAME} callId=${String(exec.callId)} reason=${JSON.stringify(args.reason)}`)
        if (typeof args.argSentinel === 'string') {
          // Recorded with its length only. The sentinel's whole purpose is to
          // be absent from every mail body and every log line, so a trace that
          // copied it would defeat the check it exists for.
          trace(`argSentinel supplied, length=${args.argSentinel.length}, value withheld`)
        }
        const outcome = await ctx.approval.request({
          agent,
          toolName: TOOL_NAME,
          callId: exec.callId,
          reason: args.reason,
          signal: exec.signal,
        })
        trace(`decided outcome=${String(outcome)}`)

        if (!OUTCOMES.includes(outcome)) {
          throw new Error(`probe_request_approval: the service returned a non-vocabulary outcome ${String(outcome)}`)
        }

        const replayId = await readReplayId()
        if (replayId !== undefined) {
          // A real duplicate: same type, same service-issued id, appended
          // through the same log the runtime itself writes.
          agent.session.append('approval/asked', { id: replayId, toolName: TOOL_NAME, callId: exec.callId })
          trace(`replayed approval/asked id=${replayId}`)
        } else if (replayIdPath !== undefined && replayIdPath !== '') {
          trace('replay requested but the answerer recorded no approval id')
        }

        if (outcome !== 'allowed-once') {
          // The tool refuses to do its work without a grant, exactly as a real
          // approval-gated tool would.
          throw new Error(
            `probe_request_approval: the decision was "${outcome}", so the requested action was not performed`,
          )
        }

        trace('resumed with allowed-once')
        return { outcome, resumed: true }
      },
    }),
  )
  trace(`tool registered as ${TOOL_NAME}`)
}
