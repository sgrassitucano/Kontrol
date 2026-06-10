import assert from "node:assert/strict";
import test from "node:test";
import { computeDpiState } from "../src/app/api/lavoratori/dpi/route";

test("computeDpiState: programmato se non consegnato ma pianificato", () => {
  assert.equal(
    computeDpiState({
      deliveredDate: null,
      plannedDate: "2026-06-01",
      nextCheckDate: null,
      todayIsoDate: "2026-06-01",
      thresholdIsoDate: "2026-07-01",
    }),
    "programmato",
  );
});

test("computeDpiState: scaduto se prossimo controllo < oggi", () => {
  assert.equal(
    computeDpiState({
      deliveredDate: "2026-01-01",
      plannedDate: null,
      nextCheckDate: "2026-05-31",
      todayIsoDate: "2026-06-01",
      thresholdIsoDate: "2026-07-01",
    }),
    "scaduto",
  );
});

test("computeDpiState: da verificare se prossimo controllo entro soglia", () => {
  assert.equal(
    computeDpiState({
      deliveredDate: "2026-01-01",
      plannedDate: null,
      nextCheckDate: "2026-06-15",
      todayIsoDate: "2026-06-01",
      thresholdIsoDate: "2026-07-01",
    }),
    "da verificare",
  );
});

