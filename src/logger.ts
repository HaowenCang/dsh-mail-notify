/**
 * The single structured-logging exit.
 *
 * Two properties make this more than a thin wrapper. First, every payload is
 * normalized on the way out, so one unreadable field cannot make a record
 * unreadable — the failure mode that cost Phase 1 its only evidence channel.
 * Second, the field allow-list is enforced here rather than trusted to callers:
 * there is no method that accepts a full visible text, reasoning text, tool
 * argument, tool result, or credential, which is what keeps the rule
 * "credentials never reach a log" a property of the code instead of a habit.
 *
 * @module dsh-mail-notify/logger
 */

import { normalize, stableJsonLine } from './normalize.ts'

/** The four severity methods a Cordis logger exposes. */
export interface LoggerLike {
  error(format: unknown, ...params: unknown[]): void
  warn(format: unknown, ...params: unknown[]): void
  info(format: unknown, ...params: unknown[]): void
  debug(format: unknown, ...params: unknown[]): void
}

/** One recorded log line: the event name plus its normalized, scalar fields. */
export interface LogRecord {
  level: 'error' | 'warn' | 'info' | 'debug'
  /** Dotted event name, e.g. `candidate.produced`. */
  event: string
  fields: Record<string, unknown>
  /** Normalization diagnostics, kept out of the logged payload itself. */
  dropped: readonly string[]
  droppedCount: number
}

/**
 * Structured logger over an optional Cordis logger.
 *
 * @example
 * ```ts
 * const logger = createLogger(ctx.logger(name))
 * logger.info('queue.enqueued', { depth: 1 })
 * ```
 */
export class PluginLogger {
  private readonly sink: LoggerLike | undefined
  private readonly records: LogRecord[] = []
  private readonly maxRecords: number
  private sequence = 0

  /**
   * @param sink - the underlying Cordis logger; absent in unit tests.
   * @param maxRecords - retained record cap, so the buffer stays bounded.
   */
  constructor(sink?: LoggerLike, maxRecords = 500) {
    this.sink = sink
    this.maxRecords = maxRecords
  }

  /**
   * Write one structured record.
   *
   * @param level - severity.
   * @param event - dotted event name.
   * @param fields - scalar fields; normalized before emission.
   */
  log(level: LogRecord['level'], event: string, fields: Record<string, unknown> = {}): void {
    const { value, dropped, droppedCount } = normalize<Record<string, unknown>>(fields)
    const record: LogRecord = { level, event, fields: value, dropped, droppedCount }
    this.sequence += 1

    if (this.maxRecords > 0) {
      this.records.push(record)
      if (this.records.length > this.maxRecords) this.records.shift()
    }

    if (this.sink === undefined) return
    const line = `${event} ${stableJsonLine(value)}`
    // Cordis loggers accept printf-style arguments; passing the payload as a
    // single argument keeps the record one line and free of format directives.
    this.sink[level](line)
  }

  /** @param event - dotted event name. @param fields - scalar fields. */
  debug(event: string, fields?: Record<string, unknown>): void {
    this.log('debug', event, fields)
  }

  /** @param event - dotted event name. @param fields - scalar fields. */
  info(event: string, fields?: Record<string, unknown>): void {
    this.log('info', event, fields)
  }

  /** @param event - dotted event name. @param fields - scalar fields. */
  warn(event: string, fields?: Record<string, unknown>): void {
    this.log('warn', event, fields)
  }

  /** @param event - dotted event name. @param fields - scalar fields. */
  error(event: string, fields?: Record<string, unknown>): void {
    this.log('error', event, fields)
  }

  /**
   * The retained record buffer, in emission order.
   *
   * This exists so tests can assert *absence* — that no record carries a
   * reasoning sentinel or a password — rather than only asserting presence.
   *
   * @returns the retained records.
   */
  getRecords(): readonly LogRecord[] {
    return this.records
  }

  /** Drop every retained record; used when unloading. */
  clearRecords(): void {
    this.records.length = 0
  }

  /** Monotonic count of records emitted, including ones already evicted. */
  get emitted(): number {
    return this.sequence
  }

  /**
   * The whole buffer rendered as one searchable string.
   *
   * @returns a newline-joined rendering of every retained record.
   */
  render(): string {
    return this.records.map((record) => `${record.level} ${record.event} ${stableJsonLine(record.fields)}`).join('\n')
  }
}

/**
 * Build a plugin logger.
 *
 * @param sink - optional Cordis logger; omit in tests.
 * @param maxRecords - retained record cap.
 * @returns the logger.
 */
export function createLogger(sink?: LoggerLike, maxRecords = 500): PluginLogger {
  return new PluginLogger(sink, maxRecords)
}
