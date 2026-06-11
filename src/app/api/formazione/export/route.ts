import { NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { applyCalibri10WithBoldHeader } from "@/lib/excel";
import { buildJobVariantKey, normalizeJobCode } from "@/lib/training/normalize";
import { requireModuleAccess } from "@/lib/api/access";
import { isoToItDate } from "@/lib/it-date";
import type { SupabaseClient } from "@supabase/supabase-js";
type XlsxWriteOptionsWithStyles = XLSX.WritingOptions & { cellStyles?: boolean };

type EmployeeRow = {
  id: number;
  matricola: string;
  tax_code: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  birth_place: string;
  birth_province: string | null;
  sex: string | null;
  residence_address: string | null;
  residence_postal_code: string | null;
  residence_city: string | null;
  residence_province: string | null;
  mobile: string | null;
  email_primary: string | null;
  responsible_code: string;
  referral: string | null;
  site_id: number | null;
  sub_site_id: number | null;
  job_title: string;
  job_title_notes: string | null;
  sites: unknown;
  sub_sites: unknown;
};

type MatrixRule = {
  scope_type: "baseline" | "job" | "site" | "sub_site" | "employee_override";
  course_id: number;
  job_code_norm: string | null;
  site_id: number | null;
  sub_site_id: number | null;
  employee_id: number | null;
};

type CourseStatusRow = {
  employee_id: number;
  course_id: number;
  completion_date: string | null;
  expiry_date: string | null;
  planned_date: string | null;
  manual_state: "programmato" | "escluso" | null;
  note: string | null;
};

type CourseRow = {
  id: number;
  code: string;
  title: string;
  is_active: boolean;
  validity_years: number | null;
  is_unlimited: boolean;
};

type FreezeRow = {
  employee_id: number;
  freeze_status: string;
  start_date: string;
  end_date: string | null;
};

type ScopeExclusionRow = {
  scope_type: "site" | "sub_site";
  site_id: number | null;
  sub_site_id: number | null;
  is_active: boolean;
};

type TrainingEmployeeExclusionRow = {
  employee_id: number;
  is_active: boolean;
};

type TrainingEmployeeCourseExclusionRow = {
  employee_id: number;
  course_id: number;
  is_active: boolean;
};

type RuleLinkRow = {
  from_course_id: number;
  to_course_id: number;
  relation_type: "substitutes" | "exempts" | "prerequisite";
};

type WorkerCourseRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  corsoCode: string;
  corso: string;
  dataConclusione: string | null;
  dataScadenza: string | null;
  dataPrevista: string | null;
  stato:
    | "idoneo"
    | "in scadenza"
    | "scaduto"
    | "perso"
    | "da fare"
    | "sospeso"
    | "programmato"
    | "upgrade"
    | "escluso";
  upgradeInfo: string | null;
  responsabile: string;
  referente: string;
  note: string;
  origine: "obbligatorio" | "aggiuntivo";
};

export const runtime = "nodejs";

const MAX_EXPORT_EMPLOYEES = 20000;
const MAX_EXPORT_RULES = 50000;
const MAX_EXPORT_COURSES = 20000;
const MAX_EXPORT_COURSE_ROWS = 200000;
const MAX_EXPORT_FREEZES = 50000;
const MAX_EXPORT_RULE_LINKS = 100000;
const MAX_EXPORT_SCOPE_EXCLUSIONS = 100000;
const MAX_EXPORT_EMPLOYEE_EXCLUSIONS = 100000;
const MAX_EXPORT_COURSE_EXCLUSIONS = 200000;
const MAX_EXPORT_OUTPUT_ROWS = 200000;

