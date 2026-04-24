import fs from "node:fs/promises";
import path from "node:path";
import { normalizeJobCode } from "@/lib/training/normalize";

export type MansioneCatalogItem = {
  key: string;
  code: string;
  description: string;
};

export async function readMansioniCsv(): Promise<MansioneCatalogItem[]> {
  const filePath = path.join(process.cwd(), "mansioni.csv");
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];

  const rows: MansioneCatalogItem[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";");
    const code = String(parts[0] ?? "").trim();
    const description = String(parts[1] ?? "").trim();
    if (!code) continue;
    rows.push({
      key: normalizeJobCode(code),
      code,
      description,
    });
  }

  return rows;
}
