// Supabase Edge Function: plan-event
// Streams a Grok-generated Kitchen Party OS plan (SSE passthrough from xAI),
// then persists the final JSON to public.plan_revisions under the caller's RLS.
//
// POST /functions/v1/plan-event
//   { "event_id": "<uuid>", "brief": "120 guests, kitchen party in Woodlands..." }            -> initial plan
//   { "event_id": "<uuid>", "change": "Aunty Mwape confirmed 15 extra guests" }              -> revision
//   Optional: "previous_plan", "event", "vendors" (used as-is when event_id is omitted, e.g. demos)
//
// Response: text/event-stream. Upstream xAI chunks are forwarded unchanged
// (data: {...choices[0].delta.content...}), and then one extra event is sent:
//   event: kpos.saved   data: {"revision_id": "...", "revision_no": 2} | {"error": "..."}
//
// Secrets: XAI_API_KEY (required), XAI_MODEL (default grok-4.20-0309-non-reasoning), XAI_STRICT_SCHEMA ("true" to send json_schema),
//          XAI_API_URL (optional override, e.g. a local mock for tests)
// SUPABASE_URL / SUPABASE_ANON_KEY are injected by Supabase automatically.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { PLANNER_REVISION_PROMPT, PLANNER_SYSTEM_PROMPT, PLAN_JSON_SCHEMA } from '../_shared/planner-prompt.ts'

const XAI_URL = Deno.env.get('XAI_API_URL') ?? 'https://api.x.ai/v1/chat/completions'

type Body = {
  event_id?: string
  brief?: string
  change?: string
  previous_plan?: unknown
  event?: Record<string, unknown>
  vendors?: unknown[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const apiKey = Deno.env.get('XAI_API_KEY')
  if (!apiKey) return json({ error: 'XAI_API_KEY is not set (supabase secrets set XAI_API_KEY=...)' }, 500)
  const model = Deno.env.get('XAI_MODEL') ?? 'grok-4.20-0309-non-reasoning'
  const strict = Deno.env.get('XAI_STRICT_SCHEMA') === 'true'

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }
  if (!body.brief && !body.change) return json({ error: 'provide "brief" (initial) or "change" (revision)' }, 400)

  // Caller-scoped client: every read/write below goes through RLS as the signed-in host.
  const authHeader = req.headers.get('Authorization') ?? ''
  const sb: SupabaseClient | null =
    body.event_id && authHeader
      ? createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false },
        })
      : null

  let event = body.event ?? {}
  let vendors = body.vendors ?? []
  let previousPlan = body.previous_plan ?? null
  let hostOrgId: string | null = null

  if (sb && body.event_id) {
    const { data: ev, error } = await sb
      .from('events')
      .select('id, org_id, title, event_type, starts_at, venue, area, guest_target, budget_zmw, current_revision_id')
      .eq('id', body.event_id)
      .single()
    if (error || !ev) return json({ error: 'event not found or not accessible' }, 404)
    hostOrgId = ev.org_id
    event = { title: ev.title, event_type: ev.event_type, starts_at: ev.starts_at, venue: ev.venue, area: ev.area, guest_count: ev.guest_target, budget_zmw: ev.budget_zmw }

    const { data: vs } = await sb
      .from('vendors')
      .select('display_name, category, orgs!inner(slug), vendor_catalog_items(name, unit, price_zmw, serves)')
      .eq('is_active', true)
    vendors = (vs ?? []).map((v: any) => ({
      vendor_ref: v.orgs?.slug, name: v.display_name, category: v.category, catalog: v.vendor_catalog_items,
    }))

    if (body.change && !previousPlan && ev.current_revision_id) {
      const { data: rev } = await sb.from('plan_revisions').select('plan').eq('id', ev.current_revision_id).single()
      previousPlan = rev?.plan ?? null
    }
  }

  const isRevision = Boolean(body.change)
  if (isRevision && !previousPlan) return json({ error: 'revision requested but no previous plan found' }, 400)

  const system = isRevision ? PLANNER_REVISION_PROMPT : PLANNER_SYSTEM_PROMPT
  const userPayload = isRevision
    ? { previous_plan: previousPlan, change: body.change, vendors }
    : { brief: body.brief, event, vendors }

  const upstream = await fetch(XAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.3,
      messages: [
        { role: 'system', content: strict ? system : `${system}\n\nJSON SCHEMA (follow exactly):\n${JSON.stringify(PLAN_JSON_SCHEMA)}` },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      response_format: strict
        ? { type: 'json_schema', json_schema: { name: 'kitchen_party_plan', strict: true, schema: PLAN_JSON_SCHEMA } }
        : { type: 'json_object' },
    }),
  })

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    return json({ error: `xAI request failed (${upstream.status})`, detail: detail.slice(0, 500) }, 502)
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let content = ''
  let lineBuf = ''

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value) // passthrough, byte-for-byte
          // side-channel: accumulate delta content so we can persist the final plan
          lineBuf += decoder.decode(value, { stream: true })
          const lines = lineBuf.split('\n')
          lineBuf = lines.pop() ?? ''
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith('data:')) continue
            const data = t.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              content += JSON.parse(data).choices?.[0]?.delta?.content ?? ''
            } catch { /* partial / keep-alive line */ }
          }
        }

        let saved: Record<string, unknown> = { persisted: false }
        if (sb && body.event_id && hostOrgId) {
          try {
            const plan = JSON.parse(content)
            const { data: rev, error } = await sb
              .from('plan_revisions')
              .insert({
                event_id: body.event_id,
                org_id: hostOrgId,
                kind: isRevision ? 'revision' : 'initial',
                instruction: body.change ?? body.brief,
                plan,
                guest_count: plan?.event?.guest_count ?? null,
                total_zmw: plan?.cost_breakdown?.total_zmw ?? null,
                model,
              })
              .select('id, revision_no')
              .single()
            if (error) throw error
            await sb.from('events').update({
              current_revision_id: rev.id,
              guest_target: plan?.event?.guest_count ?? undefined,
              status: 'planning',
            }).eq('id', body.event_id)
            saved = { persisted: true, revision_id: rev.id, revision_no: rev.revision_no }
          } catch (e) {
            saved = { persisted: false, error: e instanceof Error ? e.message : String(e) }
          }
        }
        controller.enqueue(encoder.encode(`event: kpos.saved\ndata: ${JSON.stringify(saved)}\n\n`))
      } catch (e) {
        controller.enqueue(encoder.encode(`event: kpos.error\ndata: ${JSON.stringify({ error: String(e) })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
})
