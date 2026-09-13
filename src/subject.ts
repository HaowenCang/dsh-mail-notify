/**
 * Email subject and body rendering.
 *
 * Both are pure functions of a candidate and the resolved configuration: the
 * renderer never reads turn state, never touches the runtime, and never asks
 * the network anything. Everything that reaches a header passes through
 * {@link sanitizeLine} first, because `model` and other provider-supplied
 * fields are untrusted text and a raw `\n` in a subject is a header-injection
 * primitive.
 *
 * @module dsh-mail-notify/subject
 */

import { TRUNCATION_MARKER } from './content.ts'
import type { CandidateStatus, NotificationCandidate, RenderConfig, TurnEndKind } from './types.ts'

/** Inclusive subject length limit, counted before any ellipsis. */
export const SUBJECT_MAX_CHARS = 200

const ELLIPSIS = '…'

/** Human-readable label for each status; never claims more than was observed. */
const STATUS_LABELS: Readonly<Record<CandidateStatus, string>> = {
  'completed-clean': 'Task completed',
  'completed-with-tool-errors': 'Task completed with tool errors',
  'max-tokens': 'Task stopped at max tokens',
  error: 'Task failed',
  aborted: 'Task aborted',
  blocked: 'Task blocked',
  interrupted: 'Task interrupted',
  unknown: 'Task ended (unrecognised reason)',
}

/**
 * Remove CR/LF and other control characters, then bound the length.
 *
 * @param value - untrusted text.
 * @param maxChars - inclusive maximum length in code points.
 * @returns a single-line string, never containing CR or LF.
 */
export function sanitizeLine(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return ''
  const flat = value.replace(/[\r\n\u2028\u2029\u0000-\u001f\u007f]+/g, ' ').trim()
  const points = Array.from(flat)
  if (points.length <= maxChars) return flat
  return `${points.slice(0, Math.max(0, maxChars - 1)).join('')}${ELLIPSIS}`
}

/**
 * Render the subject line for one candidate.
 *
 * The status prefix is written first and the model name is appended only if the
 * budget allows, so truncation can lengthen a subject but can never hide the
 * completion status.
 *
 * @param candidate - the notification candidate.
 * @returns a single-line subject of at most {@link SUBJECT_MAX_CHARS} characters.
 */
export function renderSubject(candidate: NotificationCandidate): string {
  const label = STATUS_LABELS[candidate.status]
  const prefix = `[DSH] ${label}`
  const model = sanitizeLine(candidate.model, 80)
  if (model === '') return sanitizeLine(prefix, SUBJECT_MAX_CHARS)
  const withModel = `${prefix} — ${model}`
  if (Array.from(withModel).length <= SUBJECT_MAX_CHARS) return withModel
  return `${sanitizeLine(prefix, SUBJECT_MAX_CHARS - 1)}${ELLIPSIS}`
}

