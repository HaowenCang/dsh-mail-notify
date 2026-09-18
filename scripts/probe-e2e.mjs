/**
 * The Phase 8 / 8.1 end-to-end probe.
 *
 * It starts a loopback SMTP server, boots the real DSH `headless` profile with
 * the probe overlays, runs one task, and then reports what the mail system
 * actually received. Nothing about the plugin is stubbed: the run goes through
 * the real agent loop, the real tools, the real `ctx.userQuestions` and
 * `ctx.approval` calls, the real session log, the plugin's own listeners, its
 * queue, its mailer, and a real SMTP conversation.
 *
 * The probe replaces exactly three things, and all three are named in its
 * output: the human (an answerer plugin), the model's tokens (a scripted
 * provider), and the SMTP server's identity (loopback, no TLS, no
 * authentication, nothing forwarded). The credential *service* is also
 * replaced for the mail path, and `probe-credential-contract` boots the shipped
 * one separately so the reference grammar is still checked against the real
 * provider rather than against the double.
 *
 * Usage:
 *   node scripts/probe-e2e.mjs <scenario> "<task>"
 *
 * Scenarios:
 *   questions             ask_user_question, then completion
 *   errors                terminal provider failure
 *   approvals             one in-Turn approval, allowed once
 *   approvals-duplicate   the same, with the audit record replayed afterwards
 *   approvals-rejected    the same, with the answerer rejecting
 *   credentials           the credential-reference contract, on the real store
 *
 * @module dsh-mail-notify/scripts/probe-e2e
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const probeHome = join(projectRoot, 'tmp', 'probe', 'home')
const outDir = join(projectRoot, 'tmp', 'probe', 'out')
const statusDir = join(projectRoot, 'tmp', 'probe', 'status')
/** The synthetic SMTP password the probe resolves; never a real secret. */
const smtpPassword = 'PROBE_SMTP_PASSWORD_NOT_A_REAL_SECRET'
/** The reference the plugin's configuration names, in the DSH CredentialRef grammar. */
const credentialRef = 'DSH_MAIL_SMTP_PASSWORD'
/**
 * An arbitrary tool argument that must never appear in a mail or a log line.
 *
 * DSH's approval contract publishes the tool name, the exact call id, and the
 * asker's reason — never the approved tool's arguments. Supplying a distinctive
 * value here is what makes that verifiable: the assertion downstream is that
 * this string is absent from every body, subject, and captured log line of the
 * run, not merely that no field obviously holds it.
 */
const toolArgumentSentinel = 'PROBE_TOOL_ARGUMENT_SENTINEL_9f2c41'
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
  process.stderr.write('usage: node scripts/probe-e2e.mjs <scenario> "<task>"\n')
  process.exit(2)
}

mkdirSync(outDir, { recursive: true })
mkdirSync(statusDir, { recursive: true })

/**
 * The per-scenario paths, all inside the disposable probe tree.
 *
 * A fixed file name per scenario would let an earlier run's output be read as
 * this run's evidence, so every artefact is deleted before the run starts.
 */
const paths = {
  answerTrace: join(outDir, `answer-trace-${scenario}.log`),
  approvalTrace: join(outDir, `approval-trace-${scenario}.log`),
  approvalId: join(outDir, `approval-id-${scenario}.txt`),
  script: join(outDir, `script-${scenario}.json`),
  credentialReport: join(outDir, `credentials-${scenario}.txt`),
  credentialsFile: join(probeHome, '.credentials.yaml'),
  rawMail: join(outDir, `smtp-raw-${scenario}.log`),
  mail: join(outDir, `smtp-${scenario}.json`),
  stdout: join(outDir, `stdout-${scenario}.log`),
  stderr: join(outDir, `stderr-${scenario}.log`),
  sentinel: join(statusDir, `approval-mail-${scenario}.ready`),
  timeline: join(outDir, `timeline-${scenario}.log`),
}

for (const path of Object.values(paths)) {
  try {
    rmSync(path, { force: true })
  } catch {
    // A path the probe cannot remove is one it must not read as its own; the
    // run continues and the artefact's absence is reported.
  }
}

// The probe home is created fresh for every run. It holds the profile the boot
// launcher materializes, the session store, and the credential document — all
// writable paths, all disposable, and all outside the operator's own DSH home.
// An earlier run's state could otherwise let a notification this run did not
// produce look like one it did.
rmSync(probeHome, { recursive: true, force: true })
for (const name of ['', 'sessions', 'storages', 'profiles', 'profiles/headless']) {
  mkdirSync(join(probeHome, name), { recursive: true })
}

