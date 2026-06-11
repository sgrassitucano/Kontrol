import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { parseStrictIsoDateToIso } from "@/lib/it-date";

export const runtime = "nodejs";

type TextFieldPatch = { action: "no_change" | "set" | "clear_value"; value?: string };
type DateFieldPatch = { action: "no_change" | "set" | "clear_value"; value?: string };

const MAX_EMPLOYEE_IDS = 5000;

type Body = {
  employeeIds: number[];
  record?: {
    planned?: { action: "no_change" | "set_true" | "set_false" };
    nextDueDate?: DateFieldPatch;
    provider?: TextFieldPatch;
    limitations?: TextFieldPatch;
    notes?: TextFieldPatch;
  };
  exclusion?: { action: "no_change" | "set_true" | "set_false"; note?: string | null };
  override?: { action: "no_change" | "force_si" | "force_no" | "clear"; note?: string | null };
};

function uniqNumbers(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  input.forEach((v) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return;
    const id = Math.trunc(n);
    if (id <= 0) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function normalizeNullableText(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

function parseIsoDate(value: unknown): string | null {
  return parseStrictIsoDateToIso(String(value ?? ""));
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("sorveglianza", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as Body;
    const employeeIds = uniqNumbers(body.employeeIds);
    if (employeeIds.length === 0) {
      return NextResponse.json({ error: "Nessun lavoratore selezionato." }, { status: 400 });
    }
    if (employeeIds.length > MAX_EMPLOYEE_IDS) {
      return NextResponse.json(
        { error: `Troppi lavoratori selezionati (>${MAX_EMPLOYEE_IDS}). Riduci la selezione.` },
        { status: 400 },
      );
    }

    const record = body.record ?? {};
    const exclusion = body.exclusion ?? { action: "no_change" as const };
    const override = body.override ?? { action: "no_change" as const };

    const recordHasChanges = Boolean(
      (record.planned && record.planned.action !== "no_change") ||
        (record.nextDueDate && record.nextDueDate.action !== "no_change") ||
        (record.provider && record.provider.action !== "no_change") ||
        (record.limitations && record.limitations.action !== "no_change") ||
        (record.notes && record.notes.action !== "no_change"),
    );

    const tasks: Array<Promise<{ count: number; error: string | null }>> = [];

    if (recordHasChanges) {
      const rowsToUpsert = employeeIds.map((employee_id) => {
        const row: Record<string, unknown> = { employee_id, created_by: auth.userId ?? null };

        if (record.planned?.action === "set_true") row.is_planned = true;
        else if (record.planned?.action === "set_false") row.is_planned = false;

        if (record.nextDueDate?.action === "set") {
          const iso = parseIsoDate(record.nextDueDate.value);
          if (!iso) throw new Error("Data scadenza visita non valida (atteso YYYY-MM-DD).");
          row.next_due_date = iso;
        } else if (record.nextDueDate?.action === "clear_value") {
          row.next_due_date = null;
        }

        if (record.provider?.action === "set") row.provider = normalizeNullableText(record.provider.value);
        else if (record.provider?.action === "clear_value") row.provider = null;

        if (record.limitations?.action === "set") row.limitations = normalizeNullableText(record.limitations.value);
        else if (record.limitations?.action === "clear_value") row.limitations = null;

        if (record.notes?.action === "set") row.notes = normalizeNullableText(record.notes.value);
        else if (record.notes?.action === "clear_value") row.notes = null;

        return row;
      });

      tasks.push(
        (async () => {
          const { error } = await auth.supabase
            .from("medical_surveillance_records")
            .upsert(rowsToUpsert, { onConflict: "employee_id" });
          return { count: rowsToUpsert.length, error: error ? error.message : null };
        })(),
      );
    }

    if (exclusion.action !== "no_change") {
      const is_active = exclusion.action === "set_true";
      const note = normalizeNullableText(exclusion.note);
      const rowsToUpsert = employeeIds.map((employee_id) => ({
        employee_id,
        is_active,
        note,
        created_by: auth.userId ?? null,
      }));
      tasks.push(
        (async () => {
          const { error } = await auth.supabase
            .from("medical_surveillance_employee_exclusions")
            .upsert(rowsToUpsert, { onConflict: "employee_id" });
          return { count: rowsToUpsert.length, error: error ? error.message : null };
        })(),
      );
    }

    if (override.action !== "no_change") {
      const is_active = override.action !== "clear";
      const requires_visit =
        override.action === "force_no" ? false : true;
      const note = normalizeNullableText(override.note);
      const rowsToUpsert = employeeIds.map((employee_id) => ({
        employee_id,
        is_active,
        requires_visit,
        note,
        created_by: auth.userId ?? null,
      }));
      tasks.push(
        (async () => {
          const { error } = await auth.supabase
            .from("medical_surveillance_employee_overrides")
            .upsert(rowsToUpsert, { onConflict: "employee_id" });
          return { count: rowsToUpsert.length, error: error ? error.message : null };
        })(),
      );
    }

    if (tasks.length === 0) {
      return NextResponse.json({ error: "Nessuna modifica selezionata." }, { status: 400 });
    }

    const results = await Promise.all(tasks);
    const firstError = results.find((r) => r.error)?.error ?? null;
    if (firstError) return NextResponse.json({ error: firstError }, { status: 500 });

    return NextResponse.json({
      ok: true,
      employees: employeeIds.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore evento sorveglianza." },
      { status: 500 },
    );
  }
}
