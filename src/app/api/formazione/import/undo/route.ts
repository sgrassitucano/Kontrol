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
      sources: ["formazione_legacy"],
    });
    if (!run) {
      return NextResponse.json({ error: "Nessun import annullabile trovato." }, { status: 404 });
    }

    const changes = await fetchImportRunChanges({
      supabase: auth.supabase,
      importRunId: run.id,
      tableName: "training_employee_courses",
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

    const currentByKey = new Map<
      string,
      { employee_id: number; course_id: number; completion_date: string | null; expiry_date: string | null }
    >();
    for (let i = 0; i < employeeIds.length; i += 500) {
      const part = employeeIds.slice(i, i + 500);
      const { data, error } = await auth.supabase
        .from("training_employee_courses")
        .select("employee_id,course_id,completion_date,expiry_date")
        .in("employee_id", part);
      if (error) throw new Error(error.message);
      (data ?? []).forEach((row) => {
        currentByKey.set(`${row.employee_id}:${row.course_id}`, row);
      });
    }

    const comparableFields = ["completion_date", "expiry_date"];
    const toDeleteByEmployeeId = new Map<number, number[]>();
    const deletedRowArchives: Array<{
      rowKey: Record<string, unknown>;
      rowData: Record<string, unknown>;
    }> = [];
    const toRestore: Array<{ employee_id: number; course_id: number; completion_date: string | null; expiry_date: string | null }> =
      [];
    let skippedChanged = 0;

    changes.forEach((change) => {
      const employeeId = Number(change.row_key.employee_id);
      const courseId = Number(change.row_key.course_id);
      if (!Number.isFinite(employeeId) || employeeId <= 0) return;
      if (!Number.isFinite(courseId) || courseId <= 0) return;
      const current = currentByKey.get(`${employeeId}:${courseId}`) ?? null;

      const afterComparable = pickComparableFields(change.after_row, comparableFields);
      const currentComparable = pickComparableFields(current ?? undefined, comparableFields);

      if (change.action === "insert") {
        if (current && shallowEqual(currentComparable, afterComparable)) {
          const list = toDeleteByEmployeeId.get(employeeId) ?? [];
          list.push(courseId);
          toDeleteByEmployeeId.set(employeeId, list);
          deletedRowArchives.push({
            rowKey: { employee_id: employeeId, course_id: courseId },
            rowData: {
              employee_id: current.employee_id,
              course_id: current.course_id,
              completion_date: current.completion_date,
              expiry_date: current.expiry_date,
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
        course_id: courseId,
        completion_date: (before.completion_date as string | null) ?? null,
        expiry_date: (before.expiry_date as string | null) ?? null,
      });
    });

    await archiveImportUndoDeletedRows({
      supabase: auth.supabase,
      importRunId: run.id,
      tableName: "training_employee_courses",
      archivedBy: auth.userId,
      rows: deletedRowArchives,
    });

    for (const [employeeId, allCourseIds] of toDeleteByEmployeeId.entries()) {
      for (let i = 0; i < allCourseIds.length; i += 500) {
        const part = allCourseIds.slice(i, i + 500);
        const { error } = await auth.supabase
          .from("training_employee_courses")
          .delete()
          .eq("employee_id", employeeId)
          .in("course_id", part);
        if (error) throw new Error(error.message);
      }
    }

    for (let i = 0; i < toRestore.length; i += 500) {
      const part = toRestore.slice(i, i + 500);
      const { error } = await auth.supabase
        .from("training_employee_courses")
        .upsert(part, { onConflict: "employee_id,course_id" });
      if (error) throw new Error(error.message);
    }

    await markImportRunUndone({ supabase: auth.supabase, importRunId: run.id, undoneBy: auth.userId });

    const deletedRows = Array.from(toDeleteByEmployeeId.values()).reduce((acc, list) => acc + list.length, 0);
    return NextResponse.json({
      ok: true,
      importRunId: run.id,
      source: run.source,
      deletedRows,
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
