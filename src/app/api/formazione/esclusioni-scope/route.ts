import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { cacheDelete, cacheDeleteByPrefix } from "@/lib/server-cache";

type ScopeType = "site" | "sub_site";

type ToggleBody = {
  scopeType: ScopeType;
  enabled: boolean;
  siteId?: number;
  subSiteId?: number;
};

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50000;
const MAX_LIMIT = 100000;

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const scopeTypeParam = url.searchParams.get("scopeType");
    const scopeType = scopeTypeParam ? (scopeTypeParam as ScopeType) : null;
    const limit = parseLimitParam(url.searchParams.get("limit"));

    if (scopeType !== null && scopeType !== "site" && scopeType !== "sub_site") {
      return NextResponse.json({ error: "scopeType non valido." }, { status: 400 });
    }

    const supabase = auth.supabase;

    let query = supabase
      .from("training_scope_exclusions")
      .select("scope_type,site_id,sub_site_id,is_active")
      .eq("is_active", true);

    if (scopeType) {
      query = query.eq("scope_type", scopeType);
    }

    const { data, error } = await query.limit(limit + 1);
    if (error) throw new Error(error.message);

    const raw = data ?? [];
    const truncated = raw.length > limit;
    const rows = raw.slice(0, limit);

    const excludedKeys = rows
      .map((row) => {
        const s = row as {
          scope_type: ScopeType;
          site_id: number | null;
          sub_site_id: number | null;
          is_active: boolean;
        };
        return s.scope_type === "site" ? String(s.site_id) : String(s.sub_site_id);
      })
      .filter((key) => key !== "null");

    return NextResponse.json({
      scopeType,
      limit,
      truncated,
      excludedKeys,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Errore imprevisto caricando esclusioni scope.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as ToggleBody;

    if (!body.scopeType || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Payload non valido." }, { status: 400 });
    }

    if (body.scopeType === "site") {
      if (!body.siteId || !Number.isFinite(body.siteId)) {
        return NextResponse.json({ error: "siteId obbligatorio per scope site." }, { status: 400 });
      }
    } else {
      if (!body.subSiteId || !Number.isFinite(body.subSiteId)) {
        return NextResponse.json({ error: "subSiteId obbligatorio per scope sub_site." }, { status: 400 });
      }
    }

    const supabase = auth.supabase;

    if (body.enabled) {
      const { error } = await supabase.from("training_scope_exclusions").upsert(
        {
          scope_type: body.scopeType,
          site_id: body.scopeType === "site" ? body.siteId : null,
          sub_site_id: body.scopeType === "sub_site" ? body.subSiteId : null,
          is_active: true,
        },
        { onConflict: "scope_type,site_id,sub_site_id" },
      );
      if (error) throw new Error(error.message);
    } else {
      let query = supabase
        .from("training_scope_exclusions")
        .update({ is_active: false })
        .eq("scope_type", body.scopeType);

      if (body.scopeType === "site") {
        query = query.eq("site_id", body.siteId).is("sub_site_id", null);
      } else {
        query = query.eq("sub_site_id", body.subSiteId).is("site_id", null);
      }

      const { error } = await query;
      if (error) throw new Error(error.message);
    }

    cacheDelete("training_scope_exclusions_v1");
    cacheDeleteByPrefix("training_rows_v2:");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Errore imprevisto aggiornando esclusioni scope.",
      },
      { status: 500 },
    );
  }
}
