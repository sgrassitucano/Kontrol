import { NextResponse } from "next/server";
import { requireAnyModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  const needsQuote = raw.includes('"') || raw.includes(",") || raw.includes("\n") || raw.includes("\r");
  const escaped = raw.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export async function GET(request: Request) {
  const auth = await requireAnyModuleAccess(["gestione", "formazione", "sorveglianza"], false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const importRunId = String(url.searchParams.get("importRunId") ?? "").trim();
    if (!importRunId) {
      return NextResponse.json({ error: "importRunId obbligatorio." }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("import_run_errors")
      .select("row_number,matricola,tax_code,last_name,first_name,error_type,error_message")
      .eq("import_run_id", importRunId)
      .order("id", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as Array<{
      row_number: number;
      matricola: string | null;
      tax_code: string | null;
      last_name: string | null;
      first_name: string | null;
      error_type: string;
      error_message: string;
    }>;

    const header = ["riga", "matricola", "codice_fiscale", "cognome", "nome", "tipo_errore", "messaggio"];
    const lines = [
      header.map(csvEscape).join(","),
      ...rows.map((r) =>
        [
          r.row_number,
          r.matricola ?? "",
          r.tax_code ?? "",
          r.last_name ?? "",
          r.first_name ?? "",
          r.error_type ?? "",
          r.error_message ?? "",
        ]
          .map(csvEscape)
          .join(","),
      ),
    ];

    const csv = `\ufeff${lines.join("\r\n")}\r\n`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-errori-${importRunId}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore download report." },
      { status: 500 },
    );
  }
}

