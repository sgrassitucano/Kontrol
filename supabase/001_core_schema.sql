-- Core schema iniziale per Gestionale Morelli.
-- Applicare il file nel SQL editor di Supabase dopo avere identificato il primo admin.

create extension if not exists pgcrypto;

create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'btree_gist') then
    create extension btree_gist with schema extensions;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_extension e
    where e.extname = 'btree_gist'
      and e.extnamespace = 'public'::regnamespace
  ) then
    alter extension btree_gist set schema extensions;
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_module') then
    create type public.app_module as enum (
      'lavoratori',
      'formazione',
      'sorveglianza',
      'dpi',
      'mezzi_attrezzature',
      'turni',
      'gestione'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'viewer', 'manager');
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  manager_code text,
  role public.user_role not null default 'manager',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add column if not exists role public.user_role;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) then
    alter table public.profiles
      alter column role set default 'manager';
    update public.profiles set role = 'manager' where role is null;
    alter table public.profiles
      alter column role set not null;
  end if;
end
$$;

create table if not exists public.module_permissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  module public.app_module not null,
  can_write boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint module_permissions_user_module_key unique (user_id, module)
);

create table if not exists public.sites (
  id bigint generated always as identity primary key,
  display_name text not null,
  normalized_name text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sub_sites (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.sites(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sub_sites_site_normalized_key unique (site_id, normalized_name)
);

create table if not exists public.employees (
  id bigint generated always as identity primary key,
  matricola text not null unique,
  tax_code text not null unique,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  birth_place text not null,
  responsible_code text not null,
  job_title text not null,
  job_title_notes text,
  phone text,
  mobile text,
  email_primary text,
  email_secondary text,
  referral text,
  theoretical_weekly_minutes integer not null,
  site_id bigint not null references public.sites(id),
  sub_site_id bigint references public.sub_sites(id),
  status text not null default 'attivo' check (status in ('attivo', 'dimesso')),
  last_imported_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.employees
  add column if not exists referral text;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'training_scope_type') then
    create type public.training_scope_type as enum (
      'baseline',
      'job',
      'site',
      'sub_site',
      'employee_override'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'training_rule_source') then
    create type public.training_rule_source as enum (
      'baseline',
      'manual'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'training_link_type') then
    create type public.training_link_type as enum (
      'substitutes',
      'exempts',
      'prerequisite'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_freeze_status') then
    create type public.employee_freeze_status as enum (
      'maternita',
      'infortunio',
      'malattia',
      'distacco_sindacale'
    );
  end if;
end
$$;

create table if not exists public.training_courses (
  id bigint generated always as identity primary key,
  code text not null unique,
  title text not null,
  validity_years integer,
  is_unlimited boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.training_courses (code, title, validity_years, is_unlimited, is_active)
values
  ('FORM_BASE', 'Formazione generale base', 5, false, true),
  ('FORM_SPEC_BASSO', 'Formazione specifica rischio basso', 5, false, true)
on conflict (code) do update
set
  title = excluded.title,
  validity_years = excluded.validity_years,
  is_unlimited = excluded.is_unlimited,
  is_active = excluded.is_active;

create table if not exists public.training_matrix_rules (
  id bigint generated always as identity primary key,
  scope_type public.training_scope_type not null,
  course_id bigint not null references public.training_courses(id) on delete cascade,
  is_required boolean not null default true,
  source public.training_rule_source not null default 'manual',
  job_code_norm text,
  site_id bigint references public.sites(id) on delete cascade,
  sub_site_id bigint references public.sub_sites(id) on delete cascade,
  employee_id bigint references public.employees(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_matrix_rules_scope_check check (
    (scope_type = 'baseline' and job_code_norm is null and site_id is null and sub_site_id is null and employee_id is null) or
    (scope_type = 'job' and job_code_norm is not null and site_id is null and sub_site_id is null and employee_id is null) or
    (scope_type = 'site' and job_code_norm is null and site_id is not null and sub_site_id is null and employee_id is null) or
    (scope_type = 'sub_site' and job_code_norm is null and site_id is null and sub_site_id is not null and employee_id is null) or
    (scope_type = 'employee_override' and job_code_norm is null and site_id is null and sub_site_id is null and employee_id is not null)
  ),
  constraint training_matrix_rules_unique unique (scope_type, course_id, job_code_norm, site_id, sub_site_id, employee_id)
);

insert into public.training_matrix_rules (
  scope_type,
  course_id,
  is_required,
  source,
  job_code_norm,
  site_id,
  sub_site_id,
  employee_id
)
select
  'baseline'::public.training_scope_type as scope_type,
  c.id as course_id,
  true as is_required,
  'baseline'::public.training_rule_source as source,
  null::text as job_code_norm,
  null::bigint as site_id,
  null::bigint as sub_site_id,
  null::bigint as employee_id
from public.training_courses c
where c.code in ('FORM_BASE', 'FORM_SPEC_BASSO')
on conflict do nothing;

create table if not exists public.training_rule_links (
  id bigint generated always as identity primary key,
  from_course_id bigint not null references public.training_courses(id) on delete cascade,
  to_course_id bigint not null references public.training_courses(id) on delete cascade,
  relation_type public.training_link_type not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint training_rule_links_distinct check (from_course_id <> to_course_id),
  constraint training_rule_links_unique unique (from_course_id, to_course_id, relation_type)
);

create table if not exists public.training_employee_courses (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  course_id bigint not null references public.training_courses(id) on delete cascade,
  completion_date date,
  expiry_date date,
  planned_date date,
  manual_state text,
  note text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_employee_courses_unique unique (employee_id, course_id)
);

alter table public.training_employee_courses
  add column if not exists manual_state text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_employee_courses_manual_state_check') then
    alter table public.training_employee_courses
      add constraint training_employee_courses_manual_state_check
      check (manual_state is null or manual_state in ('programmato', 'escluso'));
  end if;
end
$$;

create table if not exists public.employee_freeze_periods (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  freeze_status public.employee_freeze_status not null,
  start_date date not null,
  end_date date,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.training_scope_exclusions (
  id bigint generated always as identity primary key,
  scope_type public.training_scope_type not null,
  site_id bigint references public.sites(id) on delete cascade,
  sub_site_id bigint references public.sub_sites(id) on delete cascade,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_scope_exclusions_scope_check check (
    (scope_type = 'site' and site_id is not null and sub_site_id is null) or
    (scope_type = 'sub_site' and site_id is null and sub_site_id is not null)
  ),
  constraint training_scope_exclusions_unique unique (scope_type, site_id, sub_site_id)
);

create table if not exists public.training_employee_exclusions (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_employee_exclusions_unique unique (employee_id)
);

create table if not exists public.training_employee_course_exclusions (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  course_id bigint not null references public.training_courses(id) on delete cascade,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_employee_course_exclusions_unique unique (employee_id, course_id)
);

create table if not exists public.medical_surveillance_records (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  provider text,
  requires_visit boolean not null default true,
  is_planned boolean not null default false,
  next_due_date date,
  limitations text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint medical_surveillance_records_employee_unique unique (employee_id)
);

create table if not exists public.medical_surveillance_job_rules (
  job_code_norm text primary key,
  always_exempt boolean not null default false,
  exempt_below_weekly_minutes integer,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.medical_surveillance_scope_rules (
  id bigint generated always as identity primary key,
  scope_type public.training_scope_type not null,
  site_id bigint references public.sites(id) on delete cascade,
  sub_site_id bigint references public.sub_sites(id) on delete cascade,
  requires_visit boolean not null default true,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint medical_surveillance_scope_rules_scope_check check (
    (scope_type = 'site' and site_id is not null and sub_site_id is null) or
    (scope_type = 'sub_site' and site_id is null and sub_site_id is not null)
  ),
  constraint medical_surveillance_scope_rules_unique unique (scope_type, site_id, sub_site_id)
);

create table if not exists public.medical_surveillance_provider_assignments (
  id bigint generated always as identity primary key,
  scope_type public.training_scope_type not null,
  site_id bigint references public.sites(id) on delete cascade,
  sub_site_id bigint references public.sub_sites(id) on delete cascade,
  provider text not null,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint medical_surveillance_provider_assignments_scope_check check (
    (scope_type = 'site' and site_id is not null and sub_site_id is null) or
    (scope_type = 'sub_site' and site_id is null and sub_site_id is not null)
  ),
  constraint medical_surveillance_provider_assignments_unique unique (scope_type, site_id, sub_site_id)
);

create table if not exists public.medical_surveillance_employee_exclusions (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint medical_surveillance_employee_exclusions_unique unique (employee_id)
);

create table if not exists public.medical_surveillance_employee_overrides (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  requires_visit boolean not null,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint medical_surveillance_employee_overrides_unique unique (employee_id)
);

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'anagrafica',
  file_name text not null,
  imported_by uuid references public.profiles(id),
  total_rows integer not null default 0,
  processed_rows integer not null default 0,
  error_rows integer not null default 0,
  status text not null default 'preview' check (status in ('preview', 'completed', 'failed')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.import_run_errors (
  id bigint generated always as identity primary key,
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  row_number integer not null,
  matricola text,
  tax_code text,
  last_name text,
  first_name text,
  error_type text not null,
  error_message text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create schema if not exists internal;
revoke all on schema internal from public;
grant usage on schema internal to anon, authenticated, service_role;

drop function if exists public.set_updated_at();
drop function if exists public.handle_new_user();

create or replace function internal.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function internal.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create or replace function internal.current_manager_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.manager_code
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function internal.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role from public.profiles p where p.id = auth.uid()),
    'manager'::public.user_role
  );
$$;

create or replace function internal.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_active from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function internal.has_module_access(
  target_module public.app_module,
  require_write boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when internal.current_user_is_active() = false then false
    when internal.current_user_role() = 'admin' then true
    when internal.current_user_role() = 'viewer' then (require_write = false and target_module <> 'gestione')
    else exists (
      select 1
      from public.module_permissions mp
      where mp.user_id = auth.uid()
        and mp.module = target_module
        and (require_write = false or mp.can_write = true)
    )
  end;
$$;

create or replace function internal.has_any_operational_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when internal.current_user_is_active() = false then false
    when internal.current_user_role() in ('admin', 'viewer') then true
    else exists (
      select 1
      from public.module_permissions mp
      where mp.user_id = auth.uid()
        and mp.module <> 'gestione'
    )
  end;
$$;

create or replace function internal.can_access_employee(
  employee_responsible_code text,
  employee_referral text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when internal.current_user_is_active() = false then false
    when internal.current_user_role() in ('admin', 'viewer') then true
    when internal.has_module_access('gestione') then true
    when coalesce(internal.current_manager_code(), '') = '' then false
    else employee_responsible_code = internal.current_manager_code()
      or coalesce(employee_referral, '') = internal.current_manager_code()
  end;
$$;

create or replace function internal.can_access_employee(employee_responsible_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select internal.can_access_employee(employee_responsible_code, null::text);
$$;

create or replace function internal.can_access_site(target_site_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when internal.current_user_is_active() = false then false
    when internal.current_user_role() in ('admin', 'viewer') then true
    when internal.has_module_access('gestione') then true
    else exists (
      select 1
      from public.employees e
      where e.site_id = target_site_id
        and e.status = 'attivo'
        and internal.can_access_employee(e.responsible_code, e.referral)
    )
  end;
$$;

create or replace function internal.can_access_sub_site(target_sub_site_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when internal.current_user_is_active() = false then false
    when internal.current_user_role() in ('admin', 'viewer') then true
    when internal.has_module_access('gestione') then true
    else exists (
      select 1
      from public.employees e
      where e.sub_site_id = target_sub_site_id
        and e.status = 'attivo'
        and internal.can_access_employee(e.responsible_code, e.referral)
    )
  end;
$$;

grant execute on all functions in schema internal to anon, authenticated, service_role;

create or replace function public.current_manager_code()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select internal.current_manager_code();
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security invoker
set search_path = public
as $$
  select internal.current_user_role();
$$;

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select internal.current_user_is_active();
$$;

create or replace function public.has_module_access(
  target_module public.app_module,
  require_write boolean default false
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select internal.has_module_access(target_module, require_write);
$$;

create or replace function public.has_any_operational_access()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select internal.has_any_operational_access();
$$;

create or replace function public.can_access_employee(
  employee_responsible_code text,
  employee_referral text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select internal.can_access_employee(employee_responsible_code, employee_referral);
$$;

create or replace function public.can_access_employee(employee_responsible_code text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select internal.can_access_employee(employee_responsible_code);
$$;

create or replace function public.can_access_site(target_site_id bigint)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select internal.can_access_site(target_site_id);
$$;

create or replace function public.can_access_sub_site(target_sub_site_id bigint)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select internal.can_access_sub_site(target_sub_site_id);
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure internal.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure internal.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fleet_asset_type') then
    create type public.fleet_asset_type as enum ('mezzo', 'attrezzatura');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fleet_ownership_type') then
    create type public.fleet_ownership_type as enum ('proprieta', 'noleggio');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fleet_asset_status') then
    create type public.fleet_asset_status as enum ('attivo', 'fuori_servizio', 'dismesso');
  end if;
end
$$;

create table if not exists public.fleet_assets (
  id bigint generated always as identity primary key,
  asset_type public.fleet_asset_type not null,
  ownership_type public.fleet_ownership_type not null,
  status public.fleet_asset_status not null default 'attivo',
  category text,
  brand text,
  model text,
  plate text,
  vin text,
  internal_code text,
  serial_number text,
  registration_date date,
  site_id bigint references public.sites(id) on delete set null,
  sub_site_id bigint references public.sub_sites(id) on delete set null,
  rental_supplier text,
  rental_start_date date,
  rental_end_date date,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint fleet_assets_plate_unique unique (plate),
  constraint fleet_assets_internal_code_unique unique (internal_code)
);

create table if not exists public.fleet_obligation_types (
  id bigint generated always as identity primary key,
  code text not null unique,
  label text not null,
  asset_type public.fleet_asset_type,
  default_period_months integer,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fleet_asset_obligations (
  id bigint generated always as identity primary key,
  asset_id bigint not null references public.fleet_assets(id) on delete cascade,
  obligation_type_id bigint not null references public.fleet_obligation_types(id) on delete restrict,
  last_done_date date,
  next_due_date date,
  vendor text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint fleet_asset_obligations_unique unique (asset_id, obligation_type_id)
);

create table if not exists public.fleet_obligation_events (
  id bigint generated always as identity primary key,
  asset_obligation_id bigint not null references public.fleet_asset_obligations(id) on delete cascade,
  event_date date not null,
  note text,
  document_ref text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fleet_asset_assignments (
  id bigint generated always as identity primary key,
  asset_id bigint not null references public.fleet_assets(id) on delete cascade,
  employee_id bigint not null references public.employees(id) on delete cascade,
  start_date date not null,
  end_date date,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.fleet_obligation_types (code, label, asset_type, default_period_months)
values
  ('REVISIONE', 'Revisione', 'mezzo', null),
  ('ASSICURAZIONE', 'Assicurazione', 'mezzo', 12),
  ('BOLLO', 'Bollo', 'mezzo', 12),
  ('TAGLIANDO', 'Tagliando', 'mezzo', null),
  ('MANUTENZIONE', 'Manutenzione', null, null),
  ('VERIFICA_INAIL', 'Verifica periodica INAIL (Allegato VII)', 'attrezzatura', null),
  ('CONTROLLO_FUNI_CATENE', 'Controllo periodico funi/catene', 'attrezzatura', null)
on conflict (code) do update
set
  label = excluded.label,
  asset_type = excluded.asset_type,
  default_period_months = excluded.default_period_months,
  is_active = true;

drop trigger if exists fleet_assets_set_updated_at on public.fleet_assets;
create trigger fleet_assets_set_updated_at
  before update on public.fleet_assets
  for each row execute procedure internal.set_updated_at();

drop trigger if exists fleet_obligation_types_set_updated_at on public.fleet_obligation_types;
create trigger fleet_obligation_types_set_updated_at
  before update on public.fleet_obligation_types
  for each row execute procedure internal.set_updated_at();

drop trigger if exists fleet_asset_obligations_set_updated_at on public.fleet_asset_obligations;
create trigger fleet_asset_obligations_set_updated_at
  before update on public.fleet_asset_obligations
  for each row execute procedure internal.set_updated_at();

drop trigger if exists fleet_asset_assignments_set_updated_at on public.fleet_asset_assignments;
create trigger fleet_asset_assignments_set_updated_at
  before update on public.fleet_asset_assignments
  for each row execute procedure internal.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'dpi_scope_type') then
    create type public.dpi_scope_type as enum ('baseline', 'job', 'site', 'sub_site', 'employee_override');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'dpi_rule_source') then
    create type public.dpi_rule_source as enum ('baseline', 'manual', 'import');
  end if;
end
$$;

create table if not exists public.dpi_items (
  id bigint generated always as identity primary key,
  title text not null unique,
  risk_activities text,
  category text,
  control_frequency text,
  control_type text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dpi_matrix_rules (
  id bigint generated always as identity primary key,
  scope_type public.dpi_scope_type not null,
  dpi_id bigint not null references public.dpi_items(id) on delete cascade,
  is_required boolean not null default true,
  source public.dpi_rule_source not null default 'manual',
  job_code_norm text,
  site_id bigint references public.sites(id) on delete cascade,
  sub_site_id bigint references public.sub_sites(id) on delete cascade,
  employee_id bigint references public.employees(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint dpi_matrix_rules_scope_check check (
    (scope_type = 'baseline' and job_code_norm is null and site_id is null and sub_site_id is null and employee_id is null) or
    (scope_type = 'job' and job_code_norm is not null and site_id is null and sub_site_id is null and employee_id is null) or
    (scope_type = 'site' and job_code_norm is null and site_id is not null and sub_site_id is null and employee_id is null) or
    (scope_type = 'sub_site' and job_code_norm is null and site_id is null and sub_site_id is not null and employee_id is null) or
    (scope_type = 'employee_override' and job_code_norm is null and site_id is null and sub_site_id is null and employee_id is not null)
  ),
  constraint dpi_matrix_rules_unique unique (scope_type, dpi_id, job_code_norm, site_id, sub_site_id, employee_id)
);

create table if not exists public.dpi_employee_items (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  dpi_id bigint not null references public.dpi_items(id) on delete cascade,
  delivered_date date,
  planned_date date,
  last_check_date date,
  next_check_date date,
  note text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint dpi_employee_items_unique unique (employee_id, dpi_id)
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'turni_shift_state') then
    create type public.turni_shift_state as enum ('planned', 'actual', 'cancelled');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'turni_shift_source') then
    create type public.turni_shift_source as enum ('template', 'manual', 'import');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'turni_absence_type') then
    create type public.turni_absence_type as enum ('ferie', 'malattia', 'permesso', 'infortunio', 'altro');
  end if;
end
$$;

create table if not exists public.turni_site_templates (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.sites(id) on delete cascade,
  sub_site_id bigint references public.sub_sites(id) on delete cascade,
  name text not null,
  valid_from date not null,
  valid_to date,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint turni_site_templates_valid_range check (valid_to is null or valid_to >= valid_from)
);

alter table public.turni_site_templates
  add column if not exists sub_site_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'turni_site_templates_sub_site_id_fkey') then
    alter table public.turni_site_templates
      add constraint turni_site_templates_sub_site_id_fkey
      foreign key (sub_site_id) references public.sub_sites(id) on delete cascade;
  end if;
end
$$;

create table if not exists public.turni_site_template_slots (
  id bigint generated always as identity primary key,
  template_id bigint not null references public.turni_site_templates(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint turni_template_slot_times check (end_time > start_time),
  constraint turni_template_slot_break_quarter check (break_minutes % 15 = 0 and break_minutes >= 0)
);

create table if not exists public.turni_employee_site_assignments (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  site_id bigint not null references public.sites(id) on delete cascade,
  sub_site_id bigint references public.sub_sites(id) on delete set null,
  start_date date not null,
  end_date date,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint turni_employee_site_assignments_valid_range check (end_date is null or end_date >= start_date)
);

alter table public.turni_employee_site_assignments
  add column if not exists sub_site_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'turni_employee_site_assignments_sub_site_id_fkey') then
    alter table public.turni_employee_site_assignments
      add constraint turni_employee_site_assignments_sub_site_id_fkey
      foreign key (sub_site_id) references public.sub_sites(id) on delete set null;
  end if;
end
$$;

create table if not exists public.turni_employee_shifts (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  site_id bigint not null references public.sites(id) on delete restrict,
  sub_site_id bigint references public.sub_sites(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  state public.turni_shift_state not null default 'planned',
  source public.turni_shift_source not null default 'manual',
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint turni_shift_range check (end_at > start_at),
  constraint turni_shift_quarter check (
    extract(second from start_at) = 0 and extract(second from end_at) = 0
    and (extract(minute from start_at)::int % 15) = 0
    and (extract(minute from end_at)::int % 15) = 0
  )
);

alter table public.turni_employee_shifts
  add column if not exists sub_site_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'turni_employee_shifts_sub_site_id_fkey') then
    alter table public.turni_employee_shifts
      add constraint turni_employee_shifts_sub_site_id_fkey
      foreign key (sub_site_id) references public.sub_sites(id) on delete set null;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'turni_employee_shifts_no_overlap') then
    null;
  else
    if exists (select 1 from pg_class where relname = 'turni_employee_shifts_no_overlap') then
      execute 'drop index if exists public.turni_employee_shifts_no_overlap';
    end if;

    alter table public.turni_employee_shifts
      add constraint turni_employee_shifts_no_overlap
      exclude using gist (
        employee_id with =,
        tstzrange(start_at, end_at, '[)') with &&
      )
      where (state <> 'cancelled');
  end if;
end
$$;

create table if not exists public.turni_shift_breaks (
  id bigint generated always as identity primary key,
  shift_id bigint not null references public.turni_employee_shifts(id) on delete cascade,
  break_start_at timestamptz not null,
  break_end_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint turni_break_range check (break_end_at > break_start_at),
  constraint turni_break_quarter check (
    extract(second from break_start_at) = 0 and extract(second from break_end_at) = 0
    and (extract(minute from break_start_at)::int % 15) = 0
    and (extract(minute from break_end_at)::int % 15) = 0
  )
);

create table if not exists public.turni_employee_absences (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  absence_type public.turni_absence_type not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint turni_absence_range check (end_at > start_at)
);

create table if not exists public.turni_month_locks (
  id bigint generated always as identity primary key,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  locked_at timestamptz not null default timezone('utc', now()),
  locked_by uuid references public.profiles(id),
  note text,
  constraint turni_month_locks_unique unique (year, month)
);

create table if not exists public.turni_site_month_targets (
  id bigint generated always as identity primary key,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  site_id bigint not null references public.sites(id) on delete cascade,
  sub_site_id bigint references public.sub_sites(id) on delete cascade,
  theoretical_minutes integer not null check (theoretical_minutes >= 0),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint turni_site_month_targets_unique unique (year, month, site_id, sub_site_id)
);

drop trigger if exists module_permissions_set_updated_at on public.module_permissions;
create trigger module_permissions_set_updated_at
  before update on public.module_permissions
  for each row execute procedure internal.set_updated_at();

drop trigger if exists sites_set_updated_at on public.sites;
create trigger sites_set_updated_at
  before update on public.sites
  for each row execute procedure internal.set_updated_at();

drop trigger if exists sub_sites_set_updated_at on public.sub_sites;
create trigger sub_sites_set_updated_at
  before update on public.sub_sites
  for each row execute procedure internal.set_updated_at();

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
  before update on public.employees
  for each row execute procedure internal.set_updated_at();

alter table public.profiles enable row level security;
alter table public.module_permissions enable row level security;
alter table public.sites enable row level security;
alter table public.sub_sites enable row level security;
alter table public.employees enable row level security;
alter table public.fleet_assets enable row level security;
alter table public.fleet_obligation_types enable row level security;
alter table public.fleet_asset_obligations enable row level security;
alter table public.fleet_obligation_events enable row level security;
alter table public.fleet_asset_assignments enable row level security;
alter table public.import_runs enable row level security;
alter table public.import_run_errors enable row level security;
alter table public.training_courses enable row level security;
alter table public.training_matrix_rules enable row level security;
alter table public.training_rule_links enable row level security;
alter table public.training_employee_courses enable row level security;
alter table public.employee_freeze_periods enable row level security;
alter table public.training_scope_exclusions enable row level security;
alter table public.training_employee_exclusions enable row level security;
alter table public.training_employee_course_exclusions enable row level security;
alter table public.medical_surveillance_records enable row level security;
alter table public.medical_surveillance_job_rules enable row level security;
alter table public.medical_surveillance_scope_rules enable row level security;
alter table public.medical_surveillance_provider_assignments enable row level security;
alter table public.medical_surveillance_employee_exclusions enable row level security;
alter table public.medical_surveillance_employee_overrides enable row level security;
alter table public.dpi_items enable row level security;
alter table public.dpi_matrix_rules enable row level security;
alter table public.dpi_employee_items enable row level security;
alter table public.turni_site_templates enable row level security;
alter table public.turni_site_template_slots enable row level security;
alter table public.turni_employee_site_assignments enable row level security;
alter table public.turni_employee_shifts enable row level security;
alter table public.turni_shift_breaks enable row level security;
alter table public.turni_employee_absences enable row level security;
alter table public.turni_month_locks enable row level security;
alter table public.turni_site_month_targets enable row level security;

drop policy if exists "profiles_select_own_or_management" on public.profiles;
create policy "profiles_select_own_or_management"
  on public.profiles
  for select
  using ((select auth.uid()) = id or public.has_module_access('gestione'));

drop policy if exists "profiles_update_management_only" on public.profiles;
create policy "profiles_update_management_only"
  on public.profiles
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "module_permissions_select_own_or_management" on public.module_permissions;
create policy "module_permissions_select_own_or_management"
  on public.module_permissions
  for select
  using ((select auth.uid()) = user_id or public.has_module_access('gestione'));

drop policy if exists "module_permissions_write_management_only" on public.module_permissions;
create policy "module_permissions_write_management_only"
  on public.module_permissions
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "sites_read_for_operational_modules" on public.sites;
create policy "sites_read_for_operational_modules"
  on public.sites
  for select
  using (
    (public.has_any_operational_access() or public.has_module_access('gestione'))
    and public.can_access_site(id)
  );

drop policy if exists "sites_write_management_only" on public.sites;
create policy "sites_write_management_only"
  on public.sites
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "sub_sites_read_for_operational_modules" on public.sub_sites;
create policy "sub_sites_read_for_operational_modules"
  on public.sub_sites
  for select
  using (
    (public.has_any_operational_access() or public.has_module_access('gestione'))
    and public.can_access_sub_site(id)
  );

drop policy if exists "sub_sites_write_management_only" on public.sub_sites;
create policy "sub_sites_write_management_only"
  on public.sub_sites
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "employees_read_by_scope" on public.employees;
create policy "employees_read_by_scope"
  on public.employees
  for select
  using (
    (public.has_any_operational_access() or public.has_module_access('gestione'))
    and public.can_access_employee(responsible_code, referral)
  );

drop policy if exists "employees_write_management_only" on public.employees;
drop policy if exists "employees_insert_management_only" on public.employees;
drop policy if exists "employees_update_management_only" on public.employees;
drop policy if exists "employees_delete_management_only" on public.employees;

create policy "employees_insert_management_only"
  on public.employees
  for insert
  with check (public.has_module_access('gestione', true));

create policy "employees_update_management_only"
  on public.employees
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

create policy "employees_delete_management_only"
  on public.employees
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "fleet_assets_read" on public.fleet_assets;
create policy "fleet_assets_read"
  on public.fleet_assets
  for select
  using (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'));

drop policy if exists "fleet_assets_write" on public.fleet_assets;
create policy "fleet_assets_write"
  on public.fleet_assets
  for all
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

drop policy if exists "fleet_obligation_types_read" on public.fleet_obligation_types;
create policy "fleet_obligation_types_read"
  on public.fleet_obligation_types
  for select
  using (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'));

drop policy if exists "fleet_obligation_types_write" on public.fleet_obligation_types;
create policy "fleet_obligation_types_write"
  on public.fleet_obligation_types
  for all
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

drop policy if exists "fleet_asset_obligations_read" on public.fleet_asset_obligations;
create policy "fleet_asset_obligations_read"
  on public.fleet_asset_obligations
  for select
  using (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'));

drop policy if exists "fleet_asset_obligations_write" on public.fleet_asset_obligations;
create policy "fleet_asset_obligations_write"
  on public.fleet_asset_obligations
  for all
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

drop policy if exists "fleet_obligation_events_read" on public.fleet_obligation_events;
create policy "fleet_obligation_events_read"
  on public.fleet_obligation_events
  for select
  using (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'));

drop policy if exists "fleet_obligation_events_write" on public.fleet_obligation_events;
create policy "fleet_obligation_events_write"
  on public.fleet_obligation_events
  for all
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

drop policy if exists "fleet_asset_assignments_read" on public.fleet_asset_assignments;
create policy "fleet_asset_assignments_read"
  on public.fleet_asset_assignments
  for select
  using (public.has_module_access('gestione') or public.has_module_access('mezzi_attrezzature'));

drop policy if exists "fleet_asset_assignments_write" on public.fleet_asset_assignments;
drop policy if exists "fleet_asset_assignments_insert" on public.fleet_asset_assignments;
drop policy if exists "fleet_asset_assignments_update" on public.fleet_asset_assignments;
drop policy if exists "fleet_asset_assignments_delete" on public.fleet_asset_assignments;

create policy "fleet_asset_assignments_insert"
  on public.fleet_asset_assignments
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_asset_assignments_update"
  on public.fleet_asset_assignments
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_asset_assignments_delete"
  on public.fleet_asset_assignments
  for delete
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

drop policy if exists "training_courses_read_operational" on public.training_courses;
create policy "training_courses_read_operational"
  on public.training_courses
  for select
  using (
    public.has_module_access('gestione')
    or public.has_module_access('formazione')
    or public.has_module_access('lavoratori')
  );

drop policy if exists "training_courses_write_management_only" on public.training_courses;
create policy "training_courses_write_management_only"
  on public.training_courses
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "training_matrix_rules_read_operational" on public.training_matrix_rules;
create policy "training_matrix_rules_read_operational"
  on public.training_matrix_rules
  for select
  using (
    public.has_module_access('gestione')
    or public.has_module_access('formazione')
    or public.has_module_access('lavoratori')
  );

drop policy if exists "training_matrix_rules_write_management_only" on public.training_matrix_rules;
create policy "training_matrix_rules_write_management_only"
  on public.training_matrix_rules
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "training_rule_links_read_operational" on public.training_rule_links;
create policy "training_rule_links_read_operational"
  on public.training_rule_links
  for select
  using (
    public.has_module_access('gestione')
    or public.has_module_access('formazione')
    or public.has_module_access('lavoratori')
  );

drop policy if exists "training_rule_links_write_management_only" on public.training_rule_links;
create policy "training_rule_links_write_management_only"
  on public.training_rule_links
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "training_employee_courses_read_by_scope" on public.training_employee_courses;
create policy "training_employee_courses_read_by_scope"
  on public.training_employee_courses
  for select
  using (
    public.has_module_access('gestione')
    or (
      (public.has_module_access('formazione') or public.has_module_access('lavoratori'))
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "training_employee_courses_write_management_only" on public.training_employee_courses;
drop policy if exists "training_employee_courses_write_formazione" on public.training_employee_courses;
create policy "training_employee_courses_write_formazione"
  on public.training_employee_courses
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('formazione', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('formazione', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );



drop policy if exists "dpi_items_read_operational" on public.dpi_items;
create policy "dpi_items_read_operational"
  on public.dpi_items
  for select
  using (public.has_module_access('gestione') or public.has_module_access('dpi') or public.has_module_access('lavoratori'));

drop policy if exists "dpi_items_write_management_only" on public.dpi_items;
drop policy if exists "dpi_items_insert_management_only" on public.dpi_items;
drop policy if exists "dpi_items_update_management_only" on public.dpi_items;
drop policy if exists "dpi_items_delete_management_only" on public.dpi_items;

create policy "dpi_items_insert_management_only"
  on public.dpi_items
  for insert
  with check (public.has_module_access('gestione', true));

create policy "dpi_items_update_management_only"
  on public.dpi_items
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

create policy "dpi_items_delete_management_only"
  on public.dpi_items
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "dpi_matrix_rules_read_operational" on public.dpi_matrix_rules;
create policy "dpi_matrix_rules_read_operational"
  on public.dpi_matrix_rules
  for select
  using (public.has_module_access('gestione') or public.has_module_access('dpi') or public.has_module_access('lavoratori'));

drop policy if exists "dpi_matrix_rules_write_management_only" on public.dpi_matrix_rules;
drop policy if exists "dpi_matrix_rules_insert_management_only" on public.dpi_matrix_rules;
drop policy if exists "dpi_matrix_rules_update_management_only" on public.dpi_matrix_rules;
drop policy if exists "dpi_matrix_rules_delete_management_only" on public.dpi_matrix_rules;

create policy "dpi_matrix_rules_insert_management_only"
  on public.dpi_matrix_rules
  for insert
  with check (public.has_module_access('gestione', true));

create policy "dpi_matrix_rules_update_management_only"
  on public.dpi_matrix_rules
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

create policy "dpi_matrix_rules_delete_management_only"
  on public.dpi_matrix_rules
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "dpi_employee_items_read_by_scope" on public.dpi_employee_items;
create policy "dpi_employee_items_read_by_scope"
  on public.dpi_employee_items
  for select
  using (
    public.has_module_access('gestione')
    or (
      (public.has_module_access('dpi') or public.has_module_access('lavoratori'))
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "dpi_employee_items_write_management_only" on public.dpi_employee_items;
drop policy if exists "dpi_employee_items_insert_management_only" on public.dpi_employee_items;
drop policy if exists "dpi_employee_items_update_management_only" on public.dpi_employee_items;
drop policy if exists "dpi_employee_items_delete_management_only" on public.dpi_employee_items;

create policy "dpi_employee_items_insert_management_only"
  on public.dpi_employee_items
  for insert
  with check (public.has_module_access('gestione', true));

create policy "dpi_employee_items_update_management_only"
  on public.dpi_employee_items
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

create policy "dpi_employee_items_delete_management_only"
  on public.dpi_employee_items
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_site_templates_read" on public.turni_site_templates;
create policy "turni_site_templates_read"
  on public.turni_site_templates
  for select
  using (public.has_module_access('gestione') or public.has_module_access('turni'));

drop policy if exists "turni_site_templates_write" on public.turni_site_templates;
create policy "turni_site_templates_write"
  on public.turni_site_templates
  for all
  using (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

drop policy if exists "turni_site_template_slots_read" on public.turni_site_template_slots;
create policy "turni_site_template_slots_read"
  on public.turni_site_template_slots
  for select
  using (public.has_module_access('gestione') or public.has_module_access('turni'));

drop policy if exists "turni_site_template_slots_write" on public.turni_site_template_slots;
create policy "turni_site_template_slots_write"
  on public.turni_site_template_slots
  for all
  using (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

drop policy if exists "turni_employee_site_assignments_read_by_scope" on public.turni_employee_site_assignments;
create policy "turni_employee_site_assignments_read_by_scope"
  on public.turni_employee_site_assignments
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('turni')
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "turni_employee_site_assignments_write_by_scope" on public.turni_employee_site_assignments;
create policy "turni_employee_site_assignments_write_by_scope"
  on public.turni_employee_site_assignments
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "turni_employee_shifts_read_by_scope" on public.turni_employee_shifts;
create policy "turni_employee_shifts_read_by_scope"
  on public.turni_employee_shifts
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('turni')
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "turni_employee_shifts_write_by_scope" on public.turni_employee_shifts;
create policy "turni_employee_shifts_write_by_scope"
  on public.turni_employee_shifts
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "turni_shift_breaks_read_by_scope" on public.turni_shift_breaks;
create policy "turni_shift_breaks_read_by_scope"
  on public.turni_shift_breaks
  for select
  using (
    public.has_module_access('gestione')
    or exists (
      select 1
      from public.turni_employee_shifts s
      join public.employees e on e.id = s.employee_id
      where s.id = shift_id
        and public.has_module_access('turni')
        and public.can_access_employee(e.responsible_code, e.referral)
    )
  );

drop policy if exists "turni_shift_breaks_write_by_scope" on public.turni_shift_breaks;
create policy "turni_shift_breaks_write_by_scope"
  on public.turni_shift_breaks
  for all
  using (
    public.has_module_access('gestione', true)
    or exists (
      select 1
      from public.turni_employee_shifts s
      join public.employees e on e.id = s.employee_id
      where s.id = shift_id
        and public.has_module_access('turni', true)
        and public.can_access_employee(e.responsible_code, e.referral)
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or exists (
      select 1
      from public.turni_employee_shifts s
      join public.employees e on e.id = s.employee_id
      where s.id = shift_id
        and public.has_module_access('turni', true)
        and public.can_access_employee(e.responsible_code, e.referral)
    )
  );

drop policy if exists "turni_employee_absences_read_by_scope" on public.turni_employee_absences;
create policy "turni_employee_absences_read_by_scope"
  on public.turni_employee_absences
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('turni')
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "turni_employee_absences_write_by_scope" on public.turni_employee_absences;
create policy "turni_employee_absences_write_by_scope"
  on public.turni_employee_absences
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "turni_month_locks_read" on public.turni_month_locks;
create policy "turni_month_locks_read"
  on public.turni_month_locks
  for select
  using (public.has_module_access('gestione') or public.has_module_access('turni'));

drop policy if exists "turni_month_locks_write" on public.turni_month_locks;
create policy "turni_month_locks_write"
  on public.turni_month_locks
  for all
  using (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

drop policy if exists "turni_site_month_targets_read" on public.turni_site_month_targets;
create policy "turni_site_month_targets_read"
  on public.turni_site_month_targets
  for select
  using (
    (public.has_module_access('gestione') or public.has_module_access('turni'))
    and (
      (sub_site_id is null and public.can_access_site(site_id))
      or (sub_site_id is not null and public.can_access_sub_site(sub_site_id))
    )
  );

drop policy if exists "turni_site_month_targets_write" on public.turni_site_month_targets;
create policy "turni_site_month_targets_write"
  on public.turni_site_month_targets
  for all
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
    and (
      (sub_site_id is null and public.can_access_site(site_id))
      or (sub_site_id is not null and public.can_access_sub_site(sub_site_id))
    )
  )
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
    and (
      (sub_site_id is null and public.can_access_site(site_id))
      or (sub_site_id is not null and public.can_access_sub_site(sub_site_id))
    )
  );

drop policy if exists "employee_freeze_periods_read_by_scope" on public.employee_freeze_periods;
create policy "employee_freeze_periods_read_by_scope"
  on public.employee_freeze_periods
  for select
  using (
    public.has_module_access('gestione')
    or (
      (public.has_module_access('formazione') or public.has_module_access('lavoratori'))
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "employee_freeze_periods_write_management_only" on public.employee_freeze_periods;
drop policy if exists "employee_freeze_periods_insert_management_only" on public.employee_freeze_periods;
drop policy if exists "employee_freeze_periods_update_management_only" on public.employee_freeze_periods;
drop policy if exists "employee_freeze_periods_delete_management_only" on public.employee_freeze_periods;

create policy "employee_freeze_periods_insert_management_only"
  on public.employee_freeze_periods
  for insert
  with check (public.has_module_access('gestione', true));

create policy "employee_freeze_periods_update_management_only"
  on public.employee_freeze_periods
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

create policy "employee_freeze_periods_delete_management_only"
  on public.employee_freeze_periods
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "training_scope_exclusions_read_operational" on public.training_scope_exclusions;
create policy "training_scope_exclusions_read_operational"
  on public.training_scope_exclusions
  for select
  using (public.has_any_operational_access() or public.has_module_access('gestione'));

drop policy if exists "training_scope_exclusions_write_management_only" on public.training_scope_exclusions;
create policy "training_scope_exclusions_write_management_only"
  on public.training_scope_exclusions
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "training_employee_exclusions_read_by_scope" on public.training_employee_exclusions;
create policy "training_employee_exclusions_read_by_scope"
  on public.training_employee_exclusions
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('formazione')
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "training_employee_exclusions_write_formazione" on public.training_employee_exclusions;
create policy "training_employee_exclusions_write_formazione"
  on public.training_employee_exclusions
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('formazione', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('formazione', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "training_employee_course_exclusions_read_by_scope" on public.training_employee_course_exclusions;
create policy "training_employee_course_exclusions_read_by_scope"
  on public.training_employee_course_exclusions
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('formazione')
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "training_employee_course_exclusions_write_formazione" on public.training_employee_course_exclusions;
create policy "training_employee_course_exclusions_write_formazione"
  on public.training_employee_course_exclusions
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('formazione', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('formazione', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "medical_surveillance_records_read_by_scope" on public.medical_surveillance_records;
create policy "medical_surveillance_records_read_by_scope"
  on public.medical_surveillance_records
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('sorveglianza')
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "medical_surveillance_records_write_sorveglianza" on public.medical_surveillance_records;
create policy "medical_surveillance_records_write_sorveglianza"
  on public.medical_surveillance_records
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('sorveglianza', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('sorveglianza', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "medical_surveillance_job_rules_read" on public.medical_surveillance_job_rules;
create policy "medical_surveillance_job_rules_read"
  on public.medical_surveillance_job_rules
  for select
  using (
    public.has_module_access('gestione')
    or public.has_module_access('sorveglianza')
  );

drop policy if exists "medical_surveillance_job_rules_write" on public.medical_surveillance_job_rules;
create policy "medical_surveillance_job_rules_write"
  on public.medical_surveillance_job_rules
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "medical_surveillance_scope_rules_read" on public.medical_surveillance_scope_rules;
create policy "medical_surveillance_scope_rules_read"
  on public.medical_surveillance_scope_rules
  for select
  using (
    public.has_module_access('gestione')
    or public.has_module_access('sorveglianza')
  );

drop policy if exists "medical_surveillance_scope_rules_write" on public.medical_surveillance_scope_rules;
create policy "medical_surveillance_scope_rules_write"
  on public.medical_surveillance_scope_rules
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "medical_surveillance_provider_assignments_read" on public.medical_surveillance_provider_assignments;
create policy "medical_surveillance_provider_assignments_read"
  on public.medical_surveillance_provider_assignments
  for select
  using (
    public.has_module_access('gestione')
    or public.has_module_access('sorveglianza')
  );

drop policy if exists "medical_surveillance_provider_assignments_write" on public.medical_surveillance_provider_assignments;
drop policy if exists "medical_surveillance_provider_assignments_insert" on public.medical_surveillance_provider_assignments;
drop policy if exists "medical_surveillance_provider_assignments_update" on public.medical_surveillance_provider_assignments;
drop policy if exists "medical_surveillance_provider_assignments_delete" on public.medical_surveillance_provider_assignments;

create policy "medical_surveillance_provider_assignments_insert"
  on public.medical_surveillance_provider_assignments
  for insert
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('sorveglianza', true))
    and (
      ((sub_site_id is null) and public.can_access_site(site_id))
      or ((sub_site_id is not null) and public.can_access_sub_site(sub_site_id))
    )
  );

create policy "medical_surveillance_provider_assignments_update"
  on public.medical_surveillance_provider_assignments
  for update
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('sorveglianza', true))
    and (
      ((sub_site_id is null) and public.can_access_site(site_id))
      or ((sub_site_id is not null) and public.can_access_sub_site(sub_site_id))
    )
  )
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('sorveglianza', true))
    and (
      ((sub_site_id is null) and public.can_access_site(site_id))
      or ((sub_site_id is not null) and public.can_access_sub_site(sub_site_id))
    )
  );

create policy "medical_surveillance_provider_assignments_delete"
  on public.medical_surveillance_provider_assignments
  for delete
  using (
    (public.has_module_access('gestione', true) or public.has_module_access('sorveglianza', true))
    and (
      ((sub_site_id is null) and public.can_access_site(site_id))
      or ((sub_site_id is not null) and public.can_access_sub_site(sub_site_id))
    )
  );

drop policy if exists "medical_surveillance_employee_exclusions_read" on public.medical_surveillance_employee_exclusions;
create policy "medical_surveillance_employee_exclusions_read"
  on public.medical_surveillance_employee_exclusions
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('sorveglianza')
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "medical_surveillance_employee_exclusions_write" on public.medical_surveillance_employee_exclusions;
create policy "medical_surveillance_employee_exclusions_write"
  on public.medical_surveillance_employee_exclusions
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('sorveglianza', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('sorveglianza', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "medical_surveillance_employee_overrides_read" on public.medical_surveillance_employee_overrides;
create policy "medical_surveillance_employee_overrides_read"
  on public.medical_surveillance_employee_overrides
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('sorveglianza')
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "medical_surveillance_employee_overrides_write" on public.medical_surveillance_employee_overrides;
create policy "medical_surveillance_employee_overrides_write"
  on public.medical_surveillance_employee_overrides
  for all
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('sorveglianza', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  )
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('sorveglianza', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

drop policy if exists "import_runs_read_management_only" on public.import_runs;
create policy "import_runs_read_management_only"
  on public.import_runs
  for select
  using (public.has_module_access('gestione'));

drop policy if exists "import_runs_write_management_only" on public.import_runs;
create policy "import_runs_write_management_only"
  on public.import_runs
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop policy if exists "import_run_errors_read_management_only" on public.import_run_errors;
create policy "import_run_errors_read_management_only"
  on public.import_run_errors
  for select
  using (public.has_module_access('gestione'));

drop policy if exists "import_run_errors_write_management_only" on public.import_run_errors;
create policy "import_run_errors_write_management_only"
  on public.import_run_errors
  for all
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

drop trigger if exists training_courses_set_updated_at on public.training_courses;
create trigger training_courses_set_updated_at
  before update on public.training_courses
  for each row execute procedure internal.set_updated_at();

drop trigger if exists training_matrix_rules_set_updated_at on public.training_matrix_rules;
create trigger training_matrix_rules_set_updated_at
  before update on public.training_matrix_rules
  for each row execute procedure internal.set_updated_at();

drop trigger if exists training_employee_courses_set_updated_at on public.training_employee_courses;
create trigger training_employee_courses_set_updated_at
  before update on public.training_employee_courses
  for each row execute procedure internal.set_updated_at();

drop trigger if exists employee_freeze_periods_set_updated_at on public.employee_freeze_periods;
create trigger employee_freeze_periods_set_updated_at
  before update on public.employee_freeze_periods
  for each row execute procedure internal.set_updated_at();

drop trigger if exists training_scope_exclusions_set_updated_at on public.training_scope_exclusions;
create trigger training_scope_exclusions_set_updated_at
  before update on public.training_scope_exclusions
  for each row execute procedure internal.set_updated_at();

drop trigger if exists training_employee_exclusions_set_updated_at on public.training_employee_exclusions;
create trigger training_employee_exclusions_set_updated_at
  before update on public.training_employee_exclusions
  for each row execute procedure internal.set_updated_at();

drop trigger if exists training_employee_course_exclusions_set_updated_at on public.training_employee_course_exclusions;
create trigger training_employee_course_exclusions_set_updated_at
  before update on public.training_employee_course_exclusions
  for each row execute procedure internal.set_updated_at();

drop trigger if exists medical_surveillance_records_set_updated_at on public.medical_surveillance_records;
create trigger medical_surveillance_records_set_updated_at
  before update on public.medical_surveillance_records
  for each row execute procedure internal.set_updated_at();

drop trigger if exists medical_surveillance_job_rules_set_updated_at on public.medical_surveillance_job_rules;
create trigger medical_surveillance_job_rules_set_updated_at
  before update on public.medical_surveillance_job_rules
  for each row execute procedure internal.set_updated_at();

drop trigger if exists medical_surveillance_scope_rules_set_updated_at on public.medical_surveillance_scope_rules;
create trigger medical_surveillance_scope_rules_set_updated_at
  before update on public.medical_surveillance_scope_rules
  for each row execute procedure internal.set_updated_at();

drop trigger if exists medical_surveillance_provider_assignments_set_updated_at on public.medical_surveillance_provider_assignments;
create trigger medical_surveillance_provider_assignments_set_updated_at
  before update on public.medical_surveillance_provider_assignments
  for each row execute procedure internal.set_updated_at();

drop trigger if exists medical_surveillance_employee_exclusions_set_updated_at on public.medical_surveillance_employee_exclusions;
create trigger medical_surveillance_employee_exclusions_set_updated_at
  before update on public.medical_surveillance_employee_exclusions
  for each row execute procedure internal.set_updated_at();

drop trigger if exists medical_surveillance_employee_overrides_set_updated_at on public.medical_surveillance_employee_overrides;
create trigger medical_surveillance_employee_overrides_set_updated_at
  before update on public.medical_surveillance_employee_overrides
  for each row execute procedure internal.set_updated_at();

drop trigger if exists dpi_items_set_updated_at on public.dpi_items;
create trigger dpi_items_set_updated_at
  before update on public.dpi_items
  for each row execute procedure internal.set_updated_at();

drop trigger if exists dpi_matrix_rules_set_updated_at on public.dpi_matrix_rules;
create trigger dpi_matrix_rules_set_updated_at
  before update on public.dpi_matrix_rules
  for each row execute procedure internal.set_updated_at();

drop trigger if exists dpi_employee_items_set_updated_at on public.dpi_employee_items;
create trigger dpi_employee_items_set_updated_at
  before update on public.dpi_employee_items
  for each row execute procedure internal.set_updated_at();

drop trigger if exists turni_site_templates_set_updated_at on public.turni_site_templates;
create trigger turni_site_templates_set_updated_at
  before update on public.turni_site_templates
  for each row execute procedure internal.set_updated_at();

drop trigger if exists turni_site_template_slots_set_updated_at on public.turni_site_template_slots;
create trigger turni_site_template_slots_set_updated_at
  before update on public.turni_site_template_slots
  for each row execute procedure internal.set_updated_at();

drop trigger if exists turni_employee_site_assignments_set_updated_at on public.turni_employee_site_assignments;
create trigger turni_employee_site_assignments_set_updated_at
  before update on public.turni_employee_site_assignments
  for each row execute procedure internal.set_updated_at();

drop trigger if exists turni_employee_shifts_set_updated_at on public.turni_employee_shifts;
create trigger turni_employee_shifts_set_updated_at
  before update on public.turni_employee_shifts
  for each row execute procedure internal.set_updated_at();

drop trigger if exists turni_employee_absences_set_updated_at on public.turni_employee_absences;
create trigger turni_employee_absences_set_updated_at
  before update on public.turni_employee_absences
  for each row execute procedure internal.set_updated_at();

drop trigger if exists turni_site_month_targets_set_updated_at on public.turni_site_month_targets;
create trigger turni_site_month_targets_set_updated_at
  before update on public.turni_site_month_targets
  for each row execute procedure internal.set_updated_at();

-- Bootstrap iniziale:
-- 1. crea il primo utente in Auth;
-- 2. recupera il suo id da auth.users;
-- 3. inserisci una riga in public.module_permissions con module = 'gestione' e can_write = true.
