-- 1014_remove_rls_or_prerequisite_landmine.sql
-- Rimuove il prerequisito CORSO_RLS -> {FORM_SPEC_BASSO,MEDIO,ALTO} inserito in 1011
-- con logical_operator='OR' ("almeno una specifica").
--
-- Il codice applicativo (expandPrerequisites in src/app/api/lavoratori/corsi/route.ts)
-- NON legge affatto la colonna logical_operator: tratta OGNI riga prerequisite come
-- obbligo AND, aggiungendo TUTTI e tre i target al set richiesto. Con collapseLeveledCourseRequirements
-- che tiene sempre il livello più alto presente, questo avrebbe forzato FORM_SPEC_ALTO
-- per chiunque risultasse assegnato a CORSO_RLS in matrice — stesso identico bug
-- risolto in 1013 (FORM_BASE), solo dormiente perché oggi nessun job/site richiede RLS.
--
-- Rimosso preventivamente. Se in futuro serve davvero "RLS richiede almeno una specifica",
-- va prima implementato il supporto OR in expandPrerequisites, non re-inserito così.
-- (Stefano, 2026-07-03). Idempotente.

delete from public.training_rule_links
where relation_type = 'prerequisite'
  and logical_operator = 'OR'
  and from_course_id = (select id from public.training_courses where code = 'CORSO_RLS')
  and to_course_id in (
    select id from public.training_courses where code in ('FORM_SPEC_BASSO', 'FORM_SPEC_MEDIO', 'FORM_SPEC_ALTO')
  );

do $$
begin
  perform pg_notify('pgrst','reload schema');
end
$$;
