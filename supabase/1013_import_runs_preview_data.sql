alter table public.import_runs
  add column if not exists preview_data jsonb;

comment on column public.import_runs.preview_data is 'Complete preview data: previewRows, dismissalPreviewRows, dismissalGuardrail, errors. Only populated for status=preview.';
