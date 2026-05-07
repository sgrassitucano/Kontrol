import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { processMedicalSurveillanceImport, seedProvidersFromMedicalSurveillanceImportFile } from "@/lib/import/sorveglianza";
import type { SurveillanceImportColumnMapping } from "@/lib/import/sorveglianza";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "").trim() as "preview" | "commit";
    const file = formData.get("file");
    const mappingRaw = formData.get("mapping");

    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json({ error: "Modalità import non valida." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante." }, { status: 400 });
    }

    let mapping: unknown = undefined;
    if (typeof mappingRaw === "string" && mappingRaw.trim()) {
      try {
        mapping = JSON.parse(mappingRaw);
      } catch {
        return NextResponse.json({ error: "Mapping colonne non valido (JSON)." }, { status: 400 });
      }
    }

    const mappingObj = typeof mapping === "object" && mapping ? (mapping as Record<string, unknown>) : null;
    const mappingTyped: SurveillanceImportColumnMapping | undefined = mappingObj
      ? (["matricola", "taxCode", "lastName", "firstName", "provider", "visitFlag", "dueDate", "limitations", "notes"]
          .map((k) => [k, mappingObj[k]] as const)
          .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
          .reduce((acc, [k, v]) => {
            (acc as Record<string, string>)[k] = String(v);
            return acc;
          }, {} as SurveillanceImportColumnMapping))
      : undefined;

    const buffer = await file.arrayBuffer();
    const result = await processMedicalSurveillanceImport({
      fileBuffer: buffer,
      mode,
      supabase: auth.supabase,
      importedBy: auth.userId,
      mapping: mappingTyped,
    });

    if (mode === "commit") {
      try {
        const seeded = await seedProvidersFromMedicalSurveillanceImportFile({
          fileBuffer: buffer,
          supabase: auth.supabase,
          importedBy: auth.userId,
          mapping: mappingTyped,
        });
        if (seeded.seeded > 0) {
          result.message = `${result.message} Provider: aggiornate ${seeded.seeded} assegnazioni.`;
        } else {
          result.message = `${result.message} Provider: nessuna assegnazione aggiornata (campo provider vuoto o match anagrafica mancante).`;
        }
      } catch {
        result.message = `${result.message} Provider: seed fallito.`;
      }
      await auth.supabase.from("import_runs").insert({
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
