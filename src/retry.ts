/**
 * Send-failure classification and backoff computation.
 *
 * Two rules carry the weight here. Only failures classified `retry` are retried
 * at all, and anything unrecognised is `permanent` — amplifying an unknown
 * failure four times multiplies load without improving the outcome. The other
 * is that the wait is policy, not I/O: this module computes a delay, and the
 * caller supplies a cancellable sleep, so a plugin unload ends a backoff
 * immediately instead of leaving a detached timer behind.
 *
 * @module dsh-mail-notify/retry
 */

import type { RetryClass, RetryPolicy } from './types.ts'

/** Default single-wait ceiling, in milliseconds. */
export const RETRY_MAX_DELAY_MS = 30_000

/** Backoff multiplier between consecutive waits. */
export const RETRY_BACKOFF_FACTOR = 3

/** Classified failure, safe to log. */
export interface FailureInfo {
  retryClass: RetryClass
  /** Stable machine-readable category, used by counters and by the readme table. */
  category: string
  /** Redacted, single-line, length-bounded description. */
  message: string
  /** Nodemailer-style symbolic code, when the failure carried one. */
  code?: string
  /** SMTP numeric reply code, when the failure carried one. */
  responseCode?: number
}

/** The subset of a thrown error this module reads. */
interface ErrorLike {
  code?: unknown
  responseCode?: unknown
  response?: unknown
  message?: unknown
  name?: unknown
}

/**
 * Extract an SMTP numeric reply code from any of the shapes Nodemailer uses.
 *
 * @param error - the thrown value.
 * @returns the reply code, or `undefined`.
 */
function readResponseCode(error: ErrorLike): number | undefined {
  const direct = error.responseCode
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  if (typeof direct === 'string' && /^[0-9]{3}$/.test(direct)) return Number.parseInt(direct, 10)
  const response = error.response
  if (typeof response === 'string') {
    const match = /^([0-9]{3})/.exec(response.trim())
    if (match?.[1] !== undefined) return Number.parseInt(match[1], 10)
  }
  return undefined
}

/**
 * Extract the symbolic error code.
 *
 * @param error - the thrown value.
 * @returns the code, or `undefined`.
 */
function readCode(error: ErrorLike): string | undefined {
  const code = error.code
  return typeof code === 'string' && code !== '' ? code : undefined
}

/** Codes that describe a transport condition worth one more attempt. */
const TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
])

/**
 * Codes that are permanent whatever the reply code says.
 *
 * `ECONNREFUSED` sits here rather than with the transient codes: a refused
 * connection means nothing is listening on the configured host and port, which
 * four attempts cannot change. `ENOTFOUND` is a name that does not resolve at
 * all, as distinct from `EAI_AGAIN`, which is a temporary resolver failure.
 */
const PERMANENT_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAUTH', 'EENVELOPE', 'EMESSAGE', 'EDNS'])

/** SMTP reply codes that mean the credential or its authorization is wrong. */
const AUTH_REPLY_CODES = new Set([530, 534, 535, 454, 538])

/** SMTP reply codes that mean the envelope was rejected. */
const ENVELOPE_REPLY_CODES = new Set([550, 551, 552, 553, 554, 555, 556, 557])

/**
 * Remove control characters and bound the length of an error message.
 *
 * SMTP reply text is external input; written verbatim into a line-oriented log
 * it could forge additional log lines.
 *
 * @param value - untrusted text.
 * @returns a single-line, bounded string.
 */
export function redactMessage(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'no message'
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  const points = Array.from(flat)
  return points.length <= 500 ? flat : `${points.slice(0, 500).join('')}…`
}

/**
 * Classify one thrown value from a send attempt.
 *
 * @param error - the thrown value; its shape is not trusted.
 * @returns the classification, category, and redacted message.
 */
