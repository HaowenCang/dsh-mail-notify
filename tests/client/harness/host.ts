/**
 * A test double of the DSH client context the card's plugin body runs against.
 *
 * The double implements exactly the surface `src/client/index.tsx` consumes —
 * `effect`, `slots`, `settingsScope`, `connection.rpc`, `remote.credentials`,
 * `remote.$on`, and `locale` — with a settings document that behaves like the
 * host's (revision-fenced writes, user-layer presence, subscriber
 * notification), gated wire endpoints for in-flight tests, and full call
 * recording so a test can assert what crossed the wire. It is deliberately
 * NOT a mock of DSH internals: nothing here re-implements the slot registry's
 * shadowing rules or the credentials domain's validation, because the card's
 * behaviour under test does not depend on either.
 *
 * @module dsh-mail-notify/tests/client/harness/host
 */

import { SETTINGS_NAMESPACE } from '../../../src/protocol.ts'
import type { StatusValue, TestEmailValue } from '../../../src/protocol.ts'
import { createMockLocale, type MockLocale } from './locale.ts'

/** A settings path operation, as the card's save plans them. */
export type PathOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** The settings document snapshot the controller reads. */
export interface ScopeSnapshotMock {
  readonly revision: number
  readonly status: 'ok' | 'unavailable'
  readonly writable: boolean
  readonly value?: Record<string, unknown>
  readonly user?: Record<string, unknown>
}

/** The bound settings scope the controller drives. */
export interface ScopeMock {
  getSnapshot(): ScopeSnapshotMock
  subscribe(listener: () => void): () => void
  mutate(ops: PathOp[], revision: number): Promise<void>
}

/** One slot registration the client plugin performed. */
export interface SlotRegistration {
  readonly options: {
    name?: string
    key?: string
    locale?: string
    /** The registrant's business-face factory, when the entry declared one. */
    inject?: (() => Record<string, unknown>) | undefined
  }
  readonly component: unknown
}

/** Replaceable endpoints, so a test can hold an operation in flight. */
export interface HostHooks {
  /** Gate the next `mutate` call; assign `undefined` to restore the default. */
  mutate?: ((ops: PathOp[]) => Promise<void>) | undefined
  /** Gate the next test-email call. */
  testEmail?: (() => Promise<TestEmailValue>) | undefined
  /** Override the next status read. */
  status?: (() => Promise<StatusValue>) | undefined
}

/** One credential operation, with the value only when one was written. */
export interface CredentialOp {
  readonly op: 'set' | 'unset'
  readonly ref: string
  readonly value?: string
}

/** Initial conditions the mock host starts from. */
export interface HostOptions {
  /** The composition (base) layer of the settings section. */
  base?: Record<string, unknown>
  /** The user-override layer of the settings section. */
  user?: Record<string, unknown>
  /** Whether the host document accepts writes. Default `true`. */
  writable?: boolean
  /** The live status the status endpoint answers with. */
  status?: StatusValue
  /** The credential facts `describe` answers with. */
  credential?: { configured: boolean; writable: boolean }
  /** The test-email endpoint's answer. Default: one accepted recipient count. */
  testEmail?: TestEmailValue
}

/** A deferred promise a test resolves by hand. */
export interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

/**
 * Create a deferred promise.
 *
 * @returns the deferred, resolvable and rejectable from the test.
 */
export function deferred<T>(): Deferred<T> {
  let resolveFn!: (value: T) => void
  let rejectFn!: (reason: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  return { promise, resolve: resolveFn, reject: rejectFn }
}

/** The services the client plugin's `apply` consumes. */
export interface MockContext {
  effect(factory: () => void | (() => void), label?: string): void
  slots: {
    inject(name: string, registrar: () => () => void): () => void
    register(options: SlotRegistration['options'], component: unknown): () => void
  }
  settingsScope: {
    bind(options: { namespace: string }): ScopeMock
  }
  connection: {
    rpc: {
      call(channel: string, endpoint: string, body: unknown, signal?: AbortSignal): Promise<unknown>
    }
  }
  remote: {
    $on(event: string, listener: (payload: never) => void): () => void
    credentials: {
      describe(refs: string[]): Promise<{ ok: boolean; value?: Record<string, { configured: boolean; writable: boolean }>; error?: { message: string } }>
      set(ref: string, value: string): Promise<{ ok: boolean; error?: { message: string } }>
      unset(ref: string): Promise<{ ok: boolean; error?: { message: string } }>
    }
  }
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  }
}

/** The complete test host: context, records, gates, and teardown. */
export interface MockHost {
  readonly ctx: MockContext
  readonly locale: MockLocale
  /** Every registration the plugin performed, in order. */
  readonly registrations: SlotRegistration[]
  /** Every settings write, in order. */
  readonly mutateCalls: PathOp[][]
  /** Every credential write, in order. Values recorded only when written. */
  readonly credentialOps: CredentialOp[]
  /** Every `/api` endpoint addressed, in order. */
  readonly rpcEndpoints: string[]
  /** Replaceable wire endpoints for in-flight control. */
  readonly hooks: HostHooks
  /** Run every effect disposer — the fiber teardown a page unload performs. */
  dispose(): void
}

