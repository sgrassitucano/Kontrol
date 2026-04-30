import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type EmployeeOptionRow = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
  responsible_code: string;
  referral: string | null;
  site_id: number | null;
  sub_site_id: number | null;
};

type SiteRow = { id: number; display_name: string };
type SubSiteRow = { id: number; site_id: number; display_name: string };

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET() {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;

    const [employeesRes, sitesRes, subSitesRes] = await Promise.all([
      supabase
        .from("employees")
        .select("id,matricola,first_name,last_name,responsible_code,referral,site_id,sub_site_id")
        .eq("status", "attivo")
        .order("last_name")
        .order("first_name"),
      supabase.from("sites").select("id,display_name").order("display_name"),
      supabase.from("sub_sites").select("id,site_id,display_name").order("display_name"),
    ]);

    if (employeesRes.error) throw new Error(employeesRes.error.message);
    if (sitesRes.error) throw new Error(sitesRes.error.message);
    if (subSitesRes.error) throw new Error(subSitesRes.error.message);

    const employees = (employeesRes.data ?? []) as EmployeeOptionRow[];
    const sites = (sitesRes.data ?? []) as SiteRow[];
    const subSites = (subSitesRes.data ?? []) as SubSiteRow[];

    const responsibleCodes = Array.from(
      new Set(employees.map((e) => normalizeText(e.responsible_code)).filter((v) => v.length > 0)),
    ).sort((a, b) => a.localeCompare(b));

    const referrals = Array.from(
      new Set(employees.map((e) => normalizeText(e.referral)).filter((v) => v.length > 0)),
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ employees, sites, subSites, responsibleCodes, referrals });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento opzioni export turni." },
      { status: 500 },
    );
  }
}
