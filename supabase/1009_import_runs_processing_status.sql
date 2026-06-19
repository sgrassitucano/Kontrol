alter table public.import_runs
  drop constraint if exists import_runs_status_check;

alter table public.import_runs
  add constraint import_runs_status_check
  check (status in ('preview', 'processing', 'completed', 'failed'));
