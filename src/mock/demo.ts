// Offline fallback built from the same source as supabase/seed.sql.
import type { EventRow, EventVendorRow, GuestRow, OrgRow, PaymentRow, VendorRow } from '../types/database'
import type { Plan } from '../types/plan'
import { DEMO } from './demo-data'
import woodlandsPlan from './woodlands-plan.json'

const now = new Date().toISOString()
const ts = { created_at: now, updated_at: now }

export const mockPlan = woodlandsPlan as Plan

export const mockHostOrg: OrgRow = { ...DEMO.hostOrg, type: 'host', city: 'Lusaka', ...ts }

export const mockEvent: EventRow = {
  id: DEMO.event.id, org_id: DEMO.hostOrg.id, is_demo: true, title: DEMO.event.title, event_type: 'kitchen_party', status: 'planning',
  starts_at: DEMO.event.starts_at, ends_at: DEMO.event.ends_at, venue: DEMO.event.venue, area: DEMO.event.area,
  guest_target: DEMO.event.guest_target, budget_zmw: DEMO.event.budget_zmw, brief: DEMO.event.brief,
  current_revision_id: DEMO.ids.revision1, created_by: DEMO.users[0].id, ...ts,
}

export type VendorWithOrg = VendorRow & { slug: string; area: string | null; booking?: EventVendorRow }

export const mockVendors: VendorWithOrg[] = DEMO.vendors.map((v) => {
  const assignment = mockPlan.vendor_assignments.find((a) => a.vendor_ref === v.org.slug)
  return {
    id: v.id, org_id: v.org.id, display_name: v.org.name, category: v.category as VendorRow['category'],
    service_areas: v.service_areas, whatsapp: v.org.phone, rating: v.rating, bio: v.bio, is_active: true, ...ts,
    slug: v.org.slug, area: v.org.area,
    booking: assignment && {
      id: `ev-${v.id}`, event_id: DEMO.event.id, org_id: DEMO.hostOrg.id, vendor_id: v.id, service: assignment.service,
      status: v.booking_status as EventVendorRow['status'], quoted_zmw: assignment.estimated_zmw, notes: assignment.scope, ...ts,
    },
  }
})

export const mockGuests: GuestRow[] = DEMO.guests.map((g) => ({
  ...g, rsvp_status: g.rsvp_status as GuestRow['rsvp_status'], event_id: DEMO.event.id, org_id: DEMO.hostOrg.id,
  gift_pledge_zmw: Number(g.id.slice(-12)) % 3 === 0 ? null : [100, 150, 200, 250, 300, 500][Number(g.id.slice(-12)) % 6],
  dietary_notes: null, checked_in_at: null, ...ts,
}))

const vendorIdBySlug = Object.fromEntries(DEMO.vendors.map((v) => [v.org.slug, v.id]))
export const mockPayments: PaymentRow[] = DEMO.payments.map((p) => ({
  id: p.id, event_id: DEMO.event.id, org_id: DEMO.hostOrg.id, vendor_id: vendorIdBySlug[p.vendor_ref], purpose: 'deposit',
  amount_zmw: p.amount_zmw, currency: 'ZMW', status: p.status as PaymentRow['status'], provider: 'elicate_pay',
  receipt_id: p.status === 'succeeded' ? 'EP-LSK-7Q2M4K' : null, invoice_number: null, provider_ref: p.provider_ref, payer_phone: p.payer_phone, payer_network: p.payer_network, raw_payload: null,
  paid_at: p.paid_at, created_by: DEMO.users[0].id, ...ts,
}))
