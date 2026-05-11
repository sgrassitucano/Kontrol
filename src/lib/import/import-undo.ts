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

export async function fetchLatestUndoableImportRun(params: {
  supabase: SupabaseClient;
  sources: string[];
}): Promise<ImportRunRow | null> {
  const { supabase, sources } = params;
  if (sources.length === 0) return null;

  const { data, error } = await supabase
    .from("import_runs")
    .select("id,source,created_at")
    .in("source", sources)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const run = (data ?? null) as ImportRunRow | null;
  if (!run) return null;

  const { data: undos, error: undosError } = await supabase
    .from("import_run_undos")
    .select("import_run_id")
    .eq("import_run_id", run.id)
    .limit(1);
  if (undosError) throw new Error(undosError.message);
  const isUndone = ((undos ?? []) as Array<{ import_run_id: string }>).length > 0;
  return isUndone ? null : run;
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
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportRunChangeRow[];
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
