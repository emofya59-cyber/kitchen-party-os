# Kitchen Party OS — Grok planner prompts

These are the prompts used by `supabase/functions/plan-event`. The edge function does **not** read this file at runtime. Run `npm run sync:prompt` after editing it. That regenerates `supabase/functions/_shared/planner-prompt.ts` from the marked blocks below and refreshes the example output from `src/mock/woodlands-plan.json`.

> **Pricing disclaimer:** every ZMW figure the planner produces is an **example estimate** for planning only, never a vendor quote. The UI labels them that way, and so does the `price_basis: "example_estimate"` field.

---

## 1. System prompt (initial plan)

<!-- BEGIN:SYSTEM -->
```text
You are the Kitchen Party OS planner, an event-planning engine for Lusaka, Zambia.
You turn a host's short brief into a complete, costed plan for kitchen parties, weddings, birthdays and corporate events.

CONTEXT
- Location: Lusaka (areas such as Woodlands, Kabulonga, Roma, Chelston, Avondale, Ibex Hill, Kalundu, Rhodes Park).
- Currency: Zambian Kwacha (ZMW). Every money field is a plain number in ZMW (no symbols, no thousands separators).
- Typical dishes: nshima (white maize), village chicken, beef stew, kapenta, ifisashi (greens in groundnut sauce), chibwabwa, impwa (garden eggs), chikanda (African polony), rape, beans, cake, Maheu, soft drinks.
- Typical kitchen party flow: set-up, guest arrival, prayer and welcome, the bride's (covered) entrance, food, advice from the aunties, gifts, the groom's surprise arrival, cake, dancing.
- Phone numbers use +260 followed by 9 digits.

INPUTS YOU RECEIVE (in the user message, as JSON)
- "brief": free text from the host.
- "event": known event fields (may be partial).
- "vendors": available vendors with "vendor_ref" (slug), "name", "category", and "catalog" (name, unit, price_zmw, serves). Prefer these vendors and their catalog prices.

RULES
1. Output ONE JSON object that matches the schema exactly. No markdown, no prose, no code fences.
2. Scale every menu quantity from guest_count: quantity = ceil(guest_count * per_guest_qty) unless the item is a fixed unit (e.g. a cake), in which case per_guest_qty is null.
3. line_total_zmw = quantity * unit_cost_zmw. Each cost_breakdown line: total_zmw = quantity * unit_cost_zmw.
4. subtotal_zmw = sum(line_items.total_zmw). contingency_zmw = round(subtotal_zmw * contingency_pct / 100). total_zmw = subtotal_zmw + contingency_zmw. variance_zmw = budget_zmw - total_zmw (negative means over budget; null if there is no budget). per_guest_zmw = round(total_zmw / guest_count, 2).
5. Use vendor catalog prices when a vendor offers the item. Otherwise use a reasonable Lusaka estimate and add an assumption saying the price is estimated.
6. If the plan exceeds the budget, still return the plan, add a warning, and suggest specific swaps (e.g. "beef stew instead of village chicken saves about ZMW X").
7. Each vendor_assignment.estimated_zmw = the sum of the line items assigned to that vendor_ref. deposit_zmw = round(estimated_zmw * deposit_pct / 100). Default deposit_pct is 30 (cake 50).
8. Run-of-show times use 24h "HH:MM" local Lusaka time (CAT, UTC+2) and must be in chronological order.
9. Put anything you inferred (date, venue, guest mix, power or water, music) in "assumptions". Put risks in "warnings".
10. Always set "price_basis": "example_estimate" and "version": "1.0". Never claim prices are quotes.
11. Do not invent vendors that are not in "vendors". If no vendor covers a need, use vendor_ref null and add a warning.
12. For an initial plan, set "revision_summary" and "changes" to null.
```
<!-- END:SYSTEM -->

## 2. Revision prompt (delta updates)

Used when the host sends a change such as "15 extra guests", "swap village chicken for beef", or "budget cut to ZMW 20,000". The previous plan goes in as JSON. Grok returns the **full updated plan** with `revision_summary` and `changes`, so the UI can replace its state in one step and highlight what changed.

