import { NextResponse } from "next/server";
import { getCurrentUserContext, requireAnyModuleAccess } from "@/lib/api/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type EmployeeRow = { id: number; site_id: number; sub_site_id: number | null };
type RecordRow = { employee_id: number; provider: string | null };

export async function POST() {
  const auth = await requireAnyModuleAccess(["gestione", "sorveglianza"], true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const ctx = await getCurrentUserContext(auth.supabase);
    const dataSupabase =
      ctx.isActive && (ctx.role === "viewer" || ctx.role === "admin") ? createSupabaseAdminClient() : auth.supabase;

    const [employees, records] = await Promise.all([fetchEmployees(dataSupabase), fetchRecords(dataSupabase)]);

    const providerByEmployeeId = new Map<number, string>();
    records.forEach((row) => {
      const value = String(row.provider ?? "").trim();
      if (!value) return;
      providerByEmployeeId.set(row.employee_id, value);
    });

    const providersBySubSiteId = new Map<number, Map<string, number>>();
    const providersBySiteIdNoSub = new Map<number, Map<string, number>>();
    const subSitesBySiteId = new Map<number, Set<number>>();

    employees.forEach((employee) => {
      const provider = providerByEmployeeId.get(employee.id);
      if (!provider) return;

      if (employee.sub_site_id) {
        subSitesBySiteId.set(employee.site_id, (subSitesBySiteId.get(employee.site_id) ?? new Set()).add(employee.sub_site_id));
        const map = providersBySubSiteId.get(employee.sub_site_id) ?? new Map<string, number>();
        map.set(provider, (map.get(provider) ?? 0) + 1);
        providersBySubSiteId.set(employee.sub_site_id, map);
        return;
      }

      const siteMap = providersBySiteIdNoSub.get(employee.site_id) ?? new Map<string, number>();
      siteMap.set(provider, (siteMap.get(provider) ?? 0) + 1);
      providersBySiteIdNoSub.set(employee.site_id, siteMap);
    });

    const bestProvider = (countMap: Map<string, number>) => {
      let best = "";
      let bestCount = -1;
      for (const [provider, count] of countMap.entries()) {
        if (count > bestCount) {
          best = provider;
          bestCount = count;
        }
      }
      return best;
    };

    const subSiteAssignmentRows: Array<{
      scope_type: "sub_site";
      site_id: null;
      sub_site_id: number;
      provider: string;
      is_active: boolean;
      note: string | null;
      created_by: string;
    }> = [];

    for (const [subSiteId, countMap] of providersBySubSiteId.entries()) {
      const provider = bestProvider(countMap);
      if (!provider) continue;
      subSiteAssignmentRows.push({
        scope_type: "sub_site",
        site_id: null,
        sub_site_id: subSiteId,
        provider,
        is_active: true,
        note: "Seed da import sorveglianza",
        created_by: auth.userId,
      });
    }

    const siteAssignmentRows: Array<{
      scope_type: "site";
      site_id: number;
      sub_site_id: null;
      provider: string;
      is_active: boolean;
      note: string | null;
      created_by: string;
    }> = [];

    const allSiteIds = new Set<number>([
      ...providersBySiteIdNoSub.keys(),
      ...subSitesBySiteId.keys(),
      ...employees.map((e) => e.site_id),
    ]);

    for (const siteId of allSiteIds) {
      const siteNoSub = providersBySiteIdNoSub.get(siteId) ?? null;
      const siteSubIds = Array.from(subSitesBySiteId.get(siteId) ?? []);

      if (siteSubIds.length === 0) {
        if (!siteNoSub) continue;
        const provider = bestProvider(siteNoSub);
        if (!provider) continue;
        siteAssignmentRows.push({
          scope_type: "site",
          site_id: siteId,
          sub_site_id: null,
          provider,
          is_active: true,
          note: "Seed da import sorveglianza",
          created_by: auth.userId,
        });
        continue;
      }

      const uniqueProviders = new Set<string>();
      siteSubIds.forEach((subSiteId) => {
        const p = subSiteAssignmentRows.find((r) => r.sub_site_id === subSiteId)?.provider;
        if (p) uniqueProviders.add(p);
      });

      if (uniqueProviders.size === 1) {
        const provider = Array.from(uniqueProviders)[0] ?? "";
        if (!provider) continue;
        siteAssignmentRows.push({
          scope_type: "site",
          site_id: siteId,
          sub_site_id: null,
          provider,
          is_active: true,
          note: "Seed da import sorveglianza",
          created_by: auth.userId,
        });
      } else if (uniqueProviders.size > 1) {
        siteAssignmentRows.push({
          scope_type: "site",
          site_id: siteId,
          sub_site_id: null,
          provider: "MISTO",
          is_active: true,
          note: "Seed da import sorveglianza",
          created_by: auth.userId,
        });
      }
    }

    const rowsToUpsert = [...siteAssignmentRows, ...subSiteAssignmentRows];
    if (rowsToUpsert.length > 0) {
      const { error } = await dataSupabase
        .from("medical_surveillance_provider_assignments")
        .upsert(rowsToUpsert, { onConflict: "scope_type,site_id,sub_site_id" });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      seeded: rowsToUpsert.length,
      sites: siteAssignmentRows.length,
      subSites: subSiteAssignmentRows.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore seed provider." },
      { status: 500 },
    );
  }
}

async function fetchEmployees(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("employees").select("id,site_id,sub_site_id").eq("status", "attivo");
  if (error) throw new Error(error.message);
  return (data ?? []) as EmployeeRow[];
}

async function fetchRecords(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("medical_surveillance_records").select("employee_id,provider");
  if (error) throw new Error(error.message);
  return (data ?? []) as RecordRow[];
}
