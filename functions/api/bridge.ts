// Cloudflare Pages Function: /api/bridge (agent-to-agent negotiation bridge)
//
// GET  /api/bridge[?event_id=uuid]  -> { pending: [...], thread: [...] }   (latest first)
// POST /api/bridge  { from_agent, to_agent, action_type, message?, payload_json?, event_id? }
//      -> { row, applied }   (quote_accepted applies the quote's menu quantities / guest_count / vendor total)
//
// Auth: header `x-bridge-key` (demo key chosen by the owner: lusaka2026). The key is re-checked
// inside Postgres (private.bridge_keys) by the SECURITY DEFINER RPCs bridge_list / bridge_post.
// Env (Pages secrets, never in the client bundle):
//   SUPABASE_URL                 required
//   SUPABASE_SERVICE_ROLE_KEY    preferred, if available
//   SUPABASE_ANON_KEY            fallback; the RPCs are key-gated, so the anon key is enough
//   BRIDGE_KEY                   optional override of the expected header value

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  SUPABASE_ANON_KEY?: string
  BRIDGE_KEY?: string
}
type Ctx = { request: Request; env: Env }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTION = /^[a-z][a-z_]{1,39}$/

async function rpc(env: Env, fn: string, args: Record<string, unknown>) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY
  if (!env.SUPABASE_URL || !key) return json({ error: 'server_misconfigured', detail: 'SUPABASE_URL and a Supabase key must be set as Pages secrets' }, 500)
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { message: text } }
  if (!res.ok) {
    const code = data?.code
    const status = code === '28000' ? 401 : code === 'P0002' ? 404 : code === '22023' || code === '22P02' || code === '23514' ? 400 : 502
    return json({ error: data?.message ?? 'supabase_error', code }, status)
  }
  return json(data, 200)
}

export const onRequest = async ({ request, env }: Ctx): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const provided = request.headers.get('x-bridge-key')
  if (!provided || provided !== (env.BRIDGE_KEY || 'lusaka2026')) {
    return json({ error: 'unauthorized', detail: 'missing or invalid x-bridge-key header' }, 401)
  }

  const url = new URL(request.url)

  if (request.method === 'GET') {
    const eventId = url.searchParams.get('event_id')
    if (eventId && !UUID.test(eventId)) return json({ error: 'invalid_event_id' }, 400)
    const res = await rpc(env, 'bridge_list', { p_key: provided, p_event_id: eventId })
    if (!res.ok) return res
    const data = await res.json() as { pending: unknown[]; thread: unknown[]; event_id: string }
    return json({ event_id: data.event_id, pending: data.pending, thread: data.thread })
  }

  if (request.method === 'POST') {
    let body: any
    try { body = await request.json() } catch { return json({ error: 'invalid_json', detail: 'body must be JSON' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_body' }, 400)

    const errors: string[] = []
    const str = (k: string, max: number, required = true) => {
      const v = body[k]
      if (v == null || v === '') { if (required) errors.push(`${k} is required`); return null }
      if (typeof v !== 'string') { errors.push(`${k} must be a string`); return null }
      if (v.length > max) errors.push(`${k} must be <= ${max} chars`)
      return v.trim()
    }
    const from_agent = str('from_agent', 80)
    const to_agent = str('to_agent', 80)
    const action_type = str('action_type', 40)
    const message = str('message', 4000, false)
    if (action_type && !ACTION.test(action_type)) errors.push('action_type must be snake_case, e.g. quote, quote_accepted, counter_offer, message')
    const payload = body.payload_json ?? {}
    if (typeof payload !== 'object' || Array.isArray(payload) || payload === null) errors.push('payload_json must be an object')
    if (body.event_id != null && (typeof body.event_id !== 'string' || !UUID.test(body.event_id))) errors.push('event_id must be a uuid')
    if (action_type === 'counter_offer' && !(Number(payload?.counter_total_zmw) > 0)) errors.push('counter_offer requires payload_json.counter_total_zmw > 0')
    if (errors.length) return json({ error: 'validation_failed', details: errors }, 400)

    const res = await rpc(env, 'bridge_post', {
      p_key: provided, p_from_agent: from_agent, p_to_agent: to_agent, p_action_type: action_type,
      p_message: message, p_payload: payload, p_event_id: body.event_id ?? null,
    })
    if (!res.ok) return res
    return json(await res.json(), 201)
  }

  return json({ error: 'method_not_allowed', allowed: ['GET', 'POST', 'OPTIONS'] }, 405)
}
