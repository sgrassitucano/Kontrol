import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireModuleAccess("formazione", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const courseId = url.searchParams.get("course_id");

    if (!courseId) {
      return NextResponse.json({ error: "Parametro course_id mancante" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("training_course_hours")
      .select("id, hours_elearning, hours_fad_sincrona, hours_aula")
      .eq("course_id", parseInt(courseId, 10))
      .single();

    if (error && error.code !== "PGRST116") throw new Error(error.message);

    return NextResponse.json(data || {});
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore lettura ore corso" },
      { status: 500 },
    );
  }
}
