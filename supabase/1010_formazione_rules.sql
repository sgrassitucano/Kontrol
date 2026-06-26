-- 1010_formazione_rules.sql
-- Regole formazione (Stefano, 2026-06-25). Additivo e idempotente.
-- Applicare INSIEME al push finale del codice correlato.

-- 1) Nuovo stato di sospensione: "congedo"
alter type public.employee_freeze_status add value if not exists 'congedo';

-- 2) Prerequisito: il PREPOSTO deve avere il corso base (generale + specifica).
--    Aggiunge i link prerequisito CORSO_PREP -> FORM_BASE e CORSO_PREP -> FORM_SPEC_BASSO
--    (la specifica minima; i livelli superiori coprono il basso via 'substitutes').
insert into public.training_rule_links (from_course_id, to_course_id, relation_type)
select f.id, t.id, 'prerequisite'::public.training_link_type
from public.training_courses f
join public.training_courses t on t.code in ('FORM_BASE', 'FORM_SPEC_BASSO')
where f.code = 'CORSO_PREP'
on conflict (from_course_id, to_course_id, relation_type) do nothing;
