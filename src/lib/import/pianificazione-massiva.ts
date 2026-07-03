import * as XLSX from "xlsx-js-style";
import type { SupabaseClient } from "@supabase/supabase-js";

// Import massivo "programmato" round-trip: riusa lo stesso file prodotto da
// /api/formazione/export. L'utente marca stato="programmato" + "data prevista"
// su alcune righe e ricarica lo stesso file. Nessuna colonna nuova richiesta.
//
// Risoluzione corso per riga:
// - Foglio BASE: "data esecuzione" vuota -> mai fatto -> programma FORM_BASE + FORM_SPEC_<risk>.
//                "data esecuzione" compilata -> rinnovo -> programma solo FORM_SPEC_AGGIORNAMENTO.
// - Foglio preposto/dirigenti: stesso principio (originale vs "<CODICE>_AGGIORNAMENTO").
// - Foglio muletto/primo soccorso/antincendio/altri operativi: il testo "tipo corso" già
//   porta il prefisso "aggiornamento " quando la riga è un rinnovo (vedi export/route.ts
//   shouldLabelAsAggiornamento) — usato per capire quale corso puntare.

export type PianificazioneImportRow = {
  sheet: string;
  rowNumber: number;
  matricola: string;
  cognome: string;
  nome: string;
  tipoCorso: string;
  dataPrevista: string;
  hasDataEsecuzione: boolean;
};

export type PianificazioneResolvedRow = {
  sheet: string;
  rowNumber: number;
  matricola: string;
  employeeName: string;
  employeeId: number | null;
  targetCourseCodes: string[];
  plannedDateIso: string | null;
  warnings: string[];
};

const RISK_LEVELS = ["alto", "medio", "basso"] as const;

function parseItDateToIso(value: string): string | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const dd = match[1].padStart(2, "0");
  const mm = match[2].padStart(2, "0");
  const yyyy = match[3];
  return `${yyyy}-${mm}-${dd}`;
}

function resolveBaseSheetCourses(tipoCorso: string, hasDataEsecuzione: boolean): string[] | null {
  const text = tipoCorso.trim().toLowerCase();

  if (hasDataEsecuzione) {
    // Rinnovo: solo l'aggiornamento della specifica (unico per tutti i livelli di rischio).
    return ["FORM_SPEC_AGGIORNAMENTO"];
  }

  if (text === "formazione generale") return ["FORM_BASE"];

  const riskMatch = RISK_LEVELS.find((risk) => text.includes(`rischio ${risk}`));
  if (!riskMatch) return null;
  const specCode = `FORM_SPEC_${riskMatch.toUpperCase()}`;

  if (text.startsWith("generale + specifica") || text.startsWith("generale+specifica")) {
    return ["FORM_BASE", specCode];
  }
  if (text.startsWith("solo specifica")) {
    return [specCode];
  }
  return null;
}

function resolveFixedSheetCourse(baseCode: string, hasDataEsecuzione: boolean): string[] {
  return [hasDataEsecuzione ? `${baseCode}_AGGIORNAMENTO` : baseCode];
}

function resolveAntincendioCourse(tipoCorso: string): string[] | null {
  const text = tipoCorso.trim().toLowerCase();
  const isAggiornamento = text.startsWith("aggiornamento ");
  const romanMatch = text.match(/liv\.\s*(i{1,3})\b/);
  if (!romanMatch) return null;
  const level = romanMatch[1] === "i" ? "1" : romanMatch[1] === "ii" ? "2" : romanMatch[1] === "iii" ? "3" : null;
  if (!level) return null;
  const code = `CORSO_AI_${level}`;
  return [isAggiornamento ? `${code}_AGGIORNAMENTO` : code];
}

/**
 * Risolve i codici corso per "altri operativi": il testo è il titolo del corso
 * (eventualmente prefissato "aggiornamento "), va matchato contro training_courses.title.
 */
function resolveAltriOperativiCourse(
  tipoCorso: string,
  titleToCode: Map<string, string>,
): string[] | null {
  const text = tipoCorso.trim();
  const isAggiornamento = text.toLowerCase().startsWith("aggiornamento ");
  const baseTitle = (isAggiornamento ? text.slice("aggiornamento ".length) : text).trim().toLowerCase();
  const code = titleToCode.get(baseTitle);
  if (!code) return null;
  return [isAggiornamento ? `${code}_AGGIORNAMENTO` : code];
}

function resolveCoursesForRow(
  sheet: string,
  tipoCorso: string,
  hasDataEsecuzione: boolean,
  titleToCode: Map<string, string>,
): string[] | null {
  const sheetLower = sheet.trim().toLowerCase();
  if (sheetLower === "base") return resolveBaseSheetCourses(tipoCorso, hasDataEsecuzione);
  if (sheetLower === "preposto") return resolveFixedSheetCourse("CORSO_PREP", hasDataEsecuzione);
  if (sheetLower === "dirigenti") return resolveFixedSheetCourse("CORSO_DIR", hasDataEsecuzione);
  if (sheetLower === "muletto") return resolveFixedSheetCourse("CORSO_MUL", hasDataEsecuzione);
  if (sheetLower === "primo soccorso") return resolveFixedSheetCourse("CORSO_PS", hasDataEsecuzione);
  if (sheetLower === "antincendio") return resolveAntincendioCourse(tipoCorso);
  if (sheetLower === "altri operativi") return resolveAltriOperativiCourse(tipoCorso, titleToCode);
  return null;
}

