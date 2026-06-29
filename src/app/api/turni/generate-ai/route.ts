import { NextResponse } from "next/server";
import { withModuleAccess } from "@/lib/api/with-module-access";
import { AppError } from "@/lib/api/error-handler";
import { shiftGenerateLimiter } from "@/lib/api/rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MAX_ASSIGNMENTS = 5000;
const MAX_EXISTING_SHIFTS = 20000;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseIsoDate(value: unknown) {
  const v = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function ensureMonthsNotLocked(supabase: SupabaseClient, start: Date, end: Date) {
  const months = new Set<string>();
  const cursor = new Date(start);
  cursor.setDate(1);
  while (cursor <= end) {
    months.add(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const m of months) {
    const [yearStr, monthStr] = m.split("-");
    const { data, error } = await supabase
      .from("turni_month_locks")
      .select("id")
      .eq("year", Number(yearStr))
      .eq("month", Number(monthStr))
      .limit(1);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) {
      throw new AppError(400, "MONTH_LOCKED", `Mese bloccato: ${monthStr}/${yearStr}.`);
    }
  }
}

// Verifica se due intervalli temporali si sovrappongono
function isOverlapping(startA: Date, endA: Date, startB: string, endB: string) {
  const sA = startA.getTime();
  const eA = endA.getTime();
  const sB = new Date(bDate(startB)).getTime();
  const eB = new Date(bDate(endB)).getTime();
  if (Number.isNaN(sA) || Number.isNaN(eA) || Number.isNaN(sB) || Number.isNaN(eB)) return false;
  return sA < eB && eA > sB;
}

// Helper per gestire date ISO stabili
function bDate(isoString: string) {
  return isoString.includes("T") ? isoString : `${isoString}T00:00:00`;
}

export const POST = withModuleAccess("turni", true, async (request, context, { supabase, userId }) => {
  // Limitatore di frequenza
  const rl = shiftGenerateLimiter.check(userId);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Troppe richieste di generazione turni. Attendi un momento." },
      { status: 429 }
    );
  }

  try {
    const body = (await request.json()) as {
      siteId: number;
      subSiteId?: number | null;
      startDate: string;
      endDate: string;
    };

    const siteId = Number(body.siteId);
    if (!Number.isFinite(siteId)) throw new AppError(400, "INVALID_PARAM", "siteId non valido.");
    const subSiteId = body.subSiteId === null || body.subSiteId === undefined ? null : Number(body.subSiteId);

    const startDate = parseIsoDate(body.startDate);
    const endDate = parseIsoDate(body.endDate);
    if (!startDate || !endDate) throw new AppError(400, "INVALID_PARAM", "startDate/endDate non validi.");

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    if (end < start) throw new AppError(400, "INVALID_PARAM", "Range date non valido.");

    // Verifica blocchi mese
    await ensureMonthsNotLocked(supabase, start, end);

    // 1. Caricamento del template attivo per il cantiere
    const { data: anySubSites } = await supabase
      .from("sub_sites")
      .select("id")
      .eq("site_id", siteId)
      .limit(1);
    const siteHasSubSites = (anySubSites ?? []).length > 0;

    if (siteHasSubSites && subSiteId === null) {
      throw new AppError(400, "MISSING_SUBSITE", "Seleziona prima un sottocantiere.");
    }

    const { data: templates, error: templateErr } = await supabase
      .from("turni_site_templates")
      .select("id")
      .eq("site_id", siteId)
      .is("sub_site_id", siteHasSubSites ? subSiteId : null)
      .eq("is_active", true)
      .lte("valid_from", startDate)
      .or(`valid_to.is.null,valid_to.gte.${startDate}`)
      .order("valid_from", { ascending: false })
      .limit(1);
    if (templateErr) throw new Error(templateErr.message);

    const templateId = templates?.[0]?.id;
    if (!templateId) {
      throw new AppError(400, "NO_ACTIVE_TEMPLATE", "Nessun template orario attivo trovato per questo cantiere.");
    }

    // Carica le fasce orarie del template
    const { data: slots, error: slotsErr } = await supabase
      .from("turni_site_template_slots")
      .select("weekday,start_time,end_time,break_minutes")
      .eq("template_id", templateId)
      .order("weekday")
      .order("start_time");
    if (slotsErr) throw new Error(slotsErr.message);

    if (!slots || slots.length === 0) {
      throw new AppError(400, "EMPTY_TEMPLATE", "Il template orario non contiene fasce configurate.");
    }

    // 2. Caricamento lavoratori assegnati al cantiere
    const { data: assignments, error: assignErr } = await supabase
      .from("turni_employee_site_assignments")
      .select("employee_id")
      .eq("site_id", siteId)
      .is("sub_site_id", siteHasSubSites ? subSiteId : null)
      .lte("start_date", endDate)
      .or(`end_date.is.null,end_date.gte.${startDate}`);
    if (assignErr) throw new Error(assignErr.message);

    const employeeIds = Array.from(new Set((assignments ?? []).map(a => a.employee_id)));
    if (employeeIds.length === 0) {
      return NextResponse.json({
        ok: true,
        created: 0,
        uncoveredCount: 0,
        skippedEmployees: [],
        message: "Nessun lavoratore assegnato a questo cantiere nel periodo selezionato."
      });
    }

    // 3. Caricamento dati anagrafici e conformità di sicurezza dei lavoratori
    const [employeesRes, trainingRes, medicalRes, absencesRes, existingShiftsRes] = await Promise.all([
      supabase.from("employees").select("id, cognome, nome, status").in("id", employeeIds),
      supabase.from("training_employee_courses").select("employee_id, course_id, stato").in("employee_id", employeeIds),
      supabase.from("medical_surveillance_records").select("employee_id, stato").in("employee_id", employeeIds),
      supabase.from("turni_employee_absences").select("employee_id, start_at, end_at, absence_type").in("employee_id", employeeIds).neq("state", "cancelled"),
      supabase.from("turni_employee_shifts").select("employee_id, start_at, end_at").neq("state", "cancelled").lt("start_at", end.toISOString()).gt("end_at", start.toISOString())
    ]);

    if (employeesRes.error) throw new Error(employeesRes.error.message);
    if (trainingRes.error) throw new Error(trainingRes.error.message);
    if (medicalRes.error) throw new Error(medicalRes.error.message);
    if (absencesRes.error) throw new Error(absencesRes.error.message);
    if (existingShiftsRes.error) throw new Error(existingShiftsRes.error.message);

    const employeesMap = new Map((employeesRes.data ?? []).map(e => [e.id, e]));
    const trainingByEmp = new Map<number, string[]>();
    for (const t of trainingRes.data ?? []) {
      if (t.stato === "scaduto" || t.stato === "da fare") {
        const list = trainingByEmp.get(t.employee_id) ?? [];
        list.push(String(t.course_id));
        trainingByEmp.set(t.employee_id, list);
      }
    }

    const medicalByEmp = new Map((medicalRes.data ?? []).map(m => [m.employee_id, m.stato]));
    const absencesByEmp = new Map<number, typeof absencesRes.data>();
    for (const a of absencesRes.data ?? []) {
      const list = absencesByEmp.get(a.employee_id) ?? [];
      list.push(a);
      absencesByEmp.set(a.employee_id, list);
    }

    // 4. Filtraggio lavoratori per conformità di sicurezza
    const compliantEmployeeIds: number[] = [];
    const skippedReport: Array<{ nominativo: string; motivo: string }> = [];

    for (const id of employeeIds) {
      const emp = employeesMap.get(id);
      if (!emp) continue;
      
      const label = `${emp.cognome} ${emp.nome}`;
      
      // A. Stato in forza
      if (emp.status !== "attivo") {
        skippedReport.push({ nominativo: label, motivo: "Non attivo in forza (dimesso/sospeso)" });
        continue;
      }

      // B. Idoneità Medica
      const medStatus = medicalByEmp.get(id);
      if (medStatus === "scaduto") {
        skippedReport.push({ nominativo: label, motivo: "Idoneità medica scaduta" });
        continue;
      }

      // C. Corsi Formazione Obbligatori
      const expiredCourses = trainingByEmp.get(id) ?? [];
      if (expiredCourses.length > 0) {
        skippedReport.push({ nominativo: label, motivo: `Formazione di sicurezza non conforme (scaduta o da fare)` });
        continue;
      }

      compliantEmployeeIds.push(id);
    }

    if (compliantEmployeeIds.length === 0) {
      return NextResponse.json({
        ok: true,
        created: 0,
        uncoveredCount: slots.length,
        skippedEmployees: skippedReport,
        message: "Nessun lavoratore assegnato è conforme ai requisiti di sicurezza (visite/formazione)."
      });
    }

    // 5. Algoritmo di Assegnazione Turni con Bilanciamento Carico
    // Mappa per contare quanti turni abbiamo assegnato a ciascun lavoratore in questa esecuzione
    const scheduledCountMap = new Map<number, number>(compliantEmployeeIds.map(id => [id, 0]));
    
    // Mappa dei turni già pianificati sul DB in precedenza (per evitare sovrapposizioni dello stesso lavoratore)
    const existingShifts = existingShiftsRes.data ?? [];

    const newShiftsPayload: Array<{
      employee_id: number;
      site_id: number;
      sub_site_id: number | null;
      start_at: string;
      end_at: string;
      state: "planned";
      source: "template";
      note: string | null;
      created_by: string;
    }> = [];

    const uncoveredSlotsReport: Array<{ data: string; giorno: string; orario: string }> = [];

    const weekdayLabels = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

    // Ciclo giorno per giorno nel range
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);

    while (cursor <= endDay) {
      const weekday = (cursor.getDay() + 6) % 7; // Lunedì = 0
      const dayIso = cursor.toISOString().slice(0, 10);
      const daySlots = slots.filter(s => s.weekday === weekday);

      for (const slot of daySlots) {
        const startAt = new Date(`${dayIso}T${slot.start_time.slice(0, 5)}:00`);
        const endAt = new Date(`${dayIso}T${slot.end_time.slice(0, 5)}:00`);
        if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1);

        // Trova i lavoratori disponibili per questa fascia oraria
        const availableWorkers = compliantEmployeeIds.filter(id => {
          // A. Verifica assenze (ferie/malattie)
          const absences = absencesByEmp.get(id) ?? [];
          const hasAbsence = absences.some(abs => isOverlapping(startAt, endAt, abs.start_at, abs.end_at));
          if (hasAbsence) return false;

          // B. Verifica sovrapposizioni con turni già esistenti su DB
          const hasExistingOverlap = existingShifts.some(sh => sh.employee_id === id && isOverlapping(startAt, endAt, sh.start_at, sh.end_at));
          if (hasExistingOverlap) return false;

          // C. Verifica sovrapposizioni con turni generati in questa stessa run
          const hasNewOverlap = newShiftsPayload.some(sh => sh.employee_id === id && isOverlapping(startAt, endAt, sh.start_at, sh.end_at));
          if (hasNewOverlap) return false;

          return true;
        });

        if (availableWorkers.length === 0) {
          uncoveredSlotsReport.push({
            data: dayIso.split("-").reverse().join("/"),
            giorno: weekdayLabels[weekday],
            orario: `${slot.start_time.slice(0, 5)} - ${slot.end_time.slice(0, 5)}`
          });
          continue;
        }

        // Bilanciamento carico: scegliamo il lavoratore con meno turni pianificati finora
        availableWorkers.sort((a, b) => (scheduledCountMap.get(a) ?? 0) - (scheduledCountMap.get(b) ?? 0));
        const selectedWorkerId = availableWorkers[0];

        // Incrementa contatore turni pianificati per il lavoratore
        scheduledCountMap.set(selectedWorkerId, (scheduledCountMap.get(selectedWorkerId) ?? 0) + 1);

        // Aggiungi al payload
        newShiftsPayload.push({
          employee_id: selectedWorkerId,
          site_id: siteId,
          sub_site_id: subSiteId,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          state: "planned",
          source: "template",
          note: "Pianificato da AI Scheduler",
          created_by: userId
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    // 6. Salvataggio effettivo dei turni generati
    if (newShiftsPayload.length > 0) {
      const { error: insertErr } = await supabase.from("turni_employee_shifts").insert(newShiftsPayload);
      if (insertErr) throw new Error(insertErr.message);
    }

    const scheduledList = Array.from(scheduledCountMap.entries())
      .filter(([, count]) => count > 0)
      .map(([id, count]) => {
        const emp = employeesMap.get(id);
        return {
          nominativo: emp ? `${emp.cognome} ${emp.nome}` : `Lavoratore #${id}`,
          turniAssegnati: count
        };
      });

    return NextResponse.json({
      ok: true,
      created: newShiftsPayload.length,
      scheduledEmployees: scheduledList,
      skippedEmployees: skippedReport,
      uncoveredSlots: uncoveredSlotsReport,
      message: `Pianificazione completata. Generati ${newShiftsPayload.length} turni.`
    });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore durante la schedulazione AI." },
      { status: err instanceof AppError ? err.status : 500 }
    );
  }
});
