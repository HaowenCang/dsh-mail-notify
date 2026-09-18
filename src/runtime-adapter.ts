/**
 * The one module that knows DSH payload shapes.
 *
 * `turn/start`, `assistant/message`, `tool/call`, `tool/result`, and `turn/end`
 * are not top-level Cordis events: they are members of one `SessionEvent` union
 * delivered through `session/event`. Every path below therefore descends
 * through `event.data`, and every field access is shape-checked, because
 * runtime data carries no compile-time guarantee — the plugin may be loaded
 * from a bundle whose dependency versions differ from the ones it was built
 * against.
 *
 * Two rules in here are load-bearing. An event whose `turn` is missing or not a
 * number degrades to `other` rather than being defaulted to `0` or `NaN`, which
 * would silently file real telemetry under a turn that does not exist. And the
 * returned objects contain no reference to `session`, `event`, or `event.data`,
 * so nothing downstream can accidentally retain a live object.
 *
 * @module dsh-mail-notify/runtime-adapter
 */

import { describeAbort, describeError, extractFailureFacts, toTurnEndKind } from './completion.ts'
import { toApprovalNotification } from './human-attention.ts'
import { collectUsage } from './telemetry.ts'
import type {
  ApprovalNotification,
  FailureFacts,
  InternalEvent,
  RawUsage,
  SessionFacts,
  SubagentDecidedBy,
  TurnEndKind,
} from './types.ts'

/**
 * The DSH-facing view of a session.
 *
 * Stated structurally on purpose: the adapter is the only module permitted to
 * know DSH shapes (architecture invariant one), and a structural view keeps
 * that knowledge checkable against — rather than identical to — the installed
 * declaration files.
 */
export interface SessionLike {
  id?: unknown
  header?: unknown
}

/** The DSH-facing view of one session event. */
export interface SessionEventLike {
  type?: unknown
  time?: unknown
  seq?: unknown
  data?: unknown
}

/** Read a string-valued property, tolerating `null` and non-strings. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Read a finite number, tolerating `null` and numeric strings being absent. */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read a plain-record property without trusting it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Extract the session id, accepting either a string or a branded string.
 *
 * Used by `session/disposed`, which has no payload beyond the session itself.
 * The id is never inspected for hierarchy: top-level and subagent sessions
 * share one `session-<uuid>` form.
 *
 * @param session - the live session, viewed structurally.
 * @returns the id as a plain string.
 */
export function toSessionId(session: SessionLike): string {
  const raw = session.id
  if (typeof raw === 'string') return raw
  if (raw !== null && raw !== undefined) return String(raw)
  return 'unknown-session'
}

/**
 * Decide whether a session is a subagent, and record which criterion decided it.
 *
 * The three criteria are applied in a fixed order: `origin`, then
 * `parentSession`, then `delegationDepth`. The last one uses exactly one
 * comparison form — `typeof === 'number' && > 0` — because `delegationDepth: 0`
 * is a legal value on ordinary top-level sessions. Truthiness testing or key
 * presence would misclassify those sessions as subagents and silently drop
 * their notifications; that misclassification was observed at runtime during
 * Phase 1, so the strict form is part of the contract rather than a preference.
 *
 * The session id is never consulted: top-level and subagent ids share the same
 * `session-<uuid>` form and carry no hierarchy.
 *
 * @param session - the live session, viewed structurally.
 * @returns session facts, with `decidedBy: null` meaning top level.
 */
