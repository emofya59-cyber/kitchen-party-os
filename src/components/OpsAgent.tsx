import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentBridgeRow, AuditTrailRow, GuestRow, PaymentRow } from '../types/database'
import type { Plan } from '../types/plan'
import type { VendorWithOrg } from '../mock/demo'
import { bridgePost, catTime, demoAction } from '../lib/api'
import { formatZMWLong } from '../lib/format'
import { reminderText } from '../lib/reminders'

type Rule = { id: string; severity: 'high' | 'med' | 'low'; title: string; detail: string; actionLabel: string; run: () => Promise<string> }

export function OpsAgent({ plan, vendors, payments, guests, audit, live, ev, onLocalAudit, onLocalDispatch, pendingQuote }: {
  plan: Plan; vendors: VendorWithOrg[]; payments: PaymentRow[]; guests: GuestRow[]; audit: AuditTrailRow[]; live: boolean
  ev: { title: string; when: string; venue: string }
  onLocalAudit: (row: AuditTrailRow) => void; onLocalDispatch: (n: number) => void
  pendingQuote: AgentBridgeRow | null
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})

  const log = async (rule: string, action: string, detail: Record<string, unknown>) => {
    if (live) await demoAction('audit', { actor: 'OpsAgent', rule, action, detail })
    else onLocalAudit({ id: crypto.randomUUID(), event_id: '', actor: 'OpsAgent', rule, action, detail: detail as never, created_at: new Date().toISOString() })
  }

  const rules = useMemo<Rule[]>(() => {
    const out: Rule[] = []
    const cb = plan.cost_breakdown
    if (cb.variance_zmw != null && cb.variance_zmw < 0) {
      const chicken = plan.menu.find((m) => m.id === 'village-chicken' || /village chicken/i.test(m.name))
      const saving = chicken ? 5 * chicken.quantity : 0
      out.push({ id: 'budget', severity: 'high', title: `Budget overrun ${formatZMWLong(-cb.variance_zmw)}`, detail: `Total ${formatZMWLong(cb.total_zmw)} vs budget ${formatZMWLong(cb.budget_zmw)}. Propose beef stew swap (saves ~${formatZMWLong(saving)}).`, actionLabel: 'Propose swap to caterer',
        run: async () => {
          const payload = { proposal: 'swap village chicken → beef stew', saving_zmw: saving, guest_count: plan.event.guest_count }
          if (live) await bridgePost({ from_agent: 'HostBot', to_agent: 'WoodlandsCatererBot', action_type: 'message', message: `OpsAgent: we're ${formatZMWLong(-cb.variance_zmw!)} over budget. Can you swap village chicken for beef stew (saves ~${formatZMWLong(saving)})?`, payload_json: payload })
          await log('budget_overrun', 'proposed_budget_swap', payload)
          return 'Swap proposal sent to WoodlandsCatererBot'
        } })
    }
    const unpaid = plan.vendor_assignments.filter((a) => { const v = vendors.find((x) => x.slug === a.vendor_ref); return v && !payments.some((p) => p.vendor_id === v.id && p.status === 'succeeded') })
    if (unpaid.length) {
      out.push({ id: 'deposit', severity: 'high', title: `${unpaid.length} deposit${unpaid.length > 1 ? 's' : ''} overdue`, detail: unpaid.map((a) => `${a.vendor_name} ${formatZMWLong(a.deposit_zmw)}`).join(' · '), actionLabel: 'Send deposit requests',
        run: async () => {
          if (live) for (const a of unpaid) await demoAction('request_deposit', { vendor_ref: a.vendor_ref, amount_zmw: a.deposit_zmw })
          await log('overdue_deposit', 'deposit_requests_sent', { vendors: unpaid.map((a) => a.vendor_ref), total_zmw: unpaid.reduce((s, a) => s + a.deposit_zmw, 0) })
          return `Elicate Pay requests raised for ${unpaid.length} vendor(s)`
        } })
    }
    const unconfirmed = vendors.filter((v) => v.booking && v.booking.status !== 'confirmed')
    if (unconfirmed.length || pendingQuote) {
      out.push({ id: 'vendors', severity: 'med', title: `${unconfirmed.length} unconfirmed vendor${unconfirmed.length === 1 ? '' : 's'}${pendingQuote ? ' · caterer quote awaiting reply' : ''}`, detail: [...unconfirmed.map((v) => `${v.display_name} (${v.booking?.status})`), pendingQuote ? 'WoodlandsCatererBot quote pending' : ''].filter(Boolean).join(' · '), actionLabel: 'Nudge via agent bridge',
        run: async () => {
          if (live) await bridgePost({ from_agent: 'HostBot', to_agent: 'WoodlandsCatererBot', action_type: 'message', message: `OpsAgent reminder: event is ${ev.when}. Please confirm delivery times for ${plan.event.guest_count} guests and keep your quote current.`, payload_json: { reminder: true, guest_count: plan.event.guest_count, unconfirmed: unconfirmed.map((v) => v.slug) } })
          await log('unconfirmed_vendors', 'bridge_reminder_posted', { vendors: unconfirmed.map((v) => v.slug), to: 'WoodlandsCatererBot' })
          return 'Reminder posted to WoodlandsCatererBot'
        } })
    }
    const pending = guests.filter((g) => g.rsvp_status === 'invited' || g.rsvp_status === 'maybe')
    if (pending.length) {
      out.push({ id: 'rsvp', severity: 'low', title: `${pending.length} RSVPs pending`, detail: `${pending.reduce((s, g) => s + g.party_size, 0)} people unconfirmed; caterer needs a final count.`, actionLabel: 'Queue SMS reminders',
        run: async () => {
          if (live) {
            await demoAction('dispatch', { channel: 'sms', items: pending.map((g) => ({ guest_id: g.id, message: reminderText(g, ev, 'en') })) })
            setTimeout(() => { void demoAction('dispatch_flush').catch(() => undefined) }, 1800)
          } else onLocalDispatch(pending.length)
          await log('pending_rsvps', 'guest_reminders_queued', { count: pending.length, channel: 'sms', provider: 'africas_talking' })
          return `${pending.length} reminders queued (Africa's Talking, simulated)`
        } })
    }
    return out
  }, [plan, vendors, payments, guests, live, pendingQuote, ev]) // eslint-disable-line react-hooks/exhaustive-deps

  const sev = { high: 'border-rose-800 bg-rose-950/40', med: 'border-amber-800 bg-amber-950/30', low: 'border-sky-900 bg-sky-950/30' }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-400"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Daily Ops Agent</h2>
        <span className="text-[11px] text-zinc-500">{rules.length} flag{rules.length === 1 ? '' : 's'} · Alfred pattern</span>
      </header>
      <ul className="space-y-2">
        {rules.map((r) => (
          <li key={r.id} className={`rounded-xl border p-3 ${sev[r.severity]}`}>
            <p className="text-sm font-semibold text-zinc-100">{r.title}</p>
            <p className="mt-0.5 text-xs text-zinc-400">{r.detail}</p>
            <div className="mt-2 flex items-center gap-2">
              <button disabled={busy === r.id} onClick={async () => { setBusy(r.id); try { const m = await r.run(); setDone((d) => ({ ...d, [r.id]: m })) } catch (e) { setDone((d) => ({ ...d, [r.id]: `⚠ ${e instanceof Error ? e.message : e}` })) } finally { setBusy(null) } }}
                className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">
                {busy === r.id ? 'Executing…' : `Execute Agent Action: ${r.actionLabel}`}
              </button>
            </div>
            {done[r.id] && <p className="mt-1 text-[11px] text-emerald-400">✓ {done[r.id]}</p>}
          </li>
        ))}
        {rules.length === 0 && <li className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300">All clear. No issues flagged.</li>}
      </ul>
      <p className="mb-1 mt-4 text-[11px] uppercase tracking-wide text-zinc-500">Audit trail</p>
      <ul className="max-h-56 space-y-1 overflow-auto text-xs">
        {audit.slice(0, 40).map((a) => (
          <li key={a.id} className="rounded bg-zinc-900 px-2 py-1">
            <span className="text-zinc-500">{catTime(a.created_at)}</span> <span className="font-semibold text-zinc-200">{a.actor}</span> <span className="font-mono text-amber-300">{a.action}</span>
          </li>
        ))}
        {audit.length === 0 && <li className="text-zinc-600">No agent actions yet.</li>}
      </ul>
    </section>
  )
}
