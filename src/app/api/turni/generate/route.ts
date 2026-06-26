import { NextResponse } from "next/server";
import { withModuleAccess } from "@/lib/api/with-module-access";
import { handleError, AppError } from "@/lib/api/error-handler";
import { shiftGenerateLimiter } from "@/lib/api/rate-limit";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_ASSIGNMENTS = 5000;
const MAX_EXISTING_SHIFTS = 20000;

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
    if ((data ?? []).length > 0) throw new AppError(400, "MONTH_LOCKED", `Mese bloccato: ${monthStr}/${yearStr}.`);
  }
}

export const POST = withModuleAccess("turni", true, async (request, context, { supabase, userId }) => {
  // Apply rate limiting by userId
  const rl = shiftGenerateLimiter.check(userId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Troppe richieste di generazione turni. Attendi un momento." },
      { status: 429 }
    );
  }

  try {
    const body = (await request.json()) as {
      siteId: number;
      subSiteId?: number | null;
      startDate: string;
      endDate: string;
      templateId?: number;
    };

    const siteId = Number(body.siteId);
    if (!Number.isFinite(siteId)) throw new AppError(400, "INVALID_PARAM", "siteId non valido.");
    const subSiteId = body.subSiteId === null || body.subSiteId === undefined ? null : Number(body.subSiteId);
    if (body.subSiteId !== undefined && body.subSiteId !== null && !Number.isFinite(subSiteId)) {
      throw new AppError(400, "INVALID_PARAM", "subSiteId non valido.");
    }

    const startDate = parseIsoDate(body.startDate);
    const endDate = parseIsoDate(body.endDate);
    if (!startDate || !endDate) throw new AppError(400, "INVALID_PARAM", "startDate/endDate non validi.");

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
      throw new AppError(400, "INVALID_PARAM", "Range date non valido.");
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
      throw new AppError(400, "MISSING_SUBSITE", "Se il cantiere ha sottocantieri, seleziona prima il sottocantiere.");
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
      throw new AppError(400, "NO_ACTIVE_TEMPLATE", "Nessun template attivo per il cantiere nel periodo.");
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
      throw new AppError(400, "EMPTY_TEMPLATE", "Template senza fasce orarie.");
    }

    const { data: assignmentsData, error: assignmentsError } = await supabase
      .from("turni_employee_site_assignments")
      .select("id,employee_id,sub_site_id,start_date,end_date")
      .eq("site_id", siteId)
      .lte("start_date", endDate)
      .or(`end_date.is.null,end_date.gte.${startDate}`)
      .limit(MAX_ASSIGNMENTS + 1);
    if (assignmentsError) throw new Error(assignmentsError.message);

    const assignments = (assignmentsData ?? []) as Array<{
      employee_id: number;
      sub_site_id: number | null;
      start_date: string;
      end_date: string | null;
    }>;
    if (assignments.length > MAX_ASSIGNMENTS) {
      throw new AppError(400, "TOO_MANY_ASSIGNMENTS", `Troppi assegnamenti nel periodo (> ${MAX_ASSIGNMENTS}). Restringi il range.`);
    }

    const scopedAssignments =
      typeof subSiteId === "number" && Number.isFinite(subSiteId)
        ? assignments.filter((a) => a.sub_site_id === subSiteId)
        : assignments.filter((a) => a.sub_site_id === null);

    const rawEmployeeIds = Array.from(new Set(scopedAssignments.map((a) => a.employee_id)));
    if (rawEmployeeIds.length === 0) {
      return NextResponse.json({ created: 0, skippedExisting: 0, conflicts: 0, message: "Nessun lavoratore assegnato." });
    }

    // --- BUSINESS RULE: Filter out workers who are not currently active in force ---
    const { data: employeesInfo, error: employeesInfoError } = await supabase
      .from("employees")
      .select("id, status")
      .in("id", rawEmployeeIds);
    if (employeesInfoError) throw new Error(employeesInfoError.message);

    const activeEmployeeIds = new Set(
      (employeesInfo ?? [])
        .filter((emp) => emp.status === "attivo")
        .map((emp) => emp.id)
    );

    const filteredEmployeeIds = Array.from(activeEmployeeIds);
    if (filteredEmployeeIds.length === 0) {
      return NextResponse.json({ created: 0, skippedExisting: 0, conflicts: 0, message: "Nessun lavoratore in forza attivo assegnato." });
    }

    // --- BUSINESS RULE: Check freeze periods for employee exclusions ---
    const { data: freezeData, error: freezeError } = await supabase
      .from("employee_freeze_periods")
      .select("employee_id, freeze_status, start_date, end_date")
      .in("employee_id", filteredEmployeeIds);
    if (freezeError) throw new Error(freezeError.message);

    const { data: existingData, error: existingError } = await supabase
      .from("turni_employee_shifts")
      .select("id,employee_id,site_id,start_at,end_at")
      .eq("site_id", siteId)
      .in("employee_id", filteredEmployeeIds)
      .neq("state", "cancelled")
      .lt("start_at", end.toISOString())
      .gt("end_at", start.toISOString())
      .limit(MAX_EXISTING_SHIFTS + 1);
    if (existingError) throw new Error(existingError.message);
    if ((existingData ?? []).length > MAX_EXISTING_SHIFTS) {
      throw new AppError(400, "TOO_MANY_SHIFTS", `Troppi turni esistenti nel periodo (> ${MAX_EXISTING_SHIFTS}). Restringi il range.`);
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
          // 1. Must be active
          if (!activeEmployeeIds.has(a.employee_id)) return false;
          // 2. Assignment must cover this date
          if (a.start_date > dayIso) return false;
          if (a.end_date && a.end_date < dayIso) return false;

          // 3. Must not be frozen/suspended on this date (maternity, sick, union, etc.)
          const isFrozen = (freezeData ?? []).some((f) => {
            if (f.employee_id !== a.employee_id) return false;
            if (f.start_date > dayIso) return false;
            if (f.end_date && f.end_date < dayIso) return false;
            return true;
          });
          if (isFrozen) return false;

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
          if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1);
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
            created_by: userId,
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
  } catch (error) {
    return handleError(error, "POST /api/turni/generate");
  }
});
