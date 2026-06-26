import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx-js-style";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processAnagraficaImport } from "../src/lib/import/anagrafica";

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function buildWorkbookBuffer(dataRows: string[][]) {
  const headers = [
    "Matricola", "Cognome", "Nome", "Data nascita", "Luogo nascita", "Codice fiscale",
    "Telefono", "Cellulare", "Email 1", "Email 2", "Referente", "Responsabile Tecnico 1",
    "Mansione (ca4)", "Specifiche Mansione", "Cantiere (ca28)", "Sottocantiere 1",
    "Provincia nascita", "Teorico settimanale (ca5)", "CAP residenza", "Comune residenza",
    "Indirizzo residenza", "Provincia residenza", "Sesso", "Codice comune residenza",
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Import anagrafica"], headers, ...dataRows, ["Totale"], ["Fine"]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Dipendenti");
  return toArrayBuffer(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

function row(matricola: string, cf: string, cognome = "Tizio", nome = "Caio") {
  return [matricola, cognome, nome, "01/01/1980", "Roma", cf, "", "", "", "", "", "RESP1",
    "Operaio", "", "SPU", "", "RM", "2400", "00100", "Roma", "Via Roma 1", "RM", "M", "H501"];
}

function existing(id: number, matricola: string, tax_code: string) {
  return { id, matricola, tax_code, first_name: "X", last_name: "Y", status: "attivo",
    last_imported_at: null, sex: null, birth_province: null, residence_address: null,
    residence_postal_code: null, residence_city: null, residence_province: null, residence_belfiore_code: null };
}

// Mock che cattura i codici fiscali passati alla dimissione (employees.update().in())
function createMock(existingEmployees: unknown[]) {
  const dismissedTaxCodes: string[] = [];
  const supabase = {
    from(table: string) {
      if (table === "employees") {
        return {
          select: () => ({ range: (f: number, t: number) => Promise.resolve({ data: existingEmployees.slice(f, t + 1), error: null }) }),
          upsert: () => Promise.resolve({ error: null }),
          update: (payload: { status?: string }) => ({
            in: (_field: string, values: string[]) => {
              if (payload?.status === "dimesso") dismissedTaxCodes.push(...values);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "import_runs") {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "run_1" }, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "sites") {
        return {
          upsert: () => Promise.resolve({ error: null }),
          select: () => ({ in: (_f: string, v: string[]) => Promise.resolve({ data: v.map((normalized_name, i) => ({ id: i + 1, normalized_name })), error: null }) }),
        };
      }
      if (table === "sub_sites") {
        return { upsert: () => Promise.resolve({ error: null }), select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
      }
      // import_run_errors, anagrafica_import_tax_codes, import_run_changes
      return { insert: () => Promise.resolve({ error: null }) };
    },
  } as unknown as SupabaseClient;
  return { supabase, dismissedTaxCodes };
}

test("opzione B: con un CF duplicato nel file, i dimessi veri vengono comunque tolti", async () => {
  const A = "RSSMRA80A01H501Z"; // presente nel file (due volte = duplicato)
  const B = "BNCLCU81B02F205X"; // assente dal file -> deve essere dimesso
  const fileBuffer = buildWorkbookBuffer([row("0001", A), row("0001", A)]);

  const mock = createMock([existing(1, "0001", A), existing(2, "0002", B)]);
  const result = await processAnagraficaImport({
    fileBuffer,
    fileName: "con-duplicato.xlsx",
    mode: "commit",
    supabase: mock.supabase,
    confirmHighDismissals: true,
    confirmCriticalDismissals: true,
    confirmDismissalPhrase: "CONFERMO DIMISSIONE MASSIVA",
  });

  // Non è più bloccato: arriva al commit
  assert.equal(result.mode, "commit");
  assert.equal(result.importRunId, "run_1");
  // Il duplicato è segnalato come errore...
  assert.ok(result.errors.some((e) => e.errorType === "duplicate_tax_code_file"));
  // ...ma il dimesso vero (B) è stato tolto lo stesso
  assert.deepEqual(mock.dismissedTaxCodes, [B]);
});
