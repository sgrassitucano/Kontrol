import { NextResponse } from "next/server";
import { buildJobVariantKey, normalizeJobCode } from "@/lib/training/normalize";
import { requireAnyModuleAccess } from "@/lib/api/access";
import { cacheGet, cacheSet } from "@/lib/server-cache";
import { resolveCourseState, isValidCourseStatus, findBrokenPrerequisiteChain } from "@/lib/training/engine";
import type { SupabaseClient } from "@supabase/supabase-js";

type EmployeeRow = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
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

export type CourseStatusRow = {
  employee_id: number;
  course_id: number;
  completion_date: string | null;
  expiry_date: string | null;
  planned_date: string | null;
  manual_state: "programmato" | "escluso" | null;
  note: string | null;
};

export type CourseRow = {
  id: number;
  code: string;
  title: string;
  is_active: boolean;
  validity_years: number | null;
  is_unlimited: boolean;
};

type WorkerCourseRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  courseId?: number;
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
  blockedBy?: { code: string; title: string } | null;
  responsabile: string;
  referente: string;
  note: string;
  origine: "obbligatorio" | "aggiuntivo";
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

export const runtime = "nodejs";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const MAX_EMPLOYEES = 20000;
const MAX_RULES = 50000;
const MAX_RULE_LINKS = 100000;
const MAX_COURSES = 20000;
const MAX_COURSE_ROWS = 200000;
const MAX_FREEZES = 50000;
const MAX_SCOPE_EXCLUSIONS = 100000;
const MAX_EMPLOYEE_EXCLUSIONS = 100000;
const MAX_COURSE_EXCLUSIONS = 200000;
const MAX_OUTPUT_ROWS = 200000;

class TooManyRowsError extends Error {
  status = 400;
}

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

