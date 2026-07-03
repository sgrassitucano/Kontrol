-- 1011_formazione_consolidation.sql
-- Consolidamento gerarchia corsi + aggiornamenti + relazioni dipendenze
-- (Stefano, 2026-07-03). Idempotente e additivo.

-- 1) Estensione training_rule_links per logical_operator
alter table public.training_rule_links
  add column if not exists logical_operator text default 'AND' check (logical_operator in ('AND', 'OR'));

-- 2) Inserimento corsi AGGIORNAMENTO (26 nuovi corsi)
insert into public.training_courses (code, title, validity_years, is_unlimited, is_active)
values
  ('FORM_SPEC_AGGIORNAMENTO', 'Aggiornamento formazione specifica', 5, false, true),
  ('CORSO_PS_AGGIORNAMENTO', 'Aggiornamento primo soccorso', 3, false, true),
  ('CORSO_PREP_AGGIORNAMENTO', 'Aggiornamento preposto', 2, false, true),
  ('CORSO_DIR_AGGIORNAMENTO', 'Aggiornamento dirigente', 5, false, true),
  ('CORSO_RLS_AGGIORNAMENTO', 'Aggiornamento RLS', 1, false, true),
  ('CORSO_RSPP_AGGIORNAMENTO', 'Aggiornamento RSPP', 5, false, true),
  ('CORSO_FORM_AGGIORNAMENTO', 'Aggiornamento formatori', 5, false, true),
  ('CORSO_QUOTA_DPI_AGGIORNAMENTO', 'Aggiornamento lavori in quota + DPI III cat', 5, false, true),
  ('CORSO_PONT_AGGIORNAMENTO', 'Aggiornamento ponteggio', 5, false, true),
  ('CORSO_TRABATTELLO_AGGIORNAMENTO', 'Aggiornamento trabattello', 5, false, true),
  ('CORSO_PLE_AGGIORNAMENTO', 'Aggiornamento PLE', 5, false, true),
  ('CORSO_FUNI_AGGIORNAMENTO', 'Aggiornamento funi in sospensione', 5, false, true),
  ('CORSO_FERETRI_AGGIORNAMENTO', 'Aggiornamento alzaferetri', 5, false, true),
  ('CORSO_MUL_AGGIORNAMENTO', 'Aggiornamento carrello elevatore', 5, false, true),
  ('CORSO_CARRO_AGGIORNAMENTO', 'Aggiornamento carroponte', 5, false, true),
  ('CORSO_GRUAU_AGGIORNAMENTO', 'Aggiornamento gru su autocarro', 5, false, true),
  ('CORSO_ESCAV_AGGIORNAMENTO', 'Aggiornamento escavatori', 5, false, true),
  ('CORSO_VERDE_AGGIORNAMENTO', 'Aggiornamento attrezzature del verde', 5, false, true),
  ('CORSO_DPI3_AGGIORNAMENTO', 'Aggiornamento DPI III cat', 5, false, true),
  ('CORSO_AI_1_AGGIORNAMENTO', 'Aggiornamento antincendio livello I', 5, false, true),
  ('CORSO_AI_2_AGGIORNAMENTO', 'Aggiornamento antincendio livello II', 5, false, true),
  ('CORSO_AI_3_AGGIORNAMENTO', 'Aggiornamento antincendio livello III', 5, false, true),
  ('CORSO_TRASP_MERC_PER_AGGIORNAMENTO', 'Aggiornamento trasporto merci pericolose', 5, false, true),
  ('CORSO_FITOSAN_AGGIORNAMENTO', 'Aggiornamento fitosanitari', 5, false, true),
  ('CORSO_DISINF_AGGIORNAMENTO', 'Aggiornamento disinfestazione', 5, false, true),
  ('CORSO_AMBCON_AGGIORNAMENTO', 'Aggiornamento ambienti confinati', 5, false, true),
  ('CORSO_FORNO_CREM_AGGIORNAMENTO', 'Aggiornamento forno crematorio', 5, false, true)
on conflict (code) do nothing;

