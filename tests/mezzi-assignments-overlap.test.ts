import assert from "node:assert/strict";
import test from "node:test";
import { assetAssignmentOverlaps } from "../src/app/api/mezzi_attrezzature/assignments/route";

test("assetAssignmentOverlaps: gestisce end_date null come infinito", () => {
  assert.equal(
    assetAssignmentOverlaps({ startA: "2026-01-01", endA: null, startB: "2026-02-01", endB: null }),
    true,
  );
  assert.equal(
    assetAssignmentOverlaps({ startA: "2026-01-01", endA: "2026-01-31", startB: "2026-02-01", endB: null }),
    false,
  );
});

test("assetAssignmentOverlaps: non overlap se [) contiguo", () => {
  assert.equal(
    assetAssignmentOverlaps({ startA: "2026-01-01", endA: "2026-01-10", startB: "2026-01-11", endB: "2026-01-20" }),
    false,
  );
});
