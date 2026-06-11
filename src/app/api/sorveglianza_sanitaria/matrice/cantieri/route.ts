import { NextResponse } from "next/server";
import { requireAnyModuleAccess, requireModuleAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type SiteRow = { id: number; display_name: string };
type SubSiteRow = { id: number; site_id: number; display_name: string };
type RuleRow = {
  scope_type: "site" | "sub_site";
  site_id: number | null;
  sub_site_id: number | null;
  requires_visit: boolean;
  note: string | null;
  is_active?: boolean | null;
};

const MAX_SITES = 5000;
const MAX_SUBSITES = 10000;
const MAX_RULES = 20000;

function isMissingIsActiveColumnError(message: string) {
  return /is_active/i.test(message);
}

class TooManyRowsError extends Error {
  status = 400;
}

class MissingScopeRulesSoftDeleteSupportError extends Error {
  status = 503;
}

export async function GET() {
  const auth = await requireAnyModuleAccess(["gestione", "sorveglianza"], false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const [sites, subSites, rules] = await Promise.all([
      fetchAllSites(auth.supabase),
      fetchAllSubSites(auth.supabase),
      fetchAllRules(auth.supabase),
    ]);

    return NextResponse.json({
      sites,
      subSites,
      rules,
      supportsRules: true,
    });
  } catch (error) {
    if (error instanceof TooManyRowsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento matrice cantieri." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as Partial<{
      scopeType: "site" | "sub_site";
      siteId: number;
      subSiteId: number;
      requiresVisit: boolean;
      note: string | null;
    }>;

    const scopeType = body.scopeType === "sub_site" ? "sub_site" : "site";
    const requiresVisit = Boolean(body.requiresVisit);
    const note = typeof body.note === "string" ? body.note.trim() || null : null;

    const siteId = body.siteId ? Number(body.siteId) : null;
    const subSiteId = body.subSiteId ? Number(body.subSiteId) : null;

    if (scopeType === "site") {
      if (!siteId) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    } else {
      if (!subSiteId) return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });
    }

    const payload =
      scopeType === "site"
        ? {
            scope_type: "site" as const,
            site_id: siteId,
            sub_site_id: null,
            requires_visit: requiresVisit,
            note,
            is_active: true,
            created_by: auth.userId,
          }
        : {
            scope_type: "sub_site" as const,
            site_id: null,
            sub_site_id: subSiteId,
            requires_visit: requiresVisit,
            note,
            is_active: true,
            created_by: auth.userId,
          };

    const { error } = await auth.supabase
      .from("medical_surveillance_scope_rules")
      .upsert(payload, { onConflict: "scope_type,site_id,sub_site_id" });
    if (error && isMissingIsActiveColumnError(error.message)) {
      throw new MissingScopeRulesSoftDeleteSupportError(
        "Schema matrice cantieri non aggiornato. Applicare la patch DB cumulativa `supabase/999_next.sql`.",
      );
    }
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MissingScopeRulesSoftDeleteSupportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore salvataggio matrice cantieri." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as Partial<{ scopeType: "site" | "sub_site"; siteId: number; subSiteId: number }>;
    const scopeType = body.scopeType === "sub_site" ? "sub_site" : "site";
    const siteId = body.siteId ? Number(body.siteId) : null;
    const subSiteId = body.subSiteId ? Number(body.subSiteId) : null;

    if (scopeType === "site") {
      if (!siteId) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
      const { error } = await auth.supabase
        .from("medical_surveillance_scope_rules")
        .update({ is_active: false })
        .eq("scope_type", "site")
        .eq("site_id", siteId)
        .is("sub_site_id", null);
      if (error && isMissingIsActiveColumnError(error.message)) {
        throw new MissingScopeRulesSoftDeleteSupportError(
          "Schema matrice cantieri non aggiornato. Applicare la patch DB cumulativa `supabase/999_next.sql`.",
        );
      }
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (!subSiteId) return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });
    const { error } = await auth.supabase
      .from("medical_surveillance_scope_rules")
      .update({ is_active: false })
      .eq("scope_type", "sub_site")
      .eq("sub_site_id", subSiteId)
      .is("site_id", null);
    if (error && isMissingIsActiveColumnError(error.message)) {
      throw new MissingScopeRulesSoftDeleteSupportError(
        "Schema matrice cantieri non aggiornato. Applicare la patch DB cumulativa `supabase/999_next.sql`.",
      );
    }
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MissingScopeRulesSoftDeleteSupportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore reset matrice cantieri." },
      { status: 500 },
    );
  }
}

async function fetchAllSites(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("sites").select("id,display_name").order("display_name").limit(MAX_SITES + 1);
  if (error) throw new Error(error.message);
  if ((data ?? []).length > MAX_SITES) {
    throw new TooManyRowsError("Troppi cantieri. Riduci il dataset o applica paginazione.");
  }
  return (data ?? []) as SiteRow[];
}

async function fetchAllSubSites(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("sub_sites")
    .select("id,site_id,display_name")
    .order("display_name")
    .limit(MAX_SUBSITES + 1);
  if (error) throw new Error(error.message);
  if ((data ?? []).length > MAX_SUBSITES) {
    throw new TooManyRowsError("Troppi sottocantieri. Riduci il dataset o applica paginazione.");
  }
  return (data ?? []) as SubSiteRow[];
}

async function fetchAllRules(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("medical_surveillance_scope_rules")
    .select("*")
    .limit(MAX_RULES + 1);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as RuleRow[]).filter((row) => row.is_active !== false);
  if (rows.length > MAX_RULES) {
    throw new TooManyRowsError("Troppe regole cantieri. Riduci il dataset o applica paginazione.");
  }
  return rows;
}
