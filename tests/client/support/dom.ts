/**
 * DOM test support for the card's disclosure and localization surfaces.
 *
 * The card is a React component, and the collapse and localization contracts
 * under test are DOM contracts (which controls exist, what `aria-expanded`
 * says, which drafts survive a re-render). They therefore have to be asserted
 * against a mounted component in a DOM, not against a pure function.
 *
 * ## Why this file registers a module hook
 *
 * Node runs these tests with its own TypeScript stripping, which cannot load
 * `.tsx`. The hook below transforms exactly one thing — `.tsx` sources, through
 * the already-declared `typescript` dependency's `transpileModule` with the
 * same `react-jsx` setting `tsconfig.client.json` uses — and defers everything
 * else to Node's normal loading. `npm test` is unchanged, no test-only runtime
 * dependency is introduced, and the tests render the real `src/client` sources
 * rather than a second copy of them. The hook must be registered before the
 * `.tsx` module is loaded, which is why the component is reached through one
 * awaited dynamic import at the end of this module's body.
 *
 * @module dsh-mail-notify/tests/client/support/dom
 */

import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { MailNotifyCard } from '../../../src/client/controller.ts'
import type { ClientContext } from '../../../src/client/contracts.ts'
import type { Root } from 'react-dom/client'
import { createLocaleSeat, type LocaleSeat } from './seat.ts'

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const path = fileURLToPath(url)
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    return { format: 'module', source: output.outputText, shortCircuit: true }
  },
})

/**
 * Publish one jsdom document as the process's DOM globals.
 *
 * Node already defines some of these globals with getters (`navigator`), so
 * every publication goes through `defineProperty`.
 *
 * @param dom - the jsdom instance to publish.
 * @returns the installed window and document.
 */
function publishDom(dom: JSDOM): { window: Window; document: Document } {
  const publish = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
  }
  publish('window', dom.window)
  publish('document', dom.window.document)
  publish('navigator', dom.window.navigator)
  publish('HTMLElement', dom.window.HTMLElement)
  publish('HTMLInputElement', dom.window.HTMLInputElement)
  publish('HTMLSelectElement', dom.window.HTMLSelectElement)
  publish('HTMLButtonElement', dom.window.HTMLButtonElement)
  publish('Element', dom.window.Element)
  publish('Node', dom.window.Node)
  publish('Event', dom.window.Event)
  publish('MouseEvent', dom.window.MouseEvent)
  publish('KeyboardEvent', dom.window.KeyboardEvent)
  publish('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
  publish('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window))
  publish('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window))
  publish('IS_REACT_ACT_ENVIRONMENT', true)
  return { window: dom.window as unknown as Window, document: dom.window.document as unknown as Document }
}

/**
 * The DOM globals must exist before `react-dom` is first loaded.
 *
 * `react-dom`'s ChangeEventPlugin picks its change-detection strategy once, at
 * module evaluation, by feature-testing the ambient `document`; loaded without
 * one, it silently falls back to the legacy path and `onChange` never fires.
 * That is why the first DOM is published here and both `react-dom` and the
 * component are reached through awaited dynamic imports at the end of this
 * module's body, after it.
 */
publishDom(new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true }))

const reactDom = await import('react-dom/client')
const cardView = await import('../../../src/client/Card.tsx')

const createRoot = reactDom.createRoot

/** The card view under test, loaded through the `.tsx` hook above. */
export const MailNotifyCardView = cardView.MailNotifyCardView

/**
 * Install one fresh jsdom document as the process's DOM globals.
 *
 * React DOM reaches for `window`, `document`, `navigator`, and a handful of DOM
 * constructors as globals, so the jsdom window is published the same way a
 * browser would. Each call replaces the previous DOM: tests are isolated even
 * though they share a process.
 *
 * @returns the installed window and document.
 */
export function installDom(): { window: Window; document: Document } {
  return publishDom(new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true }))
}

/** One recorded `/api` call. */
export interface RecordedRpcCall {
  channel: string
  endpoint: string
  payload: unknown
}

/**
 * A faked DSH client context: the configuration form, the credential Remote,
 * and the `/api` channel the card reaches, with every answer owned by the test.
 *
 * The wire shapes mirror what `src/client/wire.ts` validates: envelopes carry
 * `{ ok, value }` or `{ ok, error }`, and the credential namespace exposes
 * exactly `describe`, `set`, and `unset` — there is deliberately no read path
 * to fake, because none exists to call.
 */
