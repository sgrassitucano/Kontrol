import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { applyCalibri10WithBoldHeader } from "@/lib/excel";
import { normalizeJobCode } from "@/lib/training/normalize";
import { requireModuleAccess } from "@/lib/api/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  stato: "idoneo" | "in scadenza" | "scaduto" | "da fare" | "sospeso" | "programmato" | "upgrade" | "escluso";
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

    const supabase = auth.supabase;

    const [
      employees,
      { data: courses, error: coursesError },
      rules,
      courseRows,
      freezes,
      scopeExclusions,
      employeeExclusions,
      courseExclusions,
    ] = await Promise.all([
      fetchAllEmployees(supabase),
      supabase.from("training_courses").select("id,code,title,is_active"),
      fetchAllRules(supabase),
      fetchAllCourseRows(supabase),
      fetchAllFreezes(supabase),
      fetchAllScopeExclusions(supabase),
      fetchAllTrainingEmployeeExclusions(supabase),
      fetchAllTrainingEmployeeCourseExclusions(supabase),
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
      if (excludedEmployeeIds.has(employee.id)) return true;
      if (typeof employee.sub_site_id === "number" && excludedSubSiteIds.has(employee.sub_site_id)) return true;
      if (typeof employee.site_id === "number" && excludedSiteIds.has(employee.site_id)) return true;
      return false;
    };

    const activeFreeze = buildActiveFreezeMap((freezes ?? []) as FreezeRow[]);
    const courseMap = new Map((courses ?? []).map((course) => [course.id, course]));
    const statusRows = (courseRows ?? []) as CourseStatusRow[];
    const statusMap = new Map(statusRows.map((row) => [`${row.employee_id}:${row.course_id}`, row]));
    const statusByEmployee = buildStatusByEmployeeMap(statusRows);
    const rulesByScope = groupRulesByScope((rules ?? []) as MatrixRule[]);

    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + (Number.isFinite(expiringDays) ? expiringDays : 30));
    const today = new Date();

    const rows: WorkerCourseRow[] = [];

    const leveledFamilies: readonly (readonly string[])[] = [
      ["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"],
      ["CORSO_AI_3", "CORSO_AI_2", "CORSO_AI_1"],
    ];

    const requiredRiskByEmployeeId = new Map<number, "basso" | "medio" | "alto">();

    for (const employee of employees.filter((row) => !shouldExcludeEmployee(row))) {
      const rawRequiredIds = resolveRequiredCourseIds(employee, rulesByScope);
      const requiredCourseIds = collapseLeveledCourseRequirements(rawRequiredIds, courseMap);
      const employeeStatusRows = statusByEmployee.get(employee.id) ?? [];

      const upgradeInfoByCourseId = new Map<number, string>();
      const upgradeCourseIds = new Set<number>();
      const suppressedAdditionalCourseIds = new Set<number>();
      const skipRequiredCourseIds = new Set<number>();

      const formBaseCourseId = findCourseIdByCode("FORM_BASE", courseMap);
      const formSpecRequired = findRequiredFormSpecCourse(requiredCourseIds, courseMap);

      if (formSpecRequired) {
        const risk = formSpecRequired.code.slice("FORM_SPEC_".length).toLowerCase();
        if (risk === "basso" || risk === "medio" || risk === "alto") {
          requiredRiskByEmployeeId.set(employee.id, risk);
        }
      }

      if (
        typeof formBaseCourseId === "number" &&
        requiredCourseIds.has(formBaseCourseId) &&
        formSpecRequired
      ) {
        const freeze = activeFreeze.get(employee.id);
        const baseAggregate = buildBaseAggregateRow({
          employee,
          formBaseCourseId,
          formSpecRequired,
          courseMap,
          statusMap,
          employeeStatusRows,
          freeze,
          thresholdDate,
          today,
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

      for (const courseId of requiredCourseIds) {
        if (skipRequiredCourseIds.has(courseId)) continue;
        const course = courseMap.get(courseId);
        if (!course) continue;

        const family = leveledFamilies.find((fam) => fam.includes(course.code));
        if (family) {
          const reqIndex = family.indexOf(course.code);
          const bestLower = findBestLowerValidCourse({
            statusRows: employeeStatusRows,
            family,
            requiredIndex: reqIndex,
            courseMap,
            today,
          });

          if (bestLower) {
            const from = levelLabel(bestLower.courseCode) ?? bestLower.courseCode;
            const to = levelLabel(course.code) ?? course.code;
            upgradeInfoByCourseId.set(bestLower.courseId, `${from} → ${to}`);
            upgradeCourseIds.add(bestLower.courseId);
            continue;
          }
        }

        const statusEntry = statusMap.get(`${employee.id}:${courseId}`);
        const freeze = activeFreeze.get(employee.id);
        const courseExcluded = excludedCourseIdsByEmployee.get(employee.id)?.has(courseId) ?? false;
        const state = courseExcluded ? "escluso" : resolveCourseState(statusEntry, freeze, thresholdDate, false);

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
          dataConclusione: statusEntry?.completion_date ?? null,
          dataScadenza: statusEntry?.expiry_date ?? null,
          stato: state as WorkerCourseRow["stato"],
          upgradeInfo: null,
          responsabile: employee.responsible_code,
          referente: employee.referral ?? "",
          note: statusEntry?.note ?? "",
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
        const baseState = freeze
          ? "sospeso"
          : isUpgrade
            ? "upgrade"
            : resolveCourseState(statusEntry, freeze, thresholdDate);
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

    const headersBasso = [
      "cognome",
      "nome",
      "data nascita",
      "luogo nascita",
      "mail",
      "cellulare",
      "codice fiscale",
      "mansione",
      "cantiere",
      "sottocantiere",
      "responsabile",
      "referente",
      "tipo corso",
      "scadenza",
      "note",
    ] as const;

    const headers = [
      "cognome",
      "nome",
      "data nascita",
      "luogo nascita",
      "codice fiscale",
      "mansione",
      "cantiere",
      "sottocantiere",
      "responsabile",
      "referente",
      "tipo corso",
      "scadenza",
      "note",
    ] as const;

    const sheet1: Record<(typeof headersBasso)[number], string>[] = [];
    const sheet2: Record<(typeof headers)[number], string>[] = [];
    const sheet3: Record<(typeof headers)[number], string>[] = [];
    const sheet4: Record<(typeof headers)[number], string>[] = [];
    const sheet5: Record<(typeof headers)[number], string>[] = [];
    const sheet6: Record<(typeof headers)[number], string>[] = [];

    rows.forEach((row) => {
      if (row.stato === "idoneo" || row.stato === "escluso") return;
      const employee = employeeById.get(row.workerId);
      if (!employee) return;

      const basePayload = buildExportPayload(employee, row);
      const isProgrammato = row.stato === "programmato";
      const isGenSpec = row.corsoCode.startsWith("FORM_BASE+FORM_SPEC_");
      const isSpec = row.corsoCode.startsWith("FORM_SPEC_");
      const isBaseOnly = row.corsoCode === "FORM_BASE";
      const isSpecificUpdate =
        isSpec && (row.stato === "scaduto" || row.stato === "in scadenza") && Boolean(row.dataConclusione);
      const isUpgrade = row.stato === "upgrade";

      if (isProgrammato) {
        sheet5.push(basePayload);
        return;
      }

      if (isSpecificUpdate) {
        sheet4.push(basePayload);
        return;
      }

      if (isGenSpec || isSpec || isBaseOnly) {
        const requiredRisk = requiredRiskByEmployeeId.get(row.workerId) ?? "medio";
        const baseRisk = isBaseOnly ? requiredRisk : extractRiskFromBaseCode(row.corsoCode);

        const targetRisk = isUpgrade
          ? (extractUpgradeTargetRisk(row.upgradeInfo) ?? requiredRisk)
          : baseRisk;

        if (targetRisk === "basso") {
          sheet1.push(buildExportPayloadBasso(employee, row));
          return;
        }
        if (targetRisk === "medio") {
          sheet2.push(basePayload);
          return;
        }
        sheet3.push(basePayload);
        return;
      }

      sheet6.push(basePayload);
    });

    const ws1 = XLSX.utils.json_to_sheet(sheet1, { header: [...headersBasso] });
    const ws2 = XLSX.utils.json_to_sheet(sheet2, { header: [...headers] });
    const ws3 = XLSX.utils.json_to_sheet(sheet3, { header: [...headers] });
    const ws4 = XLSX.utils.json_to_sheet(sheet4, { header: [...headers] });
    const ws5 = XLSX.utils.json_to_sheet(sheet5, { header: [...headers] });
    const ws6 = XLSX.utils.json_to_sheet(sheet6, { header: [...headers] });

    applyCalibri10WithBoldHeader(ws1);
    applyCalibri10WithBoldHeader(ws2);
    applyCalibri10WithBoldHeader(ws3);
    applyCalibri10WithBoldHeader(ws4);
    applyCalibri10WithBoldHeader(ws5);
    applyCalibri10WithBoldHeader(ws6);

    XLSX.utils.book_append_sheet(workbook, ws1, "1-base_basso");
    XLSX.utils.book_append_sheet(workbook, ws2, "2-base_medio");
    XLSX.utils.book_append_sheet(workbook, ws3, "3-base_alto");
    XLSX.utils.book_append_sheet(workbook, ws4, "4-agg_specifica");
    XLSX.utils.book_append_sheet(workbook, ws5, "5-programmati");
    XLSX.utils.book_append_sheet(workbook, ws6, "6-operativi");

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

function buildExportPayload(employee: EmployeeRow, row: WorkerCourseRow) {
  const scadenza = row.dataScadenza ? isoToItDate(row.dataScadenza) : "";
  const dataNascita = employee.birth_date ? isoToItDate(employee.birth_date) : "";
  const note = mergeNotesForExport(row.note, row.stato === "upgrade" ? row.upgradeInfo : null);
  const tipoCorso = buildTipoCorso(row);

  return {
    "cognome": employee.last_name ?? "",
    "nome": employee.first_name ?? "",
    "data nascita": dataNascita,
    "luogo nascita": employee.birth_place ?? "",
    "codice fiscale": employee.tax_code ?? "",
    "mansione": employee.job_title ?? "",
    "cantiere": extractDisplayName(employee.sites),
    "sottocantiere": extractDisplayName(employee.sub_sites),
    "responsabile": employee.responsible_code ?? "",
    "referente": employee.referral ?? "",
    "tipo corso": tipoCorso,
    "scadenza": scadenza,
    "note": note,
  };
}

function buildExportPayloadBasso(employee: EmployeeRow, row: WorkerCourseRow) {
  const base = buildExportPayload(employee, row);
  return {
    "cognome": base["cognome"],
    "nome": base["nome"],
    "data nascita": base["data nascita"],
    "luogo nascita": base["luogo nascita"],
    "mail": employee.email_primary ?? "",
    "cellulare": employee.mobile ?? "",
    "codice fiscale": base["codice fiscale"],
    "mansione": base["mansione"],
    "cantiere": base["cantiere"],
    "sottocantiere": base["sottocantiere"],
    "responsabile": base["responsabile"],
    "referente": base["referente"],
    "tipo corso": base["tipo corso"],
    "scadenza": base["scadenza"],
    "note": base["note"],
  };
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

function extractUpgradeTargetRisk(value: string | null) {
  const raw = (value ?? "").trim().toLowerCase();
  const match = raw.match(/->\s*(basso|medio|alto)/);
  if (!match) return null;
  const risk = match[1];
  if (risk === "basso" || risk === "medio" || risk === "alto") return risk;
  return null;
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

async function fetchAllRules(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
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

async function fetchAllCourseRows(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
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

async function fetchAllFreezes(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
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

async function fetchAllEmployees(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: EmployeeRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employees")
      .select(
        "id,matricola,tax_code,first_name,last_name,birth_date,birth_place,mobile,email_primary,responsible_code,referral,site_id,sub_site_id,job_title,sites(display_name),sub_sites(display_name)",
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

async function fetchAllScopeExclusions(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase
    .from("training_scope_exclusions")
    .select("scope_type,site_id,sub_site_id,is_active")
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ScopeExclusionRow[];
}

async function fetchAllTrainingEmployeeExclusions(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
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
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
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

  grouped.baseline.forEach((rule) => ids.add(rule.course_id));
  grouped.job
    .filter((rule) => rule.job_code_norm === normalizedJob)
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
  freeze,
  thresholdDate,
  today,
}: {
  employee: EmployeeRow;
  formBaseCourseId: number;
  formSpecRequired: { courseId: number; code: string };
  courseMap: Map<number, { id: number; code: string; title: string; is_active: boolean }>;
  statusMap: Map<string, CourseStatusRow>;
  employeeStatusRows: CourseStatusRow[];
  freeze: FreezeRow | undefined;
  thresholdDate: Date;
  today: Date;
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
          today,
        })
      : null;

  const shouldUpgrade =
    !formSpecRequiredStatus?.completion_date && bestLower !== null;

  if (shouldUpgrade) {
    return null;
  }

  const effectiveSpecCourseId = shouldUpgrade ? bestLower.courseId : formSpecRequired.courseId;
  const effectiveSpecStatus = shouldUpgrade
    ? employeeStatusRows.find((row) => row.course_id === effectiveSpecCourseId)
    : formSpecRequiredStatus;

  const formBaseState = resolveCourseState(formBaseStatus, freeze, thresholdDate, false);
  const rawSpecState = resolveCourseState(effectiveSpecStatus, freeze, thresholdDate, false);
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
  return a >= b ? a : b;
}

function pickEarliestDate(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function findBestLowerValidCourse({
  statusRows,
  family,
  requiredIndex,
  courseMap,
  today,
}: {
  statusRows: CourseStatusRow[];
  family: readonly string[];
  requiredIndex: number;
  courseMap: Map<number, { code: string; title: string; is_active: boolean }>;
  today: Date;
}) {
  const candidates: Array<{ courseId: number; courseCode: string; familyIndex: number }> = [];

  for (const sr of statusRows) {
    const course = courseMap.get(sr.course_id);
    if (!course) continue;
    if (!family.includes(course.code)) continue;
    const idx = family.indexOf(course.code);
    if (idx <= requiredIndex) continue;
    if (!isValidCourseStatus(sr, today)) continue;
    candidates.push({ courseId: sr.course_id, courseCode: course.code, familyIndex: idx });
  }

  candidates.sort((a, b) => a.familyIndex - b.familyIndex);
  return candidates[0] ?? null;
}

function isValidCourseStatus(row: CourseStatusRow, today: Date) {
  if (!row.completion_date) return false;
  if (!row.expiry_date) return true;
  return new Date(row.expiry_date) >= today;
}

function buildActiveFreezeMap(rows: FreezeRow[]) {
  const now = new Date();
  const map = new Map<number, FreezeRow>();

  rows.forEach((row) => {
    const start = new Date(row.start_date);
    const end = row.end_date ? new Date(row.end_date) : null;
    const active = start <= now && (!end || end >= now);
    if (active) {
      map.set(row.employee_id, row);
    }
  });

  return map;
}

function resolveCourseState(
  row: CourseStatusRow | undefined,
  freeze: FreezeRow | undefined,
  thresholdDate: Date,
  isUpgrade: boolean = false
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

  const expiry = new Date(row.expiry_date);
  const today = new Date();

  if (expiry < today) return "scaduto";
  if (expiry <= thresholdDate) return "in scadenza";
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
