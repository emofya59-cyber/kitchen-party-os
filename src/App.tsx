import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useEventData } from './hooks/useEventData'
import { streamPlan, type PlanRequest } from './lib/planStream'
import { formatCAT } from './lib/format'
import { demoAction, sendBridge } from './lib/api'
import { reviseHeadcount } from './lib/revise'
import type { Plan } from './types/plan'
import type { AgentBridgeRow } from './types/database'
import { mockPlan } from './mock/demo'
import { BriefPanel } from './components/BriefPanel'
import { BudgetTiles } from './components/BudgetTiles'
import { RsvpCounter } from './components/RsvpCounter'
import { Assumptions, CostBreakdown, MenuTable, RevisionBanner, RunOfShow } from './components/PlanView'
import { VendorsPanel } from './components/VendorsPanel'
import { Badge } from './components/ui'
import { NegotiationFeed } from './components/NegotiationFeed'
import { CashflowTiles, Invoice, PayModal, payTargets, type PayTarget } from './components/InvoicePay'
import { GuestTracker } from './components/GuestTracker'
import { OpsAgent } from './components/OpsAgent'
import { QrCard } from './components/QrCard'
import { DemoBar } from './components/DemoBar'

const WOODLANDS_BRIEF = '120 guests, kitchen party in Woodlands on Sat 5 Dec, budget ZMW 25,000, nshima + 3 relishes + cake'

