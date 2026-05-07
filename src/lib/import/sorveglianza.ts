import * as XLSX from "xlsx-js-style";
import type { SupabaseClient } from "@supabase/supabase-js";

type ImportMode = "preview" | "commit";

export type SurveillanceImportField =
  | "matricola"
  | "taxCode"
  | "lastName"
  | "firstName"
  | "provider"
  | "visitFlag"
  | "dueDate"
  | "limitations"
  | "notes";

export type SurveillanceImportColumnMapping = Partial<Record<SurveillanceImportField, string>>;

export type SurveillanceImportSchema = {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  signature: string;
  suggestedMapping: SurveillanceImportColumnMapping;
};

type ImportParams = {
  fileBuffer: ArrayBuffer;
  mode: ImportMode;
  supabase: SupabaseClient;
  importedBy?: string | null;
  mapping?: SurveillanceImportColumnMapping;
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

export type ProviderSeedResult = {
  seeded: number;
  sites: number;
  subSites: number;
};

export async function processMedicalSurveillanceImport({
  fileBuffer,
  mode,
  supabase,
  importedBy,
  mapping,
}: ImportParams): Promise<SurveillanceImportResult> {
  const parsed = parseWorkbook(fileBuffer, mapping);
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

export async function seedProvidersFromMedicalSurveillanceImportFile(params: {
  fileBuffer: ArrayBuffer;
  supabase: SupabaseClient;
  importedBy?: string | null;
  mapping?: SurveillanceImportColumnMapping;
}): Promise<ProviderSeedResult> {
  const parsed = parseWorkbook(params.fileBuffer, params.mapping);
  const rowsWithProvider = parsed.validRows.filter((r) => String(r.provider ?? "").trim().length > 0);
  if (rowsWithProvider.length === 0) return { seeded: 0, sites: 0, subSites: 0 };

  const lookup = await buildEmployeeLookup(params.supabase, rowsWithProvider);

  const employeeIdSet = new Set<number>();
  rowsWithProvider.forEach((row) => {
    const employee =
      (row.taxCode ? lookup.byTaxCode.get(row.taxCode) : undefined) ??
      (row.matricola ? lookup.byMatricola.get(row.matricola) : undefined);
    if (!employee) return;
    employeeIdSet.add(employee.id);
  });

  const employeeIds = Array.from(employeeIdSet.values());
  if (employeeIds.length === 0) return { seeded: 0, sites: 0, subSites: 0 };

  const employeeById = await fetchEmployeesByIds(params.supabase, employeeIds);

  const providersBySubSiteId = new Map<number, Map<string, number>>();
  const providersBySiteIdNoSub = new Map<number, Map<string, number>>();
  const subSitesBySiteId = new Map<number, Set<number>>();

  rowsWithProvider.forEach((row) => {
    const employee =
      (row.taxCode ? lookup.byTaxCode.get(row.taxCode) : undefined) ??
      (row.matricola ? lookup.byMatricola.get(row.matricola) : undefined);
    if (!employee) return;
    const employeeScope = employeeById.get(employee.id);
    if (!employeeScope) return;
    const provider = String(row.provider ?? "").trim();
    if (!provider) return;

    if (employeeScope.sub_site_id) {
      subSitesBySiteId.set(
        employeeScope.site_id,
        (subSitesBySiteId.get(employeeScope.site_id) ?? new Set()).add(employeeScope.sub_site_id),
      );
      const map = providersBySubSiteId.get(employeeScope.sub_site_id) ?? new Map<string, number>();
      map.set(provider, (map.get(provider) ?? 0) + 1);
      providersBySubSiteId.set(employeeScope.sub_site_id, map);
      return;
    }

    const siteMap = providersBySiteIdNoSub.get(employeeScope.site_id) ?? new Map<string, number>();
    siteMap.set(provider, (siteMap.get(provider) ?? 0) + 1);
    providersBySiteIdNoSub.set(employeeScope.site_id, siteMap);
  });

  const bestProvider = (countMap: Map<string, number>) => {
    let best = "";
    let bestCount = -1;
    for (const [provider, count] of countMap.entries()) {
      if (count > bestCount) {
        best = provider;
        bestCount = count;
      }
    }
    return best;
  };

  const createdBy = params.importedBy ?? null;
  const note = "Seed da import sorveglianza";

  const subSiteAssignmentRows: Array<{
    scope_type: "sub_site";
    site_id: null;
    sub_site_id: number;
    provider: string;
    is_active: boolean;
    note: string | null;
    created_by: string | null;
  }> = [];

  for (const [subSiteId, countMap] of providersBySubSiteId.entries()) {
    const provider = bestProvider(countMap);
    if (!provider) continue;
    subSiteAssignmentRows.push({
      scope_type: "sub_site",
      site_id: null,
      sub_site_id: subSiteId,
      provider,
      is_active: true,
      note,
      created_by: createdBy,
    });
  }

  const siteAssignmentRows: Array<{
    scope_type: "site";
    site_id: number;
    sub_site_id: null;
    provider: string;
    is_active: boolean;
    note: string | null;
    created_by: string | null;
  }> = [];

  const allSiteIds = new Set<number>([
    ...providersBySiteIdNoSub.keys(),
    ...subSitesBySiteId.keys(),
    ...Array.from(employeeById.values()).map((e) => e.site_id),
  ]);

  for (const siteId of allSiteIds) {
    const siteNoSub = providersBySiteIdNoSub.get(siteId) ?? null;
    const siteSubIds = Array.from(subSitesBySiteId.get(siteId) ?? []);

    if (siteSubIds.length === 0) {
      if (!siteNoSub) continue;
      const provider = bestProvider(siteNoSub);
      if (!provider) continue;
      siteAssignmentRows.push({
        scope_type: "site",
        site_id: siteId,
        sub_site_id: null,
        provider,
        is_active: true,
        note,
        created_by: createdBy,
      });
      continue;
    }

    const uniqueProviders = new Set<string>();
    siteSubIds.forEach((subSiteId) => {
      const p = subSiteAssignmentRows.find((r) => r.sub_site_id === subSiteId)?.provider;
      if (p) uniqueProviders.add(p);
    });

    if (uniqueProviders.size === 1) {
      const provider = Array.from(uniqueProviders)[0] ?? "";
      if (!provider) continue;
      siteAssignmentRows.push({
        scope_type: "site",
        site_id: siteId,
        sub_site_id: null,
        provider,
        is_active: true,
        note,
        created_by: createdBy,
      });
    } else if (uniqueProviders.size > 1) {
      siteAssignmentRows.push({
        scope_type: "site",
        site_id: siteId,
        sub_site_id: null,
        provider: "MISTO",
        is_active: true,
        note,
        created_by: createdBy,
      });
    }
  }

  const rowsToUpsert = [...siteAssignmentRows, ...subSiteAssignmentRows];
  if (rowsToUpsert.length === 0) return { seeded: 0, sites: 0, subSites: 0 };

  const { error } = await params.supabase
    .from("medical_surveillance_provider_assignments")
    .upsert(rowsToUpsert, { onConflict: "scope_type,site_id,sub_site_id" });
  if (error) throw new Error(error.message);

  return { seeded: rowsToUpsert.length, sites: siteAssignmentRows.length, subSites: subSiteAssignmentRows.length };
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

const COLUMN_ALIASES: Record<SurveillanceImportField, string[]> = {
  matricola: ["matricola", "matr", "matricola dipendente", "id dipendente", "id"],
  taxCode: ["codice fiscale", "cf", "c f", "codicefiscale", "codice fiscale dipendente"],
  lastName: ["cognome", "cognome dipendente"],
  firstName: ["nome", "nome dipendente"],
  provider: ["provider", "medico", "medico competente", "ente", "medico ente", "medico/ente"],
  visitFlag: ["visita si/no", "visita", "visita si no", "richiede visita", "visita richiesta"],
  dueDate: ["scadenza visita", "data scadenza visita", "prossima visita", "prossima scadenza", "scadenza"],
  limitations: ["limitazioni", "limitazione", "prescrizioni", "idoneita", "idoneità"],
  notes: ["note", "nota", "osservazioni"],
};

function getFirstByField(
  row: unknown[],
  headerIndex: Map<string, number[]>,
  mapping: SurveillanceImportColumnMapping | undefined,
  field: SurveillanceImportField,
) {
  const explicit = mapping?.[field];
  if (explicit) return getFirstByName(row, headerIndex, explicit);
  const aliases = COLUMN_ALIASES[field] ?? [];
  for (const name of aliases) {
    const value = getFirstByName(row, headerIndex, name);
    if (value) return value;
  }
  return "";
}

function scoreHeaderRow(normalizedRow: string[]) {
  let score = 0;
  (Object.keys(COLUMN_ALIASES) as SurveillanceImportField[]).forEach((field) => {
    const aliases = COLUMN_ALIASES[field] ?? [];
    if (aliases.some((a) => normalizedRow.includes(normalizeHeaderCell(a)))) score += 1;
  });
  return score;
}

function detectHeaderRowIndex(rows: unknown[][]) {
  const candidates = rows.slice(0, 30);
  for (let i = 0; i < candidates.length; i += 1) {
    const row = candidates[i] ?? [];
    const normalized = row.map((c) => normalizeHeaderCell(c));
    const hasMatricola = (COLUMN_ALIASES.matricola ?? []).some((a) => normalized.includes(normalizeHeaderCell(a)));
    const hasTax = (COLUMN_ALIASES.taxCode ?? []).some((a) => normalized.includes(normalizeHeaderCell(a)));
    if (hasMatricola && hasTax) {
      return i;
    }
  }
  return 0;
}

function parseBooleanSiNo(value: string) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "NO" || raw === "N" || raw === "0") return false;
  if (raw === "SI" || raw === "S" || raw === "1") return true;
  return null;
}

function parseDateToIso(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dash = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dash) return `${dash[3]}-${dash[2]}-${dash[1]}`;

  const dot = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dot) {
    const dd = String(dot[1]).padStart(2, "0");
    const mm = String(dot[2]).padStart(2, "0");
    return `${dot[3]}-${mm}-${dd}`;
  }

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

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return null;
}

