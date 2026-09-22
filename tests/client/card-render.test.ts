/**
 * A render smoke test for the card, run before the full collapse and locale
 * suites so a harness defect fails on its own rather than as a confusing
 * assertion failure inside a behaviour test.
 *
 * @module dsh-mail-notify/tests/client/card-render
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { document, h, makeLocale, mount, query, settle } from './support/dom.ts'
import { stubClientContext } from './support/client-context.ts'
import { MailNotifyCardView } from '../../src/client/Card.tsx'
import { MailNotifyCard } from '../../src/client/controller.ts'
import type { ClientContext } from '../../src/client/contracts.ts'

test('SMOKE-01 the card renders inside the installed DOM', async () => {
  const { t } = makeLocale()
  const double = stubClientContext()
  const card = new MailNotifyCard(double.ctx as unknown as ClientContext)
  const tree = await mount(h(MailNotifyCardView, { card, t }))
  await settle()
  const section = query('section', tree.container)
  assert.equal(section.getAttribute('aria-label'), 'Mail notifications')
  assert.ok(document.body.contains(section))
  await tree.unmount()
})
