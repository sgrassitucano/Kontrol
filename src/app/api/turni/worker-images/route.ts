import { NextResponse } from "next/server";
import JSZip from "jszip";
import sharp from "sharp";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

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
  sub_sites: unknown;
};

function escapeXml(value: string) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

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

function stateLabel(state: ShiftState) {
  if (state === "actual") return "CONSUNTIVO";
  if (state === "cancelled") return "ANNULLATO";
  return "PREVENTIVO";
}

function stateColor(state: ShiftState) {
  if (state === "actual") return "#047857";
  if (state === "cancelled") return "#6b7280";
  return "#1d4ed8";
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

function buildWorkerWeekSvg(args: {
  weekStart: string;
  worker: { matricola: string; cognome: string; nome: string };
  rowsByDay: Array<{
    dayIso: string;
    lines: Array<{ text: string; state: ShiftState; cancelled: boolean }>;
  }>;
}) {
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

  let y = 56;

  const title = "Turni settimanali";
  const sub = `${args.worker.cognome} ${args.worker.nome} (${args.worker.matricola})`;
  const range = `${isoToItDate(args.weekStart)} — ${isoToItDate(addDaysIso(args.weekStart, 6))}`;

  let svg = "";
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;
  svg += `<text x="${paddingX}" y="${y}" font-family="Arial, sans-serif" font-size="${titleFont}" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>`;
  y += 50;
  svg += `<text x="${paddingX}" y="${y}" font-family="Arial, sans-serif" font-size="${headerFont}" font-weight="600" fill="#0f172a">${escapeXml(sub)}</text>`;
  y += 36;
  svg += `<text x="${paddingX}" y="${y}" font-family="Arial, sans-serif" font-size="${smallFont}" fill="#475569">Settimana: ${escapeXml(range)}</text>`;
  y += 34;

  svg += `<line x1="${paddingX}" x2="${width - paddingX}" y1="${y}" y2="${y}" stroke="#e2e8f0" stroke-width="2"/>`;
  y += 30;

  args.rowsByDay.forEach((dayBlock, idx) => {
    const dayTitle = `${weekdayLabelMon0(idx)} ${isoToItDate(dayBlock.dayIso)}`;
    svg += `<text x="${paddingX}" y="${y}" font-family="Arial, sans-serif" font-size="${rowFont}" font-weight="700" fill="#1e293b">${escapeXml(dayTitle)}</text>`;
    y += lineH;

    const lines = dayBlock.lines.length > 0 ? dayBlock.lines : [{ text: "—", state: "planned" as const, cancelled: false }];
    lines.forEach((line) => {
      const fill = stateColor(line.state);
      const deco = line.cancelled ? ' text-decoration="line-through"' : "";
      svg += `<text x="${paddingX}" y="${y}" font-family="Arial, sans-serif" font-size="${rowFont}" fill="#0f172a"${deco}>${escapeXml(line.text)}</text>`;
      svg += `<text x="${width - paddingX}" y="${y}" font-family="Arial, sans-serif" font-size="${smallFont}" font-weight="700" fill="${fill}" text-anchor="end">${escapeXml(stateLabel(line.state))}</text>`;
      y += lineH;
    });

    svg += `<line x1="${paddingX}" x2="${width - paddingX}" y1="${y - 18}" y2="${y - 18}" stroke="#f1f5f9" stroke-width="2"/>`;
  });

  svg += `</svg>`;
  return svg;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const weekStartParam = url.searchParams.get("weekStart");
    const siteId = Number(url.searchParams.get("siteId") ?? "");
    const subSiteIdParam = url.searchParams.get("subSiteId");
    const subSiteId = subSiteIdParam ? Number(subSiteIdParam) : null;
    const format = (url.searchParams.get("format") ?? "jpg").toLowerCase();

    if (!weekStartParam) return NextResponse.json({ error: "weekStart mancante." }, { status: 400 });
    const parsed = parseIsoDateOnly(weekStartParam);
    if (!parsed) return NextResponse.json({ error: "weekStart non valido (YYYY-MM-DD)." }, { status: 400 });
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    if (subSiteIdParam && !Number.isFinite(subSiteId))
      return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });
    if (format !== "jpg" && format !== "png") return NextResponse.json({ error: "format non valido." }, { status: 400 });

    const start = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0, 0));
    const endIso = addDaysIso(parsed.iso, 7);
    const endParsed = parseIsoDateOnly(endIso)!;
    const end = new Date(Date.UTC(endParsed.y, endParsed.m - 1, endParsed.d, 0, 0, 0, 0));

    let q = auth.supabase
      .from("turni_employee_shifts")
      .select(
        "id,employee_id,site_id,sub_site_id,start_at,end_at,state,note,employees(matricola,first_name,last_name),sites(display_name),sub_sites(display_name)",
      )
      .gte("start_at", start.toISOString())
      .lt("start_at", end.toISOString())
      .eq("site_id", siteId)
      .order("employee_id")
      .order("start_at");

    if (typeof subSiteId === "number" && Number.isFinite(subSiteId)) q = q.eq("sub_site_id", subSiteId);
    else q = q.is("sub_site_id", null);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const shifts = (data ?? []) as ShiftRow[];

    const byEmployee = new Map<number, ShiftRow[]>();
    shifts.forEach((s) => {
      const list = byEmployee.get(s.employee_id) ?? [];
      list.push(s);
      byEmployee.set(s.employee_id, list);
    });

    const weekDays = Array.from({ length: 7 }, (_, i) => addDaysIso(parsed.iso, i));

    const zip = new JSZip();
    let count = 0;

    for (const [, list] of byEmployee.entries()) {
      const employeeMeta = extractEmployeeMeta(list[0]?.employees);
      const rowsByDay = weekDays.map((dayIso) => {
        const dayShifts = list.filter((s) => s.start_at.slice(0, 10) === dayIso);
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
            state: s.state,
            cancelled: s.state === "cancelled",
          };
        });
        return { dayIso, lines };
      });

      const svg = buildWorkerWeekSvg({
        weekStart: parsed.iso,
        worker: employeeMeta,
        rowsByDay,
      });

      const baseName = [
        "TURNI",
        parsed.iso,
        addDaysIso(parsed.iso, 6),
        safeFilePart(employeeMeta.matricola),
        safeFilePart(employeeMeta.cognome),
        safeFilePart(employeeMeta.nome),
      ].join("_");

      const fileName = `${baseName}.${format === "png" ? "png" : "jpg"}`;
      const image =
        format === "png"
          ? await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
          : await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();

      zip.file(fileName, image);
      count += 1;
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const body = new Uint8Array(buffer);

    const suffix = typeof subSiteId === "number" ? `sub_${subSiteId}` : "site";
    const zipName = `turni_wa_${parsed.iso}_${suffix}_${siteId}.zip`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
        "X-Exported-Count": String(count),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore export immagini." },
      { status: 500 },
    );
  }
}
