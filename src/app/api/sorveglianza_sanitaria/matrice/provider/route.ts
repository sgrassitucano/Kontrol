import { NextResponse } from "next/server";
import { requireAnyModuleAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type SiteRow = { id: number; display_name: string };
type SubSiteRow = { id: number; site_id: number; display_name: string };
type ProviderRow = {
  scope_type: "site" | "sub_site";
  site_id: number | null;
  sub_site_id: number | null;
  provider: string;
  is_active: boolean;
  note: string | null;
};

export async function GET() {
  const auth = await requireAnyModuleAccess(["gestione", "sorveglianza"], false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const [sites, subSites, assignments] = await Promise.all([
      fetchAllSites(auth.supabase),
      fetchAllSubSites(auth.supabase),
      fetchAllAssignments(auth.supabase),
    ]);

    return NextResponse.json({ sites, subSites, assignments, supportsRules: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento matrice provider." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAnyModuleAccess(["gestione", "sorveglianza"], true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as Partial<{
      scopeType: "site" | "sub_site";
      siteId: number;
      subSiteId: number;
      provider: string;
      enabled: boolean;
      note: string | null;
    }>;

    const scopeType = body.scopeType === "sub_site" ? "sub_site" : "site";
    const provider = String(body.provider ?? "").trim();
    const enabled = body.enabled !== false;
    const note = typeof body.note === "string" ? body.note.trim() || null : null;

    const siteId = body.siteId ? Number(body.siteId) : null;
    const subSiteId = body.subSiteId ? Number(body.subSiteId) : null;

    if (scopeType === "site") {
      if (!siteId) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    } else {
      if (!subSiteId) return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });
    }

    if (enabled && !provider) {
      return NextResponse.json({ error: "provider non valido." }, { status: 400 });
    }

    const payload =
      scopeType === "site"
        ? {
            scope_type: "site" as const,
            site_id: siteId,
            sub_site_id: null,
            provider: provider || "MISTO",
            is_active: enabled,
            note,
            created_by: auth.userId,
          }
        : {
            scope_type: "sub_site" as const,
            site_id: null,
            sub_site_id: subSiteId,
            provider: provider || "MISTO",
            is_active: enabled,
            note,
            created_by: auth.userId,
          };

    const { error } = await auth.supabase
      .from("medical_surveillance_provider_assignments")
      .upsert(payload, { onConflict: "scope_type,site_id,sub_site_id" });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore salvataggio matrice provider." },
      { status: 500 },
    );
  }
}

async function fetchAllSites(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("sites").select("id,display_name").order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as SiteRow[];
}

async function fetchAllSubSites(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("sub_sites").select("id,site_id,display_name").order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as SubSiteRow[];
}

async function fetchAllAssignments(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("medical_surveillance_provider_assignments")
    .select("scope_type,site_id,sub_site_id,provider,is_active,note");
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderRow[];
}
