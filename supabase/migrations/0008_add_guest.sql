-- 0008: '+ Add Guest' on the host dashboard. guests.is_manual marks live-added rows; demo_action gains
-- 'add_guest' (validated Zambian mobile, RSVP invited) and 'reset' deletes every non-seed guest first.
alter table public.guests add column if not exists is_manual boolean not null default false;

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
  v_rev uuid;
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

  elsif p_action = 'custom_event' then
    -- args: { title, location, area?, starts_at, guest_count, budget_zmw, brief, items:[{name,category,quantity,unit,per_guest,unit_cost_zmw,notes,vendor_ref}],
    --         caterer_total, caterer_deposit, caterer_scope, plan, model }
    if length(trim(coalesce(v_args->>'title', ''))) not between 1 and 120 then raise exception 'title required (1-120 chars)' using errcode = '22023'; end if;
    if coalesce((v_args->>'guest_count')::int, 0) not between 1 and 5000 then raise exception 'guest_count must be 1-5000' using errcode = '22023'; end if;
    if jsonb_typeof(v_args->'items') <> 'array' or jsonb_array_length(v_args->'items') not between 1 and 40 then raise exception 'items must be 1-40 menu rows' using errcode = '22023'; end if;
    if jsonb_typeof(v_args->'plan') <> 'object' then raise exception 'plan object required' using errcode = '22023'; end if;
    select v.id into v_vendor from public.vendors v join public.orgs o on o.id = v.org_id where o.slug = 'ba-mwapes-kitchen';
    update public.events e set
        title = left(trim(v_args->>'title'), 120),
        venue = left(coalesce(nullif(trim(v_args->>'location'), ''), e.venue), 200),
        area = left(coalesce(nullif(trim(v_args->>'area'), ''), nullif(trim(split_part(v_args->>'location', ',', 1)), ''), e.area), 80),
        starts_at = coalesce(nullif(v_args->>'starts_at', '')::timestamptz, e.starts_at),
        ends_at = coalesce(nullif(v_args->>'starts_at', '')::timestamptz, e.starts_at) + interval '5 hours',
        brief = left(coalesce(v_args->>'brief', e.brief), 2000),
        guest_target = (v_args->>'guest_count')::int,
        budget_zmw = nullif(v_args->>'budget_zmw', '')::numeric
     where e.id = v_event;
    delete from public.menu_items where event_id = v_event;
    insert into public.menu_items (event_id, org_id, vendor_id, name, category, quantity, unit, per_guest, unit_cost_zmw, notes, sort_order)
    select v_event, e.org_id, coalesce(vd.id, v_vendor), left(i->>'name', 120),
           case when (i->>'category') = any (enum_range(null::public.menu_category)::text[]) then (i->>'category')::public.menu_category else 'other'::public.menu_category end,
           greatest(0, coalesce((i->>'quantity')::numeric, 0)), left(coalesce(nullif(i->>'unit', ''), 'portion'), 40),
           nullif(i->>'per_guest', '')::numeric, greatest(0, coalesce((i->>'unit_cost_zmw')::numeric, 0)), left(i->>'notes', 500), t.ord::int
      from jsonb_array_elements(v_args->'items') with ordinality as t(i, ord)
      join public.events e on e.id = v_event
      left join lateral (select v.id from public.vendors v join public.orgs o on o.id = v.org_id where o.slug = i->>'vendor_ref') vd on true;
    get diagnostics v_n = row_count;
    update public.event_vendors set status = 'requested',
           quoted_zmw = coalesce(nullif(v_args->>'caterer_total', '')::numeric, quoted_zmw),
           notes = left(coalesce(v_args->>'caterer_scope', notes), 500)
     where event_id = v_event and vendor_id = v_vendor;
    update public.payments set amount_zmw = coalesce(nullif(v_args->>'caterer_deposit', '')::numeric, amount_zmw),
           status = 'pending', paid_at = null, receipt_id = null, raw_payload = null
     where event_id = v_event and vendor_id = v_vendor and purpose = 'deposit';
    insert into public.plan_revisions (event_id, org_id, kind, instruction, plan, guest_count, total_zmw, model)
    select v_event, e.org_id, 'initial', left(coalesce(v_args->>'brief', ''), 2000), v_args->'plan', (v_args->>'guest_count')::int,
           nullif(v_args->'plan'->'cost_breakdown'->>'total_zmw', '')::numeric, left(coalesce(v_args->>'model', 'offline-planner'), 80)
      from public.events e where e.id = v_event
    returning id into v_rev;
    update public.events set current_revision_id = v_rev where id = v_event;
    insert into public.audit_trail (event_id, actor, rule, action, detail)
    values (v_event, 'Planner', 'custom_event', 'custom_event_saved', jsonb_build_object('title', v_args->>'title', 'guest_count', v_args->'guest_count', 'items', v_n, 'model', v_args->>'model'));
    return jsonb_build_object('ok', true, 'revision_id', v_rev, 'menu_items', v_n);

  elsif p_action = 'seed_event' then
    perform private.restore_seed_event(v_event);
    update public.payments set status = 'succeeded', amount_zmw = 4644, paid_at = '2026-11-18T10:15:00+02:00', receipt_id = 'EP-LSK-7Q2M4K',
           payer_phone = '+260977123456', payer_network = 'airtel', raw_payload = null
     where id = '90000000-0000-4000-8000-000000000001';
    return jsonb_build_object('ok', true, 'seed_event', true);

  elsif p_action = 'add_guest' then
    -- args: { full_name, phone (+260XXXXXXXXX), party_size, gift_pledge_zmw }
    if length(trim(coalesce(v_args->>'full_name', ''))) not between 2 and 80 then raise exception 'guest name required (2-80 chars)' using errcode = '22023'; end if;
    if coalesce(v_args->>'phone', '') !~ '^\+260(9[5-7]|7[5-7])[0-9]{7}$' then
      raise exception 'phone must be a Zambian mobile: +260 then 95/96/97/75/76/77 and 7 digits' using errcode = '22023';
    end if;
    if exists (select 1 from public.guests where event_id = v_event and phone = v_args->>'phone') then
      raise exception 'a guest with phone % is already on the list', v_args->>'phone' using errcode = '22023';
    end if;
    insert into public.guests (event_id, org_id, full_name, phone, rsvp_status, party_size, guest_group, gift_pledge_zmw, is_manual)
    select v_event, e.org_id, left(trim(v_args->>'full_name'), 80), v_args->>'phone', 'invited',
           least(20, greatest(1, 1 + coalesce((v_args->>'extra_guests')::int, 0))), 'Added live',
           nullif(greatest(0, coalesce((v_args->>'gift_pledge_zmw')::numeric, 0)), 0), true
      from public.events e where e.id = v_event
    returning to_jsonb(guests.*) into v_bridge;
    return jsonb_build_object('guest', v_bridge);

  elsif p_action = 'reset' then
    perform private.restore_seed_event(v_event);
    delete from public.guests where event_id = v_event
       and (is_manual or id::text !~ '^f0000000-0000-4000-8000-0000000000[0-9]{2}$');
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
