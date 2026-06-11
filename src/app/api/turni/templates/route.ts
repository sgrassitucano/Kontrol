import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

class MissingRpcError extends Error {
  status = 503;
}

type SlotPayload = {
  weekday: number;
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

function isTemplateSlotPayload(value: {
  weekday: number;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
}): value is { weekday: number; start_time: string; end_time: string; break_minutes: number } {
  return Number.isFinite(value.weekday) && Boolean(value.start_time) && Boolean(value.end_time);
}

async function replaceTemplateSlotsAtomic(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  templateId: number;
  slots: Array<{ weekday: number; start_time: string; end_time: string; break_minutes: number }>;
}) {
  const { supabase, templateId, slots } = args;
  const { error } = await supabase.rpc("turni_replace_site_template_slots", {
    template_id: templateId,
    slots,
  });
  if (!error) return;
  const msg = String((error as { message?: unknown } | null)?.message ?? "");
  if (/turni_replace_site_template_slots/i.test(msg)) {
    throw new MissingRpcError("RPC turni_replace_site_template_slots non disponibile. Applicare patch DB.");
  }
  throw new Error(msg || "Errore aggiornamento slot template.");
}

async function resolveValidatedSubSiteIdForTemplate(
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
    const siteId = Number(url.searchParams.get("siteId") ?? "");
    const subSiteIdParam = url.searchParams.get("subSiteId");
    const date = url.searchParams.get("date");
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });

    const refDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;

    const supabase = auth.supabase;
    const subSiteId = await resolveValidatedSubSiteIdForTemplate(supabase, siteId, subSiteIdParam);
    let query = supabase
      .from("turni_site_templates")
      .select("id,site_id,sub_site_id,name,valid_from,valid_to,is_active")
      .eq("site_id", siteId)
      .is("sub_site_id", subSiteId)
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

    if (!template) {
      return NextResponse.json({ template: null, slots: [] });
    }

    const { data: slots, error: slotsError } = await supabase
      .from("turni_site_template_slots")
      .select("id,weekday,start_time,end_time,break_minutes")
      .eq("template_id", template.id)
      .order("weekday")
      .order("start_time");
    if (slotsError) throw new Error(slotsError.message);

    return NextResponse.json({
      template: {
        id: template.id,
        siteId,
        subSiteId,
        name: template.name,
        validFrom: template.valid_from,
        validTo: template.valid_to,
      },
      slots: (slots ?? []).map((s) => ({
        id: (s as { id: number }).id,
        weekday: (s as { weekday: number }).weekday,
        startTime: (s as { start_time: string }).start_time.slice(0, 5),
        endTime: (s as { end_time: string }).end_time.slice(0, 5),
        breakMinutes: (s as { break_minutes: number }).break_minutes ?? 0,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento template." },
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
      siteId: number;
      subSiteId?: number | null;
      name: string;
      validFrom: string;
      validTo?: string | null;
      slots: SlotPayload[];
    };

    const siteId = Number(body.siteId);
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });

    const subSiteId = await resolveValidatedSubSiteIdForTemplate(supabase, siteId, body.subSiteId);

    const name = normalizeText(body.name);
    if (!name) return NextResponse.json({ error: "Nome template mancante." }, { status: 400 });

    const validFrom = parseIsoDate(body.validFrom);
    const validTo = body.validTo ? parseIsoDate(body.validTo) : null;
    if (!validFrom) return NextResponse.json({ error: "validFrom non valido." }, { status: 400 });
    if (body.validTo && !validTo) return NextResponse.json({ error: "validTo non valido." }, { status: 400 });

    const { data: inserted, error: insertError } = await supabase
      .from("turni_site_templates")
      .insert({
        site_id: siteId,
        sub_site_id: subSiteId,
        name,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    const templateId = (inserted as { id: number }).id;
    const slots = Array.isArray(body.slots) ? body.slots : [];
    const payload = slots
      .map((s) => ({
        template_id: templateId,
        weekday: Number(s.weekday),
        start_time: parseTime(s.startTime),
        end_time: parseTime(s.endTime),
        break_minutes: typeof s.breakMinutes === "number" ? s.breakMinutes : 0,
      }))
      .filter((s) => Number.isFinite(s.weekday) && s.start_time && s.end_time);

    if (payload.length > 0) {
      const { error: slotsError } = await supabase.from("turni_site_template_slots").insert(payload);
      if (slotsError) throw new Error(slotsError.message);
    }

    return NextResponse.json({ id: templateId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore creazione template." },
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
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: "templateId non valido." }, { status: 400 });
    }

    const { data: templateMeta, error: templateMetaError } = await supabase
      .from("turni_site_templates")
      .select("id,site_id,sub_site_id")
      .eq("id", templateId)
      .limit(1)
      .single();
    if (templateMetaError) throw new Error(templateMetaError.message);

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
    if (typeof body.isActive === "boolean") {
      updatePayload.is_active = body.isActive;
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase.from("turni_site_templates").update(updatePayload).eq("id", templateId);
      if (updateError) throw new Error(updateError.message);
    }

    if (Array.isArray(body.slots)) {
      const siteId = (templateMeta as { site_id: number }).site_id;
      const subSiteId = (templateMeta as { sub_site_id: number | null }).sub_site_id;
      const _validated = await resolveValidatedSubSiteIdForTemplate(supabase, siteId, subSiteId);
      if (_validated !== subSiteId) {
        return NextResponse.json({ error: "Template incoerente con il perimetro selezionato." }, { status: 400 });
      }

      const slotsPayload = body.slots
        .map((s) => ({
          weekday: Number(s.weekday),
          start_time: parseTime(s.startTime),
          end_time: parseTime(s.endTime),
          break_minutes: typeof s.breakMinutes === "number" ? s.breakMinutes : 0,
        }))
        .filter(isTemplateSlotPayload);

      await replaceTemplateSlotsAtomic({ supabase, templateId, slots: slotsPayload });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MissingRpcError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore aggiornamento template." },
      { status: 500 },
    );
  }
}
