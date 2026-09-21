/**
 * The browser's two wire surfaces, and the narrowing that makes them safe to
 * consume.
 *
 * Both surfaces answer with `unknown`-shaped envelopes, so every read here
 * validates before it returns. That is not defensive padding: the settings card
 * renders whatever these functions hand back, and a shape that changed under it
 * would surface as a render crash inside the Plugins tab — an unrelated place
 * — rather than as a refused read the card can report.
 *
 * ## The credential surface is write-only, by contract
 *
 * The `credentials` Remote namespace exposes exactly three methods —
 * `describe`, `set`, `unset` — and none of them returns a secret. This module
 * declares only those three. There is deliberately no `resolve`, `get`, `read`,
 * or `list` here, and adding one would not compile: the published namespace has
 * no such member. The password crosses this module in one direction only, in
 * {@link setCredential}, and never as a return value.
 *
 * @module dsh-mail-notify/client/wire
 */

import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import { RPC_CHANNEL, STATUS_ENDPOINT, TEST_EMAIL_ENDPOINT, type QueueStatusValue, type StatusValue, type TestEmailValue } from '../protocol.ts'
import type { ClientContext } from './contracts.ts'

/**
 * One wire read's outcome.
 *
 * A refusal carries a message already fit to render: it comes from the host's
 * own error taxonomy, and nothing here composes a message out of a response
 * body it did not understand.
 */
export type WireOutcome<T> = { ok: true; value: T } | { ok: false; message: string }

/** The credential reference's state, as `describe` reports it. */
export interface CredentialFacts {
  configured: boolean
  writable: boolean
}

/** Whether a plain object carries the named keys. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a boolean member, or `false` when it is absent or of another type. */
function boolAt(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true
}

/** Read an optional string member. */
function stringAt(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/** Read a non-negative integer member, or `undefined`. */
function countAt(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Narrow a status response body.
 *
 * @param raw - the decoded response value.
 * @returns the status facts, or `undefined` when the body is not one.
 */
export function readStatusValue(raw: unknown): StatusValue | undefined {
  if (!isRecord(raw)) return undefined
  const credentialRef = stringAt(raw, 'credentialRef')
  if (credentialRef === undefined) return undefined

  const queueRaw = raw.queue
  let queue: QueueStatusValue | undefined
  if (isRecord(queueRaw)) {
    const depth = countAt(queueRaw, 'depth')
    const size = countAt(queueRaw, 'size')
    const delivered = countAt(queueRaw, 'delivered')
    const failed = countAt(queueRaw, 'failed')
    if (depth !== undefined && size !== undefined && delivered !== undefined && failed !== undefined) {
      queue = { depth, size, delivered, failed }
    }
  }

  const configError = stringAt(raw, 'configError')
  return {
    active: boolAt(raw, 'active'),
    smtpConfigured: boolAt(raw, 'smtpConfigured'),
    credentialRef,
    ...(queue === undefined ? {} : { queue }),
    ...(configError === undefined ? {} : { configError }),
  }
}

/**
 * Narrow a test-email response body.
 *
 * @param raw - the decoded response value.
 * @returns the delivery outcome, or `undefined` when the body is not one.
 */
export function readTestEmailValue(raw: unknown): TestEmailValue | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.delivered !== 'boolean') return undefined
  const recipientCount = countAt(raw, 'recipientCount')
  if (recipientCount === undefined) return undefined
  const category = stringAt(raw, 'category')
  const message = stringAt(raw, 'message')
  return {
    delivered: raw.delivered,
    recipientCount,
    ...(category === undefined ? {} : { category }),
    ...(message === undefined ? {} : { message }),
  }
}

/**
 * Flatten a Connection RPC result into this module's outcome type.
 *
 * @param result - the decoded `{ ok, value }` / `{ ok, error }` envelope.
 * @param read - narrows the success value, returning `undefined` when the body
 *   is not the shape this caller asked for.
 * @returns the narrowed outcome.
 */
