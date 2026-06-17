import assert from "node:assert/strict";
import test from "node:test";
import { makeMedicalSurveillanceUpsertsSafe, parseDateToIso } from "../src/lib/import/sorveglianza";

test("parseDateToIso: formato italiano", () => {
  assert.equal(parseDateToIso("01/07/2026"), "2026-07-01");
  assert.equal(parseDateToIso("11/06/2026"), "2026-06-11");
  assert.equal(parseDateToIso("7/1/2026"), "2026-01-07");
  assert.equal(parseDateToIso("07/01/2026"), "2026-01-07");
});

test("upsert safe: il file puo correggere una scadenza piu alta salvata male", () => {
  const existingByEmployeeId = new Map([
    [
      1,
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: "2027-01-01",
        limitations: "LIM",
        notes: "N",
      },
    ],
  ]);

  const { rows, skippedOlderDueDates } = makeMedicalSurveillanceUpsertsSafe({
    rows: [
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: "2026-07-01",
        limitations: "NUOVE",
        notes: "NUOVE",
        created_by: null,
      },
    ],
    existingByEmployeeId,
  });

  assert.equal(skippedOlderDueDates, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].next_due_date, "2026-07-01");
  assert.equal(rows[0].limitations, "NUOVE");
  assert.equal(rows[0].notes, "NUOVE");
});

test("upsert safe: non peggiora una scadenza gia piu vicina (file posticipa)", () => {
  const existingByEmployeeId = new Map([
    [
      1,
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: "2026-07-01",
        limitations: null,
        notes: null,
      },
    ],
  ]);

  const { rows, skippedOlderDueDates } = makeMedicalSurveillanceUpsertsSafe({
    rows: [
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: "2027-01-01",
        limitations: null,
        notes: null,
        created_by: null,
      },
    ],
    existingByEmployeeId,
  });

  assert.equal(skippedOlderDueDates, 1);
  assert.equal(rows.length, 1);
  assert.equal("next_due_date" in rows[0], false);
});

test("upsert safe: non azzera scadenza quando manca nel file (visita SI)", () => {
  const existingByEmployeeId = new Map([
    [
      1,
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: "2027-01-01",
        limitations: null,
        notes: null,
      },
    ],
  ]);

  const { rows, skippedOlderDueDates } = makeMedicalSurveillanceUpsertsSafe({
    rows: [
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: null,
        limitations: null,
        notes: null,
        created_by: null,
      },
    ],
    existingByEmployeeId,
  });

  assert.equal(skippedOlderDueDates, 0);
  assert.equal(rows.length, 1);
  assert.equal("next_due_date" in rows[0], false);
});

test("upsert safe: mantiene aggiornamenti di limitazioni e note anche senza nuova scadenza", () => {
  const existingByEmployeeId = new Map([
    [
      1,
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: "2027-01-01",
        limitations: "VECCHIE",
        notes: "NOTE_VECCHIE",
      },
    ],
  ]);

  const { rows } = makeMedicalSurveillanceUpsertsSafe({
    rows: [
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: null,
        limitations: "NUOVE_LIMITAZIONI",
        notes: "NUOVE_NOTE",
        created_by: null,
      },
    ],
    existingByEmployeeId,
  });

  assert.equal(rows.length, 1);
  assert.equal("next_due_date" in rows[0], false);
  assert.equal(rows[0].limitations, "NUOVE_LIMITAZIONI");
  assert.equal(rows[0].notes, "NUOVE_NOTE");
});

test("upsert safe: visita NO forza scadenza null", () => {
  const existingByEmployeeId = new Map([
    [
      1,
      {
        employee_id: 1,
        requires_visit: true,
        next_due_date: "2027-01-01",
        limitations: "LIM",
        notes: "N",
      },
    ],
  ]);

  const { rows } = makeMedicalSurveillanceUpsertsSafe({
    rows: [
      {
        employee_id: 1,
        requires_visit: false,
        next_due_date: "2027-01-01",
        limitations: "",
        notes: "",
        created_by: null,
      },
    ],
    existingByEmployeeId,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].next_due_date, null);
  assert.equal("limitations" in rows[0], false);
  assert.equal("notes" in rows[0], false);
});
