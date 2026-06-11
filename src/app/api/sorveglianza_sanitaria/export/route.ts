import { NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { requireModuleAccess } from "@/lib/api/access";
import { normalizeJobCode } from "@/lib/training/normalize";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCalibri10WithBoldHeader } from "@/lib/excel";
import { isoToItDate, parseStrictIsoDateToIso } from "@/lib/it-date";

type XlsxWriteOptionsWithStyles = XLSX.WritingOptions & { cellStyles?: boolean };

type EmployeeRow = {
  id: number;
  matricola: string;
  tax_code: string;
  first_name: string;
  last_name: string;
  responsible_code: string;
  referral: string | null;
  job_title: string;
  job_title_notes: string | null;
  theoretical_weekly_minutes: number;
  site_id: number;
  sub_site_id: number | null;
  sites: unknown;
  sub_sites: unknown;
};

function normalizeProvider(value: string | null | undefined) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.toUpperCase() === "MISTO") return null;
  return v;
}

type SurveillanceRow = {
  employee_id: number;
  provider: string | null;
  is_planned: boolean;
  next_due_date: string | null;
  limitations: string | null;
  notes: string | null;
};

type FreezeRow = {
  employee_id: number;
  freeze_status: "maternita" | "infortunio" | "malattia" | "distacco_sindacale";
  start_date: string;
  end_date: string | null;
};

type JobRuleRow = {
  job_code_norm: string;
  always_exempt: boolean;
  exempt_below_weekly_minutes: number | null;
};

type ScopeRuleRow = {
  scope_type: "site" | "sub_site";
  site_id: number | null;
  sub_site_id: number | null;
  requires_visit: boolean;
};

type ProviderAssignmentRow = {
  scope_type: "site" | "sub_site";
  site_id: number | null;
  sub_site_id: number | null;
  provider: string;
  is_active: boolean;
};

type EmployeeExclusionRow = {
  employee_id: number;
  is_active: boolean;
};

type EmployeeOverrideRow = {
  employee_id: number;
  requires_visit: boolean;
  is_active: boolean;
};

type RowState = "idoneo" | "in scadenza" | "scaduto" | "da fare" | "programmato" | "sospeso" | "escluso";

export const runtime = "nodejs";

const MAX_EXPORT_EMPLOYEES = 20000;
const MAX_EXPORT_SURVEILLANCE_ROWS = 50000;
const MAX_EXPORT_FREEZES = 50000;
const MAX_EXPORT_JOB_RULES = 50000;
const MAX_EXPORT_SCOPE_RULES = 50000;
const MAX_EXPORT_PROVIDER_ASSIGNMENTS = 50000;
const MAX_EXPORT_EMPLOYEE_EXCLUSIONS = 100000;
const MAX_EXPORT_EMPLOYEE_OVERRIDES = 100000;
const MAX_EXPORT_OUTPUT_ROWS = 20000;

class TooManyRowsError extends Error {
  status = 400;
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

function normalizeIsoDate(value: string | null | undefined) {
  return parseStrictIsoDateToIso(String(value ?? ""));
}

function buildActiveFreezeMap(rows: FreezeRow[], todayIsoDate: string) {
  const map = new Map<number, FreezeRow>();
  rows.forEach((row) => {
    const start = normalizeIsoDate(row.start_date);
    const end = row.end_date ? normalizeIsoDate(row.end_date) : null;
    if (!start) return;
    if (start > todayIsoDate) return;
    if (end && end < todayIsoDate) return;
    map.set(row.employee_id, row);
  });
  return map;
}

function computeState(args: {
  todayIsoDate: string;
  thresholdIsoDate: string;
  requiresVisit: boolean;
  nextDueDate: string | null;
  isPlanned: boolean;
}) {
  const { todayIsoDate, thresholdIsoDate, requiresVisit, nextDueDate, isPlanned } = args;
  if (!requiresVisit) return "idoneo" as const;
  if (!nextDueDate) return isPlanned ? ("programmato" as const) : ("da fare" as const);
  const dueIso = normalizeIsoDate(nextDueDate);
  if (!dueIso) return isPlanned ? ("programmato" as const) : ("da fare" as const);
  if (dueIso < todayIsoDate) return "scaduto" as const;
  if (isPlanned) return "programmato" as const;
  if (dueIso <= thresholdIsoDate) return "in scadenza" as const;
  return "idoneo" as const;
}

function shouldExcludeForJobRule(employee: EmployeeRow, rule: JobRuleRow | undefined) {
  const defaultExemptJobs = new Set(["IMP.CUP", "IMP.CC", "IMP.AMM"]);
  const jobCode = normalizeJobCode(employee.job_title ?? "");
  const isDefaultExemptJob = defaultExemptJobs.has(jobCode);
  const defaultThreshold = 20 * 60;
  const defaultExempt = isDefaultExemptJob && employee.theoretical_weekly_minutes < defaultThreshold;
  if (!rule) return defaultExempt;
  if (rule.always_exempt) return true;
  if (
    typeof rule.exempt_below_weekly_minutes === "number" &&
    Number.isFinite(rule.exempt_below_weekly_minutes) &&
    employee.theoretical_weekly_minutes < rule.exempt_below_weekly_minutes
  ) {
    return true;
  }
  return defaultExempt;
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
        "id,matricola,tax_code,first_name,last_name,responsible_code,referral,job_title,job_title_notes,theoretical_weekly_minutes,site_id,sub_site_id,sites(display_name),sub_sites(display_name)",
      )
      .eq("status", "attivo")
      .order("last_name")
      .order("first_name")
      .order("id")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as EmployeeRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_EMPLOYEES) {
      throw new TooManyRowsError(
        `Troppi lavoratori per export sorveglianza (> ${MAX_EXPORT_EMPLOYEES}). Restringi il dataset o applica filtri.`,
      );
    }
    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return allRows;
}

