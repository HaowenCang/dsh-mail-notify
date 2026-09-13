/**
 * Lossless-JSON normalization.
 *
 * Every structured object that leaves this plugin — log payloads, queue
 * entries, candidate records, debug-exit output — passes through here first.
 * The requirement is not stylistic: the Phase 1 prototype lost its only
 * evidence channel because one object carried a single `undefined` field, and
 * a single unreadable record invalidated the whole batch.
 *
 * Omitting a field and swallowing an exception are different acts. This module
 * omits fields and *reports* what it omitted, so "the runtime did not report
 * this counter" stays distinguishable from "the plugin lost data".
 *
 * @module dsh-mail-notify/normalize
 */

/** Bound on reported paths; the count stays exact beyond it. */
export const MAX_DROPPED_PATHS = 64

/** Accumulator shared by one normalization pass. */
class PathRecorder {
  readonly paths: string[] = []
  count = 0

  record(path: string): void {
    this.count += 1
    if (path !== '' && this.paths.length < MAX_DROPPED_PATHS) this.paths.push(path)
  }
}

/** Whether a value is a plain object: prototype `Object.prototype` or `null`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/**
 * Join a parent path and a key using dots.
 *
 * @param base - the parent path; empty at the root.
 * @param key - the child key.
 * @returns the dotted path.
 */
function joinPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`
}

/**
 * Canonicalize a value into lossless JSON, reporting omitted paths.
 *
 * Omitted, per the Phase 1 rule table: `undefined` (silently, it is normal),
 * `NaN` / `Infinity` (reported), functions / symbols / bigints (reported),
 * non-plain objects such as class instances, `Map`, `Set`, and `Date`
 * (reported). Arrays drop omitted slots and keep the remaining items in order;
 * cycles are not supported, matching the runtime data this plugin consumes.
 *
 * @param input - any value at all; nothing about it is trusted.
 * @returns the normalized value and the dotted paths omitted on the way.
 */
export function normalize<T = unknown>(input: unknown): { value: T; dropped: readonly string[]; droppedCount: number } {
  const recorder = new PathRecorder()

  const walk = (value: unknown, path: string): unknown => {
    if (value === null) return null

    switch (typeof value) {
      case 'string':
      case 'boolean':
        return value
      case 'number':
        if (Number.isFinite(value)) return value
        recorder.record(path)
        return undefined
      case 'undefined':
        // A key that is present and undefined is normal absence: it still
        // counts, and its path is reported so a caller can see which optional
        // field the runtime left out. Nothing is coerced.
        recorder.record(path)
        return undefined
      case 'bigint':
      case 'symbol':
      case 'function':
        recorder.record(path)
        return undefined
      default:
        break
    }

    if (Array.isArray(value)) {
      const out: unknown[] = []
      for (let index = 0; index < value.length; index += 1) {
        const item = walk(value[index], joinPath(path, String(index)))
        if (item !== undefined) out.push(item)
      }
      return out
    }

    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(value)) {
        const item = walk(value[key], joinPath(path, key))
        if (item !== undefined) out[key] = item
      }
      return out
    }

    // Class instance, Map, Set, Date, Promise, or anything else with a shape
    // this contract cannot represent. Omitted whole, never coerced.
    recorder.record(path)
    return undefined
  }

  const value = walk(input, '')
  return { value: value as T, dropped: recorder.paths, droppedCount: recorder.count }
}

/**
 * Whether a value survives a lossless-JSON round trip unchanged.
 *
 * Used by tests and by the debug exit to prove that what is emitted is
 * readable, rather than assuming it.
 *
 * @param value - the candidate output.
 * @returns true when every nested value is a scalar, array, or plain object.
 */
export function isLosslessJson(value: unknown): boolean {
  if (value === null) return true
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      return false
    default:
      break
  }
  if (Array.isArray(value)) return value.every((item) => isLosslessJson(item))
  if (isPlainObject(value)) return Object.values(value).every((item) => isLosslessJson(item))
  return false
}

/** A structural summary for diagnostics: scalars only, never the value itself. */
export interface ValueShape {
  type: string
  keys?: readonly string[]
  length?: number
}

/**
 * Describe a value's shape without disclosing its content.
 *
 * @param value - the value to describe.
 * @returns a scalar-only description safe to log.
 */
export function describeShape(value: unknown): ValueShape {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (isPlainObject(value)) return { type: 'object', keys: Object.keys(value).slice(0, 16) }
  const type = typeof value
  if (type === 'object') {
    const name = (value as object).constructor?.name
    return { type: typeof name === 'string' && name !== '' ? name : 'object' }
  }
  return { type }
}

/** A one-line, control-character-free rendering of a value, for log messages. */
export function stableJsonLine(value: unknown): string {
  const { value: normalized } = normalize(value)
  let text: string
  try {
    text = JSON.stringify(normalized) ?? 'null'
  } catch {
    text = '[unserializable]'
  }
  // JSON escapes newlines but not U+2028/U+2029, either of which would still
  // break a line-oriented reader, so all separator characters are flattened.
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
}
