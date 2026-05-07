import * as XLSX from "xlsx-js-style";
import fs from "node:fs/promises";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type DpiRow = {
  title: string;
  riskActivities: string;
  category: string;
  controlFrequency: string;
  controlType: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function loadEnvIfMissing() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  const candidates = [".env.local", ".env"];
  for (const fileName of candidates) {
    try {
      const envPath = path.join(process.cwd(), fileName);
      const raw = await fs.readFile(envPath, "utf8");
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const valueRaw = trimmed.slice(idx + 1).trim();
        if (!key) continue;
        if (process.env[key]) continue;
        const value =
          (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
          (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
            ? valueRaw.slice(1, -1)
            : valueRaw;
        process.env[key] = value;
      }
    } catch {
      continue;
    }
  }
}

async function main() {
  await loadEnvIfMissing();

  const filePath = path.join(process.cwd(), "dpi.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("File dpi.xlsx senza fogli.");
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Array<Record<string, unknown>>;

  const mapped: DpiRow[] = rows
    .map((r) => ({
      title: normalizeText(r["Tipo DPI"]),
      riskActivities: normalizeText(r["Rischi/Attività"]),
      category: normalizeText(r["Cat."]),
      controlFrequency: normalizeText(r["Controllo Obbligatorio"]),
      controlType: normalizeText(r["Tipo di Controllo"]),
    }))
    .filter((r) => r.title.length > 0);

  if (mapped.length === 0) {
    throw new Error("Nessuna riga valida trovata in dpi.xlsx (colonna 'Tipo DPI').");
  }

  const supabase = createSupabaseAdminClient();

  const payload = mapped.map((r) => ({
    title: r.title,
    risk_activities: r.riskActivities || null,
    category: r.category || null,
    control_frequency: r.controlFrequency || null,
    control_type: r.controlType || null,
    is_active: true,
  }));

  const { error } = await supabase.from("dpi_items").upsert(payload, { onConflict: "title" });
  if (error) throw new Error(error.message);

  console.log(`Import DPI completato: ${mapped.length} righe.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
