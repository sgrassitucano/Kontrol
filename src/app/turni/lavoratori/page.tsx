"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleHeader, PanelCard } from "@/components/module-ui";
import { Combobox } from "@/components/combobox";

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

type TemplateSlot = {
  id?: number;
  weekday: number;
  siteId: number;
  subSiteId: number | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
};
type Template = { id: number; employeeId: number; name: string; validFrom: string; validTo: string | null } | null;

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
  state: "planned" | "actual" | "cancelled";
  source: "template" | "manual" | "import";
  note: string;
  createdByName: string;
};

function toIsoDate(value: Date) {
  const y = String(value.getFullYear());
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfWeekMonday(d: Date) {
  const day = (d.getDay() + 6) % 7;
  const copy = new Date(d);
  copy.setDate(copy.getDate() - day);
  return copy;
}

function buildMonthGrid(ref: Date) {
  const start = startOfWeekMonday(startOfMonth(ref));
  const out: { iso: string; inMonth: boolean; day: number }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push({ iso: toIsoDate(d), inMonth: d.getMonth() === ref.getMonth(), day: d.getDate() });
  }
  return out;
}

function addMonths(d: Date, months: number) {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function formatItMonth(d: Date) {
  const months = [
    "Gennaio",
    "Febbraio",
    "Marzo",
    "Aprile",
    "Maggio",
    "Giugno",
    "Luglio",
    "Agosto",
    "Settembre",
    "Ottobre",
    "Novembre",
    "Dicembre",
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
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
            className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
          >
            Chiudi
          </button>
        </div>
        <div className="max-h-[75vh] overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function weekdayLabel(weekday: number) {
  return ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"][weekday] ?? "-";
}

function siteKey(siteId: number, subSiteId: number | null) {
  return `${siteId}:${subSiteId ?? ""}`;
}

export default function TurniLavoratoriPage() {
  const [refDate, setRefDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => toIsoDate(new Date()));
  const [daySiteKey, setDaySiteKey] = useState<string>("");

  const [sites, setSites] = useState<LookupSite[]>([]);
  const [subSites, setSubSites] = useState<LookupSubSite[]>([]);
  const [employees, setEmployees] = useState<LookupEmployee[]>([]);

  const [employeeId, setEmployeeId] = useState<string>("");
  const selectedEmployee = useMemo(() => {
    const id = Number(employeeId);
    return Number.isFinite(id) ? id : null;
  }, [employeeId]);

  const currentEmployeeDetails = useMemo(() => {
    if (!selectedEmployee) return null;
    return employees.find((e) => e.id === selectedEmployee) ?? null;
  }, [employees, selectedEmployee]);

  const range = useMemo(() => {
    const start = startOfMonth(refDate);
    const end = endOfMonth(refDate);
    return { start, end, startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }, [refDate]);

  const monthGrid = useMemo(() => buildMonthGrid(refDate), [refDate]);

  useEffect(() => {
    const start = startOfMonth(refDate);
    setSelectedDay(toIsoDate(start));
    setDaySiteKey("");
  }, [refDate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialEmployeeId = params.get("employeeId");
    if (initialEmployeeId) {
      setEmployeeId(initialEmployeeId);
    }
  }, []);

  const [template, setTemplate] = useState<Template>(null);
  const [templateSlotsAll, setTemplateSlotsAll] = useState<TemplateSlot[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);

  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    shiftId: "",
    date: toIsoDate(new Date()),
    siteId: "",
    subSiteId: "",
    startTime: "07:00",
    endTime: "16:00",
    note: "",
  });

  const [isAbsenceModalOpen, setIsAbsenceModalOpen] = useState(false);
  const [absenceForm, setAbsenceForm] = useState<{ absenceType: "ferie" | "malattia" | "permesso" | "infortunio" | "altro"; note: string }>(
    { absenceType: "malattia", note: "" },
  );

  const subSitesForSite = useCallback(
    (siteId: number) => {
      return subSites.filter((s) => s.siteId === siteId);
    },
    [subSites],
  );

  const siteHasSubSites = useCallback(
    (siteId: number) => {
      return subSitesForSite(siteId).length > 0;
    },
    [subSitesForSite],
  );

  const loadLookups = useCallback(async () => {
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
    setEmployeeId((prev) => {
      if (prev) return prev;
      return (body.employees?.length ?? 0) > 0 ? String(body.employees?.[0]?.id ?? "") : "";
    });
  }, []);

  const loadShifts = useCallback(async () => {
    if (!selectedEmployee) return;
    const res = await fetch(
      `/api/turni/shifts?employeeId=${selectedEmployee}&startDate=${range.startDate}&endDate=${range.endDate}`,
    );
    const body = (await res.json()) as { rows?: ShiftRow[]; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore caricamento turni.");
    setShifts(body.rows ?? []);
  }, [range.endDate, range.startDate, selectedEmployee]);

  const loadEmployeeTemplate = useCallback(async () => {
    if (!selectedEmployee) return;
    const res = await fetch(`/api/turni/employee-templates?employeeId=${selectedEmployee}&date=${range.startDate}`);
    const body = (await res.json()) as { template?: Template; slots?: TemplateSlot[]; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore caricamento settimana tipo.");
    setTemplate(body.template ?? null);
    setTemplateSlotsAll((body.slots ?? []).map((s) => ({ ...s, breakMinutes: typeof s.breakMinutes === "number" ? s.breakMinutes : 0 })));
  }, [range.startDate, selectedEmployee]);

  const syncMonthStandard = useCallback(async () => {
    if (!selectedEmployee) return;
    const res = await fetch("/api/turni/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "employee", employeeId: selectedEmployee, startDate: range.startDate, endDate: range.endDate }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore sync turni.");
  }, [range.endDate, range.startDate, selectedEmployee]);

  const reloadAll = useCallback(async () => {
    setIsBusy(true);
    setError("");
    try {
      await loadEmployeeTemplate();
      await syncMonthStandard();
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore imprevisto.");
    } finally {
      setIsBusy(false);
    }
  }, [loadEmployeeTemplate, loadShifts, syncMonthStandard]);

  useEffect(() => {
    setError("");
    loadLookups().catch((e) => setError(e instanceof Error ? e.message : "Errore lookup."));
  }, [loadLookups]);

  useEffect(() => {
    if (!selectedEmployee) return;
    void reloadAll();
  }, [reloadAll, selectedEmployee]);

  const templateSlotsByWeekday = useMemo(() => {
    const map = new Map<number, TemplateSlot[]>();
    for (const s of templateSlotsAll) {
      const list = map.get(s.weekday) ?? [];
      list.push(s);
      map.set(s.weekday, list);
    }
    for (const [weekday, list] of map) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(weekday, list);
    }
    return map;
  }, [templateSlotsAll]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of shifts) {
      const day = s.startAt.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(s);
      map.set(day, list);
    }
    for (const [day, list] of map) {
      list.sort((a, b) => a.startAt.localeCompare(b.startAt));
      map.set(day, list);
    }
    return map;
  }, [shifts]);

  const sitesForMatrix = useMemo(() => {
    const map = new Map<string, { siteId: number; subSiteId: number | null; label: string }>();
    for (const s of shifts) {
      const key = siteKey(s.siteId, s.subSiteId);
      if (map.has(key)) continue;
      const label = s.subSiteId ? `${s.siteLabel} — ${s.subSiteLabel}` : s.siteLabel;
      map.set(key, { siteId: s.siteId, subSiteId: s.subSiteId, label });
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [shifts]);

  const selectedDayRows = useMemo(() => {
    const day = selectedDay;
    const rows = shifts.filter((s) => s.startAt.slice(0, 10) === day);
    if (!daySiteKey) return rows;
    return rows.filter((s) => siteKey(s.siteId, s.subSiteId) === daySiteKey);
  }, [daySiteKey, selectedDay, shifts]);

  const daySiteLabel = useMemo(() => {
    if (!daySiteKey) return "";
    const [siteIdStr, subSiteIdStr] = daySiteKey.split(":");
    const siteId = Number(siteIdStr);
    const subSiteId = subSiteIdStr ? Number(subSiteIdStr) : null;
    const siteLabel = sites.find((s) => s.id === siteId)?.label ?? "-";
    if (subSiteId === null) return siteLabel;
    const subLabel = subSites.find((s) => s.id === subSiteId)?.label ?? "-";
    return `${siteLabel} — ${subLabel}`;
  }, [daySiteKey, sites, subSites]);

  const templateName = template?.name ?? "Settimana tipo";

  async function saveTemplate() {
    if (!selectedEmployee) return;
    setIsBusy(true);
    setError("");
    try {
      const slots = templateSlotsAll.map((s) => ({
        weekday: s.weekday,
        siteId: s.siteId,
        subSiteId: s.subSiteId,
        startTime: s.startTime,
        endTime: s.endTime,
        breakMinutes: 0,
      }));

      const payload = template?.id
        ? { templateId: template.id, name: templateName, slots }
        : { employeeId: selectedEmployee, name: templateName, validFrom: range.startDate, validTo: null, slots };

      const res = await fetch("/api/turni/employee-templates", {
        method: template?.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore salvataggio settimana tipo.");
      await loadEmployeeTemplate();
      await syncMonthStandard();
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore salvataggio settimana tipo.");
    } finally {
      setIsBusy(false);
    }
  }

  async function resyncMonthNow() {
    setIsBusy(true);
    setError("");
    try {
      await syncMonthStandard();
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore sync turni.");
    } finally {
      setIsBusy(false);
    }
  }

  function openNewShift(isoDay: string, siteId?: number, subSiteId?: number | null) {
    const defaultSiteId = typeof siteId === "number" ? siteId : (currentEmployeeDetails?.siteId ?? "");
    const defaultSubSiteId = typeof siteId === "number" ? subSiteId : (currentEmployeeDetails?.subSiteId ?? "");
    setShiftForm({
      shiftId: "",
      date: isoDay,
      siteId: defaultSiteId ? String(defaultSiteId) : "",
      subSiteId: defaultSubSiteId ? String(defaultSubSiteId) : "",
      startTime: "07:00",
      endTime: "16:00",
      note: "",
    });
    setIsShiftModalOpen(true);
  }

  function openEditShift(row: ShiftRow) {
    const start = new Date(row.startAt);
    const end = new Date(row.endAt);
    setShiftForm({
      shiftId: String(row.id),
      date: row.startAt.slice(0, 10),
      siteId: String(row.siteId),
      subSiteId: row.subSiteId ? String(row.subSiteId) : "",
      startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
      endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
      note: row.note,
    });
    setIsShiftModalOpen(true);
  }

  async function saveShift() {
    if (!selectedEmployee) return;
    const siteIdNum = Number(shiftForm.siteId);
    if (!Number.isFinite(siteIdNum)) {
      setError("Seleziona un cantiere.");
      return;
    }
    const hasSub = siteHasSubSites(siteIdNum);
    const subSiteIdNum = shiftForm.subSiteId ? Number(shiftForm.subSiteId) : null;
    if (hasSub && !Number.isFinite(subSiteIdNum)) {
      setError("Se il cantiere ha sottocantieri, il sottocantiere è obbligatorio.");
      return;
    }
    setIsBusy(true);
    setError("");
    try {
      const startAt = clampToQuarter(new Date(`${shiftForm.date}T${shiftForm.startTime}:00`).toISOString());
      let endAt = clampToQuarter(new Date(`${shiftForm.date}T${shiftForm.endTime}:00`).toISOString());
      if (new Date(endAt) <= new Date(startAt)) {
        const nextDay = new Date(`${shiftForm.date}T12:00:00`);
        nextDay.setDate(nextDay.getDate() + 1);
        endAt = clampToQuarter(new Date(`${toIsoDate(nextDay)}T${shiftForm.endTime}:00`).toISOString());
      }

      const payload = {
        employeeId: selectedEmployee,
        siteId: siteIdNum,
        subSiteId: hasSub ? (subSiteIdNum as number) : null,
        startAt,
        endAt,
        note: shiftForm.note,
        source: "manual",
        state: "planned",
      };

      const res = await fetch("/api/turni/shifts", {
        method: shiftForm.shiftId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shiftForm.shiftId ? { shiftId: Number(shiftForm.shiftId), ...payload } : payload),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore salvataggio turno.");
      setIsShiftModalOpen(false);
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore salvataggio turno.");
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteShift() {
    const id = Number(shiftForm.shiftId);
    if (!Number.isFinite(id)) return;
    setIsBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/turni/shifts?shiftId=${id}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore cancellazione turno.");
      setIsShiftModalOpen(false);
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore cancellazione turno.");
    } finally {
      setIsBusy(false);
    }
  }

  async function createAbsenceForDay() {
    if (!selectedEmployee) return;
    setIsBusy(true);
    setError("");
    try {
      const res = await fetch("/api/turni/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: selectedEmployee,
          startDate: shiftForm.date,
          endDate: shiftForm.date,
          absenceType: absenceForm.absenceType,
          note: absenceForm.note,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore creazione assenza.");

      await syncMonthStandard();
      await loadShifts();
      setIsAbsenceModalOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore assenza.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="theme-turni space-y-4 p-6 animate-tab-content">
      <ModuleHeader title="Turni — Lavoratori" description="Settimana tipo (ripetibile) + calendario mensile." />

      <PanelCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-[320px] flex-1 gap-1">
            <div className="text-xs font-semibold text-slate-600">Lavoratore</div>
            <Combobox
              value={employeeId}
              onChange={setEmployeeId}
              options={employees.map((e) => ({
                id: String(e.id),
                label: `${e.cognome} ${e.nome}`.trim(),
                meta: `${e.matricola} · ${e.mansione}${e.cantiere ? ` · ${e.cantiere}` : ""}`,
              }))}
              placeholder="Cerca lavoratore..."
              disabled={isBusy}
            />
          </div>

          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Mese</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRefDate((d) => addMonths(d, -1))}
                disabled={isBusy}
                className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                ←
              </button>
              <div className="min-w-[160px] text-center text-sm font-semibold text-slate-800">{formatItMonth(refDate)}</div>
              <button
                type="button"
                onClick={() => setRefDate((d) => addMonths(d, 1))}
                disabled={isBusy}
                className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                →
              </button>
            </div>
          </div>
        </div>
      </PanelCard>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <PanelCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Settimana tipo (lavoratore)</div>
            <div className="mt-1 text-xs text-slate-500">{template ? `Template: ${template.name}` : "Nessun template attivo"}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveTemplate}
              disabled={isBusy || !selectedEmployee}
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Salva
            </button>
            <button
              type="button"
              onClick={resyncMonthNow}
              disabled={isBusy || !selectedEmployee}
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Riallinea mese
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, weekday) => {
            const slots = templateSlotsByWeekday.get(weekday) ?? [];
            return (
              <div key={weekday} className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-700">{weekdayLabel(weekday)}</div>
                  <button
                    type="button"
                    onClick={() => {
                      const defaultSiteId = currentEmployeeDetails?.siteId ?? sites[0]?.id;
                      if (!defaultSiteId) return;
                      const hasSub = siteHasSubSites(defaultSiteId);
                      const subOptions = subSitesForSite(defaultSiteId);
                      const slot: TemplateSlot = {
                        weekday,
                        siteId: defaultSiteId,
                        subSiteId: hasSub ? (currentEmployeeDetails?.subSiteId ?? subOptions[0]?.id ?? null) : null,
                        startTime: "07:00",
                        endTime: "16:00",
                        breakMinutes: 0,
                      };
                      setTemplateSlotsAll((prev) => [...prev, slot]);
                    }}
                    disabled={isBusy || !selectedEmployee || sites.length === 0}
                    className="rounded-lg bg-[var(--brand-primary)] px-2 py-1 text-[11px] font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                    title="Aggiungi fascia"
                  >
                    +
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {slots.length === 0 ? (
                    <div className="text-[11px] font-semibold text-slate-400">-</div>
                  ) : (
                    slots.map((s, idx) => {
                      const subOptions = subSitesForSite(s.siteId);
                      const hasSub = subOptions.length > 0;
                      return (
                        <div key={`${weekday}-${idx}`} className="space-y-2 rounded-lg border border-[var(--brand-line)] bg-white p-2">
                          <div className="flex flex-col gap-1.5">
                            <select
                              value={String(s.siteId)}
                              onChange={(e) => {
                                const nextSiteId = Number(e.target.value);
                                const nextSubOptions = subSitesForSite(nextSiteId);
                                const nextHasSub = nextSubOptions.length > 0;
                                setTemplateSlotsAll((prev) =>
                                  prev.map((row) =>
                                    row === s
                                      ? {
                                          ...row,
                                          siteId: nextSiteId,
                                          subSiteId: nextHasSub ? (nextSubOptions[0]?.id ?? null) : null,
                                        }
                                      : row,
                                  ),
                                );
                              }}
                              className="w-full rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-[11px] font-semibold text-slate-800"
                            >
                              {sites.map((site) => (
                                <option key={site.id} value={String(site.id)}>
                                  {site.label}
                                </option>
                              ))}
                            </select>

                            <select
                              value={s.subSiteId ? String(s.subSiteId) : ""}
                              onChange={(e) => {
                                const next = e.target.value ? Number(e.target.value) : null;
                                setTemplateSlotsAll((prev) => prev.map((row) => (row === s ? { ...row, subSiteId: next } : row)));
                              }}
                              className="w-full rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-[11px] font-semibold text-slate-800"
                              disabled={!hasSub}
                            >
                              {!hasSub ? <option value="">-</option> : null}
                              {hasSub
                                ? subOptions.map((ss) => (
                                    <option key={ss.id} value={String(ss.id)}>
                                      {ss.label}
                                    </option>
                                  ))
                                : null}
                            </select>
                          </div>

                          <div className="grid grid-cols-[1fr_1fr_28px] items-center gap-2">
                            <select
                              value={s.startTime}
                              onChange={(e) => {
                                const next = e.target.value;
                                setTemplateSlotsAll((prev) => prev.map((row) => (row === s ? { ...row, startTime: next } : row)));
                              }}
                              className="rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-[11px] font-semibold text-slate-800"
                            >
                              {timeOptions.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                            <select
                              value={s.endTime}
                              onChange={(e) => {
                                const next = e.target.value;
                                setTemplateSlotsAll((prev) => prev.map((row) => (row === s ? { ...row, endTime: next } : row)));
                              }}
                              className="rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-[11px] font-semibold text-slate-800"
                            >
                              {timeOptions.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setTemplateSlotsAll((prev) => prev.filter((row) => row !== s))}
                              className="rounded-lg bg-[var(--brand-primary)] px-2 py-1 text-[11px] font-bold text-white shadow-sm transition hover:brightness-95"
                              title="Rimuovi"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </PanelCard>

      <div className="space-y-4">
        <PanelCard>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Calendario mese</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-600">
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Ciclico
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-sky-500" /> Extra/Modificato
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-red-500" /> Annullato
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                {formatItMonth(refDate)}
              </div>
              <button
                type="button"
                onClick={() => setRefDate((d) => addMonths(d, -1))}
                disabled={isBusy}
                className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setRefDate((d) => addMonths(d, 1))}
                disabled={isBusy}
                className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                →
              </button>
              <button
                onClick={() => openNewShift(selectedDay)}
                disabled={isBusy || !selectedEmployee}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Nuovo turno
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((w) => (
              <div key={w} className="px-2 text-xs font-semibold text-slate-600">
                {w}
              </div>
            ))}
            {monthGrid.map((cell) => {
              const rows = shiftsByDay.get(cell.iso) ?? [];
              const minutes = rows.reduce((acc, r) => (r.state === "cancelled" ? acc : acc + minutesBetween(r.startAt, r.endAt)), 0);
              const hasCancelled = rows.some((r) => r.state === "cancelled");
              const hasManual = rows.some((r) => r.source === "manual" && r.state !== "cancelled");
              const hasTemplate = rows.some((r) => r.source === "template" && r.state !== "cancelled");
              const isSelected = cell.iso === selectedDay;
              const bg = hasCancelled ? "bg-red-50" : hasManual ? "bg-sky-50" : hasTemplate ? "bg-emerald-50" : "bg-white";
              return (
                <button
                  key={cell.iso}
                  data-cal="true"
                  type="button"
                  disabled={!cell.inMonth}
                  onClick={() => setSelectedDay(cell.iso)}
                  className={[
                    "min-h-[74px] rounded-xl border p-2 text-left disabled:opacity-35 transition duration-150 ease-in-out",
                    isSelected ? "border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]/15" : "border-[var(--brand-line)] hover:border-slate-400",
                    bg,
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-slate-900">{cell.day}</div>
                    {rows.length ? (
                      <div className="text-[11px] font-semibold tabular-nums text-slate-700">{Math.round((minutes / 60) * 10) / 10}h</div>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <span className={["h-1.5 w-1.5 rounded-full", hasTemplate ? "bg-emerald-500" : "bg-slate-200"].join(" ")} />
                    <span className={["h-1.5 w-1.5 rounded-full", hasManual ? "bg-sky-500" : "bg-slate-200"].join(" ")} />
                    <span className={["h-1.5 w-1.5 rounded-full", hasCancelled ? "bg-red-500" : "bg-slate-200"].join(" ")} />
                    {rows.length ? <span className="ml-1 text-[11px] font-semibold text-slate-600">{rows.length}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </PanelCard>

        <PanelCard>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">Dettaglio giorno</div>
            <button
              onClick={() => openNewShift(selectedDay)}
              disabled={isBusy || !selectedEmployee}
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Aggiungi
            </button>
          </div>
          <div className="mb-3 grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Filtro cantiere (giorno)</div>
            <Combobox
              value={daySiteKey}
              onChange={(v) => setDaySiteKey(v)}
              options={[{ id: "", label: "Tutti" }, ...sitesForMatrix.map((s) => ({ id: siteKey(s.siteId, s.subSiteId), label: s.label }))]}
              placeholder="Tutti i cantieri"
              disabled={isBusy}
            />
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500">
              {formatItDate(selectedDay)}
              {daySiteLabel ? ` · ${daySiteLabel}` : ""}
            </div>
            {daySiteKey ? (
              <button
                type="button"
                onClick={() => setDaySiteKey("")}
                className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
              >
                Mostra tutti
              </button>
            ) : null}
          </div>
          <div className="max-h-[62vh] overflow-auto">
            {selectedDayRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-6 text-sm text-slate-600">
                Nessun turno.
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDayRows.map((row) => (
                  <div
                    key={row.id}
                    onClick={() => openEditShift(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openEditShift(row);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-left hover:bg-[var(--brand-panel)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">
                        {row.subSiteId ? `${row.siteLabel} — ${row.subSiteLabel}` : row.siteLabel}
                      </div>
                      <div className="text-xs font-semibold text-slate-700">
                        {formatTime(row.startAt)}–{formatTime(row.endAt)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {row.state === "cancelled" ? "ANNULLATO • " : ""}
                      {row.note ? `${row.note} • ` : ""}da: {row.createdByName}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PanelCard>
      </div>

      <Modal title={shiftForm.shiftId ? "Modifica turno" : "Nuovo turno"} isOpen={isShiftModalOpen} onClose={() => setIsShiftModalOpen(false)}>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Data</div>
            <input value={shiftForm.date} readOnly className="rounded-xl border border-[var(--brand-line)] bg-slate-50 px-3 py-2 text-sm" />
          </div>

          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Cantiere</div>
            <Combobox
              value={shiftForm.siteId}
              onChange={(next) => {
                const id = Number(next);
                if (!Number.isFinite(id)) {
                  setShiftForm((s) => ({ ...s, siteId: next, subSiteId: "" }));
                  return;
                }
                const subs = subSitesForSite(id);
                const hasSub = subs.length > 0;
                setShiftForm((s) => ({ ...s, siteId: next, subSiteId: hasSub ? String(subs[0]?.id ?? "") : "" }));
              }}
              options={[{ id: "", label: "-" }, ...sites.map((s) => ({ id: String(s.id), label: s.label }))]}
              placeholder="Cerca cantiere..."
              disabled={isBusy}
            />
          </div>

          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Sottocantiere</div>
            <Combobox
              value={shiftForm.subSiteId}
              onChange={(v) => setShiftForm((s) => ({ ...s, subSiteId: v }))}
              options={subSitesForSite(Number(shiftForm.siteId)).map((ss) => ({ id: String(ss.id), label: ss.label }))}
              placeholder={!Number.isFinite(Number(shiftForm.siteId)) || !siteHasSubSites(Number(shiftForm.siteId)) ? "-" : "Cerca sottocantiere..."}
              disabled={isBusy || !Number.isFinite(Number(shiftForm.siteId)) || !siteHasSubSites(Number(shiftForm.siteId))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <div className="text-xs font-semibold text-slate-600">Da</div>
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
            <div className="grid gap-1">
              <div className="text-xs font-semibold text-slate-600">A</div>
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

          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Note</div>
            <input
              value={shiftForm.note}
              onChange={(e) => setShiftForm((s) => ({ ...s, note: e.target.value }))}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveShift}
                disabled={isBusy || !selectedEmployee}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Salva
              </button>
              <button
                type="button"
                data-unstyled="true"
                onClick={() => {
                  setAbsenceForm({ absenceType: "malattia", note: "" });
                  setIsAbsenceModalOpen(true);
                }}
                disabled={isBusy || !selectedEmployee}
                className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Segna assenza
              </button>
              {shiftForm.shiftId ? (
                <button
                  type="button"
                  data-unstyled="true"
                  onClick={deleteShift}
                  disabled={isBusy}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 shadow-sm transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Annulla turno
                </button>
              ) : null}
            </div>
            <button
              type="button"
              data-unstyled="true"
              onClick={() => setIsShiftModalOpen(false)}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Annulla
            </button>
          </div>
        </div>
      </Modal>

      <Modal title="Assenza" isOpen={isAbsenceModalOpen} onClose={() => setIsAbsenceModalOpen(false)}>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Tipo</div>
            <select
              value={absenceForm.absenceType}
              onChange={(e) =>
                setAbsenceForm((s) => ({
                  ...s,
                  absenceType: e.target.value as "ferie" | "malattia" | "permesso" | "infortunio" | "altro",
                }))
              }
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
            >
              <option value="malattia">Malattia</option>
              <option value="ferie">Ferie</option>
              <option value="permesso">Permesso</option>
              <option value="infortunio">Infortunio</option>
              <option value="altro">Altro</option>
            </select>
          </div>

          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Note</div>
            <input
              value={absenceForm.note}
              onChange={(e) => setAbsenceForm((s) => ({ ...s, note: e.target.value }))}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={createAbsenceForDay}
              disabled={isBusy || !selectedEmployee}
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Conferma
            </button>
            <button
              type="button"
              data-unstyled="true"
              onClick={() => setIsAbsenceModalOpen(false)}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Annulla
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
