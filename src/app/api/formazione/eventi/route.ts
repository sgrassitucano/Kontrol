import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { parseStrictIsoDateToIso } from "@/lib/it-date";

export const runtime = "nodejs";

type EventType = "PROGRAMMATO" | "RIMUOVI_PROGRAMMATO" | "SVOLTO" | "MODIFICA_DATA" | "ANNULLA" | "DA_FARE" | "NOTE";

const MAX_EMPLOYEE_IDS = 5000;

function chunkArray<T>(items: T[], chunkSize: number) {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function parseDateIso(value: unknown) {
  return parseStrictIsoDateToIso(String(value ?? ""));
}

function cleanText(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function computeExpiryFromCompletion(completionDateIso: string, course: { validity_years: number | null; is_unlimited: boolean }) {
  if (course.is_unlimited) return null;
  const years = course.validity_years;
  if (!years) return null;
  const base = new Date(`${completionDateIso}T00:00:00.000Z`);
  const next = new Date(Date.UTC(base.getUTCFullYear() + years, base.getUTCMonth(), base.getUTCDate()));
  return next.toISOString().slice(0, 10);
}

async function clearCourseExclusions(args: {
  supabase: ReturnType<typeof requireModuleAccess> extends Promise<infer R>
    ? R extends { supabase: infer S }
      ? S
      : never
    : never;
  employeeIds: number[];
  courseId: number;
}) {
  const { supabase, employeeIds, courseId } = args;
  for (const chunk of chunkArray(employeeIds, 500)) {
    const { error } = await supabase
      .from("training_employee_course_exclusions")
      .update({ is_active: false })
      .eq("course_id", courseId)
      .in("employee_id", chunk)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as {
      employeeId?: number;
      employeeIds?: number[];
      courseCode: string;
      type: EventType;
      date?: string;
      note?: string;
      dryRun?: boolean;
    };

    const employeeIdsRaw = Array.isArray(body.employeeIds) ? body.employeeIds : [];
    const fallbackEmployeeId = Number(body.employeeId);
    const employeeIdsDeduped = Array.from(
      new Set(
        (employeeIdsRaw.length > 0
          ? employeeIdsRaw.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
          : Number.isFinite(fallbackEmployeeId) && fallbackEmployeeId > 0
            ? [fallbackEmployeeId]
            : []) as number[],
      ),
    );
    const employeeIds = employeeIdsDeduped;
    const courseCode = String(body.courseCode ?? "").trim();
    const type = String(body.type ?? "").trim() as EventType;
    const dateIso = parseDateIso(body.date);
    const note = cleanText(body.note);
    const dryRun = Boolean(body.dryRun);

    if (employeeIds.length === 0) {
      return NextResponse.json({ error: "employeeIds non valido." }, { status: 400 });
    }
    if (employeeIds.length > MAX_EMPLOYEE_IDS) {
      return NextResponse.json(
        { error: `Troppi lavoratori selezionati (>${MAX_EMPLOYEE_IDS}). Riduci la selezione.` },
        { status: 400 },
      );
    }
    if (!courseCode) {
      return NextResponse.json({ error: "courseCode obbligatorio." }, { status: 400 });
    }
    if (
      type !== "PROGRAMMATO" &&
      type !== "RIMUOVI_PROGRAMMATO" &&
      type !== "SVOLTO" &&
      type !== "MODIFICA_DATA" &&
      type !== "ANNULLA" &&
      type !== "DA_FARE" &&
      type !== "NOTE"
    ) {
      return NextResponse.json({ error: "Tipo evento non valido." }, { status: 400 });
    }
    if ((type === "SVOLTO" || type === "MODIFICA_DATA") && !dateIso) {
      return NextResponse.json({ error: "Data obbligatoria per questo evento." }, { status: 400 });
    }

    const { data: course, error: courseError } = await auth.supabase
      .from("training_courses")
      .select("id,validity_years,is_unlimited")
      .eq("code", courseCode)
      .maybeSingle();
    if (courseError) return NextResponse.json({ error: courseError.message }, { status: 500 });
    if (!course) return NextResponse.json({ error: "Corso non trovato." }, { status: 404 });

    const courseId = (course as { id: number }).id;

    if (type === "NOTE") {
      if (dryRun) return NextResponse.json({ ok: true, upserts: employeeIds.length });
      for (const chunk of chunkArray(employeeIds, 500)) {
        const { error: noteError } = await auth.supabase.from("training_employee_courses").upsert(
          chunk.map((employeeId) => ({
            employee_id: employeeId,
            course_id: courseId,
            updated_by: auth.userId,
            note,
          })),
          { onConflict: "employee_id,course_id" },
        );
        if (noteError) return NextResponse.json({ error: noteError.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, processed: employeeIds.length, skipped: 0 });
    }

    if (type === "ANNULLA") {
      const existing: Array<{
        employee_id: number;
        completion_date: string | null;
        planned_date: string | null;
        manual_state: string | null;
      }> = [];
      for (const chunk of chunkArray(employeeIds, 500)) {
        const { data, error: existingError } = await auth.supabase
          .from("training_employee_courses")
          .select("employee_id,completion_date,planned_date,manual_state")
          .eq("course_id", courseId)
          .in("employee_id", chunk);
        if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
        existing.push(...((data ?? []) as typeof existing));
      }

      const completedIds = new Set<number>();
      const plannedIds = new Set<number>();

      (existing ?? []).forEach((row) => {
        const r = row as {
          employee_id: number;
          completion_date: string | null;
          planned_date: string | null;
          manual_state: string | null;
        };
        if (r.completion_date) {
          completedIds.add(r.employee_id);
          return;
        }
        if (r.planned_date || r.manual_state === "programmato") {
          plannedIds.add(r.employee_id);
        }
      });

      const toExclude = employeeIds.filter((id) => !completedIds.has(id) && !plannedIds.has(id));
      const toClearPlanned = employeeIds.filter((id) => plannedIds.has(id));

      if (dryRun) {
        return NextResponse.json({
          ok: true,
          excluded: toExclude.length,
          clearedPlanned: toClearPlanned.length,
          completed: completedIds.size,
        });
      }

      if (toClearPlanned.length > 0) {
        const payload: Record<string, unknown> = {
          planned_date: null,
          manual_state: null,
          updated_by: auth.userId,
        };
        if (note !== null) payload.note = note;

        for (const chunk of chunkArray(toClearPlanned, 500)) {
          const { error: updateError } = await auth.supabase
            .from("training_employee_courses")
            .update(payload)
            .in("employee_id", chunk)
            .eq("course_id", courseId);
          if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      }

      if (toExclude.length > 0) {
        for (const chunk of chunkArray(toExclude, 500)) {
          const { error: exclusionError } = await auth.supabase.from("training_employee_course_exclusions").upsert(
            chunk.map((employeeId) => ({
              employee_id: employeeId,
              course_id: courseId,
              is_active: true,
              note,
              created_by: auth.userId,
            })),
            { onConflict: "employee_id,course_id" },
          );
          if (exclusionError) return NextResponse.json({ error: exclusionError.message }, { status: 500 });
        }
      }

      return NextResponse.json({
        ok: true,
        excluded: toExclude.length,
        clearedPlanned: toClearPlanned.length,
        skippedCompleted: completedIds.size,
      });
    }

    if (type === "PROGRAMMATO") {
      const plannedDate = dateIso;
      if (!dryRun) {
        await clearCourseExclusions({ supabase: auth.supabase, employeeIds, courseId });
      }
      const existing: Array<{ employee_id: number }> = [];
      for (const chunk of chunkArray(employeeIds, 500)) {
        const { data, error: existingError } = await auth.supabase
          .from("training_employee_courses")
          .select("employee_id")
          .eq("course_id", courseId)
          .in("employee_id", chunk);
        if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
        existing.push(...((data ?? []) as typeof existing));
      }

      const existingIds = new Set<number>((existing ?? []).map((r) => Number(r.employee_id)).filter((v) => Number.isFinite(v) && v > 0));
      const toInsert = employeeIds.filter((id) => !existingIds.has(id));
      const toUpdate = employeeIds.filter((id) => existingIds.has(id));

      if (toUpdate.length > 0) {
        const payload: Record<string, unknown> = {
          planned_date: plannedDate,
          manual_state: "programmato" as const,
          updated_by: auth.userId,
        };
        if (note !== null) payload.note = note;

        for (const chunk of chunkArray(toUpdate, 500)) {
          const { error: updateError } = await auth.supabase
            .from("training_employee_courses")
            .update(payload)
            .in("employee_id", chunk)
            .eq("course_id", courseId);
          if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      }

      if (toInsert.length > 0) {
        for (const chunk of chunkArray(toInsert, 500)) {
          const { error: insertError } = await auth.supabase.from("training_employee_courses").insert(
            chunk.map((employeeId) => ({
              employee_id: employeeId,
              course_id: courseId,
              planned_date: plannedDate,
              completion_date: null,
              expiry_date: null,
              manual_state: "programmato" as const,
              updated_by: auth.userId,
              note,
            })),
          );
          if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
        }
      }

      return NextResponse.json({ ok: true, processed: employeeIds.length, skipped: 0 });
    }

    if (type === "RIMUOVI_PROGRAMMATO") {
      const existing: Array<{
        employee_id: number;
        planned_date: string | null;
        manual_state: string | null;
      }> = [];
      for (const chunk of chunkArray(employeeIds, 500)) {
        const { data, error: existingError } = await auth.supabase
          .from("training_employee_courses")
          .select("employee_id,planned_date,manual_state")
          .eq("course_id", courseId)
          .in("employee_id", chunk);
        if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
        existing.push(...((data ?? []) as typeof existing));
      }

      const toClear = (existing ?? [])
        .filter((row) => row.planned_date || row.manual_state === "programmato")
        .map((row) => row.employee_id);

      if (dryRun) return NextResponse.json({ ok: true, clearedPlanned: toClear.length });
      if (toClear.length === 0) return NextResponse.json({ ok: true, processed: 0, skipped: employeeIds.length });

      await clearCourseExclusions({ supabase: auth.supabase, employeeIds: toClear, courseId });

      const payload: Record<string, unknown> = { planned_date: null, manual_state: null, updated_by: auth.userId };
      if (note !== null) payload.note = note;

      for (const chunk of chunkArray(toClear, 500)) {
        const { error: updateError } = await auth.supabase
          .from("training_employee_courses")
          .update(payload)
          .in("employee_id", chunk)
          .eq("course_id", courseId);
        if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, processed: toClear.length, skipped: employeeIds.length - toClear.length });
    }

    if (type === "DA_FARE") {
      const existing: Array<{
        employee_id: number;
        completion_date: string | null;
        planned_date: string | null;
        manual_state: string | null;
      }> = [];
      for (const chunk of chunkArray(employeeIds, 500)) {
        const { data, error: existingError } = await auth.supabase
          .from("training_employee_courses")
          .select("employee_id,completion_date,planned_date,manual_state")
          .eq("course_id", courseId)
          .in("employee_id", chunk);
        if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
        existing.push(...((data ?? []) as typeof existing));
      }

      const completedIds = new Set<number>();
      (existing ?? []).forEach((row) => {
        const r = row as {
          employee_id: number;
          completion_date: string | null;
          planned_date: string | null;
          manual_state: string | null;
        };
        if (r.completion_date) completedIds.add(r.employee_id);
      });

      if (dryRun) {
        return NextResponse.json({ ok: true, completed: completedIds.size, upserts: employeeIds.length - completedIds.size });
      }

      const toWrite = employeeIds.filter((id) => !completedIds.has(id));
      if (toWrite.length === 0) {
        return NextResponse.json({ ok: true, processed: 0, skipped: employeeIds.length });
      }

      await clearCourseExclusions({ supabase: auth.supabase, employeeIds: toWrite, courseId });

      for (const chunk of chunkArray(toWrite, 500)) {
        const { error: chunkError } = await auth.supabase.from("training_employee_courses").upsert(
          chunk.map((employeeId) => ({
            employee_id: employeeId,
            course_id: courseId,
            completion_date: null,
            expiry_date: null,
            planned_date: null,
            manual_state: null,
            updated_by: auth.userId,
            note,
          })),
          { onConflict: "employee_id,course_id" },
        );
        if (chunkError) return NextResponse.json({ error: chunkError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, processed: toWrite.length, skipped: completedIds.size });
    }

    if (type === "MODIFICA_DATA") {
      const expiryDate = computeExpiryFromCompletion(dateIso!, course as { validity_years: number | null; is_unlimited: boolean });
      const existing: Array<{
        employee_id: number;
        completion_date: string | null;
        planned_date: string | null;
        manual_state: string | null;
      }> = [];
      for (const chunk of chunkArray(employeeIds, 500)) {
        const { data, error: existingError } = await auth.supabase
          .from("training_employee_courses")
          .select("employee_id,completion_date,planned_date,manual_state")
          .eq("course_id", courseId)
          .in("employee_id", chunk);
        if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
        existing.push(...((data ?? []) as typeof existing));
      }

      const existingByEmployee = new Map<number, (typeof existing)[number]>();
      (existing ?? []).forEach((r) => existingByEmployee.set(r.employee_id, r));

      const toUpdatePlanned = employeeIds.filter((id) => {
        const r = existingByEmployee.get(id);
        if (!r) return false;
        return r.manual_state === "programmato" || Boolean(r.planned_date);
      });
      const toUpdatePlannedSet = new Set<number>(toUpdatePlanned);
      const toUpsertDone = employeeIds.filter((id) => !toUpdatePlannedSet.has(id));

      if (dryRun) {
        return NextResponse.json({ ok: true, updatedPlanned: toUpdatePlanned.length, upsertsDone: toUpsertDone.length });
      }

      await clearCourseExclusions({ supabase: auth.supabase, employeeIds, courseId });

      if (toUpdatePlanned.length > 0) {
        const payload: Record<string, unknown> = {
          planned_date: dateIso,
          manual_state: "programmato" as const,
          updated_by: auth.userId,
        };
        if (note !== null) payload.note = note;

        for (const chunk of chunkArray(toUpdatePlanned, 500)) {
          const { error: updateError } = await auth.supabase
            .from("training_employee_courses")
            .update(payload)
            .in("employee_id", chunk)
            .eq("course_id", courseId);
          if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      }

      if (toUpsertDone.length > 0) {
        for (const chunk of chunkArray(toUpsertDone, 500)) {
          const { error: writeError } = await auth.supabase
            .from("training_employee_courses")
            .upsert(
              chunk.map((employeeId) => ({
                employee_id: employeeId,
                course_id: courseId,
                completion_date: dateIso,
                expiry_date: expiryDate,
                planned_date: null,
                manual_state: null,
                updated_by: auth.userId,
                note,
              })),
              { onConflict: "employee_id,course_id" },
            );
          if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 });
        }
      }

      return NextResponse.json({ ok: true, processed: employeeIds.length, skipped: 0 });
    }

    const expiryDate = dateIso ? computeExpiryFromCompletion(dateIso, course as { validity_years: number | null; is_unlimited: boolean }) : null;
    if (!dryRun) {
      await clearCourseExclusions({ supabase: auth.supabase, employeeIds, courseId });
    }
    for (const chunk of chunkArray(employeeIds, 500)) {
      const { error: writeError } = await auth.supabase
        .from("training_employee_courses")
        .upsert(
          chunk.map((employeeId) => ({
            employee_id: employeeId,
            course_id: courseId,
            completion_date: dateIso,
            expiry_date: expiryDate,
            planned_date: null,
            manual_state: null,
            updated_by: auth.userId,
            note,
          })),
          { onConflict: "employee_id,course_id" },
        );
      if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, processed: employeeIds.length, skipped: 0 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore salvataggio evento." },
      { status: 500 },
    );
  }
}
