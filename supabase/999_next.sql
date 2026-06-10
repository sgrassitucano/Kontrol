-- Patch cumulativa (da applicare manualmente su Supabase).
-- Aggiornare questo file via via con le prossime modifiche DB.

create table if not exists public.turni_employee_templates (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  name text not null,
  valid_from date not null,
  valid_to date,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint turni_employee_templates_valid_range check (valid_to is null or valid_to >= valid_from)
);

create table if not exists public.turni_employee_template_slots (
  id bigint generated always as identity primary key,
  template_id bigint not null references public.turni_employee_templates(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  site_id bigint not null references public.sites(id) on delete restrict,
  sub_site_id bigint references public.sub_sites(id) on delete set null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint turni_employee_template_slot_times check (end_time > start_time),
  constraint turni_employee_template_slot_break_quarter check (break_minutes % 15 = 0 and break_minutes >= 0)
);

alter table public.turni_employee_templates enable row level security;
alter table public.turni_employee_template_slots enable row level security;

drop trigger if exists turni_employee_templates_set_updated_at on public.turni_employee_templates;
create trigger turni_employee_templates_set_updated_at
  before update on public.turni_employee_templates
  for each row execute procedure internal.set_updated_at();

drop trigger if exists turni_employee_template_slots_set_updated_at on public.turni_employee_template_slots;
create trigger turni_employee_template_slots_set_updated_at
  before update on public.turni_employee_template_slots
  for each row execute procedure internal.set_updated_at();

drop policy if exists "turni_employee_templates_read" on public.turni_employee_templates;
create policy "turni_employee_templates_read"
  on public.turni_employee_templates
  for select
  using (
    public.has_module_access('gestione')
    or public.has_module_access('turni')
  );

drop policy if exists "turni_employee_templates_write" on public.turni_employee_templates;
create policy "turni_employee_templates_write"
  on public.turni_employee_templates
  for all
  using (
    public.has_module_access('gestione', true)
    or public.has_module_access('turni', true)
  )
  with check (
    public.has_module_access('gestione', true)
    or public.has_module_access('turni', true)
  );

drop policy if exists "turni_employee_template_slots_read" on public.turni_employee_template_slots;
create policy "turni_employee_template_slots_read"
  on public.turni_employee_template_slots
  for select
  using (
    public.has_module_access('gestione')
    or public.has_module_access('turni')
  );

drop policy if exists "turni_employee_template_slots_write" on public.turni_employee_template_slots;
create policy "turni_employee_template_slots_write"
  on public.turni_employee_template_slots
  for all
  using (
    public.has_module_access('gestione', true)
    or public.has_module_access('turni', true)
  )
  with check (
    public.has_module_access('gestione', true)
    or public.has_module_access('turni', true)
  );

update public.training_courses
set validity_years = 3,
    is_unlimited = false
where code = 'CORSO_PS';

update public.training_courses
set validity_years = 2,
    is_unlimited = false
where code = 'CORSO_PREP';

update public.training_courses
set validity_years = 4,
    is_unlimited = false
where code = 'CORSO_PONT';

update public.training_employee_courses tec
set expiry_date = (tec.completion_date + interval '3 years')::date,
    updated_at = timezone('utc', now())
from public.training_courses c
where tec.course_id = c.id
  and c.code = 'CORSO_PS'
  and tec.completion_date is not null
  and (tec.manual_state is null or tec.manual_state not in ('programmato', 'escluso'));

update public.training_employee_courses tec
set expiry_date = (tec.completion_date + interval '2 years')::date,
    updated_at = timezone('utc', now())
from public.training_courses c
where tec.course_id = c.id
  and c.code = 'CORSO_PREP'
  and tec.completion_date is not null
  and (tec.manual_state is null or tec.manual_state not in ('programmato', 'escluso'));

update public.training_employee_courses tec
set expiry_date = (tec.completion_date + interval '4 years')::date,
    updated_at = timezone('utc', now())
from public.training_courses c
where tec.course_id = c.id
  and c.code = 'CORSO_PONT'
  and tec.completion_date is not null
  and (tec.manual_state is null or tec.manual_state not in ('programmato', 'escluso'));

-- Audit/Formazione: record con completion_date ma expiry_date NULL (potenziale "idoneo" troppo ottimistico)
-- Nota: esclude corsi illimitati e stati manuali programmato/escluso.
select
  c.code,
  c.title,
  count(*) as rows_without_expiry
from public.training_employee_courses tec
join public.training_courses c on c.id = tec.course_id
join public.employees e on e.id = tec.employee_id
where e.status = 'attivo'
  and tec.completion_date is not null
  and tec.expiry_date is null
  and coalesce(c.is_unlimited, false) = false
  and coalesce(c.validity_years, 0) > 0
  and (tec.manual_state is null or tec.manual_state not in ('programmato', 'escluso'))
group by c.code, c.title
order by rows_without_expiry desc, c.code;

-- Fix/Formazione: ricalcolo expiry_date mancante da completion_date + validity_years
-- Nota: non tocca corsi illimitati né quelli senza validity_years.
update public.training_employee_courses tec
set expiry_date = (tec.completion_date + make_interval(years => c.validity_years))::date,
    updated_at = timezone('utc', now())
from public.training_courses c,
     public.employees e
where tec.course_id = c.id
  and e.id = tec.employee_id
  and e.status = 'attivo'
  and tec.completion_date is not null
  and tec.expiry_date is null
  and coalesce(c.is_unlimited, false) = false
  and coalesce(c.validity_years, 0) > 0
  and (tec.manual_state is null or tec.manual_state not in ('programmato', 'escluso'));

drop policy if exists "import_runs_read_management_only" on public.import_runs;
drop policy if exists "import_runs_read_by_module" on public.import_runs;
create policy "import_runs_read_by_module"
  on public.import_runs
  for select
  using (
    public.has_module_access('gestione')
    or (source = 'formazione_legacy' and public.has_module_access('formazione'))
    or (source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza'))
  );

drop policy if exists "import_runs_write_management_only" on public.import_runs;
drop policy if exists "import_runs_insert_by_module" on public.import_runs;
drop policy if exists "import_runs_write_management_only_update" on public.import_runs;
drop policy if exists "import_runs_write_management_only_delete" on public.import_runs;

create policy "import_runs_insert_by_module"
  on public.import_runs
  for insert
  with check (
    public.has_module_access('gestione', true)
    or (source = 'formazione_legacy' and public.has_module_access('formazione', true))
    or (source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza', true))
  );

create policy "import_runs_write_management_only_update"
  on public.import_runs
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

create policy "import_runs_write_management_only_delete"
  on public.import_runs
  for delete
  using (public.has_module_access('gestione', true));

create table if not exists public.import_run_changes (
  id bigint generated always as identity primary key,
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  table_name text not null,
  action text not null check (action in ('insert', 'update')),
  row_key jsonb not null,
  before_row jsonb,
  after_row jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists import_run_changes_import_run_id_idx
  on public.import_run_changes (import_run_id);

create table if not exists public.import_run_undos (
  import_run_id uuid primary key references public.import_runs(id) on delete cascade,
  undone_by uuid references public.profiles(id),
  undone_at timestamptz not null default timezone('utc', now())
);

alter table public.import_run_changes enable row level security;
alter table public.import_run_undos enable row level security;

drop policy if exists "import_run_changes_read_by_module" on public.import_run_changes;
create policy "import_run_changes_read_by_module"
  on public.import_run_changes
  for select
  using (
    exists (
      select 1
      from public.import_runs r
      where r.id = import_run_id
        and (
          public.has_module_access('gestione')
          or (r.source = 'formazione_legacy' and public.has_module_access('formazione'))
          or (r.source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza'))
        )
    )
  );

drop policy if exists "import_run_changes_insert_by_module" on public.import_run_changes;
create policy "import_run_changes_insert_by_module"
  on public.import_run_changes
  for insert
  with check (
    exists (
      select 1
      from public.import_runs r
      where r.id = import_run_id
        and (
          public.has_module_access('gestione', true)
          or (r.source = 'formazione_legacy' and public.has_module_access('formazione', true))
          or (r.source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza', true))
        )
    )
  );

drop policy if exists "import_run_undos_read_by_module" on public.import_run_undos;
create policy "import_run_undos_read_by_module"
  on public.import_run_undos
  for select
  using (
    exists (
      select 1
      from public.import_runs r
      where r.id = import_run_id
        and (
          public.has_module_access('gestione')
          or (r.source = 'formazione_legacy' and public.has_module_access('formazione'))
          or (r.source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza'))
        )
    )
  );

drop policy if exists "import_run_undos_insert_by_module" on public.import_run_undos;
create policy "import_run_undos_insert_by_module"
  on public.import_run_undos
  for insert
  with check (
    exists (
      select 1
      from public.import_runs r
      where r.id = import_run_id
        and (
          public.has_module_access('gestione', true)
          or (r.source = 'formazione_legacy' and public.has_module_access('formazione', true))
          or (r.source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza', true))
        )
    )
  );

drop policy if exists "import_run_errors_read_management_only" on public.import_run_errors;
drop policy if exists "import_run_errors_read_by_module" on public.import_run_errors;
create policy "import_run_errors_read_by_module"
  on public.import_run_errors
  for select
  using (
    exists (
      select 1
      from public.import_runs r
      where r.id = import_run_id
        and (
          public.has_module_access('gestione')
          or (r.source = 'formazione_legacy' and public.has_module_access('formazione'))
          or (r.source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza'))
        )
    )
  );

drop policy if exists "import_run_errors_write_management_only" on public.import_run_errors;
drop policy if exists "import_run_errors_insert_by_module" on public.import_run_errors;
create policy "import_run_errors_insert_by_module"
  on public.import_run_errors
  for insert
  with check (
    exists (
      select 1
      from public.import_runs r
      where r.id = import_run_id
        and (
          public.has_module_access('gestione', true)
          or (r.source = 'formazione_legacy' and public.has_module_access('formazione', true))
          or (r.source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza', true))
        )
    )
  );

revoke usage on schema internal from anon;
revoke execute on all functions in schema internal from anon;

alter table public.employees
  add column if not exists sex text,
  add column if not exists birth_province text,
  add column if not exists residence_address text,
  add column if not exists residence_postal_code text,
  add column if not exists residence_city text,
  add column if not exists residence_province text,
  add column if not exists residence_belfiore_code text;

-- Normalizzazione preventiva per evitare che i nuovi constraint falliscano su dati storici sporchi.
update public.employees
set sex = upper(nullif(trim(sex), ''))
where sex is not null;

update public.employees
set sex = null
where sex is not null
  and sex not in ('M', 'F');

update public.employees
set birth_province = upper(nullif(trim(birth_province), ''))
where birth_province is not null;

update public.employees
set birth_province = null
where birth_province is not null
  and birth_province !~ '^[A-Z]{2}$';

update public.employees
set residence_province = upper(nullif(trim(residence_province), ''))
where residence_province is not null;

update public.employees
set residence_province = null
where residence_province is not null
  and residence_province !~ '^[A-Z]{2}$';

update public.employees
set residence_postal_code = nullif(regexp_replace(coalesce(residence_postal_code, ''), '[^0-9]', '', 'g'), '')
where residence_postal_code is not null;

update public.employees
set residence_postal_code = null
where residence_postal_code is not null
  and residence_postal_code !~ '^[0-9]{5}$';

update public.employees
set residence_belfiore_code = upper(nullif(trim(residence_belfiore_code), ''))
where residence_belfiore_code is not null;

update public.employees
set residence_belfiore_code = null
where residence_belfiore_code is not null
  and residence_belfiore_code !~ '^[A-Z][0-9]{3}$';

alter table public.employees
  drop constraint if exists employees_sex_check,
  add constraint employees_sex_check check (sex is null or sex in ('M', 'F'));

alter table public.employees
  drop constraint if exists employees_birth_province_check,
  add constraint employees_birth_province_check check (birth_province is null or birth_province ~ '^[A-Z]{2}$');

alter table public.employees
  drop constraint if exists employees_residence_province_check,
  add constraint employees_residence_province_check check (residence_province is null or residence_province ~ '^[A-Z]{2}$');

alter table public.employees
  drop constraint if exists employees_residence_postal_code_check,
  add constraint employees_residence_postal_code_check check (residence_postal_code is null or residence_postal_code ~ '^[0-9]{5}$');

alter table public.employees
  drop constraint if exists employees_residence_belfiore_check,
  add constraint employees_residence_belfiore_check check (residence_belfiore_code is null or residence_belfiore_code ~ '^[A-Z][0-9]{3}$');

select pg_notify('pgrst','reload schema');

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'turni_employee_absences_no_overlap') then
    null;
  else
    if exists (select 1 from pg_class where relname = 'turni_employee_absences_no_overlap') then
      execute 'drop index if exists public.turni_employee_absences_no_overlap';
    end if;
    alter table public.turni_employee_absences
      add constraint turni_employee_absences_no_overlap
      exclude using gist (
        employee_id with =,
        tstzrange(start_at, end_at, '[)') with &&
      );
  end if;
end
$$;

create or replace function internal.turni_assert_month_not_locked(target_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer;
  m integer;
  locked_count integer;
begin
  y := extract(year from target_at)::int;
  m := extract(month from target_at)::int;
  select count(*) into locked_count
  from public.turni_month_locks
  where year = y and month = m;
  if locked_count > 0 then
    raise exception 'Mese bloccato: %/%', lpad(m::text, 2, '0'), y using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.turni_assert_month_not_locked(target_at timestamptz)
returns void
language sql
security invoker
set search_path = public
as $$
  select internal.turni_assert_month_not_locked(target_at);
$$;

create or replace function internal.turni_enforce_month_lock_for_ranges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform internal.turni_assert_month_not_locked(new.start_at);
    perform internal.turni_assert_month_not_locked(new.end_at);
    return new;
  elsif tg_op = 'UPDATE' then
    perform internal.turni_assert_month_not_locked(old.start_at);
    perform internal.turni_assert_month_not_locked(old.end_at);
    perform internal.turni_assert_month_not_locked(new.start_at);
    perform internal.turni_assert_month_not_locked(new.end_at);
    return new;
  else
    perform internal.turni_assert_month_not_locked(old.start_at);
    perform internal.turni_assert_month_not_locked(old.end_at);
    return old;
  end if;
end;
$$;

create or replace function internal.turni_enforce_month_lock_for_breaks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  start_at timestamptz;
  end_at timestamptz;
begin
  if tg_op = 'INSERT' then
    start_at := new.break_start_at;
    end_at := new.break_end_at;
    perform internal.turni_assert_month_not_locked(start_at);
    perform internal.turni_assert_month_not_locked(end_at);
    return new;
  elsif tg_op = 'UPDATE' then
    perform internal.turni_assert_month_not_locked(old.break_start_at);
    perform internal.turni_assert_month_not_locked(old.break_end_at);
    perform internal.turni_assert_month_not_locked(new.break_start_at);
    perform internal.turni_assert_month_not_locked(new.break_end_at);
    return new;
  else
    perform internal.turni_assert_month_not_locked(old.break_start_at);
    perform internal.turni_assert_month_not_locked(old.break_end_at);
    return old;
  end if;
end;
$$;

drop trigger if exists turni_employee_shifts_enforce_month_lock on public.turni_employee_shifts;
create trigger turni_employee_shifts_enforce_month_lock
  before insert or update or delete on public.turni_employee_shifts
  for each row execute procedure internal.turni_enforce_month_lock_for_ranges();

drop trigger if exists turni_employee_absences_enforce_month_lock on public.turni_employee_absences;
create trigger turni_employee_absences_enforce_month_lock
  before insert or update or delete on public.turni_employee_absences
  for each row execute procedure internal.turni_enforce_month_lock_for_ranges();

drop trigger if exists turni_shift_breaks_enforce_month_lock on public.turni_shift_breaks;
create trigger turni_shift_breaks_enforce_month_lock
  before insert or update or delete on public.turni_shift_breaks
  for each row execute procedure internal.turni_enforce_month_lock_for_breaks();

create or replace function internal.turni_replace_shift_breaks(
  shift_id bigint,
  breaks jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_turni_write boolean;
  has_gestione_write boolean;
  employee_responsible_code text;
  employee_referral text;
  has_employee_scope boolean;
  shift_start timestamptz;
  shift_end timestamptz;
  item jsonb;
  b_start timestamptz;
  b_end timestamptz;
  prev_end timestamptz;
begin
  select public.has_module_access('gestione', true) into has_gestione_write;
  if not has_gestione_write then
    select public.has_module_access('turni', true) into has_turni_write;
    if not has_turni_write then
      raise exception 'Accesso negato.' using errcode = '42501';
    end if;
  end if;

  select s.start_at, s.end_at, e.responsible_code, e.referral
  into shift_start, shift_end, employee_responsible_code, employee_referral
  from public.turni_employee_shifts s
  join public.employees e on e.id = s.employee_id
  where s.id = internal.turni_replace_shift_breaks.shift_id;
  if shift_start is null or shift_end is null then
    raise exception 'Turno non trovato.' using errcode = 'P0002';
  end if;

  if not has_gestione_write then
    select public.can_access_employee(employee_responsible_code, employee_referral) into has_employee_scope;
    if not has_employee_scope then
      raise exception 'Accesso negato.' using errcode = '42501';
    end if;
  end if;

  perform internal.turni_assert_month_not_locked(shift_start);
  perform internal.turni_assert_month_not_locked(shift_end);

  if breaks is null or jsonb_typeof(breaks) <> 'array' then
    breaks := '[]'::jsonb;
  end if;

  create temporary table if not exists tmp_turni_breaks (
    start_at timestamptz not null,
    end_at timestamptz not null
  ) on commit drop;

  delete from tmp_turni_breaks;

  for item in select value from jsonb_array_elements(breaks) as value loop
    b_start := (item->>'start_at')::timestamptz;
    b_end := (item->>'end_at')::timestamptz;
    if b_end <= b_start then
      raise exception 'Pausa non valida (fine <= inizio).' using errcode = '22000';
    end if;
    if extract(second from b_start) <> 0 or extract(second from b_end) <> 0
      or (extract(minute from b_start)::int % 15) <> 0
      or (extract(minute from b_end)::int % 15) <> 0 then
      raise exception 'Pause ammesse solo a quarti d''ora.' using errcode = '22000';
    end if;
    if b_start < shift_start or b_end > shift_end then
      raise exception 'Le pause devono stare dentro l''orario del turno.' using errcode = '22000';
    end if;
    insert into tmp_turni_breaks(start_at, end_at) values (b_start, b_end);
  end loop;

  prev_end := null;
  for b_start, b_end in
    select t.start_at, t.end_at from tmp_turni_breaks t order by t.start_at
  loop
    if prev_end is not null and b_start < prev_end then
      raise exception 'Le pause non possono sovrapporsi.' using errcode = '22000';
    end if;
    prev_end := b_end;
  end loop;

  delete from public.turni_shift_breaks b where b.shift_id = internal.turni_replace_shift_breaks.shift_id;

  insert into public.turni_shift_breaks(shift_id, break_start_at, break_end_at)
  select internal.turni_replace_shift_breaks.shift_id, t.start_at, t.end_at
  from tmp_turni_breaks t;
end;
$$;

create or replace function public.turni_replace_shift_breaks(
  shift_id bigint,
  breaks jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  select internal.turni_replace_shift_breaks(shift_id, breaks);
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'fleet_asset_assignments_end_after_start') then
    null;
  else
    alter table public.fleet_asset_assignments
      add constraint fleet_asset_assignments_end_after_start
      check (end_date is null or end_date >= start_date);
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'fleet_asset_assignments_no_overlap') then
    null;
  else
    if exists (select 1 from pg_class where relname = 'fleet_asset_assignments_no_overlap') then
      execute 'drop index if exists public.fleet_asset_assignments_no_overlap';
    end if;
    alter table public.fleet_asset_assignments
      add constraint fleet_asset_assignments_no_overlap
      exclude using gist (
        asset_id with =,
        daterange(start_date, coalesce(end_date + 1, 'infinity'::date), '[)') with &&
      );
  end if;
end
$$;

create or replace function internal.fleet_complete_obligation(
  obligation_id bigint,
  done_date date,
  next_due_date date,
  note text,
  document_ref text,
  vendor text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_access boolean;
  obligation_exists boolean;
begin
  select public.has_module_access('mezzi_attrezzature', true) into has_access;
  if not has_access then
    raise exception 'Accesso negato.' using errcode = '42501';
  end if;

  select exists(select 1 from public.fleet_asset_obligations o where o.id = internal.fleet_complete_obligation.obligation_id)
  into obligation_exists;
  if not obligation_exists then
    raise exception 'Obbligo non trovato.' using errcode = 'P0002';
  end if;

  insert into public.fleet_obligation_events(asset_obligation_id, event_date, note, document_ref)
  values (internal.fleet_complete_obligation.obligation_id, internal.fleet_complete_obligation.done_date, note, document_ref);

  update public.fleet_asset_obligations
  set last_done_date = internal.fleet_complete_obligation.done_date,
      next_due_date = internal.fleet_complete_obligation.next_due_date,
      vendor = internal.fleet_complete_obligation.vendor
  where id = internal.fleet_complete_obligation.obligation_id;
end;
$$;

create or replace function public.fleet_complete_obligation(
  obligation_id bigint,
  done_date date,
  next_due_date date,
  note text,
  document_ref text,
  vendor text
)
returns void
language sql
security invoker
set search_path = public
as $$
  select internal.fleet_complete_obligation(obligation_id, done_date, next_due_date, note, document_ref, vendor);
$$;

drop policy if exists "fleet_assets_write" on public.fleet_assets;
drop policy if exists "fleet_assets_insert" on public.fleet_assets;
drop policy if exists "fleet_assets_update" on public.fleet_assets;
drop policy if exists "fleet_assets_delete_management_only" on public.fleet_assets;

create policy "fleet_assets_insert"
  on public.fleet_assets
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_assets_update"
  on public.fleet_assets
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_assets_delete_management_only"
  on public.fleet_assets
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "fleet_obligation_types_write" on public.fleet_obligation_types;
drop policy if exists "fleet_obligation_types_insert" on public.fleet_obligation_types;
drop policy if exists "fleet_obligation_types_update" on public.fleet_obligation_types;
drop policy if exists "fleet_obligation_types_delete_management_only" on public.fleet_obligation_types;

create policy "fleet_obligation_types_insert"
  on public.fleet_obligation_types
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_obligation_types_update"
  on public.fleet_obligation_types
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_obligation_types_delete_management_only"
  on public.fleet_obligation_types
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "fleet_asset_obligations_write" on public.fleet_asset_obligations;
drop policy if exists "fleet_asset_obligations_insert" on public.fleet_asset_obligations;
drop policy if exists "fleet_asset_obligations_update" on public.fleet_asset_obligations;
drop policy if exists "fleet_asset_obligations_delete_management_only" on public.fleet_asset_obligations;

create policy "fleet_asset_obligations_insert"
  on public.fleet_asset_obligations
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_asset_obligations_update"
  on public.fleet_asset_obligations
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_asset_obligations_delete_management_only"
  on public.fleet_asset_obligations
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "fleet_obligation_events_write" on public.fleet_obligation_events;
drop policy if exists "fleet_obligation_events_insert" on public.fleet_obligation_events;
drop policy if exists "fleet_obligation_events_update" on public.fleet_obligation_events;
drop policy if exists "fleet_obligation_events_delete_management_only" on public.fleet_obligation_events;

create policy "fleet_obligation_events_insert"
  on public.fleet_obligation_events
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_obligation_events_update"
  on public.fleet_obligation_events
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('mezzi_attrezzature', true));

create policy "fleet_obligation_events_delete_management_only"
  on public.fleet_obligation_events
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "fleet_asset_assignments_delete" on public.fleet_asset_assignments;
create policy "fleet_asset_assignments_delete"
  on public.fleet_asset_assignments
  for delete
  using (public.has_module_access('gestione', true));

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'dpi_employee_items_no_delivered_and_planned') then
    null;
  else
    alter table public.dpi_employee_items
      add constraint dpi_employee_items_no_delivered_and_planned
      check (not (delivered_date is not null and planned_date is not null)) not valid;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'dpi_employee_items_next_check_requires_delivery') then
    null;
  else
    alter table public.dpi_employee_items
      add constraint dpi_employee_items_next_check_requires_delivery
      check (next_check_date is null or delivered_date is not null) not valid;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'dpi_employee_items_next_check_after_delivery') then
    null;
  else
    alter table public.dpi_employee_items
      add constraint dpi_employee_items_next_check_after_delivery
      check (delivered_date is null or next_check_date is null or next_check_date >= delivered_date) not valid;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'dpi_employee_items_last_check_before_next') then
    null;
  else
    alter table public.dpi_employee_items
      add constraint dpi_employee_items_last_check_before_next
      check (last_check_date is null or next_check_date is null or last_check_date <= next_check_date) not valid;
  end if;
end
$$;

create or replace function internal.dpi_items_block_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rules_count integer;
  rows_count integer;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.is_active = true and new.is_active = false then
    select count(*) into rules_count from public.dpi_matrix_rules r where r.dpi_id = old.id;
    select count(*) into rows_count from public.dpi_employee_items e where e.dpi_id = old.id;
    if rules_count > 0 or rows_count > 0 then
      raise exception 'Impossibile disattivare DPI: esistono collegamenti (regole matrice=% , righe lavoratori=%).', rules_count, rows_count using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dpi_items_block_deactivation on public.dpi_items;
create trigger dpi_items_block_deactivation
  before update on public.dpi_items
  for each row execute procedure internal.dpi_items_block_deactivation();

drop policy if exists "dpi_items_insert_management_only" on public.dpi_items;
drop policy if exists "dpi_items_update_management_only" on public.dpi_items;
drop policy if exists "dpi_items_delete_management_only" on public.dpi_items;

create policy "dpi_items_insert_management_only"
  on public.dpi_items
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('dpi', true));

create policy "dpi_items_update_management_only"
  on public.dpi_items
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('dpi', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('dpi', true));

create policy "dpi_items_delete_management_only"
  on public.dpi_items
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "dpi_matrix_rules_insert_management_only" on public.dpi_matrix_rules;
drop policy if exists "dpi_matrix_rules_update_management_only" on public.dpi_matrix_rules;
drop policy if exists "dpi_matrix_rules_delete_management_only" on public.dpi_matrix_rules;

create policy "dpi_matrix_rules_insert_management_only"
  on public.dpi_matrix_rules
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('dpi', true));

create policy "dpi_matrix_rules_update_management_only"
  on public.dpi_matrix_rules
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('dpi', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('dpi', true));

create policy "dpi_matrix_rules_delete_management_only"
  on public.dpi_matrix_rules
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "dpi_employee_items_insert_management_only" on public.dpi_employee_items;
drop policy if exists "dpi_employee_items_update_management_only" on public.dpi_employee_items;
drop policy if exists "dpi_employee_items_delete_management_only" on public.dpi_employee_items;

create policy "dpi_employee_items_insert_management_only"
  on public.dpi_employee_items
  for insert
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('dpi', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

create policy "dpi_employee_items_update_management_only"
  on public.dpi_employee_items
  for update
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('dpi', true)
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
      public.has_module_access('dpi', true)
      and exists (
        select 1
        from public.employees e
        where e.id = employee_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

create policy "dpi_employee_items_delete_management_only"
  on public.dpi_employee_items
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_employee_shifts_write_by_scope" on public.turni_employee_shifts;
drop policy if exists "turni_employee_shifts_insert_by_scope" on public.turni_employee_shifts;
drop policy if exists "turni_employee_shifts_update_by_scope" on public.turni_employee_shifts;
drop policy if exists "turni_employee_shifts_delete_management_only" on public.turni_employee_shifts;

create policy "turni_employee_shifts_insert_by_scope"
  on public.turni_employee_shifts
  for insert
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

create policy "turni_employee_shifts_update_by_scope"
  on public.turni_employee_shifts
  for update
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

create policy "turni_employee_shifts_delete_management_only"
  on public.turni_employee_shifts
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_site_templates_write" on public.turni_site_templates;
drop policy if exists "turni_site_templates_insert" on public.turni_site_templates;
drop policy if exists "turni_site_templates_update" on public.turni_site_templates;
drop policy if exists "turni_site_templates_delete_management_only" on public.turni_site_templates;

create policy "turni_site_templates_insert"
  on public.turni_site_templates
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

create policy "turni_site_templates_update"
  on public.turni_site_templates
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

create policy "turni_site_templates_delete_management_only"
  on public.turni_site_templates
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_employee_site_assignments_write_by_scope" on public.turni_employee_site_assignments;
drop policy if exists "turni_employee_site_assignments_insert_by_scope" on public.turni_employee_site_assignments;
drop policy if exists "turni_employee_site_assignments_update_by_scope" on public.turni_employee_site_assignments;
drop policy if exists "turni_employee_site_assignments_delete_management_only" on public.turni_employee_site_assignments;

create policy "turni_employee_site_assignments_insert_by_scope"
  on public.turni_employee_site_assignments
  for insert
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

create policy "turni_employee_site_assignments_update_by_scope"
  on public.turni_employee_site_assignments
  for update
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

create policy "turni_employee_site_assignments_delete_management_only"
  on public.turni_employee_site_assignments
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_month_locks_write" on public.turni_month_locks;
drop policy if exists "turni_month_locks_insert" on public.turni_month_locks;
drop policy if exists "turni_month_locks_update" on public.turni_month_locks;
drop policy if exists "turni_month_locks_delete_management_only" on public.turni_month_locks;

create policy "turni_month_locks_insert"
  on public.turni_month_locks
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

create policy "turni_month_locks_update"
  on public.turni_month_locks
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

create policy "turni_month_locks_delete_management_only"
  on public.turni_month_locks
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_site_month_targets_write" on public.turni_site_month_targets;
drop policy if exists "turni_site_month_targets_insert" on public.turni_site_month_targets;
drop policy if exists "turni_site_month_targets_update" on public.turni_site_month_targets;
drop policy if exists "turni_site_month_targets_delete_management_only" on public.turni_site_month_targets;

create policy "turni_site_month_targets_insert"
  on public.turni_site_month_targets
  for insert
  with check (
    (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
    and (
      (sub_site_id is null and public.can_access_site(site_id))
      or (sub_site_id is not null and public.can_access_sub_site(sub_site_id))
    )
  );

create policy "turni_site_month_targets_update"
  on public.turni_site_month_targets
  for update
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

create policy "turni_site_month_targets_delete_management_only"
  on public.turni_site_month_targets
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "training_employee_courses_write_management_only" on public.training_employee_courses;
drop policy if exists "training_employee_courses_write_formazione" on public.training_employee_courses;
drop policy if exists "training_employee_courses_insert_by_scope" on public.training_employee_courses;
drop policy if exists "training_employee_courses_update_by_scope" on public.training_employee_courses;
drop policy if exists "training_employee_courses_delete_management_only" on public.training_employee_courses;

create policy "training_employee_courses_insert_by_scope"
  on public.training_employee_courses
  for insert
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

create policy "training_employee_courses_update_by_scope"
  on public.training_employee_courses
  for update
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

create policy "training_employee_courses_delete_management_only"
  on public.training_employee_courses
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_site_template_slots_read" on public.turni_site_template_slots;
drop policy if exists "turni_site_template_slots_write" on public.turni_site_template_slots;
drop policy if exists "turni_site_template_slots_insert" on public.turni_site_template_slots;
drop policy if exists "turni_site_template_slots_update" on public.turni_site_template_slots;
drop policy if exists "turni_site_template_slots_delete_management_only" on public.turni_site_template_slots;

create policy "turni_site_template_slots_read"
  on public.turni_site_template_slots
  for select
  using (public.has_module_access('gestione') or public.has_module_access('turni'));

create policy "turni_site_template_slots_insert"
  on public.turni_site_template_slots
  for insert
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

create policy "turni_site_template_slots_update"
  on public.turni_site_template_slots
  for update
  using (public.has_module_access('gestione', true) or public.has_module_access('turni', true))
  with check (public.has_module_access('gestione', true) or public.has_module_access('turni', true));

create policy "turni_site_template_slots_delete_management_only"
  on public.turni_site_template_slots
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_employee_templates_read" on public.turni_employee_templates;
drop policy if exists "turni_employee_templates_write" on public.turni_employee_templates;
drop policy if exists "turni_employee_templates_insert_by_scope" on public.turni_employee_templates;
drop policy if exists "turni_employee_templates_update_by_scope" on public.turni_employee_templates;
drop policy if exists "turni_employee_templates_delete_management_only" on public.turni_employee_templates;

create policy "turni_employee_templates_read_by_scope"
  on public.turni_employee_templates
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

create policy "turni_employee_templates_insert_by_scope"
  on public.turni_employee_templates
  for insert
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

create policy "turni_employee_templates_update_by_scope"
  on public.turni_employee_templates
  for update
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

create policy "turni_employee_templates_delete_management_only"
  on public.turni_employee_templates
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_employee_template_slots_read" on public.turni_employee_template_slots;
drop policy if exists "turni_employee_template_slots_write" on public.turni_employee_template_slots;
drop policy if exists "turni_employee_template_slots_insert_by_scope" on public.turni_employee_template_slots;
drop policy if exists "turni_employee_template_slots_update_by_scope" on public.turni_employee_template_slots;
drop policy if exists "turni_employee_template_slots_delete_management_only" on public.turni_employee_template_slots;

create policy "turni_employee_template_slots_read_by_scope"
  on public.turni_employee_template_slots
  for select
  using (
    public.has_module_access('gestione')
    or (
      public.has_module_access('turni')
      and exists (
        select 1
        from public.turni_employee_templates t
        join public.employees e on e.id = t.employee_id
        where t.id = template_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

create policy "turni_employee_template_slots_insert_by_scope"
  on public.turni_employee_template_slots
  for insert
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.turni_employee_templates t
        join public.employees e on e.id = t.employee_id
        where t.id = template_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

create policy "turni_employee_template_slots_update_by_scope"
  on public.turni_employee_template_slots
  for update
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.turni_employee_templates t
        join public.employees e on e.id = t.employee_id
        where t.id = template_id
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
        from public.turni_employee_templates t
        join public.employees e on e.id = t.employee_id
        where t.id = template_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

create policy "turni_employee_template_slots_delete_management_only"
  on public.turni_employee_template_slots
  for delete
  using (public.has_module_access('gestione', true));

create or replace function internal.turni_replace_site_template_slots(
  template_id bigint,
  slots jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_turni_write boolean;
  has_gestione_write boolean;
  has_scope boolean;
  template_site_id bigint;
  template_sub_site_id bigint;
  item jsonb;
  v_weekday integer;
  v_start time;
  v_end time;
  v_break_minutes integer;
begin
  select public.has_module_access('gestione', true) into has_gestione_write;
  if not has_gestione_write then
    select public.has_module_access('turni', true) into has_turni_write;
    if not has_turni_write then
      raise exception 'Accesso negato.' using errcode = '42501';
    end if;
  end if;

  select t.site_id, t.sub_site_id
  into template_site_id, template_sub_site_id
  from public.turni_site_templates t
  where t.id = internal.turni_replace_site_template_slots.template_id;
  if template_site_id is null then
    raise exception 'Template non trovato.' using errcode = 'P0002';
  end if;

  if not has_gestione_write then
    if template_sub_site_id is null then
      select public.can_access_site(template_site_id) into has_scope;
    else
      select public.can_access_sub_site(template_sub_site_id) into has_scope;
    end if;
    if not has_scope then
      raise exception 'Accesso negato.' using errcode = '42501';
    end if;
  end if;

  if slots is null or jsonb_typeof(slots) <> 'array' then
    slots := '[]'::jsonb;
  end if;

  create temporary table if not exists tmp_turni_site_template_slots (
    weekday integer not null,
    start_time time not null,
    end_time time not null,
    break_minutes integer not null
  ) on commit drop;

  delete from tmp_turni_site_template_slots;

  for item in select value from jsonb_array_elements(slots) as value loop
    begin
      v_weekday := (item->>'weekday')::int;
      v_start := (item->>'start_time')::time;
      v_end := (item->>'end_time')::time;
      v_break_minutes := coalesce((item->>'break_minutes')::int, 0);
    exception when others then
      raise exception 'Slot non valido.' using errcode = '22000';
    end;

    if v_weekday < 0 or v_weekday > 6 then
      raise exception 'Slot non valido (weekday).' using errcode = '22000';
    end if;
    if v_end <= v_start then
      raise exception 'Slot non valido (orari).' using errcode = '22000';
    end if;
    if v_break_minutes < 0 or (v_break_minutes % 15) <> 0 then
      raise exception 'Slot non valido (break_minutes).' using errcode = '22000';
    end if;

    insert into tmp_turni_site_template_slots(weekday, start_time, end_time, break_minutes)
    values (v_weekday, v_start, v_end, v_break_minutes);
  end loop;

  delete from public.turni_site_template_slots s
  where s.template_id = internal.turni_replace_site_template_slots.template_id;

  insert into public.turni_site_template_slots(template_id, weekday, start_time, end_time, break_minutes)
  select internal.turni_replace_site_template_slots.template_id, t.weekday, t.start_time, t.end_time, t.break_minutes
  from tmp_turni_site_template_slots t;
end;
$$;

create or replace function public.turni_replace_site_template_slots(
  template_id bigint,
  slots jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  select internal.turni_replace_site_template_slots(template_id, slots);
$$;

create or replace function internal.turni_replace_employee_template_slots(
  template_id bigint,
  slots jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_turni_write boolean;
  has_gestione_write boolean;
  employee_responsible_code text;
  employee_referral text;
  has_employee_scope boolean;
  item jsonb;
  v_weekday integer;
  v_site_id bigint;
  v_sub_site_id bigint;
  v_start time;
  v_end time;
  v_break_minutes integer;
begin
  select public.has_module_access('gestione', true) into has_gestione_write;
  if not has_gestione_write then
    select public.has_module_access('turni', true) into has_turni_write;
    if not has_turni_write then
      raise exception 'Accesso negato.' using errcode = '42501';
    end if;
  end if;

  select e.responsible_code, e.referral
  into employee_responsible_code, employee_referral
  from public.turni_employee_templates t
  join public.employees e on e.id = t.employee_id
  where t.id = internal.turni_replace_employee_template_slots.template_id;
  if employee_responsible_code is null then
    raise exception 'Template non trovato.' using errcode = 'P0002';
  end if;

  if not has_gestione_write then
    select public.can_access_employee(employee_responsible_code, employee_referral) into has_employee_scope;
    if not has_employee_scope then
      raise exception 'Accesso negato.' using errcode = '42501';
    end if;
  end if;

  if slots is null or jsonb_typeof(slots) <> 'array' then
    slots := '[]'::jsonb;
  end if;

  create temporary table if not exists tmp_turni_employee_template_slots (
    weekday integer not null,
    site_id bigint not null,
    sub_site_id bigint,
    start_time time not null,
    end_time time not null,
    break_minutes integer not null
  ) on commit drop;

  delete from tmp_turni_employee_template_slots;

  for item in select value from jsonb_array_elements(slots) as value loop
    begin
      v_weekday := (item->>'weekday')::int;
      v_site_id := (item->>'site_id')::bigint;
      v_sub_site_id := (item->>'sub_site_id')::bigint;
      v_start := (item->>'start_time')::time;
      v_end := (item->>'end_time')::time;
      v_break_minutes := coalesce((item->>'break_minutes')::int, 0);
    exception when others then
      raise exception 'Slot non valido.' using errcode = '22000';
    end;

    if v_weekday < 0 or v_weekday > 6 then
      raise exception 'Slot non valido (weekday).' using errcode = '22000';
    end if;
    if v_end <= v_start then
      raise exception 'Slot non valido (orari).' using errcode = '22000';
    end if;
    if v_break_minutes < 0 or (v_break_minutes % 15) <> 0 then
      raise exception 'Slot non valido (break_minutes).' using errcode = '22000';
    end if;

    insert into tmp_turni_employee_template_slots(weekday, site_id, sub_site_id, start_time, end_time, break_minutes)
    values (v_weekday, v_site_id, v_sub_site_id, v_start, v_end, v_break_minutes);
  end loop;

  delete from public.turni_employee_template_slots s
  where s.template_id = internal.turni_replace_employee_template_slots.template_id;

  insert into public.turni_employee_template_slots(
    template_id,
    weekday,
    site_id,
    sub_site_id,
    start_time,
    end_time,
    break_minutes
  )
  select
    internal.turni_replace_employee_template_slots.template_id,
    t.weekday,
    t.site_id,
    t.sub_site_id,
    t.start_time,
    t.end_time,
    t.break_minutes
  from tmp_turni_employee_template_slots t;
end;
$$;

create or replace function public.turni_replace_employee_template_slots(
  template_id bigint,
  slots jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  select internal.turni_replace_employee_template_slots(template_id, slots);
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'turni_absence_state') then
    create type public.turni_absence_state as enum ('active', 'cancelled');
  end if;
end
$$;

alter table public.turni_employee_absences
  add column if not exists state public.turni_absence_state;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'turni_employee_absences'
      and column_name = 'state'
  ) then
    alter table public.turni_employee_absences
      alter column state set default 'active'::public.turni_absence_state;
    update public.turni_employee_absences
    set state = 'active'::public.turni_absence_state
    where state is null;
    alter table public.turni_employee_absences
      alter column state set not null;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'turni_employee_absences_no_overlap') then
    alter table public.turni_employee_absences drop constraint turni_employee_absences_no_overlap;
  end if;
  if exists (select 1 from pg_class where relname = 'turni_employee_absences_no_overlap') then
    execute 'drop index if exists public.turni_employee_absences_no_overlap';
  end if;
  alter table public.turni_employee_absences
    add constraint turni_employee_absences_no_overlap
    exclude using gist (
      employee_id with =,
      tstzrange(start_at, end_at, '[)') with &&
    )
    where (state <> 'cancelled');
end
$$;

drop policy if exists "turni_employee_absences_write_by_scope" on public.turni_employee_absences;
drop policy if exists "turni_employee_absences_insert_by_scope" on public.turni_employee_absences;
drop policy if exists "turni_employee_absences_update_by_scope" on public.turni_employee_absences;
drop policy if exists "turni_employee_absences_delete_management_only" on public.turni_employee_absences;

create policy "turni_employee_absences_insert_by_scope"
  on public.turni_employee_absences
  for insert
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

create policy "turni_employee_absences_update_by_scope"
  on public.turni_employee_absences
  for update
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

create policy "turni_employee_absences_delete_management_only"
  on public.turni_employee_absences
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "turni_shift_breaks_write_by_scope" on public.turni_shift_breaks;
drop policy if exists "turni_shift_breaks_insert_by_scope" on public.turni_shift_breaks;
drop policy if exists "turni_shift_breaks_update_by_scope" on public.turni_shift_breaks;
drop policy if exists "turni_shift_breaks_delete_management_only" on public.turni_shift_breaks;

create policy "turni_shift_breaks_insert_by_scope"
  on public.turni_shift_breaks
  for insert
  with check (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.turni_employee_shifts s
        join public.employees e on e.id = s.employee_id
        where s.id = shift_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

create policy "turni_shift_breaks_update_by_scope"
  on public.turni_shift_breaks
  for update
  using (
    public.has_module_access('gestione', true)
    or (
      public.has_module_access('turni', true)
      and exists (
        select 1
        from public.turni_employee_shifts s
        join public.employees e on e.id = s.employee_id
        where s.id = shift_id
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
        from public.turni_employee_shifts s
        join public.employees e on e.id = s.employee_id
        where s.id = shift_id
          and public.can_access_employee(e.responsible_code, e.referral)
      )
    )
  );

create policy "turni_shift_breaks_delete_management_only"
  on public.turni_shift_breaks
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "training_employee_course_exclusions_write_formazione" on public.training_employee_course_exclusions;
drop policy if exists "training_employee_course_exclusions_insert_by_scope" on public.training_employee_course_exclusions;
drop policy if exists "training_employee_course_exclusions_update_by_scope" on public.training_employee_course_exclusions;
drop policy if exists "training_employee_course_exclusions_delete_management_only" on public.training_employee_course_exclusions;

create policy "training_employee_course_exclusions_insert_by_scope"
  on public.training_employee_course_exclusions
  for insert
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

create policy "training_employee_course_exclusions_update_by_scope"
  on public.training_employee_course_exclusions
  for update
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

create policy "training_employee_course_exclusions_delete_management_only"
  on public.training_employee_course_exclusions
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "medical_surveillance_records_write_sorveglianza" on public.medical_surveillance_records;
drop policy if exists "medical_surveillance_records_insert_by_scope" on public.medical_surveillance_records;
drop policy if exists "medical_surveillance_records_update_by_scope" on public.medical_surveillance_records;
drop policy if exists "medical_surveillance_records_delete_management_only" on public.medical_surveillance_records;

create policy "medical_surveillance_records_insert_by_scope"
  on public.medical_surveillance_records
  for insert
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

create policy "medical_surveillance_records_update_by_scope"
  on public.medical_surveillance_records
  for update
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

create policy "medical_surveillance_records_delete_management_only"
  on public.medical_surveillance_records
  for delete
  using (public.has_module_access('gestione', true));

drop policy if exists "training_matrix_rules_write_management_only" on public.training_matrix_rules;
drop policy if exists "training_matrix_rules_insert_management_only" on public.training_matrix_rules;
drop policy if exists "training_matrix_rules_update_management_only" on public.training_matrix_rules;
drop policy if exists "training_matrix_rules_delete_management_only" on public.training_matrix_rules;

create policy "training_matrix_rules_insert_management_only"
  on public.training_matrix_rules
  for insert
  with check (public.has_module_access('gestione', true));

create policy "training_matrix_rules_update_management_only"
  on public.training_matrix_rules
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

create policy "training_matrix_rules_delete_management_only"
  on public.training_matrix_rules
  for delete
  using (public.has_module_access('gestione', true));

alter table public.medical_surveillance_scope_rules
  add column if not exists is_active boolean not null default true;

update public.medical_surveillance_scope_rules
set is_active = true
where is_active is null;

drop policy if exists "medical_surveillance_scope_rules_write" on public.medical_surveillance_scope_rules;
drop policy if exists "medical_surveillance_scope_rules_insert_management_only" on public.medical_surveillance_scope_rules;
drop policy if exists "medical_surveillance_scope_rules_update_management_only" on public.medical_surveillance_scope_rules;
drop policy if exists "medical_surveillance_scope_rules_delete_management_only" on public.medical_surveillance_scope_rules;

create policy "medical_surveillance_scope_rules_insert_management_only"
  on public.medical_surveillance_scope_rules
  for insert
  with check (public.has_module_access('gestione', true));

create policy "medical_surveillance_scope_rules_update_management_only"
  on public.medical_surveillance_scope_rules
  for update
  using (public.has_module_access('gestione', true))
  with check (public.has_module_access('gestione', true));

create policy "medical_surveillance_scope_rules_delete_management_only"
  on public.medical_surveillance_scope_rules
  for delete
  using (public.has_module_access('gestione', true));

create table if not exists public.import_undo_deleted_rows (
  id bigint generated always as identity primary key,
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  table_name text not null,
  row_key jsonb not null,
  row_data jsonb not null,
  archived_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists import_undo_deleted_rows_import_run_id_idx
  on public.import_undo_deleted_rows (import_run_id);

alter table public.import_undo_deleted_rows enable row level security;

drop policy if exists "import_undo_deleted_rows_read_management_only" on public.import_undo_deleted_rows;
create policy "import_undo_deleted_rows_read_management_only"
  on public.import_undo_deleted_rows
  for select
  using (public.has_module_access('gestione'));

drop policy if exists "import_undo_deleted_rows_insert_management_only" on public.import_undo_deleted_rows;
create policy "import_undo_deleted_rows_insert_management_only"
  on public.import_undo_deleted_rows
  for insert
  with check (public.has_module_access('gestione', true));
