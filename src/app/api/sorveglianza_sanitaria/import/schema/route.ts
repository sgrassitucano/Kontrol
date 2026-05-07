import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { analyzeMedicalSurveillanceImportFile } from "@/lib/import/sorveglianza";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const schema = analyzeMedicalSurveillanceImportFile(buffer);

    return NextResponse.json(schema);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore analisi file." },
      { status: 500 },
    );
  }
}

