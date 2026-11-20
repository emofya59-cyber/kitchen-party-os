# Kitchen Party OS 🍲

An AI event planner for Lusaka kitchen parties, weddings and corporate events, built for the **Grok Bot Lusaka Hackathon** (AfricaWorks Lusaka, Sat 21 Nov 2026, Events & Hospitality track).

A host pastes a brief. Grok streams back a menu, run-of-show and ZMW cost breakdown. Vendors are tenants. Deposits go through Elicate Pay (mobile money). RSVPs update live over Supabase Realtime. A change like "15 extra guests" makes Grok re-plan quantities and costs.

> All ZMW figures are **example estimates**, not vendor quotes. Demo names and +260 numbers are fictional.

## Stack
React 19 + Vite 8 + TypeScript 7 + Tailwind CSS 4 · Supabase (Postgres, RLS, Realtime, Edge Functions) · xAI Grok (`grok-4.7`, OpenAI-compatible chat completions) · Cloudflare Pages.

## Quick start (offline demo, no keys needed)
```bash
npm install
npm run dev        # http://localhost:5173 (runs on mock data when VITE_SUPABASE_* is empty)
```
Offline mode streams the example plan, handles headcount revisions ("15 extra guests", "10 fewer guests") with a deterministic local re-planner (`src/lib/revise.ts`), and simulates RSVPs and Elicate webhooks.

## Connect Supabase
```bash
cp .env.example .env.local           # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
supabase link --project-ref <ref>
supabase db push                     # applies supabase/migrations/0001_init.sql
# Demo seed: `supabase db reset` runs seed.sql locally. On a hosted project, create the demo users
# through Auth first (seed.sql inserts into auth.users, which is only meant for local dev).
supabase secrets set XAI_API_KEY=xai-...
supabase functions deploy plan-event
supabase functions deploy elicate-webhook --no-verify-jwt
```
Demo logins (local seed): `natasha.mwansa@demo.kpos.zm` (host). Vendors: `mwape.zulu@`, `chanda.phiri@`, `mulenga.banda@demo.kpos.zm`. Password `demo-password-123`.

`plan-event` has `verify_jwt = true`. Signed-in hosts get plans persisted to `plan_revisions` (under RLS), and Realtime pushes them to other screens. If your project uses the new non-JWT publishable keys, sign in before calling the function or set `verify_jwt = false` for the demo.

## Deploy to Cloudflare Pages
- Build command: `npm run build`
- Build output directory: `dist`
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (optional; the app falls back to the offline demo without them)
- SPA fallback: `public/_redirects` (`/* /index.html 200`)

CLI alternative: `npx wrangler pages deploy dist --project-name kitchen-party-os`.

## Live demo wiring (hackathon)
- Supabase project `oozvqdqeguuextvddilj` (kitchen-party-os, eu-central-1) has migrations 0001–0003 and `seed.hosted.sql` applied (`npm run gen:seed -- --hosted`).
- The demo event (`events.is_demo = true`) and its children are readable by `anon` through RLS, so the dashboard works without login.
- **Agent bridge:** `functions/api/bridge.ts` (Cloudflare Pages Function). It requires the `x-bridge-key` header and calls the key-gated RPCs `bridge_list` / `bridge_post`.
  ```bash
  curl -H 'x-bridge-key: lusaka2026' https://<site>/api/bridge
  curl -X POST -H 'x-bridge-key: lusaka2026' -H 'content-type: application/json' https://<site>/api/bridge \
    -d '{"from_agent":"WoodlandsCatererBot","to_agent":"HostBot","action_type":"quote","message":"...","payload_json":{"vendor_ref":"ba-mwapes-kitchen","guest_count":135,"total_zmw":17415,"menu":[{"name":"Nshima (white maize)","quantity":135}]}}'
  ```
  `quote_accepted` applies the quote's `menu[].quantity/unit_cost_zmw`, `guest_count` (and `budget_zmw` if given) and confirms the vendor booking with `total_zmw`. `counter_offer` needs `payload_json.counter_total_zmw`.
- `/vendor` is a placeholder vendor portal (SPA route).

## Scripts
| script | what |
|---|---|
| `npm run build` / `typecheck` | `tsc -b && vite build` / `tsc -b` |
| `npm run sync:prompt` | regenerate `supabase/functions/_shared/planner-prompt.ts` from `prompts/planner.md` |
| `npm run gen:seed` | regenerate `supabase/seed.sql` from `src/mock/demo-data.ts` + `woodlands-plan.json` |
| `npm run db:validate` | stub → migration → seed → RLS smoke test on a **throwaway local** Postgres (set `PGHOST/PGPORT/PGUSER`) |

## Layout
```
prompts/planner.md                     system + revision prompt, strict JSON schema, example briefs/output
supabase/migrations/0001_init.sql      schema, RLS, helpers, triggers, indexes, realtime publication
supabase/seed.sql                      Lusaka demo data (generated)
supabase/tests/                        local-only auth stub + RLS smoke test
supabase/functions/plan-event          Grok SSE passthrough + persist plan_revisions
supabase/functions/elicate-webhook     Elicate Pay webhook stub (TODO(elicate) placeholders)
supabase/functions/_shared             CORS, generated planner prompt, Elicate client stub
src/                                   React app (hooks/useEventData = Supabase + Realtime or mock)
```

## Tenancy model
`orgs` (type `host` | `vendor`) → `org_members` (auth.users, role). Every tenant table carries `org_id`. Policies use `is_org_member(org_id)` / `has_org_role()` / `is_event_vendor(event_id)` (SECURITY DEFINER, so they don't recurse). Hosts get full control of their events. Vendors that are booked (`requested`/`confirmed`) can read the event and menu, but never guests or plans. Payments leave `pending` only through the webhook, which uses the service role.

## Elicate Pay
The webhook and collection client are **stubs**. Header names, signature scheme, payload fields, status values and endpoints are marked `TODO(elicate)` and must come from Elicate's merchant docs or sandbox.
