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
import type {
  ApprovalNotification,
  CandidateStatus,
  Notification,
  NotificationCandidate,
  QuestionNotification,
  RenderConfig,
  TurnEndKind,
  TurnNotification,
} from './types.ts'

/** Inclusive subject length limit, counted before any ellipsis. */
export const SUBJECT_MAX_CHARS = 200

const ELLIPSIS = '…'

/**
 * Subject prefix for a question the agent is blocked on.
 *
 * A constant, so no part of a model-supplied string can decide whether a
 * message reads as an instruction from the plugin.
 */
export const QUESTION_SUBJECT_PREFIX = '[DSH] Input required'

/** Subject prefix for an approval the agent is blocked on. */
export const APPROVAL_SUBJECT_PREFIX = '[DSH] Approval required'

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
 * Render the subject line for one settled turn.
 *
 * The status prefix is written first and the model name is appended only if the
 * budget allows, so truncation can lengthen a subject but can never hide the
 * completion status.
 *
 * A terminal failure states its structured code — and its HTTP status when the
 * provider reported one, which is the single most useful routing fact an
 * operator can see before opening the message:
 *
 * ```text
 * [DSH] Task failed — QUOTA (429)
 * ```
 *
 * @param candidate - the notification candidate.
 * @returns a single-line subject of at most {@link SUBJECT_MAX_CHARS} characters.
 */
export function renderSubject(candidate: NotificationCandidate): string {
  const label = STATUS_LABELS[candidate.status]
  const prefix = `[DSH] ${label}`
  const model = sanitizeLine(candidate.model, 80)

  if (candidate.status === 'error') {
    return assembleSubject(prefix, failureSubjectTag(candidate), model)
  }

  if (model === '') return sanitizeLine(prefix, SUBJECT_MAX_CHARS)
  const withModel = `${prefix} — ${model}`
  if (Array.from(withModel).length <= SUBJECT_MAX_CHARS) return withModel
  return `${sanitizeLine(prefix, SUBJECT_MAX_CHARS - 1)}${ELLIPSIS}`
}

/**
 * The `CODE (status)` tag of a failure subject, or `''` when nothing is known.
 *
 * @param candidate - the notification candidate.
 * @returns the tag, already sanitized, or an empty string.
 */
function failureSubjectTag(candidate: NotificationCandidate): string {
  const failure = candidate.failure
  if (failure === undefined) return ''
  const code = sanitizeLine(failure.code, 60)
  if (code === '') return ''
  if (failure.status === undefined) return code
  return `${code} (${failure.status})`
}

/**
 * Join prefix, optional tag, and optional tail without ever truncating the
 * prefix away.
 *
 * @param prefix - the constant, status-bearing prefix.
 * @param tag - the higher-priority optional part.
 * @param tail - the lower-priority optional part.
 * @returns the assembled single-line subject.
 */
function assembleSubject(prefix: string, tag: string, tail: string): string {
  const safePrefix = sanitizeLine(prefix, SUBJECT_MAX_CHARS)
  const parts = [safePrefix]
  if (tag !== '') parts.push(sanitizeLine(tag, 80))
  if (tail !== '') parts.push(tail)
  const composed = parts.join(' — ')
  if (Array.from(composed).length <= SUBJECT_MAX_CHARS) return composed

  // The budget ran out: keep the prefix and the tag, drop the model name.
  const shortened = tag === '' ? safePrefix : `${safePrefix} — ${sanitizeLine(tag, 80)}`
  if (Array.from(shortened).length <= SUBJECT_MAX_CHARS) return shortened
  return `${safePrefix.slice(0, Math.max(0, SUBJECT_MAX_CHARS - 1))}${ELLIPSIS}`
}

/**
 * Render the subject line for one human-attention notification.
 *
 * The shape is `PREFIX — <label>`, where the label is a question header or the
 * exact tool awaiting approval. Both are untrusted text and pass through
 * {@link sanitizeLine}, so no CR or LF can reach a header.
 *
 * @param notification - the question or approval notification.
 * @returns a single-line subject of at most {@link SUBJECT_MAX_CHARS} characters.
 */
export function renderAttentionSubject(notification: QuestionNotification | ApprovalNotification): string {
  if (notification.kind === 'approval') {
    const tool = sanitizeLine(notification.toolName, 80)
    const prefix = sanitizeLine(APPROVAL_SUBJECT_PREFIX, SUBJECT_MAX_CHARS)
    if (tool === '') return prefix
    const composed = `${prefix} — ${tool}`
    return Array.from(composed).length <= SUBJECT_MAX_CHARS ? composed : prefix
  }

  const prefix = sanitizeLine(QUESTION_SUBJECT_PREFIX, SUBJECT_MAX_CHARS)
  if (notification.questions.length === 1) {
    const header = notification.questions[0]?.header
    const label = header === undefined ? '' : sanitizeLine(header, 80)
    if (label !== '') {
      const composed = `${prefix} — ${label}`
      if (Array.from(composed).length <= SUBJECT_MAX_CHARS) return composed
    }
  } else if (notification.questions.length > 1) {
    const composed = `${prefix} — ${notification.questions.length} questions`
    if (Array.from(composed).length <= SUBJECT_MAX_CHARS) return composed
  }
  return prefix
}

