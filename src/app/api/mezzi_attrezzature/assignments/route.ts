import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

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

type AssignmentDbRow = {
  id: number;
  asset_id: number;
  employee_id: number;
  start_date: string;
  end_date: string | null;
  note: string | null;
  employees: unknown;
  fleet_assets: unknown;
};

type EmployeeJoinRow = { id: number; matricola: string; first_name: string; last_name: string };

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
  sites: unknown;
  sub_sites: unknown;
};

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

export function assetAssignmentOverlaps(args: { startA: string; endA: string | null; startB: string; endB: string | null }) {
  const endAIso = args.endA ?? "9999-12-31";
  const endBIso = args.endB ?? "9999-12-31";
  return args.startA <= endBIso && args.startB <= endAIso;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("mezzi_attrezzature", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const employeeIdParam = url.searchParams.get("employeeId");
    const employeeId = employeeIdParam ? Number(employeeIdParam) : null;
    const activeOnly = (url.searchParams.get("activeOnly") ?? "1") === "1";
    const limit = parseLimitParam(url.searchParams.get("limit"));
    const offset = parseOffsetParam(url.searchParams.get("offset"));

    const supabase = auth.supabase;
    const todayIso = new Date().toISOString().slice(0, 10);
    let query = supabase
      .from("fleet_asset_assignments")
      .select(
        "id,asset_id,employee_id,start_date,end_date,note,employees(id,matricola,first_name,last_name),fleet_assets(id,asset_type,ownership_type,status,category,brand,model,plate,internal_code,serial_number,sites(display_name),sub_sites(display_name))",
      )
      .order("start_date", { ascending: false });

    if (typeof employeeId === "number" && Number.isFinite(employeeId)) {
      query = query.eq("employee_id", employeeId);
    }
    if (activeOnly) {
      query = query.or(`end_date.is.null,end_date.gte.${todayIso}`);
    }

    const { data, error } = await query.range(offset, offset + limit);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as AssignmentDbRow[];
    const truncated = rows.length > limit;
    const filtered = rows.slice(0, limit);

    return NextResponse.json({
      limit,
      offset,
      truncated,
      rows: filtered.map((row) => {
        const employee = firstOrNull(row.employees as EmployeeJoinRow | EmployeeJoinRow[] | null);
        const asset = firstOrNull(row.fleet_assets as AssetJoinRow | AssetJoinRow[] | null);

        return {
        id: row.id,
        assetId: row.asset_id,
        employeeId: row.employee_id,
        startDate: row.start_date,
        endDate: row.end_date,
        note: row.note ?? "",
        employee: employee
          ? {
              id: employee.id,
              matricola: employee.matricola,
              cognome: employee.last_name,
              nome: employee.first_name,
            }
          : null,
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
              cantiere: extractDisplayName(asset.sites),
              sottocantiere: extractDisplayName(asset.sub_sites),
            }
          : null,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento assegnazioni." },
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
      assetId: number;
      employeeId: number;
      startDate: string;
      note?: string;
    };

    const startDate = normalizeIsoDate(body.startDate);
    if (!body.assetId || !body.employeeId || !startDate) {
      return NextResponse.json({ error: "Dati mancanti." }, { status: 400 });
    }

    const { data: overlapsData, error: overlapsError } = await supabase
      .from("fleet_asset_assignments")
      .select("id,start_date,end_date,employee_id")
      .eq("asset_id", body.assetId)
      .or(`end_date.is.null,end_date.gte.${startDate}`)
      .limit(10);
    if (overlapsError) throw new Error(overlapsError.message);
    const overlaps = (overlapsData ?? []) as Array<{ id: number; start_date: string; end_date: string | null; employee_id: number }>;
    const hasOverlap = overlaps.some((a) => assetAssignmentOverlaps({ startA: a.start_date, endA: a.end_date, startB: startDate, endB: null }));
    if (hasOverlap) {
      return NextResponse.json({ error: "Asset già assegnato nel periodo selezionato. Chiudi prima l'assegnazione attiva." }, { status: 409 });
    }

    const { error } = await supabase.from("fleet_asset_assignments").insert({
      asset_id: body.assetId,
      employee_id: body.employeeId,
      start_date: startDate,
      end_date: null,
      note: body.note ?? null,
    });

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore assegnazione asset." },
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
      assignmentId: number;
      endDate: string;
    };

    const endDate = normalizeIsoDate(body.endDate);
    if (!body.assignmentId || !endDate) {
      return NextResponse.json({ error: "Dati mancanti." }, { status: 400 });
    }

    const { error } = await supabase
      .from("fleet_asset_assignments")
      .update({ end_date: endDate })
      .eq("id", body.assignmentId);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore chiusura assegnazione." },
      { status: 500 },
    );
  }
}
