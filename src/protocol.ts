/**
 * The Connection channel this plugin's two Web endpoints travel over.
 *
 * The browser half reaches the host through `ctx.connection.rpc.call`, and the
 * host publishes through {@link API_PATH}. Both strings are declared here
 * because the browser bundle must not reach a host module to learn them.
 *
 * ## Why the endpoints are exact routes under `/api`
 *
 * The installed rc.2 contract offers three ways to add a Host endpoint, and only
 * one of them is usable by a plugin distributed outside DSH:
 *
 * - `HostConnectionRpc.intercept('/api', …)` admits exactly ONE interceptor for
 *   the shared channel and throws once one exists. `/api` is already claimed by
 *   the Typert gateway that serves every Remote namespace.
 * - `HostConnectionRpc.handle('/<channel>', …)` registers a plugin-owned
 *   channel, but its implementation reads `owner.webServer` where `owner` is the
 *   *providing* plugin's context — which does not inject `webServer`. Calling it
 *   fails with `cannot get property "webServer" without inject` before anything
 *   is registered, so no plugin can use it in this release.
 * - `HostConnectionFetch.register(route)` publishes an exact Fetch route on the
 *   shared channel. The shared handler consults exact routes BEFORE the
 *   interceptor, so a route under `/api` is reachable even though the
 *   interceptor is taken, and it inherits `/api`'s Host/Origin trust fence and
 *   browser-session authentication unchanged.
 *
 * The third is therefore the supported path, and it is the one used here. The
 * endpoint strings are channel-relative, so `call('/api', 'dsh-mail-notify/status')`
 * addresses the exact route `/api/dsh-mail-notify/status`.
 *
 * @module dsh-mail-notify/protocol
 */

/** The Connection channel the browser half calls through. */
export const RPC_CHANNEL = '/api'

/**
 * The settings namespace this plugin owns.
 *
 * Public contract: the host registers its settings section under this name, the
 * browser half binds its scope to it, and the card registers into
 * `settings.plugin.item` under it. The tab pairs the card with the host's
 * namespace by this string alone.
 */
export const SETTINGS_NAMESPACE = 'dsh-mail-notify'

/** The path segment this plugin owns below the channel. */
export const RPC_NAMESPACE_PATH = 'dsh-mail-notify'

/**
 * The endpoint the browser half asks for live plugin and queue facts.
 *
 * Channel-relative, matching the `call(channel, endpoint)` contract: each
 * `/`-separated segment must match `[A-Za-z0-9_$.-]+`.
 */
export const STATUS_ENDPOINT = `${RPC_NAMESPACE_PATH}/status`

/** The endpoint the browser half asks for a delivery test. */
export const TEST_EMAIL_ENDPOINT = `${RPC_NAMESPACE_PATH}/test-email`

/** The exact Fetch route the status endpoint is published at. */
export const STATUS_ROUTE = `${RPC_CHANNEL}/${STATUS_ENDPOINT}`

/** The exact Fetch route the delivery test is published at. */
export const TEST_EMAIL_ROUTE = `${RPC_CHANNEL}/${TEST_EMAIL_ENDPOINT}`

/** The queue facts a status read reports, when the plugin is mounted. */
export interface QueueStatusValue {
  /** Jobs waiting behind the one in flight. */
  depth: number
  /** The configured waiting-job cap. */
  size: number
  /** Jobs delivered since the plugin mounted. */
  delivered: number
  /** Jobs that reached a terminal failure. */
  failed: number
}

/** What a status read reports back. */
export interface StatusValue {
  /** Whether the notification runtime is mounted and listening. */
  active: boolean
  /**
   * Whether the effective configuration carries a usable SMTP section.
   *
   * The same predicate the notification path uses to decide that mail can be
   * sent, so a test action and a real notification cannot disagree.
   */
  smtpConfigured: boolean
  /** The credential reference name in effect. A name, never a value. */
  credentialRef: string
  /** Queue facts, present only while the runtime is mounted. */
  queue?: QueueStatusValue
  /**
   * The effective configuration's field-level failures, when it has any.
   *
   * Present means the stored configuration exists but cannot be acted on, so
   * the runtime is still the previous one — or absent. It is what lets the card
   * say why a save appeared to do nothing.
   */
  configError?: string
}

/**
 * What a delivery test reports back.
 *
 * Deliberately narrow: a boolean, a count, and an already-redacted diagnostic.
 * No recipient address is echoed, no configured value is returned, and the
 * credential never appears in any field — a browser response is one of the
 * places the password must not reach.
 */
export interface TestEmailValue {
  /** Whether the SMTP server accepted the message. */
  delivered: boolean
  /** How many recipients the message was addressed to. */
  recipientCount: number
  /** Redacted failure category, present only on a failed delivery. */
  category?: string
  /** Redacted, single-line failure diagnostic, present only on a failed delivery. */
  message?: string
}
