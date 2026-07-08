// Motore unico per il calcolo dello stato dei corsi di formazione.
// Fonte di verità condivisa da: schermo (lavoratori/corsi), export e fascicolo PDF.

export type CourseStatusRow = {
  employee_id: number;
  course_id: number;
  completion_date: string | null;
  expiry_date: string | null;
  planned_date: string | null;
  manual_state: "programmato" | "escluso" | null;
  note: string | null;
};

export type CourseRow = {
  id: number;
  code: string;
  title: string;
  is_active: boolean;
  validity_years: number | null;
  is_unlimited: boolean;
};

export type FreezeRow = {
  employee_id: number;
  freeze_status: string;
  start_date: string;
  end_date: string | null;
};

export function normalizeDateOnlyIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseDateOnlyKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const isoLike = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoLike) {
    const y = Number(isoLike[1]);
    const m = Number(isoLike[2]);
    const d = Number(isoLike[3]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;
    return y * 10000 + m * 100 + d;
  }

  const itLike = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (itLike) {
    const d = Number(itLike[1]);
    const m = Number(itLike[2]);
    const y = Number(itLike[3]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;
    return y * 10000 + m * 100 + d;
  }

  return null;
}

export function addDaysKey(todayKey: number, days: number) {
  const y = Math.floor(todayKey / 10000);
  const m = Math.floor((todayKey % 10000) / 100);
  const d = todayKey % 100;
  const base = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(base.getTime())) return todayKey;
  base.setUTCDate(base.getUTCDate() + days);
  const yy = base.getUTCFullYear();
  const mm = base.getUTCMonth() + 1;
  const dd = base.getUTCDate();
  return yy * 10000 + mm * 100 + dd;
}

export function addMonthsKey(dateKey: number, months: number) {
  const y = Math.floor(dateKey / 10000);
  const m = Math.floor((dateKey % 10000) / 100);
  const d = dateKey % 100;
  const total = y * 12 + (m - 1) + months;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const dd = Math.min(d, lastDay);
  return yy * 10000 + mm * 100 + dd;
}

export function todayLocalIso() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isSentinelUnlimitedDate(iso: string) {
  const year = Number(iso.slice(0, 4));
  return year === 2069 || year === 2099;
}

export function computeTheoreticalExpiryIso(completionDateIso: string, validityYears: number) {
  const baseKey = parseDateOnlyKey(completionDateIso);
  if (!baseKey) return null;
  const y = Math.floor(baseKey / 10000);
  const m = Math.floor((baseKey % 10000) / 100);
  const d = baseKey % 100;
  const base = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(base.getTime())) return null;
  const next = new Date(Date.UTC(base.getUTCFullYear() + validityYears, base.getUTCMonth(), base.getUTCDate()));
  return next.toISOString().slice(0, 10);
}

export function resolveCourseState(
  row: CourseStatusRow | undefined,
  course: CourseRow | undefined,
  freeze: FreezeRow | undefined,
  todayIso: string,
  expiringDays: number,
  isUpgrade: boolean = false,
) {
  if (freeze) return "sospeso";

  if (!row) {
    return isUpgrade ? "upgrade" : "da fare";
  }

  if (row.manual_state === "escluso") return "escluso";
  // "programmato" solo se NON ancora concluso: un corso concluso mostra lo stato reale.
  if (row.manual_state === "programmato" && !row.completion_date) return "programmato";
  if (row.planned_date && !row.completion_date) return "programmato";

  if (!row.completion_date) {
    return isUpgrade ? "upgrade" : "da fare";
  }

  const todayKey = parseDateOnlyKey(todayIso) ?? parseDateOnlyKey(todayLocalIso());
  if (!todayKey) return isUpgrade ? "upgrade" : "da fare";
  const thresholdKey = addDaysKey(todayKey, expiringDays);

  if (course?.is_unlimited) return "idoneo";

  let expiryIso = row.expiry_date ? normalizeDateOnlyIso(String(row.expiry_date)) : null;
  if (expiryIso && isSentinelUnlimitedDate(expiryIso)) return "idoneo";

  if (!expiryIso) {
    const years = course?.validity_years;
    if (!years || !Number.isFinite(years) || years <= 0) return isUpgrade ? "upgrade" : "da fare";
    const computed = computeTheoreticalExpiryIso(row.completion_date, years);
    if (!computed) return isUpgrade ? "upgrade" : "da fare";
    expiryIso = computed;
  }

  const expiryKey = parseDateOnlyKey(expiryIso);
  if (!expiryKey) return isUpgrade ? "upgrade" : "da fare";

  if (expiryKey < todayKey) {
    const lostKey = addMonthsKey(expiryKey, 120); // "perso" solo oltre 10 anni dalla scadenza
    if (lostKey < todayKey) return "perso";
    return "scaduto";
  }
  if (expiryKey <= thresholdKey) return "in scadenza";
  return "idoneo";
}

