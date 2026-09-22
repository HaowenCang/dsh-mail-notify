export { en, LOCALE_NAMESPACE, zh } from '../../../src/client/locales/index.ts'

/**
 * The browser-test harness: a real DOM, a real React root, and a locale service
 * with the same contract as DSH's.
 *
 * The card's behaviour is DOM behaviour — a disclosure is a button with an
 * `aria-expanded`, drafts live in inputs, a save is a promise a click starts —
 * so these tests drive the rendered card rather than calling its handlers. What
 * they exercise is therefore the same wiring the browser exercises: React's
 * event system, the controller's projection, and the props the registration
 * site composes for the card.
 *
 * ## Why the DOM is installed by hand
 *
 * `happy-dom` supplies the document; nothing supplies the renderer. DSH's own
 * client test runtime would, but it reaches the rc.2 session and agent stack
 * through `0.1.5-rc.3` peers, and this project pins every DSH package to one
 * exact `0.1.5-rc.2` release. Forcing that install would put two releases of
 * the same packages in one tree — the failure mode the pins exist to prevent.
 * The DOM is therefore the only addition, and React is the project's own
 * already-declared dependency.
 *
 * ## Why the locale service is a double here
 *
 * `@deepseek-ai/dsh-client-locale`'s browser entry is a DSH module-loader
 * envelope whose factory `require`s `dsh-client-ui-primitives` and
 * `dsh-client-store`. Those packages' published `latest` dist-tags resolve to
 * `0.0.1-rc.1` and `0.1.2-alpha.2` — neither exists at `0.1.5-rc.2` — so
 * loading the real runtime under Node would mean installing exactly the stale
 * family this project refuses to install. {@link TestLocaleRuntime} therefore
 * implements the *contract* (`register`, `bind`, `getSnapshot`, `subscribe`)
 * with the documented lookup semantics: per-language fallback, then the shared
 * `common` namespace, then the key itself.
 *
 * That is the honest boundary of what these tests can claim: they prove the
 * plugin registers its dictionaries, binds its namespace, and renders through
 * the seat it was given. Whether DSH's shipped runtime walks that chain
 * correctly is DSH's property and is verified where it actually runs — the
 * packed-plugin Web smoke test in the evaluation report.
 *
 * @module dsh-mail-notify/tests/client/support/dom
 */

import assert from 'node:assert/strict'
import * as React from 'react'
import { createElement, act as reactAct, type ReactElement, type ReactNode } from 'react'
import { Window } from 'happy-dom'
import { en, LOCALE_NAMESPACE, zh, type MailNotifyTranslate } from '../../../src/client/locales/index.ts'
/**
 * Publish React as a global.
 *
 * ## Why this is necessary
 *
 * The test loader strips TypeScript through esbuild, which picks the JSX
 * runtime per file rather than from `tsconfig.json`'s `jsx` option: the
 * automatic runtime under `NODE_ENV=production` and the classic
 * `React.createElement` otherwise. The production branch is not an option —
 * React's `act`, which every test here drives the card through, refuses to run
 * in a production build — so files that esbuild compiles with the classic
 * runtime need `React` in scope.
 *
 * `src/client/Card.tsx` is one of those files and does not import React
 * itself, because `tsconfig.client.json` compiles it with `jsx: react-jsx`,
 * where importing React would be dead weight — and `noUnusedLocals` would
 * reject it. Making React a global in the test process is what lets the *same*
 * production source run under the test loader without a test-only import being
 * added to it.
 *
 * This is done here, in the module the tests import first, rather than in a
 * preload: the import graph evaluates dependencies before the importer's body,
 * so a global assigned inside a test file would be set after the component had
 * already been evaluated.
 */
;(globalThis as unknown as Record<string, unknown>).React = React

