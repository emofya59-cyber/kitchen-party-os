import type { GuestRow, RsvpStatus } from '../types/database'
import { formatPhone } from '../lib/format'
import { Badge, Card } from './ui'

type Headcount = { confirmed: number; maybe: number; pending: number; declined: number; invited: number; rows: number }
const tone: Record<RsvpStatus, 'green' | 'amber' | 'stone' | 'red'> = { confirmed: 'green', maybe: 'amber', invited: 'stone', declined: 'red' }

export function RsvpCounter({ headcount, target, guests, pulse, onSimulate, onSetRsvp }: {
  headcount: Headcount; target: number; guests: GuestRow[]; pulse: boolean
  onSimulate: () => void; onSetRsvp: (id: string, s: RsvpStatus) => void
}) {
  const pct = target ? Math.min(100, (headcount.confirmed / target) * 100) : 0
  const recent = [...guests].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6)
  return (
    <Card title="Live RSVPs" right={<button onClick={onSimulate} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">+ Simulate RSVP</button>}>
      <div className="flex items-end gap-3">
        <span className={`text-5xl font-black tabular-nums text-stone-900 transition ${pulse ? 'scale-110 text-emerald-600' : ''}`}>{headcount.confirmed}</span>
        <span className="pb-1.5 text-stone-500">/ {target} confirmed</span>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
        {([['Maybe', headcount.maybe], ['Pending', headcount.pending], ['Declined', headcount.declined], ['Invited', headcount.invited]] as const).map(([l, v]) => (
          <div key={l} className="rounded-lg bg-stone-50 py-2"><p className="font-bold tabular-nums text-stone-800">{v}</p><p className="text-stone-500">{l}</p></div>
        ))}
      </div>
      <ul className="mt-4 divide-y divide-stone-100">
        {recent.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-stone-800">{g.full_name} {g.party_size > 1 && <span className="text-stone-400">+{g.party_size - 1}</span>}</p>
              <p className="text-xs text-stone-400">{formatPhone(g.phone)} · {g.guest_group}</p>
            </div>
            <button onClick={() => onSetRsvp(g.id, g.rsvp_status === 'confirmed' ? 'declined' : 'confirmed')} title="Toggle RSVP">
              <Badge tone={tone[g.rsvp_status]}>{g.rsvp_status}</Badge>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-400">{headcount.rows} invitations · {headcount.invited} people incl. +1s</p>
    </Card>
  )
}