export interface FakeHost {
  ctx: ClientContext
  /**
   * The composition layer: the values a field falls back to when the user layer
   * carries no entry. `mutate` never writes here, which is what makes a Reset
   * observable — removing an override has to *reveal* this layer, not clear the
   * field.
   */
  base: Record<string, unknown>
  /**
   * The schema-resolved section the form reports: the composition layer with the
   * user layer applied on top.
   *
   * Derived, never stored, so a test cannot describe a host whose effective
   * value disagrees with its two layers. Assigning it seeds the **user** layer,
   * which is the pair a real Save leaves behind — a field the profile patch
   * carries is both the override and the effective value.
   */
  readonly section: Record<string, unknown>
  /** The raw user layer; presence of a key marks a field overridden. */
  readonly user: Record<string, unknown>
  /**
   * Seed the raw user layer directly, without the section's derived read.
   *
   * Call this **before** the card is mounted: the controller reads the form's
   * snapshot once, so a layer seeded afterwards describes a host nobody asked it
   * to render.
   *
   * @param next - the replacement user layer.
   */
  seedUser(next: Record<string, unknown>): void
  /** Applied mutations, in order; each entry is the op list of one save. */
  mutations: Array<Array<Record<string, unknown>>>
  /** Credential calls, recorded without values. */
  credentialCalls: string[]
  /** `/api` calls, in order. */
  rpcCalls: RecordedRpcCall[]
  /** Credential facts per reference name. */
  credentials: Record<string, { configured: boolean; writable: boolean }>
  /** The status body the status endpoint answers with. */
  status: Record<string, unknown>
  /** The body the delivery-test endpoint answers with. */
  testEmail: Record<string, unknown>
  /** Refuse the next credential write with this message, then behave. */
  refuseCredentialOnce: string | undefined
  /**
   * Hold every asynchronous answer until {@link FakeHost.release} is called, so
   * a test can collapse the card while an operation is still in flight.
   */
  hold(): void
  /** Let held answers through. */
  release(): void
  /** Emit the credential-invalidation event for one reference. */
  emitCredentialUpdated(ref: string): void
}

/** The state a form snapshot is one projection of: the host's two layers. */
interface Layers {
  base: Record<string, unknown>
  user: Record<string, unknown>
}

/** Build one form snapshot from the fake host's two layers. */
function makeSnapshot(layers: Layers): Record<string, unknown> {
  return {
    status: 'ready',
    value: { ...layers.base, ...layers.user },
    base: { ...layers.base },
    // The raw user layer, exactly as the Host reports it: a field's *presence*
    // here is what marks it overridden, which is why the fake carries it as a
    // separate map rather than deriving it from a value comparison.
    user: { ...layers.user },
    revision: 1,
    writable: true,
    mode: 'host',
  }
}

/**
 * Build a fake host with sensible answers.
 *
 * @returns the fake host, ready for a card to bind against.
 */
