-- =====================================================================
-- Kitchen Party OS — 0001_init.sql
-- Multi-tenant event planner (hosts + vendors as orgs), FUUD HOUSE-style
-- org_id scoping with RLS. Target: Supabase Postgres 15+.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.org_type        as enum ('host', 'vendor');
create type public.member_role     as enum ('owner', 'admin', 'staff');
create type public.event_type      as enum ('kitchen_party', 'wedding', 'corporate', 'birthday', 'other');
create type public.event_status    as enum ('draft', 'planning', 'confirmed', 'completed', 'cancelled');
create type public.vendor_category as enum ('catering', 'cake', 'decor', 'tents_chairs', 'sound_dj', 'mc', 'photography', 'transport', 'drinks', 'other');
create type public.menu_category   as enum ('staple', 'relish', 'protein', 'vegetable', 'snack', 'dessert', 'cake', 'drink', 'other');
create type public.booking_status  as enum ('proposed', 'requested', 'confirmed', 'declined', 'cancelled');
create type public.rsvp_status     as enum ('invited', 'confirmed', 'maybe', 'declined');
create type public.payment_purpose as enum ('deposit', 'balance', 'vendor_payout', 'other');
create type public.payment_status  as enum ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled');
create type public.revision_kind   as enum ('initial', 'revision');

