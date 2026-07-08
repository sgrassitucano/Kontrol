# Handoff: modulo Pianificazione Formazione — sessioni/date/orari

## Obiettivo
Il modulo Pianificazione (`/home/formazione/pianificazione`) deve permettere di:
1. Selezionare lavoratori da formare (già fatto: filtri corso/cantiere/mansione/stato, ricerca)
2. Marcare "programmato" + note (già fatto: modale esistente, con/senza data)
3. **NUOVO**: compilare i dati di sessione (Tipo, Fornitore, Data1, Orario1, Data2, Orario2, Luogo) e calcolare **automaticamente** Data2/Orario2 in base alle ore del corso
4. Esportare un Excel identico a `I:\Il mio Drive\Formazione\caricamento.xlsx` (formato consumato dallo skill `automazione_formazione`)

## Formato file di riferimento (caricamento.xlsx)
- **Colonne blu** (fill `1F4E79`, A-T): `matricola, cognome, nome, mansione, cantiere, sottocantiere, tipo corso, upgrade, data esecuzione, data scadenza, data prevista, note, stato, responsabile, referente, data nascita, luogo nascita, codice fiscale, mail, cellulare` — identiche all'export Formazione principale (`/api/formazione/export`)
- **Colonne verdi** (fill `2E7D32`, U-AA): `TIPO, FORNITORE, DATA1, ORARIO1, DATA2, ORARIO2, LUOGO` — compilate a mano oggi, da far compilare/calcolare nel gestionale

## Bug trovato nell'export Pianificazione esistente
File: `src/app/api/formazione/pianificazione/export/route.ts`
- Colonne blu `data nascita, luogo nascita, codice fiscale, mail, cellulare` sono **hardcoded stringa vuota**, mai popolate dai dati reali
- Colonne verdi incomplete: solo `TIPO, id, DATA, LUOGO` (manca `FORNITORE, ORARIO1, DATA2, ORARIO2`; `id` non serve, non è nel formato target)
- Va riscritto per allinearsi esattamente all'header target sopra

## Decisioni già prese con l'utente
- Calcolo automatico giorno2/orario: **regola fissa 9:00-18:00 per giornata**, il resto delle ore va sul giorno successivo (es. corso preposto 12h → giorno1 09:00-18:00 (8h), giorno2 09:00-13:00 (4h) — esempio reale nel file)
- Le ore-per-corso non sono ancora nel DB: l'utente sta compilando `I:\Il mio Drive\Formazione\ore_corsi_da_compilare.xlsx` (generato in questa sessione, 58 righe: 31 corsi nativi + 27 aggiornamenti, colonne `codice, titolo, tipo, ore e-learning, ore aula/FAD`) — **aspettare che l'utente lo ridia compilato prima di costruire la tabella ore**

## Riferimento ore esistente (fonte manuale attuale, NON nel gestionale)
`I:\Il mio Drive\Formazione\listino_prezzi.xlsx`, foglio "Mapping": associa `tipo corso` (testo libero, es. "generale + specifica rischio basso") a un nome corso con ore incluse nel nome (es. "Formazione Generale + Specifica Rischio Basso (8h)"). Utile come riferimento/cross-check quando arrivano le ore compilate dall'utente, ma la fonte di verità sarà la nuova tabella nel DB.

## Stato del modulo Pianificazione (già fatto in questa sessione, per contesto)
File: `src/app/home/formazione/pianificazione/page.tsx`
- Filtro fabbisogni ora include correttamente `upgrade` e `bloccato` (bug fix: prima li escludeva)
- Aggiunta ricerca testuale + filtri corso/cantiere/mansione/stato
- Colonne Mansione/Cantiere in tabella + badge bloccato
- "Seleziona tutti" opera solo sui filtrati

Bozze salvate in tabella `training_plan_drafts` via `/api/formazione/pianificazione/drafts` (POST): se `planned_date` presente → upsert diretto su `training_employee_courses` con `manual_state=programmato` (scrive subito il badge); se assente → salva solo bozza, non tocca lo stato del lavoratore.

## Prossimi passi (in ordine)
1. **Aspettare** `ore_corsi_da_compilare.xlsx` compilato dall'utente
2. Creare tabella DB `training_course_hours` (o estendere `training_courses`) con ore per modalità (e-learning/aula) per corso
3. Estendere `training_plan_drafts` (o nuova tabella `training_plan_sessions`) con campi: tipo, fornitore, luogo, data1, orario1, data2, orario2 — attenzione: una sessione serve MOLTI lavoratori insieme, valutare se questi campi vanno su un record "sessione" condiviso invece che duplicati per ogni riga lavoratore+corso
4. Form nella modale "Aggiungi a Pianificazione": campi Tipo/Fornitore/Luogo/Data1/Orario1 + calcolo automatico Data2/Orario2 (regola 9-18 fissa)
5. Riscrivere `src/app/api/formazione/pianificazione/export/route.ts` per output identico a `caricamento.xlsx` (blu popolate da dati reali, verdi complete e allineate)
6. Verificare via live preview (login `s.grassi@iltucano.net`) prima di pushare

## File coinvolti
- `src/app/home/formazione/pianificazione/page.tsx` (UI)
- `src/app/api/formazione/pianificazione/drafts/route.ts` (salvataggio bozze/programmato)
- `src/app/api/formazione/pianificazione/export/route.ts` (export — da riscrivere)
- Nuova migration Supabase per tabella ore-corso e/o estensione drafts
