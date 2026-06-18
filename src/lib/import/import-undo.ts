import type { SupabaseClient } from "@supabase/supabase-js";

export type ImportRunRow = {
  id: string;
  source: string;
  created_at: string;
};

export type ImportRunChangeRow = {
  id: number;
  table_name: string;
  action: "insert" | "update";
  row_key: Record<string, unknown>;
  before_row: Record<string, unknown> | null;
  after_row: Record<string, unknown> | null;
};

const MAX_IMPORT_RUN_CHANGES = 50000;

export class MissingImportUndoArchiveError extends Error {}
export class ImportUndoLimitError extends Error {
  status = 400;
}

export async function fetchLatestUndoableImportRun(params: {
  supabase: SupabaseClient;
  sources: string[];
}): Promise<ImportRunRow | null> {
  const { supabase, sources } = params;
  if (sources.length === 0) return null;

  const MAX_CANDIDATES = 50;
  const { data, error } = await supabase
    .from("import_runs")
    .select("id,source,created_at")
    .in("source", sources)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(MAX_CANDIDATES);
  if (error) throw new Error(error.message);
  const runs = (data ?? []) as ImportRunRow[];
  if (runs.length === 0) return null;

  const runIds = runs.map((r) => r.id);
  const { data: undos, error: undosError } = await supabase
    .from("import_run_undos")
    .select("import_run_id")
    .in("import_run_id", runIds);
  if (undosError) throw new Error(undosError.message);
  const undoneSet = new Set(((undos ?? []) as Array<{ import_run_id: string }>).map((u) => u.import_run_id));

  for (const run of runs) {
    if (!undoneSet.has(run.id)) return run;
  }
  return null;
}

export async function fetchImportRunChanges(params: {
  supabase: SupabaseClient;
  importRunId: string;
  tableName: string;
}): Promise<ImportRunChangeRow[]> {
  const { supabase, importRunId, tableName } = params;
  const { data, error } = await supabase
    .from("import_run_changes")
    .select("id,table_name,action,row_key,before_row,after_row")
    .eq("import_run_id", importRunId)
    .eq("table_name", tableName)
    .order("id", { ascending: false })
    .limit(MAX_IMPORT_RUN_CHANGES + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ImportRunChangeRow[];
  if (rows.length > MAX_IMPORT_RUN_CHANGES) {
    throw new ImportUndoLimitError(
      `Undo import troppo grande (> ${MAX_IMPORT_RUN_CHANGES} righe). Restringi o spezza la run prima di annullarla.`,
    );
  }
  return rows;
}

export async function markImportRunUndone(params: {
  supabase: SupabaseClient;
  importRunId: string;
  undoneBy: string | null;
}) {
  const { supabase, importRunId, undoneBy } = params;
  const { error } = await supabase.from("import_run_undos").insert({
    import_run_id: importRunId,
    undone_by: undoneBy,
  });
  if (error) throw new Error(error.message);
}

export async function archiveImportUndoDeletedRows(params: {
  supabase: SupabaseClient;
  importRunId: string;
  tableName: string;
  archivedBy: string | null;
  rows: Array<{
    rowKey: Record<string, unknown>;
    rowData: Record<string, unknown>;
  }>;
}) {
  const { supabase, importRunId, tableName, archivedBy, rows } = params;
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    const { error } = await supabase.from("import_undo_deleted_rows").insert(
      part.map((row) => ({
        import_run_id: importRunId,
        table_name: tableName,
        row_key: row.rowKey,
        row_data: row.rowData,
        archived_by: archivedBy,
      })),
    );
    if (!error) continue;
    if (/import_undo_deleted_rows/i.test(String(error.message ?? ""))) {
      throw new MissingImportUndoArchiveError(
        "Archivio undo import non disponibile. Applicare patch DB.",
      );
    }
    throw new Error(error.message);
  }
}

export function pickComparableFields<T extends Record<string, unknown>>(
  value: T | null | undefined,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const v: Record<string, unknown> = (value ?? {}) as Record<string, unknown>;
  fields.forEach((f) => {
    out[f] = v[f];
  });
  return out;
}

export function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}