class TooManyRowsError extends Error {
  status = 400;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("formazione", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const expiringDays = Number(url.searchParams.get("expiringDays") ?? "30");
    const dateParam = url.searchParams.get("date");
    const includeExcluded = true;

    const todayIso =
      typeof dateParam === "string" && normalizeDateOnlyIso(dateParam) ? normalizeDateOnlyIso(dateParam)! : todayLocalIso();
    const expiringDaysSafeRaw = Number.isFinite(expiringDays) ? expiringDays : 30;
    const expiringDaysSafe = Math.min(Math.max(expiringDaysSafeRaw, 0), 365);

    const baseCodes = new Set([
      "FORM_BASE",
      "FORM_SPEC_BASSO",
      "FORM_SPEC_MEDIO",
      "FORM_SPEC_ALTO",
      "CORSO_RLS",
      "CORSO_RSPP",
      "CORSO_DIR",
      "CORSO_ASPP",
    ]);

    const isBaseCode = (code: string) => baseCodes.has(code) || code.startsWith("FORM_BASE+");

    const dataSupabase = auth.supabase;

    const [
      employees,
      courses,
      rules,
      courseRows,
      freezes,
      ruleLinks,
      scopeExclusions,
      employeeExclusions,
      courseExclusions,
    ] = await Promise.all([
      fetchAllEmployees(dataSupabase),
      fetchAllCourses(dataSupabase),
      fetchAllRules(dataSupabase),
      fetchAllCourseRows(dataSupabase),
      fetchAllFreezes(dataSupabase),
      fetchAllRuleLinks(dataSupabase),
      fetchAllScopeExclusions(dataSupabase),
      fetchAllTrainingEmployeeExclusions(dataSupabase),
      fetchAllTrainingEmployeeCourseExclusions(dataSupabase),
    ]);

    const excludedSiteIds = new Set<number>();
    const excludedSubSiteIds = new Set<number>();
    ((scopeExclusions ?? []) as ScopeExclusionRow[]).forEach((row) => {
      if (!row.is_active) return;
      if (row.scope_type === "site" && typeof row.site_id === "number") excludedSiteIds.add(row.site_id);
      if (row.scope_type === "sub_site" && typeof row.sub_site_id === "number") excludedSubSiteIds.add(row.sub_site_id);
    });

    const excludedEmployeeIds = new Set<number>();
    (employeeExclusions ?? []).forEach((row) => {
      const r = row as TrainingEmployeeExclusionRow;
      if (!r.is_active) return;
      excludedEmployeeIds.add(r.employee_id);
    });

    const excludedCourseIdsByEmployee = new Map<number, Set<number>>();
    (courseExclusions ?? []).forEach((row) => {
      const r = row as TrainingEmployeeCourseExclusionRow;
      if (!r.is_active) return;
      const set = excludedCourseIdsByEmployee.get(r.employee_id);
      if (!set) excludedCourseIdsByEmployee.set(r.employee_id, new Set([r.course_id]));
      else set.add(r.course_id);
    });

    const shouldExcludeEmployee = (employee: EmployeeRow) => {
      if (includeExcluded) return false;
      if (excludedEmployeeIds.has(employee.id)) return true;
      if (typeof employee.sub_site_id === "number" && excludedSubSiteIds.has(employee.sub_site_id)) return true;
      if (typeof employee.site_id === "number" && excludedSiteIds.has(employee.site_id)) return true;
      return false;
    };

    const activeFreeze = buildActiveFreezeMap((freezes ?? []) as FreezeRow[], todayIso);
    const courseMap = new Map(((courses ?? []) as CourseRow[]).map((course) => [course.id, course]));
    const statusRows = (courseRows ?? []) as CourseStatusRow[];
    const statusMap = new Map(statusRows.map((row) => [`${row.employee_id}:${row.course_id}`, row]));
    const statusByEmployee = buildStatusByEmployeeMap(statusRows);
    const rulesByScope = groupRulesByScope((rules ?? []) as MatrixRule[]);
    const substitutersByToCourseId = buildSubstitutersByToCourseId((ruleLinks ?? []) as RuleLinkRow[]);
    const substitutionTargetsByFromCourseId = buildSubstitutionTargetsByFromCourseId((ruleLinks ?? []) as RuleLinkRow[]);
    const exemptionsByFromCourseId = buildExemptionsByFromCourseId((ruleLinks ?? []) as RuleLinkRow[]);
    const prerequisitesByFromCourseId = buildPrerequisitesByFromCourseId((ruleLinks ?? []) as RuleLinkRow[]);

    const rows: WorkerCourseRow[] = [];
    const pushRow = (row: WorkerCourseRow) => {
      rows.push(row);
      if (rows.length > MAX_EXPORT_OUTPUT_ROWS) {
        throw new TooManyRowsError(
          `Export formazione troppo grande (> ${MAX_EXPORT_OUTPUT_ROWS} righe). Restringi il dataset o applica filtri.`,
        );
      }
    };

    const leveledFamilies: readonly (readonly string[])[] = [
      ["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"],
      ["CORSO_AI_3", "CORSO_AI_2", "CORSO_AI_1"],
    ];

    for (const employee of employees.filter((row) => !shouldExcludeEmployee(row))) {
      const excludedCourseIds = excludedCourseIdsByEmployee.get(employee.id) ?? null;
      const excludedCourseCodes = excludedCourseIds ? buildExcludedCourseCodeSet(excludedCourseIds, courseMap) : null;
      const rawRequiredIds = resolveRequiredCourseIds(employee, rulesByScope);
      const employeeStatusRows = statusByEmployee.get(employee.id) ?? [];
      const validCompletedCourseIds = buildValidCompletedCourseIdSet(employeeStatusRows, courseMap, todayIso, excludedCourseIds);
      let requiredCourseIds = collapseLeveledCourseRequirements(rawRequiredIds, courseMap, excludedCourseCodes);
      applyExemptions(requiredCourseIds, validCompletedCourseIds, exemptionsByFromCourseId);
      expandPrerequisites(requiredCourseIds, prerequisitesByFromCourseId);
      requiredCourseIds = collapseLeveledCourseRequirements(requiredCourseIds, courseMap, excludedCourseCodes);
      applyExemptions(requiredCourseIds, validCompletedCourseIds, exemptionsByFromCourseId);

      const upgradeInfoByCourseId = new Map<number, string>();
      const upgradeCourseIds = new Set<number>();
      const suppressedAdditionalCourseIds = new Set<number>();
      const skipRequiredCourseIds = new Set<number>();

      for (const statusRow of employeeStatusRows) {
        if (!isValidForSubstitution(statusRow, courseMap, todayIso)) continue;
        const targets = substitutionTargetsByFromCourseId.get(statusRow.course_id);
        if (!targets) continue;
        targets.forEach((targetCourseId) => suppressedAdditionalCourseIds.add(targetCourseId));
      }

      const formBaseCourseId = findCourseIdByCode("FORM_BASE", courseMap);
      const formSpecRequired = findEffectiveRequiredFormSpecCourse(requiredCourseIds, courseMap, excludedCourseCodes);

      if (
        typeof formBaseCourseId === "number" &&
        requiredCourseIds.has(formBaseCourseId) &&
        formSpecRequired
      ) {
        const baseCourseExcluded =
          excludedCourseIdsByEmployee.get(employee.id)?.has(formBaseCourseId) ?? false;
        const specCourseExcluded =
          excludedCourseIdsByEmployee.get(employee.id)?.has(formSpecRequired.courseId) ?? false;
        const shouldBuildBaseAggregate = !baseCourseExcluded && !specCourseExcluded;

        const freeze = activeFreeze.get(employee.id);
        if (shouldBuildBaseAggregate) {
          const baseAggregate = buildBaseAggregateRow({
            employee,
            formBaseCourseId,
            formSpecRequired,
            courseMap,
            statusMap,
            employeeStatusRows,
            substitutersByToCourseId,
            freeze,
            todayIso,
            expiringDays: expiringDaysSafe,
          });

          if (baseAggregate) {
            skipRequiredCourseIds.add(formBaseCourseId);
            skipRequiredCourseIds.add(formSpecRequired.courseId);
            if (baseAggregate.suppressedCourseId !== null) {
              suppressedAdditionalCourseIds.add(baseAggregate.suppressedCourseId);
            }
            pushRow(baseAggregate.row);
          }
        }
      }

      for (const courseId of requiredCourseIds) {
        if (skipRequiredCourseIds.has(courseId)) continue;
        const course = courseMap.get(courseId);
        if (!course) continue;
        const freeze = activeFreeze.get(employee.id);
        const courseExcluded = excludedCourseIdsByEmployee.get(employee.id)?.has(courseId) ?? false;

        const family = leveledFamilies.find((fam) => fam.includes(course.code));
        if (family && !courseExcluded) {
          const reqIndex = family.indexOf(course.code);
          const bestLower = findBestLowerValidCourse({
            statusRows: employeeStatusRows,
            family,
            requiredIndex: reqIndex,
            courseMap,
            todayIso,
          });

          if (bestLower) {
            const from = levelLabel(bestLower.courseCode) ?? bestLower.courseCode;
            const to = levelLabel(course.code) ?? course.code;
            upgradeInfoByCourseId.set(bestLower.courseId, `${from} → ${to}`);
            upgradeCourseIds.add(bestLower.courseId);
            const bestLowerStatus = employeeStatusRows.find((row) => row.course_id === bestLower.courseId);
            const bestLowerCourse = courseMap.get(bestLower.courseId);
            const baseState = bestLowerCourse
              ? resolveCourseState(bestLowerStatus, bestLowerCourse, freeze, todayIso, expiringDaysSafe, false)
              : "upgrade";
            const state = freeze ? "sospeso" : "upgrade";
            pushRow({
              workerId: employee.id,
              matricola: employee.matricola,
              cognome: employee.last_name,
              nome: employee.first_name,
              mansione: employee.job_title ?? "",
              cantiere: extractDisplayName(employee.sites),
              sottocantiere: extractDisplayName(employee.sub_sites),
              corsoCode: course.code,
              corso: course.title,
              dataConclusione: bestLowerStatus?.completion_date ?? null,
              dataScadenza: bestLowerStatus?.expiry_date ?? null,
              dataPrevista: bestLowerStatus?.planned_date ?? null,
              stato: (baseState === "sospeso" ? "sospeso" : state) as WorkerCourseRow["stato"],
              upgradeInfo: `${from} → ${to}`,
              responsabile: employee.responsible_code,
              referente: employee.referral ?? "",
              note: bestLowerStatus?.note ?? "",
              origine: "obbligatorio",
            });
            continue;
          }

          const bestHigher = findBestHigherValidCourse({
            statusRows: employeeStatusRows,
            family,
            requiredIndex: reqIndex,
            courseMap,
            todayIso,
          });

          if (bestHigher) {
            const higherStatus = statusMap.get(`${employee.id}:${bestHigher.courseId}`);
            const higherCourse = courseMap.get(bestHigher.courseId);
            if (higherStatus && higherCourse) {
              if (!requiredCourseIds.has(bestHigher.courseId)) {
                suppressedAdditionalCourseIds.add(bestHigher.courseId);
              }

              const state = resolveCourseState(higherStatus, higherCourse, freeze, todayIso, expiringDaysSafe, false);

              const outputRow: WorkerCourseRow = {
                workerId: employee.id,
                matricola: employee.matricola,
                cognome: employee.last_name,
                nome: employee.first_name,
                mansione: employee.job_title ?? "",
                cantiere: extractDisplayName(employee.sites),
                sottocantiere: extractDisplayName(employee.sub_sites),
                corsoCode: higherCourse.code,
                corso: higherCourse.title,
                dataConclusione: higherStatus.completion_date ?? null,
                dataScadenza: higherStatus.expiry_date ?? null,
                dataPrevista: higherStatus.planned_date ?? null,
                stato: state as WorkerCourseRow["stato"],
                upgradeInfo: null,
                responsabile: employee.responsible_code,
                referente: employee.referral ?? "",
                note: mergeNotes(higherStatus.note ?? null, `Copre obbligo: ${course.code}`),
                origine: "obbligatorio",
              };

              pushRow(outputRow);
              continue;
            }
          }
        }

        const statusEntry = statusMap.get(`${employee.id}:${courseId}`);
        const substitute = pickBestSubstituteStatus({
          requiredCourseId: courseId,
          statusEntry,
          employeeStatusRows,
          substitutersByToCourseId,
          courseMap,
          todayIso,
        });
        if (courseExcluded || !substitute) {
          const lost =
            !courseExcluded &&
            Boolean(statusEntry?.expiry_date) &&
            resolveCourseState(statusEntry, course, undefined, todayIso, expiringDaysSafe, false) === "perso";

          const state = courseExcluded
            ? "escluso"
            : lost
              ? resolveCourseState(undefined, undefined, freeze, todayIso, expiringDaysSafe, false)
              : resolveCourseState(statusEntry, course, freeze, todayIso, expiringDaysSafe, false);

          const outputRow: WorkerCourseRow = {
            workerId: employee.id,
            matricola: employee.matricola,
            cognome: employee.last_name,
            nome: employee.first_name,
            mansione: employee.job_title ?? "",
            cantiere: extractDisplayName(employee.sites),
            sottocantiere: extractDisplayName(employee.sub_sites),
            corsoCode: course.code,
            corso: course.title,
            dataConclusione: lost ? null : statusEntry?.completion_date ?? null,
            dataScadenza: lost ? null : statusEntry?.expiry_date ?? null,
            dataPrevista: lost ? null : statusEntry?.planned_date ?? null,
            stato: state as WorkerCourseRow["stato"],
            upgradeInfo: null,
            responsabile: employee.responsible_code,
            referente: employee.referral ?? "",
            note: lost ? "" : statusEntry?.note ?? "",
            origine: "obbligatorio",
          };

          pushRow(outputRow);

          if (lost && statusEntry) {
            const lostRow: WorkerCourseRow = {
              workerId: employee.id,
              matricola: employee.matricola,
              cognome: employee.last_name,
              nome: employee.first_name,
              mansione: employee.job_title ?? "",
              cantiere: extractDisplayName(employee.sites),
              sottocantiere: extractDisplayName(employee.sub_sites),
              corsoCode: course.code,
              corso: course.title,
              dataConclusione: statusEntry.completion_date ?? null,
              dataScadenza: statusEntry.expiry_date ?? null,
              dataPrevista: statusEntry.planned_date ?? null,
              stato: "perso",
              upgradeInfo: null,
              responsabile: employee.responsible_code,
              referente: employee.referral ?? "",
              note: statusEntry.note ?? "",
              origine: "obbligatorio",
            };
            pushRow(lostRow);
          }
          continue;
        }

        const substituteCourse = courseMap.get(substitute.substituteCourseId);
        if (!substituteCourse) continue;
        if (!requiredCourseIds.has(substitute.substituteCourseId)) {
          suppressedAdditionalCourseIds.add(substitute.substituteCourseId);
        }

        const state = resolveCourseState(substitute.statusEntry, substituteCourse, freeze, todayIso, expiringDaysSafe, false);

        const outputRow: WorkerCourseRow = {
          workerId: employee.id,
          matricola: employee.matricola,
          cognome: employee.last_name,
          nome: employee.first_name,
          mansione: employee.job_title ?? "",
          cantiere: extractDisplayName(employee.sites),
          sottocantiere: extractDisplayName(employee.sub_sites),
          corsoCode: substituteCourse.code,
          corso: substituteCourse.title,
          dataConclusione: substitute.statusEntry.completion_date ?? null,
          dataScadenza: substitute.statusEntry.expiry_date ?? null,
          dataPrevista: substitute.statusEntry.planned_date ?? null,
          stato: state as WorkerCourseRow["stato"],
          upgradeInfo: null,
          responsabile: employee.responsible_code,
          referente: employee.referral ?? "",
          note: mergeNotes(
            mergeNotes(statusEntry?.note ?? null, substitute.statusEntry.note ?? null),
            `Copre obbligo: ${course.code}`,
          ),
          origine: "obbligatorio",
        };

        pushRow(outputRow);
      }

      for (const statusEntry of employeeStatusRows) {
        if (suppressedAdditionalCourseIds.has(statusEntry.course_id)) continue;
        if (requiredCourseIds.has(statusEntry.course_id)) continue;
        const course = courseMap.get(statusEntry.course_id);
        if (!course) continue;
        if (isBaseCode(course.code)) continue;

        const freeze = activeFreeze.get(employee.id);
        const isUpgrade = upgradeCourseIds.has(statusEntry.course_id);
        const courseExcluded =
          excludedCourseIdsByEmployee.get(employee.id)?.has(statusEntry.course_id) ?? false;
        const lost = resolveCourseState(statusEntry, course, undefined, todayIso, expiringDaysSafe) === "perso";
        const baseState = lost
          ? "perso"
          : freeze
            ? "sospeso"
            : isUpgrade
              ? "upgrade"
              : resolveCourseState(statusEntry, course, freeze, todayIso, expiringDaysSafe);
        const state = courseExcluded ? "escluso" : baseState;

        const outputRow: WorkerCourseRow = {
          workerId: employee.id,
          matricola: employee.matricola,
          cognome: employee.last_name,
          nome: employee.first_name,
          mansione: employee.job_title ?? "",
          cantiere: extractDisplayName(employee.sites),
          sottocantiere: extractDisplayName(employee.sub_sites),
          corsoCode: course.code,
          corso: course.title,
          dataConclusione: statusEntry.completion_date ?? null,
          dataScadenza: statusEntry.expiry_date ?? null,
          dataPrevista: statusEntry.planned_date ?? null,
          stato: state as WorkerCourseRow["stato"],
          upgradeInfo: isUpgrade ? (upgradeInfoByCourseId.get(statusEntry.course_id) ?? null) : null,
          responsabile: employee.responsible_code,
          referente: employee.referral ?? "",
          note: statusEntry.note ?? "",
          origine: isUpgrade ? "obbligatorio" : "aggiuntivo",
        };

        pushRow(outputRow);
      }
    }

    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const workbook = XLSX.utils.book_new();

    const headers = [
      "matricola",
      "cognome",
      "nome",
      "mansione",
      "cantiere",
      "sottocantiere",
      "tipo corso",
      "upgrade",
      "data esecuzione",
      "data scadenza",
      "data prevista",
      "note",
      "stato",
      "responsabile",
      "referente",
      "data nascita",
      "luogo nascita",
      "codice fiscale",
      "mail",
      "cellulare",
    ] as const;

    const byPerson = (a: WorkerCourseRow, b: WorkerCourseRow) => {
      const bySurname = a.cognome.localeCompare(b.cognome, "it", { sensitivity: "base" });
      if (bySurname !== 0) return bySurname;
      const byName = a.nome.localeCompare(b.nome, "it", { sensitivity: "base" });
      if (byName !== 0) return byName;
      return `${a.corsoCode} ${a.corso}`.localeCompare(`${b.corsoCode} ${b.corso}`, "it", { sensitivity: "base" });
    };

    const allRows = [...rows].sort(byPerson);

    const exportableRows = allRows.filter((row) => row.stato !== "escluso");

    const base = exportableRows.filter((row) => isBaseCode(row.corsoCode));
    const muletto = exportableRows.filter((row) => row.corsoCode === "CORSO_MUL");
    const primoSoccorso = exportableRows.filter((row) => row.corsoCode === "CORSO_PS");
    const antincendio = exportableRows.filter((row) => Boolean(row.corsoCode.match(/^CORSO_AI_[123]$/)));
    const altriOperativi = exportableRows.filter((row) => {
      if (isBaseCode(row.corsoCode)) return false;
      if (row.corsoCode === "CORSO_MUL") return false;
      if (row.corsoCode === "CORSO_PS") return false;
      if (row.corsoCode.match(/^CORSO_AI_[123]$/)) return false;
      return true;
    });

    const reportSheets: Array<{ name: string; kind: ReportSheetKind; rows: WorkerCourseRow[] }> = [
      { name: "BASE", kind: "base", rows: base },
      { name: "muletto", kind: "muletto", rows: muletto },
      { name: "primo soccorso", kind: "primo_soccorso", rows: primoSoccorso },
      { name: "antincendio", kind: "antincendio", rows: antincendio },
      { name: "altri operativi", kind: "altri_operativi", rows: altriOperativi },
    ];

    reportSheets.forEach((sheetCfg) => {
      const sheet: Record<(typeof headers)[number], string>[] = [];
      sheetCfg.rows.forEach((row) => {
        const employee = employeeById.get(row.workerId);
        if (!employee) return;
        sheet.push(buildExportRow(employee, row, sheetCfg.kind));
      });
      const ws = XLSX.utils.json_to_sheet(sheet, { header: [...headers] });
      applyCalibri10WithBoldHeader(ws);
      XLSX.utils.book_append_sheet(workbook, ws, sanitizeSheetName(sheetCfg.name));
    });

    const ebafosHeaders = [
      "Nome",
      "Cognome",
      "Email Discente (opzionale)",
      "Data Nascita (opzionale)",
      "Sesso (M/F) (opzionale)",
      "Nato in Italia (0 - Si / 1 - No) (opzionale)",
      "Luogo di Nascita / Nazione di Nascita (opzionale)",
      "Mansione (opzionale)",
      "Codice Fiscale (obbligatorio se dati anagrafici non compilati)",
      "Codice Ateco (x.xx.xx.xx) (opzionale)",
      "Numero Identificazione Fiscale TIN (opzionale)",
    ] as const;

    const ebafosRows: Record<(typeof ebafosHeaders)[number], string>[] = [];
    exportableRows
      .filter((row) => row.stato === "programmato")
      .forEach((row) => {
        const employee = employeeById.get(row.workerId);
        if (!employee) return;
        ebafosRows.push({
          "Nome": employee.first_name ?? "",
          "Cognome": employee.last_name ?? "",
          "Email Discente (opzionale)": employee.email_primary ?? "",
          "Data Nascita (opzionale)": employee.birth_date ? isoToItDate(employee.birth_date) : "",
          "Sesso (M/F) (opzionale)": employee.sex ?? "",
          "Nato in Italia (0 - Si / 1 - No) (opzionale)": "",
          "Luogo di Nascita / Nazione di Nascita (opzionale)": employee.birth_place ?? "",
          "Mansione (opzionale)": employee.job_title ?? "",
          "Codice Fiscale (obbligatorio se dati anagrafici non compilati)": employee.tax_code ?? "",
          "Codice Ateco (x.xx.xx.xx) (opzionale)": "",
          "Numero Identificazione Fiscale TIN (opzionale)": "",
        });
      });

    const ebafosWs = XLSX.utils.json_to_sheet(ebafosRows, { header: [...ebafosHeaders] });
    applyCalibri10WithBoldHeader(ebafosWs);
    XLSX.utils.book_append_sheet(workbook, ebafosWs, "EBAFOS");

    const piattaformaHeaders = [
      "COGNOME",
      "NOME",
      "INDIRIZZO RESIDENZA",
      "CAP RESIDENZA",
      "CITTA RESIDENZA",
      "PROVINCIA RESIDENZA",
      "REGIONE RESIDENZA",
      "CITTA NASCITA",
      "PROVINCIA NASCITA",
      "REGIONE NASCITA",
      "DATA NASCITA",
      "CODICE FISCALE",
      "SESSO",
      "MAIL",
      "CELL",
      "USERNAME",
      "PASSWORD",
      "MANSIONE",
      "NOTE",
    ] as const;

    const piattaformaEmployeeIds = new Set<number>();
    const piattaformaNotesByEmployeeId = new Map<number, Set<string>>();

    base.forEach((row) => {
      const normalizedState = normalizeBaseSheetState(row);
      const isBassoEntry =
        row.corsoCode === "FORM_SPEC_BASSO" ||
        row.corsoCode === "FORM_BASE+FORM_SPEC_BASSO";
      const isAllRisksGenSpec =
        row.corsoCode.startsWith("FORM_BASE+FORM_SPEC_") ||
        row.corsoCode === "FORM_SPEC_BASSO" ||
        row.corsoCode === "FORM_SPEC_MEDIO" ||
        row.corsoCode === "FORM_SPEC_ALTO";

      const include =
        (isBassoEntry && (normalizedState === "da fare" || normalizedState === "programmato")) ||
        (isAllRisksGenSpec && (normalizedState === "scaduto" || normalizedState === "programmato"));

      if (!include) return;
      piattaformaEmployeeIds.add(row.workerId);
      const note = (row.note ?? "").trim();
      if (!note) return;
      const set = piattaformaNotesByEmployeeId.get(row.workerId);
      if (!set) piattaformaNotesByEmployeeId.set(row.workerId, new Set([note]));
      else set.add(note);
    });

    const piattaformaRows: Record<(typeof piattaformaHeaders)[number], string>[] = Array.from(
      piattaformaEmployeeIds.values(),
    )
      .map((id) => employeeById.get(id))
      .filter((employee): employee is EmployeeRow => Boolean(employee))
      .sort((a, b) => {
        const bySurname = a.last_name.localeCompare(b.last_name, "it", { sensitivity: "base" });
        if (bySurname !== 0) return bySurname;
        return a.first_name.localeCompare(b.first_name, "it", { sensitivity: "base" });
      })
      .map((employee) => {
        const taxCode = (employee.tax_code ?? "").toUpperCase();
        const username = taxCode.length >= 6 ? taxCode.slice(0, 6) : "";
        const notes = Array.from(piattaformaNotesByEmployeeId.get(employee.id) ?? []).join(" | ");
        const provinceResidence = (employee.residence_province ?? "").toUpperCase();
        const provinceBirth = (employee.birth_province ?? "").toUpperCase();
        return {
          "COGNOME": employee.last_name ?? "",
          "NOME": employee.first_name ?? "",
          "INDIRIZZO RESIDENZA": employee.residence_address ?? "",
          "CAP RESIDENZA": employee.residence_postal_code ?? "",
          "CITTA RESIDENZA": employee.residence_city ?? "",
          "PROVINCIA RESIDENZA": provinceResidence,
          "REGIONE RESIDENZA": provinceToRegion(provinceResidence),
          "CITTA NASCITA": employee.birth_place ?? "",
          "PROVINCIA NASCITA": provinceBirth,
          "REGIONE NASCITA": provinceToRegion(provinceBirth),
          "DATA NASCITA": employee.birth_date ? isoToItDate(employee.birth_date) : "",
          "CODICE FISCALE": taxCode,
          "SESSO": employee.sex ?? "",
          "MAIL": employee.email_primary ?? "",
          "CELL": employee.mobile ?? "",
          "USERNAME": username,
          "PASSWORD": "Morelli2026!",
          "MANSIONE": employee.job_title ?? "",
          "NOTE": notes,
        };
      });

    const piattaformaWs = XLSX.utils.json_to_sheet(piattaformaRows, { header: [...piattaformaHeaders] });
    applyCalibri10WithBoldHeader(piattaformaWs);
    XLSX.utils.book_append_sheet(workbook, piattaformaWs, "PIATTAFORMA");

    const out = XLSX.write(
      workbook,
      { type: "array", bookType: "xlsx", cellStyles: true } as XlsxWriteOptionsWithStyles,
    ) as ArrayBuffer;
    const filename = `export_formazione_${formatFilenameDate(new Date())}.xlsx`;

    return new NextResponse(out, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof TooManyRowsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore export formazione." },
      { status: 500 },
    );
  }
}

