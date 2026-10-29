import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assistantMessage, rootSession, TEST_SESSION_CWD, toolCall, turnEnd, turnStart } from '../fixtures/runtime-shapes.ts'
import { emit, mountPlugin } from '../support/plugin-harness.ts'
import type { MailJob } from '../../src/types.ts'

const allOn = { notifyCompleted: true, notifyErrors: true, notifyQuestions: true, notifyApprovals: true }

for (const rule of [
  {},
  { mutedSessions: ['session-muted'] },
  { mutedWorkspaces: [TEST_SESSION_CWD] },
]) {
  test(`scope ${Object.keys(rule)[0] ?? 'unmuted control'} applies to every automatic notification family`, async (t) => {
    const jobs: MailJob[] = []
    const harness = await mountPlugin({ ...allOn, ...rule }, { sink: async (job) => { jobs.push(job); return { ok: true } } })
    t.after(harness.dispose)
    const session = rootSession('session-muted')
    emit(harness.ctx, session, [
      turnStart(1, 100),
      toolCall(1, 1, 110, 'ask_user_question', JSON.stringify({ questions: [{ id: 'choose-mode', question: 'Choose?', header: 'Mode', options: [{ label: 'A', description: 'A mode' }, { label: 'B', description: 'B mode' }] }] })),
      { type: 'approval/asked', time: 120, data: { id: 'approval-muted', toolName: 'pwsh', reason: 'Run tool' } },
      assistantMessage({ turn: 1, step: 1, time: 130, content: [{ type: 'text', text: 'Done' }] }), turnEnd(1, 140),
      turnStart(2, 200), { type: 'turn/end', time: 210, data: { turn: 2, reason: { kind: 'error', error: { code: 'QUOTA', message: 'Failed' } } } },
      turnStart(3, 300), assistantMessage({ turn: 3, step: 1, time: 310, content: [{ type: 'text', text: 'Partial' }] }),
      { type: 'turn/end', time: 320, data: { turn: 3, reason: { kind: 'max-tokens' } } },
    ])
    assert.ok(harness.handle)
    await harness.handle.queue.settle()
    const muted = Object.keys(rule).length > 0
    assert.equal(jobs.length, muted ? 0 : 5)
    assert.equal(harness.handle.dedupe.size, muted ? 0 : 5)
    const reasons = harness.handle.logger.getRecords().filter((record) => record.event === 'notification.suppressed')
    assert.equal(reasons.length, muted ? 5 : 0, 'completion, failure, token limit, question, and approval are all observed')
    assert.ok(reasons.every((record) => record.fields['suppressedReason'] === (rule.mutedSessions ? 'session-muted' : 'workspace-muted')))
  })
}

test('unrelated sessions notify and removing a live mute restores eligibility', async (t) => {
  const jobs: MailJob[] = []
  const harness = await mountPlugin({ mutedSessions: ['session-muted'] }, { sink: async (job) => { jobs.push(job); return { ok: true } } })
  t.after(harness.dispose)
  const done = (id: string, turn: number) => emit(harness.ctx, rootSession(id), [turnStart(turn, 100), assistantMessage({ turn, step: 1, time: 110, content: [{ type: 'text', text: 'Done' }] }), turnEnd(turn, 120)])
  done('session-muted', 1)
  done('session-other', 1)
  assert.equal(jobs.length, 1)
  harness.reconfigure({ mutedSessions: [] })
  done('session-muted', 2)
  assert.equal(jobs.length, 2)
})
