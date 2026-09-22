/**
 * A test double of the DSH client locale service, plus the dictionary lookup
 * it performs.
 *
 * The lookup mirrors the installed `0.1.5-rc.2` `LocaleRuntime` exactly where
 * the card can observe it: the active locale's fallback chain is consulted in
 * the entry namespace first, English terminates every chain, and an unresolved
 * key renders as the key itself. `{name}` template parameters are substituted
 * with the same regular expression the runtime uses. A locale id outside the
 * built-ins (`ja`, or any future language pack) falls straight to English,
 * which is the property the "unknown locale" acceptance case rests on.
 *
 * What this double does NOT model is dictionary *registration policy* (the
 * runtime's duplicate-registration throws) — the card's registrations are
 * captured verbatim instead, so tests can assert what was registered without
 * re-testing DSH's own bookkeeping.
 *
 * @module dsh-mail-notify/tests/client/harness/locale
 */

/** One namespace's dictionaries, keyed by locale id (`zh`, `en`, …). */
export type NamespaceDicts = Record<string, Record<string, string>>

/** The immutable face snapshot the outlet subscribes to. */
export interface LocaleSnapshot {
  readonly active: string
  readonly revision: number
}

/** The captured locale service the client plugin talks to. */
export interface MockLocale {
  /** Active locale id; switches notify subscribers. */
  active: string
  /** Register one namespace's dictionaries (what `ctx.locale.register` does). */
  register(ns: string, dicts: NamespaceDicts): () => void
  /** The dictionaries registered for one namespace, for direct assertions. */
  dictFor(ns: string): NamespaceDicts | undefined
  /** Switch the active locale and notify every subscriber. */
  setLocale(id: string): void
  /** Observe snapshot replacements (the outlet's re-render trigger). */
  subscribe(listener: () => void): () => void
  /** The current snapshot; stable reference until the next change. */
  getSnapshot(): LocaleSnapshot
}

/**
 * The fallback chain for one active locale.
 *
 * Mirrors `LocaleRuntime.fallbackChain`: the active id first, then its declared
 * fallbacks, and English appended whenever the chain does not already reach it.
 * The built-ins are `zh → en` and `en` with no successor.
 *
 * @param active - the active locale id.
 * @returns the ordered lookup chain.
 */
export function chainFor(active: string): string[] {
  if (active === 'en') return ['en']
  if (active === 'zh') return ['zh', 'en']
  // Any other id can only be a registered language pack, whose fallback chain
  // the DSH runtime requires to terminate at English.
  return [active, 'en']
}

/**
 * Translate one key against captured dictionaries.
 *
 * @param ns - the entry namespace's dictionaries, then the shared `common` ones.
 * @param active - the active locale id.
 * @param key - the dictionary key.
 * @param params - `{name}` template parameters, if any.
 * @returns the localized template with parameters substituted, or the key.
 */
export function translate(
  dicts: Record<string, NamespaceDicts>,
  active: string,
  key: string,
  params?: Record<string, unknown>,
): string {
  const chain = chainFor(active)
  const template = lookup(dicts, key, chain) ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}

/** Read one key through the chain in the given namespaces, in order. */
function lookup(
  dicts: Record<string, NamespaceDicts>,
  key: string,
  chain: readonly string[],
): string | undefined {
  for (const ns of ['dsh-mail-notify', 'common']) {
    const locales = dicts[ns]
    if (locales === undefined) continue
    for (const locale of chain) {
      const value = locales[locale]?.[key]
      if (value !== undefined) return value
    }
  }
  return undefined
}

/**
 * Create the locale service double.
 *
 * @param initial - the active locale id at creation.
 * @returns the service, ready for `ctx.locale.register` and for outlet subscription.
 */
export function createMockLocale(initial: string): MockLocale {
  const dicts = new Map<string, NamespaceDicts>()
  const listeners = new Set<() => void>()
  let snapshot: LocaleSnapshot = { active: initial, revision: 0 }

  const publish = (): void => {
    snapshot = { active: snapshot.active, revision: snapshot.revision + 1 }
    for (const listener of [...listeners]) listener()
  }

  return {
    active: initial,
    register(ns, registered) {
      dicts.set(ns, registered)
      publish()
      return () => {
        if (dicts.get(ns) === registered) dicts.delete(ns)
      }
    },
    dictFor(ns) {
      return dicts.get(ns)
    },
    setLocale(id) {
      if (snapshot.active === id) return
      this.active = id
      snapshot = { active: id, revision: snapshot.revision + 1 }
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return snapshot
    },
  }
}

/**
 * The translate function an outlet hands to the card.
 *
 * A NEW function identity is minted per call, matching the renderer's locale
 * seat contract: a locale switch mints a new seat, and the new prop identity
 * is what re-renders the card.
 *
 * @param locale - the captured locale service.
 * @param ns - the entry namespace.
 * @returns a translate function reading the active locale at call time.
 */
export function makeTranslate(locale: MockLocale, ns: string): (key: string, params?: Record<string, unknown>) => string {
  const dictionaries = (): Record<string, NamespaceDicts> => {
    const entry = locale.dictFor(ns)
    const common = locale.dictFor('common')
    const out: Record<string, NamespaceDicts> = {}
    if (entry !== undefined) out[ns] = entry
    if (common !== undefined) out['common'] = common
    return out
  }
  return (key, params) => translate(dictionaries(), locale.active, key, params)
}
