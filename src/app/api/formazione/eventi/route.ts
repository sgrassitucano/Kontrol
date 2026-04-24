import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type EventType = "PROGRAMMATO" | "SVOLTO" | "MODIFICA_DATA" | "ANNULLA";

function parseDateIso(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
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

export async function POST(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as {
      employeeId: number;
      courseCode: string;
      type: EventType;
      date?: string;
      note?: string;
    };

    const employeeId = Number(body.employeeId);
    const courseCode = String(body.courseCode ?? "").trim();
    const type = String(body.type ?? "").trim() as EventType;
    const dateIso = parseDateIso(body.date);
    const note = cleanText(body.note);

    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    }
    if (!courseCode) {
      return NextResponse.json({ error: "courseCode obbligatorio." }, { status: 400 });
    }
    if (type !== "PROGRAMMATO" && type !== "SVOLTO" && type !== "MODIFICA_DATA" && type !== "ANNULLA") {
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

    if (type === "ANNULLA") {
      const payload: Record<string, unknown> = {
        planned_date: null,
        manual_state: null,
        updated_by: auth.userId,
      };
      if (note !== null) payload.note = note;

      const { error: updateError } = await auth.supabase
        .from("training_employee_courses")
        .update(payload)
        .eq("employee_id", employeeId)
        .eq("course_id", courseId);
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (type === "PROGRAMMATO") {
      const plannedDate = dateIso;
      const { error: updateError } = await auth.supabase
        .from("training_employee_courses")
        .upsert(
          {
            employee_id: employeeId,
            course_id: courseId,
            planned_date: plannedDate,
            completion_date: null,
            expiry_date: null,
            manual_state: "programmato",
            updated_by: auth.userId,
            note,
          },
          { onConflict: "employee_id,course_id" },
        );
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    const expiryDate = dateIso ? computeExpiryFromCompletion(dateIso, course as { validity_years: number | null; is_unlimited: boolean }) : null;
    const { error: writeError } = await auth.supabase
      .from("training_employee_courses")
      .upsert(
        {
          employee_id: employeeId,
          course_id: courseId,
          completion_date: dateIso,
          expiry_date: expiryDate,
          planned_date: null,
          manual_state: null,
          updated_by: auth.userId,
          note,
        },
        { onConflict: "employee_id,course_id" },
      );
    if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore salvataggio evento." },
      { status: 500 },
    );
  }
}