// The one controlled credential source for this run: the shipped file-backed
// store, pointed at the disposable home, holding one reference whose value is
// synthetic. Written here rather than inherited from anything, so a resolution
// the plugin reports cannot be a coincidence of ambient state (§14).
writeFileSync(paths.credentialsFile, `version: 1\nrefs:\n  ${credentialRef}: ${smtpPassword}\nrecords: {}\n`, 'utf8')

/** Every message the loopback server accepted, with the time it was accepted. */
const received = []

/**
 * Start the loopback SMTP server on an ephemeral port.
 *
 * It speaks just enough of the protocol for one Nodemailer client: greeting,
 * EHLO with the capability set the plugin's transport asks for, AUTH, and one
 * message per MAIL/RCPT/DATA exchange. It never relays and never listens beyond
 * the loopback interface.
 *
 * The port is chosen by the operating system rather than fixed: a fixed port
 * makes a concurrent run — or a lingering process from an earlier one — fail
 * with `EADDRINUSE`, which would be an environment defect masquerading as a
 * probe result.
 *
 * @param onMessage - called with each accepted message's index.
 * @returns a promise resolving to the server and its port.
 */
function startSmtp(onMessage) {
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
            received.push({ raw: message, at: Date.now() })
            onMessage(received.length)
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
    server.listen(0, '127.0.0.1', () => resolvePromise({ server, port: server.address().port }))
  })
}

/**
 * Run the booted profile to completion.
 *
 * @param patches - overlay files, applied in order after the profile layer.
 * @param scriptPath - the scripted model's turn list for this scenario.
 * @param mailConfig - the plugin settings this run applies, as one JSON document.
 * @param extraEnv - scenario-specific environment the probe plugins read.
 * @returns the child's exit code and its captured stdio.
 */
