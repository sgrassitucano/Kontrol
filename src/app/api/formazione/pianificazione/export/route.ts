import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import * as XLSX from "xlsx-js-style";

function formatDDMMYYYY(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
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
  "FORNITORE",
  "DATA1",
  "ORARIO1",
  "DATA2",
  "ORARIO2",
  "LUOGO"
];

export async function POST(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { supabase } = auth;

    // Fetch all drafts with employee + course info + historical training data
    const { data: drafts, error: draftsError } = await supabase
      .from("training_plan_drafts")
      .select(`
        id,
        employee_id,
        course_id,
        course_type,
        fornitore,
        location,
        date1,
        time1_start,
        date2,
        time2_start,
        notes,
        employees(
          id, matricola, first_name, last_name, job_title,
          date_of_birth, place_of_birth, tax_code, email, phone,
          responsible_code, referral,
          sites(display_name)
        ),
        training_courses(id, code, title)
      `);

    if (draftsError) throw new Error(draftsError.message);
    if (!drafts || drafts.length === 0) {
      return NextResponse.json({ error: "Nessuna bozza da esportare" }, { status: 400 });
    }

    // Fetch historical training data for each employee+course combo
    const employeeCourseIds = drafts.map(d => ({ employee_id: d.employee_id, course_id: d.course_id }));
    const { data: trainingHistory } = await supabase
      .from("training_employee_courses")
      .select("employee_id, course_id, completion_date, expiry_date, planned_date, manual_state, note");

    const historyMap = new Map();
    trainingHistory?.forEach(h => {
      historyMap.set(`${h.employee_id}-${h.course_id}`, h);
    });

    const excelRows = drafts.map((d: any) => {
      const emp = d.employees;
      const course = d.training_courses;
      const history = historyMap.get(`${d.employee_id}-${d.course_id}`);

      return {
        "matricola": emp?.matricola || "",
        "cognome": emp?.last_name || "",
        "nome": emp?.first_name || "",
        "mansione": emp?.job_title || "",
        "cantiere": emp?.sites?.display_name || "",
        "sottocantiere": "",
        "tipo corso": course?.code || "",
        "upgrade": history?.note?.includes("upgrade") ? "Sì" : "",
        "data esecuzione": history?.completion_date ? formatDDMMYYYY(history.completion_date) : "",
        "data scadenza": history?.expiry_date ? formatDDMMYYYY(history.expiry_date) : "",
        "data prevista": d.date1 ? formatDDMMYYYY(d.date1) : "",
        "note": d.notes || "",
        "stato": d.date1 ? "Programmato" : "Bozza",
        "responsabile": emp?.responsible_code || "",
        "referente": emp?.referral || "",
        "data nascita": emp?.date_of_birth ? formatDDMMYYYY(emp.date_of_birth) : "",
        "luogo nascita": emp?.place_of_birth || "",
        "codice fiscale": emp?.tax_code || "",
        "mail": emp?.email || "",
        "cellulare": emp?.phone || "",
        "TIPO": d.course_type || "",
        "FORNITORE": d.fornitore || "",
        "DATA1": d.date1 ? formatDDMMYYYY(d.date1) : "",
        "ORARIO1": d.time1_start || "",
        "DATA2": d.date2 ? formatDDMMYYYY(d.date2) : "",
        "ORARIO2": d.time2_start || "",
        "LUOGO": d.location || ""
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows, { header: HEADERS });

    // Style: blue columns (A-T) with fill 1F4E79, green columns (U-AA) with fill 2E7D32
    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    for (let row = range.s.r; row <= range.e.r; row++) {
      // Blue columns: A-T (0-19)
      for (let col = 0; col <= 19; col++) {
        const cell = XLSX.utils.encode_cell({ r: row, c: col });
        if (worksheet[cell]) {
          worksheet[cell].fill = { fgColor: { rgb: "FF1F4E79" } };
          if (row === 0) worksheet[cell].font = { bold: true, color: { rgb: "FFFFFFFF" } };
        }
      }
      // Green columns: U-AA (20-26)
      for (let col = 20; col <= 26; col++) {
        const cell = XLSX.utils.encode_cell({ r: row, c: col });
        if (worksheet[cell]) {
          worksheet[cell].fill = { fgColor: { rgb: "FF2E7D32" } };
          if (row === 0) worksheet[cell].font = { bold: true, color: { rgb: "FFFFFFFF" } };
        }
      }
    }

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
