import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx-js-style";
import { createClient } from "@supabase/supabase-js";

async function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const content = await readFile(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    process.env[key] = trimmed.slice(separator + 1).trim().replace(/^"|"$/g, "");
  }
}

async function main() {
  await loadLocalEnv();
  const wb = XLSX.readFile(path.resolve(process.cwd(), "SCAM21042026_111033.xls"));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<(string | number | Date)[]>(ws, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  let headerRow = -1;
  let dipIndex = -1;
  for (let i = 0; i < Math.min(aoa.length, 25); i += 1) {
    const row = aoa[i] ?? [];
    const cells = row.map((v) => String(v ?? "").toLowerCase().trim());
    const idx = cells.findIndex((v) => v === "dip." || v === "dip");
    if (idx >= 0) {
      headerRow = i;
      dipIndex = idx;
      break;
    }
  }

  const legacySet = new Set<string>();
  for (let i = headerRow + 1; i < aoa.length; i += 1) {
    const row = aoa[i] ?? [];
    const matricola = String(row[dipIndex] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (matricola) legacySet.add(matricola);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await supabase
    .from("employees")
    .select("matricola")
    .limit(5000);
  if (error) throw error;

  const dbSet = new Set((data ?? []).map((row) => String(row.matricola ?? "").trim()));
  let intersection = 0;
  for (const item of legacySet) {
    if (dbSet.has(item)) intersection += 1;
  }

  console.log(
    JSON.stringify(
      {
        legacyDistinct: legacySet.size,
        dbDistinct: dbSet.size,
        intersection,
      },
      null,
      2,
    ),
  );
}

void main();
