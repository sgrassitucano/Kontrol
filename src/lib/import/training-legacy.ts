import * as XLSX from "xlsx-js-style";
import type { SupabaseClient } from "@supabase/supabase-js";

type LegacyPreviewParams = {
  fileBuffer: ArrayBuffer;
  supabase: SupabaseClient;
};

type EmployeeRow = {
  id: number;
  matricola: string;
  tax_code: string;
  last_name: string;
  first_name: string;
  status?: "attivo" | "dimesso";
};

type CourseRow = {
  id: number;
  code: string;
  title: string;
  validity_years?: number | null;
  is_unlimited?: boolean;
};

type LegacyParsedRow = {
  rowNumber: number;
  matricola: string;
  cognome: string;
  nome: string;
  rawCourseCode: string;
  canonicalCourseCode: string | null;
  note: string;
  effSi: boolean;
  startDate: string | null;
  startYear: number | null;
  legacyExpiryDate: string | null;
  legacyExpiryYear: number | null;
};

type Interpretation =
  | "svolto_illimitato"
  | "da_fare"
  | "da_aggiornare"
  | "valido";

export type LegacyPreviewIssue = {
  rowNumber: number;
  matricola: string;
  cognome: string;
  nome: string;
  rawCourseCode: string;
  canonicalCourseCode: string | null;
  issueType:
    | "missing_employee"
    | "missing_course"
    | "ambiguous_form_spec_note";
  message: string;
};

export type LegacyPreviewCourseStat = {
  courseCode: string;
  courseTitle: string;
  legacyRows: number;
  mappedRows: number;
  missingEmployeeRows: number;
};

export type LegacyMissingEmployee = {
  matricola: string;
  cognome: string;
  nome: string;
  rows: number;
  courses: string[];
};

export type LegacyPreviewSummary = {
  totalRows: number;
  mappedEmployees: number;
  missingEmployees: number;
  mappedCourses: number;
  missingCourses: number;
  svoltoIllimitato: number;
  daFare: number;
  daAggiornare: number;
  validi: number;
};

export type LegacyPreviewResult = {
  summary: LegacyPreviewSummary;
  issues: LegacyPreviewIssue[];
  courseStats: LegacyPreviewCourseStat[];
  missingEmployeesList: LegacyMissingEmployee[];
  message: string;
};

export type LegacyCommitResult = {
  summary: LegacyPreviewSummary & {
    committedRows: number;
    skippedDaFareRows: number;
  };
  message: string;
};

const SENTINEL_UNLIMITED_YEARS = new Set([2069, 2099]);

