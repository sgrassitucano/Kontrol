import { NextResponse } from "next/server";
import { requireAnyModuleAccess, requireModuleAccess } from "@/lib/api/access";
import { cacheDeleteByPrefix } from "@/lib/server-cache";
import { normalizeJobCode } from "@/lib/training/normalize";

export const runtime = "nodejs";

type DetailEmployeeRow = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
  job_title: string;
  theoretical_weekly_minutes: number;
  site_id: number;
  sub_site_id: number | null;
  sites: unknown;
  sub_sites: unknown;
};

type RecordRow = {
  employee_id: number;
  provider: string | null;
  is_planned: boolean;
  next_due_date: string | null;
  limitations: string | null;
  notes: string | null;
};

type ExclusionRow = { employee_id: number; is_active: boolean; note: string | null };
type OverrideRow = { employee_id: number; requires_visit: boolean; is_active: boolean; note: string | null };
type FreezeRow = { employee_id: number; freeze_status: string; start_date: string; end_date: string | null };
type JobRuleRow = { job_code_norm: string; always_exempt: boolean; exempt_below_weekly_minutes: number | null };
type ScopeRuleRow = { scope_type: "site" | "sub_site"; site_id: number | null; sub_site_id: number | null; requires_visit: boolean };

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
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
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

export async function GET(request: Request) {
  const auth = await requireAnyModuleAccess(["gestione", "sorveglianza"], false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const employeeId = Number(url.searchParams.get("employeeId") ?? "");
    const expiringDaysRaw = url.searchParams.get("expiringDays");
    const expiringDays = (() => {
      const n = Number(expiringDaysRaw ?? "");
      if (!expiringDaysRaw) return 30;
      if (!Number.isFinite(n) || n <= 0) return 30;
      return Math.min(365, Math.floor(n));
    })();
    if (!employeeId || Number.isNaN(employeeId)) {
      return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    }

    const dataSupabase = auth.supabase;
    const employee = await dataSupabase
      .from("employees")
      .select(
        "id,matricola,first_name,last_name,job_title,theoretical_weekly_minutes,site_id,sub_site_id,sites(display_name),sub_sites(display_name)",
      )
      .eq("id", employeeId)
      .maybeSingle();
    if (employee.error) throw new Error(employee.error.message);
    if (!employee.data) return NextResponse.json({ error: "Lavoratore non trovato." }, { status: 404 });

    const e = employee.data as unknown as DetailEmployeeRow;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const thresholdDate = new Date(today);
    thresholdDate.setDate(thresholdDate.getDate() + expiringDays);
    const todayIsoDate = today.toISOString().slice(0, 10);
    const thresholdIsoDate = thresholdDate.toISOString().slice(0, 10);
    const jobCodeNorm = normalizeJobCode(e.job_title ?? "");

    const [record, exclusion, override, freezeRows, jobRule, scopeRules] = await Promise.all([
      dataSupabase
        .from("medical_surveillance_records")
        .select("employee_id,provider,is_planned,next_due_date,limitations,notes")
        .eq("employee_id", employeeId)
        .maybeSingle(),
      dataSupabase
        .from("medical_surveillance_employee_exclusions")
        .select("employee_id,is_active,note")
        .eq("employee_id", employeeId)
        .eq("is_active", true)
        .maybeSingle(),
      dataSupabase
        .from("medical_surveillance_employee_overrides")
        .select("employee_id,requires_visit,is_active,note")
        .eq("employee_id", employeeId)
        .eq("is_active", true)
        .maybeSingle(),
      dataSupabase
        .from("employee_freeze_periods")
        .select("employee_id,freeze_status,start_date,end_date")
        .eq("employee_id", employeeId),
      dataSupabase
        .from("medical_surveillance_job_rules")
        .select("job_code_norm,always_exempt,exempt_below_weekly_minutes")
        .eq("job_code_norm", jobCodeNorm)
        .maybeSingle(),
      dataSupabase
        .from("medical_surveillance_scope_rules")
        .select("scope_type,site_id,sub_site_id,requires_visit")
        .or(
          typeof e.sub_site_id === "number" && e.sub_site_id
            ? `and(scope_type.eq.sub_site,sub_site_id.eq.${e.sub_site_id}),and(scope_type.eq.site,site_id.eq.${e.site_id})`
            : `and(scope_type.eq.site,site_id.eq.${e.site_id})`,
        ),
    ]);

    if (record.error) throw new Error(record.error.message);
    if (exclusion.error) throw new Error(exclusion.error.message);
    if (override.error) throw new Error(override.error.message);
    if (freezeRows.error) throw new Error(freezeRows.error.message);
    if (jobRule.error) throw new Error(jobRule.error.message);
    if (scopeRules.error) throw new Error(scopeRules.error.message);

    const r = (record.data ?? null) as unknown as RecordRow | null;
    const ex = (exclusion.data ?? null) as unknown as ExclusionRow | null;
    const ov = (override.data ?? null) as unknown as OverrideRow | null;
    const freeze = ((freezeRows.data ?? []) as FreezeRow[]).find((row) => {
      const start = normalizeIsoDate(row.start_date);
      const end = row.end_date ? normalizeIsoDate(row.end_date) : null;
      if (!start) return false;
      if (start > todayIsoDate) return false;
      if (end && end < todayIsoDate) return false;
      return true;
    }) ?? null;
    const jr = (jobRule.data ?? null) as unknown as JobRuleRow | null;
    const sr = (scopeRules.data ?? []) as unknown as ScopeRuleRow[];
    const subSiteRule =
      typeof e.sub_site_id === "number" && e.sub_site_id
        ? sr.find((row) => row.scope_type === "sub_site" && row.sub_site_id === e.sub_site_id) ?? null
        : null;
    const siteRule = sr.find((row) => row.scope_type === "site" && row.site_id === e.site_id) ?? null;
    const excludedByJob =
      Boolean(jr?.always_exempt) ||
      (typeof jr?.exempt_below_weekly_minutes === "number" && e.theoretical_weekly_minutes < jr.exempt_below_weekly_minutes);
    const derivedRequiresVisit = subSiteRule?.requires_visit ?? siteRule?.requires_visit ?? !excludedByJob;
    const requiresVisit = ex?.is_active ? false : ov ? ov.requires_visit : derivedRequiresVisit;
    const baseState =
      freeze && !ex?.is_active
        ? ("sospeso" as const)
        : computeState({
            todayIsoDate,
            thresholdIsoDate,
            requiresVisit,
            nextDueDate: r?.next_due_date ?? null,
            isPlanned: Boolean(r?.is_planned ?? false),
          });
    const state = ex?.is_active ? "escluso" : baseState;

    return NextResponse.json({
      employee: {
        id: e.id,
        matricola: e.matricola,
        first_name: e.first_name,
        last_name: e.last_name,
        job_title: e.job_title,
        theoretical_weekly_minutes: e.theoretical_weekly_minutes,
        site: extractDisplayName(e.sites),
        sub_site: extractDisplayName(e.sub_sites),
      },
      record: r,
      exclusion: ex,
      override: ov,
      state,
      requiresVisit,
      freezeStatus: freeze?.freeze_status ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento lavoratore." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as Partial<{
      employeeId: number;
      provider: string | null;
      planned: boolean;
      exclusionEnabled: boolean;
      exclusionNote: string | null;
      overrideEnabled: boolean;
      overrideRequiresVisit: boolean;
      overrideNote: string | null;
    }>;

    const employeeId = Number(body.employeeId);
    if (!employeeId || Number.isNaN(employeeId)) {
      return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    }

    const updates: Array<PromiseLike<unknown>> = [];

    if ("provider" in body) {
      updates.push(
        auth.supabase
          .from("medical_surveillance_records")
          .upsert(
            {
              employee_id: employeeId,
              provider: typeof body.provider === "string" ? body.provider.trim() || null : null,
              created_by: auth.userId,
            },
            { onConflict: "employee_id" },
          ),
      );
    }

    if (typeof body.planned === "boolean") {
      updates.push(
        auth.supabase
          .from("medical_surveillance_records")
          .upsert(
            {
              employee_id: employeeId,
              is_planned: body.planned,
              created_by: auth.userId,
            },
            { onConflict: "employee_id" },
          ),
      );
    }

    if (typeof body.exclusionEnabled === "boolean") {
      updates.push(
        auth.supabase
          .from("medical_surveillance_employee_exclusions")
          .upsert(
            {
              employee_id: employeeId,
              is_active: body.exclusionEnabled,
              note: typeof body.exclusionNote === "string" ? body.exclusionNote.trim() || null : null,
              created_by: auth.userId,
            },
            { onConflict: "employee_id" },
          ),
      );
    }

    if (typeof body.overrideEnabled === "boolean") {
      updates.push(
        auth.supabase
          .from("medical_surveillance_employee_overrides")
          .upsert(
            {
              employee_id: employeeId,
              is_active: body.overrideEnabled,
              requires_visit: Boolean(body.overrideRequiresVisit),
              note: typeof body.overrideNote === "string" ? body.overrideNote.trim() || null : null,
              created_by: auth.userId,
            },
            { onConflict: "employee_id" },
          ),
      );
    }

    const results = await Promise.all(updates);
    const firstError = results.find((res) => (res as { error?: { message: string } } | null)?.error);
    if (firstError && (firstError as { error?: { message: string } }).error) {
      throw new Error((firstError as { error?: { message: string } }).error?.message);
    }

    cacheDeleteByPrefix("surveillance_rows_v1:");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore aggiornamento lavoratore." },
      { status: 500 },
    );
  }
}
