import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx-js-style";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commitLegacyTrainingImport } from "../src/lib/import/training-legacy";

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function buildWorkbookBuffer(dataRows: unknown[][]) {
  const headers = ["Dip.", "Cognome", "Nome", "Scadenza", "Inizio scadenza", "Eff.", "Note", "Data scadenza"];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Legacy");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return toArrayBuffer(buffer);
}

function createSupabaseMock() {
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
                return Promise.resolve({
                  data: [{ id: 1, matricola: "0001", tax_code: "RSSMRA80A01H501Z", last_name: "Rossi", first_name: "Mario", status: "attivo" }],
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "training_courses") {
        return {
          select() {
            return {
              eq(_field: string, _value: boolean) {
                void _field;
                void _value;
                return {
                  order(_field2: string) {
                    void _field2;
                    return Promise.resolve({
                      data: [{ id: 1, code: "FORM_BASE", title: "Formazione generale base", validity_years: 5, is_unlimited: false }],
                      error: null,
                    });
                  },
                };
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

test("commitLegacyTrainingImport: persiste import_run_errors dalle issues preview", async () => {
  const fileBuffer = buildWorkbookBuffer([["0001", "Rossi", "Mario", "FORM_BASE", "", "", "", ""]]);
  const mock = createSupabaseMock();

  const result = await commitLegacyTrainingImport({
    fileBuffer,
    supabase: mock.supabase,
    importRunId: "run_form_1",
  });

  assert.equal(result.summary.issueRows, 1);
  assert.equal(mock.insertedErrors.length, 1);
  const row = mock.insertedErrors[0] as { import_run_id: string; error_type: string; row_number: number };
  assert.equal(row.import_run_id, "run_form_1");
  assert.equal(row.error_type, "missing_start_date");
  assert.equal(row.row_number, 2);
});
