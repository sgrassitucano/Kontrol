import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireModuleAccess("formazione", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { data, error } = await auth.supabase
      .from("training_courses")
      .select("id,code,title")
      .eq("is_active", true)
      .order("code");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      courses: (data ?? []).map((row) => ({
        id: Number((row as { id: number }).id),
        code: String((row as { code: string }).code),
        title: String((row as { title: string }).title),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento corsi." },
      { status: 500 },
    );
  }
}