type ReportSheetKind =
  | "base"
  | "muletto"
  | "primo_soccorso"
  | "antincendio"
  | "altri_operativi";

function buildExportRow(employee: EmployeeRow, row: WorkerCourseRow, sheet: ReportSheetKind) {
  const dataNascita = employee.birth_date ? isoToItDate(employee.birth_date) : "";
  const dataEsecuzione = row.dataConclusione ? isoToItDate(row.dataConclusione) : "";
  const dataScadenza = formatExpiryLabel(row);
  const dataPrevista = row.dataPrevista ? isoToItDate(row.dataPrevista) : "";
  const note = (row.note ?? "").trim();
  const tipoCorso = buildTipoCorsoForReport(row, sheet);
  const upgrade = buildUpgradeLabel(row, sheet);
  const stato =
    sheet === "base" && (row.stato === "perso" || row.stato === "upgrade" || row.stato === "sospeso")
      ? "da fare"
      : row.stato;

  return {
    "matricola": employee.matricola ?? "",
    "cognome": employee.last_name ?? "",
    "nome": employee.first_name ?? "",
    "mansione": employee.job_title ?? "",
    "cantiere": extractDisplayName(employee.sites),
    "sottocantiere": extractDisplayName(employee.sub_sites),
    "tipo corso": tipoCorso,
    "upgrade": upgrade,
    "data esecuzione": dataEsecuzione,
    "data scadenza": dataScadenza,
    "data prevista": dataPrevista,
    "note": note,
    "stato": stato,
    "responsabile": employee.responsible_code ?? "",
    "referente": employee.referral ?? "",
    "data nascita": dataNascita,
    "luogo nascita": employee.birth_place ?? "",
    "codice fiscale": employee.tax_code ?? "",
    "mail": employee.email_primary ?? "",
    "cellulare": employee.mobile ?? "",
  };
}