<!-- BEGIN:REVISION -->
```text
You are revising an existing Kitchen Party OS plan. You will receive JSON with:
- "previous_plan": the current plan (same schema as your output).
- "change": the host's requested change in free text (e.g. "Aunty Mwape confirmed 15 extra guests").
- "vendors": the same vendor catalog as before.

RULES
1. Apply ONLY the requested change and its knock-on effects. Keep every other field identical (same ids, same order, same vendors) unless the change requires otherwise.
2. Headcount changes: update event.guest_count, recompute every per-guest menu quantity (ceil(guest_count * per_guest_qty)), every per-guest cost line (chairs, plates, drinks), and check that fixed items (e.g. cake serves N) still cover the guests. If they don't, upgrade the item and say so.
3. Recompute subtotal, contingency, total, variance, per_guest, vendor estimated_zmw and deposit_zmw using the same formulas as the original plan.
4. If the new total exceeds the budget, add a warning with 1-3 concrete savings options and their ZMW impact.
5. Add "revision_summary": one sentence, e.g. "Headcount 120 → 135: catering +ZMW 1,935, total now ZMW 26,607 (ZMW 1,607 over budget)".
6. Add "changes": an array of { "path", "from", "to", "reason" } for every field whose value changed. Use JSON-pointer-like paths, e.g. "event.guest_count", "menu[village-chicken].quantity", "cost_breakdown.total_zmw".
7. Output ONE JSON object only: no markdown, no prose. Keep "price_basis": "example_estimate".
```
<!-- END:REVISION -->

## 3. Strict output schema (JSON Schema)

The edge function sends this as `response_format: { type: "json_schema", json_schema: { name: "kitchen_party_plan", strict: true, schema } }` when `XAI_STRICT_SCHEMA=true`, and otherwise as `json_object` with the schema pasted into the prompt. `revision_summary` and `changes` are nullable so the same schema serves both modes.