/** The status answer used when the caller supplies none. */
const DEFAULT_STATUS: StatusValue = {
  active: true,
  smtpConfigured: true,
  credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
}

/**
 * Build one mock host and run the client plugin's `apply` against it.
 *
 * @param client - the loaded client module (`apply` + `inject`).
 * @param options - initial document, status, credential, and endpoint answers.
 * @param locale - the locale service the plugin registers dictionaries into.
 * @returns the host with its records and gates.
 */
export function createMockHost(
  client: { apply(ctx: MockContext): void },
  options: HostOptions = {},
  locale: MockLocale = createMockLocale('en'),
): MockHost {
  const base: Record<string, unknown> = { ...(options.base ?? {}) }
  const user: Record<string, unknown> = { ...(options.user ?? {}) }
  const writable = options.writable ?? true
  let revision = 1
  const scopeListeners = new Set<() => void>()
  const eventListeners = new Map<string, Array<(payload: never) => void>>()

  const registrations: SlotRegistration[] = []
  const mutateCalls: PathOp[][] = []
  const credentialOps: CredentialOp[] = []
  const rpcEndpoints: string[] = []
  const disposers: Array<() => void> = []
  const hooks: HostHooks = {}

  const compose = (): Record<string, unknown> => ({ ...base, ...user })

  const scope: ScopeMock = {
    getSnapshot() {
      return {
        revision,
        status: 'ok',
        writable,
        value: compose(),
        user: { ...user },
      }
    },
    subscribe(listener) {
      scopeListeners.add(listener)
      return () => {
        scopeListeners.delete(listener)
      }
    },
    async mutate(ops) {
      mutateCalls.push(ops)
      const gate = hooks.mutate
      if (gate !== undefined) await gate(ops)
      for (const op of ops) {
        const field = op.path[0]
        if (field === undefined) continue
        if (op.op === 'set') user[field] = op.value
        else delete user[field]
      }
      revision += 1
      for (const listener of [...scopeListeners]) listener()
    },
  }

  const ctx: MockContext = {
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    slots: {
      inject(_name, registrar) {
        const dispose = registrar()
        disposers.push(dispose)
        return dispose
      },
      register(options_, component) {
        const registration: SlotRegistration = { options: options_, component }
        registrations.push(registration)
        return () => {
          const index = registrations.indexOf(registration)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
    },
    settingsScope: {
      bind() {
        return scope
      },
    },
    connection: {
      rpc: {
        async call(channel, endpoint) {
          if (channel !== '/api') throw new Error(`unexpected RPC channel "${channel}"`)
          rpcEndpoints.push(endpoint)
          if (endpoint === 'dsh-mail-notify/status') {
            const gate = hooks.status
            const value = gate !== undefined ? await gate() : (options.status ?? DEFAULT_STATUS)
            return { ok: true, value }
          }
          if (endpoint === 'dsh-mail-notify/test-email') {
            const gate = hooks.testEmail
            const value = gate !== undefined ? await gate() : (options.testEmail ?? { delivered: true, recipientCount: 2 })
            return { ok: true, value }
          }
          return { ok: false, error: { message: `no route for "${endpoint}"` } }
        },
      },
    },
    remote: {
      $on(event, listener) {
        const list = eventListeners.get(event) ?? []
        list.push(listener)
        eventListeners.set(event, list)
        return () => {
          const current = eventListeners.get(event) ?? []
          eventListeners.set(
            event,
            current.filter((entry) => entry !== listener),
          )
        }
      },
      credentials: {
        async describe(refs) {
          const facts = options.credential ?? { configured: false, writable: true }
          const value: Record<string, { configured: boolean; writable: boolean }> = {}
          for (const ref of refs) value[ref] = facts
          return { ok: true, value }
        },
        async set(ref, value) {
          credentialOps.push({ op: 'set', ref, value })
          return { ok: true }
        },
        async unset(ref) {
          credentialOps.push({ op: 'unset', ref })
          return { ok: true }
        },
      },
    },
    locale: {
      register(ns, dicts) {
        return locale.register(ns, dicts)
      },
    },
  }

  client.apply(ctx)

  return {
    ctx,
    locale,
    registrations,
    mutateCalls,
    credentialOps,
    rpcEndpoints,
    hooks,
    dispose() {
      for (const disposer of disposers.splice(0).reverse()) disposer()
      scopeListeners.clear()
      eventListeners.clear()
    },
  }
}

/**
 * Find the settings card's registration on a host.
 *
 * @param host - the mock host the plugin was applied to.
 * @returns the `settings.plugin.item` registration keyed by this plugin's namespace.
 * @throws when the plugin registered nothing under the expected key.
 */
export function cardRegistration(host: MockHost): SlotRegistration {
  const found = host.registrations.find(
    (entry) => entry.options.name === 'settings.plugin.item' && entry.options.key === SETTINGS_NAMESPACE,
  )
  if (found === undefined) {
    throw new Error(
      `the client registered no settings.plugin.item entry under "${SETTINGS_NAMESPACE}" (saw ${String(
        host.registrations.map((entry) => entry.options.key ?? entry.options.name ?? '?').join(', '),
      )})`,
    )
  }
  return found
}
