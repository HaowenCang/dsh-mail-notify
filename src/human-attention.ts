/**
 * The strict parser and field allowlist for mid-turn human-attention
 * notifications (D018).
 *
 * This module exists because `ask_user_question` is the single, narrow
 * exception to the project's rule that tool arguments never leave the process.
 * The exception is a *semantic allowlist*, not a permission: DSH defines these
 * fields as human-facing presentation — the human was always meant to read them
 * — while everything else a model can put in a tool call stays forbidden.
 *
 * Two properties are load-bearing and are enforced structurally rather than by
 * convention. First, no raw argument value is ever retained: the input JSON
 * string is parsed, copied field by field into a new object, and dropped, so
 * nothing downstream can hold a reference to it and no `arguments` value can
 * reach a log line or a mail body. Second, no field is copied implicitly: there
 * is no spread of the source object anywhere in this file, so a question field
 * the allowlist does not name is dropped even when it arrived.
 *
 * @module dsh-mail-notify/human-attention
 */

import { sanitizeDetail } from './completion.ts'
import type {
  ApprovalNotification,
  QuestionItem,
  QuestionOption,
  QuestionParseResult,
  ResolvedConfig,
  SuppressionReason,
} from './types.ts'

/** The one tool name whose arguments may be parsed, matched exactly (§12). */
export const QUESTION_TOOL_NAME = 'ask_user_question'

/** Most questions carried from one call; the remainder are counted, not read. */
export const MAX_QUESTIONS = 20

/** Most options carried on one question. */
export const MAX_OPTIONS_PER_QUESTION = 20

/** Inclusive code-point bound on one question's text. */
export const MAX_QUESTION_CHARS = 2000

/** Inclusive code-point bound on one option label. */
export const MAX_OPTION_LABEL_CHARS = 500

/** Inclusive code-point bound on one option description. */
export const MAX_OPTION_DESCRIPTION_CHARS = 1000

/** Inclusive code-point bound on a question header. */
export const MAX_HEADER_CHARS = 120

/** Inclusive code-point bound on one question id. */
export const MAX_QUESTION_ID_CHARS = 200

/** Inclusive code-point bound over every carried question field together. */
export const MAX_TOTAL_QUESTION_CHARS = 6000

/** Inclusive code-point bound on an approval's asker-supplied reason. */
export const MAX_APPROVAL_REASON_CHARS = 1000

/** Inclusive code-point bound on an approval's tool name. */
export const MAX_APPROVAL_TOOL_NAME_CHARS = 200

/**
 * Clean untrusted presentation text.
 *
 * `sanitizeDetail` is reused deliberately: it removes the whole C0/C1 control
 * range and bounds the length in code points, which is what an email body and a
 * subject line both need. Newlines are flattened to spaces rather than kept, so
 * a question's text cannot forge extra lines in a body and cannot put a CR or LF
 * anywhere near a header. That is stricter than readability alone would require
 * and is the intended behaviour: the parser's output feeds both a body and a
 * subject, and the safer of the two constraints governs.
 *
 * @param value - the raw field value; its type is not trusted.
 * @param limit - inclusive maximum length in code points.
 * @returns the sanitized text, or `undefined` when nothing usable remained.
 */
function cleanText(value: unknown, limit: number): string | undefined {
  return sanitizeDetail(value, limit)
}

/** A plain record, or `undefined` for arrays, `null`, and non-objects. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Parse one option, copying only the two allowlisted fields.
 *
 * @param raw - the raw option value.
 * @param dropped - sink for dropped-field paths, in discovery order.
 * @returns the option, or `undefined` when no label was usable.
 */
function parseOption(raw: unknown, dropped: string[]): QuestionOption | undefined {
  const record = asRecord(raw)
  if (record === undefined) {
    dropped.push('options[].<non-object>')
    return undefined
  }
  const label = cleanText(record['label'], MAX_OPTION_LABEL_CHARS)
  if (label === undefined) {
    dropped.push('options[].label')
    return undefined
  }
  const option: QuestionOption = { label }
  const description = cleanText(record['description'], MAX_OPTION_DESCRIPTION_CHARS)
  if (description !== undefined) option.description = description
  return option
}

/**
 * Parse one question, copying only the five allowlisted fields.
 *
 * The construction is field by field on purpose. A spread (`{ ...record }`)
 * would carry every additional property the model emitted — including any
 * credential or file content it chose to place there — straight into the
 * outbound message, which is the failure this module exists to prevent.
 *
 * @param raw - the raw question value.
 * @param index - its position in the call, used only for drop reporting.
 * @param dropped - sink for dropped-field paths.
 * @returns the question, or `undefined` when `id` or `question` was unusable.
 */
