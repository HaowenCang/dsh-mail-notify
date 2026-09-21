/**
 * Desensitized runtime shapes for adapter and pipeline tests.
 *
 * Every shape here is copied from the field paths and value patterns recorded in
 * `PHASE1_RUNTIME_CONTRACT.md` and observed by the Phase 1 prototype, not
 * invented to make a type checker happy. The details that matter are the ones
 * that are easy to get wrong from a declaration file alone:
 *
 * - a `tool/result` message's `content` is a single-element tuple, and
 *   `isError` is *absent* on success rather than `false`;
 * - `turn/end` has exactly six reason kinds;
 * - an assistant message mixes `reasoning`, `text`, and `tool-call` blocks;
 * - a top-level session may carry `delegationDepth: 0`;
 * - `usage` may omit optional counters entirely.
 *
 * Secret-bearing content is deliberately synthetic. The sentinels below are the
 * strings the privacy tests search for, so a future field added to a candidate
 * or a log line would fail those tests rather than leak quietly.
 *
 * @module dsh-mail-notify/tests/fixtures
 */

import type { SessionEventLike, SessionLike } from '../../src/runtime-adapter.ts'

/** Injected into reasoning text; must never appear in mail or logs. */
export const REASONING_SECRET_SENTINEL = 'REASONING_SECRET_SENTINEL'
/** Injected into tool arguments; must never appear in mail or logs. */
export const TOOL_ARGUMENT_SECRET_SENTINEL = 'TOOL_ARGUMENT_SECRET_SENTINEL'
/** Injected into a tool result body; must never appear in mail or logs. */
export const TOOL_RESULT_SECRET_SENTINEL = 'TOOL_RESULT_SECRET_SENTINEL'
/** A synthetic SMTP password. Not a real credential and never a real one. */
export const SMTP_PASSWORD_SENTINEL = 'SMTP_PASSWORD_SENTINEL-not-a-real-password'
/** Injected into a system-message payload; must never appear in mail or logs. */
export const SYSTEM_PROMPT_SENTINEL = 'SYSTEM_PROMPT_SENTINEL'
/** Injected into a user message; must not be sent unless explicitly enabled. */
export const USER_PROMPT_SENTINEL = 'USER_PROMPT_SENTINEL'

/**
 * The session `cwd` used by every fixture here.
 *
 * Synthetic on purpose: a fixture must not pin the machine a test happened to
 * run on, and a real workspace path in a tracked test is an environment leak
 * even when it carries no secret. The adapter and the renderer treat `cwd` as
 * opaque text, so any Windows-shaped absolute path exercises the same code.
 */
export const TEST_SESSION_CWD = 'C:\\workspace\\project'

/** Build a `SessionLike` header with the given overrides. */
export function sessionHeader(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    id: 'session-3f0c2938-3769-471e-b2bf-12badadde842',
    createdAt: 1_750_000_000_000,
    cwd: TEST_SESSION_CWD,
    isSeeded: false,
    agentPreset: 'standard',
    ...overrides,
  }
}

/** A top-level session: `origin`/`parentSession` absent, `delegationDepth: 0`. */
export function rootSession(id = 'session-3f0c2938-3769-471e-b2bf-12badadde842'): SessionLike {
  return { id, header: sessionHeader({ id, origin: null, parentSession: null, delegationDepth: 0 }) }
}

/** A top-level session whose optional metadata is entirely absent. */
export function bareRootSession(id = 'session-bare'): SessionLike {
  const header = sessionHeader({ id })
  delete header['cwd']
  delete header['agentPreset']
  return { id, header }
}

/** A subagent session, as observed: all three criteria present. */
export function subagentSession(id = 'session-08062578-254d-4051-a7cf-dc329d334fb1'): SessionLike {
  return {
    id,
    header: sessionHeader({
      id,
      origin: 'subagent',
      parentSession: 'session-3f0c2938-3769-471e-b2bf-12badadde842',
      delegationDepth: 1,
    }),
  }
}

/** A session identified as a subagent only by `parentSession`. */
export function parentOnlySubagent(id = 'session-parent-only'): SessionLike {
  return { id, header: sessionHeader({ id, parentSession: 'session-x' }) }
}

/** A session identified as a subagent only by a positive `delegationDepth`. */
export function depthOnlySubagent(id = 'session-depth-only', depth = 1): SessionLike {
  return { id, header: sessionHeader({ id, delegationDepth: depth }) }
}

/** A `turn/start` event. */
export function turnStart(turn: number, time: number): SessionEventLike {
  return { type: 'turn/start', seq: turn * 100, time, data: { turn } }
}

