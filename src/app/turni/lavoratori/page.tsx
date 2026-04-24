"use client";

import { useEffect, useMemo, useState } from "react";

type Zoom = "mese" | "settimana";
type ShiftState = "planned" | "actual" | "cancelled";

type LookupSite = { id: number; label: string };
type LookupSubSite = { id: number; siteId: number; label: string };
type LookupEmployee = {
  id: number;
  matricola: string;
  cognome: string;
  nome: string;
  responsabile: string;
  referente: string;
  mansione: string;
  siteId: number | null;
  subSiteId: number | null;
  cantiere?: string;
  sottocantiere?: string;
};

type ShiftRow = {
  id: number;
  employeeId: number;
  employeeLabel: string;
  siteId: number;
  siteLabel: string;
  subSiteId: number | null;
  subSiteLabel: string;
  startAt: string;
  endAt: string;
  state: ShiftState;
  source: string;
  note: string;
  breaks: Array<{ id: number; startAt: string; endAt: string }>;
};

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfWeek(d: Date) {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatItDate(isoDate: string) {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatTime(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function clampToQuarter(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  const minutes = d.getMinutes();
  const rounded = Math.round(minutes / 15) * 15;
  d.setMinutes(rounded, 0, 0);
  return d.toISOString();
}

function minutesBetween(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  if (!Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return 0;
  return Math.max(0, Math.round((db.getTime() - da.getTime()) / 60000));
}

function buildTimeOptions() {
  const options: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      options.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return options;
}

const timeOptions = buildTimeOptions();

function Modal({
  title,
  isOpen,
  onClose,
  children,
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-5xl rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--brand-line)] px-5 py-4">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--brand-line)] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-[var(--brand-panel)]"
          >
            Chiudi
          </button>
        </div>
        <div className="max-h-[75vh] overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export default function TurniLavoratoriPage() {
  const [zoom, setZoom] = useState<Zoom>("mese");
  const [refDate, setRefDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => toIsoDate(new Date()));
  const [sites, setSites] = useState<LookupSite[]>([]);
  const [subSites, setSubSites] = useState<LookupSubSite[]>([]);
  const [employees, setEmployees] = useState<LookupEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [monthLocked, setMonthLocked] = useState(false);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isDayModalOpen, setIsDayModalOpen] = useState(false);
  const [copyDayTargetDate, setCopyDayTargetDate] = useState(() => toIsoDate(addDays(new Date(), 1)));

  const [shiftForm, setShiftForm] = useState({
    shiftId: "",
    employeeId: "",
    date: toIsoDate(new Date()),
    siteId: "",
    subSiteId: "",
    startTime: "07:00",
    endTime: "16:00",
    state: "planned" as ShiftState,
    note: "",
    breaks: [] as Array<{ startTime: string; endTime: string }>,
  });

  const selectedEmployee = useMemo(() => {
    const id = Number(employeeId);
    return Number.isFinite(id) ? id : null;
  }, [employeeId]);

  const subSitesForShiftSite = useMemo(() => {
    const siteIdNum = Number(shiftForm.siteId);
    if (!Number.isFinite(siteIdNum)) return [];
    return subSites.filter((s) => s.siteId === siteIdNum);
  }, [shiftForm.siteId, subSites]);

  const range = useMemo(() => {
    if (zoom === "settimana") {
      const start = startOfWeek(refDate);
      const end = addDays(start, 6);
      return { start, end, startDate: toIsoDate(start), endDate: toIsoDate(end) };
    }
    const start = startOfMonth(refDate);
    const end = endOfMonth(refDate);
    return { start, end, startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }, [refDate, zoom]);

  const monthKey = useMemo(() => {
    const d = startOfMonth(refDate);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }, [refDate]);

  async function loadLookups() {
    const res = await fetch("/api/turni/lookups");
    const body = (await res.json()) as {
      sites?: LookupSite[];
      subSites?: LookupSubSite[];
      employees?: LookupEmployee[];
      error?: string;
    };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore caricamento lookup.");
    setSites(body.sites ?? []);
    setSubSites(body.subSites ?? []);
    setEmployees(body.employees ?? []);
    if (!employeeId && (body.employees?.length ?? 0) > 0) setEmployeeId(String(body.employees?.[0]?.id ?? ""));
  }

  async function loadLocks() {
    const res = await fetch(`/api/turni/locks?year=${monthKey.year}&month=${monthKey.month}`);
    const body = (await res.json()) as { locked?: boolean; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore lock mese.");
    setMonthLocked(Boolean(body.locked));
  }

  async function loadShifts() {
    if (!selectedEmployee) return;
    const res = await fetch(
      `/api/turni/shifts?employeeId=${selectedEmployee}&startDate=${range.startDate}&endDate=${range.endDate}`,
    );
    const body = (await res.json()) as { rows?: ShiftRow[]; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore caricamento turni.");
    setShifts(body.rows ?? []);
  }

  async function reloadAll() {
    setError("");
    try {
      await loadLocks();
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore imprevisto.");
    }
  }

  useEffect(() => {
    setError("");
    loadLookups().catch((e) => setError(e instanceof Error ? e.message : "Errore lookup."));
  }, []);

  useEffect(() => {
    if (!selectedEmployee) return;
    reloadAll();
  }, [selectedEmployee, range.startDate, range.endDate, monthKey.year, monthKey.month]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of shifts) {
      const day = s.startAt.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(s);
      map.set(day, list);
    }
    for (const [day, list] of map) {
      list.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.siteLabel.localeCompare(b.siteLabel));
      map.set(day, list);
    }
    return map;
  }, [shifts]);

  const monthCalendar = useMemo(() => {
    const start = startOfMonth(refDate);
    const startCal = startOfWeek(start);
    const weeks: Array<Array<string>> = [];
    let cursor = new Date(startCal);
    for (let w = 0; w < 6; w++) {
      const row: string[] = [];
      for (let d = 0; d < 7; d++) {
        row.push(toIsoDate(cursor));
        cursor = addDays(cursor, 1);
      }
      weeks.push(row);
      const monthEnd = endOfMonth(refDate);
      if (cursor > monthEnd && cursor.getDay() === 1) break;
    }
    return weeks;
  }, [refDate]);

  const monthSummaryByDay = useMemo(() => {
    const map = new Map<string, { planned: number; actual: number; minutes: number }>();
    for (const s of shifts) {
      const day = s.startAt.slice(0, 10);
      const base = map.get(day) ?? { planned: 0, actual: 0, minutes: 0 };
      const totalMinutes = minutesBetween(s.startAt, s.endAt);
      const breakMinutes = s.breaks.reduce((acc, b) => acc + minutesBetween(b.startAt, b.endAt), 0);
      if (s.state === "actual") base.actual += 1;
      else if (s.state === "planned") base.planned += 1;
      base.minutes += Math.max(0, totalMinutes - breakMinutes);
      map.set(day, base);
    }
    return map;
  }, [shifts]);

  function openNewShift(isoDay: string) {
    const defaultSiteId = sites[0] ? String(sites[0].id) : "";
    const defaultSiteIdNum = Number(defaultSiteId);
    const defaultSubSiteId =
      Number.isFinite(defaultSiteIdNum) && subSites.some((s) => s.siteId === defaultSiteIdNum)
        ? String(subSites.find((s) => s.siteId === defaultSiteIdNum)?.id ?? "")
        : "";
    setShiftForm({
      shiftId: "",
      employeeId: employeeId,
      date: isoDay,
      siteId: defaultSiteId,
      subSiteId: defaultSubSiteId,
      startTime: "07:00",
      endTime: "16:00",
      state: "planned",
      note: "",
      breaks: [],
    });
    setSelectedDay(isoDay);
    setCopyDayTargetDate(toIsoDate(addDays(new Date(`${isoDay}T12:00:00`), 1)));
    setIsDayModalOpen(true);
  }

  function openEditShift(row: ShiftRow) {
    const start = new Date(row.startAt);
    const end = new Date(row.endAt);
    setShiftForm({
      shiftId: String(row.id),
      employeeId: String(row.employeeId),
      date: row.startAt.slice(0, 10),
      siteId: String(row.siteId),
      subSiteId: row.subSiteId ? String(row.subSiteId) : "",
      startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
      endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
      state: row.state,
      note: row.note,
      breaks: row.breaks.map((b) => {
        const bs = new Date(b.startAt);
        const be = new Date(b.endAt);
        return {
          startTime: `${String(bs.getHours()).padStart(2, "0")}:${String(bs.getMinutes()).padStart(2, "0")}`,
          endTime: `${String(be.getHours()).padStart(2, "0")}:${String(be.getMinutes()).padStart(2, "0")}`,
        };
      }),
    });
    setSelectedDay(row.startAt.slice(0, 10));
    setCopyDayTargetDate(toIsoDate(addDays(new Date(`${row.startAt.slice(0, 10)}T12:00:00`), 1)));
    setIsDayModalOpen(true);
  }

  async function lockMonth() {
    setIsBusy(true);
    setError("");
    try {
      const res = await fetch("/api/turni/locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: monthKey.year, month: monthKey.month }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore lock mese.");
      await loadLocks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore lock mese.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveShift() {
    const employeeIdNum = Number(shiftForm.employeeId);
    const siteIdNum = Number(shiftForm.siteId);
    if (!Number.isFinite(employeeIdNum)) {
      setError("Seleziona un lavoratore.");
      return;
    }
    if (!Number.isFinite(siteIdNum)) {
      setError("Seleziona un cantiere.");
      return;
    }
    const hasSubSites = subSites.some((s) => s.siteId === siteIdNum);
    const subSiteIdNum = shiftForm.subSiteId ? Number(shiftForm.subSiteId) : null;
    if (hasSubSites && !Number.isFinite(subSiteIdNum)) {
      setError("Seleziona un sottocantiere.");
      return;
    }
    setIsBusy(true);
    setError("");
    try {
      const startAt = clampToQuarter(new Date(`${shiftForm.date}T${shiftForm.startTime}:00`).toISOString());
      let endAt = clampToQuarter(new Date(`${shiftForm.date}T${shiftForm.endTime}:00`).toISOString());
      if (new Date(endAt) <= new Date(startAt)) {
        endAt = clampToQuarter(
          new Date(`${toIsoDate(addDays(new Date(shiftForm.date), 1))}T${shiftForm.endTime}:00`).toISOString(),
        );
      }

      const breaks = shiftForm.breaks
        .map((b) => {
          const bs = new Date(`${shiftForm.date}T${b.startTime}:00`);
          const be = new Date(`${shiftForm.date}T${b.endTime}:00`);
          return { startAt: bs.toISOString(), endAt: be.toISOString() };
        })
        .filter((b) => minutesBetween(b.startAt, b.endAt) > 0);

      const payload = {
        employeeId: employeeIdNum,
        siteId: siteIdNum,
        subSiteId: hasSubSites && Number.isFinite(subSiteIdNum) ? subSiteIdNum : null,
        startAt,
        endAt,
        state: shiftForm.state,
        note: shiftForm.note,
        breaks,
      };

      const res = await fetch("/api/turni/shifts", {
        method: shiftForm.shiftId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shiftForm.shiftId ? { shiftId: Number(shiftForm.shiftId), ...payload } : payload),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore salvataggio turno.");
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore salvataggio turno.");
    } finally {
      setIsBusy(false);
    }
  }

  async function cancelCurrentShift() {
    const id = Number(shiftForm.shiftId);
    if (!Number.isFinite(id)) return;
    setIsBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/turni/shifts?shiftId=${id}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore annullamento turno.");
      setShiftForm((s) => ({ ...s, shiftId: "", note: "", breaks: [] }));
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore annullamento turno.");
    } finally {
      setIsBusy(false);
    }
  }

  async function copyDayShifts() {
    const sourceDay = shiftForm.date;
    const targetDay = copyDayTargetDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDay)) {
      setError("Data destinazione non valida.");
      return;
    }
    const rows = (shiftsByDay.get(sourceDay) ?? []).filter((r) => r.state !== "cancelled");
    if (rows.length === 0) {
      setError("Nessun turno da copiare in quel giorno.");
      return;
    }
    setIsBusy(true);
    setError("");
    try {
      let created = 0;
      let errors = 0;
      for (const r of rows) {
        const start = new Date(r.startAt);
        const end = new Date(r.endAt);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
        const durationMs = end.getTime() - start.getTime();
        const hh = String(start.getHours()).padStart(2, "0");
        const mm = String(start.getMinutes()).padStart(2, "0");
        const newStart = new Date(`${targetDay}T${hh}:${mm}:00`);
        const newEnd = new Date(newStart.getTime() + durationMs);
        const breaks = r.breaks
          .map((b) => {
            const bs = new Date(b.startAt);
            const be = new Date(b.endAt);
            const offStart = bs.getTime() - start.getTime();
            const offEnd = be.getTime() - start.getTime();
            return {
              startAt: new Date(newStart.getTime() + offStart).toISOString(),
              endAt: new Date(newStart.getTime() + offEnd).toISOString(),
            };
          })
          .filter((b) => minutesBetween(b.startAt, b.endAt) > 0);

        const res = await fetch("/api/turni/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: r.employeeId,
            siteId: r.siteId,
            subSiteId: r.subSiteId,
            startAt: newStart.toISOString(),
            endAt: newEnd.toISOString(),
            state: r.state,
            note: r.note,
            breaks,
          }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok || body.error) errors += 1;
        else created += 1;
      }
      await loadShifts();
      if (errors > 0) setError(`Copia completata: ${created} creati, ${errors} errori.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore copia turni.");
    } finally {
      setIsBusy(false);
    }
  }

  const exportHref = useMemo(() => {
    const employee = selectedEmployee ? `&employeeId=${selectedEmployee}` : "";
    return `/api/turni/export?year=${monthKey.year}&month=${monthKey.month}${employee}`;
  }, [monthKey.year, monthKey.month, selectedEmployee]);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Turni / Lavoratori</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">Turni</div>
          <div className="mt-1 text-sm text-slate-600">Vista calendario personale del lavoratore.</div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={exportHref}
            className="inline-flex items-center rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-[var(--brand-panel)]"
          >
            Export
          </a>
          <button
            disabled={isBusy || monthLocked}
            onClick={lockMonth}
            className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-[var(--brand-panel)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Chiudi mese
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--brand-line)] bg-white p-4">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold text-slate-600">Lavoratore</div>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
          >
            {employees.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.cognome} {e.nome} ({e.matricola})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold text-slate-600">{zoom === "mese" ? "Mese" : "Settimana"}</div>
          <input
            type="date"
            value={toIsoDate(refDate)}
            onChange={(e) => setRefDate(new Date(`${e.target.value}T12:00:00`))}
            className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-[var(--brand-line)] bg-white p-1">
          <button
            onClick={() => setZoom("mese")}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${zoom === "mese" ? "bg-[var(--brand-panel)] text-slate-900" : "text-slate-600"}`}
          >
            Mese
          </button>
          <button
            onClick={() => setZoom("settimana")}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${zoom === "settimana" ? "bg-[var(--brand-panel)] text-slate-900" : "text-slate-600"}`}
          >
            Settimana
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {monthLocked ? (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              Mese bloccato
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              Modificabile
            </span>
          )}
          <button
            onClick={() => openNewShift(selectedDay)}
            disabled={monthLocked}
            className="rounded-xl border border-[#2f5ea8] bg-gradient-to-r from-[var(--brand-primary)] to-[#2f5ea8] px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-white/20 transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
          >
            Nuovo turno
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {zoom === "mese" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
            <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-slate-500">
              {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((d) => (
                <div key={d} className="px-2 py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-2 grid gap-2">
              {monthCalendar.map((week, idx) => (
                <div key={idx} className="grid grid-cols-7 gap-2">
                  {week.map((day, dayIdx) => {
                    const inMonth = day.slice(0, 7) === toIsoDate(refDate).slice(0, 7);
                    const summary = monthSummaryByDay.get(day) ?? { planned: 0, actual: 0, minutes: 0 };
                    const total = summary.planned + summary.actual;
                    const isSelected = day === selectedDay;
                    const isToday = day === toIsoDate(new Date());
                    const isWeekend = dayIdx >= 5;
                    return (
                      <button
                        key={day}
                        onClick={() => {
                          setSelectedDay(day);
                          setShiftForm((s) => {
                            const defaultSiteId = s.siteId || (sites[0] ? String(sites[0].id) : "");
                            const siteIdNum = Number(defaultSiteId);
                            const defaultSubSiteId =
                              s.subSiteId ||
                              (Number.isFinite(siteIdNum) && subSites.some((ss) => ss.siteId === siteIdNum)
                                ? String(subSites.find((ss) => ss.siteId === siteIdNum)?.id ?? "")
                                : "");
                            return {
                              ...s,
                              date: day,
                              employeeId: s.employeeId || employeeId,
                              siteId: defaultSiteId,
                              subSiteId: defaultSubSiteId,
                            };
                          });
                          setCopyDayTargetDate(toIsoDate(addDays(new Date(`${day}T12:00:00`), 1)));
                          setIsDayModalOpen(true);
                        }}
                        className={`rounded-xl border px-2 py-2 text-left transition ${
                          isSelected
                            ? "border-[#2f5ea8] bg-indigo-50"
                            : "border-[var(--brand-line)] bg-white hover:bg-[var(--brand-panel)]"
                        } ${inMonth ? "" : "opacity-40"} ${isWeekend ? "bg-slate-50" : ""} ${isToday ? "ring-2 ring-[#2f5ea8]/20" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-900">{day.slice(8, 10)}</div>
                          <div className="text-[10px] font-semibold text-slate-500">{total} turni</div>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div className="text-[11px] text-slate-700">
                            {summary.minutes ? `${Math.round((summary.minutes / 60) * 100) / 100}h` : "-"}
                          </div>
                          <div className="flex items-center gap-1">
                            {summary.actual > 0 ? <span className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
                            {summary.planned > 0 ? <span className="h-2 w-2 rounded-full bg-blue-500" /> : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
            <div className="mb-2 text-xs font-semibold text-slate-500">{formatItDate(selectedDay)}</div>
            <div className="max-h-[62vh] overflow-auto">
              {(shiftsByDay.get(selectedDay) ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-6 text-sm text-slate-600">
                  Nessun turno.
                </div>
              ) : (
                <div className="space-y-2">
                  {(shiftsByDay.get(selectedDay) ?? []).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => openEditShift(r)}
                      className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-left hover:bg-[var(--brand-panel)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">{r.siteLabel}</div>
                        <div className="text-xs font-semibold text-slate-700">
                          {formatTime(r.startAt)}–{formatTime(r.endAt)}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        {r.state === "actual" ? "Consuntivo" : r.state === "planned" ? "Preventivo" : "Annullato"}
                        {r.note ? ` • ${r.note}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 7 }).map((_, i) => {
              const day = toIsoDate(addDays(startOfWeek(refDate), i));
              const rows = shiftsByDay.get(day) ?? [];
              return (
                <div key={day} className="rounded-2xl border border-[var(--brand-line)] bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900">{formatItDate(day)}</div>
                    <button
                      disabled={monthLocked}
                      onClick={() => openNewShift(day)}
                      className="rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-[var(--brand-panel)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      +
                    </button>
                  </div>
                  {rows.length === 0 ? (
                    <div className="text-sm text-slate-500">Nessun turno.</div>
                  ) : (
                    <div className="space-y-2">
                      {rows.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => openEditShift(r)}
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-left hover:bg-[var(--brand-panel)]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">{r.siteLabel}</div>
                            <div className="text-xs font-semibold text-slate-700">
                              {formatTime(r.startAt)}–{formatTime(r.endAt)}
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            {r.state === "actual" ? "Consuntivo" : r.state === "planned" ? "Preventivo" : "Annullato"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal title="Turni del giorno" isOpen={isDayModalOpen} onClose={() => setIsDayModalOpen(false)}>
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div>
            <div className="mb-3 rounded-2xl border border-[var(--brand-line)] bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-600">{formatItDate(selectedDay)}</div>
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-slate-600">Copia su</div>
                  <input
                    type="date"
                    value={copyDayTargetDate}
                    onChange={(e) => setCopyDayTargetDate(e.target.value)}
                    className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                  />
                  <button
                    disabled={isBusy || monthLocked}
                    onClick={copyDayShifts}
                    className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-[var(--brand-panel)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Copia giorno
                  </button>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {(shiftsByDay.get(selectedDay) ?? []).map((r) => (
                <button
                  key={r.id}
                  onClick={() => openEditShift(r)}
                  className={`w-full rounded-xl border bg-white px-3 py-2 text-left hover:bg-[var(--brand-panel)] ${
                    String(r.id) === shiftForm.shiftId ? "border-[#2f5ea8]" : "border-[var(--brand-line)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {r.subSiteLabel && r.subSiteLabel !== "-" ? r.subSiteLabel : r.siteLabel}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-600">{r.note ? r.note : ""}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          r.state === "actual"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : r.state === "planned"
                              ? "border-blue-200 bg-blue-50 text-blue-800"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        {r.state === "actual" ? "Consuntivo" : r.state === "planned" ? "Preventivo" : "Annullato"}
                      </span>
                      <div className="text-xs font-semibold text-slate-800">
                        {formatTime(r.startAt)}–{formatTime(r.endAt)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">
              {shiftForm.shiftId ? "Modifica turno" : "Nuovo turno"}
            </div>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-slate-600">Lavoratore</div>
                <select
                  value={shiftForm.employeeId}
                  onChange={(e) => setShiftForm((s) => ({ ...s, employeeId: e.target.value }))}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                >
                  <option value="">Seleziona...</option>
                  {employees.map((e) => (
                    <option key={e.id} value={String(e.id)}>
                      {e.cognome} {e.nome} ({e.matricola})
                      {e.cantiere && e.cantiere !== "-"
                        ? ` — ${e.cantiere}${e.sottocantiere && e.sottocantiere !== "-" ? ` / ${e.sottocantiere}` : ""}`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold text-slate-600">Data</div>
                <input
                  type="date"
                  value={shiftForm.date}
                  onChange={(e) => setShiftForm((s) => ({ ...s, date: e.target.value }))}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold text-slate-600">Cantiere</div>
                <select
                  value={shiftForm.siteId}
                  onChange={(e) => {
                    const nextSiteId = e.target.value;
                    const nextSiteIdNum = Number(nextSiteId);
                    const defaultSubSiteId =
                      Number.isFinite(nextSiteIdNum) && subSites.some((ss) => ss.siteId === nextSiteIdNum)
                        ? String(subSites.find((ss) => ss.siteId === nextSiteIdNum)?.id ?? "")
                        : "";
                    setShiftForm((s) => ({ ...s, siteId: nextSiteId, subSiteId: defaultSubSiteId }));
                  }}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                >
                  <option value="">Seleziona...</option>
                  {sites.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {subSitesForShiftSite.length > 0 ? (
                <div className="grid gap-2">
                  <div className="text-xs font-semibold text-slate-600">Sottocantiere</div>
                  <select
                    value={shiftForm.subSiteId}
                    onChange={(e) => setShiftForm((s) => ({ ...s, subSiteId: e.target.value }))}
                    className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Seleziona...</option>
                    {subSitesForShiftSite.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <div className="text-xs font-semibold text-slate-600">Inizio</div>
                  <select
                    value={shiftForm.startTime}
                    onChange={(e) => setShiftForm((s) => ({ ...s, startTime: e.target.value }))}
                    className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                  >
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <div className="text-xs font-semibold text-slate-600">Fine</div>
                  <select
                    value={shiftForm.endTime}
                    onChange={(e) => setShiftForm((s) => ({ ...s, endTime: e.target.value }))}
                    className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                  >
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold text-slate-600">Stato</div>
                <select
                  value={shiftForm.state}
                  onChange={(e) => setShiftForm((s) => ({ ...s, state: e.target.value as ShiftState }))}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                >
                  <option value="planned">Preventivo</option>
                  <option value="actual">Consuntivo</option>
                  <option value="cancelled">Annullato</option>
                </select>
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-semibold text-slate-600">Note</div>
                <input
                  value={shiftForm.note}
                  onChange={(e) => setShiftForm((s) => ({ ...s, note: e.target.value }))}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-700">Pause</div>
                  <button
                    onClick={() =>
                      setShiftForm((s) => ({ ...s, breaks: [...s.breaks, { startTime: "12:00", endTime: "12:15" }] }))
                    }
                    className="rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-[var(--brand-panel)]"
                  >
                    Aggiungi
                  </button>
                </div>
                {shiftForm.breaks.length === 0 ? (
                  <div className="text-sm text-slate-500">Nessuna pausa.</div>
                ) : (
                  <div className="grid gap-2">
                    {shiftForm.breaks.map((b, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_1fr_44px] gap-2">
                        <select
                          value={b.startTime}
                          onChange={(e) =>
                            setShiftForm((s) => ({
                              ...s,
                              breaks: s.breaks.map((it, i) => (i === idx ? { ...it, startTime: e.target.value } : it)),
                            }))
                          }
                          className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                        >
                          {timeOptions.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <select
                          value={b.endTime}
                          onChange={(e) =>
                            setShiftForm((s) => ({
                              ...s,
                              breaks: s.breaks.map((it, i) => (i === idx ? { ...it, endTime: e.target.value } : it)),
                            }))
                          }
                          className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                        >
                          {timeOptions.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => setShiftForm((s) => ({ ...s, breaks: s.breaks.filter((_, i) => i !== idx) }))}
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                          title="Rimuovi"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {shiftForm.shiftId ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={isBusy || monthLocked}
                    onClick={() => setShiftForm((s) => ({ ...s, shiftId: "" }))}
                    className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-[var(--brand-panel)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Duplica
                  </button>
                  <button
                    disabled={isBusy || monthLocked}
                    onClick={cancelCurrentShift}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Annulla
                  </button>
                </div>
              ) : null}

              <button
                disabled={isBusy || monthLocked}
                onClick={saveShift}
                className="rounded-xl border border-[#2f5ea8] bg-gradient-to-r from-[var(--brand-primary)] to-[#2f5ea8] px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-white/20 transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
              >
                Salva turno
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
