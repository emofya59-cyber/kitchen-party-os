import type { Plan } from '../types/plan'
import { formatZMWLong } from '../lib/format'

export function BudgetTiles({ plan }: { plan: Plan }) {
  const cb = plan.cost_breakdown
  const over = cb.variance_zmw != null && cb.variance_zmw < 0
  const pct = cb.budget_zmw ? Math.min(100, (cb.total_zmw / cb.budget_zmw) * 100) : 0
  const tiles = [
    { label: 'Estimated total', value: formatZMWLong(cb.total_zmw), sub: `incl. ${cb.contingency_pct}% contingency` },
    { label: 'Budget', value: formatZMWLong(cb.budget_zmw), sub: `${Math.round(pct)}% used` },
    { label: over ? 'Over budget' : 'Headroom', value: formatZMWLong(Math.abs(cb.variance_zmw ?? 0)), sub: over ? 'needs menu swaps' : 'remaining', tone: over ? 'text-rose-600' : 'text-emerald-600' },
    { label: 'Per guest', value: formatZMWLong(cb.per_guest_zmw), sub: `${plan.event.guest_count} guests` },
  ]
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${t.tone ?? 'text-zinc-50'}`}>{t.value}</p>
            <p className="text-xs text-zinc-500">{t.sub}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full transition-all duration-700 ${over ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
