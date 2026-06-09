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
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Import anagrafica"],
    headers,
    ...dataRows,
    ["Totale"],
    ["Fine"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Dipendenti");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return toArrayBuffer(buffer);
}

function createPreviewSupabase(existingEmployees: unknown[] = []) {
  return {
    from(table: string) {
      assert.equal(table, "employees");
      return {
        select() {
          return {
            range(from: number, to: number) {
              return Promise.resolve({
                data: existingEmployees.slice(from, to + 1),
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

test("processAnagraficaImport: importa le righe sporche con warning ma blocca quelle invalide", async () => {
  const fileBuffer = buildWorkbookBuffer([
    [
      "0001",
      "Rossi",
      "Giulia",
      "01/02/1990",
      "Roma",
      "RSSGLI90B41H501Z",
      "061234",
      "3331234567",
      "mail-non-valida",
      "",
      "REF1",
      "RESP1",
      "Impiegata",
      "",
      "SPU",
      "SALOV",
      "Roma",
      "2400",
      "12",
      "Roma",
      "Via Roma 1",
      "RM",
      "X",
      "L833",
    ],
    [
      "0002",
      "Bianchi",
      "Luca",
      "10/03/1988",
      "Milano",
      "",
      "",
      "",
      "luca@example.com",
      "",
      "",
      "RESP2",
      "Operaio",
      "",
      "SPU",
      "",
      "MI",
      "2400",
      "20100",
      "Milano",
      "Via Milano 2",
      "MI",
      "M",
      "F205",
    ],
    [
      "0003",
      "Verdi",
      "Anna",
      "11/04/1991",
      "Torino",
      "RSSGLI90B41H501Z",
      "",
      "",
      "anna@example.com",
      "",
      "",
      "RESP3",
      "Operaio",
      "",
      "SPU",
      "",
      "TO",
      "2400",
      "10100",
      "Torino",
      "Via Torino 3",
      "TO",
      "F",
      "L219",
    ],
  ]);

  const result = await processAnagraficaImport({
    fileBuffer,
    fileName: "sporco.xlsx",
    mode: "preview",
    supabase: createPreviewSupabase(),
  });

  assert.equal(result.mode, "preview");
  assert.equal(result.summary.totalRows, 3);
  assert.equal(result.summary.validRows, 1);
  assert.equal(result.summary.errorRows, 3);
  assert.equal(result.previewRows.length, 1);
  assert.equal(result.previewRows[0]?.matricola, "0001");

  const warning = result.errors.find((row) => row.errorType === "row_imported_with_issues");
  assert.ok(warning);
  assert.match(warning.errorMessage, /sesso non valido/i);
  assert.match(warning.errorMessage, /cap residenza non valido/i);
  assert.match(warning.errorMessage, /email 1 non valida/i);

  assert.ok(result.errors.some((row) => row.errorType === "required_identity_fields"));
  assert.ok(result.errors.some((row) => row.errorType === "duplicate_tax_code_file"));
});
