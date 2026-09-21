/**
 * Unit tests for the Connection RPC envelope this plugin implements.
 *
 * The browser caller validates `type`, `rpcId`, `result.ok`, and the failure's
 * `code`/`message`/`details` before it accepts a response, so a field this
 * codec spelled differently would surface as a transport failure rather than as
 * the endpoint's own refusal. These tests pin the shape against that contract.
 *
 * @module dsh-mail-notify/tests/unit/web-rpc
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRouteHandler, decodeRequest, encodeResponse, failure } from '../../src/web-rpc.ts'

/** Post one body to a handler and decode its JSON response. */
async function post(
  handler: (request: Request) => Promise<Response>,
  body: unknown,
  init: { method?: string; contentType?: string | null } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const headers: Record<string, string> = {}
  if (init.contentType !== null) headers['content-type'] = init.contentType ?? 'application/json'
  const response = await handler(
    new Request('http://host/api/dsh-mail-notify/status', {
      method: init.method ?? 'POST',
      headers,
      ...(init.method === undefined || init.method === 'POST'
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
        : {}),
    }),
  )
  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, json, text }
}

test('RPC-01 a well-formed request is decoded and its id echoed', async () => {
  const handler = createRouteHandler(() => Promise.resolve({ ok: true, value: { pong: 1 } }))
  const { status, json } = await post(handler, {
    type: 'client-request',
    rpcId: 'rpc-1',
    method: 'dsh-mail-notify/status',
    payload: { ignored: true },
  })
  assert.equal(status, 200)
  assert.deepEqual(json, {
    type: 'server-response',
    rpcId: 'rpc-1',
    result: { ok: true, value: { pong: 1 } },
  })
})

test('RPC-02 the decoded method and payload reach the dispatcher', async () => {
  const seen: Array<{ method: string; payload: unknown }> = []
  const handler = createRouteHandler((method, payload) => {
    seen.push({ method, payload })
    return Promise.resolve({ ok: true, value: null })
  })
  await post(handler, { type: 'client-request', rpcId: 'r', method: 'dsh-mail-notify/test-email', payload: { a: 1 } })
  assert.deepEqual(seen, [{ method: 'dsh-mail-notify/test-email', payload: { a: 1 } }])
})

test('RPC-03 an endpoint refusal rides the envelope, not the HTTP status', async () => {
  const handler = createRouteHandler(() =>
    Promise.resolve({ ok: false as const, error: failure('not-found', 'unknown endpoint') }),
  )
  const { status, json } = await post(handler, { type: 'client-request', rpcId: 'r', method: 'x', payload: null })
  // HTTP 200 is what lets the caller distinguish an endpoint's own refusal from
  // a transport fault; the browser caller throws on a non-ok response.
  assert.equal(status, 200)
  assert.deepEqual(json, {
    type: 'server-response',
    rpcId: 'r',
    result: { ok: false, error: { code: 'not-found', message: 'unknown endpoint', details: {} } },
  })
})

test('RPC-04 transport faults are HTTP failures, not envelopes', async () => {
  const handler = createRouteHandler(() => Promise.resolve({ ok: true, value: null }))
  const envelope = { type: 'client-request', rpcId: 'r', method: 'x', payload: null }

  assert.equal((await post(handler, envelope, { method: 'GET' })).status, 404)
  assert.equal((await post(handler, envelope, { contentType: 'text/plain' })).status, 415)
  assert.equal((await post(handler, 'not json')).status, 400)
  assert.equal((await post(handler, { rpcId: 'r', method: 'x' })).status, 400)
  assert.equal((await post(handler, { type: 'server-response', rpcId: 'r', method: 'x' })).status, 400)
})

test('RPC-05 a content type with parameters is still application/json', async () => {
  const handler = createRouteHandler(() => Promise.resolve({ ok: true, value: 'ok' }))
  const { status } = await post(handler, { type: 'client-request', rpcId: 'r', method: 'x', payload: null }, {
    contentType: 'application/json; charset=utf-8',
  })
  assert.equal(status, 200)
})

test('RPC-06 decoding rejects every shape that is not a client request', () => {
  assert.deepEqual(decodeRequest({ type: 'client-request', rpcId: 'a', method: 'm', payload: 7 }), {
    rpcId: 'a',
    method: 'm',
    payload: 7,
  })
  for (const bad of [
    undefined,
    null,
    42,
    'client-request',
    [],
    { type: 'client-request', rpcId: '', method: 'm' },
    { type: 'client-request', rpcId: 'a', method: '' },
    { type: 'server-response', rpcId: 'a', method: 'm' },
    { rpcId: 'a', method: 'm' },
  ]) {
    assert.equal(decodeRequest(bad), undefined, `${JSON.stringify(bad)} must not decode`)
  }
})

test('RPC-07 the encoded response is always JSON with an ok status', async () => {
  const response = encodeResponse('rpc-9', { ok: true, value: { delivered: true } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json')
  assert.deepEqual(await response.json(), {
    type: 'server-response',
    rpcId: 'rpc-9',
    result: { ok: true, value: { delivered: true } },
  })
})