export default function App() {
  const d = useEventData()
  const [brief, setBrief] = useState(d.event.brief ?? WOODLANDS_BRIEF)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'grok' | 'offline' | null>(null)
  const [pulse, setPulse] = useState(false)
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null)
  const [payAuto, setPayAuto] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [bridgeRows, setBridgeRows] = useState<AgentBridgeRow[]>([])
  const abort = useRef<AbortController | null>(null)
  const planRef = useRef<Plan>(d.plan)
  planRef.current = d.plan

  useEffect(() => {
    if (!d.lastPulse) return
    setPulse(true)
    const t = setTimeout(() => setPulse(false), 600)
    return () => clearTimeout(t)
  }, [d.lastPulse])

  const changed = useMemo(() => new Set((d.plan.changes ?? []).map((c) => c.path)), [d.plan])
  const { setPlan } = d
  const onApplied = useCallback((guestCount: number) => {
    setPlan((prev) => (prev.event.guest_count === guestCount ? prev : reviseHeadcount(prev, guestCount - prev.event.guest_count)))
  }, [setPlan])

  const run = (req: PlanRequest) => new Promise<Plan | null>((resolve) => {
    abort.current?.abort()
    abort.current = new AbortController()
    setStreaming(true); setError(null); setStreamText('')
    void streamPlan(req, {
      onToken: setStreamText,
      onDone: (plan, meta) => { d.setPlan(plan); setSource(meta.source); setStreaming(false); resolve(plan) },
      onError: (m) => { setError(m); setStreaming(false); resolve(null) },
    }, abort.current.signal)
  })

  const ev = useMemo(() => ({ title: d.event.title, when: formatCAT(d.event.starts_at).replace(' CAT', ''), venue: d.event.venue ?? 'Woodlands, Lusaka' }), [d.event])
  const targets = useMemo(() => payTargets(d.plan, d.vendors, d.payments), [d.plan, d.vendors, d.payments])
  const pendingQuote = useMemo(() => bridgeRows.find((r) => r.status === 'pending' && r.from_agent !== 'HostBot' && (r.action_type === 'quote' || r.action_type === 'counter_offer')) ?? null, [bridgeRows])

  const dispatchToCaterer = async (plan: Plan) => {
    const catering = plan.menu.filter((m) => m.vendor_ref === 'ba-mwapes-kitchen')
    await sendBridge({
      from_agent: 'HostBot', to_agent: 'WoodlandsCatererBot', action_type: 'quote_request',
      message: `Headcount is now ${plan.event.guest_count}. Please re-quote food & drinks, delivery 12:00 on Sat 5 Dec (Woodlands). Budget ZMW ${(plan.cost_breakdown.budget_zmw ?? 0).toLocaleString('en-ZM')}.`,
      payload_json: {
        guest_count: plan.event.guest_count, previous_guest_count: 120, delivery_time: '2026-12-05T12:00:00+02:00', budget_zmw: plan.cost_breakdown.budget_zmw,
        menu: catering.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
      },
    })
  }

  const triggers = [
    { id: 'brief', label: 'Load Woodlands Brief (120 Guests / ZMW 25,000)', run: async () => { setBrief(WOODLANDS_BRIEF); await run({ kind: 'initial', brief: WOODLANDS_BRIEF, eventId: d.event.id }) } },
    { id: 'plus15', label: "Trigger +15 Extra Guests → Dispatch to Anna's Caterer Bot", run: async () => {
      const base = planRef.current.event.guest_count === 120 ? planRef.current : mockPlan
      const p = await run({ kind: 'revision', change: 'Aunty Mwape confirmed 15 extra guests', previousPlan: base, eventId: d.event.id })
      if (p) await dispatchToCaterer(p)
    } },
    { id: 'counter', label: 'Fallback: Simulate Caterer Bot Counter-Offer', run: async () => {
      const g = Math.max(planRef.current.event.guest_count, 135)
      await sendBridge({ from_agent: 'WoodlandsCatererBot', to_agent: 'HostBot', action_type: 'quote',
        message: `Muli shani! For ${g} guests I can do ZMW ${(16740).toLocaleString('en-ZM')} if we swap village chicken for beef stew (saves ZMW 675). Delivery 12:00 sharp. Example estimate.`,
        payload_json: { vendor_ref: 'ba-mwapes-kitchen', guest_count: g, total_zmw: 16740, deposit_zmw: 5022, currency: 'ZMW', price_basis: 'example_estimate', delivery_time: '2026-12-05T12:00:00+02:00',
          menu: [
            { name: 'Nshima (white maize)', quantity: g, unit_cost_zmw: 12 }, { name: 'Village chicken (stewed)', quantity: g, unit_cost_zmw: 40 },
            { name: 'Kapenta with tomato & onion', quantity: g, unit_cost_zmw: 20 }, { name: 'Ifisashi (greens in groundnut sauce)', quantity: g, unit_cost_zmw: 15 },
            { name: 'Impwa (garden eggs) with tomato', quantity: g, unit_cost_zmw: 12 }, { name: 'Chikanda (African polony) slices', quantity: g, unit_cost_zmw: 10 },
            { name: 'Soft drinks, Maheu & water', quantity: g, unit_cost_zmw: 15 },
          ] } })
    } },
    { id: 'pay', label: 'Simulate Elicate Pay Deposit', run: () => {
      const t = targets[0] ?? { vendorRef: 'chanda-cakes', vendorName: 'Chanda Cakes & Bakes', amount: 1400 }
      setPayAuto(true); setPayTarget(t)
    } },
    { id: 'reset', label: 'Reset Demo', run: async () => {
      abort.current?.abort()
      if (d.live) await demoAction('reset')
      setStreamText(''); setSource(null); setError(null); setBrief(WOODLANDS_BRIEF); setPayTarget(null)
      d.reset(); setReloadKey((k) => k + 1)
    } },
  ]

  const modeBadge = d.mode === 'offline'
    ? <Badge tone="amber">Offline demo · mock data</Badge>
    : d.mode === 'live' ? <Badge tone="green">● Live · Supabase Realtime</Badge>
    : <Badge tone="blue">Supabase connected · demo data</Badge>

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1c1410,_#09090b_55%)] pb-28 text-zinc-100 print:bg-white print:pb-0">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-600 to-amber-400 text-xl shadow-lg shadow-orange-900/40">🍲</div>
            <div>
              <h1 className="text-lg font-black tracking-tight">Kitchen Party OS <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-zinc-400">COMMAND CENTER</span></h1>
              <p className="text-xs text-zinc-500">AI event ops for Lusaka · powered by Grok</p>
            </div>
          </div>
          <div className="text-center">
            <p className="font-semibold">{d.event.title}</p>
            <p className="text-xs text-zinc-500">{formatCAT(d.event.starts_at)} · {d.event.area}, Lusaka · {d.plan.event.guest_count} guests</p>
          </div>
          <div className="flex items-center gap-2">{modeBadge}<a href="/vendor" target="_blank" rel="noreferrer" className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Vendor view ↗</a></div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-5 px-5 py-5 xl:grid-cols-12 print:block">
        <div className="flex flex-col gap-5 xl:col-span-3 print:hidden">
          <BriefPanel brief={brief} onBriefChange={setBrief} streaming={streaming} streamText={streamText} error={error} source={source}
            onGenerate={(b) => void run({ kind: 'initial', brief: b, eventId: d.event.id })}
            onRevise={(c) => void run({ kind: 'revision', change: c, previousPlan: d.plan, eventId: d.event.id })} />
          <RsvpCounter headcount={d.headcount} target={d.plan.event.guest_count} guests={d.guests} pulse={pulse} onSimulate={d.simulateRsvp} onSetRsvp={(id, s) => void d.setRsvp(id, s)} />
        </div>

        <div className="flex flex-col gap-5 xl:col-span-6">
          <div className="print:hidden"><BudgetTiles plan={d.plan} /></div>
          <div className="print:hidden"><CashflowTiles payments={d.payments} guests={d.guests} plan={d.plan} /></div>
          <div className="print:hidden"><RevisionBanner plan={d.plan} /></div>
          <div className="print:hidden"><NegotiationFeed eventId={d.event.id} onApplied={onApplied} reloadKey={reloadKey} onRows={setBridgeRows} /></div>
          <Invoice plan={d.plan} eventTitle={d.event.title} startsAt={d.event.starts_at} targets={targets} onPay={(t) => { setPayAuto(false); setPayTarget(t) }} />
          <div className="grid gap-5 lg:grid-cols-2 print:hidden">
            <MenuTable plan={d.plan} changed={changed} />
            <CostBreakdown plan={d.plan} />
          </div>
          <div className="print:hidden">
            <GuestTracker guests={d.guests} dispatchLog={d.dispatchLog} live={d.live} ev={ev} onSetRsvp={(id, s) => void d.setRsvp(id, s)}
              onLocalDispatch={d.local.addDispatch} onLocalFlush={d.local.flushDispatch} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2 print:hidden">
            <RunOfShow plan={d.plan} />
            <Assumptions plan={d.plan} />
          </div>
        </div>

        <div className="flex flex-col gap-5 xl:col-span-3 print:hidden">
          <OpsAgent plan={d.plan} vendors={d.vendors} payments={d.payments} guests={d.guests} audit={d.audit} live={d.live} ev={ev} pendingQuote={pendingQuote}
            onLocalAudit={d.local.addAudit}
            onLocalDispatch={(n) => d.local.addAudit({ id: crypto.randomUUID(), event_id: '', actor: 'OpsAgent', rule: 'pending_rsvps', action: `queued_${n}_sms`, detail: {}, created_at: new Date().toISOString() })} />
          <QrCard />
          <VendorsPanel vendors={d.vendors} plan={d.plan} payments={d.payments} offline={false} onSimulatePaid={() => undefined} />
        </div>
      </main>

      <footer className="pb-4 text-center text-xs text-zinc-600 print:hidden">
        Built by <b className="text-zinc-400">Emmanuel Mofya</b> & <b className="text-zinc-400">Anna Mwanza</b> (NIPA) · Grok Bot Lusaka Hackathon 2026 · ZMW amounts are example estimates · payments & SMS are simulated
      </footer>

      <PayModal target={payTarget} live={d.live} autoRun={payAuto} onClose={() => { setPayTarget(null); setPayAuto(false) }}
        onLocalPaid={(pid, r, phone, net) => pid && d.local.markPaid(pid, r, phone, net)} />
      <DemoBar triggers={triggers} />
    </div>
  )
}
