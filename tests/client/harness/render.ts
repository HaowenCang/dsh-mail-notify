/**
 * The component-test entry: mount the real card against a mock host.
 *
 * Importing this module (before anything else in a test file) installs the
 * jsdom environment. `renderCard` then loads the built bundle, applies the
 * plugin to a mock DSH context, and renders the registered card through a
 * locale outlet that stands in for the renderer's `t`-seat wiring: it
 * subscribes to the locale service's revision exactly as an outlet does, and
 * mints a NEW translate function per revision, so a live locale switch
 * re-renders the mounted card without the test touching it.
 *
 * Everything below the outlet — the registered component, the controller, the
 * settings projection, the dictionaries registered by `apply` — is the real
 * shipping code, taken from `lib/client.js`.
 *
 * @module dsh-mail-notify/tests/client/harness/render
 */

import './dom.ts'
import { createElement, useCallback, useMemo, useSyncExternalStore, type ComponentType, type ReactElement } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { SETTINGS_NAMESPACE } from '../../../src/protocol.ts'
import { loadClientBundle, type ClientModule } from './bundle.ts'
import { cardRegistration, createMockHost, type HostOptions, type MockHost, type SlotRegistration } from './host.ts'
import { createMockLocale, makeTranslate, type MockLocale } from './locale.ts'

export { act, cleanup, screen, waitFor, within }

/** A fresh user-event driver bound to the installed DOM. */
export function setupUser(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup()
}

/** One mounted card. */
export interface CardMount {
  readonly host: MockHost
  readonly registration: SlotRegistration
  /** The rendered tree's result, for unmount and container queries. */
  readonly result: ReturnType<typeof render>
  /**
   * The disclosure header — the one button that carries `aria-controls`.
   * Addressed structurally so the query survives copy changes between locales.
   */
  header(): HTMLButtonElement
  /** The registrant's injected face (`{ card }`), for direct controller calls. */
  face(): Record<string, unknown>
}

/** A card environment: one plugin application, mountable more than once. */
export interface CardEnv {
  readonly client: ClientModule
  readonly host: MockHost
  /** Render the registered card. Repeated mounts share the same controller. */
  mount(): CardMount
}

function Outlet(props: {
  locale: MockLocale
  namespace: string
  component: ComponentType<Record<string, unknown>>
  face: Record<string, unknown>
}): ReactElement {
  const { locale, namespace, component, face } = props
  const subscribe = useCallback((listener: () => void) => locale.subscribe(listener), [locale])
  const read = useMemo(() => () => locale.getSnapshot(), [locale])
  const snapshot = useSyncExternalStore(subscribe, read, read)
  // A new translate identity per locale revision — the contract the renderer's
  // locale seat follows, and what re-renders the card on a live switch.
  // `snapshot` is the revision proxy: it changes exactly when the locale does.
  const t = useMemo(() => makeTranslate(locale, namespace), [locale, snapshot])
  return createElement(component, { ...face, t })
}

/**
 * Apply the plugin to a fresh mock host without rendering yet.
 *
 * @param options - initial document, status, credential, and endpoint answers.
 * @param initialLocale - the locale the service double starts in.
 * @returns the environment.
 */
export function createCard(options: HostOptions = {}, initialLocale = 'en'): CardEnv {
  const client = loadClientBundle()
  const host = createMockHost(client, options, createMockLocale(initialLocale))
  return {
    client,
    host,
    mount() {
      const registration = cardRegistration(host)
      const inject = registration.options.inject
      if (inject === undefined) throw new Error('the card registration declared no inject face')
      const face = inject()
      const component = registration.component as ComponentType<Record<string, unknown>>
      const result = render(
        createElement(Outlet, { locale: host.locale, namespace: SETTINGS_NAMESPACE, component, face }),
      )
      return {
        host,
        registration,
        result,
        header() {
          const button = result.container.querySelector('button[aria-controls]')
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error('the card rendered no disclosure header (button[aria-controls])')
          }
          return button
        },
        face() {
          return face
        },
      }
    },
  }
}

/**
 * Apply the plugin and render the card in one step.
 *
 * @param options - initial document, status, credential, and endpoint answers.
 * @param initialLocale - the locale the service double starts in.
 * @returns the environment plus the first mount.
 */
export function renderCard(options: HostOptions = {}, initialLocale = 'en'): CardEnv & CardMount {
  const env = createCard(options, initialLocale)
  const mounted = env.mount()
  return { ...env, ...mounted }
}
