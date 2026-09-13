/**
 * Internal DTOs shared by every module of `dsh-mail-notify`.
 *
 * This module is types only. It contains no runtime code and deliberately
 * imports nothing from DSH: the shape knowledge of DSH payloads lives
 * exclusively in `runtime-adapter.ts` (architecture invariant one).
 *
 * @module dsh-mail-notify/types
 */

/**
 * One provider-reported per-call token sample, exactly as the runtime reported it.
 *
 * Every field is optional because the runtime omits counters a provider did not
 * report. Values are never derived, corrected, or used to classify a turn
 * (D006). This is the shape of a *single model call*, not of a turn: the
 * turn-level aggregate has its own type, {@link TurnUsage} (D017).
 */
export interface RawUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * Turn-level aggregate of observable per-call provider-reported counters (D017).
 *
 * Produced by folding the samples of every distinct model call observed inside
 * one turn. `inputTokens` is uncached input only; cached input is reported
 * separately, so the three input buckets are disjoint and are never added
 * together. `reasoningTokens` is a subset of `outputTokens` and is therefore
 * never added to it. No total and no price is derived from these buckets, and a
 * counter no sample reported stays absent rather than becoming a known `0`.
 */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * How completely one turn's token telemetry was observed.
 *
 * The four fields answer two different questions. `sampleCount` says how many
 * distinct model-call usage reports were folded into the aggregate.
 * `missingCount` and `unobservableRetries` say how many accountable model calls
 * produced no usable report, and `complete` is true only when both of those are
 * zero and the turn was observed from its start.
 *
 * `missingCount` and `unobservableRetries` are independent facts rather than a
 * partition of the turn's calls: a single failed call that recorded an
 * `assistant/attempt` settlement *and* a retry record is counted in both, which
 * is why neither is presented as "the number of calls".
 */
export interface TurnUsageCoverage {
  /** Distinct model-call usage reports folded into the aggregate. */
  sampleCount: number
  /** Accountable model calls observed without a usable usage report. */
  missingCount: number
  /** Retried model calls whose failed attempt reported no usage. */
  unobservableRetries: number
  /** True only when no accountable call was left without a usage report. */
  complete: boolean
}

/** Which settlement produced a usage sample. */
export type SettlementKind = 'message' | 'attempt'

/** One observed model-call settlement, as the handler saw it. */
export interface SettlementInput {
  kind: SettlementKind
  step: number
  /** Durable session sequence number, when the envelope carried one. */
  seq?: number
  /** Assistant message id, when the payload carried one. */
  messageId?: string
  /** Event time, used only as a last-resort identity for deduplication. */
  timeMs: number
  /** The raw usage value; its shape is not trusted. */
  usage: unknown
}

/**
 * What one settlement contributed.
 *
 * `sampled` folded a usable usage report; `unusable` recorded an accountable
 * call that reported none; `duplicate` changed nothing because the same
 * settlement had already been observed.
 */
export type SettlementOutcome = 'sampled' | 'unusable' | 'duplicate'

/** One retry record: a failed model call whose usage is not reported at all. */
export interface RetryInput {
  step: number
  seq?: number
  timeMs: number
}

/** The folded result handed to the candidate builder. */
export interface TurnUsageSnapshot extends TurnUsageCoverage {
  /** The aggregate, or `undefined` when no readable sample was folded. */
  usage?: TurnUsage
}

/**
 * The per-turn token-accounting seam.
 *
 * Stated structurally so this module stays free of runtime imports; the
 * implementation is `TurnUsageAccounting` in `telemetry.ts`.
 */
export interface TurnUsageLedger {
  /** Record that the runtime announced a model call for this step. */
  noteStepStarted(step: number): void
  /** Fold one model-call settlement. */
  addSettlement(input: SettlementInput): SettlementOutcome
  /** Record one retried model call, whose usage is not observable. */
  noteRetry(input: RetryInput): boolean
  /** The turn's aggregate and coverage. */
  snapshot(sawTurnStart: boolean): TurnUsageSnapshot
}

/**
 * Completion classification of one turn.
 *
 * `completed-clean` means only that the runtime reported no explicit tool
 * failure; it does not mean every shell command succeeded (D005).
 */
