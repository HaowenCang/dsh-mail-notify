/**
 * Visible-text extraction and truncation.
 *
 * This module is the single implementation point of D002. The whitelist is not
 * a stylistic choice: `reasoning` blocks carry a field named `text` exactly as
 * `text` blocks do, so any read keyed on the field name would put private
 * reasoning into an outbound email. `ContentBlockMap` is merge-extensible, so
 * unknown block types are a normal, designed-for event, and the safe default
 * for them is exclusion.
 *
 * @module dsh-mail-notify/content
 */

/** Marker appended when the visible text had to be truncated (D014). */
export const TRUNCATION_MARKER = '[Output truncated by dsh-mail-notify]'

/** Result of a truncation pass. */
export interface TruncateResult {
  text: string
  truncated: boolean
  /** Length in code points of the input, measured after truncation occurred. */
  originalLength: number
}

/** Whether a value is a text block, the only block type admitted to a body. */
function isTextBlock(value: unknown): value is { type: 'text'; text: string } {
  if (typeof value !== 'object' || value === null) return false
  const block = value as { type?: unknown; text?: unknown }
  return block.type === 'text' && typeof block.text === 'string'
}

/**
 * Extract the user-visible text of one assistant message.
 *
 * The whitelist admits `type === 'text'` and nothing else. `reasoning`,
 * `tool-call`, `tool-result`, `image`, `file`, and every unknown type are
 * skipped silently. Multiple text blocks are joined with a newline; empty and
 * whitespace-only blocks are dropped so joining cannot produce blank lines.
 *
 * @param blocks - the runtime content array; its shape is not trusted.
 * @returns the visible text, or `''` when there is none. Never throws.
 */
export function extractVisibleText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (!isTextBlock(block)) continue
    if (block.text.trim() === '') continue
    parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Truncate text to a maximum number of code points.
 *
 * Truncation is by code point, never by byte or by UTF-16 unit: cutting inside
 * a surrogate pair would emit a lone surrogate and corrupt the email encoding.
 *
 * @param text - the text to bound.
 * @param maxChars - the inclusive maximum, counted in code points.
 * @returns the bounded text and whether truncation happened.
 */
export function truncateVisibleText(text: string, maxChars: number): TruncateResult {
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0
  const points = Array.from(text)
  const originalLength = points.length
  if (originalLength <= limit) return { text, truncated: false, originalLength }
  return { text: points.slice(0, limit).join(''), truncated: true, originalLength }
}

/**
 * Measure a string in code points, matching the unit `truncateVisibleText` bounds.
 *
 * @param text - the text to measure.
 * @returns the number of code points.
 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}