/** An `assistant/message` event. */
export function assistantMessage(input: {
  turn: number
  step: number
  time: number
  content: readonly unknown[]
  id?: string
  provider?: string
  model?: string
  usage?: Record<string, unknown>
  /** Durable sequence number; the settlement identity the fold dedupes on. */
  seq?: number
  /** Raw stream records, for the usage-in-stream compatibility path. */
  stream?: readonly unknown[]
}): SessionEventLike {
  const message: Record<string, unknown> = {
    role: 'assistant',
    id: input.id ?? `message-${input.turn}-${input.step}`,
    content: input.content,
    source: { kind: 'model', provider: input.provider ?? 'deepseek-official', model: input.model ?? 'deepseek-chat' },
  }
  const data: Record<string, unknown> = {
    turn: input.turn,
    step: input.step,
    message,
    // A copy when the caller passed an array — nothing downstream may hold a
    // reference into the fixture — and the value itself otherwise, so a test can
    // also present a malformed stream and assert the adapter survives it.
    stream: Array.isArray(input.stream) ? [...input.stream] : (input.stream ?? []),
  }
  if (input.usage !== undefined) data['usage'] = input.usage
  return { type: 'assistant/message', seq: input.seq ?? input.turn * 100 + input.step, time: input.time, data }
}

/**
 * An `assistant/attempt` event: a model call that committed no surface message.
 *
 * Observed 83 times across 858 real session logs; none of them carried a usage
 * record in its stream.
 */
export function assistantAttempt(input: {
  turn: number
  step: number
  time: number
  seq?: number
  /** Raw stream records; the only place an attempt's usage could appear. */
  stream?: unknown
}): SessionEventLike {
  return {
    type: 'assistant/attempt',
    seq: input.seq ?? input.turn * 1000 + input.step * 10 + 1,
    time: input.time,
    data: {
      turn: input.turn,
      step: input.step,
      stream: Array.isArray(input.stream) ? [...input.stream] : (input.stream ?? []),
    },
  }
}

/**
 * An `llm/retry` event: the durable record of one failed model call.
 *
 * The payload names the failure and the retry policy and never carries the
 * failed call's usage, which is why a retry makes a turn's usage incomplete.
 */
export function llmRetry(turn: number, step: number, time: number, seq = turn * 1000 + step * 10 + 2): SessionEventLike {
  return {
    type: 'llm/retry',
    seq,
    time,
    data: {
      retryId: `retry-${turn}-${step}-${seq}`,
      turn,
      step,
      provider: 'deepseek-official',
      mode: 'normal',
      policyKey: 'default',
      retry: 1,
      maxRetries: 3,
      delayMs: 500,
      failure: { kind: 'error', message: 'upstream unavailable', code: 'LLM_UNAVAILABLE' },
    },
  }
}

/**
 * An `llm/retry-started` event: the transition written after the retry wait.
 *
 * It is deliberately not accumulated. The failed call it follows is already
 * accounted at `llm/retry`, and the attempt that replaces it settles through
 * its own `assistant/message` or `assistant/attempt`.
 */
export function llmRetryStarted(turn: number, step: number, time: number, seq = turn * 1000 + step * 10 + 3): SessionEventLike {
  return { type: 'llm/retry-started', seq, time, data: { retryId: `retry-${turn}-${step}`, turn, step, retry: 1 } }
}

/** A usage record in a stream, as the compacted record an attempt would embed. */
export function streamUsageRecord(usage: Record<string, unknown>): Record<string, unknown> {
  return { type: 'chunk', time: 1_750_000_000_000, chunk: { type: 'usage', usage } }
}

/** A `tool/call` event. */
export function toolCall(turn: number, step: number, time: number, name = 'pwsh', args = '{"command":"echo"}'): SessionEventLike {
  return {
    type: 'tool/call',
    seq: turn * 100 + step,
    time,
    data: { turn, step, callId: `call-${turn}-${step}`, name, arguments: args },
  }
}

/** A successful `tool/result`: `isError` absent, no `error` field. */
export function toolResultOk(turn: number, step: number, time: number, text = 'ok'): SessionEventLike {
  return {
    type: 'tool/result',
    seq: turn * 100 + step,
    time,
    data: {
      turn,
      step,
      message: {
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: `call-${turn}-${step}`, content: [{ type: 'text', text }] }],
        source: { kind: 'tool', callId: `call-${turn}-${step}` },
      },
    },
  }
}