function hashSignature(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
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

function analyzeWorkbook(workbook: XLSX.WorkBook) {
  const candidates = workbook.SheetNames.map((sheetName) => {
    const rows = readSheetRows(workbook, sheetName);
    const headerRowIndex = detectHeaderRowIndex(rows);
    const headerRow = rows[headerRowIndex] ?? [];
    const normalizedHeader = headerRow.map((c) => normalizeHeaderCell(c)).filter(Boolean);
    const score = scoreHeaderRow(headerRow.map((c) => normalizeHeaderCell(c)));
    return { sheetName, rows, headerRowIndex, headerRow, normalizedHeader, score };
  });

  const best =
    candidates.reduce((acc, cur) => {
      if (!acc) return cur;
      if (cur.score > acc.score) return cur;
      if (cur.score === acc.score && cur.headerRowIndex < acc.headerRowIndex) return cur;
      return acc;
    }, null as null | (typeof candidates)[number]) ?? candidates[0];

  const headers = (best?.headerRow ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
  const signature = hashSignature(Array.from(new Set(best?.normalizedHeader ?? [])).sort().join("|"));
  const headerIndex = buildHeaderIndex(best?.headerRow ?? []);

  const suggestedMapping: SurveillanceImportColumnMapping = {};
  (Object.keys(COLUMN_ALIASES) as SurveillanceImportField[]).forEach((field) => {
    const aliases = COLUMN_ALIASES[field] ?? [];
    for (const alias of aliases) {
      const key = normalizeHeaderCell(alias);
      const indices = headerIndex.get(key);
      const idx = indices?.[0];
      if (typeof idx === "number") {
        const raw = String((best?.headerRow ?? [])[idx] ?? "").trim();
        if (raw) suggestedMapping[field] = raw;
        break;
      }
    }
  });

  return {
    sheetName: best?.sheetName ?? workbook.SheetNames[0],
    rows: best?.rows ?? readSheetRows(workbook, workbook.SheetNames[0]),
    headerRowIndex: best?.headerRowIndex ?? 0,
    headerRow: best?.headerRow ?? [],
    headerIndex,
    headers,
    signature,
    suggestedMapping,
  };
}

export function analyzeMedicalSurveillanceImportFile(fileBuffer: ArrayBuffer): SurveillanceImportSchema {
  const workbook = XLSX.read(Buffer.from(fileBuffer), { cellDates: true });
  const analyzed = analyzeWorkbook(workbook);
  return {
    sheetName: analyzed.sheetName,
    headerRowIndex: analyzed.headerRowIndex,
    headers: analyzed.headers,
    signature: analyzed.signature,
    suggestedMapping: analyzed.suggestedMapping,
  };
}

function parseWorkbook(
  fileBuffer: ArrayBuffer,
  mapping?: SurveillanceImportColumnMapping,
): { validRows: RawRow[]; errors: SurveillanceImportErrorRow[]; totalRows: number } {
  const workbook = XLSX.read(Buffer.from(fileBuffer), { cellDates: true });
  const analyzed = analyzeWorkbook(workbook);
  const rows = analyzed.rows;
  const headerRowIndex = analyzed.headerRowIndex;
  const headerIndex = analyzed.headerIndex;

  const dataRows = rows.slice(headerRowIndex + 1);
  const validRows: RawRow[] = [];
  const errors: SurveillanceImportErrorRow[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + 2 + i;
    const firstCell = cleanCell(row[0]);
    if (firstCell.toLowerCase().startsWith("totale")) return;

    const matricola = cleanCell(getFirstByField(row, headerIndex, mapping, "matricola"));
    const taxCode = cleanCell(getFirstByField(row, headerIndex, mapping, "taxCode")).toUpperCase();
    const lastName = cleanCell(getFirstByField(row, headerIndex, mapping, "lastName"));
    const firstName = cleanCell(getFirstByField(row, headerIndex, mapping, "firstName"));
    const provider = cleanCell(getFirstByField(row, headerIndex, mapping, "provider"));
    const visitRaw = cleanCell(getFirstByField(row, headerIndex, mapping, "visitFlag"));
    const dueRaw = getFirstByField(row, headerIndex, mapping, "dueDate");
    const limitations = cleanCell(getFirstByField(row, headerIndex, mapping, "limitations"));
    const notes = cleanCell(getFirstByField(row, headerIndex, mapping, "notes"));

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

async function fetchEmployeesByIds(supabase: SupabaseClient, ids: number[]) {
  const out = new Map<number, { id: number; site_id: number; sub_site_id: number | null }>();
  const chunks = chunk(ids, 500);
  for (const part of chunks) {
    const { data, error } = await supabase.from("employees").select("id,site_id,sub_site_id").in("id", part);
    if (error) throw new Error(error.message);
    ((data ?? []) as Array<{ id: number; site_id: number; sub_site_id: number | null }>).forEach((row) => {
      out.set(row.id, row);
    });
  }
  return out;
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
