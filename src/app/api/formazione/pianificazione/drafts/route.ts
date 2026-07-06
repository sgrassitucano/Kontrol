import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireModuleAccess("formazione", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { data, error } = await auth.supabase
      .from("training_plan_drafts")
      .select("id, employee_id, course_id, course_type, fornitore, location, date1, time1_start, date2, time2_start, notes, created_at, employees(matricola, first_name, last_name, sites(display_name), job_title), training_courses(code, title)");
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
      const draftData = {
        employee_id: row.employee_id,
        course_id: row.course_id,
        course_type: row.course_type || null,
        fornitore: row.fornitore || null,
        location: row.location || null,
        date1: row.date1 || null,
        time1_start: row.time1_start || null,
        date2: row.date2 || null,
        time2_start: row.time2_start || null,
        notes: row.notes || null,
        created_by: auth.userId,
      };

      // If date1 provided, auto-schedule to "programmato" state
      if (row.date1) {
        coursesToSchedule.push({
          employee_id: row.employee_id,
          course_id: row.course_id,
          planned_date: row.date1,
          manual_state: "programmato",
        });
      } else {
        draftsToUpsert.push(draftData);
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
        const { error: deleteErr } = await supabase
          .from("training_plan_drafts")
          .delete()
          .match({ employee_id: item.employee_id, course_id: item.course_id });
        if (deleteErr) throw new Error("Errore eliminazione bozza: " + deleteErr.message);
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
    const id = url.searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "Parametro id mancante." }, { status: 400 });
    const { error } = await auth.supabase
      .from("training_plan_drafts")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore eliminazione bozza." },
      { status: 500 },
    );
  }
}
