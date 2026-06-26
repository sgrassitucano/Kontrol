import fs from "node:fs/promises";
import path from "node:path";
import { requireAnyModuleAccess } from "@/lib/api/access";
import { buildFascicoloPdf, type FascicoloWorker } from "@/lib/fascicolo/pdf";
import { resolveCourseState, type CourseStatusRow, type CourseRow } from "@/lib/training/engine";
import { isoToItDate } from "@/lib/it-date";

export const runtime = "nodejs";

const MAX_WORKERS = 200;

const COMPANY = {
  name: "Cooperativa Luigi Morelli",
  line1: "Sede legale: Via di Sottomonte 27, Fraz. Guamo, 55060 Capannori (LU)",
  line2: "C.F./P.IVA 00130460462  ·  REA LU-60482  ·  PEC cooperativamorelli@pec.it  ·  Tel 0583 94801",
};

type EmployeeRow = {
  id: number; matricola: string; first_name: string; last_name: string; tax_code: string;
  birth_date: string | null; birth_place: string | null; job_title: string; responsible_code: string;
  referral: string | null; phone: string | null; mobile: string | null; email_primary: string | null;
  residence_address: string | null; residence_city: string | null; residence_province: string | null;
  residence_postal_code: string | null; status: string; sites: unknown; sub_sites: unknown;
};

function displayName(value: unknown) {
  if (Array.isArray(value)) return (value[0] as { display_name?: string })?.display_name ?? "";
  if (value && typeof value === "object") return (value as { display_name?: string }).display_name ?? "";
  return "";
}

function medicalState(next: string | null, today: string) {
  if (!next) return "da fare";
  if (next < today) return "scaduto";
  if (next <= addDays(today, 30)) return "in scadenza";
  return "idoneo";
}

