import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import * as XLSX from "xlsx-js-style";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File non presente" }, { status: 400 });
    }

    const fileBuffer = await file.arrayBuffer();
    const wb = XLSX.read(fileBuffer);
    const ws = wb.Sheets[wb.SheetNames[0]];

    if (!ws) {
      return NextResponse.json({ error: "Nessun foglio trovato nel file" }, { status: 400 });
    }

    // Get headers (first row)
    const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] as string[];
    if (!headers || headers.length === 0) {
      return NextResponse.json({ error: "File vuoto o senza intestazioni" }, { status: 400 });
    }

    // Get all data rows
    const data = XLSX.utils.sheet_to_json(ws);

    return NextResponse.json({
      fileName: file.name,
      headers,
      totalRows: data.length,
      sampleRows: data.slice(0, 5), // First 5 rows for preview
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore parsing file" },
      { status: 500 },
    );
  }
}
