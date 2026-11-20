import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useEventData } from './hooks/useEventData'
import { streamPlan } from './lib/planStream'
import { formatCAT } from './lib/format'
import { BriefPanel } from './components/BriefPanel'
import { BudgetTiles } from './components/BudgetTiles'
import { RsvpCounter } from './components/RsvpCounter'
import { Assumptions, CostBreakdown, MenuTable, RevisionBanner, RunOfShow } from './components/PlanView'
import { VendorsPanel } from './components/VendorsPanel'
import { Badge } from './components/ui'
import { NegotiationFeed } from './components/NegotiationFeed'
import { reviseHeadcount } from './lib/revise'

export default function App() {
  const d = useEventData()
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'grok' | 'offline' | null>(null)
  const [pulse, setPulse] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!d.lastPulse) return
    setPulse(true)
    const t = setTimeout(() => setPulse(false), 600)
    return () => clearTimeout(t)
  }, [d.lastPulse, d.headcount.confirmed])

  // When HostBot accepts a caterer quote with a new headcount, re-plan locally so tiles/menu follow.
  const { setPlan } = d
  const onApplied = useCallback((guestCount: number) => {
    setPlan((prev) => (prev.event.guest_count === guestCount ? prev : reviseHeadcount(prev, guestCount - prev.event.guest_count)))
  }, [setPlan])

  const changed = useMemo(() => new Set((d.plan.changes ?? []).map((c) => c.path)), [d.plan])

  const run = (req: Parameters<typeof streamPlan>[0]) => {
    abort.current?.abort()
    abort.current = new AbortController()
    setStreaming(true); setError(null); setStreamText('')
    void streamPlan(req, {
      onToken: setStreamText,
      onDone: (plan, meta) => { d.setPlan(plan); setSource(meta.source); setStreaming(false) },
      onError: (m) => { setError(m); setStreaming(false) },
    }, abort.current.signal)
  }

  const modeBadge = d.mode === 'offline'
    ? <Badge tone="amber">Offline demo · mock data</Badge>
    : d.mode === 'live' ? <Badge tone="green">● Live · Supabase Realtime</Badge>
    : <Badge tone="blue">Supabase connected · sign in to load events (showing demo)</Badge>

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#fff7ed,_#fafaf9_60%)] text-stone-900">
      <header className="border-b border-orange-100 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-600 to-amber-400 text-xl shadow">🍲</div>
            <div>
              <h1 className="text-lg font-black tracking-tight">Kitchen Party OS</h1>
              <p className="text-xs text-stone-500">AI event planner for Lusaka · powered by Grok</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold">{d.event.title}</p>
            <p className="text-xs text-stone-500">{formatCAT(d.event.starts_at)} · {d.event.area}, Lusaka</p>
          </div>
          {modeBadge}
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <BriefPanel
            defaultBrief={d.event.brief ?? ''}
            streaming={streaming}
            streamText={streamText}
            error={error}
            source={source}
            onGenerate={(brief) => run({ kind: 'initial', brief, eventId: d.event.id })}
            onRevise={(change) => run({ kind: 'revision', change, previousPlan: d.plan, eventId: d.event.id })}
          />
        </div>

        <div className="flex flex-col gap-6 lg:col-span-8">
          <BudgetTiles plan={d.plan} />
          <NegotiationFeed eventId={d.event.id} onApplied={onApplied} />
          <RevisionBanner plan={d.plan} />
          <div className="grid gap-6 xl:grid-cols-2">
            <RsvpCounter headcount={d.headcount} target={d.plan.event.guest_count} guests={d.guests} pulse={pulse}
              onSimulate={d.simulateRsvp} onSetRsvp={(id, s) => void d.setRsvp(id, s)} />
            <VendorsPanel vendors={d.vendors} plan={d.plan} payments={d.payments} offline={d.mode !== 'live'} onSimulatePaid={d.simulateDepositPaid} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <MenuTable plan={d.plan} changed={changed} />
            <CostBreakdown plan={d.plan} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <RunOfShow plan={d.plan} />
            <Assumptions plan={d.plan} />
          </div>
        </div>
      </main>
      <footer className="pb-8 text-center text-xs text-stone-400">All ZMW amounts are example estimates for planning, not vendor quotes. Demo names and +260 numbers are fictional.</footer>
    </div>
  )
}
