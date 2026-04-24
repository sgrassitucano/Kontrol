import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAnyOperationalAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAnyOperationalAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const source = String(url.searchParams.get("source") ?? "").trim();
    if (!source) {
      return NextResponse.json({ error: "source obbligatorio." }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("import_runs")
      .select("id,source,file_name,status,created_at,imported_by")
      .eq("source", source)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const run = (data ?? [])[0] as
      | {
          id: string;
          source: string;
          file_name: string;
          status: string;
          created_at: string;
          imported_by: string | null;
        }
      | undefined;

    let importedByName: string | null = null;
    if (run?.imported_by) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name,email")
        .eq("id", run.imported_by)
        .maybeSingle();
      importedByName = (profile as { full_name?: string | null; email?: string | null } | null)?.full_name?.trim() || (profile as { email?: string | null } | null)?.email?.trim() || null;
    }

    return NextResponse.json({
      run: run
        ? {
            id: run.id,
            source: run.source,
            fileName: run.file_name,
            status: run.status,
            createdAt: run.created_at,
            importedByName,
          }
        : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento ultimo import." },
      { status: 500 },
    );
  }
}

