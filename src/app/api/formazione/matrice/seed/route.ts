import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireModuleAccess } from "@/lib/api/access";
import { normalizeJobCode } from "@/lib/training/normalize";

export const runtime = "nodejs";

type CourseSeed = {
  code: string;
  title: string;
  validityYears: number | null;
  isUnlimited: boolean;
  rules: string;
};

type JobRow = {
  jobCode: string;
  requirements: string[];
};

export async function POST() {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const coursesCsvPath = path.resolve(process.cwd(), "corsi.csv");
    const jobsCsvPath = path.resolve(process.cwd(), "mansioni.csv");
    const [coursesCsvRaw, jobsCsvRaw] = await Promise.all([
      readFile(coursesCsvPath, "utf8"),
      readFile(jobsCsvPath, "utf8"),
    ]);

    const courseSeeds = parseCoursesCsv(coursesCsvRaw);
    const { rows: jobRows, unmappedLabels } = parseJobsCsv(jobsCsvRaw);

    const { data: upsertedCourses, error: coursesError } = await auth.supabase
      .from("training_courses")
      .upsert(
        courseSeeds.map((course) => ({
          code: course.code,
          title: course.title,
          validity_years: course.validityYears,
          is_unlimited: course.isUnlimited,
          is_active: true,
        })),
        { onConflict: "code" },
      )
      .select("id,code");

    if (coursesError) return NextResponse.json({ error: coursesError.message }, { status: 500 });

    const courseIdByCode = new Map(
      (upsertedCourses ?? []).map((course) => [course.code, course.id] as const),
    );

    const { substitutions, exemptions, prerequisites } = buildRuleLinks(courseSeeds);
    const linksPayload = [
      ...substitutions.map(([fromCode, toCode]) => ({
        from_course_id: courseIdByCode.get(fromCode),
        to_course_id: courseIdByCode.get(toCode),
        relation_type: "substitutes",
      })),
      ...exemptions.map(([fromCode, toCode]) => ({
        from_course_id: courseIdByCode.get(fromCode),
        to_course_id: courseIdByCode.get(toCode),
        relation_type: "exempts",
      })),
      ...prerequisites.map(([fromCode, toCode]) => ({
        from_course_id: courseIdByCode.get(fromCode),
        to_course_id: courseIdByCode.get(toCode),
        relation_type: "prerequisite",
      })),
    ].filter(
      (item): item is { from_course_id: number; to_course_id: number; relation_type: string } =>
        typeof item.from_course_id === "number" && typeof item.to_course_id === "number",
    );

    if (linksPayload.length > 0) {
      const { error: linksError } = await auth.supabase
        .from("training_rule_links")
        .upsert(linksPayload, { onConflict: "from_course_id,to_course_id,relation_type" });
      if (linksError) return NextResponse.json({ error: linksError.message }, { status: 500 });
    }

    const { error: disableError } = await auth.supabase
      .from("training_matrix_rules")
      .update({ is_required: false, source: "baseline" })
      .eq("source", "baseline")
      .in("scope_type", ["baseline", "job"]);
    if (disableError) return NextResponse.json({ error: disableError.message }, { status: 500 });

    const baselinePayload = ["FORM_BASE", "FORM_SPEC_BASSO"]
      .map((code) => {
        const courseId = courseIdByCode.get(code);
        if (!courseId) return null;
        return {
          scope_type: "baseline",
          course_id: courseId,
          is_required: true,
          source: "baseline",
          job_code_norm: null,
          site_id: null,
          sub_site_id: null,
          employee_id: null,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    const missingCourseCodes = new Set<string>();

    const jobRulesPayload = jobRows.flatMap(({ jobCode, requirements }) =>
      requirements
        .map((courseCode) => {
          const courseId = courseIdByCode.get(courseCode);
          if (!courseId) {
            missingCourseCodes.add(courseCode);
            return null;
          }
          return {
            scope_type: "job",
            course_id: courseId,
            is_required: true,
            source: "baseline",
            job_code_norm: normalizeJobCode(jobCode),
            site_id: null,
            sub_site_id: null,
            employee_id: null,
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    );

    if (baselinePayload.length > 0 || jobRulesPayload.length > 0) {
      const { error: rulesError } = await auth.supabase
        .from("training_matrix_rules")
        .upsert([...baselinePayload, ...jobRulesPayload], {
          onConflict: "scope_type,course_id,job_code_norm,site_id,sub_site_id,employee_id",
        });
      if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      seededCourses: courseSeeds.length,
      seededBaselineRules: baselinePayload.length,
      seededJobRules: jobRulesPayload.length,
      missingCourseCodes: Array.from(missingCourseCodes).sort(),
      unmappedLabels: Array.from(unmappedLabels).sort(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore seed matrice." },
      { status: 500 },
    );
  }
}

function parseCoursesCsv(content: string): CourseSeed[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const dataLines = lines.slice(1);

  const rows: CourseSeed[] = [];
  for (const line of dataLines) {
    const columns = line.split(";").map((cell) => cell.trim());
    if (columns.length < 4) continue;
    const originalCode = columns[2];
    const title = columns[3];
    const validityRaw = (columns[4] ?? "").toLowerCase();
    const rules = (columns[5] ?? "").toLowerCase();
    if (!originalCode || !title) continue;

    const code = normalizeCourseCode(originalCode, title);
    const isUnlimited = validityRaw.includes("illimit");
    const validityYears = isUnlimited ? null : parseInt(validityRaw, 10) || 5;

    rows.push({ code, title, validityYears, isUnlimited, rules });
  }

  const unique = new Map<string, CourseSeed>();
  rows.forEach((row) => unique.set(row.code, row));
  return Array.from(unique.values());
}

function parseJobsCsv(content: string): { rows: JobRow[]; unmappedLabels: Set<string> } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const dataLines = lines.slice(1);
  const rows: JobRow[] = [];
  const unmappedLabels = new Set<string>();

  for (const line of dataLines) {
    const columns = line.split(";").map((cell) => cell.trim());
    const jobCode = columns[0];
    if (!jobCode) continue;

    const requirements = new Set<string>();
    for (const rawCell of columns.slice(2)) {
      const mapped = mapRequirementLabelToCodes(rawCell);
      if (mapped.length === 0) {
        const normalized = normalizeText(rawCell);
        if (normalized && !normalized.includes("corso mezzi")) unmappedLabels.add(normalized);
      } else {
        mapped.forEach((code) => requirements.add(code));
      }
    }

    if (requirements.size > 0) {
      rows.push({ jobCode, requirements: Array.from(requirements) });
    }
  }

  return { rows, unmappedLabels };
}

function normalizeCourseCode(code: string, title: string) {
  const normalizedCode = code.toUpperCase().replace(/\s+/g, "");
  if (normalizedCode === "FORM_SPEC") {
    const t = title.toLowerCase();
    if (t.includes("alto")) return "FORM_SPEC_ALTO";
    if (t.includes("medio")) return "FORM_SPEC_MEDIO";
    return "FORM_SPEC_BASSO";
  }
  return normalizedCode;
}

function normalizeText(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mapRequirementLabelToCodes(label: string) {
  const value = normalizeText(label);
  if (!value) return [];
  if (value.includes("corso mezzi")) return [];

  if (value.includes("generale") && value.includes("basso")) return ["FORM_BASE", "FORM_SPEC_BASSO"];
  if (value.includes("generale") && value.includes("medio")) return ["FORM_BASE", "FORM_SPEC_MEDIO"];
  if (value.includes("generale") && value.includes("alto")) return ["FORM_BASE", "FORM_SPEC_ALTO"];

  if (value.includes("antincendio") && value.includes("3")) return ["CORSO_AI_3"];
  if (value.includes("antincendio") && value.includes("ii")) return ["CORSO_AI_2"];
  if (value.includes("antincendio") && value.includes("2")) return ["CORSO_AI_2"];
  if (value.includes("antincendio") && value.includes("i")) return ["CORSO_AI_1"];
  if (value.includes("antincendio") && value.includes("1")) return ["CORSO_AI_1"];

  if (value.includes("primo soccorso")) return ["CORSO_PS"];
  if (value.includes("muletto")) return ["CORSO_MUL"];
  if (value.includes("attrezzature del verde") || value.includes("attrezzature verde")) return ["CORSO_VERDE"];
  if (value.includes("preposto")) return ["CORSO_PREP"];
  if (value.includes("dirigent") && value.includes("sicurezza")) return ["CORSO_DIR"];
  if (value.includes("forno")) return ["CORSO_FORNO_CREM"];
  if (value.includes("fitosanitar")) return ["CORSO_FITOSAN"];

  const isConfined = value.includes("ambienti confin") || value.includes("spazi confin");
  if (isConfined) return ["CORSO_AMBCON"];

  const mentionsPle = value.includes("ple");
  const mentionsQuota = value.includes("quota") || value.includes("lavri in quota") || value.includes("lavori in quota");
  const mentionsDpi3 = value.includes("dpi 3") || value.includes("dpi iii") || value.includes("iii cat");

  if (mentionsPle && mentionsQuota) return ["CORSO_PLE", "CORSO_QUOTA_DPI"];
  if (mentionsPle) return ["CORSO_PLE"];
  if (mentionsQuota) return ["CORSO_QUOTA_DPI"];
  if (mentionsDpi3) return ["CORSO_DPI3"];

  return [];
}

function buildRuleLinks(courses: CourseSeed[]) {
  const substitutions: Array<[string, string]> = [];
  const exemptions: Array<[string, string]> = [];
  const prerequisites: Array<[string, string]> = [];

  courses.forEach((course) => {
    const rule = course.rules;
    const code = course.code;

    if (!rule) return;

    if (rule.includes("sostituisce il livello i") && code === "CORSO_AI_2") {
      substitutions.push(["CORSO_AI_2", "CORSO_AI_1"]);
    }
    if (rule.includes("sostituisce il livello ii e i") && code === "CORSO_AI_3") {
      substitutions.push(["CORSO_AI_3", "CORSO_AI_2"]);
      substitutions.push(["CORSO_AI_3", "CORSO_AI_1"]);
    }
    if (rule.includes("sostituisce il rischio basso") && code === "FORM_SPEC_MEDIO") {
      substitutions.push(["FORM_SPEC_MEDIO", "FORM_SPEC_BASSO"]);
    }
    if (rule.includes("sostituisce il rischio medio e basso") && code === "FORM_SPEC_ALTO") {
      substitutions.push(["FORM_SPEC_ALTO", "FORM_SPEC_MEDIO"]);
      substitutions.push(["FORM_SPEC_ALTO", "FORM_SPEC_BASSO"]);
    }
    if (rule.includes("esonera dalla formazione generale e specifica")) {
      exemptions.push([code, "FORM_BASE"]);
      exemptions.push([code, "FORM_SPEC_BASSO"]);
      exemptions.push([code, "FORM_SPEC_MEDIO"]);
      exemptions.push([code, "FORM_SPEC_ALTO"]);
    } else if (rule.includes("esonera dalla formazione generale")) {
      exemptions.push([code, "FORM_BASE"]);
    }
    if (rule.includes("deve avere ple + lavori in quota")) {
      prerequisites.push([code, "CORSO_PLE"]);
      prerequisites.push([code, "CORSO_QUOTA_DPI"]);
      if (rule.includes("dpi iii")) {
        prerequisites.push([code, "CORSO_DPI3"]);
      }
    } else if (rule.includes("deve avere lavori in quota")) {
      prerequisites.push([code, "CORSO_QUOTA_DPI"]);
      if (rule.includes("dpi iii")) {
        prerequisites.push([code, "CORSO_DPI3"]);
      }
    }
  });

  return {
    substitutions: dedupePairs(substitutions),
    exemptions: dedupePairs(exemptions),
    prerequisites: dedupePairs(prerequisites),
  };
}

function dedupePairs(values: Array<[string, string]>) {
  const seen = new Set<string>();
  const output: Array<[string, string]> = [];
  values.forEach(([a, b]) => {
    const key = `${a}->${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push([a, b]);
  });
  return output;
}
