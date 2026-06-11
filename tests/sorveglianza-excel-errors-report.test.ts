import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx-js-style";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processMedicalSurveillanceImport } from "../src/lib/import/sorveglianza";

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function buildWorkbookBuffer(dataRows: unknown[][]) {
  const headers = [
    "Matricola",
    "Codice fiscale",
    "Cognome",
    "Nome",
    "Visita si/no",
    "Scadenza visita",
    "Limitazioni",
    "Note",
  ];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sorveglianza");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return toArrayBuffer(buffer);
}

function createCommitSupabaseMock(args: { employeeId: number; taxCode: string; matricola: string }) {
  const insertedErrors: unknown[] = [];
  const insertedChanges: unknown[] = [];

  const supabase = {
    from(table: string) {
      if (table === "employees") {
        return {
          select() {
            return {
              in(_field: string, _values: string[]) {
                void _field;
                void _values;
                return Promise.resolve({
                  data: [
                    {
                      id: args.employeeId,
                      tax_code: args.taxCode,
                      matricola: args.matricola,
                    },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "medical_surveillance_records") {
        return {
          select() {
            return {
              in(_field: string, _values: number[]) {
                void _field;
                void _values;
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          upsert(_rows: unknown, _opts: unknown) {
            void _rows;
            void _opts;
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "import_run_changes") {
        return {
          insert(rows: unknown[]) {
            insertedChanges.push(...rows);
            return Promise.resolve({ error: null });
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

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { supabase, insertedErrors, insertedChanges };
}

test("processMedicalSurveillanceImport(commit): persiste import_run_errors se presenti", async () => {
  const fileBuffer = buildWorkbookBuffer([
    ["0001", "RSSMRA80A01H501Z", "Rossi", "Mario", "boh", "data non valida", "", ""],
  ]);

  const mock = createCommitSupabaseMock({ employeeId: 1, taxCode: "RSSMRA80A01H501Z", matricola: "0001" });
  const result = await processMedicalSurveillanceImport({
    fileBuffer,
    mode: "commit",
    supabase: mock.supabase,
    importedBy: null,
    importRunId: "run_sorv_1",
  });

  assert.equal(result.mode, "commit");
  assert.equal(mock.insertedErrors.length > 0, true);
  const first = mock.insertedErrors[0] as { import_run_id: string; row_number: number; error_type: string };
  assert.equal(first.import_run_id, "run_sorv_1");
  assert.equal(first.row_number, 2);
  assert.equal(
    mock.insertedErrors.some((r) => (r as { error_type?: string }).error_type === "invalid_due_date"),
    true,
  );
  assert.equal(mock.insertedChanges.length, 0);
});
