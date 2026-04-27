import { NextResponse } from "next/server";
import { normalizeJobCode } from "@/lib/training/normalize";
import { getCurrentUserContext, requireModuleAccess } from "@/lib/api/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type JobRuleRow = {
  job_code_norm: string;
  always_exempt: boolean;
  exempt_below_weekly_minutes: number | null;
  note: string | null;
};

export const runtime = "nodejs";

async function listJobCodes(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const map = new Map<string, string>();

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employees")
      .select("job_title")
      .eq("status", "attivo")
      .order("job_title")
      .range(from, to);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((row) => {
      const label = String((row as { job_title?: string }).job_title ?? "").trim();
      if (!label) return;
      const key = normalizeJobCode(label);
      if (!map.has(key)) map.set(key, label);
    });
    const batch = (data ?? []) as Array<{ job_title: string }>;
    if (batch.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  return Array.from(map.entries())
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function listRules(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("medical_surveillance_job_rules")
    .select("job_code_norm,always_exempt,exempt_below_weekly_minutes,note")
    .order("job_code_norm");
  if (error) return { ok: false as const, rows: [] as JobRuleRow[] };
  return { ok: true as const, rows: (data ?? []) as JobRuleRow[] };
}

export async function GET() {
  const auth = await requireModuleAccess("sorveglianza", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const ctx = await getCurrentUserContext(auth.supabase);
    const dataSupabase =
      ctx.isActive && (ctx.role === "viewer" || ctx.role === "admin") ? createSupabaseAdminClient() : auth.supabase;

    const [jobCodes, rulesResult] = await Promise.all([listJobCodes(dataSupabase), listRules(dataSupabase)]);
    const rulesByCode: Record<string, JobRuleRow> = {};
    rulesResult.rows.forEach((r) => {
      rulesByCode[r.job_code_norm] = r;
    });

    return NextResponse.json({
      jobCodes,
      rulesByCode,
      supportsRules: rulesResult.ok,
      defaults: {
        exemptJobCodes: ["IMP.CUP", "IMP.CC", "IMP.AMM"],
        exemptBelowWeeklyMinutes: 1200,
        excludedFreezeStatuses: ["maternita", "distacco_sindacale"],
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento matrice sorveglianza." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as {
      jobCodeNorm: string;
      alwaysExempt?: boolean;
      exemptBelowWeeklyMinutes?: number | null;
      note?: string | null;
    };

    const jobCodeNorm = normalizeJobCode(String(body.jobCodeNorm ?? "").trim());
    if (!jobCodeNorm) return NextResponse.json({ error: "jobCodeNorm obbligatorio." }, { status: 400 });

    const alwaysExempt = Boolean(body.alwaysExempt);
    const exemptBelowWeeklyMinutes =
      body.exemptBelowWeeklyMinutes === null
        ? null
        : Number.isFinite(Number(body.exemptBelowWeeklyMinutes))
          ? Number(body.exemptBelowWeeklyMinutes)
          : null;
    const note = body.note !== undefined ? String(body.note ?? "").trim() || null : null;

    const supabaseAdmin = createSupabaseAdminClient();
    const { error } = await supabaseAdmin.from("medical_surveillance_job_rules").upsert(
      {
        job_code_norm: jobCodeNorm,
        always_exempt: alwaysExempt,
        exempt_below_weekly_minutes: exemptBelowWeeklyMinutes,
        note,
      },
      { onConflict: "job_code_norm" },
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore aggiornamento matrice sorveglianza." },
      { status: 500 },
    );
  }
}