function parseQuestion(raw: unknown, index: number, dropped: string[]): QuestionItem | undefined {
  const record = asRecord(raw)
  if (record === undefined) {
    dropped.push(`questions[${index}].<non-object>`)
    return undefined
  }

  const id = cleanText(record['id'], MAX_QUESTION_ID_CHARS)
  const question = cleanText(record['question'], MAX_QUESTION_CHARS)
  if (id === undefined || question === undefined) {
    if (id === undefined) dropped.push(`questions[${index}].id`)
    if (question === undefined) dropped.push(`questions[${index}].question`)
    return undefined
  }

  const item: QuestionItem = { id, question }

  const header = cleanText(record['header'], MAX_HEADER_CHARS)
  if (header !== undefined) item.header = header

  // `multi_select` is the argument spelling DSH's tool schema declares;
  // `multiSelect` is the service-side spelling the tool maps it onto. Both are
  // accepted so the notification survives either side of that mapping, and the
  // value must be a real boolean rather than a truthy value.
  const rawMulti = record['multi_select'] ?? record['multiSelect']
  if (typeof rawMulti === 'boolean') item.multiSelect = rawMulti

  const rawOptions = record['options']
  if (Array.isArray(rawOptions)) {
    const options: QuestionOption[] = []
    for (let position = 0; position < rawOptions.length; position += 1) {
      if (position >= MAX_OPTIONS_PER_QUESTION) {
        dropped.push(`questions[${index}].options[${position}+]`)
        break
      }
      const option = parseOption(rawOptions[position], dropped)
      if (option !== undefined) options.push(option)
    }
    if (options.length > 0) item.options = options
  }

  return item
}

/**
 * Parse the arguments of one observed `ask_user_question` call.
 *
 * Malformed JSON is a normal outcome rather than an exception: the model
 * produces the argument string, and a truncated or invalid one must degrade to
 * "nothing to notify" with the reason recorded, never to a thrown error on the
 * session-append path.
 *
 * Bounds are applied in a fixed order — count, then per-field length, then the
 * running total — so the same oversized call always produces the same carried
 * set rather than depending on object key order.
 *
 * @param raw - the raw `arguments` value, expected to be the model's JSON string.
 * @returns the carried questions plus the accounting for everything not carried.
 */
export function parseAskUserQuestionArguments(raw: unknown): QuestionParseResult {
  const dropped: string[] = []
  const empty: QuestionParseResult = {
    questions: [],
    droppedQuestions: 0,
    droppedFields: dropped,
    sawOptions: false,
    sawMultiSelect: false,
    argumentsReadable: false,
  }

  let value: unknown
  if (typeof raw === 'string') {
    if (raw.trim() === '') return { ...empty, dropReason: 'unreadable-arguments' }
    try {
      value = JSON.parse(raw)
    } catch {
      return { ...empty, dropReason: 'unreadable-arguments' }
    }
  } else if (typeof raw === 'object' && raw !== null) {
    // A structured value is accepted as compatibility: some DSH versions persist
    // the parsed argument object on the event instead of the model's raw string.
    // It is still copied field by field and never retained.
    value = raw
  } else {
    return { ...empty, dropReason: 'unreadable-arguments' }
  }

  const container = asRecord(value)
  if (container === undefined) return { ...empty, dropReason: 'unreadable-arguments' }

  const rawQuestions = container['questions']
  if (!Array.isArray(rawQuestions)) return { ...empty, argumentsReadable: true, dropReason: 'no-questions' }
  if (rawQuestions.length === 0) return { ...empty, argumentsReadable: true, dropReason: 'no-questions' }

  const questions: QuestionItem[] = []
  let totalChars = 0
  let sawOptions = false
  let sawMultiSelect = false
  let truncatedByCount = false
  let truncatedBySize = false

  for (let index = 0; index < rawQuestions.length; index += 1) {
    if (index >= MAX_QUESTIONS) {
      truncatedByCount = true
      dropped.push(`questions[${index}+]`)
      break
    }

    const item = parseQuestion(rawQuestions[index], index, dropped)
    if (item === undefined) continue

    // The running total is measured on what will actually be carried, so the
    // bound describes the outbound content rather than the inbound call. A
    // question refused here still spends the budget: spending it only on carried
    // questions would let a small question after an oversized one slip through
    // the gap, and the carry set would stop being a prefix of the call.
    const cost = Array.from(item.id).length + Array.from(item.question).length
    totalChars += cost
    if (totalChars > MAX_TOTAL_QUESTION_CHARS) {
      truncatedBySize = true
      dropped.push(`questions[${index}]`)
      continue
    }

    if (item.options !== undefined) {
      sawOptions = true
      if (item.multiSelect === true) sawMultiSelect = true
    }

    questions.push(item)
  }

  if (questions.length === 0) {
    return {
      ...empty,
      argumentsReadable: true,
      droppedFields: dropped,
      droppedQuestions: rawQuestions.length,
      dropReason: truncatedByCount ? 'question-limit' : truncatedBySize ? 'content-limit' : 'no-usable-question',
    }
  }

  return {
    questions,
    droppedQuestions: rawQuestions.length - questions.length,
    droppedFields: dropped,
    sawOptions,
    sawMultiSelect,
    argumentsReadable: true,
  }
}

