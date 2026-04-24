import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type ObligationStatus = "da impostare" | "ok" | "in scadenza" | "scaduto";

type ObligationDbRow = {
  id: number;
  asset_id: number;
  last_done_date: string | null;
  next_due_date: string | null;
  vendor: string | null;
  notes: string | null;
  fleet_assets: unknown;
  fleet_obligation_types: unknown;
};

type AssetJoinRow = {
  id: number;
  asset_type: string;
  ownership_type: string;
  status: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  plate: string | null;
  internal_code: string | null;
  serial_number: string | null;
  rental_end_date: string | null;
  sites: unknown;
  sub_sites: unknown;
};

type ObligationTypeJoinRow = { code?: string; label?: string };

function firstOrNull<T>(value: T | T[] | null | undefined) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

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

function computeStatus(nextDueDate: string | null, thresholdDate: Date) {
  if (!nextDueDate) return "da impostare" as const;
  const due = new Date(nextDueDate);
  const today = new Date();
  if (due < today) return "scaduto" as const;
  if (due <= thresholdDate) return "in scadenza" as const;
  return "ok" as const;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("mezzi_attrezzature", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const dueInDays = Number(url.searchParams.get("dueInDays") ?? "30");
    const includeMissing = (url.searchParams.get("includeMissing") ?? "1") === "1";

    const supabase = auth.supabase;
    const { data, error } = await supabase
      .from("fleet_asset_obligations")
      .select(
        "id,asset_id,last_done_date,next_due_date,vendor,notes,fleet_assets(id,asset_type,ownership_type,status,category,brand,model,plate,internal_code,serial_number,rental_end_date,sites(display_name),sub_sites(display_name)),fleet_obligation_types(id,code,label)",
      )
      .order("id", { ascending: false });

    if (error) throw new Error(error.message);

    const thresholdDate = new Date();
    thresholdDate.setDate(
      thresholdDate.getDate() + (Number.isFinite(dueInDays) ? dueInDays : 30),
    );

    const rows = (data ?? []) as ObligationDbRow[];

    const mapped = rows
      .map((row) => {
        const asset = firstOrNull(row.fleet_assets as AssetJoinRow | AssetJoinRow[] | null);
        const type = firstOrNull(
          row.fleet_obligation_types as ObligationTypeJoinRow | ObligationTypeJoinRow[] | null,
        );
        const status = computeStatus(row.next_due_date, thresholdDate);

        return {
          obligationId: row.id,
          assetId: row.asset_id,
          obligationCode: type?.code ?? "",
          obligationLabel: type?.label ?? "",
          lastDoneDate: row.last_done_date,
          nextDueDate: row.next_due_date,
          vendor: row.vendor ?? "",
          notes: row.notes ?? "",
          status: status as ObligationStatus,
          asset: asset
            ? {
                id: asset.id,
                assetType: asset.asset_type,
                ownershipType: asset.ownership_type,
                status: asset.status,
                category: asset.category ?? "",
                brand: asset.brand ?? "",
                model: asset.model ?? "",
                plate: asset.plate ?? "",
                internalCode: asset.internal_code ?? "",
                serialNumber: asset.serial_number ?? "",
                rentalEndDate: asset.rental_end_date ?? null,
                cantiere: extractDisplayName(asset.sites),
                sottocantiere: extractDisplayName(asset.sub_sites),
              }
            : null,
        };
      })
      .filter((row) => includeMissing || row.nextDueDate !== null)
      .filter((row) => {
        if (!row.nextDueDate) return true;
        const due = new Date(row.nextDueDate);
        return due <= thresholdDate;
      })
      .sort((a, b) => {
        const aKey = a.nextDueDate ?? "9999-12-31";
        const bKey = b.nextDueDate ?? "9999-12-31";
        return aKey.localeCompare(bKey);
      });

    return NextResponse.json({ rows: mapped, dueInDays: Number.isFinite(dueInDays) ? dueInDays : 30 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento scadenze." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireModuleAccess("mezzi_attrezzature", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      obligationId: number;
      nextDueDate?: string | null;
      vendor?: string;
      notes?: string;
    };

    if (!body.obligationId) {
      return NextResponse.json({ error: "obligationId mancante." }, { status: 400 });
    }

    const payload = {
      next_due_date: body.nextDueDate ?? null,
      vendor: typeof body.vendor === "string" ? body.vendor : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    };

    const { error } = await supabase
      .from("fleet_asset_obligations")
      .update(payload)
      .eq("id", body.obligationId);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore aggiornamento scadenza." },
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
      obligationId: number;
      doneDate: string;
      nextDueDate?: string | null;
      note?: string;
      documentRef?: string;
      vendor?: string;
    };

    if (!body.obligationId || !body.doneDate) {
      return NextResponse.json({ error: "Dati mancanti." }, { status: 400 });
    }

    const { error: eventError } = await supabase
      .from("fleet_obligation_events")
      .insert({
        asset_obligation_id: body.obligationId,
        event_date: body.doneDate,
        note: body.note ?? null,
        document_ref: body.documentRef ?? null,
      });
    if (eventError) throw new Error(eventError.message);

    const { error: updateError } = await supabase
      .from("fleet_asset_obligations")
      .update({
        last_done_date: body.doneDate,
        next_due_date: body.nextDueDate ?? null,
        vendor: body.vendor ?? null,
      })
      .eq("id", body.obligationId);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore registrazione verifica." },
      { status: 500 },
    );
  }
}
