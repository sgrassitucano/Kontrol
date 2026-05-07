import { NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { applyCalibri10WithBoldHeader } from "@/lib/excel";
import { buildJobVariantKey, normalizeJobCode } from "@/lib/training/normalize";
import { requireModuleAccess } from "@/lib/api/access";
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

export async function GET(request: Request) {
  const auth = await requireModuleAccess("formazione", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const expiringDays = Number(url.searchParams.get("expiringDays") ?? "30");
    const dateParam = url.searchParams.get("date");
    const includeExcluded = url.searchParams.get("includeExcluded") === "1";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const category = (url.searchParams.get("category") ?? "").trim();
    const statesParam = (url.searchParams.get("states") ?? "").trim();
    const origineParam = (url.searchParams.get("origine") ?? "").trim();
    const filterMatricola = (url.searchParams.get("matricola") ?? "").trim();
    const filterCognome = (url.searchParams.get("cognome") ?? "").trim();
    const filterNome = (url.searchParams.get("nome") ?? "").trim();
    const filterMansione = (url.searchParams.get("mansione") ?? "").trim();
    const filterCantiere = (url.searchParams.get("cantiere") ?? "").trim();
    const filterSottocantiere = (url.searchParams.get("sottocantiere") ?? "").trim();
    const filterResponsabile = (url.searchParams.get("responsabile") ?? "").trim();
    const filterReferente = (url.searchParams.get("referente") ?? "").trim();
    const filterCorso = (url.searchParams.get("corso") ?? "").trim();
    const filterDataConclusione = (url.searchParams.get("dataConclusione") ?? "").trim();
    const filterDataScadenza = (url.searchParams.get("dataScadenza") ?? "").trim();
    const filterNote = (url.searchParams.get("note") ?? "").trim();

    const todayIso =
      typeof dateParam === "string" && normalizeDateOnlyIso(dateParam) ? normalizeDateOnlyIso(dateParam)! : todayLocalIso();
    const expiringDaysSafeRaw = Number.isFinite(expiringDays) ? expiringDays : 30;
    const expiringDaysSafe = Math.min(Math.max(expiringDaysSafeRaw, 0), 365);

    const dataSupabase = auth.supabase;

    const [
      employees,
      { data: courses, error: coursesError },
      rules,
      courseRows,
      freezes,
      ruleLinks,
      scopeExclusions,
      employeeExclusions,
      courseExclusions,
    ] = await Promise.all([
      fetchAllEmployees(dataSupabase),
      dataSupabase.from("training_courses").select("id,code,title,is_active"),
      fetchAllRules(dataSupabase),
      fetchAllCourseRows(dataSupabase),
      fetchAllFreezes(dataSupabase),
      fetchAllRuleLinks(dataSupabase),
      fetchAllScopeExclusions(dataSupabase),
      fetchAllTrainingEmployeeExclusions(dataSupabase),
      fetchAllTrainingEmployeeCourseExclusions(dataSupabase),
    ]);

    if (coursesError) {
      throw new Error(coursesError.message);
    }

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
      if (!includeExcluded && excludedEmployeeIds.has(employee.id)) return true;
      if (typeof employee.sub_site_id === "number" && excludedSubSiteIds.has(employee.sub_site_id)) return true;
      if (typeof employee.site_id === "number" && excludedSiteIds.has(employee.site_id)) return true;
      return false;
    };

    const activeFreeze = buildActiveFreezeMap((freezes ?? []) as FreezeRow[], todayIso);
    const courseMap = new Map((courses ?? []).map((course) => [course.id, course]));
    const statusRows = (courseRows ?? []) as CourseStatusRow[];
    const statusMap = new Map(statusRows.map((row) => [`${row.employee_id}:${row.course_id}`, row]));
    const statusByEmployee = buildStatusByEmployeeMap(statusRows);
    const rulesByScope = groupRulesByScope((rules ?? []) as MatrixRule[]);
    const substitutersByToCourseId = buildSubstitutersByToCourseId((ruleLinks ?? []) as RuleLinkRow[]);
    const substitutionTargetsByFromCourseId = buildSubstitutionTargetsByFromCourseId((ruleLinks ?? []) as RuleLinkRow[]);
    const exemptionsByFromCourseId = buildExemptionsByFromCourseId((ruleLinks ?? []) as RuleLinkRow[]);
    const prerequisitesByFromCourseId = buildPrerequisitesByFromCourseId((ruleLinks ?? []) as RuleLinkRow[]);

    const rows: WorkerCourseRow[] = [];

    const leveledFamilies: readonly (readonly string[])[] = [
      ["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"],
      ["CORSO_AI_3", "CORSO_AI_2", "CORSO_AI_1"],
    ];

    for (const employee of employees.filter((row) => !shouldExcludeEmployee(row))) {
      const rawRequiredIds = resolveRequiredCourseIds(employee, rulesByScope);
      const employeeStatusRows = statusByEmployee.get(employee.id) ?? [];
      const validCompletedCourseIds = buildValidCompletedCourseIdSet(employeeStatusRows, todayIso);
      let requiredCourseIds = collapseLeveledCourseRequirements(rawRequiredIds, courseMap);
      applyExemptions(requiredCourseIds, validCompletedCourseIds, exemptionsByFromCourseId);
      expandPrerequisites(requiredCourseIds, prerequisitesByFromCourseId);
      requiredCourseIds = collapseLeveledCourseRequirements(requiredCourseIds, courseMap);
      applyExemptions(requiredCourseIds, validCompletedCourseIds, exemptionsByFromCourseId);

      const upgradeInfoByCourseId = new Map<number, string>();
      const upgradeCourseIds = new Set<number>();
      const suppressedAdditionalCourseIds = new Set<number>();
      const skipRequiredCourseIds = new Set<number>();

      for (const statusRow of employeeStatusRows) {
        if (!isValidForSubstitution(statusRow, todayIso)) continue;
        const targets = substitutionTargetsByFromCourseId.get(statusRow.course_id);
        if (!targets) continue;
        targets.forEach((targetCourseId) => suppressedAdditionalCourseIds.add(targetCourseId));
      }

      const formBaseCourseId = findCourseIdByCode("FORM_BASE", courseMap);
      const formSpecRequired = findRequiredFormSpecCourse(requiredCourseIds, courseMap);

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
            rows.push(baseAggregate.row);
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

              const state = resolveCourseState(higherStatus, freeze, todayIso, expiringDaysSafe, false);

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
                stato: state as WorkerCourseRow["stato"],
                upgradeInfo: null,
                responsabile: employee.responsible_code,
                referente: employee.referral ?? "",
                note: mergeNotes(higherStatus.note ?? null, `Copre obbligo: ${course.code}`),
                origine: "obbligatorio",
              };

              rows.push(outputRow);
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
          todayIso,
        });
        if (courseExcluded || !substitute) {
          const lost =
            !courseExcluded &&
            Boolean(statusEntry?.expiry_date) &&
            resolveCourseState(statusEntry, undefined, todayIso, expiringDaysSafe, false) === "perso";

          const state = courseExcluded
            ? "escluso"
            : lost
              ? resolveCourseState(undefined, freeze, todayIso, expiringDaysSafe, false)
              : resolveCourseState(statusEntry, freeze, todayIso, expiringDaysSafe, false);

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
            stato: state as WorkerCourseRow["stato"],
            upgradeInfo: null,
            responsabile: employee.responsible_code,
            referente: employee.referral ?? "",
            note: lost ? "" : statusEntry?.note ?? "",
            origine: "obbligatorio",
          };

          rows.push(outputRow);

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
              stato: "perso",
              upgradeInfo: null,
              responsabile: employee.responsible_code,
              referente: employee.referral ?? "",
              note: statusEntry.note ?? "",
              origine: "obbligatorio",
            };
            rows.push(lostRow);
          }
          continue;
        }

        const substituteCourse = courseMap.get(substitute.substituteCourseId);
        if (!substituteCourse) continue;
        if (!requiredCourseIds.has(substitute.substituteCourseId)) {
          suppressedAdditionalCourseIds.add(substitute.substituteCourseId);
        }

        const state = resolveCourseState(substitute.statusEntry, freeze, todayIso, expiringDaysSafe, false);

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

        rows.push(outputRow);
      }

      for (const statusEntry of employeeStatusRows) {
        if (suppressedAdditionalCourseIds.has(statusEntry.course_id)) continue;
        if (requiredCourseIds.has(statusEntry.course_id)) continue;
        const course = courseMap.get(statusEntry.course_id);
        if (!course) continue;

        const freeze = activeFreeze.get(employee.id);
        const isUpgrade = upgradeCourseIds.has(statusEntry.course_id);
        const courseExcluded =
          excludedCourseIdsByEmployee.get(employee.id)?.has(statusEntry.course_id) ?? false;
        const lost = resolveCourseState(statusEntry, undefined, todayIso, expiringDaysSafe) === "perso";
        const baseState = lost
          ? "perso"
          : freeze
            ? "sospeso"
            : isUpgrade
              ? "upgrade"
              : resolveCourseState(statusEntry, freeze, todayIso, expiringDaysSafe);
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
          stato: state as WorkerCourseRow["stato"],
          upgradeInfo: isUpgrade ? (upgradeInfoByCourseId.get(statusEntry.course_id) ?? null) : null,
          responsabile: employee.responsible_code,
          referente: employee.referral ?? "",
          note: statusEntry.note ?? "",
          origine: isUpgrade ? "obbligatorio" : "aggiuntivo",
        };

        rows.push(outputRow);
      }
    }

    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const workbook = XLSX.utils.book_new();

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

    const statesFilter =
      statesParam
        ? new Set(
            statesParam
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          )
        : null;

    const shouldIncludeRow = (row: WorkerCourseRow) => {
      if (category) {
        const isBase = isBaseCode(row.corsoCode);
        if (category === "base" && !isBase) return false;
        if (category === "operativi" && isBase) return false;
      }
      if (statesFilter && !statesFilter.has(row.stato)) return false;
      if (origineParam && row.origine !== origineParam) return false;
      if (q) {
        const searchable = [
          row.matricola,
          row.cognome,
          row.nome,
          row.mansione,
          row.cantiere,
          row.sottocantiere,
          row.responsabile,
          row.referente,
          `${row.corsoCode} ${row.corso}`,
        ]
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      if (filterMatricola && !matchText(row.matricola, filterMatricola)) return false;
      if (filterCognome && !matchText(row.cognome, filterCognome)) return false;
      if (filterNome && !matchText(row.nome, filterNome)) return false;
      if (filterMansione && !matchText(row.mansione, filterMansione)) return false;
      if (filterCantiere && !matchText(row.cantiere, filterCantiere)) return false;
      if (filterSottocantiere && !matchText(row.sottocantiere, filterSottocantiere)) return false;
      if (filterResponsabile && !matchText(row.responsabile, filterResponsabile)) return false;
      if (filterReferente && !matchText(row.referente, filterReferente)) return false;
      if (filterCorso && !matchText(`${row.corsoCode} ${row.corso}`, filterCorso)) return false;
      if (filterDataConclusione && !matchText(row.dataConclusione ?? "", filterDataConclusione)) return false;
      if (filterDataScadenza && !matchText(row.dataScadenza ?? "", filterDataScadenza)) return false;
      if (filterNote && !matchText(row.note ?? "", filterNote)) return false;
      return true;
    };

    const filtered = rows.filter(shouldIncludeRow);

    filtered.sort((a, b) => {
      const bySurname = a.cognome.localeCompare(b.cognome, "it", { sensitivity: "base" });
      if (bySurname !== 0) return bySurname;
      const byName = a.nome.localeCompare(b.nome, "it", { sensitivity: "base" });
      if (byName !== 0) return byName;
      return `${a.corsoCode} ${a.corso}`.localeCompare(`${b.corsoCode} ${b.corso}`, "it", { sensitivity: "base" });
    });

    const headers = [
      "cognome",
      "nome",
      "mansione",
      "cantiere",
      "sottocantiere",
      "tipo corso",
      "data esecuzione",
      "data scadenza",
      "note",
      "idoneo/non idoneo",
      "responsabile",
      "referente",
      "data nascita",
      "luogo nascita",
      "mail",
      "cellulare",
    ] as const;

    const sheet: Record<(typeof headers)[number], string>[] = [];

    filtered.forEach((row) => {
      const employee = employeeById.get(row.workerId);
      if (!employee) return;
      sheet.push(buildExportRow(employee, row));
    });

    const ws = XLSX.utils.json_to_sheet(sheet, { header: [...headers] });
    applyCalibri10WithBoldHeader(ws);
    XLSX.utils.book_append_sheet(workbook, ws, "Formazione");

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore export formazione." },
      { status: 500 },
    );
  }
}

