import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { data, error } = await auth.supabase
      .from("training_plan_drafts")
      .select("id, employee_id, course_id, provider, mode, notes, created_at, employees(matricola, first_name, last_name, sites(display_name), job_title), training_courses(code, title)");
    if (error) throw new Error(error.message);
    return NextResponse.json(data ?? []);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore lettura bozze." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json();
    const rows = Array.isArray(payload) ? payload : [payload];
    
    const draftsToUpsert = [];
    const coursesToSchedule = [];

    for (const row of rows) {
      if (row.planned_date) {
        coursesToSchedule.push({
          employee_id: row.employee_id,
          course_id: row.course_id,
          planned_date: row.planned_date,
          manual_state: "programmato",
        });
      } else {
        draftsToUpsert.push({
          employee_id: row.employee_id,
          course_id: row.course_id,
          provider: row.provider || null,
          mode: row.mode || null,
          notes: row.notes || null,
          created_by: auth.userId,
        });
      }
    }

    const { supabase } = auth;

    // Se ci sono corsi da schedulare, inseriamo in training_employee_courses
    // e cancelliamo eventuali bozze esistenti.
    if (coursesToSchedule.length > 0) {
      for (const item of coursesToSchedule) {
        const { error: upsertErr } = await supabase
          .from("training_employee_courses")
          .upsert({
            employee_id: item.employee_id,
            course_id: item.course_id,
            planned_date: item.planned_date,
            manual_state: item.manual_state,
          }, { onConflict: "employee_id,course_id" });
        if (upsertErr) throw new Error("Errore aggiornamento corso programmato: " + upsertErr.message);

        // Delete any draft
        await supabase
          .from("training_plan_drafts")
          .delete()
          .match({ employee_id: item.employee_id, course_id: item.course_id });
      }
    }

    // Upsert drafts
    if (draftsToUpsert.length > 0) {
      const { error } = await supabase
        .from("training_plan_drafts")
        .upsert(draftsToUpsert, { onConflict: "employee_id,course_id" });
      if (error) throw new Error("Errore salvataggio bozza: " + error.message);
    }

    return NextResponse.json({ success: true, scheduled: coursesToSchedule.length, drafts: draftsToUpsert.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore salvataggio pianificazione." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const { error } = await auth.supabase
      .from("training_plan_drafts")
      .delete()
      .eq(id ? "id" : "created_by", id ? id : auth.userId); // basic delete logic
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore eliminazione bozza." },
      { status: 500 },
    );
  }
}
