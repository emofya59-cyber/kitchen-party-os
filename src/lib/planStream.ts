// Streams a plan from the plan-event edge function (SSE passthrough of xAI chat
// completions), or simulates streaming from mock data when offline.
import type { Plan } from '../types/plan'
import { functionsUrl, supabase, supabaseAnonKey } from './supabase'
import { mockPlan } from '../mock/demo'
import { DEMO } from '../mock/demo-data'
import { parseHeadcountDelta, reviseHeadcount } from './revise'

export type StreamCallbacks = {
  onToken: (text: string) => void
  onDone: (plan: Plan, meta: { source: 'grok' | 'offline'; saved?: unknown }) => void
  onError: (message: string) => void
}

export type PlanRequest =
  | { kind: 'initial'; brief: string; eventId?: string }
  | { kind: 'revision'; change: string; previousPlan: Plan; eventId?: string }

export async function streamPlan(req: PlanRequest, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
  if (!functionsUrl || !supabase) return simulate(req, cb, signal)

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? supabaseAnonKey
  // When signed in with an event_id, the function loads event + vendor catalog itself (under RLS).
  // Otherwise we send the demo catalog so Grok still prices from known vendors.
  const vendors = DEMO.vendors.map((v) => ({ vendor_ref: v.org.slug, name: v.org.name, category: v.category, catalog: v.catalog }))
  const eventId = data.session ? req.eventId : undefined
  const body =
    req.kind === 'initial'
      ? { event_id: eventId, brief: req.brief, vendors }
      : { event_id: eventId, change: req.change, previous_plan: req.previousPlan, vendors }

  let res: Response
  try {
    res = await fetch(`${functionsUrl}/plan-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supabaseAnonKey ?? '' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    return cb.onError(`Network error: ${String(e)}`)
  }
  if (!res.ok || !res.body) return cb.onError(`plan-event failed (${res.status}): ${await res.text().catch(() => '')}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  let saved: unknown
  let eventName = 'message'
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (line === '') { eventName = 'message'; continue }
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue }
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const obj = JSON.parse(payload)
        if (eventName === 'kpos.saved') saved = obj
        else if (eventName === 'kpos.error') return cb.onError(obj.error ?? 'stream error')
        else {
          const delta: string = obj.choices?.[0]?.delta?.content ?? ''
          if (delta) { content += delta; cb.onToken(content) }
        }
      } catch { /* ignore partial line */ }
    }
  }
  try {
    cb.onDone(JSON.parse(stripFences(content)) as Plan, { source: 'grok', saved })
  } catch {
    cb.onError('Grok returned non-JSON output. Check the raw stream panel.')
  }
}

const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')

async function simulate(req: PlanRequest, cb: StreamCallbacks, signal?: AbortSignal) {
  let plan: Plan
  if (req.kind === 'initial') plan = mockPlan
  else {
    const delta = parseHeadcountDelta(req.change)
    if (delta == null) return cb.onError('Offline demo understands headcount changes like "15 extra guests". Connect Grok for free-form edits.')
    plan = reviseHeadcount(req.previousPlan, delta)
  }
  const text = JSON.stringify(plan, null, 2)
  const chunk = 48
  for (let i = 0; i < text.length; i += chunk) {
    if (signal?.aborted) return
    cb.onToken(text.slice(0, i + chunk))
    await new Promise((r) => setTimeout(r, 12))
  }
  cb.onDone(plan, { source: 'offline' })
}
