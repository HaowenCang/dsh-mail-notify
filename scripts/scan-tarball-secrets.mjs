#!/usr/bin/env node
/**
 * Phase 6.1 tarball secret scan.
 *
 * The packed archive is the artefact that actually ships, so it is scanned as a
 * separate surface from the working tree: extraction is to a temporary
 * directory, every entry is compared against the live credential values in both
 * UTF-8 and UTF-16LE, and the same bytes are swept for private-key and
 * credential-shaped literals.
 *
 * Values are read into memory for comparison only. They are never printed, never
 * hashed into a reversible form, and never passed as an argument.
 *
 * Usage: node scan-tarball-secrets.mjs <path-to.tgz> [workDir]
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const archive = resolve(process.argv[2] ?? 'dsh-mail-notify-0.1.1.tgz')
const workDir = process.argv[3] === undefined ? mkdtempSync(join(tmpdir(), 'dsh-mail-secret-scan-')) : resolve(process.argv[3])
mkdirSync(workDir, { recursive: true })

/** Read the flat `refs:` map of the credential store without logging values. */
function readRefs() {
  const text = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
  const refs = {}
  let inRefs = false
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true
      continue
    }
    if (/^\S/.test(line) && line.trim() !== '') {
      inRefs = false
      continue
    }
    if (!inRefs) continue
    const match = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (match !== null && match[2].trim() !== '') refs[match[1]] = match[2].trim()
  }
  return refs
}

const targets = Object.entries(readRefs()).map(([name, value]) => ({
  name,
  utf8: Buffer.from(value, 'utf8'),
  utf16: Buffer.from(value, 'utf16le'),
  digest: createHash('sha256').update(value).digest('hex').slice(0, 8),
  length: value.length,
}))

for (const target of targets) {
  process.stdout.write(`scanning ${target.name}: length=${target.length} sha256_8=${target.digest}\n`)
}

/** Literal shapes that must never appear in a shipping archive. */
const SHAPES = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: 'PEM private key' },
  { pattern: /ssh-rsa\s+[A-Za-z0-9+/=]{100,}/, why: 'SSH public key blob' },
  { pattern: /pass(?:word|wd)?\s*[:=]\s*['"][^'"]{6,}['"]/i, why: 'assigned password literal' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, why: 'AWS access key id' },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/, why: 'bearer-style API key' },
]

execFileSync('tar', ['-xzf', archive, '-C', workDir], { stdio: 'pipe' })

/** Every extracted file, recursively. */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

const files = walk(workDir)
let bytesTotal = 0
let valueHits = 0
let shapeHits = 0

for (const path of files) {
  const bytes = readFileSync(path)
  bytesTotal += bytes.length
  const shown = relative(workDir, path).replace(/\\/g, '/')
  for (const target of targets) {
    if (bytes.includes(target.utf8) || bytes.includes(target.utf16)) {
      valueHits += 1
      process.stdout.write(`HIT ${shown} contains ${target.name}\n`)
    }
  }
  const text = bytes.toString('utf8')
  for (const shape of SHAPES) {
    if (shape.pattern.test(text)) {
      shapeHits += 1
      process.stdout.write(`HIT ${shown} matches ${shape.why}\n`)
    }
  }
}

process.stdout.write(
  `archive: ${files.length} entries, ${bytesTotal} bytes, credential-value hits=${valueHits}, shaped-literal hits=${shapeHits}\n`,
)

if (process.argv[3] === undefined) rmSync(workDir, { recursive: true, force: true })

const verdict = valueHits === 0 && shapeHits === 0
process.stdout.write(`TARBALL SECRET SCAN: ${verdict ? 'PASS' : 'FAIL'}\n`)
process.exitCode = verdict ? 0 : 1