function normalizeBaseSheetState(row: WorkerCourseRow) {
  return row.stato === "perso" || row.stato === "upgrade" || row.stato === "sospeso"
    ? "da fare"
    : row.stato;
}

const REGION_BY_PROVINCE: Record<string, string> = (() => {
  const data: Record<string, { sigla: string }[] | string[]> = {
    "regioni": [
      "Sicilia",
      "Piemonte",
      "Marche",
      "Valle d'Aosta",
      "Toscana",
      "Campania",
      "Puglia",
      "Veneto",
      "Lombardia",
      "Emilia-Romagna",
      "Trentino-Alto Adige",
      "Sardegna",
      "Molise",
      "Calabria",
      "Abruzzo",
      "Lazio",
      "Liguria",
      "Friuli-Venezia Giulia",
      "Basilicata",
      "Umbria",
    ],
    "Sicilia": [{ "sigla": "AG" }, { "sigla": "CL" }, { "sigla": "CT" }, { "sigla": "EN" }, { "sigla": "ME" }, { "sigla": "PA" }, { "sigla": "RG" }, { "sigla": "SR" }, { "sigla": "TP" }],
    "Piemonte": [{ "sigla": "AL" }, { "sigla": "AT" }, { "sigla": "BI" }, { "sigla": "CN" }, { "sigla": "NO" }, { "sigla": "TO" }, { "sigla": "VB" }, { "sigla": "VC" }],
    "Marche": [{ "sigla": "AN" }, { "sigla": "AP" }, { "sigla": "FM" }, { "sigla": "MC" }, { "sigla": "PU" }],
    "Valle d'Aosta": [{ "sigla": "AO" }],
    "Toscana": [{ "sigla": "AR" }, { "sigla": "FI" }, { "sigla": "GR" }, { "sigla": "LI" }, { "sigla": "LU" }, { "sigla": "MS" }, { "sigla": "PI" }, { "sigla": "PT" }, { "sigla": "PO" }, { "sigla": "SI" }],
    "Campania": [{ "sigla": "AV" }, { "sigla": "BN" }, { "sigla": "CE" }, { "sigla": "NA" }, { "sigla": "SA" }],
    "Puglia": [{ "sigla": "BA" }, { "sigla": "BT" }, { "sigla": "BR" }, { "sigla": "FG" }, { "sigla": "LE" }, { "sigla": "TA" }],
    "Veneto": [{ "sigla": "BL" }, { "sigla": "PD" }, { "sigla": "RO" }, { "sigla": "TV" }, { "sigla": "VE" }, { "sigla": "VR" }, { "sigla": "VI" }],
    "Lombardia": [{ "sigla": "BG" }, { "sigla": "BS" }, { "sigla": "CO" }, { "sigla": "CR" }, { "sigla": "LC" }, { "sigla": "LO" }, { "sigla": "MN" }, { "sigla": "MI" }, { "sigla": "MB" }, { "sigla": "PV" }, { "sigla": "SO" }, { "sigla": "VA" }],
    "Emilia-Romagna": [{ "sigla": "BO" }, { "sigla": "FE" }, { "sigla": "FC" }, { "sigla": "MO" }, { "sigla": "PR" }, { "sigla": "PC" }, { "sigla": "RA" }, { "sigla": "RE" }, { "sigla": "RN" }],
    "Trentino-Alto Adige": [{ "sigla": "BZ" }, { "sigla": "TN" }],
    "Sardegna": [{ "sigla": "CA" }, { "sigla": "CI" }, { "sigla": "NU" }, { "sigla": "OT" }, { "sigla": "OR" }, { "sigla": "VS" }, { "sigla": "SS" }, { "sigla": "OG" }, { "sigla": "SU" }],
    "Molise": [{ "sigla": "CB" }, { "sigla": "IS" }],
    "Calabria": [{ "sigla": "CZ" }, { "sigla": "CS" }, { "sigla": "KR" }, { "sigla": "RC" }, { "sigla": "VV" }],
    "Abruzzo": [{ "sigla": "CH" }, { "sigla": "AQ" }, { "sigla": "PE" }, { "sigla": "TE" }],
    "Lazio": [{ "sigla": "FR" }, { "sigla": "LT" }, { "sigla": "RI" }, { "sigla": "RM" }, { "sigla": "VT" }],
    "Liguria": [{ "sigla": "GE" }, { "sigla": "IM" }, { "sigla": "SP" }, { "sigla": "SV" }],
    "Friuli-Venezia Giulia": [{ "sigla": "GO" }, { "sigla": "PN" }, { "sigla": "TS" }, { "sigla": "UD" }],
    "Basilicata": [{ "sigla": "MT" }, { "sigla": "PZ" }],
    "Umbria": [{ "sigla": "PG" }, { "sigla": "TR" }],
  };

  const map: Record<string, string> = {};
  (data["regioni"] as string[]).forEach((region) => {
    const provinces = data[region] as { sigla: string }[] | undefined;
    provinces?.forEach((p) => {
      map[p.sigla.toUpperCase()] = region;
    });
  });
  return map;
})();

