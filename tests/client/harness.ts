/**
 * Test harness for dsh-mail-notify client components and controller.
 *
 * Provides a mock ClientContext with SettingsScope, Remote credentials,
 * Connection RPC, and optional LocaleRuntime, plus JSDOM-based mounting helpers.
 *
 * @module dsh-mail-notify/tests/client/harness
 */

import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import ReactDOM from 'react-dom/client'
import type { ClientContext } from '../../src/client/contracts.ts'
import { MailNotifyCard } from '../../src/client/controller.ts'
import { MailNotifyCardView } from '../../src/client/Card.ts'
import type { StatusValue, TestEmailValue } from '../../src/protocol.ts'

// Ensure React act environment is recognized without console warnings.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

export interface MockScopeOptions {
  value?: Record<string, unknown>
  user?: Record<string, unknown>
  writable?: boolean
  status?: string
}

export interface MockContextOptions {
  scope?: MockScopeOptions
  status?: StatusValue
  testEmail?: TestEmailValue
  credentials?: Record<string, { configured: boolean; writable: boolean }>
  locale?: string
}

export interface FakeClientEnvironment {
  ctx: ClientContext
  setScopeValue: (value: Record<string, unknown>, user?: Record<string, unknown>) => void
  setRuntimeStatus: (status: StatusValue) => void
  setLocale: (locale: string) => void
  triggerCredentialUpdate: (ref: string) => void
  credentials: Record<string, { configured: boolean; writable: boolean }>
  passwords: Record<string, string>
}

