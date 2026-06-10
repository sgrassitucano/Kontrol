import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type ShiftState = "planned" | "actual" | "cancelled";
type ShiftSource = "template" | "manual" | "import";

class ClientError extends Error {}
class MissingRpcError extends Error {}

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
  created_by: string | null;
  employees: unknown;
  sites: unknown;
};

type BreakRow = { id: number; shift_id: number; break_start_at: string; break_end_at: string };

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

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseIsoDate(value: unknown) {
  const v = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function isQuarterHour(date: Date) {
  if (!Number.isFinite(date.getTime())) return false;
  return date.getSeconds() === 0 && date.getMilliseconds() === 0 && date.getMinutes() % 15 === 0;
}

function normalizeAndValidateBreaks(args: {
  breaks: unknown;
  shiftStart: Date;
  shiftEnd: Date;
}) {
  const { breaks, shiftStart, shiftEnd } = args;
  if (!Array.isArray(breaks)) return [] as Array<{ start: Date; end: Date }>;

  const parsed = breaks
    .map((b) => ({
      start: new Date((b as { startAt?: unknown }).startAt as string),
      end: new Date((b as { endAt?: unknown }).endAt as string),
    }))
    .filter((b) => Number.isFinite(b.start.getTime()) && Number.isFinite(b.end.getTime()));

  for (const b of parsed) {
    if (b.end <= b.start) throw new ClientError("Pausa non valida (fine <= inizio).");
    if (!isQuarterHour(b.start) || !isQuarterHour(b.end)) throw new ClientError("Pause ammesse solo a quarti d'ora.");
    if (b.start < shiftStart || b.end > shiftEnd) throw new ClientError("Le pause devono stare dentro l'orario del turno.");
  }

  parsed.sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < parsed.length; i += 1) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    if (!prev || !cur) continue;
    if (cur.start < prev.end) throw new ClientError("Le pause non possono sovrapporsi.");
  }

  return parsed;
}

async function replaceBreaksAtomic(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  shiftId: number;
  breaks: Array<{ start: Date; end: Date }>;
}) {
  const { supabase, shiftId, breaks } = args;
  const payload = breaks.map((b) => ({
    start_at: b.start.toISOString(),
    end_at: b.end.toISOString(),
  }));

  const { error } = await supabase.rpc("turni_replace_shift_breaks", {
    shift_id: shiftId,
    breaks: payload,
  });
  if (!error) return;
  const msg = String((error as { message?: unknown } | null)?.message ?? "");
  if (/turni_replace_shift_breaks/i.test(msg)) {
    throw new MissingRpcError("RPC turni_replace_shift_breaks non disponibile. Applicare patch DB.");
  }
  if (msg) {
    throw new Error(msg || "Errore aggiornamento pause.");
  }
  throw new Error("Errore aggiornamento pause.");
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseLimitParam(value: string | null, fallback = 500) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 1000);
}

async function resolveValidatedSubSiteId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  siteId: number,
  subSiteIdInput: unknown,
) {
  const hasValue = subSiteIdInput !== undefined;
  const raw = hasValue ? subSiteIdInput : null;
  const subSiteId = raw === null || raw === "" ? null : Number(raw);

  const { data: anySubSites, error: anySubSitesError } = await supabase
    .from("sub_sites")
    .select("id")
    .eq("site_id", siteId)
    .limit(1);
  if (anySubSitesError) throw new Error(anySubSitesError.message);
  const siteHasSubSites = (anySubSites ?? []).length > 0;

  if (!siteHasSubSites) {
    if (subSiteId === null) return null;
    if (!Number.isFinite(subSiteId)) throw new ClientError("subSiteId non valido.");
    const { data: match, error: matchError } = await supabase
      .from("sub_sites")
      .select("id")
      .eq("id", subSiteId)
      .eq("site_id", siteId)
      .limit(1);
    if (matchError) throw new Error(matchError.message);
    if ((match ?? []).length === 0) throw new ClientError("Sottocantiere non valido per il cantiere selezionato.");
    return subSiteId;
  }

  if (subSiteId === null || !Number.isFinite(subSiteId)) {
    throw new ClientError("Se il cantiere ha sottocantieri, il sottocantiere è obbligatorio.");
  }

  const { data: match, error: matchError } = await supabase
    .from("sub_sites")
    .select("id")
    .eq("id", subSiteId)
    .eq("site_id", siteId)
    .limit(1);
  if (matchError) throw new Error(matchError.message);
  if ((match ?? []).length === 0) throw new ClientError("Sottocantiere non valido per il cantiere selezionato.");
  return subSiteId;
}

