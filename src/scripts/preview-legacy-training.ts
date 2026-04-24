import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { previewLegacyTrainingImport } from "@/lib/import/training-legacy";

async function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const content = await readFile(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  await loadLocalEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error("Missing Supabase env vars in .env.local.");
  }

  const filePath = path.resolve(
    process.cwd(),
    "SCAM21042026_111033.xls",
  );
  const file = await readFile(filePath);
  const fileBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await previewLegacyTrainingImport({
    fileBuffer,
    supabase,
  });

  const issueByType = result.issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.issueType] = (acc[issue.issueType] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        summary: result.summary,
        issuesTotal: result.issues.length,
        issueByType,
        topCourses: result.courseStats.slice(0, 12),
      },
      null,
      2,
    ),
  );
}

void main();
