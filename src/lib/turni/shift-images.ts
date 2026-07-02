import path from "path";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Serverless runtimes (Vercel/AWS Lambda) ship with no system fonts, so
 * SVG-based text rendering via sharp/librsvg silently produces blank/illegible
 * text there even though it looks fine on a dev machine with fonts installed.
 * @napi-rs/canvas embeds its own font rasterizer and works identically with
 * or without system fonts as long as we register a font file explicitly.
 */
const FONT_FAMILY = "TurniSans";
const FONT_FAMILY_BOLD = "TurniSansBold";
let fontsRegistered = false;
function ensureFontsRegistered() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf"), FONT_FAMILY);
  GlobalFonts.registerFromPath(path.join(process.cwd(), "public/fonts/LiberationSans-Bold.ttf"), FONT_FAMILY_BOLD);
  fontsRegistered = true;
}

type ShiftState = "planned" | "actual" | "cancelled";
type ShiftSource = "template" | "manual" | "import";

type ShiftRow = {
  id: number;
  employee_id: number;
  site_id: number;
  sub_site_id: number | null;
  start_at: string;
  end_at: string;
  state: ShiftState;
  source: ShiftSource;
  note: string | null;
  employees: unknown;
  sites: unknown;
  sub_sites: unknown;
};

export type ShiftImageItem = { baseName: string; png: Buffer };

export type BuildShiftImagesResult =
  | { ok: true; items: ShiftImageItem[]; mode: "week" | "month"; labelRange: string }
  | { ok: false; status: number; error: string };

function parseIsoDateOnly(value: string) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 2000 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  return { y, m, d, iso: `${match[1]}-${match[2]}-${match[3]}` };
}

function addDaysIso(iso: string, days: number) {
  const parsed = parseIsoDateOnly(iso);
  if (!parsed) return iso;
  const base = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function isoToItDate(iso: string) {
  const match = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function weekdayLabelMon0(index: number) {
  return ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"][index] ?? "";
}

function badgeLabel(state: ShiftState, source: ShiftSource) {
  if (state === "cancelled") return "ANNULLATO";
  if (source === "template") return "STANDARD";
  return "EXTRA";
}

function badgeColor(state: ShiftState, source: ShiftSource) {
  if (state === "cancelled") return "#dc2626";
  if (source === "template") return "#16a34a";
  return "#2563eb";
}

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

function formatTime(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function safeFilePart(value: string) {
  const raw = String(value ?? "").trim().toUpperCase();
  const cleaned = raw
    .replaceAll("À", "A")
    .replaceAll("È", "E")
    .replaceAll("É", "E")
    .replaceAll("Ì", "I")
    .replaceAll("Ò", "O")
    .replaceAll("Ù", "U")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "X";
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

function parseYearMonth(value: string | null) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  if (y < 2000 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  return { y, m };
}

function parsePositiveIntParam(value: string | null) {
  if (!value) return null;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function monthRangeUtc(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const next = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), nextIso: next.toISOString(), startDateIso: start.toISOString().slice(0, 10) };
}

function startOfWeekMonday(isoDate: string) {
  const parsed = parseIsoDateOnly(isoDate);
  if (!parsed) return isoDate;
  const dt = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0, 0));
  const dayMon0 = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayMon0);
  return dt.toISOString().slice(0, 10);
}

