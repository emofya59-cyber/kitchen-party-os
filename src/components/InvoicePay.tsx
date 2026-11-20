import { useEffect, useMemo, useState } from 'react'
import type { PaymentRow } from '../types/database'
import type { Plan } from '../types/plan'
import type { VendorWithOrg } from '../mock/demo'
import { demoAction, networkOf, normaliseZmPhone } from '../lib/api'
import { formatCAT, formatZMWLong } from '../lib/format'

export type PayTarget = { vendorRef: string; vendorName: string; amount: number; paymentId?: string }

const VAT_PCT = 16

export function Invoice({ plan, eventTitle, startsAt, onPay, targets }: {
  plan: Plan; eventTitle: string; startsAt: string | null; onPay: (t: PayTarget) => void; targets: PayTarget[]
}) {
  const cb = plan.cost_breakdown
  const vat = Math.round((cb.total_zmw * VAT_PCT) / 100)
  const invoiceNo = `KPOS-LSK-2026-${String(plan.event.guest_count).padStart(4, '0')}`
  return (
    <section id="invoice" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 print:border-0 print:bg-white print:p-0 print:text-black">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 print:text-black">Tax invoice (pro-forma)</h2>
          <p className="mt-1 font-mono text-lg font-bold text-zinc-50 print:text-black">{invoiceNo}</p>
          <p className="text-xs text-zinc-500">Issued {formatCAT(new Date().toISOString())} · Event {formatCAT(startsAt)}</p>
        </div>
        <div className="text-right text-xs text-zinc-400 print:text-black">
          <p className="font-semibold text-zinc-200 print:text-black">Mwansa Family Events (mock)</p>
          <p>Plot 12, Woodlands, Lusaka</p>
          <p>+260 97 712 3456 · TPIN 1000000000 (mock)</p>
        </div>
      </header>
      <p className="mt-3 text-sm text-zinc-300 print:text-black">For: <b>{eventTitle}</b>, {plan.event.guest_count} guests</p>
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs uppercase text-zinc-500 print:text-black">
          <tr><th className="pb-1">Item</th><th className="pb-1 text-right">Qty</th><th className="pb-1 text-right">Unit</th><th className="pb-1 text-right">Amount</th></tr>
        </thead>
        <tbody className="divide-y divide-zinc-800 print:divide-zinc-300">
          {cb.line_items.map((l, i) => (
            <tr key={i}><td className="py-1.5 pr-2 text-zinc-200 print:text-black">{l.description}</td>
              <td className="py-1.5 text-right tabular-nums">{l.quantity}</td>
              <td className="whitespace-nowrap py-1.5 pl-2 text-right tabular-nums text-zinc-400 print:text-black">{formatZMWLong(l.unit_cost_zmw)}</td>
              <td className="whitespace-nowrap py-1.5 pl-2 text-right font-semibold tabular-nums">{formatZMWLong(l.total_zmw)}</td></tr>
          ))}
          <tr><td colSpan={3} className="py-1.5 text-zinc-400 print:text-black">Contingency ({cb.contingency_pct}%)</td><td className="py-1.5 text-right tabular-nums">{formatZMWLong(cb.contingency_zmw)}</td></tr>
          <tr><td colSpan={3} className="py-1.5 text-zinc-400 print:text-black">VAT {VAT_PCT}% (example only; confirm ZRA applicability)</td><td className="py-1.5 text-right tabular-nums">{formatZMWLong(vat)}</td></tr>
          <tr><td colSpan={3} className="py-2 text-base font-bold">Total (example estimate)</td><td className="py-2 text-right text-base font-bold tabular-nums">{formatZMWLong(cb.total_zmw + vat)}</td></tr>
        </tbody>
      </table>
      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        {targets.map((t) => (
          <button key={t.vendorRef} onClick={() => onPay(t)} className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-2 text-xs font-semibold text-white shadow hover:brightness-110">
            Pay {t.vendorName} deposit {formatZMWLong(t.amount)} via Elicate Pay (Airtel Money / MTN MoMo)
          </button>
        ))}
        {targets.length === 0 && <span className="text-xs text-emerald-400">All vendor deposits paid ✓</span>}
        <button onClick={() => window.print()} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Print / PDF</button>
      </div>
      <p className="mt-2 text-[10px] text-zinc-600 print:text-black">Prices are example estimates, not quotes. Payments are simulated (no real money moves).</p>
    </section>
  )
}

type Step = 'form' | 'ussd' | 'pin' | 'confirm' | 'done' | 'error'

