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

export default function TurniCantierePage() {
  const [refDate, setRefDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => toIsoDate(new Date()));
  const [dayEmployeeId, setDayEmployeeId] = useState<number | null>(null);

  const [sites, setSites] = useState<LookupSite[]>([]);
  const [subSites, setSubSites] = useState<LookupSubSite[]>([]);
  const [employees, setEmployees] = useState<LookupEmployee[]>([]);

  const [siteId, setSiteId] = useState<string>("");
  const [subSiteId, setSubSiteId] = useState<string>("");
  const [employeeId, setEmployeeId] = useState<string>("");

  const [template, setTemplate] = useState<Template>(null);
  const [templateSlotsAll, setTemplateSlotsAll] = useState<TemplateSlot[]>([]);

  const [shifts, setShifts] = useState<ShiftRow[]>([]);

  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    shiftId: "",
    employeeId: "",
    date: toIsoDate(new Date()),
    startTime: "07:00",
    endTime: "16:00",
    note: "",
  });

  const [isAbsenceModalOpen, setIsAbsenceModalOpen] = useState(false);
  const [absenceForm, setAbsenceForm] = useState<{ absenceType: "ferie" | "malattia" | "permesso" | "infortunio" | "altro"; note: string }>(
    { absenceType: "malattia", note: "" },
  );

  // AI Scheduler state
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiResult, setAiResult] = useState<{
    ok: boolean;
    created: number;
    scheduledEmployees?: Array<{ nominativo: string; turniAssegnati: number }>;
    skippedEmployees?: Array<{ nominativo: string; motivo: string }>;
    uncoveredSlots?: Array<{ data: string; giorno: string; orario: string }>;
    message: string;
  } | null>(null);
  const [isAiRunning, setIsAiRunning] = useState(false);

  const selectedSite = useMemo(() => {
    if (!siteId) return null;
    const id = Number(siteId);
    return Number.isFinite(id) ? id : null;
  }, [siteId]);

  const selectedSubSite = useMemo(() => {
    if (!subSiteId) return null;
    const id = Number(subSiteId);
    return Number.isFinite(id) ? id : null;
  }, [subSiteId]);

  const selectedEmployee = useMemo(() => {
    if (!employeeId) return null;
    const id = Number(employeeId);
    return Number.isFinite(id) ? id : null;
  }, [employeeId]);

  const subSitesForSelectedSite = useMemo(() => {
    if (!selectedSite) return [];
    return subSites.filter((s) => s.siteId === selectedSite);
  }, [selectedSite, subSites]);

  const selectedSiteHasSubSites = subSitesForSelectedSite.length > 0;

  useEffect(() => {
    if (!selectedSite) return;
    if (!selectedSiteHasSubSites) {
      if (subSiteId) setSubSiteId("");
      return;
    }
    if (!subSiteId || !subSitesForSelectedSite.some((s) => String(s.id) === subSiteId)) {
      setSubSiteId(String(subSitesForSelectedSite[0]?.id ?? ""));
    }
  }, [selectedSite, selectedSiteHasSubSites, subSiteId, subSitesForSelectedSite]);

  const range = useMemo(() => {
    const start = startOfMonth(refDate);
    const end = endOfMonth(refDate);
    return { start, end, startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }, [refDate]);

  const monthGrid = useMemo(() => buildMonthGrid(refDate), [refDate]);

  useEffect(() => {
    const start = startOfMonth(refDate);
    setSelectedDay(toIsoDate(start));
    setDayEmployeeId(null);
  }, [refDate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialSiteId = params.get("siteId");
    const initialSubSiteId = params.get("subSiteId");
    if (initialSiteId) {
      setSiteId(initialSiteId);
    }
    if (initialSubSiteId) {
      setSubSiteId(initialSubSiteId);
    }
  }, []);

  const employeesForMatrix = useMemo(() => {
    if (!selectedSite) return [];
    const sub = typeof selectedSubSite === "number" ? selectedSubSite : null;
    const rows = employees.filter((e) => {
      if (e.siteId !== selectedSite) return false;
      if (selectedSiteHasSubSites) return e.subSiteId === sub;
      return true;
    });
    return rows
      .map((e) => ({ id: e.id, label: `${e.cognome} ${e.nome} (${e.matricola})`.trim() }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees, selectedSite, selectedSiteHasSubSites, selectedSubSite]);

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
    setSiteId((prev) => {
      if (prev) return prev;
      return (body.sites?.length ?? 0) > 0 ? String(body.sites?.[0]?.id ?? "") : "";
    });
    setEmployeeId((prev) => {
      if (prev) return prev;
      return (body.employees?.length ?? 0) > 0 ? String(body.employees?.[0]?.id ?? "") : "";
    });
  }, []);

  const loadShifts = useCallback(async () => {
    if (!selectedSite) return;
    const sub = typeof selectedSubSite === "number" ? `&subSiteId=${selectedSubSite}` : "";
    const res = await fetch(`/api/turni/shifts?siteId=${selectedSite}${sub}&startDate=${range.startDate}&endDate=${range.endDate}`);
    const body = (await res.json()) as { rows?: ShiftRow[]; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore caricamento turni.");
    setShifts(body.rows ?? []);
  }, [range.endDate, range.startDate, selectedSite, selectedSubSite]);

  const syncMonthStandard = useCallback(async () => {
    if (!selectedSite) return;
    const effectiveSubSiteId = selectedSiteHasSubSites ? (typeof selectedSubSite === "number" ? selectedSubSite : null) : null;
    const res = await fetch("/api/turni/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "site",
        siteId: selectedSite,
        subSiteId: effectiveSubSiteId,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore sync turni.");
  }, [range.endDate, range.startDate, selectedSite, selectedSiteHasSubSites, selectedSubSite]);

  const loadEmployeeTemplate = useCallback(async () => {
    if (!selectedEmployee) return;
    const res = await fetch(`/api/turni/employee-templates?employeeId=${selectedEmployee}&date=${range.startDate}`);
    const body = (await res.json()) as { template?: Template; slots?: TemplateSlot[]; error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "Errore caricamento settimana tipo.");
    setTemplate(body.template ?? null);
    setTemplateSlotsAll((body.slots ?? []).map((s) => ({ ...s, breakMinutes: typeof s.breakMinutes === "number" ? s.breakMinutes : 0 })));
  }, [range.startDate, selectedEmployee]);

  useEffect(() => {
    setError("");
    loadLookups().catch((e) => setError(e instanceof Error ? e.message : "Errore lookup."));
  }, [loadLookups]);

  useEffect(() => {
    if (!selectedSite) return;
    const run = async () => {
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
    };
    void run();
  }, [loadShifts, selectedSite, syncMonthStandard]);

  useEffect(() => {
    if (!selectedEmployee) return;
    void loadEmployeeTemplate();
  }, [loadEmployeeTemplate, selectedEmployee]);

  const templateSlotsForSelectedSite = useMemo(() => {
    if (!selectedSite) return [];
    const sub = typeof selectedSubSite === "number" ? selectedSubSite : null;
    return templateSlotsAll.filter((s) => {
      if (s.siteId !== selectedSite) return false;
      if (!selectedSiteHasSubSites) return true;
      return s.subSiteId === sub;
    });
  }, [selectedSite, selectedSiteHasSubSites, selectedSubSite, templateSlotsAll]);

  const templateSlotsByWeekday = useMemo(() => {
    const map = new Map<number, TemplateSlot[]>();
    for (const s of templateSlotsForSelectedSite) {
      const list = map.get(s.weekday) ?? [];
      list.push(s);
      map.set(s.weekday, list);
    }
    for (const [weekday, list] of map) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(weekday, list);
    }
    return map;
  }, [templateSlotsForSelectedSite]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of shifts) {
      const day = s.startAt.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(s);
      map.set(day, list);
    }
    for (const [day, list] of map) {
      list.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.employeeLabel.localeCompare(b.employeeLabel));
      map.set(day, list);
    }
    return map;
  }, [shifts]);

  const dayEmployeeLabel = useMemo(() => {
    if (!dayEmployeeId) return "";
    return employeesForMatrix.find((e) => e.id === dayEmployeeId)?.label ?? "";
  }, [dayEmployeeId, employeesForMatrix]);

  const dayRows = useMemo(() => {
    const rows = shiftsByDay.get(selectedDay) ?? [];
    if (!dayEmployeeId) return rows;
    return rows.filter((r) => r.employeeId === dayEmployeeId);
  }, [dayEmployeeId, selectedDay, shiftsByDay]);

  const templateName = template?.name ?? "Settimana tipo";

  async function saveTemplate() {
    if (!selectedEmployee) return;
    if (!selectedSite) return;
    if (selectedSiteHasSubSites && typeof selectedSubSite !== "number") {
      setError("Seleziona un sottocantiere.");
      return;
    }
    setIsBusy(true);
    setError("");
    try {
      const preserve = templateSlotsAll.filter((s) => {
        if (s.siteId !== selectedSite) return true;
        if (!selectedSiteHasSubSites) return false;
        const sub = typeof selectedSubSite === "number" ? selectedSubSite : null;
        return s.subSiteId !== sub;
      });
      const mergedSlots = [...preserve, ...templateSlotsForSelectedSite].map((s) => ({
        weekday: s.weekday,
        siteId: s.siteId,
        subSiteId: s.subSiteId,
        startTime: s.startTime,
        endTime: s.endTime,
        breakMinutes: 0,
      }));

      const payload = template?.id
        ? { templateId: template.id, name: templateName, slots: mergedSlots }
        : { employeeId: selectedEmployee, name: templateName, validFrom: range.startDate, validTo: null, slots: mergedSlots };

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

  async function runAiScheduler() {
    if (!selectedSite) return;
    setIsAiRunning(true);
    setAiResult(null);
    setError("");
    try {
      const effectiveSubSiteId = selectedSiteHasSubSites ? (typeof selectedSubSite === "number" ? selectedSubSite : null) : null;
      const res = await fetch("/api/turni/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: selectedSite,
          subSiteId: effectiveSubSiteId,
          startDate: range.startDate,
          endDate: range.endDate,
        }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore AI Scheduler.");
      setAiResult(body);
      // Ricarica turni dopo la generazione
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore AI Scheduler.");
      setAiResult(null);
    } finally {
      setIsAiRunning(false);
    }
  }

  function openDay(isoDay: string, employeeId?: number) {
    setSelectedDay(isoDay);
    setDayEmployeeId(typeof employeeId === "number" ? employeeId : null);
  }

  function openNewShift(isoDay: string, employeeId?: number) {
    setShiftForm({
      shiftId: "",
      employeeId: typeof employeeId === "number" ? String(employeeId) : employeeId ? String(employeeId) : "",
      date: isoDay,
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
      employeeId: String(row.employeeId),
      date: row.startAt.slice(0, 10),
      startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
      endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
      note: row.note,
    });
    setIsShiftModalOpen(true);
  }

  async function saveShift() {
    if (!selectedSite) return;
    const employeeIdNum = Number(shiftForm.employeeId);
    if (!Number.isFinite(employeeIdNum)) {
      setError("Seleziona un lavoratore.");
      return;
    }
    if (selectedSiteHasSubSites && typeof selectedSubSite !== "number") {
      setError("Seleziona un sottocantiere.");
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
        employeeId: employeeIdNum,
        siteId: selectedSite,
        subSiteId: selectedSiteHasSubSites ? selectedSubSite : null,
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
    const employeeIdNum = Number(shiftForm.employeeId);
    if (!Number.isFinite(employeeIdNum)) {
      setError("Seleziona un lavoratore.");
      return;
    }
    setIsBusy(true);
    setError("");
    try {
      const res = await fetch("/api/turni/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: employeeIdNum,
          startDate: shiftForm.date,
          endDate: shiftForm.date,
          absenceType: absenceForm.absenceType,
          note: absenceForm.note,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Errore creazione assenza.");

      const syncRes = await fetch("/api/turni/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "employee",
          employeeId: employeeIdNum,
          startDate: shiftForm.date,
          endDate: shiftForm.date,
        }),
      });
      const syncBody = (await syncRes.json()) as { error?: string };
      if (!syncRes.ok || syncBody.error) throw new Error(syncBody.error ?? "Errore sync assenza.");

      setIsAbsenceModalOpen(false);
      await syncMonthStandard();
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore assenza.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="theme-turni space-y-4 p-6 animate-tab-content">
      <ModuleHeader title="Turni — Cantiere" description="Settimana tipo (ripetibile) + calendario mensile." />

      <PanelCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Cantiere</div>
            <Combobox
              value={siteId}
              onChange={setSiteId}
              options={sites.map((s) => ({ id: String(s.id), label: s.label }))}
              placeholder="Cerca cantiere..."
              disabled={isBusy}
            />
          </div>

          <div className="grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Sottocantiere</div>
            <Combobox
              value={subSiteId}
              onChange={setSubSiteId}
              options={subSitesForSelectedSite.map((s) => ({ id: String(s.id), label: s.label }))}
              placeholder={selectedSiteHasSubSites ? "Cerca sottocantiere..." : "-"}
              disabled={isBusy || !selectedSiteHasSubSites}
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

          <div className="grid min-w-[260px] flex-1 gap-1">
            <div className="text-xs font-semibold text-slate-600">Lavoratore (per settimana tipo)</div>
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
        </div>
      </PanelCard>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <PanelCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Settimana tipo (cantiere)</div>
            <div className="mt-1 text-xs text-slate-500">
              {template ? `Template: ${template.name}` : "Nessun template attivo"} · {selectedSiteHasSubSites ? "Sottocantiere obbligatorio" : "Sottocantiere non previsto"}
            </div>
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
            <button
              type="button"
              onClick={() => setIsAiModalOpen(true)}
              disabled={isBusy || !selectedSite || isAiRunning}
              className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              title="Genera turni con AI: assegna automaticamente i lavoratori conformi agli slot del template"
            >
              🤖 AI Scheduler
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
                      if (!selectedSite) return;
                      if (selectedSiteHasSubSites && typeof selectedSubSite !== "number") return;
                      const slot: TemplateSlot = {
                        weekday,
                        siteId: selectedSite,
                        subSiteId: selectedSiteHasSubSites ? selectedSubSite : null,
                        startTime: "07:00",
                        endTime: "16:00",
                        breakMinutes: 0,
                      };
                      setTemplateSlotsAll((prev) => [...prev, slot]);
                    }}
                    disabled={isBusy || !selectedSite || (selectedSiteHasSubSites && typeof selectedSubSite !== "number")}
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
                    slots.map((s, idx) => (
                      <div key={`${weekday}-${idx}`} className="grid grid-cols-[1fr_1fr_28px] items-center gap-2">
                        <select
                          value={s.startTime}
                          onChange={(e) => {
                            const next = e.target.value;
                            setTemplateSlotsAll((prev) =>
                              prev.map((row) => (row === s ? { ...row, startTime: next } : row)),
                            );
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
                    ))
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
                onClick={() => openNewShift(selectedDay, dayEmployeeId ?? undefined)}
                disabled={isBusy}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Nuovo turno
              </button>
            </div>
          </div>

          <div className="mb-3 grid gap-1">
            <div className="text-xs font-semibold text-slate-600">Filtro lavoratore (mese)</div>
            <Combobox
              value={dayEmployeeId ? String(dayEmployeeId) : ""}
              onChange={(v) => setDayEmployeeId(v ? Number(v) : null)}
              options={[{ id: "", label: "Tutti" }, ...employeesForMatrix.map((e) => ({ id: String(e.id), label: e.label }))]}
              placeholder="Tutti i lavoratori"
              disabled={isBusy}
            />
          </div>

          <div className="grid grid-cols-7 gap-2">
            {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((w) => (
              <div key={w} className="px-2 text-xs font-semibold text-slate-600">
                {w}
              </div>
            ))}
            {monthGrid.map((cell) => {
              const baseRows = shiftsByDay.get(cell.iso) ?? [];
              const rows = dayEmployeeId ? baseRows.filter((r) => r.employeeId === dayEmployeeId) : baseRows;
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
                  onClick={() => openDay(cell.iso, dayEmployeeId ?? undefined)}
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
              onClick={() => openNewShift(selectedDay, dayEmployeeId ?? undefined)}
              disabled={isBusy}
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Aggiungi
            </button>
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500">
              {formatItDate(selectedDay)}
              {dayEmployeeLabel ? ` · ${dayEmployeeLabel}` : ""}
            </div>
            {dayEmployeeId ? (
              <button
                type="button"
                onClick={() => setDayEmployeeId(null)}
                className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
              >
                Mostra tutti
              </button>
            ) : null}
          </div>
          <div className="max-h-[62vh] overflow-auto">
            {dayRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-6 text-sm text-slate-600">
                Nessun turno.
              </div>
            ) : (
              <div className="space-y-2">
                {dayRows.map((row) => (
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
                      <div className="text-sm font-semibold text-slate-900">{row.employeeLabel}</div>
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
            <div className="text-xs font-semibold text-slate-600">Lavoratore</div>
            <select
              value={shiftForm.employeeId}
              onChange={(e) => setShiftForm((s) => ({ ...s, employeeId: e.target.value }))}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
            >
              <option value="">-</option>
              {employeesForMatrix.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.label}
                </option>
              ))}
            </select>
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
                disabled={isBusy}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Salva
              </button>
              <button
                type="button"
                onClick={() => {
                  setAbsenceForm({ absenceType: "malattia", note: "" });
                  setIsAbsenceModalOpen(true);
                }}
                disabled={isBusy || !shiftForm.employeeId}
                className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Segna assenza
              </button>
              {shiftForm.shiftId ? (
                <button
                  type="button"
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
              disabled={isBusy}
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Conferma
            </button>
            <button
              type="button"
              onClick={() => setIsAbsenceModalOpen(false)}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Annulla
            </button>
          </div>
        </div>
      </Modal>

      {/* AI Scheduler Modal */}
      <Modal title="🤖 AI Auto-Scheduling" isOpen={isAiModalOpen} onClose={() => { setIsAiModalOpen(false); setAiResult(null); }}>
        <div className="grid gap-5">
          {/* Step 1: Conferma */}
          {!aiResult && !isAiRunning && (
            <div className="space-y-4">
              <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3">
                <div className="text-sm font-semibold text-violet-900">Generazione Intelligente Turni</div>
                <div className="mt-1 text-xs text-violet-700">
                  L&apos;AI Scheduler genererà automaticamente i turni per <strong>{formatItMonth(refDate)}</strong> assegnando
                  i lavoratori conformi (visite mediche in regola, formazione aggiornata) agli slot del template orario attivo.
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-xs font-semibold text-amber-800">⚠️ Attenzione</div>
                <div className="mt-1 text-xs text-amber-700">
                  I turni verranno generati per tutti i giorni del mese selezionato. I lavoratori con formazione scaduta,
                  idoneità medica non valida o assenze saranno automaticamente esclusi.
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => { runAiScheduler(); }}
                  disabled={!selectedSite}
                  className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Genera turni per {formatItMonth(refDate)}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAiModalOpen(false)}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Loading */}
          {isAiRunning && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
              <div className="text-sm font-semibold text-violet-700">Generazione turni in corso...</div>
              <div className="text-xs text-slate-500">Analisi conformità e bilanciamento carichi di lavoro</div>
            </div>
          )}

          {/* Step 3: Risultati */}
          {aiResult && !isAiRunning && (
            <div className="space-y-4">
              {/* Banner risultato */}
              <div className={`rounded-xl border px-4 py-3 ${aiResult.created > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className={`text-sm font-semibold ${aiResult.created > 0 ? 'text-emerald-900' : 'text-amber-900'}`}>
                  {aiResult.created > 0 ? '✅' : '⚠️'} {aiResult.message}
                </div>
              </div>

              {/* Lavoratori pianificati */}
              {(aiResult.scheduledEmployees ?? []).length > 0 && (
                <details open className="rounded-xl border border-emerald-200 bg-emerald-50/50">
                  <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-emerald-800">
                    ✅ Lavoratori pianificati ({aiResult.scheduledEmployees!.length})
                  </summary>
                  <div className="border-t border-emerald-200 px-4 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-emerald-700">
                          <th className="py-1">Nominativo</th>
                          <th className="py-1 text-right">Turni assegnati</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiResult.scheduledEmployees!.map((e, i) => (
                          <tr key={i} className="border-t border-emerald-100">
                            <td className="py-1 font-medium text-slate-800">{e.nominativo}</td>
                            <td className="py-1 text-right font-bold text-emerald-700">{e.turniAssegnati}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {/* Lavoratori esclusi */}
              {(aiResult.skippedEmployees ?? []).length > 0 && (
                <details className="rounded-xl border border-amber-200 bg-amber-50/50">
                  <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-amber-800">
                    ⚠️ Lavoratori esclusi ({aiResult.skippedEmployees!.length})
                  </summary>
                  <div className="border-t border-amber-200 px-4 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-amber-700">
                          <th className="py-1">Nominativo</th>
                          <th className="py-1">Motivo esclusione</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiResult.skippedEmployees!.map((e, i) => (
                          <tr key={i} className="border-t border-amber-100">
                            <td className="py-1 font-medium text-slate-800">{e.nominativo}</td>
                            <td className="py-1 text-red-600">{e.motivo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {/* Slot non coperti */}
              {(aiResult.uncoveredSlots ?? []).length > 0 && (
                <details className="rounded-xl border border-red-200 bg-red-50/50">
                  <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-red-800">
                    ❌ Fasce non coperte ({aiResult.uncoveredSlots!.length})
                  </summary>
                  <div className="border-t border-red-200 px-4 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-red-700">
                          <th className="py-1">Data</th>
                          <th className="py-1">Giorno</th>
                          <th className="py-1">Orario</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiResult.uncoveredSlots!.map((s, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="py-1 font-medium text-slate-800">{s.data}</td>
                            <td className="py-1 text-slate-600">{s.giorno}</td>
                            <td className="py-1 font-mono text-slate-800">{s.orario}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => { setIsAiModalOpen(false); setAiResult(null); }}
                  className="rounded-xl bg-[var(--brand-primary)] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
                >
                  Chiudi
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
