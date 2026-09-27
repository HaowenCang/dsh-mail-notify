/**
 * Shared SMTP decoding for the probes.
 *
 * The probes assert on what the mail system actually received, so they read the
 * message the way a mail client does rather than the way it happens to sit on
 * the wire. Two encodings stand between the two and both have to be undone
 * before an assertion means anything: headers are RFC 2047 encoded words, and a
 * body may be quoted-printable.
 *
 * Folding is undone *before* the encoded words are joined: a long header is
 * folded across lines that begin with whitespace, and each fragment of an
 * RFC 2047 value is a complete encoded word on its own line. Decoding first
 * would leave the fold in the value, so a subject the mail system holds as
 * `Choose Mode` would read as `Choos e Mode`.
 *
 * @module dsh-mail-notify/scripts/probe/smtp-decode
 */

/**
 * Unfold a header block into `name:value` pairs.
 *
 * @param block - the raw header block, without the body.
 * @returns one entry per header field, values already unfolded.
 */
export function parseHeaders(block) {
  const fields = []
  for (const line of block.split('\n')) {
    if (/^[ \t]/.test(line) && fields.length > 0) {
      fields[fields.length - 1] += ` ${line.trim()}`
      continue
    }
    const separator = line.indexOf(':')
    if (separator === -1) continue
    fields.push(`${line.slice(0, separator)}:${line.slice(separator + 1).trim()}`)
  }
  return fields
}

/**
 * Decode RFC 2047 encoded words in a header value.
 *
 * The whitespace between two adjacent encoded words is not part of the value:
 * each word encodes a fragment of one string and the fold was inserted to
 * satisfy a line-length limit. Every fragment is a complete word, so `B` and `Q`
 * may differ within one value.
 *
 * @param value - the unfolded header value.
 * @returns the decoded value.
 */
export function decodeEncodedWords(value) {
  return value
    .replace(/\?=[ \t]+=\?/g, '?==?')
    .replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_all, mode, payload) => {
      if (mode.toUpperCase() === 'B') return Buffer.from(payload, 'base64').toString('utf8')
      // Q encoding: `_` is a space and `=XX` is one byte.
      const bytes = payload
        .replace(/_/g, ' ')
        .replace(/=([0-9A-F]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      return Buffer.from(bytes, 'latin1').toString('utf8')
    })
}

/**
 * Undo quoted-printable: soft line breaks disappear, `=XX` is one byte.
 *
 * @param text - the encoded body text.
 * @returns the decoded text.
 */
export function decodeQuotedPrintable(text) {
  return Buffer.from(
    text
      .replace(/=(?:\r?\n)/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))),
    'latin1',
  ).toString('utf8')
}

/**
 * Pull the two facts a mail reader cares about out of one raw SMTP DATA blob.
 *
 * The message is `multipart/alternative`, so the plain-text part is selected by
 * its MIME boundary and decoded by its own transfer encoding. Reading the raw
 * body instead would report quoted-printable soft breaks as content, which looks
 * like corruption the mail system never produced.
 *
 * @param entry - the accepted message and its arrival time.
 * @returns the decoded subject, body, received time, and arrival order.
 */
export function parseMessage(entry) {
  const raw = entry.raw
  const separator = raw.indexOf('\n\n')
  const headerBlock = separator === -1 ? raw : raw.slice(0, separator)
  const bodyRaw = separator === -1 ? '' : raw.slice(separator + 2)
  const fields = parseHeaders(headerBlock)

  const lookup = (name) => {
    const prefix = `${name.toLowerCase()}:`
    const found = fields.find((field) => field.toLowerCase().startsWith(prefix))
    return found === undefined ? '' : found.slice(prefix.length).trim()
  }

  const subject = decodeEncodedWords(lookup('Subject')).trim()

  const boundary = lookup('Content-Type').match(/boundary="?([^";]+)"?/)?.[1]
  let part = bodyRaw
  let legacy = true
  if (boundary !== undefined) {
    // The first part after the opening delimiter is the text/plain alternative;
    // the plugin's messages declare it first.
    const marker = `--${boundary}`
    const start = bodyRaw.indexOf(marker)
    const partStart = bodyRaw.indexOf('\n', start) + 1
    const end = bodyRaw.indexOf(`\n${marker}`, partStart)
    part = bodyRaw.slice(partStart, end === -1 ? undefined : end)
    legacy = false
  }

  const partSeparator = part.indexOf('\n\n')
  const partHeaders = legacy ? '' : part.slice(0, partSeparator === -1 ? part.length : partSeparator)
  const inline = partSeparator === -1 ? '' : part.slice(partSeparator + 2)
  const partBody = legacy ? part : inline
  const transfer = (
    legacy
      ? lookup('Content-Transfer-Encoding')
      : (parseHeaders(partHeaders)
          .find((f) => f.toLowerCase().startsWith('content-transfer-encoding:'))
          ?.split(':')
          .slice(1)
          .join(':')
          .trim() ?? '')
  ).toLowerCase()

  const body =
    transfer === 'base64'
      ? Buffer.from(partBody.replace(/\s+/g, ''), 'base64').toString('utf8')
      : transfer === 'quoted-printable'
        ? decodeQuotedPrintable(partBody)
        : partBody
  return { subject, body, receivedAt: entry.at }
}
