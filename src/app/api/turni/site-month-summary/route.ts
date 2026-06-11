import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type ShiftState = "planned" | "actual" | "cancelled";
type ShiftRow = { id: number; start_at: string; end_at: string; state: ShiftState };
type BreakRow = { shift_id: number; break_start_at: string; break_end_at: string };

const MAX_SHIFTS = 50000;
const MAX_BREAKS = 100000;
const IN_QUERY_CHUNK_SIZE = 500;

class TooManyRowsError extends Error {
  status = 400;
}

function clampYearMonth(year: number, month: number) {
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) return [] as T[][];
  const size = Math.max(1, Math.trunc(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function minutesBetween(aIso: string, bIso: string) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") ?? "");
    const month = Number(url.searchParams.get("month") ?? "");
    const siteId = Number(url.searchParams.get("siteId") ?? "");
    const subSiteIdParam = url.searchParams.get("subSiteId");
    const subSiteId = subSiteIdParam ? Number(subSiteIdParam) : null;

    const ym = clampYearMonth(year, month);
    if (!ym) return NextResponse.json({ error: "year/month non validi." }, { status: 400 });
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    if (subSiteIdParam && !Number.isFinite(subSiteId))
      return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });

    const start = new Date(Date.UTC(ym.year, ym.month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(ym.year, ym.month, 1, 0, 0, 0));

    let shiftsQuery = auth.supabase
      .from("turni_employee_shifts")
      .select("id,start_at,end_at,state")
      .gte("start_at", start.toISOString())
      .lt("start_at", end.toISOString())
      .eq("site_id", siteId)
      .neq("state", "cancelled")
      .limit(MAX_SHIFTS + 1);
    if (typeof subSiteId === "number" && Number.isFinite(subSiteId)) shiftsQuery = shiftsQuery.eq("sub_site_id", subSiteId);
    else shiftsQuery = shiftsQuery.is("sub_site_id", null);

    const { data: shiftsData, error: shiftsError } = await shiftsQuery;
    if (shiftsError) throw new Error(shiftsError.message);
    const shifts = (shiftsData ?? []) as ShiftRow[];
    if (shifts.length > MAX_SHIFTS) {
      throw new TooManyRowsError("Troppi turni per riepilogo mensile. Restringi il dataset o applica filtri.");
    }
    const shiftIds = shifts.map((s) => s.id);

    const breaksByShiftId = new Map<number, BreakRow[]>();
    if (shiftIds.length > 0) {
      let totalBreaks = 0;
      for (const chunk of chunkArray(shiftIds, IN_QUERY_CHUNK_SIZE)) {
        const { data: breaksData, error: breaksError } = await auth.supabase
          .from("turni_shift_breaks")
          .select("shift_id,break_start_at,break_end_at")
          .in("shift_id", chunk)
          .limit(MAX_BREAKS + 1);
        if (breaksError) throw new Error(breaksError.message);
        for (const b of (breaksData ?? []) as BreakRow[]) {
          totalBreaks += 1;
          if (totalBreaks > MAX_BREAKS) {
            throw new TooManyRowsError("Troppe pause per riepilogo mensile. Restringi il dataset o applica filtri.");
          }
          const list = breaksByShiftId.get(b.shift_id) ?? [];
          list.push(b);
          breaksByShiftId.set(b.shift_id, list);
        }
      }
    }

    let plannedMinutes = 0;
    let actualMinutes = 0;
    for (const s of shifts) {
      const totalMinutes = minutesBetween(s.start_at, s.end_at);
      const breakMinutes = (breaksByShiftId.get(s.id) ?? []).reduce(
        (acc, b) => acc + minutesBetween(b.break_start_at, b.break_end_at),
        0,
      );
      const net = Math.max(0, totalMinutes - breakMinutes);
      if (s.state === "actual") actualMinutes += net;
      else plannedMinutes += net;
    }

    let targetQuery = auth.supabase
      .from("turni_site_month_targets")
      .select("theoretical_minutes")
      .eq("year", ym.year)
      .eq("month", ym.month)
      .eq("site_id", siteId);
    if (typeof subSiteId === "number" && Number.isFinite(subSiteId)) targetQuery = targetQuery.eq("sub_site_id", subSiteId);
    else targetQuery = targetQuery.is("sub_site_id", null);
    const { data: targetData, error: targetError } = await targetQuery.maybeSingle();
    if (targetError) throw new Error(targetError.message);

    const theoreticalMinutes = targetData?.theoretical_minutes ?? null;

    return NextResponse.json({
      plannedMinutes,
      actualMinutes,
      theoreticalMinutes,
      diffPlannedVsTheoretical: theoreticalMinutes === null ? null : plannedMinutes - theoreticalMinutes,
      diffActualVsTheoretical: theoreticalMinutes === null ? null : actualMinutes - theoreticalMinutes,
      diffActualVsPlanned: actualMinutes - plannedMinutes,
    });
  } catch (err) {
    if (err instanceof TooManyRowsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore riepilogo mese." },
      { status: 500 },
    );
  }
}
