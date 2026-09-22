/**
 * A test `ClientContext` with the four services the card's controller reaches.
 *
 * The controller is the object that owns staged drafts and runs the save and
 * delivery actions, so the collapse and retention suites drive it through this
 * context rather than through a hand-built projection. That matters for what
 * the tests can claim: a test that fed the card a literal snapshot could pass
 * while the controller discarded drafts on every collapse, because the
 * projection it fed would never have changed.
 *
 * ## What the double records
 *
 * Every mutating call is written to a call log, so a test can assert not only
 * that a draft survived a collapse but that collapsing *performed no write at
 * all* — the stronger statement, and the one that matters for a disclosure that
 * must not touch configuration. The credential surface records the value it was
 * asked to store and never returns one, matching the real namespace.
 *
 * @module dsh-mail-notify/tests/client/support/client-context
 */

/** One recorded call, in order. */
export interface RecordedCall {
  readonly method: string
  readonly args: readonly unknown[]
}

/** The settings section the fake transport serves, and the revision it is at. */
export interface FakeSection {
  value: Record<string, unknown>
  user?: Record<string, unknown>
  revision: number
  writable: boolean
  status: 'unavailable' | 'ready'
}

/** A client context double plus the handles a test needs to inspect it. */
export interface ClientContextDouble {
  readonly ctx: unknown
  readonly calls: RecordedCall[]
  /** The settings document the scope serves. */
  readonly section: FakeSection
  /** Values passed to `credentials.set`, in order. Never a read path. */
  readonly writtenSecrets: string[]
  /** References passed to `credentials.unset`, in order. */
  readonly unsetRefs: string[]
  /** Move the settings document, as another surface's write would. */
  publishSection(next: Record<string, unknown>): void
  /** Make the credential reference report as configured. */
  setCredentialConfigured(configured: boolean, writable?: boolean): void
  /** The status body the `/api` endpoint answers with, or `undefined` to refuse. */
  setStatus(body: unknown): void
  /** The test-email body the `/api` endpoint answers with, or `undefined` to refuse. */
  setTestEmail(body: unknown): void
}

/**
 * Build a client context double.
 *
 * @param overrides - initial facts to seed.
 * @returns the double.
 */
export function stubClientContext(overrides: {
  section?: Record<string, unknown>
  user?: Record<string, unknown>
  writable?: boolean
  status?: 'unavailable' | 'ready'
  configured?: boolean
} = {}): ClientContextDouble {
  const calls: RecordedCall[] = []
  const writtenSecrets: string[] = []
  const unsetRefs: string[] = []
  const listeners = new Set<() => void>()
  const section: FakeSection = {
    value: overrides.section ?? {},
    ...(overrides.user === undefined ? {} : { user: overrides.user }),
    revision: 1,
    writable: overrides.writable ?? true,
    status: overrides.status ?? 'ready',
  }
  let credential = { configured: overrides.configured ?? false, writable: true }
  let statusBody: unknown = {
    active: true,
    smtpConfigured: true,
    credentialRef: 'DSH_MAIL_SMTP_PASSWORD',
  }
  let testEmailBody: unknown = { delivered: true, recipientCount: 2 }

  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args })
  }

  const scope = {
    getSnapshot: () => ({
      status: section.status,
      writable: section.writable,
      revision: section.revision,
      value: section.value,
      ...(section.user === undefined ? {} : { user: section.user }),
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    bind: () => scope,
    describe: () => ({ namespace: 'dsh-mail-notify' }),
    mutate: async (ops: readonly unknown[], revision: number): Promise<void> => {
      record('settings.mutate', ops, revision)
      // Apply the operations to the served document so a later read sees what a
      // real commit would have left behind.
      for (const op of ops as ReadonlyArray<{ op: string; path: string[]; value?: unknown }>) {
        const key = op.path[0]
        if (key === undefined) continue
        if (op.op === 'unset') delete section.value[key]
        else section.value[key] = op.value
      }
      section.revision += 1
      for (const listener of [...listeners]) listener()
    },
  }

  const ctx = {
    locale: {
      getSnapshot: () => ({ active: 'en', locales: [{ id: 'en' }], revision: 0 }),
      subscribe: () => () => undefined,
    },
    settingsScope: scope,
    remote: {
      $on: () => () => undefined,
      credentials: {
        describe: async (refs: readonly string[]) => {
          record('credentials.describe', refs)
          return {
            ok: true,
            value: Object.fromEntries(refs.map((ref) => [ref, { ...credential }])),
          }
        },
        set: async (ref: string, value: string) => {
          record('credentials.set', ref)
          writtenSecrets.push(value)
          credential = { ...credential, configured: true }
          return { ok: true, value: undefined }
        },
        unset: async (ref: string) => {
          record('credentials.unset', ref)
          unsetRefs.push(ref)
          credential = { ...credential, configured: false }
          return { ok: true, value: undefined }
        },
      },
    },
    connection: {
      rpc: {
        call: async (_channel: string, endpoint: string) => {
          record('rpc.call', endpoint)
          if (endpoint.endsWith('/status')) {
            return statusBody === undefined
              ? { ok: false, error: { message: 'the channel refused the read' } }
              : { ok: true, value: statusBody }
          }
          return testEmailBody === undefined
            ? { ok: false, error: { message: 'the channel refused the request' } }
            : { ok: true, value: testEmailBody }
        },
      },
    },
    effect: () => () => undefined,
    on: () => () => undefined,
    emit: () => undefined,
  }

  return {
    ctx,
    calls,
    section,
    writtenSecrets,
    unsetRefs,
    publishSection(next) {
      section.value = next
      section.revision += 1
      for (const listener of [...listeners]) listener()
    },
    setCredentialConfigured(configured, writable = true) {
      credential = { configured, writable }
    },
    setStatus(body) {
      statusBody = body
    },
    setTestEmail(body) {
      testEmailBody = body
    },
  }
}
