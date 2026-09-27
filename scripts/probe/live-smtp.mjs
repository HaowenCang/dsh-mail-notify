/**
 * A loopback SMTP receiver for the live-configuration probe.
 *
 * It exists so that a Web-driven configuration change can be observed *as mail*,
 * which is the only evidence that a volatile write reached the running
 * notification engine rather than merely reaching the profile file. The
 * alternative — reading the plugin's own status endpoint — would report what the
 * plugin believes about itself, which is exactly what the probe must not take on
 * trust.
 *
 * It speaks just enough SMTP for one Nodemailer client, never relays, and
 * listens only on the loopback interface. Every accepted message is appended to
 * a JSON file, so the probe can read the receipts after the fact.
 *
 * Usage:
 *   node scripts/probe/live-smtp.mjs <port> <receipts.json> [sentinel]
 *
 * @module dsh-mail-notify/scripts/probe/live-smtp
 */

import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'

const port = Number(process.argv[2] ?? '0')
const receiptsPath = process.argv[3]
const sentinelPath = process.argv[4]
if (!Number.isInteger(port) || port <= 0 || receiptsPath === undefined) {
  process.stderr.write('usage: node live-smtp.mjs <port> <receipts.json> [sentinel]\n')
  process.exit(2)
}

/** One line per accepted message, appended as it arrives. */
writeFileSync(receiptsPath, '', 'utf8')

const server = createServer((socket) => {
  let inData = false
  let buffer = ''
  let message = ''
  socket.write('220 live-probe.local ESMTP probe\r\n')

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    for (;;) {
      const index = buffer.indexOf('\r\n')
      if (index === -1) break
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)

      if (inData) {
        if (line === '.') {
          // The subject alone is what the probe asserts on; the body is kept
          // out of the receipt so a run cannot accumulate message text.
          const subjectLine = message.split('\n').find((entry) => /^subject:/i.test(entry)) ?? ''
          appendFileSync(
            receiptsPath,
            `${JSON.stringify({ at: Date.now(), bytes: message.length, subject: subjectLine.replace(/^subject:\s*/i, '').trim() })}\n`,
            'utf8',
          )
          message = ''
          inData = false
          socket.write('250 2.0.0 Ok: queued as LIVE\r\n')
          if (sentinelPath !== undefined) {
            try {
              writeFileSync(sentinelPath, `${Date.now()}\n`, 'utf8')
            } catch {
              // An unwritable sentinel leaves the probe on its own timeout.
            }
          }
        } else {
          message += `${line.startsWith('..') ? line.slice(1) : line}\n`
        }
        continue
      }

      const upper = line.toUpperCase()
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        socket.write('250-live-probe.local\r\n250-AUTH PLAIN LOGIN\r\n250-SIZE 10485760\r\n250 8BITMIME\r\n')
      } else if (upper.startsWith('AUTH')) {
        socket.write('235 2.7.0 Authentication successful\r\n')
      } else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO')) {
        socket.write('250 2.1.0 Ok\r\n')
      } else if (upper.startsWith('DATA')) {
        inData = true
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
      } else if (upper.startsWith('QUIT')) {
        socket.write('221 2.0.0 Bye\r\n')
        socket.end()
      } else {
        socket.write('250 2.0.0 Ok\r\n')
      }
    }
  })
  socket.on('error', () => undefined)
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`live-smtp listening on 127.0.0.1:${port}\n`)
})
