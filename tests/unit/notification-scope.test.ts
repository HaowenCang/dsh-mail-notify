import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideNotification } from '../../src/notifier.ts'
import { Config, resolveConfig, snapshotOf } from '../../src/config.ts'
import { testCandidate, testConfig, VALID_RAW_CONFIG } from '../support/harness.ts'

for (const [entry, cwd, muted] of [
  [' C:\\Work\\Project\\ ', 'c:/work/project', true],
  ['C:\\Work\\Project', 'C:\\Work\\Project-other', false],
  ['C:\\Work\\Project', 'C:\\Work\\Project\\child', false],
  ['C:\\Work\\Project', 'C:\\Work\\Other\\..\\Project', true],
  ['\\\\Server\\Share\\Project\\', '//server/share/project', true],
  ['/work/Project/', '/work/Project', true],
  ['/work/Project', '/work/project', false],
  ['/work/Project', '/work/Project-two', false],
  ['/work/Project', '/work/Project\\', false],
  ['/work/Project', '/work/Project\\/', false],
  ['/work/Project', '/work/Project ', false],
  ['/work/Project', undefined, false],
  ['', undefined, false],
] as const) {
  test(`workspace mute ${JSON.stringify(entry)} vs ${JSON.stringify(cwd)} = ${muted}`, () => {
    const config = testConfig({ mutedWorkspaces: [entry] })
    const decision = decideNotification(testCandidate(cwd === undefined ? {} : { cwd }), config, false)
    assert.deepEqual(decision, muted ? { notify: false, reason: 'workspace-muted' } : { notify: true })
  })
}

test('session mute matches complete, case-sensitive IDs and precedes other policy', () => {
  const config = testConfig({ mutedSessions: [' session-test-0001 ', ''] })
  assert.deepEqual(decideNotification(testCandidate({ visibleText: '' }), config, true), { notify: false, reason: 'session-muted' })
  assert.deepEqual(decideNotification(testCandidate({ sessionId: 'SESSION-test-0001' }), config, false), { notify: true })
  assert.deepEqual(decideNotification(testCandidate({ sessionId: 'session-test-0001-extra' }), config, false), { notify: true })
})

test('mute arrays default empty, detach snapshots, and reject malformed entries', () => {
  const defaults = testConfig()
  assert.deepEqual(defaults.policy.mutedSessions, [])
  assert.deepEqual(defaults.policy.mutedWorkspaces, [])
  const config = Config({ ...VALID_RAW_CONFIG, mutedWorkspaces: ['C:\\Work'], mutedSessions: ['session-one'] } as never)
  const snapshot = snapshotOf(config)
  snapshot.mutedSessions.push('other')
  snapshot.mutedWorkspaces.push('C:\\Other')
  assert.deepEqual(snapshotOf(config).mutedSessions, ['session-one'])
  assert.deepEqual(snapshotOf(config).mutedWorkspaces, ['C:\\Work'])
  for (const field of ['mutedWorkspaces', 'mutedSessions']) {
    for (const value of ['not-an-array', [123], [null]]) {
      assert.ok(resolveConfig({ ...VALID_RAW_CONFIG, [field]: value }).errors.length > 0)
    }
  }
})