/**
 * Build a React element without JSX.
 *
 * The test loader strips TypeScript through esbuild but is not configured with
 * this project's JSX runtime, so a `.tsx` test would compile its tags to
 * `React.createElement` and fail at `React is not defined`. Rather than
 * reconfigure the loader — or pin a second toolchain to render one component —
 * the tests construct elements directly. The component under test is
 * `src/client/Card.tsx`, which the real build compiles; only the test's own
 * call sites lose the sugar, and those are one line each.
 *
 * @param type - the element type.
 * @param props - its props, `key` included.
 * @param children - its children.
 * @returns the element.
 */
export function h(
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: ReactNode[]
): ReactElement {
  return createElement(
    type as never,
    (props ?? null) as never,
    ...children,
  ) as ReactElement
}

/**
 * Render a React tree and return the wrapper's rendered payload.
 *
 * A render is the test's assertion subject in most cases here, so wrapping the
 * element is what lets a test read the returned tree.
 *
 * @param element - the element to render.
 * @returns the element, unchanged; present so callers read symmetrically.
 */
export function render(element: ReactElement): ReactElement {
  return element
}

/** Install the DOM globals once, before any React import is used. */
function installDom(): Window {
  const window = new Window({ url: 'http://localhost/' })
  const global = globalThis as unknown as Record<string, unknown>
  const names = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLButtonElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'KeyboardEvent',
    'MouseEvent',
    'FocusEvent',
    'InputEvent',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'MessageChannel',
    'MutationObserver',
  ] as const
  global.window = window
  for (const name of names) {
    if (name === 'window') continue
    const value = (window as unknown as Record<string, unknown>)[name]
    if (value === undefined) continue
    // Node 24 declares `navigator` as a getter-only global, so a plain
    // assignment throws. Redefining the property is what installs the DOM's
    // navigator, which React and the locale catalogue both read.
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    })
  }
  // React reads this off the global scope, and a React root outside an "act"
  // environment warns on every update rather than failing, which would bury a
  // real error in noise.
  global.IS_REACT_ACT_ENVIRONMENT = true
  return window
}

/** The installed window, created on first use. */
const win: Window = installDom()

/** The document the tests query. */
export const document = win.document as unknown as Document

/**
 * Dispatch one of `happy-dom`'s events at an element.
 *
 * The two `Event` types are structurally close but not identical — the DOM
 * library's declares `isTrusted`, `returnValue`, and `srcElement`, which
 * `happy-dom`'s does not — so the dispatch is narrowed once here rather than at
 * every call site. React's synthetic event system reads the properties it needs
 * off the dispatched object, and those are present.
 *
 * @param target - the element to dispatch at.
 * @param event - the event to dispatch.
 */
function dispatch(target: Element, event: unknown): void {
  ;(target as unknown as { dispatchEvent(value: unknown): boolean }).dispatchEvent(event)
}

/** One dictionary registration, as the service stores it. */
type Dicts = Map<string, Map<string, Record<string, string>>>

/**
 * A locale service implementing the contract DSH's runtime publishes.
 *
 * The behaviour that matters to this plugin is reproduced exactly: dictionaries
 * are keyed by namespace and locale, `bind` returns a stable function per
 * namespace that reads the active locale at call time, a lookup walks the
 * active language's fallback chain, then the shared `common` namespace, then
 * falls back to the key itself. `setLocale` refuses an unregistered id, as the
 * real service does.
 */
export class TestLocaleRuntime {
  private readonly dicts: Dicts = new Map()
  private readonly bound = new Map<string, (key: never, params?: Record<string, unknown>) => string>()
  private readonly listeners = new Set<() => void>()
  private readonly catalog: string[]
  private active: string
  private revision = 0

  /**
   * @param locales - the selectable locale ids, in catalog order.
   */
  constructor(locales: readonly string[] = ['zh', 'en']) {
    this.catalog = [...locales]
    this.active = this.catalog.includes('en') ? 'en' : (this.catalog[0] ?? 'en')
  }

  /** @returns the current snapshot. */
  getSnapshot(): { active: string; locales: readonly { id: string }[]; revision: number } {
    return { active: this.active, locales: this.catalog.map((id) => ({ id })), revision: this.revision }
  }

