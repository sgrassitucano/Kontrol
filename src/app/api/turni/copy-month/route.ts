import { NextResponse } from "next/server";
import { withModuleAccess } from "@/lib/api/with-module-access";
import { handleError, AppError } from "@/lib/api/error-handler";
import { shiftGenerateLimiter } from "@/lib/api/rate-limit";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_SOURCE_SHIFTS = 20000;
const MAX_TARGET_EXISTING = 20000;
const INSERT_CHUNK = 200;

type ShiftState = "planned" | "actual" | "cancelled";
type ShiftSource = "template" | "manual" | "import";

type SourceShift = {
  employee_id: number;
  site_id: number;
  sub_site_id: number | null;
  start_at: string;
  end_at: string;
  state: ShiftState;
  source: ShiftSource;
  note: string | null;
};

function parseYearMonth(value: unknown) {
  const v = String(value ?? "").trim();
  const m = v.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function parseCsvNumbers(value: unknown) {
  if (!Array.isArray(value)) return [];
  const nums = value.map((v) => Number(v)).filter((v) => Number.isFinite(v)) as number[];
  return Array.from(new Set(nums));
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

async function ensureMonthNotLocked(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  year: number,
  month: number,
) {
  const { data, error } = await supabase
    .from("turni_month_locks")
    .select("id")
    .eq("year", year)
    .eq("month", month)
    .limit(1);
  if (error) throw new Error(error.message);
  if ((data ?? []).length > 0) {
    throw new AppError(400, "MONTH_LOCKED", `Mese di destinazione bloccato: ${pad2(month)}/${year}.`);
  }
}

function isOverlapError(message: string) {
  return /turni_employee_shifts_no_overlap/i.test(message) || /overlap/i.test(message);
}

export const POST = withModuleAccess("turni", true, async (request, context, { supabase, userId }) => {
  const rl = shiftGenerateLimiter.check(userId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Troppe richieste di copia turni. Attendi un momento." },
      { status: 429 },
    );
  }

  try {
    const body = (await request.json()) as {
      fromMonth: string;
      toMonth: string;
      siteIds?: number[];
      employeeIds?: number[];
      includeCancelled?: boolean;
    };

    const from = parseYearMonth(body.fromMonth);
    const to = parseYearMonth(body.toMonth);
    if (!from) throw new AppError(400, "INVALID_PARAM", "fromMonth non valido (YYYY-MM).");
    if (!to) throw new AppError(400, "INVALID_PARAM", "toMonth non valido (YYYY-MM).");
    if (from.year === to.year && from.month === to.month) {
      throw new AppError(400, "INVALID_PARAM", "Mese di origine e destinazione coincidono.");
    }

    const siteIds = parseCsvNumbers(body.siteIds);
    const employeeIds = parseCsvNumbers(body.employeeIds);
    const includeCancelled = Boolean(body.includeCancelled);

    await ensureMonthNotLocked(supabase, to.year, to.month);

    // Source range [srcStart, srcEnd)
    const srcStart = new Date(Date.UTC(from.year, from.month - 1, 1, 0, 0, 0, 0));
    const srcEnd = new Date(Date.UTC(from.year, from.month, 1, 0, 0, 0, 0));

    let q = supabase
      .from("turni_employee_shifts")
      .select("employee_id,site_id,sub_site_id,start_at,end_at,state,source,note")
      .gte("start_at", srcStart.toISOString())
      .lt("start_at", srcEnd.toISOString())
      .order("employee_id")
      .order("start_at")
      .limit(MAX_SOURCE_SHIFTS + 1);
    if (!includeCancelled) q = q.neq("state", "cancelled");
    if (siteIds.length > 0) q = q.in("site_id", siteIds);
    if (employeeIds.length > 0) q = q.in("employee_id", employeeIds);

    const { data: srcData, error: srcError } = await q;
    if (srcError) throw new Error(srcError.message);
    const sourceShifts = (srcData ?? []) as SourceShift[];
    if (sourceShifts.length > MAX_SOURCE_SHIFTS) {
      throw new AppError(400, "TOO_MANY_SHIFTS", `Troppi turni nel mese origine (> ${MAX_SOURCE_SHIFTS}). Restringi con filtri.`);
    }
    if (sourceShifts.length === 0) {
      return NextResponse.json({ created: 0, skippedExisting: 0, conflicts: 0, skippedInvalidDay: 0, skippedInactive: 0, message: "Nessun turno nel mese di origine." });
    }

    // Business rule: only workers currently active in force.
    const involvedEmployeeIds = Array.from(new Set(sourceShifts.map((s) => s.employee_id)));
    const { data: employeesInfo, error: employeesInfoError } = await supabase
      .from("employees")
      .select("id,status")
      .in("id", involvedEmployeeIds);
    if (employeesInfoError) throw new Error(employeesInfoError.message);
    const activeEmployeeIds = new Set(
      (employeesInfo ?? []).filter((e) => (e as { status: string }).status === "attivo").map((e) => (e as { id: number }).id),
    );

    // Existing shifts in the target month, to dedup exact copies.
    const tgtStart = new Date(Date.UTC(to.year, to.month - 1, 1, 0, 0, 0, 0));
    const tgtEnd = new Date(Date.UTC(to.year, to.month, 1, 0, 0, 0, 0));
    let tq = supabase
      .from("turni_employee_shifts")
      .select("employee_id,site_id,start_at,end_at")
      .gte("start_at", tgtStart.toISOString())
      .lt("start_at", tgtEnd.toISOString())
      .neq("state", "cancelled")
      .limit(MAX_TARGET_EXISTING + 1);
    if (siteIds.length > 0) tq = tq.in("site_id", siteIds);
    const { data: tgtData, error: tgtError } = await tq;
    if (tgtError) throw new Error(tgtError.message);
    if ((tgtData ?? []).length > MAX_TARGET_EXISTING) {
      throw new AppError(400, "TOO_MANY_SHIFTS", `Troppi turni già presenti nel mese destinazione (> ${MAX_TARGET_EXISTING}).`);
    }
    const existingKey = new Set<string>();
    for (const r of (tgtData ?? []) as Array<{ employee_id: number; site_id: number; start_at: string; end_at: string }>) {
      existingKey.add(`${r.employee_id}:${r.site_id}:${r.start_at}:${r.end_at}`);
    }

    const tgtDays = daysInMonth(to.year, to.month);
    let skippedInvalidDay = 0;
    let skippedInactive = 0;

    const payload: Array<{
      employee_id: number;
      site_id: number;
      sub_site_id: number | null;
      start_at: string;
      end_at: string;
      state: "planned";
      source: ShiftSource;
      note: string | null;
      created_by: string;
    }> = [];

    for (const s of sourceShifts) {
      if (!activeEmployeeIds.has(s.employee_id)) {
        skippedInactive += 1;
        continue;
      }
      const srcStartDate = new Date(s.start_at);
      const srcEndDate = new Date(s.end_at);
      if (!Number.isFinite(srcStartDate.getTime()) || !Number.isFinite(srcEndDate.getTime())) continue;
      const durationMs = srcEndDate.getTime() - srcStartDate.getTime();
      if (durationMs <= 0) continue;

      // Preserve calendar day-of-month + time-of-day. Skip days absent in target month (e.g. 31 -> Feb).
      const dom = srcStartDate.getUTCDate();
      if (dom > tgtDays) {
        skippedInvalidDay += 1;
        continue;
      }
      const startAt = new Date(
        Date.UTC(
          to.year,
          to.month - 1,
          dom,
          srcStartDate.getUTCHours(),
          srcStartDate.getUTCMinutes(),
          0,
          0,
        ),
      );
      const endAt = new Date(startAt.getTime() + durationMs);
      const startIso = startAt.toISOString();
      const endIso = endAt.toISOString();
      const key = `${s.employee_id}:${s.site_id}:${startIso}:${endIso}`;
      if (existingKey.has(key)) continue;
      existingKey.add(key);
      payload.push({
        employee_id: s.employee_id,
        site_id: s.site_id,
        sub_site_id: s.sub_site_id,
        start_at: startIso,
        end_at: endIso,
        state: "planned",
        source: s.source,
        note: s.note,
        created_by: userId,
      });
    }

    if (payload.length === 0) {
      return NextResponse.json({
        created: 0,
        skippedExisting: 0,
        conflicts: 0,
        skippedInvalidDay,
        skippedInactive,
        message: "Nessun nuovo turno da copiare.",
      });
    }

    let created = 0;
    let conflicts = 0;
    for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
      const chunk = payload.slice(i, i + INSERT_CHUNK);
      const { error } = await supabase.from("turni_employee_shifts").insert(chunk);
      if (!error) {
        created += chunk.length;
        continue;
      }
      // Fall back row-by-row so a single overlap does not drop the whole chunk.
      for (const row of chunk) {
        const { error: singleError } = await supabase.from("turni_employee_shifts").insert(row);
        if (!singleError) created += 1;
        else if (isOverlapError(singleError.message)) conflicts += 1;
        else throw new Error(singleError.message);
      }
    }

    return NextResponse.json({
      created,
      skippedExisting: 0,
      conflicts,
      skippedInvalidDay,
      skippedInactive,
      message: `Copiati ${created} turni da ${pad2(from.month)}/${from.year} a ${pad2(to.month)}/${to.year}.`,
    });
  } catch (error) {
    return handleError(error, "POST /api/turni/copy-month");
  }
});
