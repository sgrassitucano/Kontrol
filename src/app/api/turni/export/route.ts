import { NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { applyCalibri10WithBoldHeader } from "@/lib/excel";
import { requireModuleAccess } from "@/lib/api/access";

type XlsxWriteOptionsWithStyles = XLSX.WritingOptions & { cellStyles?: boolean };

export const runtime = "nodejs";

const MAX_FILTER_EMPLOYEE_IDS = 20000;

type ShiftState = "planned" | "actual" | "cancelled";

type ShiftRow = {
  id: number;
  employee_id: number;
  site_id: number;
  sub_site_id: number | null;
  start_at: string;
  end_at: string;
  state: ShiftState;
  note: string | null;
  employees: unknown;
  sites: unknown;
};

type BreakRow = { shift_id: number; break_start_at: string; break_end_at: string };

function extractDisplayName(value: unknown, fallback = "-") {
  if (!value) return fallback;
  if (Array.isArray(value)) {
    const first = value[0] as { display_name?: string; first_name?: string; last_name?: string; matricola?: string } | undefined;
    if (!first) return fallback;
    if (typeof first.display_name === "string") return first.display_name;
    const name = `${first.last_name ?? ""} ${first.first_name ?? ""}`.trim();
    return name || fallback;
  }
  if (typeof value === "object") {
    const obj = value as { display_name?: string; first_name?: string; last_name?: string; matricola?: string };
    if (typeof obj.display_name === "string") return obj.display_name;
    const name = `${obj.last_name ?? ""} ${obj.first_name ?? ""}`.trim();
    return name || fallback;
  }
  return fallback;
}

function extractEmployeeMeta(value: unknown) {
  if (!value) return { matricola: "", cognome: "", nome: "" };
  if (Array.isArray(value)) {
    const first = value[0] as { matricola?: string; first_name?: string; last_name?: string } | undefined;
    return { matricola: first?.matricola ?? "", cognome: first?.last_name ?? "", nome: first?.first_name ?? "" };
  }
  if (typeof value === "object") {
    const obj = value as { matricola?: string; first_name?: string; last_name?: string };
    return { matricola: obj.matricola ?? "", cognome: obj.last_name ?? "", nome: obj.first_name ?? "" };
  }
  return { matricola: "", cognome: "", nome: "" };
}

function toItDate(value: Date) {
  const dd = String(value.getDate()).padStart(2, "0");
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const yyyy = value.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toTime(value: Date) {
  const hh = String(value.getHours()).padStart(2, "0");
  const mm = String(value.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseCsvNumberList(value: string | null) {
  if (!value) return [];
  const items = value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v)) as number[];
  return Array.from(new Set(items));
}

function parseCsvStringList(value: string | null) {
  if (!value) return [];
  const items = value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(items));
}

function intersectNumberLists(a: number[], b: number[]) {
  const setB = new Set(b);
  return a.filter((v) => setB.has(v));
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") ?? "");
    const month = Number(url.searchParams.get("month") ?? "");
    const includeCancelled =
      (url.searchParams.get("includeCancelled") ?? "").toLowerCase() === "true" ||
      (url.searchParams.get("includeCancelled") ?? "") === "1";

    const employeeIdsCsv = parseCsvNumberList(url.searchParams.get("employeeIds"));
    const siteIdsCsv = parseCsvNumberList(url.searchParams.get("siteIds"));
    const subSiteIdsCsv = parseCsvNumberList(url.searchParams.get("subSiteIds"));
    const includeNullSubSite =
      (url.searchParams.get("includeNullSubSite") ?? "").toLowerCase() === "true" ||
      (url.searchParams.get("includeNullSubSite") ?? "") === "1";
    const responsibleCodes = parseCsvStringList(url.searchParams.get("responsibleCodes"));
    const referrals = parseCsvStringList(url.searchParams.get("referrals"));

    const siteIdParam = url.searchParams.get("siteId");
    const subSiteIdParam = url.searchParams.get("subSiteId");
    const employeeIdParam = url.searchParams.get("employeeId");
    const siteId = siteIdParam ? Number(siteIdParam) : null;
    const subSiteId = subSiteIdParam ? Number(subSiteIdParam) : null;
    const employeeId = employeeIdParam ? Number(employeeIdParam) : null;
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "year non valido." }, { status: 400 });
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "month non valido." }, { status: 400 });
    }
    if (siteIdParam && !Number.isFinite(siteId)) {
      return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    }
    if (subSiteIdParam && !Number.isFinite(subSiteId)) {
      return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });
    }
    if (employeeIdParam && !Number.isFinite(employeeId)) {
      return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    }

    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    const supabase = auth.supabase;

    const siteIds = siteIdsCsv.length > 0 ? siteIdsCsv : typeof siteId === "number" && Number.isFinite(siteId) ? [siteId] : [];
    const subSiteIds =
      subSiteIdsCsv.length > 0
        ? subSiteIdsCsv
        : typeof subSiteId === "number" && Number.isFinite(subSiteId)
          ? [subSiteId]
          : [];

    let allowedEmployeeIds: number[] | null = null;
    if (responsibleCodes.length > 0 || referrals.length > 0) {
      let q = supabase.from("employees").select("id").eq("status", "attivo");
      if (responsibleCodes.length > 0) q = q.in("responsible_code", responsibleCodes);
      if (referrals.length > 0) q = q.in("referral", referrals);
      const { data, error } = await q.limit(MAX_FILTER_EMPLOYEE_IDS + 1);
      if (error) throw new Error(error.message);
      if ((data ?? []).length > MAX_FILTER_EMPLOYEE_IDS) {
        return NextResponse.json(
          {
            error: `Filtro troppo ampio: trovati > ${MAX_FILTER_EMPLOYEE_IDS} lavoratori. Restringi responsibleCodes/referrals.`,
          },
          { status: 400 },
        );
      }
      allowedEmployeeIds = Array.from(new Set((data ?? []).map((r) => (r as { id: number }).id)));
    }

    const explicitEmployeeIds =
      employeeIdsCsv.length > 0
        ? employeeIdsCsv
        : typeof employeeId === "number" && Number.isFinite(employeeId)
          ? [employeeId]
          : [];

    if (explicitEmployeeIds.length > 0) {
      allowedEmployeeIds = allowedEmployeeIds ? intersectNumberLists(allowedEmployeeIds, explicitEmployeeIds) : explicitEmployeeIds;
    }
    let shiftsQuery = supabase
      .from("turni_employee_shifts")
      .select(
        "id,employee_id,site_id,sub_site_id,start_at,end_at,state,note,employees(matricola,first_name,last_name),sites(display_name)",
      )
      .gte("start_at", start.toISOString())
      .lt("start_at", end.toISOString())
      .neq("state", "cancelled")
    if (typeof siteId === "number" && Number.isFinite(siteId)) shiftsQuery = shiftsQuery.eq("site_id", siteId);

    if (!includeCancelled) shiftsQuery = shiftsQuery.neq("state", "cancelled");
    if (allowedEmployeeIds && allowedEmployeeIds.length === 0) {
      const emptyWb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet([], { header: ["data", "matricola", "cognome", "nome", "cantiere", "sottocantiere", "inizio", "fine", "pause_min", "ore_nette", "stato", "note"] });
      applyCalibri10WithBoldHeader(ws1);
      XLSX.utils.book_append_sheet(emptyWb, ws1, "per_lavoratore");
      const ws2 = XLSX.utils.json_to_sheet([], { header: ["data", "matricola", "cognome", "nome", "cantiere", "sottocantiere", "inizio", "fine", "pause_min", "ore_nette", "stato", "note"] });
      applyCalibri10WithBoldHeader(ws2);
      XLSX.utils.book_append_sheet(emptyWb, ws2, "per_cantiere");
      const buffer = XLSX.write(
        emptyWb,
        { bookType: "xlsx", type: "buffer", cellStyles: true } as XlsxWriteOptionsWithStyles,
      );
      const fileName = `turni_${year}_${String(month).padStart(2, "0")}_selezione.xlsx`;
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }
    if (allowedEmployeeIds && allowedEmployeeIds.length > 0) shiftsQuery = shiftsQuery.in("employee_id", allowedEmployeeIds);
    if (siteIds.length > 0) shiftsQuery = shiftsQuery.in("site_id", siteIds);

    if (includeNullSubSite && subSiteIds.length > 0) {
      shiftsQuery = shiftsQuery.or(`sub_site_id.is.null,sub_site_id.in.(${subSiteIds.join(",")})`);
    } else if (includeNullSubSite) {
      shiftsQuery = shiftsQuery.is("sub_site_id", null);
    } else if (subSiteIds.length > 0) {
      shiftsQuery = shiftsQuery.in("sub_site_id", subSiteIds);
    }
    const { data: shiftsData, error: shiftsError } = await shiftsQuery;
    if (shiftsError) throw new Error(shiftsError.message);


    const shifts = (shiftsData ?? []) as ShiftRow[];
    const shiftIds = shifts.map((s) => s.id);

    const subSiteIdsInShifts = Array.from(
      new Set(shifts.map((s) => s.sub_site_id).filter((v): v is number => typeof v === "number")),
    );
    const subSitesById = new Map<number, string>();
    if (subSiteIdsInShifts.length > 0) {
      const { data: subSitesData, error: subSitesError } = await supabase
        .from("sub_sites")
        .select("id,display_name")
        .in("id", subSiteIdsInShifts);
      if (subSitesError) throw new Error(subSitesError.message);
      for (const s of (subSitesData ?? []) as Array<{ id: number; display_name: string }>) {
        subSitesById.set(s.id, s.display_name);
      }
    }

    const breaksByShiftId = new Map<number, BreakRow[]>();
    if (shiftIds.length > 0) {
      const { data: breaksData, error: breaksError } = await supabase
        .from("turni_shift_breaks")
        .select("shift_id,break_start_at,break_end_at")
        .in("shift_id", shiftIds);
      if (breaksError) throw new Error(breaksError.message);
      for (const b of (breaksData ?? []) as BreakRow[]) {
        const list = breaksByShiftId.get(b.shift_id) ?? [];
        list.push(b);
        breaksByShiftId.set(b.shift_id, list);
      }
    }

    const rows = shifts.map((s) => {
      const startAt = new Date(s.start_at);
      const endAt = new Date(s.end_at);
      const durationMinutes = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000));
      const breakMinutes = (breaksByShiftId.get(s.id) ?? []).reduce((acc, b) => {
        const bs = new Date(b.break_start_at);
        const be = new Date(b.break_end_at);
        const m = Math.max(0, Math.round((be.getTime() - bs.getTime()) / 60000));
        return acc + m;
      }, 0);
      const netMinutes = Math.max(0, durationMinutes - breakMinutes);
      const netHours = Math.round((netMinutes / 60) * 100) / 100;
      const emp = extractEmployeeMeta(s.employees);
      return {
        data: toItDate(startAt),
        matricola: emp.matricola,
        cognome: emp.cognome,
        nome: emp.nome,
        cantiere: extractDisplayName(s.sites),
        sottocantiere: s.sub_site_id ? (subSitesById.get(s.sub_site_id) ?? "-") : "-",
        inizio: toTime(startAt),
        fine: toTime(endAt),
        pause_min: breakMinutes,
        ore_nette: netHours,
        stato: s.state,
        note: s.note ?? "",
      };
    });

    const wb = XLSX.utils.book_new();
    const wsHeaders = [
      "data",
      "matricola",
      "cognome",
      "nome",
      "cantiere",
      "sottocantiere",
      "inizio",
      "fine",
      "pause_min",
      "ore_nette",
      "stato",
      "note",
    ] as const;
    const ws1 = XLSX.utils.json_to_sheet(rows, { header: [...wsHeaders] });
    applyCalibri10WithBoldHeader(ws1);
    XLSX.utils.book_append_sheet(wb, ws1, "per_lavoratore");

    const bySite = [...rows].sort((a, b) => a.cantiere.localeCompare(b.cantiere) || a.cognome.localeCompare(b.cognome));
    const ws2 = XLSX.utils.json_to_sheet(bySite, { header: [...wsHeaders] });
    applyCalibri10WithBoldHeader(ws2);
    XLSX.utils.book_append_sheet(wb, ws2, "per_cantiere");

    const buffer = XLSX.write(
      wb,
      { bookType: "xlsx", type: "buffer", cellStyles: true } as XlsxWriteOptionsWithStyles,
    );
    const suffix =
      employeeIdsCsv.length > 0 ||
      siteIdsCsv.length > 0 ||
      subSiteIdsCsv.length > 0 ||
      responsibleCodes.length > 0 ||
      referrals.length > 0 ||
      includeNullSubSite ||
      includeCancelled
        ? "selezione"
        : employeeId
          ? `employee_${employeeId}`
          : siteId
            ? `site_${siteId}`
            : "tutti";
    const fileName = `turni_${year}_${String(month).padStart(2, "0")}_${suffix}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore export turni." },
      { status: 500 },
    );
  }
}