  /**
   * Switch the active locale.
   * @param id - a registered locale id.
   */
  setLocale(id: string): void {
    if (!this.catalog.includes(id)) throw new Error(`unknown locale "${id}"`)
    if (id === this.active) return
    this.active = id
    this.publish()
  }

  /**
   * Observe snapshot changes.
   * @param listener - notified on every change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Register one namespace's dictionaries.
   * @param ns - the namespace.
   * @param dicts - locale to dictionary.
   * @returns the disposer removing them.
   */
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void {
    let byLocale = this.dicts.get(ns)
    if (byLocale === undefined) {
      byLocale = new Map()
      this.dicts.set(ns, byLocale)
    }
    for (const locale of Object.keys(dicts)) {
      if (byLocale.has(locale)) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`)
    }
    for (const [locale, entries] of Object.entries(dicts)) byLocale.set(locale, entries)
    this.publish()
    return () => {
      for (const [locale, entries] of Object.entries(dicts)) {
        if (byLocale.get(locale) === entries) byLocale.delete(locale)
      }
      this.publish()
    }
  }

  /**
   * Bind a namespace to a translate function.
   * @param ns - the namespace.
   * @returns the stable translate function.
   */
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string {
    const existing = this.bound.get(ns)
    if (existing !== undefined) return existing as (key: string, params?: Record<string, unknown>) => string
    const t = (key: string, params?: Record<string, unknown>): string => this.translate(ns, key, params)
    this.bound.set(ns, t as never)
    return t
  }

  /** Notify every listener and advance the revision. */
  private publish(): void {
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
  }

  /** The lookup chain for the active locale: its own language, then English. */
  private chain(): string[] {
    const chain = [this.active]
    if (this.active !== 'en') chain.push('en')
    return chain
  }

  /** Resolve one key, then the shared namespace, then the key itself. */
  private translate(ns: string, key: string, params?: Record<string, unknown>): string {
    const chain = this.chain()
    const template = this.lookup(ns, key, chain) ?? this.lookup('common', key, chain) ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    )
  }

  /** Walk the chain for one namespace. */
  private lookup(ns: string, key: string, chain: readonly string[]): string | undefined {
    const byLocale = this.dicts.get(ns)
    for (const locale of chain) {
      const value = byLocale?.get(locale)?.[key]
      if (value !== undefined) return value
    }
    return undefined
  }
}

/**
 * A locale service with this plugin's dictionaries registered, in English.
 *
 * @param extraLocales - additional registered locales, for the fallback tests.
 * @returns the service and its namespace-bound translate function.
 */
export function makeLocale(extraLocales: readonly string[] = []): { locale: TestLocaleRuntime; t: MailNotifyTranslate } {
  const locale = new TestLocaleRuntime(['zh', 'en', ...extraLocales])
  locale.register(LOCALE_NAMESPACE, { zh, en })
  const t = locale.bind(LOCALE_NAMESPACE) as unknown as MailNotifyTranslate
  return { locale, t }
}

/**
 * Mount a React tree into a fresh container attached to the document.
 *
 * @param render - receives the container element and the act-aware update hook.
 * @returns the mounted handle.
 */
/**
 * Mount a React root into a fresh container attached to the document.
 *
 * @param element - the element to render.
 * @returns the mounted handle.
 */
export async function mount(element: ReactElement): Promise<MountedTree> {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const draw = async (node: ReactElement): Promise<void> => {
    await reactAct(async () => {
      root.render(node)
    })
  }
  await draw(element)
  return {
    container,
    async update(node: ReactElement): Promise<void> {
      await draw(node)
    },
    async unmount(): Promise<void> {
      await reactAct(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}

/** A mounted React tree under test. */
export interface MountedTree {
  readonly container: HTMLElement
  /** Re-render with a new element. */
  update(node: ReactElement): Promise<void>
  /** Unmount and detach the container. */
  unmount(): Promise<void>
}

/**
 * Let queued microtasks and React work settle.
 *
 * @param times - how many macrotask turns to drain.
 */
export async function settle(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }
}

/**
 * Dispatch a real pointer click, as a user would produce.
 *
 * @param element - the target.
 */
export async function click(element: Element): Promise<void> {
  await reactAct(async () => {
    dispatch(element, new win.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/**
 * Dispatch a real key press, as a user would produce.
 *
 * @param element - the focused element.
 * @param key - the key name.
 */
export async function press(element: Element, key: string): Promise<void> {
  await reactAct(async () => {
    dispatch(element, new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    dispatch(element, new win.KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  })
}

/**
 * Type into a real input, through React's change plumbing.
 *
 * @param element - the input or select.
 * @param value - the new value.
 */
export async function type(element: Element, value: string): Promise<void> {
  const target = element as HTMLInputElement | HTMLSelectElement
  const prototype =
    target.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  assert.ok(setter !== undefined, `${target.tagName} must expose a value setter`)
  await reactAct(async () => {
    setter.call(target, value)
    dispatch(target, new win.Event('input', { bubbles: true }))
    dispatch(target, new win.Event('change', { bubbles: true }))
  })
}

/**
 * Mount the card against a fresh controller, wired to the locale service the
 * way the registration site wires it.
 *
 * The wrapper subscribes to the locale service's snapshot and re-derives `t` on
 * every change. That is not decoration: it is the same mechanism DSH's renderer
 * uses — the renderer re-derives each entry's `t` from `(namespace, revision)`,
 * so a language switch hands out a new function and memoized components
 * re-render. A test that passed a captured `t` would prove nothing about a
 * language switch, because nothing would ever hand the card a new one.
 *
 * @param options - the initial facts to seed the fake host with.
 * @returns the mounted tree, its controller double, and the locale handle.
 */
export async function mountCard(
  options: Parameters<typeof import('./client-context.ts').stubClientContext>[0] = {},
): Promise<MountedCard> {
  const { MailNotifyCard } = await import('../../../src/client/controller.ts')
  const { MailNotifyCardView } = await import('../../../src/client/Card.tsx')
  const { stubClientContext } = await import('./client-context.ts')
  const { useSyncExternalStore } = await import('react')

  const double = stubClientContext(options)
  const card = new MailNotifyCard(double.ctx as never)
  const { locale } = makeLocale()

  const App = (): ReactElement => {
    // One read of the locale revision per render is what makes a switch
    // observable; the value itself is unused, and reading it is the point.
    useSyncExternalStore(
      (listener) => locale.subscribe(listener),
      () => locale.getSnapshot().revision,
      () => locale.getSnapshot().revision,
    )
    return h(MailNotifyCardView, { card, t: locale.bind(LOCALE_NAMESPACE) }) as ReactElement
  }

  const tree = await mount(h(App, null))
  await settle()
  return { tree, card, double, locale }
}

/** A mounted card with the handles a behaviour test needs. */
export interface MountedCard {
  readonly tree: MountedTree
  readonly card: import('../../../src/client/controller.ts').MailNotifyCard
  readonly double: import('./client-context.ts').ClientContextDouble
  readonly locale: TestLocaleRuntime
}

/** The disclosure button, which is the card's only direct child button. */
export function disclosure(root: ParentNode): HTMLButtonElement {
  return query<HTMLButtonElement>('section > button', root)
}

/** Whether the card's body region is currently rendered. */
export function isOpen(root: ParentNode): boolean {
  return root.querySelector('section > div[role="region"]') !== null
}

/**
 * Toggle the disclosure the way a user does: a real click on the real button.
 *
 * @param root - the mounted card's container.
 */
export async function toggle(root: ParentNode): Promise<void> {
  const button = disclosure(root)
  await click(button)
  await settle()
}

/** Query one element, failing loudly when it is absent. */
export function query<T extends Element = Element>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector(selector)
  assert.ok(found !== null, `expected to find ${selector}`)
  return found as T
}

/** Query every element matching a selector. */
export function queryAll<T extends Element = Element>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll(selector)] as T[]
}