export function createFakeClientContext(options: MockContextOptions = {}): FakeClientEnvironment {
  let scopeValue = options.scope?.value ?? {}
  let scopeUser = options.scope?.user ?? {}
  let scopeRevision = 1
  const scopeListeners = new Set<() => void>()
  const credentialListeners = new Set<(ref: string) => void>()
  const localeListeners = new Set<() => void>()

  let activeLocale = options.locale ?? 'en'
  let localeRevision = 1

  const credentials: Record<string, { configured: boolean; writable: boolean }> = {
    DSH_MAIL_SMTP_PASSWORD: { configured: false, writable: true },
    ...(options.credentials ?? {}),
  }
  const passwords: Record<string, string> = {}

  let runtimeStatus: StatusValue = options.status ?? {
    active: true,
    smtpConfigured: true,
    credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
  }

  const testEmailResult: TestEmailValue = options.testEmail ?? {
    delivered: true,
    recipientCount: 1,
    message: 'OK',
  }

  const scope = {
    getSnapshot: () => ({
      status: options.scope?.status ?? 'ready',
      writable: options.scope?.writable ?? true,
      value: scopeValue,
      user: scopeUser,
      revision: scopeRevision,
    }),
    subscribe: (listener: () => void) => {
      scopeListeners.add(listener)
      return () => {
        scopeListeners.delete(listener)
      }
    },
    mutate: async (ops: Array<{ op: string; path: string[]; value?: unknown }>) => {
      scopeRevision++
      for (const op of ops) {
        const field = op.path[0]
        if (!field) continue
        if (op.op === 'unset') {
          const nextVal = { ...scopeValue }
          delete nextVal[field]
          scopeValue = nextVal
          const nextUser = { ...scopeUser }
          delete nextUser[field]
          scopeUser = nextUser
        } else if (op.op === 'set') {
          scopeValue = { ...scopeValue, [field]: op.value }
          scopeUser = { ...scopeUser, [field]: op.value }
        }
      }
      for (const listener of scopeListeners) listener()
    },
  }

  const fakeCtx = {
    settingsScope: {
      bind: () => scope,
    },
    remote: {
      $on: (event: string, listener: (ref: string) => void) => {
        if (event === 'credentials/reference-updated') {
          credentialListeners.add(listener)
          return () => {
            credentialListeners.delete(listener)
          }
        }
        return () => {}
      },
      credentials: {
        describe: async (refs: string[]) => {
          const result: Record<string, { configured: boolean; writable: boolean }> = {}
          for (const ref of refs) {
            result[ref] = credentials[ref] ?? { configured: false, writable: true }
          }
          return { ok: true, value: result }
        },
        set: async (ref: string, value: string) => {
          passwords[ref] = value
          credentials[ref] = { configured: true, writable: true }
          for (const listener of credentialListeners) listener(ref)
          return { ok: true, value: undefined }
        },
        unset: async (ref: string) => {
          delete passwords[ref]
          credentials[ref] = { configured: false, writable: true }
          for (const listener of credentialListeners) listener(ref)
          return { ok: true, value: undefined }
        },
      },
    },
    connection: {
      rpc: {
        call: async (_channel: string, endpoint: string) => {
          if (endpoint.endsWith('/status')) {
            return { ok: true, value: runtimeStatus }
          }
          if (endpoint.endsWith('/test-email')) {
            return { ok: true, value: testEmailResult }
          }
          return { ok: false, error: { message: `unknown endpoint: ${endpoint}` } }
        },
      },
    },
    locale: {
      getLocale: () => ({ active: activeLocale, revision: localeRevision, locales: [] }),
      getSnapshot: () => ({ active: activeLocale, revision: localeRevision, locales: [] }),
      subscribe: (listener: () => void) => {
        localeListeners.add(listener)
        return () => {
          localeListeners.delete(listener)
        }
      },
      register: () => () => {},
      bind: () => (key: string) => key,
    },
    effect: (fn: () => void | (() => void)) => {
      const cleanup = fn()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    slots: {
      inject: (_slot: string, factory: () => () => void) => factory(),
      register: () => () => {},
    },
  } as unknown as ClientContext

  return {
    ctx: fakeCtx,
    setScopeValue: (val, user) => {
      scopeValue = val
      scopeUser = user ?? val
      scopeRevision++
      for (const listener of scopeListeners) listener()
    },
    setRuntimeStatus: (st) => {
      runtimeStatus = st
    },
    setLocale: (loc) => {
      activeLocale = loc
      localeRevision++
      for (const listener of localeListeners) listener()
    },
    triggerCredentialUpdate: (ref) => {
      for (const listener of credentialListeners) listener(ref)
    },
    credentials,
    passwords,
  }
}

export interface MountedCard {
  container: HTMLElement
  card: MailNotifyCard
  getHeaderButton: () => HTMLButtonElement
  getSummaryText: () => string
  getTitleText: () => string
  toggle: () => Promise<void>
  pressKey: (key: 'Enter' | ' ') => Promise<void>
  isExpanded: () => boolean
  unmount: () => Promise<void>
}

export async function mountCard(card: MailNotifyCard): Promise<MountedCard> {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  })
  // Bind global window and document for React DOM interactions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = dom.window
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).document = dom.window.document

  const container = dom.window.document.getElementById('root')!
  const root = ReactDOM.createRoot(container)

  await act(async () => {
    root.render(React.createElement(MailNotifyCardView, { card }))
  })

  const getHeaderButton = (): HTMLButtonElement => {
    const btn = container.querySelector('button[aria-expanded]')
    if (!btn) throw new Error('disclosure header button not found')
    return btn as HTMLButtonElement
  }

  const isExpanded = (): boolean => {
    return getHeaderButton().getAttribute('aria-expanded') === 'true'
  }

  const toggle = async (): Promise<void> => {
    await act(async () => {
      getHeaderButton().click()
    })
  }

  const pressKey = async (key: 'Enter' | ' '): Promise<void> => {
    await act(async () => {
      const event = new dom.window.KeyboardEvent('keydown', {
        key: key === ' ' ? ' ' : 'Enter',
        code: key === ' ' ? 'Space' : 'Enter',
        bubbles: true,
        cancelable: true,
      })
      getHeaderButton().dispatchEvent(event)
      getHeaderButton().click()
    })
  }

  const getSummaryText = (): string => {
    const btn = getHeaderButton()
    const spans = btn.querySelectorAll('span')
    return spans.length > 0 ? spans[0]!.textContent ?? '' : ''
  }

  const getTitleText = (): string => {
    const strong = container.querySelector('strong')
    return strong?.textContent ?? ''
  }

  const unmount = async (): Promise<void> => {
    await act(async () => {
      root.unmount()
    })
  }

  return {
    container,
    card,
    getHeaderButton,
    getSummaryText,
    getTitleText,
    toggle,
    pressKey,
    isExpanded,
    unmount,
  }
}
