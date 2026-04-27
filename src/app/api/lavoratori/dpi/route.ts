import { NextResponse } from "next/server";
import { normalizeJobCode } from "@/lib/training/normalize";
import { getCurrentUserContext, requireModuleAccess } from "@/lib/api/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type DpiState = "idoneo" | "consegnato" | "da consegnare" | "da verificare" | "scaduto" | "programmato";

type EmployeeRow = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
  responsible_code: string;
  referral: string | null;
  job_title: string;
  sites: unknown;
  sub_sites: unknown;
};

type DpiItemRow = {
  id: number;
  title: string;
  risk_activities: string | null;
  category: string | null;
  control_frequency: string | null;
  control_type: string | null;
};

type RuleRow = {
  scope_type: "job" | "employee_override";
  dpi_id: number;
  is_required: boolean;
  job_code_norm: string | null;
  employee_id: number | null;
};

type EmployeeDpiRow = {
  employee_id: number;
  dpi_id: number;
  delivered_date: string | null;
  planned_date: string | null;
  next_check_date: string | null;
  note: string | null;
};

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

function computeState({
  deliveredDate,
  plannedDate,
  nextCheckDate,
  today,
  thresholdDate,
}: {
  deliveredDate: string | null;
  plannedDate: string | null;
  nextCheckDate: string | null;
  today: Date;
  thresholdDate: Date;
}): DpiState {
  if (!deliveredDate) {
    if (plannedDate) return "programmato";
    return "da consegnare";
  }
  if (!nextCheckDate) return "consegnato";
  const due = new Date(nextCheckDate);
  if (due < today) return "scaduto";
  if (due <= thresholdDate) return "da verificare";
  return "idoneo";
}

function isMissingRelationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /relation .*dpi_/i.test(error.message) && /does not exist/i.test(error.message);
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("lavoratori", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const expiringDays = Number(url.searchParams.get("expiringDays") ?? "30");
    const employeeIdParam = url.searchParams.get("employeeId");
    const employeeId = employeeIdParam ? Number(employeeIdParam) : null;
    const simulationDate = (url.searchParams.get("date") ?? "").trim();

    const today = simulationDate ? new Date(simulationDate) : new Date();
    const thresholdDate = new Date(today);
    thresholdDate.setDate(
      thresholdDate.getDate() + (Number.isFinite(expiringDays) ? expiringDays : 30),
    );

    const supabase = auth.supabase;
    const ctx = await getCurrentUserContext(supabase);
    const dataSupabase =
      ctx.isActive && (ctx.role === "viewer" || ctx.role === "admin") ? createSupabaseAdminClient() : supabase;

    const employees = await fetchEmployees(dataSupabase, employeeId);
    const employeeIds = employees.map((e) => e.id);

    const [{ data: dpiData, error: dpiError }, { data: rulesData, error: rulesError }, deliveriesResult] =
      await Promise.all([
        dataSupabase
          .from("dpi_items")
          .select("id,title,risk_activities,category,control_frequency,control_type")
          .eq("is_active", true)
          .order("title"),
        dataSupabase
          .from("dpi_matrix_rules")
          .select("scope_type,dpi_id,is_required,job_code_norm,employee_id")
          .in("scope_type", ["job", "employee_override"]),
        employeeIds.length > 0
          ? dataSupabase
              .from("dpi_employee_items")
              .select("employee_id,dpi_id,delivered_date,planned_date,next_check_date,note")
              .in("employee_id", employeeIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (dpiError) throw new Error(dpiError.message);
    if (rulesError) throw new Error(rulesError.message);
    if (deliveriesResult.error) throw new Error(deliveriesResult.error.message);

    const dpiItems = (dpiData ?? []) as DpiItemRow[];
    const dpiById = new Map<number, DpiItemRow>(dpiItems.map((d) => [d.id, d]));

    const rules = (rulesData ?? []) as RuleRow[];
    const requiredDpiByJob = new Map<string, Set<number>>();
    const overrideByEmployee = new Map<number, Map<number, boolean>>();

    for (const rule of rules) {
      if (rule.scope_type === "job") {
        if (!rule.job_code_norm) continue;
        const set = requiredDpiByJob.get(rule.job_code_norm) ?? new Set<number>();
        if (rule.is_required) set.add(rule.dpi_id);
        requiredDpiByJob.set(rule.job_code_norm, set);
        continue;
      }
      if (rule.scope_type === "employee_override") {
        if (!rule.employee_id) continue;
        const map = overrideByEmployee.get(rule.employee_id) ?? new Map<number, boolean>();
        map.set(rule.dpi_id, rule.is_required);
        overrideByEmployee.set(rule.employee_id, map);
      }
    }

    const deliveries = (deliveriesResult.data ?? []) as EmployeeDpiRow[];
    const deliveryByKey = new Map<string, EmployeeDpiRow>();
    for (const row of deliveries) {
      deliveryByKey.set(`${row.employee_id}:${row.dpi_id}`, row);
    }

    const rows = [];

    for (const employee of employees) {
      const jobCodeNorm = normalizeJobCode(employee.job_title ?? "");
      const requiredSet = new Set<number>();

      if (jobCodeNorm) {
        const jobRequired = requiredDpiByJob.get(jobCodeNorm);
        if (jobRequired) {
          for (const dpiId of jobRequired) requiredSet.add(dpiId);
        }
      }

      const overrides = overrideByEmployee.get(employee.id);
      if (overrides) {
        for (const [dpiId, isRequired] of overrides.entries()) {
          if (isRequired) requiredSet.add(dpiId);
          else requiredSet.delete(dpiId);
        }
      }

      for (const dpiId of requiredSet) {
        const dpi = dpiById.get(dpiId);
        if (!dpi) continue;

        const delivery = deliveryByKey.get(`${employee.id}:${dpiId}`) ?? null;

        const stato = computeState({
          deliveredDate: delivery?.delivered_date ?? null,
          plannedDate: delivery?.planned_date ?? null,
          nextCheckDate: delivery?.next_check_date ?? null,
          today,
          thresholdDate,
        });

        const row = {
          workerId: employee.id,
          matricola: employee.matricola,
          cognome: employee.last_name,
          nome: employee.first_name,
          mansione: employee.job_title ?? "",
          cantiere: extractDisplayName(employee.sites),
          sottocantiere: extractDisplayName(employee.sub_sites),
          responsabile: employee.responsible_code,
          referente: employee.referral ?? "",
          dpiId: dpi.id,
          dpi: dpi.title,
          riskActivities: dpi.risk_activities ?? "",
          category: dpi.category ?? "",
          controlFrequency: dpi.control_frequency ?? "",
          controlType: dpi.control_type ?? "",
          dataConsegna: delivery?.delivered_date ?? null,
          dataProssimoControllo: delivery?.next_check_date ?? null,
          stato,
          note: delivery?.note ?? "",
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
            row.dpi,
            row.category,
            row.riskActivities,
            row.controlFrequency,
            row.controlType,
          ]
            .join(" ")
            .toLowerCase();
          if (!searchable.includes(query)) continue;
        }

        rows.push(row);
      }
    }

    rows.sort(
      (a, b) =>
        a.cognome.localeCompare(b.cognome) ||
        a.nome.localeCompare(b.nome) ||
        a.dpi.localeCompare(b.dpi),
    );

    return NextResponse.json({
      rows,
      totalRows: rows.length,
    });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return NextResponse.json({
        rows: [],
        totalRows: 0,
        warning: "Tabelle DPI non presenti nel DB. Applica lo schema Supabase per abilitare il modulo DPI.",
      });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento DPI lavoratori." },
      { status: 500 },
    );
  }
}

async function fetchEmployees(
  supabase: SupabaseClient,
  employeeId: number | null,
) {
  if (typeof employeeId === "number" && Number.isFinite(employeeId)) {
    const { data, error } = await supabase
      .from("employees")
      .select(
        "id,matricola,first_name,last_name,responsible_code,referral,job_title,sites(display_name),sub_sites(display_name)",
      )
      .eq("id", employeeId)
      .single();
    if (error) throw new Error(error.message);
    return [data as EmployeeRow];
  }

  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: EmployeeRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employees")
      .select(
        "id,matricola,first_name,last_name,responsible_code,referral,job_title,sites(display_name),sub_sites(display_name)",
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
