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

const IN_QUERY_CHUNK_SIZE = 500;

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) return [] as T[][];
  const size = Math.max(1, Math.trunc(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const limit = parseLimitParam(url.searchParams.get("limit"), q ? 200 : 500);

    const supabase = auth.supabase;

    let employeesQuery = supabase
      .from("employees")
      .select(
        "id,matricola,first_name,last_name,responsible_code,referral,site_id,sub_site_id,job_title,sites(display_name),sub_sites(display_name)",
      )
      .eq("status", "attivo")
      .order("last_name")
      .order("first_name")
      .limit(limit + 1);

    if (q) {
      const like = `%${q}%`;
      employeesQuery = employeesQuery.or(
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

    const { data: employeesData, error: employeesError } = await employeesQuery;
    if (employeesError) throw new Error(employeesError.message);

    const employeesRaw = (employeesData ?? []) as EmployeeRow[];
    const truncated = employeesRaw.length > limit;
    const employees = employeesRaw.slice(0, limit);

    const allowedSiteIds = new Set<number>();
    const allowedSubSiteIds = new Set<number>();
    for (const e of employees) {
      if (typeof e.site_id === "number") allowedSiteIds.add(e.site_id);
      if (typeof e.sub_site_id === "number") allowedSubSiteIds.add(e.sub_site_id);
    }

    const sites: Array<{ id: number; label: string }> = [];
    const subSites: Array<{ id: number; siteId: number; label: string }> = [];

    const siteIds = Array.from(allowedSiteIds);
    for (const part of chunkArray(siteIds, IN_QUERY_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from("sites")
        .select("id,display_name")
        .in("id", part)
        .order("display_name");
      if (error) throw new Error(error.message);
      sites.push(...((data ?? []) as SiteRow[]).map((s) => ({ id: s.id, label: s.display_name })));
    }

    const subSiteIds = Array.from(allowedSubSiteIds);
    for (const part of chunkArray(subSiteIds, IN_QUERY_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from("sub_sites")
        .select("id,site_id,display_name")
        .in("id", part)
        .order("display_name");
      if (error) throw new Error(error.message);
      subSites.push(
        ...((data ?? []) as SubSiteRow[]).map((s) => ({ id: s.id, siteId: s.site_id, label: s.display_name })),
      );
    }

    return NextResponse.json({
      limit,
      truncated,
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
