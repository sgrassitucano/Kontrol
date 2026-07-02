import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import * as XLSX from "xlsx-js-style";

function formatDDMMYYYY(d: Date) {
  if (isNaN(d.getTime())) return "";
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function formatYYYYMMDD_HHMM(d: Date) {
  return `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}_${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}`;
}

export const runtime = "nodejs";

const HEADERS = [
  "matricola",
  "cognome",
  "nome",
  "mansione",
  "cantiere",
  "sottocantiere",
  "tipo corso",
  "upgrade",
  "data esecuzione",
  "data scadenza",
  "data prevista",
  "note",
  "stato",
  "responsabile",
  "referente",
  "data nascita",
  "luogo nascita",
  "codice fiscale",
  "mail",
  "cellulare",
  "TIPO",
  "id",
  "DATA",
  "LUOGO"
];

export async function POST(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json();
    const rows = Array.isArray(payload) ? payload : [];

    const excelRows = rows.map((r: any) => {
      return {
        "matricola": r.matricola || "",
        "cognome": r.cognome || "",
        "nome": r.nome || "",
        "mansione": r.mansione || "",
        "cantiere": r.cantiere || "",
        "sottocantiere": r.sottocantiere || "",
        "tipo corso": r.corsoCode || "",
        "upgrade": r.upgradeInfo || "",
        "data esecuzione": r.dataConclusione || "",
        "data scadenza": r.dataScadenza || "",
        "data prevista": r.dataPrevista || "",
        "note": r.note || "",
        "stato": r.stato || "",
        "responsabile": r.responsabile || "",
        "referente": r.referente || "",
        "data nascita": "", // Aggiungere se necessario o se recuperabile
        "luogo nascita": "", // Aggiungere se necessario
        "codice fiscale": "", // Aggiungere se necessario
        "mail": "",
        "cellulare": "",
        "TIPO": r.mode || "", // E-learning, Aula
        "id": "", // ID interno non strettamente necessario per l'import
        "DATA": r.planned_date ? formatDDMMYYYY(new Date(r.planned_date)) : "",
        "LUOGO": r.provider || ""
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows, { header: HEADERS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Programmazione");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="caricamento_${formatYYYYMMDD_HHMM(new Date())}.xlsx"`
      }
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore generazione Excel." },
      { status: 500 },
    );
  }
}
