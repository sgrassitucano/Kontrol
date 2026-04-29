import { NextResponse } from "next/server";
import { getCurrentUserContext, requireAnyModuleAccess, requireModuleAccess } from "@/lib/api/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

export async function GET(request: Request) {
  const auth = await requireAnyModuleAccess(["gestione", "sorveglianza"], false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const employeeId = Number(url.searchParams.get("employeeId") ?? "");
    if (!employeeId || Number.isNaN(employeeId)) {
      return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    }

    const ctx = await getCurrentUserContext(auth.supabase);
    const dataSupabase =
      ctx.isActive && (ctx.role === "viewer" || ctx.role === "admin") ? createSupabaseAdminClient() : auth.supabase;

    const [employee, record, exclusion, override] = await Promise.all([
      dataSupabase
        .from("employees")
        .select(
          "id,matricola,first_name,last_name,job_title,theoretical_weekly_minutes,site_id,sub_site_id,sites(display_name),sub_sites(display_name)",
        )
        .eq("id", employeeId)
        .maybeSingle(),
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
    ]);

    if (employee.error) throw new Error(employee.error.message);
    if (!employee.data) return NextResponse.json({ error: "Lavoratore non trovato." }, { status: 404 });
    if (record.error) throw new Error(record.error.message);
    if (exclusion.error) throw new Error(exclusion.error.message);
    if (override.error) throw new Error(override.error.message);

    const e = employee.data as unknown as DetailEmployeeRow;
    const r = (record.data ?? null) as unknown as RecordRow | null;
    const ex = (exclusion.data ?? null) as unknown as ExclusionRow | null;
    const ov = (override.data ?? null) as unknown as OverrideRow | null;

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

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore aggiornamento lavoratore." },
      { status: 500 },
    );
  }
}
