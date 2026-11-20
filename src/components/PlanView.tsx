import type { Plan } from '../types/plan'
import { formatZMWLong } from '../lib/format'
import { Card, EstimateTag } from './ui'

export function RevisionBanner({ plan }: { plan: Plan }) {
  if (!plan.revision_summary) return null
  return (
    <div className="rounded-2xl border border-orange-900 bg-orange-950/40 p-4">
      <p className="font-semibold text-orange-200">↻ {plan.revision_summary}</p>
      {plan.changes && (
        <ul className="mt-2 grid gap-1 text-xs text-orange-300 sm:grid-cols-2">
          {plan.changes.slice(0, 10).map((c) => (
            <li key={c.path} className="font-mono">{c.path}: <s className="opacity-60">{String(c.from ?? '∅')}</s> → <b>{String(c.to ?? '∅')}</b></li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MenuTable({ plan, changed }: { plan: Plan; changed: Set<string> }) {
  return (
    <Card title={`Menu · ${plan.event.guest_count} guests`} right={<EstimateTag />}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="pb-2">Item</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Unit</th><th className="pb-2 text-right">Line</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {plan.menu.map((m) => (
              <tr key={m.id} className={changed.has(`menu[${m.id}].quantity`) || changed.has(`menu[${m.id}]`) ? 'bg-orange-950/40 transition-colors' : ''}>
                <td className="py-2 pr-2"><p className="font-medium text-zinc-100">{m.name}</p>{m.notes && <p className="text-xs text-zinc-500">{m.notes}</p>}</td>
                <td className="whitespace-nowrap py-2 text-right tabular-nums">{m.quantity} <span className="text-zinc-500">{m.unit}</span></td>
                <td className="whitespace-nowrap py-2 pl-2 text-right tabular-nums text-zinc-400">{formatZMWLong(m.unit_cost_zmw)}</td>
                <td className="whitespace-nowrap py-2 pl-2 text-right font-semibold tabular-nums">{formatZMWLong(m.line_total_zmw)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function CostBreakdown({ plan }: { plan: Plan }) {
  const cb = plan.cost_breakdown
  return (
    <Card title="Cost breakdown (ZMW)" right={<EstimateTag />}>
      <ul className="divide-y divide-zinc-800 text-sm">
        {cb.line_items.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-2"><span className="text-zinc-200">{l.description}</span><span className="shrink-0 font-semibold tabular-nums">{formatZMWLong(l.total_zmw)}</span></li>
        ))}
        <li className="flex justify-between py-2 text-zinc-400"><span>Subtotal</span><span className="tabular-nums">{formatZMWLong(cb.subtotal_zmw)}</span></li>
        <li className="flex justify-between py-2 text-zinc-400"><span>Contingency ({cb.contingency_pct}%)</span><span className="tabular-nums">{formatZMWLong(cb.contingency_zmw)}</span></li>
        <li className="flex justify-between py-2 text-base font-bold"><span>Total</span><span className="tabular-nums">{formatZMWLong(cb.total_zmw)}</span></li>
      </ul>
      {plan.warnings.length > 0 && <div className="mt-3 space-y-1">{plan.warnings.map((w) => <p key={w} className="rounded-lg bg-amber-950/50 p-2 text-xs text-amber-300">⚠ {w}</p>)}</div>}
    </Card>
  )
}

export function RunOfShow({ plan }: { plan: Plan }) {
  return (
    <Card title="Run of show">
      <ol className="relative ml-2 border-l-2 border-orange-900">
        {plan.run_of_show.map((r) => (
          <li key={r.time + r.item} className="mb-3 ml-4">
            <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-zinc-900 bg-orange-500" />
            <p className="text-sm"><span className="font-mono font-semibold text-orange-400">{r.time}</span> <span className="font-medium text-zinc-100">{r.item}</span></p>
            <p className="text-xs text-zinc-500">{r.owner} · {r.duration_min} min{r.notes ? ` · ${r.notes}` : ''}</p>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export function Assumptions({ plan }: { plan: Plan }) {
  return (
    <Card title="Assumptions">
      <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">{plan.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
    </Card>
  )
}
