import assert from "node:assert/strict";
import test from "node:test";
import { assessDismissalRisk } from "../src/lib/import/anagrafica";

test("assessDismissalRisk: nessun rischio se non ci sono attivi o dimessi", () => {
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 0, dismissedRows: 0, snapshotTaxCodes: 0 }), "none");
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 0, snapshotTaxCodes: 100 }), "none");
});

test("assessDismissalRisk: warning sopra il 5%", () => {
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 6, snapshotTaxCodes: 94 }), "warning");
});

test("assessDismissalRisk: critical se non ci sono CF validi nello snapshot", () => {
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 100, snapshotTaxCodes: 0 }), "critical");
});

test("assessDismissalRisk: critical per dimissioni massive percentuali o assolute", () => {
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 100, dismissedRows: 21, snapshotTaxCodes: 79 }), "critical");
  assert.equal(assessDismissalRisk({ existingActiveEmployees: 400, dismissedRows: 50, snapshotTaxCodes: 350 }), "critical");
});

