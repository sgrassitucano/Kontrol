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

select pg_notify('pgrst','reload schema');