function provinceToRegion(provinceCode: string) {
  const key = (provinceCode ?? "").trim().toUpperCase();
  return REGION_BY_PROVINCE[key] ?? "";
}

function sanitizeSheetName(name: string) {
  const cleaned = String(name ?? "").replace(/[\\/?*[\]:]/g, "-").trim();
  const out = cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned;
  return out || "Sheet";
}

function formatExpiryLabel(row: WorkerCourseRow) {
  if (row.stato === "escluso") return "ESENTE";
  if (!row.dataConclusione) return "";
  if (!row.dataScadenza) return "ILLIMITATO";
  return isoToItDate(row.dataScadenza);
}

function buildTipoCorso(row: WorkerCourseRow) {
  if (row.corsoCode.startsWith("FORM_BASE+FORM_SPEC_")) {
    const risk = extractRiskFromBaseCode(row.corsoCode);
    return `generale + specifica rischio ${risk}`;
  }
  if (row.corsoCode.startsWith("FORM_SPEC_")) {
    const risk = extractRiskFromBaseCode(row.corsoCode);
    return `solo specifica rischio ${risk}`;
  }
  if (row.corsoCode === "FORM_BASE") {
    return "formazione generale";
  }
  return row.corso;
}

function extractRiskFromBaseCode(code: string) {
  const match = code.match(/FORM_SPEC_(ALTO|MEDIO|BASSO)/);
  if (!match) return "medio";
  return match[1].toLowerCase();
}

function parseCombinedFormSpecCode(courseCode: string) {
  if (!courseCode.startsWith("FORM_BASE+")) return null;
  const suffix = courseCode.slice("FORM_BASE+".length);
  if (!suffix.startsWith("FORM_SPEC_")) return null;
  return suffix;
}

function buildUpgradeLabel(row: WorkerCourseRow, sheet: ReportSheetKind) {
  if (sheet !== "base") return "";
  return row.stato === "upgrade" ? `upgrade ${normalizeUpgradeArrow(row.upgradeInfo).toLowerCase()}` : "";
}

function buildTipoCorsoForReport(row: WorkerCourseRow, sheet: ReportSheetKind) {
  if (sheet === "muletto") return buildOperationalTipoCorso(row, "muletto", row.corsoCode === "CORSO_MUL");
  if (sheet === "primo_soccorso") return buildOperationalTipoCorso(row, "primo soccorso", row.corsoCode === "CORSO_PS");
  if (sheet === "antincendio") {
    const level = row.corsoCode.match(/^CORSO_AI_([123])$/)?.[1] ?? "";
    const roman = level === "1" ? "i" : level === "2" ? "ii" : level === "3" ? "iii" : "";
    return buildOperationalTipoCorso(row, roman ? `antincendio liv. ${roman}` : "antincendio", Boolean(roman));
  }
  if (sheet === "altri_operativi") {
    const base = (row.corso ?? "").trim();
    if (shouldLabelAsAggiornamento(row)) return `aggiornamento ${base}`.trim();
    return base;
  }
  return buildTipoCorso(row);
}

function shouldLabelAsAggiornamento(row: WorkerCourseRow) {
  if (!row.dataConclusione) return false;
  if (!row.dataScadenza) return false;
  return row.stato === "scaduto" || row.stato === "in scadenza" || row.stato === "programmato";
}

function buildOperationalTipoCorso(row: WorkerCourseRow, label: string, isKnown: boolean) {
  const base = isKnown ? label : buildTipoCorso(row);
  if (shouldLabelAsAggiornamento(row)) return `aggiornamento ${base}`.trim();
  return base;
}

function normalizeUpgradeArrow(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\s*→\s*/g, " -> ").replace(/\s*->\s*/g, " -> ");
}

function formatFilenameDate(date: Date) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function buildStatusByEmployeeMap(rows: CourseStatusRow[]) {
  const map = new Map<number, CourseStatusRow[]>();
  rows.forEach((row) => {
    const list = map.get(row.employee_id);
    if (!list) {
      map.set(row.employee_id, [row]);
      return;
    }
    list.push(row);
  });
  return map;
}

async function fetchAllRules(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: MatrixRule[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("training_matrix_rules")
      .select("scope_type,course_id,job_code_norm,site_id,sub_site_id,employee_id")
      .eq("is_required", true)
      .range(from, to);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as MatrixRule[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_RULES) {
      throw new TooManyRowsError(
        `Troppe regole matrice formazione (> ${MAX_EXPORT_RULES}). Restringi il dataset o applica paginazione.`,
      );
    }

    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }
  return allRows;
}

async function fetchAllCourses(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: CourseRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("training_courses")
      .select("id,code,title,is_active,validity_years,is_unlimited")
      .order("id")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CourseRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_COURSES) {
      throw new TooManyRowsError(
        `Troppi corsi formazione (> ${MAX_EXPORT_COURSES}). Restringi il dataset o applica paginazione.`,
      );
    }
    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return allRows;
}

async function fetchAllCourseRows(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: CourseStatusRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("training_employee_courses")
      .select("employee_id,course_id,completion_date,expiry_date,planned_date,manual_state,note")
      .range(from, to);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CourseStatusRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_COURSE_ROWS) {
      throw new TooManyRowsError(
        `Troppi record corsi lavoratori (> ${MAX_EXPORT_COURSE_ROWS}). Restringi il dataset o applica paginazione.`,
      );
    }

    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }
  return allRows;
}

async function fetchAllFreezes(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: FreezeRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employee_freeze_periods")
      .select("employee_id,freeze_status,start_date,end_date")
      .range(from, to);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as FreezeRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_FREEZES) {
      throw new TooManyRowsError(
        `Troppi periodi freeze (> ${MAX_EXPORT_FREEZES}). Restringi il dataset o applica paginazione.`,
      );
    }

    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }
  return allRows;
}

