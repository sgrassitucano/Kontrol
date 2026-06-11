import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import {
  archiveImportUndoDeletedRows,
  fetchImportRunChanges,
  fetchLatestUndoableImportRun,
  ImportUndoLimitError,
  markImportRunUndone,
  MissingImportUndoArchiveError,
  pickComparableFields,
  shallowEqual,
} from "@/lib/import/import-undo";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireModuleAccess("gestione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const run = await fetchLatestUndoableImportRun({
      supabase: auth.supabase,
      sources: ["sorveglianza", "sorveglianza_pdf"],
    });
    if (!run) {
      return NextResponse.json({ error: "Nessun import annullabile trovato." }, { status: 404 });
    }

    const changes = await fetchImportRunChanges({
      supabase: auth.supabase,
      importRunId: run.id,
      tableName: "medical_surveillance_records",
    });
    if (changes.length === 0) {
      return NextResponse.json({ error: "Nessun dato annullabile trovato per questo import." }, { status: 400 });
    }

    const employeeIds = Array.from(
      new Set(
        changes
          .map((c) => Number(c.row_key.employee_id))
          .filter((v) => Number.isFinite(v) && v > 0),
      ),
    );

    const currentByEmployeeId = new Map<
      number,
      { employee_id: number; requires_visit: boolean; next_due_date: string | null; limitations: string | null; notes: string | null }
    >();
    for (let i = 0; i < employeeIds.length; i += 500) {
      const part = employeeIds.slice(i, i + 500);
      const { data, error } = await auth.supabase
        .from("medical_surveillance_records")
        .select("employee_id,requires_visit,next_due_date,limitations,notes")
        .in("employee_id", part);
      if (error) throw new Error(error.message);
      (data ?? []).forEach((row) => {
        currentByEmployeeId.set(row.employee_id, row);
      });
    }

    const comparableFields = ["requires_visit", "next_due_date", "limitations", "notes"];
    const toDelete: number[] = [];
    const deletedRowArchives: Array<{
      rowKey: Record<string, unknown>;
      rowData: Record<string, unknown>;
    }> = [];
    const toRestore: Array<{
      employee_id: number;
      requires_visit: boolean;
      next_due_date: string | null;
      limitations: string | null;
      notes: string | null;
    }> = [];
    let skippedChanged = 0;

    changes.forEach((change) => {
      const employeeId = Number(change.row_key.employee_id);
      if (!Number.isFinite(employeeId) || employeeId <= 0) return;
      const current = currentByEmployeeId.get(employeeId) ?? null;

      const afterComparable = pickComparableFields(change.after_row, comparableFields);
      const currentComparable = pickComparableFields(current ?? undefined, comparableFields);

      if (change.action === "insert") {
        if (current && shallowEqual(currentComparable, afterComparable)) {
          toDelete.push(employeeId);
          deletedRowArchives.push({
            rowKey: { employee_id: employeeId },
            rowData: {
              employee_id: current.employee_id,
              requires_visit: current.requires_visit,
              next_due_date: current.next_due_date,
              limitations: current.limitations,
              notes: current.notes,
            },
          });
        } else {
          skippedChanged += 1;
        }
        return;
      }

      const before = change.before_row;
      if (!before || !current) {
        skippedChanged += 1;
        return;
      }
      if (!shallowEqual(currentComparable, afterComparable)) {
        skippedChanged += 1;
        return;
      }

      toRestore.push({
        employee_id: employeeId,
        requires_visit: Boolean(before.requires_visit),
        next_due_date: (before.next_due_date as string | null) ?? null,
        limitations: (before.limitations as string | null) ?? null,
        notes: (before.notes as string | null) ?? null,
      });
    });

    await archiveImportUndoDeletedRows({
      supabase: auth.supabase,
      importRunId: run.id,
      tableName: "medical_surveillance_records",
      archivedBy: auth.userId,
      rows: deletedRowArchives,
    });

    for (let i = 0; i < toDelete.length; i += 500) {
      const part = toDelete.slice(i, i + 500);
      const { error } = await auth.supabase.from("medical_surveillance_records").delete().in("employee_id", part);
      if (error) throw new Error(error.message);
    }

    for (let i = 0; i < toRestore.length; i += 500) {
      const part = toRestore.slice(i, i + 500);
      const { error } = await auth.supabase
        .from("medical_surveillance_records")
        .upsert(part, { onConflict: "employee_id" });
      if (error) throw new Error(error.message);
    }

    await markImportRunUndone({ supabase: auth.supabase, importRunId: run.id, undoneBy: auth.userId });

    return NextResponse.json({
      ok: true,
      importRunId: run.id,
      source: run.source,
      deletedRows: toDelete.length,
      restoredRows: toRestore.length,
      skippedRows: skippedChanged,
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
