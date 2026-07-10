import { NextResponse } from "next/server";
import { buildJobVariantKey, normalizeJobCode } from "@/lib/training/normalize";
import { readMansioniCsv } from "@/lib/training/mansioni";
import { withModuleAccess } from "@/lib/api/with-module-access";
import { handleError, AppError } from "@/lib/api/error-handler";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { cacheGet, cacheSet, cacheDelete, cacheDeleteByPrefix } from "@/lib/server-cache";

type ScopeType = "job" | "site" | "sub_site";

type ToggleBody = {
  scopeType: ScopeType;
  enabled: boolean;
  courseId: number;
  jobCodeNorm?: string;
  siteId?: number;
  subSiteId?: number;
};

export const runtime = "nodejs";

const MAX_COURSES = 5000;
const MAX_RULES = 50000;
const MAX_EMPLOYEES_FOR_JOB_ENTITIES = 20000;
const MAX_SITES = 5000;
const MAX_SUBSITES = 10000;

export const GET = withModuleAccess("gestione", true, async (request, context, { supabase }) => {
  try {
    const url = new URL(request.url);
    const scopeType = (url.searchParams.get("scopeType") ?? "job") as ScopeType;

    if (!["job", "site", "sub_site"].includes(scopeType)) {
      throw new AppError(400, "INVALID_SCOPE", "scopeType non valido.");
    }

    const cacheKey = `training_matrix_v1:${scopeType}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const [{ data: courses, error: coursesError }, entitiesResult, { data: rules, error: rulesError }] =
      await Promise.all([
        supabase
          .from("training_courses")
          .select("id,code,title,is_active")
          .eq("is_active", true)
          .order("code")
          .limit(MAX_COURSES + 1),
        fetchScopeEntities(supabase, scopeType),
        supabase
          .from("training_matrix_rules")
          .select("id,scope_type,course_id,job_code_norm,site_id,sub_site_id,is_required,source")
          .eq("scope_type", scopeType)
          .limit(MAX_RULES + 1),
      ]);

    if (coursesError) throw new Error(coursesError.message);
    if (entitiesResult.error) throw new Error(entitiesResult.error);
    if (rulesError) throw new Error(rulesError.message);

    // Gli aggiornamenti non sono mai assegnabili in matrice: sono impliciti nel corso
    // nativo (chi deve fare CORSO_X deve anche rinnovarlo, non serve un obbligo separato).
    const coursesRows = (courses ?? []).filter((c) => !String(c.code).endsWith("_AGGIORNAMENTO"));
    if (coursesRows.length > MAX_COURSES) {
      throw new AppError(400, "TOO_MANY_ROWS", "Troppi corsi per matrice formazione. Riduci il dataset o applica paginazione.");
    }

    const rulesRows = rules ?? [];
    if (rulesRows.length > MAX_RULES) {
      throw new AppError(400, "TOO_MANY_ROWS", "Troppe regole per matrice formazione. Riduci il dataset o applica paginazione.");
    }

    const flags = new Set<string>();
    const cellSources: Record<string, "baseline" | "manual"> = {};
    rulesRows.forEach((rule) => {
      if (!rule.is_required) return;
      const scopeKey =
        scopeType === "job"
          ? rule.job_code_norm
          : scopeType === "site"
            ? String(rule.site_id)
            : String(rule.sub_site_id);
      const key = `${scopeKey}:${rule.course_id}`;
      flags.add(key);
      const source = rule.source === "manual" ? "manual" : "baseline";
      const existing = cellSources[key];
      if (!existing || source === "manual") {
        cellSources[key] = source;
      }
    });

    const responseBody = {
      scopeType,
      courses: coursesRows,
      entities: entitiesResult.data,
      entitiesTruncated: entitiesResult.truncated,
      flags: Array.from(flags),
      cellSources,
    };

    cacheSet(cacheKey, responseBody, 5 * 60 * 1000); // Cache for 5 minutes

    return NextResponse.json(responseBody);
  } catch (error) {
    return handleError(error, "GET /api/formazione/matrice");
  }
});

export const POST = withModuleAccess("gestione", true, async (request, context, { supabase, userId }) => {
  try {
    const body = (await request.json()) as ToggleBody;

    if (!body.courseId || !body.scopeType || typeof body.enabled !== "boolean") {
      throw new AppError(400, "INVALID_PAYLOAD", "Payload non valido.");
    }

    const match = getScopeMatch(body);
    if ("error" in match) {
      throw new AppError(400, "INVALID_SCOPE_PARAMS", match.error as string);
    }

    if (body.enabled) {
      const { error } = await supabase.from("training_matrix_rules").upsert(
        {
          scope_type: body.scopeType,
          course_id: body.courseId,
          is_required: true,
          source: "manual",
          job_code_norm: match.job_code_norm,
          site_id: match.site_id,
          sub_site_id: match.sub_site_id,
        },
        {
          onConflict:
            "scope_type,course_id,job_code_norm,site_id,sub_site_id,employee_id",
        },
      );

      if (error) throw new Error(error.message);
    } else {
      let query = supabase
        .from("training_matrix_rules")
        .update({ is_required: false, source: "manual" })
        .eq("scope_type", body.scopeType)
        .eq("course_id", body.courseId)
        .is("employee_id", null);

      if (body.scopeType === "job") {
        query = query.eq("job_code_norm", match.job_code_norm).is("site_id", null).is("sub_site_id", null);
      } else if (body.scopeType === "site") {
        query = query.eq("site_id", match.site_id).is("job_code_norm", null).is("sub_site_id", null);
      } else {
        query = query.eq("sub_site_id", match.sub_site_id).is("job_code_norm", null).is("site_id", null);
      }

      const { error } = await query;
      if (error) throw new Error(error.message);
    }

    cacheDelete(`training_matrix_v1:${body.scopeType}`);
    cacheDelete("training_static_v1");
    cacheDeleteByPrefix("training_rows_v2:");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, "POST /api/formazione/matrice");
  }
});

async function fetchScopeEntities(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scopeType: ScopeType,
) {
  if (scopeType === "job") {
    const csvMansioni = await readMansioniCsv();
    const csvKeys = new Set(csvMansioni.map((row) => row.key));

    const { data, error } = await supabase
      .from("employees")
      .select("job_title,job_title_notes")
      .neq("job_title", "")
      .order("job_title")
      .limit(MAX_EMPLOYEES_FOR_JOB_ENTITIES + 1);

    if (error) {
      return {
        data: [] as Array<{ key: string; label: string; isExtra: boolean }>,
        error: error.message,
        truncated: false,
      };
    }

    const truncated = (data ?? []).length > MAX_EMPLOYEES_FOR_JOB_ENTITIES;
    const employeeRows = (data ?? []).slice(0, MAX_EMPLOYEES_FOR_JOB_ENTITIES);

    const extras = new Map<string, string>();
    const variants = new Map<string, string>();
    employeeRows.forEach((row) => {
      const title = String((row as { job_title?: string }).job_title ?? "").trim();
      const notes = String((row as { job_title_notes?: string | null }).job_title_notes ?? "").trim();
      if (!title) return;

      const key = normalizeJobCode(title);
      if (key && !csvKeys.has(key) && !extras.has(key)) extras.set(key, title);

      const variantKey = buildJobVariantKey(title, notes);
      if (variantKey && !variants.has(variantKey)) {
        variants.set(variantKey, notes ? `${title} / ${notes}` : title);
      }
    });

    const baseEntities = csvMansioni.map((row) => ({
      key: row.key,
      label: row.description ? `${row.code} - ${row.description}` : row.code,
      isExtra: false,
    }));

    return {
      data: [
        ...baseEntities,
        ...[
          ...Array.from(extras.entries()).map(([key, label]) => ({ key, label, isExtra: true })),
          ...Array.from(variants.entries()).map(([key, label]) => ({ key, label, isExtra: true })),
        ].sort((a, b) => a.label.localeCompare(b.label)),
      ],
      error: null,
      truncated,
    };
  }

  if (scopeType === "site") {
    const { data, error } = await supabase
      .from("sites")
      .select("id,display_name")
      .order("display_name")
      .limit(MAX_SITES + 1);

    if (error) {
      return { data: [] as Array<{ key: string; label: string }>, error: error.message, truncated: false };
    }

    if ((data ?? []).length > MAX_SITES) {
      return {
        data: [] as Array<{ key: string; label: string }>,
        error: "Troppi cantieri per matrice formazione. Riduci il dataset o applica paginazione.",
        truncated: false,
      };
    }

    return {
      data: (data ?? []).map((row) => ({
        key: String(row.id),
        label: row.display_name,
      })),
      error: null,
      truncated: false,
    };
  }

  const { data, error } = await supabase
    .from("sub_sites")
    .select("id,display_name,sites(display_name)")
    .order("display_name")
    .limit(MAX_SUBSITES + 1);

  if (error) {
    return { data: [] as Array<{ key: string; label: string }>, error: error.message, truncated: false };
  }

  if ((data ?? []).length > MAX_SUBSITES) {
    return {
      data: [] as Array<{ key: string; label: string }>,
      error: "Troppi sottocantieri per matrice formazione. Riduci il dataset o applica paginazione.",
      truncated: false,
    };
  }

  return {
    data: (data ?? []).map((row) => ({
      key: String(row.id),
      label: `${(row as { sites?: { display_name?: string } }).sites?.display_name ?? ""} / ${row.display_name}`,
    })),
    error: null,
    truncated: false,
  };
}

function getScopeMatch(body: ToggleBody) {
  if (body.scopeType === "job") {
    if (!body.jobCodeNorm) {
      return { error: "jobCodeNorm obbligatorio per scope job." };
    }
    return {
      job_code_norm: normalizeJobCode(body.jobCodeNorm),
      site_id: null,
      sub_site_id: null,
    };
  }

  if (body.scopeType === "site") {
    if (!body.siteId) {
      return { error: "siteId obbligatorio per scope site." };
    }
    return {
      job_code_norm: null,
      site_id: body.siteId,
      sub_site_id: null,
    };
  }

  if (!body.subSiteId) {
    return { error: "subSiteId obbligatorio per scope sub_site." };
  }

  return {
    job_code_norm: null,
    site_id: null,
    sub_site_id: body.subSiteId,
  };
}
