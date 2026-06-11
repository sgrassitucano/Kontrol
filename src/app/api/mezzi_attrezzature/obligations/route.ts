import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function normalizeIsoDate(value: unknown) {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return s;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 20000;
const MAX_DUE_IN_DAYS = 365;

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

function parseDueInDaysParam(value: string | null, fallback = 30) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, MAX_DUE_IN_DAYS);
}

export function computeObligationStatus(args: { nextDueDate: string | null; thresholdIsoDate: string }) {
  const nextDueDate = normalizeIsoDate(args.nextDueDate);
  if (!nextDueDate) return "da impostare" as const;
  const todayIso = todayIsoDate();
  if (nextDueDate < todayIso) return "scaduto" as const;
  if (nextDueDate <= args.thresholdIsoDate) return "in scadenza" as const;
  return "ok" as const;
}

class MissingRpcError extends Error {
  status = 503;
}

async function completeObligationAtomic(args: {
  supabase: SupabaseClient;
  obligationId: number;
  doneDate: string;
  nextDueDate: string | null;
  note: string | null;
  documentRef: string | null;
  vendor: string | null;
}) {
  const { supabase, ...payload } = args;
  const { error } = await supabase.rpc("fleet_complete_obligation", {
    obligation_id: payload.obligationId,
    done_date: payload.doneDate,
    next_due_date: payload.nextDueDate,
    note: payload.note,
    document_ref: payload.documentRef,
    vendor: payload.vendor,
  });
  if (!error) return { usedRpc: true as const };
  const msg = String((error as { message?: unknown } | null)?.message ?? "");
  if (/fleet_complete_obligation/i.test(msg)) {
    throw new MissingRpcError("RPC fleet_complete_obligation non disponibile. Applicare patch DB.");
  }
  throw new Error(msg || "Errore registrazione verifica.");
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("mezzi_attrezzature", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const dueInDays = parseDueInDaysParam(url.searchParams.get("dueInDays"), 30);
    const includeMissing = (url.searchParams.get("includeMissing") ?? "1") === "1";
    const limit = parseLimitParam(url.searchParams.get("limit"));

    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + dueInDays);
    const thresholdIsoDate = thresholdDate.toISOString().slice(0, 10);

    const supabase = auth.supabase;
    let query = supabase
      .from("fleet_asset_obligations")
      .select(
        "id,asset_id,last_done_date,next_due_date,vendor,notes,fleet_assets(id,asset_type,ownership_type,status,category,brand,model,plate,internal_code,serial_number,rental_end_date,sites(display_name),sub_sites(display_name)),fleet_obligation_types(id,code,label)",
      )
      .order("next_due_date", { ascending: true })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (includeMissing) {
      query = query.or(`next_due_date.is.null,next_due_date.lte.${thresholdIsoDate}`);
    } else {
      query = query.lte("next_due_date", thresholdIsoDate).not("next_due_date", "is", null);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const raw = (data ?? []) as ObligationDbRow[];
    const truncated = raw.length > limit;
    const rows = raw.slice(0, limit);

    const mapped = rows.map((row) => {
      const asset = firstOrNull(row.fleet_assets as AssetJoinRow | AssetJoinRow[] | null);
      const type = firstOrNull(row.fleet_obligation_types as ObligationTypeJoinRow | ObligationTypeJoinRow[] | null);
      const status = computeObligationStatus({ nextDueDate: row.next_due_date, thresholdIsoDate });

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
    });

    return NextResponse.json({ dueInDays, limit, truncated, rows: mapped });
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
      next_due_date: body.nextDueDate ? normalizeIsoDate(body.nextDueDate) : null,
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

    const doneDate = normalizeIsoDate(body.doneDate);
    const nextDueDate = body.nextDueDate ? normalizeIsoDate(body.nextDueDate) : null;
    if (!body.obligationId || !doneDate) {
      return NextResponse.json({ error: "Dati mancanti." }, { status: 400 });
    }

    const rpcRes = await completeObligationAtomic({
      supabase,
      obligationId: body.obligationId,
      doneDate,
      nextDueDate,
      note: body.note ?? null,
      documentRef: body.documentRef ?? null,
      vendor: body.vendor ?? null,
    });
    void rpcRes;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MissingRpcError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore registrazione verifica." },
      { status: 500 },
    );
  }
}
