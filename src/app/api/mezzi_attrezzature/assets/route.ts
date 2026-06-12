import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AssetType = "mezzo" | "attrezzatura";
type OwnershipType = "proprieta" | "noleggio";
type AssetStatus = "attivo" | "fuori_servizio" | "dismesso";

type AssetRow = {
  id: number;
  asset_type: AssetType;
  ownership_type: OwnershipType;
  status: AssetStatus;
  category: string | null;
  brand: string | null;
  model: string | null;
  plate: string | null;
  vin: string | null;
  internal_code: string | null;
  serial_number: string | null;
  registration_date: string | null;
  rental_supplier: string | null;
  rental_start_date: string | null;
  rental_end_date: string | null;
  notes: string | null;
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

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveValidatedSubSiteId(args: {
  supabase: SupabaseClient;
  siteId: number | null;
  subSiteId: number | null;
}) {
  const { supabase, siteId, subSiteId } = args;
  if (subSiteId === null) return null;
  if (siteId === null) throw new Error("siteId obbligatorio quando è valorizzato subSiteId.");
  const { data, error } = await supabase
    .from("sub_sites")
    .select("id,site_id")
    .eq("id", subSiteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { id: number; site_id: number } | null;
  if (!row) throw new Error("subSiteId non valido.");
  if (row.site_id !== siteId) throw new Error("Il sottocantiere non appartiene al cantiere selezionato.");
  return subSiteId;
}

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 20000;

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

function parseOffsetParam(value: string | null) {
  if (!value) return 0;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("mezzi_attrezzature", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const url = new URL(request.url);
    const limit = parseLimitParam(url.searchParams.get("limit"));
    const offset = parseOffsetParam(url.searchParams.get("offset"));

    const { data, error } = await supabase
      .from("fleet_assets")
      .select(
        "id,asset_type,ownership_type,status,category,brand,model,plate,vin,internal_code,serial_number,registration_date,rental_supplier,rental_start_date,rental_end_date,notes,sites(display_name),sub_sites(display_name)",
      )
      .order("id", { ascending: false })
      .range(offset, offset + limit);

    if (error) throw new Error(error.message);
    const raw = (data ?? []) as AssetRow[];
    const truncated = raw.length > limit;
    const rows = raw.slice(0, limit);

    return NextResponse.json({
      limit,
      offset,
      truncated,
      rows: rows.map((row) => ({
        id: row.id,
        assetType: row.asset_type,
        ownershipType: row.ownership_type,
        status: row.status,
        category: row.category ?? "",
        brand: row.brand ?? "",
        model: row.model ?? "",
        plate: row.plate ?? "",
        vin: row.vin ?? "",
        internalCode: row.internal_code ?? "",
        serialNumber: row.serial_number ?? "",
        registrationDate: row.registration_date,
        cantiere: extractDisplayName(row.sites),
        sottocantiere: extractDisplayName(row.sub_sites),
        rentalSupplier: row.rental_supplier ?? "",
        rentalStartDate: row.rental_start_date,
        rentalEndDate: row.rental_end_date,
        notes: row.notes ?? "",
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento asset." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("mezzi_attrezzature", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      assetType: AssetType;
      ownershipType: OwnershipType;
      status?: AssetStatus;
      category?: string;
      brand?: string;
      model?: string;
      plate?: string;
      vin?: string;
      internalCode?: string;
      serialNumber?: string;
      registrationDate?: string | null;
      siteId?: number | null;
      subSiteId?: number | null;
      rentalSupplier?: string;
      rentalStartDate?: string | null;
      rentalEndDate?: string | null;
      notes?: string;
    };

    const assetType = body.assetType;
    const ownershipType = body.ownershipType;
    if (assetType !== "mezzo" && assetType !== "attrezzatura") {
      return NextResponse.json({ error: "assetType non valido." }, { status: 400 });
    }
    if (ownershipType !== "proprieta" && ownershipType !== "noleggio") {
      return NextResponse.json({ error: "ownershipType non valido." }, { status: 400 });
    }

    const siteId = typeof body.siteId === "number" ? body.siteId : null;
    const subSiteId = typeof body.subSiteId === "number" ? body.subSiteId : null;
    const validatedSubSiteId = await resolveValidatedSubSiteId({ supabase, siteId, subSiteId });

    const payload = {
      asset_type: assetType,
      ownership_type: ownershipType,
      status: body.status ?? "attivo",
      category: normalizeText(body.category) || null,
      brand: normalizeText(body.brand) || null,
      model: normalizeText(body.model) || null,
      plate: normalizeText(body.plate) || null,
      vin: normalizeText(body.vin) || null,
      internal_code: normalizeText(body.internalCode) || null,
      serial_number: normalizeText(body.serialNumber) || null,
      registration_date: body.registrationDate ?? null,
      site_id: siteId,
      sub_site_id: validatedSubSiteId,
      rental_supplier: normalizeText(body.rentalSupplier) || null,
      rental_start_date: body.rentalStartDate ?? null,
      rental_end_date: body.rentalEndDate ?? null,
      notes: normalizeText(body.notes) || null,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("fleet_assets")
      .insert(payload)
      .select("id,asset_type")
      .single();

    if (insertError) throw new Error(insertError.message);
    const assetId = (inserted as { id: number }).id;

    const { data: types, error: typesError } = await supabase
      .from("fleet_obligation_types")
      .select("id,code,asset_type,is_active")
      .eq("is_active", true);

    if (typesError) throw new Error(typesError.message);

    const obligationTypeIds = (types ?? [])
      .filter((t) => {
        const tAssetType = (t as { asset_type: AssetType | null }).asset_type;
        const code = (t as { code: string }).code;
        if (tAssetType && tAssetType !== assetType) return false;
        if (assetType === "mezzo") {
          return ["REVISIONE", "ASSICURAZIONE", "BOLLO", "TAGLIANDO", "MANUTENZIONE"].includes(code);
        }
        return ["MANUTENZIONE", "VERIFICA_INAIL", "CONTROLLO_FUNI_CATENE"].includes(code);
      })
      .map((t) => (t as { id: number }).id);

    if (obligationTypeIds.length > 0) {
      const obligationsPayload = obligationTypeIds.map((typeId) => ({
        asset_id: assetId,
        obligation_type_id: typeId,
        last_done_date: null,
        next_due_date: null,
        vendor: null,
        notes: null,
      }));
      const { error: obligationsError } = await supabase
        .from("fleet_asset_obligations")
        .upsert(obligationsPayload, { onConflict: "asset_id,obligation_type_id" });
      if (obligationsError) throw new Error(obligationsError.message);
    }

    return NextResponse.json({ id: assetId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore creazione asset." },
      { status: 500 },
    );
  }
}