/** A failed `tool/result` carrying the block-level marker (criterion A). */
export function toolResultBlockError(turn: number, step: number, time: number): SessionEventLike {
  return {
    type: 'tool/result',
    seq: turn * 100 + step,
    time,
    data: {
      turn,
      step,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool-result',
            toolCallId: `call-${turn}-${step}`,
            isError: true,
            content: [{ type: 'text', text: TOOL_RESULT_SECRET_SENTINEL }],
          },
        ],
        source: { kind: 'tool', callId: `call-${turn}-${step}` },
      },
    },
  }
}

/** A failed `tool/result` carrying only the event-level error (criterion B). */
export function toolResultEventError(turn: number, step: number, time: number): SessionEventLike {
  const event = toolResultOk(turn, step, time, TOOL_RESULT_SECRET_SENTINEL)
  ;(event.data as Record<string, unknown>)['error'] = { name: 'FsError', code: 'FS_NOT_FOUND' }
  return event
}

/** A successful `tool/result` whose text carries a non-zero shell exit code. */
export function toolResultNonZeroExit(turn: number, step: number, time: number): SessionEventLike {
  return toolResultOk(turn, step, time, 'command output\n[exit code: 1]')
}

/** A `turn/end` event. */
export function turnEnd(turn: number, time: number, reason: Record<string, unknown> = { kind: 'completed' }): SessionEventLike {
  return { type: 'turn/end', seq: turn * 100 + 99, time, data: { turn, reason } }
}

/** The six confirmed `turn/end` reasons, plus one unconfirmed kind. */
export const TURN_END_REASONS: Readonly<Record<string, Record<string, unknown>>> = {
  completed: { kind: 'completed' },
  'max-tokens': { kind: 'max-tokens' },
  error: { kind: 'error', error: { message: 'upstream unavailable', code: 'LLM_UNAVAILABLE', status: 503 } },
  aborted: { kind: 'aborted', reason: { kind: 'user' } },
  'aborted-hook': { kind: 'aborted', reason: { kind: 'hook', reason: 'budget exceeded' } },
  blocked: { kind: 'blocked' },
  interrupted: { kind: 'interrupted' },
  future: { kind: 'future-kind' },
}

/** A mixed assistant message: reasoning, text, and two tool calls. */
export function mixedAssistantMessage(turn: number, step: number, time: number, text: string): SessionEventLike {
  return assistantMessage({
    turn,
    step,
    time,
    content: [
      { type: 'reasoning', text: `${REASONING_SECRET_SENTINEL} thinking about the task` },
      { type: 'text', text },
      { type: 'tool-call', id: 'call-a', name: 'pwsh', arguments: `{"command":"${TOOL_ARGUMENT_SECRET_SENTINEL}"}` },
      { type: 'tool-call', id: 'call-b', name: 'read', arguments: `{"path":"${TOOL_ARGUMENT_SECRET_SENTINEL}"}` },
    ],
  })
}

/** A reasoning-only assistant message: no visible text at all. */
export function reasoningOnlyMessage(turn: number, step: number, time: number): SessionEventLike {
  return assistantMessage({
    turn,
    step,
    time,
    content: [{ type: 'reasoning', text: `${REASONING_SECRET_SENTINEL} still thinking` }],
  })
}

/** A `user/message` event, whose payload is the user message itself. */
export function userMessage(text: string, time = 1_750_000_000_100): SessionEventLike {
  return {
    type: 'user/message',
    seq: 5,
    time,
    data: { role: 'user', id: 'message-user-1', content: [{ type: 'text', text }], source: { kind: 'user' } },
  }
}

/** A `system/message` event, used to prove system prompts stay out of output. */
export function systemMessage(turn: number, step: number, time: number): SessionEventLike {
  return {
    type: 'system/message',
    seq: 6,
    time,
    data: {
      turn,
      step,
      message: { role: 'system', id: 'message-system-1', content: [{ type: 'text', text: SYSTEM_PROMPT_SENTINEL }] },
    },
  }
}

/** A `step/start` event; carries a turn and step but no counters. */
export function stepStart(turn: number, step: number, time: number): SessionEventLike {
  return { type: 'step/start', seq: turn * 100 + step, time, data: { turn, step } }
}

/**
 * The `usage` object Phase 1 actually read from a live turn.
 *
 * `reasoningTokens` is absent, not `undefined`-valued. `inputTokens: 255`
 * against `totalTokens: 187638` is the recorded inconsistency, kept verbatim on
 * purpose: nothing in this plugin may "fix" it.
 */
export const OBSERVED_USAGE: Readonly<Record<string, number>> = {
  inputTokens: 255,
  outputTokens: 759,
  totalTokens: 187638,
  cacheReadTokens: 186624,
}

