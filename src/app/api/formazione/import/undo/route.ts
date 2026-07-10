import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { cacheDelete, cacheDeleteByPrefix } from "@/lib/server-cache";
import {
  fetchLatestUndoableImportRun,
  ImportUndoLimitError,
  MissingImportUndoArchiveError,
} from "@/lib/import/import-undo";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const run = await fetchLatestUndoableImportRun({
      supabase: auth.supabase,
      sources: ["formazione_legacy"],
    });
    if (!run) {
      return NextResponse.json({ error: "Nessun import annullabile trovato." }, { status: 404 });
    }

    const { data, error } = await auth.supabase.rpc("undo_training_legacy_import", {
      import_run_id: run.id,
    });
    if (error) throw new Error(error.message);
    const payload = (data ?? null) as
      | { deletedRows?: number; restoredRows?: number; skippedRows?: number }
      | null;

    cacheDelete("training_scope_exclusions_v1");
    cacheDeleteByPrefix("training_rows_v2:");
    return NextResponse.json({
      ok: true,
      importRunId: run.id,
      source: run.source,
      deletedRows: Number(payload?.deletedRows ?? 0),
      restoredRows: Number(payload?.restoredRows ?? 0),
      skippedRows: Number(payload?.skippedRows ?? 0),
    });
  } catch (err) {
    if (err instanceof MissingImportUndoArchiveError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof ImportUndoLimitError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore annullamento import." },
      { status: 500 },
    );
  }
}
