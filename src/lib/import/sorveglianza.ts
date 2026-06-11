import * as XLSX from "xlsx-js-style";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStrictIsoDateToIso } from "@/lib/it-date";

type ImportMode = "preview" | "commit";

export type SurveillanceImportField =
  | "matricola"
  | "taxCode"
  | "lastName"
  | "firstName"
  | "visitFlag"
  | "dueDate"
  | "limitations"
  | "notes";

type ImportParams = {
  fileBuffer: ArrayBuffer;
  mode: ImportMode;
  supabase: SupabaseClient;
  importedBy?: string | null;
  importRunId?: string | null;
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

async function insertImportRunErrors(args: {
  supabase: SupabaseClient;
  importRunId: string;
  errors: SurveillanceImportErrorRow[];
}) {
  const { supabase, importRunId, errors } = args;
  if (!importRunId) return;
  if (errors.length === 0) return;

  for (const part of chunk(errors, 500)) {
    const { error } = await supabase.from("import_run_errors").insert(
      part.map((row) => ({
        import_run_id: importRunId,
        row_number: Number.isFinite(row.rowNumber) ? row.rowNumber : 0,
        matricola: row.matricola || null,
        tax_code: row.taxCode || null,
        last_name: row.lastName || null,
        first_name: row.firstName || null,
        error_type: row.errorType || "error",
        error_message: row.errorMessage || "Errore import.",
      })),
    );
    if (error) throw new Error(error.message);
  }
}

export type ExistingMedicalSurveillanceRow = {
  employee_id: number;
  requires_visit: boolean;
  next_due_date: string | null;
  limitations: string | null;
  notes: string | null;
};

export type MedicalSurveillanceUpsertRow = {
  employee_id: number;
  requires_visit: boolean;
  next_due_date?: string | null;
  limitations?: string | null;
  notes?: string | null;
  created_by: string | null;
};

export function makeMedicalSurveillanceUpsertsSafe(args: {
  rows: MedicalSurveillanceUpsertRow[];
  existingByEmployeeId: Map<number, ExistingMedicalSurveillanceRow>;
}) {
  const safeRows = args.rows.map((row) => {
    const out: MedicalSurveillanceUpsertRow = { ...row };

    if (!out.requires_visit) {
      out.next_due_date = null;
    } else if (!out.next_due_date) {
      delete out.next_due_date;
    }

    const candLimitations = String(out.limitations ?? "").trim();
    if (!candLimitations) delete out.limitations;

    const candNotes = String(out.notes ?? "").trim();
    if (!candNotes) delete out.notes;

    return out;
  });

  return { rows: safeRows, skippedOlderDueDates: 0 };
}

export async function processMedicalSurveillanceImport({
  fileBuffer,
  mode,
  supabase,
  importedBy,
  importRunId,
}: ImportParams): Promise<SurveillanceImportResult> {
  const parsed = parseWorkbook(fileBuffer);
  const lookup = await buildEmployeeLookup(supabase, parsed.validRows);

  const errors: SurveillanceImportErrorRow[] = [...parsed.errors];

  const chosenByEmployeeId = new Map<
    number,
    {
      raw: RawRow;
      upsert: {
        employee_id: number;
        requires_visit: boolean;
        next_due_date?: string | null;
        limitations?: string | null;
        notes?: string | null;
        created_by: string | null;
      };
    }
  >();

  let matchedRowOccurrences = 0;
  let missingEmployees = 0;

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

    matchedRowOccurrences += 1;

    const candidate = {
      raw: row,
      upsert: {
        employee_id: employee.id,
        requires_visit: row.requiresVisit,
        next_due_date: row.nextDueDate,
        limitations: cleanNullable(row.limitations),
        notes: cleanNullable(row.notes),
        created_by: importedBy ?? null,
      },
    };

    const existing = chosenByEmployeeId.get(employee.id);
    if (!existing) {
      chosenByEmployeeId.set(employee.id, candidate);
      return;
    }

    const a = candidate.upsert.next_due_date;
    const b = existing.upsert.next_due_date;
    const takeCandidate =
      a && b
        ? a > b || (a === b && candidate.raw.rowNumber > existing.raw.rowNumber)
        : a
          ? true
          : b
            ? false
            : candidate.raw.rowNumber > existing.raw.rowNumber;

    if (takeCandidate) chosenByEmployeeId.set(employee.id, candidate);
  });

  const chosen = Array.from(chosenByEmployeeId.values());
  const rowsToUpsert = chosen.map((c) => c.upsert) as MedicalSurveillanceUpsertRow[];
  const matchedEmployees = rowsToUpsert.length;
  const duplicateRowsCollapsed = Math.max(0, matchedRowOccurrences - matchedEmployees);

  let visitRequiredYes = 0;
  let visitRequiredNo = 0;
  let dueDateMissing = 0;
  chosen.forEach((c) => {
    if (c.upsert.requires_visit) visitRequiredYes += 1;
    else visitRequiredNo += 1;
    if (c.upsert.requires_visit && !c.upsert.next_due_date) dueDateMissing += 1;
  });

  let skippedOlderDueDates = 0;
  let safeRowsToUpsert = rowsToUpsert;
  if (mode === "commit" && rowsToUpsert.length > 0) {
    const employeeIds = rowsToUpsert.map((r) => r.employee_id);
    const existingByEmployeeId = new Map<number, ExistingMedicalSurveillanceRow>();

    for (const part of chunk(employeeIds, 500)) {
      const { data, error } = await supabase
        .from("medical_surveillance_records")
        .select("employee_id,requires_visit,next_due_date,limitations,notes")
        .in("employee_id", part);
      if (error) throw new Error(error.message);
      (data ?? []).forEach((row) => {
        existingByEmployeeId.set((row as ExistingMedicalSurveillanceRow).employee_id, row as ExistingMedicalSurveillanceRow);
      });
    }

    const safe = makeMedicalSurveillanceUpsertsSafe({ rows: rowsToUpsert, existingByEmployeeId });
    safeRowsToUpsert = safe.rows;
    skippedOlderDueDates = safe.skippedOlderDueDates;

    if (skippedOlderDueDates > 0) {
      errors.push({
        rowNumber: 0,
        matricola: "",
        taxCode: "",
        lastName: "",
        firstName: "",
        errorType: "skipped_older_due_date",
        errorMessage: `Saltate ${skippedOlderDueDates} scadenze più vecchie rispetto a quelle già presenti.`,
      });
    }

    if (importRunId) {
      const changes = safeRowsToUpsert.map((row) => {
        const before = existingByEmployeeId.get(row.employee_id) ?? null;
        const afterNextDueDate =
          row.next_due_date === undefined ? before?.next_due_date ?? null : (row.next_due_date ?? null);
        const afterLimitations =
          row.limitations === undefined ? before?.limitations ?? null : (row.limitations ?? null);
        const afterNotes = row.notes === undefined ? before?.notes ?? null : (row.notes ?? null);
        return {
          import_run_id: importRunId,
          table_name: "medical_surveillance_records",
          action: before ? "update" : "insert",
          row_key: { employee_id: row.employee_id },
          before_row: before
            ? {
                employee_id: before.employee_id,
                requires_visit: before.requires_visit,
                next_due_date: before.next_due_date,
                limitations: before.limitations,
                notes: before.notes,
              }
            : null,
          after_row: {
            employee_id: row.employee_id,
            requires_visit: row.requires_visit,
            next_due_date: afterNextDueDate,
            limitations: afterLimitations,
            notes: afterNotes,
          },
        };
      });

      for (const part of chunk(changes, 500)) {
        const { error } = await supabase.from("import_run_changes").insert(part);
        if (error) throw new Error(error.message);
      }
    }

    const { error } = await supabase
      .from("medical_surveillance_records")
      .upsert(safeRowsToUpsert, { onConflict: "employee_id" });
    if (error) {
      if (importRunId) {
        await insertImportRunErrors({ supabase, importRunId, errors });
      }
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
        previewRows: buildPreview(chosen.map((c) => c.raw)).slice(0, 50),
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
      ? `Import completato: ${matchedEmployees} righe associate ad anagrafica e salvate.${duplicateRowsCollapsed > 0 ? ` (Duplicati consolidati: ${duplicateRowsCollapsed})` : ""}`
      : `Anteprima completata: ${matchedEmployees} righe associabili ad anagrafica.${duplicateRowsCollapsed > 0 ? ` (Duplicati consolidati: ${duplicateRowsCollapsed})` : ""}`;

  if (mode === "commit" && importRunId) {
    await insertImportRunErrors({ supabase, importRunId, errors });
  }

  return {
    mode,
    summary,
    previewRows: buildPreview(chosen.map((c) => c.raw)).slice(0, 50),
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
    .replace(/[_/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
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

function parseBooleanSiNo(value: string) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "NO" || raw === "N" || raw === "0") return false;
  if (raw === "SI" || raw === "S" || raw === "1") return true;
  return null;
}

export function parseDateToIso(value: unknown) {
  const toValidIso = (yyyy: string | number, mm: string | number, dd: string | number) =>
    parseStrictIsoDateToIso(
      `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
    );

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return parseStrictIsoDateToIso(value.toISOString().slice(0, 10));
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const n = value;
    if (n > 20000 && n < 80000) {
      const millis = Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000;
      return parseStrictIsoDateToIso(new Date(millis).toISOString().slice(0, 10));
    }
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (raw.match(/^\d+(\.\d+)?$/)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 20000 && n < 80000) {
      const millis = Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000;
      return parseStrictIsoDateToIso(new Date(millis).toISOString().slice(0, 10));
    }
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return toValidIso(iso[1], iso[2], iso[3]);

  const dash = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dash) return toValidIso(dash[3], dash[2], dash[1]);

  const dot = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dot) {
    return toValidIso(dot[3], dot[2], dot[1]);
  }

  const slashLong = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashLong) {
    const ddNum = Number(slashLong[1]);
    const mmNum = Number(slashLong[2]);
    if (!Number.isFinite(ddNum) || !Number.isFinite(mmNum) || ddNum < 1 || ddNum > 31 || mmNum < 1 || mmNum > 12) return null;
    return toValidIso(slashLong[3], mmNum, ddNum);
  }

  const slashShort = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (slashShort) {
    const ddNum = Number(slashShort[1]);
    const mmNum = Number(slashShort[2]);
    if (!Number.isFinite(ddNum) || !Number.isFinite(mmNum) || ddNum < 1 || ddNum > 31 || mmNum < 1 || mmNum > 12) return null;
    const yy = Number(slashShort[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return toValidIso(year, mmNum, ddNum);
  }

  return null;
}

function readSheetRows(workbook: XLSX.WorkBook, sheetName: string) {
  const worksheet = workbook.Sheets[sheetName];
  const rows = (XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  }) ?? []) as unknown[][];
  return rows;
}

function parseWorkbook(
  fileBuffer: ArrayBuffer,
): { validRows: RawRow[]; errors: SurveillanceImportErrorRow[]; totalRows: number } {
  const workbook = XLSX.read(Buffer.from(fileBuffer), { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = readSheetRows(workbook, sheetName);
  const headerRowIndex = 0;
  const headerRow = rows[headerRowIndex] ?? [];
  const headerIndex = buildHeaderIndex(headerRow);

  const templateHeaders: Record<SurveillanceImportField, string> = {
    matricola: "matricola",
    taxCode: "codice fiscale",
    lastName: "cognome",
    firstName: "nome",
    visitFlag: "visita si/no",
    dueDate: "scadenza visita",
    limitations: "limitazioni",
    notes: "note",
  };

  const missingHeaders = (Object.keys(templateHeaders) as SurveillanceImportField[]).filter((field) => {
    const key = normalizeHeaderCell(templateHeaders[field]);
    const indices = headerIndex.get(key);
    return !indices || indices.length === 0;
  });
  if (missingHeaders.length > 0) {
    const missingNames = missingHeaders.map((f) => templateHeaders[f]).join(", ");
    throw new Error(`File non conforme al modello import Sorveglianza. Colonne mancanti: ${missingNames}.`);
  }

  const dueKey = normalizeHeaderCell(templateHeaders.dueDate);
  const dueIndices = headerIndex.get(dueKey) ?? [];
  const dueColIndex = dueIndices[0] ?? -1;

  const dataRows = rows.slice(headerRowIndex + 1);
  const validRows: RawRow[] = [];
  const errors: SurveillanceImportErrorRow[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + 2 + i;
    const firstCell = cleanCell(row[0]);
    if (firstCell.toLowerCase().startsWith("totale")) return;

    const matricola = cleanCell(getFirstByName(row, headerIndex, templateHeaders.matricola));
    const taxCode = cleanCell(getFirstByName(row, headerIndex, templateHeaders.taxCode)).toUpperCase();
    const lastName = cleanCell(getFirstByName(row, headerIndex, templateHeaders.lastName));
    const firstName = cleanCell(getFirstByName(row, headerIndex, templateHeaders.firstName));
    const visitRaw = cleanCell(getFirstByName(row, headerIndex, templateHeaders.visitFlag));
    const dueRaw = getFirstByName(row, headerIndex, templateHeaders.dueDate);
    const limitations = cleanCell(getFirstByName(row, headerIndex, templateHeaders.limitations));
    const notes = cleanCell(getFirstByName(row, headerIndex, templateHeaders.notes));

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

    const requiresVisitParsed = parseBooleanSiNo(visitRaw);
    if (requiresVisitParsed === null) {
      errors.push({
        rowNumber,
        matricola,
        taxCode,
        lastName,
        firstName,
        errorType: "invalid_visit_flag",
        errorMessage: 'Valore non valido per "visita si/no" (attesi SI/NO). Importato come SI per sicurezza.',
      });
    }
    const requiresVisit = requiresVisitParsed ?? true;

    const dueCell =
      worksheet && dueColIndex >= 0
        ? (worksheet[XLSX.utils.encode_cell({ r: headerRowIndex + 1 + i, c: dueColIndex })] as
            | { v?: unknown; w?: unknown; f?: unknown }
            | undefined)
        : undefined;

    const dueRawText = cleanCell(dueCell?.w ?? dueRaw);

    let nextDueDate: string | null = null;
    if (dueCell) {
      if (dueCell.f && (dueCell.v === undefined || dueCell.v === null || dueCell.v === "")) {
        errors.push({
          rowNumber,
          matricola,
          taxCode,
          lastName,
          firstName,
          errorType: "due_date_formula_not_supported",
          errorMessage:
            'La cella "scadenza visita" contiene una formula senza valore. Salva/Esporta il file con valori (incolla valori) e reimporta.',
        });
      } else {
        nextDueDate = parseDateToIso(dueCell.v ?? dueCell.w ?? null);
      }
    }
    if (!nextDueDate) nextDueDate = parseDateToIso(dueRaw);

    if (dueRawText && !nextDueDate) {
      errors.push({
        rowNumber,
        matricola,
        taxCode,
        lastName,
        firstName,
        errorType: "invalid_due_date",
        errorMessage: `Data non valida in "scadenza visita": "${dueRawText}".`,
      });
      return;
    }

    validRows.push({
      rowNumber,
      matricola,
      taxCode,
      lastName,
      firstName,
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
