import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ImportMode = "preview" | "commit";

type PdfImportPreviewRow = {
  page: number;
  taxCode: string;
  lastName: string;
  firstName: string;
  nextDueDate: string | null;
  limitations: string;
};

type PdfImportErrorRow = {
  page: number;
  taxCode: string;
  errorType: string;
  errorMessage: string;
};

type PdfImportSummary = {
  totalPages: number;
  parsedPages: number;
  matchedEmployees: number;
  missingEmployees: number;
  updatedRecords: number;
  dueDateFound: number;
  limitationsFound: number;
  errors: number;
};

type PdfImportResponse = {
  mode: ImportMode;
  summary: PdfImportSummary;
  previewRows: PdfImportPreviewRow[];
  errors: PdfImportErrorRow[];
  message: string;
};

type EmployeeLookupRow = { id: number; tax_code: string; first_name: string; last_name: string };

function cleanSpaces(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTaxCode(value: string) {
  return cleanSpaces(value).toUpperCase().replace(/\s+/g, "");
}

function parseItDateToIso(value: string) {
  const raw = cleanSpaces(value);
  const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return null;
  const dd = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  let yyyy = Number(m[3]);
  if (yyyy < 100) yyyy = 2000 + yyyy;
  if (yyyy < 1900 || yyyy > 2200) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function extractTaxCode(text: string) {
  const normalized = text.toUpperCase().replace(/\s+/g, " ");
  const match = normalized.match(/\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/);
  return match ? normalizeTaxCode(match[0]) : "";
}

function extractNextDueDateIso(text: string) {
  const lines = text.split(/\r?\n/).map((l) => cleanSpaces(l)).filter(Boolean);
  const joined = lines.join(" ");
  const candidates: string[] = [];

  const within = joined.match(/(?:prossim\w*\s+visita|scaden\w*\s+visita|entro\s+il)\s*(?:il\s*)?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i);
  if (within?.[1]) candidates.push(within[1]);

  const all = joined.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g) ?? [];
  all.forEach((d) => candidates.push(d));

  const unique = Array.from(new Set(candidates));
  const parsed = unique.map((d) => ({ raw: d, iso: parseItDateToIso(d) })).filter((x) => Boolean(x.iso));
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
  return parsed[parsed.length - 1]?.iso ?? null;
}

function extractLimitationsText(text: string) {
  const lines = text.split(/\r?\n/).map((l) => cleanSpaces(l)).filter(Boolean);
  const lower = lines.map((l) => l.toLowerCase());
  const hasWithLimitations = lower.some((l) => l.includes("idoneo con limitazioni") || l.includes("idoneo con limitazione"));
  if (!hasWithLimitations) return { text: "", found: false };

  let start = -1;
  for (let i = 0; i < lower.length; i += 1) {
    if (lower[i]?.includes("con le seguenti limitazioni")) {
      start = i + 1;
      break;
    }
  }

  if (start < 0) {
    for (let i = 0; i < lower.length; i += 1) {
      if (lower[i]?.includes("limitazione")) {
        start = i + 1;
        break;
      }
    }
  }

  const stopWords = ["avverso", "medico competente", "trasmissione", "datore di lavoro", "art.", "art "];
  const items: string[] = [];
  if (start >= 0) {
    for (let i = start; i < lines.length; i += 1) {
      const l = lines[i] ?? "";
      const low = lower[i] ?? "";
      if (!l) continue;
      if (stopWords.some((w) => low.includes(w))) break;
      if (low.includes("limitazione") && low.includes("data scadenza")) continue;
      if (l.length <= 2) continue;
      items.push(l);
    }
  }

  const cleaned = items
    .map((l) => l.replace(/^\-+\s*/, "").trim())
    .filter(Boolean);

  const body = cleaned.length ? cleaned.map((l) => `- ${l}`).join("\n") : "";
  const out = body ? `IDONEO CON LIMITAZIONI\n${body}` : "IDONEO CON LIMITAZIONI";
  return { text: out, found: true };
}

async function extractPdfPagesText(fileBuffer: ArrayBuffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fileBuffer);
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true } as never);
  const pdf = await loadingTask.promise;
  const out: Array<{ page: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const parts = (content.items as Array<{ str?: string }>).map((i) => String(i.str ?? "")).filter(Boolean);
    const text = cleanSpaces(parts.join(" ")) ? parts.join("\n") : "";
    out.push({ page: pageNumber, text });
  }
  return out;
}

