import { NextResponse } from "next/server";
import { requireAnyModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50000;
const MAX_LIMIT = 100000;

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

function parseOffsetParam(value: string | null) {
  if (!value) return 0;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

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

    const limit = parseLimitParam(url.searchParams.get("limit"));
    const offset = parseOffsetParam(url.searchParams.get("offset"));

    const { data, error } = await auth.supabase
      .from("import_run_errors")
      .select("row_number,matricola,tax_code,last_name,first_name,error_type,error_message")
      .eq("import_run_id", importRunId)
      .order("id", { ascending: true })
      .range(offset, offset + limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const raw = (data ?? []) as Array<{
      row_number: number;
      matricola: string | null;
      tax_code: string | null;
      last_name: string | null;
      first_name: string | null;
      error_type: string;
      error_message: string;
    }>;
    const truncated = raw.length > limit;
    const rows = raw.slice(0, limit);

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
        "X-Limit": String(limit),
        "X-Offset": String(offset),
        "X-Truncated": truncated ? "1" : "0",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore download report." },
      { status: 500 },
    );
  }
}
