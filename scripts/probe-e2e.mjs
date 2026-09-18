/**
 * The Phase 8 end-to-end probe.
 *
 * It starts a loopback SMTP server, boots the real DSH `headless` profile with
 * the probe overlays, runs one task, and then reports what the mail system
 * actually received. Nothing about the plugin is stubbed: the run goes through
 * the real agent loop, the real `ask_user_question` tool, the real
 * `ctx.userQuestions` blocking call, the real session log, the plugin's own
 * listeners, its queue, its mailer, and a real SMTP conversation.
 *
 * The probe replaces exactly two things, and both are named in its output: the
 * human (an answerer plugin) and the SMTP server's identity (loopback, no TLS,
 * no authentication, nothing forwarded).
 *
 * Usage:
 *   node scripts/probe-e2e.mjs <questions|errors|approvals> "<task>"
 *
 * @module dsh-mail-notify/scripts/probe-e2e
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const probeHome = join(projectRoot, 'tmp', 'probe', 'home')
const outDir = join(projectRoot, 'tmp', 'probe', 'out')
const smtpPort = 2525
/** The synthetic SMTP password the probe resolves; never a real secret. */
const smtpPassword = 'PROBE_SMTP_PASSWORD_NOT_A_REAL_SECRET'

/**
 * The DSH installation root — the directory holding `node_modules/@deepseek-ai`.
 *
 * The boot probe defaults to `<DSH_HOME>/..`, which for the disposable probe home
 * is inside the project. Resolving it from the operator's own DSH home instead
 * keeps the probe pointed at the real installation while its `DSH_HOME` stays
 * disposable.
 *
 * @returns the install root path.
 */
function resolveInstallRoot() {
  const explicit = process.env['DSH_INSTALL_ROOT']
  if (explicit !== undefined && explicit !== '') return explicit
  return dirname(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'))
}

const installRoot = resolveInstallRoot()

const scenario = process.argv[2]
const task = process.argv[3]
if (scenario === undefined || task === undefined) {
  process.stderr.write('usage: node scripts/probe-e2e.mjs <questions|errors|approvals> "<task>"\n')
  process.exit(2)
}

mkdirSync(outDir, { recursive: true })

// The probe home is created fresh for every run. It holds the profile the boot
// launcher materializes, the session store, and the credential document — all
// writable paths, all disposable, and all outside the operator's own DSH home.
// An earlier run's state could otherwise let a notification this run did not
// produce look like one it did.
for (const name of ['', 'sessions', 'storages', 'profiles', 'profiles/headless']) {
  mkdirSync(join(probeHome, name), { recursive: true })
}
writeFileSync(
  join(probeHome, '.credentials.yaml'),
  'version: 1\nrefs: {}\nrecords: {}\n',
  'utf8',
)

/** Every message the loopback server accepted, as raw DATA. */
const received = []

/**
 * Start the loopback SMTP server.
 *
 * It speaks just enough of the protocol for one Nodemailer client: greeting,
 * EHLO with the capability set the plugin's transport asks for, AUTH, and one
 * message per MAIL/RCPT/DATA exchange. It never relays and never listens beyond
 * the loopback interface.
 *
 * @returns a promise resolving to the server and a stop function.
 */
function startSmtp() {
  const server = createServer((socket) => {
    let inData = false
    let buffer = ''
    let message = ''
    socket.write('220 probe.local ESMTP probe\r\n')

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const index = buffer.indexOf('\r\n')
        if (index === -1) break
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)

        if (inData) {
          if (line === '.') {
            received.push(message)
            message = ''
            inData = false
            socket.write('250 2.0.0 Ok: queued as PROBE\r\n')
          } else {
            // Undo dot-stuffing, the one transformation SMTP applies to DATA.
            message += `${line.startsWith('..') ? line.slice(1) : line}\n`
          }
          continue
        }

        const upper = line.toUpperCase()
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-probe.local\r\n250-AUTH PLAIN LOGIN\r\n250-SIZE 10485760\r\n250 8BITMIME\r\n')
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

  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(smtpPort, '127.0.0.1', () => resolvePromise(server))
  })
}

