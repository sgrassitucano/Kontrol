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

type RawEmployeeRow = {
  rowNumber: number;
  matricola: string;
  lastName: string;
  firstName: string;
  birthDateIso: string;
  birthPlace: string;
  taxCode: string;
  phone: string;
  mobile: string;
  emailPrimary: string;
  emailSecondary: string;
  referral: string;
  responsibleCode: string;
  jobTitle: string;
  jobTitleNotes: string;
  siteDisplayName: string;
  siteNormalizedName: string;
  subSiteDisplayName: string;
  subSiteNormalizedName: string;
  theoreticalWeeklyMinutes: number;
};

type ExistingEmployee = {
  id: number;
  matricola: string;
  tax_code: string;
  status: "attivo" | "dimesso";
};

type SiteRow = {
  id: number;
  normalized_name: string;
};

type SubSiteRow = {
  id: number;
  site_id: number;
  normalized_name: string;
};

export type ImportErrorRow = {
  rowNumber: number;
  matricola: string;
  taxCode: string;
  lastName: string;
  firstName: string;
  errorType: string;
  errorMessage: string;
};

export type ImportPreviewRow = {
  matricola: string;
  cognome: string;
  nome: string;
  codiceFiscale: string;
  responsabile: string;
  cantiere: string;
};

export type ImportSummary = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  newRows: number;
  updatedRows: number;
  reactivatedRows: number;
  dismissedRows: number;
};

export type ImportResult = {
  mode: ImportMode;
  summary: ImportSummary;
  previewRows: ImportPreviewRow[];
  errors: ImportErrorRow[];
  importRunId: string | null;
  message: string;
};

