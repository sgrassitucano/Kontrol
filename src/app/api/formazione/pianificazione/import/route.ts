import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import {
  extractProgrammatoRows,
  resolveProgrammatoRows,
  commitProgrammatoRows,
} from "@/lib/import/pianificazione-massiva";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "").trim();
    const file = formData.get("file");

    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json({ error: "Modalità import non valida." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const rawRows = extractProgrammatoRows(buffer);

    if (rawRows.length === 0) {
      return NextResponse.json({
        mode,
        totalRows: 0,
        rows: [],
        message: "Nessuna riga con stato=\"programmato\" e data prevista compilata trovata nel file.",
      });
    }

    const resolvedRows = await resolveProgrammatoRows(auth.supabase, rawRows);

    if (mode === "preview") {
      return NextResponse.json({
        mode,
        totalRows: resolvedRows.length,
        validRows: resolvedRows.filter((r) => r.warnings.length === 0).length,
        rows: resolvedRows,
      });
    }

    const { applied, skipped } = await commitProgrammatoRows(auth.supabase, resolvedRows);

    return NextResponse.json({
      mode,
      totalRows: resolvedRows.length,
      applied,
      skipped,
      rows: resolvedRows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore import pianificazione massiva." },
      { status: 500 },
    );
  }
}