/**
 * Dispatch a subject to the renderer for its notification kind.
 *
 * @param notification - the notification envelope.
 * @returns the subject line.
 */
export function renderNotificationSubject(notification: Notification): string {
  return notification.kind === 'turn' ? renderSubject(notification.candidate) : renderAttentionSubject(notification)
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
 * The note is written per notification family, because the privacy claim a
 * reader needs differs between them. A turn notification says the body is the
 * model's final visible output; a human-attention notification says the body is
 * a question or an approval DSH was already about to show a human, and that
 * everything else the model sent remains excluded.
 *
 * @param kind - the notification family.
 * @param truncated - whether the visible text was cut.
 * @param droppedFields - configuration fields that could not be read.
 * @returns the footer lines, or `''` when there is nothing to state.
 */
export function renderFooter(
  kind: 'turn' | 'attention',
  truncated: boolean,
  droppedFields: readonly string[],
): string {
  const lines: string[] = []
  if (truncated) lines.push(TRUNCATION_MARKER)
  if (kind === 'turn') {
    lines.push('Sent by dsh-mail-notify; body contains the model’s final visible output and the metadata above.')
    lines.push('Reasoning, tool arguments, tool results, and the user prompt are never included.')
  } else {
    lines.push('Sent by dsh-mail-notify as a human-attention notification.')
    lines.push('Body contains only the fields DSH defines as human-facing presentation for this interaction.')
    lines.push('Reasoning, tool results, credentials, and every other tool argument are never included.')
  }
  if (droppedFields.length > 0) {
    lines.push(`Unrecognised configuration fields were ignored: ${droppedFields.join(', ')}`)
  }
  return lines.join('\n')
}

/** Everything the body renderer needs beyond the notification. */
export interface RenderInput {
  /** The notification envelope to render. */
  notification: Notification
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
 * Render the failure section of a terminal-error notification (D018).
 *
 * Every line below states an observation. Where the runtime reported nothing,
 * the line says so rather than printing a default: an unreported retry delay and
 * a zero one are different facts, and only one of them is true here.
 *
 * @param candidate - the failed turn's candidate.
 * @returns the section lines, without a trailing newline.
 */
function renderFailureSection(candidate: NotificationCandidate): string {
  const failure = candidate.failure
  if (failure === undefined) {
    return [
      '--- Failure ---',
      'Failure code: not reported by the runtime',
      'No structured failure facts were available for this turn; only the reason text above was reported.',
    ].join('\n')
  }

  const lines: string[] = ['--- Failure ---', `Failure code: ${sanitizeLine(failure.code, 120)}`]
  lines.push(failure.status === undefined ? 'HTTP status: not reported' : `HTTP status: ${failure.status}`)
  lines.push(
    failure.providerRetryAfterMs === undefined
      ? 'Retry-After: not reported'
      : `Retry-After: ${failure.providerRetryAfterMs} ms (provider-requested, reported at failure time)`,
  )
  if (failure.message !== undefined) {
    lines.push(`Failure message: ${sanitizeLine(failure.message, 500)}`)
  } else {
    lines.push('Failure message: not reported')
  }
  return lines.join('\n')
}

/**
 * Render the question block of a human-attention notification (§17).
 *
 * @param notification - the parsed question notification.
 * @returns the section lines, without a trailing newline.
 */
function renderQuestionSection(notification: QuestionNotification): string {
  const lines: string[] = ['--- Question ---']
  notification.questions.forEach((item, index) => {
    if (notification.questions.length > 1) lines.push(`Q${index + 1}. ${item.question}`)
    else lines.push(item.question)
    if (item.header !== undefined) lines.push(`   (${item.header})`)
    if (item.multiSelect === true) lines.push('   Select one or more.')
    if (item.options !== undefined) {
      item.options.forEach((option, position) => {
        lines.push(`   ${position + 1}. ${option.label}`)
        if (option.description !== undefined) lines.push(`      ${option.description}`)
      })
    }
    lines.push('')
  })
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  if (notification.droppedQuestions > 0) {
    lines.push(
      `This call carried ${notification.droppedQuestions} further question(s) that are not shown here; open DSH to see the complete request.`,
    )
  }
  if (notification.argumentsUnreadable === true) {
    lines.push('The tool call’s arguments could not be parsed, so no question text is shown.')
  }
  return lines.join('\n')
}

/**
 * Render the approval block of a human-attention notification (§22).
 *
 * The approved tool's arguments are absent by construction: DSH's approval
 * contract does not publish them, and this renderer has no field to put them in.
 *
 * @param notification - the adapted approval notification.
 * @returns the section lines, without a trailing newline.
 */
function renderApprovalSection(notification: ApprovalNotification): string {
  const lines: string[] = ['--- Approval ---', `Tool: ${sanitizeLine(notification.toolName, 200)}`]
  lines.push(
    notification.reason === undefined ? 'Reason: not reported' : `Reason: ${sanitizeLine(notification.reason, 1000)}`,
  )
  lines.push('Tool arguments: not published by DSH and not included in this message.')
  return lines.join('\n')
}

/**
 * Render the metadata block shared by every notification family.
 *
 * @param notification - the notification envelope.
 * @returns one line per fact, without a trailing newline.
 */
function renderNotificationMetadata(notification: Notification): string {
  if (notification.kind === 'turn') return renderMetadata(notification.candidate)

  const lines: string[] = ['Status:    Waiting for a human']
  lines.push(`Session:   ${sanitizeLine(notification.sessionId, 120)}`)
  if (notification.turn !== undefined) lines.push(`Turn:      ${notification.turn}`)
  if (notification.step !== undefined) lines.push(`Step:      ${notification.step}`)
  if (notification.cwd !== undefined) lines.push(`Workspace: ${sanitizeLine(notification.cwd, 240)}`)
  lines.push(`Observed:  ${new Date(notification.observedAt).toISOString()}`)
  return lines.join('\n')
}

/**
 * Render a settled-turn notification.
 *
 * @param notification - the turn envelope.
 * @param input - the render switches.
 * @returns the rendered message parts.
 */
function renderTurnMail(notification: TurnNotification, input: RenderInput): RenderedMail {
  const { candidate } = notification
  const { render } = input
  const sections: string[] = []

  if (render.includeMetadata) sections.push(renderMetadata(candidate))

  // The failure section is emitted for a failed turn even when the runtime
  // reported nothing structured, because the operator needs to see that the
  // absence is an observation rather than an omission (D018).
  if (candidate.status === 'error') sections.push(renderFailureSection(candidate))

  if (render.includeUserPrompt && candidate.userText !== undefined && candidate.userText.trim() !== '') {
    sections.push(`--- User prompt ---\n${candidate.userText}`)
  }

  const body = candidate.visibleText
  if (candidate.status === 'error') {
    // Partial output must never read as the final answer. It keeps its own
    // paragraph and its own heading, and when there is none the mail says so
    // instead of leaving an empty gap that looks like a truncation bug.
    sections.push(
      body.trim() !== ''
        ? `--- Partial model output before failure ---\n${body}`
        : '--- No model output was produced before this failure ---',
    )
  } else {
    sections.push(body === '' ? '' : body)
  }

  if (render.includeFooter) {
    sections.push(renderFooter('turn', input.truncated, input.droppedFields ?? []))
  } else if (input.truncated) {
    // The footer switch hides the marker from the message, but the fact stays
    // observable in the structured log. Silent truncation is never introduced.
    sections.push('')
  }

  const text = sections.join('\n\n').replace(/\n{4,}/g, '\n\n\n')
  return {
    subject: renderNotificationSubject(notification),
    text,
    bodyTextLength: Array.from(body).length,
  }
}

/**
 * Render a mid-turn human-attention notification.
 *
 * The instruction line is appended only when the footer is enabled, so the
 * `includeFooter` switch keeps meaning "the plugin's own generated text is
 * removable" rather than silently meaning two different things.
 *
 * @param notification - the question or approval envelope.
 * @param input - the render switches.
 * @returns the rendered message parts.
 */
function renderAttentionMail(
  notification: QuestionNotification | ApprovalNotification,
  input: RenderInput,
): RenderedMail {
  const { render } = input
  const sections: string[] = []

  if (render.includeMetadata) sections.push(renderNotificationMetadata(notification))
  sections.push(
    notification.kind === 'question' ? renderQuestionSection(notification) : renderApprovalSection(notification),
  )

  if (render.includeFooter) {
    sections.push(
      [
        'Open DSH to answer this request. This message is a notification only; it cannot be answered by reply.',
        renderFooter('attention', false, input.droppedFields ?? []),
      ].join('\n'),
    )
  }

  const questionChars =
    notification.kind === 'question'
      ? notification.questions.reduce((total, item) => total + Array.from(item.question).length, 0)
      : 0

  const text = sections.join('\n\n').replace(/\n{4,}/g, '\n\n\n')
  return {
    subject: renderNotificationSubject(notification),
    text,
    // For a human-attention mail the meaningful size is the question text; an
    // approval carries none, and `truncated` is always false for both because
    // their content was bounded by the parser rather than by `maxBodyChars`.
    bodyTextLength: questionChars,
  }
}

/**
 * Render the complete plain-text message for any notification kind (§27).
 *
 * The branch is explicit rather than inferred from which fields are populated,
 * so a question can never be rendered as though it were the model's final
 * output. Only three things may appear in a turn mail: the final visible
 * assistant text, the failure facts, and the metadata block. In a
 * human-attention mail only the allowlisted presentation fields appear.
 * Reasoning text, tool results, the system prompt, raw tool arguments, and
 * credentials have no path into this function at all.
 *
 * @param input - the notification and the render switches.
 * @returns the subject and body.
 */
export function renderMail(input: RenderInput): RenderedMail {
  return input.notification.kind === 'turn'
    ? renderTurnMail(input.notification, input)
    : renderAttentionMail(input.notification, input)
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