function addMonthsIso(isoDate: string, months: number) {
  const parsed = parseIsoDateOnly(isoDate);
  if (!parsed) return isoDate;
  const dt = new Date(Date.UTC(parsed.y, parsed.m - 1, 1, 0, 0, 0, 0));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

function buildMonthGrid(monthIso: string) {
  const parsed = parseIsoDateOnly(monthIso);
  if (!parsed) return { monthStart: monthIso, cells: [] as Array<{ iso: string; inMonth: boolean }> };
  const monthStart = `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-01`;
  const gridStart = startOfWeekMonday(monthStart);
  const nextMonthStart = addMonthsIso(monthStart, 1);
  const cells: Array<{ iso: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const iso = addDaysIso(gridStart, i);
    cells.push({ iso, inMonth: iso >= monthStart && iso < nextMonthStart });
  }
  return { monthStart, cells };
}

function drawText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  bold: boolean,
  color: string,
  align: "left" | "right" = "left",
) {
  ctx.font = `${size}px ${bold ? FONT_FAMILY_BOLD : FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

function buildWorkerWeekImage(args: {
  weekStart: string;
  worker: { matricola: string; cognome: string; nome: string };
  rowsByDay: Array<{
    dayIso: string;
    lines: Array<{ text: string; badgeText: string; badgeColor: string; cancelled: boolean }>;
  }>;
}): Buffer {
  ensureFontsRegistered();
  const width = 1080;
  const paddingX = 48;
  const titleFont = 44;
  const headerFont = 30;
  const rowFont = 28;
  const smallFont = 22;
  const lineH = 40;

  const baseHeight = 56 + 56 + 28;
  let contentLines = 0;
  args.rowsByDay.forEach((d) => {
    contentLines += 1;
    contentLines += Math.max(1, d.lines.length);
  });
  const height = baseHeight + contentLines * lineH + 80;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let y = 56;
  const title = "Turni settimanali";
  const sub = `${args.worker.cognome} ${args.worker.nome} (${args.worker.matricola})`;
  const range = `${isoToItDate(args.weekStart)} — ${isoToItDate(addDaysIso(args.weekStart, 6))}`;

  drawText(ctx, title, paddingX, y, titleFont, true, "#0f172a");
  y += 50;
  drawText(ctx, sub, paddingX, y, headerFont, false, "#0f172a");
  y += 36;
  drawText(ctx, `Settimana: ${range}`, paddingX, y, smallFont, false, "#475569");
  y += 34;

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(paddingX, y);
  ctx.lineTo(width - paddingX, y);
  ctx.stroke();
  y += 30;

  args.rowsByDay.forEach((dayBlock, idx) => {
    const dayTitle = `${weekdayLabelMon0(idx)} ${isoToItDate(dayBlock.dayIso)}`;
    drawText(ctx, dayTitle, paddingX, y, rowFont, true, "#1e293b");
    y += lineH;

    const lines =
      dayBlock.lines.length > 0
        ? dayBlock.lines
        : [{ text: "—", badgeText: "", badgeColor: "#94a3b8", cancelled: false }];
    lines.forEach((line) => {
      drawText(ctx, line.text, paddingX, y, rowFont, false, "#0f172a");
      if (line.cancelled) {
        const textWidth = ctx.measureText(line.text).width;
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(paddingX, y - rowFont * 0.32);
        ctx.lineTo(paddingX + textWidth, y - rowFont * 0.32);
        ctx.stroke();
      }
      drawText(ctx, line.badgeText, width - paddingX, y, smallFont, true, line.badgeColor, "right");
      y += lineH;
    });

    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(paddingX, y - 18);
    ctx.lineTo(width - paddingX, y - 18);
    ctx.stroke();
  });

  return canvas.toBuffer("image/png");
}

function buildWorkerMonthImage(args: {
  month: string;
  worker: { matricola: string; cognome: string; nome: string };
  cells: Array<{ iso: string; inMonth: boolean; tone: "none" | "template" | "manual" | "cancelled"; lines: string[] }>;
}): Buffer {
  ensureFontsRegistered();
  const width = 1400;
  const paddingX = 40;
  const titleFont = 44;
  const headerFont = 28;
  const smallFont = 20;
  const cellFont = 20;

  const headerH = 56 + 46 + 34 + 24;
  const cellW = Math.floor((width - paddingX * 2) / 7);
  const cellH = 150;
  const gridH = cellH * 6;
  const height = headerH + gridH + 40;

  const toneBg = (tone: "none" | "template" | "manual" | "cancelled") => {
    if (tone === "cancelled") return "#fee2e2";
    if (tone === "template") return "#dcfce7";
    if (tone === "manual") return "#dbeafe";
    return "#ffffff";
  };

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let y = 56;
  drawText(ctx, "Turni mensili", paddingX, y, titleFont, true, "#0f172a");
  y += 50;
  drawText(ctx, `${args.worker.cognome} ${args.worker.nome} (${args.worker.matricola})`, paddingX, y, headerFont, false, "#0f172a");
  y += 34;
  drawText(ctx, `Mese: ${args.month}`, paddingX, y, smallFont, false, "#475569");
  y += 28;

  const gridTop = y + 12;
  const weekLabels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  weekLabels.forEach((label, i) => {
    const x = paddingX + i * cellW;
    drawText(ctx, label, x + 8, gridTop - 10, smallFont, true, "#334155");
  });

  for (let idx = 0; idx < 42; idx += 1) {
    const cell = args.cells[idx];
    if (!cell) continue;
    const row = Math.floor(idx / 7);
    const col = idx % 7;
    const x = paddingX + col * cellW;
    const y0 = gridTop + row * cellH;

    ctx.fillStyle = cell.inMonth ? toneBg(cell.tone) : "#f8fafc";
    ctx.fillRect(x, y0, cellW, cellH);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y0, cellW, cellH);

    const dayNum = cell.iso.slice(8, 10);
    drawText(ctx, dayNum, x + 8, y0 + 26, cellFont, true, cell.inMonth ? "#0f172a" : "#94a3b8");

    const maxLines = 3;
    const lines = cell.lines.slice(0, maxLines);
    lines.forEach((t, i) => {
      drawText(ctx, t, x + 8, y0 + 54 + i * 26, smallFont, false, "#0f172a");
    });
    if (cell.lines.length > maxLines) {
      drawText(ctx, `+${cell.lines.length - maxLines} turni`, x + 8, y0 + 54 + maxLines * 26, smallFont, false, "#475569");
    }
  }

  return canvas.toBuffer("image/png");
}

/**
 * Shared data → PNG pipeline for turni worker calendars.
 * Used by both the JPG/PNG export (worker-images) and the PDF export routes
 * so the two never drift.
 */
export async function buildShiftImages(
  supabase: SupabaseServerClient,
  url: URL,
): Promise<BuildShiftImagesResult> {
  const mode = (url.searchParams.get("mode") ?? "week").toLowerCase();
  const weekStartParam = url.searchParams.get("weekStart");
  const monthParam = url.searchParams.get("month");

  const employeeIdsCsv = parseCsvNumberList(url.searchParams.get("employeeIds"));
  const siteIdsCsv = parseCsvNumberList(url.searchParams.get("siteIds"));
  const subSiteIdsCsv = parseCsvNumberList(url.searchParams.get("subSiteIds"));
  const includeNullSubSite =
    (url.searchParams.get("includeNullSubSite") ?? "").toLowerCase() === "true" ||
    (url.searchParams.get("includeNullSubSite") ?? "") === "1";
  const responsibleCodes = parseCsvStringList(url.searchParams.get("responsibleCodes"));
  const referrals = parseCsvStringList(url.searchParams.get("referrals"));
  const includeCancelled =
    (url.searchParams.get("includeCancelled") ?? "1").toLowerCase() === "true" ||
    (url.searchParams.get("includeCancelled") ?? "1") === "1";

  const maxEmployeesDefault = mode === "month" ? 200 : 300;
  const maxShiftsDefault = mode === "month" ? 20000 : 8000;
  const maxEmployees = Math.min(parsePositiveIntParam(url.searchParams.get("maxEmployees")) ?? maxEmployeesDefault, 500);
  const maxShifts = Math.min(parsePositiveIntParam(url.searchParams.get("maxShifts")) ?? maxShiftsDefault, 50000);

  const siteIdParam = url.searchParams.get("siteId");
  const subSiteIdParam = url.searchParams.get("subSiteId");
  const legacySiteId = siteIdParam ? Number(siteIdParam) : null;
  const legacySubSiteId = subSiteIdParam ? Number(subSiteIdParam) : null;

  if (mode !== "week" && mode !== "month") return { ok: false, status: 400, error: "mode non valido." };

  if (
    employeeIdsCsv.length === 0 &&
    siteIdsCsv.length === 0 &&
    subSiteIdsCsv.length === 0 &&
    !includeNullSubSite &&
    responsibleCodes.length === 0 &&
    referrals.length === 0 &&
    !(typeof legacySiteId === "number" && Number.isFinite(legacySiteId))
  ) {
    return { ok: false, status: 400, error: "Seleziona almeno un filtro o un lavoratore." };
  }

  let startIso = "";
  let endIso = "";
  let labelRange = "";
  let monthLabel = "";

  if (mode === "week") {
    if (!weekStartParam) return { ok: false, status: 400, error: "weekStart mancante." };
    const parsed = parseIsoDateOnly(weekStartParam);
    if (!parsed) return { ok: false, status: 400, error: "weekStart non valido (YYYY-MM-DD)." };
    const monday = startOfWeekMonday(parsed.iso);
    startIso = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0, 0)).toISOString();
    if (monday !== parsed.iso) {
      const p2 = parseIsoDateOnly(monday)!;
      startIso = new Date(Date.UTC(p2.y, p2.m - 1, p2.d, 0, 0, 0, 0)).toISOString();
    }
    endIso = new Date(new Date(startIso).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    labelRange = `${startIso.slice(0, 10)}_${addDaysIso(startIso.slice(0, 10), 6)}`;
  } else {
    const ym = parseYearMonth(monthParam);
    if (!ym) return { ok: false, status: 400, error: "month non valido (YYYY-MM)." };
    const range = monthRangeUtc(ym.y, ym.m);
    startIso = range.startIso;
    endIso = range.nextIso;
    monthLabel = `${String(ym.y).padStart(4, "0")}-${String(ym.m).padStart(2, "0")}`;
    labelRange = monthLabel;
  }

  const siteIds = siteIdsCsv.length > 0 ? siteIdsCsv : typeof legacySiteId === "number" && Number.isFinite(legacySiteId) ? [legacySiteId] : [];
  const subSiteIds = subSiteIdsCsv.length > 0 ? subSiteIdsCsv : typeof legacySubSiteId === "number" && Number.isFinite(legacySubSiteId) ? [legacySubSiteId] : [];

  let allowedEmployeeIds: number[] | null = null;
  if (responsibleCodes.length > 0 || referrals.length > 0) {
    let q = supabase.from("employees").select("id").eq("status", "attivo");
    if (responsibleCodes.length > 0) q = q.in("responsible_code", responsibleCodes);
    if (referrals.length > 0) q = q.in("referral", referrals);
    const { data, error } = await q.order("id").limit(maxEmployees + 1);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > maxEmployees) {
      return { ok: false, status: 400, error: `Troppi lavoratori selezionati (>${maxEmployees}). Riduci i filtri.` };
    }
    allowedEmployeeIds = Array.from(new Set((data ?? []).map((r) => (r as { id: number }).id)));
  }
  if (employeeIdsCsv.length > 0) {
    allowedEmployeeIds = allowedEmployeeIds ? intersectNumberLists(allowedEmployeeIds, employeeIdsCsv) : employeeIdsCsv;
  }
  if (allowedEmployeeIds && allowedEmployeeIds.length === 0) {
    return { ok: false, status: 400, error: "Nessun lavoratore corrispondente ai filtri." };
  }
  if (allowedEmployeeIds && allowedEmployeeIds.length > maxEmployees) {
    return { ok: false, status: 400, error: `Troppi lavoratori selezionati (${allowedEmployeeIds.length}). Riduci i filtri.` };
  }

  let q = supabase
    .from("turni_employee_shifts")
    .select(
      "id,employee_id,site_id,sub_site_id,start_at,end_at,state,source,note,employees(matricola,first_name,last_name),sites(display_name),sub_sites(display_name)",
    )
    .lt("start_at", endIso)
    .gt("end_at", startIso)
    .order("employee_id")
    .order("start_at")
    .limit(maxShifts + 1);

  if (!includeCancelled) q = q.neq("state", "cancelled");
  if (allowedEmployeeIds && allowedEmployeeIds.length > 0) q = q.in("employee_id", allowedEmployeeIds);
  if (siteIds.length > 0) q = q.in("site_id", siteIds);
  if (includeNullSubSite && subSiteIds.length > 0) q = q.or(`sub_site_id.is.null,sub_site_id.in.(${subSiteIds.join(",")})`);
  else if (includeNullSubSite) q = q.is("sub_site_id", null);
  else if (subSiteIds.length > 0) q = q.in("sub_site_id", subSiteIds);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if ((data ?? []).length > maxShifts) {
    return { ok: false, status: 400, error: `Troppi turni per export (>${maxShifts}). Restringi filtri o periodo.` };
  }
  const shifts = (data ?? []) as ShiftRow[];
  const byEmployee = new Map<number, ShiftRow[]>();
  shifts.forEach((s) => {
    const list = byEmployee.get(s.employee_id) ?? [];
    list.push(s);
    byEmployee.set(s.employee_id, list);
  });
  if (byEmployee.size > maxEmployees) {
    return { ok: false, status: 400, error: `Troppi lavoratori per export (${byEmployee.size}). Restringi i filtri.` };
  }

  const items: ShiftImageItem[] = [];

  for (const [, list] of byEmployee.entries()) {
    const employeeMeta = extractEmployeeMeta(list[0]?.employees);
    let png: Buffer;
    let baseName = "";

    if (mode === "week") {
      const weekStartIso = startIso.slice(0, 10);
      const weekDays = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartIso, i));
      const byDay = new Map<string, ShiftRow[]>();
      list.forEach((s) => {
        const day = s.start_at.slice(0, 10);
        const existing = byDay.get(day) ?? [];
        existing.push(s);
        byDay.set(day, existing);
      });
      const rowsByDay = weekDays.map((dayIso) => {
        const dayShifts = byDay.get(dayIso) ?? [];
        const lines = dayShifts.map((s) => {
          const startTime = formatTime(s.start_at);
          const endTime = formatTime(s.end_at);
          const siteLabel = extractDisplayName(s.sites);
          const subLabel = extractDisplayName(s.sub_sites, "");
          const place = subLabel && subLabel !== "-" ? `${siteLabel} / ${subLabel}` : siteLabel;
          const note = String(s.note ?? "").trim();
          const tail = note ? ` · ${note}` : "";
          return {
            text: `${startTime}–${endTime} · ${place}${tail}`,
            badgeText: badgeLabel(s.state, s.source),
            badgeColor: badgeColor(s.state, s.source),
            cancelled: s.state === "cancelled",
          };
        });
        return { dayIso, lines };
      });

      png = buildWorkerWeekImage({ weekStart: weekStartIso, worker: employeeMeta, rowsByDay });

      baseName = [
        "TURNI_WEEK",
        weekStartIso,
        addDaysIso(weekStartIso, 6),
        safeFilePart(employeeMeta.matricola),
        safeFilePart(employeeMeta.cognome),
        safeFilePart(employeeMeta.nome),
      ].join("_");
    } else {
      const monthStartIso = `${monthLabel}-01`;
      const grid = buildMonthGrid(monthStartIso);
      const byDay = new Map<string, ShiftRow[]>();
      list.forEach((s) => {
        const day = s.start_at.slice(0, 10);
        const existing = byDay.get(day) ?? [];
        existing.push(s);
        byDay.set(day, existing);
      });
      const cells = grid.cells.map((c) => {
        const dayShifts = byDay.get(c.iso) ?? [];
        const tone =
          dayShifts.some((s) => s.state === "cancelled")
            ? ("cancelled" as const)
            : dayShifts.some((s) => s.source !== "template")
              ? ("manual" as const)
              : dayShifts.some((s) => s.source === "template")
                ? ("template" as const)
                : ("none" as const);
        const lines = dayShifts.map((s) => {
          const startTime = formatTime(s.start_at);
          const endTime = formatTime(s.end_at);
          return `${startTime}–${endTime}`;
        });
        return { iso: c.iso, inMonth: c.inMonth, tone, lines };
      });
      png = buildWorkerMonthImage({ month: monthLabel, worker: employeeMeta, cells });

      baseName = [
        "TURNI_MONTH",
        monthLabel,
        safeFilePart(employeeMeta.matricola),
        safeFilePart(employeeMeta.cognome),
        safeFilePart(employeeMeta.nome),
      ].join("_");
    }

    items.push({ baseName, png });
  }

  return { ok: true, items, mode, labelRange };
}