async function fetchAllRuleLinks(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: RuleLinkRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("training_rule_links")
      .select("id,from_course_id,to_course_id,relation_type")
      .order("id")
      .range(from, to);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RuleLinkRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_RULE_LINKS) {
      throw new TooManyRowsError(
        `Troppe relazioni corsi (> ${MAX_EXPORT_RULE_LINKS}). Restringi il dataset o applica paginazione.`,
      );
    }

    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }
  return allRows;
}

async function fetchAllEmployees(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: EmployeeRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employees")
      .select(
        "id,matricola,tax_code,first_name,last_name,birth_date,birth_place,birth_province,sex,residence_address,residence_postal_code,residence_city,residence_province,mobile,email_primary,responsible_code,referral,site_id,sub_site_id,job_title,job_title_notes,sites(display_name),sub_sites(display_name)",
      )
      .eq("status", "attivo")
      .order("last_name")
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as EmployeeRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_EMPLOYEES) {
      throw new TooManyRowsError(
        `Troppi lavoratori per export formazione (> ${MAX_EXPORT_EMPLOYEES}). Restringi il dataset o applica filtri.`,
      );
    }

    if (rows.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return allRows;
}

function buildSubstitutersByToCourseId(links: RuleLinkRow[]) {
  const map = new Map<number, Set<number>>();
  links.forEach((row) => {
    if (row.relation_type !== "substitutes") return;
    const set = map.get(row.to_course_id);
    if (!set) map.set(row.to_course_id, new Set([row.from_course_id]));
    else set.add(row.from_course_id);
  });
  return map;
}

function buildSubstitutionTargetsByFromCourseId(links: RuleLinkRow[]) {
  const map = new Map<number, Set<number>>();
  links.forEach((row) => {
    if (row.relation_type !== "substitutes") return;
    const set = map.get(row.from_course_id);
    if (!set) map.set(row.from_course_id, new Set([row.to_course_id]));
    else set.add(row.to_course_id);
  });
  return map;
}

function buildExemptionsByFromCourseId(links: RuleLinkRow[]) {
  const map = new Map<number, Set<number>>();
  links.forEach((row) => {
    if (row.relation_type !== "exempts") return;
    const set = map.get(row.from_course_id);
    if (!set) map.set(row.from_course_id, new Set([row.to_course_id]));
    else set.add(row.to_course_id);
  });
  return map;
}

function buildPrerequisitesByFromCourseId(links: RuleLinkRow[]) {
  const map = new Map<number, Set<number>>();
  links.forEach((row) => {
    if (row.relation_type !== "prerequisite") return;
    const set = map.get(row.from_course_id);
    if (!set) map.set(row.from_course_id, new Set([row.to_course_id]));
    else set.add(row.to_course_id);
  });
  return map;
}

function isValidForSubstitution(row: CourseStatusRow, courseMap: Map<number, CourseRow>, todayIso: string) {
  if (row.manual_state === "escluso") return false;
  if (row.manual_state === "programmato") return false;
  if (row.planned_date && !row.completion_date) return false;
  const course = courseMap.get(row.course_id);
  if (!course) return false;
  return isValidCourseStatus(row, course, todayIso);
}

function buildValidCompletedCourseIdSet(
  statusRows: CourseStatusRow[],
  courseMap: Map<number, CourseRow>,
  todayIso: string,
  excludedCourseIds?: Set<number> | null,
) {
  const set = new Set<number>();
  statusRows.forEach((row) => {
    if (excludedCourseIds?.has(row.course_id) ?? false) return;
    const course = courseMap.get(row.course_id);
    if (!course) return;
    if (isValidCourseStatus(row, course, todayIso)) set.add(row.course_id);
  });
  return set;
}

function applyExemptions(
  requiredCourseIds: Set<number>,
  validCompletedCourseIds: Set<number>,
  exemptionsByFromCourseId: Map<number, Set<number>>,
) {
  validCompletedCourseIds.forEach((fromCourseId) => {
    const targets = exemptionsByFromCourseId.get(fromCourseId);
    if (!targets) return;
    targets.forEach((toCourseId) => requiredCourseIds.delete(toCourseId));
  });
}

function expandPrerequisites(
  requiredCourseIds: Set<number>,
  prerequisitesByFromCourseId: Map<number, Set<number>>,
) {
  const queue = Array.from(requiredCourseIds.values());
  const seen = new Set<number>(queue);

  while (queue.length > 0) {
    const courseId = queue.shift();
    if (typeof courseId !== "number") continue;
    const prereqs = prerequisitesByFromCourseId.get(courseId);
    if (!prereqs) continue;
    prereqs.forEach((prereqId) => {
      if (seen.has(prereqId)) return;
      seen.add(prereqId);
      requiredCourseIds.add(prereqId);
      queue.push(prereqId);
    });
  }
}

function pickBestSubstituteStatus(args: {
  requiredCourseId: number;
  statusEntry: CourseStatusRow | undefined;
  employeeStatusRows: CourseStatusRow[];
  substitutersByToCourseId: Map<number, Set<number>>;
  courseMap: Map<number, CourseRow>;
  todayIso: string;
}) {
  const { requiredCourseId, statusEntry, employeeStatusRows, substitutersByToCourseId, courseMap, todayIso } = args;
  if (statusEntry?.manual_state === "escluso") return null;

  const substituters = substitutersByToCourseId.get(requiredCourseId);
  if (!substituters || substituters.size === 0) return null;

  const candidates = employeeStatusRows.filter(
    (row) => substituters.has(row.course_id) && isValidForSubstitution(row, courseMap, todayIso),
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aExpiry = a.expiry_date ?? "";
    const bExpiry = b.expiry_date ?? "";
    if (!aExpiry && bExpiry) return -1;
    if (aExpiry && !bExpiry) return 1;
    if (aExpiry && bExpiry && aExpiry !== bExpiry) return bExpiry.localeCompare(aExpiry);
    const aComp = a.completion_date ?? "";
    const bComp = b.completion_date ?? "";
    return bComp.localeCompare(aComp);
  });

  const best = candidates[0];
  return best ? { statusEntry: best, substituteCourseId: best.course_id } : null;
}

async function fetchAllScopeExclusions(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("training_scope_exclusions")
    .select("scope_type,site_id,sub_site_id,is_active")
    .eq("is_active", true)
    .limit(MAX_EXPORT_SCOPE_EXCLUSIONS + 1);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as ScopeExclusionRow[];
  if (rows.length > MAX_EXPORT_SCOPE_EXCLUSIONS) {
    throw new TooManyRowsError(
      `Troppe esclusioni scope (> ${MAX_EXPORT_SCOPE_EXCLUSIONS}). Restringi il dataset o applica paginazione.`,
    );
  }
  return rows;
}

async function fetchAllTrainingEmployeeExclusions(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("training_employee_exclusions")
    .select("employee_id,is_active")
    .eq("is_active", true)
    .limit(MAX_EXPORT_EMPLOYEE_EXCLUSIONS + 1);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TrainingEmployeeExclusionRow[];
  if (rows.length > MAX_EXPORT_EMPLOYEE_EXCLUSIONS) {
    throw new TooManyRowsError(
      `Troppe esclusioni lavoratori (> ${MAX_EXPORT_EMPLOYEE_EXCLUSIONS}). Restringi il dataset o applica paginazione.`,
    );
  }
  return rows;
}

async function fetchAllTrainingEmployeeCourseExclusions(
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from("training_employee_course_exclusions")
    .select("employee_id,course_id,is_active")
    .eq("is_active", true)
    .limit(MAX_EXPORT_COURSE_EXCLUSIONS + 1);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TrainingEmployeeCourseExclusionRow[];
  if (rows.length > MAX_EXPORT_COURSE_EXCLUSIONS) {
    throw new TooManyRowsError(
      `Troppe esclusioni corsi per lavoratore (> ${MAX_EXPORT_COURSE_EXCLUSIONS}). Restringi il dataset o applica paginazione.`,
    );
  }
  return rows;
}

function groupRulesByScope(rules: MatrixRule[]) {
  return {
    baseline: rules.filter((rule) => rule.scope_type === "baseline"),
    job: rules.filter((rule) => rule.scope_type === "job"),
    site: rules.filter((rule) => rule.scope_type === "site"),
    subSite: rules.filter((rule) => rule.scope_type === "sub_site"),
    employee: rules.filter((rule) => rule.scope_type === "employee_override"),
  };
}

