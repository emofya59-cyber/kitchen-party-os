-- =====================================================================
-- 0004: Phase 2: gift pledges, receipts, dispatch_log, audit_trail,
-- key-gated demo_action RPC (pay / dispatch / audit / deposit request / reset),
-- and a vendor-scoped read RPC that never exposes guests or host finances.
-- =====================================================================

alter table public.guests   add column if not exists gift_pledge_zmw numeric(12,2) check (gift_pledge_zmw is null or gift_pledge_zmw >= 0);
alter table public.payments add column if not exists receipt_id text unique;
alter table public.payments add column if not exists invoice_number text;

create table public.dispatch_log (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  guest_id    uuid references public.guests(id) on delete set null,
  channel     text not null default 'sms' check (channel in ('sms','whatsapp')),
  provider    text not null default 'africas_talking',
  to_phone    text check (to_phone is null or to_phone ~ '^\+260[0-9]{9}$'),
  to_name     text,
  message     text not null check (length(message) <= 1600),
  status      text not null default 'queued' check (status in ('queued','sent','failed')),
  simulated   boolean not null default true,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index idx_dispatch_log_event on public.dispatch_log (event_id, created_at desc);
create index idx_dispatch_log_guest on public.dispatch_log (guest_id);

create table public.audit_trail (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  actor       text not null default 'OpsAgent',
  rule        text,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index idx_audit_trail_event on public.audit_trail (event_id, created_at desc);

alter table public.dispatch_log enable row level security;
alter table public.audit_trail  enable row level security;
create policy dispatch_log_demo_select on public.dispatch_log for select to anon, authenticated using (public.is_demo_event(event_id));
create policy dispatch_log_host_select on public.dispatch_log for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_org_member(e.org_id)));
create policy audit_trail_demo_select on public.audit_trail for select to anon, authenticated using (public.is_demo_event(event_id));
create policy audit_trail_host_select on public.audit_trail for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_org_member(e.org_id)));
grant select on public.dispatch_log, public.audit_trail to anon, authenticated;
grant all on public.dispatch_log, public.audit_trail to service_role;

alter publication supabase_realtime add table public.dispatch_log, public.audit_trail, public.menu_items, public.event_vendors;

-- Seed gift pledges deterministically (demo guests only)
update public.guests g set gift_pledge_zmw =
  case when (right(g.id::text, 12))::int % 3 = 0 then null
       else (array[100,150,200,250,300,500])[((right(g.id::text, 12))::int % 6) + 1] end
where public.is_demo_event(g.event_id);

