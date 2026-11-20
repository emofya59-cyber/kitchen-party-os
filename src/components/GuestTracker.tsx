import { useMemo, useState } from 'react'
import type { DispatchLogRow, GuestRow, RsvpStatus } from '../types/database'
import { formatPhone, formatZMWLong } from '../lib/format'
import { catTime, demoAction } from '../lib/api'
import { reminderText, waLink, type Lang } from '../lib/reminders'
import { generateReminderWithGrok } from '../lib/planStream'

const tone: Record<RsvpStatus, string> = {
  confirmed: 'bg-emerald-950 text-emerald-300', invited: 'bg-zinc-800 text-zinc-300', maybe: 'bg-amber-950 text-amber-300', declined: 'bg-rose-950 text-rose-300',
}

export function GuestTracker({ guests, dispatchLog, live, ev, onSetRsvp, onLocalDispatch, onLocalFlush }: {
  guests: GuestRow[]; dispatchLog: DispatchLogRow[]; live: boolean
  ev: { title: string; when: string; venue: string }
  onSetRsvp: (id: string, s: RsvpStatus) => void
  onLocalDispatch: (rows: DispatchLogRow[]) => void; onLocalFlush: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'pending'>('pending')
  const [lang, setLang] = useState<Lang>('en')
  const [custom, setCustom] = useState<string | null>(null)
  const [genBusy, setGenBusy] = useState(false)
  const [source, setSource] = useState<'grok' | 'template'>('template')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const shown = useMemo(() => guests.filter((g) => filter === 'all' || g.rsvp_status === 'invited' || g.rsvp_status === 'maybe'), [guests, filter])
  const pledgeTotal = guests.filter((g) => g.rsvp_status !== 'declined').reduce((s, g) => s + Number(g.gift_pledge_zmw ?? 0), 0)
  const textFor = (g: GuestRow) => (custom ? custom.replace(/\{name\}/g, g.full_name.replace(/^(Mrs|Mr|Ms)\s+/, '').split(' ')[0]) : reminderText(g, ev, lang))

  async function generate() {
    setGenBusy(true)
    const t = await generateReminderWithGrok(ev, lang)
    if (t) { setCustom(t); setSource('grok') } else { setCustom(null); setSource('template') }
    setGenBusy(false)
  }

  async function sendAT() {
    const targets = shown.filter((g) => g.phone)
    if (!targets.length) return
    setSending(true); setMsg(null)
    try {
      if (live) {
        await demoAction('dispatch', { channel: 'sms', items: targets.map((g) => ({ guest_id: g.id, message: textFor(g) })) })
        setTimeout(() => { void demoAction('dispatch_flush').catch(() => undefined) }, 1800)
      } else {
        const now = new Date().toISOString()
        onLocalDispatch(targets.map((g) => ({ id: crypto.randomUUID(), event_id: g.event_id, guest_id: g.id, channel: 'sms', provider: 'africas_talking', to_phone: g.phone, to_name: g.full_name, message: textFor(g), status: 'queued', simulated: true, created_at: now, sent_at: null })))
        setTimeout(onLocalFlush, 1800)
      }
      setMsg(`${targets.length} SMS queued via Africa's Talking (simulated)`)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setSending(false) }
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Guests, RSVPs & gift pledges</h2>
        <div className="flex gap-1 text-xs">
          {(['pending', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 ${filter === f ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>{f === 'pending' ? 'Needs reply' : `All ${guests.length}`}</button>
          ))}
        </div>
      </header>

      <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500">Reminder:</span>
          {(['en', 'bem'] as const).map((l) => (
            <button key={l} onClick={() => { setLang(l); setCustom(null); setSource('template') }} className={`rounded px-2 py-0.5 ${lang === l ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}>{l === 'en' ? 'English' : 'Bemba-friendly'}</button>
          ))}
          <button onClick={generate} disabled={genBusy} className="rounded bg-sky-800 px-2 py-0.5 text-sky-100 hover:bg-sky-700 disabled:opacity-50">{genBusy ? 'Generating…' : '✨ Generate with Grok'}</button>
          <span className="text-zinc-600">{source === 'grok' ? 'by Grok' : 'template (Grok offline)'}</span>
        </div>
        <p className="mt-2 text-sm text-zinc-300">{shown[0] ? textFor(shown[0]) : reminderText({ full_name: 'Guest', rsvp_status: 'invited' }, ev, lang)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={sendAT} disabled={sending || !shown.length} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
            Send via Africa's Talking ({shown.filter((g) => g.phone).length})
          </button>
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        </div>
      </div>

      <div className="max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900 text-left text-[11px] uppercase text-zinc-500">
            <tr><th className="py-1">Guest</th><th>Phone</th><th>RSVP</th><th className="text-right">Pledge</th><th className="text-right">WhatsApp</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {shown.map((g) => (
              <tr key={g.id}>
                <td className="py-1.5 pr-2"><p className="text-zinc-100">{g.full_name}{g.party_size > 1 && <span className="text-zinc-500"> +{g.party_size - 1}</span>}</p><p className="text-[11px] text-zinc-500">{g.guest_group}</p></td>
                <td className="whitespace-nowrap font-mono text-xs text-zinc-400">{formatPhone(g.phone)}</td>
                <td>
                  <select value={g.rsvp_status} onChange={(e) => onSetRsvp(g.id, e.target.value as RsvpStatus)} className={`rounded px-1.5 py-0.5 text-xs outline-none ${tone[g.rsvp_status]}`}>
                    {(['invited', 'confirmed', 'maybe', 'declined'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="text-right tabular-nums text-zinc-300">{g.gift_pledge_zmw ? formatZMWLong(g.gift_pledge_zmw) : '—'}</td>
                <td className="text-right"><a href={waLink(g.phone, textFor(g))} target="_blank" rel="noreferrer" className="rounded bg-green-800 px-2 py-0.5 text-[11px] text-green-100 hover:bg-green-700">wa.me ↗</a></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3} className="pt-2 text-xs text-zinc-500">Pledges total (excl. declined)</td><td className="pt-2 text-right font-bold text-sky-300">{formatZMWLong(pledgeTotal)}</td><td /></tr></tfoot>
        </table>
      </div>

      <div className="mt-4">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Dispatch log · Africa's Talking (simulated)</p>
        <ul className="max-h-40 space-y-1 overflow-auto text-xs">
          {dispatchLog.slice(0, 30).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded bg-zinc-950/60 px-2 py-1">
              <span className="truncate text-zinc-300">{d.to_name} · {formatPhone(d.to_phone)}</span>
              <span className="shrink-0 text-zinc-500">{catTime(d.sent_at ?? d.created_at)}</span>
              <span className={`shrink-0 rounded px-1.5 ${d.status === 'sent' ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}>{d.status === 'sent' ? 'Sent' : 'Queued'}</span>
            </li>
          ))}
          {dispatchLog.length === 0 && <li className="text-zinc-600">Nothing sent yet.</li>}
        </ul>
      </div>
    </section>
  )
}