export function PayModal({ target, live, autoRun, onClose, onLocalPaid }: {
  target: PayTarget | null; live: boolean; autoRun?: boolean; onClose: () => void
  onLocalPaid: (paymentId: string | undefined, receipt: string, phone: string, network: string) => void
}) {
  const [network, setNetwork] = useState<'airtel' | 'mtn'>('airtel')
  const [phone, setPhone] = useState('0971234567')
  const [step, setStep] = useState<Step>('form')
  const [receipt, setReceipt] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const e164 = useMemo(() => normaliseZmPhone(phone), [phone])

  useEffect(() => { if (target) { setStep('form'); setReceipt(null); setErr(null) } }, [target])
  useEffect(() => { if (target && autoRun) void run() }, [target, autoRun]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function run() {
    const num = normaliseZmPhone(phone)
    if (!num) { setErr('Enter a Zambian mobile number: 097/077 (Airtel), 096/076 (MTN), 095/075 (Zamtel)'); return }
    setErr(null)
    setStep('ussd'); await wait(1100)
    setStep('pin'); await wait(1300)
    setStep('confirm'); await wait(900)
    try {
      let r: string
      if (live) {
        const res = await demoAction<{ payment: PaymentRow }>('pay_deposit', {
          vendor_ref: target!.vendorRef, amount_zmw: target!.amount, phone: num, network, ...(target!.paymentId ? { payment_id: target!.paymentId } : {}),
        })
        r = res.payment.receipt_id ?? 'EP-LSK-??????'
      } else {
        r = 'EP-LSK-' + Math.random().toString(36).slice(2, 8).toUpperCase()
        onLocalPaid(target!.paymentId, r, num, network)
      }
      setReceipt(r); setStep('done')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStep('error') }
  }

  const steps: Array<[Step, string]> = [
    ['ussd', `USSD push sent to ${e164 ?? phone} (${network === 'airtel' ? 'Airtel Money' : 'MTN MoMo'})`],
    ['pin', 'Payer enters PIN on handset…'],
    ['confirm', 'Elicate Pay confirming with network…'],
    ['done', 'Payment confirmed'],
  ]
  const order: Step[] = ['ussd', 'pin', 'confirm', 'done']

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm print:hidden" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Pay deposit via Elicate Pay</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </div>
        <p className="mt-1 text-sm text-zinc-400">{target.vendorName} · <b className="text-zinc-100">{formatZMWLong(target.amount)}</b></p>

        {step === 'form' || step === 'error' ? (
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void run() }}>
            <div className="grid grid-cols-2 gap-2">
              {(['airtel', 'mtn'] as const).map((n) => (
                <button type="button" key={n} onClick={() => setNetwork(n)}
                  className={`rounded-xl border px-3 py-3 text-sm font-semibold ${network === n ? (n === 'airtel' ? 'border-red-500 bg-red-950 text-red-200' : 'border-yellow-400 bg-yellow-950 text-yellow-200') : 'border-zinc-700 text-zinc-400'}`}>
                  {n === 'airtel' ? 'Airtel Money' : 'MTN MoMo'}
                </button>
              ))}
            </div>
            <label className="block text-xs text-zinc-400">Payer mobile number (+260)
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel"
                className={`mt-1 w-full rounded-lg border bg-zinc-950 px-3 py-2 font-mono text-sm outline-none ${e164 ? 'border-zinc-700 focus:border-emerald-500' : 'border-rose-600'}`} />
            </label>
            <p className="text-xs text-zinc-500">{e164 ? `${e164} · ${networkOf(e164)}` : 'Valid prefixes: 097 / 096 / 095 / 077 / 076 / 075'}</p>
            {err && <p className="rounded-lg bg-rose-950 p-2 text-xs text-rose-300">{err}</p>}
            <button disabled={!e164} className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">Send payment prompt</button>
          </form>
        ) : (
          <ol className="mt-5 space-y-3">
            {steps.map(([s, label]) => {
              const idx = order.indexOf(s), cur = order.indexOf(step)
              return (
                <li key={s} className={`flex items-center gap-3 text-sm ${idx <= cur ? 'text-zinc-100' : 'text-zinc-600'}`}>
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${idx < cur || step === 'done' ? 'bg-emerald-600' : idx === cur ? 'animate-pulse bg-amber-500' : 'bg-zinc-800'}`}>{idx < cur || step === 'done' ? '✓' : idx + 1}</span>
                  {label}
                </li>
              )
            })}
          </ol>
        )}
        {step === 'done' && receipt && (
          <div className="mt-5 rounded-xl border border-emerald-800 bg-emerald-950/60 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-emerald-400">Receipt</p>
            <p className="font-mono text-2xl font-black text-emerald-200">{receipt}</p>
            <p className="text-xs text-emerald-400">PAID · {formatZMWLong(target.amount)} · {formatCAT(new Date().toISOString())}</p>
            <button onClick={onClose} className="mt-3 rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-semibold">Done</button>
          </div>
        )}
        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-zinc-600">Simulated: no real money moves</p>
      </div>
    </div>
  )
}

export function payTargets(plan: Plan, vendors: VendorWithOrg[], payments: PaymentRow[]): PayTarget[] {
  return plan.vendor_assignments.flatMap((a) => {
    const v = vendors.find((x) => x.slug === a.vendor_ref)
    if (!v) return []
    const vp = payments.filter((p) => p.vendor_id === v.id)
    if (vp.some((p) => p.status === 'succeeded')) return []
    const pending = vp.find((p) => p.status === 'pending' || p.status === 'processing')
    return [{ vendorRef: a.vendor_ref, vendorName: a.vendor_name, amount: pending?.amount_zmw ?? a.deposit_zmw, paymentId: pending?.id }]
  })
}

export function CashflowTiles({ payments, guests, plan }: { payments: PaymentRow[]; guests: { gift_pledge_zmw: number | null; rsvp_status: string }[]; plan: Plan }) {
  const paid = payments.filter((p) => p.status === 'succeeded').reduce((s, p) => s + Number(p.amount_zmw), 0)
  const due = plan.vendor_assignments.reduce((s, a) => s + a.deposit_zmw, 0)
  const pledges = guests.filter((g) => g.rsvp_status !== 'declined').reduce((s, g) => s + Number(g.gift_pledge_zmw ?? 0), 0)
  const tiles = [
    { l: 'Deposits paid', v: paid, c: 'text-emerald-400' },
    { l: 'Deposits outstanding', v: Math.max(0, due - paid), c: due - paid > 0 ? 'text-amber-400' : 'text-emerald-400' },
    { l: 'Gift pledges', v: pledges, c: 'text-sky-400' },
    { l: 'Net cash need', v: Math.max(0, plan.cost_breakdown.total_zmw - paid - pledges), c: 'text-zinc-100' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.l} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t.l}</p>
          <p className={`text-xl font-bold tabular-nums transition-all ${t.c}`}>{formatZMWLong(t.v)}</p>
        </div>
      ))}
    </div>
  )
}
