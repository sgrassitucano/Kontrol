import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx-js-style";
import { createClient } from "@supabase/supabase-js";

type InputRow = {
  rowNumber: number;
  lastName: string;
  firstName: string;
  taxCode: string;
  courseLabel: string;
  rawState: string;
  note: string;
};

type ManualState = "programmato" | "escluso";

async function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const content = await readFile(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "'");
}

function normalizeTaxCode(value: string) {
  return value.trim().toUpperCase();
}

function parseWorkbook(fileBuffer: ArrayBuffer): InputRow[] {
  const workbook = XLSX.read(Buffer.from(fileBuffer), {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  const out: InputRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const lastName = String(r[0] ?? "").trim();
    const firstName = String(r[1] ?? "").trim();
    const taxCode = normalizeTaxCode(String(r[2] ?? ""));
    const courseLabel = String(r[3] ?? "").trim();
    const rawState = String(r[4] ?? "").trim();
    const note = String(r[5] ?? "").trim();
    if (!taxCode || !courseLabel || !rawState) continue;
    out.push({ rowNumber: i + 1, lastName, firstName, taxCode, courseLabel, rawState, note });
  }
  return out;
}

function mapManualState(raw: string): ManualState | null {
  const v = normalizeText(raw);
  if (v === "programmato") return "programmato";
  if (v === "escluso manualmente") return "escluso";
  return null;
}

function mapCourseLabelToCodes(label: string): string[] | null {
  const v = normalizeText(label);
  if (v === "generale") return ["FORM_BASE"];

  const matchBundle = v.match(/^generale \+ specifica rischio (basso|medio|alto)$/);
  if (matchBundle) {
    const risk = matchBundle[1];
    if (risk === "basso") return ["FORM_BASE", "FORM_SPEC_BASSO"];
    if (risk === "medio") return ["FORM_BASE", "FORM_SPEC_MEDIO"];
    if (risk === "alto") return ["FORM_BASE", "FORM_SPEC_ALTO"];
  }

  const matchSolo = v.match(/^solo specifica rischio (basso|medio|alto)$/);
  if (matchSolo) {
    const risk = matchSolo[1];
    if (risk === "basso") return ["FORM_SPEC_BASSO"];
    if (risk === "medio") return ["FORM_SPEC_MEDIO"];
    if (risk === "alto") return ["FORM_SPEC_ALTO"];
  }

  if (v === "specifica medio" || v === "spec. r. medio") return ["FORM_SPEC_MEDIO"];
  if (v === "spec. r. basso" || v === "specifica basso") return ["FORM_SPEC_BASSO"];
  if (v === "spec. r. alto" || v === "specifica alto") return ["FORM_SPEC_ALTO"];

  if (v === "antincendio liv. ii") return ["CORSO_AI_2"];
  if (v === "antincendio liv. iii") return ["CORSO_AI_3"];
  if (v === "antincendio liv. i") return ["CORSO_AI_1"];
  if (v === "preposto") return ["CORSO_PREP"];
  if (v === "formazione lavori in quota e dpi anticad") return ["CORSO_QUOTA_DPI"];

  return null;
}

async function main() {
  await loadLocalEnv();

  const filePathArg = process.argv.find((v) => v.toLowerCase().endsWith(".xlsx")) ?? null;
  if (!filePathArg) {
    throw new Error("Passa il percorso del file xlsx come argomento.");
  }

  const dryRun = process.argv.includes("--dry-run");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error("Missing Supabase env vars.");
  }

  const fileBuffer = await readFile(filePathArg);
  const inputRows = parseWorkbook(
    fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength),
  );

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const taxCodes = Array.from(new Set(inputRows.map((r) => r.taxCode)));
  const employeesByTaxCode = new Map<string, number>();
  for (let i = 0; i < taxCodes.length; i += 500) {
    const chunk = taxCodes.slice(i, i + 500);
    const { data, error } = await supabase
      .from("employees")
      .select("id,tax_code")
      .in("tax_code", chunk);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      employeesByTaxCode.set(String(r.tax_code).toUpperCase(), Number(r.id));
    }
  }

  const { data: courses, error: coursesError } = await supabase
    .from("training_courses")
    .select("id,code,title");
  if (coursesError) throw new Error(coursesError.message);
  const coursesByCode = new Map<string, number>();
  const coursesByNormalizedTitle = new Map<string, { id: number; code: string; title: string }[]>();
  for (const c of courses ?? []) {
    const id = Number(c.id);
    const code = String(c.code);
    const title = String(c.title ?? "");
    coursesByCode.set(code, id);
    const key = normalizeText(title);
    const list = coursesByNormalizedTitle.get(key) ?? [];
    list.push({ id, code, title });
    coursesByNormalizedTitle.set(key, list);
  }

  const updates: Array<{ employee_id: number; course_id: number; manual_state: ManualState; note: string | null }> = [];
  const errors: Array<{ rowNumber: number; taxCode: string; courseLabel: string; error: string }> = [];

  for (const r of inputRows) {
    const employeeId = employeesByTaxCode.get(r.taxCode) ?? null;
    if (!employeeId) {
      errors.push({ rowNumber: r.rowNumber, taxCode: r.taxCode, courseLabel: r.courseLabel, error: "Dipendente non trovato per CF." });
      continue;
    }

    const manualState = mapManualState(r.rawState);
    if (!manualState) {
      errors.push({ rowNumber: r.rowNumber, taxCode: r.taxCode, courseLabel: r.courseLabel, error: `Stato non riconosciuto: ${r.rawState}` });
      continue;
    }

    const mappedCodes = mapCourseLabelToCodes(r.courseLabel);
    if (mappedCodes) {
      let ok = true;
      for (const code of mappedCodes) {
        const courseId = coursesByCode.get(code) ?? null;
        if (!courseId) {
          ok = false;
          errors.push({ rowNumber: r.rowNumber, taxCode: r.taxCode, courseLabel: r.courseLabel, error: `Corso non trovato per code: ${code}` });
          continue;
        }
        updates.push({ employee_id: employeeId, course_id: courseId, manual_state: manualState, note: r.note || null });
      }
      if (!ok) continue;
      continue;
    }

    const normalizedLabel = normalizeText(r.courseLabel);
    const byTitle = coursesByNormalizedTitle.get(normalizedLabel) ?? [];
    if (byTitle.length !== 1) {
      errors.push({
        rowNumber: r.rowNumber,
        taxCode: r.taxCode,
        courseLabel: r.courseLabel,
        error: byTitle.length === 0 ? "Corso non trovato per titolo." : "Corso ambiguo per titolo (più match).",
      });
      continue;
    }
    updates.push({ employee_id: employeeId, course_id: byTitle[0].id, manual_state: manualState, note: r.note || null });
  }

  const uniqueKey = new Set<string>();
  const deduped = updates.filter((u) => {
    const k = `${u.employee_id}:${u.course_id}`;
    if (uniqueKey.has(k)) return false;
    uniqueKey.add(k);
    return true;
  });

  if (!dryRun && deduped.length > 0) {
    for (let i = 0; i < deduped.length; i += 500) {
      const chunk = deduped.slice(i, i + 500);
      const { error } = await supabase
        .from("training_employee_courses")
        .upsert(chunk, { onConflict: "employee_id,course_id" });
      if (error) throw new Error(error.message);
    }
  }

  const summary = {
    file: filePathArg,
    dryRun,
    inputRows: inputRows.length,
    distinctTaxCodes: taxCodes.length,
    resolvedEmployees: employeesByTaxCode.size,
    updates: updates.length,
    dedupedUpdates: deduped.length,
    errors: errors.length,
  };

  const publicErrors = errors.slice(0, 200).map((e) => ({
    rowNumber: e.rowNumber,
    courseLabel: e.courseLabel,
    error: e.error,
  }));
  console.log(JSON.stringify({ summary, errors: publicErrors }, null, 2));
  if (errors.length > 0) {
    process.exitCode = 2;
  }
}

void main();
