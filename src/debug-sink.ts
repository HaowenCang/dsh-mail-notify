/**
 * The debug sink: a complete, network-free stand-in for the mailer.
 *
 * It implements the same `(job) => Promise<SendResult>` contract, so the whole
 * chain — runtime event, adapter, turn state, candidate, policy, queue,
 * outcome — can be exercised end to end without Nodemailer, without a socket,
 * and without a credential. That makes it both the P3.4 integration point and
 * the default sink in tests.
 *
 * What it records is only the field set `docs/SECURITY.md` §4 allows. In
 * particular it never records the full visible text: that text is already
 * visible in the mail a recipient receives, so a log copy would widen exposure
 * without adding information. The length, the status, and the timing are the
 * signals troubleshooting actually needs.
 *
 * @module dsh-mail-notify/debug-sink
 */

import type { PluginLogger } from './logger.ts'
import type { Notification, MailJob, MailSink, SendResult } from './types.ts'

/** The safe per-job summary the debug sink records for a settled turn. */
export interface DebugSinkTurnRecord {
  notificationKind: 'turn'
  sessionId: string
  turn: number
  status: string
  turnEndKind: string
  visibleTextLength: number
  bodyTextLength: number
  explicitToolErrorCount: number
  telemetryComplete: boolean
  /** Distinct model-call usage reports folded into the candidate's aggregate. */
  usageSampleCount: number
  /** Whether every accountable model call of the turn reported usage. */
  usageComplete: boolean
  /** `null` when the turn's start was never observed. */
  durationMs: number | null
  /** Structured failure code, present only for a terminal error (D018). */
  failureCode: string | null
  truncated: boolean
  recipientCount: number
}

/**
 * The safe per-job summary for a mid-turn human-attention notification.
 *
 * The question text and the approval reason are deliberately absent: they are
 * the body of the mail, and the buffer's purpose is to prove *that* a
 * notification was produced, not to keep a second copy of its content.
 */
export interface DebugSinkAttentionRecord {
  notificationKind: 'question' | 'approval'
  sessionId: string
  turn: number | null
  step: number | null
  /** Tool awaiting approval; `null` for a question. */
  toolName: string | null
  questionCount: number
  /** Whether any carried question offered options. */
  hasOptions: boolean
  /** Code-point length of the carried question text, measured not sampled. */
  bodyTextLength: number
  truncated: boolean
  recipientCount: number
}

/** One recorded job, discriminated by the notification family it carried. */
export type DebugSinkRecord = DebugSinkTurnRecord | DebugSinkAttentionRecord

/** A `debug` sink plus the bounded buffer of everything it recorded. */
export interface DebugSink {
  sink: MailSink
  records(): readonly DebugSinkRecord[]
  clear(): void
}

/**
 * Build a debug sink.
 *
 * @param logger - the plugin logger; records go out as `debug` lines.
 * @param maxRecords - retained-record cap, so the buffer cannot grow unbounded.
 * @param failWith - when set, every send fails with this classified error, so
 *   retry and queue behaviour can be tested without a transport.
 * @returns the sink and its buffer.
 */
export function createDebugSink(
  logger: PluginLogger,
  maxRecords = 500,
  failWith?: { class: 'retry' | 'permanent'; category: string; message: string },
): DebugSink {
  const records: DebugSinkRecord[] = []

  const sink: MailSink = (job: MailJob): Promise<SendResult> => {
    const record = summarize(job)
    if (maxRecords > 0) {
      records.push(record)
      if (records.length > maxRecords) records.shift()
    }
    logger.debug('sink.debug', { ...record })

    if (failWith !== undefined) {
      return Promise.resolve({
        ok: false,
        class: failWith.class,
        category: failWith.category,
        message: failWith.message,
      })
    }
    return Promise.resolve({ ok: true })
  }

  return {
    sink,
    records: () => records,
    clear: () => {
      records.length = 0
    },
  }
}

/**
 * Reduce a job to the recordable field set.
 *
 * `bodyTextLength` is measured, never sampled: the length of what would be sent
 * is safe to disclose, while any fragment of it is not. This holds for every
 * notification family — a question's recorded length says how much text went
 * out without revealing a word of it.
 *
 * @param job - the queued job.
 * @returns the safe summary.
 */
function summarize(job: MailJob): DebugSinkRecord {
  const notification: Notification = job.notification
  if (notification.kind === 'turn') {
    const candidate = notification.candidate
    return {
      notificationKind: 'turn',
      sessionId: candidate.sessionId,
      turn: candidate.turn,
      status: candidate.status,
      turnEndKind: candidate.turnEndKind,
      visibleTextLength: candidate.visibleTextLength,
      bodyTextLength: Array.from(candidate.visibleText).length,
      explicitToolErrorCount: candidate.explicitToolErrorCount,
      telemetryComplete: candidate.telemetryComplete,
      usageSampleCount: candidate.usageSampleCount,
      usageComplete: candidate.usageComplete,
      durationMs: candidate.durationMs ?? null,
      failureCode: candidate.failure?.code ?? null,
      truncated: job.truncated,
      recipientCount: job.to.length,
    }
  }

  const isQuestion = notification.kind === 'question'
  const questions = isQuestion ? notification.questions : []
  return {
    notificationKind: notification.kind,
    sessionId: notification.sessionId,
    turn: notification.turn ?? null,
    step: notification.step ?? null,
    toolName: isQuestion ? null : notification.toolName,
    questionCount: questions.length,
    hasOptions: questions.some((item) => item.options !== undefined),
    bodyTextLength: questions.reduce((total, item) => total + Array.from(item.question).length, 0),
    truncated: job.truncated,
    recipientCount: job.to.length,
  }
}
