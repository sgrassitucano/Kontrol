import { NextResponse } from "next/server";
import { normalizeJobCode } from "@/lib/training/normalize";
import { withModuleAccess } from "@/lib/api/with-module-access";
import { handleError, AppError } from "@/lib/api/error-handler";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheGet, cacheSet, cacheDelete, cacheDeleteByPrefix } from "@/lib/server-cache";

type JobRuleRow = {
  job_code_norm: string;
  always_exempt: boolean;
  exempt_below_weekly_minutes: number | null;
  note: string | null;
};

export const runtime = "nodejs";

const MAX_EMPLOYEES_FOR_JOB_CODES = 20000;
const MAX_JOB_CODES = 5000;
const MAX_JOB_RULES = 50000;

async function listJobCodes(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const map = new Map<string, string>();
  let totalEmployees = 0;

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
    totalEmployees += batch.length;
    if (totalEmployees > MAX_EMPLOYEES_FOR_JOB_CODES) {
      throw new AppError(
        400,
        "TOO_MANY_ROWS",
        `Troppi lavoratori per derivare le mansioni matrice (> ${MAX_EMPLOYEES_FOR_JOB_CODES}). Restringi il dataset o applica paginazione.`
      );
    }
    if (map.size > MAX_JOB_CODES) {
      throw new AppError(
        400,
        "TOO_MANY_ROWS",
        `Troppe mansioni distinte per matrice sorveglianza (> ${MAX_JOB_CODES}). Restringi il dataset o applica paginazione.`
      );
    }
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
    .order("job_code_norm")
    .limit(MAX_JOB_RULES + 1);
  if (error) return { ok: false as const, rows: [] as JobRuleRow[] };
  const rows = (data ?? []) as JobRuleRow[];
  if (rows.length > MAX_JOB_RULES) {
    throw new AppError(
      400,
      "TOO_MANY_ROWS",
      `Troppe regole mansione per matrice sorveglianza (> ${MAX_JOB_RULES}). Restringi il dataset o applica paginazione.`
    );
  }
  return { ok: true as const, rows };
}

export const GET = withModuleAccess("sorveglianza", false, async (request, context, { supabase }) => {
  try {
    const cacheKey = "medical_matrix_v1";
    const cached = cacheGet(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const [jobCodes, rulesResult] = await Promise.all([listJobCodes(supabase), listRules(supabase)]);
    const rulesByCode: Record<string, JobRuleRow> = {};
    rulesResult.rows.forEach((r) => {
      rulesByCode[r.job_code_norm] = r;
    });

    const responseBody = {
      jobCodes,
      rulesByCode,
      supportsRules: rulesResult.ok,
      defaults: {
        exemptJobCodes: ["IMP.CUP", "IMP.CC", "IMP.AMM"],
        exemptBelowWeeklyMinutes: 1200,
        excludedFreezeStatuses: ["maternita", "distacco_sindacale"],
      },
    };

    cacheSet(cacheKey, responseBody, 5 * 60 * 1000); // Cache for 5 minutes

    return NextResponse.json(responseBody);
  } catch (error) {
    return handleError(error, "GET /api/sorveglianza_sanitaria/matrice");
  }
});

export const PATCH = withModuleAccess("gestione", true, async (request, context, { supabase }) => {
  try {
    const body = (await request.json()) as {
      jobCodeNorm: string;
      alwaysExempt?: boolean;
      exemptBelowWeeklyMinutes?: number | null;
      note?: string | null;
    };

    const jobCodeNorm = normalizeJobCode(String(body.jobCodeNorm ?? "").trim());
    if (!jobCodeNorm) {
      throw new AppError(400, "INVALID_PARAM", "jobCodeNorm obbligatorio.");
    }

    const alwaysExempt = Boolean(body.alwaysExempt);
    const exemptBelowWeeklyMinutes =
      body.exemptBelowWeeklyMinutes === null
        ? null
        : Number.isFinite(Number(body.exemptBelowWeeklyMinutes))
          ? Number(body.exemptBelowWeeklyMinutes)
          : null;
    const note = body.note !== undefined ? String(body.note ?? "").trim() || null : null;

    const { error } = await supabase.from("medical_surveillance_job_rules").upsert(
      {
        job_code_norm: jobCodeNorm,
        always_exempt: alwaysExempt,
        exempt_below_weekly_minutes: exemptBelowWeeklyMinutes,
        note,
      },
      { onConflict: "job_code_norm" }
    );
    if (error) throw new Error(error.message);

    cacheDelete("medical_matrix_v1");
    cacheDeleteByPrefix("surveillance_rows_v2:");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, "PATCH /api/sorveglianza_sanitaria/matrice");
  }
});
