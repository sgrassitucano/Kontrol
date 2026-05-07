import { NextResponse } from "next/server";
import { requireAnyModuleAccess } from "@/lib/api/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx-js-style";

export const runtime = "nodejs";

type EmployeeRow = { id: number; site_id: number; sub_site_id: number | null };
type RecordRow = { employee_id: number; provider: string | null };
type ImportRow = { matricola: string; taxCode: string; provider: string };

export async function POST(request: Request) {
  const auth = await requireAnyModuleAccess(["gestione", "sorveglianza"], true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const admin = createSupabaseAdminClient();
    const file = await readOptionalFile(request);

    const employees = await fetchEmployees(admin);
    const providerByEmployeeId = new Map<number, string>();

    if (file) {
      const buffer = await file.arrayBuffer();
      const parsed = parseImportFile(buffer);
      const lookup = await buildEmployeeLookup(admin, parsed);
      parsed.forEach((row) => {
        const provider = String(row.provider ?? "").trim();
        if (!provider) return;
        const employeeId =
          (row.taxCode ? lookup.byTaxCode.get(row.taxCode) : undefined) ??
          (row.matricola ? lookup.byMatricola.get(row.matricola) : undefined) ??
          null;
        if (!employeeId) return;
        providerByEmployeeId.set(employeeId, provider);
      });
    } else {
      const records = await fetchRecords(admin);
      records.forEach((row) => {
        const value = String(row.provider ?? "").trim();
        if (!value) return;
        providerByEmployeeId.set(row.employee_id, value);
      });
    }

    const providersBySubSiteId = new Map<number, Map<string, number>>();
    const providersBySiteIdNoSub = new Map<number, Map<string, number>>();
    const subSitesBySiteId = new Map<number, Set<number>>();

    employees.forEach((employee) => {
      const provider = providerByEmployeeId.get(employee.id);
      if (!provider) return;

      if (employee.sub_site_id) {
        subSitesBySiteId.set(employee.site_id, (subSitesBySiteId.get(employee.site_id) ?? new Set()).add(employee.sub_site_id));
        const map = providersBySubSiteId.get(employee.sub_site_id) ?? new Map<string, number>();
        map.set(provider, (map.get(provider) ?? 0) + 1);
        providersBySubSiteId.set(employee.sub_site_id, map);
        return;
      }

      const siteMap = providersBySiteIdNoSub.get(employee.site_id) ?? new Map<string, number>();
      siteMap.set(provider, (siteMap.get(provider) ?? 0) + 1);
      providersBySiteIdNoSub.set(employee.site_id, siteMap);
    });

    const bestProvider = (countMap: Map<string, number>) => {
      let best = "";
      let bestCount = -1;
      for (const [provider, count] of countMap.entries()) {
        if (count > bestCount) {
          best = provider;
          bestCount = count;
        }
      }
      return best;
    };

    const subSiteAssignmentRows: Array<{
      scope_type: "sub_site";
      site_id: null;
      sub_site_id: number;
      provider: string;
      is_active: boolean;
      note: string | null;
      created_by: string;
    }> = [];

    for (const [subSiteId, countMap] of providersBySubSiteId.entries()) {
      const provider = bestProvider(countMap);
      if (!provider) continue;
      subSiteAssignmentRows.push({
        scope_type: "sub_site",
        site_id: null,
        sub_site_id: subSiteId,
        provider,
        is_active: true,
        note: "Seed da import sorveglianza",
        created_by: auth.userId,
      });
    }

    const siteAssignmentRows: Array<{
      scope_type: "site";
      site_id: number;
      sub_site_id: null;
      provider: string;
      is_active: boolean;
      note: string | null;
      created_by: string;
    }> = [];

    const allSiteIds = new Set<number>([
      ...providersBySiteIdNoSub.keys(),
      ...subSitesBySiteId.keys(),
      ...employees.map((e) => e.site_id),
    ]);

    for (const siteId of allSiteIds) {
      const siteNoSub = providersBySiteIdNoSub.get(siteId) ?? null;
      const siteSubIds = Array.from(subSitesBySiteId.get(siteId) ?? []);

      if (siteSubIds.length === 0) {
        if (!siteNoSub) continue;
        const provider = bestProvider(siteNoSub);
        if (!provider) continue;
        siteAssignmentRows.push({
          scope_type: "site",
          site_id: siteId,
          sub_site_id: null,
          provider,
          is_active: true,
          note: "Seed da import sorveglianza",
          created_by: auth.userId,
        });
        continue;
      }

      const uniqueProviders = new Set<string>();
      siteSubIds.forEach((subSiteId) => {
        const p = subSiteAssignmentRows.find((r) => r.sub_site_id === subSiteId)?.provider;
        if (p) uniqueProviders.add(p);
      });

      if (uniqueProviders.size === 1) {
        const provider = Array.from(uniqueProviders)[0] ?? "";
        if (!provider) continue;
        siteAssignmentRows.push({
          scope_type: "site",
          site_id: siteId,
          sub_site_id: null,
          provider,
          is_active: true,
          note: "Seed da import sorveglianza",
          created_by: auth.userId,
        });
      } else if (uniqueProviders.size > 1) {
        siteAssignmentRows.push({
          scope_type: "site",
          site_id: siteId,
          sub_site_id: null,
          provider: "MISTO",
          is_active: true,
          note: "Seed da import sorveglianza",
          created_by: auth.userId,
        });
      }
    }

    const rowsToUpsert = [...siteAssignmentRows, ...subSiteAssignmentRows];
    if (rowsToUpsert.length > 0) {
      const { error } = await admin
        .from("medical_surveillance_provider_assignments")
        .upsert(rowsToUpsert, { onConflict: "scope_type,site_id,sub_site_id" });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      source: file ? "file" : "records",
      seeded: rowsToUpsert.length,
      sites: siteAssignmentRows.length,
      subSites: subSiteAssignmentRows.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore seed provider." },
      { status: 500 },
    );
  }
}

