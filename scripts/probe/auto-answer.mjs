/**
 * The human stand-in for the Phase 8 end-to-end probes.
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
 * For approvals the answerer does not merely answer: it **withholds** the
 * answer until the probe has observed the approval mail arrive over SMTP. That
 * ordering is what turns "a mail was sent" into "the notification reached the
 * mail system while the approval was still pending". A fixed sleep would leave
 * a race — on a slow machine the mail could land after the decision — and a
 * pass that cannot distinguish those two cases is not evidence.
 *
 * It also reads the live approval identity out of the session log rather than
 * out of the request: DSH's own `ApprovalService.request()` appends
 * `approval/asked` with the service-issued id and then dispatches the public
 * `ApprovalRequest` **without** that id, so the log is the only place the
 * answerer can learn which interaction it is answering. The small bounded scan
 * below is the whole of that read.
 *
 * The answer itself is scripted from the environment:
 *
 * ```text
 * PROBE_APPROVAL_OUTCOME   allowed-once (default) | rejected | cancelled
 * PROBE_WAIT_SENTINEL      absolute path whose appearance releases the answer
 * PROBE_WAIT_TIMEOUT_MS    how long to wait before answering anyway (default 20000)
 * PROBE_APPROVAL_TRACE     where to record this answerer's own timeline
 * PROBE_APPROVAL_ID_FILE   where to record the service-issued approval id
 * ```
 *
 * @module dsh-mail-notify/scripts/probe/auto-answer
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-auto-answer'

/** The services the answerer needs before it can answer anything. */
export const inject = ['userQuestions', 'approval']

/** Where the answerer records what it was asked, when the probe asks it to. */
const tracePath = process.env['PROBE_ANSWER_TRACE']

/** Where the approval answerer records its timeline, when the probe asks it to. */
const approvalTracePath = process.env['PROBE_APPROVAL_TRACE']

/** The scripted approval outcome; `allowed-once` unless the probe says otherwise. */
const approvalOutcome = process.env['PROBE_APPROVAL_OUTCOME'] ?? 'allowed-once'

/** The sentinel whose appearance means the approval mail has arrived. */
const waitSentinel = process.env['PROBE_WAIT_SENTINEL']

/** How long to wait for that sentinel before answering regardless. */
const waitTimeoutMs = Number.parseInt(process.env['PROBE_WAIT_TIMEOUT_MS'] ?? '20000', 10)

/** How many trailing log entries the identity scan may read. */
const SCAN_DEPTH = 12

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
 * Append one timestamped line to the approval timeline.
 *
 * The timestamps share the clock with the session log and with the probe's SMTP
 * receipts, which is what lets the ordering between the three sources be read
 * off directly rather than inferred.
 *
 * @param line - the event, without a trailing newline.
 */
function approvalTrace(line) {
  if (approvalTracePath === undefined || approvalTracePath === '') return
  mkdirSync(dirname(approvalTracePath), { recursive: true })
  appendFileSync(approvalTracePath, `T+${Date.now()} ${line}\n`, 'utf8')
}

/**
 * Read the newest `approval/asked` identity from the requesting session log.
 *
 * `request.agent.session` is the durable log the approval service just appended
 * to, so the tail of it holds the record for this very interaction. The scan is
 * bounded and reads event types and one id only — no tool arguments, no result,
 * no message content.
 *
 * @param agent - the agent whose session holds the audit record.
 * @returns the id and tool name, or `undefined` when the tail holds no ask.
 */
function lastApprovalAsked(agent) {
  let session
  try {
    session = agent?.session
  } catch {
    return undefined
  }
  let seq
  try {
    seq = typeof session?.seq === 'number' ? session.seq : undefined
  } catch {
    return undefined
  }
  if (session === undefined || seq === undefined || typeof session.eventAt !== 'function') return undefined
  for (let index = seq - 1; index >= 0 && index >= seq - SCAN_DEPTH; index -= 1) {
    let event
    try {
      event = session.eventAt(index)
    } catch {
      return undefined
    }
    if (event?.type !== 'approval/asked') continue
    const id = event.data?.id
    const toolName = event.data?.toolName
    if (typeof id !== 'string' || id === '') return undefined
    return { id, toolName: typeof toolName === 'string' ? toolName : '' }
  }
  return undefined
}

/**
 * Wait for the probe to confirm the approval mail reached the SMTP server.
 *
 * @returns the observed wait, in milliseconds and with how it ended.
 */
async function waitForApprovalMail() {
  if (waitSentinel === undefined || waitSentinel === '') return { waitedMs: 0, releasedBy: 'no-sentinel' }
  const deadline = Date.now() + (Number.isFinite(waitTimeoutMs) ? waitTimeoutMs : 20000)
  const started = Date.now()
  while (Date.now() < deadline) {
    if (existsSync(waitSentinel)) return { waitedMs: Date.now() - started, releasedBy: 'mail-observed' }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  return { waitedMs: Date.now() - started, releasedBy: 'timeout' }
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
 * returns the scripted outcome; without any answerer DSH fails closed with
 * `unavailable` and the task would stop before demonstrating the chain.
 *
 * @param ctx - the plugin's fiber context.
 */
export function apply(ctx) {
  ctx.on('user-questions/request', (request) => Promise.resolve(answer(request)))
  ctx.on('approval/request', async (request) => {
    const toolName = String(request?.toolName ?? '')
    const reason = typeof request?.reason === 'string' ? request.reason : ''
    const callId = request?.callId === undefined ? 'none' : String(request.callId)
    const asked = lastApprovalAsked(request?.agent)
    approvalTrace(
      `approval/request received tool=${JSON.stringify(toolName)} callId=${callId} reason=${JSON.stringify(reason)} ` +
        `id=${asked?.id ?? 'unreadable'} logTail=${asked === undefined ? 'no-approval-asked' : 'approval/asked-present'}`,
    )
    trace(`approval ${JSON.stringify(toolName)} asked`)

    if (asked !== undefined) {
      const idPath = process.env['PROBE_APPROVAL_ID_FILE']
      if (idPath !== undefined && idPath !== '') {
        mkdirSync(dirname(idPath), { recursive: true })
        appendFileSync(idPath, `${asked.id}\n`, 'utf8')
      }
    }

    const wait = await waitForApprovalMail()
    approvalTrace(`approval/request released by=${wait.releasedBy} waitedMs=${wait.waitedMs}`)
    approvalTrace(`approval/request answering ${approvalOutcome}`)
    trace(`approval ${JSON.stringify(toolName)} answered ${approvalOutcome} (${wait.releasedBy} after ${wait.waitedMs}ms)`)
    return Promise.resolve(approvalOutcome)
  })
  trace(`auto-answer registered (approval outcome ${approvalOutcome})`)
}