export type CandidateStatus =
  | 'completed-clean'
  | 'completed-with-tool-errors'
  | 'max-tokens'
  | 'error'
  | 'aborted'
  | 'blocked'
  | 'interrupted'
  | 'unknown'

/**
 * The six confirmed `turn/end` reasons plus the defensive fallback.
 *
 * `unknown` is reachable only when the runtime reports a kind outside the
 * confirmed set; no confirmed kind produces it (D007).
 */
export type TurnEndKind =
  | 'completed'
  | 'max-tokens'
  | 'error'
  | 'aborted'
  | 'blocked'
  | 'interrupted'
  | 'unknown'

/** Why a candidate was not turned into a queued job. */
export type SuppressionReason =
  | 'disabled'
  | 'subagent-excluded'
  | 'disabled-by-policy'
  | 'no-visible-text'
  | 'below-min-duration'
  | 'duplicate'

/**
 * Outcome of one DSH session event after adaptation.
 *
 * Every variant carries plain scalars only. No variant may reference the live
 * `session`, the `SessionEvent`, or `event.data` (ADP-05).
 */
export type InternalEvent =
  | { kind: 'turn-start'; turn: number; timeMs: number }
  | {
      kind: 'assistant-message'
      turn: number
      step: number
      /** Durable session sequence number; the primary settlement identity. */
      seq?: number
      /** Raw content blocks; only `content.ts` may interpret them. */
      blocks: readonly unknown[]
      messageId?: string
      provider?: string
      model?: string
      usage?: RawUsage
      timeMs: number
    }
  | {
      kind: 'assistant-attempt'
      turn: number
      step: number
      seq?: number
      /** The attempt's own usage, when its stream carried one. */
      usage?: RawUsage
      timeMs: number
    }
  | { kind: 'step-start'; turn: number; step: number; timeMs: number }
  | { kind: 'llm-retry'; turn: number; step: number; seq?: number; timeMs: number }
  | { kind: 'tool-call'; turn: number; step: number; timeMs: number }
  | {
      kind: 'user-message'
      /** Absent on the runtime's own `user/message` payload, which has no turn. */
      turn?: number
      /** The user's own text, collected always and rendered only on opt-in. */
      text: string
      timeMs: number
    }
  | {
      kind: 'tool-result'
      turn: number
      step: number
      /** Both runtime error criteria folded into one flag (D005). */
      explicitError: boolean
      errorName?: string
      errorCode?: string
      timeMs: number
    }
  | {
      kind: 'turn-end'
      turn: number
      turnEndKind: TurnEndKind
      detail?: string
      reasonDetail?: string
      timeMs: number
    }
  | { kind: 'other'; type: string; turn?: number; timeMs: number }

/**
 * Which criterion classified a session as a subagent (D003).
 *
 * `null` means the session is top level. The value exists so that "why was
 * this mail not sent" is auditable rather than a silent skip.
 */
export type SubagentDecidedBy = 'origin' | 'parentSession' | 'delegationDepth' | null

/** Session-level facts, reduced to what policy needs. */
export interface SessionFacts {
  sessionId: string
  isSubagent: boolean
  decidedBy: SubagentDecidedBy
  cwd?: string
  agentPreset?: string
}

/**
 * Accumulated per-turn state.
 *
 * Created by exactly two paths that share one accessor: a real `turn/start`,
 * or lazy initialization on any other event carrying a turn number. A turn
 * whose `turn/start` was never observed reports `durationMs: null`, never `0`
 * (D004).
 */
export interface TurnState {
  turn: number
  /** Whether this turn's `turn/start` was observed. */
  sawTurnStart: boolean
  /** Epoch ms of `turn/start`; absent while unobserved. */
  startAt?: number
  /** Whether the counters are known to cover the whole turn. */
  telemetryComplete: boolean

  /** Last non-empty visible text; empty messages never overwrite it. */
  lastVisibleAssistantText: string
  lastAssistantMessageId?: string
  /** Most recent user message text, collected always, rendered only on opt-in. */
  lastUserText?: string

  provider?: string
  model?: string
  /** Per-turn usage fold; see `telemetry.ts` for the semantics. */
  usage: TurnUsageLedger

  /** How many distinct step numbers were observed, not the highest number. */
  steps: number
  assistantEvents: number
  toolCallCount: number
  toolResultCount: number
  explicitToolErrorCount: number
}