-- 3) Relazioni PREREQUISITE — BASE (formazione generale/specifica)
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code in ('FORM_SPEC_BASSO', 'FORM_SPEC_MEDIO', 'FORM_SPEC_ALTO')
where f.code = 'FORM_BASE'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- Aggiornamento form base richiede form base
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'FORM_BASE'
where f.code = 'FORM_SPEC_AGGIORNAMENTO'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- Preposto richiede form base
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'FORM_BASE'
where f.code = 'CORSO_PREP'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- Aggiornamento preposto richiede preposto
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'CORSO_PREP'
where f.code = 'CORSO_PREP_AGGIORNAMENTO'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- RLS richiede almeno uno tra FORM_SPEC (OR logic — almeno uno)
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'OR'
from public.training_courses f
join public.training_courses t on t.code in ('FORM_SPEC_BASSO', 'FORM_SPEC_MEDIO', 'FORM_SPEC_ALTO')
where f.code = 'CORSO_RLS'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- Aggiornamento RLS richiede RLS
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'CORSO_RLS'
where f.code = 'CORSO_RLS_AGGIORNAMENTO'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- Aggiornamenti per corsi BASE (PS, DIR, RSPP, FORM)
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on
  (f.code = 'CORSO_PS_AGGIORNAMENTO' and t.code = 'CORSO_PS') or
  (f.code = 'CORSO_DIR_AGGIORNAMENTO' and t.code = 'CORSO_DIR') or
  (f.code = 'CORSO_RSPP_AGGIORNAMENTO' and t.code = 'CORSO_RSPP') or
  (f.code = 'CORSO_FORM_AGGIORNAMENTO' and t.code = 'CORSO_FORM')
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- 4) Relazioni OPERATIVI
-- 4.1) FORM_SPEC_ALTO prerequisiti diretti (blocco critico)
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'FORM_SPEC_ALTO'
where f.code in ('CORSO_QUOTA_DPI', 'CORSO_GRUAU', 'CORSO_ESCAV', 'CORSO_AMBCON')
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- 4.2) MULETTO richiede FORM_SPEC_MEDIO (almeno)
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'FORM_SPEC_MEDIO'
where f.code = 'CORSO_MUL'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- 4.3) Catena QUOTA_DPI (ponteggio, trabattello, ple, funi)
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'CORSO_QUOTA_DPI'
where f.code in ('CORSO_PONT', 'CORSO_TRABATTELLO', 'CORSO_PLE', 'CORSO_FUNI')
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- 4.4) FERETRI richiede PLE (che a sua volta richiede QUOTA_DPI → FORM_SPEC_ALTO)
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'CORSO_PLE'
where f.code = 'CORSO_FERETRI'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- 4.5) Aggiornamenti operativi
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'prerequisite'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on
  (f.code = 'CORSO_QUOTA_DPI_AGGIORNAMENTO' and t.code = 'CORSO_QUOTA_DPI') or
  (f.code = 'CORSO_PONT_AGGIORNAMENTO' and t.code = 'CORSO_PONT') or
  (f.code = 'CORSO_TRABATTELLO_AGGIORNAMENTO' and t.code = 'CORSO_TRABATTELLO') or
  (f.code = 'CORSO_PLE_AGGIORNAMENTO' and t.code = 'CORSO_PLE') or
  (f.code = 'CORSO_FUNI_AGGIORNAMENTO' and t.code = 'CORSO_FUNI') or
  (f.code = 'CORSO_FERETRI_AGGIORNAMENTO' and t.code = 'CORSO_FERETRI') or
  (f.code = 'CORSO_MUL_AGGIORNAMENTO' and t.code = 'CORSO_MUL') or
  (f.code = 'CORSO_CARRO_AGGIORNAMENTO' and t.code = 'CORSO_CARRO') or
  (f.code = 'CORSO_GRUAU_AGGIORNAMENTO' and t.code = 'CORSO_GRUAU') or
  (f.code = 'CORSO_ESCAV_AGGIORNAMENTO' and t.code = 'CORSO_ESCAV') or
  (f.code = 'CORSO_VERDE_AGGIORNAMENTO' and t.code = 'CORSO_VERDE') or
  (f.code = 'CORSO_DPI3_AGGIORNAMENTO' and t.code = 'CORSO_DPI3') or
  (f.code = 'CORSO_AI_1_AGGIORNAMENTO' and t.code = 'CORSO_AI_1') or
  (f.code = 'CORSO_AI_2_AGGIORNAMENTO' and t.code = 'CORSO_AI_2') or
  (f.code = 'CORSO_AI_3_AGGIORNAMENTO' and t.code = 'CORSO_AI_3') or
  (f.code = 'CORSO_TRASP_MERC_PER_AGGIORNAMENTO' and t.code = 'CORSO_TRASP_MERC_PER') or
  (f.code = 'CORSO_FITOSAN_AGGIORNAMENTO' and t.code = 'CORSO_FITOSAN') or
  (f.code = 'CORSO_DISINF_AGGIORNAMENTO' and t.code = 'CORSO_DISINF') or
  (f.code = 'CORSO_AMBCON_AGGIORNAMENTO' and t.code = 'CORSO_AMBCON') or
  (f.code = 'CORSO_FORNO_CREM_AGGIORNAMENTO' and t.code = 'CORSO_FORNO_CREM')
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- 5) Relazioni SUBSTITUTES (gerarchia)
-- 5.1) Forma specifica: ALTO > MEDIO > BASSO
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'substitutes'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code in ('FORM_SPEC_MEDIO', 'FORM_SPEC_BASSO')
where f.code = 'FORM_SPEC_ALTO'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'substitutes'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'FORM_SPEC_BASSO'
where f.code = 'FORM_SPEC_MEDIO'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- 5.2) Antincendio: AI_3 > AI_2 > AI_1
insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'substitutes'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code in ('CORSO_AI_2', 'CORSO_AI_1')
where f.code = 'CORSO_AI_3'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

insert into public.training_rule_links (from_course_id, to_course_id, relation_type, logical_operator)
select f.id, t.id, 'substitutes'::public.training_link_type, 'AND'
from public.training_courses f
join public.training_courses t on t.code = 'CORSO_AI_1'
where f.code = 'CORSO_AI_2'
on conflict (from_course_id, to_course_id, relation_type) do nothing;

-- 6) Notifica schema per reload
do $$
begin
  perform pg_notify('pgrst','reload schema');
end
$$;