async function fetchAllSurveillanceRows(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: SurveillanceRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("medical_surveillance_records")
      .select("employee_id,provider,is_planned,next_due_date,limitations,notes")
      .order("employee_id")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SurveillanceRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_SURVEILLANCE_ROWS) {
      throw new TooManyRowsError(
        `Troppi record sorveglianza (> ${MAX_EXPORT_SURVEILLANCE_ROWS}). Restringi il dataset o applica filtri.`,
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
      .order("employee_id")
      .order("start_date")
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

async function fetchAllJobRules(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: JobRuleRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("medical_surveillance_job_rules")
      .select("job_code_norm,always_exempt,exempt_below_weekly_minutes")
      .order("job_code_norm")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as JobRuleRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_JOB_RULES) {
      throw new TooManyRowsError(
        `Troppe regole mansione (> ${MAX_EXPORT_JOB_RULES}). Restringi il dataset o applica paginazione.`,
      );
    }
    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return allRows;
}

async function fetchAllScopeRules(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: ScopeRuleRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("medical_surveillance_scope_rules")
      .select("*")
      .order("id")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Array<ScopeRuleRow & { is_active?: boolean | null }>).filter(
      (row) => row.is_active !== false,
    );
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_SCOPE_RULES) {
      throw new TooManyRowsError(
        `Troppe regole scope (> ${MAX_EXPORT_SCOPE_RULES}). Restringi il dataset o applica paginazione.`,
      );
    }
    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return allRows;
}

async function fetchAllProviderAssignments(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: ProviderAssignmentRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("medical_surveillance_provider_assignments")
      .select("scope_type,site_id,sub_site_id,provider,is_active")
      .order("id")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ProviderAssignmentRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_PROVIDER_ASSIGNMENTS) {
      throw new TooManyRowsError(
        `Troppe assegnazioni provider (> ${MAX_EXPORT_PROVIDER_ASSIGNMENTS}). Restringi il dataset o applica paginazione.`,
      );
    }
    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return allRows;
}

async function fetchAllEmployeeExclusions(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: EmployeeExclusionRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("medical_surveillance_employee_exclusions")
      .select("employee_id,is_active")
      .eq("is_active", true)
      .order("id")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as EmployeeExclusionRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_EMPLOYEE_EXCLUSIONS) {
      throw new TooManyRowsError(
        `Troppe esclusioni lavoratori (> ${MAX_EXPORT_EMPLOYEE_EXCLUSIONS}). Restringi il dataset o applica paginazione.`,
      );
    }
    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return allRows;
}

