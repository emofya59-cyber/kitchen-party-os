import { useState } from 'react'
import { Clapperboard } from 'lucide-react'

export type DemoTrigger = { id: string; label: string; run: () => Promise<void> | void }

export function DemoBar({ triggers }: { triggers: DemoTrigger[] }) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(null)
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 print:hidden">
      <div className="mx-auto max-w-7xl px-4 pb-3">
        <div className="rounded-2xl border border-zinc-700/80 bg-zinc-900/95 shadow-2xl backdrop-blur">
          <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-1.5 text-[11px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300">
            <span className="flex items-center gap-1.5"><Clapperboard className="h-3.5 w-3.5" /> Demo Mode{last ? ` · ✓ ${last}` : ''}</span><span>{open ? '▾ hide' : '▴ show'}</span>
          </button>
          {open && (
            <div className="flex flex-wrap gap-2 px-3 pb-3">
              {triggers.map((t, i) => (
                <button key={t.id} disabled={busy !== null}
                  onClick={async () => { setBusy(t.id); try { await t.run(); setLast(t.label) } finally { setBusy(null) } }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${t.id === 'reset' ? 'border-rose-800 text-rose-300 hover:bg-rose-950' : 'border-zinc-700 text-zinc-200 hover:border-orange-500 hover:bg-zinc-800'}`}>
                  <span className="mr-1 text-zinc-500">{i + 1}</span>{busy === t.id ? 'Running…' : t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
