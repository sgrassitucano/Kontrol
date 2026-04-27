import { NextResponse } from "next/server";
import { normalizeJobCode } from "@/lib/training/normalize";
import { getCurrentUserContext, requireModuleAccess } from "@/lib/api/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
  sites: unknown;
  sub_sites: unknown;
};

type SurveillanceRow = {
  employee_id: number;
  provider: string | null;
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
  stato: "idoneo" | "in scadenza" | "scaduto" | "da fare" | "sospeso" | "escluso";
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
}) {
  const { today, thresholdDate, requiresVisit, nextDueDate } = args;
  if (!requiresVisit) return "idoneo" as const;
  if (!nextDueDate) return "da fare" as const;
  const due = new Date(nextDueDate);
  if (Number.isNaN(due.getTime())) return "da fare" as const;
  if (due < today) return "scaduto" as const;
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
    const expiringDays = Number(url.searchParams.get("expiringDays") ?? "30");
    const includeExcluded = url.searchParams.get("includeExcluded") === "1";

    const today = new Date();
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + (Number.isFinite(expiringDays) ? expiringDays : 30));

    const ctx = await getCurrentUserContext(auth.supabase);
    const dataSupabase =
      ctx.isActive && (ctx.role === "viewer" || ctx.role === "admin") ? createSupabaseAdminClient() : auth.supabase;

    const [employees, surveillanceRows, freezeRows, jobRules] = await Promise.all([
      fetchAllEmployees(dataSupabase),
      fetchAllSurveillanceRows(dataSupabase),
      fetchAllFreezes(dataSupabase),
      fetchAllJobRules(dataSupabase),
    ]);

    const surveillanceByEmployeeId = new Map<number, SurveillanceRow>();
    (surveillanceRows ?? []).forEach((row) => surveillanceByEmployeeId.set(row.employee_id, row));

    const activeFreezeByEmployeeId = buildActiveFreezeMap((freezeRows ?? []) as FreezeRow[], today);
    const jobRuleByCode = new Map<string, JobRuleRow>();
    (jobRules ?? []).forEach((row) => jobRuleByCode.set(row.job_code_norm, row));

    let excludedByRule = 0;
    let frozenEmployees = 0;

    const rows: WorkerSurveillanceRow[] = [];
    for (const employee of employees) {
      const freeze = activeFreezeByEmployeeId.get(employee.id);
      const isExcludedFreeze = freeze?.freeze_status === "maternita" || freeze?.freeze_status === "distacco_sindacale";
      if (freeze) frozenEmployees += 1;

      const jobCode = normalizeJobCode(employee.job_title ?? "");
      const jobRule = jobRuleByCode.get(jobCode);
      const excludedByJob = shouldExcludeForJobRule(employee, jobRule);

      const isExcluded = isExcludedFreeze || excludedByJob;
      if (isExcluded) excludedByRule += 1;
      if (isExcluded && !includeExcluded) continue;

      const record = surveillanceByEmployeeId.get(employee.id) ?? null;
      const requiresVisit = !isExcluded;
      const baseState = freeze ? "sospeso" : computeState({ today, thresholdDate, requiresVisit, nextDueDate: record?.next_due_date ?? null });
      const state = isExcluded ? "escluso" : baseState;

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
        medico: (record?.provider ?? "").trim() || "-",
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

      rows.push(row);
    }

    const counts = {
      idoneo: 0,
      inScadenza: 0,
      scaduto: 0,
      daFare: 0,
      sospeso: 0,
      escluso: 0,
    };
    rows.forEach((r) => {
      if (r.stato === "idoneo") counts.idoneo += 1;
      else if (r.stato === "in scadenza") counts.inScadenza += 1;
      else if (r.stato === "scaduto") counts.scaduto += 1;
      else if (r.stato === "da fare") counts.daFare += 1;
      else if (r.stato === "sospeso") counts.sospeso += 1;
      else counts.escluso += 1;
    });

    rows.sort((a, b) => a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome));

    return NextResponse.json({
      rows,
      totalRows: rows.length,
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
        "id,matricola,first_name,last_name,responsible_code,referral,job_title,theoretical_weekly_minutes,sites(display_name),sub_sites(display_name)",
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

async function fetchAllSurveillanceRows(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: SurveillanceRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("medical_surveillance_records")
      .select("employee_id,provider,next_due_date,limitations,notes")
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SurveillanceRow[];
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

async function fetchAllJobRules(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("medical_surveillance_job_rules")
    .select("job_code_norm,always_exempt,exempt_below_weekly_minutes");
  if (error) return [] as JobRuleRow[];
  return (data ?? []) as JobRuleRow[];
}

