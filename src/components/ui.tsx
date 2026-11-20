import type { ReactNode } from 'react'

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm backdrop-blur ${className}`}>
      {(title || right) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

const tones = {
  green: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-100 text-amber-300 ring-amber-200',
  red: 'bg-rose-100 text-rose-800 ring-rose-200',
  stone: 'bg-stone-100 text-zinc-200 ring-stone-200',
  blue: 'bg-sky-100 text-sky-800 ring-sky-200',
} as const

export function Badge({ tone = 'stone', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>
}

export function EstimateTag() {
  return <Badge tone="amber">Example estimates, not quotes</Badge>
}
