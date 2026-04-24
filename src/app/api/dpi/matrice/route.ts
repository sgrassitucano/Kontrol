import { NextResponse } from "next/server";
import { readMansioniCsv } from "@/lib/training/mansioni";
import { normalizeJobCode } from "@/lib/training/normalize";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type DpiItemRow = {
  id: number;
  title: string;
  risk_activities: string | null;
  category: string | null;
  control_frequency: string | null;
  control_type: string | null;
  is_active: boolean;
};

type MatrixRuleRow = {
  dpi_id: number;
  job_code_norm: string | null;
  is_required: boolean;
};

function isMissingRelationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /relation .*dpi_/i.test(error.message) && /does not exist/i.test(error.message);
}

export async function GET() {
  const auth = await requireModuleAccess("dpi", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const [mansioni, dpiItemsResult, rulesResult] = await Promise.all([
      readMansioniCsv(),
      supabase
        .from("dpi_items")
        .select("id,title,risk_activities,category,control_frequency,control_type,is_active")
        .eq("is_active", true)
        .order("title", { ascending: true }),
      supabase
        .from("dpi_matrix_rules")
        .select("dpi_id,job_code_norm,is_required")
        .eq("scope_type", "job")
        .order("dpi_id", { ascending: true }),
    ]);

    if (dpiItemsResult.error) throw new Error(dpiItemsResult.error.message);
    if (rulesResult.error) throw new Error(rulesResult.error.message);

    const dpiItems = (dpiItemsResult.data ?? []) as DpiItemRow[];
    const rules = (rulesResult.data ?? []) as MatrixRuleRow[];

    const requiredByJob: Record<string, number[]> = {};
    for (const rule of rules) {
      if (!rule.job_code_norm) continue;
      if (!rule.is_required) continue;
      (requiredByJob[rule.job_code_norm] ??= []).push(rule.dpi_id);
    }

    return NextResponse.json({
      mansioni: mansioni.map((m) => ({
        key: m.key,
        code: m.code,
        description: m.description,
      })),
      dpiItems: dpiItems.map((d) => ({
        id: d.id,
        title: d.title,
        riskActivities: d.risk_activities ?? "",
        category: d.category ?? "",
        controlFrequency: d.control_frequency ?? "",
        controlType: d.control_type ?? "",
      })),
      requiredByJob,
    });
  } catch (err) {
    if (isMissingRelationError(err)) {
      const mansioni = await readMansioniCsv();
      return NextResponse.json({
        mansioni,
        dpiItems: [],
        requiredByJob: {},
        warning: "Tabelle DPI non presenti nel DB. Applica lo schema Supabase per abilitare la matrice DPI.",
      });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento matrice DPI." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("dpi", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      jobCode: string;
      dpiId: number;
      isRequired: boolean;
    };

    const jobCodeNorm = normalizeJobCode(String(body.jobCode ?? ""));
    const dpiId = Number(body.dpiId);
    const isRequired = Boolean(body.isRequired);

    if (!jobCodeNorm) {
      return NextResponse.json({ error: "Mansione mancante." }, { status: 400 });
    }
    if (!Number.isFinite(dpiId)) {
      return NextResponse.json({ error: "DPI non valido." }, { status: 400 });
    }

    if (isRequired) {
      const { error } = await supabase
        .from("dpi_matrix_rules")
        .upsert(
          {
            scope_type: "job",
            dpi_id: dpiId,
            is_required: true,
            source: "manual",
            job_code_norm: jobCodeNorm,
            site_id: null,
            sub_site_id: null,
            employee_id: null,
          },
          { onConflict: "scope_type,dpi_id,job_code_norm,site_id,sub_site_id,employee_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("dpi_matrix_rules")
        .delete()
        .eq("scope_type", "job")
        .eq("dpi_id", dpiId)
        .eq("job_code_norm", jobCodeNorm);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore salvataggio matrice DPI." },
      { status: 500 },
    );
  }
}
