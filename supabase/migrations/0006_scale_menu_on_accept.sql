-- 0006: quote_accepted scales every per-guest menu item to the accepted guest_count
-- (quotes without a menu array, e.g. WoodlandsCatererBot's live quote, previously left items at 120).
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

    -- per-guest items not explicitly quantified in the payload scale with the accepted headcount
    if (v_payload->>'guest_count') is not null then
      update public.menu_items m
         set quantity = ceil((v_payload->>'guest_count')::numeric * m.per_guest)
       where m.event_id = v_event and m.per_guest is not null
         and not exists (select 1 from jsonb_array_elements(coalesce(v_payload->'menu', '[]'::jsonb)) x
                          where (x->>'quantity') is not null and (m.id::text = x->>'id' or lower(m.name) = lower(x->>'name')));
      get diagnostics v_n = row_count;
      v_updated := v_updated + v_n;
    end if;

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
