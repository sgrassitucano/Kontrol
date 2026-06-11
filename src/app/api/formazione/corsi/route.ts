import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 20000;

function parseLimitParam(value: string | null, fallback = DEFAULT_LIMIT) {
  if (!value) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(request: Request) {
  const auth = await requireModuleAccess("formazione", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const limit = parseLimitParam(url.searchParams.get("limit"));

    const { data, error } = await auth.supabase
      .from("training_courses")
      .select("id,code,title,is_active")
      .order("code")
      .limit(limit + 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const raw = data ?? [];
    const truncated = raw.length > limit;
    const rows = raw.slice(0, limit);

    return NextResponse.json({
      limit,
      truncated,
      courses: rows.map((row) => ({
        id: Number((row as { id: number }).id),
        code: String((row as { code: string }).code),
        title: String((row as { title: string }).title),
        isActive: Boolean((row as { is_active?: boolean }).is_active),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento corsi." },
      { status: 500 },
    );
  }
}
