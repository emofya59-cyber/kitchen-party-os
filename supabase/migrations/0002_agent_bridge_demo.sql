-- =====================================================================
-- 0002: agent_bridge (agent-to-agent negotiation feed) + public demo mode
-- - events.is_demo: a demo event (and its children) is readable by anon so the
--   hackathon dashboard works without login. Never flag real events as demo.
-- - agent_bridge writes go through SECURITY DEFINER RPCs that require the bridge
--   key (sha256 stored in private.bridge_keys). They're called by the Cloudflare
--   Pages Function /api/bridge.
-- =====================================================================

alter table public.events add column if not exists is_demo boolean not null default false;
create index if not exists idx_events_demo on public.events (id) where is_demo;

create or replace function public.is_demo_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events where id = p_event_id and is_demo);
$$;

-- ---------------------------------------------------------------------
-- agent_bridge
-- ---------------------------------------------------------------------
create table public.agent_bridge (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  from_agent    text not null check (length(trim(from_agent)) between 1 and 80),
  to_agent      text not null check (length(trim(to_agent)) between 1 and 80),
  action_type   text not null check (action_type ~ '^[a-z][a-z_]{1,39}$'),
  message       text check (message is null or length(message) <= 4000),
  payload_json  jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','accepted','countered','declined','applied','info')),
  created_at    timestamptz not null default now()
);
create index idx_agent_bridge_event_created on public.agent_bridge (event_id, created_at desc);
create index idx_agent_bridge_pending on public.agent_bridge (event_id) where status = 'pending';

alter table public.agent_bridge enable row level security;
create policy agent_bridge_demo_select on public.agent_bridge for select to anon, authenticated
  using (public.is_demo_event(event_id));
create policy agent_bridge_host_select on public.agent_bridge for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_org_member(e.org_id)));

grant select on public.agent_bridge to anon, authenticated;
grant all on public.agent_bridge to service_role;
alter table public.agent_bridge replica identity full;
alter publication supabase_realtime add table public.agent_bridge;

-- ---------------------------------------------------------------------
-- Anonymous read access to the demo event only
-- ---------------------------------------------------------------------
grant select on public.events, public.menu_items, public.guests, public.payments, public.event_vendors,
  public.vendors, public.vendor_catalog_items, public.orgs, public.plan_revisions, public.event_headcount to anon;
grant update (rsvp_status) on public.guests to anon;  -- "Simulate RSVP" on the demo board

create policy events_demo_select        on public.events         for select to anon using (is_demo);
create policy menu_items_demo_select    on public.menu_items     for select to anon using (public.is_demo_event(event_id));
create policy guests_demo_select        on public.guests         for select to anon using (public.is_demo_event(event_id));
create policy guests_demo_rsvp          on public.guests         for update to anon using (public.is_demo_event(event_id)) with check (public.is_demo_event(event_id));
create policy payments_demo_select      on public.payments       for select to anon using (public.is_demo_event(event_id));
create policy event_vendors_demo_select on public.event_vendors  for select to anon using (public.is_demo_event(event_id));
create policy plan_revisions_demo_select on public.plan_revisions for select to anon using (public.is_demo_event(event_id));
create policy vendors_demo_select       on public.vendors        for select to anon using (is_active);
create policy catalog_demo_select       on public.vendor_catalog_items for select to anon using (is_active);
create policy orgs_demo_select          on public.orgs           for select to anon
  using (type = 'vendor' or exists (select 1 from public.events e where e.org_id = orgs.id and e.is_demo));

-- ---------------------------------------------------------------------
-- Bridge key + RPCs
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.bridge_keys (
  key_hash   text primary key,
  label      text not null,
  created_at timestamptz not null default now()
);
-- Demo key chosen by the event owner for the hackathon ('lusaka2026'). Rotate after the event:
--   insert into private.bridge_keys values (encode(sha256(convert_to('<new>','UTF8')),'hex'), 'rotated');
--   delete from private.bridge_keys where label = 'hackathon-demo';
insert into private.bridge_keys (key_hash, label)
values (encode(sha256(convert_to('lusaka2026', 'UTF8')), 'hex'), 'hackathon-demo');

create or replace function private.assert_bridge_key(p_key text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key is null or not exists (
    select 1 from private.bridge_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'invalid bridge key' using errcode = '28000';
  end if;
end;
$$;

create or replace function private.resolve_event(p_event_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(p_event_id, (select id from public.events where is_demo order by created_at limit 1));
$$;

-- GET: pending items + full thread, latest first
create or replace function public.bridge_list(p_key text, p_event_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_event uuid;
begin
  perform private.assert_bridge_key(p_key);
  v_event := private.resolve_event(p_event_id);
  if v_event is null then raise exception 'no demo event found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'event_id', v_event,
    'pending', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from public.agent_bridge b
                         where b.event_id = v_event and b.status = 'pending'), '[]'::jsonb),
    'thread',  coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from public.agent_bridge b
                         where b.event_id = v_event), '[]'::jsonb)
  );
