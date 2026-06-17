drop policy if exists "import_runs_update_by_module" on public.import_runs;

create policy "import_runs_update_by_module"
  on public.import_runs
  for update
  using (
    public.has_module_access('gestione', true)
    or (source = 'formazione_legacy' and public.has_module_access('formazione', true))
    or (source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza', true))
  )
  with check (
    public.has_module_access('gestione', true)
    or (source = 'formazione_legacy' and public.has_module_access('formazione', true))
    or (source in ('sorveglianza', 'sorveglianza_pdf') and public.has_module_access('sorveglianza', true))
  );
