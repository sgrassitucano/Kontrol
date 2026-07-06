import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import * as XLSX from "xlsx-js-style";

export const runtime = "nodejs";

type ColumnMapping = Record<string, string | null>;

type ValidationError = {
  field: string;
  message: string;
};

function normalizeDate(value: any, format: string): string | null {
  if (!value) return null;

  // If it's already a Date object from Excel
  if (value instanceof Date) {
    const d = value;
    return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()}`;
  }

  // If it's a string, try to parse
  if (typeof value === "string") {
    value = value.trim();
    // Try DD/MM/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
    // Try YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-");
      return `${d}/${m}/${y}`;
    }
  }

  return null;
}

function validateRow(row: Record<string, any>, mapping: ColumnMapping, employees: Set<string>) {
  const errors: ValidationError[] = [];
  const normalized: Record<string, any> = {};

  // Matricola (required)
  const matricolaCol = Object.keys(mapping).find((k) => mapping[k] === "matricola");
  const matricola = matricolaCol ? row[matricolaCol] : null;
  if (!matricola) {
    errors.push({ field: "matricola", message: "Obbligatoria" });
  } else if (!employees.has(String(matricola))) {
    errors.push({ field: "matricola", message: "Non trovata in anagrafica" });
  } else {
    normalized.matricola = String(matricola).trim();
  }

  // Cognome (required)
  const cognomeCol = Object.keys(mapping).find((k) => mapping[k] === "cognome");
  const cognome = cognomeCol ? row[cognomeCol] : null;
  normalized.cognome = cognome ? String(cognome).trim().toUpperCase() : "";
  if (!normalized.cognome) {
    errors.push({ field: "cognome", message: "Obbligatorio" });
  }

  // Nome (required)
  const nomeCol = Object.keys(mapping).find((k) => mapping[k] === "nome");
  const nome = nomeCol ? row[nomeCol] : null;
  normalized.nome = nome ? String(nome).trim().toUpperCase() : "";
  if (!normalized.nome) {
    errors.push({ field: "nome", message: "Obbligatorio" });
  }

  // Date fields
  const dataNascitaCol = Object.keys(mapping).find((k) => mapping[k] === "data_nascita");
  if (dataNascitaCol) {
    const dataNascita = normalizeDate(row[dataNascitaCol], "DD/MM/YYYY");
    if (row[dataNascitaCol] && !dataNascita) {
      errors.push({ field: "data_nascita", message: "Formato non riconosciuto (usa DD/MM/YYYY)" });
    }
    normalized.data_nascita = dataNascita;
  }

  const dataVisitaCol = Object.keys(mapping).find((k) => mapping[k] === "data_visita");
  if (dataVisitaCol) {
    const dataVisita = normalizeDate(row[dataVisitaCol], "DD/MM/YYYY");
    if (row[dataVisitaCol] && !dataVisita) {
      errors.push({ field: "data_visita", message: "Formato non riconosciuto (usa DD/MM/YYYY)" });
    }
    normalized.data_visita = dataVisita;
  }

  const scadenzaVisitaCol = Object.keys(mapping).find((k) => mapping[k] === "scadenza_visita");
  if (scadenzaVisitaCol) {
    const scadenzaVisita = normalizeDate(row[scadenzaVisitaCol], "DD/MM/YYYY");
    if (row[scadenzaVisitaCol] && !scadenzaVisita) {
      errors.push({ field: "scadenza_visita", message: "Formato non riconosciuto (usa DD/MM/YYYY)" });
    }
    normalized.scadenza_visita = scadenzaVisita;
  }

  // Visita richiesta (SI/NO)
  const visitaRichiestaCol = Object.keys(mapping).find((k) => mapping[k] === "visita_richiesta");
  if (visitaRichiestaCol) {
    const val = String(row[visitaRichiestaCol]).trim().toUpperCase();
    if (val && !["SI", "NO", "SÌ"].includes(val)) {
      errors.push({ field: "visita_richiesta", message: "Deve essere SI o NO" });
    }
    normalized.visita_richiesta = ["SI", "SÌ"].includes(val) ? "SI" : val === "NO" ? "NO" : null;
  }

  // Optional text fields
  const codFiscCol = Object.keys(mapping).find((k) => mapping[k] === "codice_fiscale");
  normalized.codice_fiscale = codFiscCol ? String(row[codFiscCol]).trim().toUpperCase() : null;

  const limitazioniCol = Object.keys(mapping).find((k) => mapping[k] === "limitazioni");
  normalized.limitazioni = limitazioniCol ? String(row[limitazioniCol]).trim() : null;

  const noteCol = Object.keys(mapping).find((k) => mapping[k] === "note");
  normalized.note = noteCol ? String(row[noteCol]).trim() : null;

  return { normalized, errors };
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const { fileBuffer, mapping } = body as {
      fileBuffer: string; // base64
      mapping: ColumnMapping;
    };

    if (!fileBuffer || !mapping) {
      return NextResponse.json(
        { error: "fileBuffer e mapping richiesti" },
        { status: 400 },
      );
    }

    // Decode base64
    const buffer = Buffer.from(fileBuffer, "base64");
    const wb = XLSX.read(buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws);

    // Fetch all employees for validation
    const { data: employees } = await auth.supabase
      .from("employees")
      .select("matricola");

    const employeeSet = new Set((employees || []).map((e: any) => String(e.matricola)));

    // Validate all rows
    const validatedRows = data.map((row, idx) => {
      const { normalized, errors } = validateRow(row, mapping, employeeSet);
      return {
        row_number: idx + 2, // +2 because Excel has header + 1-based indexing
        source_data: row,
        normalized_data: normalized,
        validation_errors: errors,
        is_valid: errors.length === 0,
      };
    });

    const validCount = validatedRows.filter((r) => r.is_valid).length;
    const errorCount = validatedRows.filter((r) => !r.is_valid).length;

    return NextResponse.json({
      totalRows: validatedRows.length,
      validRows: validCount,
      errorRows: errorCount,
      validatedRows: validatedRows.slice(0, 50), // First 50 for preview
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore validazione" },
      { status: 500 },
    );
  }
}
