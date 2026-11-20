-- =====================================================================
-- 0005: final demo sync
--  * agent_bridge.status accepts 'PAID'; pay_deposit posts a HostBot deposit_paid row
--  * bridge_list adds latest_deposit (existing fields unchanged)
--  * quote_accepted: caterer vendor_ref fallback, scope headcount sync, revised deposit (quote deposit_zmw or 30%)
--  * vendor_view exposes event guest_count + this vendor's latest deposit notice (still no guests / host finances)
--  * reset restores seed deposit amounts and vendor scope text
-- =====================================================================
alter table public.agent_bridge drop constraint if exists agent_bridge_status_check;
alter table public.agent_bridge add constraint agent_bridge_status_check
  check (status in ('pending','accepted','countered','declined','applied','info','PAID'));

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
                         where b.event_id = v_event), '[]'::jsonb),
    'latest_deposit', (select to_jsonb(b) from public.agent_bridge b
                        where b.event_id = v_event and b.action_type = 'deposit_paid' order by b.created_at desc limit 1)
  );
end;
$$;

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
  v_dep numeric;
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

    if not (v_payload ? 'vendor_ref') and v_quote.from_agent = 'WoodlandsCatererBot' then
      v_payload := v_payload || jsonb_build_object('vendor_ref', 'ba-mwapes-kitchen');
    end if;
    if v_payload ? 'vendor_ref' then
      update public.event_vendors ev
         set status = 'confirmed',
             quoted_zmw = coalesce((v_payload->>'total_zmw')::numeric, ev.quoted_zmw)
        from public.vendors v join public.orgs o on o.id = v.org_id
       where ev.event_id = v_event and ev.vendor_id = v.id and o.slug = v_payload->>'vendor_ref';
      -- keep the vendor-facing scope line in sync with the accepted headcount
      if v_payload ? 'guest_count' then
        update public.event_vendors ev
           set notes = regexp_replace(coalesce(ev.notes, ''), '[0-9]+ guests', (v_payload->>'guest_count') || ' guests')
          from public.vendors v join public.orgs o on o.id = v.org_id
         where ev.event_id = v_event and ev.vendor_id = v.id and o.slug = v_payload->>'vendor_ref';
      end if;
      -- revised deposit: quote's deposit_zmw, else 30% of the accepted total; reopen the vendor's deposit if it changed
      if (v_payload->>'total_zmw') is not null or (v_payload->>'deposit_zmw') is not null then
        v_dep := coalesce((v_payload->>'deposit_zmw')::numeric, round((v_payload->>'total_zmw')::numeric * 0.30));
        v_payload := v_payload || jsonb_build_object('deposit_zmw', v_dep);
        update public.payments p
           set amount_zmw = v_dep, status = 'pending', paid_at = null, receipt_id = null, raw_payload = null
          from public.vendors v join public.orgs o on o.id = v.org_id
         where p.event_id = v_event and p.vendor_id = v.id and o.slug = v_payload->>'vendor_ref'
           and p.purpose = 'deposit' and p.amount_zmw <> v_dep;
      end if;
    end if;

    update public.agent_bridge set status = 'accepted' where id = v_quote.id;
    v_applied := jsonb_build_object('quote_id', v_quote.id, 'menu_items_updated', v_updated,
                                    'guest_count', v_payload->'guest_count', 'total_zmw', v_payload->'total_zmw', 'deposit_zmw', v_payload->'deposit_zmw');
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
  v_slug text;
  v_vname text;
  v_qdep numeric;
  v_amt numeric;
  v_bridge jsonb;
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
    select o.slug, v.display_name into v_slug, v_vname
      from public.vendors v join public.orgs o on o.id = v.org_id where v.id = v_pay.vendor_id;
    select (b.payload_json->>'deposit_zmw')::numeric into v_qdep from public.agent_bridge b
     where b.event_id = v_event and b.status = 'accepted' and b.payload_json->>'vendor_ref' = v_slug
       and b.payload_json ? 'deposit_zmw' order by b.created_at desc limit 1;
    v_amt := v_pay.amount_zmw;
    insert into public.agent_bridge (event_id, from_agent, to_agent, action_type, message, payload_json, status)
    select v_event, 'HostBot', case when v_slug = 'ba-mwapes-kitchen' then 'WoodlandsCatererBot' else v_vname end, 'deposit_paid',
           'Elicate Pay deposit PAID: ZMW ' || to_char(v_amt, 'FM999,999,990') || ' (Receipt ' || v_receipt || ')',
           jsonb_build_object('status', 'PAID', 'deposit_zmw', v_amt, 'receipt_id', v_receipt, 'guest_count', e.guest_target,
                              'vendor_ref', v_slug, 'payment_id', v_pay.id, 'network', v_pay.payer_network,
                              'quote_deposit_zmw', v_qdep, 'simulated', true),
           'PAID'
      from public.events e where e.id = v_event
    returning to_jsonb(agent_bridge.*) into v_bridge;
    return jsonb_build_object('payment', to_jsonb(v_pay), 'bridge', v_bridge);

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
    update public.event_vendors ev set status = x.s::public.booking_status, quoted_zmw = x.q, notes = x.n from (values
      ('catering','confirmed',15480,'All food & drinks for 120 guests, 2 serving lines, 4 servers'),
      ('cake','requested',2800,'3-tier cake, delivered 13:30'),
      ('tents_chairs','proposed',4600,'120 chairs with covers, decor package, set-up & teardown')) x(svc, s, q, n)
     where ev.event_id = v_event and ev.service::text = x.svc;
    delete from public.payments where event_id = v_event
       and id not in ('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002');
    update public.payments set status = 'succeeded', amount_zmw = 4644, paid_at = '2026-11-18T10:15:00+02:00', receipt_id = 'EP-LSK-7Q2M4K',
           payer_phone = '+260977123456', payer_network = 'airtel', raw_payload = null
     where id = '90000000-0000-4000-8000-000000000001';
    update public.payments set status = 'pending', amount_zmw = 1400, paid_at = null, receipt_id = null, payer_phone = '+260977123456',
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

create or replace function public.vendor_view(p_vendor_ref text default 'ba-mwapes-kitchen')
returns jsonb language sql stable security definer set search_path = '' as $$
  with ev as (select e.id, e.title, e.starts_at, e.area, e.guest_target, e.current_revision_id from public.events e where e.is_demo order by e.created_at limit 1),
       vend as (select v.id, v.display_name, v.category, o.slug from public.vendors v join public.orgs o on o.id = v.org_id where o.slug = p_vendor_ref)
  select jsonb_build_object(
    'event', (select jsonb_build_object('id', ev.id, 'title', ev.title, 'starts_at', ev.starts_at, 'area', ev.area, 'guest_count', ev.guest_target) from ev),
    'deposit_notice', (select jsonb_build_object('message', b.message, 'receipt_id', b.payload_json->>'receipt_id', 'deposit_zmw', b.payload_json->'deposit_zmw', 'created_at', b.created_at)
                  from public.agent_bridge b, ev, vend where b.event_id = ev.id and b.action_type = 'deposit_paid' and b.payload_json->>'vendor_ref' = vend.slug order by b.created_at desc limit 1),
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
