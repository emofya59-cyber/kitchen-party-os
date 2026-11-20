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
import { CookingPot } from 'lucide-react'
import { DEFAULT_FIELDS, briefFromFields, customEventArgs, isDefaultFields, type EventFields } from './lib/eventFields'

const WOODLANDS_BRIEF = '120 guests, kitchen party in Woodlands on Sat 5 Dec, budget ZMW 25,000, nshima + 3 relishes + cake'

export default function App() {
  const d = useEventData()
  const [brief, setBrief] = useState(d.event.brief ?? WOODLANDS_BRIEF)
  const [fields, setFields] = useState<EventFields>(DEFAULT_FIELDS)
  const lastSource = useRef<'grok' | 'offline' | null>(null)
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
      onDone: (plan, meta) => { lastSource.current = meta.source; d.setPlan(plan); setSource(meta.source); setStreaming(false); resolve(plan) },
      onError: (m) => { setError(m); setStreaming(false); resolve(null) },
    }, abort.current.signal)
  })

  // Active event header: the current plan wins (instant), DB event row is the fallback.
  const act = useMemo(() => {
    const pe = d.plan.event
    const startsAt = pe.date && pe.start_time ? `${pe.date}T${pe.start_time}:00+02:00` : d.event.starts_at
    return { title: pe.title || d.event.title, area: pe.area || d.event.area || 'Lusaka', venue: pe.venue || d.event.venue || 'Lusaka', startsAt, guests: pe.guest_count }
  }, [d.plan, d.event])
  const ev = useMemo(() => ({ title: act.title, when: formatCAT(act.startsAt).replace(' CAT', ''), venue: act.venue }), [act])
  const targets = useMemo(() => payTargets(d.plan, d.vendors, d.payments), [d.plan, d.vendors, d.payments])
  const pendingQuote = useMemo(() => bridgeRows.find((r) => r.status === 'pending' && r.from_agent !== 'HostBot' && (r.action_type === 'quote' || r.action_type === 'counter_offer')) ?? null, [bridgeRows])

  const dispatchToCaterer = async (plan: Plan, previous: number) => {
    const catering = plan.menu.filter((m) => m.vendor_ref === 'ba-mwapes-kitchen')
    const pe = plan.event
    const date = pe.date ?? '2026-12-05', start = pe.start_time ?? '14:00'
    const startMs = new Date(`${date}T${start}:00+02:00`).getTime()
    const deliveryIso = new Date(startMs - 2 * 3600_000 + 2 * 3600_000).toISOString().slice(0, 19) + '+02:00' // local wall time, 2h before start
    const deliveryHHMM = deliveryIso.slice(11, 16)
    const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(startMs)).replace(',', '')
    await sendBridge({
      from_agent: 'HostBot', to_agent: 'WoodlandsCatererBot', action_type: 'quote_request',
      message: `${pe.title}: headcount is now ${pe.guest_count}. Please re-quote food & drinks, delivery ${deliveryHHMM} on ${dayLabel} (${pe.area ?? pe.venue ?? 'Lusaka'}). Budget ZMW ${(plan.cost_breakdown.budget_zmw ?? 0).toLocaleString('en-ZM')}.`,
      payload_json: {
        guest_count: pe.guest_count, previous_guest_count: previous, delivery_time: deliveryIso, budget_zmw: plan.cost_breakdown.budget_zmw,
        menu: catering.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
        event_title: pe.title, location: pe.venue ?? pe.area, area: pe.area, starts_at: `${date}T${start}:00+02:00`,
      },
    })
  }

  const SEED_REV = 'd0000000-0000-4000-8000-000000000001'
  const dbIsCustom = () => d.event.title !== DEFAULT_FIELDS.title || d.event.area !== 'Woodlands' || (d.event.current_revision_id != null && d.event.current_revision_id !== SEED_REV)

  const generate = async (b: string) => {
    const f = fields
    const plan = await run({ kind: 'initial', brief: b, eventId: d.event.id, fields: f })
    if (!plan || !d.live) return
    try {
      if (isDefaultFields(f) && lastSource.current === 'offline') { if (dbIsCustom()) await demoAction('seed_event') }
      else await demoAction('custom_event', customEventArgs(plan, f, b, lastSource.current === 'grok' ? 'grok' : 'offline-planner'))
    } catch (e) { setError(`Saved plan locally, but Supabase sync failed: ${e instanceof Error ? e.message : String(e)}`) }
  }

  const triggers = [
    { id: 'brief', label: 'Load Woodlands Brief (120 Guests / ZMW 25,000)', run: async () => { setFields(DEFAULT_FIELDS); setBrief(WOODLANDS_BRIEF); if (d.live && dbIsCustom()) await demoAction('seed_event').catch(() => undefined); await run({ kind: 'initial', brief: WOODLANDS_BRIEF, eventId: d.event.id }) } },
    { id: 'plus15', label: "Trigger +15 Extra Guests → Dispatch to Anna's Caterer Bot", run: async () => {
      const cur = planRef.current
      const custom = cur.event.title !== mockPlan.event.title || cur.event.area !== mockPlan.event.area
      const base = custom ? cur : cur.event.guest_count === 120 ? cur : mockPlan
      const p = await run({ kind: 'revision', change: 'Aunty Mwape confirmed 15 extra guests', previousPlan: base, eventId: d.event.id })
      if (p) await dispatchToCaterer(p, base.event.guest_count)
    } },
    { id: 'counter', label: 'Fallback: Simulate Caterer Bot Counter-Offer', run: async () => {
      const g = Math.max(planRef.current.event.guest_count, 135)
      await sendBridge({ from_agent: 'WoodlandsCatererBot', to_agent: 'HostBot', action_type: 'quote',
        message: `Muli shani! For ${g} guests the full menu plus drinks comes to ZMW ${(g * 129).toLocaleString('en-ZM')} (example estimate). The 30% deposit is ZMW ${Math.round(g * 129 * 0.3).toLocaleString('en-ZM')} via Elicate Pay.`,
        payload_json: { vendor_ref: 'ba-mwapes-kitchen', guest_count: g, total_zmw: g * 129, deposit_zmw: Math.round(g * 129 * 0.3), currency: 'ZMW', price_basis: 'example_estimate', delivery_time: '2026-12-05T12:00:00+02:00',
          menu: [
            { name: 'Nshima (white maize)', quantity: g, unit_cost_zmw: 12 }, { name: 'Village chicken (stewed)', quantity: g, unit_cost_zmw: 45 },
            { name: 'Kapenta with tomato & onion', quantity: g, unit_cost_zmw: 20 }, { name: 'Ifisashi (greens in groundnut sauce)', quantity: g, unit_cost_zmw: 15 },
            { name: 'Impwa (garden eggs) with tomato', quantity: g, unit_cost_zmw: 12 }, { name: 'Chikanda (African polony) slices', quantity: g, unit_cost_zmw: 10 },
            { name: 'Soft drinks, Maheu & water', quantity: g, unit_cost_zmw: 15 },
          ] } })
    } },
    { id: 'pay', label: 'Simulate Elicate Pay Deposit', run: () => {
      const t = targets.find((x) => x.vendorRef === 'ba-mwapes-kitchen') ?? targets[0] ?? { vendorRef: 'chanda-cakes', vendorName: 'Chanda Cakes & Bakes', amount: 1400 }
      setPayAuto(true); setPayTarget(t)
    } },
    { id: 'reset', label: 'Reset Demo', run: async () => {
      abort.current?.abort()
      if (d.live) await demoAction('reset')
      setStreamText(''); setSource(null); setError(null); setFields(DEFAULT_FIELDS); setBrief(WOODLANDS_BRIEF); setPayTarget(null)
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
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-600 to-amber-400 shadow-lg shadow-orange-900/40"><CookingPot className="h-5 w-5 text-white" strokeWidth={2.25} /></div>
            <div>
              <h1 className="text-lg font-black tracking-tight">Kitchen Party OS <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-zinc-400">COMMAND CENTER</span></h1>
              <p className="text-xs text-zinc-500">AI event ops for Lusaka · powered by Grok</p>
            </div>
          </div>
          <div className="text-center">
            <p className="font-semibold">{act.title}</p>
            <p className="text-xs text-zinc-500">{formatCAT(act.startsAt)} · {act.area}, Lusaka · {act.guests} guests</p>
          </div>
          <div className="flex items-center gap-2">{modeBadge}<a href="/vendor" target="_blank" rel="noreferrer" className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Vendor view ↗</a></div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-5 px-5 py-5 xl:grid-cols-12 print:block">
        <div className="flex flex-col gap-5 xl:col-span-3 print:hidden">
          <BriefPanel brief={brief} onBriefChange={setBrief} streaming={streaming} streamText={streamText} error={error} source={source}
            onGenerate={(b) => void generate(b)}
            fields={fields} onFieldsChange={(f) => { setFields(f); setBrief(briefFromFields(f)) }}
            onRevise={(c) => void run({ kind: 'revision', change: c, previousPlan: d.plan, eventId: d.event.id })} />
          <RsvpCounter headcount={d.headcount} target={d.plan.event.guest_count} guests={d.guests} pulse={pulse} onSimulate={d.simulateRsvp} onSetRsvp={(id, s) => void d.setRsvp(id, s)} />
        </div>

        <div className="flex flex-col gap-5 xl:col-span-6">
          <div className="print:hidden"><BudgetTiles plan={d.plan} /></div>
          <div className="print:hidden"><CashflowTiles payments={d.payments} guests={d.guests} plan={d.plan} /></div>
          <div className="print:hidden"><RevisionBanner plan={d.plan} /></div>
          <div className="print:hidden"><NegotiationFeed eventId={d.event.id} onApplied={onApplied} reloadKey={reloadKey} onRows={setBridgeRows} /></div>
          <Invoice plan={d.plan} eventTitle={act.title} startsAt={act.startsAt} targets={targets} onPay={(t) => { setPayAuto(false); setPayTarget(t) }} />
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