export function toSessionFacts(session: SessionLike): SessionFacts {
  if (typeof session !== 'object' || session === null) {
    return { sessionId: 'unknown-session', isSubagent: false, decidedBy: null }
  }
  const sessionId = toSessionId(session)
  const header = asRecord(session.header)

  const facts: SessionFacts = { sessionId, isSubagent: false, decidedBy: null }
  if (header === undefined) return facts

  const cwd = asString(header.cwd)
  if (cwd !== undefined) facts.cwd = cwd
  const agentPreset = asString(header.agentPreset)
  if (agentPreset !== undefined) facts.agentPreset = agentPreset

  const origin = header.origin
  if (origin === 'subagent') {
    facts.isSubagent = true
    facts.decidedBy = 'origin' satisfies SubagentDecidedBy
    return facts
  }

  const parentSession = header.parentSession
  if (typeof parentSession === 'string' && parentSession !== '') {
    facts.isSubagent = true
    facts.decidedBy = 'parentSession'
    return facts
  }

  const depth = header.delegationDepth
  // Exactly one comparison form is permitted here: a numeric test and a strict
  // `> 0`. Truthiness (`if (depth)`) and key presence (`'delegationDepth' in
  // header`, `!== undefined`) both misclassify a legal top-level session that
  // carries `delegationDepth: 0`, which the runtime was observed to emit.
  // `Number.isFinite` additionally rejects `Infinity`, which is not a depth the
  // runtime writes and must not be read as unbounded delegation.
  if (typeof depth === 'number' && Number.isFinite(depth) && depth > 0) {
    facts.isSubagent = true
    facts.decidedBy = 'delegationDepth'
  }

  return facts
}

/** Read `provider` / `model` from an assistant message source. */
function readModelSource(message: Record<string, unknown>): { provider?: string; model?: string } {
  const source = asRecord(message.source)
  if (source === undefined) return {}
  // `MessageSource` is a union of `model` / `user` / `plugin` / `tool`; only the
  // model variant carries provider and model.
  if (source.kind !== 'model') return {}
  const out: { provider?: string; model?: string } = {}
  const provider = asString(source.provider)
  if (provider !== undefined) out.provider = provider
  const model = asString(source.model)
  if (model !== undefined) out.model = model
  return out
}

/**
 * Read the usage carried inside a durable assistant stream.
 *
 * A stream is a compacted record list; a usage report appears as a raw
 * `{ type: 'chunk', chunk: { type: 'usage', usage } }` record, and the last one
 * wins because a stream may report usage more than once. Every real
 * `assistant/message` observed so far carried its counters on `data.usage`
 * instead, so this path is compatibility rather than the primary source; the
 * DSH token meter reads both in the same order.
 *
 * @param stream - the raw stream value; its shape is not trusted.
 * @returns the counters, or `undefined` when the stream carried none.
 */
function readStreamUsage(stream: unknown): RawUsage | undefined {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = asRecord(stream[index])
    if (record?.['type'] !== 'chunk') continue
    const chunk = asRecord(record['chunk'])
    if (chunk?.['type'] !== 'usage') continue
    const usage = collectUsage(chunk['usage'])
    if (usage !== undefined) return usage
  }
  return undefined
}

/**
 * Read the user's own text out of a `user/message` payload.
 *
 * A `UserMessage` carries a content array or a bare string depending on the
 * path that wrote it, so both are accepted and everything else yields nothing.
 *
 * @param data - the event payload, viewed structurally.
 * @returns the collected text, possibly empty.
 */
function readUserText(data: Record<string, unknown>): string {
  const direct = data.content
  if (typeof direct === 'string') return direct
  if (!Array.isArray(direct)) {
    const text = data.text
    return typeof text === 'string' ? text : ''
  }
  const parts: string[] = []
  for (const block of direct) {
    const record = asRecord(block)
    if (record?.type !== 'text') continue
    if (typeof record.text !== 'string') continue
    parts.push(record.text)
  }
  return parts.join('\n')
}

/**
 * Translate one DSH session event into an internal event.
 *
 * Recognized kinds: `turn/start`, `step/start`, `assistant/message`,
 * `assistant/attempt`, `llm/retry`, `tool/call`, `tool/result`, `user/message`,
 * and `turn/end`. Everything else — including any turn-scoped kind whose `turn`
 * is missing or non-numeric — becomes `{ kind: 'other' }`. This function never
 * throws and never returns a live object.
 *
 * `step/start`, `assistant/attempt`, and `llm/retry` are translated because
 * turn-level token accounting has to know how many model calls a turn made and
 * which of them reported no usage (D017); without them, a retried call would be
 * invisible and the aggregate would be presented as if it covered the turn.
 *
 * @param event - the runtime event, viewed structurally.
 * @returns the internal event.
 */
