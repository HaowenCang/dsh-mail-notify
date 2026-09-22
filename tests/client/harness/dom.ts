/**
 * The DOM environment the card's component tests run in.
 *
 * This module must be evaluated before any module that reads DOM globals at
 * load time — in particular before `@testing-library/react`, whose automatic
 * cleanup registers itself against a global `afterEach` and against the
 * presence of `window`/`document` at import time. The harness entry
 * (`harness/render.ts`) imports this file first for that reason, and the tests
 * import only the harness entry.
 *
 * Globals are installed with `Object.defineProperty` rather than assignment:
 * Node 24 already defines a global `navigator` accessor, which a plain
 * assignment would throw on in strict mode.
 *
 * @module dsh-mail-notify/tests/client/harness/dom
 */

import { afterEach } from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1/',
})

/** Install one global, overwriting whatever the runtime already defines. */
function defineGlobal(key: string, value: unknown): void {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

defineGlobal('window', dom.window)
defineGlobal('document', dom.window.document)
defineGlobal('navigator', dom.window.navigator)

// The surface React DOM, user-event, and the queries touch. Each is taken from
// the jsdom window so the tests see exactly one DOM implementation.
const WINDOW_KEYS = [
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLButtonElement',
  'HTMLAnchorElement',
  'HTMLTextAreaElement',
  'SVGElement',
  'Element',
  'Node',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'InputEvent',
  'DOMParser',
  'getComputedStyle',
  'MutationObserver',
] as const
for (const key of WINDOW_KEYS) {
  const value = (dom.window as unknown as Record<string, unknown>)[key]
  if (value !== undefined) defineGlobal(key, value)
}

// React 18 requires this flag before `act` may flush work outside a bundler's
// test environment.
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)

// node:test has no ambient `afterEach`; exposing the file-level hook here is
// what lets @testing-library/react register its automatic cleanup on import,
// exactly as it does under Jest without configuration.
defineGlobal('afterEach', afterEach)
