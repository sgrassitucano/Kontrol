import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";

type ImportMode = "preview" | "commit";

type ImportParams = {
  fileBuffer: ArrayBuffer;
  fileName: string;
  mode: ImportMode;
  supabase: SupabaseClient;
  importedBy?: string | null;
};

type EmployeeLookupRow = {
  id: number;
  tax_code: string;
  matricola: string;
};

type RawRow = {
  rowNumber: number;
  matricola: string;
  taxCode: string;
  lastName: string;
  firstName: string;
  provider: string;
  requiresVisit: boolean;
  nextDueDate: string | null;
  limitations: string;
  notes: string;
};

export type SurveillanceImportErrorRow = {
  rowNumber: number;
  matricola: string;
  taxCode: string;
  lastName: string;
  firstName: string;
  errorType: string;
  errorMessage: string;
};

export type SurveillanceImportPreviewRow = {
  matricola: string;
  cognome: string;
  nome: string;
  codiceFiscale: string;
  provider: string;
  visitaRichiesta: "SI" | "NO";
  scadenzaVisita: string;
};

export type SurveillanceImportSummary = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  matchedEmployees: number;
  missingEmployees: number;
  visitRequiredYes: number;
  visitRequiredNo: number;
  dueDateMissing: number;
};

export type SurveillanceImportResult = {
  mode: ImportMode;
  summary: SurveillanceImportSummary;
  previewRows: SurveillanceImportPreviewRow[];
  errors: SurveillanceImportErrorRow[];
  message: string;
};

export async function processMedicalSurveillanceImport({
  fileBuffer,
  fileName,
  mode,
  supabase,
  importedBy,
}: ImportParams): Promise<SurveillanceImportResult> {
  const parsed = parseWorkbook(fileBuffer);
  const lookup = await buildEmployeeLookup(supabase, parsed.validRows);

  const errors: SurveillanceImportErrorRow[] = [...parsed.errors];
  const rowsToUpsert: Array<{
    employee_id: number;
    provider: string | null;
    requires_visit: boolean;
    next_due_date: string | null;
    limitations: string | null;
    notes: string | null;
    created_by: string | null;
  }> = [];

  let matchedEmployees = 0;
  let missingEmployees = 0;
  let visitRequiredYes = 0;
  let visitRequiredNo = 0;
  let dueDateMissing = 0;

  parsed.validRows.forEach((row) => {
    const employee =
      (row.taxCode ? lookup.byTaxCode.get(row.taxCode) : undefined) ??
      (row.matricola ? lookup.byMatricola.get(row.matricola) : undefined);

    if (!employee) {
      missingEmployees += 1;
      errors.push({
        rowNumber: row.rowNumber,
        matricola: row.matricola,
        taxCode: row.taxCode,
        lastName: row.lastName,
        firstName: row.firstName,
        errorType: "employee_not_found",
        errorMessage: "Dipendente non trovato in anagrafica (match su CF o matricola).",
      });
      return;
    }

    matchedEmployees += 1;
    if (row.requiresVisit) visitRequiredYes += 1;
    else visitRequiredNo += 1;
    if (row.requiresVisit && !row.nextDueDate) dueDateMissing += 1;

    rowsToUpsert.push({
      employee_id: employee.id,
      provider: cleanNullable(row.provider),
      requires_visit: row.requiresVisit,
      next_due_date: row.nextDueDate,
      limitations: cleanNullable(row.limitations),
      notes: cleanNullable(row.notes),
      created_by: importedBy ?? null,
    });
  });

  if (mode === "commit" && rowsToUpsert.length > 0) {
    const { error } = await supabase
      .from("medical_surveillance_records")
      .upsert(rowsToUpsert, { onConflict: "employee_id" });
    if (error) {
      return {
        mode,
        summary: {
          totalRows: parsed.totalRows,
          validRows: parsed.validRows.length,
          errorRows: errors.length,
          matchedEmployees,
          missingEmployees,
          visitRequiredYes,
          visitRequiredNo,
          dueDateMissing,
        },
        previewRows: buildPreview(parsed.validRows).slice(0, 50),
        errors,
        message: `Import fallito: ${error.message}`,
      };
    }
  }

  const summary: SurveillanceImportSummary = {
    totalRows: parsed.totalRows,
    validRows: parsed.validRows.length,
    errorRows: errors.length,
    matchedEmployees,
    missingEmployees,
    visitRequiredYes,
    visitRequiredNo,
    dueDateMissing,
  };

  const message =
    mode === "commit"
      ? `Import completato: ${matchedEmployees} righe associate ad anagrafica e salvate.`
      : `Anteprima completata: ${matchedEmployees} righe associabili ad anagrafica.`;

  return {
    mode,
    summary,
    previewRows: buildPreview(parsed.validRows).slice(0, 50),
    errors,
    message,
  };
}