/**
 * Sanitize one observed `approval/asked` payload into an approval notification.
 *
 * DSH's approval contract is already minimal by design: it deliberately
 * publishes the request identity, the tool name, the exact call id, and the
 * asker's human-readable reason — and never the approved tool's arguments. That
 * safety property is preserved here rather than re-derived, and this function
 * adds only the sanitization and bounding the mail path requires.
 *
 * `callId` is carried as the identity anchor for the dedupe key, not as mail
 * content (§21 excludes it from the body for the same reason `requestId` is
 * excluded from failure mail: it is a diagnostic identifier, not something the
 * reader needs).
 *
 * @param data - the raw audit payload; its shape is not trusted.
 * @param sessionId - the owning session.
 * @param cwd - the workspace directory, when the session header carried one.
 * @param observedAt - epoch ms at which the plugin observed the event.
 * @returns the notification, or `undefined` when no usable tool name was present.
 */
export function toApprovalNotification(
  data: unknown,
  sessionId: string,
  cwd: string | undefined,
  observedAt: number,
): ApprovalNotification | undefined {
  const record = asRecord(data)
  if (record === undefined) return undefined

  const toolName = cleanText(record['toolName'], MAX_APPROVAL_TOOL_NAME_CHARS)
  if (toolName === undefined) return undefined

  const notification: ApprovalNotification = {
    kind: 'approval',
    sessionId,
    toolName,
    observedAt,
  }

  const callId = cleanText(record['callId'], MAX_QUESTION_ID_CHARS)
  if (callId !== undefined) notification.callId = callId

  const reason = cleanText(record['reason'], MAX_APPROVAL_REASON_CHARS)
  if (reason !== undefined) notification.reason = reason

  if (cwd !== undefined) notification.cwd = cwd

  return notification
}

/** What to do with one observed human-attention event. */
export type AttentionDecision =
  | { notify: true }
  | { notify: false; reason: SuppressionReason; detail?: string }

/**
 * Apply policy to one question notification.
 *
 * Deliberately shorter than the turn policy, and deliberately separate from it.
 * `minTurnDurationMs` does not appear here: an agent that asks a question two
 * seconds into a turn is precisely the case the mail exists for, and applying a
 * turn-length floor would suppress it. For the same reason there is no
 * visible-text rule — the questions *are* the content.
 *
 * There is no parameter for the notification itself. A question that reached
 * this function has already been parsed into allowlisted fields, and whether it
 * is *worth* sending depends only on configuration and on whether the same call
 * was already notified; accepting the payload would invite a future condition on
 * its content that no rule in this phase authorizes.
 *
 * @param config - the resolved configuration.
 * @param isDuplicate - whether this call id already produced a job.
 * @returns the decision; never enqueues and never marks.
 */
export function decideQuestionNotification(config: ResolvedConfig, isDuplicate: boolean): AttentionDecision {
  if (!config.enabled) return { notify: false, reason: 'disabled' }
  if (!config.policy.notifyQuestions) {
    return { notify: false, reason: 'disabled-by-policy', detail: 'notifyQuestions is switched off' }
  }
  if (isDuplicate) return { notify: false, reason: 'duplicate' }
  return { notify: true }
}

/**
 * Apply policy to one approval notification.
 *
 * @param config - the resolved configuration.
 * @param isDuplicate - whether this approval id already produced a job.
 * @returns the decision; never enqueues and never marks.
 */
export function decideApprovalNotification(config: ResolvedConfig, isDuplicate: boolean): AttentionDecision {
  if (!config.enabled) return { notify: false, reason: 'disabled' }
  if (!config.policy.notifyApprovals) {
    return { notify: false, reason: 'disabled-by-policy', detail: 'notifyApprovals is switched off' }
  }
  if (isDuplicate) return { notify: false, reason: 'duplicate' }
  return { notify: true }
}
