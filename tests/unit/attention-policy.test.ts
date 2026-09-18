/**
 * L1 unit tests for the human-attention policy — `decideQuestionNotification`
 * and `decideApprovalNotification` in `human-attention.ts`.
 *
 * The two switches are proved independent in both directions, because a single
 * shared flag would pass every one-sided test while sending approvals to a
 * mailbox whose operator asked only about questions. The default configuration
 * is asserted through the real `resolveConfig`, not through the harness, so a
 * drifted schema default cannot hide behind a hand-built config. And `HAT-POL-05`
 * pins the §28 rule: the turn-duration floor must not reach the mid-turn
 * decisions, because an agent that asks a question two seconds into a turn is
 * exactly the case the notification exists for.
 *
 * @module dsh-mail-notify/tests/unit/attention-policy
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig } from '../../src/config.ts'
import { decideApprovalNotification, decideQuestionNotification } from '../../src/human-attention.ts'
import { VALID_RAW_CONFIG, testConfig } from '../support/harness.ts'
import type { ResolvedConfig } from '../../src/types.ts'

test('HAT-POL-01 notifyQuestions is off by default, so a question is suppressed by policy rather than sent', () => {
  const config = testConfig()
  assert.equal(config.policy.notifyQuestions, false)

  const decision = decideQuestionNotification(config, false)
  assert.equal(decision.notify, false)
  assert.deepEqual(decision, {
    notify: false,
    reason: 'disabled-by-policy',
    detail: 'notifyQuestions is switched off',
  })

  // The detail names the switch, which is what makes a suppression auditable
  // rather than an unexplained silence in the operator's log.
  assert.deepEqual(decideQuestionNotification(testConfig({ notifyQuestions: true }), false), { notify: true })
})

test('HAT-POL-02 notifyApprovals is off by default and its suppression names its own switch', () => {
  const config = testConfig()
  assert.equal(config.policy.notifyApprovals, false)

  const decision = decideApprovalNotification(config, false)
  assert.equal(decision.notify, false)
  assert.deepEqual(decision, {
    notify: false,
    reason: 'disabled-by-policy',
    detail: 'notifyApprovals is switched off',
  })

  assert.deepEqual(decideApprovalNotification(testConfig({ notifyApprovals: true }), false), { notify: true })
})

test('HAT-POL-03 the two switches are independent, in both directions', () => {
  // Questions on, approvals off: the approval must not ride on the question
  // switch. This is the direction that matters, because an approval reveals the
  // name of a tool the operator did not agree to hear about.
  const questionsOnly = testConfig({ notifyQuestions: true, notifyApprovals: false })
  assert.deepEqual(decideQuestionNotification(questionsOnly, false), { notify: true })
  assert.equal(decideApprovalNotification(questionsOnly, false).notify, false)

  const approvalsOnly = testConfig({ notifyQuestions: false, notifyApprovals: true })
  assert.equal(decideQuestionNotification(approvalsOnly, false).notify, false)
  assert.deepEqual(decideApprovalNotification(approvalsOnly, false), { notify: true })

  // Each suppression still names the switch that caused it, so the reverse
  // direction is not merely "some policy refused".
  const refusedApproval = decideApprovalNotification(questionsOnly, false)
  assert.equal(refusedApproval.notify === false ? refusedApproval.detail : '', 'notifyApprovals is switched off')
  const refusedQuestion = decideQuestionNotification(approvalsOnly, false)
  assert.equal(refusedQuestion.notify === false ? refusedQuestion.detail : '', 'notifyQuestions is switched off')
})

test('HAT-POL-04 a disabled plugin suppresses with the master switch, before any notification switch is read', () => {
  // Both notification switches are on, and it still makes no difference: the
  // master switch is the first rule, so turning the plugin off cannot be
  // reported as a policy choice the operator did not make.
  const config: ResolvedConfig = {
    ...testConfig({ notifyQuestions: true, notifyApprovals: true }),
    enabled: false,
  }

  assert.deepEqual(decideQuestionNotification(config, false), { notify: false, reason: 'disabled' })
  assert.deepEqual(decideApprovalNotification(config, false), { notify: false, reason: 'disabled' })
})

test('HAT-POL-05 the turn-duration floor does not apply to a question notification (§28)', () => {
  // §28: the mid-turn notifications are not turn-level decisions. An agent that
  // asks a question two seconds into a turn must not be suppressed — the question
  // is the whole reason the mail exists, and a turn-length floor would silence
  // exactly the mid-turn case the notification was added for. The decision
  // signature carries no duration and no notification payload, which is the
  // structural form of the same rule: there is nothing here to test a duration
  // against, and an hour-long floor changes nothing.
  const config = testConfig({ notifyQuestions: true, notifyApprovals: true, minTurnDurationMs: 600_000 })
  assert.equal(config.policy.minTurnDurationMs, 600_000)

  assert.deepEqual(decideQuestionNotification(config, false), { notify: true })
  assert.deepEqual(decideApprovalNotification(config, false), { notify: true })
})

test('HAT-POL-06 a duplicate call is suppressed after the switch check, and only then', () => {
  const open = testConfig({ notifyQuestions: true, notifyApprovals: true })
  assert.deepEqual(decideQuestionNotification(open, true), { notify: false, reason: 'duplicate' })
  assert.deepEqual(decideApprovalNotification(open, true), { notify: false, reason: 'duplicate' })

  // With the switch off the duplicate rule is never reached, so the operator
  // sees the reason that is actionable: the switch, not a duplicate that would
  // suggest the first mail had already arrived.
  const closed = testConfig()
  assert.deepEqual(decideQuestionNotification(closed, true), {
    notify: false,
    reason: 'disabled-by-policy',
    detail: 'notifyQuestions is switched off',
  })
  assert.deepEqual(decideApprovalNotification(closed, true), {
    notify: false,
    reason: 'disabled-by-policy',
    detail: 'notifyApprovals is switched off',
  })
})

test('HAT-POL-07 the default configuration keeps both attention switches off', () => {
  // Resolved through the real `resolveConfig` rather than through `testConfig`,
  // so this asserts the schema default an operator actually gets: the safest
  // value must not be reachable only by the test harness.
  const { resolved, errors } = resolveConfig({ ...VALID_RAW_CONFIG })

  assert.deepEqual(errors, [])
  assert.equal(resolved.policy.notifyQuestions, false)
  assert.equal(resolved.policy.notifyApprovals, false)
  // Both are off while the plugin itself is armed, which is the combination that
  // matters: an enabled plugin that sends nothing until asked is the intent.
  assert.equal(resolved.enabled, true)
})

test('HAT-POL-08 the all-switches-off warning names the two attention switches', () => {
  const { warnings, errors, resolved } = resolveConfig({
    ...VALID_RAW_CONFIG,
    notifyCompleted: false,
    notifyErrors: false,
    notifyMaxTokens: false,
    notifyQuestions: false,
    notifyApprovals: false,
  })

  assert.deepEqual(errors, [])
  assert.equal(warnings.length, 1)
  const warning = warnings[0]
  assert.ok(warning !== undefined)
  // A warning that named only the three turn-level switches would let an
  // operator who wanted mid-turn mail believe the new switches had taken effect.
  assert.ok(warning.includes('notifyQuestions'))
  assert.ok(warning.includes('notifyApprovals'))
  assert.ok(warning.includes('all false'))
  // A warning never blocks activation; the plugin mounts and sends nothing.
  assert.equal(resolved.enabled, true)
  assert.equal(resolved.policy.notifyQuestions, false)
  assert.equal(resolved.policy.notifyApprovals, false)
})