function cleanNullable(value: string) {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

function buildPreview(rows: RawRow[]): SurveillanceImportPreviewRow[] {
  return rows.map((row) => ({
    matricola: row.matricola,
    cognome: row.lastName,
    nome: row.firstName,
    codiceFiscale: row.taxCode,
    provider: row.provider || "-",
    visitaRichiesta: row.requiresVisit ? "SI" : "NO",
    scadenzaVisita: row.nextDueDate ? formatDateIt(row.nextDueDate) : "-",
  }));
}

function formatDateIt(iso: string) {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function normalizeHeaderCell(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildHeaderIndex(headerRow: unknown[]) {
  const index = new Map<string, number[]>();
  headerRow.forEach((cell, i) => {
    const key = normalizeHeaderCell(cell);
    if (!key) return;
    const list = index.get(key);
    if (!list) index.set(key, [i]);
    else list.push(i);
  });
  return index;
}

function getFirstByName(row: unknown[], headerIndex: Map<string, number[]>, name: string) {
  const key = normalizeHeaderCell(name);
  const indices = headerIndex.get(key);
  if (!indices || indices.length === 0) return "";
  for (const idx of indices) {
    const value = cleanCell(row[idx]);
    if (value) return value;
  }
  return "";
}

function cleanCell(value: unknown) {
  return String(value ?? "").trim();
}

function detectHeaderRowIndex(rows: unknown[][]) {
  const candidates = rows.slice(0, 30);
  for (let i = 0; i < candidates.length; i += 1) {
    const row = candidates[i] ?? [];
    const normalized = row.map((c) => normalizeHeaderCell(c));
    if (normalized.includes("matricola") && normalized.includes("codice fiscale")) {
      return i;
    }
  }
  return 0;
}

function parseBooleanSiNo(value: string) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "NO" || raw === "N" || raw === "0") return false;
  if (raw === "SI" || raw === "S" || raw === "1") return true;
  return true;
}

function parseDateToIso(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const dash = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dash) return `${dash[3]}-${dash[2]}-${dash[1]}`;

  const slashLong = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashLong) {
    const mm = String(slashLong[1]).padStart(2, "0");
    const dd = String(slashLong[2]).padStart(2, "0");
    return `${slashLong[3]}-${mm}-${dd}`;
  }

  const slashShort = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (slashShort) {
    const yy = Number(slashShort[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const mm = String(slashShort[1]).padStart(2, "0");
    const dd = String(slashShort[2]).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  return null;
}

function parseWorkbook(fileBuffer: ArrayBuffer): { validRows: RawRow[]; errors: SurveillanceImportErrorRow[]; totalRows: number } {
  const workbook = XLSX.read(Buffer.from(fileBuffer), { cellDates: true });
  const sheetName =
    workbook.SheetNames.find((name) => name.toLowerCase().includes("anagrafica_sorveglianza")) ??
    workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = (XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  }) ?? []) as unknown[][];

  const headerRowIndex = detectHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] ?? [];
  const headerIndex = buildHeaderIndex(headerRow);

  const dataRows = rows.slice(headerRowIndex + 1);
  const validRows: RawRow[] = [];
  const errors: SurveillanceImportErrorRow[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + 2 + i;
    const firstCell = cleanCell(row[0]);
    if (firstCell.toLowerCase().startsWith("totale")) return;

    const matricola = cleanCell(getFirstByName(row, headerIndex, "matricola"));
    const taxCode = cleanCell(getFirstByName(row, headerIndex, "codice fiscale")).toUpperCase();
    const lastName = cleanCell(getFirstByName(row, headerIndex, "cognome"));
    const firstName = cleanCell(getFirstByName(row, headerIndex, "nome"));
    const provider = cleanCell(getFirstByName(row, headerIndex, "provider"));
    const visitRaw = cleanCell(getFirstByName(row, headerIndex, "visita si/no"));
    const dueRaw = cleanCell(getFirstByName(row, headerIndex, "scadenza visita"));
    const limitations = cleanCell(getFirstByName(row, headerIndex, "limitazioni"));
    const notes = cleanCell(getFirstByName(row, headerIndex, "note"));

    if (!matricola && !taxCode) return;

    if (!matricola || !taxCode) {
      errors.push({
        rowNumber,
        matricola,
        taxCode,
        lastName,
        firstName,
        errorType: "required_identity_fields",
        errorMessage: "Campi identificativi mancanti (matricola e/o codice fiscale).",
      });
      return;
    }

    const requiresVisit = parseBooleanSiNo(visitRaw);
    const nextDueDate = parseDateToIso(dueRaw);

    validRows.push({
      rowNumber,
      matricola,
      taxCode,
      lastName,
      firstName,
      provider,
      requiresVisit,
      nextDueDate,
      limitations,
      notes,
    });
  });

  return { validRows, errors, totalRows: validRows.length + errors.length };
}

async function buildEmployeeLookup(supabase: SupabaseClient, rows: RawRow[]) {
  const taxCodes = Array.from(new Set(rows.map((r) => r.taxCode).filter(Boolean)));
  const matricole = Array.from(new Set(rows.map((r) => r.matricola).filter(Boolean)));

  const byTaxCode = new Map<string, EmployeeLookupRow>();
  const byMatricola = new Map<string, EmployeeLookupRow>();

  const taxChunks = chunk(taxCodes, 500);
  for (const part of taxChunks) {
    const { data, error } = await supabase
      .from("employees")
      .select("id,tax_code,matricola")
      .in("tax_code", part);
    if (error) throw new Error(error.message);
    ((data ?? []) as EmployeeLookupRow[]).forEach((row) => {
      byTaxCode.set(String(row.tax_code ?? "").toUpperCase(), row);
      byMatricola.set(String(row.matricola ?? "").trim(), row);
    });
  }

  const remainingMatricole = matricole.filter((m) => !byMatricola.has(m));
  const matricolaChunks = chunk(remainingMatricole, 500);
  for (const part of matricolaChunks) {
    const { data, error } = await supabase
      .from("employees")
      .select("id,tax_code,matricola")
      .in("matricola", part);
    if (error) throw new Error(error.message);
    ((data ?? []) as EmployeeLookupRow[]).forEach((row) => {
      byTaxCode.set(String(row.tax_code ?? "").toUpperCase(), row);
      byMatricola.set(String(row.matricola ?? "").trim(), row);
    });
  }

  return { byTaxCode, byMatricola };
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
