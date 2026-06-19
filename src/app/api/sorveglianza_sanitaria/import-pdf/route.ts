import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { parseStrictItDateToIso } from "@/lib/it-date";
import { cacheDeleteByPrefix } from "@/lib/server-cache";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ImportMode = "preview" | "commit";

class PdfImportHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type PdfImportPreviewRow = {
  page: number;
  employeeId: number | null;
  taxCode: string;
  lastName: string;
  firstName: string;
  nextDueDate: string | null;
  limitations: string;
  dueDateCandidates: string[];
  status: "ok" | "dubbio" | "errore";
  issues: string[];
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
type ExistingMedicalSurveillanceRecord = {
  employee_id: number;
  provider: string | null;
  is_planned: boolean;
  requires_visit: boolean;
  next_due_date: string | null;
  limitations: string | null;
  notes: string | null;
};

function cleanSpaces(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTaxCode(value: string) {
  return cleanSpaces(value).toUpperCase().replace(/\s+/g, "");
}

function isLikelyTaxCode(value: string) {
  const raw = normalizeTaxCode(value);
  return Boolean(raw.match(/^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/));
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
  return parseStrictItDateToIso(`${dd}/${mm}/${yyyy}`);
}

function extractTaxCode(text: string) {
  const normalized = text.toUpperCase().replace(/\s+/g, " ");
  const match = normalized.match(/\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/);
  return match ? normalizeTaxCode(match[0]) : "";
}

function extractNextDueDate(text: string) {
  const lines = text.split(/\r?\n/).map((l) => cleanSpaces(l)).filter(Boolean);
  const joined = lines.join(" ");
  const primaryMatch = joined.match(
    /(?:prossim\w*\s+visita|scaden\w*\s+visita|entro\s+il)\s*(?:il\s*)?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i,
  );
  if (primaryMatch?.[1]) {
    const iso = parseItDateToIso(primaryMatch[1]);
    if (iso) return { iso, candidates: [primaryMatch[1]], chosenRaw: primaryMatch[1] };
  }

  const includeWords = ["visita", "prossim", "scaden", "entro il", "idone"];
  const excludeWords = ["nasc", "nato", "nata", "nato il", "nata il", "data nasc", "emission", "rilasc", "stamp", "protocol", "referto"];

  const dateRegex = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g;
  const allMatches: Array<{ raw: string; index: number }> = [];
  for (let m = dateRegex.exec(joined); m; m = dateRegex.exec(joined)) {
    allMatches.push({ raw: m[0], index: m.index });
  }

  const uniqueAll = Array.from(new Set(allMatches.map((m) => m.raw)));
  const byRawFirstIndex = new Map<string, number>();
  allMatches.forEach((m) => {
    if (!byRawFirstIndex.has(m.raw)) byRawFirstIndex.set(m.raw, m.index);
  });

  const scored = uniqueAll
    .map((raw) => {
      const iso = parseItDateToIso(raw);
      if (!iso) return null;
      const year = Number(String(iso).slice(0, 4));
      const idx = byRawFirstIndex.get(raw) ?? -1;
      const start = Math.max(0, idx - 40);
      const end = Math.min(joined.length, idx + raw.length + 40);
      const ctx = joined.slice(start, end).toLowerCase();

      let score = 0;
      if (excludeWords.some((w) => ctx.includes(w))) score -= 200;
      if (includeWords.some((w) => ctx.includes(w))) score += 40;
      if (ctx.includes("visita") && (ctx.includes("scaden") || ctx.includes("prossim") || ctx.includes("entro"))) score += 80;
      if (year < 2000) score -= 120;
      if (year < 1900 || year > 2200) score -= 500;

      return { raw, iso, score };
    })
    .filter(Boolean) as Array<{ raw: string; iso: string; score: number }>;

  const filteredCandidates = scored.filter((s) => s.score > -100).map((s) => s.raw);
  const candidates = filteredCandidates.length > 0 ? filteredCandidates : uniqueAll;

  const scoredCandidates = scored.filter((s) => candidates.includes(s.raw));
  if (scoredCandidates.length === 0) return { iso: null, candidates, chosenRaw: null };

  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.iso).localeCompare(String(a.iso));
  });
  const chosen = scoredCandidates[0];
  return { iso: (chosen?.iso ?? null) as string | null, candidates, chosenRaw: chosen?.raw ?? null };
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
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fileBuffer);
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true } as never);
  const pdf = await loadingTask.promise;
  const MAX_PDF_PAGES = 700;
  const MAX_PAGE_PARSE_MS = 12_000;
  const totalPages = Number(pdf.numPages ?? 0);
  if (!Number.isFinite(totalPages) || totalPages <= 0) {
    throw new PdfImportHttpError(422, "PDF non valido o non leggibile (pagine non rilevate).");
  }
  if (totalPages > MAX_PDF_PAGES) {
    throw new PdfImportHttpError(
      413,
      `PDF troppo grande: ${totalPages} pagine (max ${MAX_PDF_PAGES}). Dividi il file e riprova.`,
    );
  }
  const out: Array<{ page: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new PdfImportHttpError(422, `Parsing PDF troppo lento (pagina ${pageNumber}).`)),
        MAX_PAGE_PARSE_MS,
      );
    });
    const page = await Promise.race([pdf.getPage(pageNumber), timeout]);
    const content = await Promise.race([
      (page as { getTextContent: () => Promise<{ items: unknown[] }> }).getTextContent(),
      timeout,
    ]);
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

