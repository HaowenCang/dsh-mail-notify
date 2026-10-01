/**
 * Live-policy end-to-end probe.
 *
 * ## What it proves
 *
 * A switch flipped on the Web configuration surface reaches the *running*
 * notification engine — not merely the profile file — and changes what mail is
 * sent, without restarting DSH. That is the release proof for the whole volatile
 * configuration migration: a plugin whose configuration is read once at mount
 * would pass every other test in this repository and fail this one.
 *
 * ## How it proves it
 *
 * One booted real composition, driven by the same two-Turn driver the
 * attribution scenario uses, with a loopback SMTP receiver capturing everything:
 *
 * 1. `notifyQuestions = false` is composed from the overlay. The scripted model
 *    calls `ask_user_question`; the probe asserts **no** question mail arrives.
 * 2. The running plugin's configuration is then changed through the *host*
 *    configuration write path — `SettingsForms.mutate` on the same profile entry
 *    the Web page addresses — which is what a Save in the browser performs. The
 *    write is made by a probe plugin inside the booted process, because the
 *    probe's job is to exercise the host path rather than to re-implement it.
 * 3. A second Turn calls `ask_user_question` again. The probe asserts that a
 *    question mail **does** arrive, and that its text is the question the second
 *    call raised.
 *
 * Nothing about the plugin is stubbed. The Loader commits the change, the plugin
 * re-reads its configuration, rebuilds its runtime, and the new policy decides
 * the second question. The only substitutions are the ones every probe in this
 * directory already makes: the human, the model's tokens, and the SMTP server's
 * identity.
 *
 * Usage:
 *   node scripts/probe-live-policy.mjs
 *
 * @module dsh-mail-notify/scripts/probe-live-policy
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMessage } from './probe/smtp-decode.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
/**
 * The disposable tree every writable path of a run lives under.
 *
 * The default keeps it inside the checkout, already outside the operator's own
 * Harness home. `DSH_MAIL_NOTIFY_PROBE_ROOT` relocates it so a run can be
 * pointed at one mandated, inspectable isolation root.
 */
const probeRoot = process.env['DSH_MAIL_NOTIFY_PROBE_ROOT'] ?? join(projectRoot, 'tmp', 'live-policy')
const probeHome = join(probeRoot, 'home')
const outDir = join(probeRoot, 'out')
const statusDir = join(probeRoot, 'status')
/**
 * The profile the run boots, inside the disposable home above.
 *
 * `headless` is the shipped template and the default. A non-shipped name is
 * created from that same template by the launcher, which is what an operator
 * who reserves the shipped names needs.
 */
const probeProfile = process.env['DSH_MAIL_NOTIFY_PROBE_PROFILE'] ?? 'headless'

const smtpPassword = 'PROBE_LIVE_POLICY_PASSWORD_NOT_A_REAL_SECRET'
const credentialRef = 'DSH_MAIL_SMTP_PASSWORD'
/** The question the first Turn asks, while the switch is off. */
const questionWhileOff = 'QUESTION_WHILE_OFF_should_not_be_mailed'
/** The question the second Turn asks, after the switch is turned on. */
const questionWhileOn = 'QUESTION_WHILE_ON_should_be_mailed'

/**
 * The DSH installation root, resolved the same way the other probes resolve it.
 *
 * `DSH_INSTALL_ROOT` wins when set. The fallback asks `npm` for the global
 * prefix rather than assuming the operator's `.dsh` sits beside the global
 * `node_modules`: it does not, and the old assumption resolved to the user's home
 * and produced an `ENOENT` from inside the installation.
 *
 * @returns the install root path.
 */
function resolveInstallRoot() {
  const explicit = process.env['DSH_INSTALL_ROOT']
  if (explicit !== undefined && explicit !== '') return explicit
  const located = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf8', shell: true })
  const prefix = (located.stdout ?? '').trim()
  if (located.status === 0 && prefix !== '' && existsSync(join(prefix, 'node_modules', '@deepseek-ai'))) {
    return prefix
  }
  throw new Error(
    'probe-live-policy: cannot locate the DSH installation; set DSH_INSTALL_ROOT to the directory holding node_modules/@deepseek-ai',
  )
}
const installRoot = resolveInstallRoot()

mkdirSync(outDir, { recursive: true })
mkdirSync(statusDir, { recursive: true })

