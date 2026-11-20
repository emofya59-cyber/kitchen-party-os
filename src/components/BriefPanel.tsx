import { useEffect, useRef, useState } from 'react'
import { Card, Badge } from './ui'
import { isOffline } from '../lib/supabase'
import { CalendarClock, MapPin, PartyPopper, UtensilsCrossed, Users, Wallet, type LucideIcon } from 'lucide-react'
import type { EventFields } from '../lib/eventFields'

const FIELD_DEFS: { key: keyof EventFields; label: string; icon: LucideIcon; type: 'text' | 'number'; min?: number }[] = [
  { key: 'title', label: 'Event / owner name', icon: PartyPopper, type: 'text' },
  { key: 'location', label: 'Location', icon: MapPin, type: 'text' },
  { key: 'dateTime', label: 'Date & time', icon: CalendarClock, type: 'text' },
  { key: 'guests', label: 'Guests', icon: Users, type: 'number', min: 1 },
  { key: 'budget', label: 'Budget ZMW', icon: Wallet, type: 'number', min: 0 },
  { key: 'food', label: 'Food / menu', icon: UtensilsCrossed, type: 'text' },
]

const SECTIONS = ['event', 'menu', 'run_of_show', 'cost_breakdown', 'vendor_assignments', 'assumptions'] as const

type Props = {
  brief: string
  onBriefChange: (v: string) => void
  streaming: boolean
  streamText: string
  error: string | null
  source: 'grok' | 'offline' | null
  onGenerate: (brief: string) => void
  onRevise: (change: string) => void
  fields: EventFields
  onFieldsChange: (f: EventFields) => void
}

export function BriefPanel({ brief, onBriefChange: setBrief, streaming, streamText, error, source, onGenerate, onRevise, fields, onFieldsChange }: Props) {
  const [change, setChange] = useState('')
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight }, [streamText])

  return (
    <div className="flex flex-col gap-5">
      <Card title="Event brief" right={source && <Badge tone={source === 'grok' ? 'blue' : 'stone'}>{source === 'grok' ? 'Grok · live' : 'Offline planner'}</Badge>}>
        <div className="mb-3 grid grid-cols-3 gap-1.5" data-testid="event-fields">
          {FIELD_DEFS.map(({ key, label, icon: Icon, type, min }) => (
            <label key={key} className="group relative block min-w-0" title={label}>
              <span className="mb-0.5 block truncate text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
              <Icon className="pointer-events-none absolute bottom-[7px] left-2 h-3.5 w-3.5 text-zinc-500 group-focus-within:text-orange-400" />
              <input
                name={key}
                aria-label={label}
                type={type}
                min={min}
                value={fields[key]}
                onChange={(e) => onFieldsChange({ ...fields, [key]: type === 'number' ? Math.max(min ?? 0, Number(e.target.value) || 0) : e.target.value })}
                className="w-full min-w-0 rounded-lg border border-zinc-800 bg-zinc-800/60 py-1.5 pl-7 pr-1.5 text-[11px] text-zinc-100 outline-none focus:border-orange-400"
              />
            </label>
          ))}
        </div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-800/60 p-3 text-[15px] leading-relaxed text-zinc-100 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-900"
          placeholder="120 guests, kitchen party in Woodlands, budget ZMW 25,000, nshima + 3 relishes + cake"
        />
        <button
          disabled={streaming || !brief.trim()}
          onClick={() => onGenerate(brief)}
          className="mt-3 w-full rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 px-4 py-3 font-semibold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
        >
          {streaming ? 'Grok is planning…' : 'Generate plan with Grok'}
        </button>

        <div className="mt-5 border-t border-zinc-800 pt-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Tell Grok a change</label>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (change.trim()) onRevise(change) }}>
            <input
              value={change}
              onChange={(e) => setChange(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-800/60 px-3 py-2 text-sm outline-none focus:border-orange-400"
              placeholder="Aunty Mwape confirmed 15 extra guests"
            />
            <button disabled={streaming} className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Revise</button>
          </form>
          <div className="mt-2 flex flex-wrap gap-2">
            {['Aunty Mwape confirmed 15 extra guests', '10 fewer guests', ...(isOffline ? [] : ['Swap village chicken for beef stew'])].map((c) => (
              <button key={c} onClick={() => { setChange(c); onRevise(c) }} disabled={streaming}
                className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-orange-700 hover:text-orange-400 disabled:opacity-50">
                {c}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Grok stream" right={streaming && <span className="h-2.5 w-2.5 animate-ping rounded-full bg-orange-500" />}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <Badge key={s} tone={streamText.includes(`"${s}"`) ? 'green' : 'stone'}>
              {streamText.includes(`"${s}"`) ? '✓' : '○'} {s.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
        <pre ref={pre} className="h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black p-3 font-mono text-[11px] leading-relaxed text-emerald-300">
          {streamText || '// Paste a brief and press Generate. Grok streams structured JSON here.'}
          {streaming && <span className="animate-pulse">▍</span>}
        </pre>
        {error && <p className="mt-3 rounded-lg bg-rose-950/50 p-3 text-sm text-rose-300">{error}</p>}
      </Card>
    </div>
  )
}