export function collapseUpsertsByEmployeeId(
  rows: Array<{ page: number; employee_id: number; created_by: string | null; next_due_date?: string | null; limitations?: string | null }>,
) {
  const map = new Map<
    number,
    { page: number; upsert: { employee_id: number; created_by: string | null; next_due_date?: string | null; limitations?: string | null } }
  >();

  rows.forEach((r) => {
    const existing = map.get(r.employee_id);
    const candidateUpsert = {
      employee_id: r.employee_id,
      created_by: r.created_by,
      next_due_date: r.next_due_date,
      limitations: r.limitations,
    };
    if (!existing) {
      map.set(r.employee_id, { page: r.page, upsert: candidateUpsert });
      return;
    }

    const candDue = candidateUpsert.next_due_date ?? null;
    const prevDue = existing.upsert.next_due_date ?? null;
    const takeCandidate =
      candDue && prevDue
        ? candDue > prevDue || (candDue === prevDue && r.page >= existing.page)
        : candDue
          ? true
          : prevDue
            ? false
            : r.page >= existing.page;

    if (takeCandidate) {
      map.set(r.employee_id, { page: r.page, upsert: candidateUpsert });
    }
  });

  return Array.from(map.values());
}

export async function makePdfImportUpsertsSafe(args: {
  supabase: SupabaseClient;
  rows: Array<{
    page: number;
    upsert: { employee_id: number; created_by: string | null; next_due_date?: string | null; limitations?: string | null };
  }>;
}) {
  const { rows, supabase } = args;

  let skippedOlderDueDates = 0;
  const safeRows: typeof rows = [];

  const employeeIds = Array.from(new Set(rows.map((r) => r.upsert.employee_id)));
  const existingByEmployeeId = new Map<number, ExistingMedicalSurveillanceRecord>();

  const chunkSize = 500;
  for (let i = 0; i < employeeIds.length; i += chunkSize) {
    const part = employeeIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("medical_surveillance_records")
      .select("employee_id,provider,is_planned,requires_visit,next_due_date,limitations,notes")
      .in("employee_id", part);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((row) => {
      existingByEmployeeId.set(
        (row as ExistingMedicalSurveillanceRecord).employee_id,
        row as ExistingMedicalSurveillanceRecord,
      );
    });
  }

  rows.forEach((row) => {
    const out = { ...row.upsert };

    const candLim = String(out.limitations ?? "").trim();
    if (!candLim) delete out.limitations;

    const existing = existingByEmployeeId.get(out.employee_id) ?? null;
    const candDue = out.next_due_date ?? null;
    const prevDue = existing?.next_due_date ?? null;
    if (candDue && prevDue && candDue > prevDue) {
      delete out.next_due_date;
      skippedOlderDueDates += 1;
    }

    if (!out.next_due_date && !out.limitations) return;
    safeRows.push({ page: row.page, upsert: out });
  });

  return { rows: safeRows, skippedOlderDueDates, existingByEmployeeId };
}

