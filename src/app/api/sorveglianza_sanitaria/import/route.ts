import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { processMedicalSurveillanceImport } from "@/lib/import/sorveglianza";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "").trim() as "preview" | "commit";
    const file = formData.get("file");

    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json({ error: "Modalità import non valida." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const result = await processMedicalSurveillanceImport({
      fileBuffer: buffer,
      mode,
      supabase: auth.supabase,
      importedBy: auth.userId,
    });

    if (mode === "commit") {
      const admin = createSupabaseAdminClient();
      await admin.from("import_runs").insert({
        source: "sorveglianza",
        file_name: file.name,
        imported_by: auth.userId,
        total_rows: result.summary.totalRows,
        processed_rows: result.summary.matchedEmployees,
        error_rows: result.summary.errorRows,
        status: "completed",
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore import." },
      { status: 500 },
    );
  }
}