const paths = {
  credentialsFile: join(probeHome, '.credentials.yaml'),
  script: join(outDir, 'script.json'),
  overlay: join(outDir, 'overlay.yml'),
  receipts: join(outDir, 'smtp.json'),
  stdout: join(outDir, 'stdout.log'),
  stderr: join(outDir, 'stderr.log'),
  driverTrace: join(outDir, 'driver.log'),
  policyTrace: join(outDir, 'policy.log'),
  answerTrace: join(outDir, 'answer.log'),
  eventOrder: join(outDir, 'events.log'),
}
for (const path of Object.values(paths)) {
  try {
    rmSync(path, { force: true })
  } catch {
    // A path the probe cannot remove is one it must not read as its own.
  }
}

// A fresh home for every run: an earlier run's profile, session store, or
// credential document could otherwise make a mail this run did not produce look
// like one it did.
rmSync(probeHome, { recursive: true, force: true })
for (const name of ['', 'sessions', 'storages', 'profiles']) {
  mkdirSync(join(probeHome, name), { recursive: true })
}
// A non-shipped profile name has no bundle list of its own; the launcher
// creates it from the `headless` template. It refuses a target directory that
// already exists, which is why the loop above does not create the profile.
if (probeProfile !== 'headless') {
  const init = spawnSync(
    'dsh',
    ['--profile', probeProfile, '--from-default-profile', 'headless', '--dump-config'],
    {
      cwd: projectRoot,
      env: { ...process.env, DSH_HOME: probeHome, DSH_INSTALL_ROOT: installRoot },
      encoding: 'utf8',
      shell: true,
    },
  )
  if (!existsSync(join(probeHome, 'profiles', probeProfile, 'package.json'))) {
    process.stderr.write(
      `[probe] profile initialization failed (exit ${String(init.status)}):\n${init.stdout ?? ''}\n${init.stderr ?? ''}\n`,
    )
    process.exit(2)
  }
}
writeFileSync(paths.credentialsFile, `version: 1\nrefs:\n  ${credentialRef}: ${smtpPassword}\nrecords: {}\n`, 'utf8')

/** Every message the loopback server accepted, with its arrival time and subject. */
const received = []

/**
 * Start the loopback SMTP server.
 *
 * @param port - the fixed port the plugin's configuration names.
 * @returns a promise resolving once it is listening.
 */
