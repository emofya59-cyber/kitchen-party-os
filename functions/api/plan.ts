// Cloudflare Pages Function: /api/plan. Grok planner (SSE passthrough) + reminder writer.
// Secret: XAI_API_KEY (Pages secret; never in the client bundle). Optional XAI_MODEL (default grok-4.20-0309-non-reasoning: fast first token; reasoning models blow the 8s fallback).
// Without the key it returns 503 and the client falls back to the offline planner.
import { PLAN_JSON_SCHEMA, PLANNER_REVISION_PROMPT, PLANNER_SYSTEM_PROMPT } from '../../supabase/functions/_shared/planner-prompt'

interface Env { XAI_API_KEY?: string; XAI_MODEL?: string }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!env.XAI_API_KEY) return json({ error: 'grok_unavailable', detail: 'XAI_API_KEY not set; use offline planner' }, 503)
  let body: any
  try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const model = env.XAI_MODEL || 'grok-4.20-0309-non-reasoning'
  const headers = { Authorization: `Bearer ${env.XAI_API_KEY}`, 'Content-Type': 'application/json' }

  if (body?.kind === 'reminder') {
    const ev = body.event ?? {}
    const lang = body.lang === 'bem' ? 'a warm mix of Bemba greetings (Muli shani, Natotela) and simple English' : 'friendly Zambian English'
    const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({
      model, temperature: 0.7, messages: [
        { role: 'system', content: 'You write short WhatsApp/SMS RSVP reminders for Lusaka events. Max 300 characters. Use the literal placeholder {name} for the guest first name. Output only the message text.' },
        { role: 'user', content: `Event: ${ev.title}; when: ${ev.when}; venue: ${ev.venue}. Language: ${lang}. Ask them to reply YES or NO.` },
      ] }) })
    if (!r.ok) return json({ error: 'xai_failed', status: r.status }, 502)
    const d: any = await r.json()
    return json({ text: String(d?.choices?.[0]?.message?.content ?? '').trim().slice(0, 600) })
  }

  const isRevision = Boolean(body?.change)
  if (!isRevision && !body?.brief) return json({ error: 'provide brief or change' }, 400)
  const user = isRevision ? { previous_plan: body.previous_plan, change: body.change, vendors: body.vendors ?? [] } : { brief: body.brief, event: body.event ?? {}, vendors: body.vendors ?? [] }
  const upstream = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({
    model, stream: true, temperature: 0.3, response_format: { type: 'json_schema', json_schema: { name: 'kitchen_party_plan', strict: true, schema: PLAN_JSON_SCHEMA } },
    messages: [{ role: 'system', content: isRevision ? PLANNER_REVISION_PROMPT : PLANNER_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(user) }],
  }) })
  if (!upstream.ok || !upstream.body) return json({ error: 'xai_failed', status: upstream.status }, 502)
  return new Response(upstream.body, { headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
