# Checklist operativa (anti-rotture)

## Prima di un import

### Import Anagrafica
- Verifica che il file contenga tutti gli attivi (l’import marca dimessi chi non è presente nel file).
- Se l’anteprima segnala “dimessi > 5%”, fai commit solo se sei certo che il file sia completo.
- Dopo il commit controlla in Gestione → Import l’ultimo run e scarica il report errori (se presente).

### Import Sorveglianza (Excel)
- Verifica che la colonna “Scadenza visita” sia una data reale (non testo incollato casuale) e non una formula senza valore.
- Se nel file mancano scadenze ma “Visita SI”, l’import non azzera più le scadenze già presenti: controlla comunque il report errori.

### Import Sorveglianza (PDF)
- In caso di import massivo, usa sempre il “report errori” scaricabile dall’ultimo run.
- Le scadenze più vecchie rispetto al DB vengono ignorate automaticamente.

## Dopo un import (controlli rapidi)

### Sorveglianza sanitaria
- Cerca 3–5 lavoratori a campione e confronta scadenza/limitazioni con il documento sorgente.
- Filtra “Critico” e verifica che il totale abbia senso rispetto alle scadenze importate.
- Se hai fatto import massivo, scarica il report errori e risolvi prima i “employee_not_found” (anagrafica mancante).

### Formazione
- Controlla i KPI principali (scaduto/da fare/in scadenza/programmato).
- Apri il dettaglio di 2–3 lavoratori e verifica coerenenza tabella ↔ dettaglio.
- Se export per sistemi esterni: rigenera l’export e valida 2 righe EBAFOS e 2 righe PIATTAFORMA.

## Prima di un deploy
- Applica su Supabase la patch cumulativa DB: `supabase/999_next.sql` (una sola volta per ambiente).
- La patch cumulativa aggiorna anche strutture usate da hardening operativo recente:
  - `medical_surveillance_scope_rules.is_active`
  - `import_undo_deleted_rows`
- Verifica che le RPC richieste dai moduli operativi siano presenti (se mancano alcuni endpoint tornano errore):
  - `turni_replace_shift_breaks`
  - `fleet_complete_obligation`
- Esegui `npm run lint`
- Esegui `npm run build`
- Esegui `npm test`

## Rollback (se qualcosa va storto)
- Import Sorveglianza/Anagrafica/Formazione legacy: usa la funzione Undo dall’ultimo import run (dove disponibile).
- Se l’Undo import fallisce con errore archivio/patch DB mancante: applica `supabase/999_next.sql` prima di riprovare.
- Se il problema riguarda date/parse: reimporta il file corretto (l’import è progettato per convergere sul dato più recente).
- Se un endpoint inizia a dare 403 dopo patch DB: è quasi sempre una policy RLS più stretta; controlla che l’utente abbia il modulo giusto e lo scope corretto (responsabile/referente).