async function fetchEmployees(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("employees").select("id,site_id,sub_site_id").eq("status", "attivo");
  if (error) throw new Error(error.message);
  return (data ?? []) as EmployeeRow[];
}

async function fetchRecords(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("medical_surveillance_records").select("employee_id,provider");
  if (error) throw new Error(error.message);
  return (data ?? []) as RecordRow[];
}

async function readOptionalFile(request: Request): Promise<File | null> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (file instanceof File) return file;
    return null;
  } catch {
    return null;
  }
}

function normalizeHeaderCell(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildHeaderIndex(headerRow: unknown[]) {
  const index = new Map<string, number[]>();
  headerRow.forEach((cell, i) => {
    const key = normalizeHeaderCell(cell);
    if (!key) return;
    const list = index.get(key);
    if (!list) index.set(key, [i]);
    else list.push(i);
  });
  return index;
}

function cleanCell(value: unknown) {
  return String(value ?? "").trim();
}

function getFirstByName(row: unknown[], headerIndex: Map<string, number[]>, name: string) {
  const key = normalizeHeaderCell(name);
  const indices = headerIndex.get(key);
  if (!indices || indices.length === 0) return "";
  for (const idx of indices) {
    const value = cleanCell(row[idx]);
    if (value) return value;
  }
  return "";
}

function detectHeaderRowIndex(rows: unknown[][]) {
  const candidates = rows.slice(0, 30);
  for (let i = 0; i < candidates.length; i += 1) {
    const row = candidates[i] ?? [];
    const normalized = row.map((c) => normalizeHeaderCell(c));
    if (normalized.includes("matricola") && normalized.includes("codice fiscale")) {
      return i;
    }
  }
  return 0;
}

function parseImportFile(fileBuffer: ArrayBuffer): ImportRow[] {
  const workbook = XLSX.read(Buffer.from(fileBuffer), { cellDates: true });
  const sheetName =
    workbook.SheetNames.find((name) => name.toLowerCase().includes("anagrafica_sorveglianza")) ??
    workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = (XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  }) ?? []) as unknown[][];

  const headerRowIndex = detectHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] ?? [];
  const headerIndex = buildHeaderIndex(headerRow);
  const dataRows = rows.slice(headerRowIndex + 1);

  const out: ImportRow[] = [];
  dataRows.forEach((row) => {
    const firstCell = cleanCell(row[0]);
    if (firstCell.toLowerCase().startsWith("totale")) return;

    const matricola = cleanCell(getFirstByName(row, headerIndex, "matricola"));
    const taxCode = cleanCell(getFirstByName(row, headerIndex, "codice fiscale")).toUpperCase();
    const provider =
      cleanCell(getFirstByName(row, headerIndex, "provider")) ||
      cleanCell(getFirstByName(row, headerIndex, "medico")) ||
      cleanCell(getFirstByName(row, headerIndex, "medico/ente")) ||
      cleanCell(getFirstByName(row, headerIndex, "ente")) ||
      cleanCell(getFirstByName(row, headerIndex, "medico competente"));

    if (!matricola && !taxCode) return;
    if (!provider) return;
    out.push({ matricola, taxCode, provider });
  });

  return out;
}

async function buildEmployeeLookup(supabase: SupabaseClient, rows: ImportRow[]) {
  const taxCodes = Array.from(new Set(rows.map((r) => r.taxCode).filter(Boolean)));
  const matricole = Array.from(new Set(rows.map((r) => r.matricola).filter(Boolean)));

  const byTaxCode = new Map<string, number>();
  const byMatricola = new Map<string, number>();

  const taxChunks = chunk(taxCodes, 500);
  for (const part of taxChunks) {
    const { data, error } = await supabase.from("employees").select("id,tax_code,matricola").in("tax_code", part);
    if (error) throw new Error(error.message);
    ((data ?? []) as Array<{ id: number; tax_code: string; matricola: string }>).forEach((row) => {
      byTaxCode.set(String(row.tax_code ?? "").toUpperCase(), row.id);
      byMatricola.set(String(row.matricola ?? "").trim(), row.id);
    });
  }

  const remainingMatricole = matricole.filter((m) => !byMatricola.has(m));
  const matricolaChunks = chunk(remainingMatricole, 500);
  for (const part of matricolaChunks) {
    const { data, error } = await supabase.from("employees").select("id,tax_code,matricola").in("matricola", part);
    if (error) throw new Error(error.message);
    ((data ?? []) as Array<{ id: number; tax_code: string; matricola: string }>).forEach((row) => {
      byTaxCode.set(String(row.tax_code ?? "").toUpperCase(), row.id);
      byMatricola.set(String(row.matricola ?? "").trim(), row.id);
    });
  }

  return { byTaxCode, byMatricola };
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
