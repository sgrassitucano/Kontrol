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

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const MAX_EMPLOYEES = 20000;

class TooManyRowsError extends Error {
  status = 400;
}

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

function parseOffsetParam(value: string | null) {
  if (!value) return 0;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export async function GET(request: Request) {
  const auth = await requireAnyOperationalAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const limit = parseLimitParam(url.searchParams.get("limit"), query ? 200 : DEFAULT_LIMIT);
    const offset = parseOffsetParam(url.searchParams.get("offset"));
    const employees = await fetchAllEmployees(auth.supabase);

    const filteredRows: EmployeeListRow[] = employees
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

    filteredRows.sort((a, b) => a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome));
    const totalRows = filteredRows.length;
    const rows = filteredRows.slice(offset, offset + limit);
    const truncated = offset + limit < totalRows;

    return NextResponse.json({
      limit,
      offset,
      truncated,
      rows,
      totalRows,
    });
  } catch (error) {
    if (error instanceof TooManyRowsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
    if (allRows.length > MAX_EMPLOYEES) {
      throw new TooManyRowsError(
        `Troppi lavoratori per anagrafica (> ${MAX_EMPLOYEES}). Restringi il dataset o applica filtri.`,
      );
    }

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