function resolveRequiredCourseIds(employee: EmployeeRow, grouped: ReturnType<typeof groupRulesByScope>) {
  const ids = new Set<number>();
  const normalizedJob = normalizeJobCode(employee.job_title ?? "");
  const jobVariantKey = buildJobVariantKey(employee.job_title ?? "", employee.job_title_notes ?? null);

  grouped.baseline.forEach((rule) => ids.add(rule.course_id));
  grouped.job
    .filter((rule) => rule.job_code_norm === normalizedJob || (!!jobVariantKey && rule.job_code_norm === jobVariantKey))
    .forEach((rule) => ids.add(rule.course_id));
  grouped.site
    .filter((rule) => rule.site_id === employee.site_id)
    .forEach((rule) => ids.add(rule.course_id));
  grouped.subSite
    .filter((rule) => rule.sub_site_id === employee.sub_site_id)
    .forEach((rule) => ids.add(rule.course_id));
  grouped.employee
    .filter((rule) => rule.employee_id === employee.id)
    .forEach((rule) => ids.add(rule.course_id));

  return ids;
}

function collapseLeveledCourseRequirements(
  requiredIds: Set<number>,
  courseMap: Map<number, CourseRow>,
  excludedCodes: Set<string> | null,
) {
  const result = new Set(requiredIds);
  const requiredCodes = new Set<string>();

  result.forEach((courseId) => {
    const code = courseMap.get(courseId)?.code;
    if (code) requiredCodes.add(code);
  });

  const leveledFamilies = [
    ["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"],
    ["CORSO_AI_3", "CORSO_AI_2", "CORSO_AI_1"],
  ] as const;

  leveledFamilies.forEach((family) => {
    const winnerCode = family.find((code) => requiredCodes.has(code) && !(excludedCodes?.has(code) ?? false));
    if (!winnerCode) return;

    family.forEach((code) => {
      if (code === winnerCode) return;
      if (excludedCodes?.has(code)) return;
      const losingId = findCourseIdByCode(code, courseMap);
      if (losingId !== null) result.delete(losingId);
    });
  });

  return result;
}

function findCourseIdByCode(
  code: string,
  courseMap: Map<number, CourseRow>,
) {
  for (const [courseId, course] of courseMap.entries()) {
    if (course.code === code) return courseId;
  }
  return null;
}

function findEffectiveRequiredFormSpecCourse(
  requiredCourseIds: Set<number>,
  courseMap: Map<number, CourseRow>,
  excludedCodes: Set<string> | null,
) {
  const family = ["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"] as const;
  for (const code of family) {
    if (excludedCodes?.has(code) ?? false) continue;
    const courseId = findCourseIdByCode(code, courseMap);
    if (courseId !== null && requiredCourseIds.has(courseId)) return { courseId, code };
  }
  return null;
}

function buildExcludedCourseCodeSet(excludedCourseIds: Set<number>, courseMap: Map<number, CourseRow>) {
  const out = new Set<string>();
  excludedCourseIds.forEach((courseId) => {
    const code = courseMap.get(courseId)?.code ?? "";
    if (!code) return;
    out.add(code);
    const spec = parseCombinedFormSpecCode(code);
    if (spec) {
      out.add("FORM_BASE");
      out.add(spec);
    }
  });
  return out;
}

function buildBaseAggregateRow({
  employee,
  formBaseCourseId,
  formSpecRequired,
  courseMap,
  statusMap,
  employeeStatusRows,
  substitutersByToCourseId,
  freeze,
  todayIso,
  expiringDays,
}: {
  employee: EmployeeRow;
  formBaseCourseId: number;
  formSpecRequired: { courseId: number; code: string };
  courseMap: Map<number, CourseRow>;
  statusMap: Map<string, CourseStatusRow>;
  employeeStatusRows: CourseStatusRow[];
  substitutersByToCourseId: Map<number, Set<number>>;
  freeze: FreezeRow | undefined;
  todayIso: string;
  expiringDays: number;
}) {
  if (freeze) return null;

  const formSpecFamily = ["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"] as const;
  const requiredIndex = formSpecFamily.indexOf(formSpecRequired.code as (typeof formSpecFamily)[number]);

  const formBaseStatus = statusMap.get(`${employee.id}:${formBaseCourseId}`);
  const formSpecRequiredStatus = statusMap.get(`${employee.id}:${formSpecRequired.courseId}`);

  if (!isToDoFromScratch(formBaseStatus) || !isToDoFromScratch(formSpecRequiredStatus)) {
    return null;
  }

  const bestLower =
    requiredIndex >= 0
      ? findBestLowerValidCourse({
          statusRows: employeeStatusRows,
          family: formSpecFamily,
          requiredIndex,
          courseMap,
          todayIso,
        })
      : null;

  const bestHigher =
    requiredIndex >= 0
      ? findBestHigherValidCourse({
          statusRows: employeeStatusRows,
          family: formSpecFamily,
          requiredIndex,
          courseMap,
          todayIso,
        })
      : null;

  const shouldUpgrade =
    !formSpecRequiredStatus?.completion_date && bestLower !== null;

  if (shouldUpgrade) {
    return null;
  }

  const higherStatus = bestHigher
    ? employeeStatusRows.find((row) => row.course_id === bestHigher.courseId)
    : null;

  const effectiveSpecCourseId = higherStatus
    ? bestHigher!.courseId
    : shouldUpgrade
      ? bestLower!.courseId
      : formSpecRequired.courseId;

  const effectiveSpecStatus = higherStatus
    ? higherStatus
    : shouldUpgrade
      ? employeeStatusRows.find((row) => row.course_id === effectiveSpecCourseId)
      : formSpecRequiredStatus;

  const substituteForSpec = pickBestSubstituteStatus({
    requiredCourseId: effectiveSpecCourseId,
    statusEntry: effectiveSpecStatus,
    employeeStatusRows,
    substitutersByToCourseId,
    courseMap,
    todayIso,
  });
  if (substituteForSpec) return null;

  const baseCourse = courseMap.get(formBaseCourseId);
  const specCourse = courseMap.get(effectiveSpecCourseId);
  const formBaseState = resolveCourseState(formBaseStatus, baseCourse, freeze, todayIso, expiringDays, false);
  const rawSpecState = resolveCourseState(effectiveSpecStatus, specCourse, freeze, todayIso, expiringDays, false);
  const specState =
    shouldUpgrade && (rawSpecState === "idoneo" || rawSpecState === "in scadenza")
      ? "upgrade"
      : rawSpecState;

  const state = mergeBaseStates(formBaseState, specState);

  const completionDate = pickLatestDate(
    formBaseStatus?.completion_date ?? null,
    effectiveSpecStatus?.completion_date ?? null,
  );

  const expiryDate = pickEarliestDate(
    formBaseStatus?.expiry_date ?? null,
    effectiveSpecStatus?.expiry_date ?? null,
  );

  const plannedDate = pickLatestDate(
    formBaseStatus?.planned_date ?? null,
    effectiveSpecStatus?.planned_date ?? null,
  );

  const risk = formSpecRequired.code.slice("FORM_SPEC_".length).toLowerCase();
  const courseCode = `FORM_BASE+${formSpecRequired.code}`;
  const courseTitle = `Formazione generale + specifica rischio ${risk}`;

  const upgradeInfo = shouldUpgrade && bestLower
    ? `${levelLabel(bestLower.courseCode) ?? bestLower.courseCode} → ${levelLabel(formSpecRequired.code) ?? formSpecRequired.code}`
    : null;

  const note = mergeNotes(formBaseStatus?.note ?? null, effectiveSpecStatus?.note ?? null);

  const row: WorkerCourseRow = {
    workerId: employee.id,
    matricola: employee.matricola,
    cognome: employee.last_name,
    nome: employee.first_name,
    mansione: employee.job_title ?? "",
    cantiere: extractDisplayName(employee.sites),
    sottocantiere: extractDisplayName(employee.sub_sites),
    corsoCode: courseCode,
    corso: courseTitle,
    dataConclusione: completionDate,
    dataScadenza: expiryDate,
    dataPrevista: plannedDate,
    stato: state as WorkerCourseRow["stato"],
    upgradeInfo,
    responsabile: employee.responsible_code,
    referente: employee.referral ?? "",
    note,
    origine: "obbligatorio",
  };

  return {
    row,
    suppressedCourseId: null,
  };
}

function isToDoFromScratch(row: CourseStatusRow | undefined) {
  if (!row) return true;
  if (row.completion_date) return false;
  return true;
}

function mergeNotes(a: string | null, b: string | null) {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left && !right) return "";
  if (left && !right) return left;
  if (!left && right) return right;
  if (left === right) return left;
  return `${left} | ${right}`;
}

function mergeBaseStates(a: string, b: string) {
  if (a === "sospeso" || b === "sospeso") return "sospeso";
  if (a === "programmato" || b === "programmato") return "programmato";
  if (a === "da fare" || b === "da fare") return "da fare";
  if (a === "scaduto" || b === "scaduto") return "scaduto";
  if (a === "in scadenza" || b === "in scadenza") return "in scadenza";
  if (a === "upgrade" || b === "upgrade") return "upgrade";
  return "idoneo";
}