export async function insertImportRunErrors(args: {
  supabase: SupabaseClient;
  importRunId: string;
  errors: PdfImportErrorRow[];
}) {
  const { supabase, importRunId, errors } = args;
  if (!importRunId) return;
  if (errors.length === 0) return;

  const chunkSize = 500;
  for (let i = 0; i < errors.length; i += chunkSize) {
    const part = errors.slice(i, i + chunkSize);
    const { error } = await supabase.from("import_run_errors").insert(
      part.map((e) => ({
        import_run_id: importRunId,
        row_number: Number.isFinite(e.page) ? e.page : 0,
        matricola: null,
        tax_code: String(e.taxCode ?? "").trim() ? String(e.taxCode).trim() : null,
        last_name: null,
        first_name: null,
        error_type: String(e.errorType ?? "").trim() || "error",
        error_message: String(e.errorMessage ?? "").trim() || "Errore import PDF.",
      })),
    );
    if (error) throw new Error(error.message);
  }
}

export async function insertImportRunChanges(args: {
  supabase: SupabaseClient;
  importRunId: string;
  rows: Array<{
    employee_id: number;
    created_by: string | null;
    next_due_date?: string | null;
    limitations?: string | null;
  }>;
  existingByEmployeeId: Map<number, ExistingMedicalSurveillanceRecord>;
}) {
  const { supabase, importRunId, rows, existingByEmployeeId } = args;
  if (!importRunId) return;
  if (rows.length === 0) return;

  const changes = rows.map((row) => {
    const before = existingByEmployeeId.get(row.employee_id) ?? null;
    const afterNextDueDate =
      row.next_due_date === undefined ? before?.next_due_date ?? null : (row.next_due_date ?? null);
    const afterLimitations =
      row.limitations === undefined ? before?.limitations ?? null : (row.limitations ?? null);

    return {
      import_run_id: importRunId,
      table_name: "medical_surveillance_records",
      action: before ? "update" : "insert",
      row_key: { employee_id: row.employee_id },
      before_row: before
        ? {
            employee_id: before.employee_id,
            provider: before.provider,
            is_planned: before.is_planned,
            requires_visit: before.requires_visit,
            next_due_date: before.next_due_date,
            limitations: before.limitations,
            notes: before.notes,
          }
        : null,
      after_row: {
        employee_id: row.employee_id,
        provider: before?.provider ?? null,
        is_planned: before?.is_planned ?? false,
        requires_visit: before?.requires_visit ?? true,
        next_due_date: afterNextDueDate,
        limitations: afterLimitations,
        notes: before?.notes ?? null,
      },
    };
  });

  const chunkSize = 500;
  for (let i = 0; i < changes.length; i += chunkSize) {
    const part = changes.slice(i, i + chunkSize);
    const { error } = await supabase.from("import_run_changes").insert(part);
    if (error) throw new Error(error.message);
  }
}

async function createPdfImportRun(args: {
  supabase: SupabaseClient;
  importedBy: string | null;
  fileName: string;
}) {
  const { supabase, importedBy, fileName } = args;
  const inserted = await supabase
    .from("import_runs")
    .insert({
      source: "sorveglianza_pdf",
      file_name: fileName || "import_pdf",
      imported_by: importedBy,
      total_rows: 0,
      processed_rows: 0,
      error_rows: 0,
      status: "processing",
    })
    .select("id")
    .single();

  if (inserted.error) {
    throw new Error(`Impossibile creare la traccia import PDF per il rollback: ${inserted.error.message}`);
  }
  if (!inserted.data?.id) {
    throw new Error("Impossibile creare la traccia import PDF per il rollback: id mancante.");
  }
  return inserted.data.id;
}