/**
 * Run the booted profile to completion.
 *
 * @param patches - overlay files, applied in order after the profile layer.
 * @param scriptPath - the scripted model's turn list for this scenario.
 * @param mailConfig - the plugin settings this run applies, as one JSON document.
 * @returns the child's exit code and its captured stdio.
 */
function runProfile(patches, scriptPath, mailConfig) {
  const args = ['--profile', 'headless']
  for (const patch of patches) args.push('--patch', patch)

  return new Promise((resolvePromise) => {
    // The boot probe's `--` separator is what forwards the rest verbatim to the
    // booted app; without it the task positional is swallowed by the probe's own
    // argument parser and the profile starts with no task at all.
    const child = spawn(process.execPath, [join(here, 'dev-boot-probe.mjs'), ...args, '--', task], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DSH_HOME: probeHome,
        // The operator's own DSH home supplies the installation; the probe home
        // above supplies every writable path. Neither touches the other.
        DSH_INSTALL_ROOT: installRoot,
        PROBE_ROOT: projectRoot,
        PROBE_ANSWER_TRACE: join(outDir, 'answer-trace.log'),
        // The scripted model's turn list travels in the environment because the
        // loader row receives no custom invocation surface of its own.
        PROBE_SCRIPT: scriptPath,
        // The plugin's settings, as the JSON document the overlay row reads. The
        // probe prints the same document before booting, so what took effect and
        // what was reported cannot diverge.
        PROBE_MAIL_CONFIG: JSON.stringify(mailConfig),
        PROBE_SMTP_PASSWORD: smtpPassword,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      err += chunk.toString('utf8')
    })
    child.on('close', (code) => resolvePromise({ code, out, err }))
  })
}

/**
 * Unfold a header block into `name: value` pairs.
 *
 * A long header is folded across lines that begin with whitespace, and each
 * fragment of an RFC 2047 encoded value is a complete encoded word on its own
 * line. Reading only the first line would report a truncated subject that the
 * mail system never received, so the folding is undone before anything is
 * decoded — that ordering matters, because the encoded words must be joined
 * before they can be decoded.
 *
 * @param block - the raw header block, without the body.
 * @returns one entry per header field, values already unfolded.
 */
