import { NextResponse } from "next/server";
import { normalizeJobCode } from "@/lib/training/normalize";
import { requireModuleAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const MAX_EMPLOYEES = 20000;
const MAX_OUTPUT_ROWS = 100000;
const MAX_DPI_ITEMS = 5000;
const MAX_RULES = 50000;
const MAX_DELIVERIES = 200000;
const IN_QUERY_CHUNK_SIZE = 500;

class TooManyRowsError extends Error {
  status = 400;
}

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

type WorkerDpiRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
  dpiId: number;
  dpi: string;
  riskActivities: string;
  category: string;
  controlFrequency: string;
  controlType: string;
  dataConsegna: string | null;
  dataProssimoControllo: string | null;
  stato: DpiState;
  note: string;
};

function normalizeIsoDate(value: unknown) {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return s;
}

function addDaysIso(baseIso: string, days: number) {
  const base = new Date(`${baseIso}T00:00:00.000Z`);
  if (!Number.isFinite(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
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

export function computeDpiState(args: {
  deliveredDate: string | null;
  plannedDate: string | null;
  nextCheckDate: string | null;
  todayIsoDate: string;
  thresholdIsoDate: string;
}): DpiState {
  const deliveredDate = normalizeIsoDate(args.deliveredDate);
  const plannedDate = normalizeIsoDate(args.plannedDate);
  const nextCheckDate = normalizeIsoDate(args.nextCheckDate);
  if (!deliveredDate) {
    if (plannedDate) return "programmato";
    return "da consegnare";
  }
  if (!nextCheckDate) return "consegnato";
  if (nextCheckDate < args.todayIsoDate) return "scaduto";
  if (nextCheckDate <= args.thresholdIsoDate) return "da verificare";
  return "idoneo";
}

function isMissingRelationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /relation .*dpi_/i.test(error.message) && /does not exist/i.test(error.message);
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

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) return [] as T[][];
  const size = Math.max(1, Math.trunc(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
    const limit = parseLimitParam(url.searchParams.get("limit"), query ? 200 : DEFAULT_LIMIT);
    const offset = parseOffsetParam(url.searchParams.get("offset"));

    const todayIsoDate = normalizeIsoDate(simulationDate) ?? new Date().toISOString().slice(0, 10);
    const thresholdIsoDate =
      addDaysIso(todayIsoDate, Number.isFinite(expiringDays) ? expiringDays : 30) ??
      addDaysIso(todayIsoDate, 30) ??
      todayIsoDate;

    const supabase = auth.supabase;
    const employees = await fetchEmployees(supabase, employeeId);
    const employeeIds = employees.map((e) => e.id);

    const [{ data: dpiData, error: dpiError }, { data: rulesData, error: rulesError }] = await Promise.all([
      supabase
        .from("dpi_items")
        .select("id,title,risk_activities,category,control_frequency,control_type")
        .eq("is_active", true)
        .order("title")
        .limit(MAX_DPI_ITEMS + 1),
      supabase
        .from("dpi_matrix_rules")
        .select("scope_type,dpi_id,is_required,job_code_norm,employee_id")
        .in("scope_type", ["job", "employee_override"])
        .limit(MAX_RULES + 1),
    ]);

    if (dpiError) throw new Error(dpiError.message);
    if (rulesError) throw new Error(rulesError.message);

    const dpiItems = (dpiData ?? []) as DpiItemRow[];
    if (dpiItems.length > MAX_DPI_ITEMS) {
      throw new TooManyRowsError(`Troppi DPI attivi (> ${MAX_DPI_ITEMS}). Restringi il dataset o applica paginazione.`);
    }
    const dpiById = new Map<number, DpiItemRow>(dpiItems.map((d) => [d.id, d]));

    const rules = (rulesData ?? []) as RuleRow[];
    if (rules.length > MAX_RULES) {
      throw new TooManyRowsError(`Troppe regole matrice DPI (> ${MAX_RULES}). Restringi il dataset o applica paginazione.`);
    }
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

    const deliveries: EmployeeDpiRow[] = [];
    if (employeeIds.length > 0) {
      for (const part of chunkArray(employeeIds, IN_QUERY_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .from("dpi_employee_items")
          .select("employee_id,dpi_id,delivered_date,planned_date,next_check_date,note")
          .in("employee_id", part);
        if (error) throw new Error(error.message);
        deliveries.push(...((data ?? []) as EmployeeDpiRow[]));
        if (deliveries.length > MAX_DELIVERIES) {
          throw new TooManyRowsError(
            `Troppi record consegne DPI (> ${MAX_DELIVERIES}). Restringi il dataset o applica filtri.`,
          );
        }
      }
    }
    const deliveryByKey = new Map<string, EmployeeDpiRow>();
    for (const row of deliveries) {
      deliveryByKey.set(`${row.employee_id}:${row.dpi_id}`, row);
    }

    const rows: WorkerDpiRow[] = [];
    const pushRow = (row: WorkerDpiRow) => {
      rows.push(row);
      if (rows.length > MAX_OUTPUT_ROWS) {
        throw new TooManyRowsError(
          `Troppi risultati DPI lavoratori (> ${MAX_OUTPUT_ROWS}). Restringi il dataset o applica filtri.`,
        );
      }
    };

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

        const stato = computeDpiState({
          deliveredDate: delivery?.delivered_date ?? null,
          plannedDate: delivery?.planned_date ?? null,
          nextCheckDate: delivery?.next_check_date ?? null,
          todayIsoDate,
          thresholdIsoDate,
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

        pushRow(row);
      }
    }

    rows.sort(
      (a, b) =>
        a.cognome.localeCompare(b.cognome) ||
        a.nome.localeCompare(b.nome) ||
        a.dpi.localeCompare(b.dpi),
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
    });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return NextResponse.json({
        limit: 0,
        offset: 0,
        truncated: false,
        rows: [],
        totalRows: 0,
        warning: "Tabelle DPI non presenti nel DB. Applica lo schema Supabase per abilitare il modulo DPI.",
      });
    }
    if (err instanceof TooManyRowsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
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

  // Round trip di sola COUNT (economica) per sapere quante pagine servono,
  // poi tutte le pagine partono in parallelo invece che in sequenza (vedi
  // stesso fix in lavoratori/corsi, anagrafica e sorveglianza_sanitaria).
  const { count, error: countError } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("status", "attivo");
  if (countError) throw new Error(countError.message);

  const total = count ?? 0;
  if (total > MAX_EMPLOYEES) {
    throw new TooManyRowsError(
      `Troppi lavoratori per vista DPI (> ${MAX_EMPLOYEES}). Restringi il dataset o applica filtri.`,
    );
  }
  if (total === 0) return [] as EmployeeRow[];

  const pageCount = Math.ceil(total / pageSize);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const from = i * pageSize;
      const to = from + pageSize - 1;
      return supabase
        .from("employees")
        .select(
          "id,matricola,first_name,last_name,responsible_code,referral,job_title,sites(display_name),sub_sites(display_name)",
        )
        .eq("status", "attivo")
        .order("last_name")
        .range(from, to);
    }),
  );

  const allRows: EmployeeRow[] = [];
  for (const { data, error } of pages) {
    if (error) throw new Error(error.message);
    allRows.push(...((data ?? []) as EmployeeRow[]));
  }
  return allRows;
}