// Gerarchia rischio FORM_SPEC: chi possiede un livello superiore soddisfa
// automaticamente il requisito di un livello inferiore (ALTO copre MEDIO/BASSO).
function formSpecRank(code: string): number {
  if (code === "FORM_SPEC_ALTO") return 3;
  if (code === "FORM_SPEC_MEDIO") return 2;
  if (code === "FORM_SPEC_BASSO") return 1;
  return 0;
}

/**
 * Verifica ricorsivamente se i prerequisiti diretti/transitivi di un corso sono validi
 * per un lavoratore. Usa dati già caricati in memoria (nessuna query DB aggiuntiva).
 * Esempio: PONTEGGIO -> QUOTA_DPI -> FORM_SPEC_ALTO. Se FORM_SPEC_ALTO è scaduto,
 * PONTEGGIO risulta bloccato anche se il proprio completamento non è scaduto.
 * Ritorna il codice del primo prerequisito non valido trovato risalendo la catena, o null.
 */
export function findBrokenPrerequisiteChain(
  courseId: number,
  employeeStatusByCourseId: Map<number, CourseStatusRow>,
  courseMap: Map<number, CourseRow>,
  prerequisitesByFromCourseId: Map<number, Set<number>>,
  todayIso: string,
  visited: Set<number> = new Set(),
): { courseCode: string; courseTitle: string } | null {
  if (visited.has(courseId)) return null;
  visited.add(courseId);

  const prereqIds = prerequisitesByFromCourseId.get(courseId);
  if (!prereqIds || prereqIds.size === 0) return null;

  for (const prereqId of prereqIds) {
    const prereqCourse = courseMap.get(prereqId);
    if (!prereqCourse) continue;

    const requiredRank = formSpecRank(prereqCourse.code);
    let prereqValid: boolean;
    if (requiredRank > 0) {
      // Prerequisito di livello FORM_SPEC: basta possedere QUALSIASI livello
      // pari o superiore (es. ALTO soddisfa un prerequisito MEDIO), non solo
      // esattamente quel corso — altrimenti un mulettista con FORM_SPEC_ALTO
      // risultava "bloccato" per mancanza di FORM_SPEC_MEDIO pur essendo più
      // che coperto nella realtà.
      prereqValid = Array.from(courseMap.entries()).some(([otherId, otherCourse]) => {
        if (formSpecRank(otherCourse.code) < requiredRank) return false;
        const status = employeeStatusByCourseId.get(otherId);
        return status ? isValidCourseStatus(status, otherCourse, todayIso) : false;
      });
    } else {
      const prereqStatus = employeeStatusByCourseId.get(prereqId);
      prereqValid = prereqStatus ? isValidCourseStatus(prereqStatus, prereqCourse, todayIso) : false;
    }

    if (!prereqValid) {
      return { courseCode: prereqCourse.code, courseTitle: prereqCourse.title };
    }

    const deeper = findBrokenPrerequisiteChain(
      prereqId,
      employeeStatusByCourseId,
      courseMap,
      prerequisitesByFromCourseId,
      todayIso,
      visited,
    );
    if (deeper) return deeper;
  }

  return null;
}

export function isValidCourseStatus(row: CourseStatusRow, course: CourseRow, todayIso: string) {
  if (row.manual_state === "escluso") return false;
  if (!row.completion_date) return false;
  if (course.is_unlimited) return true;
  const todayKey = parseDateOnlyKey(todayIso) ?? parseDateOnlyKey(todayLocalIso());
  if (!todayKey) return false;

  const expiryIso = row.expiry_date ? normalizeDateOnlyIso(String(row.expiry_date)) : null;
  if (expiryIso && isSentinelUnlimitedDate(expiryIso)) return true;

  if (!expiryIso) {
    const years = course.validity_years;
    if (!years || !Number.isFinite(years) || years <= 0) return false;
    const computed = computeTheoreticalExpiryIso(row.completion_date, years);
    if (!computed) return false;
    const computedKey = parseDateOnlyKey(computed);
    if (!computedKey) return false;
    return computedKey >= todayKey;
  }

  const expiryKey = parseDateOnlyKey(expiryIso);
  if (!expiryKey) return false;
  return expiryKey >= todayKey;
}
