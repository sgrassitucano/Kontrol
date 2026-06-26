import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeJobCode, normalizeFreeTextKey, buildJobVariantKey } from "./normalize";

test("normalizeJobCode: maiuscolo, niente spazi, punti compattati", () => {
  assert.equal(normalizeJobCode("op.  edile"), "OP.EDILE");
  assert.equal(normalizeJobCode(".A..B."), "A.B");
  assert.equal(normalizeJobCode("  capo squadra "), "CAPOSQUADRA");
});

test("normalizeFreeTextKey: chiave alfanumerica con underscore", () => {
  assert.equal(normalizeFreeTextKey("Cantiere Nord!"), "CANTIERE_NORD");
  assert.equal(normalizeFreeTextKey("  a--b  "), "A_B");
  assert.equal(normalizeFreeTextKey(""), "");
});

test("buildJobVariantKey: combina mansione e note", () => {
  assert.equal(buildJobVariantKey("Operaio", "turno notte"), "OPERAIO__TURNO_NOTTE");
  assert.equal(buildJobVariantKey("Operaio", null), null); // senza note nessuna variante
  assert.equal(buildJobVariantKey("", "solo note"), "SOLO_NOTE");
});