/**
 * The stable DTO produced at turn end, schema version 2 (D007, D013, D017).
 *
 * Must fields are the ones without which no notification policy can decide
 * unambiguously. Optional fields are omitted entirely when absent; nothing is
 * written as `undefined` or as a `null` placeholder except `durationMs`, whose
 * `null` is a positive observation that the duration is unknown.
 *
 * Version 2 changed the meaning of `usage`: it is the turn-level aggregate of
 * observable per-call provider counters, not the last observed per-call sample.
 */
export interface NotificationCandidate {
  schemaVersion: 2
  sessionId: string
  turn: number
  status: CandidateStatus
  turnEndKind: TurnEndKind
  /** Final visible text, truncated at render time; never reasoning or tool data. */
  visibleText: string
  /** Length of the text before truncation (D014). */
  visibleTextLength: number
  explicitToolErrorCount: number
  telemetryComplete: boolean
  /** Distinct model-call usage reports folded into `usage`. */
  usageSampleCount: number
  /** Accountable model calls observed without a usable usage report (D017). */
  usageMissingCount: number
  /** Retried model calls whose failed attempt reported no usage (D017). */
  usageUnobservableRetries: number
  /** Whether every accountable model call of this turn reported usage (D017). */
  usageComplete: boolean
  /** Epoch ms at which the candidate was constructed. */
  createdAt: number

  turnEndDetail?: string
  reasonDetail?: string
  provider?: string
  model?: string
  assistantMessageId?: string
  /** `null` means unknown, which is not the same claim as `0` (D015). */
  durationMs?: number | null
  /** Turn-level aggregate; absent when no sample was readable (D017). */
  usage?: TurnUsage
  cwd?: string
  /** Collected always, carried only when the candidate is built for rendering. */
  userText?: string
  sawTurnStart?: boolean
}

/** A notification accepted for delivery: one candidate plus its routing facts. */
export interface MailJob {
  candidate: NotificationCandidate
  /** Recipients, already de-duplicated by configuration resolution. */
  to: readonly string[]
  /** Whether the visible text was truncated when this job was built. */
  truncated: boolean
}

/** Classification of a failed send attempt. */
export type RetryClass = 'retry' | 'permanent'

/**
 * Outcome of one sink call.
 *
 * `message` is already redacted, control-character-stripped, and truncated:
 * it never carries a credential and never spans lines (SECURITY.md §4).
 */
export type SendResult =
  | { ok: true }
  | {
      ok: false
      class: RetryClass
      category: string
      message: string
    }

/** The sink contract shared by the real mailer and the debug sink. */
export type MailSink = (job: MailJob) => Promise<SendResult>

/** Network and timeout knobs the mailer needs, resolved and defaulted. */
export interface SmtpConfig {
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPasswordCredential: string
  from: string
  to: readonly string[]
}

/** Bounded retry policy shared by the mailer and the queue. */
export interface RetryPolicy {
  retryAttempts: number
  retryBaseDelayMs: number
  retryMaxDelayMs: number
}

/** Notification policy switches. */
export interface PolicyConfig {
  includeSubagents: boolean
  notifyCompleted: boolean
  notifyErrors: boolean
  notifyMaxTokens: boolean
  minTurnDurationMs: number
}

/** Body composition switches. */
export interface RenderConfig {
  maxBodyChars: number
  includeMetadata: boolean
  includeUserPrompt: boolean
  includeFooter: boolean
}

/** Fully resolved configuration: every field is present, none is `undefined`. */
export interface ResolvedConfig {
  enabled: boolean
  smtp: SmtpConfig
  policy: PolicyConfig
  render: RenderConfig
  retry: RetryPolicy
  queueSize: number
  maxDedupeEntries: number
  /** True when the operator asked for mail but the SMTP fields are unusable. */
  smtpConfigured: boolean
  /** Field-level and cross-field warnings; never blocks activation. */
  warnings: readonly string[]
  /** Field-level failures; a non-empty list means the plugin must not mount. */
  errors: readonly string[]
}

/** Result of a lossless-JSON normalization pass. */
export interface NormalizeResult<T> {
  value: T
  /** Dotted paths of fields that were omitted, in emission order. */
  dropped: readonly string[]
}
