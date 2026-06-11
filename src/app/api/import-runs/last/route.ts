import { NextResponse } from "next/server";
import { requireAnyModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAnyModuleAccess(["gestione", "formazione", "sorveglianza"], false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const source = String(url.searchParams.get("source") ?? "").trim();
    if (!source) {
      return NextResponse.json({ error: "source obbligatorio." }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("import_runs")
      .select("id,source,file_name,status,created_at,imported_by,total_rows,processed_rows,error_rows")
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
          total_rows: number;
          processed_rows: number;
          error_rows: number;
        }
      | undefined;

    let importedByName: string | null = null;
    if (run?.imported_by) {
      const { data: canSeeProfiles, error: canSeeProfilesError } = await auth.supabase.rpc("has_module_access", {
        target_module: "gestione",
        require_write: false,
      });
      if (!canSeeProfilesError && canSeeProfiles) {
        const { data: profile } = await auth.supabase
          .from("profiles")
          .select("full_name,email")
          .eq("id", run.imported_by)
          .maybeSingle();
        importedByName =
          (profile as { full_name?: string | null; email?: string | null } | null)?.full_name?.trim() ||
          null;
      }
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
            totalRows: run.total_rows,
            processedRows: run.processed_rows,
            errorRows: run.error_rows,
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