<!-- BEGIN:SCHEMA -->
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "price_basis", "event", "menu", "run_of_show", "cost_breakdown", "vendor_assignments", "assumptions", "warnings", "revision_summary", "changes"],
  "properties": {
    "version": { "type": "string", "enum": ["1.0"] },
    "price_basis": { "type": "string", "enum": ["example_estimate"] },
    "event": {
      "type": "object",
      "additionalProperties": false,
      "required": ["title", "event_type", "date", "start_time", "end_time", "area", "venue", "guest_count", "budget_zmw"],
      "properties": {
        "title": { "type": "string" },
        "event_type": { "type": "string", "enum": ["kitchen_party", "wedding", "corporate", "birthday", "other"] },
        "date": { "type": ["string", "null"], "description": "YYYY-MM-DD" },
        "start_time": { "type": ["string", "null"], "description": "HH:MM 24h CAT" },
        "end_time": { "type": ["string", "null"] },
        "area": { "type": ["string", "null"] },
        "venue": { "type": ["string", "null"] },
        "guest_count": { "type": "integer", "minimum": 1 },
        "budget_zmw": { "type": ["number", "null"] }
      }
    },
    "menu": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "name", "category", "per_guest_qty", "per_guest_unit", "quantity", "unit", "unit_cost_zmw", "line_total_zmw", "vendor_ref", "notes"],
        "properties": {
          "id": { "type": "string", "description": "stable kebab-case id, kept across revisions" },
          "name": { "type": "string" },
          "category": { "type": "string", "enum": ["staple", "relish", "protein", "vegetable", "snack", "dessert", "cake", "drink", "other"] },
          "per_guest_qty": { "type": ["number", "null"] },
          "per_guest_unit": { "type": ["string", "null"] },
          "quantity": { "type": "number" },
          "unit": { "type": "string" },
          "unit_cost_zmw": { "type": "number" },
          "line_total_zmw": { "type": "number" },
          "vendor_ref": { "type": ["string", "null"] },
          "notes": { "type": ["string", "null"] }
        }
      }
    },
    "run_of_show": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["time", "duration_min", "item", "owner", "notes"],
        "properties": {
          "time": { "type": "string", "description": "HH:MM" },
          "duration_min": { "type": "integer" },
          "item": { "type": "string" },
          "owner": { "type": "string" },
          "notes": { "type": ["string", "null"] }
        }
      }
    },
    "cost_breakdown": {
      "type": "object",
      "additionalProperties": false,
      "required": ["currency", "line_items", "subtotal_zmw", "contingency_pct", "contingency_zmw", "total_zmw", "budget_zmw", "variance_zmw", "per_guest_zmw"],
      "properties": {
        "currency": { "type": "string", "enum": ["ZMW"] },
        "line_items": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["category", "description", "quantity", "unit", "unit_cost_zmw", "total_zmw", "vendor_ref"],
            "properties": {
              "category": { "type": "string", "enum": ["food", "drinks", "cake", "decor", "tents_chairs", "sound_dj", "mc", "photography", "transport", "venue", "other"] },
              "description": { "type": "string" },
              "quantity": { "type": "number" },
              "unit": { "type": "string" },
              "unit_cost_zmw": { "type": "number" },
              "total_zmw": { "type": "number" },
              "vendor_ref": { "type": ["string", "null"] }
            }
          }
        },
        "subtotal_zmw": { "type": "number" },
        "contingency_pct": { "type": "number" },
        "contingency_zmw": { "type": "number" },
        "total_zmw": { "type": "number" },
        "budget_zmw": { "type": ["number", "null"] },
        "variance_zmw": { "type": ["number", "null"] },
        "per_guest_zmw": { "type": "number" }
      }
    },
    "vendor_assignments": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["vendor_ref", "vendor_name", "service", "scope", "estimated_zmw", "deposit_pct", "deposit_zmw", "status"],
        "properties": {
          "vendor_ref": { "type": "string" },
          "vendor_name": { "type": "string" },
          "service": { "type": "string", "enum": ["catering", "cake", "decor", "tents_chairs", "sound_dj", "mc", "photography", "transport", "drinks", "other"] },
          "scope": { "type": "string" },
          "estimated_zmw": { "type": "number" },
          "deposit_pct": { "type": "number" },
          "deposit_zmw": { "type": "number" },
          "status": { "type": "string", "enum": ["proposed", "requested", "confirmed"] }
        }
      }
    },
    "assumptions": { "type": "array", "items": { "type": "string" } },
    "warnings": { "type": "array", "items": { "type": "string" } },
    "revision_summary": { "type": ["string", "null"] },
    "changes": {
      "type": ["array", "null"],
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["path", "from", "to", "reason"],
        "properties": {
          "path": { "type": "string" },
          "from": { "type": ["string", "number", "null"] },
          "to": { "type": ["string", "number", "null"] },
          "reason": { "type": "string" }
        }
      }
    }
  }
}
```
<!-- END:SCHEMA -->

## 4. User message format

The edge function builds the user message like this, so you can paste it into the xAI console to test:

```json
{
  "brief": "120 guests, kitchen party in Woodlands, budget ZMW 25,000, nshima + 3 relishes + cake",
  "event": { "title": "Mutale's Kitchen Party", "date": "2026-12-05", "area": "Woodlands", "guest_count": 120, "budget_zmw": 25000 },
  "vendors": [
    { "vendor_ref": "ba-mwapes-kitchen", "name": "Ba Mwape's Kitchen", "category": "catering", "catalog": [{ "name": "Village chicken (stewed)", "unit": "portion", "price_zmw": 45 }] }
  ]
}
```

For revisions: `{ "previous_plan": { ... }, "change": "Aunty Mwape confirmed 15 extra guests", "vendors": [ ... ] }`.

## 5. Example briefs

**Brief A: kitchen party (Woodlands)**
> 120 guests, kitchen party in Woodlands on Sat 5 Dec, budget ZMW 25,000, nshima + 3 relishes + cake

**Brief B: corporate end-of-year lunch (Roma)**
> Corporate year-end lunch for 60 staff at our Roma office, Friday 18 Dec 12:30–16:00, budget ZMW 18,000. Buffet with nshima and rice, beef and chicken, a vegetarian option, soft drinks, a small cake for long-service awards, and a PA system for speeches.

**Revision example (on Brief A)**
> Aunty Mwape confirmed 15 extra guests

Expected effect: guest_count 120 → 135. Every per-guest menu line and chairs go up by 15. The cake (serves 130) is flagged as insufficient and upgraded, or cupcakes are added. Total goes to about ZMW 26.6k, over the ZMW 25,000 budget. A warning suggests swaps, e.g. beef stew instead of village chicken saves ZMW 5 × 135 = ZMW 675.

## 6. Example output: Brief A (Woodlands kitchen party)

All prices are **example estimates**, not quotes.

<!-- BEGIN:EXAMPLE -->
```json
{
  "version": "1.0",
  "price_basis": "example_estimate",
  "event": {
    "title": "Mutale's Kitchen Party",
    "event_type": "kitchen_party",
    "date": "2026-12-05",
    "start_time": "14:00",
    "end_time": "19:00",
    "area": "Woodlands",
    "venue": "Family home, Woodlands, Lusaka",
    "guest_count": 120,
    "budget_zmw": 25000
  },
  "menu": [
    {
      "id": "nshima",
      "name": "Nshima (white maize)",
      "category": "staple",
      "per_guest_qty": 1,
      "per_guest_unit": "plate",
      "quantity": 120,
      "unit": "plate",
      "unit_cost_zmw": 12,
      "line_total_zmw": 1440,
      "vendor_ref": "ba-mwapes-kitchen",
      "notes": "Roughly 0.2 kg mealie meal per guest; cook in 3 batches."
    },
    {
      "id": "village-chicken",
      "name": "Village chicken (stewed)",
      "category": "protein",
      "per_guest_qty": 1,
      "per_guest_unit": "portion",
      "quantity": 120,
      "unit": "portion",
      "unit_cost_zmw": 45,
      "line_total_zmw": 5400,
      "vendor_ref": "ba-mwapes-kitchen",
      "notes": "About 1 bird per 6 guests, so ~20 birds."
    },
    {
      "id": "kapenta",
      "name": "Kapenta with tomato & onion",
      "category": "relish",
      "per_guest_qty": 1,
      "per_guest_unit": "portion",
      "quantity": 120,
      "unit": "portion",
      "unit_cost_zmw": 20,
      "line_total_zmw": 2400,
      "vendor_ref": "ba-mwapes-kitchen",
      "notes": "Siavonga kapenta, ~40 g dried per guest."
    },
    {
      "id": "ifisashi",
      "name": "Ifisashi (greens in groundnut sauce)",
      "category": "relish",
      "per_guest_qty": 1,
      "per_guest_unit": "portion",
      "quantity": 120,
      "unit": "portion",
      "unit_cost_zmw": 15,
      "line_total_zmw": 1800,
      "vendor_ref": "ba-mwapes-kitchen",
      "notes": "Pumpkin leaves (chibwabwa) or rape; vegetarian option."
    },
    {
      "id": "impwa",
      "name": "Impwa (garden eggs) with tomato",
      "category": "vegetable",
      "per_guest_qty": 1,
      "per_guest_unit": "portion",
      "quantity": 120,
      "unit": "portion",
      "unit_cost_zmw": 12,
      "line_total_zmw": 1440,
      "vendor_ref": "ba-mwapes-kitchen",
      "notes": null
    },
    {
      "id": "chikanda",
      "name": "Chikanda (African polony) slices",
      "category": "snack",
      "per_guest_qty": 1,
      "per_guest_unit": "slice",
      "quantity": 120,
      "unit": "slice",
      "unit_cost_zmw": 10,
      "line_total_zmw": 1200,
      "vendor_ref": "ba-mwapes-kitchen",
      "notes": "Served with welcome drinks."
    },
    {
      "id": "drinks",
      "name": "Soft drinks, Maheu & water",
      "category": "drink",
      "per_guest_qty": 1,
      "per_guest_unit": "set",
      "quantity": 120,
      "unit": "set",
      "unit_cost_zmw": 15,
      "line_total_zmw": 1800,
      "vendor_ref": "ba-mwapes-kitchen",
      "notes": "Two 500 ml drinks per guest."
    },
    {
      "id": "cake",
      "name": "3-tier celebration cake",
      "category": "cake",
      "per_guest_qty": null,
      "per_guest_unit": null,
      "quantity": 1,
      "unit": "cake",
      "unit_cost_zmw": 2800,
      "line_total_zmw": 2800,
      "vendor_ref": "chanda-cakes",
      "notes": "About 130 slices, so it covers 120 guests with a small buffer."
    }
  ],
  "run_of_show": [
    {
      "time": "10:00",
      "duration_min": 120,
      "item": "Tent, chairs & decor set-up",
      "owner": "Roma Tents & Decor",
      "notes": "Gazebo on the lawn, with chairs facing the bride's seat."
    },
    {
      "time": "12:00",
      "duration_min": 90,
      "item": "Catering arrives, cooking starts on site",
      "owner": "Ba Mwape's Kitchen",
      "notes": "Charcoal braziers set up behind the house."
    },
    {
      "time": "13:30",
      "duration_min": 30,
      "item": "Cake delivery & placement",
      "owner": "Chanda Cakes & Bakes",
      "notes": null
    },
    {
      "time": "14:00",
      "duration_min": 30,
      "item": "Guests arrive, welcome drinks & chikanda",
      "owner": "Host family",
      "notes": "Ushers at the gate with the RSVP list."
    },
    {
      "time": "14:30",
      "duration_min": 15,
      "item": "Opening prayer & welcome by the MC (Aunty)",
      "owner": "Host family",
      "notes": null
    },
    {
      "time": "14:45",
      "duration_min": 30,
      "item": "Bride's entrance (covered), dancing",
      "owner": "Host family",
      "notes": null
    },
    {
      "time": "15:15",
      "duration_min": 60,
      "item": "Lunch served (buffet): nshima, chicken, relishes",
      "owner": "Ba Mwape's Kitchen",
      "notes": "2 serving lines, 60 guests each."
    },
    {
      "time": "16:15",
      "duration_min": 60,
      "item": "Advice from the aunties & gift presentation",
      "owner": "Host family",
      "notes": null
    },
    {
      "time": "17:15",
      "duration_min": 30,
      "item": "Groom's surprise arrival, cake cutting",
      "owner": "Host family",
      "notes": null
    },
    {
      "time": "17:45",
      "duration_min": 75,
      "item": "Dancing, photos, close",
      "owner": "Host family",
      "notes": "Teardown starts at 19:00."
    }
  ],
  "cost_breakdown": {
    "currency": "ZMW",
    "line_items": [
      {
        "category": "food",
        "description": "Catering: nshima, village chicken, kapenta, ifisashi, impwa, chikanda",
        "quantity": 120,
        "unit": "guest",
        "unit_cost_zmw": 114,
        "total_zmw": 13680,
        "vendor_ref": "ba-mwapes-kitchen"
      },
      {
        "category": "drinks",
        "description": "Soft drinks, Maheu & water",
        "quantity": 120,
        "unit": "set",
        "unit_cost_zmw": 15,
        "total_zmw": 1800,
        "vendor_ref": "ba-mwapes-kitchen"
      },
      {
        "category": "cake",
        "description": "3-tier celebration cake",
        "quantity": 1,
        "unit": "cake",
        "unit_cost_zmw": 2800,
        "total_zmw": 2800,
        "vendor_ref": "chanda-cakes"
      },
      {
        "category": "tents_chairs",
        "description": "Chairs with covers",
        "quantity": 120,
        "unit": "chair",
        "unit_cost_zmw": 15,
        "total_zmw": 1800,
        "vendor_ref": "roma-tents-decor"
      },
      {
        "category": "decor",
        "description": "Kitchen party decor package (gazebo, bride's seat, chitenge drapes)",
        "quantity": 1,
        "unit": "package",
        "unit_cost_zmw": 2800,
        "total_zmw": 2800,
        "vendor_ref": "roma-tents-decor"
      }
    ],
    "subtotal_zmw": 22880,
    "contingency_pct": 5,
    "contingency_zmw": 1144,
    "total_zmw": 24024,
    "budget_zmw": 25000,
    "variance_zmw": 976,
    "per_guest_zmw": 200.2
  },
  "vendor_assignments": [
    {
      "vendor_ref": "ba-mwapes-kitchen",
      "vendor_name": "Ba Mwape's Kitchen",
      "service": "catering",
      "scope": "All food & drinks for 120 guests, 2 serving lines, 4 servers",
      "estimated_zmw": 15480,
      "deposit_pct": 30,
      "deposit_zmw": 4644,
      "status": "proposed"
    },
    {
      "vendor_ref": "chanda-cakes",
      "vendor_name": "Chanda Cakes & Bakes",
      "service": "cake",
      "scope": "3-tier cake, delivered 13:30",
      "estimated_zmw": 2800,
      "deposit_pct": 50,
      "deposit_zmw": 1400,
      "status": "proposed"
    },
    {
      "vendor_ref": "roma-tents-decor",
      "vendor_name": "Roma Tents & Decor",
      "service": "tents_chairs",
      "scope": "120 chairs with covers, decor package, set-up & teardown",
      "estimated_zmw": 4600,
      "deposit_pct": 30,
      "deposit_zmw": 1380,
      "status": "proposed"
    }
  ],
  "assumptions": [
    "All prices are EXAMPLE ESTIMATES for planning only; they are not vendor quotes.",
    "120 guests (adults); children under 5 are not catered separately.",
    "The host's home has power and water access for the caterer; no generator is budgeted.",
    "Music comes from a family member's speaker; no DJ or MC is budgeted.",
    "5% contingency is held back for price swings at market (Soweto/City Market)."
  ],
  "warnings": [
    "Only ZMW 976 of headroom is left. Adding 15 or more guests will push the plan over budget unless the menu changes."
  ],
  "revision_summary": null,
  "changes": null
}
```
<!-- END:EXAMPLE -->
