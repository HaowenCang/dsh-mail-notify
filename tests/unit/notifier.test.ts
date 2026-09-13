/**
 * L1 unit tests for `notifier.ts` — matrix rows DED-01…DED-04 and SUP-01…SUP-06.
 *
 * Two behaviours are the reason this file exists in its current shape. DED-04
 * checks that a suppressed turn leaves *no* dedupe mark, because the opposite
 * implementation silently swallows a later, legitimate settlement of the same
 * turn. SUP-06 checks the fixed decision order, because that order is what
 * decides which `suppressedReason` an operator sees when several suppression
 * conditions hold at once.
 *
 * @module dsh-mail-notify/tests/unit/notifier
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DedupeCache, decideNotification } from '../../src/notifier.ts'
import { testCandidate, testConfig } from '../support/harness.ts'

test('SUP-01 empty visible text is suppressed', () => {
  const decision = decideNotification(testCandidate({ visibleText: '', visibleTextLength: 0 }), testConfig(), false)
  assert.deepEqual(decision, { notify: false, reason: 'no-visible-text' })
})

test('SUP-02 whitespace-only visible text is suppressed too', () => {
  const decision = decideNotification(testCandidate({ visibleText: '   \n\t ', visibleTextLength: 6 }), testConfig(), false)
  assert.deepEqual(decision, { notify: false, reason: 'no-visible-text' })
})

test('SUP-03 an error turn is suppressed while notifyErrors is false', () => {
  const candidate = testCandidate({ status: 'error', turnEndKind: 'error', visibleText: 'the failure text' })
  const decision = decideNotification(candidate, testConfig(), false)
  assert.equal(decision.notify, false)
  assert.equal(decision.notify === false ? decision.reason : '', 'disabled-by-policy')
})

test('SUP-03b the same error turn notifies once notifyErrors is true', () => {
  const candidate = testCandidate({ status: 'error', turnEndKind: 'error', visibleText: 'the failure text' })
  assert.deepEqual(decideNotification(candidate, testConfig({ notifyErrors: true }), false), { notify: true })
})

test('SUP-03c notifyMaxTokens and notifyCompleted gate their own statuses', () => {
  const truncated = testCandidate({ status: 'max-tokens', turnEndKind: 'max-tokens' })
  assert.deepEqual(decideNotification(truncated, testConfig(), false), { notify: true })
  assert.equal(
    decideNotification(truncated, testConfig({ notifyMaxTokens: false }), false).notify,
    false,
  )
  const done = testCandidate({ status: 'completed-clean' })
  assert.deepEqual(decideNotification(done, testConfig(), false), { notify: true })
  assert.equal(decideNotification(done, testConfig({ notifyCompleted: false }), false).notify, false)
})

test('SUP-04 the four switchless termination kinds can never notify', () => {
  const cases: Partial<import('../../src/types.ts').NotificationCandidate>[] = [
    { status: 'aborted', turnEndKind: 'aborted' },
    { status: 'blocked', turnEndKind: 'blocked' },
    { status: 'interrupted', turnEndKind: 'interrupted' },
    { status: 'unknown', turnEndKind: 'unknown' },
  ]
  // Every switch on, and it still makes no difference: there is no enabling path.
  const allOn = testConfig({ notifyCompleted: true, notifyErrors: true, notifyMaxTokens: true })
  for (const override of cases) {
    const decision = decideNotification(testCandidate(override), allOn, false)
    assert.equal(decision.notify, false, `${String(override.status)} must never notify`)
    assert.equal(decision.notify === false ? decision.reason : '', 'disabled-by-policy')
  }
})

test('SUP-05 enabled:false suppresses before anything else is considered', () => {
  const config = testConfig()
  const disabled = { ...config, enabled: false }
  // Even a candidate that would otherwise be suppressed for a more specific
  // reason reports the master switch, because that is the first rule.
  assert.deepEqual(decideNotification(testCandidate({ visibleText: '' }), disabled, false), {
    notify: false,
    reason: 'disabled',
  })
})

test('DUR-02 a duration below the floor is suppressed', () => {
  const config = testConfig({ minTurnDurationMs: 60_000 })
  const decision = decideNotification(testCandidate({ durationMs: 1000 }), config, false)
  assert.equal(decision.notify, false)
  assert.equal(decision.notify === false ? decision.reason : '', 'below-min-duration')
})

test('DUR-03 a duration exactly at the floor is not suppressed', () => {
  const config = testConfig({ minTurnDurationMs: 60_000 })
  assert.deepEqual(decideNotification(testCandidate({ durationMs: 60_000 }), config, false), { notify: true })
})

test('DUR-04 a floor of 0 suppresses nothing', () => {
  assert.deepEqual(decideNotification(testCandidate({ durationMs: 0 }), testConfig({ minTurnDurationMs: 0 }), false), {
    notify: true,
  })
})

test('DUR-01 an unknown duration is never suppressed by the floor', () => {
  const config = testConfig({ minTurnDurationMs: 60_000 })
  const midTurn = testCandidate({ durationMs: null, telemetryComplete: false, sawTurnStart: false })
  assert.deepEqual(
    decideNotification(midTurn, config, false),
    { notify: true },
    'unknown is not short; suppressing here would drop exactly the mid-turn case',
  )
})

test('DUR-01b a candidate with no durationMs key at all is also not suppressed', () => {
  const candidate = testCandidate()
  delete candidate.durationMs
  assert.deepEqual(decideNotification(candidate, testConfig({ minTurnDurationMs: 60_000 }), false), { notify: true })
})

test('DED-01 a duplicate is suppressed with the duplicate reason', () => {
  const decision = decideNotification(testCandidate(), testConfig(), true)
  assert.deepEqual(decision, { notify: false, reason: 'duplicate' })
})

test('SUP-06 the decision order is master switch, scope, policy, text, duration, duplicate', () => {
  const config = testConfig({ minTurnDurationMs: 60_000 })
  const emptyAndShort = testCandidate({ visibleText: '   ', durationMs: 10, status: 'error', turnEndKind: 'error' })

  // 1 beats everything.
  assert.equal(
    (decideNotification(emptyAndShort, { ...config, enabled: false }, true) as { reason: string }).reason,
    'disabled',
  )
  // 3 (policy) beats 4 and 5.
  assert.equal((decideNotification(emptyAndShort, config, true) as { reason: string }).reason, 'disabled-by-policy')
  // With the policy open, 4 (text) beats 5 (duration).
  const openPolicy = testConfig({ minTurnDurationMs: 60_000, notifyErrors: true })
  assert.equal(
    (decideNotification(emptyAndShort, openPolicy, true) as { reason: string }).reason,
    'no-visible-text',
  )
  // With text present, 5 (duration) beats 6 (duplicate).
  const shortWithText = testCandidate({ visibleText: 'text', durationMs: 10 })
  assert.equal((decideNotification(shortWithText, openPolicy, true) as { reason: string }).reason, 'below-min-duration')
  // Finally, the duplicate rule, reached only once every earlier rule passes.
  const duplicateCandidate = testCandidate({ visibleText: 'text', durationMs: 60_000 })
  assert.equal(
    (decideNotification(duplicateCandidate, openPolicy, true) as { reason: string }).reason,
    'duplicate',
  )
  assert.deepEqual(decideNotification(duplicateCandidate, openPolicy, false), { notify: true })
})

test('DED-02 two different turns of one session both notify', () => {
  const config = testConfig()
  assert.deepEqual(decideNotification(testCandidate({ turn: 1 }), config, false), { notify: true })
  assert.deepEqual(decideNotification(testCandidate({ turn: 2 }), config, false), { notify: true })
})

test('the dedupe key is session-scoped and turn-numbered', () => {
  assert.equal(DedupeCache.keyFor('session-a', 3), 'session-a:3')
  assert.notEqual(DedupeCache.keyFor('session-a', 3), DedupeCache.keyFor('session-b', 3))
  assert.notEqual(DedupeCache.keyFor('session-a', 3), DedupeCache.keyFor('session-a', 4))
})

test('the dedupe cache reports only marked keys', () => {
  const cache = new DedupeCache(10)
  const key = DedupeCache.keyFor('session-a', 1)
  assert.equal(cache.has(key), false)
  cache.mark(key)
  assert.equal(cache.has(key), true)
  assert.equal(cache.size, 1)
})

test('DED-03 the cache is bounded and evicts the oldest key', () => {
  const capacity = 10
  const cache = new DedupeCache(capacity)
  for (let turn = 1; turn <= capacity + 5; turn += 1) cache.mark(DedupeCache.keyFor('session-a', turn))
  assert.equal(cache.size, capacity, 'the cache must never exceed its capacity')
  assert.equal(cache.has(DedupeCache.keyFor('session-a', 1)), false, 'the oldest key was evicted')
  assert.equal(cache.has(DedupeCache.keyFor('session-a', capacity + 5)), true, 'the newest key is retained')
})

test('DED-03b re-marking an existing key is idempotent and does not evict', () => {
  const cache = new DedupeCache(2)
  cache.mark(DedupeCache.keyFor('session-a', 1))
  cache.mark(DedupeCache.keyFor('session-a', 2))
  cache.mark(DedupeCache.keyFor('session-a', 1))
  assert.equal(cache.size, 2)
  assert.equal(cache.has(DedupeCache.keyFor('session-a', 2)), true)
})

test('DED-04 suppression leaves no mark, so the same turn can still be delivered later', () => {
  const cache = new DedupeCache(10)
  const config = testConfig()
  const key = DedupeCache.keyFor('session-a', 7)

  // First settlement: no usable text, so the decision is a suppression and the
  // caller has no reason to mark. This is the contract the handler follows.
  const first = decideNotification(testCandidate({ turn: 7, visibleText: '', visibleTextLength: 0 }), config, cache.has(key))
  assert.deepEqual(first, { notify: false, reason: 'no-visible-text' })
  assert.equal(cache.has(key), false, 'a suppressed turn must not occupy its key')

  // Second settlement of the same turn, this time with text: it must be sent.
  const second = decideNotification(testCandidate({ turn: 7, visibleText: 'now there is text' }), config, cache.has(key))
  assert.deepEqual(second, { notify: true })
  cache.mark(key)
  assert.equal(cache.has(key), true)

  // Third settlement: the duplicate rule now applies as intended.
  const third = decideNotification(testCandidate({ turn: 7, visibleText: 'now there is text' }), config, cache.has(key))
  assert.deepEqual(third, { notify: false, reason: 'duplicate' })
})

test('the cache can be cleared on unload', () => {
  const cache = new DedupeCache(10)
  cache.mark(DedupeCache.keyFor('session-a', 1))
  cache.clear()
  assert.equal(cache.size, 0)
})

test('a capacity below one is clamped rather than accepted', () => {
  const cache = new DedupeCache(0)
  cache.mark('k')
  assert.equal(cache.size, 1)
})
