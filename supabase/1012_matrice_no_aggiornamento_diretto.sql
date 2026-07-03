-- 1012_matrice_no_aggiornamento_diretto.sql
-- Gli aggiornamenti (CORSO_X_AGGIORNAMENTO) non devono mai essere un obbligo diretto
-- in matrice: sono impliciti nel corso nativo (chi deve fare CORSO_X deve anche
-- rinnovarlo, non serve attivarli come voce separata). Rimuove eventuali righe
-- sporche già inserite prima del fix lato codice.
-- (Stefano, 2026-07-03). Idempotente.

delete from public.training_matrix_rules
where course_id in (
  select id from public.training_courses where code like '%\_AGGIORNAMENTO' escape '\'
);

do $$
begin
  perform pg_notify('pgrst','reload schema');
end
$$;
