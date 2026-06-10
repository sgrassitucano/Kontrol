import assert from "node:assert/strict";
import test from "node:test";
import { pickAbsenceForShift } from "../src/app/api/turni/sync/route";

test("pickAbsenceForShift: deterministico (prima per start_at, poi per id)", () => {
  const absences = [
    { id: 20, absence_type: "ferie" as const, start_at: "2026-06-01T00:00:00.000Z", end_at: "2026-06-30T23:59:59.000Z", note: null },
    { id: 10, absence_type: "malattia" as const, start_at: "2026-06-01T00:00:00.000Z", end_at: "2026-06-02T23:59:59.000Z", note: null },
    { id: 30, absence_type: "permesso" as const, start_at: "2026-05-31T00:00:00.000Z", end_at: "2026-06-01T23:59:59.000Z", note: null },
  ];

  const picked = pickAbsenceForShift(absences, "2026-06-01T08:00:00.000Z", "2026-06-01T12:00:00.000Z");
  assert.ok(picked);
  assert.equal(picked.id, 30);
});

