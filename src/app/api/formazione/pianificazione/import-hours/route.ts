import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { supabase } = auth;
    const payload = await request.json();

    if (!Array.isArray(payload) || payload.length === 0) {
      return NextResponse.json({ error: "Payload vuoto o non è array" }, { status: 400 });
    }

    // Fetch all course codes to map codice -> id
    const { data: courses, error: courseError } = await supabase
      .from("training_courses")
      .select("id, code");
    if (courseError) throw new Error(courseError.message);

    const codeMap = new Map(courses?.map(c => [c.code, c.id]) || []);

    // Prepare rows for upsert
    const rows = payload
      .map((row: any) => {
        const courseId = codeMap.get(row.codice);
        if (!courseId) {
          console.warn(`Course not found for code: ${row.codice}`);
          return null;
        }

        return {
          course_id: courseId,
          hours_elearning: row["ore e-learning"] || 0,
          hours_fad_sincrona: row["ore aula/FAD"] || 0,
          hours_aula: row["ore aula/FAD"] || 0, // Unified column
        };
      })
      .filter(Boolean);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Nessun corso mappabile trovato" }, { status: 400 });
    }

    // Upsert all rows
    const { error: upsertError } = await supabase
      .from("training_course_hours")
      .upsert(rows, { onConflict: "course_id" });

    if (upsertError) throw new Error(upsertError.message);

    return NextResponse.json({
      success: true,
      imported: rows.length,
      message: `${rows.length} corsi importati con successo`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore importazione ore" },
      { status: 500 },
    );
  }
}
