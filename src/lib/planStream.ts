// Streams a plan from the same-origin Pages Function /api/plan (Grok SSE passthrough;
// key lives only in Pages secrets). Any error, missing key, or >8s without a first
// token falls back to the deterministic offline planner, so the demo never stalls.
import type { Plan } from '../types/plan'
import { mockPlan } from '../mock/demo'
import { DEMO } from '../mock/demo-data'
import { parseHeadcountDelta, reviseHeadcount } from './revise'
import { buildOfflinePlan, grokEventPayload, isDefaultFields, type EventFields } from './eventFields'

export type StreamCallbacks = {
  onToken: (text: string) => void
  onDone: (plan: Plan, meta: { source: 'grok' | 'offline' }) => void
  onError: (message: string) => void
}

export type PlanRequest =
  | { kind: 'initial'; brief: string; eventId?: string; fields?: EventFields }
  | { kind: 'revision'; change: string; previousPlan: Plan; eventId?: string }

const vendorsPayload = () => DEMO.vendors.map((v) => ({ vendor_ref: v.org.slug, name: v.org.name, category: v.category, catalog: v.catalog }))
const FIRST_TOKEN_MS = 8000

export async function streamPlan(req: PlanRequest, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
  const body = req.kind === 'initial'
    ? { brief: req.brief, vendors: vendorsPayload(), ...(req.fields ? { event: grokEventPayload(req.fields) } : {}) }
    : { change: req.change, previous_plan: req.previousPlan, vendors: vendorsPayload() }

  const ctrl = new AbortController()
  signal?.addEventListener('abort', () => ctrl.abort())
  let timer = setTimeout(() => ctrl.abort(), FIRST_TOKEN_MS)
  let content = ''
  try {
    const res = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
    if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) throw new Error(`plan ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const delta: string = JSON.parse(payload).choices?.[0]?.delta?.content ?? ''
          if (delta) {
            content += delta
            clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 15000) // stall guard after first token
            cb.onToken(content)
          }
        } catch { /* partial */ }
      }
    }
    clearTimeout(timer)
    const plan = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')) as Plan
    if (!plan?.cost_breakdown || !Array.isArray(plan.menu) || !Array.isArray(plan.cost_breakdown.line_items) || !Array.isArray(plan.run_of_show)) throw new Error('invalid plan shape')
    cb.onDone(plan, { source: 'grok' })
  } catch {
    clearTimeout(timer)
    if (signal?.aborted) return
    return simulate(req, cb, signal)
  }
}

async function simulate(req: PlanRequest, cb: StreamCallbacks, signal?: AbortSignal) {
  let plan: Plan
  if (req.kind === 'initial') plan = req.fields && !isDefaultFields(req.fields) ? buildOfflinePlan(req.fields) : mockPlan
  else {
    const delta = parseHeadcountDelta(req.change)
    if (delta == null) return cb.onError('Offline planner understands headcount changes like "15 extra guests". Grok handles free-form edits when its key is set.')
    plan = reviseHeadcount(req.previousPlan, delta)
  }
  const text = JSON.stringify(plan, null, 2)
  const step = Math.max(64, Math.ceil(text.length / 60)) // whole stream < ~0.6s
  for (let i = 0; i < text.length; i += step) {
    if (signal?.aborted) return
    cb.onToken(text.slice(0, i + step))
    await new Promise((r) => setTimeout(r, 8))
  }
  cb.onDone(plan, { source: 'offline' })
}

/** Grok-written reminder (non-streaming). Returns null when Grok is unavailable → caller uses templates. */
export async function generateReminderWithGrok(ev: { title: string; when: string; venue: string }, lang: 'en' | 'bem'): Promise<string | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'reminder', event: ev, lang }), signal: ctrl.signal })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.text === 'string' && data.text.includes('{name}') ? data.text : null
  } catch { return null } finally { clearTimeout(t) }
}