/**
 * The two per-call usage shapes real providers emit inside one turn.
 *
 * Taken from the recorded tuple log of a real multi-step turn in this project
 * (`session-4322f6f0`, turn 1):
 *
 * - `deepseek-official` always reports `cacheReadTokens` and `totalTokens`,
 *   including when nothing was cached, and adds `reasoningTokens` only on calls
 *   that reasoned;
 * - a route with no cache in play reports the required pair only, so a bucket's
 *   absence there means "this call had none", not "this call was not counted".
 *
 * Both are kept as recorded. Nothing in the plugin may reconcile them.
 */
export const DEEPSEEK_CALL_USAGE: Readonly<Record<string, number>> = {
  inputTokens: 5954,
  outputTokens: 489,
  totalTokens: 36907,
  cacheReadTokens: 30464,
}

/** A call whose provider reported no cache bucket at all. */
export const UNCACHED_CALL_USAGE: Readonly<Record<string, number>> = {
  inputTokens: 3661,
  outputTokens: 60,
}

/** A call that reported a reasoning subset of its output. */
export const REASONING_CALL_USAGE: Readonly<Record<string, number>> = {
  inputTokens: 1425,
  outputTokens: 252,
  totalTokens: 57741,
  cacheReadTokens: 56064,
  reasoningTokens: 180,
}

/**
 * A three-call turn's events, as the runtime orders them.
 *
 * The shape is the one every real turn observed so far uses: `step/start`,
 * `assistant/message` with `usage`, its `tool/call`s and `tool/result`s, then
 * `step/end`. It exists so the multi-step fold is tested against the runtime's
 * order rather than against a single message.
 *
 * @param turn - the turn number.
 * @param usages - one usage record per step; the chain length follows it.
 * @param baseTime - the `turn/start` time; each step advances it by 3 000 ms.
 * @returns the event sequence, in delivery order.
 */
export function multiStepTurnChain(
  turn: number,
  usages: readonly Record<string, unknown>[],
  baseTime = 1_750_000_000_000,
): SessionEventLike[] {
  const events: SessionEventLike[] = [turnStart(turn, baseTime)]
  let seq = turn * 1000
  usages.forEach((usage, index) => {
    const step = index + 1
    const stepTime = baseTime + step * 3_000
    const callId = `call-${turn}-${step}`
    events.push({ type: 'step/start', seq: (seq += 1), time: stepTime - 20, data: { turn, step } })
    events.push(
      assistantMessage({
        turn,
        step,
        time: stepTime,
        seq: (seq += 1),
        content: [{ type: 'text', text: index === usages.length - 1 ? 'the final answer' : `step ${step} text` }],
        usage: { ...usage },
      }),
    )
    // Built inline rather than through the single-event helpers so every
    // sequence number in the chain is distinct, as the durable log's are.
    events.push({
      type: 'tool/call',
      seq: (seq += 1),
      time: stepTime + 5,
      data: { turn, step, callId, name: 'pwsh', arguments: '{"command":"echo"}' },
    })
    events.push({
      type: 'tool/result',
      seq: (seq += 1),
      time: stepTime + 900,
      data: {
        turn,
        step,
        message: {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'ok' }] }],
          source: { kind: 'tool', callId },
        },
      },
    })
    events.push({ type: 'step/end', seq: (seq += 1), time: stepTime + 1_000, data: { turn, step } })
  })
  events.push(turnEnd(turn, baseTime + usages.length * 3_000 + 2_000))
  return events
}

/**
 * The complete event chain of one healthy top-level turn.
 *
 * @param turn - the turn number.
 * @param text - the final visible answer.
 * @param options - whether to include a tool error and a tool call.
 * @returns the event sequence, in delivery order.
 */
export function healthyTurnChain(
  turn: number,
  text: string,
  options: { toolError?: boolean; reason?: Record<string, unknown> } = {},
): SessionEventLike[] {
  const base = 1_750_000_000_000 + turn * 10_000
  const events: SessionEventLike[] = [
    turnStart(turn, base),
    stepStart(turn, 1, base + 10),
    mixedAssistantMessage(turn, 1, base + 20, text),
    toolCall(turn, 1, base + 30),
    options.toolError === true ? toolResultBlockError(turn, 1, base + 40) : toolResultOk(turn, 1, base + 40),
    stepStart(turn, 2, base + 50),
    assistantMessage({
      turn,
      step: 2,
      time: base + 60,
      content: [{ type: 'text', text }],
      usage: { ...OBSERVED_USAGE },
    }),
  ]
  events.push(turnEnd(turn, base + 70, options.reason ?? { kind: 'completed' }))
  return events
}
