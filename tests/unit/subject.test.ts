/**
 * L1 unit tests for `subject.ts` — matrix rows TRN-06 (subject marking),
 * PRIV-01…PRIV-08, and the truncation-observability half of TRUNC-04.
 *
 * The privacy rows are negative assertions by design. A test that only checks
 * "the body contains the answer" would keep passing after a future field leaked
 * reasoning or tool data into the body, which is exactly the regression these
 * rows exist to catch.
 *
 * @module dsh-mail-notify/tests/unit/subject
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TRUNCATION_MARKER } from '../../src/content.ts'
import { renderFooter, renderMail, renderMetadata, renderSubject, sanitizeLine, SUBJECT_MAX_CHARS } from '../../src/subject.ts'
import {
  REASONING_SECRET_SENTINEL,
  SMTP_PASSWORD_SENTINEL,
  SYSTEM_PROMPT_SENTINEL,
  TOOL_ARGUMENT_SECRET_SENTINEL,
  TOOL_RESULT_SECRET_SENTINEL,
  USER_PROMPT_SENTINEL,
} from '../fixtures/runtime-shapes.ts'
import { testCandidate, testConfig } from '../support/harness.ts'

test('TRN-06 the subject marks max-tokens instead of claiming success', () => {
  const subject = renderSubject(testCandidate({ status: 'max-tokens', turnEndKind: 'max-tokens', model: 'deepseek-chat' }))
  assert.equal(subject, '[DSH] Task stopped at max tokens — deepseek-chat')
  assert.ok(!subject.toLowerCase().includes('completed'))
})

test('a completed-clean subject never claims that everything succeeded', () => {
  const subject = renderSubject(testCandidate({ model: 'deepseek-chat' }))
  assert.equal(subject, '[DSH] Task completed — deepseek-chat')
  for (const word of ['all tests', 'success', 'verified', 'all commands']) {
    assert.ok(!subject.toLowerCase().includes(word), `subject must not claim ${word}`)
  }
})

test('each status has its own subject prefix', () => {
  const expectations: [Parameters<typeof testCandidate>[0], string][] = [
    [{ status: 'completed-clean' }, '[DSH] Task completed'],
    [{ status: 'completed-with-tool-errors' }, '[DSH] Task completed with tool errors'],
    [{ status: 'max-tokens', turnEndKind: 'max-tokens' }, '[DSH] Task stopped at max tokens'],
    [{ status: 'error', turnEndKind: 'error' }, '[DSH] Task failed'],
    [{ status: 'aborted', turnEndKind: 'aborted' }, '[DSH] Task aborted'],
    [{ status: 'blocked', turnEndKind: 'blocked' }, '[DSH] Task blocked'],
    [{ status: 'interrupted', turnEndKind: 'interrupted' }, '[DSH] Task interrupted'],
    [{ status: 'unknown', turnEndKind: 'unknown' }, '[DSH] Task ended (unrecognised reason)'],
  ]
  // `model` is cleared so the assertion isolates the prefix from the model suffix.
  for (const [override, prefix] of expectations) {
    const candidate = testCandidate(override)
    delete candidate.model
    assert.equal(renderSubject(candidate), prefix)
  }
})

test('a subject never contains CR or LF, whatever the model name claims', () => {
  const candidate = testCandidate({ model: 'evil\r\nBcc: attacker@example.com' })
  const subject = renderSubject(candidate)
  // The injection primitive is the line break, not the text: with every CR and
  // LF flattened, the "Bcc:" fragment stays inside the single-line value and
  // cannot become a header of its own.
  assert.ok(!subject.includes('\r'), 'CR must not survive')
  assert.ok(!subject.includes('\n'), 'LF must not survive')
  assert.ok(!/[\u2028\u2029]/.test(subject))
  assert.ok(!sanitizeLine('evil\r\nBcc: attacker@example.com', 200).includes('\n'))
})

test('a subject is bounded even with an enormous model name', () => {
  const subject = renderSubject(testCandidate({ model: 'm'.repeat(5000) }))
  assert.ok(Array.from(subject).length <= SUBJECT_MAX_CHARS)
  assert.ok(subject.startsWith('[DSH] Task completed'), 'the status prefix survives truncation')
})

test('sanitizeLine flattens every line separator the platform knows', () => {
  assert.equal(sanitizeLine('a\r\nb', 100), 'a b')
  assert.equal(sanitizeLine('a\u2028b\u2029c', 100), 'a b c')
  assert.equal(sanitizeLine('a\u0000b', 100), 'a b')
  assert.equal(sanitizeLine(42, 100), '')
})

test('PRIV-01 reasoning text appears nowhere in the rendered mail', () => {
  const mail = renderMail({
    candidate: testCandidate({ visibleText: 'the answer', visibleTextLength: 10 }),
    render: testConfig().render,
    truncated: false,
  })
  assert.ok(!mail.text.includes(REASONING_SECRET_SENTINEL))
  assert.ok(!mail.subject.includes(REASONING_SECRET_SENTINEL))
})

test('PRIV-02/03/04 tool arguments, tool results, and the user prompt stay out by default', () => {
  const mail = renderMail({
    candidate: testCandidate({
      visibleText: 'the answer',
      // Even if a caller wrongly attached a user prompt, the default switch
      // keeps it out of the body.
      userText: `${USER_PROMPT_SENTINEL} please do the thing`,
    }),
    render: testConfig().render,
    truncated: false,
  })
  for (const sentinel of [TOOL_ARGUMENT_SECRET_SENTINEL, TOOL_RESULT_SECRET_SENTINEL, USER_PROMPT_SENTINEL, SYSTEM_PROMPT_SENTINEL, SMTP_PASSWORD_SENTINEL]) {
    assert.ok(!mail.text.includes(sentinel), `${sentinel} must not appear in the body`)
    assert.ok(!mail.subject.includes(sentinel), `${sentinel} must not appear in the subject`)
  }
})

test('PRIV-05 the user prompt appears only when explicitly enabled', () => {
  const config = testConfig({ includeUserPrompt: true })
  const mail = renderMail({
    candidate: testCandidate({ userText: `${USER_PROMPT_SENTINEL} please do the thing` }),
    render: config.render,
    truncated: false,
  })
  assert.ok(mail.text.includes(USER_PROMPT_SENTINEL), 'the opt-in switch must actually work')
  const withoutSwitch = renderMail({
    candidate: testCandidate({ userText: `${USER_PROMPT_SENTINEL} please do the thing` }),
    render: testConfig().render,
    truncated: false,
  })
  assert.ok(!withoutSwitch.text.includes(USER_PROMPT_SENTINEL))
})

test('PRIV-07 metadata minimisation removes cwd and session id', () => {
  const minimal = testConfig({ includeMetadata: false })
  const mail = renderMail({
    candidate: testCandidate({
      cwd: 'E:\\Projects\\Secret-Client-Name',
      sessionId: 'session-abcdef-should-not-appear',
      visibleText: 'the answer',
    }),
    render: minimal.render,
    truncated: false,
  })
  assert.ok(!mail.text.includes('Secret-Client-Name'))
  assert.ok(!mail.text.includes('session-abcdef-should-not-appear'))
  assert.ok(!mail.text.includes('Status:'))
  assert.ok(mail.text.includes('the answer'), 'the visible text is the point and stays')
})

test('the metadata block reports the recorded token counters without arithmetic', () => {
  const mail = renderMail({
    candidate: testCandidate({ usage: { inputTokens: 255, outputTokens: 759, totalTokens: 187638, cacheReadTokens: 186624 } }),
    render: testConfig().render,
    truncated: false,
  })
  const line = mail.text.split('\n').find((entry) => entry.startsWith('Token counters'))
  assert.ok(line !== undefined)
  assert.ok(line.includes('inputTokens=255'))
  assert.ok(line.includes('totalTokens=187638'))
  assert.ok(!line.includes('reasoningTokens'), 'a counter the runtime never reported is not invented')
})

test('an unknown duration is stated as unknown, not as zero', () => {
  const mail = renderMail({
    candidate: testCandidate({ durationMs: null, telemetryComplete: false, sawTurnStart: false }),
    render: testConfig().render,
    truncated: false,
  })
  assert.ok(mail.text.includes('Duration:  unknown (plugin attached mid-turn)'))
  assert.ok(!mail.text.includes('Duration:  0'))
})

test('the status line distinguishes the two completed statuses and never over-claims', () => {
  const clean = renderMetadata(testCandidate({ status: 'completed-clean' }))
  assert.ok(clean.includes('(completed-clean)'))
  assert.ok(!clean.toLowerCase().includes('all commands'))
  const withErrors = renderMetadata(testCandidate({ status: 'completed-with-tool-errors', explicitToolErrorCount: 2 }))
  assert.ok(withErrors.includes('(completed-with-tool-errors)'))
  assert.ok(withErrors.includes('Tool errors reported by DSH: 2'))
})

test('TRUNC-02/TRUNC-04 the truncation marker follows the footer switch', () => {
  const withFooter = renderMail({ candidate: testCandidate(), render: testConfig().render, truncated: true })
  assert.ok(withFooter.text.includes(TRUNCATION_MARKER))

  const withoutFooter = renderMail({
    candidate: testCandidate(),
    render: testConfig({ includeFooter: false }).render,
    truncated: true,
  })
  assert.ok(!withoutFooter.text.includes(TRUNCATION_MARKER), 'includeFooter:false hides the marker')
  // The fact remains observable to the caller: `truncated` is a parameter, and
  // the handler logs it regardless of this switch.
})

test('an untruncated body carries no marker', () => {
  const mail = renderMail({ candidate: testCandidate(), render: testConfig().render, truncated: false })
  assert.ok(!mail.text.includes(TRUNCATION_MARKER))
})

test('rendering never mutates the candidate', () => {
  const candidate = testCandidate({ visibleText: 'x'.repeat(500) })
  const before = JSON.stringify(candidate)
  renderMail({ candidate, render: testConfig({ maxBodyChars: 1000 }).render, truncated: true })
  assert.equal(JSON.stringify(candidate), before)
})

test('renderFooter states what the message is and what it omits', () => {
  const footer = renderFooter(false, [])
  assert.ok(footer.includes('dsh-mail-notify'))
  assert.ok(footer.includes('never included'))
})

test('an unusual cwd is flattened before it reaches the body', () => {
  const metadata = renderMetadata(testCandidate({ cwd: 'E:\\a\nInjected-Header: yes' }))
  assert.ok(!metadata.includes('\nInjected-Header'))
})
