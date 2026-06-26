import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export type FascicoloCourse = { corso: string; conclusione: string | null; scadenza: string | null; stato: string };
export type FascicoloDpi = { dpi: string; consegna: string | null; prossimoControllo: string | null; stato: string };
export type FascicoloWorker = {
  cognome: string;
  nome: string;
  matricola: string;
  taxCode: string;
  birthDate: string | null;
  birthPlace: string;
  jobTitle: string;
  site: string;
  subSite: string;
  responsibleCode: string;
  referral: string;
  phone: string;
  email: string;
  residence: string;
  status: string;
  formazione: FascicoloCourse[];
  visite: { stato: string; scadenza: string | null; provider: string; limitazioni: string; note: string } | null;
  dpi: FascicoloDpi[];
};

export type FascicoloCompany = { name: string; lines?: string[] };

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 40;
const CONTENT_W = A4.w - 2 * MARGIN;

const BRAND = rgb(0.24, 0.38, 0.65);
const INK = rgb(0.11, 0.14, 0.21);
const MUTED = rgb(0.46, 0.51, 0.59);
const LINE = rgb(0.86, 0.88, 0.91);
const PANEL = rgb(0.96, 0.97, 0.985);
const ZEBRA = rgb(0.975, 0.98, 0.99);

type Palette = { bg: RGB; fg: RGB };
function statoPalette(stato: string): Palette {
  const s = stato.toLowerCase();
  if (s === "scaduto" || s === "perso") return { bg: rgb(0.98, 0.91, 0.91), fg: rgb(0.72, 0.12, 0.12) };
  if (s === "in scadenza") return { bg: rgb(1, 0.95, 0.84), fg: rgb(0.68, 0.42, 0.04) };
  if (s === "idoneo") return { bg: rgb(0.89, 0.96, 0.91), fg: rgb(0.1, 0.5, 0.22) };
  if (s === "programmato" || s === "upgrade") return { bg: rgb(0.9, 0.93, 0.99), fg: BRAND };
  return { bg: rgb(0.94, 0.95, 0.96), fg: MUTED };
}

function clip(text: string, font: PDFFont, size: number, maxWidth: number) {
  let t = String(text ?? "");
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

type Fonts = { reg: PDFFont; bold: PDFFont };

function rightText(page: PDFPage, text: string, xRight: number, y: number, size: number, font: PDFFont, color: RGB) {
  page.drawText(text, { x: xRight - font.widthOfTextAtSize(text, size), y, size, font, color });
}

function pill(page: PDFPage, fonts: Fonts, x: number, y: number, text: string) {
  const size = 8;
  const pal = statoPalette(text);
  const label = text.toUpperCase();
  const w = fonts.bold.widthOfTextAtSize(label, size) + 12;
  page.drawRectangle({ x, y: y - 3, width: w, height: 14, color: pal.bg });
  page.drawText(label, { x: x + 6, y: y + 0.5, size, font: fonts.bold, color: pal.fg });
}

export async function buildFascicoloPdf(
  workers: FascicoloWorker[],
  opts: { logo?: Uint8Array; company?: FascicoloCompany } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const logo = opts.logo ? await doc.embedPng(opts.logo).catch(() => null) : null;
  const company = opts.company ?? { name: "Fascicolo lavoratore" };
  const generatedAt = new Date().toLocaleDateString("it-IT");

  for (const w of workers) {
    const page = doc.addPage([A4.w, A4.h]);
    let y = A4.h - MARGIN;

    // ---- Intestazione brandizzata ----
    let lw = 0;
    let lh = 0;
    if (logo) {
      const s = Math.min(46 / logo.height, 130 / logo.width);
      lw = logo.width * s;
      lh = logo.height * s;
      page.drawImage(logo, { x: MARGIN, y: y - lh, width: lw, height: lh });
    }
    const tx = MARGIN + (logo ? lw + 16 : 0);
    const txW = CONTENT_W - (logo ? lw + 16 : 0);
    page.drawText(clip(company.name, fonts.bold, 12, txW - 150), { x: tx, y: y - 11, size: 12, font: fonts.bold, color: INK });
    rightText(page, "FASCICOLO LAVORATORE", MARGIN + CONTENT_W, y - 11, 10, fonts.bold, BRAND);
    rightText(page, `Generato il ${generatedAt}`, MARGIN + CONTENT_W, y - 23, 8, fonts.reg, MUTED);
    let cy = y - 23;
    (company.lines ?? []).forEach((ln) => {
      page.drawText(clip(ln, fonts.reg, 7.5, txW), { x: tx, y: cy, size: 7.5, font: fonts.reg, color: MUTED });
      cy -= 10;
    });
    y = Math.min(cy + 2, y - lh) - 8;
    page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 3, color: BRAND });
    y -= 20;

    // ---- Nome + stato ----
    page.drawText(`${w.cognome} ${w.nome}`, { x: MARGIN, y, size: 16, font: fonts.bold, color: INK });
    pill(page, fonts, MARGIN + fonts.bold.widthOfTextAtSize(`${w.cognome} ${w.nome}`, 16) + 12, y + 2, w.status === "attivo" ? "ATTIVO" : w.status.toUpperCase());
    y -= 17;

    // ---- Identità essenziale ----
    const nascita = w.birthDate || w.birthPlace ? `Nato/a il ${w.birthDate ?? "-"}${w.birthPlace ? " a " + w.birthPlace : ""}` : "";
    const idLine = [nascita, w.taxCode ? `C.F. ${w.taxCode}` : ""].filter(Boolean).join("     ·     ");
    if (idLine) {
      page.drawText(clip(idLine, fonts.reg, 9, CONTENT_W), { x: MARGIN, y, size: 9, font: fonts.reg, color: MUTED });
      y -= 13;
    }
    if (w.residence) {
      page.drawText(clip(`Residenza: ${w.residence}`, fonts.reg, 9, CONTENT_W), { x: MARGIN, y, size: 9, font: fonts.reg, color: MUTED });
      y -= 13;
    }
    y -= 14;

    // ---- Formazione ----
    y = drawTable(page, fonts, y, "FORMAZIONE", ["Corso", "Conclusione", "Scadenza", "Stato"], [0.5, 0.17, 0.17, 0.16],
      w.formazione.map((c) => [c.corso, c.conclusione ?? "-", c.scadenza ?? "-", c.stato]), 3);

    // ---- Sorveglianza sanitaria ----
    y = sectionHeader(page, fonts, y, "SORVEGLIANZA SANITARIA");
    if (w.visite) {
      pill(page, fonts, MARGIN, y, w.visite.stato);
      page.drawText(clip(`Scadenza: ${w.visite.scadenza ?? "-"}`, fonts.reg, 9, CONTENT_W - 120), { x: MARGIN + 120, y, size: 9, font: fonts.reg, color: INK });
      y -= 14;
      if (w.visite.limitazioni) { page.drawText(clip("Limitazioni: " + w.visite.limitazioni, fonts.reg, 8, CONTENT_W), { x: MARGIN, y, size: 8, font: fonts.reg, color: MUTED }); y -= 12; }
    } else {
      page.drawText("Nessun dato di sorveglianza sanitaria.", { x: MARGIN, y, size: 9, font: fonts.reg, color: MUTED });
      y -= 14;
    }
    y -= 10;

    // ---- DPI ----
    drawTable(page, fonts, y, "DPI", ["DPI", "Consegna", "Prossimo controllo", "Stato"], [0.5, 0.17, 0.17, 0.16],
      w.dpi.map((d) => [d.dpi, d.consegna ?? "-", d.prossimoControllo ?? "-", d.stato]), 3);
  }

  // ---- Footer su tutte le pagine ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN - 8 }, end: { x: A4.w - MARGIN, y: MARGIN - 8 }, thickness: 0.5, color: LINE });
    p.drawText(clip(company.name, fonts.reg, 7, CONTENT_W - 80), { x: MARGIN, y: MARGIN - 18, size: 7, font: fonts.reg, color: MUTED });
    rightText(p, `Pag. ${i + 1} di ${pages.length}`, A4.w - MARGIN, MARGIN - 18, 7, fonts.reg, MUTED);
  });

  return doc.save();
}

