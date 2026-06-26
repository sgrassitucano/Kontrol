import assert from "node:assert/strict";
import test from "node:test";
import { buildFascicoloPdf, type FascicoloWorker } from "../src/lib/fascicolo/pdf";

function worker(over: Partial<FascicoloWorker> = {}): FascicoloWorker {
  return {
    cognome: "ROSSI", nome: "Mario", matricola: "0001", taxCode: "RSSMRA80A01H501Z",
    birthDate: "01/01/1980", birthPlace: "Roma", jobTitle: "Operaio", site: "SPU", subSite: "",
    responsibleCode: "RESP1", referral: "", phone: "3331234567", email: "mario@example.com",
    residence: "Via Roma 1, Roma (RM)", status: "attivo",
    formazione: [
      { corso: "Formazione generale", conclusione: "01/01/2024", scadenza: "01/01/2029", stato: "idoneo" },
      { corso: "Specifica rischio alto", conclusione: "01/01/2020", scadenza: "01/01/2025", stato: "scaduto" },
    ],
    visite: { stato: "in scadenza", scadenza: "30/07/2026", provider: "Studio X", limitazioni: "", note: "" },
    dpi: [{ dpi: "Casco", consegna: "01/01/2025", prossimoControllo: "01/01/2027", stato: "idoneo" }],
    ...over,
  };
}

test("buildFascicoloPdf: genera un PDF valido e non vuoto", async () => {
  const bytes = await buildFascicoloPdf([worker()]);
  assert.ok(bytes.length > 1000, "il PDF dovrebbe avere una dimensione sensata");
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  assert.equal(header, "%PDF-", "deve iniziare con l'header PDF");
});

test("buildFascicoloPdf: una pagina per lavoratore", async () => {
  const single = await buildFascicoloPdf([worker()]);
  const triple = await buildFascicoloPdf([worker(), worker({ cognome: "BIANCHI" }), worker({ cognome: "VERDI" })]);
  assert.ok(triple.length > single.length, "più lavoratori = PDF più grande");
});

test("buildFascicoloPdf: gestisce dati mancanti senza crashare", async () => {
  const bytes = await buildFascicoloPdf([worker({ visite: null, formazione: [], dpi: [], birthDate: null })]);
  assert.ok(bytes.length > 1000);
});
