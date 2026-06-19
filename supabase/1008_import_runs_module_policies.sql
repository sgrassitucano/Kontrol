-- Import runs & rollback tables: allow module-level insert/read for their own sources.

drop policy if exists "import_runs_read_by_module" on public.import_runs;
create policy "import_runs_read_by_module"
  on public.import_runs
  for select
  using (
    public.has_module_access('gestione')
    or (source = 'formazione_legacy' and public.has_module_access('formazione'))
    or (source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza'))
  );

drop policy if exists "import_runs_insert_by_module" on public.import_runs;
create policy "import_runs_insert_by_module"
  on public.import_runs
  for insert
  with check (
    public.has_module_access('gestione', true)
    or (source = 'formazione_legacy' and public.has_module_access('formazione', true))
    or (source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza', true))
  );

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

