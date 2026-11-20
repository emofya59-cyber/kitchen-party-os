-- Reset the hosted demo event to its pre-negotiation state (run before a judge demo).
delete from public.agent_bridge
 where event_id = 'e0000000-0000-4000-8000-000000000001'
   and id not in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002');
update public.agent_bridge set status = 'pending' where id = 'b1000000-0000-4000-8000-000000000002';
update public.menu_items set quantity = 120 where event_id = 'e0000000-0000-4000-8000-000000000001' and per_guest is not null;
update public.events set guest_target = 120, budget_zmw = 25000 where id = 'e0000000-0000-4000-8000-000000000001';
update public.event_vendors set quoted_zmw = 15480, status = 'confirmed'
 where event_id = 'e0000000-0000-4000-8000-000000000001' and service = 'catering';
