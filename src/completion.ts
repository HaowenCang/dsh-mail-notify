/**
 * Completion classification: `turnEndKind` plus the explicit tool error count
 * yields a `CandidateStatus`, together with the two optional detail strings.
 *
 * `usage` is deliberately absent from this module's inputs. Token counters
 * never influence whether a turn completed, whether it failed, or whether it
 * is notified (D006).
 *
 * @module dsh-mail-notify/completion
 */

import type { CandidateStatus, TurnEndKind } from './types.ts'

/** Longest `reasonDetail` retained; provider text is untrusted input. */
export const REASON_DETAIL_LIMIT = 500

/** The six confirmed `turn/end` reason kinds. */
const CONFIRMED_KINDS: readonly string[] = [
  'completed',
  'max-tokens',
  'error',
  'aborted',
  'blocked',
  'interrupted',
]

/**
 * Narrow a runtime string to a confirmed `TurnEndKind`.
 *
 * @param value - the runtime `reason.kind` value.
 * @returns the confirmed kind, or `'unknown'` for anything else.
 */
export function toTurnEndKind(value: unknown): TurnEndKind {
  if (typeof value !== 'string') return 'unknown'
  return (CONFIRMED_KINDS as readonly TurnEndKind[]).includes(value as TurnEndKind)
    ? (value as TurnEndKind)
    : 'unknown'
}

/**
 * Strip control characters and bound the length of untrusted text.
 *
 * Newlines and tabs become spaces rather than disappearing, so log lines and
 * mail headers cannot be forged from provider-supplied text.
 *
 * @param value - untrusted text.
 * @param limit - inclusive maximum length in code points.
 * @returns the sanitized text, or `undefined` when nothing usable remains.
 */
export function sanitizeDetail(value: unknown, limit: number = REASON_DETAIL_LIMIT): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  if (cleaned === '') return undefined
  return Array.from(cleaned).slice(0, limit).join('')
}

/**
 * Classify one completed turn.
 *
 * @param turnEndKind - the narrowed `turn/end` reason.
 * @param explicitToolErrorCount - DSH-reported tool failures in this turn.
 * @returns the candidate status.
 */
export function classifyCompletion(
  turnEndKind: TurnEndKind,
  explicitToolErrorCount: number,
): CandidateStatus {
  switch (turnEndKind) {
    case 'completed':
      return explicitToolErrorCount > 0 ? 'completed-with-tool-errors' : 'completed-clean'
    case 'max-tokens':
      return 'max-tokens'
    case 'error':
      return 'error'
    case 'aborted':
      return 'aborted'
    case 'blocked':
      return 'blocked'
    case 'interrupted':
      return 'interrupted'
    default:
      // A kind outside the confirmed set is a normal forward-compatibility
      // event, not an exception: classify defensively and let policy suppress.
      return 'unknown'
  }
}

/** Human-readable description of an abort cause kind. */
const ABORT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  user: 'the user cancelled the turn',
  parent: 'the delegating agent cancelled the turn',
  hook: 'a hook cancelled the turn',
  disposed: 'the owning agent was disposed',
  legacy: 'the turn was cancelled by an unidentified cause',
}

/**
 * Parse the `aborted` detail out of the runtime reason.
 *
 * The runtime shape is `{ kind: 'aborted', reason: AgentCancelCause | { kind: 'legacy' } }`,
 * where the `hook` branch additionally carries a `reason` string.
 *
 * @param reason - the raw `turn/end.reason` value.
 * @returns the cause kind and a readable description, both optional.
 */
export function describeAbort(reason: unknown): { detail?: string; reasonDetail?: string } {
  if (typeof reason !== 'object' || reason === null) return {}
  const cause = (reason as { reason?: unknown }).reason
  if (typeof cause !== 'object' || cause === null) return {}
  const kind = (cause as { kind?: unknown }).kind
  if (typeof kind !== 'string' || kind === '') return {}
  const hookNote = sanitizeDetail((cause as { reason?: unknown }).reason, 200)
  const base = ABORT_DESCRIPTIONS[kind] ?? `the turn was cancelled (${kind})`
  return {
    detail: kind,
    reasonDetail: hookNote === undefined ? base : `${base}: ${hookNote}`,
  }
}

/**
 * Parse the `error` detail out of the runtime reason.
 *
 * The runtime shape is `{ kind: 'error', error: LlmFailure }` with
 * `LlmFailure = { message, code, status?, ... }`. The message originates from
 * the provider; it carries no SMTP credential, but it is still treated as
 * untrusted text and is both sanitized and bounded.
 *
 * @param reason - the raw `turn/end.reason` value.
 * @returns the provider error code and a cleaned message, both optional.
 */
export function describeError(reason: unknown): { detail?: string; reasonDetail?: string } {
  if (typeof reason !== 'object' || reason === null) return {}
  const failure = (reason as { error?: unknown }).error
  if (typeof failure !== 'object' || failure === null) return {}
  const code = sanitizeDetail((failure as { code?: unknown }).code, 120)
  const message = sanitizeDetail((failure as { message?: unknown }).message, REASON_DETAIL_LIMIT)
  const out: { detail?: string; reasonDetail?: string } = {}
  if (code !== undefined) out.detail = code
  if (message !== undefined) out.reasonDetail = message
  return out
}