function buildExportRow(employee: EmployeeRow, row: WorkerCourseRow) {
  const dataNascita = employee.birth_date ? isoToItDate(employee.birth_date) : "";
  const dataEsecuzione = row.dataConclusione ? isoToItDate(row.dataConclusione) : "";
  const dataScadenza = formatExpiryLabel(row);
  const note = mergeNotesForExport(row.note, row.stato === "upgrade" ? row.upgradeInfo : null);
  const tipoCorso = buildTipoCorso(row);

  return {
    "cognome": employee.last_name ?? "",
    "nome": employee.first_name ?? "",
    "mansione": employee.job_title ?? "",
    "cantiere": extractDisplayName(employee.sites),
    "sottocantiere": extractDisplayName(employee.sub_sites),
    "tipo corso": tipoCorso,
    "data esecuzione": dataEsecuzione,
    "data scadenza": dataScadenza,
    "note": note,
    "idoneo/non idoneo": buildEsitoLabel(row),
    "responsabile": employee.responsible_code ?? "",
    "referente": employee.referral ?? "",
    "data nascita": dataNascita,
    "luogo nascita": employee.birth_place ?? "",
    "mail": employee.email_primary ?? "",
    "cellulare": employee.mobile ?? "",
  };
}

function buildEsitoLabel(row: WorkerCourseRow) {
  if (row.stato === "idoneo") return "IDONEO";
  if (row.stato === "escluso") return "ESENTE";
  if (row.stato === "perso") return "PERSO";
  if (row.stato === "sospeso") return "SOSPESO";
  return "NON IDONEO";
}