/**
 * Estrae dal workbook (formato export) tutte le righe marcate stato="programmato"
 * con "data prevista" compilata, su tutti i fogli. Porta anche il segnale
 * "data esecuzione compilata", necessario per distinguere corso originale da aggiornamento.
 */
export function extractProgrammatoRows(fileBuffer: ArrayBuffer): PianificazioneImportRow[] {
  const workbook = XLSX.read(Buffer.from(fileBuffer), { type: "buffer", cellDates: false, raw: false });
  const out: PianificazioneImportRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false });

    rows.forEach((row, idx) => {
      const stato = String(row["stato"] ?? "").trim().toLowerCase();
      const dataPrevista = String(row["data prevista"] ?? "").trim();
      if (stato !== "programmato" || !dataPrevista) return;

      out.push({
        sheet: sheetName,
        rowNumber: idx + 2, // +1 header, +1 1-based
        matricola: String(row["matricola"] ?? "").trim(),
        cognome: String(row["cognome"] ?? "").trim(),
        nome: String(row["nome"] ?? "").trim(),
        tipoCorso: String(row["tipo corso"] ?? "").trim(),
        dataPrevista,
        hasDataEsecuzione: String(row["data esecuzione"] ?? "").trim().length > 0,
      });
    });
  }

  return out;
}

/**
 * Risolve dipendente + corso per ogni riga estratta. Richiede accesso DB per
 * matricola->employee_id e per il match titolo->codice di "altri operativi".
 */
export async function resolveProgrammatoRows(
  supabase: SupabaseClient,
  rawRows: PianificazioneImportRow[],
): Promise<PianificazioneResolvedRow[]> {
  if (rawRows.length === 0) return [];

  const matricole = Array.from(new Set(rawRows.map((r) => r.matricola).filter(Boolean)));
  const { data: employees } = await supabase
    .from("employees")
    .select("id, matricola, first_name, last_name")
    .in("matricola", matricole);

  const employeeByMatricola = new Map(
    (employees ?? []).map((e) => [String(e.matricola).trim(), e as { id: number; first_name: string; last_name: string }]),
  );

  const { data: courses } = await supabase.from("training_courses").select("code, title");
  const titleToCode = new Map(
    (courses ?? [])
      .filter((c) => !String(c.code).endsWith("_AGGIORNAMENTO"))
      .map((c) => [String(c.title).trim().toLowerCase(), String(c.code)]),
  );

  return rawRows.map((row) => {
    const warnings: string[] = [];
    const employee = row.matricola ? employeeByMatricola.get(row.matricola) : undefined;
    if (!employee) warnings.push(`Matricola "${row.matricola}" non trovata.`);

    const plannedDateIso = parseItDateToIso(row.dataPrevista);
    if (!plannedDateIso) warnings.push(`Data prevista "${row.dataPrevista}" non valida (attesa gg/mm/aaaa).`);

    const targetCourseCodes = resolveCoursesForRow(row.sheet, row.tipoCorso, row.hasDataEsecuzione, titleToCode);
    if (!targetCourseCodes || targetCourseCodes.length === 0) {
      warnings.push(`Corso non riconosciuto per foglio "${row.sheet}" / tipo corso "${row.tipoCorso}".`);
    }

    return {
      sheet: row.sheet,
      rowNumber: row.rowNumber,
      matricola: row.matricola,
      employeeName: employee ? `${employee.last_name} ${employee.first_name}` : `${row.cognome} ${row.nome}`,
      employeeId: employee?.id ?? null,
      targetCourseCodes: targetCourseCodes ?? [],
      plannedDateIso,
      warnings,
    };
  });
}

/**
 * Applica le righe risolte (senza warning bloccanti) al DB: upsert planned_date +
 * manual_state='programmato' per ciascun (employee_id, course_id) target.
 */
export async function commitProgrammatoRows(
  supabase: SupabaseClient,
  resolvedRows: PianificazioneResolvedRow[],
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;

  const { data: courses } = await supabase.from("training_courses").select("id, code");
  const codeToId = new Map((courses ?? []).map((c) => [String(c.code), c.id as number]));

  for (const row of resolvedRows) {
    if (row.warnings.length > 0 || !row.employeeId || !row.plannedDateIso || row.targetCourseCodes.length === 0) {
      skipped += 1;
      continue;
    }

    for (const code of row.targetCourseCodes) {
      const courseId = codeToId.get(code);
      if (!courseId) {
        skipped += 1;
        continue;
      }
      const { error } = await supabase
        .from("training_employee_courses")
        .upsert(
          {
            employee_id: row.employeeId,
            course_id: courseId,
            planned_date: row.plannedDateIso,
            manual_state: "programmato",
          },
          { onConflict: "employee_id,course_id" },
        );
      if (error) {
        skipped += 1;
        continue;
      }
      applied += 1;
    }
  }

  return { applied, skipped };
}
