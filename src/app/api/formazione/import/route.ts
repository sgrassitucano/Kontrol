import { NextResponse } from "next/server";
import { commitLegacyTrainingImport, previewLegacyTrainingImport } from "@/lib/import/training-legacy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
    const supabase = createSupabaseAdminClient();
    const result =
      mode === "commit"
        ? await commitLegacyTrainingImport({
            fileBuffer,
            supabase,
          })
        : await previewLegacyTrainingImport({
            fileBuffer,
            supabase,
          });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Errore imprevisto durante la preview import formazione.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
