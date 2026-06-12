create table if not exists public.anagrafica_import_tax_codes (
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  tax_code text not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (import_run_id, tax_code)
);

create index if not exists anagrafica_import_tax_codes_tax_code_idx
  on public.anagrafica_import_tax_codes (tax_code);

alter table public.anagrafica_import_tax_codes enable row level security;

drop policy if exists "anagrafica_import_tax_codes_read_by_module" on public.anagrafica_import_tax_codes;
create policy "anagrafica_import_tax_codes_read_by_module"
  on public.anagrafica_import_tax_codes
  for select
  using (
    exists (
      select 1
      from public.import_runs r
      where r.id = import_run_id
        and r.source = 'anagrafica'
        and public.has_module_access('gestione')
    )
  );

drop policy if exists "anagrafica_import_tax_codes_insert_by_module" on public.anagrafica_import_tax_codes;
create policy "anagrafica_import_tax_codes_insert_by_module"
  on public.anagrafica_import_tax_codes
  for insert
  with check (
    exists (
      select 1
      from public.import_runs r
      where r.id = import_run_id
        and r.source = 'anagrafica'
        and public.has_module_access('gestione', true)
    )
  );

create table if not exists public.employee_status_audit (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees(id) on delete cascade,
  tax_code text not null,
  before_status text,
  after_status text,
  changed_by uuid references public.profiles(id),
  import_run_id uuid references public.import_runs(id),
  source text not null default 'unknown',
  changed_at timestamptz not null default timezone('utc', now())
);

create index if not exists employee_status_audit_employee_id_idx
  on public.employee_status_audit (employee_id);

create index if not exists employee_status_audit_changed_at_idx
  on public.employee_status_audit (changed_at);

alter table public.employee_status_audit enable row level security;

drop policy if exists "employee_status_audit_read_management_only" on public.employee_status_audit;
create policy "employee_status_audit_read_management_only"
  on public.employee_status_audit
  for select
  using (public.has_module_access('gestione'));

create or replace function internal.audit_employee_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (new.status is distinct from old.status) then
    insert into public.employee_status_audit (
      employee_id,
      tax_code,
      before_status,
      after_status,
      changed_by,
      import_run_id,
      source
    ) values (
      new.id,
      new.tax_code,
      old.status,
      new.status,
      auth.uid(),
      null,
      'unknown'
    );
  end if;
  return new;
end
$$;

drop trigger if exists employees_audit_status on public.employees;
create trigger employees_audit_status
  after update of status on public.employees
  for each row execute procedure internal.audit_employee_status_change();
