/**
 * Shared test helpers: a real resolved configuration and a candidate builder.
 *
 * The configuration is produced by the real `resolveConfig`, not hand-built, so
 * the tests exercise the same defaulting and validation path the plugin uses at
 * load time. A hand-built `ResolvedConfig` could drift from the real one and
 * let a policy test pass against a configuration the plugin can never produce.
 *
 * @module dsh-mail-notify/tests/support
 */

import { resolveConfig } from '../../src/config.ts'
import type {
  CandidateStatus,
  FailureFacts,
  MailJob,
  NotificationCandidate,
  ResolvedConfig,
  TurnEndKind,
  TurnNotification,
} from '../../src/types.ts'

/** Raw configuration overrides accepted by {@link testConfig}. */
export interface TestConfigOverrides extends Record<string, unknown> {
  enabled?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpSecure?: boolean
  smtpUser?: string
  smtpPasswordCredential?: string
  from?: string
  to?: string[]
  includeSubagents?: boolean
  notifyCompleted?: boolean
  notifyErrors?: boolean
  notifyMaxTokens?: boolean
  notifyQuestions?: boolean
  notifyApprovals?: boolean
  minTurnDurationMs?: number
  maxBodyChars?: number
  includeMetadata?: boolean
  includeUserPrompt?: boolean
  includeFooter?: boolean
  queueSize?: number
  retryAttempts?: number
  retryBaseDelayMs?: number
  maxDedupeEntries?: number
}

/** Raw configuration that validates successfully. */
export const VALID_RAW_CONFIG: TestConfigOverrides = {
  enabled: true,
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: 'notify@example.com',
  smtpPasswordCredential: 'DSH_MAIL_SMTP_PASSWORD',
  from: 'notify@example.com',
  to: ['recipient@example.com'],
}

/**
 * Resolve a valid configuration with overrides applied.
 *
 * @param overrides - raw fields to override.
 * @returns the resolved configuration; throws if the override broke validation,
 *   which is what makes a malformed test setup fail loudly.
 */
export function testConfig(overrides: TestConfigOverrides = {}): ResolvedConfig {
  const { resolved, errors } = resolveConfig({ ...VALID_RAW_CONFIG, ...overrides })
  if (errors.length > 0) throw new Error(`test configuration is invalid: ${errors.join('; ')}`)
  return resolved
}

/** Build a candidate with sensible defaults for policy and rendering tests. */
export function testCandidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  const status: CandidateStatus = overrides.status ?? 'completed-clean'
  const turnEndKind: TurnEndKind = overrides.turnEndKind ?? 'completed'
  return {
    schemaVersion: 2,
    sessionId: 'session-test-0001',
    turn: 1,
    status,
    turnEndKind,
    visibleText: 'the final answer',
    visibleTextLength: 16,
    explicitToolErrorCount: 0,
    telemetryComplete: true,
    usageSampleCount: 0,
    usageMissingCount: 0,
    usageUnobservableRetries: 0,
    usageComplete: false,
    createdAt: 1_750_000_000_000,
    durationMs: 12_345,
    model: 'deepseek-chat',
    ...overrides,
  }
}

/** A promise that resolves after `ms`, using real timers. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Wrap a candidate in the turn branch of the notification union.
 *
 * Since D018 a `MailJob` carries a discriminated notification rather than a bare
 * candidate, because a queued job may now be a terminal turn settlement or a
 * mid-turn human-attention event. This helper names the turn case explicitly, so
 * a test that means "a settled turn" says so rather than relying on a default.
 *
 * @param candidate - the settled turn.
 * @returns the turn notification envelope.
 */
export function testTurnNotification(candidate: NotificationCandidate): TurnNotification {
  return { kind: 'turn', candidate }
}

/**
 * Build a terminal failure's structured facts with the runtime's own vocabulary.
 *
 * @param overrides - fields to override, e.g. `code: 'QUOTA'`, `status: 429`.
 * @returns the failure facts.
 */
export function testFailure(overrides: Partial<FailureFacts> = {}): FailureFacts {
  return { code: 'RATE_LIMIT', message: 'the provider rate-limited the request', ...overrides }
}

/**
 * Narrow a queued job to its turn branch.
 *
 * Every job a test receives from a turn lifecycle is a turn notification, and
 * this helper says so once. It throws rather than returning `undefined` when the
 * job is a human-attention notification, so a suite that accidentally asserts on
 * the wrong family fails at the assertion instead of reading nothing. An absent
 * job yields `undefined`, so the existing `sink.jobs[0]?.candidate` idiom keeps
 * working unchanged.
 *
 * @param job - the queued job, or `undefined` when the queue produced none.
 * @returns the settled turn's candidate, or `undefined` when there is no job.
 */
export function turn(job: MailJob): NotificationCandidate
export function turn(job: MailJob | undefined): NotificationCandidate | undefined
export function turn(job: MailJob | undefined): NotificationCandidate | undefined {
  if (job === undefined) return undefined
  if (job.notification.kind !== 'turn') {
    throw new Error(`expected a turn notification but received a ${job.notification.kind} notification`)
  }
  return job.notification.candidate
}

/**
 * Poll until a predicate holds, or fail after a bounded number of ticks.
 *
 * The first check runs on a microtask rather than synchronously: the queue's
 * worker only starts after `enqueue` returns, so a synchronous first check
 * would report "not started" for work that is already scheduled.
 *
 * @param predicate - the condition to await.
 * @param label - description used in the failure message.
 * @param timeoutMs - overall bound.
 */
export async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await Promise.resolve()
    if (predicate()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await delay(2)
  }
}
