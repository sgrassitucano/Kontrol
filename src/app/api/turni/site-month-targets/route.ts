import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

function clampYearMonth(year: number, month: number) {
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("turni", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") ?? "");
    const month = Number(url.searchParams.get("month") ?? "");
    const siteId = Number(url.searchParams.get("siteId") ?? "");
    const subSiteIdParam = url.searchParams.get("subSiteId");
    const subSiteId = subSiteIdParam ? Number(subSiteIdParam) : null;

    const ym = clampYearMonth(year, month);
    if (!ym) return NextResponse.json({ error: "year/month non validi." }, { status: 400 });
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    if (subSiteIdParam && !Number.isFinite(subSiteId))
      return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });

    let q = auth.supabase
      .from("turni_site_month_targets")
      .select("id,year,month,site_id,sub_site_id,theoretical_minutes,note,updated_at")
      .eq("year", ym.year)
      .eq("month", ym.month)
      .eq("site_id", siteId);

    if (typeof subSiteId === "number" && Number.isFinite(subSiteId)) q = q.eq("sub_site_id", subSiteId);
    else q = q.is("sub_site_id", null);

    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      target: data
        ? {
            id: data.id,
            year: data.year,
            month: data.month,
            siteId: data.site_id,
            subSiteId: data.sub_site_id,
            theoreticalMinutes: data.theoretical_minutes,
            note: data.note ?? "",
            updatedAt: data.updated_at,
          }
        : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore lettura target ore." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireModuleAccess("turni", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as {
      year?: number;
      month?: number;
      siteId?: number;
      subSiteId?: number | null;
      theoreticalHours?: number;
      note?: string;
    };

    const ym = clampYearMonth(Number(body.year), Number(body.month));
    if (!ym) return NextResponse.json({ error: "year/month non validi." }, { status: 400 });
    const siteId = Number(body.siteId);
    if (!Number.isFinite(siteId)) return NextResponse.json({ error: "siteId non valido." }, { status: 400 });
    const subSiteId =
      body.subSiteId === null || typeof body.subSiteId === "undefined" ? null : Number(body.subSiteId);
    if (typeof body.subSiteId !== "undefined" && body.subSiteId !== null && !Number.isFinite(subSiteId)) {
      return NextResponse.json({ error: "subSiteId non valido." }, { status: 400 });
    }
    const theoreticalHours = Number(body.theoreticalHours);
    if (!Number.isFinite(theoreticalHours) || theoreticalHours < 0) {
      return NextResponse.json({ error: "theoreticalHours non valido." }, { status: 400 });
    }

    const theoreticalMinutes = Math.round(theoreticalHours * 60);
    const note = String(body.note ?? "").trim();

    const { data, error } = await auth.supabase
      .from("turni_site_month_targets")
      .upsert(
        {
          year: ym.year,
          month: ym.month,
          site_id: siteId,
          sub_site_id: subSiteId,
          theoretical_minutes: theoreticalMinutes,
          note,
          created_by: auth.userId ?? null,
        },
        { onConflict: "year,month,site_id,sub_site_id" },
      )
      .select("id,theoretical_minutes,updated_at")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      target: {
        id: data.id,
        theoreticalMinutes: data.theoretical_minutes,
        updatedAt: data.updated_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore salvataggio target ore." },
      { status: 500 },
    );
  }
}

