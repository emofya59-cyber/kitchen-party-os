// Custom event builder: form fields -> brief sentence, Grok payload, and a fully dynamic offline plan.
import type { CostLineItem, Plan, PlanMenuItem, RunOfShowItem } from '../types/plan'
import type { MenuCategory } from '../types/database'

export type EventFields = { title: string; location: string; dateTime: string; guests: number; budget: number; food: string }

export const DEFAULT_FIELDS: EventFields = {
  title: "Mutale's Kitchen Party",
  location: 'Woodlands, Lusaka',
  dateTime: 'Sat 5 Dec, 14:00',
  guests: 120,
  budget: 25000,
  food: 'nshima, village chicken, kapenta, ifisashi, impwa, chikanda, cake',
}

export const isDefaultFields = (f: EventFields) =>
  (Object.keys(DEFAULT_FIELDS) as (keyof EventFields)[]).every((k) => String(f[k]).trim() === String(DEFAULT_FIELDS[k]))

const CATERER = { ref: 'ba-mwapes-kitchen', name: "Ba Mwape's Kitchen" }
const TENTS = { ref: 'roma-tents-decor', name: 'Roma Tents & Decor' }

export const eventType = (title: string): Plan['event']['event_type'] => {
  const t = title.toLowerCase()
  return t.includes('kitchen') ? 'kitchen_party' : t.includes('wedding') ? 'wedding' : t.includes('birthday') ? 'birthday'
    : /corporate|launch|conference|office|company|ltd/.test(t) ? 'corporate' : 'other'
}
const typeLabel = (t: Plan['event']['event_type']) => ({ kitchen_party: 'kitchen party', wedding: 'wedding', birthday: 'birthday party', corporate: 'corporate event', other: 'event' })[t]