async function updatePdfImportRun(args: {
  supabase: SupabaseClient;
  importRunId: string;
  summary: PdfImportSummary;
  status: "completed" | "failed";
}) {
  const { supabase, importRunId, summary, status } = args;
  const { error } = await supabase
    .from("import_runs")
    .update({
      total_rows: summary.totalPages,
      processed_rows: summary.matchedEmployees,
      error_rows: summary.errors,
      status,
    })
    .eq("id", importRunId);
  if (error) throw new Error(error.message);
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let importRunId: string | null = null;
  try {
    const MAX_PDF_UPLOAD_BYTES = 6_000_000;
    const MAX_PDF_PAGES = 700;

    const contentType = request.headers.get("content-type") ?? "";
    let mode: ImportMode = "preview";
    let file: unknown = null;
    let pagesRaw: unknown = null;
    let parsedRaw: unknown = null;
    let updatesRaw: unknown = null;
    let fileName = "";

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { mode?: unknown; parsed?: unknown; fileName?: unknown };
      mode = String(body?.mode ?? "").trim() as ImportMode;
      parsedRaw = body?.parsed ?? null;
      fileName = String(body?.fileName ?? "").trim();
    } else {
      const formData = await request.formData();
      mode = String(formData.get("mode") ?? "").trim() as ImportMode;
      file = formData.get("file");
      pagesRaw = formData.get("pages");
      parsedRaw = formData.get("parsed");
      updatesRaw = formData.get("updates");
      fileName = String(formData.get("fileName") ?? "").trim();
    }

    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json({ error: "Modalità import non valida." }, { status: 400 });
    }

    const errors: PdfImportErrorRow[] = [];
    if (mode === "commit" && typeof updatesRaw === "string" && updatesRaw.trim()) {
      const updates = JSON.parse(updatesRaw) as Array<{
        page: number;
        taxCode: string;
        nextDueDate?: string | null;
        limitations?: string | null;
        applyDueDate?: boolean;
        applyLimitations?: boolean;
      }>;

      const normalizedUpdates = (Array.isArray(updates) ? updates : [])
        .map((u) => ({
          page: Number(u?.page),
          taxCode: normalizeTaxCode(String(u?.taxCode ?? "")),
          nextDueDate: typeof u?.nextDueDate === "string" ? u.nextDueDate.trim() : u?.nextDueDate ?? null,
          limitations: typeof u?.limitations === "string" ? u.limitations : u?.limitations ?? null,
          applyDueDate: Boolean(u?.applyDueDate),
          applyLimitations: Boolean(u?.applyLimitations),
        }))
        .filter((u) => Number.isFinite(u.page) && u.page > 0 && u.taxCode);

      const runId = await createPdfImportRun({
        supabase: auth.supabase,
        importedBy: auth.userId ?? null,
        fileName: fileName || "import_pdf",
      });
      importRunId = runId;

      const taxCodes = Array.from(new Set(normalizedUpdates.map((u) => u.taxCode).filter(Boolean)));
      const lookup = await buildEmployeeLookupByTaxCode(auth.supabase, taxCodes);

      let matchedEmployees = 0;
      let missingEmployees = 0;
      let dueDateFound = 0;
      let limitationsFound = 0;
      let updatedRecords = 0;

      const rowsToUpsertWithMeta: Array<{ page: number; employee_id: number; next_due_date?: string | null; limitations?: string | null; created_by: string | null }> = [];

      normalizedUpdates.forEach((u) => {
        if (!isLikelyTaxCode(u.taxCode)) {
          errors.push({ page: u.page, taxCode: u.taxCode, errorType: "invalid_tax_code", errorMessage: "Codice fiscale non valido." });
          return;
        }

        const employee = lookup.get(u.taxCode);
        if (!employee) {
          missingEmployees += 1;
          errors.push({
            page: u.page,
            taxCode: u.taxCode,
            errorType: "employee_not_found",
            errorMessage: "Dipendente non trovato in anagrafica (match su CF).",
          });
          return;
        }

        const upsert: { employee_id: number; created_by: string | null; next_due_date?: string | null; limitations?: string | null } = {
          employee_id: employee.id,
          created_by: auth.userId ?? null,
        };

        if (u.applyDueDate) {
          const iso = u.nextDueDate ? parseItDateToIso(u.nextDueDate) : null;
          if (!iso) {
            errors.push({
              page: u.page,
              taxCode: u.taxCode,
              errorType: "invalid_due_date",
              errorMessage: "Scadenza non valida (atteso gg/mm/aaaa).",
            });
            return;
          }
          upsert.next_due_date = iso;
          dueDateFound += 1;
        }

        if (u.applyLimitations) {
          const txt = typeof u.limitations === "string" ? cleanSpaces(u.limitations) : "";
          upsert.limitations = txt ? txt : null;
          limitationsFound += 1;
        }

        if (Object.keys(upsert).length > 2) {
          rowsToUpsertWithMeta.push({ page: u.page, ...upsert });
        }
      });

      const collapsed = collapseUpsertsByEmployeeId(rowsToUpsertWithMeta);
      const safe = await makePdfImportUpsertsSafe({ supabase: auth.supabase, rows: collapsed });
      const rowsToUpsert = safe.rows.map((r) => r.upsert);
      matchedEmployees = rowsToUpsert.length;
      dueDateFound = rowsToUpsert.filter((r) => Boolean(r.next_due_date)).length;
      limitationsFound = rowsToUpsert.filter((r) => Boolean(String(r.limitations ?? "").trim())).length;

      if (rowsToUpsert.length > 0) {
        await insertImportRunChanges({
          supabase: auth.supabase,
          importRunId: runId,
          rows: rowsToUpsert,
          existingByEmployeeId: safe.existingByEmployeeId,
        });
        const { error } = await auth.supabase
          .from("medical_surveillance_records")
          .upsert(rowsToUpsert, { onConflict: "employee_id" });
        if (error) {
          throw new Error(error.message);
        }
        updatedRecords = rowsToUpsert.length;
      }

      if (safe.skippedOlderDueDates > 0) {
        errors.push({
          page: 0,
          taxCode: "",
          errorType: "skipped_older_due_date",
          errorMessage: `Saltate ${safe.skippedOlderDueDates} scadenze più alte rispetto a quelle già presenti.`,
        });
      }

      const summary: PdfImportSummary = {
        totalPages: normalizedUpdates.length,
        parsedPages: normalizedUpdates.length,
        matchedEmployees,
        missingEmployees,
        updatedRecords,
        dueDateFound,
        limitationsFound,
        errors: errors.length,
      };
      await insertImportRunErrors({ supabase: auth.supabase, importRunId: runId, errors });
      await updatePdfImportRun({
        supabase: auth.supabase,
        importRunId: runId,
        summary,
        status: "completed",
      });
      cacheDeleteByPrefix("surveillance_rows_v1:");

      const response: PdfImportResponse = {
        mode,
        summary,
        previewRows: [],
        errors: errors.slice(0, 200),
        message:
          safe.skippedOlderDueDates > 0
            ? `Import PDF completato: aggiornati ${updatedRecords} lavoratori. Saltate ${safe.skippedOlderDueDates} scadenze più alte.`
            : `Import PDF completato: aggiornati ${updatedRecords} lavoratori.`,
      };
      return NextResponse.json(response);
    }

    type ParsedPage = {
      page: number;
      taxCode: string;
      nextDueDate: string | null;
      dueDateCandidates: string[];
      limitations: string;
      limitationsFound: boolean;
    };

    let parsed: ParsedPage[] = [];

    if (parsedRaw) {
      const input =
        typeof parsedRaw === "string"
          ? (JSON.parse(parsedRaw) as Array<Partial<ParsedPage>>)
          : (parsedRaw as Array<Partial<ParsedPage>>);
      parsed = (Array.isArray(input) ? input : [])
        .map((p) => ({
          page: Number(p?.page),
          taxCode: normalizeTaxCode(String(p?.taxCode ?? "")),
          nextDueDate: typeof p?.nextDueDate === "string" ? p.nextDueDate : p?.nextDueDate ?? null,
          dueDateCandidates: Array.isArray(p?.dueDateCandidates) ? (p?.dueDateCandidates as unknown[]).map((x) => String(x)) : [],
          limitations: typeof p?.limitations === "string" ? p.limitations : "",
          limitationsFound: Boolean(p?.limitationsFound),
        }))
        .filter((p) => Number.isFinite(p.page) && p.page > 0);
      if (parsed.length === 0) {
        return NextResponse.json({ error: "Nessuna pagina valida da importare." }, { status: 400 });
      }
      if (parsed.length > MAX_PDF_PAGES) {
        return NextResponse.json(
          { error: `PDF troppo grande: ${parsed.length} pagine (max ${MAX_PDF_PAGES}). Dividi il file e riprova.` },
          { status: 413 },
        );
      }
    } else {
      let pages: Array<{ page: number; text: string }> = [];
      if (typeof pagesRaw === "string" && pagesRaw.trim()) {
        const input = JSON.parse(pagesRaw) as Array<{ page?: unknown; text?: unknown }>;
        pages = (Array.isArray(input) ? input : [])
          .map((p) => ({ page: Number(p?.page), text: typeof p?.text === "string" ? p.text : "" }))
          .filter((p) => Number.isFinite(p.page) && p.page > 0);
        if (pages.length === 0) {
          return NextResponse.json({ error: "Nessuna pagina valida da importare." }, { status: 400 });
        }
        if (pages.length > MAX_PDF_PAGES) {
          return NextResponse.json(
            { error: `PDF troppo grande: ${pages.length} pagine (max ${MAX_PDF_PAGES}). Dividi il file e riprova.` },
            { status: 413 },
          );
        }
      } else {
        if (!(file instanceof File)) {
          return NextResponse.json({ error: "File mancante." }, { status: 400 });
        }
        if (!String(file.name ?? "").toLowerCase().endsWith(".pdf")) {
          return NextResponse.json({ error: "Formato non valido (atteso PDF)." }, { status: 400 });
        }
        if (file.size > MAX_PDF_UPLOAD_BYTES) {
          return NextResponse.json({ error: "PDF troppo grande (max ~6MB)." }, { status: 413 });
        }

        const buffer = await file.arrayBuffer();
        pages = await extractPdfPagesText(buffer);
      }

      parsed = pages.map(({ page, text }) => {
        const taxCode = extractTaxCode(text);
        const due = extractNextDueDate(text);
        const lim = extractLimitationsText(text);
        return {
          page,
          taxCode,
          nextDueDate: due.iso,
          dueDateCandidates: due.candidates,
          limitations: lim.text,
          limitationsFound: lim.found,
        };
      });
    }

    const runId =
      mode === "commit"
        ? await createPdfImportRun({
            supabase: auth.supabase,
            importedBy: auth.userId ?? null,
            fileName: file instanceof File ? file.name : fileName || "import_pdf",
          })
        : null;
    importRunId = runId;

    const taxCodes = parsed.map((p) => p.taxCode).filter(Boolean);
    const lookup = await buildEmployeeLookupByTaxCode(auth.supabase, taxCodes);

    let matchedEmployees = 0;
    let missingEmployees = 0;
    let dueDateFound = 0;
    let limitationsFound = 0;
    let updatedRecords = 0;

    const previewRows: PdfImportPreviewRow[] = [];
    const rowsToUpsertWithMeta: Array<{ page: number; employee_id: number; next_due_date?: string | null; limitations?: string | null; created_by: string | null }> = [];

    parsed.forEach((row) => {
      const issues: string[] = [];
      let status: "ok" | "dubbio" | "errore" = "ok";

      if (!row.taxCode) {
        status = "errore";
        issues.push("missing_tax_code");
      } else if (!isLikelyTaxCode(row.taxCode)) {
        status = "errore";
        issues.push("invalid_tax_code");
      }

      const employee = row.taxCode ? lookup.get(row.taxCode) ?? null : null;
      if (row.taxCode && !employee) {
        status = "errore";
        issues.push("employee_not_found");
        missingEmployees += 1;
      }

      if (row.dueDateCandidates.length > 1) {
        if (status === "ok") status = "dubbio";
        issues.push("multiple_date_candidates");
      }
      if (employee && !row.nextDueDate) {
        if (status === "ok") status = "dubbio";
        issues.push("missing_due_date");
      }
      if (employee && !row.limitationsFound) {
        issues.push("limitations_not_found");
      }

      if (!row.taxCode) {
        errors.push({ page: row.page, taxCode: "", errorType: "missing_tax_code", errorMessage: "Codice fiscale non trovato nella pagina." });
      } else if (!isLikelyTaxCode(row.taxCode)) {
        errors.push({ page: row.page, taxCode: row.taxCode, errorType: "invalid_tax_code", errorMessage: "Codice fiscale non valido." });
      } else if (!employee) {
        errors.push({
          page: row.page,
          taxCode: row.taxCode,
          errorType: "employee_not_found",
          errorMessage: "Dipendente non trovato in anagrafica (match su CF).",
        });
      }

      if (employee) {
        matchedEmployees += 1;
        if (row.nextDueDate) dueDateFound += 1;
        if (row.limitationsFound) limitationsFound += 1;
      }

      previewRows.push({
        page: row.page,
        employeeId: employee?.id ?? null,
        taxCode: row.taxCode,
        lastName: employee?.last_name ?? "",
        firstName: employee?.first_name ?? "",
        nextDueDate: row.nextDueDate,
        limitations: row.limitations,
        dueDateCandidates: row.dueDateCandidates,
        status,
        issues,
      });

      if (mode === "commit" && employee) {
        const upsert: { employee_id: number; created_by: string | null; next_due_date?: string | null; limitations?: string | null } = {
          employee_id: employee.id,
          created_by: auth.userId ?? null,
        };
        if (row.nextDueDate) upsert.next_due_date = row.nextDueDate;
        if (row.limitationsFound) upsert.limitations = row.limitations;
        if (Object.keys(upsert).length > 2) rowsToUpsertWithMeta.push({ page: row.page, ...upsert });
      }
    });

    const collapsed = collapseUpsertsByEmployeeId(rowsToUpsertWithMeta);
    const safe = await makePdfImportUpsertsSafe({ supabase: auth.supabase, rows: collapsed });
    const rowsToUpsert = safe.rows.map((r) => r.upsert);

    if (mode === "commit") {
      if (!runId) throw new Error("Impossibile creare la traccia import PDF per il rollback.");
    }

    if (mode === "commit" && rowsToUpsert.length > 0) {
      await insertImportRunChanges({
        supabase: auth.supabase,
        importRunId: runId,
        rows: rowsToUpsert,
        existingByEmployeeId: safe.existingByEmployeeId,
      });
      const { error } = await auth.supabase
        .from("medical_surveillance_records")
        .upsert(rowsToUpsert, { onConflict: "employee_id" });
      if (error) {
        throw new Error(error.message);
      }
      updatedRecords = rowsToUpsert.length;
    }

    const errorsForRun = [...errors];
    if (mode === "commit" && safe.skippedOlderDueDates > 0) {
      errorsForRun.push({
        page: 0,
        taxCode: "",
        errorType: "skipped_older_due_date",
        errorMessage: `Saltate ${safe.skippedOlderDueDates} scadenze più alte rispetto a quelle già presenti.`,
      });
    }

    const summary: PdfImportSummary = {
      totalPages: parsed.length,
      parsedPages: parsed.length,
      matchedEmployees,
      missingEmployees,
      updatedRecords,
      dueDateFound,
      limitationsFound,
      errors: errorsForRun.length,
    };

    const message =
      mode === "commit"
        ? safe.skippedOlderDueDates > 0
          ? `Import PDF completato: aggiornati ${updatedRecords} lavoratori. Saltate ${safe.skippedOlderDueDates} scadenze più alte.`
          : `Import PDF completato: aggiornati ${updatedRecords} lavoratori.`
        : `Anteprima PDF completata: ${matchedEmployees} pagine associate.`;

    if (mode === "commit") {
      if (!runId) throw new Error("Impossibile creare la traccia import PDF per il rollback.");
      await insertImportRunErrors({ supabase: auth.supabase, importRunId: runId, errors: errorsForRun });
      await updatePdfImportRun({
        supabase: auth.supabase,
        importRunId: runId,
        summary,
        status: "completed",
      });
      cacheDeleteByPrefix("surveillance_rows_v1:");
    }

    const response: PdfImportResponse = {
      mode,
      summary,
      previewRows,
      errors: errorsForRun.slice(0, 200),
      message,
    };

    return NextResponse.json(response);
  } catch (err) {
    if (importRunId) {
      try {
        await auth.supabase
          .from("import_runs")
          .update({ status: "failed" })
          .eq("id", importRunId);
      } catch {
        // Keep the original import error as the primary failure surface.
      }
    }
    const status = err instanceof PdfImportHttpError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Errore import PDF." }, { status });
  }
}