async function buildEmployeeLookupByTaxCode(supabase: SupabaseClient, taxCodes: string[]) {
  const normalized = Array.from(new Set(taxCodes.map((c) => normalizeTaxCode(c)).filter(Boolean)));
  const byTax = new Map<string, EmployeeLookupRow>();
  const chunkSize = 500;
  for (let i = 0; i < normalized.length; i += chunkSize) {
    const part = normalized.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("employees")
      .select("id,tax_code,first_name,last_name")
      .in("tax_code", part);
    if (error) throw new Error(error.message);
    ((data ?? []) as EmployeeLookupRow[]).forEach((row) => {
      byTax.set(normalizeTaxCode(row.tax_code ?? ""), row);
    });
  }
  return byTax;
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "").trim() as ImportMode;
    const file = formData.get("file");

    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json({ error: "Modalità import non valida." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante." }, { status: 400 });
    }
    if (!String(file.name ?? "").toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Formato non valido (atteso PDF)." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const pages = await extractPdfPagesText(buffer);

    const errors: PdfImportErrorRow[] = [];
    const parsed = pages.map(({ page, text }) => {
      const taxCode = extractTaxCode(text);
      const nextDueDate = extractNextDueDateIso(text);
      const lim = extractLimitationsText(text);
      return {
        page,
        taxCode,
        nextDueDate,
        limitations: lim.text,
        limitationsFound: lim.found,
      };
    });

    const taxCodes = parsed.map((p) => p.taxCode).filter(Boolean);
    const lookup = await buildEmployeeLookupByTaxCode(auth.supabase, taxCodes);

    let matchedEmployees = 0;
    let missingEmployees = 0;
    let dueDateFound = 0;
    let limitationsFound = 0;
    let updatedRecords = 0;

    const previewRows: PdfImportPreviewRow[] = [];
    const rowsToUpsert: Array<{ employee_id: number; next_due_date?: string | null; limitations?: string | null; created_by: string | null }> = [];

    parsed.forEach((row) => {
      if (!row.taxCode) {
        errors.push({ page: row.page, taxCode: "", errorType: "missing_tax_code", errorMessage: "Codice fiscale non trovato nella pagina." });
        return;
      }

      const employee = lookup.get(row.taxCode);
      if (!employee) {
        missingEmployees += 1;
        errors.push({
          page: row.page,
          taxCode: row.taxCode,
          errorType: "employee_not_found",
          errorMessage: "Dipendente non trovato in anagrafica (match su CF).",
        });
        return;
      }

      matchedEmployees += 1;
      if (row.nextDueDate) dueDateFound += 1;
      if (row.limitationsFound) limitationsFound += 1;

      previewRows.push({
        page: row.page,
        taxCode: row.taxCode,
        lastName: employee.last_name ?? "",
        firstName: employee.first_name ?? "",
        nextDueDate: row.nextDueDate,
        limitations: row.limitations,
      });

      const upsert: { employee_id: number; created_by: string | null; next_due_date?: string | null; limitations?: string | null } = {
        employee_id: employee.id,
        created_by: auth.userId ?? null,
      };
      if (row.nextDueDate) upsert.next_due_date = row.nextDueDate;
      if (row.limitationsFound) upsert.limitations = row.limitations;
      if (Object.keys(upsert).length > 2) rowsToUpsert.push(upsert);
    });

    if (mode === "commit" && rowsToUpsert.length > 0) {
      const { error } = await auth.supabase
        .from("medical_surveillance_records")
        .upsert(rowsToUpsert, { onConflict: "employee_id" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      updatedRecords = rowsToUpsert.length;
    }

    const summary: PdfImportSummary = {
      totalPages: pages.length,
      parsedPages: parsed.length,
      matchedEmployees,
      missingEmployees,
      updatedRecords,
      dueDateFound,
      limitationsFound,
      errors: errors.length,
    };

    const message =
      mode === "commit"
        ? `Import PDF completato: aggiornati ${updatedRecords} lavoratori.`
        : `Anteprima PDF completata: ${matchedEmployees} pagine associate.`;

    if (mode === "commit") {
      await auth.supabase.from("import_runs").insert({
        source: "sorveglianza_pdf",
        file_name: file.name,
        imported_by: auth.userId,
        total_rows: summary.totalPages,
        processed_rows: summary.matchedEmployees,
        error_rows: summary.errors,
        status: "completed",
      });
    }

    const response: PdfImportResponse = {
      mode,
      summary,
      previewRows: previewRows.slice(0, 60),
      errors: errors.slice(0, 200),
      message,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore import PDF." },
      { status: 500 },
    );
  }
}