function project<T>(result: unknown, read: (raw: unknown) => T | undefined): WireOutcome<T> {
  if (!isRecord(result)) return { ok: false, message: 'the host returned no decodable response' }
  if (result.ok === true) {
    const value = read(result.value)
    if (value === undefined) return { ok: false, message: 'the host response did not carry the expected fields' }
    return { ok: true, value }
  }
  const error = result.error
  if (isRecord(error)) {
    const message = stringAt(error, 'message')
    if (message !== undefined) return { ok: false, message }
  }
  return { ok: false, message: 'the host refused the request' }
}

/**
 * Call one of this plugin's two `/api` endpoints.
 *
 * @param ctx - the client context, read for its Connection service.
 * @param endpoint - the channel-relative endpoint.
 * @param signal - caller cancellation.
 * @returns the decoded envelope, or a refusal when the channel itself failed.
 */
async function callEndpoint(ctx: ClientContext, endpoint: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await ctx.connection.rpc.call(RPC_CHANNEL, endpoint, {}, signal)
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}

/**
 * Read the plugin's live runtime facts.
 *
 * @param ctx - the client context.
 * @param signal - caller cancellation.
 * @returns the status facts, or a refusal.
 */
export async function readRuntimeStatus(ctx: ClientContext, signal?: AbortSignal): Promise<WireOutcome<StatusValue>> {
  return project(await callEndpoint(ctx, STATUS_ENDPOINT, signal), readStatusValue)
}

/**
 * Ask the host to deliver a test message.
 *
 * @param ctx - the client context.
 * @param signal - caller cancellation.
 * @returns the delivery outcome, or a refusal.
 */
export async function requestTestEmail(ctx: ClientContext, signal?: AbortSignal): Promise<WireOutcome<TestEmailValue>> {
  return project(await callEndpoint(ctx, TEST_EMAIL_ENDPOINT, signal), readTestEmailValue)
}

/**
 * Describe a credential reference.
 *
 * Reports whether the reference holds a value and whether this deployment may
 * write it. It cannot report the value, and neither can any other call here.
 *
 * @param ctx - the client context.
 * @param ref - the credential reference name.
 * @returns the described state, or a refusal.
 */
export async function describeCredential(ctx: ClientContext, ref: string): Promise<WireOutcome<CredentialFacts>> {
  try {
    const response = await ctx.remote.credentials.describe([ref])
    if (!response.ok) return { ok: false, message: response.error.message }
    const info: CredentialInfo | undefined = response.value[ref]
    if (info === undefined) return { ok: false, message: `the host did not describe the reference "${ref}"` }
    return { ok: true, value: { configured: info.configured === true, writable: info.writable === true } }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Write a credential value. The only direction in which a secret crosses here.
 *
 * @param ctx - the client context.
 * @param ref - the credential reference name.
 * @param value - the secret to store. Callers must not retain it afterwards.
 * @returns whether the host accepted the write.
 */
export async function setCredential(ctx: ClientContext, ref: string, value: string): Promise<WireOutcome<void>> {
  try {
    const response = await ctx.remote.credentials.set(ref, value)
    return response.ok ? { ok: true, value: undefined } : { ok: false, message: response.error.message }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Remove a credential value, so the reference re-inherits whatever the
 * deployment's other sources supply.
 *
 * @param ctx - the client context.
 * @param ref - the credential reference name.
 * @returns whether the host accepted the removal.
 */
export async function unsetCredential(ctx: ClientContext, ref: string): Promise<WireOutcome<void>> {
  try {
    const response = await ctx.remote.credentials.unset(ref)
    return response.ok ? { ok: true, value: undefined } : { ok: false, message: response.error.message }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Observe credential changes made anywhere in the deployment.
 *
 * A password written from another tab, or rotated on the host, invalidates what
 * this card last described. The event carries the reference, never a value.
 *
 * @param ctx - the client context.
 * @param listener - invoked with the reference that changed.
 * @returns the disposer removing this listener.
 */
export function onCredentialUpdated(ctx: ClientContext, listener: (ref: string) => void): () => void {
  return ctx.remote.$on('credentials/reference-updated', listener)
}