function formatExpiryLabel(row: WorkerCourseRow) {
  if (row.stato === "escluso") return "ESENTE";
  if (!row.dataConclusione) return "";
  if (!row.dataScadenza) return "ILLIMITATO";
  return isoToItDate(row.dataScadenza);
}

function matchText(value: string, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) return true;
  const normalizedValue = String(value ?? "").toLowerCase();
  if (normalizedValue.includes(normalizedFilter)) return true;
  const formattedValue = isoToItDate(String(value ?? "")).toLowerCase();
  if (formattedValue !== normalizedValue && formattedValue.includes(normalizedFilter)) return true;
  return false;
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

function mergeNotesForExport(note: string, upgradeInfo: string | null) {
  const base = (note ?? "").trim();
  const upgrade = (upgradeInfo ?? "").trim();
  if (!upgrade) return base;
  if (!base) return `upgrade ${upgrade}`;
  return `${base} | upgrade ${upgrade}`;
}

function isoToItDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
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
      .range(from, to);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as MatrixRule[];
    allRows.push(...rows);

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
        "id,matricola,tax_code,first_name,last_name,birth_date,birth_place,mobile,email_primary,responsible_code,referral,site_id,sub_site_id,job_title,job_title_notes,sites(display_name),sub_sites(display_name)",
      )
      .eq("status", "attivo")
      .order("last_name")
      .range(from, to);

    if (error) {
      throw new Error(error.message);
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

function isValidForSubstitution(row: CourseStatusRow, todayIso: string) {
  if (row.manual_state === "escluso") return false;
  if (row.manual_state === "programmato") return false;
  if (row.planned_date && !row.completion_date) return false;
  return isValidCourseStatus(row, todayIso);
}

function buildValidCompletedCourseIdSet(statusRows: CourseStatusRow[], todayIso: string) {
  const set = new Set<number>();
  statusRows.forEach((row) => {
    if (isValidCourseStatus(row, todayIso)) set.add(row.course_id);
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
  todayIso: string;
}) {
  const { requiredCourseId, statusEntry, employeeStatusRows, substitutersByToCourseId, todayIso } = args;
  if (statusEntry?.manual_state === "escluso") return null;

  const substituters = substitutersByToCourseId.get(requiredCourseId);
  if (!substituters || substituters.size === 0) return null;

  const candidates = employeeStatusRows.filter(
    (row) => substituters.has(row.course_id) && isValidForSubstitution(row, todayIso),
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
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ScopeExclusionRow[];
}

async function fetchAllTrainingEmployeeExclusions(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("training_employee_exclusions")
    .select("employee_id,is_active")
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as TrainingEmployeeExclusionRow[];
}

async function fetchAllTrainingEmployeeCourseExclusions(
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from("training_employee_course_exclusions")
    .select("employee_id,course_id,is_active")
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as TrainingEmployeeCourseExclusionRow[];
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
  courseMap: Map<number, { code: string; title: string; is_active: boolean }>,
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
    const winnerCode = family.find((code) => requiredCodes.has(code));
    if (!winnerCode) return;

    family.forEach((code) => {
      if (code === winnerCode) return;
      const losingId = findCourseIdByCode(code, courseMap);
      if (losingId !== null) result.delete(losingId);
    });
  });

  return result;
}

function findCourseIdByCode(
  code: string,
  courseMap: Map<number, { code: string; title: string; is_active: boolean }>,
) {
  for (const [courseId, course] of courseMap.entries()) {
    if (course.code === code) return courseId;
  }
  return null;
}

function findRequiredFormSpecCourse(
  requiredCourseIds: Set<number>,
  courseMap: Map<number, { code: string; title: string; is_active: boolean }>,
) {
  for (const courseId of requiredCourseIds) {
    const code = courseMap.get(courseId)?.code ?? "";
    if (code.startsWith("FORM_SPEC_")) {
      return { courseId, code };
    }
  }
  return null;
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
  courseMap: Map<number, { id: number; code: string; title: string; is_active: boolean }>;
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
    todayIso,
  });
  if (substituteForSpec) return null;

  const formBaseState = resolveCourseState(formBaseStatus, freeze, todayIso, expiringDays, false);
  const rawSpecState = resolveCourseState(effectiveSpecStatus, freeze, todayIso, expiringDays, false);
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
  if (row.planned_date && !row.completion_date) return false;
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
  courseMap: Map<number, { code: string; title: string; is_active: boolean }>;
  todayIso: string;
}) {
  const candidates: Array<{ courseId: number; courseCode: string; familyIndex: number }> = [];

  for (const sr of statusRows) {
    const course = courseMap.get(sr.course_id);
    if (!course) continue;
    if (!family.includes(course.code)) continue;
    const idx = family.indexOf(course.code);
    if (idx <= requiredIndex) continue;
    if (!isValidCourseStatus(sr, todayIso)) continue;
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
  courseMap: Map<number, { code: string; title: string; is_active: boolean }>;
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
    if (!isValidCourseStatus(sr, todayIso)) continue;
    candidates.push({ courseId: sr.course_id, courseCode: course.code, familyIndex: idx });
  }

  candidates.sort((a, b) => b.familyIndex - a.familyIndex);
  return candidates[0] ?? null;
}