async function ensureNotLocked(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const { data, error } = await supabase
    .from("turni_month_locks")
    .select("id")
    .eq("year", year)
    .eq("month", month)
    .limit(1);
  if (error) throw new Error(error.message);
  if ((data ?? []).length > 0) {
    throw new Error(`Mese bloccato: ${String(month).padStart(2, "0")}/${year}.`);
  }
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const siteIdParam = url.searchParams.get("siteId");
    const subSiteIdParam = url.searchParams.get("subSiteId");
    const employeeIdParam = url.searchParams.get("employeeId");
    const limit = parseLimitParam(url.searchParams.get("limit"));
    const startDate = parseIsoDate(url.searchParams.get("startDate"));
    const endDate = parseIsoDate(url.searchParams.get("endDate"));

    const siteId = siteIdParam ? Number(siteIdParam) : null;
    const subSiteId = subSiteIdParam ? Number(subSiteIdParam) : null;
    const employeeId = employeeIdParam ? Number(employeeIdParam) : null;

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate/endDate non validi." }, { status: 400 });
    }

    const startAt = new Date(`${startDate}T00:00:00`);
    const endAt = new Date(`${endDate}T23:59:59`);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      return NextResponse.json({ error: "Range date non valido." }, { status: 400 });
    }
    const maxSpanMs = 1000 * 60 * 60 * 24 * 62;
    if (endAt.getTime() - startAt.getTime() > maxSpanMs) {
      return NextResponse.json({ error: "Intervallo troppo ampio. Massimo 62 giorni." }, { status: 400 });
    }

    const supabase = auth.supabase;
    let query = supabase
      .from("turni_employee_shifts")
      .select(
        "id,employee_id,site_id,sub_site_id,start_at,end_at,state,source,note,created_by,employees(id,matricola,first_name,last_name),sites(id,display_name)",
      )
      .lt("start_at", endAt.toISOString())
      .gt("end_at", startAt.toISOString())
      .order("start_at")
      .limit(limit + 1);

    if (typeof siteId === "number" && Number.isFinite(siteId)) query = query.eq("site_id", siteId);
    if (typeof subSiteId === "number" && Number.isFinite(subSiteId)) query = query.eq("sub_site_id", subSiteId);
    if (typeof employeeId === "number" && Number.isFinite(employeeId)) query = query.eq("employee_id", employeeId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const shifts = ((data ?? []) as ShiftRow[]).slice(0, limit);
    const truncated = (data ?? []).length > limit;

    const subSiteIds = Array.from(new Set(shifts.map((s) => s.sub_site_id).filter((v): v is number => typeof v === "number")));
    const subSitesById = new Map<number, string>();
    if (subSiteIds.length > 0) {
      const { data: subSitesData, error: subSitesError } = await supabase
        .from("sub_sites")
        .select("id,display_name")
        .in("id", subSiteIds);
      if (subSitesError) throw new Error(subSitesError.message);
      for (const s of (subSitesData ?? []) as Array<{ id: number; display_name: string }>) {
        subSitesById.set(s.id, s.display_name);
      }
    }

    const ids = shifts.map((s) => s.id);
    const breaksByShiftId = new Map<number, BreakRow[]>();
    if (ids.length > 0) {
      const { data: breaks, error: breaksError } = await supabase
        .from("turni_shift_breaks")
        .select("id,shift_id,break_start_at,break_end_at")
        .in("shift_id", ids)
        .order("break_start_at");
      if (breaksError) throw new Error(breaksError.message);
      for (const b of (breaks ?? []) as BreakRow[]) {
        const list = breaksByShiftId.get(b.shift_id) ?? [];
        list.push(b);
        breaksByShiftId.set(b.shift_id, list);
      }
    }

    const createdByIds = Array.from(
      new Set(shifts.map((s) => s.created_by).filter((v): v is string => typeof v === "string" && v.length > 0)),
    );
    const createdByName = new Map<string, string>();
    if (createdByIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id,full_name,email")
        .in("id", createdByIds);
      if (profilesError) throw new Error(profilesError.message);
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
        const name = normalizeText(p.full_name) || normalizeText(p.email) || "-";
        createdByName.set(p.id, name);
      }
    }

    return NextResponse.json({
      limit,
      truncated,
      rows: shifts.map((s) => ({
        id: s.id,
        employeeId: s.employee_id,
        employeeLabel: extractDisplayName(s.employees),
        siteId: s.site_id,
        siteLabel: extractDisplayName(s.sites),
        subSiteId: s.sub_site_id,
        subSiteLabel: s.sub_site_id ? (subSitesById.get(s.sub_site_id) ?? "-") : "-",
        startAt: s.start_at,
        endAt: s.end_at,
        state: s.state,
        source: s.source,
        note: s.note ?? "",
        createdByName: s.created_by ? (createdByName.get(s.created_by) ?? "-") : "-",
        updatedByName: s.created_by ? (createdByName.get(s.created_by) ?? "-") : "-",
        breaks: (breaksByShiftId.get(s.id) ?? []).map((b) => ({
          id: b.id,
          startAt: b.break_start_at,
          endAt: b.break_end_at,
        })),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento turni." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      employeeId: number;
      siteId: number;
      subSiteId?: number | null;
      startAt: string;
      endAt: string;
      state?: ShiftState;
      source?: ShiftSource;
      note?: string;
      breaks?: Array<{ startAt: string; endAt: string }>;
    };

    const employeeId = Number(body.employeeId);
    const siteId = Number(body.siteId);
    if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });

    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      return NextResponse.json({ error: "startAt/endAt non validi." }, { status: 400 });
    }
    if (endAt <= startAt) return NextResponse.json({ error: "Orario non valido (fine <= inizio)." }, { status: 400 });
    if (!isQuarterHour(startAt) || !isQuarterHour(endAt)) {
      return NextResponse.json({ error: "Orari ammessi solo a quarti d'ora." }, { status: 400 });
    }

    const normalizedBreaks = normalizeAndValidateBreaks({ breaks: body.breaks, shiftStart: startAt, shiftEnd: endAt });

    const months = new Set([monthKey(startAt), monthKey(endAt)]);
    for (const m of months) {
      const [y, mm] = m.split("-").map((x) => Number(x));
      await ensureNotLocked(supabase, new Date(`${y}-${String(mm).padStart(2, "0")}-01T00:00:00`));
    }

    const state: ShiftState = body.state ?? "planned";
    const source: ShiftSource = body.source ?? "manual";
    const note = normalizeText(body.note) || null;
    const subSiteId = await resolveValidatedSubSiteId(supabase, siteId, body.subSiteId);

    const { data: inserted, error: insertError } = await supabase
      .from("turni_employee_shifts")
      .insert({
        employee_id: employeeId,
        site_id: siteId,
        sub_site_id: subSiteId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        state,
        source,
        note,
        created_by: auth.userId,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);
    const shiftId = (inserted as { id: number }).id;

    if (normalizedBreaks.length > 0) {
      try {
        await replaceBreaksAtomic({ supabase, shiftId, breaks: normalizedBreaks });
      } catch (err) {
        await supabase.from("turni_employee_shifts").update({ state: "cancelled" }).eq("id", shiftId);
        throw err;
      }
    }

    return NextResponse.json({ id: shiftId });
  } catch (err) {
    const status = err instanceof ClientError ? 400 : err instanceof MissingRpcError ? 503 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore creazione turno." },
      { status },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      shiftId: number;
      employeeId?: number;
      siteId?: number;
      subSiteId?: number | null;
      startAt?: string;
      endAt?: string;
      state?: ShiftState;
      note?: string;
      breaks?: Array<{ startAt: string; endAt: string }>;
    };

    const shiftId = Number(body.shiftId);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "shiftId non valido." }, { status: 400 });

    const { data: current, error: currentError } = await supabase
      .from("turni_employee_shifts")
      .select("id,employee_id,site_id,sub_site_id,start_at,end_at,source")
      .eq("id", shiftId)
      .single();
    if (currentError) throw new Error(currentError.message);

    const currentSource = (current as { source: "template" | "manual" | "import" }).source;
    const currentSiteId = (current as { site_id: number }).site_id;
    const currentSubSiteId = (current as { sub_site_id: number | null }).sub_site_id;
    const currentStart = new Date((current as { start_at: string }).start_at);
    const currentEnd = new Date((current as { end_at: string }).end_at);

    const updatePayload: Record<string, unknown> = {};
    if (typeof body.employeeId === "number") {
      const v = Number(body.employeeId);
      if (!Number.isFinite(v)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
      updatePayload.employee_id = v;
    }
    if (typeof body.siteId === "number") {
      const v = Number(body.siteId);
      if (!Number.isFinite(v)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
      updatePayload.site_id = v;
    }

    const nextSiteId = typeof body.siteId === "number" ? Number(body.siteId) : currentSiteId;
    const nextSubSiteIdInput =
      typeof body.siteId === "number"
        ? "subSiteId" in body
          ? body.subSiteId
          : null
        : "subSiteId" in body
          ? body.subSiteId
          : currentSubSiteId;
    const nextSubSiteId = await resolveValidatedSubSiteId(supabase, nextSiteId, nextSubSiteIdInput);
    if ("subSiteId" in body || typeof body.siteId === "number") updatePayload.sub_site_id = nextSubSiteId;

    const nextStart = typeof body.startAt === "string" ? new Date(body.startAt) : currentStart;
    const nextEnd = typeof body.endAt === "string" ? new Date(body.endAt) : currentEnd;
    if (!Number.isFinite(nextStart.getTime()) || !Number.isFinite(nextEnd.getTime())) {
      return NextResponse.json({ error: "startAt/endAt non validi." }, { status: 400 });
    }
    if (nextEnd <= nextStart) return NextResponse.json({ error: "Orario non valido (fine <= inizio)." }, { status: 400 });
    if (!isQuarterHour(nextStart) || !isQuarterHour(nextEnd)) {
      return NextResponse.json({ error: "Orari ammessi solo a quarti d'ora." }, { status: 400 });
    }

    const normalizedBreaks = Array.isArray(body.breaks)
      ? normalizeAndValidateBreaks({ breaks: body.breaks, shiftStart: nextStart, shiftEnd: nextEnd })
      : [];

    const months = new Set([monthKey(nextStart), monthKey(nextEnd), monthKey(currentStart), monthKey(currentEnd)]);
    for (const m of months) {
      const [y, mm] = m.split("-").map((x) => Number(x));
      await ensureNotLocked(supabase, new Date(`${y}-${String(mm).padStart(2, "0")}-01T00:00:00`));
    }

    if (typeof body.startAt === "string") updatePayload.start_at = nextStart.toISOString();
    if (typeof body.endAt === "string") updatePayload.end_at = nextEnd.toISOString();
    if (typeof body.state === "string") updatePayload.state = body.state;
    if (typeof body.note === "string") updatePayload.note = normalizeText(body.note) || null;

    if (currentSource === "template" && (Object.keys(updatePayload).length > 0 || Array.isArray(body.breaks))) {
      updatePayload.source = "manual";
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase.from("turni_employee_shifts").update(updatePayload).eq("id", shiftId);
      if (updateError) throw new Error(updateError.message);
    }

    if (Array.isArray(body.breaks)) {
      await replaceBreaksAtomic({ supabase, shiftId, breaks: normalizedBreaks });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof ClientError ? 400 : err instanceof MissingRpcError ? 503 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore aggiornamento turno." },
      { status },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const shiftId = Number(url.searchParams.get("shiftId") ?? "");
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "shiftId non valido." }, { status: 400 });

    const supabase = auth.supabase;
    const { data: current, error: currentError } = await supabase
      .from("turni_employee_shifts")
      .select("start_at,end_at")
      .eq("id", shiftId)
      .single();
    if (currentError) throw new Error(currentError.message);

    await ensureNotLocked(supabase, new Date((current as { start_at: string }).start_at));
    await ensureNotLocked(supabase, new Date((current as { end_at: string }).end_at));

    const { error } = await supabase
      .from("turni_employee_shifts")
      .update({ state: "cancelled" })
      .eq("id", shiftId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore annullamento turno." },
      { status: 500 },
    );
  }
}
