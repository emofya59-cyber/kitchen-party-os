-- LOCAL VALIDATION ONLY. Simulates Supabase JWT claims and checks tenant isolation.
\set ON_ERROR_STOP on
\echo '--- as host (Natasha) ---'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
select (select count(*) from public.events) as events,
       (select count(*) from public.guests) as guests,
       (select count(*) from public.payments) as payments,
       (select count(*) from public.plan_revisions) as revisions,
       (select count(*) from public.orgs) as visible_orgs;
select confirmed, maybe, pending, declined, invited_total from public.event_headcount;
-- realtime-style update: RSVP flip
update public.guests set rsvp_status = 'confirmed' where full_name like 'Mrs %' and rsvp_status <> 'confirmed';
-- append a revision (revision_no auto-numbered)
insert into public.plan_revisions (event_id, org_id, kind, instruction, plan, guest_count)
values ('e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','revision','15 extra guests','{"version":"1.0"}',135)
returning revision_no;
-- host may create a pending payment but not a succeeded one
insert into public.payments (event_id, org_id, purpose, amount_zmw) values
  ('e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','deposit',500) returning status;
do $$ begin
  insert into public.payments (event_id, org_id, amount_zmw, status)
  values ('e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',500,'succeeded');
  raise exception 'FAIL: host forged a succeeded payment';
exception when insufficient_privilege then raise notice 'OK: forged succeeded payment blocked by RLS';
end $$;

\echo '--- as vendor (Mwape, caterer, confirmed on event) ---'
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
select (select count(*) from public.events) as events,
       (select count(*) from public.menu_items) as menu_items,
       (select count(*) from public.guests) as guests_should_be_0,
       (select count(*) from public.payments) as own_payments,
       (select count(*) from public.plan_revisions) as revisions_should_be_0;

\echo '--- as vendor (Mulenga, tents, only proposed) ---'
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated"}', false);
select (select count(*) from public.events) as events_should_be_0,
       (select count(*) from public.event_vendors) as own_bookings;

\echo '--- as random signed-in user ---'
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000ff","role":"authenticated"}', false);
select (select count(*) from public.events) as events_should_be_0,
       (select count(*) from public.vendors) as vendor_directory,
       (select count(*) from public.vendor_catalog_items) as catalog;
do $$ begin
  insert into public.events (org_id, title) values ('a0000000-0000-4000-8000-000000000001','hijack');
  raise exception 'FAIL: outsider inserted into host org';
exception when insufficient_privilege then raise notice 'OK: cross-tenant insert blocked';
end $$;

reset role;
\echo '--- realtime publication ---'
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