function sectionHeader(page: PDFPage, fonts: Fonts, y: number, title: string) {
  page.drawRectangle({ x: MARGIN, y: y - 2, width: 3, height: 11, color: BRAND });
  page.drawText(title, { x: MARGIN + 9, y, size: 9.5, font: fonts.bold, color: BRAND });
  return y - 17;
}

function drawTable(
  page: PDFPage,
  fonts: Fonts,
  yStart: number,
  title: string,
  headers: string[],
  widths: number[],
  rows: string[][],
  statoColIndex: number,
) {
  let y = sectionHeader(page, fonts, yStart, title);
  const xs = widths.reduce<number[]>((acc, _w, i) => {
    acc.push(MARGIN + widths.slice(0, i).reduce((s, v) => s + v, 0) * CONTENT_W);
    return acc;
  }, []);

  // header riga
  page.drawRectangle({ x: MARGIN, y: y - 3, width: CONTENT_W, height: 15, color: PANEL });
  headers.forEach((h, i) => page.drawText(h.toUpperCase(), { x: xs[i] + 4, y: y + 1, size: 6.5, font: fonts.bold, color: MUTED }));
  y -= 16;

  if (rows.length === 0) {
    page.drawText("Nessun elemento.", { x: MARGIN + 4, y, size: 8.5, font: fonts.reg, color: MUTED });
    return y - 14;
  }

  const maxRows = Math.max(0, Math.floor((y - (MARGIN + 24)) / 16));
  const shown = rows.slice(0, maxRows);
  shown.forEach((row, ri) => {
    if (ri % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - 3, width: CONTENT_W, height: 16, color: ZEBRA });
    row.forEach((cell, i) => {
      if (i === statoColIndex) {
        pill(page, fonts, xs[i] + 4, y, cell);
      } else {
        page.drawText(clip(cell, fonts.reg, 8.5, widths[i] * CONTENT_W - 10), { x: xs[i] + 4, y, size: 8.5, font: fonts.reg, color: INK });
      }
    });
    y -= 16;
  });
  if (rows.length > shown.length) {
    page.drawText(`… e altri ${rows.length - shown.length} elementi`, { x: MARGIN + 4, y, size: 7.5, font: fonts.reg, color: MUTED });
    y -= 14;
  }
  return y - 8;
}
