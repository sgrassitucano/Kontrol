import assert from "node:assert/strict";
import test from "node:test";
import { resolveCourseState, isValidCourseStatus, type CourseStatusRow, type CourseRow } from "../src/lib/training/engine";

const TODAY = "2026-06-25";
const DAYS = 30;

function course(over: Partial<CourseRow> = {}): CourseRow {
  return { id: 1, code: "FORM_BASE", title: "Base", is_active: true, validity_years: 5, is_unlimited: false, ...over };
}
function status(over: Partial<CourseStatusRow> = {}): CourseStatusRow {
  return { employee_id: 1, course_id: 1, completion_date: null, expiry_date: null, planned_date: null, manual_state: null, note: null, ...over };
}

test("resolveCourseState: idoneo se scadenza lontana", () => {
  const s = resolveCourseState(status({ completion_date: "2025-01-01", expiry_date: "2027-01-01" }), course(), undefined, TODAY, DAYS);
  assert.equal(s, "idoneo");
});

test("resolveCourseState: in scadenza entro la soglia", () => {
  const s = resolveCourseState(status({ completion_date: "2021-07-10", expiry_date: "2026-07-10" }), course(), undefined, TODAY, DAYS);
  assert.equal(s, "in scadenza");
});

test("resolveCourseState: scaduto (entro 6 mesi)", () => {
  const s = resolveCourseState(status({ completion_date: "2021-06-01", expiry_date: "2026-06-01" }), course(), undefined, TODAY, DAYS);
  assert.equal(s, "scaduto");
});

test("resolveCourseState: perso solo oltre 10 anni dalla scadenza", () => {
  // scaduto da ~11 anni -> perso
  assert.equal(resolveCourseState(status({ completion_date: "2009-01-01", expiry_date: "2014-01-01" }), course(), undefined, TODAY, DAYS), "perso");
  // scaduto da ~1,5 anni -> ancora "scaduto", NON perso
  assert.equal(resolveCourseState(status({ completion_date: "2020-01-01", expiry_date: "2025-01-01" }), course(), undefined, TODAY, DAYS), "scaduto");
});

test("resolveCourseState: da fare se nessun dato", () => {
  assert.equal(resolveCourseState(undefined, course(), undefined, TODAY, DAYS), "da fare");
  assert.equal(resolveCourseState(status(), course(), undefined, TODAY, DAYS), "da fare");
});

test("resolveCourseState: programmato se c'è data prevista", () => {
  const s = resolveCourseState(status({ planned_date: "2026-09-01" }), course(), undefined, TODAY, DAYS);
  assert.equal(s, "programmato");
});

test("resolveCourseState: sospeso se il lavoratore è congelato", () => {
  const freeze = { employee_id: 1, freeze_status: "malattia", start_date: "2026-01-01", end_date: null };
  const s = resolveCourseState(status({ completion_date: "2025-01-01", expiry_date: "2020-01-01" }), course(), freeze, TODAY, DAYS);
  assert.equal(s, "sospeso");
});

test("resolveCourseState: corso illimitato sempre idoneo", () => {
  const s = resolveCourseState(status({ completion_date: "2010-01-01" }), course({ is_unlimited: true }), undefined, TODAY, DAYS);
  assert.equal(s, "idoneo");
});

test("resolveCourseState: data sentinella (2069) = illimitato/idoneo", () => {
  const s = resolveCourseState(status({ completion_date: "2020-01-01", expiry_date: "2069-01-01" }), course(), undefined, TODAY, DAYS);
  assert.equal(s, "idoneo");
});

test("resolveCourseState: scadenza calcolata da validità se manca expiry", () => {
  // concluso 2026-01-01, validità 5 anni -> scade 2031, idoneo
  const s = resolveCourseState(status({ completion_date: "2026-01-01" }), course({ validity_years: 5 }), undefined, TODAY, DAYS);
  assert.equal(s, "idoneo");
});

test("isValidCourseStatus: valido se non scaduto, non valido se scaduto", () => {
  assert.equal(isValidCourseStatus(status({ completion_date: "2025-01-01", expiry_date: "2027-01-01" }), course(), TODAY), true);
  assert.equal(isValidCourseStatus(status({ completion_date: "2020-01-01", expiry_date: "2025-01-01" }), course(), TODAY), false);
  assert.equal(isValidCourseStatus(status({ manual_state: "escluso", completion_date: "2025-01-01" }), course(), TODAY), false);
});
