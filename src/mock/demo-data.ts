// Single source of truth for Lusaka demo data (seed.sql + offline frontend mock).
// All names/phones are fictional. Prices are EXAMPLE ESTIMATES.
export const ids = {
  hostOrg: 'a0000000-0000-4000-8000-000000000001',
  event: 'e0000000-0000-4000-8000-000000000001',
  revision1: 'd0000000-0000-4000-8000-000000000001',
}

export const users = [
  { id: 'c0000000-0000-4000-8000-000000000001', email: 'natasha.mwansa@demo.kpos.zm', name: 'Natasha Mwansa', org_id: ids.hostOrg },
  { id: 'c0000000-0000-4000-8000-000000000002', email: 'mwape.zulu@demo.kpos.zm', name: 'Mwape Zulu', org_id: 'a0000000-0000-4000-8000-000000000002' },
  { id: 'c0000000-0000-4000-8000-000000000003', email: 'chanda.phiri@demo.kpos.zm', name: 'Chanda Phiri', org_id: 'a0000000-0000-4000-8000-000000000003' },
  { id: 'c0000000-0000-4000-8000-000000000004', email: 'mulenga.banda@demo.kpos.zm', name: 'Mulenga Banda', org_id: 'a0000000-0000-4000-8000-000000000004' },
]

export const hostOrg = { id: ids.hostOrg, type: 'host', name: 'Mwansa Family Events', slug: 'mwansa-family', phone: '+260977123456', email: 'natasha.mwansa@demo.kpos.zm', area: 'Woodlands' }

export const vendors = [
  {
    id: 'b0000000-0000-4000-8000-000000000002', category: 'catering', rating: 4.8, booking_status: 'confirmed',
    service_areas: ['Chelston', 'Woodlands', 'Kabulonga', 'Roma', 'Avondale'],
    bio: 'Traditional Zambian catering for kitchen parties and weddings since 2014.',
    org: { id: 'a0000000-0000-4000-8000-000000000002', type: 'vendor', name: "Ba Mwape's Kitchen", slug: 'ba-mwapes-kitchen', phone: '+260966234567', email: 'mwape.zulu@demo.kpos.zm', area: 'Chelston' },
    catalog: [
      { name: 'Nshima (white maize)', category: 'staple', unit: 'plate', price_zmw: 12, min_qty: 50 },
      { name: 'Village chicken (stewed)', category: 'protein', unit: 'portion', price_zmw: 45, min_qty: 30 },
      { name: 'Beef stew', category: 'protein', unit: 'portion', price_zmw: 40, min_qty: 30 },
      { name: 'Kapenta with tomato & onion', category: 'relish', unit: 'portion', price_zmw: 20, min_qty: 30 },
      { name: 'Ifisashi (greens in groundnut sauce)', category: 'relish', unit: 'portion', price_zmw: 15, min_qty: 30 },
      { name: 'Impwa (garden eggs) with tomato', category: 'vegetable', unit: 'portion', price_zmw: 12, min_qty: 30 },
      { name: 'Chikanda (African polony) slices', category: 'snack', unit: 'slice', price_zmw: 10, min_qty: 50 },
      { name: 'Soft drinks, Maheu & water', category: 'drink', unit: 'set', price_zmw: 15, min_qty: 50 },
    ],
  },
  {
    id: 'b0000000-0000-4000-8000-000000000003', category: 'cake', rating: 4.9, booking_status: 'requested',
    service_areas: ['Kabulonga', 'Woodlands', 'Rhodes Park', 'Ibex Hill'],
    bio: 'Custom celebration cakes and cupcakes, Kabulonga.',
    org: { id: 'a0000000-0000-4000-8000-000000000003', type: 'vendor', name: 'Chanda Cakes & Bakes', slug: 'chanda-cakes', phone: '+260955345678', email: 'chanda.phiri@demo.kpos.zm', area: 'Kabulonga' },
    catalog: [
      { name: '3-tier celebration cake', category: 'cake', unit: 'cake', price_zmw: 2800, serves: 130 },
      { name: '2-tier cake', category: 'cake', unit: 'cake', price_zmw: 1800, serves: 80 },
      { name: 'Cupcakes (dozen)', category: 'dessert', unit: 'dozen', price_zmw: 300, serves: 12 },
    ],
  },
  {
    id: 'b0000000-0000-4000-8000-000000000004', category: 'tents_chairs', rating: 4.6, booking_status: 'proposed',
    service_areas: ['Roma', 'Woodlands', 'Chelston', 'Kalundu', 'Kabulonga'],
    bio: 'Tents, chairs, chitenge drapes and kitchen-party decor.',
    org: { id: 'a0000000-0000-4000-8000-000000000004', type: 'vendor', name: 'Roma Tents & Decor', slug: 'roma-tents-decor', phone: '+260976456789', email: 'mulenga.banda@demo.kpos.zm', area: 'Roma' },
    catalog: [
      { name: 'Chair with cover', category: null, unit: 'chair', price_zmw: 15, min_qty: 50 },
      { name: '100-seater tent (per day)', category: null, unit: 'day', price_zmw: 2500 },
      { name: 'Kitchen party decor package', category: null, unit: 'package', price_zmw: 2800 },
    ],
  },
]

