import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EventRow, GuestRow, PaymentRow, PlanRevisionRow, RsvpStatus } from '../types/database'
import type { Plan } from '../types/plan'
import { mockEvent, mockGuests, mockPayments, mockPlan, mockVendors, type VendorWithOrg } from '../mock/demo'

export type DataMode = 'offline' | 'live' | 'live-empty'

export function useEventData() {
  const [mode, setMode] = useState<DataMode>(supabase ? 'live' : 'offline')
  const [event, setEvent] = useState<EventRow>(mockEvent)
  const [guests, setGuests] = useState<GuestRow[]>(mockGuests)
  const [payments, setPayments] = useState<PaymentRow[]>(mockPayments)
  const [vendors, setVendors] = useState<VendorWithOrg[]>(mockVendors)
  const [plan, setPlan] = useState<Plan>(mockPlan)
  const [lastPulse, setLastPulse] = useState<string | null>(null)

  // Initial load (live mode)
  useEffect(() => {
    if (!supabase) return
    const sb = supabase
    let cancelled = false
    ;(async () => {
      const { data: ev } = await sb.from('events').select('*').order('starts_at', { ascending: true }).limit(1).maybeSingle()
      if (cancelled) return
      if (!ev) { setMode('live-empty'); return } // not signed in, or no events: keep the mock data visible
      setEvent(ev)
      const [g, p, vend, bookings, rev] = await Promise.all([
        sb.from('guests').select('*').eq('event_id', ev.id).order('full_name'),
        sb.from('payments').select('*').eq('event_id', ev.id).order('created_at', { ascending: false }),
        sb.from('vendors').select('*, orgs!inner(slug, area)').eq('is_active', true),
        sb.from('event_vendors').select('*').eq('event_id', ev.id),
        ev.current_revision_id ? sb.from('plan_revisions').select('*').eq('id', ev.current_revision_id).maybeSingle() : Promise.resolve({ data: null }),
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
    })()
    return () => { cancelled = true }
  }, [])

  // Realtime: guests, payments, events, plan_revisions
  useEffect(() => {
    if (!supabase || mode !== 'live') return
    const sb = supabase
    const ch = sb
      .channel(`event-${event.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests', filter: `event_id=eq.${event.id}` }, (msg) => {
        setLastPulse('guests')
        setGuests((prev) => {
          if (msg.eventType === 'DELETE') return prev.filter((x) => x.id !== (msg.old as GuestRow).id)
          const row = msg.new as GuestRow
          return prev.some((x) => x.id === row.id) ? prev.map((x) => (x.id === row.id ? row : x)) : [...prev, row]
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `event_id=eq.${event.id}` }, (msg) => {
        setLastPulse('payments')
        const row = msg.new as PaymentRow
        if (!row?.id) return
        setPayments((prev) => (prev.some((x) => x.id === row.id) ? prev.map((x) => (x.id === row.id ? row : x)) : [row, ...prev]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${event.id}` }, (msg) => {
        setLastPulse('event')
        setEvent(msg.new as EventRow)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plan_revisions', filter: `event_id=eq.${event.id}` }, (msg) => {
        setLastPulse('plan')
        setPlan((msg.new as PlanRevisionRow).plan as unknown as Plan)
      })
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [mode, event.id])

  const headcount = useMemo(() => {
    const sum = (s: RsvpStatus) => guests.filter((g) => g.rsvp_status === s).reduce((n, g) => n + g.party_size, 0)
    return { confirmed: sum('confirmed'), maybe: sum('maybe'), pending: sum('invited'), declined: sum('declined'), invited: guests.reduce((n, g) => n + g.party_size, 0), rows: guests.length }
  }, [guests])

  const setRsvp = useCallback(async (guestId: string, status: RsvpStatus) => {
    setGuests((prev) => prev.map((g) => (g.id === guestId ? { ...g, rsvp_status: status } : g))) // optimistic
    setLastPulse('guests')
    if (supabase && mode === 'live') await supabase.from('guests').update({ rsvp_status: status }).eq('id', guestId)
  }, [mode])

  /** Demo button: confirm a random pending/maybe guest (in live mode this writes to Supabase → Realtime). */
  const simulateRsvp = useCallback(() => {
    const pool = guests.filter((g) => g.rsvp_status === 'invited' || g.rsvp_status === 'maybe')
    if (!pool.length) return
    void setRsvp(pool[Math.floor(Math.random() * pool.length)].id, 'confirmed')
  }, [guests, setRsvp])

  /** Offline only: pretend the Elicate webhook marked a pending deposit as paid. */
  const simulateDepositPaid = useCallback((paymentId: string) => {
    setPayments((prev) => prev.map((p) => (p.id === paymentId ? { ...p, status: 'succeeded', paid_at: new Date().toISOString() } : p)))
    setLastPulse('payments')
  }, [])

  return { mode, event, guests, payments, vendors, plan, setPlan, headcount, setRsvp, simulateRsvp, simulateDepositPaid, lastPulse }
}
