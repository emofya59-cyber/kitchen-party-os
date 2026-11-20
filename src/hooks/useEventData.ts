import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuditTrailRow, DispatchLogRow, EventRow, EventVendorRow, GuestRow, PaymentRow, PlanRevisionRow, RsvpStatus } from '../types/database'
import type { Plan } from '../types/plan'
import { mockEvent, mockGuests, mockPayments, mockPlan, mockVendors, type VendorWithOrg } from '../mock/demo'
import { demoAction } from '../lib/api'

export type DataMode = 'offline' | 'live' | 'live-empty'

type Row = { id: string }
const upsert = <T extends Row>(prev: T[], row: T, front = true) =>
  prev.some((x) => x.id === row.id) ? prev.map((x) => (x.id === row.id ? row : x)) : front ? [row, ...prev] : [...prev, row]

export function useEventData() {
  const [mode, setMode] = useState<DataMode>(supabase ? 'live' : 'offline')
  const [event, setEvent] = useState<EventRow>(mockEvent)
  const [guests, setGuests] = useState<GuestRow[]>(mockGuests)
  const [payments, setPayments] = useState<PaymentRow[]>(mockPayments)
  const [vendors, setVendors] = useState<VendorWithOrg[]>(mockVendors)
  const [plan, setPlan] = useState<Plan>(mockPlan)
  const [dispatchLog, setDispatchLog] = useState<DispatchLogRow[]>([])
  const [audit, setAudit] = useState<AuditTrailRow[]>([])
  const [lastPulse, setLastPulse] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!supabase) return
    const sb = supabase
    let cancelled = false
    ;(async () => {
      const { data: ev } = await sb.from('events').select('*').order('starts_at', { ascending: true }).limit(1).maybeSingle()
      if (cancelled) return
      if (!ev) { setMode('live-empty'); return }
      setEvent(ev)
      const [g, p, vend, bookings, rev, dl, au] = await Promise.all([
        sb.from('guests').select('*').eq('event_id', ev.id).order('full_name'),
        sb.from('payments').select('*').eq('event_id', ev.id).order('created_at', { ascending: true }),
        sb.from('vendors').select('*, orgs!inner(slug, area)').eq('is_active', true),
        sb.from('event_vendors').select('*').eq('event_id', ev.id),
        ev.current_revision_id ? sb.from('plan_revisions').select('*').eq('id', ev.current_revision_id).maybeSingle() : Promise.resolve({ data: null }),
        sb.from('dispatch_log').select('*').eq('event_id', ev.id).order('created_at', { ascending: false }).limit(100),
        sb.from('audit_trail').select('*').eq('event_id', ev.id).order('created_at', { ascending: false }).limit(100),
      ])
      if (cancelled) return
      if (g.data) setGuests(g.data)
      if (p.data) setPayments(p.data)
      if (vend.data) {
        setVendors(
          (vend.data as unknown as Array<VendorWithOrg & { orgs: { slug: string; area: string | null } }>).map((v) => ({
            ...v, slug: v.orgs.slug, area: v.orgs.area, booking: bookings.data?.find((b) => b.vendor_id === v.id),
          })),
        )
      }
      const r = rev.data as PlanRevisionRow | null
      if (r?.plan) setPlan(r.plan as unknown as Plan)
      if (dl.data) setDispatchLog(dl.data)
      if (au.data) setAudit(au.data)
    })()
    return () => { cancelled = true }
  }, [reloadTick])

  useEffect(() => {
    if (!supabase || mode !== 'live') return
    const sb = supabase
    const f = `event_id=eq.${event.id}`
    const ch = sb
      .channel(`event-${event.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests', filter: f }, (msg) => {
        setLastPulse('guests:' + Date.now())
        if (msg.eventType === 'DELETE') return setGuests((prev) => prev.filter((x) => x.id !== (msg.old as GuestRow).id))
        setGuests((prev) => upsert(prev, msg.new as GuestRow, false))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: f }, (msg) => {
        setLastPulse('payments:' + Date.now())
        if (msg.eventType === 'DELETE') return setPayments((prev) => prev.filter((x) => x.id !== (msg.old as PaymentRow).id))
        setPayments((prev) => upsert(prev, msg.new as PaymentRow, false))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_vendors', filter: f }, (msg) => {
        const b = msg.new as EventVendorRow
        if (!b?.id) return
        setVendors((prev) => prev.map((v) => (v.id === b.vendor_id ? { ...v, booking: b } : v)))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_log', filter: f }, (msg) => {
        if (msg.eventType === 'DELETE') return setDispatchLog((prev) => prev.filter((x) => x.id !== (msg.old as DispatchLogRow).id))
        setDispatchLog((prev) => upsert(prev, msg.new as DispatchLogRow))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_trail', filter: f }, (msg) => {
        if (msg.eventType === 'DELETE') return setAudit((prev) => prev.filter((x) => x.id !== (msg.old as AuditTrailRow).id))
        setAudit((prev) => upsert(prev, msg.new as AuditTrailRow))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${event.id}` }, (msg) => {
        setEvent(msg.new as EventRow)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plan_revisions', filter: f }, (msg) => {
        setPlan((msg.new as PlanRevisionRow).plan as unknown as Plan)
      })
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [mode, event.id])

  const headcount = useMemo(() => {
    const sum = (s: RsvpStatus) => guests.filter((g) => g.rsvp_status === s).reduce((n, g) => n + g.party_size, 0)
    return { confirmed: sum('confirmed'), maybe: sum('maybe'), pending: sum('invited'), declined: sum('declined'), invited: guests.reduce((n, g) => n + g.party_size, 0), rows: guests.length }
  }, [guests])

  const live = mode === 'live'

  const setRsvp = useCallback(async (guestId: string, status: RsvpStatus) => {
    setGuests((prev) => prev.map((g) => (g.id === guestId ? { ...g, rsvp_status: status, updated_at: new Date().toISOString() } : g)))
    setLastPulse('guests:' + Date.now())
    if (live) await demoAction('set_rsvp', { guest_id: guestId, status }).catch(() => undefined)
  }, [live])

  const simulateRsvp = useCallback(() => {
    const pool = guests.filter((g) => g.rsvp_status === 'invited' || g.rsvp_status === 'maybe')
    if (!pool.length) return
    void setRsvp(pool[Math.floor(Math.random() * pool.length)].id, 'confirmed')
  }, [guests, setRsvp])

  /** Offline-only local mutations so every button still works without Supabase. */
  const local = {
    markPaid: (paymentId: string, receipt: string, phone: string, network: string) =>
      setPayments((prev) => prev.map((p) => (p.id === paymentId ? { ...p, status: 'succeeded', paid_at: new Date().toISOString(), receipt_id: receipt, payer_phone: phone, payer_network: network } : p))),
    addDispatch: (rows: DispatchLogRow[]) => setDispatchLog((prev) => [...rows, ...prev]),
    flushDispatch: () => setDispatchLog((prev) => prev.map((r) => (r.status === 'queued' ? { ...r, status: 'sent', sent_at: new Date().toISOString() } : r))),
    addAudit: (row: AuditTrailRow) => setAudit((prev) => [row, ...prev]),
    addGuest: (row: GuestRow) => { setGuests((prev) => [row, ...prev.filter((x) => x.id !== row.id)]); setLastPulse('guests:' + Date.now()) },
    replaceGuest: (tempId: string, row: GuestRow | null) => setGuests((prev) => (row ? [row, ...prev.filter((x) => x.id !== tempId && x.id !== row.id)] : prev.filter((x) => x.id !== tempId))),
  }

  const reset = useCallback(() => {
    setPlan(mockPlan); setGuests(mockGuests); setPayments(mockPayments); setVendors(mockVendors); setDispatchLog([]); setAudit([])
    setReloadTick((t) => t + 1)
  }, [])

  return { mode, live, event, guests, payments, vendors, plan, setPlan, headcount, setRsvp, simulateRsvp, lastPulse, dispatchLog, audit, local, reset }
}
