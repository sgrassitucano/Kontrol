import { NextResponse } from "next/server";
import { commitLegacyTrainingImport, previewLegacyTrainingImport } from "@/lib/import/training-legacy";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let importRunId: string | null = null;
  try {
    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "preview");
    const file = formData.get("file");

    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json(
        { error: "Modalità non valida. Deve essere 'preview' o 'commit'." },
        { status: 400 },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File non presente nella richiesta." }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File vuoto." }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith(".xls") || fileName.endsWith(".xlsx");
    if (!isExcel) {
      return NextResponse.json(
        { error: "Formato non supportato. Carica un file .xls o .xlsx." },
        { status: 400 },
      );
    }

    const fileBuffer = await file.arrayBuffer();
    const supabase = auth.supabase;
    if (mode === "commit") {
      const inserted = await auth.supabase
        .from("import_runs")
        .insert({
          source: "formazione_legacy",
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

    const result = await (mode === "commit"
      ? commitLegacyTrainingImport({ fileBuffer, supabase, importRunId, importedBy: auth.userId })
      : previewLegacyTrainingImport({ fileBuffer, supabase }));

    if (mode === "commit") {
      const summary = (result as { summary?: unknown }).summary as
        | {
            totalRows?: number;
            committedRows?: number;
            missingEmployees?: number;
            missingCourses?: number;
            missingStartDateRows?: number;
            issueRows?: number;
          }
        | undefined;
      if (importRunId) {
        await auth.supabase
          .from("import_runs")
          .update({
            total_rows: typeof summary?.totalRows === "number" ? summary.totalRows : 0,
            processed_rows: typeof summary?.committedRows === "number" ? summary.committedRows : 0,
            error_rows:
              typeof summary?.issueRows === "number"
                ? summary.issueRows
                : (typeof summary?.missingEmployees === "number" ? summary.missingEmployees : 0) +
                  (typeof summary?.missingCourses === "number" ? summary.missingCourses : 0) +
                  (typeof summary?.missingStartDateRows === "number" ? summary.missingStartDateRows : 0),
            status: "completed",
          })
          .eq("id", importRunId);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    if (importRunId) {
      await auth.supabase
        .from("import_runs")
        .update({ status: "failed" })
        .eq("id", importRunId);
    }
    const message =
      error instanceof Error
        ? error.message
        : "Errore imprevisto durante la preview import formazione.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
