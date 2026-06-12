import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Mode = "employee" | "site";
type ShiftState = "planned" | "actual" | "cancelled";
type AbsenceType = "ferie" | "malattia" | "permesso" | "infortunio" | "altro";
type ShiftSource = "template" | "manual" | "import";
type ExistingShiftRow = {
  id: number;
  site_id: number;
  sub_site_id: number | null;
  start_at: string;
  end_at: string;
  state: ShiftState;
  source: ShiftSource;
  note: string | null;
};

const MAX_SYNC_RANGE_DAYS = 62;
const MAX_SITE_SYNC_EMPLOYEES = 500;
const MAX_DESIRED_SHIFTS_PER_EMPLOYEE = 5000;

class SyncLimitError extends Error {
  status = 400;
}

export function pickAbsenceForShift(
  absences: Array<{ id: number; absence_type: AbsenceType; start_at: string; end_at: string; note: string | null }>,
  startAt: string,
  endAt: string,
) {
  const ordered = [...absences].sort((a, b) => {
    const cmp = String(a.start_at).localeCompare(String(b.start_at));
    if (cmp !== 0) return cmp;
    return a.id - b.id;
  });
  for (const a of ordered) {
    if (overlaps(startAt, endAt, a.start_at, a.end_at)) return a;
  }
  return null;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseIsoDate(value: unknown) {
  const v = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function toIsoDate(d: Date) {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function diffDaysInclusive(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const delta = end.getTime() - start.getTime();
  if (!Number.isFinite(delta)) return null;
  return Math.floor(delta / 86400000) + 1;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const aS = new Date(aStart).getTime();
  const aE = new Date(aEnd).getTime();
  const bS = new Date(bStart).getTime();
  const bE = new Date(bEnd).getTime();
  if (!Number.isFinite(aS) || !Number.isFinite(aE) || !Number.isFinite(bS) || !Number.isFinite(bE)) return false;
  return aS < bE && aE > bS;
}

function isShiftOverlapConflict(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "23P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return (
    message.includes("turni_employee_shifts_no_overlap") ||
    message.includes("exclusion constraint") ||
    message.includes("conflicting key value")
  );
}

async function findConflictingShift(params: {
  supabase: SupabaseClient;
  employeeId: number;
  siteId: number;
  subSiteId: number | null;
  startAt: string;
  endAt: string;
}) {
  const { supabase, employeeId, siteId, subSiteId, startAt, endAt } = params;
  let query = supabase
    .from("turni_employee_shifts")
    .select("id,site_id,sub_site_id,start_at,end_at,state,source,note")
    .eq("employee_id", employeeId)
    .eq("site_id", siteId)
    .neq("state", "cancelled")
    .lt("start_at", endAt)
    .gt("end_at", startAt)
    .limit(5);

  if (subSiteId === null) query = query.is("sub_site_id", null);
  else query = query.eq("sub_site_id", subSiteId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ExistingShiftRow[];
  return rows.find((row) => row.start_at === startAt && row.end_at === endAt) ?? rows[0] ?? null;
}

async function loadActiveTemplate(
  supabase: SupabaseClient,
  employeeId: number,
  refDate: string,
) {
  const { data: templates, error } = await supabase
    .from("turni_employee_templates")
    .select("id,employee_id,name,valid_from,valid_to,is_active,created_by")
    .eq("employee_id", employeeId)
    .eq("is_active", true)
    .lte("valid_from", refDate)
    .or(`valid_to.is.null,valid_to.gte.${refDate}`)
    .order("valid_from", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (templates ?? [])[0] as
    | { id: number; employee_id: number; name: string; valid_from: string; valid_to: string | null; created_by: string | null }
    | undefined;
}

async function syncEmployeeRange(params: {
  supabase: SupabaseClient;
  employeeId: number;
  startDate: string;
  endDate: string;
  siteId?: number;
  subSiteId?: number | null;
}) {
  const { supabase, employeeId, startDate, endDate, siteId, subSiteId } = params;

  const template = await loadActiveTemplate(supabase, employeeId, startDate);
  if (!template) return { inserted: 0, updated: 0, deleted: 0, skippedManual: 0, message: "Nessun template attivo." };

  let slotsQuery = supabase
    .from("turni_employee_template_slots")
    .select("id,weekday,site_id,sub_site_id,start_time,end_time,break_minutes")
    .eq("template_id", template.id)
    .order("weekday")
    .order("start_time");
  if (typeof siteId === "number" && Number.isFinite(siteId)) slotsQuery = slotsQuery.eq("site_id", siteId);
  if (subSiteId === null) {
    if (typeof siteId === "number" && Number.isFinite(siteId)) slotsQuery = slotsQuery.is("sub_site_id", null);
  } else if (typeof subSiteId === "number" && Number.isFinite(subSiteId)) {
    slotsQuery = slotsQuery.eq("sub_site_id", subSiteId);
  }

  const { data: slotsData, error: slotsError } = await slotsQuery;
  if (slotsError) throw new Error(slotsError.message);
  const slots = (slotsData ?? []) as Array<{
    id: number;
    weekday: number;
    site_id: number;
    sub_site_id: number | null;
    start_time: string;
    end_time: string;
    break_minutes: number;
  }>;
  if (slots.length === 0) return { inserted: 0, updated: 0, deleted: 0, skippedManual: 0, message: "Template senza fasce." };

  const startAtRange = new Date(`${startDate}T00:00:00`);
  const endAtRange = new Date(`${endDate}T23:59:59`);
  if (!Number.isFinite(startAtRange.getTime()) || !Number.isFinite(endAtRange.getTime())) {
    throw new Error("Range date non valido.");
  }

  const [{ data: absencesData, error: absencesError }, { data: existingData, error: existingError }] = await Promise.all([
    supabase
      .from("turni_employee_absences")
      .select("id,absence_type,start_at,end_at,note")
      .eq("employee_id", employeeId)
      .neq("state", "cancelled")
      .lt("start_at", endAtRange.toISOString())
      .gt("end_at", startAtRange.toISOString()),
    supabase
      .from("turni_employee_shifts")
      .select("id,employee_id,site_id,sub_site_id,start_at,end_at,state,source,note,created_by")
      .eq("employee_id", employeeId)
      .lt("start_at", endAtRange.toISOString())
      .gt("end_at", startAtRange.toISOString()),
  ]);
  if (absencesError) throw new Error(absencesError.message);
  if (existingError) throw new Error(existingError.message);

  const absences = (absencesData ?? []) as Array<{
    id: number;
    absence_type: AbsenceType;
    start_at: string;
    end_at: string;
    note: string | null;
  }>;

  const allExisting = (existingData ?? []) as ExistingShiftRow[];

  const allowedSite = typeof siteId === "number" && Number.isFinite(siteId) ? siteId : null;
  const allowedSub = subSiteId === undefined ? undefined : subSiteId;

  const existingAnyByKey = new Map<string, { id: number; source: string }>();
  const existingTemplateByKey = new Map<string, { id: number; state: ShiftState; note: string | null }>();
  for (const r of allExisting) {
    if (allowedSite !== null && r.site_id !== allowedSite) continue;
    if (allowedSub !== undefined) {
      if (allowedSub === null && r.sub_site_id !== null) continue;
      if (typeof allowedSub === "number" && r.sub_site_id !== allowedSub) continue;
    }
    const key = `${employeeId}:${r.site_id}:${r.sub_site_id ?? ""}:${r.start_at}:${r.end_at}`;
    existingAnyByKey.set(key, { id: r.id, source: r.source });
    if (r.source === "template") existingTemplateByKey.set(key, { id: r.id, state: r.state, note: r.note });
  }

  const desired: Array<{
    key: string;
    siteId: number;
    subSiteId: number | null;
    startAt: string;
    endAt: string;
    state: ShiftState;
    note: string | null;
  }> = [];

  const cursor = new Date(`${startDate}T12:00:00`);
  const endDay = new Date(`${endDate}T12:00:00`);
  cursor.setHours(12, 0, 0, 0);
  endDay.setHours(12, 0, 0, 0);

  while (cursor <= endDay) {
    const weekday = (cursor.getDay() + 6) % 7;
    const dayIso = toIsoDate(cursor);
    const daySlots = slots.filter((s) => s.weekday === weekday);
    for (const slot of daySlots) {
      const start = new Date(`${dayIso}T${slot.start_time.slice(0, 5)}:00`);
      let end = new Date(`${dayIso}T${slot.end_time.slice(0, 5)}:00`);
      if (end <= start) {
        const next = new Date(`${dayIso}T12:00:00`);
        next.setDate(next.getDate() + 1);
        end = new Date(`${toIsoDate(next)}T${slot.end_time.slice(0, 5)}:00`);
      }
      const startAt = start.toISOString();
      const endAt = end.toISOString();
      const key = `${employeeId}:${slot.site_id}:${slot.sub_site_id ?? ""}:${startAt}:${endAt}`;

      const absence = pickAbsenceForShift(absences, startAt, endAt);
      const state: ShiftState = absence ? "cancelled" : "planned";
      const note = absence
        ? normalizeText(`${absence.absence_type}${absence.note ? `: ${absence.note}` : ""}`) || null
        : null;

      desired.push({
        key,
        siteId: slot.site_id,
        subSiteId: slot.sub_site_id,
        startAt,
        endAt,
        state,
        note,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (desired.length > MAX_DESIRED_SHIFTS_PER_EMPLOYEE) {
    throw new SyncLimitError(
      `Troppi turni template da sincronizzare per un singolo lavoratore (> ${MAX_DESIRED_SHIFTS_PER_EMPLOYEE}). Restringi il range o il template.`,
    );
  }

  const desiredKey = new Set(desired.map((d) => d.key));

  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  let skippedManual = 0;

  for (const d of desired) {
    const any = existingAnyByKey.get(d.key);
    if (any && any.source !== "template") {
      skippedManual += 1;
      continue;
    }

    const current = existingTemplateByKey.get(d.key);
    if (current) {
      const patch: Record<string, unknown> = {};
      if (current.state !== d.state) patch.state = d.state;
      if ((current.note ?? null) !== (d.note ?? null)) patch.note = d.note;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("turni_employee_shifts").update(patch).eq("id", current.id);
        if (error) throw new Error(error.message);
        updated += 1;
      }
      continue;
    }

    const { error } = await supabase.from("turni_employee_shifts").insert({
      employee_id: employeeId,
      site_id: d.siteId,
      sub_site_id: d.subSiteId,
      start_at: d.startAt,
      end_at: d.endAt,
      state: d.state,
      source: "template",
      note: d.note,
      created_by: template.created_by,
    });
    if (error) {
      if (!isShiftOverlapConflict(error)) throw new Error(error.message);

      const conflicting = await findConflictingShift({
        supabase,
        employeeId,
        siteId: d.siteId,
        subSiteId: d.subSiteId,
        startAt: d.startAt,
        endAt: d.endAt,
      });
      if (!conflicting) throw new Error(error.message);

      if (conflicting.source !== "template") {
        skippedManual += 1;
        continue;
      }

      const patch: Record<string, unknown> = {};
      if (conflicting.state !== d.state) patch.state = d.state;
      if ((conflicting.note ?? null) !== (d.note ?? null)) patch.note = d.note;
      if (Object.keys(patch).length > 0) {
        const { error: updateError } = await supabase
          .from("turni_employee_shifts")
          .update(patch)
          .eq("id", conflicting.id)
          .eq("source", "template");
        if (updateError) throw new Error(updateError.message);
        updated += 1;
      }
      continue;
    }
    inserted += 1;
  }

  const extraTemplate = Array.from(existingTemplateByKey.entries()).filter(([k]) => !desiredKey.has(k));
  if (extraTemplate.length > 0) {
    const ids = extraTemplate.map(([, v]) => v.id);
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("turni_employee_shifts")
        .update({ state: "cancelled" })
        .eq("source", "template")
        .neq("state", "cancelled")
        .in("id", chunk)
        .select("id");
      if (error) throw new Error(error.message);
      deleted += (data ?? []).length;
    }
  }

  return { inserted, updated, deleted, skippedManual, message: null as string | null };
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as
      | {
          mode: Mode;
          employeeId: number;
          startDate: string;
          endDate: string;
          siteId?: number;
          subSiteId?: number | null;
        }
      | {
          mode: Mode;
          siteId: number;
          subSiteId?: number | null;
          startDate: string;
          endDate: string;
        };

    const mode = normalizeText((body as { mode?: string }).mode) as Mode;
    const startDate = parseIsoDate((body as { startDate?: string }).startDate);
    const endDate = parseIsoDate((body as { endDate?: string }).endDate);
    if (!startDate || !endDate) return NextResponse.json({ error: "startDate/endDate non validi." }, { status: 400 });
    if (startDate > endDate) return NextResponse.json({ error: "Range date non valido." }, { status: 400 });
    const rangeDays = diffDaysInclusive(startDate, endDate);
    if (!rangeDays || rangeDays <= 0) {
      return NextResponse.json({ error: "Range date non valido." }, { status: 400 });
    }
    if (rangeDays > MAX_SYNC_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Range troppo ampio (${rangeDays} giorni). Massimo consentito: ${MAX_SYNC_RANGE_DAYS}.` },
        { status: 400 },
      );
    }

    const supabase = auth.supabase;

    if (mode === "employee") {
      const employeeId = Number((body as { employeeId?: number }).employeeId);
      if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
      const siteId = (body as { siteId?: number }).siteId;
      const subSiteId = (body as { subSiteId?: number | null }).subSiteId;
      const result = await syncEmployeeRange({
        supabase,
        employeeId,
        startDate,
        endDate,
        siteId: typeof siteId === "number" ? Number(siteId) : undefined,
        subSiteId: subSiteId === undefined ? undefined : subSiteId === null ? null : Number(subSiteId),
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (mode !== "site") return NextResponse.json({ error: "mode non valido." }, { status: 400 });

    const siteId = Number((body as { siteId?: number }).siteId);
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    const subSiteIdRaw = (body as { subSiteId?: number | null }).subSiteId;
    const subSiteId = subSiteIdRaw === undefined ? undefined : subSiteIdRaw === null ? null : Number(subSiteIdRaw);

    let q = supabase
      .from("turni_employee_site_assignments")
      .select("employee_id,start_date,end_date")
      .eq("site_id", siteId)
      .lte("start_date", endDate)
      .or(`end_date.is.null,end_date.gte.${startDate}`)
      .limit(MAX_SITE_SYNC_EMPLOYEES + 1);
    if (subSiteId === null) q = q.is("sub_site_id", null);
    else if (typeof subSiteId === "number" && Number.isFinite(subSiteId)) q = q.eq("sub_site_id", subSiteId);

    const { data: assignments, error: assignmentsError } = await q;
    if (assignmentsError) throw new Error(assignmentsError.message);

    if ((assignments ?? []).length > MAX_SITE_SYNC_EMPLOYEES) {
      return NextResponse.json(
        { error: `Troppi lavoratori assegnati al sito per sync (> ${MAX_SITE_SYNC_EMPLOYEES}). Restringi filtri o periodo.` },
        { status: 400 },
      );
    }

    const employeeIds = Array.from(
      new Set((assignments ?? []).map((r) => (r as { employee_id: number }).employee_id).filter((v) => typeof v === "number")),
    );

    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    let skippedManual = 0;
    for (const employeeId of employeeIds) {
      const res = await syncEmployeeRange({
        supabase,
        employeeId,
        startDate,
        endDate,
        siteId,
        subSiteId: subSiteId === undefined ? undefined : subSiteId,
      });
      inserted += res.inserted;
      updated += res.updated;
      deleted += res.deleted;
      skippedManual += res.skippedManual;
    }

    return NextResponse.json({ ok: true, employeeCount: employeeIds.length, inserted, updated, deleted, skippedManual });
  } catch (err) {
    if (err instanceof SyncLimitError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore sync turni." },
      { status: 500 },
    );
  }
}
