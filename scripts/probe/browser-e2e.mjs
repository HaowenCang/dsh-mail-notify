/**
 * Real-browser end-to-end probe for the Web half of `dsh-mail-notify`.
 *
 * ## What this proves, and what it does not
 *
 * Every other probe in this directory drives the Host: it boots a profile
 * through the `dsh` launcher and reads mail off a loopback SMTP server. None of
 * them renders the browser half. A card can therefore be registered, typecheck
 * against the installed slot contract, and still never appear in a real page —
 * which is exactly the failure the v0.4.0 migration produced and the reason a
 * browser run is a release gate rather than a nicety.
 *
 * This probe drives **real Chrome** over the DevTools Protocol, against a real
 * `dsh web` instance the caller has already booted. It asserts what the page
 * actually rendered: the plugin is listed as installed at the version under
 * test, exactly one `section[data-plugin-config]` exists, all 23 expected Config
 * controls carry their rendered labels beside the separate write-only password
 * Credential control, a Save commits, and *Send test email* delivers a message
 * the loopback sink receives.
 *
 * It asserts an explicit list of **expected display labels**, not a bare control
 * count. A count cannot distinguish "the expected controls rendered" from "one
 * went missing and two unrelated controls appeared", and the v0.4.0 report had
 * to retract a conclusion drawn from exactly such a tally.
 *
 * That list is evidence about **rendering only**. It is handwritten page copy
 * matched against the rendered `<label>` text, so it would keep passing if the
 * Host schema gained a field nobody added here: it is not a Host-derived key set
 * and must not be described as one. The complementary invariant — Host Config
 * keys == Web `ALL_FIELDS` keys, in both directions — is enforced by the unit
 * suite at `tests/client/config-surface.test.ts` PAR-01, which derives the Host
 * side from `Config.toJSON()`. Neither check substitutes for the other, and
 * neither one alone closes the "a field was added and the card omits it" gap.
 *
 * ## Isolation
 *
 * The probe never boots anything and never chooses a profile: the caller owns
 * both, and must have booted the instance against a disposable `DSH_HOME` on a
 * port that is not the operator's. It opens one browser profile of its own under
 * `PROBE_CHROME_DATA`, talks only to `PROBE_WEB_URL`, and writes only under
 * `PROBE_OUT`.
 *
 * Usage:
 *   PROBE_WEB_URL=<url with token> PROBE_SMTP_PORT=25101 \
 *   PROBE_CHROME_DATA=<dir> PROBE_OUT=<dir> \
 *   node scripts/probe/browser-e2e.mjs
 *
 * @module dsh-mail-notify/scripts/probe/browser-e2e
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..', '..')

const webUrl = process.env['PROBE_WEB_URL']
const chromePath = process.env['PROBE_CHROME'] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const cdpPort = Number(process.env['PROBE_CDP_PORT'] ?? '9226')
const smtpPort = Number(process.env['PROBE_SMTP_PORT'] ?? '25101')
const outDir = process.env['PROBE_OUT'] ?? join(projectRoot, 'tmp', 'browser-e2e')
const chromeData = process.env['PROBE_CHROME_DATA'] ?? join(outDir, 'chrome-profile')

if (webUrl === undefined || webUrl === '') {
  process.stderr.write('browser-e2e: set PROBE_WEB_URL to the isolated instance URL\n')
  process.exit(2)
}
if (!existsSync(chromePath)) {
  process.stderr.write(`browser-e2e: no browser at ${chromePath}; set PROBE_CHROME\n`)
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
mkdirSync(chromeData, { recursive: true })

/**
 * The 23 Config controls the expanded card is expected to render, by their
 * rendered English display labels.
 *
 * These are the card's *own* labels, not Host Config keys and not a set derived
 * from the Host's describe mirror: the assertion below only asks whether each of
 * these strings appears as the start of a rendered `<label>`.
 */
const EXPECTED_CONFIG_FIELD_LABELS = [
  'Questions requiring input',
  'Approval requests',
  'Enable mail notifications',
  'Include subagent activity',
  'Completed turns',
  'Errors',
  'Token-limit termination',
  'Minimum turn duration',
  'SMTP host',
  'Port',
  'Security',
  'Username',
  'From',
  'Recipients',
  'Credential reference',
  'Include metadata',
  'Include user prompt',
  'Include footer',
  'Maximum body length',
  'Queue size',
  'Retry attempts',
  'Retry base delay',
  'Dedupe cache size',
]

