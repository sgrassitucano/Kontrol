import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isoToItDate,
  normalizeItDateDraft,
  parseStrictIsoDateToIso,
  parseStrictItDateToIso,
} from "./it-date";

test("isoToItDate: ISO -> gg/mm/aaaa", () => {
  assert.equal(isoToItDate("2026-06-24"), "24/06/2026");
  assert.equal(isoToItDate("2026-06-24T10:00:00Z"), "24/06/2026");
});

test("isoToItDate: vuoto o non-ISO", () => {
  assert.equal(isoToItDate(null), "");
  assert.equal(isoToItDate(""), "");
  assert.equal(isoToItDate("ciao"), "ciao");
});

test("normalizeItDateDraft: inserisce le barre mentre si digita", () => {
  assert.equal(normalizeItDateDraft("24"), "24");
  assert.equal(normalizeItDateDraft("2406"), "24/06");
  assert.equal(normalizeItDateDraft("24062026"), "24/06/2026");
  assert.equal(normalizeItDateDraft("24/06/2026999"), "24/06/2026");
});

test("parseStrictIsoDateToIso: valida solo date reali", () => {
  assert.equal(parseStrictIsoDateToIso("2026-06-24"), "2026-06-24");
  assert.equal(parseStrictIsoDateToIso("2026-02-30"), null); // 30 febbraio non esiste
  assert.equal(parseStrictIsoDateToIso("24/06/2026"), null); // formato sbagliato
  assert.equal(parseStrictIsoDateToIso(""), null);
});

test("parseStrictItDateToIso: gg/mm/aaaa -> ISO", () => {
  assert.equal(parseStrictItDateToIso("24/06/2026"), "2026-06-24");
  assert.equal(parseStrictItDateToIso("31/02/2026"), null); // data inesistente
  assert.equal(parseStrictItDateToIso("2026-06-24"), null); // formato sbagliato
});
