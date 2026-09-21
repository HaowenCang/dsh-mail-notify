/**
 * The Connection RPC envelope, implemented for an exact Fetch route.
 *
 * {@link import('./protocol.ts')} explains why this plugin publishes under
 * `/api` as an exact route rather than registering its own channel. The cost of
 * that choice is that Connection's own `rpcFetchHandler` does not run for these
 * endpoints, so the envelope it would have handled is handled here.
 *
 * The codec is small and fully specified by the published contracts —
 * `ClientRequest`, `ServerResponse`, and `ConnectionRpcResult` in
 * `@deepseek-ai/dsh-client-connection` — and it is reproduced rather than
 * approximated: the browser caller validates `type`, `rpcId`, `result.ok`, and
 * the failure's `code`/`message`/`details` before it will accept a response, and
 * a field this file spelled differently would surface as a transport failure
 * rather than as the endpoint's own refusal.
 *
 * @module dsh-mail-notify/web-rpc
 */

/** One decoded client request. */
export interface DecodedRequest {
  /** Correlation id the response must echo. */
  rpcId: string
  /** Channel-relative endpoint the caller addressed. */
  method: string
  /** Endpoint-owned payload. */
  payload: unknown
}

/** One endpoint failure, in the shape the browser caller validates. */
export interface RpcFailure {
  code: string
  message: string
  details: Record<string, unknown>
}

/** One endpoint outcome. */
export type RpcOutcome<T> = { ok: true; value: T } | { ok: false; error: RpcFailure }

/** Whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Decode one request envelope.
 *
 * @param raw - the parsed JSON body.
 * @returns the decoded request, or `undefined` when the body is not one.
 */
export function decodeRequest(raw: unknown): DecodedRequest | undefined {
  if (!isRecord(raw)) return undefined
  if (raw.type !== 'client-request') return undefined
  const { rpcId, method } = raw
  if (typeof rpcId !== 'string' || rpcId === '') return undefined
  if (typeof method !== 'string' || method === '') return undefined
  return { rpcId, method, payload: raw.payload }
}

/**
 * Build one failure outcome.
 *
 * @param code - stable machine code.
 * @param message - human-readable, safe to render.
 * @param details - additional machine-readable context.
 * @returns the failure.
 */
export function failure(code: string, message: string, details: Record<string, unknown> = {}): RpcFailure {
  return { code, message, details }
}

/**
 * Encode one response envelope as an HTTP response.
 *
 * @param rpcId - the correlation id to echo.
 * @param outcome - the endpoint's outcome.
 * @returns the response, always HTTP 200: the envelope carries the failure so
 *   the caller can distinguish an endpoint refusal from a transport fault.
 */
export function encodeResponse(rpcId: string, outcome: RpcOutcome<unknown>): Response {
  return new Response(JSON.stringify({ type: 'server-response', rpcId, result: outcome }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Build a transport-level response that is not an RPC envelope. */
function transportFailure(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain' } })
}

/**
 * Build the POST handler for one exact Fetch route.
 *
 * Transport faults — a wrong content type, an unparseable body, an envelope
 * that is not a client request — are answered as HTTP failures, exactly as
 * Connection's own handler answers them. Only an endpoint's own outcome is
 * carried inside the envelope.
 *
 * @param dispatch - runs the endpoint; receives the decoded method and payload.
 * @returns the Fetch handler.
 */
export function createRouteHandler(
  dispatch: (method: string, payload: unknown) => Promise<RpcOutcome<unknown>>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return transportFailure(404, 'not found')
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') return transportFailure(415, 'content type must be application/json')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return transportFailure(400, 'request body must be JSON')
    }

    const decoded = decodeRequest(body)
    if (decoded === undefined) return transportFailure(400, 'request body must be a client-request envelope')

    return encodeResponse(decoded.rpcId, await dispatch(decoded.method, decoded.payload))
  }
}
