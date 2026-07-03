-- 1013_fix_form_base_prerequisite_direction.sql
-- BUG CRITICO in 1011: la relazione prerequisite tra FORM_BASE e le tre
-- formazioni specifiche era invertita: from=FORM_BASE, to={BASSO,MEDIO,ALTO}
-- significa "FORM_BASE richiede tutte e tre le specifiche". Siccome FORM_BASE
-- è nella baseline (quasi tutti i lavoratori), expandPrerequisites aggiungeva
-- SEMPRE tutte e tre le specifiche come richieste, e collapseLeveledCourseRequirements
-- teneva sempre la più alta (ALTO) — causando "upgrade a rischio ALTO" per il 99%
-- dei lavoratori indipendentemente da mansione/cantiere.
-- Direzione corretta (coerente con CORSO_PREP -> FORM_BASE, stesso pattern):
-- ogni formazione specifica richiede FORM_BASE, non il contrario.
-- (Stefano, 2026-07-03). Idempotente.

delete from public.training_rule_links
where relation_type = 'prerequisite'
  and from_course_id = (select id from public.training_courses where code = 'FORM_BASE')
  and to_course_id in (
    select id from public.training_courses where code in ('FORM_SPEC_BASSO', 'FORM_SPEC_MEDIO', 'FORM_SPEC_ALTO')
  );

insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'FORM_BASE'
where f.code in ('FORM_SPEC_BASSO', 'FORM_SPEC_MEDIO', 'FORM_SPEC_ALTO')
on conflict (from_course_id, to_course_id, relation_type) do nothing;

do $$
begin
  perform pg_notify('pgrst','reload schema');
end
$$;
