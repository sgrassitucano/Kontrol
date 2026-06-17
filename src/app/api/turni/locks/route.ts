import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

function parseIntParam(value: string | null) {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const year = parseIntParam(url.searchParams.get("year"));
    const month = parseIntParam(url.searchParams.get("month"));
    if (!year || !month) return NextResponse.json({ error: "year/month non validi." }, { status: 400 });

    const supabase = auth.supabase;
    const { data, error } = await supabase
      .from("turni_month_locks")
      .select("id,locked_at,note")
      .eq("year", year)
      .eq("month", month)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as { id: number; locked_at: string; note: string | null } | undefined;
    return NextResponse.json({
      locked: Boolean(row),
      lock: row ? { id: row.id, lockedAt: row.locked_at, note: row.note ?? "" } : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore lettura lock mese." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as { year: number; month: number; note?: string };
    const year = Math.trunc(Number(body.year));
    const month = Math.trunc(Number(body.month));
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "year non valido." }, { status: 400 });
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "month non valido." }, { status: 400 });
    }

    const { error } = await supabase
      .from("turni_month_locks")
      .upsert(
        { year, month, note: (body.note ?? "").trim() || null, locked_by: auth.userId },
        { onConflict: "year,month" },
      );
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore lock mese." },
      { status: 500 },
    );
  }
}