export function toInternalEvent(event: SessionEventLike): InternalEvent {
  // The runtime always hands over an object, but an adapter that throws on a
  // malformed argument would violate its own contract, so the guard is here
  // rather than in the caller.
  if (typeof event !== 'object' || event === null) return { kind: 'other', type: 'unknown', timeMs: 0 }
  const type = typeof event.type === 'string' ? event.type : 'unknown'
  const timeMs = asNumber(event.time) ?? 0
  const seq = asNumber(event.seq)
  const data = asRecord(event.data)

  if (data === undefined) return { kind: 'other', type, timeMs }

  const turn = asNumber(data['turn'])
  const step = asNumber(data['step'])

  if (type === 'user/message') {
    // Handled before the turn guard: the runtime's own user-message payload has
    // no turn number, and the text is still worth collecting.
    return { kind: 'user-message', ...(turn !== undefined ? { turn } : {}), text: readUserText(data), timeMs }
  }

  if (turn === undefined) {
    // No usable turn number: report the type and omit the turn. Filing this
    // under turn 0 would fabricate a turn that never existed.
    return { kind: 'other', type, timeMs }
  }

  switch (type) {
    case 'turn/start':
      return { kind: 'turn-start', turn, timeMs }

    case 'step/start':
      return { kind: 'step-start', turn, step: step ?? 0, timeMs }

    case 'assistant/message': {
      const message = asRecord(data['message']) ?? {}
      // A copy, not the runtime's own array: nothing downstream may hold a
      // reference into `event.data`, which is frozen now but is the runtime's
      // object rather than ours.
      const blocks: readonly unknown[] = Array.isArray(message['content']) ? [...(message['content'] as unknown[])] : []
      const modelSource = readModelSource(message)
      const messageId = asString(message['id'])
      // `data.usage` first, then the stream's own usage record: the same order
      // the DSH token meter applies, so the two agree about which report is the
      // call's.
      const usage: RawUsage | undefined = collectUsage(data['usage']) ?? readStreamUsage(data['stream'])
      return {
        kind: 'assistant-message',
        turn,
        step: step ?? 0,
        ...(seq !== undefined ? { seq } : {}),
        blocks,
        ...(messageId !== undefined ? { messageId } : {}),
        ...(modelSource.provider !== undefined ? { provider: modelSource.provider } : {}),
        ...(modelSource.model !== undefined ? { model: modelSource.model } : {}),
        ...(usage !== undefined ? { usage } : {}),
        timeMs,
      }
    }

    case 'assistant/attempt': {
      // A model call that committed no surface message. Its own usage is only
      // ever present in the embedded stream; observed attempts carry none, and
      // an attempt without usage is an accountable call that reported nothing.
      const usage = readStreamUsage(data['stream'])
      return {
        kind: 'assistant-attempt',
        turn,
        step: step ?? 0,
        ...(seq !== undefined ? { seq } : {}),
        ...(usage !== undefined ? { usage } : {}),
        timeMs,
      }
    }

    case 'llm/retry':
      // One failed model call. The payload carries the failure identity and the
      // retry policy, never the failed call's usage, so this event is how the
      // turn learns that a call exists whose usage it cannot report.
      return { kind: 'llm-retry', turn, step: step ?? 0, ...(seq !== undefined ? { seq } : {}), timeMs }

    case 'tool/call': {
      // `name` is copied so the handler can exact-match it; `arguments` is
      // copied as one opaque string so the dedicated parser — and nothing else
      // — can decide whether it belongs to a question call. Neither field is
      // logged, and neither may be rendered (§12, §13).
      const name = asString(data['name'])
      const rawArguments = typeof data['arguments'] === 'string' ? data['arguments'] : undefined
      const callId = asString(data['callId'])
      return {
        kind: 'tool-call',
        turn,
        step: step ?? 0,
        ...(callId !== undefined ? { callId } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(rawArguments !== undefined ? { rawArguments } : {}),
        timeMs,
      }
    }

    case 'user/message': {
      // `UserMessage` is the whole payload, so the turn may be present or
      // absent depending on how the message reached the log; either way the
      // text is collected and the handler decides which turn owns it.
      const text = readUserText(data)
      return {
        kind: 'user-message',
        ...(turn !== undefined ? { turn } : {}),
        text,
        timeMs,
      }
    }

    case 'tool/result': {
      // The two runtime criteria are folded here so nothing downstream has to
      // know either path (D005). Both are checked; a single result counts once.
      const message = asRecord(data['message']) ?? {}
      const content = Array.isArray(message['content']) ? (message['content'] as unknown[]) : []
      const firstBlock = asRecord(content[0])
      const blockIsError = firstBlock?.['isError'] === true
      const errorRecord = asRecord(data['error'])
      const eventHasError = data['error'] !== undefined
      const explicitError = blockIsError || eventHasError
      const errorName = explicitError ? asString(errorRecord?.['name']) : undefined
      const errorCode = explicitError ? asString(errorRecord?.['code']) : undefined
      return {
        kind: 'tool-result',
        turn,
        step: step ?? 0,
        explicitError,
        ...(errorName !== undefined ? { errorName } : {}),
        ...(errorCode !== undefined ? { errorCode } : {}),
        timeMs,
      }
    }

    case 'turn/end': {
      const reason = data['reason']
      const reasonRecord = asRecord(reason)
      const turnEndKind: TurnEndKind = toTurnEndKind(reasonRecord?.['kind'])
      let detail: string | undefined
      let reasonDetail: string | undefined
      let failure: FailureFacts | undefined
      if (turnEndKind === 'aborted') {
        const described = describeAbort(reason)
        detail = described.detail
        reasonDetail = described.reasonDetail
      } else if (turnEndKind === 'error') {
        const described = describeError(reason)
        detail = described.detail
        reasonDetail = described.reasonDetail
        // Structural facts are read from the same `reason.error` object the
        // readable strings above come from, and read once, here: no other module
        // needs to know the DSH shape (architecture invariant one).
        //
        // This is the only place failure facts are produced. A recovered
        // `llm/retry` must never reach this branch, because the turn it belongs
        // to ends `completed` — a temporary request failure is not a terminal
        // turn failure (§4).
        failure = extractFailureFacts(reason)
      }
      return {
        kind: 'turn-end',
        turn,
        turnEndKind,
        ...(detail !== undefined ? { detail } : {}),
        ...(reasonDetail !== undefined ? { reasonDetail } : {}),
        ...(failure !== undefined ? { failure } : {}),
        timeMs,
      }
    }

    default:
      return { kind: 'other', type, turn, timeMs }
  }
}

/**
 * Whether an internal event carries a definite turn number worth accumulating.
 *
 * @param event - the internal event.
 * @returns true for the kinds that always update turn state.
 */
export function carriesTurn(event: InternalEvent): event is Extract<InternalEvent, { turn: number }> {
  return (
    event.kind === 'turn-start' ||
    event.kind === 'step-start' ||
    event.kind === 'assistant-message' ||
    event.kind === 'assistant-attempt' ||
    event.kind === 'llm-retry' ||
    event.kind === 'tool-call' ||
    event.kind === 'tool-result' ||
    event.kind === 'turn-end'
  )
}

/** One observed `approval/asked` audit event, reduced to safe scalars. */
export interface ApprovalObservation {
  sessionId: string
  notification: ApprovalNotification
}

/**
 * Adapt one `approval/asked` audit event.
 *
 * `approval/asked` is a durable, log-only audit record — the same class of event
 * as `hook/*`, carrying no `surfaceOp` — so observing it cannot claim, reorder,
 * or delay an answer. That is the whole reason it is the trigger here rather
 * than the `approval/request` waterfall, which is an answer-ownership chain
 * (§11, §20).
 *
 * The payload carries a request identity, a tool name, an optional exact call
 * id, and an optional asker reason — and, by the service's own design, never the
 * approved tool's arguments. This adapter copies those fields and nothing else,
 * so the safety property is inherited rather than re-established.
 *
 * @param session - the live session, viewed structurally.
 * @param data - the raw audit payload; its shape is not trusted.
 * @param observedAt - epoch ms at which the plugin observed the event.
 * @returns the observation, or `undefined` when no usable approval can be built.
 */
export function toApprovalObservation(
  session: SessionLike,
  data: unknown,
  observedAt: number,
): ApprovalObservation | undefined {
  const facts = toSessionFacts(session)
  const notification = toApprovalNotification(data, facts.sessionId, facts.cwd, observedAt)
  if (notification === undefined) return undefined
  return { sessionId: facts.sessionId, notification }
}