-- ---------------------------------------------------------------------
-- demo_action: one key-gated entry point for Phase 2 simulations
-- ---------------------------------------------------------------------
create or replace function public.demo_action(p_key text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event uuid;
  v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_pay public.payments;
  v_receipt text;
  v_n int;
  v_vendor uuid;
  v_ids uuid[];
begin
  perform private.assert_bridge_key(p_key);
  v_event := private.resolve_event(nullif(v_args->>'event_id', '')::uuid);
  if v_event is null or not public.is_demo_event(v_event) then
    raise exception 'demo_action only works on the demo event' using errcode = 'P0002';
  end if;

  if p_action = 'pay_deposit' then
    if coalesce(v_args->>'phone', '') !~ '^\+260(97|96|95|77|76|75)[0-9]{7}$' then
      raise exception 'phone must be +260 followed by 97/96/95/77/76/75 and 7 digits' using errcode = '22023';
    end if;
    if v_args ? 'payment_id' then
      select * into v_pay from public.payments where id = (v_args->>'payment_id')::uuid and event_id = v_event;
    else
      select p.* into v_pay from public.payments p
        join public.vendors v on v.id = p.vendor_id join public.orgs o on o.id = v.org_id
       where p.event_id = v_event and p.status in ('pending','processing') and o.slug = v_args->>'vendor_ref'
       order by p.created_at limit 1;
      if v_pay.id is null and (v_args->>'amount_zmw')::numeric > 0 then
        select v.id into v_vendor from public.vendors v join public.orgs o on o.id = v.org_id where o.slug = v_args->>'vendor_ref';
        insert into public.payments (event_id, org_id, vendor_id, purpose, amount_zmw, status, provider_ref)
        select v_event, e.org_id, v_vendor, 'deposit', (v_args->>'amount_zmw')::numeric, 'pending', 'SIM-' || upper(substr(md5(random()::text), 1, 8))
          from public.events e where e.id = v_event
        returning * into v_pay;
      end if;
    end if;
    if v_pay.id is null then raise exception 'no pending payment found' using errcode = 'P0002'; end if;
    if v_pay.status = 'succeeded' then raise exception 'payment already paid (receipt %)', v_pay.receipt_id using errcode = '22023'; end if;
    v_receipt := 'EP-LSK-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    update public.payments set status = 'succeeded', paid_at = now(), receipt_id = v_receipt,
           payer_phone = v_args->>'phone', payer_network = lower(coalesce(v_args->>'network', 'airtel')),
           invoice_number = coalesce(v_args->>'invoice_number', invoice_number),
           raw_payload = jsonb_build_object('simulated', true, 'network', v_args->>'network', 'receipt_id', v_receipt)
     where id = v_pay.id returning * into v_pay;
    insert into public.audit_trail (event_id, actor, rule, action, detail)
    values (v_event, 'ElicatePaySim', 'deposit', 'deposit_paid', jsonb_build_object('payment_id', v_pay.id, 'amount_zmw', v_pay.amount_zmw, 'receipt_id', v_receipt, 'network', v_pay.payer_network));
    return jsonb_build_object('payment', to_jsonb(v_pay));

  elsif p_action = 'request_deposit' then
    select v.id into v_vendor from public.vendors v join public.orgs o on o.id = v.org_id where o.slug = v_args->>'vendor_ref';
    if v_vendor is null or not ((v_args->>'amount_zmw')::numeric > 0) then
      raise exception 'request_deposit needs vendor_ref and amount_zmw > 0' using errcode = '22023';
    end if;
    select * into v_pay from public.payments where event_id = v_event and vendor_id = v_vendor and status = 'pending' limit 1;
    if v_pay.id is null then
      insert into public.payments (event_id, org_id, vendor_id, purpose, amount_zmw, status, provider_ref)
      select v_event, e.org_id, v_vendor, 'deposit', (v_args->>'amount_zmw')::numeric, 'pending', 'SIM-' || upper(substr(md5(random()::text), 1, 8))
        from public.events e where e.id = v_event returning * into v_pay;
    end if;
    return jsonb_build_object('payment', to_jsonb(v_pay));

  elsif p_action = 'dispatch' then
    -- args: { channel, items: [{guest_id, message}] }  (message <= 1600 chars)
    insert into public.dispatch_log (event_id, guest_id, channel, to_phone, to_name, message)
    select v_event, g.id, coalesce(v_args->>'channel', 'sms'), g.phone, g.full_name, left(i->>'message', 1600)
      from jsonb_array_elements(coalesce(v_args->'items', '[]'::jsonb)) i
      join public.guests g on g.id = (i->>'guest_id')::uuid and g.event_id = v_event;
    get diagnostics v_n = row_count;
    return jsonb_build_object('queued', v_n);

  elsif p_action = 'dispatch_flush' then
    update public.dispatch_log set status = 'sent', sent_at = now() where event_id = v_event and status = 'queued';
    get diagnostics v_n = row_count;
    return jsonb_build_object('sent', v_n);

  elsif p_action = 'audit' then
    insert into public.audit_trail (event_id, actor, rule, action, detail)
    values (v_event, coalesce(v_args->>'actor', 'OpsAgent'), v_args->>'rule', coalesce(v_args->>'action', 'note'), coalesce(v_args->'detail', '{}'::jsonb));
    return jsonb_build_object('ok', true);

  elsif p_action = 'set_rsvp' then
    update public.guests set rsvp_status = (v_args->>'status')::public.rsvp_status
     where id = (v_args->>'guest_id')::uuid and event_id = v_event;
    return jsonb_build_object('ok', true);

  elsif p_action = 'reset' then
    delete from public.agent_bridge where event_id = v_event
       and id not in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002');
    update public.agent_bridge set status = 'pending' where id = 'b1000000-0000-4000-8000-000000000002';
    update public.agent_bridge set status = 'info' where id = 'b1000000-0000-4000-8000-000000000001';
    update public.menu_items set quantity = 120 where event_id = v_event and per_guest is not null;
    update public.menu_items m set unit_cost_zmw = x.c from (values
      ('Nshima (white maize)',12),('Village chicken (stewed)',45),('Kapenta with tomato & onion',20),
      ('Ifisashi (greens in groundnut sauce)',15),('Impwa (garden eggs) with tomato',12),
      ('Chikanda (African polony) slices',10),('Soft drinks, Maheu & water',15),('3-tier celebration cake',2800)) x(n, c)
     where m.event_id = v_event and m.name = x.n;
    update public.events set guest_target = 120, budget_zmw = 25000, current_revision_id = 'd0000000-0000-4000-8000-000000000001' where id = v_event;
    delete from public.plan_revisions where event_id = v_event and id <> 'd0000000-0000-4000-8000-000000000001';
    update public.event_vendors ev set status = x.s::public.booking_status, quoted_zmw = x.q from (values
      ('catering','confirmed',15480),('cake','requested',2800),('tents_chairs','proposed',4600)) x(svc, s, q)
     where ev.event_id = v_event and ev.service::text = x.svc;
    delete from public.payments where event_id = v_event
       and id not in ('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002');
    update public.payments set status = 'succeeded', paid_at = '2026-11-18T10:15:00+02:00', receipt_id = 'EP-LSK-7Q2M4K',
           payer_phone = '+260977123456', payer_network = 'airtel', raw_payload = null
     where id = '90000000-0000-4000-8000-000000000001';
    update public.payments set status = 'pending', paid_at = null, receipt_id = null, payer_phone = '+260977123456',
           payer_network = 'airtel', raw_payload = null
     where id = '90000000-0000-4000-8000-000000000002';
    update public.guests g set
      rsvp_status = (array['confirmed','confirmed','confirmed','confirmed','confirmed','confirmed','invited','invited','maybe','declined'])
                      [(((right(g.id::text, 12))::int - 1) % 10) + 1]::public.rsvp_status,
      gift_pledge_zmw = case when (right(g.id::text, 12))::int % 3 = 0 then null
                             else (array[100,150,200,250,300,500])[((right(g.id::text, 12))::int % 6) + 1] end
     where g.event_id = v_event;
    delete from public.dispatch_log where event_id = v_event;
    delete from public.audit_trail where event_id = v_event;
    insert into public.audit_trail (event_id, actor, rule, action, detail)
    values (v_event, 'DemoMode', null, 'demo_reset', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'reset', true);
  end if;

  raise exception 'unknown demo action %', p_action using errcode = '22023';
end;
$$;

-- Vendor-scoped read: food quantities, delivery slots, own booking + payout/deposit status only.
create or replace function public.vendor_view(p_vendor_ref text default 'ba-mwapes-kitchen')
returns jsonb language sql stable security definer set search_path = '' as $$
  with ev as (select e.id, e.title, e.starts_at, e.area, e.current_revision_id from public.events e where e.is_demo order by e.created_at limit 1),
       vend as (select v.id, v.display_name, v.category, o.slug from public.vendors v join public.orgs o on o.id = v.org_id where o.slug = p_vendor_ref)
  select jsonb_build_object(
    'event', (select jsonb_build_object('title', ev.title, 'starts_at', ev.starts_at, 'area', ev.area) from ev),
    'vendor', (select to_jsonb(vend) from vend),
    'booking', (select jsonb_build_object('status', b.status, 'quoted_zmw', b.quoted_zmw, 'scope', b.notes)
                  from public.event_vendors b, ev, vend where b.event_id = ev.id and b.vendor_id = vend.id limit 1),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'quantity', m.quantity, 'unit', m.unit) order by m.sort_order)
                  from public.menu_items m, ev, vend where m.event_id = ev.id and m.vendor_id = vend.id), '[]'::jsonb),
    'deliveries', coalesce((select jsonb_agg(r) from ev, vend, public.plan_revisions pr,
                  jsonb_array_elements(pr.plan->'run_of_show') r
                  where pr.id = ev.current_revision_id and r->>'owner' = vend.display_name), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('amount_zmw', p.amount_zmw, 'status', p.status, 'receipt_id', p.receipt_id, 'paid_at', p.paid_at) order by p.created_at)
                  from public.payments p, ev, vend where p.event_id = ev.id and p.vendor_id = vend.id), '[]'::jsonb)
  );
$$;

revoke all on function public.demo_action(text, text, jsonb) from public, authenticated;
grant execute on function public.demo_action(text, text, jsonb) to anon, service_role;
revoke all on function public.vendor_view(text) from public;
grant execute on function public.vendor_view(text) to anon, authenticated, service_role;

-- Reset payment 1 receipt for a nicer demo
update public.payments set receipt_id = 'EP-LSK-7Q2M4K' where id = '90000000-0000-4000-8000-000000000001';
