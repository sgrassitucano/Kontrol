import assert from "node:assert/strict";
import test from "node:test";
import { collapseUpsertsByEmployeeId } from "../src/app/api/sorveglianza_sanitaria/import-pdf/route";

test("collapseUpsertsByEmployeeId: tiene il certificato con scadenza più recente senza mescolare limitazioni vecchie", () => {
  const rows = collapseUpsertsByEmployeeId([
    {
      page: 1,
      employee_id: 10,
      created_by: null,
      next_due_date: "2026-06-01",
      limitations: "LIMITAZIONI VECCHIE",
    },
    {
      page: 2,
      employee_id: 10,
      created_by: null,
      next_due_date: "2027-06-01",
      limitations: "LIMITAZIONI NUOVE",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.page, 2);
  assert.equal(rows[0]?.upsert.next_due_date, "2027-06-01");
  assert.equal(rows[0]?.upsert.limitations, "LIMITAZIONI NUOVE");
});

test("collapseUpsertsByEmployeeId: a parità di scadenza vince la pagina più recente", () => {
  const rows = collapseUpsertsByEmployeeId([
    {
      page: 4,
      employee_id: 12,
      created_by: null,
      next_due_date: "2027-06-01",
      limitations: "PRIMA",
    },
    {
      page: 8,
      employee_id: 12,
      created_by: null,
      next_due_date: "2027-06-01",
      limitations: "SECONDA",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.page, 8);
  assert.equal(rows[0]?.upsert.next_due_date, "2027-06-01");
  assert.equal(rows[0]?.upsert.limitations, "SECONDA");
});

test("collapseUpsertsByEmployeeId: una riga senza scadenza non sostituisce una riga valida già trovata", () => {
  const rows = collapseUpsertsByEmployeeId([
    {
      page: 3,
      employee_id: 15,
      created_by: null,
      next_due_date: "2028-01-15",
      limitations: "IDONEO CON LIMITAZIONI",
    },
    {
      page: 6,
      employee_id: 15,
      created_by: null,
      limitations: "SENZA SCADENZA",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.page, 3);
  assert.equal(rows[0]?.upsert.next_due_date, "2028-01-15");
  assert.equal(rows[0]?.upsert.limitations, "IDONEO CON LIMITAZIONI");
});
