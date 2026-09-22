/**
 * The card's locale dictionaries and the namespace they register under.
 *
 * Both shipped locales are exported together on purpose. The locale service's
 * typed `register` overload takes every built-in locale in one call and checks
 * each against the namespace's merged key union, so a dictionary cannot be
 * shipped alone and a language cannot silently lag the other.
 *
 * @module dsh-mail-notify/client/locales
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MailNotifyLocaleKey } from './vocabulary.ts'

export { en } from './en.ts'
export { zh } from './zh.ts'
export type { MailNotifyDictionary, MailNotifyLocaleKey } from './vocabulary.ts'

/**
 * The dictionary namespace this plugin owns.
 *
 * Declared into `LocaleNamespaceMap` by `../contracts.ts`. It is a namespace in
 * the locale service's sense — a key space inside every locale, not a language
 * tag — which is why it stays constant while the active language changes.
 */
export const LOCALE_NAMESPACE = 'dsh-mail-notify'

/**
 * The translate function bound to this plugin's namespace.
 *
 * Read from the merge table rather than restated, so the key domain is exactly
 * the one `contracts.ts` declared: a key renamed in the vocabulary breaks every
 * call site instead of compiling against a stale local union.
 */
export type MailNotifyTranslate = TranslateNS<typeof LOCALE_NAMESPACE>

/** Re-exported for callers that only need the key domain. */
export type { MailNotifyLocaleKey as LocaleKey }
