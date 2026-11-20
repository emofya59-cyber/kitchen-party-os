// Same-origin Pages Functions. The bridge key is the owner's public demo key.
export const BRIDGE_KEY = (import.meta.env.VITE_BRIDGE_KEY as string | undefined) ?? 'lusaka2026'

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-key': BRIDGE_KEY },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.details?.join?.('; ') ?? data?.error ?? `HTTP ${res.status}`)
  return data as T
}

export type BridgeBody = { from_agent: string; to_agent: string; action_type: string; message?: string; payload_json?: Record<string, unknown> }
export const bridgePost = (b: BridgeBody) => call<{ row: Record<string, unknown>; applied: unknown }>('/api/bridge', b)
export const demoAction = <T = Record<string, unknown>>(action: string, args: Record<string, unknown> = {}) =>
  call<T>('/api/demo', { action, args })

/** +260 validation: Airtel 097/077, MTN 096/076, Zamtel 095/075. Accepts 0971234567 / 260971234567 / +260971234567. */
export function normaliseZmPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  const local = /^260\d{9}$/.test(d) ? d.slice(3) : /^0\d{9}$/.test(d) ? d.slice(1) : /^\d{9}$/.test(d) ? d : null
  if (!local || !/^(97|96|95|77|76|75)\d{7}$/.test(local)) return null
  return `+260${local}`
}
export const networkOf = (e164: string) => {
  const p = e164.slice(4, 6)
  return p === '97' || p === '77' ? 'Airtel' : p === '96' || p === '76' ? 'MTN' : 'Zamtel'
}
export const catTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso)) + ' CAT'

// Offline fallback for the agent bridge: rows are broadcast in-page instead of POSTed.
import { supabase as _sb } from './supabase'
export async function sendBridge(b: BridgeBody) {
  if (_sb) return bridgePost(b)
  const row = { id: crypto.randomUUID(), event_id: 'offline', from_agent: b.from_agent, to_agent: b.to_agent, action_type: b.action_type,
    message: b.message ?? null, payload_json: b.payload_json ?? {}, status: ['quote', 'counter_offer'].includes(b.action_type) ? 'pending' : b.action_type === 'quote_accepted' ? 'applied' : 'info',
    created_at: new Date().toISOString() }
  window.dispatchEvent(new CustomEvent('kpos-bridge-local', { detail: row }))
  return { row, applied: null }
}