export async function previewLegacyTrainingImport({
  fileBuffer,
  supabase,
}: LegacyPreviewParams): Promise<LegacyPreviewResult> {
  const parsedRows = parseLegacyWorkbook(fileBuffer);
  const [employees, courses] = await Promise.all([
    fetchAllEmployees(supabase),
    fetchAllCourses(supabase),
  ]);

  const employeeByMatricola = new Map<string, EmployeeRow>();
  for (const row of employees) {
    const key = normalizeMatricola(row.matricola);
    if (!key) continue;
    if (!employeeByMatricola.has(key)) {
      employeeByMatricola.set(key, row);
    }
  }
  const courseByCode = new Map(courses.map((row) => [row.code, row]));

  const aiPsCounts = new Map<string, number>();
  parsedRows.forEach((row) => {
    if (!row.canonicalCourseCode) return;
    if (!isAiOrPsCode(row.canonicalCourseCode)) return;
    const key = `${row.matricola}:${row.canonicalCourseCode}`;
    aiPsCounts.set(key, (aiPsCounts.get(key) ?? 0) + 1);
  });

  const issues: LegacyPreviewIssue[] = [];
  const courseStatsMap = new Map<string, LegacyPreviewCourseStat>();
  const missingEmployeeMap = new Map<string, LegacyMissingEmployee>();

  let mappedEmployees = 0;
  let missingEmployees = 0;
  let mappedCourses = 0;
  let missingCourses = 0;
  let svoltoIllimitato = 0;
  let daFare = 0;
  let daAggiornare = 0;
  let validi = 0;

  const today = new Date();
  const todayIso = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    .toISOString()
    .slice(0, 10);

  for (const row of parsedRows) {
    const employee = employeeByMatricola.get(normalizeMatricola(row.matricola));
    const course = row.canonicalCourseCode
      ? (courseByCode.get(row.canonicalCourseCode) ?? null)
      : null;

    if (employee) {
      mappedEmployees += 1;
    } else {
      missingEmployees += 1;
      const missingKey = normalizeMatricola(row.matricola) || row.matricola;
      const existingMissing = missingEmployeeMap.get(missingKey);
      if (existingMissing) {
        existingMissing.rows += 1;
        const code = row.canonicalCourseCode ?? row.rawCourseCode;
        if (code && !existingMissing.courses.includes(code)) {
          existingMissing.courses.push(code);
        }
      } else {
        missingEmployeeMap.set(missingKey, {
          matricola: row.matricola,
          cognome: row.cognome,
          nome: row.nome,
          rows: 1,
          courses: [row.canonicalCourseCode ?? row.rawCourseCode].filter(Boolean),
        });
      }
      issues.push({
        rowNumber: row.rowNumber,
        matricola: row.matricola,
        cognome: row.cognome,
        nome: row.nome,
        rawCourseCode: row.rawCourseCode,
        canonicalCourseCode: row.canonicalCourseCode,
        issueType: "missing_employee",
        message: "Dipendente non trovato in anagrafica (match su matricola).",
      });
    }

    if (course) {
      mappedCourses += 1;
    } else {
      missingCourses += 1;
      issues.push({
        rowNumber: row.rowNumber,
        matricola: row.matricola,
        cognome: row.cognome,
        nome: row.nome,
        rawCourseCode: row.rawCourseCode,
        canonicalCourseCode: row.canonicalCourseCode,
        issueType: "missing_course",
        message: "Codice corso non mappato nel catalogo training.",
      });
    }

    if (row.rawCourseCode === "FORM_SPEC" && row.canonicalCourseCode === "FORM_SPEC_BASSO") {
      const note = normalizeText(row.note);
      const hasSsl = note.includes("ssl") || note.includes("rischio");
      if (!hasSsl) {
        issues.push({
          rowNumber: row.rowNumber,
          matricola: row.matricola,
          cognome: row.cognome,
          nome: row.nome,
          rawCourseCode: row.rawCourseCode,
          canonicalCourseCode: row.canonicalCourseCode,
          issueType: "ambiguous_form_spec_note",
          message: "FORM_SPEC senza nota SSL chiara: applicato fallback RISCHIO BASSO.",
        });
      }
    }

    const interpretation = interpretRow(row, course, aiPsCounts, todayIso);
    if (interpretation === "svolto_illimitato") svoltoIllimitato += 1;
    if (interpretation === "da_fare") daFare += 1;
    if (interpretation === "da_aggiornare") daAggiornare += 1;
    if (interpretation === "valido") validi += 1;

    const statKey = row.canonicalCourseCode || row.rawCourseCode || "N.D.";
    if (!courseStatsMap.has(statKey)) {
      courseStatsMap.set(statKey, {
        courseCode: statKey,
        courseTitle: course?.title ?? "Corso non mappato",
        legacyRows: 0,
        mappedRows: 0,
        missingEmployeeRows: 0,
      });
    }
    const stat = courseStatsMap.get(statKey);
    if (stat) {
      stat.legacyRows += 1;
      if (employee && course) stat.mappedRows += 1;
      if (!employee) stat.missingEmployeeRows += 1;
    }
  }

  const courseStats = Array.from(courseStatsMap.values()).sort((a, b) => {
    if (b.legacyRows !== a.legacyRows) return b.legacyRows - a.legacyRows;
    return a.courseCode.localeCompare(b.courseCode);
  });
  const missingEmployeesList = Array.from(missingEmployeeMap.values())
    .map((item) => ({
      ...item,
      courses: item.courses.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => {
      if (b.rows !== a.rows) return b.rows - a.rows;
      return a.matricola.localeCompare(b.matricola);
    });

  return {
    summary: {
      totalRows: parsedRows.length,
      mappedEmployees,
      missingEmployees,
      mappedCourses,
      missingCourses,
      svoltoIllimitato,
      daFare,
      daAggiornare,
      validi,
    },
    issues: issues.slice(0, 1000),
    courseStats: courseStats.slice(0, 200),
    missingEmployeesList: missingEmployeesList.slice(0, 2000),
    message: "Preview legacy completata.",
  };
}

export async function commitLegacyTrainingImport({
  fileBuffer,
  supabase,
}: LegacyPreviewParams): Promise<LegacyCommitResult> {
  const preview = await previewLegacyTrainingImport({ fileBuffer, supabase });
  const parsedRows = parseLegacyWorkbook(fileBuffer);
  const [employees, courses] = await Promise.all([
    fetchAllEmployees(supabase),
    fetchAllCourses(supabase),
  ]);

  const activeEmployees = employees.filter((employee) => employee.status !== "dimesso");
  const employeeByMatricola = new Map<string, EmployeeRow>();
  for (const row of activeEmployees) {
    const key = normalizeMatricola(row.matricola);
    if (!key) continue;
    if (!employeeByMatricola.has(key)) {
      employeeByMatricola.set(key, row);
    }
  }

  const courseByCode = new Map(courses.map((row) => [row.code, row]));

  const aiPsCounts = new Map<string, number>();
  parsedRows.forEach((row) => {
    if (!row.canonicalCourseCode) return;
    if (!isAiOrPsCode(row.canonicalCourseCode)) return;
    const key = `${row.matricola}:${row.canonicalCourseCode}`;
    aiPsCounts.set(key, (aiPsCounts.get(key) ?? 0) + 1);
  });

  const today = new Date();
  const todayIso = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    .toISOString()
    .slice(0, 10);

  type SelectedRow = {
    row: LegacyParsedRow;
    interpretation: Interpretation;
    employeeId: number;
    course: CourseRow;
  };
  const selectedByKey = new Map<string, SelectedRow>();

  for (const row of parsedRows) {
    const employee = employeeByMatricola.get(normalizeMatricola(row.matricola));
    const course = row.canonicalCourseCode
      ? (courseByCode.get(row.canonicalCourseCode) ?? null)
      : null;
    if (!employee || !course) continue;

    const interpretation = interpretRow(row, course, aiPsCounts, todayIso);
    const key = `${employee.id}:${course.id}`;
    const current = selectedByKey.get(key);
    if (!current) {
      selectedByKey.set(key, { row, interpretation, employeeId: employee.id, course });
      continue;
    }

    const currentDate = current.row.startDate ?? "";
    const candidateDate = row.startDate ?? "";
    if (candidateDate > currentDate) {
      selectedByKey.set(key, { row, interpretation, employeeId: employee.id, course });
      continue;
    }
    if (candidateDate === currentDate && row.rowNumber > current.row.rowNumber) {
      selectedByKey.set(key, { row, interpretation, employeeId: employee.id, course });
    }
  }

  const payload: Array<{
    employee_id: number;
    course_id: number;
    completion_date: string | null;
    expiry_date: string | null;
    planned_date: string | null;
    note: string | null;
  }> = [];
  let skippedDaFareRows = 0;

  const { error: clearNotesError } = await supabase
    .from("training_employee_courses")
    .update({ note: null })
    .not("note", "is", null);
  if (clearNotesError) {
    throw new Error(`Errore azzeramento note: ${clearNotesError.message}`);
  }

  const { error: clearEmptyNotesError } = await supabase
    .from("training_employee_courses")
    .update({ note: null })
    .eq("note", "");
  if (clearEmptyNotesError) {
    throw new Error(`Errore azzeramento note vuote: ${clearEmptyNotesError.message}`);
  }

  for (const item of selectedByKey.values()) {
    const { interpretation, row, employeeId, course } = item;
    if (interpretation === "da_fare") {
      skippedDaFareRows += 1;
      continue;
    }

    if (interpretation === "svolto_illimitato") {
      payload.push({
        employee_id: employeeId,
        course_id: course.id,
        completion_date: row.startDate ?? todayIso,
        expiry_date: null,
        planned_date: null,
        note: null,
      });
      continue;
    }

    const completionDate = row.startDate ?? todayIso;
    const expiryDate = computeTheoreticalExpiryDate(completionDate, course);
    payload.push({
      employee_id: employeeId,
      course_id: course.id,
      completion_date: completionDate,
      expiry_date: expiryDate,
      planned_date: null,
      note: null,
    });
  }

  for (const chunk of chunkArray(payload, 500)) {
    const { error } = await supabase
      .from("training_employee_courses")
      .upsert(chunk, { onConflict: "employee_id,course_id" });
    if (error) {
      throw new Error(`Errore commit training_employee_courses: ${error.message}`);
    }
  }

  return {
    summary: {
      ...preview.summary,
      committedRows: payload.length,
      skippedDaFareRows,
    },
    message: "Commit legacy completato (solo dipendenti in anagrafica attiva).",
  };
}

function parseLegacyWorkbook(fileBuffer: ArrayBuffer) {
  const workbook = XLSX.read(Buffer.from(fileBuffer), {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
  if (rows.length === 0) return [];

  const headerInfo = detectHeaderRow(rows);
  if (!headerInfo) return [];
  const { rowIndex, index } = headerInfo;

  const parsed: LegacyParsedRow[] = [];
  for (let i = rowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const matricola = cleanCell(row[index.dip]);
    const rawCourseCode = cleanCell(row[index.scadenza]).toUpperCase();
    if (!matricola || !rawCourseCode) continue;

    const cognome = cleanCell(row[index.cognome]);
    const nome = cleanCell(row[index.nome]);
    const note = cleanCell(row[index.note]);
    const effVal = normalizeText(cleanCell(row[index.eff]));
    const effSi = effVal === "si" || effVal === "s";
    const startDate = parseDateToIso(row[index.inizioScadenza]);
    const startYear = startDate ? Number(startDate.slice(0, 4)) : null;
    const legacyExpiryDate = parseDateToIso(row[index.dataScadenza]);
    const legacyExpiryYear = legacyExpiryDate ? Number(legacyExpiryDate.slice(0, 4)) : null;
    const canonicalCourseCode = canonicalizeCourseCode(rawCourseCode, note);

    parsed.push({
      rowNumber: i + 1,
      matricola,
      cognome,
      nome,
      rawCourseCode,
      canonicalCourseCode,
      note,
      effSi,
      startDate,
      startYear,
      legacyExpiryDate,
      legacyExpiryYear,
    });
  }

  return parsed;
}

function detectHeaderRow(rows: (string | number | Date)[][]) {
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const cells = rows[i].map((cell) => normalizeText(String(cell ?? "")));
    const dip = cells.findIndex((v) => v === "dip." || v === "dip");
    const cognome = cells.findIndex((v) => v === "cognome");
    const nome = cells.findIndex((v) => v === "nome");
    const scadenza = cells.findIndex((v) => v === "scadenza");
    const inizioScadenza = cells.findIndex((v) => v === "inizio scadenza");
    const eff = cells.findIndex((v) => v === "eff.");
    const note = cells.findIndex((v) => v === "note");
    const dataScadenza = cells.findIndex((v) => v === "data scadenza");
    if (
      dip >= 0 &&
      scadenza >= 0 &&
      inizioScadenza >= 0 &&
      eff >= 0 &&
      note >= 0 &&
      dataScadenza >= 0
    ) {
      return {
        rowIndex: i,
        index: { dip, cognome, nome, scadenza, inizioScadenza, eff, note, dataScadenza },
      };
    }
  }
  return null;
}

function interpretRow(
  row: LegacyParsedRow,
  course: CourseRow | null,
  aiPsCounts: Map<string, number>,
  todayIso: string,
): Interpretation {
  const isAiPs = row.canonicalCourseCode ? isAiOrPsCode(row.canonicalCourseCode) : false;
  const aiPsKey = `${row.matricola}:${row.canonicalCourseCode ?? ""}`;
  const isUniqueAiPsRow = isAiPs && (aiPsCounts.get(aiPsKey) ?? 0) <= 1;
  const effectiveEffSi = row.effSi && !isUniqueAiPsRow;

  if (effectiveEffSi) {
    return "svolto_illimitato";
  }

  if (
    (row.startYear !== null && SENTINEL_UNLIMITED_YEARS.has(row.startYear)) ||
    (row.legacyExpiryYear !== null && SENTINEL_UNLIMITED_YEARS.has(row.legacyExpiryYear))
  ) {
    return "svolto_illimitato";
  }

  if (row.startYear !== null && row.startYear < 2011) {
    return "da_fare";
  }

  if (!row.startDate) {
    return "da_fare";
  }

  const theoreticalExpiry = course ? computeTheoreticalExpiryDate(row.startDate, course) : null;
  if (theoreticalExpiry && theoreticalExpiry < todayIso) {
    return "da_aggiornare";
  }

  return "valido";
}

function isAiOrPsCode(code: string) {
  return code.startsWith("CORSO_AI_") || code === "CORSO_PS";
}

function canonicalizeCourseCode(rawCode: string, note: string) {
  if (rawCode !== "FORM_SPEC") return rawCode;
  const normalizedNote = normalizeText(note);
  if (normalizedNote.includes("alto")) return "FORM_SPEC_ALTO";
  if (normalizedNote.includes("medio")) return "FORM_SPEC_MEDIO";
  return "FORM_SPEC_BASSO";
}

async function fetchAllEmployees(supabase: SupabaseClient): Promise<EmployeeRow[]> {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: EmployeeRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employees")
      .select("id,matricola,tax_code,last_name,first_name,status")
      .range(from, to);
    if (error) {
      throw new Error(`Errore lettura dipendenti: ${error.message}`);
    }
    const rows = (data ?? []) as EmployeeRow[];
    allRows.push(...rows);
    if (rows.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return allRows;
}

async function fetchAllCourses(supabase: SupabaseClient): Promise<CourseRow[]> {
  const { data, error } = await supabase
    .from("training_courses")
    .select("id,code,title,validity_years,is_unlimited")
    .eq("is_active", true)
    .order("code");
  if (error) {
    throw new Error(`Errore lettura corsi: ${error.message}`);
  }
  return (data ?? []) as CourseRow[];
}

function computeTheoreticalExpiryDate(startDateIso: string, course: CourseRow) {
  if (course.is_unlimited) return null;
  const years = course.validity_years;
  if (!years) return null;
  const base = new Date(`${startDateIso}T00:00:00.000Z`);
  const next = new Date(Date.UTC(base.getUTCFullYear() + years, base.getUTCMonth(), base.getUTCDate()));
  return next.toISOString().slice(0, 10);
}

function cleanCell(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMatricola(value: string) {
  const cleaned = cleanCell(value);
  if (!cleaned) return "";
  const stripped = cleaned.replace(/^0+/, "");
  return stripped || "0";
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}