export function classifyError(error: unknown): FailureInfo {
  if (typeof error !== 'object' || error === null) {
    return { retryClass: 'permanent', category: 'unknown-error', message: redactMessage(String(error)) }
  }
  const like = error as ErrorLike
  const code = readCode(like)
  const responseCode = readResponseCode(like)
  const message = redactMessage(like.message)

  if (code === 'EAUTH' || (responseCode !== undefined && AUTH_REPLY_CODES.has(responseCode))) {
    // The raw text of an auth failure can echo the username back; only the
    // classification and the reply code are retained.
    return responseCode === undefined
      ? { retryClass: 'permanent', category: 'smtp-auth', message: 'SMTP authentication was rejected', ...(code !== undefined ? { code } : {}) }
      : {
          retryClass: 'permanent',
          category: 'smtp-auth',
          message: `SMTP authentication was rejected (${responseCode})`,
          responseCode,
          ...(code !== undefined ? { code } : {}),
        }
  }

  if (
    code === 'EENVELOPE' ||
    (responseCode !== undefined && ENVELOPE_REPLY_CODES.has(responseCode))
  ) {
    const detail = responseCode === undefined ? undefined : ` (${responseCode})`
    return {
      retryClass: 'permanent',
      category: 'envelope-rejected',
      message: `the SMTP server rejected the envelope${detail ?? ''}`,
      ...(responseCode !== undefined ? { responseCode } : {}),
      ...(code !== undefined ? { code } : {}),
    }
  }

  if (code !== undefined && PERMANENT_CODES.has(code)) {
    return {
      retryClass: 'permanent',
      category: code === 'ENOTFOUND' ? 'dns-not-found' : `code-${code}`,
      message,
      code,
      ...(responseCode !== undefined ? { responseCode } : {}),
    }
  }

  if (responseCode !== undefined && responseCode >= 500) {
    return {
      retryClass: 'permanent',
      category: 'smtp-5xx',
      message: `SMTP permanent failure (${responseCode})`,
      responseCode,
      ...(code !== undefined ? { code } : {}),
    }
  }

  if (code !== undefined && TRANSIENT_CODES.has(code)) {
    return {
      retryClass: 'retry',
      category: `code-${code}`,
      message,
      code,
      ...(responseCode !== undefined ? { responseCode } : {}),
    }
  }

  if (responseCode !== undefined && responseCode >= 400 && responseCode < 500) {
    return {
      retryClass: 'retry',
      category: 'smtp-4xx',
      message: `SMTP transient failure (${responseCode})`,
      responseCode,
      ...(code !== undefined ? { code } : {}),
    }
  }

  return {
    retryClass: 'permanent',
    category: 'unknown-error',
    message,
    ...(code !== undefined ? { code } : {}),
    ...(responseCode !== undefined ? { responseCode } : {}),
  }
}

/**
 * Build a permanent failure for a condition detected before any I/O happened.
 *
 * @param category - the stable category name.
 * @param message - the redacted, single-line description.
 * @returns the failure record.
 */
export function permanentFailure(category: string, message: string): FailureInfo {
  return { retryClass: 'permanent', category, message: redactMessage(message) }
}

/** Backoff decision for one classified failure. */
export type RetryDecision = { retry: false } | { retry: true; delayMs: number; attemptNumber: number }

/**
 * Decide whether another attempt is warranted, and after how long.
 *
 * @param failure - the classified failure.
 * @param attemptsSoFar - attempts already made, including the failed one.
 * @param policy - the resolved retry policy.
 * @returns the decision; `retry: false` covers both permanent failures and an
 *   exhausted attempt budget.
 */
export function decideRetry(failure: FailureInfo, attemptsSoFar: number, policy: RetryPolicy): RetryDecision {
  if (failure.retryClass !== 'retry') return { retry: false }
  if (attemptsSoFar >= policy.retryAttempts + 1) return { retry: false }
  return { retry: true, delayMs: backoffDelayMs(attemptsSoFar, policy), attemptNumber: attemptsSoFar }
}

/**
 * Exponential backoff for the n-th retry: `base × 3^(n-1)`, capped.
 *
 * With the default `retryBaseDelayMs` of 1000 the sequence is 1 s, 3 s, 9 s.
 *
 * @param attemptNumber - the 1-based index of the retry about to be scheduled.
 * @param policy - the resolved retry policy.
 * @returns the wait in milliseconds.
 */
export function backoffDelayMs(attemptNumber: number, policy: RetryPolicy): number {
  const exponent = Math.max(0, attemptNumber - 1)
  const raw = policy.retryBaseDelayMs * RETRY_BACKOFF_FACTOR ** exponent
  return Math.min(policy.retryMaxDelayMs, Math.round(raw))
}

/** The waits a run of `retryAttempts` retries will use, for tests and docs. */
export function backoffSequence(policy: RetryPolicy): number[] {
  const delays: number[] = []
  for (let attempt = 1; attempt <= policy.retryAttempts; attempt += 1) delays.push(backoffDelayMs(attempt, policy))
  return delays
}