function pickLatestDate(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  const ak = parseDateOnlyKey(a);
  const bk = parseDateOnlyKey(b);
  if (ak && bk) return ak >= bk ? a : b;
  return a >= b ? a : b;
}

function pickEarliestDate(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  const ak = parseDateOnlyKey(a);
  const bk = parseDateOnlyKey(b);
  if (ak && bk) return ak <= bk ? a : b;
  return a <= b ? a : b;
}

function normalizeDateOnlyIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseDateOnlyKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const isoLike = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoLike) {
    const y = Number(isoLike[1]);
    const m = Number(isoLike[2]);
    const d = Number(isoLike[3]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;
    return y * 10000 + m * 100 + d;
  }

  const itLike = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (itLike) {
    const d = Number(itLike[1]);
    const m = Number(itLike[2]);
    const y = Number(itLike[3]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;
    return y * 10000 + m * 100 + d;
  }

  return null;
}

function addDaysKey(todayKey: number, days: number) {
  const y = Math.floor(todayKey / 10000);
  const m = Math.floor((todayKey % 10000) / 100);
  const d = todayKey % 100;
  const base = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(base.getTime())) return todayKey;
  base.setUTCDate(base.getUTCDate() + days);
  const yy = base.getUTCFullYear();
  const mm = base.getUTCMonth() + 1;
  const dd = base.getUTCDate();
  return yy * 10000 + mm * 100 + dd;
}

function addMonthsKey(dateKey: number, months: number) {
  const y = Math.floor(dateKey / 10000);
  const m = Math.floor((dateKey % 10000) / 100);
  const d = dateKey % 100;
  const total = y * 12 + (m - 1) + months;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const dd = Math.min(d, lastDay);
  return yy * 10000 + mm * 100 + dd;
}

function todayLocalIso() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSentinelUnlimitedDate(iso: string) {
  const year = Number(iso.slice(0, 4));
  return year === 2069 || year === 2099;
}

function findBestLowerValidCourse({
  statusRows,
  family,
  requiredIndex,
  courseMap,
  todayIso,
}: {
  statusRows: CourseStatusRow[];
  family: readonly string[];
  requiredIndex: number;
  courseMap: Map<number, CourseRow>;
  todayIso: string;
}) {
  const candidates: Array<{ courseId: number; courseCode: string; familyIndex: number }> = [];

  for (const sr of statusRows) {
    const course = courseMap.get(sr.course_id);
    if (!course) continue;
    if (!family.includes(course.code)) continue;
    const idx = family.indexOf(course.code);
    if (idx <= requiredIndex) continue;
    if (!isValidCourseStatus(sr, course, todayIso)) continue;
    candidates.push({ courseId: sr.course_id, courseCode: course.code, familyIndex: idx });
  }

  candidates.sort((a, b) => a.familyIndex - b.familyIndex);
  return candidates[0] ?? null;
}

function findBestHigherValidCourse({
  statusRows,
  family,
  requiredIndex,
  courseMap,
  todayIso,
}: {
  statusRows: CourseStatusRow[];
  family: readonly string[];
  requiredIndex: number;
  courseMap: Map<number, CourseRow>;
  todayIso: string;
}) {
  const candidates: Array<{ courseId: number; courseCode: string; familyIndex: number }> = [];

  for (const sr of statusRows) {
    const course = courseMap.get(sr.course_id);
    if (!course) continue;
    if (!family.includes(course.code)) continue;
    const idx = family.indexOf(course.code);
    if (idx < 0) continue;
    if (idx >= requiredIndex) continue;
    if (!isValidCourseStatus(sr, course, todayIso)) continue;
    candidates.push({ courseId: sr.course_id, courseCode: course.code, familyIndex: idx });
  }

  candidates.sort((a, b) => b.familyIndex - a.familyIndex);
  return candidates[0] ?? null;
}

function computeTheoreticalExpiryIso(completionDateIso: string, validityYears: number) {
  const baseKey = parseDateOnlyKey(completionDateIso);
  if (!baseKey) return null;
  const y = Math.floor(baseKey / 10000);
  const m = Math.floor((baseKey % 10000) / 100);
  const d = baseKey % 100;
  const base = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(base.getTime())) return null;
  const next = new Date(Date.UTC(base.getUTCFullYear() + validityYears, base.getUTCMonth(), base.getUTCDate()));
  return next.toISOString().slice(0, 10);
}

function isValidCourseStatus(row: CourseStatusRow, course: CourseRow, todayIso: string) {
  if (row.manual_state === "escluso") return false;
  if (!row.completion_date) return false;
  if (course.is_unlimited) return true;

  const todayKey = parseDateOnlyKey(todayIso) ?? parseDateOnlyKey(todayLocalIso());
  if (!todayKey) return false;

  const expiryIso = row.expiry_date ? normalizeDateOnlyIso(String(row.expiry_date)) : null;
  if (expiryIso && isSentinelUnlimitedDate(expiryIso)) return true;

  if (!expiryIso) {
    const years = course.validity_years;
    if (!years || !Number.isFinite(years) || years <= 0) return false;
    const computed = computeTheoreticalExpiryIso(row.completion_date, years);
    if (!computed) return false;
    const computedKey = parseDateOnlyKey(computed);
    if (!computedKey) return false;
    return computedKey >= todayKey;
  }

  const expiryKey = parseDateOnlyKey(expiryIso);
  if (!expiryKey) return false;
  return expiryKey >= todayKey;
}

function buildActiveFreezeMap(rows: FreezeRow[], todayIso: string) {
  const todayKey = parseDateOnlyKey(todayIso) ?? parseDateOnlyKey(todayLocalIso());
  const map = new Map<number, FreezeRow>();

  if (!todayKey) return map;

  rows.forEach((row) => {
    const startKey = parseDateOnlyKey(row.start_date);
    const endKey = row.end_date ? parseDateOnlyKey(row.end_date) : null;
    if (!startKey) return;
    const active = startKey <= todayKey && (!endKey || endKey >= todayKey);
    if (active) {
      map.set(row.employee_id, row);
    }
  });

  return map;
}

function resolveCourseState(
  row: CourseStatusRow | undefined,
  course: CourseRow | undefined,
  freeze: FreezeRow | undefined,
  todayIso: string,
  expiringDays: number,
  isUpgrade: boolean = false,
) {
  if (freeze) return "sospeso";

  if (!row) {
    return isUpgrade ? "upgrade" : "da fare";
  }

  if (row.manual_state === "escluso") return "escluso";
  if (row.manual_state === "programmato" && !row.completion_date) return "programmato";

  if (row.planned_date && !row.completion_date) {
    return "programmato";
  }

  if (!row.completion_date) {
    return isUpgrade ? "upgrade" : "da fare";
  }

  const todayKey = parseDateOnlyKey(todayIso) ?? parseDateOnlyKey(todayLocalIso());
  if (!todayKey) return isUpgrade ? "upgrade" : "da fare";
  const thresholdKey = addDaysKey(todayKey, expiringDays);

  if (course?.is_unlimited) return "idoneo";

  let expiryIso = row.expiry_date ? normalizeDateOnlyIso(String(row.expiry_date)) : null;
  if (expiryIso && isSentinelUnlimitedDate(expiryIso)) return "idoneo";

  if (!expiryIso) {
    const years = course?.validity_years;
    if (!years || !Number.isFinite(years) || years <= 0) return isUpgrade ? "upgrade" : "da fare";
    const computed = computeTheoreticalExpiryIso(row.completion_date, years);
    if (!computed) return isUpgrade ? "upgrade" : "da fare";
    expiryIso = computed;
  }

  const expiryKey = parseDateOnlyKey(expiryIso);
  if (!expiryKey) return isUpgrade ? "upgrade" : "da fare";

  if (expiryKey < todayKey) {
    const lostKey = addMonthsKey(expiryKey, 6);
    if (lostKey < todayKey) return "perso";
    return "scaduto";
  }
  if (expiryKey <= thresholdKey) return "in scadenza";
  return "idoneo";
}

function levelLabel(courseCode: string) {
  if (courseCode.startsWith("FORM_SPEC_")) {
    const suffix = courseCode.slice("FORM_SPEC_".length);
    if (suffix) return suffix.toUpperCase();
  }
  const aiMatch = courseCode.match(/^CORSO_AI_(\d)$/);
  if (aiMatch) return aiMatch[1];
  return null;
}

function extractDisplayName(value: unknown) {
  if (!value) return "-";
  if (Array.isArray(value)) {
    const first = value[0] as { display_name?: string } | undefined;
    return first?.display_name ?? "-";
  }
  if (typeof value === "object") {
    return (value as { display_name?: string }).display_name ?? "-";
  }
  return "-";
}
