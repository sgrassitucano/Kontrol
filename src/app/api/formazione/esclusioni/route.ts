import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/api/access";
import { cacheDeleteByPrefix } from "@/lib/server-cache";

export const runtime = "nodejs";

type ExclusionRequest =
  | {
      kind: "employee";
      employeeId: number;
      enabled: boolean;
      note: string;
    }
  | {
      kind: "course";
      employeeId: number;
      courseId?: number;
      courseCode?: string;
      enabled: boolean;
      note: string;
    };

export async function GET(request: Request) {
  const auth = await requireModuleAccess("formazione", false);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const employeeIdParam = url.searchParams.get("employeeId");
    const employeeId = employeeIdParam ? Number(employeeIdParam) : null;
    if (!employeeId || Number.isNaN(employeeId)) {
      return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    }

    const supabase = auth.supabase;

    const [{ data: employeeRows, error: employeeError }, { data: courseRows, error: courseError }] =
      await Promise.all([
        supabase
          .from("training_employee_exclusions")
          .select("is_active,note")
          .eq("employee_id", employeeId)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("training_employee_course_exclusions")
          .select("course_id,is_active,note")
          .eq("employee_id", employeeId)
          .eq("is_active", true),
      ]);

    if (employeeError) throw new Error(employeeError.message);
    if (courseError) throw new Error(courseError.message);

    const employee = (employeeRows ?? [])[0] as { is_active: boolean; note: string | null } | undefined;
    const activeCourses = new Map<number, string>();
    (courseRows ?? []).forEach((row) => {
      const r = row as { course_id: number; is_active: boolean; note: string | null };
      if (!r.is_active) return;
      activeCourses.set(r.course_id, r.note ?? "");
    });

    const courseIds = Array.from(activeCourses.keys());
    const courseInfoById = new Map<number, { code: string; title: string }>();
    if (courseIds.length > 0) {
      const { data: courseInfo, error: courseInfoError } = await supabase
        .from("training_courses")
        .select("id,code,title")
        .in("id", courseIds);
      if (courseInfoError) throw new Error(courseInfoError.message);
      (courseInfo ?? []).forEach((row) => {
        const r = row as { id: number; code: string; title: string };
        courseInfoById.set(r.id, { code: r.code, title: r.title });
      });
    }

    return NextResponse.json({
      employee: employee ? { isActive: employee.is_active, note: employee.note ?? "" } : { isActive: false, note: "" },
      excludedCourses: Array.from(activeCourses.entries()).map(([courseId, note]) => ({
        courseId,
        courseCode: courseInfoById.get(courseId)?.code ?? "",
        courseTitle: courseInfoById.get(courseId)?.title ?? "",
        note,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore caricamento esclusioni." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as Partial<ExclusionRequest>;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Payload non valido." }, { status: 400 });
    }

    const { kind } = body as { kind?: string };
    const employeeId = Number((body as { employeeId?: unknown }).employeeId);
    if (!employeeId || Number.isNaN(employeeId)) {
      return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    }

    const enabled = Boolean((body as { enabled?: unknown }).enabled);
    const note = String((body as { note?: unknown }).note ?? "");
    const supabase = auth.supabase;
    const userId = auth.userId;

    if (kind === "employee") {
      const { error } = await supabase
        .from("training_employee_exclusions")
        .upsert(
          {
            employee_id: employeeId,
            is_active: enabled,
            note,
            created_by: userId,
          },
          { onConflict: "employee_id" },
        );
      if (error) throw new Error(error.message);
      cacheDeleteByPrefix("training_rows_v1:");
      return NextResponse.json({ ok: true });
    }

    if (kind === "course") {
      const courseIdRaw = (body as { courseId?: unknown }).courseId;
      const courseCodeRaw = String((body as { courseCode?: unknown }).courseCode ?? "").trim();
      let courseId = typeof courseIdRaw === "number" ? courseIdRaw : Number(courseIdRaw);
      if (!courseId || Number.isNaN(courseId)) {
        if (!courseCodeRaw) {
          return NextResponse.json({ error: "courseId/courseCode non valido." }, { status: 400 });
        }
        const { data: course, error: courseError } = await supabase
          .from("training_courses")
          .select("id")
          .eq("code", courseCodeRaw)
          .maybeSingle();
        if (courseError) throw new Error(courseError.message);
        const resolvedId = course ? Number((course as { id: number }).id) : null;
        if (!resolvedId || Number.isNaN(resolvedId)) {
          return NextResponse.json({ error: `Corso non trovato: ${courseCodeRaw}` }, { status: 404 });
        }
        courseId = resolvedId;
      }

      const { error } = await supabase
        .from("training_employee_course_exclusions")
        .upsert(
          {
            employee_id: employeeId,
            course_id: courseId,
            is_active: enabled,
            note,
            created_by: userId,
          },
          { onConflict: "employee_id,course_id" },
        );
      if (error) throw new Error(error.message);
      cacheDeleteByPrefix("training_rows_v1:");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "kind non valido." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore salvataggio esclusione." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireModuleAccess("formazione", true);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = (await request.json()) as Partial<{ kind: string; employeeId: number; courseId: number }>;
    const kind = String(body.kind ?? "").trim();
    const employeeId = Number(body.employeeId);
    const courseId = Number(body.courseId);

    if (kind !== "course") {
      return NextResponse.json({ error: "kind non valido." }, { status: 400 });
    }
    if (!employeeId || Number.isNaN(employeeId)) {
      return NextResponse.json({ error: "employeeId non valido." }, { status: 400 });
    }
    if (!courseId || Number.isNaN(courseId)) {
      return NextResponse.json({ error: "courseId non valido." }, { status: 400 });
    }

    const { error: deleteCourseError } = await auth.supabase
      .from("training_employee_courses")
      .delete()
      .eq("employee_id", employeeId)
      .eq("course_id", courseId);
    if (deleteCourseError) throw new Error(deleteCourseError.message);

    const { error } = await auth.supabase
      .from("training_employee_course_exclusions")
      .delete()
      .eq("employee_id", employeeId)
      .eq("course_id", courseId);
    if (error) throw new Error(error.message);

    cacheDeleteByPrefix("training_rows_v1:");
    return NextResponse.json({ ok: true, deletedCourse: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore eliminazione corso escluso." },
      { status: 500 },
    );
  }
}
