// Mirrors the planner JSON contract in prompts/planner.md (keep in sync).
import type { MenuCategory, VendorCategory } from './database'

export type PlanMenuItem = {
  id: string
  name: string
  category: MenuCategory
  per_guest_qty: number | null
  per_guest_unit: string | null
  quantity: number
  unit: string
  unit_cost_zmw: number
  line_total_zmw: number
  vendor_ref: string | null
  notes: string | null
}

export type RunOfShowItem = { time: string; duration_min: number; item: string; owner: string; notes: string | null }

export type CostLineItem = {
  category: 'food' | 'drinks' | 'cake' | 'decor' | 'tents_chairs' | 'sound_dj' | 'mc' | 'photography' | 'transport' | 'venue' | 'other'
  description: string
  quantity: number
  unit: string
  unit_cost_zmw: number
  total_zmw: number
  vendor_ref: string | null
}

export type VendorAssignment = {
  vendor_ref: string
  vendor_name: string
  service: VendorCategory
  scope: string
  estimated_zmw: number
  deposit_pct: number
  deposit_zmw: number
  status: 'proposed' | 'requested' | 'confirmed'
}

export type PlanChange = { path: string; from: string | number | null; to: string | number | null; reason: string }

export type Plan = {
  version: '1.0'
  price_basis: 'example_estimate'
  event: {
    title: string
    event_type: 'kitchen_party' | 'wedding' | 'corporate' | 'birthday' | 'other'
    date: string | null
    start_time: string | null
    end_time: string | null
    area: string | null
    venue: string | null
    guest_count: number
    budget_zmw: number | null
  }
  menu: PlanMenuItem[]
  run_of_show: RunOfShowItem[]
  cost_breakdown: {
    currency: 'ZMW'
    line_items: CostLineItem[]
    subtotal_zmw: number
    contingency_pct: number
    contingency_zmw: number
    total_zmw: number
    budget_zmw: number | null
    variance_zmw: number | null
    per_guest_zmw: number
  }
  vendor_assignments: VendorAssignment[]
  assumptions: string[]
  warnings: string[]
  // null on initial plans
  revision_summary: string | null
  changes: PlanChange[] | null
}
