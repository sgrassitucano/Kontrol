import assert from "node:assert/strict";
import test from "node:test";
import { assessDismissalRisk } from "../src/lib/import/anagrafica";

test("assessDismissalRisk: nessun rischio se non ci sono attivi o dimessi", () => {
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 0, dismissedRows: 0, snapshotTaxCodes: 0 }), "none");
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 0, snapshotTaxCodes: 100 }), "none");
});

test("assessDismissalRisk: warning per dimissioni numeriche >= 10", () => {
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 9, snapshotTaxCodes: 91 }), "none");
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 10, snapshotTaxCodes: 90 }), "warning");
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 15, snapshotTaxCodes: 85 }), "warning");
});

test("assessDismissalRisk: critical se non ci sono CF validi nello snapshot", () => {
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 100, snapshotTaxCodes: 0 }), "critical");
});

test("assessDismissalRisk: critical per dimissioni massive numeriche >= 50", () => {
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 49, snapshotTaxCodes: 51 }), "warning");
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 50, snapshotTaxCodes: 50 }), "critical");
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 400, dismissedRows: 55, snapshotTaxCodes: 345 }), "critical");
});