function dpiState(nextCheck: string | null, delivered: string | null, today: string) {
  if (nextCheck && nextCheck < today) return "scaduto";
  if (nextCheck && nextCheck <= addDays(today, 30)) return "in scadenza";
  if (delivered) return "idoneo";
  return "da consegnare";
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const auth = await requireAnyModuleAccess(["lavoratori", "formazione"], false);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });

  try {
    const body = (await request.json()) as { employeeIds?: unknown };
    const ids = Array.isArray(body.employeeIds)
      ? Array.from(new Set(body.employeeIds.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0)))
      : [];
    if (ids.length === 0) return new Response(JSON.stringify({ error: "Nessun lavoratore selezionato." }), { status: 400 });
    if (ids.length > MAX_WORKERS)
      return new Response(JSON.stringify({ error: `Troppi lavoratori (max ${MAX_WORKERS}).` }), { status: 400 });

    const supabase = auth.supabase;
    const today = new Date().toISOString().slice(0, 10);

    const [empRes, coursesRes, tecRes, medRes, dpiItemsRes, dpiEmpRes] = await Promise.all([
      supabase.from("employees").select(
        "id,matricola,first_name,last_name,tax_code,birth_date,birth_place,job_title,responsible_code,referral,phone,mobile,email_primary,residence_address,residence_city,residence_province,residence_postal_code,status,sites(display_name),sub_sites(display_name)",
      ).in("id", ids),
      supabase.from("training_courses").select("id,code,title,is_active,validity_years,is_unlimited"),
      supabase.from("training_employee_courses").select("employee_id,course_id,completion_date,expiry_date,planned_date,manual_state,note").in("employee_id", ids),
      supabase.from("medical_surveillance_records").select("employee_id,provider,next_due_date,limitations,notes").in("employee_id", ids),
      supabase.from("dpi_items").select("id,title"),
      supabase.from("dpi_employee_items").select("employee_id,dpi_id,delivered_date,next_check_date").in("employee_id", ids),
    ]);

    for (const r of [empRes, coursesRes, tecRes, medRes, dpiItemsRes, dpiEmpRes]) {
      if (r.error) throw new Error(r.error.message);
    }

    const employees = (empRes.data ?? []) as EmployeeRow[];
    const courseMap = new Map<number, CourseRow>(((coursesRes.data ?? []) as CourseRow[]).map((c) => [c.id, c]));
    const dpiTitleMap = new Map<number, string>(((dpiItemsRes.data ?? []) as Array<{ id: number; title: string }>).map((d) => [d.id, d.title]));

    const tecByEmp = new Map<number, CourseStatusRow[]>();
    ((tecRes.data ?? []) as CourseStatusRow[]).forEach((r) => {
      const list = tecByEmp.get(r.employee_id) ?? [];
      list.push(r);
      tecByEmp.set(r.employee_id, list);
    });
    const medByEmp = new Map<number, { provider: string | null; next_due_date: string | null; limitations: string | null; notes: string | null }>();
    ((medRes.data ?? []) as Array<{ employee_id: number; provider: string | null; next_due_date: string | null; limitations: string | null; notes: string | null }>).forEach((r) => medByEmp.set(r.employee_id, r));
    const dpiByEmp = new Map<number, Array<{ dpi_id: number; delivered_date: string | null; next_check_date: string | null }>>();
    ((dpiEmpRes.data ?? []) as Array<{ employee_id: number; dpi_id: number; delivered_date: string | null; next_check_date: string | null }>).forEach((r) => {
      const list = dpiByEmp.get(r.employee_id) ?? [];
      list.push(r);
      dpiByEmp.set(r.employee_id, list);
    });

    // ordina come la lista: cognome, nome
    employees.sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));

    const workers: FascicoloWorker[] = employees.map((e) => {
      const formazione = (tecByEmp.get(e.id) ?? []).map((row) => {
        const course = courseMap.get(row.course_id);
        return {
          corso: course?.title ?? `Corso #${row.course_id}`,
          conclusione: isoToItDate(row.completion_date) || null,
          scadenza: isoToItDate(row.expiry_date) || null,
          stato: resolveCourseState(row, course, undefined, today, 30),
        };
      }).sort((a, b) => a.corso.localeCompare(b.corso));

      const med = medByEmp.get(e.id) ?? null;
      const residence = [e.residence_address, e.residence_city && `${e.residence_city}${e.residence_province ? ` (${e.residence_province})` : ""}`, e.residence_postal_code]
        .filter(Boolean).join(", ");

      return {
        cognome: e.last_name, nome: e.first_name, matricola: e.matricola, taxCode: e.tax_code,
        birthDate: isoToItDate(e.birth_date) || null, birthPlace: e.birth_place ?? "",
        jobTitle: e.job_title, site: displayName(e.sites), subSite: displayName(e.sub_sites),
        responsibleCode: e.responsible_code, referral: e.referral ?? "",
        phone: e.phone || e.mobile || "", email: e.email_primary ?? "", residence, status: e.status,
        formazione,
        visite: med ? {
          stato: medicalState(med.next_due_date, today), scadenza: isoToItDate(med.next_due_date) || null,
          provider: med.provider ?? "", limitazioni: med.limitations ?? "", note: med.notes ?? "",
        } : null,
        dpi: (dpiByEmp.get(e.id) ?? []).map((d) => ({
          dpi: dpiTitleMap.get(d.dpi_id) ?? `DPI #${d.dpi_id}`,
          consegna: isoToItDate(d.delivered_date) || null,
          prossimoControllo: isoToItDate(d.next_check_date) || null,
          stato: dpiState(d.next_check_date, d.delivered_date, today),
        })),
      };
    });

    if (workers.length === 0) return new Response(JSON.stringify({ error: "Nessun lavoratore trovato o accessibile." }), { status: 404 });

    let logo: Uint8Array | undefined;
    try {
      logo = await fs.readFile(path.join(process.cwd(), "public", "logo-morelli.png"));
    } catch {
      logo = undefined;
    }

    const pdf = await buildFascicoloPdf(workers, { logo, company: COMPANY });
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="fascicoli-${today}.pdf"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Errore generazione fascicoli." }), { status: 500 });
  }
}
