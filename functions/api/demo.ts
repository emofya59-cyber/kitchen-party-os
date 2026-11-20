// Cloudflare Pages Function: /api/demo. Key-gated demo simulations (pay, dispatch, audit, reset).
// POST { action, args } with header x-bridge-key → Postgres RPC public.demo_action (re-checks the key).
interface Env { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string; SUPABASE_ANON_KEY?: string; BRIDGE_KEY?: string }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const ACTIONS = new Set(['pay_deposit', 'request_deposit', 'dispatch', 'dispatch_flush', 'audit', 'set_rsvp', 'reset', 'custom_event', 'seed_event', 'add_guest'])

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const provided = request.headers.get('x-bridge-key')
  if (!provided || provided !== (env.BRIDGE_KEY || 'lusaka2026')) return json({ error: 'unauthorized' }, 401)
  let body: any
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  if (!ACTIONS.has(body?.action)) return json({ error: 'validation_failed', details: [`action must be one of ${[...ACTIONS].join(', ')}`] }, 400)
  const args = body.args ?? {}
  if (typeof args !== 'object' || Array.isArray(args)) return json({ error: 'validation_failed', details: ['args must be an object'] }, 400)
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY
  if (!env.SUPABASE_URL || !key) return json({ error: 'server_misconfigured' }, 500)
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/demo_action`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: provided, p_action: body.action, p_args: args }),
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { message: text } }
  if (!res.ok) return json({ error: data?.message ?? 'supabase_error', code: data?.code }, data?.code === '28000' ? 401 : data?.code === '22023' ? 400 : data?.code === 'P0002' ? 404 : 502)
  return json(data)
}
