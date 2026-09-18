/**
 * The credential-reference contract, checked against the DSH code that will
 * actually receive the reference.
 *
 * This file exists because Phase 8 changed `CREDENTIAL_REF_PATTERN` on a
 * diagnosis that turned out to be wrong: the store's `<scope>/<id>`
 * addressing was read as the grammar for *references*, when it is the grammar
 * for *records* — the other half of the seam, reached through different
 * methods. A grammar test against the plugin's own copy of the pattern cannot
 * catch that class of error, because the copy is exactly what was wrong.
 *
 * So the pattern is compared, case by case, against `credentialRef()` and
 * `isCredentialRefName()` from the installed `@deepseek-ai/dsh-credentials`:
 * the two must agree on every candidate. The `refs` section of
 * `$DSH_HOME/.credentials.yaml` is parsed through the same helper at provider
 * boot, which is why agreeing with it is the whole requirement (D019).
 *
 * Nothing here reads a credential value: the only inputs are reference names,
 * and the only outputs are the pattern's own verdicts.
 *
 * @module dsh-mail-notify/tests/integration/credential-contract
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { credentialKey, credentialRef, isCredentialKeySegment, isCredentialRefName, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { CREDENTIAL_REF_PATTERN } from '../../src/config.ts'

/**
 * Candidates that must be accepted as a `CredentialRef`.
 *
 * The first entry is the name the project has always shipped and the one the
 * plugin's own documentation, `.env.example`, and resolved-config default
 * carry; a regression that rejected it would break every existing deployment.
 */
const ACCEPTED = [
  'DSH_MAIL_SMTP_PASSWORD',
  'DEEPSEEK_API_KEY',
  '_private',
  'lower_case_ok',
  'A',
  'a1',
  'MIXED_Case_99',
]

/**
 * Candidates that must be rejected.
 *
 * Most are not POSIX identifiers at all. The `/`-bearing entries are the ones
 * Phase 8 wrongly admitted: they are `CredentialKey` shapes, and the seam keeps
 * the two grammars disjoint precisely so a subject can never be ambiguous about
 * which key space it belongs to.
 */
const REJECTED = [
  // Not POSIX identifiers.
  '',
  'has space',
  'has-dash',
  '1leading_digit',
  'has.dot',
  'has:colon',
  'ünïcode',
  ' leading_space',
  'trailing_space ',
  // CredentialKey shapes: the record half of the store, not the reference half.
  'credentials/smtp-password',
  'dsh/mail-smtp-password',
  'scope/UPPER',
  'bad/',
  '/bad',
  'a//b',
  'a/b/c',
  // The literal reference is never the value it refers to.
  'correct horse battery staple',
]

test('CREDENTIAL_REF_PATTERN agrees with the installed DSH credentialRef() helper', () => {
  for (const candidate of [...ACCEPTED, ...REJECTED]) {
    const helperAccepts = isCredentialRefName(candidate)
    assert.equal(
      CREDENTIAL_REF_PATTERN.test(candidate),
      helperAccepts,
      `the plugin pattern and DSH's isCredentialRefName disagree about ${JSON.stringify(candidate)}`,
    )
  }
})

test('the accepted set is exactly what DSH brands as a reference', () => {
  for (const candidate of ACCEPTED) {
    // Both halves matter: `isCredentialRefName` predicts, `credentialRef`
    // enforces, and a pattern matching only the predictor would still be wrong.
    assert.equal(isCredentialRefName(candidate), true, `${candidate} must be a reference name`)
    assert.equal(credentialRef(candidate), candidate)
  }
  for (const candidate of REJECTED) {
    assert.equal(isCredentialRefName(candidate), false, `${candidate} must not be a reference name`)
    assert.throws(() => credentialRef(candidate), TypeError)
  }
})

test('the reference grammar and the record grammar are disjoint, and the plugin uses the first', () => {
  // The seam documents the `/` as what keeps the two key spaces from
  // colliding. If a future DSH release widened the reference grammar to admit
  // it, this assertion would fail and the contract would have to be re-read
  // rather than silently inherited.
  for (const candidate of ACCEPTED) {
    assert.equal(CREDENTIAL_REF_PATTERN.test(candidate), true)
    assert.throws(() => parseCredentialKey(candidate), TypeError, `${candidate} must not parse as a key`)
  }

  const key = credentialKey('credentials', 'smtp-password')
  assert.equal(key, 'credentials/smtp-password')
  assert.equal(isCredentialKeySegment('credentials'), true)
  assert.equal(isCredentialKeySegment('smtp-password'), true)
  // A key is built from segments that are individually valid key segments and
  // is still not a reference; that asymmetry is the point.
  assert.equal(CREDENTIAL_REF_PATTERN.test(key), false)
})
