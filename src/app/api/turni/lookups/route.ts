import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type SiteRow = { id: number; display_name: string };
type SubSiteRow = { id: number; site_id: number; display_name: string };

type EmployeeRow = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
  responsible_code: string;
  referral: string | null;
  site_id: number | null;
  sub_site_id: number | null;
  job_title: string;
  sites: unknown;
  sub_sites: unknown;
};

function extractDisplayName(value: unknown) {
  if (!value) return "-";
  if (Array.isArray(value)) {
    const first = value[0] as { display_name?: string } | undefined;
    return first?.display_name ?? "-";
  }
  if (typeof value === "object") {
    return (value as { display_name?: string }).display_name ?? "-";
  }
  return "-";
}

function parseLimitParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 2000);
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const limit = parseLimitParam(url.searchParams.get("limit"), q ? 200 : 500);

    const supabase = auth.supabase;

    const [
      { data: sitesData, error: sitesError },
      { data: subSitesData, error: subSitesError },
      { data: employeesData, error: employeesError },
    ] = await Promise.all([
      supabase.from("sites").select("id,display_name").order("display_name"),
      supabase.from("sub_sites").select("id,site_id,display_name").order("display_name"),
      (() => {
        let query = supabase
          .from("employees")
          .select(
            "id,matricola,first_name,last_name,responsible_code,referral,site_id,sub_site_id,job_title,sites(display_name),sub_sites(display_name)",
          )
          .eq("status", "attivo")
          .order("last_name")
          .limit(limit);

        if (q) {
          const like = `%${q}%`;
          query = query.or(
            [
              `matricola.ilike.${like}`,
              `last_name.ilike.${like}`,
              `first_name.ilike.${like}`,
              `responsible_code.ilike.${like}`,
              `referral.ilike.${like}`,
              `job_title.ilike.${like}`,
            ].join(","),
          );
        }

        return query;
      })(),
    ]);

    if (sitesError) throw new Error(sitesError.message);
    if (subSitesError) throw new Error(subSitesError.message);
    if (employeesError) throw new Error(employeesError.message);

    const employees = (employeesData ?? []) as EmployeeRow[];

    const allowedSiteIds = new Set<number>();
    const allowedSubSiteIds = new Set<number>();
    for (const e of employees) {
      if (typeof e.site_id === "number") allowedSiteIds.add(e.site_id);
      if (typeof e.sub_site_id === "number") allowedSubSiteIds.add(e.sub_site_id);
    }

    const sites = ((sitesData ?? []) as SiteRow[])
      .filter((s) => allowedSiteIds.has(s.id))
      .map((s) => ({ id: s.id, label: s.display_name }));
    const subSites = ((subSitesData ?? []) as SubSiteRow[])
      .filter((s) => allowedSubSiteIds.has(s.id))
      .map((s) => ({
        id: s.id,
        siteId: s.site_id,
        label: s.display_name,
      }));
    return NextResponse.json({
      limit,
      sites,
      subSites,
      employees: employees.map((e) => ({
        id: e.id,
        matricola: e.matricola,
        cognome: e.last_name,
        nome: e.first_name,
        responsabile: e.responsible_code,
        referente: e.referral ?? "",
        mansione: e.job_title,
        siteId: e.site_id,
        subSiteId: e.sub_site_id,
        cantiere: extractDisplayName(e.sites),
        sottocantiere: extractDisplayName(e.sub_sites),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento lookup turni." },
      { status: 500 },
    );
  }
}