function parseOffsetParam(value: string | null) {
  if (!value) return 0;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchSearchQuery(parts: Array<string | null | undefined>, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText(parts.filter(Boolean).join(" "));
  if (!haystack) return false;
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

export async function GET(request: Request) {
  const auth = await requireAnyModuleAccess(["lavoratori", "formazione"], false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const expiringDays = Number(url.searchParams.get("expiringDays") ?? "30");
    const dateParam = url.searchParams.get("date");
    const employeeIdParam = url.searchParams.get("employeeId");
    const employeeId = employeeIdParam ? Number(employeeIdParam) : null;
    const panel = url.searchParams.get("panel") ?? "lavoratori";
    const applyFormazioneExclusions = panel === "formazione";
    const includeExcluded = url.searchParams.get("includeExcluded") === "1";
    const limit = parseLimitParam(url.searchParams.get("limit"), query ? 200 : DEFAULT_LIMIT);
    const offset = parseOffsetParam(url.searchParams.get("offset"));

    const expiringDaysSafeRaw = Number.isFinite(expiringDays) ? expiringDays : 30;
    const expiringDaysSafe = Math.min(Math.max(expiringDaysSafeRaw, 0), 365);
    const todayIso =
      typeof dateParam === "string" && normalizeDateOnlyIso(dateParam) ? normalizeDateOnlyIso(dateParam)! : todayLocalIso();

    const rowsCacheKey = `training_rows_v2:${auth.userId}:${panel}:${includeExcluded ? 1 : 0}:${String(
      typeof employeeId === "number" && Number.isFinite(employeeId) ? employeeId : "all",
    )}:${query || "-"}:${todayIso}:${expiringDaysSafe}`;
    const rowsCached = cacheGet<{
      rows: WorkerCourseRow[];
      meta: {
        totalActiveEmployees: number;
        excludedByScopeEmployees: number;
        frozenEmployees: number;
        eligibleEmployees: number;
        eligibleOperativiEmployees: number;
      };
    }>(rowsCacheKey);
    if (rowsCached) {
      const totalRows = rowsCached.rows.length;
      const pagedRows = rowsCached.rows.slice(offset, offset + limit);
      const truncated = offset + limit < totalRows;
      return NextResponse.json({
        limit,
        offset,
        truncated,
        rows: pagedRows,
        totalRows,
        totalActiveEmployees: rowsCached.meta.totalActiveEmployees,
        excludedByScopeEmployees: rowsCached.meta.excludedByScopeEmployees,
        frozenEmployees: rowsCached.meta.frozenEmployees,
        eligibleEmployees: rowsCached.meta.eligibleEmployees,
        eligibleOperativiEmployees: rowsCached.meta.eligibleOperativiEmployees,
        expiringDays: expiringDaysSafeRaw,
      });
    }

    const dataSupabase = auth.supabase;

    const employees =
      typeof employeeId === "number" && Number.isFinite(employeeId)
        ? await fetchEmployeeById(dataSupabase, employeeId)
        : await fetchAllEmployees(dataSupabase);

    const employeeIds = Array.from(new Set(employees.map((e) => e.id)));

    const staticKey = "training_static_v1";
    const staticCached = cacheGet<{ courses: CourseRow[]; rules: MatrixRule[]; ruleLinks: RuleLinkRow[] }>(staticKey);
    const staticLoaded = staticCached ?? (await (async () => {
      const [{ data: courses, error: coursesError }, rules, ruleLinks] = await Promise.all([
        dataSupabase
          .from("training_courses")
          .select("id,code,title,is_active,validity_years,is_unlimited")
          .limit(MAX_COURSES + 1),
        fetchAllRules(dataSupabase),
        fetchAllRuleLinks(dataSupabase),
      ]);
      if (coursesError) throw new Error(coursesError.message);
      const courseRows = (courses ?? []) as CourseRow[];
      if (courseRows.length > MAX_COURSES) {
        throw new TooManyRowsError(
          `Troppi corsi formazione (> ${MAX_COURSES}). Restringi il dataset o applica paginazione.`,
        );
      }
      // Difesa: gli aggiornamenti non sono mai un obbligo diretto in matrice, sono impliciti
      // nel corso nativo. Scarta eventuali regole matrice sporche che li puntano direttamente.
      const aggiornamentoCourseIds = new Set(
        courseRows.filter((c) => c.code.endsWith("_AGGIORNAMENTO")).map((c) => c.id),
      );
      const cleanRules = ((rules ?? []) as MatrixRule[]).filter((rule) => !aggiornamentoCourseIds.has(rule.course_id));

      const out = {
        courses: courseRows,
        rules: cleanRules,
        ruleLinks: (ruleLinks ?? []) as RuleLinkRow[],
      };
      cacheSet(staticKey, out, 5 * 60 * 1000);
      return out;
    })());

    const scopeKey = "training_scope_exclusions_v1";
    const scopeCached = applyFormazioneExclusions ? cacheGet<ScopeExclusionRow[]>(scopeKey) : null;
    const [
      courseRows,
      freezes,
      scopeExclusions,
      employeeExclusions,
      courseExclusions,
    ] = await Promise.all([
      fetchCourseRowsByEmployeeIds(dataSupabase, employeeIds),
      fetchFreezesByEmployeeIds(dataSupabase, employeeIds),
      applyFormazioneExclusions
        ? scopeCached ?? fetchAllScopeExclusions(dataSupabase)
        : Promise.resolve([] as ScopeExclusionRow[]),
      applyFormazioneExclusions
        ? fetchTrainingEmployeeExclusionsByEmployeeIds(dataSupabase, employeeIds)
        : Promise.resolve([] as TrainingEmployeeExclusionRow[]),
      applyFormazioneExclusions
        ? fetchTrainingEmployeeCourseExclusionsByEmployeeIds(dataSupabase, employeeIds)
        : Promise.resolve([] as TrainingEmployeeCourseExclusionRow[]),
    ]);
    if (applyFormazioneExclusions && scopeCached === null) cacheSet(scopeKey, scopeExclusions, 60 * 1000);

    const activeFreeze = buildActiveFreezeMap((freezes ?? []) as FreezeRow[], todayIso);
    const courseMap = new Map(staticLoaded.courses.map((course) => [course.id, course]));
    const statusRows = (courseRows ?? []) as CourseStatusRow[];
    const statusMap = new Map(statusRows.map((row) => [`${row.employee_id}:${row.course_id}`, row]));
    const statusByEmployee = buildStatusByEmployeeMap(statusRows);
    const rulesByScope = groupRulesByScope(staticLoaded.rules);
    const substitutersByToCourseId = buildSubstitutersByToCourseId(staticLoaded.ruleLinks);
    const substitutionTargetsByFromCourseId = buildSubstitutionTargetsByFromCourseId(staticLoaded.ruleLinks);
    const exemptionsByFromCourseId = buildExemptionsByFromCourseId(staticLoaded.ruleLinks);
    const prerequisitesByFromCourseId = buildPrerequisitesByFromCourseId(staticLoaded.ruleLinks);

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

    const isEmployeeExcludedByScopeForList = (employee: EmployeeRow) => {
      if (!applyFormazioneExclusions) return false;
      if (typeof employeeId === "number") return false;
      if (excludedEmployeeIds.has(employee.id)) return true;
      if (typeof employee.sub_site_id === "number" && excludedSubSiteIds.has(employee.sub_site_id)) return true;
      if (typeof employee.site_id === "number" && excludedSiteIds.has(employee.site_id)) return true;
      return false;
    };

    const shouldExcludeEmployee = (employee: EmployeeRow) => {
      if (!applyFormazioneExclusions) return false;
      if (includeExcluded) return false;
      if (query) return false;
      return isEmployeeExcludedByScopeForList(employee);
    };

    const rows: WorkerCourseRow[] = [];
    const pushRow = (row: WorkerCourseRow) => {
      rows.push(row);
      if (rows.length > MAX_OUTPUT_ROWS) {
        throw new TooManyRowsError(
          `Troppi risultati corsi lavoratori (> ${MAX_OUTPUT_ROWS}). Restringi il dataset o applica filtri.`,
        );
      }
    };
    const pushRows = (items: WorkerCourseRow[]) => {
      for (const item of items) pushRow(item);
    };

    const leveledFamilies: readonly (readonly string[])[] = [
      ["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"],
      ["CORSO_AI_3", "CORSO_AI_2", "CORSO_AI_1"],
    ];

    const scopedEmployeesRaw =
      typeof employeeId === "number" && Number.isFinite(employeeId)
        ? employees.filter((employee) => employee.id === employeeId)
        : employees;

    const totalActiveEmployees = scopedEmployeesRaw.length;
    const scopedEmployees = scopedEmployeesRaw.filter((employee) => !shouldExcludeEmployee(employee));
    const excludedByScopeEmployees = totalActiveEmployees - scopedEmployees.length;

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

    // Sottoinsieme di baseCodes con rendering combinato dedicato (buildTrainingBaseSectionRows).
    // RLS/RSPP/DIR non hanno una riga speciale: se completati ma non richiesti da matrice
    // devono comunque comparire come corso aggiuntivo, non sparire silenziosamente.
    const formBaseFamilyCodes = new Set(["FORM_BASE", "FORM_SPEC_BASSO", "FORM_SPEC_MEDIO", "FORM_SPEC_ALTO"]);

    let frozenEmployees = 0;
    let eligibleEmployees = 0;
    let eligibleOperativiEmployees = 0;

    for (const employee of scopedEmployees) {
      const excludedCourseIds = applyFormazioneExclusions ? excludedCourseIdsByEmployee.get(employee.id) ?? null : null;
      const excludedCourseCodes = excludedCourseIds ? buildExcludedCourseCodeSet(excludedCourseIds, courseMap) : null;
      const rawRequiredIds = resolveRequiredCourseIds(employee, rulesByScope);
      const employeeStatusRows = statusByEmployee.get(employee.id) ?? [];
      const employeeStatusByCourseId = new Map(employeeStatusRows.map((row) => [row.course_id, row]));
      const validCompletedCourseIds = buildValidCompletedCourseIdSet(employeeStatusRows, courseMap, todayIso, excludedCourseIds);
      let requiredCourseIds = expandCombinedBaseRequirements(
        collapseLeveledCourseRequirements(rawRequiredIds, courseMap, excludedCourseCodes),
        courseMap,
      );
      applyExemptions(requiredCourseIds, validCompletedCourseIds, exemptionsByFromCourseId);
      expandPrerequisites(requiredCourseIds, prerequisitesByFromCourseId);
      requiredCourseIds = expandCombinedBaseRequirements(
        collapseLeveledCourseRequirements(requiredCourseIds, courseMap, excludedCourseCodes),
        courseMap,
      );
      applyExemptions(requiredCourseIds, validCompletedCourseIds, exemptionsByFromCourseId);

      const freeze = activeFreeze.get(employee.id);
      if (freeze) frozenEmployees += 1;
      else {
        eligibleEmployees += 1;
        const excludedCoursesForEmployee = excludedCourseIdsByEmployee.get(employee.id) ?? null;
        const hasOperativi = employeeStatusRows.some((statusEntry) => {
          const course = courseMap.get(statusEntry.course_id);
          if (!course) return false;
          if (baseCodes.has(course.code) || course.code.startsWith("FORM_BASE+")) return false;
          if (applyFormazioneExclusions && excludedCoursesForEmployee?.has(statusEntry.course_id)) return false;
          if (statusEntry.manual_state === "escluso") return false;
          return Boolean(
            statusEntry.completion_date || statusEntry.planned_date || statusEntry.manual_state === "programmato",
          );
        });
        if (hasOperativi) eligibleOperativiEmployees += 1;
      }

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
        const excludedSet = excludedCourseIds;
        const baseCourseExcluded = excludedSet?.has(formBaseCourseId) ?? false;
        const specCourseExcluded = excludedSet?.has(formSpecRequired.courseId) ?? false;
        const shouldBuildBaseSection = !baseCourseExcluded && !specCourseExcluded;

        if (shouldBuildBaseSection) {
          const baseSection = buildTrainingBaseSectionRows({
            employee,
            formBaseCourseId,
            formSpecRequired,
            courseMap,
            statusMap,
            employeeStatusRows,
            excludedCourseIds,
            freeze,
            todayIso,
            expiringDays: expiringDaysSafe,
          });

          if (baseSection) {
            skipRequiredCourseIds.add(formBaseCourseId);
            skipRequiredCourseIds.add(formSpecRequired.courseId);
            const filteredBaseSection = query
              ? baseSection.filter((row) =>
                  matchSearchQuery(
                    [
                      row.matricola,
                      row.cantiere,
                      row.sottocantiere,
                      row.cognome,
                      row.nome,
                      row.mansione,
                      row.responsabile,
                      row.referente,
                      row.corsoCode,
                      row.corso,
                      row.note,
                    ],
                    query,
                  ),
                )
              : baseSection;
            pushRows(filteredBaseSection);
          }
        }
      }

      for (const courseId of requiredCourseIds) {
        if (skipRequiredCourseIds.has(courseId)) continue;
        const course = courseMap.get(courseId);
        if (!course) continue;
        const freeze = activeFreeze.get(employee.id);
        const employeeExcluded = isEmployeeExcludedByScopeForList(employee);
        const courseExcluded =
          applyFormazioneExclusions && (excludedCourseIdsByEmployee.get(employee.id)?.has(courseId) ?? false);
        const family = leveledFamilies.find((fam) => fam.includes(course.code));
        if (family && !employeeExcluded && !courseExcluded) {
          const reqIndex = family.indexOf(course.code);
          const bestLower = findBestLowerValidCourse({
            statusRows: employeeStatusRows,
            family,
            requiredIndex: reqIndex,
            courseMap,
            todayIso,
            excludedCourseIds,
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
            excludedCourseIds,
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
                mansione: formatJobLabel(employee.job_title ?? ""),
                cantiere: extractDisplayName(employee.sites),
                sottocantiere: extractDisplayName(employee.sub_sites),
                courseId: bestHigher.courseId,
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

              if (
                query &&
                !matchSearchQuery(
                  [
                    outputRow.matricola,
                    outputRow.cantiere,
                    outputRow.sottocantiere,
                    outputRow.cognome,
                    outputRow.nome,
                    outputRow.mansione,
                    outputRow.responsabile,
                    outputRow.referente,
                    outputRow.corsoCode,
                    outputRow.corso,
                    outputRow.note,
                  ],
                  query,
                )
              ) {
                continue;
              }

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
        if (employeeExcluded || courseExcluded || !substitute) {
          const lost =
            !employeeExcluded &&
            !courseExcluded &&
            Boolean(statusEntry?.expiry_date) &&
            resolveCourseState(statusEntry, course, undefined, todayIso, expiringDaysSafe, false) === "perso";

          const state = employeeExcluded
            ? "escluso"
            : courseExcluded
              ? "escluso"
              : lost
                ? resolveCourseState(undefined, undefined, freeze, todayIso, expiringDaysSafe, false)
                : resolveCourseState(statusEntry, course, freeze, todayIso, expiringDaysSafe, false);

          const brokenChain =
            !employeeExcluded && !courseExcluded && !lost && state === "idoneo"
              ? findBrokenPrerequisiteChain(courseId, employeeStatusByCourseId, courseMap, prerequisitesByFromCourseId, todayIso)
              : null;

          const outputRow: WorkerCourseRow = {
            workerId: employee.id,
            matricola: employee.matricola,
            cognome: employee.last_name,
            nome: employee.first_name,
            mansione: formatJobLabel(employee.job_title ?? ""),
            cantiere: extractDisplayName(employee.sites),
            sottocantiere: extractDisplayName(employee.sub_sites),
            courseId,
            corsoCode: course.code,
            corso: course.title,
            dataConclusione: lost ? null : statusEntry?.completion_date ?? null,
            dataScadenza: lost ? null : statusEntry?.expiry_date ?? null,
            dataPrevista: lost ? null : statusEntry?.planned_date ?? null,
            stato: state as WorkerCourseRow["stato"],
            upgradeInfo: null,
            blockedBy: brokenChain ? { code: brokenChain.courseCode, title: brokenChain.courseTitle } : null,
            responsabile: employee.responsible_code,
            referente: employee.referral ?? "",
            note: lost ? "" : statusEntry?.note ?? "",
            origine: "obbligatorio",
          };

          if (
            query &&
            !matchSearchQuery(
              [
                outputRow.matricola,
                outputRow.cantiere,
                outputRow.sottocantiere,
                outputRow.cognome,
                outputRow.nome,
                outputRow.mansione,
                outputRow.responsabile,
                outputRow.referente,
                outputRow.corsoCode,
                outputRow.corso,
                outputRow.note,
              ],
              query,
            )
          ) {
            continue;
          }

          pushRow(outputRow);

          if (lost && statusEntry) {
            const lostRow: WorkerCourseRow = {
              workerId: employee.id,
              matricola: employee.matricola,
              cognome: employee.last_name,
              nome: employee.first_name,
              mansione: formatJobLabel(employee.job_title ?? ""),
              cantiere: extractDisplayName(employee.sites),
              sottocantiere: extractDisplayName(employee.sub_sites),
              courseId,
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

            if (
              query &&
              !matchSearchQuery(
                [
                  lostRow.matricola,
                  lostRow.cantiere,
                  lostRow.sottocantiere,
                  lostRow.cognome,
                  lostRow.nome,
                  lostRow.mansione,
                  lostRow.responsabile,
                  lostRow.referente,
                  lostRow.corsoCode,
                  lostRow.corso,
                  lostRow.note,
                ],
                query,
              )
            ) {
              continue;
            }

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
          mansione: formatJobLabel(employee.job_title ?? ""),
          cantiere: extractDisplayName(employee.sites),
          sottocantiere: extractDisplayName(employee.sub_sites),
          courseId: substitute.substituteCourseId,
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

        if (
          query &&
          !matchSearchQuery(
            [
              outputRow.matricola,
              outputRow.cantiere,
              outputRow.sottocantiere,
              outputRow.cognome,
              outputRow.nome,
              outputRow.mansione,
              outputRow.responsabile,
              outputRow.referente,
              outputRow.corsoCode,
              outputRow.corso,
              outputRow.note,
            ],
            query,
          )
        ) {
          continue;
        }

        pushRow(outputRow);
      }

      for (const statusEntry of employeeStatusRows) {
        if (suppressedAdditionalCourseIds.has(statusEntry.course_id)) continue;
        if (requiredCourseIds.has(statusEntry.course_id)) continue;
        const course = courseMap.get(statusEntry.course_id);
        if (!course) continue;
        if (formBaseFamilyCodes.has(course.code) || course.code.startsWith("FORM_BASE+")) continue;

        const freeze = activeFreeze.get(employee.id);
        const isUpgrade = upgradeCourseIds.has(statusEntry.course_id);
        const employeeExcluded = isEmployeeExcludedByScopeForList(employee);
        const courseExcluded =
          applyFormazioneExclusions &&
          (excludedCourseIdsByEmployee.get(employee.id)?.has(statusEntry.course_id) ?? false);
        const lost = resolveCourseState(statusEntry, course, undefined, todayIso, expiringDaysSafe) === "perso";
        const baseState = lost
          ? "perso"
          : freeze
            ? "sospeso"
            : isUpgrade
              ? "upgrade"
              : resolveCourseState(statusEntry, course, freeze, todayIso, expiringDaysSafe);
        const state = employeeExcluded ? "escluso" : courseExcluded ? "escluso" : baseState;

        const outputRow: WorkerCourseRow = {
          workerId: employee.id,
          matricola: employee.matricola,
          cognome: employee.last_name,
          nome: employee.first_name,
          mansione: formatJobLabel(employee.job_title ?? ""),
          cantiere: extractDisplayName(employee.sites),
          sottocantiere: extractDisplayName(employee.sub_sites),
          courseId: statusEntry.course_id,
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

        if (
          query &&
          !matchSearchQuery(
            [
              outputRow.matricola,
              outputRow.cantiere,
              outputRow.sottocantiere,
              outputRow.cognome,
              outputRow.nome,
              outputRow.mansione,
              outputRow.responsabile,
              outputRow.referente,
              outputRow.corsoCode,
              outputRow.corso,
              outputRow.note,
            ],
            query,
          )
        ) {
          continue;
        }

        pushRow(outputRow);
      }

    }

    rows.sort((a, b) => {
      const bySurname = a.cognome.localeCompare(b.cognome);
      if (bySurname !== 0) return bySurname;
      const byName = a.nome.localeCompare(b.nome);
      if (byName !== 0) return byName;
      return a.corsoCode.localeCompare(b.corsoCode);
    });

    cacheSet(
      rowsCacheKey,
      {
        rows,
        meta: {
          totalActiveEmployees,
          excludedByScopeEmployees,
          frozenEmployees,
          eligibleEmployees,
          eligibleOperativiEmployees,
        },
      },
      10 * 60 * 1000,
    );

    const totalRows = rows.length;
    const pagedRows = rows.slice(offset, offset + limit);
    const truncated = offset + limit < totalRows;

    return NextResponse.json({
      limit,
      offset,
      truncated,
      rows: pagedRows,
      totalRows,
      totalActiveEmployees,
      excludedByScopeEmployees,
      frozenEmployees,
      eligibleEmployees,
      eligibleOperativiEmployees,
      expiringDays: Number.isFinite(expiringDays) ? expiringDays : 30,
    });
  } catch (error) {
    if (error instanceof TooManyRowsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Errore caricamento tabella lavoratori.",
      },
      { status: 500 },
    );
  }
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
    if (allRows.length > MAX_RULES) {
      throw new TooManyRowsError(
        `Troppe regole matrice formazione (> ${MAX_RULES}). Restringi il dataset o applica paginazione.`,
      );
    }

    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }
  return allRows;
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchCourseRowsByEmployeeIds(supabase: SupabaseClient, employeeIds: number[]) {
  const ids = employeeIds.filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return [] as CourseStatusRow[];
  const all: CourseStatusRow[] = [];
  for (const chunk of chunkArray(ids, 500)) {
    const pageSize = 1000;
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("training_employee_courses")
        .select("employee_id,course_id,completion_date,expiry_date,planned_date,manual_state,note")
        .in("employee_id", chunk)
        .order("employee_id")
        .range(from, to);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as CourseStatusRow[];
      all.push(...rows);
      if (all.length > MAX_COURSE_ROWS) {
        throw new TooManyRowsError(
          `Troppi record corsi lavoratori (> ${MAX_COURSE_ROWS}). Restringi il dataset o applica filtri.`,
        );
      }
      if (rows.length < pageSize) hasMore = false;
      else from += pageSize;
    }
  }
  return all;
}

async function fetchFreezesByEmployeeIds(supabase: SupabaseClient, employeeIds: number[]) {
  const ids = employeeIds.filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return [] as FreezeRow[];
  const all: FreezeRow[] = [];
  for (const chunk of chunkArray(ids, 500)) {
    const { data, error } = await supabase
      .from("employee_freeze_periods")
      .select("employee_id,freeze_status,start_date,end_date")
      .in("employee_id", chunk);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as FreezeRow[]));
    if (all.length > MAX_FREEZES) {
      throw new TooManyRowsError(
        `Troppi periodi freeze (> ${MAX_FREEZES}). Restringi il dataset o applica paginazione.`,
      );
    }
  }
  return all;
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
    if (allRows.length > MAX_RULE_LINKS) {
      throw new TooManyRowsError(
        `Troppe relazioni corsi (> ${MAX_RULE_LINKS}). Restringi il dataset o applica paginazione.`,
      );
    }

    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }
  return allRows;
}

async function fetchAllEmployees(
  supabase: SupabaseClient,
) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: EmployeeRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employees")
      .select(
        "id,matricola,first_name,last_name,responsible_code,referral,site_id,sub_site_id,job_title,job_title_notes,sites(display_name),sub_sites(display_name)",
      )
      .eq("status", "attivo")
      .order("last_name")
      .order("first_name")
      .order("id")
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as EmployeeRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EMPLOYEES) {
      throw new TooManyRowsError(
        `Troppi lavoratori per vista corsi (> ${MAX_EMPLOYEES}). Restringi il dataset o applica filtri.`,
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

async function fetchEmployeeById(supabase: SupabaseClient, employeeId: number) {
  const { data, error } = await supabase
    .from("employees")
    .select(
      "id,matricola,first_name,last_name,responsible_code,referral,site_id,sub_site_id,job_title,job_title_notes,sites(display_name),sub_sites(display_name)",
    )
    .eq("status", "attivo")
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return [] as EmployeeRow[];
  return [data as EmployeeRow];
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

async function fetchAllScopeExclusions(
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from("training_scope_exclusions")
    .select("scope_type,site_id,sub_site_id,is_active")
    .eq("is_active", true)
    .limit(MAX_SCOPE_EXCLUSIONS + 1);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as ScopeExclusionRow[];
  if (rows.length > MAX_SCOPE_EXCLUSIONS) {
    throw new TooManyRowsError(
      `Troppe esclusioni scope (> ${MAX_SCOPE_EXCLUSIONS}). Restringi il dataset o applica paginazione.`,
    );
  }
  return rows;
}

async function fetchTrainingEmployeeExclusionsByEmployeeIds(supabase: SupabaseClient, employeeIds: number[]) {
  const ids = employeeIds.filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return [] as TrainingEmployeeExclusionRow[];
  const all: TrainingEmployeeExclusionRow[] = [];
  for (const chunk of chunkArray(ids, 500)) {
    const { data, error } = await supabase
      .from("training_employee_exclusions")
      .select("employee_id,is_active")
      .eq("is_active", true)
      .in("employee_id", chunk);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as TrainingEmployeeExclusionRow[]));
    if (all.length > MAX_EMPLOYEE_EXCLUSIONS) {
      throw new TooManyRowsError(
        `Troppe esclusioni lavoratori (> ${MAX_EMPLOYEE_EXCLUSIONS}). Restringi il dataset o applica paginazione.`,
      );
    }
  }
  return all;
}

async function fetchTrainingEmployeeCourseExclusionsByEmployeeIds(supabase: SupabaseClient, employeeIds: number[]) {
  const ids = employeeIds.filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return [] as TrainingEmployeeCourseExclusionRow[];
  const all: TrainingEmployeeCourseExclusionRow[] = [];
  for (const chunk of chunkArray(ids, 500)) {
    const { data, error } = await supabase
      .from("training_employee_course_exclusions")
      .select("employee_id,course_id,is_active")
      .eq("is_active", true)
      .in("employee_id", chunk);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as TrainingEmployeeCourseExclusionRow[]));
    if (all.length > MAX_COURSE_EXCLUSIONS) {
      throw new TooManyRowsError(
        `Troppe esclusioni corsi per lavoratore (> ${MAX_COURSE_EXCLUSIONS}). Restringi il dataset o applica paginazione.`,
      );
    }
  }
  return all;
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

function expandCombinedBaseRequirements(requiredIds: Set<number>, courseMap: Map<number, CourseRow>) {
  const formBaseCourseId = findCourseIdByCode("FORM_BASE", courseMap);
  if (formBaseCourseId === null) return requiredIds;

  const result = new Set(requiredIds);
  for (const courseId of requiredIds) {
    const code = courseMap.get(courseId)?.code ?? "";
    const specCode = parseCombinedFormSpecCode(code);
    if (!specCode) continue;
    const specCourseId = findCourseIdByCode(specCode, courseMap);
    if (specCourseId === null) continue;
    result.delete(courseId);
    result.add(formBaseCourseId);
    result.add(specCourseId);
  }
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

function formatJobLabel(jobTitle: string) {
  const base = String(jobTitle ?? "").trim();
  return base;
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

function formSpecRank(code: string) {
  if (code === "FORM_SPEC_ALTO") return 3;
  if (code === "FORM_SPEC_MEDIO") return 2;
  if (code === "FORM_SPEC_BASSO") return 1;
  return 0;
}

function parseCombinedFormSpecCode(courseCode: string) {
  if (!courseCode.startsWith("FORM_BASE+")) return null;
  const suffix = courseCode.slice("FORM_BASE+".length);
  if (!suffix.startsWith("FORM_SPEC_")) return null;
  return suffix;
}

function computeEffectiveExpiryIso(statusRow: CourseStatusRow, course: CourseRow) {
  if (course.is_unlimited) return null;
  const raw = statusRow.expiry_date ? normalizeDateOnlyIso(String(statusRow.expiry_date)) : null;
  if (raw && isSentinelUnlimitedDate(raw)) return null;
  if (raw) return raw;
  const years = course.validity_years;
  if (!years || !Number.isFinite(years) || years <= 0) return null;
  if (!statusRow.completion_date) return null;
  return computeTheoreticalExpiryIso(statusRow.completion_date, years);
}

function buildTrainingBaseSectionRows({
  employee,
  formBaseCourseId,
  formSpecRequired,
  courseMap,
  statusMap,
  employeeStatusRows,
  excludedCourseIds,
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
  excludedCourseIds: Set<number> | null;
  freeze: FreezeRow | undefined;
  todayIso: string;
  expiringDays: number;
}): WorkerCourseRow[] | null {
  const formSpecFamily = ["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"] as const;

  const formBaseStatus = statusMap.get(`${employee.id}:${formBaseCourseId}`);
  const baseCourse = courseMap.get(formBaseCourseId);
  const formBaseState = resolveCourseState(formBaseStatus, baseCourse, freeze, todayIso, expiringDays, false);
  const baseCompletionKey = formBaseStatus?.completion_date ? parseDateOnlyKey(formBaseStatus.completion_date) : null;

  const requiredRank = formSpecRank(formSpecRequired.code);

  const combinedCandidates: Array<{
    statusRow: CourseStatusRow;
    course: CourseRow;
    specCode: (typeof formSpecFamily)[number];
    rank: number;
    state: WorkerCourseRow["stato"];
  }> = [];

  for (const sr of employeeStatusRows) {
    if (excludedCourseIds?.has(sr.course_id) ?? false) continue;
    const course = courseMap.get(sr.course_id);
    if (!course) continue;
    const specCodeRaw = parseCombinedFormSpecCode(course.code);
    if (!specCodeRaw) continue;
    if (!formSpecFamily.includes(specCodeRaw as (typeof formSpecFamily)[number])) continue;
    if (!sr.completion_date) continue;
    const specCode = specCodeRaw as (typeof formSpecFamily)[number];
    const state = resolveCourseState(sr, course, freeze, todayIso, expiringDays, false);
    combinedCandidates.push({ statusRow: sr, course, specCode, rank: formSpecRank(specCode), state });
  }

  const combinedBest = combinedCandidates
    .map((candidate) => {
      const ok = candidate.state === "idoneo" || candidate.state === "in scadenza";
      const meets = candidate.rank >= requiredRank;
      const expiryIso = computeEffectiveExpiryIso(candidate.statusRow, candidate.course);
      const expiryKey = expiryIso ? parseDateOnlyKey(expiryIso) : null;
      const completionKey = candidate.statusRow.completion_date ? parseDateOnlyKey(candidate.statusRow.completion_date) : null;
      return { ...candidate, ok, meets, expiryIso, expiryKey, completionKey };
    })
    .sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      if (a.meets !== b.meets) return a.meets ? -1 : 1;
      if (a.rank !== b.rank) return b.rank - a.rank;
      const ak = a.expiryKey ?? -1;
      const bk = b.expiryKey ?? -1;
      if (ak !== bk) return bk - ak;
      const ac = a.completionKey ?? -1;
      const bc = b.completionKey ?? -1;
      return bc - ac;
    })[0];

  if (combinedBest && combinedBest.ok && combinedBest.meets) {
    const risk = combinedBest.specCode.slice("FORM_SPEC_".length).toLowerCase();
    const courseCode = `FORM_BASE+${combinedBest.specCode}`;
    const courseTitle = `Formazione generale + specifica rischio ${risk}`;
    const state = combinedBest.state as WorkerCourseRow["stato"];
    const row: WorkerCourseRow = {
      workerId: employee.id,
      matricola: employee.matricola,
      cognome: employee.last_name,
      nome: employee.first_name,
      mansione: formatJobLabel(employee.job_title ?? ""),
      cantiere: extractDisplayName(employee.sites),
      sottocantiere: extractDisplayName(employee.sub_sites),
      courseId: combinedBest.statusRow.course_id,
      corsoCode: courseCode,
      corso: courseTitle,
      dataConclusione: combinedBest.statusRow.completion_date ?? null,
      dataScadenza: combinedBest.expiryIso,
      dataPrevista: combinedBest.statusRow.planned_date ?? null,
      stato: state,
      upgradeInfo: null,
      responsabile: employee.responsible_code,
      referente: employee.referral ?? "",
      note: combinedBest.statusRow.note ?? "",
      origine: "obbligatorio",
    };
    return [row];
  }

  const ownedSpecByCode = new Map<string, CourseStatusRow>();
  for (const sr of employeeStatusRows) {
    if (excludedCourseIds?.has(sr.course_id) ?? false) continue;
    const code = courseMap.get(sr.course_id)?.code ?? "";
    if (!formSpecFamily.includes(code as (typeof formSpecFamily)[number])) continue;
    if (!sr.completion_date) continue;
    const completionKey = parseDateOnlyKey(sr.completion_date);
    if (!completionKey) continue;
    if (baseCompletionKey && completionKey < baseCompletionKey) continue;
    const prev = ownedSpecByCode.get(code);
    if (!prev) {
      ownedSpecByCode.set(code, sr);
      continue;
    }
    const prevKey = prev.completion_date ? parseDateOnlyKey(prev.completion_date) : null;
    if (!prevKey || completionKey >= prevKey) ownedSpecByCode.set(code, sr);
  }

  const ownedSpecCode =
    ownedSpecByCode.has("FORM_SPEC_ALTO")
      ? "FORM_SPEC_ALTO"
      : ownedSpecByCode.has("FORM_SPEC_MEDIO")
        ? "FORM_SPEC_MEDIO"
        : ownedSpecByCode.has("FORM_SPEC_BASSO")
          ? "FORM_SPEC_BASSO"
          : null;

  const ownedSpecStatus = ownedSpecCode ? ownedSpecByCode.get(ownedSpecCode) ?? null : null;
  const ownedSpecCourseId = ownedSpecStatus?.course_id ?? null;
  const ownedSpecCourse = ownedSpecCourseId ? courseMap.get(ownedSpecCourseId) : undefined;
  const ownedSpecState = resolveCourseState(ownedSpecStatus ?? undefined, ownedSpecCourse, freeze, todayIso, expiringDays, false);
  const ownedRank = ownedSpecCode ? formSpecRank(ownedSpecCode) : 0;

  const baseOk = formBaseState === "idoneo" || formBaseState === "in scadenza";
  const specOk = ownedSpecState === "idoneo" || ownedSpecState === "in scadenza";

  const canAggregate = Boolean(baseCompletionKey) && ownedSpecStatus && baseOk && specOk && ownedRank >= requiredRank;

  if (canAggregate) {
    const completionDate = pickLatestDate(formBaseStatus?.completion_date ?? null, ownedSpecStatus?.completion_date ?? null);
    const expiryDate = pickEarliestDate(formBaseStatus?.expiry_date ?? null, ownedSpecStatus?.expiry_date ?? null);
    const risk = ownedSpecCode!.slice("FORM_SPEC_".length).toLowerCase();
    const courseCode = `FORM_BASE+${ownedSpecCode}`;
    const courseTitle = `Formazione generale + specifica rischio ${risk}`;
    const note = mergeNotes(formBaseStatus?.note ?? null, ownedSpecStatus?.note ?? null);
    const state = mergeBaseStates(formBaseState, ownedSpecState);

    const row: WorkerCourseRow = {
        workerId: employee.id,
        matricola: employee.matricola,
        cognome: employee.last_name,
        nome: employee.first_name,
        mansione: formatJobLabel(employee.job_title ?? ""),
        cantiere: extractDisplayName(employee.sites),
        sottocantiere: extractDisplayName(employee.sub_sites),
        corsoCode: courseCode,
        corso: courseTitle,
        dataConclusione: completionDate,
        dataScadenza: expiryDate,
        dataPrevista: null,
        stato: state as WorkerCourseRow["stato"],
        upgradeInfo: null,
        responsabile: employee.responsible_code,
        referente: employee.referral ?? "",
        note,
        origine: "obbligatorio",
      };
    return [row];
  }

  const requiredSpecCourse = courseMap.get(formSpecRequired.courseId);

  const generalRow: WorkerCourseRow = {
    workerId: employee.id,
    matricola: employee.matricola,
    cognome: employee.last_name,
    nome: employee.first_name,
    mansione: formatJobLabel(employee.job_title ?? ""),
    cantiere: extractDisplayName(employee.sites),
    sottocantiere: extractDisplayName(employee.sub_sites),
    courseId: formBaseCourseId,
    corsoCode: baseCourse?.code ?? "FORM_BASE",
    corso: baseCourse?.title ?? "Formazione generale",
    dataConclusione: formBaseStatus?.completion_date ?? null,
    dataScadenza: formBaseStatus?.expiry_date ?? null,
    dataPrevista: formBaseStatus?.planned_date ?? null,
    stato: formBaseState as WorkerCourseRow["stato"],
    upgradeInfo: null,
    responsabile: employee.responsible_code,
    referente: employee.referral ?? "",
    note: formBaseStatus?.note ?? "",
    origine: "obbligatorio",
  };

  if (ownedSpecStatus && baseOk && specOk && ownedRank < requiredRank && ownedSpecCourseId) {
    const from = levelLabel(ownedSpecCode!) ?? ownedSpecCode!;
    const to = levelLabel(formSpecRequired.code) ?? formSpecRequired.code;
    const course = courseMap.get(ownedSpecCourseId);

    const specRow: WorkerCourseRow = {
        workerId: employee.id,
        matricola: employee.matricola,
        cognome: employee.last_name,
        nome: employee.first_name,
        mansione: formatJobLabel(employee.job_title ?? ""),
        cantiere: extractDisplayName(employee.sites),
        sottocantiere: extractDisplayName(employee.sub_sites),
        courseId: ownedSpecCourseId,
        corsoCode: course?.code ?? ownedSpecCode!,
        corso: course?.title ?? "Formazione specifica",
        dataConclusione: ownedSpecStatus.completion_date ?? null,
        dataScadenza: ownedSpecStatus.expiry_date ?? null,
        dataPrevista: ownedSpecStatus.planned_date ?? null,
        stato: "upgrade",
        upgradeInfo: `${from} → ${to}`,
        responsabile: employee.responsible_code,
        referente: employee.referral ?? "",
        note: ownedSpecStatus.note ?? "",
        origine: "obbligatorio",
      };
    return [generalRow, specRow];
  }

  const requiredSpecStatus = statusMap.get(`${employee.id}:${formSpecRequired.courseId}`);
  const requiredSpecState = resolveCourseState(requiredSpecStatus, requiredSpecCourse, freeze, todayIso, expiringDays, false);

  if (!ownedSpecStatus) {
    const specRow: WorkerCourseRow = {
        workerId: employee.id,
        matricola: employee.matricola,
        cognome: employee.last_name,
        nome: employee.first_name,
        mansione: formatJobLabel(employee.job_title ?? ""),
        cantiere: extractDisplayName(employee.sites),
        sottocantiere: extractDisplayName(employee.sub_sites),
        courseId: formSpecRequired.courseId,
        corsoCode: requiredSpecCourse?.code ?? formSpecRequired.code,
        corso: requiredSpecCourse?.title ?? "Formazione specifica",
        dataConclusione: requiredSpecStatus?.completion_date ?? null,
        dataScadenza: requiredSpecStatus?.expiry_date ?? null,
        dataPrevista: requiredSpecStatus?.planned_date ?? null,
        stato: requiredSpecState as WorkerCourseRow["stato"],
        upgradeInfo: null,
        responsabile: employee.responsible_code,
        referente: employee.referral ?? "",
        note: requiredSpecStatus?.note ?? "",
        origine: "obbligatorio",
      };
    return [generalRow, specRow];
  }

  const ownedCourse = ownedSpecCourseId ? courseMap.get(ownedSpecCourseId) : null;
  const upgradeInfo =
    ownedRank > 0 && ownedRank < requiredRank
      ? `${levelLabel(ownedSpecCode!) ?? ownedSpecCode!} → ${levelLabel(formSpecRequired.code) ?? formSpecRequired.code}`
      : null;

  const specRow: WorkerCourseRow = {
      workerId: employee.id,
      matricola: employee.matricola,
      cognome: employee.last_name,
      nome: employee.first_name,
      mansione: formatJobLabel(employee.job_title ?? ""),
      cantiere: extractDisplayName(employee.sites),
      sottocantiere: extractDisplayName(employee.sub_sites),
      courseId: ownedSpecCourseId ?? formSpecRequired.courseId,
      corsoCode: ownedCourse?.code ?? ownedSpecCode ?? (requiredSpecCourse?.code ?? formSpecRequired.code),
      corso: ownedCourse?.title ?? requiredSpecCourse?.title ?? "Formazione specifica",
      dataConclusione: ownedSpecStatus?.completion_date ?? null,
      dataScadenza: ownedSpecStatus?.expiry_date ?? null,
      dataPrevista: ownedSpecStatus?.planned_date ?? null,
      stato: ownedSpecState as WorkerCourseRow["stato"],
      upgradeInfo,
      responsabile: employee.responsible_code,
      referente: employee.referral ?? "",
      note: ownedSpecStatus?.note ?? "",
      origine: "obbligatorio",
    };
  return [generalRow, specRow];
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

function findBestLowerValidCourse({
  statusRows,
  family,
  requiredIndex,
  courseMap,
  todayIso,
  excludedCourseIds,
}: {
  statusRows: CourseStatusRow[];
  family: readonly string[];
  requiredIndex: number;
  courseMap: Map<number, CourseRow>;
  todayIso: string;
  excludedCourseIds?: Set<number> | null;
}) {
  const candidates: Array<{ courseId: number; courseCode: string; familyIndex: number }> = [];

  for (const sr of statusRows) {
    if (excludedCourseIds?.has(sr.course_id) ?? false) continue;
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
  excludedCourseIds,
}: {
  statusRows: CourseStatusRow[];
  family: readonly string[];
  requiredIndex: number;
  courseMap: Map<number, CourseRow>;
  todayIso: string;
  excludedCourseIds?: Set<number> | null;
}) {
  const candidates: Array<{ courseId: number; courseCode: string; familyIndex: number }> = [];

  for (const sr of statusRows) {
    if (excludedCourseIds?.has(sr.course_id) ?? false) continue;
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

function levelLabel(courseCode: string) {
  if (courseCode.startsWith("FORM_SPEC_")) {
    const suffix = courseCode.slice("FORM_SPEC_".length);
    if (suffix) return suffix.toUpperCase();
  }
  const aiMatch = courseCode.match(/^CORSO_AI_(\d)$/);
  if (aiMatch) return aiMatch[1];
  return null;
}