/** "Sat 5 Dec, 14:00" | "2026-12-05 14:00" | "5 December 2026 3pm" -> { date, time, iso } (Lusaka, UTC+2) */
export function parseDateTime(s: string): { date: string; time: string; iso: string } {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const t = s.toLowerCase()
  let y: number | null = null, mo: number | null = null, d: number | null = null
  const iso = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) { y = +iso[1]; mo = +iso[2] - 1; d = +iso[3] }
  else {
    const m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*/) ?? null
    const m2 = t.match(/([a-z]{3})[a-z]*\s+(\d{1,2})(?!\d|:)/)
    if (m && months.includes(m[2])) { d = +m[1]; mo = months.indexOf(m[2]) }
    else if (m2 && months.includes(m2[1])) { d = +m2[2]; mo = months.indexOf(m2[1]) }
    const yy = t.match(/\b(20\d{2})\b/); if (yy) y = +yy[1]
  }
  if (mo == null || d == null || d < 1 || d > 31) { mo = 11; d = 5 }
  if (y == null) y = mo >= 10 ? 2026 : 2027
  let hh = 14, mm = 0
  const tm = t.match(/(\d{1,2})[:h.](\d{2})\s*(am|pm)?/) ?? t.match(/\b(\d{1,2})\s*(am|pm)\b/)
  if (tm) {
    hh = +tm[1]; mm = tm[2] && /^\d+$/.test(tm[2]) ? +tm[2] : 0
    const ap = tm[3] ?? (tm[2] && !/^\d+$/.test(tm[2]) ? tm[2] : undefined)
    if (ap === 'pm' && hh < 12) hh += 12
    if (ap === 'am' && hh === 12) hh = 0
    if (hh > 23 || mm > 59) { hh = 14; mm = 0 }
  }
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${y}-${p(mo + 1)}-${p(d)}`, time = `${p(hh)}:${p(mm)}`
  return { date, time, iso: `${date}T${time}:00+02:00` }
}

const zmw = (n: number) => `ZMW ${Math.round(n).toLocaleString('en-ZM')}`

export function briefFromFields(f: EventFields): string {
  const t = typeLabel(eventType(f.title))
  return `${f.guests} guests, ${t} "${f.title}" in ${f.location} on ${f.dateTime}, budget ${zmw(f.budget)}, menu: ${f.food}`
}

export const grokEventPayload = (f: EventFields) => {
  const dt = parseDateTime(f.dateTime)
  return { title: f.title, location: f.location, area: areaOf(f.location), date: dt.date, start_time: dt.time, date_time_text: f.dateTime, guest_count: f.guests, budget_zmw: f.budget, food_preferences: f.food }
}

const areaOf = (loc: string) => (loc.split(',')[0] || loc).trim() || 'Lusaka'

// Lusaka example-estimate price table (ZMW per guest portion), NOT quotes.
type Dish = { match: RegExp; name: string; category: MenuCategory; unit: string; cost: number; notes: string | null }
const DISHES: Dish[] = [
  { match: /nshima|mealie|maize/, name: 'Nshima (white maize)', category: 'staple', unit: 'plate', cost: 12, notes: 'Roughly 0.2 kg mealie meal per guest.' },
  { match: /village chicken|chicken/, name: 'Village chicken (stewed)', category: 'protein', unit: 'portion', cost: 45, notes: 'About 1 bird per 6 guests.' },
  { match: /beef|stew/, name: 'Beef stew', category: 'protein', unit: 'portion', cost: 38, notes: 'About 150 g beef per guest.' },
  { match: /goat/, name: 'Goat meat (stewed)', category: 'protein', unit: 'portion', cost: 45, notes: null },
  { match: /bream|fish|tilapia/, name: 'Fried bream (fish)', category: 'protein', unit: 'portion', cost: 50, notes: null },
  { match: /sausage|boerewors|wors/, name: 'Boerewors (braai sausage)', category: 'protein', unit: 'portion', cost: 25, notes: null },
  { match: /rice/, name: 'Rice (plain)', category: 'staple', unit: 'portion', cost: 10, notes: 'About 80 g uncooked rice per guest.' },
  { match: /kapenta/, name: 'Kapenta with tomato & onion', category: 'relish', unit: 'portion', cost: 20, notes: 'Siavonga kapenta, ~40 g dried per guest.' },
  { match: /ifisashi|groundnut/, name: 'Ifisashi (greens in groundnut sauce)', category: 'relish', unit: 'portion', cost: 15, notes: 'Pumpkin leaves (chibwabwa) or rape.' },
  { match: /impwa|garden egg/, name: 'Impwa (garden eggs) with tomato', category: 'vegetable', unit: 'portion', cost: 12, notes: null },
  { match: /chikanda|polony/, name: 'Chikanda (African polony) slices', category: 'snack', unit: 'slice', cost: 10, notes: 'Served with welcome drinks.' },
  { match: /chibwabwa|pumpkin leaves/, name: 'Chibwabwa (pumpkin leaves)', category: 'vegetable', unit: 'portion', cost: 10, notes: null },
  { match: /braised greens|greens|rape|spinach|cabbage|vegetable/, name: 'Braised greens (rape)', category: 'vegetable', unit: 'portion', cost: 10, notes: null },
  { match: /bean/, name: 'Beans relish', category: 'relish', unit: 'portion', cost: 10, notes: null },
  { match: /salad|coleslaw/, name: 'Garden salad', category: 'vegetable', unit: 'portion', cost: 10, notes: null },
  { match: /samoosa|samosa/, name: 'Samoosas', category: 'snack', unit: 'piece', cost: 8, notes: null },
  { match: /cake/, name: 'Celebration cake (sliced)', category: 'cake', unit: 'slice', cost: 22, notes: null },
  { match: /drink|soda|juice|maheu|water|mineral/, name: 'Soft drinks, Maheu & water', category: 'drink', unit: 'set', cost: 15, notes: 'Two 500 ml drinks per guest.' },
]
const titleCase = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'

export function parseFood(food: string, guests: number): PlanMenuItem[] {
  const parts = food.split(/,|\+|;|\n|&|\band\b/i).map((p) => p.trim()).filter(Boolean)
  const seen = new Set<string>()
  const out: PlanMenuItem[] = []
  for (const raw of parts) {
    const low = raw.toLowerCase()
    const d = DISHES.find((x) => x.match.test(low))
    const name = d ? d.name : titleCase(raw).slice(0, 80)
    if (seen.has(name)) continue
    seen.add(name)
    const isCake = d?.category === 'cake'
    const qty = isCake ? Math.ceil(guests * 1.05) : guests
    const unit = d?.unit ?? 'portion'
    const cost = d?.cost ?? 18
    const notes = isCake ? `About ${qty} slices (${guests <= 60 ? '2' : guests <= 150 ? '3' : '4'}-tier); 5% buffer.` : d?.notes ?? 'Example estimate: ZMW 18 per guest portion (dish not in price table).'
    out.push({ id: slug(name), name, category: d?.category ?? 'other', per_guest_qty: isCake ? 1.05 : 1, per_guest_unit: unit, quantity: qty, unit, unit_cost_zmw: cost, line_total_zmw: qty * cost, vendor_ref: CATERER.ref, notes })
  }
  return out.slice(0, 40)
}

const addMin = (hhmm: string, mins: number) => {
  const [h, m] = hhmm.split(':').map(Number)
  const t = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + mins))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Deterministic, instant plan for any custom event. Prices are example estimates. */
export function buildOfflinePlan(f: EventFields): Plan {
  const guests = Math.max(1, Math.round(f.guests))
  const budget = f.budget > 0 ? Math.round(f.budget) : null
  const dt = parseDateTime(f.dateTime)
  const type = eventType(f.title)
  const area = areaOf(f.location)
  const menu = parseFood(f.food || 'nshima, beef stew, braised greens', guests)
  const food = menu.filter((m) => m.category !== 'drink' && m.category !== 'cake')
  const drinks = menu.filter((m) => m.category === 'drink')
  const cake = menu.filter((m) => m.category === 'cake')
  const perGuestFood = food.reduce((s, m) => s + m.unit_cost_zmw, 0)
  const lines: CostLineItem[] = []
  if (food.length) lines.push({ category: 'food', description: `Catering: ${food.map((m) => m.name.split(' (')[0].toLowerCase()).join(', ')}`, quantity: guests, unit: 'guest', unit_cost_zmw: perGuestFood, total_zmw: guests * perGuestFood, vendor_ref: CATERER.ref })
  for (const d of drinks) lines.push({ category: 'drinks', description: d.name, quantity: d.quantity, unit: d.unit, unit_cost_zmw: d.unit_cost_zmw, total_zmw: d.line_total_zmw, vendor_ref: CATERER.ref })
  for (const c of cake) lines.push({ category: 'cake', description: c.name, quantity: c.quantity, unit: c.unit, unit_cost_zmw: c.unit_cost_zmw, total_zmw: c.line_total_zmw, vendor_ref: CATERER.ref })
  const decor = guests <= 60 ? 1800 : guests <= 150 ? 2800 : 4200
  lines.push({ category: 'tents_chairs', description: 'Chairs with covers', quantity: guests, unit: 'chair', unit_cost_zmw: 15, total_zmw: guests * 15, vendor_ref: TENTS.ref })
  lines.push({ category: 'decor', description: `${titleCase(typeLabel(type))} decor package (gazebo, chitenge drapes)`, quantity: 1, unit: 'package', unit_cost_zmw: decor, total_zmw: decor, vendor_ref: TENTS.ref })
  const subtotal = lines.reduce((s, l) => s + l.total_zmw, 0)
  const contingency = Math.round(subtotal * 0.05)
  const total = subtotal + contingency
  const catererEst = lines.filter((l) => l.vendor_ref === CATERER.ref).reduce((s, l) => s + l.total_zmw, 0)
  const tentsEst = lines.filter((l) => l.vendor_ref === TENTS.ref).reduce((s, l) => s + l.total_zmw, 0)
  const lines2 = Math.max(1, Math.ceil(guests / 60))
  const T = dt.time
  const kp = type === 'kitchen_party'
  const ros: RunOfShowItem[] = [
    { time: addMin(T, -240), duration_min: 120, item: 'Tent, chairs & decor set-up', owner: TENTS.name, notes: `${guests} chairs at ${f.location}.` },
    { time: addMin(T, -120), duration_min: 90, item: 'Catering arrives, cooking starts on site', owner: CATERER.name, notes: 'Charcoal braziers set up behind the venue.' },
    ...(cake.length ? [{ time: addMin(T, -30), duration_min: 30, item: 'Cake delivery & placement', owner: CATERER.name, notes: null }] : []),
    { time: T, duration_min: 30, item: 'Guests arrive, welcome drinks', owner: 'Host family', notes: 'Ushers at the gate with the RSVP list.' },
    { time: addMin(T, 30), duration_min: 15, item: 'Opening prayer & welcome by the MC', owner: 'Host family', notes: null },
    { time: addMin(T, 45), duration_min: 30, item: kp ? "Bride's entrance (covered), dancing" : 'Opening programme & speeches', owner: 'Host family', notes: null },
    { time: addMin(T, 75), duration_min: 60, item: `Lunch served (buffet): ${food.slice(0, 3).map((m) => m.name.split(' (')[0].toLowerCase()).join(', ') || 'meal'}`, owner: CATERER.name, notes: `${lines2} serving line${lines2 > 1 ? 's' : ''}, ~${Math.ceil(guests / lines2)} guests each.` },
    { time: addMin(T, 135), duration_min: 60, item: kp ? 'Advice from the aunties & gift presentation' : 'Gifts, toasts & presentations', owner: 'Host family', notes: null },
    ...(cake.length ? [{ time: addMin(T, 195), duration_min: 30, item: kp ? "Groom's surprise arrival, cake cutting" : 'Cake cutting', owner: 'Host family', notes: null }] : []),
    { time: addMin(T, 225), duration_min: 75, item: 'Dancing, photos, close', owner: 'Host family', notes: `Teardown starts at ${addMin(T, 300)}.` },
  ]
  const warnings: string[] = []
  if (budget != null && total > budget) warnings.push(`Over budget by ${zmw(total - budget)}. Swap village chicken for beef stew or trim the decor package to save.`)
  else if (budget != null && budget - total < budget * 0.05) warnings.push(`Only ${zmw(budget - total)} of headroom is left; extra guests will push the plan over budget.`)
  const unknown = menu.filter((m) => m.category === 'other').map((m) => m.name)
  return {
    version: '1.0', price_basis: 'example_estimate',
    event: { title: f.title.trim() || 'Custom event', event_type: type, date: dt.date, start_time: dt.time, end_time: addMin(T, 300), area, venue: f.location.trim() || area, guest_count: guests, budget_zmw: budget },
    menu,
    run_of_show: ros,
    cost_breakdown: { currency: 'ZMW', line_items: lines, subtotal_zmw: subtotal, contingency_pct: 5, contingency_zmw: contingency, total_zmw: total, budget_zmw: budget, variance_zmw: budget == null ? null : budget - total, per_guest_zmw: Math.round((total / guests) * 100) / 100 },
    vendor_assignments: [
      { vendor_ref: CATERER.ref, vendor_name: CATERER.name, service: 'catering', scope: `All food${drinks.length ? ' & drinks' : ''}${cake.length ? ' & cake' : ''} for ${guests} guests, ${lines2} serving line${lines2 > 1 ? 's' : ''}`, estimated_zmw: catererEst, deposit_pct: 30, deposit_zmw: Math.round(catererEst * 0.3), status: 'proposed' },
      { vendor_ref: TENTS.ref, vendor_name: TENTS.name, service: 'tents_chairs', scope: `${guests} chairs with covers, decor package, set-up & teardown`, estimated_zmw: tentsEst, deposit_pct: 30, deposit_zmw: Math.round(tentsEst * 0.3), status: 'proposed' },
    ],
    assumptions: [
      'All prices are EXAMPLE ESTIMATES for planning only; they are not vendor quotes.',
      `${guests} guests (adults); children under 5 are not catered separately.`,
      `Venue: ${f.location}; power and water are available for the caterer.`,
      ...(unknown.length ? [`No price-table match for ${unknown.join(', ')}: estimated at ZMW 18 per guest.`] : []),
      '5% contingency is held back for price swings at market (Soweto/City Market).',
    ],
    warnings,
    revision_summary: null,
    changes: null,
  }
}

const MENU_CATS = new Set(['staple', 'relish', 'protein', 'vegetable', 'snack', 'dessert', 'cake', 'drink', 'other'])
const KNOWN_VENDORS = new Set(['ba-mwapes-kitchen', 'chanda-cakes', 'roma-tents-decor'])

/** demo_action('custom_event') args from a plan (Grok or offline). */
export function customEventArgs(plan: Plan, f: EventFields, brief: string, model: string) {
  const dt = parseDateTime(f.dateTime)
  const cat = plan.vendor_assignments.find((a) => a.vendor_ref === CATERER.ref)
  const items = plan.menu.slice(0, 40).map((m) => ({
    name: m.name, category: MENU_CATS.has(m.category) ? m.category : 'other', quantity: m.quantity, unit: m.unit,
    per_guest: m.per_guest_qty, unit_cost_zmw: m.unit_cost_zmw, notes: m.notes,
    vendor_ref: m.vendor_ref && KNOWN_VENDORS.has(m.vendor_ref) ? m.vendor_ref : CATERER.ref,
  }))
  const catTotal = cat?.estimated_zmw ?? items.filter((i) => i.vendor_ref === CATERER.ref).reduce((s, i) => s + i.quantity * i.unit_cost_zmw, 0)
  return {
    title: f.title.trim(), location: f.location.trim(), area: areaOf(f.location), starts_at: dt.iso, guest_count: f.guests, budget_zmw: f.budget, brief,
    items, caterer_total: Math.round(catTotal), caterer_deposit: cat?.deposit_zmw ?? Math.round(catTotal * 0.3),
    caterer_scope: cat?.scope ?? `All food & drinks for ${f.guests} guests`, plan, model,
  }
}