/**
 * The one write-only password Credential control the expanded card is expected
 * to render.
 *
 * `smtpPasswordSecret` is a Credential **value** written through the
 * `credentials` domain, not a Config field, so it is a separate class of
 * expected label and is never counted as a 24th Config control. The Config
 * *reference* name — `smtpPasswordCredential` — is one of the 23 above and
 * renders as `Credential reference`.
 */
const EXPECTED_CREDENTIAL_CONTROL_LABELS = ['Set password']

/** The receipt file the loopback sink appends to, one line per accepted message. */
const receiptsPath = join(outDir, 'browser-smtp.json')
const sink = spawn(process.execPath, [join(here, 'live-smtp.mjs'), String(smtpPort), receiptsPath], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let sinkErr = ''
sink.stderr.on('data', (chunk) => {
  sinkErr += chunk.toString('utf8')
})

/** The recorded assertions, in the order they ran. */
const results = []
/**
 * Record one assertion.
 *
 * @param name - what the assertion claims.
 * @param ok - whether the page satisfied it.
 * @param detail - the observed value, so a failure is diagnosable.
 */
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  process.stdout.write(`[browser] ${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${detail}`}\n`)
}

// Wait for the sink to be listening before the page can be asked to use it.
await sleep(500)

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${chromeData}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    '--window-size=1600,1200',
    webUrl,
  ],
  { stdio: 'ignore' },
)

/** Poll the CDP HTTP endpoint until the page target exists. */
async function findPageTarget() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      const page = list.find((target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
      if (page !== undefined) return page
    } catch {
      // The endpoint is not up yet; the loop owns the retry.
    }
    await sleep(500)
  }
  throw new Error('browser-e2e: Chrome never exposed a page target')
}

const target = await findPageTarget()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.onopen = resolveOpen
  socket.onerror = rejectOpen
})

let nextId = 1
const pending = new Map()
/** Uncaught page errors and `console.error` records, which must stay empty. */
const pageErrors = []
/** Every `settings/mutate` request id, so its envelope body can be read back. */
const mutateRequestIds = []
/** Every plugin-RPC request id, so a failed test-email send is diagnosable. */
const pluginRequestIds = []
/** Request ids whose response body this probe still has to read. */
const bodiesToRead = []
/** The decoded `settings/mutate` envelopes, in order. */
const mutateEnvelopes = []
/** The decoded plugin-RPC envelopes, in order. */
const pluginEnvelopes = []
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params?.exceptionDetails?.exception?.description ?? 'exception')
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    pageErrors.push(
      (message.params.args ?? []).map((argument) => argument.value ?? argument.description ?? '').join(' '),
    )
  }
  if (message.method === 'Network.requestWillBeSent') {
    const url = message.params.request.url
    if (url.endsWith('/api/settings/mutate')) mutateRequestIds.push(message.params.requestId)
    if (url.includes('/api/dsh-mail-notify/')) pluginRequestIds.push(message.params.requestId)
  }
  if (
    message.method === 'Network.responseReceived' &&
    (mutateRequestIds.includes(message.params.requestId) || pluginRequestIds.includes(message.params.requestId)) &&
    !bodiesToRead.includes(message.params.requestId)
  ) {
    bodiesToRead.push(message.params.requestId)
  }
  if (message.id === undefined) return
  const entry = pending.get(message.id)
  if (entry === undefined) return
  pending.delete(message.id)
  if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
  else entry.resolve(message.result)
}

/**
 * Send one CDP command.
 *
 * @param method - the protocol method.
 * @param params - its parameters.
 * @returns the command result.
 */
function send(method, params = {}) {
  const id = nextId++
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCommand, rejectCommand) => {
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand })
  })
}

/**
 * Evaluate an expression in the page and return its value.
 *
 * @param expression - the expression, which must be JSON-serializable.
 * @returns the value, or `undefined` when the page threw.
 */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails !== undefined) return undefined
  return result.result.value
}

await send('Runtime.enable')
await send('Page.enable')
// The write path answers over the RPC envelope with an HTTP 200, so the status
// code cannot tell an accepted commit from a refused one. The envelope body is
// the only place the Host's own reason appears.
await send('Network.enable')

// The shell has to boot, register its client plugins, and hydrate before any
// selector in this probe means anything.
await sleep(7000)

/**
 * Click the first button whose trimmed text matches, exactly or by inclusion.
 *
 * @param needle - the text to look for.
 * @param exact - when true, only an exact match counts.
 * @returns whether a click happened.
 */
async function clickText(needle, exact = false) {
  return evaluate(`(() => {
    const candidates = [...document.querySelectorAll('button, a, [role=button], [role=tab]')]
    const text = (element) => (element.textContent || '').trim()
    const hit = candidates.find((element) => ${exact ? 'text(element) === ' : 'text(element).includes('}${JSON.stringify(needle)}${exact ? '' : ')'})
    if (hit === undefined) return false
    hit.click()
    return true
  })()`)
}

check('the shell booted', (await evaluate('typeof window.__DSH_BOOT__ !== "undefined"')) === true)

await clickText('Continue')
await sleep(2500)
check('the Plugins page opened', (await clickText('Plugins')) === true)
await sleep(3500)
await clickText('Configure later')
await sleep(1500)
check('the installed plugin row was found', (await clickText('dsh-mail-notify', true)) === true)
await sleep(3500)

const listed = await evaluate(`(() => {
  const text = document.body.innerText
  return {
    text,
    hasName: text.includes('dsh-mail-notify'),
    hasVersion: text.includes('v' + ${JSON.stringify(process.env['PROBE_EXPECT_VERSION'] ?? '0.5.0')}),
    failed: /failed to load plugins/i.test(text),
  }
})()`)
check('the page does not report a plugin load failure', listed?.failed === false)
check('the plugin is listed as installed', listed?.hasName === true)
check('the listed version is the candidate version', listed?.hasVersion === true)

check('the configuration card was expanded', (await clickText('Mail notifications')) === true)
await sleep(2500)

const card = await evaluate(`(() => ({
  sections: document.querySelectorAll('section[data-plugin-config]').length,
  labels: [...document.querySelectorAll('label')].map((label) => (label.textContent || '').trim()),
}))()`)
check('exactly one configuration card exists', card?.sections === 1, `count=${String(card?.sections)}`)

// Two separately evaluated claims, because they are two different things: all
// 23 expected Config controls rendered their labels, and the one expected
// write-only Credential control rendered its label. The Config claim is never
// derived from the total: 24 labelled controls could equally be 22 + 2, which is
// the exact shape of the v0.4.0 defect this harness exists to catch.
//
// Both claims are reported through one recorded assertion so the probe's
// assertion count — and therefore the 26/26 result already recorded for this
// harness — stays comparable across this terminology correction.
const renderedLabels = card?.labels ?? []
const missingConfigLabels = EXPECTED_CONFIG_FIELD_LABELS.filter(
  (field) => !renderedLabels.some((label) => label.startsWith(field)),
)
const missingCredentialLabels = EXPECTED_CREDENTIAL_CONTROL_LABELS.filter(
  (control) => !renderedLabels.some((label) => label.startsWith(control)),
)
const labelsOk = missingConfigLabels.length === 0 && missingCredentialLabels.length === 0
check(
  'all 23 expected Config controls have labelled browser controls, and the 1 expected write-only password Credential control is present',
  labelsOk,
  labelsOk
    ? `config ${EXPECTED_CONFIG_FIELD_LABELS.length}/${EXPECTED_CONFIG_FIELD_LABELS.length}, credential ${EXPECTED_CREDENTIAL_CONTROL_LABELS.length}/${EXPECTED_CREDENTIAL_CONTROL_LABELS.length}`
    : [
        missingConfigLabels.length === 0 ? '' : `missing Config labels: ${missingConfigLabels.join(', ')}`,
        missingCredentialLabels.length === 0 ? '' : `missing Credential labels: ${missingCredentialLabels.join(', ')}`,
      ]
        .filter((part) => part !== '')
        .join('; '),
)

/**
 * Set a field by its label text, through the native setter so React observes the
 * change rather than reading back the value it last rendered.
 *
 * @param label - the field's label text.
 * @param value - the value to set.
 * @returns whether a control was found and set.
 */
async function setField(label, value) {
  return evaluate(`(() => {
    const label = [...document.querySelectorAll('label')]
      .find((element) => (element.textContent || '').trim().startsWith(${JSON.stringify(label)}))
    if (label === undefined) return false
    const control = label.querySelector('input, select, textarea')
    if (control === null) return false
    const prototype = control.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor.set.call(control, ${JSON.stringify(value)})
    control.dispatchEvent(new Event('input', { bubbles: true }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

check('the SMTP host field accepted a value', (await setField('SMTP host', '127.0.0.1')) === true)
check('the port field accepted a value', (await setField('Port', String(smtpPort))) === true)
check('the username field accepted a value', (await setField('Username', 'probe-user')) === true)
check('the from field accepted a value', (await setField('From', 'probe@browser.local')) === true)
check('the recipients field accepted a value', (await setField('Recipients', 'operator@browser.local')) === true)
check('the enable switch was turned on', (await setField('Enable mail notifications', 'true')) === true)
// The value is synthetic and exists only so the credential resolves; it is
// never a real secret, and the plugin has no read path that could echo it.
check('the password field accepted a value', (await setField('Set password', 'PROBE_BROWSER_PASSWORD_NOT_A_REAL_SECRET')) === true)
await sleep(500)

// The form owns the edit buffer; the Host only sees a commit. Reading the
// controls back before Save is what separates "the edit never registered in the
// page" from "the edit registered and the Host refused it" — two failures that
// look identical from the rendered status line alone.
const formState = await evaluate(`(() => {
  const valueOf = (name) => {
    const control = document.querySelector('[name=' + JSON.stringify(name) + ']')
    return control === null ? null : control.value
  }
  const save = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Save')
  return {
    smtpHost: valueOf('smtpHost'),
    smtpPort: valueOf('smtpPort'),
    smtpUser: valueOf('smtpUser'),
    from: valueOf('from'),
    enabled: valueOf('enabled'),
    saveDisabled: save === undefined ? null : save.disabled,
  }
})()`)
check(
  'the form registered every edit before Save',
  formState?.smtpHost === '127.0.0.1' &&
    formState?.smtpPort === String(smtpPort) &&
    formState?.smtpUser === 'probe-user' &&
    formState?.from === 'probe@browser.local' &&
    formState?.enabled === 'true',
  JSON.stringify(formState),
)
check('the Save control is enabled once the form is dirty', formState?.saveDisabled === false, `disabled=${String(formState?.saveDisabled)}`)

check('the Save button exists', (await clickText('Save', true)) === true)
await sleep(5000)

// Read every commit envelope the page produced, so a refusal is reported with
// the Host's own words instead of being inferred from the rendered status.
for (const requestId of bodiesToRead) {
  try {
    const body = await send('Network.getResponseBody', { requestId })
    mutateEnvelopes.push(JSON.parse(body.body))
  } catch {
    mutateEnvelopes.push({ unreadable: requestId })
  }
}
const accepted = mutateEnvelopes.filter((envelope) => envelope?.result?.ok === true)
const refusals = mutateEnvelopes
  .filter((envelope) => envelope?.result?.ok === false)
  .map((envelope) => envelope.result.error?.message ?? 'refused')
check('the Host accepted the commit', accepted.length >= 1, `envelopes=${mutateEnvelopes.length}`)
check(
  'no commit was refused by the Host',
  refusals.length === 0,
  refusals.length === 0 ? undefined : refusals.join(' | ').replace(/\n/g, ' '),
)

const afterSave = await evaluate('document.body.innerText')
check('the card does not report a refused save', !/did not accept the save/i.test(afterSave ?? ''))
check(
  'the card reports the plugin as configured',
  /Active/.test(afterSave ?? '') && !/SMTP not configured/.test(afterSave ?? ''),
  (afterSave ?? '').split('\n').find((line) => line.includes('Active') || line.includes('not configured')),
)

check('the Send test email control exists', (await clickText('Send test email')) === true)
await sleep(9000)

for (const requestId of bodiesToRead) {
  try {
    const body = await send('Network.getResponseBody', { requestId })
    const envelope = JSON.parse(body.body)
    if (pluginRequestIds.includes(requestId)) pluginEnvelopes.push(envelope)
  } catch {
    // A body that cannot be read is reported through the assertions below.
  }
}

const receipts = existsSync(receiptsPath)
  ? readFileSync(receiptsPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '').length
  : 0
const failedPluginCalls = pluginEnvelopes
  .filter((envelope) => envelope?.result?.ok === false)
  .map((envelope) => envelope.result.error?.message ?? 'refused')
check(
  'the loopback sink received the test email',
  receipts >= 1,
  `messages=${receipts}` +
    (failedPluginCalls.length === 0 ? '' : ` refused: ${failedPluginCalls.join(' | ')}`) +
    (sinkErr === '' ? '' : ` sink stderr: ${sinkErr.slice(0, 200)}`),
)

check('the page produced no uncaught error or console error', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

socket.close()
chrome.kill()
sink.kill()

const failures = results.filter((result) => !result.ok)
process.stdout.write(`[browser] ${results.length - failures.length}/${results.length} assertions passed\n`)
process.exit(failures.length === 0 ? 0 : 1)
