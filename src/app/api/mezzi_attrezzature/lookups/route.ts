import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

const MAX_SITES = 5000;
const MAX_SUBSITES = 10000;

class TooManyRowsError extends Error {
  status = 400;
}

export async function GET() {
  const auth = await requireModuleAccess("mezzi_attrezzature", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const [{ data: sites, error: sitesError }, { data: subSites, error: subSitesError }] =
      await Promise.all([
        supabase.from("sites").select("id,display_name").order("display_name").limit(MAX_SITES + 1),
        supabase.from("sub_sites").select("id,site_id,display_name").order("display_name").limit(MAX_SUBSITES + 1),
      ]);

    if (sitesError) throw new Error(sitesError.message);
    if (subSitesError) throw new Error(subSitesError.message);

    if ((sites ?? []).length > MAX_SITES) {
      throw new TooManyRowsError("Troppi cantieri per lookups mezzi/attrezzature. Riduci il dataset o applica paginazione.");
    }
    if ((subSites ?? []).length > MAX_SUBSITES) {
      throw new TooManyRowsError(
        "Troppi sottocantieri per lookups mezzi/attrezzature. Riduci il dataset o applica paginazione.",
      );
    }

    return NextResponse.json({
      sites: (sites ?? []).map((s) => ({ id: s.id, label: s.display_name })),
      subSites: (subSites ?? []).map((s) => ({ id: s.id, siteId: s.site_id, label: s.display_name })),
    });
  } catch (error) {
    if (error instanceof TooManyRowsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento lookups." },
      { status: 500 },
    );
  }
}