export function fakeHost(): FakeHost {
  let gate: Promise<void> = Promise.resolve()
  let releaseGate: () => void = () => {}
  const credentialListeners = new Set<(ref: string) => void>()

  const host: FakeHost = {
    ctx: undefined as unknown as ClientContext,
    base: {},
    get section(): Record<string, unknown> {
      return { ...host.base, ...host.user }
    },
    set section(next: Record<string, unknown>) {
      // Seeding the section is seeding the user layer: the effective value and
      // the override are then the same document, exactly as they are after a
      // Save. Assigning it any other way would let a test describe a host the
      // card can never be shown.
      host.seedUser(next)
    },
    get user(): Record<string, unknown> {
      return layers.user
    },
    seedUser: (next: Record<string, unknown>) => {
      layers.user = { ...next }
      // The snapshot is derived, so a layer that moved has to invalidate it —
      // otherwise a test would be asserting against the host it seeded before
      // its own last line.
      snapshot = undefined
    },
    mutations: [],
    credentialCalls: [],
    rpcCalls: [],
    credentials: {},
    status: { active: true, smtpConfigured: true, credentialRef: 'DSH_MAIL_SMTP_PASSWORD' },
    testEmail: { delivered: true, recipientCount: 1 },
    refuseCredentialOnce: undefined,
    hold: () => {
      gate = new Promise((resolve) => {
        releaseGate = resolve
      })
    },
    release: () => {
      releaseGate()
      gate = Promise.resolve()
    },
    emitCredentialUpdated: (ref: string) => {
      for (const listener of [...credentialListeners]) listener(ref)
    },
  }

  /** The host's two layers; `user` is private so every write invalidates the snapshot. */
  const layers: Layers = { base: host.base, user: {} }
  /** The cached projection, rebuilt whenever a layer moved. */
  let snapshot: Record<string, unknown> | undefined
  const formListeners = new Set<() => void>()
  const republish = (): void => {
    snapshot = undefined
    for (const listener of [...formListeners]) listener()
  }

  /**
   * One Host plugin entry's configuration form.
   *
   * The three members are the whole published `ConfigForm` contract minus the
   * single-field `set`/`unset` helpers this card does not use — it stages every
   * edit and submits them as one atomic mutation. Answering `boolean` from
   * `mutate` mirrors the Host: `false` is a refusal the caller must handle, and a
   * transport failure rejects instead.
   */
  const form = {
    // Derived on read, cached until a layer moves: `useSyncExternalStore`
    // requires a stable reference between publications, and the card compares
    // the projection it holds against this one on every render.
    getSnapshot: () => (snapshot ??= makeSnapshot(layers)),
    subscribe: (listener: () => void) => {
      formListeners.add(listener)
      return () => {
        formListeners.delete(listener)
      }
    },
    mutate: async (ops: ReadonlyArray<Record<string, unknown>>) => {
      await gate
      host.mutations.push([...ops])
      const next = { ...layers.user }
      for (const op of ops) {
        const path = op.path as unknown
        const field = Array.isArray(path) && typeof path[0] === 'string' ? path[0] : undefined
        if (field === undefined) continue
        if (op.op === 'set') {
          next[field] = op.value
        } else if (op.op === 'unset') {
          // Only the user layer moves. The effective value is derived from both
          // layers, so an unset reveals the composition value rather than
          // leaving the field blank — which is the whole point of a Reset.
          delete next[field]
        }
      }
      host.seedUser(next)
      republish()
      return true
    },
  }

  const describe = async (refs: string[]) => {
    await gate
    const value: Record<string, { configured: boolean; writable: boolean }> = {}
    for (const ref of refs) {
      const facts = host.credentials[ref]
      if (facts !== undefined) value[ref] = facts
    }
    return { ok: true, value }
  }
  const set = async (ref: string) => {
    await gate
    // The value is deliberately not recorded: nothing a test can read should
    // carry the secret, which is the property COL-12 asserts at the surface.
    host.credentialCalls.push(`set:${ref}`)
    const refusal = host.refuseCredentialOnce
    if (refusal !== undefined) {
      host.refuseCredentialOnce = undefined
      return { ok: false, error: { code: 'credential/rejected', message: refusal } }
    }
    host.credentials[ref] = { configured: true, writable: true }
    return { ok: true, value: undefined }
  }
  const unset = async (ref: string) => {
    await gate
    host.credentialCalls.push(`unset:${ref}`)
    host.credentials[ref] = { configured: false, writable: true }
    return { ok: true, value: undefined }
  }

  host.ctx = {
    // The Host's shared form service, answering for the one entry this card
    // edits. `get` is addressed by the profile entry id, and the fake ignores
    // the argument for the same reason the card does not: both sides already
    // agree on which entry a bundle's page is showing.
    configForms: { get: () => form, whileServed: () => () => {} },
    remote: {
      credentials: { describe, set, unset },
      $on: (name: string, listener: (ref: string) => void) => {
        if (name !== 'credentials/reference-updated') return () => {}
        credentialListeners.add(listener)
        return () => {
          credentialListeners.delete(listener)
        }
      },
    },
    connection: {
      rpc: {
        call: async (channel: string, endpoint: string, payload: unknown) => {
          host.rpcCalls.push({ channel, endpoint, payload })
          await gate
          return {
            ok: true,
            value: endpoint.endsWith('/test-email') ? host.testEmail : host.status,
          }
        },
      },
    },
  } as unknown as ClientContext

  return host
}

