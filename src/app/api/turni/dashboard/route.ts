import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SiteRow = { id: number; display_name: string };

type EmployeeRow = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
  job_title: string;
  responsible_code: string;
  referral: string | null;
  site_id: number | null;
  sub_site_id: number | null;
  sites: unknown;
  sub_sites: unknown;
};

type AssignmentRow = {
  employee_id: number;
  site_id: number;
  sub_site_id: number | null;
  start_date: string;
  end_date: string | null;
};

type TemplateRow = {
  id: number;
  site_id: number;
  sub_site_id: number | null;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
};

type TemplateSlotRow = {
  template_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  break_minutes: number;
};

type ShiftRow = {
  id: number;
  employee_id: number;
  site_id: number;
  sub_site_id: number | null;
  start_at: string;
  end_at: string;
  state: "planned" | "actual" | "cancelled";
};

type BreakRow = {
  shift_id: number;
  break_start_at: string;
  break_end_at: string;
};

const MAX_SITES = 5000;
const MAX_EMPLOYEES = 10000;
const MAX_ASSIGNMENTS = 50000;
const MAX_TEMPLATES = 20000;
const MAX_TEMPLATE_SLOTS = 50000;
const MAX_SHIFTS = 50000;
const MAX_BREAKS = 100000;
const QUERY_CHUNK_SIZE = 500;

function extractDisplayName(value: unknown, fallback = "-") {
  if (!value) return fallback;
  if (Array.isArray(value)) {
    const first = value[0] as { display_name?: string } | undefined;
    return typeof first?.display_name === "string" ? first.display_name : fallback;
  }
  if (typeof value === "object") {
    const obj = value as { display_name?: string };
    return typeof obj.display_name === "string" ? obj.display_name : fallback;
  }
  return fallback;
}

