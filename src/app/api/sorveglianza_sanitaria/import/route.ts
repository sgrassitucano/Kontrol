import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { processMedicalSurveillanceImport } from "@/lib/import/sorveglianza";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let importRunId: string | null = null;
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

    if (mode === "commit") {
      const inserted = await auth.supabase
        .from("import_runs")
        .insert({
          source: "sorveglianza",
          file_name: file.name,
          imported_by: auth.userId,
          total_rows: 0,
          processed_rows: 0,
          error_rows: 0,
          status: "preview",
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data?.id) {
        return NextResponse.json(
          { error: "Impossibile creare la traccia import per il rollback." },
          { status: 500 },
        );
      }
      importRunId = inserted.data.id;
    }

    const result = await processMedicalSurveillanceImport({
      fileBuffer: buffer,
      mode,
      supabase: auth.supabase,
      importedBy: auth.userId,
      importRunId,
    });

    if (mode === "commit") {
      if (importRunId) {
        const status = result.message.startsWith("Import fallito:") ? "failed" : "completed";
        await auth.supabase
          .from("import_runs")
          .update({
            total_rows: result.summary.totalRows,
            processed_rows: result.summary.matchedEmployees,
            error_rows: result.summary.errorRows,
            status,
          })
          .eq("id", importRunId);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    if (importRunId) {
      await auth.supabase
        .from("import_runs")
        .update({ status: "failed" })
        .eq("id", importRunId);
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore import." },
      { status: 500 },
    );
  }
}
