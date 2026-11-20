import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCAT, formatZMWLong } from '../lib/format'
import { mockPlan, mockPayments } from '../mock/demo'

type VendorView = {
  event: { title: string; starts_at: string; area: string } | null
  vendor: { display_name: string; category: string; slug: string } | null
  booking: { status: string; quoted_zmw: number; scope: string } | null
  items: { name: string; quantity: number; unit: string }[]
  deliveries: { time: string; item: string; duration_min: number; notes: string | null }[]
  payments: { amount_zmw: number; status: string; receipt_id: string | null; paid_at: string | null }[]
}

const offline: VendorView = {
  event: { title: "Mutale's Kitchen Party", starts_at: '2026-12-05T14:00:00+02:00', area: 'Woodlands' },
  vendor: { display_name: "Ba Mwape's Kitchen", category: 'catering', slug: 'ba-mwapes-kitchen' },
  booking: { status: 'confirmed', quoted_zmw: 15480, scope: mockPlan.vendor_assignments[0].scope },
  items: mockPlan.menu.filter((m) => m.vendor_ref === 'ba-mwapes-kitchen').map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
  deliveries: mockPlan.run_of_show.filter((r) => r.owner === "Ba Mwape's Kitchen"),
  payments: mockPayments.slice(0, 1).map((p) => ({ amount_zmw: p.amount_zmw, status: p.status, receipt_id: p.receipt_id, paid_at: p.paid_at })),
}

export function VendorPage() {
  const ref = new URLSearchParams(window.location.search).get('v') ?? 'ba-mwapes-kitchen'
  const [data, setData] = useState<VendorView | null>(supabase ? null : offline)
  const [pulse, setPulse] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data: d, error } = await supabase.rpc('vendor_view', { p_vendor_ref: ref })
    if (!error && d) { setData(d as unknown as VendorView); setPulse(true); setTimeout(() => setPulse(false), 700) }
    else setData(offline)
  }, [ref])

  useEffect(() => {
    void load()
    if (!supabase) return
    const sb = supabase
    // Change notifications only; data itself is always re-read through the vendor-scoped RPC.
    const ch = sb.channel('vendor-view')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_vendors' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => void load())
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [load])

  if (!data) return <div className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-400">Loading…</div>
  const deposit = data.payments[0]
  return (
    <div className="min-h-screen bg-zinc-950 px-4 pb-10 pt-5 text-zinc-100">
      <div className="mx-auto max-w-md">
        <header className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-600 text-2xl">🧑🏾‍🍳</div>
          <div>
            <p className="text-xs uppercase tracking-wide text-amber-400">Vendor view · WoodlandsCatererBot</p>
            <h1 className="text-lg font-black">{data.vendor?.display_name}</h1>
          </div>
        </header>
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="font-semibold">{data.event?.title}</p>
          <p className="text-sm text-zinc-400">{formatCAT(data.event?.starts_at ?? null)} · {data.event?.area}, Lusaka</p>
          <div className="mt-3 flex items-center justify-between">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${data.booking?.status === 'confirmed' ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}>{data.booking?.status ?? 'not booked'}</span>
            <span className={`text-xl font-black tabular-nums transition ${pulse ? 'text-emerald-300' : ''}`}>{formatZMWLong(data.booking?.quoted_zmw)}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{data.booking?.scope}</p>
        </div>

        <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Food quantities</h2>
        <ul className="divide-y divide-zinc-800 rounded-2xl border border-zinc-800 bg-zinc-900">
          {data.items.map((i) => (
            <li key={i.name} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm">{i.name}</span>
              <span className="text-lg font-bold tabular-nums">{Number(i.quantity)} <span className="text-xs font-normal text-zinc-500">{i.unit}</span></span>
            </li>
          ))}
        </ul>

        <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Delivery & service times</h2>
        <ul className="space-y-2">
          {data.deliveries.map((d) => (
            <li key={d.time + d.item} className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
              <p className="text-sm"><span className="font-mono font-bold text-amber-400">{d.time}</span> {d.item}</p>
              <p className="text-xs text-zinc-500">{d.duration_min} min{d.notes ? ` · ${d.notes}` : ''}</p>
            </li>
          ))}
        </ul>

        <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Deposit / payout</h2>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          {deposit ? (
            <div className="flex items-center justify-between">
              <div><p className="text-lg font-bold">{formatZMWLong(deposit.amount_zmw)}</p><p className="text-xs text-zinc-500">{deposit.receipt_id ?? 'awaiting payment'}{deposit.paid_at ? ` · ${formatCAT(deposit.paid_at)}` : ''}</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${deposit.status === 'succeeded' ? 'bg-emerald-700 text-white' : 'bg-amber-700 text-white'}`}>{deposit.status === 'succeeded' ? 'PAID' : 'PENDING'}</span>
            </div>
          ) : <p className="text-sm text-zinc-500">No deposit requested yet.</p>}
          <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">Elicate Pay · simulated</p>
        </div>
        <p className="mt-6 text-center text-[11px] text-zinc-600">Built by Emmanuel Mofya & Anna Mwanza (NIPA)</p>
      </div>
    </div>
  )
}
