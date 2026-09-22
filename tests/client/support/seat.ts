/**
 * A test-side model of the DSH locale seat.
 *
 * The card consumes exactly one locale surface: the `t` translate the slot
 * machinery derives from `LocaleRuntime.bind(namespace)` per `(namespace,
 * revision)`. This module models that published contract — lookup in the entry
 * namespace across the active language with English as the fallback, a new
 * translate identity per revision, and change notification to mounted outlets —
 * so the card's half of the integration is testable in Node.
 *
 * It is a model, not a second locale runtime: no language is chosen here, no
 * dictionary is registered here, and nothing in `src/` imports it. The real
 * service's side of the contract (registration, preference storage, the
 * fallback chain, and the live switch in a mounted page) is verified against
 * the installed `@deepseek-ai/dsh-client-locale@0.1.5-rc.2` in the real-browser
 * run recorded in `MIMO_V2_6_PRO_EVAL.md`.
 *
 * @module dsh-mail-notify/tests/client/support/seat
 */

import { en, zh, formatMailText, type MailNotifyTranslate } from '../../../src/client/locale.ts'

/** The seat's observable face: active locale and a monotonic revision. */
export interface LocaleSeat {
  /** The active locale id. */
  readonly active: string
  /** Monotonic revision, advanced on every locale switch. */
  readonly revision: number
  /**
   * The current translate — a NEW reference on every revision, exactly as the
   * renderer's `(namespace, revision)` derivation hands out.
   */
  current(): MailNotifyTranslate
  /**
   * Observe revision changes (what a mounted outlet binds to).
   * @param listener - invoked after every switch.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Switch the active locale. Unknown ids fall back to English copy, which is
   * the published lookup chain's terminal behavior for languages this plugin
   * ships no dictionary for.
   * @param id - the locale id to activate.
   */
  setLocale(id: string): void
}

/**
 * Build one seat.
 *
 * @param initial - the locale to open in ('en' when omitted).
 * @returns the seat.
 */
export function createLocaleSeat(initial = 'en'): LocaleSeat {
  const dictionaries: Record<string, Record<string, string>> = { en, zh }
  const listeners = new Set<() => void>()
  let active = initial
  let revision = 0
  let translate = derive(initial)

  /** One namespace-bound translate, reading the active locale at call time. */
  function derive(locale: string): MailNotifyTranslate {
    const dictionary = dictionaries[locale] ?? {}
    return (key: string, params?: Record<string, unknown>): string => {
      const template = dictionary[key] ?? en[key as keyof typeof en] ?? key
      return formatMailText(template, params)
    }
  }

  return {
    get active(): string {
      return active
    },
    get revision(): number {
      return revision
    },
    current: () => translate,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setLocale: (id) => {
      active = id
      revision += 1
      translate = derive(id)
      for (const listener of [...listeners]) listener()
    },
  }
}