function isValidCourseStatus(row: CourseStatusRow, todayIso: string) {
  if (row.manual_state === "escluso") return false;
  if (row.manual_state === "programmato") return false;
  if (!row.completion_date) return false;
  if (!row.expiry_date) return true;
  const expiryKey = parseDateOnlyKey(row.expiry_date);
  if (!expiryKey) return true;
  const expiryIso = normalizeDateOnlyIso(String(row.expiry_date));
  if (expiryIso && isSentinelUnlimitedDate(expiryIso)) return true;
  const todayKey = parseDateOnlyKey(todayIso) ?? parseDateOnlyKey(todayLocalIso());
  if (!todayKey) return true;
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
  if (row.manual_state === "programmato") return "programmato";

  if (row.planned_date && !row.completion_date) {
    return "programmato";
  }

  if (!row.completion_date) {
    return isUpgrade ? "upgrade" : "da fare";
  }

  if (!row.expiry_date) {
    return "idoneo";
  }
  const expiryKey = parseDateOnlyKey(row.expiry_date);
  if (!expiryKey) return "idoneo";
  const expiryIso = normalizeDateOnlyIso(String(row.expiry_date));
  if (expiryIso && isSentinelUnlimitedDate(expiryIso)) return "idoneo";

  const todayKey = parseDateOnlyKey(todayIso) ?? parseDateOnlyKey(todayLocalIso());
  if (!todayKey) return "idoneo";
  const thresholdKey = addDaysKey(todayKey, expiringDays);

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