end;
$$;

-- POST: insert a message; quote_accepted applies the quote to menu/budget/vendor booking
create or replace function public.bridge_post(
  p_key text, p_from_agent text, p_to_agent text, p_action_type text,
  p_message text default null, p_payload jsonb default '{}'::jsonb, p_event_id uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event uuid;
  v_row public.agent_bridge;
  v_quote public.agent_bridge;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_status text := 'pending';
  v_item jsonb;
  v_updated int := 0;
  v_n int;
  v_applied jsonb := null;
begin
  perform private.assert_bridge_key(p_key);
  v_event := private.resolve_event(p_event_id);
  if v_event is null then raise exception 'no demo event found' using errcode = 'P0002'; end if;
  if jsonb_typeof(v_payload) <> 'object' then raise exception 'payload_json must be an object' using errcode = '22023'; end if;

  if p_action_type in ('quote_accepted', 'counter_offer', 'quote_declined') then
    select * into v_quote from public.agent_bridge
    where event_id = v_event and action_type in ('quote', 'counter_offer')
      and (case when v_payload ? 'quote_id' then id = (v_payload->>'quote_id')::uuid else status = 'pending' end)
    order by created_at desc limit 1;
    if v_quote.id is null then raise exception 'no matching pending quote to %', p_action_type using errcode = 'P0002'; end if;
  end if;

  if p_action_type = 'quote_accepted' then
    v_payload := v_quote.payload_json || v_payload || jsonb_build_object('quote_id', v_quote.id);
    v_status := 'applied';

    for v_item in select * from jsonb_array_elements(coalesce(v_payload->'menu', '[]'::jsonb)) loop
      update public.menu_items m
         set quantity = coalesce((v_item->>'quantity')::numeric, m.quantity),
             unit_cost_zmw = coalesce((v_item->>'unit_cost_zmw')::numeric, m.unit_cost_zmw)
       where m.event_id = v_event
         and (m.id::text = v_item->>'id' or lower(m.name) = lower(v_item->>'name'));
      get diagnostics v_n = row_count;
      v_updated := v_updated + v_n;
    end loop;

    update public.events
       set guest_target = coalesce((v_payload->>'guest_count')::int, guest_target),
           budget_zmw   = coalesce((v_payload->>'budget_zmw')::numeric, budget_zmw)
     where id = v_event;

    if v_payload ? 'vendor_ref' then
      update public.event_vendors ev
         set status = 'confirmed',
             quoted_zmw = coalesce((v_payload->>'total_zmw')::numeric, ev.quoted_zmw)
        from public.vendors v join public.orgs o on o.id = v.org_id
       where ev.event_id = v_event and ev.vendor_id = v.id and o.slug = v_payload->>'vendor_ref';
    end if;

    update public.agent_bridge set status = 'accepted' where id = v_quote.id;
    v_applied := jsonb_build_object('quote_id', v_quote.id, 'menu_items_updated', v_updated,
                                    'guest_count', v_payload->'guest_count', 'total_zmw', v_payload->'total_zmw');
  elsif p_action_type = 'counter_offer' then
    if not (v_payload ? 'counter_total_zmw') or (v_payload->>'counter_total_zmw')::numeric <= 0 then
      raise exception 'counter_offer needs payload_json.counter_total_zmw > 0' using errcode = '22023';
    end if;
    v_payload := v_payload || jsonb_build_object('quote_id', v_quote.id);
    update public.agent_bridge set status = 'countered' where id = v_quote.id;
  elsif p_action_type = 'quote_declined' then
    v_payload := v_payload || jsonb_build_object('quote_id', v_quote.id);
    v_status := 'info';
    update public.agent_bridge set status = 'declined' where id = v_quote.id;
  elsif p_action_type in ('message', 'quote_request', 'note') then
    v_status := 'info';
  end if;

  insert into public.agent_bridge (event_id, from_agent, to_agent, action_type, message, payload_json, status)
  values (v_event, trim(p_from_agent), trim(p_to_agent), p_action_type, p_message, v_payload, v_status)
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row), 'applied', v_applied);
end;
$$;

revoke all on function public.bridge_list(text, uuid) from public;
revoke all on function public.bridge_post(text, text, text, text, text, jsonb, uuid) from public;
grant execute on function public.bridge_list(text, uuid) to anon, authenticated, service_role;
grant execute on function public.bridge_post(text, text, text, text, text, jsonb, uuid) to anon, authenticated, service_role;
grant execute on function public.is_demo_event(uuid) to anon, authenticated, service_role;
