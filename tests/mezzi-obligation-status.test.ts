import assert from "node:assert/strict";
import test from "node:test";
import { computeObligationStatus } from "../src/app/api/mezzi_attrezzature/obligations/route";

function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test("computeObligationStatus: da impostare se manca nextDueDate", () => {
  assert.equal(computeObligationStatus({ nextDueDate: null, thresholdIsoDate: addDaysIso(30) }), "da impostare");
});

test("computeObligationStatus: scaduto se nextDueDate < oggi", () => {
  assert.equal(computeObligationStatus({ nextDueDate: "1900-01-01", thresholdIsoDate: addDaysIso(30) }), "scaduto");
});

test("computeObligationStatus: ok se nextDueDate > soglia", () => {
  assert.equal(computeObligationStatus({ nextDueDate: "2999-01-01", thresholdIsoDate: addDaysIso(30) }), "ok");
});

test("computeObligationStatus: in scadenza se nextDueDate <= soglia e non scaduto", () => {
  const threshold = addDaysIso(30);
  const tomorrow = addDaysIso(1);
  assert.equal(computeObligationStatus({ nextDueDate: tomorrow, thresholdIsoDate: threshold }), "in scadenza");
});