function startSmtp(port) {
  const server = createServer((socket) => {
    let inData = false
    let buffer = ''
    let message = ''
    socket.write('220 live-policy.local ESMTP probe\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const index = buffer.indexOf('\r\n')
        if (index === -1) break
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (inData) {
          if (line === '.') {
            received.push({ at: Date.now(), raw: message })
            message = ''
            inData = false
            socket.write('250 2.0.0 Ok: queued as LIVE\r\n')
          } else {
            message += `${line.startsWith('..') ? line.slice(1) : line}\n`
          }
          continue
        }
        const upper = line.toUpperCase()
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-live-policy.local\r\n250-AUTH PLAIN LOGIN\r\n250-SIZE 10485760\r\n250 8BITMIME\r\n')
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
    server.listen(port, '127.0.0.1', () => resolvePromise(server))
  })
}

/**
 * The scripted conversation.
 *
 * Two Turns, each asking one question and then answering. The questions differ so
 * that the assertion can say *which* Turn's question was mailed rather than only
 * counting messages.
 *
 * @returns one entry per model call.
 */
function script() {
  const ask = (id, question) => ({
    tool: 'ask_user_question',
    arguments: JSON.stringify({
      questions: [{ id, header: question, question, options: [{ label: 'A', description: 'first' }] }],
    }),
  })
  return [ask('off', questionWhileOff), 'The first Turn finished.', ask('on', questionWhileOn), 'The second Turn finished.']
}

/**
 * Write the overlay this run composes.
 *
 * Every plugin row names a literal path or a bare specifier: the target checks a
 * row's plugin compatibility before interpolating `!!js` expressions in `name`,
 * and an unevaluated expression object fails that check. The plugin under test is
 * addressed by package so its real manifest is what the preflight reads.
 *
 * @param port - the loopback SMTP port.
 * @returns the overlay's path.
 */
function writeOverlay(port) {
  const lines = [
    '# Generated by scripts/probe-live-policy.mjs for one run. Do not edit.',
    '',
    '- id: agent-default-model',
    '  config:',
    '    provider: probe',
    '    model: probe-scripted',
    '',
    '# The headless template does not compose the agent loop on its own;',
    '# without it `ctx.agents` has no factory.',
    '- id: agent-loop',
    "  name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    '',
    '# The shipped one-shot runner drives one Turn; this scenario needs two, so it',
    '# is replaced by the probe driver.',
    '- id: headless-runner',
    '  disabled: true',
    '',
    '- id: credentials',
    '  config:',
    `    path: ${JSON.stringify(paths.credentialsFile)}`,
    '    watch: true',
    '',
    '- insert:',
    `    - id: probe-scripted-provider`,
    `      name: ${JSON.stringify(join(here, 'probe', 'scripted-provider.mjs'))}`,
    `    - id: probe-auto-answer`,
    `      name: ${JSON.stringify(join(here, 'probe', 'auto-answer.mjs'))}`,
    `    - id: probe-event-order`,
    `      name: ${JSON.stringify(join(here, 'probe', 'event-order.mjs'))}`,
    `    - id: probe-two-turn-driver`,
    `      name: ${JSON.stringify(join(here, 'probe', 'two-turn-driver.mjs'))}`,
    `    - id: probe-live-policy`,
    `      name: ${JSON.stringify(join(here, 'probe', 'live-policy.mjs'))}`,
    '    - id: tool-ask-user',
    "      name: '@deepseek-ai/dsh-tool-ask-user'",
    '',
    '# The plugin under test, composed with the question switch OFF. Enabling it is',
    '# the live change this scenario makes.',
    '- insert:',
    '    - id: dsh-mail-notify',
    '      name: dsh-mail-notify',
    '      config:',
    '        enabled: true',
    '        smtpHost: 127.0.0.1',
    `        smtpPort: ${port}`,
    '        smtpSecure: false',
    '        smtpUser: probe@example.invalid',
    `        smtpPasswordCredential: ${credentialRef}`,
    '        from: probe@example.invalid',
    '        to:',
    '          - recipient@example.invalid',
    '        notifyCompleted: false',
    '        notifyQuestions: false',
    '        notifyApprovals: false',
    '        retryAttempts: 1',
    '        retryBaseDelayMs: 200',
    '',
  ]
  writeFileSync(paths.overlay, lines.join('\n'), 'utf8')
  return paths.overlay
}

/** Boot the profile through the log-exporting harness. */
function runProfile(overlay, port) {
  const baseEnv = { ...process.env }
  delete baseEnv[credentialRef]
  const task = 'probe: live policy switch'
  const child = spawn(
    process.execPath,
    [join(here, 'dev-boot-probe.mjs'), '--profile', probeProfile, '--patch', overlay, '--', task],
    {
      cwd: projectRoot,
      env: {
        ...baseEnv,
        DSH_HOME: probeHome,
        DSH_INSTALL_ROOT: installRoot,
        PROBE_ROOT: projectRoot,
        PROBE_CREDENTIALS_FILE: paths.credentialsFile,
        PROBE_CREDENTIAL_VALUE: smtpPassword,
        PROBE_SCRIPT: paths.script,
        PROBE_ANSWER_TRACE: paths.answerTrace,
        PROBE_TIMELINE: join(outDir, 'timeline.log'),
        PROBE_TWO_TURN_TRACE: paths.driverTrace,
        PROBE_EVENT_ORDER: paths.eventOrder,
        PROBE_POLICY_TRACE: paths.policyTrace,
        PROBE_SMTP_PORT: String(port),
        PROBE_PROMPT_A: 'the first task',
        PROBE_PROMPT_B: 'the second task',
        PROBE_MAIL_CONFIG: JSON.stringify({}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk) => {
    out += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk) => {
    err += chunk.toString('utf8')
  })
  const limitMs = Number(process.env['PROBE_TIMEOUT_MS'] ?? '180000')
  const timer = setTimeout(() => {
    err += `\n[probe] the booted profile did not exit within ${limitMs} ms; terminating it\n`
    child.kill('SIGKILL')
  }, limitMs)
  return new Promise((resolvePromise) => {
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, out, err })
    })
  })
}

/**
 * Install the packed plugin into the disposable profile.
 *
 * A row named by absolute path has no package identity, so the target's
 * compatibility preflight disables it before the Loader imports anything.
 * Installing the archive gives the row a real manifest — and makes the probe
 * exercise the artefact that ships.
 *
 * @param tarball - absolute path to the packed archive.
 */
