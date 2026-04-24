import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

class ClientError extends Error {}

type AssignmentRow = {
  id: number;
  employee_id: number;
  site_id: number;
  sub_site_id: number | null;
  start_date: string;
  end_date: string | null;
  note: string | null;
  employees: unknown;
  sites: unknown;
};

function extractDisplayName(value: unknown, fallback = "-") {
  if (!value) return fallback;
  if (Array.isArray(value)) {
    const first = value[0] as { display_name?: string; first_name?: string; last_name?: string; matricola?: string } | undefined;
    if (!first) return fallback;
    if (typeof first.display_name === "string") return first.display_name;
    const name = `${first.last_name ?? ""} ${first.first_name ?? ""}`.trim();
    return name || fallback;
  }
  if (typeof value === "object") {
    const obj = value as { display_name?: string; first_name?: string; last_name?: string; matricola?: string };
    if (typeof obj.display_name === "string") return obj.display_name;
    const name = `${obj.last_name ?? ""} ${obj.first_name ?? ""}`.trim();
    return name || fallback;
  }
  return fallback;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseIsoDate(value: unknown) {
  const v = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

async function resolveValidatedSubSiteId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  siteId: number,
  subSiteIdInput: unknown,
) {
  const hasValue = subSiteIdInput !== undefined;
  const raw = hasValue ? subSiteIdInput : null;
  const subSiteId = raw === null || raw === "" ? null : Number(raw);

  const { data: anySubSites, error: anySubSitesError } = await supabase
    .from("sub_sites")
    .select("id")
    .eq("site_id", siteId)
    .limit(1);
  if (anySubSitesError) throw new Error(anySubSitesError.message);
  const siteHasSubSites = (anySubSites ?? []).length > 0;

  if (!siteHasSubSites) {
    if (subSiteId === null) return null;
    if (!Number.isFinite(subSiteId)) throw new ClientError("subSiteId non valido.");
    const { data: match, error: matchError } = await supabase
      .from("sub_sites")
      .select("id")
      .eq("id", subSiteId)
      .eq("site_id", siteId)
      .limit(1);
    if (matchError) throw new Error(matchError.message);
    if ((match ?? []).length === 0) throw new ClientError("Sottocantiere non valido per il cantiere selezionato.");
    return subSiteId;
  }

  if (subSiteId === null || !Number.isFinite(subSiteId)) {
    throw new ClientError("Se il cantiere ha sottocantieri, il sottocantiere è obbligatorio.");
  }

  const { data: match, error: matchError } = await supabase
    .from("sub_sites")
    .select("id")
    .eq("id", subSiteId)
    .eq("site_id", siteId)
    .limit(1);
  if (matchError) throw new Error(matchError.message);
  if ((match ?? []).length === 0) throw new ClientError("Sottocantiere non valido per il cantiere selezionato.");
  return subSiteId;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const siteIdParam = url.searchParams.get("siteId");
    const subSiteIdParam = url.searchParams.get("subSiteId");
    const employeeIdParam = url.searchParams.get("employeeId");
    const siteId = siteIdParam ? Number(siteIdParam) : null;
    const subSiteId = subSiteIdParam ? Number(subSiteIdParam) : null;
    const employeeId = employeeIdParam ? Number(employeeIdParam) : null;

    const supabase = auth.supabase;
    let query = supabase
      .from("turni_employee_site_assignments")
      .select(
        "id,employee_id,site_id,sub_site_id,start_date,end_date,note,employees(id,matricola,first_name,last_name),sites(id,display_name)",
      )
      .order("start_date", { ascending: false });

    if (typeof siteId === "number" && Number.isFinite(siteId)) query = query.eq("site_id", siteId);
    if (typeof subSiteId === "number" && Number.isFinite(subSiteId)) query = query.eq("sub_site_id", subSiteId);
    if (typeof employeeId === "number" && Number.isFinite(employeeId)) query = query.eq("employee_id", employeeId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AssignmentRow[];

    const subSiteIds = Array.from(new Set(rows.map((r) => r.sub_site_id).filter((v): v is number => typeof v === "number")));
    const subSitesById = new Map<number, string>();
    if (subSiteIds.length > 0) {
      const { data: subSitesData, error: subSitesError } = await supabase
        .from("sub_sites")
        .select("id,display_name")
        .in("id", subSiteIds);
      if (subSitesError) throw new Error(subSitesError.message);
      for (const s of (subSitesData ?? []) as Array<{ id: number; display_name: string }>) {
        subSitesById.set(s.id, s.display_name);
      }
    }

    return NextResponse.json({
      rows: rows.map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeLabel: extractDisplayName(r.employees),
        siteId: r.site_id,
        siteLabel: extractDisplayName(r.sites),
        subSiteId: r.sub_site_id,
        subSiteLabel: r.sub_site_id ? (subSitesById.get(r.sub_site_id) ?? "-") : "-",
        startDate: r.start_date,
        endDate: r.end_date,
        note: r.note ?? "",
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento assegnazioni." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      employeeId: number;
      siteId: number;
      subSiteId?: number | null;
      startDate: string;
      endDate?: string | null;
      note?: string;
    };

    const employeeId = Number(body.employeeId);
    const siteId = Number(body.siteId);
    if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });

    const startDate = parseIsoDate(body.startDate);
    const endDate = body.endDate ? parseIsoDate(body.endDate) : null;
    if (!startDate) return NextResponse.json({ error: "startDate non valido." }, { status: 400 });
    if (body.endDate && !endDate) return NextResponse.json({ error: "endDate non valido." }, { status: 400 });

    const subSiteId = await resolveValidatedSubSiteId(supabase, siteId, body.subSiteId);

    const { data, error } = await supabase
      .from("turni_employee_site_assignments")
      .insert({
        employee_id: employeeId,
        site_id: siteId,
        sub_site_id: subSiteId,
        start_date: startDate,
        end_date: endDate,
        note: normalizeText(body.note) || null,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ id: (data as { id: number }).id });
  } catch (err) {
    const status = err instanceof ClientError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore creazione assegnazione." },
      { status },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as { assignmentId: number; endDate: string | null; note?: string };

    const assignmentId = Number(body.assignmentId);
    if (!Number.isFinite(assignmentId)) {
      return NextResponse.json({ error: "assignmentId non valido." }, { status: 400 });
    }

    const endDate = body.endDate ? parseIsoDate(body.endDate) : null;
    if (body.endDate && !endDate) return NextResponse.json({ error: "endDate non valido." }, { status: 400 });

    const payload: Record<string, unknown> = { end_date: endDate };
    if (typeof body.note === "string") payload.note = normalizeText(body.note) || null;

    const { error } = await supabase.from("turni_employee_site_assignments").update(payload).eq("id", assignmentId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore aggiornamento assegnazione." },
      { status: 500 },
    );
  }
}