-- ---------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------
create table public.orgs (
  id          uuid primary key default gen_random_uuid(),
  type        public.org_type not null,
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  phone       text check (phone is null or phone ~ '^\+260[0-9]{9}$'),
  email       text,
  area        text,                          -- e.g. Woodlands, Kabulonga, Roma, Chelston
  city        text not null default 'Lusaka',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.org_members (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ---------------------------------------------------------------------
-- RLS helpers (SECURITY DEFINER so policies don't recurse on org_members)
-- ---------------------------------------------------------------------
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

-- When an authenticated user creates an org, make them its owner.
create or replace function public.handle_new_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    insert into public.org_members (org_id, user_id, role)
    values (new.id, (select auth.uid()), 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Vendors (a vendor org's public profile + catalog)
-- ---------------------------------------------------------------------
create table public.vendors (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null unique references public.orgs(id) on delete cascade,
  display_name   text not null,
  category       public.vendor_category not null,
  service_areas  text[] not null default '{}',
  whatsapp       text check (whatsapp is null or whatsapp ~ '^\+260[0-9]{9}$'),
  rating         numeric(2,1) check (rating between 0 and 5),
  bio            text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.vendor_catalog_items (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references public.vendors(id) on delete cascade,
  org_id         uuid not null references public.orgs(id) on delete cascade, -- denormalised vendor org for RLS
  name           text not null,
  category       public.menu_category,
  unit           text not null,                       -- 'plate', 'kg', 'tray', 'tier', 'chair', 'day'
  price_zmw      numeric(12,2) not null check (price_zmw >= 0),
  min_qty        numeric(10,2) not null default 1,
  serves         integer,                             -- people served per unit, if applicable
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------
create table public.events (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id) on delete cascade, -- host org
  title                text not null,
  event_type           public.event_type not null default 'kitchen_party',
  status               public.event_status not null default 'draft',
  starts_at            timestamptz,
  ends_at              timestamptz,
  venue                text,
  area                 text,
  guest_target         integer not null default 0 check (guest_target >= 0),
  budget_zmw           numeric(12,2) check (budget_zmw >= 0),
  brief                text,
  current_revision_id  uuid,   -- FK added after plan_revisions
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.event_vendors (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  org_id        uuid not null references public.orgs(id) on delete cascade, -- host org (denormalised)
  vendor_id     uuid not null references public.vendors(id) on delete restrict,
  service       public.vendor_category not null,
  status        public.booking_status not null default 'proposed',
  quoted_zmw    numeric(12,2) check (quoted_zmw >= 0),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, vendor_id, service)
);

-- Vendor-side access helper: is the current user a member of a vendor booked on this event?
create or replace function public.is_event_vendor(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_vendors ev
    join public.vendors v on v.id = ev.vendor_id
    join public.org_members m on m.org_id = v.org_id
    where ev.event_id = p_event_id
      and ev.status in ('requested', 'confirmed')
      and m.user_id = (select auth.uid())
  );
$$;

create table public.menu_items (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  org_id           uuid not null references public.orgs(id) on delete cascade, -- host org
  vendor_id        uuid references public.vendors(id) on delete set null,
  name             text not null,
  category         public.menu_category not null default 'other',
  quantity         numeric(10,2) not null default 0 check (quantity >= 0),
  unit             text not null default 'portion',
  per_guest        numeric(10,3),                 -- e.g. 0.25 kg/guest
  unit_cost_zmw    numeric(12,2) check (unit_cost_zmw >= 0),
  total_cost_zmw   numeric(12,2) generated always as (round(quantity * coalesce(unit_cost_zmw, 0), 2)) stored,
  notes            text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.guests (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id) on delete cascade,
  org_id         uuid not null references public.orgs(id) on delete cascade, -- host org
  full_name      text not null,
  phone          text check (phone is null or phone ~ '^\+260[0-9]{9}$'),
  rsvp_status    public.rsvp_status not null default 'invited',
  party_size     integer not null default 1 check (party_size between 1 and 20),
  guest_group    text,             -- 'Bride''s family', 'Groom''s side', 'Church', 'Work'
  dietary_notes  text,
  checked_in_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (event_id, phone)
);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  org_id          uuid not null references public.orgs(id) on delete cascade, -- host org (payer)
  vendor_id       uuid references public.vendors(id) on delete set null,     -- payee, if vendor deposit
  purpose         public.payment_purpose not null default 'deposit',
  amount_zmw      numeric(12,2) not null check (amount_zmw > 0),
  currency        text not null default 'ZMW' check (currency = 'ZMW'),
  status          public.payment_status not null default 'pending',
  provider        text not null default 'elicate_pay',
  provider_ref    text unique,          -- Elicate Pay transaction reference
  payer_phone     text check (payer_phone is null or payer_phone ~ '^\+260[0-9]{9}$'),
  payer_network   text,                 -- 'mtn' | 'airtel' | 'zamtel' (informational)
  raw_payload     jsonb,                -- last webhook payload (service role only writes)
  paid_at         timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.plan_revisions (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  org_id        uuid not null references public.orgs(id) on delete cascade, -- host org
  revision_no   integer not null check (revision_no >= 1), -- auto-filled by trigger when omitted
  kind          public.revision_kind not null default 'initial',
  instruction   text,                 -- brief or delta ("15 extra guests")
  plan          jsonb not null,       -- validated planner JSON (see prompts/planner.md)
  guest_count   integer,
  total_zmw     numeric(12,2),
  model         text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, revision_no)
);

alter table public.events
  add constraint events_current_revision_fk
  foreign key (current_revision_id) references public.plan_revisions(id) on delete set null;

-- Auto-number revisions per event.
create or replace function public.next_revision_no()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revision_no is null then
    select coalesce(max(revision_no), 0) + 1 into new.revision_no
    from public.plan_revisions where event_id = new.event_id;
  end if;
  return new;
end;
$$;

-- Guard: denormalised org_id must match the parent event's host org.
create or replace function public.enforce_event_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.events where id = new.event_id;
  if v_org is null then
    raise exception 'event % not found', new.event_id;
  end if;
  if new.org_id is null then
    new.org_id := v_org;
  elsif new.org_id <> v_org then
    raise exception 'org_id % does not match event host org %', new.org_id, v_org;
  end if;
  return new;
end;
$$;

-- Guard: catalog org_id must match vendor's org.
create or replace function public.enforce_vendor_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.vendors where id = new.vendor_id;
  if new.org_id is null then new.org_id := v_org;
  elsif new.org_id <> v_org then
    raise exception 'org_id does not match vendor org';
  end if;
  return new;
end;
$$;

-- Live headcount view (security_invoker so RLS of guests applies)
create view public.event_headcount
with (security_invoker = true) as
select
  e.id as event_id,
  e.org_id,
  e.guest_target,
  coalesce(sum(g.party_size) filter (where g.rsvp_status = 'confirmed'), 0)::int as confirmed,
  coalesce(sum(g.party_size) filter (where g.rsvp_status = 'maybe'), 0)::int     as maybe,
  coalesce(sum(g.party_size) filter (where g.rsvp_status = 'invited'), 0)::int   as pending,
  coalesce(sum(g.party_size) filter (where g.rsvp_status = 'declined'), 0)::int  as declined,
  coalesce(sum(g.party_size), 0)::int as invited_total
from public.events e
left join public.guests g on g.event_id = e.id
group by e.id;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['orgs','org_members','vendors','vendor_catalog_items','events',
                           'event_vendors','menu_items','guests','payments','plan_revisions']
  loop
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array['event_vendors','menu_items','guests','payments','plan_revisions']
  loop
    execute format('create trigger trg_%1$s_event_org before insert or update of event_id, org_id on public.%1$I
                    for each row execute function public.enforce_event_org()', t);
  end loop;
end $$;

create trigger trg_orgs_owner after insert on public.orgs
  for each row execute function public.handle_new_org();
create trigger trg_catalog_vendor_org before insert or update of vendor_id, org_id on public.vendor_catalog_items
  for each row execute function public.enforce_vendor_org();
create trigger trg_plan_revisions_no before insert on public.plan_revisions
  for each row execute function public.next_revision_no();


-- ---------------------------------------------------------------------
-- Indexes (FKs + hot filters)
-- ---------------------------------------------------------------------
create index idx_org_members_user        on public.org_members (user_id);
create index idx_vendors_category        on public.vendors (category) where is_active;
create index idx_vendors_areas           on public.vendors using gin (service_areas);
create index idx_catalog_vendor          on public.vendor_catalog_items (vendor_id) where is_active;
create index idx_catalog_org             on public.vendor_catalog_items (org_id);
create index idx_events_org_starts       on public.events (org_id, starts_at desc);
create index idx_events_current_rev      on public.events (current_revision_id);
create index idx_event_vendors_event     on public.event_vendors (event_id);
create index idx_event_vendors_vendor    on public.event_vendors (vendor_id, status);
create index idx_event_vendors_org       on public.event_vendors (org_id);
create index idx_menu_items_event        on public.menu_items (event_id, sort_order);
create index idx_menu_items_org          on public.menu_items (org_id);
create index idx_menu_items_vendor       on public.menu_items (vendor_id);
create index idx_guests_event_status     on public.guests (event_id, rsvp_status);
create index idx_guests_org              on public.guests (org_id);
create index idx_payments_event          on public.payments (event_id, created_at desc);
create index idx_payments_org            on public.payments (org_id);
create index idx_payments_vendor         on public.payments (vendor_id);
create index idx_payments_status         on public.payments (status) where status in ('pending','processing');
create index idx_plan_revisions_event    on public.plan_revisions (event_id, revision_no desc);
create index idx_plan_revisions_org      on public.plan_revisions (org_id);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.orgs                 enable row level security;
alter table public.org_members          enable row level security;
alter table public.vendors              enable row level security;
alter table public.vendor_catalog_items enable row level security;
alter table public.events               enable row level security;
alter table public.event_vendors        enable row level security;
alter table public.menu_items           enable row level security;
alter table public.guests               enable row level security;
alter table public.payments             enable row level security;
alter table public.plan_revisions       enable row level security;

-- orgs: members see their org; vendor orgs are a public directory for signed-in hosts
create policy orgs_select on public.orgs for select to authenticated
  using (public.is_org_member(id) or type = 'vendor');
create policy orgs_insert on public.orgs for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy orgs_update on public.orgs for update to authenticated
  using (public.has_org_role(id, array['owner','admin']::public.member_role[]))
  with check (public.has_org_role(id, array['owner','admin']::public.member_role[]));
create policy orgs_delete on public.orgs for delete to authenticated
  using (public.has_org_role(id, array['owner']::public.member_role[]));

-- org_members
create policy org_members_select on public.org_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_member(org_id));
create policy org_members_insert on public.org_members for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin']::public.member_role[]));
create policy org_members_update on public.org_members for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.member_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.member_role[]));
create policy org_members_delete on public.org_members for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.member_role[]) or user_id = (select auth.uid()));

-- vendors + catalog: directory readable by any signed-in user; writable by the vendor org
create policy vendors_select on public.vendors for select to authenticated
  using (is_active or public.is_org_member(org_id));
create policy vendors_write on public.vendors for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create policy catalog_select on public.vendor_catalog_items for select to authenticated
  using (is_active or public.is_org_member(org_id));
create policy catalog_write on public.vendor_catalog_items for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- events: host org full access; booked vendors read-only
create policy events_host_all on public.events for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy events_vendor_select on public.events for select to authenticated
  using (public.is_event_vendor(id));

-- event_vendors: host full; vendor sees + updates (accept/decline) its own bookings
create policy event_vendors_host_all on public.event_vendors for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy event_vendors_vendor_select on public.event_vendors for select to authenticated
  using (exists (select 1 from public.vendors v where v.id = vendor_id and public.is_org_member(v.org_id)));
create policy event_vendors_vendor_update on public.event_vendors for update to authenticated
  using (exists (select 1 from public.vendors v where v.id = vendor_id and public.is_org_member(v.org_id)))
  with check (exists (select 1 from public.vendors v where v.id = vendor_id and public.is_org_member(v.org_id)));

-- menu_items: host full; booked vendors read (caterer needs quantities)
create policy menu_items_host_all on public.menu_items for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy menu_items_vendor_select on public.menu_items for select to authenticated
  using (public.is_event_vendor(event_id));

-- guests: host only (guest phone numbers are private)
create policy guests_host_all on public.guests for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- payments: host reads + creates pending intents; status changes come from the
-- Elicate webhook via service_role (bypasses RLS). Payee vendor can read.
create policy payments_host_select on public.payments for select to authenticated
  using (public.is_org_member(org_id));
create policy payments_host_insert on public.payments for insert to authenticated
  with check (public.is_org_member(org_id) and status = 'pending' and paid_at is null and raw_payload is null);
create policy payments_vendor_select on public.payments for select to authenticated
  using (vendor_id is not null and exists (
    select 1 from public.vendors v where v.id = vendor_id and public.is_org_member(v.org_id)));

-- plan_revisions: host only; append-only from the client (no update/delete policy)
create policy plan_revisions_host_select on public.plan_revisions for select to authenticated
  using (public.is_org_member(org_id));
create policy plan_revisions_host_insert on public.plan_revisions for insert to authenticated
  with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- Grants (Supabase defaults usually cover these; explicit for clarity)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on public.event_headcount to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.is_org_member(uuid), public.has_org_role(uuid, public.member_role[]),
  public.is_event_vendor(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
alter table public.guests         replica identity full;
alter table public.payments       replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table
  public.guests, public.events, public.payments, public.plan_revisions;
