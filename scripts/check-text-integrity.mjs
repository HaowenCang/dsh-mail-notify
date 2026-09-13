#!/usr/bin/env node
/**
 * Text-integrity guard.
 *
 * It exists because a documentation commit once re-encoded a Markdown file
 * through a lossy path: typographic characters were replaced by CJK-looking
 * sequences and a byte order mark appeared at the start of the file. Nothing in
 * the build or the test suite noticed, because nothing was checking text as
 * text.
 *
 * Three independent checks are run over every text source file:
 *
 * 1. **Strict UTF-8.** The bytes must round-trip through a strict UTF-8 decoder.
 *    A lone continuation byte or a truncated sequence is reported with its byte
 *    offset rather than being silently replaced by U+FFFD.
 * 2. **No replacement character.** U+FFFD in the decoded text means something
 *    already lost data on the way in.
 * 3. **No known mojibake sentinel.** The sequences a UTF-8 round trip through a
 *    legacy code page produces.
 *
 * The sentinels are declared as `\u` escapes so that this file stays pure ASCII
 * and therefore cannot trip its own check. The CJK patterns require a following
 * ASCII `?`, and the section-sign pattern requires the actual paired artefact,
 * so ordinary Chinese documentation is not flagged: a bare CJK character is
 * never a match on its own.
 *
 * Run with: npm run check:text
 *
 * @module dsh-mail-notify/scripts/check-text-integrity
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** File extensions treated as text. */
const EXTENSIONS = ['.md', '.ts', '.js', '.mjs', '.json', '.yml', '.yaml']

/** Directories and artefacts that are generated, vendored, or examined elsewhere. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'lib', 'out', 'dist', 'coverage'])

/** Generated archives are binary. */
const SKIP_EXTENSIONS = new Set(['.tgz', '.gz', '.map'])

const REPLACEMENT_CHARACTER = 0xfffd
const BOM = [0xef, 0xbb, 0xbf]

/**
 * Known mojibake artefacts, declared by code point.
 *
 * Each entry is a byte sequence that only a lossy re-encoding produces, taken
 * from the real corruption this guard was written for. The `requires` predicate
 * narrows a pattern that would otherwise be ambiguous: the corrupted dash is
 * always followed by an ASCII `?` because the byte that could not be represented
 * was substituted, so a bare CJK character is never a match on its own and
 * legitimate Chinese documentation is not flagged.
 */
const SENTINELS = [
  {
    label: 'dash or ellipsis re-encoded through a legacy code page',
    text: '\u9225\u003f',
    requires: (haystack, at) => haystack[at + 2] !== '\u003f',
  },
  {
    label: 'dash or ellipsis re-encoded where the next byte completed a sequence',
    text: '\u9225\u63c7',
  },
  {
    label: 'section sign re-encoded through a legacy code page',
    text: '\u6402\u0038',
  },
]

/** The U+FFFD replacement character and the BOM are checked separately. */
const FORBIDDEN_CHARACTERS = [{ label: 'U+FFFD replacement character', codePoint: REPLACEMENT_CHARACTER }]

/** Every text file below `root`, as repository-relative POSIX paths. */
function collectFiles(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue
      collectFiles(join(directory, entry.name), found)
      continue
    }
    if (!entry.isFile()) continue
    const extension = entry.name.slice(entry.name.lastIndexOf('.'))
    if (!EXTENSIONS.includes(extension)) continue
    if (SKIP_EXTENSIONS.has(extension)) continue
    found.push(join(directory, entry.name))
  }
  return found
}

/**
 * Decode a file strictly, reporting the offset of the first invalid sequence.
 *
 * `TextDecoder` with `fatal: true` throws on malformed input instead of
 * substituting U+FFFD, which is the difference between detecting a problem and
 * hiding it.
 *
 * @param bytes - the file's contents.
 * @returns the decoded text, or the byte offset that failed.
 */
function decodeStrict(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    return { text: decoder.decode(bytes) }
  } catch {
    // Locate the first offending byte so the report is actionable.
    for (let offset = 0; offset < bytes.length; offset += 1) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset + 1))
      } catch {
        return { errorAt: offset }
      }
    }
    return { errorAt: bytes.length - 1 }
  }
}

/** Whether the buffer begins with a UTF-8 byte order mark. */
function hasBom(bytes) {
  return bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2]
}

/** Find every position of `needle` in `haystack`. */
function occurrences(haystack, needle) {
  const positions = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return positions
    positions.push(at)
    from = at + 1
  }
}

/** The 1-based line and column of a character offset. */
function locate(text, offset) {
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - (before.lastIndexOf('\n') + 1) + 1
  return { line, column }
}

const problems = []
const files = collectFiles(root).sort()

for (const absolute of files) {
  const display = relative(root, absolute).split('\\').join('/')
  const bytes = readFileSync(absolute)

  if (hasBom(bytes)) {
    problems.push({ file: display, what: 'starts with a UTF-8 byte order mark' })
  }

  const decoded = decodeStrict(bytes)
  if (decoded.errorAt !== undefined) {
    const line = bytes.subarray(0, decoded.errorAt).toString('latin1').split('\n').length
    problems.push({ file: display, what: `is not valid UTF-8 (first bad byte at offset ${decoded.errorAt}, line ~${line})` })
    continue
  }

  const text = decoded.text
  if (text.charCodeAt(0) === REPLACEMENT_CHARACTER) {
    problems.push({ file: display, what: 'begins with a replacement character' })
  }

  for (const rule of FORBIDDEN_CHARACTERS) {
    for (const at of occurrences(text, String.fromCharCode(rule.codePoint))) {
      const { line, column } = locate(text, at)
      problems.push({ file: display, what: `contains a ${rule.label} at ${line}:${column}` })
    }
  }

  for (const sentinel of SENTINELS) {
    for (const at of occurrences(text, sentinel.text)) {
      if (sentinel.requires !== undefined && !sentinel.requires(text, at)) continue
      const { line, column } = locate(text, at)
      problems.push({ file: display, what: `${sentinel.label} at ${line}:${column}` })
    }
  }
}

console.log(`check-text-integrity: scanned ${files.length} text files`)

if (problems.length === 0) {
  console.log('PASS: every file is strict UTF-8, BOM-free, and free of known mojibake')
  process.exitCode = 0
} else {
  console.error('FAIL')
  for (const problem of problems) console.error(`  - ${problem.file} ${problem.what}`)
  process.exitCode = 1
}

// A file-count sanity check: a scan that silently found nothing would otherwise
// report success.
if (files.length < 10) {
  console.error(`FAIL: only ${files.length} files were scanned; the walker is not reaching the repository`)
  process.exitCode = 1
}
