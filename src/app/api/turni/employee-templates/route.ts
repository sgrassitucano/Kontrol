import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

type SlotPayload = {
  weekday: number;
  siteId: number;
  subSiteId?: number | null;
  startTime: string;
  endTime: string;
  breakMinutes?: number;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseIsoDate(value: unknown) {
  const v = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function parseTime(value: unknown) {
  const v = normalizeText(value);
  if (!/^\d{2}:\d{2}$/.test(v)) return null;
  return v;
}

async function resolveValidatedSubSiteId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  siteId: number,
  subSiteIdInput: unknown,
) {
  const raw = subSiteIdInput === undefined ? null : subSiteIdInput;
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
    if (!Number.isFinite(subSiteId)) throw new Error("subSiteId non valido.");
    const { data: match, error: matchError } = await supabase
      .from("sub_sites")
      .select("id")
      .eq("id", subSiteId)
      .eq("site_id", siteId)
      .limit(1);
    if (matchError) throw new Error(matchError.message);
    if ((match ?? []).length === 0) throw new Error("Sottocantiere non valido per il cantiere selezionato.");
    return subSiteId;
  }

  if (subSiteId === null || !Number.isFinite(subSiteId)) {
    throw new Error("Se il cantiere ha sottocantieri, il sottocantiere è obbligatorio.");
  }

  const { data: match, error: matchError } = await supabase
    .from("sub_sites")
    .select("id")
    .eq("id", subSiteId)
    .eq("site_id", siteId)
    .limit(1);
  if (matchError) throw new Error(matchError.message);
  if ((match ?? []).length === 0) throw new Error("Sottocantiere non valido per il cantiere selezionato.");
  return subSiteId;
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const employeeId = Number(url.searchParams.get("employeeId") ?? "");
    const date = url.searchParams.get("date");
    if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });

    const refDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    const supabase = auth.supabase;

    let query = supabase
      .from("turni_employee_templates")
      .select("id,employee_id,name,valid_from,valid_to,is_active")
      .eq("employee_id", employeeId)
      .eq("is_active", true)
      .order("valid_from", { ascending: false })
      .limit(10);

    if (refDate) {
      query = query.lte("valid_from", refDate).or(`valid_to.is.null,valid_to.gte.${refDate}`);
    }

    const { data: templates, error: templatesError } = await query;
    if (templatesError) throw new Error(templatesError.message);
    const template = (templates ?? [])[0] as
      | { id: number; name: string; valid_from: string; valid_to: string | null }
      | undefined;

    if (!template) return NextResponse.json({ template: null, slots: [] });

    const { data: slots, error: slotsError } = await supabase
      .from("turni_employee_template_slots")
      .select("id,weekday,site_id,sub_site_id,start_time,end_time,break_minutes")
      .eq("template_id", template.id)
      .order("weekday")
      .order("start_time");
    if (slotsError) throw new Error(slotsError.message);

    return NextResponse.json({
      template: {
        id: template.id,
        employeeId,
        name: template.name,
        validFrom: template.valid_from,
        validTo: template.valid_to,
      },
      slots: (slots ?? []).map((s) => ({
        id: (s as { id: number }).id,
        weekday: (s as { weekday: number }).weekday,
        siteId: (s as { site_id: number }).site_id,
        subSiteId: (s as { sub_site_id: number | null }).sub_site_id,
        startTime: (s as { start_time: string }).start_time.slice(0, 5),
        endTime: (s as { end_time: string }).end_time.slice(0, 5),
        breakMinutes: (s as { break_minutes: number }).break_minutes ?? 0,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento template lavoratore." },
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
      name: string;
      validFrom: string;
      validTo?: string | null;
      slots: SlotPayload[];
    };

    const employeeId = Number(body.employeeId);
    if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });

    const name = normalizeText(body.name);
    if (!name) return NextResponse.json({ error: "Nome template mancante." }, { status: 400 });

    const validFrom = parseIsoDate(body.validFrom);
    const validTo = body.validTo ? parseIsoDate(body.validTo) : null;
    if (!validFrom) return NextResponse.json({ error: "validFrom non valido." }, { status: 400 });
    if (body.validTo && !validTo) return NextResponse.json({ error: "validTo non valido." }, { status: 400 });

    const { data: inserted, error: insertError } = await supabase
      .from("turni_employee_templates")
      .insert({
        employee_id: employeeId,
        name,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        created_by: auth.userId,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);
    const templateId = (inserted as { id: number }).id;

    const slots = Array.isArray(body.slots) ? body.slots : [];
    const payload = [];
    for (const s of slots) {
      const weekday = Number(s.weekday);
      const siteId = Number(s.siteId);
      if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) continue;
      if (!Number.isFinite(siteId)) continue;
      const startTime = parseTime(s.startTime);
      const endTime = parseTime(s.endTime);
      if (!startTime || !endTime) continue;
      const subSiteId = await resolveValidatedSubSiteId(supabase, siteId, s.subSiteId);
      payload.push({
        template_id: templateId,
        weekday,
        site_id: siteId,
        sub_site_id: subSiteId,
        start_time: startTime,
        end_time: endTime,
        break_minutes: typeof s.breakMinutes === "number" ? s.breakMinutes : 0,
      });
    }
    if (payload.length > 0) {
      const { error: slotsError } = await supabase.from("turni_employee_template_slots").insert(payload);
      if (slotsError) throw new Error(slotsError.message);
    }

    return NextResponse.json({ id: templateId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore creazione template lavoratore." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = auth.supabase;
    const body = (await request.json()) as {
      templateId: number;
      name?: string;
      validFrom?: string;
      validTo?: string | null;
      isActive?: boolean;
      slots?: Array<SlotPayload & { id?: number }>;
    };

    const templateId = Number(body.templateId);
    if (!Number.isFinite(templateId)) return NextResponse.json({ error: "templateId non valido." }, { status: 400 });

    const updatePayload: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = normalizeText(body.name);
      if (!name) return NextResponse.json({ error: "Nome template mancante." }, { status: 400 });
      updatePayload.name = name;
    }
    if (typeof body.validFrom === "string") {
      const v = parseIsoDate(body.validFrom);
      if (!v) return NextResponse.json({ error: "validFrom non valido." }, { status: 400 });
      updatePayload.valid_from = v;
    }
    if (typeof body.validTo === "string" || body.validTo === null) {
      const v = body.validTo ? parseIsoDate(body.validTo) : null;
      if (body.validTo && !v) return NextResponse.json({ error: "validTo non valido." }, { status: 400 });
      updatePayload.valid_to = v;
    }
    if (typeof body.isActive === "boolean") updatePayload.is_active = body.isActive;

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase.from("turni_employee_templates").update(updatePayload).eq("id", templateId);
      if (updateError) throw new Error(updateError.message);
    }

    if (Array.isArray(body.slots)) {
      const slotsPayload = [];
      for (const s of body.slots) {
        const weekday = Number(s.weekday);
        const siteId = Number(s.siteId);
        if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) continue;
        if (!Number.isFinite(siteId)) continue;
        const startTime = parseTime(s.startTime);
        const endTime = parseTime(s.endTime);
        if (!startTime || !endTime) continue;
        const subSiteId = await resolveValidatedSubSiteId(supabase, siteId, s.subSiteId);
        slotsPayload.push({
          weekday,
          site_id: siteId,
          sub_site_id: subSiteId,
          start_time: startTime,
          end_time: endTime,
          break_minutes: typeof s.breakMinutes === "number" ? s.breakMinutes : 0,
        });
      }

      const { error: replaceError } = await supabase.rpc("turni_replace_employee_template_slots", {
        template_id: templateId,
        slots: slotsPayload,
      });
      if (replaceError) throw new Error(replaceError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore aggiornamento template lavoratore." },
      { status: 500 },
    );
  }
}