function parseHeaders(block) {
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
 * each word encodes a fragment of one string, and the encoder inserted a fold
 * (or a space) purely to satisfy line-length limits. Leaving it in would report
 * `Choos e Mode` for a subject the mail system holds as `Choose Mode`, and every
 * fragment is a complete word, so `B` and `Q` may differ within one value.
 *
 * @param value - the unfolded header value.
 * @returns the decoded value.
 */
function decodeEncodedWords(value) {
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
function decodeQuotedPrintable(text) {
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
 * body instead would report quoted-printable soft breaks as content, which
 * looks like corruption the mail system never produced.
 *
 * @param raw - the raw message, headers and body.
 * @returns the decoded subject and the decoded plain-text body.
 */
function parseMessage(raw) {
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
  const transfer = (legacy ? lookup('Content-Transfer-Encoding') : parseHeaders(partHeaders).find((f) => f.toLowerCase().startsWith('content-transfer-encoding:'))?.split(':').slice(1).join(':').trim() ?? '').toLowerCase()

  const body = transfer === 'base64' ? Buffer.from(partBody.replace(/\s+/g, ''), 'base64').toString('utf8') : transfer === 'quoted-printable' ? decodeQuotedPrintable(partBody) : partBody
  return { subject, body }
}

/**
 * The scripted model's turn list for one scenario.
 *
 * Each entry is one model call. The script is what makes the probe deterministic
 * and credential-free: the loop, the tools, the session log, and the plugin all
 * take the production path, and only the tokens come from this table.
 *
 * @param name - the scenario name.
 * @returns one entry per model call, in order.
 */
function scriptFor(name) {
  const question = {
    tool: 'ask_user_question',
    arguments: JSON.stringify({
      questions: [
        {
          id: 'mode',
          header: 'Choose Mode',
          question: 'Which implementation should be used?',
          options: [
            { label: 'A', description: 'The first implementation.' },
            { label: 'B', description: 'The second implementation.' },
          ],
        },
      ],
    }),
  }

  switch (name) {
    case 'questions':
      // One question, then the agent continues and finishes. Producing exactly
      // two messages is what proves the question's dedupe namespace did not
      // consume the turn's.
      return [question, 'Implementation A was chosen; the task is complete.']

    case 'errors':
      // DSH's own retry policy decides whether a failure is retried, and the
      // probe's provider declares no policy, so this is a terminal failure.
      return [{ fail: { message: 'the provider reported an exhausted quota', code: 'QUOTA', status: 402 } }]

    case 'approvals':
      // A shell command that writes outside the probe's workspace root. The
      // sandbox policy escalates that, and an escalation is what makes the
      // approval service append `approval/asked` before the command runs. A
      // command inside the workspace needs no decision, so it would prove
      // nothing — the first version of this scenario made exactly that mistake.
      return [
        {
          tool: 'pwsh',
          arguments: JSON.stringify({
            command: `Set-Content -Path '${join(outDir, 'approval-proof.txt')}' -Value probe-approval`,
          }),
        },
        'The shell command ran under a one-shot approval.',
      ]

    default:
      return ['The script defines nothing for this scenario.']
  }
}

/**
 * The plugin settings one scenario runs under.
 *
 * The whole document is built here rather than split across YAML files, so the
 * switches the probe reports are the switches that were applied: a second copy
 * in an overlay could drift from this one without anything noticing.
 *
 * @param name - the scenario name.
 * @returns the resolved plugin configuration.
 */
function mailConfigFor(name) {
  const switches = {
    questions: { notifyCompleted: true, notifyErrors: false, notifyMaxTokens: true, notifyQuestions: true, notifyApprovals: false },
    errors: { notifyCompleted: true, notifyErrors: true, notifyMaxTokens: true, notifyQuestions: false, notifyApprovals: false },
    approvals: { notifyCompleted: true, notifyErrors: false, notifyMaxTokens: true, notifyQuestions: false, notifyApprovals: true },
  }[name]

  return {
    enabled: true,
    smtpHost: '127.0.0.1',
    smtpPort: smtpPort,
    smtpSecure: false,
    smtpUser: 'probe@example.invalid',
    smtpPasswordCredential: 'credentials/smtp-password',
    from: 'probe@example.invalid',
    to: ['recipient@example.invalid'],
    includeSubagents: false,
    minTurnDurationMs: 0,
    maxBodyChars: 100_000,
    includeMetadata: true,
    includeUserPrompt: false,
    includeFooter: true,
    queueSize: 100,
    retryAttempts: 1,
    retryBaseDelayMs: 200,
    maxDedupeEntries: 1000,
    ...switches,
  }
}

const server = await startSmtp()
process.stdout.write(`[probe] loopback SMTP listening on 127.0.0.1:${smtpPort}\n`)

const patches = [join(here, 'probe', 'overlay-base.yml')]
const scriptPath = join(outDir, `script-${scenario}.json`)
writeFileSync(scriptPath, `${JSON.stringify(scriptFor(scenario), null, 2)}\n`, 'utf8')
const result = await runProfile(patches, scriptPath, mailConfigFor(scenario))

// The notification queue is asynchronous: the run may print its answer before
// the last message is delivered. Waiting is what makes the count meaningful.
await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))
server.close()

const messages = received.map(parseMessage)
// The raw DATA is kept as well as the decoded form: a decoding bug in this
// probe must not be able to masquerade as a truncation bug in the plugin, and
// the only way to tell them apart afterwards is to keep both.
writeFileSync(join(outDir, `smtp-raw-${scenario}.log`), received.join('\n\n=== MESSAGE ===\n\n'), 'utf8')
writeFileSync(join(outDir, `smtp-${scenario}.json`), `${JSON.stringify(messages, null, 2)}\n`, 'utf8')
writeFileSync(join(outDir, `stdout-${scenario}.log`), result.out, 'utf8')
writeFileSync(join(outDir, `stderr-${scenario}.log`), result.err, 'utf8')

process.stdout.write(
  [
    `[probe] scenario: ${scenario}`,
    `[probe] child exit code: ${result.code}`,
    `[probe] messages received: ${messages.length}`,
    ...messages.map((message, index) => `[probe]   ${index + 1}. ${message.subject}`),
    `[probe] artifacts: ${outDir}`,
    '',
  ].join('\n'),
)
process.exit(result.code === 0 && messages.length > 0 ? 0 : 1)