async function fetchAllEmployeeOverrides(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: EmployeeOverrideRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("medical_surveillance_employee_overrides")
      .select("employee_id,requires_visit,is_active")
      .eq("is_active", true)
      .order("id")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as EmployeeOverrideRow[];
    allRows.push(...rows);
    if (allRows.length > MAX_EXPORT_EMPLOYEE_OVERRIDES) {
      throw new TooManyRowsError(
        `Troppe override lavoratori (> ${MAX_EXPORT_EMPLOYEE_OVERRIDES}). Restringi il dataset o applica paginazione.`,
      );
    }
    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return allRows;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const expiringDays = Number(url.searchParams.get("expiringDays") ?? "30");
    const dateParam = url.searchParams.get("date");
    const includeExcluded = url.searchParams.get("includeExcluded") === "1";
    const status = (url.searchParams.get("status") ?? "").trim().toLowerCase();

    const expiringDaysSafeRaw = Number.isFinite(expiringDays) ? expiringDays : 30;
    const expiringDaysSafe = Math.min(Math.max(expiringDaysSafeRaw, 0), 365);

    let today = new Date();
    today.setHours(12, 0, 0, 0);
    if (typeof dateParam === "string") {
      const parsedIso = parseStrictIsoDateToIso(dateParam);
      if (parsedIso) today = new Date(`${parsedIso}T12:00:00`);
    }

    const thresholdDate = new Date(today);
    thresholdDate.setDate(thresholdDate.getDate() + expiringDaysSafe);
    const todayIsoDate = today.toISOString().slice(0, 10);
    const thresholdIsoDate = thresholdDate.toISOString().slice(0, 10);

    const dataSupabase = auth.supabase;

    const [employees, surveillanceRows, freezeRows, jobRules, scopeRules, providerAssignments, employeeExclusions, employeeOverrides] =
      await Promise.all([
        fetchAllEmployees(dataSupabase),
        fetchAllSurveillanceRows(dataSupabase),
        fetchAllFreezes(dataSupabase),
        fetchAllJobRules(dataSupabase),
        fetchAllScopeRules(dataSupabase),
        fetchAllProviderAssignments(dataSupabase),
        fetchAllEmployeeExclusions(dataSupabase),
        fetchAllEmployeeOverrides(dataSupabase),
      ]);

    const surveillanceByEmployeeId = new Map<number, SurveillanceRow>();
    (surveillanceRows ?? []).forEach((row) => surveillanceByEmployeeId.set(row.employee_id, row));

    const activeFreezeByEmployeeId = buildActiveFreezeMap((freezeRows ?? []) as FreezeRow[], todayIsoDate);
    const jobRuleByCode = new Map<string, JobRuleRow>();
    (jobRules ?? []).forEach((row) => jobRuleByCode.set(row.job_code_norm, row));

    const scopeRuleBySiteId = new Map<number, ScopeRuleRow>();
    const scopeRuleBySubSiteId = new Map<number, ScopeRuleRow>();
    (scopeRules ?? []).forEach((row) => {
      if (row.scope_type === "site" && row.site_id) scopeRuleBySiteId.set(row.site_id, row);
      if (row.scope_type === "sub_site" && row.sub_site_id) scopeRuleBySubSiteId.set(row.sub_site_id, row);
    });

    const providerBySiteId = new Map<number, ProviderAssignmentRow>();
    const providerBySubSiteId = new Map<number, ProviderAssignmentRow>();
    (providerAssignments ?? []).forEach((row) => {
      if (!row.is_active) return;
      if (row.scope_type === "site" && row.site_id) providerBySiteId.set(row.site_id, row);
      if (row.scope_type === "sub_site" && row.sub_site_id) providerBySubSiteId.set(row.sub_site_id, row);
    });

    const excludedEmployeeIdSet = new Set<number>();
    (employeeExclusions ?? []).forEach((row) => {
      if (row.is_active) excludedEmployeeIdSet.add(row.employee_id);
    });

    const overridesByEmployeeId = new Map<number, EmployeeOverrideRow>();
    (employeeOverrides ?? []).forEach((row) => {
      if (!row.is_active) return;
      overridesByEmployeeId.set(row.employee_id, row);
    });

    const rows: Array<{
      employee: EmployeeRow;
      provider: string;
      nextDueDate: string | null;
      limitations: string;
      state: RowState;
      requiresVisit: boolean;
    }> = [];
    const pushRow = (row: (typeof rows)[number]) => {
      rows.push(row);
      if (rows.length > MAX_EXPORT_OUTPUT_ROWS) {
        throw new TooManyRowsError(
          `Export sorveglianza troppo grande (> ${MAX_EXPORT_OUTPUT_ROWS} righe). Restringi il dataset o applica filtri.`,
        );
      }
    };

    for (const employee of employees) {
      const freeze = activeFreezeByEmployeeId.get(employee.id);
      const isExcludedFreeze = freeze?.freeze_status === "maternita" || freeze?.freeze_status === "distacco_sindacale";

      const jobCode = normalizeJobCode(employee.job_title ?? "");
      const jobRule = jobRuleByCode.get(jobCode);
      const excludedByJob = shouldExcludeForJobRule(employee, jobRule);

      const isExcludedManual = excludedEmployeeIdSet.has(employee.id);
      const isExcluded = isExcludedFreeze || excludedByJob || isExcludedManual;
      if (isExcluded && !includeExcluded) continue;

      const record = surveillanceByEmployeeId.get(employee.id) ?? null;
      const override = overridesByEmployeeId.get(employee.id) ?? null;
      const scopeRule =
        typeof employee.sub_site_id === "number" && employee.sub_site_id
          ? scopeRuleBySubSiteId.get(employee.sub_site_id) ?? null
          : null;
      const siteRule = scopeRule ? null : scopeRuleBySiteId.get(employee.site_id) ?? null;

      const derivedRequiresVisit = scopeRule?.requires_visit ?? siteRule?.requires_visit ?? !excludedByJob;
      const requiresVisit = isExcluded ? false : override ? override.requires_visit : derivedRequiresVisit;

      const baseState =
        freeze && !isExcluded
          ? ("sospeso" as const)
          : computeState({
              todayIsoDate,
              thresholdIsoDate,
              requiresVisit,
              nextDueDate: record?.next_due_date ?? null,
              isPlanned: Boolean(record?.is_planned ?? false),
            });
      const state: RowState = isExcluded ? "escluso" : baseState;

      const providerFromAssignment =
        typeof employee.sub_site_id === "number" && employee.sub_site_id
          ? normalizeProvider(providerBySubSiteId.get(employee.sub_site_id)?.provider ?? null)
          : normalizeProvider(providerBySiteId.get(employee.site_id)?.provider ?? null);
      const providerFromRecord = normalizeProvider(record?.provider ?? null);
      const provider = providerFromAssignment || providerFromRecord || "-";

      const limitations = String(record?.limitations ?? "").trim();
      const nextDueDate = record?.next_due_date ?? null;

      if (status) {
        if (status === "critico") {
          if (!(state === "scaduto" || state === "da fare")) continue;
        } else if (state !== (status as RowState)) {
          continue;
        }
      }

      if (query) {
        const searchable = [
          employee.matricola,
          employee.tax_code,
          employee.last_name,
          employee.first_name,
          employee.job_title,
          employee.job_title_notes ?? "",
          employee.responsible_code ?? "",
          employee.referral ?? "",
          extractDisplayName(employee.sites),
          extractDisplayName(employee.sub_sites),
          provider,
          limitations,
          record?.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(query)) continue;
      }

      pushRow({ employee, provider, nextDueDate, limitations, state, requiresVisit });
    }

    rows.sort((a, b) => a.employee.last_name.localeCompare(b.employee.last_name, "it", { sensitivity: "base" }) || a.employee.first_name.localeCompare(b.employee.first_name, "it", { sensitivity: "base" }));

    const headers = [
      "cognome",
      "nome",
      "codice",
      "codice fiscale",
      "mansione",
      "specifiche mansione",
      "responsabile",
      "referente",
      "cantiere",
      "sottocantiere",
      "provider",
      "scadenza visita",
      "stato",
      "limitazioni",
    ] as const;

    const sheet: Record<(typeof headers)[number], string>[] = rows.map(({ employee, provider, nextDueDate, limitations, state }) => ({
      "cognome": employee.last_name ?? "",
      "nome": employee.first_name ?? "",
      "codice": employee.matricola ?? "",
      "codice fiscale": (employee.tax_code ?? "").toUpperCase(),
      "mansione": employee.job_title ?? "",
      "specifiche mansione": employee.job_title_notes ?? "",
      "responsabile": employee.responsible_code ?? "",
      "referente": employee.referral ?? "",
      "cantiere": extractDisplayName(employee.sites),
      "sottocantiere": extractDisplayName(employee.sub_sites),
      "provider": provider,
      "scadenza visita": nextDueDate ? isoToItDate(nextDueDate) : "",
      "stato": state,
      "limitazioni": limitations,
    }));

    const workbook = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheet, { header: [...headers] });
    applyCalibri10WithBoldHeader(ws);
    XLSX.utils.book_append_sheet(workbook, ws, "Sorveglianza");

    const out = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true } as XlsxWriteOptionsWithStyles) as ArrayBuffer;
    const filename = `export_sorveglianza_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(out, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof TooManyRowsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore export sorveglianza." },
      { status: 500 },
    );
  }
}