/** A mounted card and the handles a test needs to inspect and drive it. */
export interface Mounted {
  card: MailNotifyCard
  container: HTMLElement
  root: Root
  /** The locale seat the card renders through. */
  seat: LocaleSeat
  /** The disclosure control. */
  toggle(): HTMLButtonElement
  /** The disclosure region, by the id `aria-controls` names. */
  region(): HTMLElement
  /** One form control by its `name` attribute. */
  field(name: string): HTMLInputElement | HTMLSelectElement
  /** One action button by its `data-action` hook. */
  action(name: string): HTMLButtonElement
  /** Re-render the same component (props unchanged). */
  rerender(): void
  /** Unmount and mount the view again, against the same controller. */
  remount(): Promise<void>
  /** Unmount the view. The controller is the test's to keep or dispose. */
  unmount(): void
}

/** Fail loudly instead of returning `null` from a query a test depends on. */
function assertPresent<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message)
  return value
}

/**
 * Mount the card against a fake host.
 *
 * The controller is created here, exactly as the client plugin's effect
 * creates it once — it is never recreated because of anything the view does,
 * which is the property the draft-retention tests rest on. The constructor's
 * first status read is flushed inside an `act` scope, so its render lands where
 * a test can observe it. The locale seat is wired the way the renderer wires
 * its own: the card renders through `seat.current()`, and every seat revision
 * re-renders it with a new translate identity.
 *
 * @param host - the fake host.
 * @param seat - the locale seat; a fresh English one when omitted.
 * @param options - `reuseDom: true` mounts into the already-installed document
 *   instead of replacing it, so a second instance can share one document with
 *   the first (the multi-instance id tests need exactly that).
 * @returns the mounted card and its DOM handles.
 */
export async function mountCard(
  host: FakeHost,
  seat: LocaleSeat = createLocaleSeat('en'),
  options: { reuseDom?: boolean } = {},
): Promise<Mounted> {
  if (options.reuseDom !== true) installDom()
  const card = new MailNotifyCard(host.ctx)
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root = createRoot(container)
  let releaseSeat: (() => void) | undefined
  const render = (): void => {
    void act(() => {
      root.render(createElement(MailNotifyCardView, { card, t: seat.current() }))
    })
  }
  render()
  releaseSeat = seat.subscribe(render)
  await settleRender()

  const queryToggle = (): HTMLButtonElement =>
    assertPresent(container.querySelector<HTMLButtonElement>('button[aria-expanded]'), 'the card must render a disclosure control with aria-expanded')

  const mounted: Mounted = {
    card,
    container,
    seat,
    get root(): Root {
      return root
    },
    toggle: queryToggle,
    region: () => {
      const id = assertPresent(queryToggle().getAttribute('aria-controls'), 'the disclosure control must carry aria-controls')
      return assertPresent(document.getElementById(id), `aria-controls must name an existing region (${id})`)
    },
    field: (name: string) =>
      assertPresent(
        container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`),
        `the form must render a control named ${name}`,
      ),
    action: (name: string) =>
      assertPresent(container.querySelector<HTMLButtonElement>(`[data-action="${name}"]`), `the form must render a "${name}" action`),
    rerender: render,
    remount: async () => {
      releaseSeat?.()
      void act(() => {
        root.unmount()
      })
      root = createRoot(container)
      render()
      releaseSeat = seat.subscribe(render)
      await settleRender()
    },
    unmount: () => {
      releaseSeat?.()
      releaseSeat = undefined
      void act(() => {
        root.unmount()
      })
    },
  }
  return mounted
}

/**
 * Press a control the way a pointer would: the DOM's own activation behavior.
 *
 * @param element - the element to activate.
 */
export async function click(element: Element): Promise<void> {
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

/**
 * Type into a text control and let React see the edit.
 *
 * React tracks the input's value descriptor, so the value is set through the
 * prototype setter and followed by a bubbling `input` event — the same pair a
 * browser keystroke produces.
 *
 * @param input - the text control.
 * @param text - the text to enter.
 */
export async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
    setter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/**
 * Choose an option in a select control and let React see the change.
 *
 * @param select - the select control.
 * @param value - the option value to select.
 */
export async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/**
 * Let pending promises and the renders they cause settle.
 *
 * @param mounted - the mounted card.
 */
export async function settle(mounted: Mounted): Promise<void> {
  await settleRender()
  mounted.rerender()
}

/**
 * One `act` window wide enough for a queued async operation to settle.
 *
 * A macrotask turn on purpose: every microtask the fake host's answers chain
 * through runs before the timer fires, so one window covers a whole operation.
 */
async function settleRender(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}
