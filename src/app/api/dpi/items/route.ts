import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

function normalizeQuery(value: string | null) {
  const q = String(value ?? "").trim();
  if (!q) return null;
  return q.slice(0, 80);
}

type DpiItemRow = {
  id: number;
  title: string;
  risk_activities: string | null;
  category: string | null;
  control_frequency: string | null;
  control_type: string | null;
  is_active: boolean;
};

function isMissingRelationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /relation .*dpi_items.* does not exist/i.test(error.message);
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("dpi", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const q = normalizeQuery(url.searchParams.get("q"));
    const limit = parseLimitParam(url.searchParams.get("limit"), q ? 200 : DEFAULT_LIMIT);

    const supabase = auth.supabase;
    let query = supabase
      .from("dpi_items")
      .select("id,title,risk_activities,category,control_frequency,control_type,is_active")
      .eq("is_active", true)
      .order("title", { ascending: true });
    if (q) {
      query = query.ilike("title", `%${q}%`);
    }
    const { data, error } = await query.limit(limit + 1);

    if (error) throw new Error(error.message);
    const raw = (data ?? []) as DpiItemRow[];
    const truncated = raw.length > limit;
    const rows = raw.slice(0, limit);

    return NextResponse.json({
      limit,
      truncated,
      rows: rows.map((row) => ({
        id: row.id,
        title: row.title,
        riskActivities: row.risk_activities ?? "",
        category: row.category ?? "",
        controlFrequency: row.control_frequency ?? "",
        controlType: row.control_type ?? "",
      })),
    });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return NextResponse.json({
        limit: 0,
        truncated: false,
        rows: [],
        warning: "Tabelle DPI non presenti nel DB. Applica lo schema Supabase per abilitare il modulo DPI.",
      });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento DPI." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("dpi", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      title: string;
      riskActivities?: string;
      category?: string;
      controlFrequency?: string;
      controlType?: string;
    };

    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "Titolo DPI mancante." }, { status: 400 });
    }

    const payload = {
      title,
      risk_activities: String(body.riskActivities ?? "").trim() || null,
      category: String(body.category ?? "").trim() || null,
      control_frequency: String(body.controlFrequency ?? "").trim() || null,
      control_type: String(body.controlType ?? "").trim() || null,
      is_active: true,
    };

    const { data, error } = await supabase
      .from("dpi_items")
      .upsert(payload, { onConflict: "title" })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ id: (data as { id: number }).id });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return NextResponse.json(
        { error: "Tabelle DPI non presenti nel DB. Applica lo schema Supabase." },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore creazione DPI." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireModuleAccess("dpi", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      id: number;
      title?: string;
      riskActivities?: string;
      category?: string;
      controlFrequency?: string;
      controlType?: string;
      isActive?: boolean;
    };

    const id = Number(body.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id DPI non valido." }, { status: 400 });
    }

    const payload: Record<string, unknown> = {};

    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) {
        return NextResponse.json({ error: "Titolo DPI mancante." }, { status: 400 });
      }
      payload.title = title;
    }

    if (typeof body.riskActivities === "string") {
      payload.risk_activities = body.riskActivities.trim() || null;
    }
    if (typeof body.category === "string") {
      payload.category = body.category.trim() || null;
    }
    if (typeof body.controlFrequency === "string") {
      payload.control_frequency = body.controlFrequency.trim() || null;
    }
    if (typeof body.controlType === "string") {
      payload.control_type = body.controlType.trim() || null;
    }
    if (typeof body.isActive === "boolean") {
      if (body.isActive === false) {
        const [{ count: rulesCount, error: rulesError }, { count: empCount, error: empError }] = await Promise.all([
          supabase.from("dpi_matrix_rules").select("id", { count: "exact", head: true }).eq("dpi_id", id),
          supabase.from("dpi_employee_items").select("employee_id", { count: "exact", head: true }).eq("dpi_id", id),
        ]);
        if (rulesError) throw new Error(rulesError.message);
        if (empError) throw new Error(empError.message);
        const rules = typeof rulesCount === "number" ? rulesCount : 0;
        const rows = typeof empCount === "number" ? empCount : 0;
        if (rules > 0 || rows > 0) {
          return NextResponse.json(
            {
              error:
                "Impossibile disattivare: esistono regole matrice o consegne collegate. Rimuovi prima le regole/righe collegate.",
              details: { matrixRules: rules, employeeRows: rows },
            },
            { status: 409 },
          );
        }
      }
      payload.is_active = body.isActive;
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "Nessun campo da aggiornare." }, { status: 400 });
    }

    const { error } = await supabase.from("dpi_items").update(payload).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return NextResponse.json(
        { error: "Tabelle DPI non presenti nel DB. Applica lo schema Supabase." },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore modifica DPI." },
      { status: 500 },
    );
  }
}
