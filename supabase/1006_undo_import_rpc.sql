create or replace function public.undo_training_legacy_import(p_import_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  has_access boolean;
  run_source text;
  changes_count integer;
  deleted_rows integer := 0;
  restored_rows integer := 0;
  skipped_rows integer := 0;
  r record;
  employee_id_val bigint;
  course_id_val bigint;
  curr record;
  after_completion date;
  after_expiry date;
  before_completion date;
  before_expiry date;
begin
  select public.has_module_access('gestione', true) into has_access;
  if not has_access then
    raise exception 'Accesso negato.' using errcode = '42501';
  end if;

  if to_regclass('public.import_undo_deleted_rows') is null then
    raise exception 'Archivio undo import non disponibile. Applicare patch DB.' using errcode = '42501';
  end if;

  select source into run_source
  from public.import_runs
  where id = p_import_run_id
  for update;
  if run_source is null then
    raise exception 'Import run non trovato.' using errcode = '22023';
  end if;
  if run_source <> 'formazione_legacy' then
    raise exception 'Sorgente import non valida.' using errcode = '22023';
  end if;

  if exists (select 1 from public.import_run_undos u where u.import_run_id = p_import_run_id) then
    raise exception 'Import già annullato.' using errcode = '22023';
  end if;

  with changes as (
    select distinct on (
      (row_key->>'employee_id')::bigint,
      (row_key->>'course_id')::bigint
    )
      id, action, row_key, before_row, after_row
    from public.import_run_changes
    where import_run_id = p_import_run_id
      and table_name = 'training_employee_courses'
    order by
      (row_key->>'employee_id')::bigint,
      (row_key->>'course_id')::bigint,
      id desc
  )
  select count(*) into changes_count from changes;

  if changes_count is null or changes_count = 0 then
    raise exception 'Nessun dato annullabile trovato per questo import.' using errcode = '22023';
  end if;
  if changes_count > 50000 then
    raise exception 'Undo import troppo grande (> 50000 righe).' using errcode = '22023';
  end if;

  for r in
    with changes as (
      select distinct on (
        (row_key->>'employee_id')::bigint,
        (row_key->>'course_id')::bigint
      )
        id, action, row_key, before_row, after_row
      from public.import_run_changes
      where import_run_id = p_import_run_id
        and table_name = 'training_employee_courses'
      order by
        (row_key->>'employee_id')::bigint,
        (row_key->>'course_id')::bigint,
        id desc
    )
    select * from changes
  loop
    employee_id_val := (r.row_key->>'employee_id')::bigint;
    course_id_val := (r.row_key->>'course_id')::bigint;
    if employee_id_val is null or employee_id_val <= 0 or course_id_val is null or course_id_val <= 0 then
      skipped_rows := skipped_rows + 1;
      continue;
    end if;

    select employee_id, course_id, completion_date, expiry_date
    into curr
    from public.training_employee_courses
    where employee_id = employee_id_val and course_id = course_id_val;

    after_completion := nullif(coalesce(r.after_row->>'completion_date',''), '')::date;
    after_expiry := nullif(coalesce(r.after_row->>'expiry_date',''), '')::date;

    if r.action = 'insert' then
      if curr is not null
        and curr.completion_date is not distinct from after_completion
        and curr.expiry_date is not distinct from after_expiry
      then
        insert into public.import_undo_deleted_rows(import_run_id, table_name, row_key, row_data, archived_by)
        values (
          p_import_run_id,
          'training_employee_courses',
          jsonb_build_object('employee_id', employee_id_val, 'course_id', course_id_val),
          to_jsonb(curr),
          auth.uid()
        );

        delete from public.training_employee_courses
        where employee_id = employee_id_val and course_id = course_id_val;

        deleted_rows := deleted_rows + 1;
      else
        skipped_rows := skipped_rows + 1;
      end if;
      continue;
    end if;

    if r.before_row is null or curr is null then
      skipped_rows := skipped_rows + 1;
      continue;
    end if;

    if not (curr.completion_date is not distinct from after_completion and curr.expiry_date is not distinct from after_expiry) then
      skipped_rows := skipped_rows + 1;
      continue;
    end if;

    before_completion := nullif(coalesce(r.before_row->>'completion_date',''), '')::date;
    before_expiry := nullif(coalesce(r.before_row->>'expiry_date',''), '')::date;

    update public.training_employee_courses
    set completion_date = before_completion,
        expiry_date = before_expiry
    where employee_id = employee_id_val and course_id = course_id_val;

    restored_rows := restored_rows + 1;
  end loop;

  insert into public.import_run_undos(import_run_id, undone_by)
  values (p_import_run_id, auth.uid());

  return jsonb_build_object(
    'ok', true,
    'deletedRows', deleted_rows,
    'restoredRows', restored_rows,
    'skippedRows', skipped_rows
  );
end;
$$;

create or replace function public.undo_sorveglianza_import(p_import_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  has_access boolean;
  run_source text;
  changes_count integer;
  deleted_rows integer := 0;
  restored_rows integer := 0;
  skipped_rows integer := 0;
  r record;
  employee_id_val bigint;
  curr record;
  after_provider text;
  after_is_planned boolean;
  after_requires_visit boolean;
  after_next_due date;
  after_limitations text;
  after_notes text;
  before_provider text;
  before_is_planned boolean;
  before_requires_visit boolean;
  before_next_due date;
  before_limitations text;
  before_notes text;
begin
  select public.has_module_access('gestione', true) into has_access;
  if not has_access then
    raise exception 'Accesso negato.' using errcode = '42501';
  end if;

  if to_regclass('public.import_undo_deleted_rows') is null then
    raise exception 'Archivio undo import non disponibile. Applicare patch DB.' using errcode = '42501';
  end if;

  select source into run_source
  from public.import_runs
  where id = p_import_run_id
  for update;
  if run_source is null then
    raise exception 'Import run non trovato.' using errcode = '22023';
  end if;
  if run_source not in ('sorveglianza', 'sorveglianza_pdf') then
    raise exception 'Sorgente import non valida.' using errcode = '22023';
  end if;

  if exists (select 1 from public.import_run_undos u where u.import_run_id = p_import_run_id) then
    raise exception 'Import già annullato.' using errcode = '22023';
  end if;

  with changes as (
    select distinct on ((row_key->>'employee_id')::bigint)
      id, action, row_key, before_row, after_row
    from public.import_run_changes
    where import_run_id = p_import_run_id
      and table_name = 'medical_surveillance_records'
    order by (row_key->>'employee_id')::bigint, id desc
  )
  select count(*) into changes_count from changes;

  if changes_count is null or changes_count = 0 then
    raise exception 'Nessun dato annullabile trovato per questo import.' using errcode = '22023';
  end if;
  if changes_count > 50000 then
    raise exception 'Undo import troppo grande (> 50000 righe).' using errcode = '22023';
  end if;

  for r in
    with changes as (
      select distinct on ((row_key->>'employee_id')::bigint)
        id, action, row_key, before_row, after_row
      from public.import_run_changes
      where import_run_id = p_import_run_id
        and table_name = 'medical_surveillance_records'
      order by (row_key->>'employee_id')::bigint, id desc
    )
    select * from changes
  loop
    employee_id_val := (r.row_key->>'employee_id')::bigint;
    if employee_id_val is null or employee_id_val <= 0 then
      skipped_rows := skipped_rows + 1;
      continue;
    end if;

    select employee_id, provider, is_planned, requires_visit, next_due_date, limitations, notes
    into curr
    from public.medical_surveillance_records
    where employee_id = employee_id_val;

    after_provider := nullif(coalesce(r.after_row->>'provider',''), '');
    after_is_planned := coalesce((r.after_row->>'is_planned')::boolean, false);
    after_requires_visit := coalesce((r.after_row->>'requires_visit')::boolean, true);
    after_next_due := nullif(coalesce(r.after_row->>'next_due_date',''), '')::date;
    after_limitations := nullif(coalesce(r.after_row->>'limitations',''), '');
    after_notes := nullif(coalesce(r.after_row->>'notes',''), '');

    if r.action = 'insert' then
      if curr is not null
        and curr.provider is not distinct from after_provider
        and curr.is_planned is not distinct from after_is_planned
        and curr.requires_visit is not distinct from after_requires_visit
        and curr.next_due_date is not distinct from after_next_due
        and curr.limitations is not distinct from after_limitations
        and curr.notes is not distinct from after_notes
      then
        insert into public.import_undo_deleted_rows(import_run_id, table_name, row_key, row_data, archived_by)
        values (
          p_import_run_id,
          'medical_surveillance_records',
          jsonb_build_object('employee_id', employee_id_val),
          to_jsonb(curr),
          auth.uid()
        );

        delete from public.medical_surveillance_records
        where employee_id = employee_id_val;

        deleted_rows := deleted_rows + 1;
      else
        skipped_rows := skipped_rows + 1;
      end if;
      continue;
    end if;

    if r.before_row is null or curr is null then
      skipped_rows := skipped_rows + 1;
      continue;
    end if;

    if not (
      curr.provider is not distinct from after_provider
      and curr.is_planned is not distinct from after_is_planned
      and curr.requires_visit is not distinct from after_requires_visit
      and curr.next_due_date is not distinct from after_next_due
      and curr.limitations is not distinct from after_limitations
      and curr.notes is not distinct from after_notes
    ) then
      skipped_rows := skipped_rows + 1;
      continue;
    end if;

    before_provider := nullif(coalesce(r.before_row->>'provider',''), '');
    before_is_planned := coalesce((r.before_row->>'is_planned')::boolean, false);
    before_requires_visit := coalesce((r.before_row->>'requires_visit')::boolean, true);
    before_next_due := nullif(coalesce(r.before_row->>'next_due_date',''), '')::date;
    before_limitations := nullif(coalesce(r.before_row->>'limitations',''), '');
    before_notes := nullif(coalesce(r.before_row->>'notes',''), '');

    update public.medical_surveillance_records
    set provider = before_provider,
        is_planned = before_is_planned,
        requires_visit = before_requires_visit,
        next_due_date = before_next_due,
        limitations = before_limitations,
        notes = before_notes
    where employee_id = employee_id_val;

    restored_rows := restored_rows + 1;
  end loop;

  insert into public.import_run_undos(import_run_id, undone_by)
  values (p_import_run_id, auth.uid());

  return jsonb_build_object(
    'ok', true,
    'deletedRows', deleted_rows,
    'restoredRows', restored_rows,
    'skippedRows', skipped_rows
  );
end;
$$;
