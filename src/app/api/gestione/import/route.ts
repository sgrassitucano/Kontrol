import { NextResponse } from "next/server";
import { processAnagraficaImport } from "@/lib/import/anagrafica";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "preview");
    const file = formData.get("file");
    const confirmHighDismissals = String(formData.get("confirmHighDismissals") ?? "") === "1";

    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json(
        { error: "Modalita non valida. Usa preview o commit." },
        { status: 400 },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "File non presente nella richiesta." },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File vuoto." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const supabase = auth.supabase;

    const importedBy = auth.userId;

    const result = await processAnagraficaImport({
      fileBuffer: arrayBuffer,
      fileName: file.name,
      mode,
      supabase,
      importedBy,
      confirmHighDismissals,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Errore imprevisto durante l'import.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
