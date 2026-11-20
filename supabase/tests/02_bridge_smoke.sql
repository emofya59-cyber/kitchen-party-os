\set ON_ERROR_STOP on
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select count(*) as anon_events from public.events;
select count(*) as anon_bridge from public.agent_bridge;
select jsonb_array_length(public.bridge_list('lusaka2026')->'pending') as pending;
do $$ begin perform public.bridge_list('wrong'); raise exception 'FAIL'; exception when sqlstate '28000' then raise notice 'OK: bad key rejected'; end $$;
select public.bridge_post('lusaka2026','HostBot','WoodlandsCatererBot','quote_accepted','Deal, Anna. Accepted.','{}')->'applied' as applied;
reset role;
select guest_target, budget_zmw from public.events;
select status, count(*) from public.agent_bridge group by 1 order by 1;
select name, quantity, total_cost_zmw from public.menu_items order by sort_order limit 3;
select status, quoted_zmw from public.event_vendors where service='catering';