export const event = {
  id: ids.event,
  title: "Mutale's Kitchen Party",
  starts_at: '2026-12-05T14:00:00+02:00',
  ends_at: '2026-12-05T19:00:00+02:00',
  venue: 'Family home, Woodlands, Lusaka',
  area: 'Woodlands',
  guest_target: 120,
  budget_zmw: 25000,
  brief: '120 guests, kitchen party in Woodlands on Sat 5 Dec, budget ZMW 25,000, nshima + 3 relishes + cake',
}

const first = ['Mutinta', 'Chileshe', 'Bwalya', 'Mwila', 'Thandiwe', 'Mapalo', 'Chipo', 'Musonda', 'Namakau', 'Kabwe', 'Nkandu', 'Towela', 'Luyando', 'Inonge', 'Chilufya', 'Mwaka', 'Precious', 'Memory', 'Charity', 'Mercy', 'Ruth', 'Agness', 'Beatrice', 'Natasha']
const last = ['Banda', 'Phiri', 'Mwale', 'Zulu', 'Tembo', 'Mulenga', 'Chanda', 'Lungu', 'Daka', 'Ngoma', 'Sakala', 'Mumba', 'Chirwa', 'Kapembwa', 'Musonda', 'Simwanza']
const prefixes = ['97', '96', '76', '77', '95'] // Airtel / MTN / Zamtel style prefixes
const groups = ["Bride's family", "Groom's family", 'Church (UCZ)', 'Friends', 'Work']
const statusCycle = ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'invited', 'invited', 'maybe', 'declined']

// 48 rows, party sizes cycle 1..4, so they sum to exactly 120 people
export const guests = Array.from({ length: 48 }, (_, i) => ({
  id: `f0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  full_name: `${i % 7 === 0 ? 'Mrs ' : ''}${first[i % first.length]} ${last[(i * 5) % last.length]}`,
  phone: `+260${prefixes[i % prefixes.length]}${String(1000000 + ((i * 7919) % 8999999)).padStart(7, '0')}`,
  rsvp_status: statusCycle[i % statusCycle.length],
  party_size: (i % 4) + 1,
  guest_group: groups[i % groups.length],
}))

export const payments = [
  { id: '90000000-0000-4000-8000-000000000001', vendor_ref: 'ba-mwapes-kitchen', amount_zmw: 4644, status: 'succeeded', provider_ref: 'DEMO-ELICATE-0001', payer_phone: '+260977123456', payer_network: 'airtel', paid_at: '2026-11-18T10:15:00+02:00' },
  { id: '90000000-0000-4000-8000-000000000002', vendor_ref: 'chanda-cakes', amount_zmw: 1400, status: 'pending', provider_ref: 'DEMO-ELICATE-0002', payer_phone: '+260977123456', payer_network: 'airtel', paid_at: null },
]

export const DEMO = { ids, users, hostOrg, vendors, event, guests, payments }