function runProfile(patches, scriptPath, mailConfig, extraEnv) {
  const args = ['--profile', 'headless']
  for (const patch of patches) args.push('--patch', patch)

  // The operator's own environment must not be able to supply the reference:
  // the disposable document is meant to be the only source, and a value that
  // happened to be exported in this shell would silently take precedence over
  // it. Removing it makes the probe's own claim checkable (§14).
  const baseEnv = { ...process.env }
  delete baseEnv[credentialRef]

  return new Promise((resolvePromise) => {
    // The boot probe's `--` separator is what forwards the rest verbatim to the
    // booted app; without it the task positional is swallowed by the probe's own
    // argument parser and the profile starts with no task at all.
    const child = spawn(process.execPath, [join(here, 'dev-boot-probe.mjs'), ...args, '--', task], {
      cwd: projectRoot,
      env: {
        ...baseEnv,
        DSH_HOME: probeHome,
        // The operator's own DSH home supplies the installation; the probe home
        // above supplies every writable path. Neither touches the other.
        DSH_INSTALL_ROOT: installRoot,
        PROBE_ROOT: projectRoot,
        PROBE_CREDENTIALS_FILE: paths.credentialsFile,
        // The value the contract check compares against, so the comparison is
        // exact and against what was really written rather than against a
        // second copy of the string. Synthetic; never a real secret.
        PROBE_CREDENTIAL_VALUE: smtpPassword,
        PROBE_ANSWER_TRACE: paths.answerTrace,
        PROBE_APPROVAL_TRACE: paths.approvalTrace,
        PROBE_APPROVAL_ID_FILE: paths.approvalId,
        PROBE_CREDENTIAL_REPORT: paths.credentialReport,
        PROBE_TIMELINE: paths.timeline,
        // The scripted model's turn list travels in the environment because the
        // loader row receives no custom invocation surface of its own.
        PROBE_SCRIPT: scriptPath,
        // The plugin's settings, as the JSON document the overlay row reads. The
        // probe prints the same document before booting, so what took effect and
        // what was reported cannot diverge.
        PROBE_MAIL_CONFIG: JSON.stringify(mailConfig),
        ...extraEnv,
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
 * @param entry - the accepted message and its arrival time.
 * @returns the decoded subject, body, received time, and arrival order.
 */
function parseMessage(entry) {
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

  /** The one model call that asks for a decision from inside the Turn. */
  const approval = {
    tool: 'probe_request_approval',
    arguments: JSON.stringify({
      reason: 'the probe needs a one-shot grant before it performs the action',
      argSentinel: toolArgumentSentinel,
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
    case 'approvals-duplicate':
    case 'approvals-rejected':
      // The approval is requested from inside a real tool execution, so the
      // audit pair is turn-enclosed; the second model call runs after the tool
      // resumed, which is what proves the Turn continued rather than restarted.
      return [approval, 'The tool resumed under a one-shot approval; the task is complete.']

    case 'credentials':
      // The contract checker runs during plugin activation, so the task only
      // has to give the booted app something to do.
      return ['The credential-contract checks ran during activation.']

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
 * @param port - the loopback SMTP port chosen for this run.
 * @returns the resolved plugin configuration.
 */
function mailConfigFor(name, port) {
  const switches = {
    questions: {
      notifyCompleted: true,
      notifyErrors: false,
      notifyMaxTokens: true,
      notifyQuestions: true,
      notifyApprovals: false,
    },
    errors: {
      notifyCompleted: true,
      notifyErrors: true,
      notifyMaxTokens: true,
      notifyQuestions: false,
      notifyApprovals: false,
    },
    approvals: {
      notifyCompleted: true,
      notifyErrors: false,
      notifyMaxTokens: true,
      notifyQuestions: false,
      notifyApprovals: true,
    },
    'approvals-duplicate': {
      notifyCompleted: true,
      notifyErrors: false,
      notifyMaxTokens: true,
      notifyQuestions: false,
      notifyApprovals: true,
    },
    'approvals-rejected': {
      notifyCompleted: true,
      notifyErrors: false,
      notifyMaxTokens: true,
      notifyQuestions: false,
      notifyApprovals: true,
    },
    credentials: {
      notifyCompleted: true,
      notifyErrors: false,
      notifyMaxTokens: true,
      notifyQuestions: false,
      notifyApprovals: false,
    },
  }[name]

  return {
    enabled: true,
    smtpHost: '127.0.0.1',
    smtpPort: port,
    smtpSecure: false,
    smtpUser: 'probe@example.invalid',
    // The reference, never the value, and in the grammar DSH's own
    // `credentialRef()` enforces.
    smtpPasswordCredential: credentialRef,
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

/**
 * Scenario-specific environment for the probe plugins.
 *
 * @param name - the scenario name.
 * @returns the extra environment entries.
 */
function extraEnvFor(name) {
  if (name === 'approvals') {
    // The answerer withholds its answer until the probe has seen the approval
    // mail arrive, which is what makes the notification provably earlier than
    // the decision.
    return { PROBE_APPROVAL_OUTCOME: 'allowed-once', PROBE_WAIT_SENTINEL: paths.sentinel, PROBE_WAIT_TIMEOUT_MS: '20000' }
  }
  if (name === 'approvals-duplicate') {
    // Same wait, plus a real duplicate of the audit record: the tool appends a
    // second `approval/asked` with the service-issued id after the decision.
    return {
      PROBE_APPROVAL_OUTCOME: 'allowed-once',
      PROBE_WAIT_SENTINEL: paths.sentinel,
      PROBE_WAIT_TIMEOUT_MS: '20000',
      PROBE_REPLAY_APPROVAL: paths.approvalId,
    }
  }
  if (name === 'approvals-rejected') {
    return { PROBE_APPROVAL_OUTCOME: 'rejected', PROBE_WAIT_SENTINEL: paths.sentinel, PROBE_WAIT_TIMEOUT_MS: '20000' }
  }
  return {}
}

/**
 * Read one of the probe's own trace files, or an empty string.
 *
 * @param path - the trace file.
 * @returns its contents, or an empty string when it was never written.
 */
function readTrace(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Parse a probe timeline file into timestamped events.
 *
 * Both the observer and the answerer write `T+<epoch ms> <text>` lines, so one
 * reader serves both and the two sources can be merged on a single clock. The
 * clock is the probe process's, because both files are written by processes
 * this run started on this machine.
 *
 * @param path - the trace file.
 * @param source - the label to prefix each event with.
 * @returns the parsed events.
 */
function readTimeline(path, source) {
  const events = []
  for (const line of readTrace(path).split('\n')) {
    const match = /^T\+(\d+) (.*)$/.exec(line.trim())
    if (match?.[1] === undefined) continue
    events.push({ at: Number(match[1]), label: `${source}: ${match[2]}` })
  }
  return events
}

/**
 * Count `approval/asked` records per service-issued id.
 *
 * The dedupe case needs to show that the duplicate really reached the log: a
 * replay that never happened would otherwise look exactly like a dedupe that
 * worked.
 *
 * @param events - the parsed observer timeline.
 * @returns one entry per approval id, with how many times it was published.
 */
function approvalAskCounts(events) {
  const counts = new Map()
  for (const event of events) {
    const match = /approval\/asked .*id="([^"]+)"/.exec(event.label)
    if (match?.[1] === undefined) continue
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  return counts
}

const smtp = await startSmtp((index) => {
  // The answerer is waiting for exactly this. Writing the sentinel when the
  // first message lands makes "the mail reached the mail system" the event that
  // releases the decision, in both directions of the ordering.
  if (index === 1) {
    try {
      writeFileSync(paths.sentinel, `${Date.now()}\n`, 'utf8')
    } catch {
      // A sentinel the probe cannot write leaves the answerer on its timeout,
      // which the run reports rather than hides.
    }
  }
})
process.stdout.write(`[probe] loopback SMTP listening on 127.0.0.1:${smtp.port}\n`)

const patches = [join(here, 'probe', 'overlay-base.yml')]
writeFileSync(paths.script, `${JSON.stringify(scriptFor(scenario), null, 2)}\n`, 'utf8')
const startedAt = Date.now()
const result = await runProfile(patches, paths.script, mailConfigFor(scenario, smtp.port), extraEnvFor(scenario))
const finishedAt = Date.now()

// The notification queue is asynchronous: the run may print its answer before
// the last message is delivered. Waiting is what makes the count meaningful.
await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))
smtp.server.close()

const rawMessages = received.map((entry) => entry.raw)
const messages = received.map(parseMessage)
// The raw DATA is kept as well as the decoded form: a decoding bug in this
// probe must not be able to masquerade as a truncation bug in the plugin, and
// the only way to tell them apart afterwards is to keep both.
writeFileSync(paths.rawMail, rawMessages.join('\n\n=== MESSAGE ===\n\n'), 'utf8')
writeFileSync(paths.mail, `${JSON.stringify(messages, null, 2)}\n`, 'utf8')
writeFileSync(paths.stdout, result.out, 'utf8')
writeFileSync(paths.stderr, result.err, 'utf8')

const lines = [
  `[probe] scenario: ${scenario}`,
  `[probe] child exit code: ${result.code}`,
  `[probe] wall clock: ${finishedAt - startedAt} ms`,
  `[probe] messages received: ${messages.length}`,
  ...messages.map((message, index) => `[probe]   ${index + 1}. ${message.subject}`),
]

if (scenario.startsWith('approvals')) {
  // Read back only now: the observer's file is written by the run that just
  // finished, and reading it before that run started would report the previous
  // run's timeline — or none at all.
  const observerTimeline = readTimeline(paths.timeline, 'runtime')
  lines.push('[probe] approval timeline (runtime events + SMTP receipts + answerer):')
  const events = [
    ...observerTimeline,
    ...readTimeline(paths.approvalTrace, 'answerer'),
    ...messages.map((message) => ({
      at: message.receivedAt,
      label: `SMTP: DATA accepted -> ${JSON.stringify(message.subject)}`,
    })),
  ]
  events.sort((left, right) => left.at - right.at)
  for (const event of events) lines.push(`[probe]   +${String(event.at - startedAt).padStart(7)} ms  ${event.label}`)

  const counts = approvalAskCounts(observerTimeline)
  for (const [id, count] of counts) {
    lines.push(`[probe] approval/asked records for id ${id}: ${count}`)
  }
  lines.push(`[probe] distinct approval ids published: ${counts.size}`)

  // The privacy assertions are made against the raw SMTP DATA and the captured
  // stderr, not against the plugin's own log fields: a leak that reached the
  // wire or a log line would not show up in a structured field the probe chose
  // to inspect.
  const surfaces = [
    ['raw SMTP payloads', paths.rawMail],
    ['plugin stderr', paths.stderr],
    ['plugin stdout', paths.stdout],
  ]
  for (const [label, path] of surfaces) {
    const found = readTrace(path).includes(toolArgumentSentinel)
    lines.push(
      `[probe] ${found ? 'LEAK' : 'clean'} | the approval's tool arguments are absent from ${label}`,
    )
  }
}

const credentialReport = readTrace(paths.credentialReport)
const credentialFailures = credentialReport.split('\n').filter((line) => line.startsWith('FAIL'))
lines.push(
  `[probe] credential contract: ${
    credentialReport === '' ? 'NO REPORT WRITTEN' : `${credentialFailures.length} FAIL, ${credentialReport.split('\n').filter((line) => line.startsWith('PASS')).length} PASS`
  }`,
)
for (const line of credentialReport.split('\n')) {
  if (line.trim() !== '') lines.push(`[probe]   ${line}`)
}

lines.push(`[probe] artifacts: ${outDir}`)
process.stdout.write(`${lines.join('\n')}\n`)

process.exit(result.code === 0 && messages.length > 0 && credentialFailures.length === 0 && credentialReport !== '' ? 0 : 1)
