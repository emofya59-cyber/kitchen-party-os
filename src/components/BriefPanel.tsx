import { useEffect, useRef, useState } from 'react'
import { Card, Badge } from './ui'
import { isOffline } from '../lib/supabase'

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
}

export function BriefPanel({ brief, onBriefChange: setBrief, streaming, streamText, error, source, onGenerate, onRevise }: Props) {
  const [change, setChange] = useState('')
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight }, [streamText])

  return (
    <div className="flex flex-col gap-5">
      <Card title="Event brief" right={source && <Badge tone={source === 'grok' ? 'blue' : 'stone'}>{source === 'grok' ? 'Grok · live' : 'Offline planner'}</Badge>}>
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
