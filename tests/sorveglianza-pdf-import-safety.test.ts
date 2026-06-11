import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertImportRunErrors, makePdfImportUpsertsSafe } from "../src/app/api/sorveglianza_sanitaria/import-pdf/route";

function createSupabaseMock() {
  const insertedErrors: unknown[] = [];

  const supabase = {
    from(table: string) {
      if (table === "medical_surveillance_records") {
        return {
          select(_fields: string) {
            void _fields;
            return {
              in(_field: string, _values: number[]) {
                void _field;
                void _values;
                return Promise.resolve({
                  data: [{ employee_id: 1, next_due_date: "2027-01-01", limitations: "LIM_VECCHIE" }],
                  error: null,
                });
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

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { supabase, insertedErrors };
}

test("makePdfImportUpsertsSafe: permette di correggere una scadenza salvata troppo avanti", async () => {
  const mock = createSupabaseMock();
  const result = await makePdfImportUpsertsSafe({
    supabase: mock.supabase,
    rows: [
      {
        page: 1,
        upsert: { employee_id: 1, created_by: null, next_due_date: "2026-01-01", limitations: "LIM_NUOVE" },
      },
    ],
  });

  assert.equal(result.skippedOlderDueDates, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.upsert.next_due_date, "2026-01-01");
  assert.equal(result.rows[0]?.upsert.limitations, "LIM_NUOVE");
});

test("insertImportRunErrors: mappa page->row_number e salva tax_code", async () => {
  const mock = createSupabaseMock();
  await insertImportRunErrors({
    supabase: mock.supabase,
    importRunId: "run_pdf_1",
    errors: [{ page: 10, taxCode: "RSSMRA80A01H501Z", errorType: "employee_not_found", errorMessage: "Missing" }],
  });

  assert.equal(mock.insertedErrors.length, 1);
  const row = mock.insertedErrors[0] as { import_run_id: string; row_number: number; tax_code: string; error_type: string };
  assert.equal(row.import_run_id, "run_pdf_1");
  assert.equal(row.row_number, 10);
  assert.equal(row.tax_code, "RSSMRA80A01H501Z");
  assert.equal(row.error_type, "employee_not_found");
});