function parseYearMonth(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function toIsoDateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthRangeUtc(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const next = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const endDay = new Date(Date.UTC(year, month, 0, 0, 0, 0, 0));
  return {
    startDate: toIsoDateUTC(start),
    endDate: toIsoDateUTC(endDay),
    startAtIso: start.toISOString(),
    nextMonthStartIso: next.toISOString(),
  };
}

function weekdayMon0(dateIso: string) {
  const [y, m, d] = dateIso.split("-").map((v) => Number(v));
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  return (dt.getUTCDay() + 6) % 7;
}

function minutesBetween(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

function intersectDateRange(
  start: string,
  end: string | null,
  rangeStart: string,
  rangeEnd: string,
) {
  const s = start > rangeStart ? start : rangeStart;
  const eRaw = end ?? rangeEnd;
  const e = eRaw < rangeEnd ? eRaw : rangeEnd;
  if (e < s) return null;
  return { start: s, end: e };
}

function* iterateDatesInclusive(startIsoDate: string, endIsoDate: string) {
  const [sy, sm, sd] = startIsoDate.split("-").map((v) => Number(v));
  const [ey, em, ed] = endIsoDate.split("-").map((v) => Number(v));
  const cursor = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0));
  const end = new Date(Date.UTC(ey, em - 1, ed, 0, 0, 0, 0));
  while (cursor <= end) {
    yield toIsoDateUTC(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

function pickTemplateForDate(templates: TemplateRow[], dateIso: string) {
  const matches = templates.filter((t) => {
    if (!t.is_active) return false;
    if (t.valid_from > dateIso) return false;
    if (t.valid_to && t.valid_to < dateIso) return false;
    return true;
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.id - a.id);
  return matches[0];
}

async function fetchSites(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase
    .from("sites")
    .select("id,display_name")
    .order("display_name")
    .limit(MAX_SITES + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SiteRow[];
  if (rows.length > MAX_SITES) {
    throw new Error("Troppi cantieri per dashboard turni. Riduci il dataset o applica paginazione.");
  }
  return rows;
}

async function fetchEmployees(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase
    .from("employees")
    .select(
      "id,matricola,first_name,last_name,job_title,responsible_code,referral,site_id,sub_site_id,sites(display_name),sub_sites(display_name)",
    )
    .eq("status", "attivo")
    .order("last_name")
    .order("first_name")
    .limit(MAX_EMPLOYEES + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EmployeeRow[];
  if (rows.length > MAX_EMPLOYEES) {
    throw new Error("Troppi lavoratori per dashboard turni. Riduci il dataset o applica paginazione.");
  }
  return rows;
}

async function fetchAssignmentsInRange(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  startDate: string,
  endDate: string,
) {
  const { data, error } = await supabase
    .from("turni_employee_site_assignments")
    .select("employee_id,site_id,sub_site_id,start_date,end_date")
    .lte("start_date", endDate)
    .or(`end_date.is.null,end_date.gte.${startDate}`)
    .limit(MAX_ASSIGNMENTS + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AssignmentRow[];
  if (rows.length > MAX_ASSIGNMENTS) {
    throw new Error("Troppi assegnamenti per dashboard turni. Restringi il periodo o il dataset.");
  }
  return rows;
}

async function fetchTemplatesForSites(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  siteIds: number[],
) {
  if (siteIds.length === 0) {
    return { templates: [] as TemplateRow[], slots: [] as TemplateSlotRow[] };
  }
  const templates: TemplateRow[] = [];
  for (let i = 0; i < siteIds.length; i += QUERY_CHUNK_SIZE) {
    const chunk = siteIds.slice(i, i + QUERY_CHUNK_SIZE);
    const { data: templatesData, error: templatesError } = await supabase
      .from("turni_site_templates")
      .select("id,site_id,sub_site_id,valid_from,valid_to,is_active")
      .eq("is_active", true)
      .in("site_id", chunk)
      .limit(MAX_TEMPLATES + 1);
    if (templatesError) throw new Error(templatesError.message);
    templates.push(...((templatesData ?? []) as TemplateRow[]));
    if (templates.length > MAX_TEMPLATES) {
      throw new Error("Troppi template per dashboard turni. Restringi il dataset.");
    }
  }
  const templateIds = templates.map((t) => t.id);
  if (templateIds.length === 0) {
    return { templates, slots: [] as TemplateSlotRow[] };
  }
  const slots: TemplateSlotRow[] = [];
  for (let i = 0; i < templateIds.length; i += QUERY_CHUNK_SIZE) {
    const chunk = templateIds.slice(i, i + QUERY_CHUNK_SIZE);
    const { data: slotsData, error: slotsError } = await supabase
      .from("turni_site_template_slots")
      .select("template_id,weekday,start_time,end_time,break_minutes")
      .in("template_id", chunk)
      .limit(MAX_TEMPLATE_SLOTS + 1);
    if (slotsError) throw new Error(slotsError.message);
    slots.push(...((slotsData ?? []) as TemplateSlotRow[]));
    if (slots.length > MAX_TEMPLATE_SLOTS) {
      throw new Error("Troppi slot template per dashboard turni. Restringi il dataset.");
    }
  }
  return { templates, slots };
}

async function fetchShiftsInMonth(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  monthStartIso: string,
  nextMonthStartIso: string,
) {
  const { data, error } = await supabase
    .from("turni_employee_shifts")
    .select("id,employee_id,site_id,sub_site_id,start_at,end_at,state")
    .neq("state", "cancelled")
    .lt("start_at", nextMonthStartIso)
    .gt("end_at", monthStartIso)
    .order("start_at")
    .limit(MAX_SHIFTS + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ShiftRow[];
  if (rows.length > MAX_SHIFTS) {
    throw new Error("Troppi turni per dashboard mensile. Restringi il mese o applica filtri.");
  }
  return rows;
}

async function fetchBreaksByShiftIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  shiftIds: number[],
) {
  const map = new Map<number, BreakRow[]>();
  let totalRows = 0;
  for (let i = 0; i < shiftIds.length; i += QUERY_CHUNK_SIZE) {
    const chunk = shiftIds.slice(i, i + QUERY_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("turni_shift_breaks")
      .select("shift_id,break_start_at,break_end_at")
      .in("shift_id", chunk)
      .limit(MAX_BREAKS + 1);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as BreakRow[]) {
      totalRows += 1;
      if (totalRows > MAX_BREAKS) {
        throw new Error("Troppe pause per dashboard turni. Restringi il dataset.");
      }
      const list = map.get(row.shift_id);
      if (!list) map.set(row.shift_id, [row]);
      else list.push(row);
    }
  }
  return map;
}

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const ym = parseYearMonth(url.searchParams.get("month"));
    if (!ym) {
      return NextResponse.json({ error: "Parametro month non valido (YYYY-MM)." }, { status: 400 });
    }

    const supabase = auth.supabase;
    const { startDate, endDate, startAtIso, nextMonthStartIso } = monthRangeUtc(ym.year, ym.month);

    const [sites, employees, assignments, shifts] = await Promise.all([
      fetchSites(supabase),
      fetchEmployees(supabase),
      fetchAssignmentsInRange(supabase, startDate, endDate),
      fetchShiftsInMonth(supabase, startAtIso, nextMonthStartIso),
    ]);

    const siteIdsWithAssignments = Array.from(new Set(assignments.map((a) => a.site_id)));
    const { templates, slots } = await fetchTemplatesForSites(supabase, siteIdsWithAssignments);

    const templatesByUnit = new Map<string, TemplateRow[]>();
    for (const t of templates) {
      const unitKey =
        typeof t.sub_site_id === "number" ? `sub:${t.sub_site_id}` : `site:${t.site_id}`;
      const list = templatesByUnit.get(unitKey);
      if (!list) templatesByUnit.set(unitKey, [t]);
      else list.push(t);
    }

    const slotsByTemplate = new Map<number, TemplateSlotRow[]>();
    for (const s of slots) {
      const list = slotsByTemplate.get(s.template_id);
      if (!list) slotsByTemplate.set(s.template_id, [s]);
      else list.push(s);
    }

    const templateWeekStats = new Map<
      number,
      { shiftsByWeekday: number[]; minutesByWeekday: number[] }
    >();
    for (const [templateId, list] of slotsByTemplate.entries()) {
      const shiftsByWeekday = [0, 0, 0, 0, 0, 0, 0];
      const minutesByWeekday = [0, 0, 0, 0, 0, 0, 0];
      for (const slot of list) {
        if (slot.weekday < 0 || slot.weekday > 6) continue;
        const startMinutes =
          Number(slot.start_time.slice(0, 2)) * 60 + Number(slot.start_time.slice(3, 5));
        const endMinutes =
          Number(slot.end_time.slice(0, 2)) * 60 + Number(slot.end_time.slice(3, 5));
        const duration = Math.max(0, endMinutes - startMinutes);
        const net = Math.max(0, duration - (Number.isFinite(slot.break_minutes) ? slot.break_minutes : 0));
        shiftsByWeekday[slot.weekday] += 1;
        minutesByWeekday[slot.weekday] += net;
      }
      templateWeekStats.set(templateId, { shiftsByWeekday, minutesByWeekday });
    }

    const breaksByShiftId = await fetchBreaksByShiftIds(
      supabase,
      shifts.map((s) => s.id),
    );

    const employeeAssigned = new Map<number, { shifts: number; minutes: number }>();
    const siteAssigned = new Map<number, { shifts: number; minutes: number }>();
    for (const shift of shifts) {
      const shiftMinutes = minutesBetween(shift.start_at, shift.end_at);
      const breakMinutes = (breaksByShiftId.get(shift.id) ?? []).reduce(
        (sum, b) => sum + minutesBetween(b.break_start_at, b.break_end_at),
        0,
      );
      const netMinutes = Math.max(0, shiftMinutes - breakMinutes);

      const emp = employeeAssigned.get(shift.employee_id) ?? { shifts: 0, minutes: 0 };
      emp.shifts += 1;
      emp.minutes += netMinutes;
      employeeAssigned.set(shift.employee_id, emp);

      const site = siteAssigned.get(shift.site_id) ?? { shifts: 0, minutes: 0 };
      site.shifts += 1;
      site.minutes += netMinutes;
      siteAssigned.set(shift.site_id, site);
    }

    const employeeExpected = new Map<number, { shifts: number; minutes: number }>();
    const siteExpected = new Map<number, { shifts: number; minutes: number }>();

    for (const a of assignments) {
      const intersection = intersectDateRange(a.start_date, a.end_date, startDate, endDate);
      if (!intersection) continue;

      const unitKey =
        typeof a.sub_site_id === "number" ? `sub:${a.sub_site_id}` : `site:${a.site_id}`;
      const unitTemplates = templatesByUnit.get(unitKey) ?? [];
      for (const dayIso of iterateDatesInclusive(intersection.start, intersection.end)) {
        const template = pickTemplateForDate(unitTemplates, dayIso);
        if (!template) continue;
        const stats = templateWeekStats.get(template.id);
        if (!stats) continue;
        const wd = weekdayMon0(dayIso);
        const addShifts = stats.shiftsByWeekday[wd] ?? 0;
        const addMinutes = stats.minutesByWeekday[wd] ?? 0;
        if (addShifts === 0 && addMinutes === 0) continue;

        const emp = employeeExpected.get(a.employee_id) ?? { shifts: 0, minutes: 0 };
        emp.shifts += addShifts;
        emp.minutes += addMinutes;
        employeeExpected.set(a.employee_id, emp);

        const site = siteExpected.get(a.site_id) ?? { shifts: 0, minutes: 0 };
        site.shifts += addShifts;
        site.minutes += addMinutes;
        siteExpected.set(a.site_id, site);
      }
    }

    const assignmentsByEmployee = new Map<number, AssignmentRow[]>();
    assignments.forEach((a) => {
      const list = assignmentsByEmployee.get(a.employee_id);
      if (!list) assignmentsByEmployee.set(a.employee_id, [a]);
      else list.push(a);
    });
    for (const list of assignmentsByEmployee.values()) {
      list.sort((a, b) => b.start_date.localeCompare(a.start_date));
    }

    const siteNameById = new Map<number, string>(sites.map((s) => [s.id, s.display_name]));

    const tableRows = employees.map((e) => {
      const empExpected = employeeExpected.get(e.id) ?? { shifts: 0, minutes: 0 };
      const empAssigned = employeeAssigned.get(e.id) ?? { shifts: 0, minutes: 0 };
      const turnoAssegnato = empAssigned.shifts > 0;

      const chosenAssignment = (assignmentsByEmployee.get(e.id) ?? []).find((a) => {
        const intersection = intersectDateRange(a.start_date, a.end_date, startDate, endDate);
        return Boolean(intersection);
      }) ?? null;

      const cantiere =
        chosenAssignment?.site_id
          ? siteNameById.get(chosenAssignment.site_id) ?? extractDisplayName(e.sites)
          : extractDisplayName(e.sites);
      const sottocantiere = extractDisplayName(e.sub_sites, "-");

      return {
        workerId: e.id,
        matricola: e.matricola,
        cognome: e.last_name,
        nome: e.first_name,
        mansione: e.job_title ?? "",
        cantiere,
        sottocantiere,
        responsabile: e.responsible_code ?? "",
        referente: e.referral ?? "",
        turnoAssegnato,
        expectedShifts: empExpected.shifts,
        assignedShifts: empAssigned.shifts,
        expectedMinutes: empExpected.minutes,
        assignedMinutes: empAssigned.minutes,
      };
    });

    const workersTotal = employees.length;
    const expectedShiftsTotal = Array.from(employeeExpected.values()).reduce((sum, v) => sum + v.shifts, 0);
    const expectedMinutesTotal = Array.from(employeeExpected.values()).reduce((sum, v) => sum + v.minutes, 0);
    const assignedShiftsTotal = shifts.length;
    const assignedMinutesTotal = Array.from(employeeAssigned.values()).reduce((sum, v) => sum + v.minutes, 0);

    const sitesTotal = sites.length;
    const sitesWithAssigned = new Set<number>(Array.from(siteAssigned.keys()));
    const sitesWithExpected = new Set<number>(Array.from(siteExpected.entries()).filter(([, v]) => v.shifts > 0).map(([k]) => k));
    const sitesWithoutAssigned = Array.from(sitesWithExpected).filter((id) => !sitesWithAssigned.has(id)).length;

    const assignedShiftsBySites = Array.from(siteAssigned.values()).reduce((sum, v) => sum + v.shifts, 0);
    const assignedMinutesBySites = Array.from(siteAssigned.values()).reduce((sum, v) => sum + v.minutes, 0);
    const expectedShiftsBySites = Array.from(siteExpected.values()).reduce((sum, v) => sum + v.shifts, 0);
    const expectedMinutesBySites = Array.from(siteExpected.values()).reduce((sum, v) => sum + v.minutes, 0);

    return NextResponse.json({
      month: `${ym.year}-${String(ym.month).padStart(2, "0")}`,
      range: { startDate, endDate },
      workers: {
        totalWorkers: workersTotal,
        expectedShifts: expectedShiftsTotal,
        assignedShifts: assignedShiftsTotal,
        unassignedShifts: Math.max(0, expectedShiftsTotal - assignedShiftsTotal),
        expectedMinutes: expectedMinutesTotal,
        assignedMinutes: assignedMinutesTotal,
        unassignedMinutes: Math.max(0, expectedMinutesTotal - assignedMinutesTotal),
      },
      sites: {
        totalSites: sitesTotal,
        sitesWithAssigned: sitesWithAssigned.size,
        sitesWithoutAssigned,
        expectedShifts: expectedShiftsBySites,
        assignedShifts: assignedShiftsBySites,
        unassignedShifts: Math.max(0, expectedShiftsBySites - assignedShiftsBySites),
        expectedMinutes: expectedMinutesBySites,
        assignedMinutes: assignedMinutesBySites,
        unassignedMinutes: Math.max(0, expectedMinutesBySites - assignedMinutesBySites),
      },
      tableRows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore cruscotto turni." },
      { status: 500 },
    );
  }
}
