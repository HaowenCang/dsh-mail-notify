/**
 * The controller's message vocabulary, and the one place it becomes text.
 *
 * A controller is not a React component, so it has no `t` seat and no active
 * locale of its own. Rather than capture a translate function at construction
 * time — which would freeze the notice that is already on screen at the
 * language the card was built in — the controller records *what happened* as a
 * key plus its parameters, and the card renders it through the live `t` on
 * every render. A language switch therefore re-renders an already-displayed
 * refusal in the new language, with no re-registration and no replay.
 *
 * ## Host text is not plugin text
 *
 * A refusal composed by the settings provider or a redacted SMTP diagnostic
 * arrives as a plain string this plugin did not author. It has no key, this
 * plugin does not know its language, and inventing one would mean either
 * machine-translating a diagnostic or printing a key at the user. It is
 * therefore carried verbatim through {@link TEXT} in both locales. Only the
 * *frame* around it — "The host did not accept the save." — is localizable, and
 * that frame is a plugin string with a key of its own.
 *
 * @module dsh-mail-notify/client/message
 */

import type { MailNotifyTranslate } from './locales/index.ts'

/**
 * A message this plugin authored: a locale key and its template parameters.
 *
 * The key domain is the namespace's own union plus the shared common
 * vocabulary, exactly as the slot-injected `t` seat is typed.
 */
export interface MessageSpec {
  readonly key: Parameters<MailNotifyTranslate>[0]
  readonly params?: Record<string, string | number>
}

/**
 * A message the card renders: either plugin copy, or text that arrived from the
 * host and is passed through unchanged.
 */
export type ControllerMessage = { readonly kind: 'spec'; readonly spec: MessageSpec } | { readonly kind: 'text'; readonly text: string }

/**
 * Build a plugin-authored message.
 *
 * @param key - the locale key.
 * @param params - template parameters interpolated into the copy.
 * @returns the message spec.
 */
export function MSG(key: Parameters<MailNotifyTranslate>[0], params?: Record<string, string | number>): ControllerMessage {
  return { kind: 'spec', spec: params === undefined ? { key } : { key, params } }
}

/**
 * Wrap text this plugin did not author.
 *
 * @param text - the host's message, rendered as-is.
 * @returns the pass-through message.
 */
export function TEXT(text: string): ControllerMessage {
  return { kind: 'text', text }
}

/**
 * Render a controller message in the active locale.
 *
 * @param t - the live translate function for this namespace.
 * @param message - the message, or `undefined` when there is nothing to show.
 * @returns the rendered text, or `undefined`.
 */
export function compose(t: MailNotifyTranslate, message: ControllerMessage | undefined): string | undefined {
  if (message === undefined) return undefined
  if (message.kind === 'text') return message.text
  const spec = message.spec
  return spec.params === undefined ? t(spec.key) : t(spec.key, spec.params)
}
