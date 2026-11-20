// Generated-style types for supabase/migrations/0001_init.sql.
// Regenerate against a real project with:
//   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Ts = string // timestamptz ISO string
type Table<Row, Required extends keyof Row> = {
  Row: Row
  Insert: Partial<Row> & Pick<Row, Required>
  Update: Partial<Row>
  Relationships: []
}

export type OrgType = 'host' | 'vendor'
export type MemberRole = 'owner' | 'admin' | 'staff'
export type EventType = 'kitchen_party' | 'wedding' | 'corporate' | 'birthday' | 'other'
export type EventStatus = 'draft' | 'planning' | 'confirmed' | 'completed' | 'cancelled'
export type VendorCategory = 'catering' | 'cake' | 'decor' | 'tents_chairs' | 'sound_dj' | 'mc' | 'photography' | 'transport' | 'drinks' | 'other'
export type MenuCategory = 'staple' | 'relish' | 'protein' | 'vegetable' | 'snack' | 'dessert' | 'cake' | 'drink' | 'other'
export type BookingStatus = 'proposed' | 'requested' | 'confirmed' | 'declined' | 'cancelled'
export type RsvpStatus = 'invited' | 'confirmed' | 'maybe' | 'declined'
export type PaymentPurpose = 'deposit' | 'balance' | 'vendor_payout' | 'other'
export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'cancelled'
export type RevisionKind = 'initial' | 'revision'

export type OrgRow = { id: string; type: OrgType; name: string; slug: string; phone: string | null; email: string | null; area: string | null; city: string; created_at: Ts; updated_at: Ts }
export type OrgMemberRow = { org_id: string; user_id: string; role: MemberRole; created_at: Ts; updated_at: Ts }
export type VendorRow = { id: string; org_id: string; display_name: string; category: VendorCategory; service_areas: string[]; whatsapp: string | null; rating: number | null; bio: string | null; is_active: boolean; created_at: Ts; updated_at: Ts }
export type VendorCatalogItemRow = { id: string; vendor_id: string; org_id: string; name: string; category: MenuCategory | null; unit: string; price_zmw: number; min_qty: number; serves: number | null; is_active: boolean; created_at: Ts; updated_at: Ts }
export type EventRow = { id: string; org_id: string; is_demo: boolean; title: string; event_type: EventType; status: EventStatus; starts_at: Ts | null; ends_at: Ts | null; venue: string | null; area: string | null; guest_target: number; budget_zmw: number | null; brief: string | null; current_revision_id: string | null; created_by: string | null; created_at: Ts; updated_at: Ts }
export type EventVendorRow = { id: string; event_id: string; org_id: string; vendor_id: string; service: VendorCategory; status: BookingStatus; quoted_zmw: number | null; notes: string | null; created_at: Ts; updated_at: Ts }
export type MenuItemRow = { id: string; event_id: string; org_id: string; vendor_id: string | null; name: string; category: MenuCategory; quantity: number; unit: string; per_guest: number | null; unit_cost_zmw: number | null; total_cost_zmw: number; notes: string | null; sort_order: number; created_at: Ts; updated_at: Ts }
export type GuestRow = { id: string; event_id: string; org_id: string; gift_pledge_zmw: number | null; full_name: string; phone: string | null; rsvp_status: RsvpStatus; party_size: number; guest_group: string | null; dietary_notes: string | null; checked_in_at: Ts | null; created_at: Ts; updated_at: Ts }
export type PaymentRow = { id: string; event_id: string; org_id: string; receipt_id: string | null; invoice_number: string | null; vendor_id: string | null; purpose: PaymentPurpose; amount_zmw: number; currency: 'ZMW'; status: PaymentStatus; provider: string; provider_ref: string | null; payer_phone: string | null; payer_network: string | null; raw_payload: Json | null; paid_at: Ts | null; created_by: string | null; created_at: Ts; updated_at: Ts }
export type PlanRevisionRow = { id: string; event_id: string; org_id: string; revision_no: number; kind: RevisionKind; instruction: string | null; plan: Json; guest_count: number | null; total_zmw: number | null; model: string | null; created_by: string | null; created_at: Ts; updated_at: Ts }
export type AgentBridgeStatus = 'pending' | 'accepted' | 'countered' | 'declined' | 'applied' | 'info'
export type AgentBridgeRow = { id: string; event_id: string; from_agent: string; to_agent: string; action_type: string; message: string | null; payload_json: Json; status: AgentBridgeStatus; created_at: Ts }
export type DispatchLogRow = { id: string; event_id: string; guest_id: string | null; channel: 'sms' | 'whatsapp'; provider: string; to_phone: string | null; to_name: string | null; message: string; status: 'queued' | 'sent' | 'failed'; simulated: boolean; created_at: Ts; sent_at: Ts | null }
export type AuditTrailRow = { id: string; event_id: string; actor: string; rule: string | null; action: string; detail: Json; created_at: Ts }
export type EventHeadcountRow = { event_id: string; org_id: string; guest_target: number; confirmed: number; maybe: number; pending: number; declined: number; invited_total: number }

export type Database = {
  public: {
    Tables: {
      orgs: Table<OrgRow, 'type' | 'name' | 'slug'>
      org_members: Table<OrgMemberRow, 'org_id' | 'user_id'>
      vendors: Table<VendorRow, 'org_id' | 'display_name' | 'category'>
      vendor_catalog_items: Table<VendorCatalogItemRow, 'vendor_id' | 'name' | 'unit' | 'price_zmw'>
      events: Table<EventRow, 'org_id' | 'title'>
      event_vendors: Table<EventVendorRow, 'event_id' | 'vendor_id' | 'service'>
      menu_items: Table<MenuItemRow, 'event_id' | 'name'>
      guests: Table<GuestRow, 'event_id' | 'full_name'>
      payments: Table<PaymentRow, 'event_id' | 'amount_zmw'>
      plan_revisions: Table<PlanRevisionRow, 'event_id' | 'plan'>
      dispatch_log: Table<DispatchLogRow, 'event_id' | 'message'>
      audit_trail: Table<AuditTrailRow, 'event_id' | 'action'>
      agent_bridge: Table<AgentBridgeRow, 'event_id' | 'from_agent' | 'to_agent' | 'action_type'>
    }
    Views: {
      event_headcount: { Row: EventHeadcountRow; Relationships: [] }
    }
    Functions: {
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      has_org_role: { Args: { p_org_id: string; p_roles: MemberRole[] }; Returns: boolean }
      is_event_vendor: { Args: { p_event_id: string }; Returns: boolean }
      vendor_view: { Args: { p_vendor_ref?: string }; Returns: Json }
      demo_action: { Args: { p_key: string; p_action: string; p_args?: Json }; Returns: Json }
      is_demo_event: { Args: { p_event_id: string }; Returns: boolean }
      bridge_list: { Args: { p_key: string; p_event_id?: string | null }; Returns: Json }
      bridge_post: { Args: { p_key: string; p_from_agent: string; p_to_agent: string; p_action_type: string; p_message?: string | null; p_payload?: Json; p_event_id?: string | null }; Returns: Json }
    }
    Enums: {
      org_type: OrgType
      member_role: MemberRole
      event_type: EventType
      event_status: EventStatus
      vendor_category: VendorCategory
      menu_category: MenuCategory
      booking_status: BookingStatus
      rsvp_status: RsvpStatus
      payment_purpose: PaymentPurpose
      payment_status: PaymentStatus
      revision_kind: RevisionKind
    }
    CompositeTypes: { [_ in never]: never }
  }
}
