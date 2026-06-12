import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

const MAX_EXISTING_SHIFTS = 5000;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseIsoDate(value: unknown) {
  const v = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function isOverlapError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /turni_employee_shifts_no_overlap/i.test(error.message) || /overlap/i.test(error.message);
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      employeeId: number;
      startDate: string;
      endDate: string;
      templateId?: number;
    };

    const employeeId = Number(body.employeeId);
    if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });

    const startDate = parseIsoDate(body.startDate);
    const endDate = parseIsoDate(body.endDate);
    if (!startDate || !endDate) return NextResponse.json({ error: "startDate/endDate non validi." }, { status: 400 });

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
      return NextResponse.json({ error: "Range date non valido." }, { status: 400 });
    }

    const templateId = typeof body.templateId === "number" ? Number(body.templateId) : null;
    let effectiveTemplateId: number | null = templateId;

    if (!effectiveTemplateId) {
      const { data: templates, error } = await supabase
        .from("turni_employee_templates")
        .select("id,valid_from,valid_to,is_active")
        .eq("employee_id", employeeId)
        .eq("is_active", true)
        .lte("valid_from", startDate)
        .or(`valid_to.is.null,valid_to.gte.${startDate}`)
        .order("valid_from", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      effectiveTemplateId = (templates ?? [])[0]?.id ?? null;
    }

    if (!effectiveTemplateId) {
      return NextResponse.json({ error: "Nessun template attivo per il lavoratore nel periodo." }, { status: 400 });
    }

    const { data: slotsData, error: slotsError } = await supabase
      .from("turni_employee_template_slots")
      .select("weekday,site_id,sub_site_id,start_time,end_time,break_minutes")
      .eq("template_id", effectiveTemplateId)
      .order("weekday")
      .order("start_time");
    if (slotsError) throw new Error(slotsError.message);

    const slots = (slotsData ?? []) as Array<{
      weekday: number;
      site_id: number;
      sub_site_id: number | null;
      start_time: string;
      end_time: string;
      break_minutes: number;
    }>;

    if (slots.length === 0) return NextResponse.json({ created: 0, skippedExisting: 0, conflicts: 0, message: "Template senza fasce." });

    const { data: existingData, error: existingError } = await supabase
      .from("turni_employee_shifts")
      .select("id,employee_id,site_id,start_at,end_at")
      .eq("employee_id", employeeId)
      .neq("state", "cancelled")
      .lt("start_at", end.toISOString())
      .gt("end_at", start.toISOString())
      .limit(MAX_EXISTING_SHIFTS + 1);
    if (existingError) throw new Error(existingError.message);
    if ((existingData ?? []).length > MAX_EXISTING_SHIFTS) {
      return NextResponse.json({ error: `Troppi turni esistenti nel periodo (> ${MAX_EXISTING_SHIFTS}). Restringi il range.` }, { status: 400 });
    }

    const existingKey = new Set<string>();
    for (const r of (existingData ?? []) as Array<{ employee_id: number; site_id: number; start_at: string; end_at: string }>) {
      existingKey.add(`${r.employee_id}:${r.site_id}:${r.start_at}:${r.end_at}`);
    }

    const payload: Array<{
      employee_id: number;
      site_id: number;
      sub_site_id: number | null;
      start_at: string;
      end_at: string;
      state: "planned";
      source: "template";
      note: null;
      created_by: string;
    }> = [];

    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);

    while (cursor <= endDay) {
      const weekday = (cursor.getDay() + 6) % 7;
      const dayIso = cursor.toISOString().slice(0, 10);
      const daySlots = slots.filter((s) => s.weekday === weekday);
      for (const slot of daySlots) {
        const startAt = new Date(`${dayIso}T${slot.start_time.slice(0, 5)}:00`);
        const endAt = new Date(`${dayIso}T${slot.end_time.slice(0, 5)}:00`);
        if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1);
        const startIso = startAt.toISOString();
        const endIso = endAt.toISOString();
        const key = `${employeeId}:${slot.site_id}:${startIso}:${endIso}`;
        if (existingKey.has(key)) continue;
        payload.push({
          employee_id: employeeId,
          site_id: slot.site_id,
          sub_site_id: slot.sub_site_id,
          start_at: startIso,
          end_at: endIso,
          state: "planned",
          source: "template",
          note: null,
          created_by: auth.userId,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (payload.length === 0) {
      return NextResponse.json({ created: 0, skippedExisting: 0, conflicts: 0, message: "Nessun nuovo turno da generare." });
    }

    let created = 0;
    let conflicts = 0;
    const skippedExisting = 0;

    const chunkSize = 200;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabase.from("turni_employee_shifts").insert(chunk);
      if (!error) {
        created += chunk.length;
        continue;
      }
      for (const row of chunk) {
        const { error: singleError } = await supabase.from("turni_employee_shifts").insert(row);
        if (!singleError) created += 1;
        else if (isOverlapError(new Error(singleError.message))) conflicts += 1;
        else throw new Error(singleError.message);
      }
    }

    return NextResponse.json({ created, skippedExisting, conflicts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore generazione turni (lavoratore)." },
      { status: 500 },
    );
  }
}
