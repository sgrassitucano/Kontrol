import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

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

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function ensureMonthsNotLocked(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  start: Date,
  end: Date,
) {
  const months = new Set<string>();
  const cursor = new Date(start);
  cursor.setDate(1);
  while (cursor <= end) {
    months.add(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const m of months) {
    const [yearStr, monthStr] = m.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const { data, error } = await supabase
      .from("turni_month_locks")
      .select("id")
      .eq("year", year)
      .eq("month", month)
      .limit(1);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) throw new Error(`Mese bloccato: ${monthStr}/${yearStr}.`);
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      siteId: number;
      subSiteId?: number | null;
      startDate: string;
      endDate: string;
      templateId?: number;
    };

    const siteId = Number(body.siteId);
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    const subSiteId = body.subSiteId === null || body.subSiteId === undefined ? null : Number(body.subSiteId);
    if (body.subSiteId !== undefined && body.subSiteId !== null && !Number.isFinite(subSiteId)) {
      return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });
    }

    const startDate = parseIsoDate(body.startDate);
    const endDate = parseIsoDate(body.endDate);
    if (!startDate || !endDate) return NextResponse.json({ error: "startDate/endDate non validi." }, { status: 400 });

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
      return NextResponse.json({ error: "Range date non valido." }, { status: 400 });
    }

    await ensureMonthsNotLocked(supabase, start, end);

    const { data: anySubSites, error: anySubSitesError } = await supabase
      .from("sub_sites")
      .select("id")
      .eq("site_id", siteId)
      .limit(1);
    if (anySubSitesError) throw new Error(anySubSitesError.message);
    const siteHasSubSites = (anySubSites ?? []).length > 0;

    if (siteHasSubSites && subSiteId === null) {
      return NextResponse.json(
        { error: "Se il cantiere ha sottocantieri, seleziona prima il sottocantiere." },
        { status: 400 },
      );
    }

    const templateId = typeof body.templateId === "number" ? Number(body.templateId) : null;
    let effectiveTemplateId: number | null = templateId;

    if (!effectiveTemplateId) {
      const { data: templates, error } = await supabase
        .from("turni_site_templates")
        .select("id,valid_from,valid_to,is_active,sub_site_id")
        .eq("site_id", siteId)
        .is("sub_site_id", siteHasSubSites ? subSiteId : null)
        .eq("is_active", true)
        .lte("valid_from", startDate)
        .or(`valid_to.is.null,valid_to.gte.${startDate}`)
        .order("valid_from", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      effectiveTemplateId = (templates ?? [])[0]?.id ?? null;
    }

    if (!effectiveTemplateId) {
      return NextResponse.json({ error: "Nessun template attivo per il cantiere nel periodo." }, { status: 400 });
    }

    const { data: slotsData, error: slotsError } = await supabase
      .from("turni_site_template_slots")
      .select("weekday,start_time,end_time,break_minutes")
      .eq("template_id", effectiveTemplateId)
      .order("weekday")
      .order("start_time");
    if (slotsError) throw new Error(slotsError.message);

    const slots = (slotsData ?? []) as Array<{
      weekday: number;
      start_time: string;
      end_time: string;
      break_minutes: number;
    }>;

    if (slots.length === 0) {
      return NextResponse.json({ error: "Template senza fasce orarie." }, { status: 400 });
    }

    const { data: assignmentsData, error: assignmentsError } = await supabase
      .from("turni_employee_site_assignments")
      .select("id,employee_id,sub_site_id,start_date,end_date")
      .eq("site_id", siteId);
    if (assignmentsError) throw new Error(assignmentsError.message);

    const assignments = (assignmentsData ?? []) as Array<{
      employee_id: number;
      sub_site_id: number | null;
      start_date: string;
      end_date: string | null;
    }>;

    const scopedAssignments =
      typeof subSiteId === "number" && Number.isFinite(subSiteId)
        ? assignments.filter((a) => a.sub_site_id === subSiteId)
        : assignments.filter((a) => a.sub_site_id === null);

    const employeeIds = Array.from(new Set(scopedAssignments.map((a) => a.employee_id)));
    if (employeeIds.length === 0) {
      return NextResponse.json({ created: 0, skippedExisting: 0, conflicts: 0, message: "Nessun lavoratore assegnato." });
    }

    const { data: existingData, error: existingError } = await supabase
      .from("turni_employee_shifts")
      .select("id,employee_id,site_id,start_at,end_at")
      .eq("site_id", siteId)
      .in("employee_id", employeeIds)
      .lt("start_at", end.toISOString())
      .gt("end_at", start.toISOString());
    if (existingError) throw new Error(existingError.message);

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

    let missingSubSiteAssignments = 0;

    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);

    while (cursor <= endDay) {
      const weekday = (cursor.getDay() + 6) % 7;
      const dayIso = cursor.toISOString().slice(0, 10);

      const daySlots = slots.filter((s) => s.weekday === weekday);
      if (daySlots.length === 0) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      const activeAssignments = scopedAssignments
        .filter((a) => {
          if (a.start_date > dayIso) return false;
          if (a.end_date && a.end_date < dayIso) return false;
          return true;
        });

      for (const a of activeAssignments) {
        if (siteHasSubSites && a.sub_site_id === null) {
          missingSubSiteAssignments += 1;
          continue;
        }
        const employeeId = a.employee_id;
        for (const slot of daySlots) {
          const startAt = new Date(`${dayIso}T${slot.start_time.slice(0, 5)}:00`);
          const endAt = new Date(`${dayIso}T${slot.end_time.slice(0, 5)}:00`);
          const startIso = startAt.toISOString();
          const endIso = endAt.toISOString();
          const key = `${employeeId}:${siteId}:${startIso}:${endIso}`;
          if (existingKey.has(key)) continue;
          payload.push({
            employee_id: employeeId,
            site_id: siteId,
            sub_site_id: a.sub_site_id,
            start_at: startIso,
            end_at: endIso,
            state: "planned",
            source: "template",
            note: null,
            created_by: auth.userId,
          });
        }
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

    const message =
      siteHasSubSites && missingSubSiteAssignments > 0
        ? `Assegnazioni senza sottocantiere: ${missingSubSiteAssignments}.`
        : undefined;
    return NextResponse.json({ created, skippedExisting, conflicts, missingSubSiteAssignments, message });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore generazione turni." },
      { status: 500 },
    );
  }
}
