import type { PaymentRow, PaymentStatus } from '../types/database'
import type { Plan } from '../types/plan'
import type { VendorWithOrg } from '../mock/demo'
import { formatCAT, formatPhone, formatZMWLong } from '../lib/format'
import { Badge, Card } from './ui'

const payTone: Record<PaymentStatus, 'green' | 'amber' | 'red' | 'stone' | 'blue'> = {
  succeeded: 'green', pending: 'amber', processing: 'blue', failed: 'red', refunded: 'stone', cancelled: 'stone',
}
const bookingTone = { confirmed: 'green', requested: 'blue', proposed: 'stone', declined: 'red', cancelled: 'red' } as const

export function VendorsPanel({ vendors, plan, payments, offline, onSimulatePaid }: {
  vendors: VendorWithOrg[]; plan: Plan; payments: PaymentRow[]; offline: boolean; onSimulatePaid: (id: string) => void
}) {
  const paidTotal = payments.filter((p) => p.status === 'succeeded').reduce((s, p) => s + p.amount_zmw, 0)
  const dueTotal = plan.vendor_assignments.reduce((s, a) => s + a.deposit_zmw, 0)
  return (
    <Card title="Vendors & deposits" right={<Badge tone={paidTotal >= dueTotal ? 'green' : 'amber'}>Deposits {formatZMWLong(paidTotal)} / {formatZMWLong(dueTotal)}</Badge>}>
      <ul className="space-y-3">
        {vendors.map((v) => {
          const a = plan.vendor_assignments.find((x) => x.vendor_ref === v.slug)
          const vp = payments.filter((p) => p.vendor_id === v.id)
          return (
            <li key={v.id} className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-zinc-100">{v.display_name} <span className="text-xs font-normal text-zinc-500">★ {v.rating} · {v.area}</span></p>
                  <p className="text-xs text-zinc-400">{v.category.replace('_', ' & ')} · {formatPhone(v.whatsapp)}</p>
                </div>
                <Badge tone={bookingTone[v.booking?.status ?? 'proposed']}>{v.booking?.status ?? 'not booked'}</Badge>
              </div>
              {a && (
                <p className="mt-2 text-xs text-zinc-300">{a.scope}. Est. <b>{formatZMWLong(a.estimated_zmw)}</b>, deposit {a.deposit_pct}% = <b>{formatZMWLong(a.deposit_zmw)}</b></p>
              )}
              {vp.map((p) => (
                <div key={p.id} className="mt-2 flex items-center justify-between rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs">
                  <span className="text-zinc-300">Elicate Pay · {formatZMWLong(p.amount_zmw)} · {p.payer_network?.toUpperCase()} {p.paid_at ? `· ${formatCAT(p.paid_at)}` : ''}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={payTone[p.status]}>{p.status}</Badge>
                    {offline && p.status === 'pending' && (
                      <button onClick={() => onSimulatePaid(p.id)} className="text-emerald-700 underline">simulate webhook</button>
                    )}
                  </span>
                </div>
              ))}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
