import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type AbsenceType = "ferie" | "malattia" | "permesso" | "infortunio" | "altro";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseIsoDate(value: unknown) {
  const v = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function toDayStartIso(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (!Number.isFinite(d.getTime())) throw new Error("Data non valida.");
  return d.toISOString();
}

function toDayEndIso(isoDate: string) {
  const d = new Date(`${isoDate}T23:59:59`);
  if (!Number.isFinite(d.getTime())) throw new Error("Data non valida.");
  return d.toISOString();
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const employeeId = Number(url.searchParams.get("employeeId") ?? "");
    const startDate = parseIsoDate(url.searchParams.get("startDate"));
    const endDate = parseIsoDate(url.searchParams.get("endDate"));
    if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    if (!startDate || !endDate) return NextResponse.json({ error: "startDate/endDate non validi." }, { status: 400 });

    const startAt = new Date(`${startDate}T00:00:00`);
    const endAt = new Date(`${endDate}T23:59:59`);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      return NextResponse.json({ error: "Range date non valido." }, { status: 400 });
    }

    const supabase = auth.supabase;
    const { data, error } = await supabase
      .from("turni_employee_absences")
      .select("id,absence_type,start_at,end_at,note,created_by,created_at")
      .eq("employee_id", employeeId)
      .lt("start_at", endAt.toISOString())
      .gt("end_at", startAt.toISOString())
      .order("start_at");
    if (error) throw new Error(error.message);

    return NextResponse.json({
      rows: (data ?? []).map((r) => ({
        id: (r as { id: number }).id,
        absenceType: (r as { absence_type: AbsenceType }).absence_type,
        startAt: (r as { start_at: string }).start_at,
        endAt: (r as { end_at: string }).end_at,
        note: (r as { note: string | null }).note ?? "",
        createdAt: (r as { created_at: string }).created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento assenze." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as {
      employeeId: number;
      startDate: string;
      endDate?: string;
      absenceType: AbsenceType;
      note?: string;
    };

    const employeeId = Number(body.employeeId);
    if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });

    const startDate = parseIsoDate(body.startDate);
    const endDate = parseIsoDate(body.endDate ?? body.startDate);
    if (!startDate || !endDate) return NextResponse.json({ error: "startDate/endDate non validi." }, { status: 400 });

    const absenceType = normalizeText(body.absenceType) as AbsenceType;
    if (!["ferie", "malattia", "permesso", "infortunio", "altro"].includes(absenceType)) {
      return NextResponse.json({ error: "absenceType non valido." }, { status: 400 });
    }

    const supabase = auth.supabase;
    const startAt = toDayStartIso(startDate);
    const endAt = toDayEndIso(endDate);

    const { data, error } = await supabase
      .from("turni_employee_absences")
      .insert({
        employee_id: employeeId,
        absence_type: absenceType,
        start_at: startAt,
        end_at: endAt,
        note: normalizeText(body.note) || null,
        created_by: auth.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ id: (data as { id: number }).id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore creazione assenza." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const absenceId = Number(url.searchParams.get("absenceId") ?? "");
    if (!Number.isFinite(absenceId)) return NextResponse.json({ error: "absenceId non valido." }, { status: 400 });

    const supabase = auth.supabase;
    const { error } = await supabase.from("turni_employee_absences").delete().eq("id", absenceId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore cancellazione assenza." },
      { status: 500 },
    );
  }
}

