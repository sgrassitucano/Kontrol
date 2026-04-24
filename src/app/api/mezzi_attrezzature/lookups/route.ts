import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireModuleAccess("mezzi_attrezzature", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const [{ data: sites, error: sitesError }, { data: subSites, error: subSitesError }] =
      await Promise.all([
        supabase.from("sites").select("id,display_name").order("display_name"),
        supabase.from("sub_sites").select("id,site_id,display_name").order("display_name"),
      ]);

    if (sitesError) throw new Error(sitesError.message);
    if (subSitesError) throw new Error(subSitesError.message);

    return NextResponse.json({
      sites: (sites ?? []).map((s) => ({ id: s.id, label: s.display_name })),
      subSites: (subSites ?? []).map((s) => ({ id: s.id, siteId: s.site_id, label: s.display_name })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento lookups." },
      { status: 500 },
    );
  }
}
