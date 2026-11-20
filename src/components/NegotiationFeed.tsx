import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AgentBridgeRow } from '../types/database'

const BRIDGE_KEY = (import.meta.env.VITE_BRIDGE_KEY as string | undefined) ?? 'lusaka2026' // demo key (owner's choice)
const PEOPLE: Record<string, string> = { HostBot: 'Emmanuel', WoodlandsCatererBot: 'Anna' }
const time = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso)) + ' CAT'
const zmw = (n: unknown) => (typeof n === 'number' || typeof n === 'string') && n !== '' ? `ZMW ${Number(n).toLocaleString('en-ZM')}` : null

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-key': BRIDGE_KEY },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error === 'validation_failed' ? data.details.join('; ') : (data?.error ?? `HTTP ${res.status}`))
  return data as { row: AgentBridgeRow; applied: Record<string, unknown> | null }
}

export function NegotiationFeed({ eventId, onApplied }: { eventId: string; onApplied?: (guestCount: number) => void }) {
  const [rows, setRows] = useState<AgentBridgeRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [counterFor, setCounterFor] = useState<string | null>(null)
  const [counter, setCounter] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    const sb = supabase
    void sb.from('agent_bridge').select('*').eq('event_id', eventId).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => data && setRows(data))
    const ch = sb.channel(`bridge-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_bridge', filter: `event_id=eq.${eventId}` }, (msg) => {
        const row = msg.new as AgentBridgeRow
        if (!row?.id) return
        setRows((prev) => prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev])
        if (msg.eventType === 'INSERT' && row.action_type === 'quote_accepted') {
          const g = Number((row.payload_json as Record<string, unknown>)?.guest_count)
          if (g > 0) onApplied?.(g)
        }
      })
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [eventId, onApplied])

  const sorted = useMemo(() => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)), [rows])

  const act = async (id: string, body: Record<string, unknown>) => {
    setBusy(id); setErr(null)
    try { await post(body); setCounterFor(null); setCounter('') } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-lg">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Agent-to-Agent Negotiation Feed</h2>
        <span className="flex items-center gap-2 text-xs text-emerald-400"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />{supabase ? 'live' : 'offline'}</span>
      </header>
      {!supabase && <p className="text-sm text-zinc-500">Connect Supabase to see the live agent feed.</p>}
      {err && <p className="mb-3 rounded-lg bg-rose-950 p-2 text-xs text-rose-300">{err}</p>}
      <ul className="max-h-[28rem] space-y-3 overflow-auto pr-1">
        {sorted.map((r) => {
          const host = r.from_agent === 'HostBot'
          const p = (r.payload_json ?? {}) as Record<string, unknown>
          const amount = zmw(p.counter_total_zmw ?? p.total_zmw)
          const actionable = r.status === 'pending' && (r.action_type === 'quote' || r.action_type === 'counter_offer') && r.from_agent !== 'HostBot'
          return (
            <li key={r.id} className={`rounded-xl border p-3 ${host ? 'ml-8 border-sky-900 bg-sky-950/60' : 'mr-8 border-amber-900 bg-amber-950/40'}`}>
              <div className="flex items-center justify-between text-xs">
                <span className={host ? 'font-semibold text-sky-300' : 'font-semibold text-amber-300'}>
                  {r.from_agent} <span className="font-normal text-zinc-500">({PEOPLE[r.from_agent] ?? 'agent'}) → {r.to_agent}</span>
                </span>
                <span className="text-zinc-500">{time(r.created_at)}</span>
              </div>
              <p className="mt-1 text-sm text-zinc-200">{r.message}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-400">{r.action_type}</span>
                <span className={`rounded px-1.5 py-0.5 ${r.status === 'pending' ? 'bg-amber-900 text-amber-200' : r.status === 'accepted' || r.status === 'applied' ? 'bg-emerald-900 text-emerald-200' : 'bg-zinc-800 text-zinc-400'}`}>{r.status}</span>
                {amount && <span className="font-semibold text-zinc-100">{amount}</span>}
                {typeof p.guest_count === 'number' && <span className="text-zinc-400">{p.guest_count} guests</span>}
              </div>
              {actionable && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={busy === r.id}
                    onClick={() => act(r.id, { from_agent: 'HostBot', to_agent: r.from_agent, action_type: 'quote_accepted', message: `Accepted ${amount ?? 'the quote'}. Please proceed, ${PEOPLE[r.from_agent] ?? ''}.`.trim(), payload_json: { ...p, quote_id: r.id } })}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Accept</button>
                  {counterFor === r.id ? (
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = Number(counter); if (n > 0) void act(r.id, { from_agent: 'HostBot', to_agent: r.from_agent, action_type: 'counter_offer', message: `Can we do ZMW ${n.toLocaleString('en-ZM')}?`, payload_json: { quote_id: r.id, counter_total_zmw: n, guest_count: p.guest_count ?? null } }) }}>
                      <input autoFocus inputMode="numeric" value={counter} onChange={(e) => setCounter(e.target.value.replace(/[^\d.]/g, ''))} placeholder="ZMW"
                        className="w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-amber-500" />
                      <button disabled={busy === r.id} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Send</button>
                      <button type="button" onClick={() => setCounterFor(null)} className="text-xs text-zinc-500">cancel</button>
                    </form>
                  ) : (
                    <button onClick={() => { setCounterFor(r.id); setCounter('') }} className="rounded-lg border border-amber-700 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-950">Counter</button>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {supabase && sorted.length === 0 && <li className="text-sm text-zinc-500">No agent messages yet.</li>}
      </ul>
    </section>
  )
}