type ParsedDataset = {
  validRows: RawEmployeeRow[];
  errors: ImportErrorRow[];
  totalRows: number;
  snapshotTaxCodes: string[];
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_RESPONSIBLE_CODE = "NON_ASSEGNATO";
const DEFAULT_JOB_TITLE = "MANSIONE_NON_ASSEGNATA";
const DEFAULT_TEXT_VALUE = "NON_INDICATO";
const DEFAULT_BIRTH_DATE = "1900-01-01";
const DEFAULT_SITE = "NON_ASSEGNATO";

export async function processAnagraficaImport({
  fileBuffer,
  fileName,
  mode,
  supabase,
  importedBy,
}: ImportParams): Promise<ImportResult> {
  const parsed = parseWorkbook(fileBuffer);
  const existingEmployees = await fetchExistingEmployees(supabase);

  const analysis = analyzeAgainstExisting(
    parsed.validRows,
    existingEmployees,
    parsed.snapshotTaxCodes,
  );
  const allErrors = [...parsed.errors, ...analysis.conflictErrors];
  const validRows = analysis.filteredValidRows;
  const previewRows = validRows.slice(0, 150).map((row) => ({
    matricola: row.matricola,
    cognome: row.lastName,
    nome: row.firstName,
    codiceFiscale: row.taxCode,
    responsabile: row.responsibleCode,
    cantiere: row.siteDisplayName,
  }));

  const summaryBase: ImportSummary = {
    totalRows: parsed.totalRows,
    validRows: validRows.length,
    errorRows: allErrors.length,
    newRows: analysis.newRows,
    updatedRows: analysis.updatedRows,
    reactivatedRows: analysis.reactivatedRows,
    dismissedRows: analysis.dismissedRows,
  };

  if (mode === "preview") {
    return {
      mode,
      summary: summaryBase,
      previewRows,
      errors: allErrors,
      importRunId: null,
      message: "Anteprima completata.",
    };
  }

  const commitResult = await commitImport({
    supabase,
    fileName,
    importedBy: importedBy ?? null,
    validRows,
    snapshotTaxCodes: parsed.snapshotTaxCodes,
    errors: allErrors,
    existingEmployees,
    summary: summaryBase,
  });

  return {
    mode,
    summary: commitResult.summary,
    previewRows,
    errors: allErrors,
    importRunId: commitResult.importRunId,
    message: commitResult.message,
  };
}

function parseWorkbook(fileBuffer: ArrayBuffer): ParsedDataset {
  const workbook = XLSX.read(Buffer.from(fileBuffer), {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return { validRows: [], errors: [], totalRows: 0, snapshotTaxCodes: [] };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  if (rows.length < 3) {
    return { validRows: [], errors: [], totalRows: 0, snapshotTaxCodes: [] };
  }

  const headerRow = rows[1] ?? [];
  const headerIndex = buildHeaderIndex(headerRow);
  const dataRows = rows.slice(2, Math.max(rows.length - 2, 2));

  const validRows: RawEmployeeRow[] = [];
  const errors: ImportErrorRow[] = [];
  const snapshotTaxCodes = new Set<string>();

  const seenTaxCodes = new Set<string>();
  const seenMatricolaByTaxCode = new Map<string, string>();
  const seenTaxCodeByMatricola = new Map<string, string>();

  dataRows.forEach((row, i) => {
    const rowNumber = i + 3;

    const raw = {
      matricola: cleanCell(getByAliases(row, headerIndex, ["matricola"])),
      lastName: cleanCell(getByAliases(row, headerIndex, ["cognome"])),
      firstName: cleanCell(getByAliases(row, headerIndex, ["nome"])),
      birthDate: getByAliases(row, headerIndex, ["data nascita"]),
      birthPlace: cleanCell(getByAliases(row, headerIndex, ["luogo nascita"])),
      taxCode: cleanCell(getByAliases(row, headerIndex, ["codice fiscale"])).toUpperCase(),
      phone: cleanCell(getByAliases(row, headerIndex, ["telefono"])),
      mobile: cleanCell(getByAliases(row, headerIndex, ["cellulare"])),
      emailPrimary: cleanCell(getByAliases(row, headerIndex, ["email 1"])),
      emailSecondary: cleanCell(getByAliases(row, headerIndex, ["email 2"])),
      referral: cleanCell(getByAliases(row, headerIndex, ["referente"])),
      responsibleCode: cleanCell(
        getByAliases(row, headerIndex, ["responsabile tecnico 1", "responsabile"]),
      ).toUpperCase(),
      jobTitle: cleanCell(getByAliases(row, headerIndex, ["mansione (ca4)", "mansione"])),
      jobTitleNotes: cleanCell(
        getByAliases(row, headerIndex, ["specifiche mansione"]),
      ),
      site: cleanCell(getByAliases(row, headerIndex, ["cantiere (ca28)", "cantiere"])),
      subSite: cleanCell(
        getByAliases(row, headerIndex, ["sottocantiere 1", "sottocantiere"]),
      ),
      theoreticalRaw: cleanCell(
        getByAliases(row, headerIndex, ["teorico settimanale (ca5)", "teorico settimanale"]),
      ),
    };

    const birthDateIso = parseDateToIso(raw.birthDate);
    const theoreticalWeeklyMinutes = parseMinutes(raw.theoreticalRaw);
    const emailSanitized = sanitizeEmails(raw.emailPrimary, raw.emailSecondary);

    if (raw.taxCode) {
      snapshotTaxCodes.add(raw.taxCode);
    }

    const blockingMissing: string[] = [];
    const rowIssues: string[] = [];

    if (!raw.matricola) {
      blockingMissing.push("matricola");
    }

    if (!raw.taxCode) {
      blockingMissing.push("codice fiscale");
    }

    if (!raw.lastName) rowIssues.push("cognome mancante (usato NON_INDICATO)");
    if (!raw.firstName) rowIssues.push("nome mancante (usato NON_INDICATO)");
    if (!birthDateIso) rowIssues.push("data nascita mancante/non valida (usata 1900-01-01)");
    if (!raw.birthPlace) rowIssues.push("luogo nascita mancante (usato NON_INDICATO)");
    if (!raw.site) rowIssues.push("cantiere mancante (usato NON_ASSEGNATO)");
    if (theoreticalWeeklyMinutes === null) {
      rowIssues.push("teorico settimanale mancante/non valido (usato 0)");
    }
    if (emailSanitized.issues.length > 0) {
      rowIssues.push(...emailSanitized.issues);
    }

    if (blockingMissing.length > 0) {
      errors.push(
        mkError(
          rowNumber,
          raw,
          "required_identity_fields",
          `Campi identificativi mancanti: ${blockingMissing.join(", ")}`,
        ),
      );
      return;
    }

    const ensuredBirthDateIso = birthDateIso ?? DEFAULT_BIRTH_DATE;
    const ensuredTheoreticalWeeklyMinutes = theoreticalWeeklyMinutes ?? 0;

    if (seenTaxCodes.has(raw.taxCode)) {
      errors.push(
        mkError(
          rowNumber,
          raw,
          "duplicate_tax_code_file",
          "Codice fiscale duplicato nel file di import.",
        ),
      );
      return;
    }

    if (
      seenTaxCodeByMatricola.has(raw.matricola) &&
      seenTaxCodeByMatricola.get(raw.matricola) !== raw.taxCode
    ) {
      errors.push(
        mkError(
          rowNumber,
          raw,
          "matricola_tax_mismatch_file",
          "Matricola associata a codici fiscali differenti nello stesso file.",
        ),
      );
      return;
    }

    if (rowIssues.length > 0) {
      errors.push(
        mkError(
          rowNumber,
          raw,
          "row_imported_with_issues",
          `Riga importata con segnalazioni: ${rowIssues.join("; ")}`,
        ),
      );
    }

    seenTaxCodes.add(raw.taxCode);
    seenMatricolaByTaxCode.set(raw.taxCode, raw.matricola);
    seenTaxCodeByMatricola.set(raw.matricola, raw.taxCode);

    validRows.push({
      rowNumber,
      matricola: raw.matricola,
      lastName: raw.lastName || DEFAULT_TEXT_VALUE,
      firstName: raw.firstName || DEFAULT_TEXT_VALUE,
      birthDateIso: ensuredBirthDateIso,
      birthPlace: raw.birthPlace || DEFAULT_TEXT_VALUE,
      taxCode: raw.taxCode,
      phone: raw.phone,
      mobile: raw.mobile,
      emailPrimary: emailSanitized.emailPrimary,
      emailSecondary: emailSanitized.emailSecondary,
      referral: raw.referral,
      responsibleCode: raw.responsibleCode || DEFAULT_RESPONSIBLE_CODE,
      jobTitle: raw.jobTitle || DEFAULT_JOB_TITLE,
      jobTitleNotes: raw.jobTitleNotes,
      siteDisplayName: toTitleCase(raw.site || DEFAULT_SITE),
      siteNormalizedName: normalizeSiteName(raw.site || DEFAULT_SITE),
      subSiteDisplayName: raw.subSite ? toTitleCase(raw.subSite) : "",
      subSiteNormalizedName: raw.subSite ? normalizeSiteName(raw.subSite) : "",
      theoreticalWeeklyMinutes: ensuredTheoreticalWeeklyMinutes,
    });
  });

  return {
    validRows,
    errors,
    totalRows: dataRows.length,
    snapshotTaxCodes: Array.from(snapshotTaxCodes),
  };
}

function analyzeAgainstExisting(
  validRows: RawEmployeeRow[],
  existing: ExistingEmployee[],
  snapshotTaxCodes: string[],
) {
  const existingByTaxCode = new Map(existing.map((item) => [item.tax_code, item]));
  const existingByMatricola = new Map(existing.map((item) => [item.matricola, item]));

  const conflictErrors: ImportErrorRow[] = [];
  const filteredValidRows: RawEmployeeRow[] = [];

  let newRows = 0;
  let updatedRows = 0;
  let reactivatedRows = 0;

  for (const row of validRows) {
    const sameTaxCode = existingByTaxCode.get(row.taxCode);
    const sameMatricola = existingByMatricola.get(row.matricola);

    if (sameMatricola && sameMatricola.tax_code !== row.taxCode) {
      conflictErrors.push(
        mkError(
          row.rowNumber,
          row,
          "matricola_tax_mismatch_db",
          "Matricola gia presente su un altro codice fiscale nel database.",
        ),
      );
      continue;
    }

    if (!sameTaxCode) {
      newRows += 1;
    } else if (sameTaxCode.status === "dimesso") {
      reactivatedRows += 1;
    } else {
      updatedRows += 1;
    }

    filteredValidRows.push(row);
  }

  const incomingTaxCodes = new Set(snapshotTaxCodes);
  const dismissedRows = existing.filter(
    (employee) => employee.status === "attivo" && !incomingTaxCodes.has(employee.tax_code),
  ).length;

  return {
    filteredValidRows,
    conflictErrors,
    newRows,
    updatedRows,
    reactivatedRows,
    dismissedRows,
  };
}

async function commitImport(args: {
  supabase: SupabaseClient;
  fileName: string;
  importedBy: string | null;
  validRows: RawEmployeeRow[];
  snapshotTaxCodes: string[];
  errors: ImportErrorRow[];
  existingEmployees: ExistingEmployee[];
  summary: ImportSummary;
}) {
  const {
    supabase,
    fileName,
    importedBy,
    validRows,
    snapshotTaxCodes,
    errors,
    existingEmployees,
  } = args;

  let importRunId: string | null = null;

  const runInsert = await supabase
    .from("import_runs")
    .insert({
      source: "anagrafica",
      file_name: fileName,
      imported_by: importedBy,
      total_rows: args.summary.totalRows,
      processed_rows: validRows.length,
      error_rows: errors.length,
      status: "preview",
    })
    .select("id")
    .single();

  if (!runInsert.error && runInsert.data?.id) {
    importRunId = runInsert.data.id;
  }

  if (importRunId && errors.length > 0) {
    await supabase.from("import_run_errors").insert(
      errors.map((error) => ({
        import_run_id: importRunId,
        row_number: error.rowNumber,
        matricola: error.matricola || null,
        tax_code: error.taxCode || null,
        last_name: error.lastName || null,
        first_name: error.firstName || null,
        error_type: error.errorType,
        error_message: error.errorMessage,
      })),
    );
  }

  const nowIso = new Date().toISOString();

  const siteMap = await ensureSites(supabase, validRows);
  const subSiteMap = await ensureSubSites(supabase, validRows, siteMap);

  const commitErrors: ImportErrorRow[] = [];
  let committedRows = 0;

  for (const row of validRows) {
    const siteId = siteMap.get(row.siteNormalizedName);

    if (!siteId) {
      commitErrors.push(
        mkError(
          row.rowNumber,
          row,
          "site_resolution_error",
          "Impossibile risolvere il cantiere nel database.",
        ),
      );
      continue;
    }

    const subSiteId = row.subSiteNormalizedName
      ? subSiteMap.get(`${siteId}:${row.subSiteNormalizedName}`) ?? null
      : null;

    const { error } = await supabase.from("employees").upsert(
      {
        matricola: row.matricola,
        tax_code: row.taxCode,
        first_name: row.firstName,
        last_name: row.lastName,
        birth_date: row.birthDateIso,
        birth_place: row.birthPlace,
        responsible_code: row.responsibleCode,
        job_title: row.jobTitle,
        job_title_notes: row.jobTitleNotes || null,
        phone: row.phone || null,
        mobile: row.mobile || null,
        email_primary: row.emailPrimary || null,
        email_secondary: row.emailSecondary || null,
        referral: row.referral || null,
        theoretical_weekly_minutes: row.theoreticalWeeklyMinutes,
        site_id: siteId,
        sub_site_id: subSiteId,
        status: "attivo",
        last_imported_at: nowIso,
      },
      { onConflict: "tax_code" },
    );

    if (error) {
      commitErrors.push(
        mkError(
          row.rowNumber,
          row,
          "employee_upsert_error",
          `Errore salvataggio dipendente: ${error.message}`,
        ),
      );
      continue;
    }

    committedRows += 1;
  }

  const importedTaxCodes = new Set(snapshotTaxCodes);
  const toDismiss = existingEmployees
    .filter((employee) => employee.status === "attivo" && !importedTaxCodes.has(employee.tax_code))
    .map((employee) => employee.tax_code);

  for (const chunk of chunkArray(toDismiss, 300)) {
    const { error } = await supabase
      .from("employees")
      .update({ status: "dimesso" })
      .in("tax_code", chunk);
    if (error) {
      commitErrors.push({
        rowNumber: 0,
        matricola: "",
        taxCode: "",
        lastName: "",
        firstName: "",
        errorType: "dismiss_update_error",
        errorMessage: `Errore aggiornamento dimessi: ${error.message}`,
      });
      break;
    }
  }

  if (importRunId) {
    await supabase
      .from("import_runs")
      .update({
        processed_rows: committedRows,
        error_rows: errors.length + commitErrors.length,
        status: commitErrors.length ? "failed" : "completed",
      })
      .eq("id", importRunId);

    if (commitErrors.length > 0) {
      await supabase.from("import_run_errors").insert(
        commitErrors.map((error) => ({
          import_run_id: importRunId,
          row_number: error.rowNumber,
          matricola: error.matricola || null,
          tax_code: error.taxCode || null,
          last_name: error.lastName || null,
          first_name: error.firstName || null,
          error_type: error.errorType,
          error_message: error.errorMessage,
        })),
      );
    }
  }

  return {
    importRunId,
    summary: {
      ...args.summary,
      validRows: committedRows,
      errorRows: args.summary.errorRows + commitErrors.length,
    },
    message:
      commitErrors.length > 0
        ? "Import completato con errori. Controlla il report."
        : "Import completato con successo.",
  };
}

async function fetchExistingEmployees(supabase: SupabaseClient): Promise<ExistingEmployee[]> {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: ExistingEmployee[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employees")
      .select("id,matricola,tax_code,status")
      .range(from, to);

    if (error) {
      throw new Error(`Errore lettura dipendenti: ${error.message}`);
    }

    const rows = (data ?? []) as ExistingEmployee[];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return allRows;
}

async function ensureSites(supabase: SupabaseClient, rows: RawEmployeeRow[]) {
  const uniqueSites = new Map<string, string>();
  rows.forEach((row) => {
    uniqueSites.set(row.siteNormalizedName, row.siteDisplayName);
  });

  const upsertPayload = Array.from(uniqueSites.entries()).map(
    ([normalized_name, display_name]) => ({
      normalized_name,
      display_name,
    }),
  );

  if (upsertPayload.length > 0) {
    const { error } = await supabase
      .from("sites")
      .upsert(upsertPayload, { onConflict: "normalized_name" });
    if (error) {
      throw new Error(`Errore upsert cantieri: ${error.message}`);
    }
  }

  const map = new Map<string, number>();

  for (const chunk of chunkArray(Array.from(uniqueSites.keys()), 300)) {
    const { data, error } = await supabase
      .from("sites")
      .select("id,normalized_name")
      .in("normalized_name", chunk);

    if (error) {
      throw new Error(`Errore lettura cantieri: ${error.message}`);
    }

    (data as SiteRow[]).forEach((site) => map.set(site.normalized_name, site.id));
  }

  return map;
}

async function ensureSubSites(
  supabase: SupabaseClient,
  rows: RawEmployeeRow[],
  siteMap: Map<string, number>,
) {
  const unique = new Map<string, { site_id: number; normalized_name: string; display_name: string }>();

  rows.forEach((row) => {
    if (!row.subSiteNormalizedName) return;
    const siteId = siteMap.get(row.siteNormalizedName);
    if (!siteId) return;
    const key = `${siteId}:${row.subSiteNormalizedName}`;
    unique.set(key, {
      site_id: siteId,
      normalized_name: row.subSiteNormalizedName,
      display_name: row.subSiteDisplayName,
    });
  });

  const payload = Array.from(unique.values());
  if (payload.length > 0) {
    const { error } = await supabase
      .from("sub_sites")
      .upsert(payload, { onConflict: "site_id,normalized_name" });
    if (error) {
      throw new Error(`Errore upsert sottocantieri: ${error.message}`);
    }
  }

  const map = new Map<string, number>();

  for (const item of payload) {
    const { data, error } = await supabase
      .from("sub_sites")
      .select("id,site_id,normalized_name")
      .eq("site_id", item.site_id)
      .eq("normalized_name", item.normalized_name)
      .limit(1);

    if (!error && data && data.length > 0) {
      const row = data[0] as SubSiteRow;
      map.set(`${row.site_id}:${row.normalized_name}`, row.id);
    }
  }

  return map;
}

function mkError(
  rowNumber: number,
  row: Pick<RawEmployeeRow, "matricola" | "taxCode" | "lastName" | "firstName">,
  errorType: string,
  errorMessage: string,
): ImportErrorRow {
  return {
    rowNumber,
    matricola: row.matricola ?? "",
    taxCode: row.taxCode ?? "",
    lastName: row.lastName ?? "",
    firstName: row.firstName ?? "",
    errorType,
    errorMessage,
  };
}

function buildHeaderIndex(headerRow: (string | number | Date)[]) {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(String(cell ?? ""));
    if (normalized) {
      map.set(normalized, index);
    }
  });
  return map;
}

function getByAliases(
  row: (string | number | Date)[],
  headerIndex: Map<string, number>,
  aliases: string[],
) {
  for (const alias of aliases) {
    const index = headerIndex.get(normalizeHeader(alias));
    if (index !== undefined) {
      return row[index];
    }
  }
  return "";
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCell(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSiteName(value: string) {
  return cleanCell(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value: string) {
  const cleaned = cleanCell(value);

  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      const alnum = part.replace(/[^\p{L}\p{N}]/gu, "");
      const isAllCapsWord =
        alnum.length > 0 &&
        alnum === alnum.toUpperCase() &&
        alnum !== alnum.toLowerCase();

      // Preserve acronyms/codes like IREN, SPU, CUP, ASL, etc.
      if (isAllCapsWord) {
        return part.toUpperCase();
      }

      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function parseDateToIso(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const str = cleanCell(value);
  if (!str) return null;

  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return str;

  const dmyMatch = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return `${year}-${month}-${day}`;
  }

  const numeric = Number(str);
  if (!Number.isNaN(numeric) && numeric > 59) {
    const parsed = XLSX.SSF.parse_date_code(numeric);
    if (parsed) {
      const month = String(parsed.m).padStart(2, "0");
      const day = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${month}-${day}`;
    }
  }

  return null;
}

function parseMinutes(value: string) {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEmail(value: string) {
  return value ? value.trim().toLowerCase() : "";
}

function sanitizeEmails(primary: string, secondary: string) {
  const issues: string[] = [];
  const emailPrimary = normalizeEmail(primary);
  const emailSecondary = normalizeEmail(secondary);

  const cleanPrimary =
    emailPrimary && !EMAIL_REGEX.test(emailPrimary)
      ? (issues.push(`email 1 non valida (${emailPrimary})`), "")
      : emailPrimary;

  const cleanSecondary =
    emailSecondary && !EMAIL_REGEX.test(emailSecondary)
      ? (issues.push(`email 2 non valida (${emailSecondary})`), "")
      : emailSecondary;

  return {
    emailPrimary: cleanPrimary,
    emailSecondary: cleanSecondary,
    issues,
  };
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}
