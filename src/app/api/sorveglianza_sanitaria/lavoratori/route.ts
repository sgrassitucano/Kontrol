import { NextResponse } from "next/server";
import { normalizeJobCode } from "@/lib/training/normalize";
import { requireModuleAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

type EmployeeRow = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
  responsible_code: string;
  referral: string | null;
  job_title: string;
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

function parseLimitParam(value: string | null, fallback = 500) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 2000);
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

type WorkerSurveillanceRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
  visitaRichiesta: "SI" | "NO";
  scadenzaVisita: string | null;
  stato: "idoneo" | "in scadenza" | "scaduto" | "da fare" | "programmato" | "sospeso" | "escluso";
  medico: string;
  limitazioni: string;
  note: string;
};

export const runtime = "nodejs";

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

function buildActiveFreezeMap(rows: FreezeRow[], today: Date) {
  const map = new Map<number, FreezeRow>();
  rows.forEach((row) => {
    const start = new Date(row.start_date);
    const end = row.end_date ? new Date(row.end_date) : null;
    if (Number.isNaN(start.getTime())) return;
    if (start > today) return;
    if (end && end < today) return;
    map.set(row.employee_id, row);
  });
  return map;
}

function computeState(args: {
  today: Date;
  thresholdDate: Date;
  requiresVisit: boolean;
  nextDueDate: string | null;
  isPlanned: boolean;
}) {
  const { today, thresholdDate, requiresVisit, nextDueDate, isPlanned } = args;
  if (!requiresVisit) return "idoneo" as const;
  if (!nextDueDate) return isPlanned ? ("programmato" as const) : ("da fare" as const);
  const due = new Date(nextDueDate);
  if (Number.isNaN(due.getTime())) return isPlanned ? ("programmato" as const) : ("da fare" as const);
  if (due < today) return "scaduto" as const;
  if (isPlanned) return "programmato" as const;
  if (due <= thresholdDate) return "in scadenza" as const;
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

export async function GET(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const limit = parseLimitParam(url.searchParams.get("limit"), query ? 200 : 500);
    const expiringDays = Number(url.searchParams.get("expiringDays") ?? "30");
    const dateParam = url.searchParams.get("date");
    const includeExcluded = url.searchParams.get("includeExcluded") === "1";

    const expiringDaysSafeRaw = Number.isFinite(expiringDays) ? expiringDays : 30;
    const expiringDaysSafe = Math.min(Math.max(expiringDaysSafeRaw, 0), 365);

    let today = new Date();
    if (typeof dateParam === "string") {
      const match = dateParam.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`);
        if (!Number.isNaN(parsed.getTime())) today = parsed;
      }
    }

    const thresholdDate = new Date(today);
    thresholdDate.setDate(thresholdDate.getDate() + expiringDaysSafe);

    const dataSupabase = auth.supabase;

    const [employees, jobRules, scopeRules, providerAssignments] = await Promise.all([
      fetchAllEmployees(dataSupabase),
      fetchAllJobRules(dataSupabase),
      fetchAllScopeRules(dataSupabase),
      fetchAllProviderAssignments(dataSupabase),
    ]);

    const employeeIds = employees.map((e) => e.id);

    const [surveillanceRows, freezeRows, employeeExclusions, employeeOverrides] = await Promise.all([
      fetchSurveillanceRowsForEmployees(dataSupabase, employeeIds),
      fetchFreezesForEmployees(dataSupabase, employeeIds),
      fetchEmployeeExclusionsForEmployees(dataSupabase, employeeIds),
      fetchEmployeeOverridesForEmployees(dataSupabase, employeeIds),
    ]);

    const surveillanceByEmployeeId = new Map<number, SurveillanceRow>();
    (surveillanceRows ?? []).forEach((row) => surveillanceByEmployeeId.set(row.employee_id, row));

    const activeFreezeByEmployeeId = buildActiveFreezeMap((freezeRows ?? []) as FreezeRow[], today);
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

    let excludedByRule = 0;
    let frozenEmployees = 0;

    const rows: WorkerSurveillanceRow[] = [];
    let totalRows = 0;
    const counts = {
      idoneo: 0,
      inScadenza: 0,
      scaduto: 0,
      daFare: 0,
      programmato: 0,
      sospeso: 0,
      escluso: 0,
    };
    for (const employee of employees) {
      const freeze = activeFreezeByEmployeeId.get(employee.id);
      const isExcludedFreeze = freeze?.freeze_status === "maternita" || freeze?.freeze_status === "distacco_sindacale";
      if (freeze) frozenEmployees += 1;

      const jobCode = normalizeJobCode(employee.job_title ?? "");
      const jobRule = jobRuleByCode.get(jobCode);
      const excludedByJob = shouldExcludeForJobRule(employee, jobRule);

      const isExcludedManual = excludedEmployeeIdSet.has(employee.id);
      const isExcluded = isExcludedFreeze || excludedByJob || isExcludedManual;
      if (isExcluded) excludedByRule += 1;
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
              today,
              thresholdDate,
              requiresVisit,
              nextDueDate: record?.next_due_date ?? null,
              isPlanned: Boolean(record?.is_planned ?? false),
            });
      const state = isExcluded ? "escluso" : baseState;

      const providerFromAssignment =
        typeof employee.sub_site_id === "number" && employee.sub_site_id
          ? normalizeProvider(providerBySubSiteId.get(employee.sub_site_id)?.provider ?? null)
          : normalizeProvider(providerBySiteId.get(employee.site_id)?.provider ?? null);
      const providerFromRecord = normalizeProvider(record?.provider ?? null);

      const row: WorkerSurveillanceRow = {
        workerId: employee.id,
        matricola: employee.matricola,
        cognome: employee.last_name,
        nome: employee.first_name,
        mansione: employee.job_title ?? "",
        cantiere: extractDisplayName(employee.sites),
        sottocantiere: extractDisplayName(employee.sub_sites),
        responsabile: employee.responsible_code,
        referente: employee.referral ?? "",
        visitaRichiesta: requiresVisit ? "SI" : "NO",
        scadenzaVisita: record?.next_due_date ?? null,
        stato: state,
        medico: providerFromAssignment || providerFromRecord || "-",
        limitazioni: (record?.limitations ?? "").trim(),
        note: (record?.notes ?? "").trim(),
      };

      if (query) {
        const searchable = [
          row.matricola,
          row.cognome,
          row.nome,
          row.mansione,
          row.cantiere,
          row.sottocantiere,
          row.responsabile,
          row.referente,
          row.medico,
          row.limitazioni,
          row.note,
        ]
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(query)) continue;
      }

      totalRows += 1;
      if (row.stato === "idoneo") counts.idoneo += 1;
      else if (row.stato === "in scadenza") counts.inScadenza += 1;
      else if (row.stato === "scaduto") counts.scaduto += 1;
      else if (row.stato === "da fare") counts.daFare += 1;
      else if (row.stato === "programmato") counts.programmato += 1;
      else if (row.stato === "sospeso") counts.sospeso += 1;
      else counts.escluso += 1;
      if (rows.length < limit) rows.push(row);
    }

    rows.sort((a, b) => a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome));

    return NextResponse.json({
      rows,
      limit,
      truncated: totalRows > rows.length,
      totalRows,
      totalActiveEmployees: employees.length,
      excludedByRule,
      frozenEmployees,
      expiringDays: Number.isFinite(expiringDays) ? expiringDays : 30,
      counts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento sorveglianza sanitaria." },
      { status: 500 },
    );
  }
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
        "id,matricola,first_name,last_name,responsible_code,referral,job_title,theoretical_weekly_minutes,site_id,sub_site_id,sites(display_name),sub_sites(display_name)",
      )
      .eq("status", "attivo")
      .order("last_name")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as EmployeeRow[];
    allRows.push(...rows);
    if (rows.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return allRows;
}

async function fetchSurveillanceRowsForEmployees(supabase: SupabaseClient, employeeIds: number[]) {
  const rows: SurveillanceRow[] = [];
  for (let i = 0; i < employeeIds.length; i += 500) {
    const part = employeeIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from("medical_surveillance_records")
      .select("employee_id,provider,is_planned,next_due_date,limitations,notes")
      .in("employee_id", part);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as SurveillanceRow[]));
  }
  return rows;
}

async function fetchFreezesForEmployees(supabase: SupabaseClient, employeeIds: number[]) {
  const rows: FreezeRow[] = [];
  for (let i = 0; i < employeeIds.length; i += 500) {
    const part = employeeIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from("employee_freeze_periods")
      .select("employee_id,freeze_status,start_date,end_date")
      .in("employee_id", part);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as FreezeRow[]));
  }
  return rows;
}

async function fetchAllJobRules(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("medical_surveillance_job_rules")
    .select("job_code_norm,always_exempt,exempt_below_weekly_minutes");
  if (error) return [] as JobRuleRow[];
  return (data ?? []) as JobRuleRow[];
}

async function fetchAllScopeRules(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("medical_surveillance_scope_rules")
    .select("scope_type,site_id,sub_site_id,requires_visit");
  if (error) return [] as ScopeRuleRow[];
  return (data ?? []) as ScopeRuleRow[];
}

async function fetchAllProviderAssignments(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("medical_surveillance_provider_assignments")
    .select("scope_type,site_id,sub_site_id,provider,is_active");
  if (error) return [] as ProviderAssignmentRow[];
  return (data ?? []) as ProviderAssignmentRow[];
}

async function fetchEmployeeExclusionsForEmployees(supabase: SupabaseClient, employeeIds: number[]) {
  const rows: EmployeeExclusionRow[] = [];
  for (let i = 0; i < employeeIds.length; i += 500) {
    const part = employeeIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from("medical_surveillance_employee_exclusions")
      .select("employee_id,is_active")
      .eq("is_active", true)
      .in("employee_id", part);
    if (error) return [] as EmployeeExclusionRow[];
    rows.push(...((data ?? []) as EmployeeExclusionRow[]));
  }
  return rows;
}

async function fetchEmployeeOverridesForEmployees(supabase: SupabaseClient, employeeIds: number[]) {
  const rows: EmployeeOverrideRow[] = [];
  for (let i = 0; i < employeeIds.length; i += 500) {
    const part = employeeIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from("medical_surveillance_employee_overrides")
      .select("employee_id,requires_visit,is_active")
      .eq("is_active", true)
      .in("employee_id", part);
    if (error) return [] as EmployeeOverrideRow[];
    rows.push(...((data ?? []) as EmployeeOverrideRow[]));
  }
  return rows;
}
