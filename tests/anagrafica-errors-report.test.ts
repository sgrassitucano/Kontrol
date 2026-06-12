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
    "Matricola",
    "Cognome",
    "Nome",
    "Data nascita",
    "Luogo nascita",
    "Codice fiscale",
    "Telefono",
    "Cellulare",
    "Email 1",
    "Email 2",
    "Referente",
    "Responsabile Tecnico 1",
    "Mansione (ca4)",
    "Specifiche Mansione",
    "Cantiere (ca28)",
    "Sottocantiere 1",
    "Provincia nascita",
    "Teorico settimanale (ca5)",
    "CAP residenza",
    "Comune residenza",
    "Indirizzo residenza",
    "Provincia residenza",
    "Sesso",
    "Codice comune residenza",
  ];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Import anagrafica"], headers, ...dataRows, ["Totale"], ["Fine"]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Dipendenti");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return toArrayBuffer(buffer);
}

function createCommitSupabaseMock() {
  const insertedErrors: unknown[] = [];

  const supabase = {
    from(table: string) {
      if (table === "employees") {
        return {
          select() {
            return {
              range(_from: number, _to: number) {
                void _from;
                void _to;
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          upsert(_rows: unknown, _opts: unknown) {
            void _rows;
            void _opts;
            return Promise.resolve({ error: null });
          },
          update(_payload: unknown) {
            void _payload;
            return {
              in(_field: string, _values: unknown[]) {
                void _field;
                void _values;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "import_runs") {
        return {
          insert(_payload: unknown) {
            void _payload;
            return {
              select(_fields: string) {
                void _fields;
                return {
                  single() {
                    return Promise.resolve({ data: { id: "run_anag_1" }, error: null });
                  },
                };
              },
            };
          },
          update(_payload: unknown) {
            void _payload;
            return {
              eq(_field: string, _value: string) {
                void _field;
                void _value;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "import_run_errors") {
        return {
          insert(rows: unknown[]) {
            insertedErrors.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "sites") {
        return {
          upsert(_payload: unknown, _opts: unknown) {
            void _payload;
            void _opts;
            return Promise.resolve({ error: null });
          },
          select(_fields: string) {
            void _fields;
            return {
              in(_field: string, values: string[]) {
                void _field;
                return Promise.resolve({
                  data: values.map((normalized_name, i) => ({ id: i + 1, normalized_name })),
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "sub_sites") {
        return {
          upsert(_payload: unknown, _opts: unknown) {
            void _payload;
            void _opts;
            return Promise.resolve({ error: null });
          },
          select(_fields: string) {
            void _fields;
            return {
              in(_field: string, _values: unknown[]) {
                void _field;
                void _values;
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }

      if (table === "anagrafica_import_tax_codes") {
        return {
          insert(_payload: unknown) {
            void _payload;
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "import_run_changes") {
        return {
          insert(_payload: unknown) {
            void _payload;
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { supabase, insertedErrors };
}

test("processAnagraficaImport(commit): persiste import_run_errors se presenti", async () => {
  const fileBuffer = buildWorkbookBuffer([
    [
      "0001",
      "Rossi",
      "Mario",
      "01/01/1980",
      "Roma",
      "RSSMRA80A01H501Z",
      "",
      "",
      "email-non-valida",
      "",
      "",
      "RESP1",
      "Operaio",
      "",
      "SPU",
      "",
      "RM",
      "2400",
      "",
      "",
      "",
      "",
      "X",
      "L833",
    ],
  ]);

  const mock = createCommitSupabaseMock();
  const result = await processAnagraficaImport({
    fileBuffer,
    fileName: "anagrafica.xlsx",
    mode: "commit",
    supabase: mock.supabase,
    importedBy: null,
    confirmHighDismissals: true,
    confirmCriticalDismissals: true,
  });

  assert.equal(result.mode, "commit");
  assert.equal(result.importRunId, "run_anag_1");
  assert.equal(mock.insertedErrors.length > 0, true);
  const row = mock.insertedErrors[0] as { import_run_id: string; error_type: string; row_number: number };
  assert.equal(row.import_run_id, "run_anag_1");
  assert.equal(row.error_type, "row_imported_with_issues");
  assert.equal(row.row_number, 3);
});
