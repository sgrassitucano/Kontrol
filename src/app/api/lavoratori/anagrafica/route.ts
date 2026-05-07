import { NextResponse } from "next/server";
import { requireAnyOperationalAccess } from "@/lib/api/access";
import type { SupabaseClient } from "@supabase/supabase-js";

type EmployeeListRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
};

type EmployeeRow = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
  responsible_code: string;
  referral: string | null;
  job_title: string;
  sites: unknown;
  sub_sites: unknown;
};

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAnyOperationalAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const employees = await fetchAllEmployees(auth.supabase);

    const rows: EmployeeListRow[] = employees
      .map((employee) => ({
        workerId: employee.id,
        matricola: employee.matricola,
        cognome: employee.last_name,
        nome: employee.first_name,
        mansione: employee.job_title ?? "",
        cantiere: extractDisplayName(employee.sites),
        sottocantiere: extractDisplayName(employee.sub_sites),
        responsabile: employee.responsible_code,
        referente: employee.referral ?? "",
      }))
      .filter((row) => {
        if (!query) return true;
        const searchable = [
          row.matricola,
          row.cognome,
          row.nome,
          row.mansione,
          row.cantiere,
          row.sottocantiere,
          row.responsabile,
          row.referente,
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(query);
      });

    rows.sort((a, b) => a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome));

    return NextResponse.json({
      rows,
      totalRows: rows.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore caricamento lavoratori." },
      { status: 500 },
    );
  }
}

async function fetchAllEmployees(supabase: SupabaseClient) {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: EmployeeRow[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("employees")
      .select(
        "id,matricola,first_name,last_name,responsible_code,referral,job_title,sites(display_name),sub_sites(display_name)",
      )
      .eq("status", "attivo")
      .order("last_name")
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as EmployeeRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return allRows;
}

function extractDisplayName(value: unknown) {
  if (!value) return "-";
  if (Array.isArray(value)) {
    const first = value[0] as { display_name?: string } | undefined;
    return first?.display_name ?? "-";
  }
  if (typeof value === "object") {
    return (value as { display_name?: string }).display_name ?? "-";
  }
  return "-";
}
