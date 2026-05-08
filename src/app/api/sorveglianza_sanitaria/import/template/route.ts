import { NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { requireModuleAccess } from "@/lib/api/access";
import { applyCalibri10WithBoldHeader } from "@/lib/excel";

type XlsxWriteOptionsWithStyles = XLSX.WritingOptions & { cellStyles?: boolean };

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireModuleAccess("sorveglianza", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const headers: string[] = [
    "matricola",
    "codice fiscale",
    "cognome",
    "nome",
    "provider",
    "visita si/no",
    "scadenza visita",
    "limitazioni",
    "note",
  ];

  const workbook = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, Array.from({ length: headers.length }, () => "")]);
  applyCalibri10WithBoldHeader(ws);
  XLSX.utils.book_append_sheet(workbook, ws, "Import");

  const out = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true } as XlsxWriteOptionsWithStyles) as ArrayBuffer;
  const filename = "import_sorveglianza_template.xlsx";

  return new NextResponse(out, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