/** Format a duration in the metadata header. */
function formatDuration(candidate: NotificationCandidate): string {
  if (candidate.durationMs === null || candidate.durationMs === undefined) {
    return 'unknown (plugin attached mid-turn)'
  }
  const ms = candidate.durationMs
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`
}

/** The five foldable counters, in the order the mail states them. */
const USAGE_BUCKETS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const

/**
 * Render the turn's token aggregate.
 *
 * The label says "turn aggregate" because that is what the value is; the
 * previous "as reported" label described a single raw sample and invited the
 * reader to take the last model call for the whole turn (D017). Every bucket is
 * named, and a bucket no call reported is stated as unreported rather than
 * printed as `0`, which would be a claim the runtime never made.
 *
 * @param candidate - the notification candidate.
 * @returns one line, without a trailing newline.
 */
function formatUsage(candidate: NotificationCandidate): string {
  const usage = candidate.usage
  const label = 'Token usage (turn aggregate):'
  if (usage === undefined) return `${label} none observed`
  const parts = USAGE_BUCKETS.map((bucket) => {
    const value = usage[bucket]
    return typeof value === 'number' ? `${bucket}=${value}` : `${bucket}=not reported`
  })
  return `${label} ${parts.join(', ')}`
}

/**
 * State how much of the turn's token telemetry was actually observed.
 *
 * `usageComplete` and `telemetryComplete` are different claims and are rendered
 * separately: the first is about every accountable model call reporting usage,
 * the second only about the plugin having seen the turn from its start.
 *
 * @param candidate - the notification candidate.
 * @returns one line, without a trailing newline.
 */
function formatUsageCompleteness(candidate: NotificationCandidate): string {
  const label = 'Token telemetry complete:'
  if (candidate.usageComplete) {
    const calls = candidate.usageSampleCount === 1 ? '1 model call' : `${candidate.usageSampleCount} model calls`
    return `${label} yes (${calls} observed, each reporting usage)`
  }
  const gaps: string[] = []
  if (candidate.usageMissingCount > 0) {
    const calls = candidate.usageMissingCount === 1 ? '1 model call' : `${candidate.usageMissingCount} model calls`
    gaps.push(`${calls} without a usable usage report`)
  }
  if (candidate.usageUnobservableRetries > 0) {
    const retries =
      candidate.usageUnobservableRetries === 1 ? '1 retried model call' : `${candidate.usageUnobservableRetries} retried model calls`
    gaps.push(`${retries} whose usage was not reported`)
  }
  if (gaps.length === 0) gaps.push('the turn was not observed from its start')
  return `${label} no (${gaps.join('; ')})`
}

/**
 * Render the metadata block of the body.
 *
 * @param candidate - the notification candidate.
 * @returns one line per fact, without a trailing newline.
 */
export function renderMetadata(candidate: NotificationCandidate): string {
  const lines: string[] = [`Status:    ${STATUS_LABELS[candidate.status]} (${candidate.status})`]
  lines.push(`Session:   ${sanitizeLine(candidate.sessionId, 120)}`)
  lines.push(`Turn:      ${candidate.turn}`)
  lines.push(`Duration:  ${formatDuration(candidate)}`)
  if (candidate.provider !== undefined) lines.push(`Provider:  ${sanitizeLine(candidate.provider, 80)}`)
  if (candidate.model !== undefined) lines.push(`Model:     ${sanitizeLine(candidate.model, 80)}`)
  if (candidate.cwd !== undefined) lines.push(`Workspace: ${sanitizeLine(candidate.cwd, 240)}`)
  lines.push(`Tool errors reported by DSH: ${candidate.explicitToolErrorCount}`)
  lines.push(`Telemetry complete: ${candidate.telemetryComplete ? 'yes' : 'no (plugin attached mid-turn)'}`)
  lines.push(formatUsage(candidate))
  lines.push(formatUsageCompleteness(candidate))
  if (candidate.turnEndDetail !== undefined) {
    lines.push(`Turn end detail: ${sanitizeLine(candidate.turnEndDetail, 120)}`)
  }
  if (candidate.reasonDetail !== undefined) {
    lines.push(`Reason:    ${sanitizeLine(candidate.reasonDetail, 500)}`)
  }
  return lines.join('\n')
}

/**
 * Render a footer note explaining what the message is and what it omits.
 *
 * @param truncated - whether the visible text was cut.
 * @param droppedFields - configuration fields that could not be read.
 * @returns the footer lines, or `''` when there is nothing to state.
 */
export function renderFooter(truncated: boolean, droppedFields: readonly string[]): string {
  const lines: string[] = []
  if (truncated) lines.push(TRUNCATION_MARKER)
  lines.push('Sent by dsh-mail-notify; body contains the model’s final visible output and the metadata above.')
  lines.push('Reasoning, tool arguments, tool results, and the user prompt are never included.')
  if (droppedFields.length > 0) {
    lines.push(`Unrecognised configuration fields were ignored: ${droppedFields.join(', ')}`)
  }
  return lines.join('\n')
}

/** Everything the body renderer needs beyond the candidate. */
export interface RenderInput {
  candidate: NotificationCandidate
  render: RenderConfig
  /** Whether the visible text was cut to fit `maxBodyChars`. */
  truncated: boolean
  /** Configuration keys the loader did not recognise; reported, never applied. */
  droppedFields?: readonly string[]
}

/** The rendered message parts. */
export interface RenderedMail {
  subject: string
  text: string
  /** The exact number of visible-text characters that reached the body. */
  bodyTextLength: number
}

/**
 * Render the complete plain-text message.
 *
 * Only three things may appear: the final visible assistant text, the metadata
 * block when `includeMetadata` is on, and the footer when `includeFooter` is
 * on. Reasoning text, tool arguments, tool results, the system prompt, and
 * credentials have no path into this function at all.
 *
 * @param input - the candidate and the render switches.
 * @returns the subject and body.
 */
export function renderMail(input: RenderInput): RenderedMail {
  const { candidate, render } = input
  const sections: string[] = []

  if (render.includeMetadata) sections.push(renderMetadata(candidate))
  if (render.includeUserPrompt && candidate.userText !== undefined && candidate.userText.trim() !== '') {
    sections.push(`--- User prompt ---\n${candidate.userText}`)
  }

  const body = candidate.visibleText
  sections.push(body === '' ? '' : body)

  if (render.includeFooter) {
    sections.push(renderFooter(input.truncated, input.droppedFields ?? []))
  } else if (input.truncated) {
    // The footer switch hides the marker from the message, but the fact stays
    // observable in the structured log. Silent truncation is never introduced.
    sections.push('')
  }

  const text = sections.join('\n\n').replace(/\n{4,}/g, '\n\n\n')
  return { subject: renderSubject(candidate), text, bodyTextLength: Array.from(body).length }
}

/**
 * The plain, human-readable meaning of one status, for logs and documentation.
 *
 * @param status - the candidate status.
 * @returns the status label.
 */
export function statusLabel(status: CandidateStatus): string {
  return STATUS_LABELS[status]
}

/**
 * The status families the policy switches address.
 *
 * @param status - the candidate status.
 * @returns which policy switch governs this status, or `undefined` when no
 *   switch exists and the status is therefore always suppressed.
 */
export function policySwitchFor(status: CandidateStatus): 'completed' | 'error' | 'max-tokens' | undefined {
  if (status === 'completed-clean' || status === 'completed-with-tool-errors') return 'completed'
  if (status === 'error') return 'error'
  if (status === 'max-tokens') return 'max-tokens'
  return undefined
}

/**
 * Whether one turn-end kind is worth reporting at all, ignoring configuration.
 *
 * @param kind - the turn end kind.
 * @returns true for the three kinds that carry a deliverable final answer.
 */
export function isNotifiableKind(kind: TurnEndKind): boolean {
  return kind === 'completed' || kind === 'error' || kind === 'max-tokens'
}