function installPlugin(tarball) {
  // `shell: true` because `dsh` is a `.cmd` shim on Windows; the same invocation
  // works on both platforms and is the command the README documents.
  const result = spawnSync('dsh', ['plugin', '--profile', probeProfile, 'add', tarball], {
    cwd: projectRoot,
    env: { ...process.env, DSH_HOME: probeHome, DSH_INSTALL_ROOT: installRoot },
    encoding: 'utf8',
    shell: true,
  })
  if (result.status !== 0) {
    process.stderr.write(`[probe] plugin installation failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}\n`)
    process.exit(2)
  }
}

/** Pick a free port by asking the OS for one, then closing it. */
async function freePort() {
  const server = createServer()
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  await new Promise((resolvePromise) => server.close(resolvePromise))
  return port
}

const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version
const archivePath = join(projectRoot, `dsh-mail-notify-${version}.tgz`)
if (!existsSync(archivePath)) {
  process.stderr.write(`[probe] ${archivePath} does not exist; run "npm pack" first\n`)
  process.exit(2)
}

const smtpPort = await freePort()
const smtp = await startSmtp(smtpPort)
process.stdout.write(`[probe] loopback SMTP listening on 127.0.0.1:${smtpPort}\n`)
process.stdout.write(`[probe] installing ${archivePath} into the disposable profile\n`)
installPlugin(archivePath)

writeFileSync(paths.script, `${JSON.stringify(script(), null, 2)}\n`, 'utf8')
const overlay = writeOverlay(smtpPort)

const startedAt = Date.now()
const result = await runProfile(overlay, smtpPort)
const finishedAt = Date.now()
await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))
smtp.close()

const mail = received.map(parseMessage)
writeFileSync(paths.receipts, `${JSON.stringify(mail, null, 2)}\n`, 'utf8')
writeFileSync(paths.stdout, result.out, 'utf8')
writeFileSync(paths.stderr, result.err, 'utf8')

const read = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Assert the live-policy property from the receipts and the plugin's own trace.
 *
 * @returns one entry per check.
 */
function checks() {
  const offMail = mail.filter((entry) => entry.body.includes(questionWhileOff))
  const onMail = mail.filter((entry) => entry.body.includes(questionWhileOn))
  const questionMails = mail.filter((entry) => /Input required/i.test(entry.subject))
  const policy = read(paths.policyTrace)
  return [
    ['the run booted and exited cleanly', result.code === 0, `exit code ${String(result.code)}`],
    ['the first Turn ran with the switch off', read(paths.driverTrace).includes('prompt 1 reached quiescence'), 'driver trace'],
    ['the question switch was turned on inside the running process', policy.includes('switch-on-committed'), policy.trim().split('\n').slice(-1)[0] ?? 'no policy trace'],
    ['the second Turn ran after the switch', read(paths.driverTrace).includes('prompt 2 reached quiescence'), 'driver trace'],
    ['NO mail carried the question asked while the switch was off', offMail.length === 0, `matching messages: ${offMail.length}`],
    ['a question mail carried the question asked after the switch', onMail.length === 1, `matching messages: ${onMail.length}`],
    ['exactly one question notification was sent in the whole run', questionMails.length === 1, `question mails: ${questionMails.length}`],
    ['no completion mail was sent, because that switch stayed off', mail.every((entry) => !/Task completed/i.test(entry.subject)), `subjects: ${mail.map((entry) => entry.subject).join(' | ')}`],
  ]
}

const lines = [
  `[probe] live-policy scenario`,
  `[probe] child exit code: ${String(result.code)}`,
  `[probe] wall clock: ${finishedAt - startedAt} ms`,
  `[probe] messages received: ${mail.length}`,
  ...mail.map((entry, index) => `[probe]   ${index + 1}. ${entry.subject}`),
  '[probe] checks:',
]
let failed = 0
for (const [label, passed, detail] of checks()) {
  lines.push(`[probe] ${passed ? 'PASS' : 'FAIL'} ${label} (${detail})`)
  if (!passed) failed += 1
}
lines.push(`[probe] artifacts: ${outDir}`)
process.stdout.write(`${lines.join('\n')}\n`)
process.exit(failed === 0 ? 0 : 1)
