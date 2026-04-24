import { NextResponse } from "next/server";
import { normalizeJobCode } from "@/lib/training/normalize";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

function isMissingRelationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /relation .*dpi_/i.test(error.message) && /does not exist/i.test(error.message);
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("dpi", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      employeeId: number;
      dpiId: number;
      mode: "deliver" | "plan" | "require" | "exclude";
      deliveredDate?: string | null;
      plannedDate?: string | null;
      nextCheckDate?: string | null;
      note?: string;
    };

    const employeeId = Number(body.employeeId);
    const dpiId = Number(body.dpiId);
    if (!Number.isFinite(employeeId) || !Number.isFinite(dpiId)) {
      return NextResponse.json({ error: "Dati non validi." }, { status: 400 });
    }

    const mode = body.mode;
    if (!mode) return NextResponse.json({ error: "mode mancante." }, { status: 400 });

    if (mode === "require" || mode === "exclude") {
      const { error } = await supabase
        .from("dpi_matrix_rules")
        .upsert(
          {
            scope_type: "employee_override",
            dpi_id: dpiId,
            is_required: mode === "require",
            source: "manual",
            job_code_norm: null,
            site_id: null,
            sub_site_id: null,
            employee_id: employeeId,
          },
          { onConflict: "scope_type,dpi_id,job_code_norm,site_id,sub_site_id,employee_id" },
        );
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    const { data: employeeData, error: employeeError } = await supabase
      .from("employees")
      .select("id,job_title")
      .eq("id", employeeId)
      .single();
    if (employeeError) throw new Error(employeeError.message);

    const jobCodeNorm = normalizeJobCode(String((employeeData as { job_title?: string }).job_title ?? ""));
    let jobAlreadyRequires = false;
    if (jobCodeNorm) {
      const { data: ruleData, error: ruleError } = await supabase
        .from("dpi_matrix_rules")
        .select("id")
        .eq("scope_type", "job")
        .eq("job_code_norm", jobCodeNorm)
        .eq("dpi_id", dpiId)
        .eq("is_required", true)
        .limit(1);
      if (ruleError) throw new Error(ruleError.message);
      jobAlreadyRequires = (ruleData ?? []).length > 0;
    }

    if (!jobAlreadyRequires) {
      const { error } = await supabase
        .from("dpi_matrix_rules")
        .upsert(
          {
            scope_type: "employee_override",
            dpi_id: dpiId,
            is_required: true,
            source: "manual",
            job_code_norm: null,
            site_id: null,
            sub_site_id: null,
            employee_id: employeeId,
          },
          { onConflict: "scope_type,dpi_id,job_code_norm,site_id,sub_site_id,employee_id" },
        );
      if (error) throw new Error(error.message);
    }

    const payload =
      mode === "deliver"
        ? {
            employee_id: employeeId,
            dpi_id: dpiId,
            delivered_date: body.deliveredDate ?? new Date().toISOString().slice(0, 10),
            planned_date: null,
            next_check_date: body.nextCheckDate ?? null,
            note: typeof body.note === "string" ? body.note : null,
          }
        : {
            employee_id: employeeId,
            dpi_id: dpiId,
            delivered_date: null,
            planned_date: body.plannedDate ?? new Date().toISOString().slice(0, 10),
            next_check_date: body.nextCheckDate ?? null,
            note: typeof body.note === "string" ? body.note : null,
          };

    const { error: upsertError } = await supabase
      .from("dpi_employee_items")
      .upsert(payload, { onConflict: "employee_id,dpi_id" });
    if (upsertError) throw new Error(upsertError.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return NextResponse.json(
        { error: "Tabelle DPI non presenti nel DB. Applica lo schema Supabase." },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore assegnazione DPI." },
      { status: 500 },
    );
  }
}
