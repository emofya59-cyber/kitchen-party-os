// Deterministic local revision used in offline demo mode (and as a sanity check
// on Grok's math). Handles headcount deltas such as "15 extra guests" / "minus 10 guests".
import type { Plan, PlanChange } from '../types/plan'

export function parseHeadcountDelta(text: string): number | null {
  const t = text.toLowerCase()
  const m = t.match(/([+-]?\d+)\s*(extra|more|additional|less|fewer)?\s*(guests?|people|pax)/)
  if (!m) return null
  let n = parseInt(m[1], 10)
  if (/(less|fewer|minus|cancel|drop)/.test(t) || m[2] === 'less' || m[2] === 'fewer') n = -Math.abs(n)
  return n
}

const CAKE_SERVES = 130 // matches demo catalog: 3-tier cake serves ~130
const CUPCAKE_DOZEN_ZMW = 300

export function reviseHeadcount(prev: Plan, delta: number): Plan {
  const from = prev.event.guest_count
  const to = Math.max(1, from + delta)
  const changes: PlanChange[] = [{ path: 'event.guest_count', from, to, reason: `${delta > 0 ? '+' : ''}${delta} guests` }]
  const plan: Plan = structuredClone(prev)
  plan.event.guest_count = to

  plan.menu = plan.menu.map((m) => {
    if (m.per_guest_qty == null) return m
    const quantity = Math.ceil(to * m.per_guest_qty)
    const line_total_zmw = quantity * m.unit_cost_zmw
    if (quantity !== m.quantity) changes.push({ path: `menu[${m.id}].quantity`, from: m.quantity, to: quantity, reason: 'scaled to headcount' })
    return { ...m, quantity, line_total_zmw }
  })

  const warnings = prev.warnings.filter((w) => !w.toLowerCase().includes('headroom') && !w.toLowerCase().includes('over budget'))
  const cupcakesNeeded = Math.max(0, Math.ceil((to - CAKE_SERVES) / 12))
  plan.menu = plan.menu.filter((m) => m.id !== 'cupcakes')
  if (cupcakesNeeded > 0) {
    plan.menu.push({
      id: 'cupcakes', name: 'Cupcakes (top-up for cake)', category: 'dessert', per_guest_qty: null, per_guest_unit: null,
      quantity: cupcakesNeeded, unit: 'dozen', unit_cost_zmw: CUPCAKE_DOZEN_ZMW, line_total_zmw: cupcakesNeeded * CUPCAKE_DOZEN_ZMW,
      vendor_ref: 'chanda-cakes', notes: `Cake serves ~${CAKE_SERVES}; adds ${cupcakesNeeded * 12} portions.`,
    })
    changes.push({ path: 'menu[cupcakes]', from: null, to: `${cupcakesNeeded} dozen`, reason: `cake serves ~${CAKE_SERVES} < ${to} guests` })
  }

  const sumMenu = (pred: (cat: string) => boolean) =>
    plan.menu.filter((m) => pred(m.category)).reduce((s, m) => s + m.line_total_zmw, 0)
  const foodTotal = sumMenu((c) => !['drink', 'cake', 'dessert'].includes(c))
  const drinksTotal = sumMenu((c) => c === 'drink')
  const cakeTotal = sumMenu((c) => c === 'cake' || c === 'dessert')

  const cb = plan.cost_breakdown
  cb.line_items = cb.line_items.map((li) => {
    let next = li
    if (li.category === 'food') next = { ...li, quantity: to, unit_cost_zmw: Math.round((foodTotal / to) * 100) / 100, total_zmw: foodTotal }
    else if (li.category === 'drinks') next = { ...li, quantity: to, total_zmw: drinksTotal }
    else if (li.category === 'cake') next = { ...li, description: cupcakesNeeded ? `${li.description.replace(/ \+ cupcakes.*/, '')} + cupcakes` : li.description.replace(/ \+ cupcakes.*/, ''), total_zmw: cakeTotal }
    else if (li.category === 'tents_chairs' && li.unit === 'chair') next = { ...li, quantity: to, total_zmw: to * li.unit_cost_zmw }
    if (next.total_zmw !== li.total_zmw) changes.push({ path: `cost_breakdown.line_items[${li.category}].total_zmw`, from: li.total_zmw, to: next.total_zmw, reason: 'headcount' })
    return next
  })

  const prevTotal = cb.total_zmw
  cb.subtotal_zmw = cb.line_items.reduce((s, l) => s + l.total_zmw, 0)
  cb.contingency_zmw = Math.round((cb.subtotal_zmw * cb.contingency_pct) / 100)
  cb.total_zmw = cb.subtotal_zmw + cb.contingency_zmw
  cb.variance_zmw = cb.budget_zmw == null ? null : cb.budget_zmw - cb.total_zmw
  cb.per_guest_zmw = Math.round((cb.total_zmw / to) * 100) / 100
  changes.push({ path: 'cost_breakdown.total_zmw', from: prevTotal, to: cb.total_zmw, reason: 'recomputed' })

  plan.vendor_assignments = plan.vendor_assignments.map((a) => {
    const estimated_zmw = cb.line_items.filter((l) => l.vendor_ref === a.vendor_ref).reduce((s, l) => s + l.total_zmw, 0)
    return { ...a, estimated_zmw, deposit_zmw: Math.round((estimated_zmw * a.deposit_pct) / 100), scope: a.scope.replace(/\d+ (guests|chairs)/, `${to} $1`) }
  })

  if (cb.variance_zmw != null && cb.variance_zmw < 0) {
    const chicken = plan.menu.find((m) => m.id === 'village-chicken')
    const swap = chicken ? ` Beef stew instead of village chicken saves about ZMW ${(5 * chicken.quantity).toLocaleString('en-ZM')}.` : ''
    warnings.push(`Over budget by ZMW ${Math.abs(cb.variance_zmw).toLocaleString('en-ZM')}.${swap} Dropping chikanda saves ZMW ${(10 * to).toLocaleString('en-ZM')}.`)
  }
  plan.warnings = warnings
  plan.changes = changes
  const diff = cb.total_zmw - prevTotal
  plan.revision_summary = `Headcount ${from} → ${to}: ${diff >= 0 ? '+' : '−'}ZMW ${Math.abs(diff).toLocaleString('en-ZM')}, total now ZMW ${cb.total_zmw.toLocaleString('en-ZM')}${cb.variance_zmw != null ? (cb.variance_zmw < 0 ? ` (ZMW ${Math.abs(cb.variance_zmw).toLocaleString('en-ZM')} over budget)` : ` (ZMW ${cb.variance_zmw.toLocaleString('en-ZM')} under budget)`) : ''}.`
  return plan
}
