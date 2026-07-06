"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { ModuleHeader, PanelCard } from "@/components/module-ui";
import { Download, Plus, Trash2, FileText, X } from "lucide-react";

function formatYYYYMMDD_HHMM(d: Date) {
  return `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, "0")}${d.getDate().toString().padStart(2, "0")}_${d.getHours().toString().padStart(2, "0")}${d.getMinutes().toString().padStart(2, "0")}`;
}

type DraftRow = {
  id: string;
  employee_id: number;
  course_id: number;
  course_type: string | null;
  fornitore: string | null;
  location: string | null;
  date1: string | null;
  time1_start: string | null;
  date2: string | null;
  time2_start: string | null;
  notes: string | null;
  created_at: string;
  employees: { matricola: string; first_name: string; last_name: string; job_title: string; sites: { display_name: string } | null };
  training_courses: { code: string; title: string };
};

type WorkerCourseRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  courseId: number;
  corsoCode: string;
  corso: string;
  dataConclusione: string | null;
  dataScadenza: string | null;
  dataPrevista: string | null;
  stato: string;
  blockedBy?: { code: string; title: string } | null;
  responsabile: string;
  referente: string;
  note: string;
};

// Stati che rappresentano un fabbisogno da pianificare. "bloccato" non è uno
// stato server-side (deriva da blockedBy sul corso "idoneo"), va aggiunto qui.
const PIANIFICABILE_STATI = new Set(["scaduto", "in scadenza", "da fare", "perso", "upgrade"]);

function isPianificabile(row: WorkerCourseRow) {
  if (row.dataPrevista) return false;
  if (row.blockedBy) return true;
  return PIANIFICABILE_STATI.has(row.stato);
}

export default function PianificazionePage() {
  const [courses, setCourses] = useState<WorkerCourseRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [corsoFilter, setCorsoFilter] = useState("");
  const [cantiereFilter, setCantiereFilter] = useState("");
  const [mansioneFilter, setMansioneFilter] = useState("");
  const [statoFilter, setStatoFilter] = useState("");

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [courseType, setCourseType] = useState("e-learning");
  const [fornitore, setFornitore] = useState("");
  const [location, setLocation] = useState("");
  const [date1, setDate1] = useState("");
  const [time1Start, setTime1Start] = useState("09:00");
  const [date2, setDate2] = useState("");
  const [time2Start, setTime2Start] = useState("");
  const [notes, setNotes] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [courseHours, setCourseHours] = useState<Record<number, { hours_elearning: number; hours_aula: number }>>({});

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [draftsRes, coursesRes] = await Promise.all([
        fetch("/api/formazione/pianificazione/drafts"),
        fetch("/api/lavoratori/corsi?limit=10000"),
      ]);
      const [draftsData, coursesData] = await Promise.all([draftsRes.json(), coursesRes.json()]);
      if (!draftsRes.ok) throw new Error(draftsData.error || "Errore caricamento bozze");
      if (!coursesRes.ok) throw new Error(coursesData.error || "Errore caricamento fabbisogni");

      setDrafts(draftsData);
      const filtered = (coursesData.rows || []).filter(isPianificabile);
      setCourses(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore sconosciuto.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const corsoOptions = useMemo(
    () => Array.from(new Set(courses.map((r) => r.corsoCode))).sort(),
    [courses],
  );
  const cantiereOptions = useMemo(
    () => Array.from(new Set(courses.map((r) => r.cantiere).filter(Boolean))).sort(),
    [courses],
  );
  const mansioneOptions = useMemo(
    () => Array.from(new Set(courses.map((r) => r.mansione).filter(Boolean))).sort(),
    [courses],
  );
  const statoOptions = useMemo(
    () => Array.from(new Set(courses.map((r) => (r.blockedBy ? "bloccato" : r.stato)))).sort(),
    [courses],
  );

  const filteredCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courses.filter((r) => {
      if (corsoFilter && r.corsoCode !== corsoFilter) return false;
      if (cantiereFilter && r.cantiere !== cantiereFilter) return false;
      if (mansioneFilter && r.mansione !== mansioneFilter) return false;
      if (statoFilter) {
        const effectiveStato = r.blockedBy ? "bloccato" : r.stato;
        if (effectiveStato !== statoFilter) return false;
      }
      if (q) {
        const haystack = `${r.cognome} ${r.nome} ${r.matricola} ${r.corso} ${r.corsoCode}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [courses, search, corsoFilter, cantiereFilter, mansioneFilter, statoFilter]);

  const toggleSelection = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const filteredKeys = useMemo(() => filteredCourses.map((r) => `${r.workerId}-${r.courseId}`), [filteredCourses]);
  const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((k) => selectedKeys.has(k));

  const toggleAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedKeys);
      filteredKeys.forEach((k) => next.delete(k));
      setSelectedKeys(next);
    } else {
      const next = new Set(selectedKeys);
      filteredKeys.forEach((k) => next.add(k));
      setSelectedKeys(next);
    }
  };

  // Calculate auto date2/time2 based on course hours
  const calculateDate2AndTime2 = useCallback((
    d1: string,
    t1: string,
    hours: number,
  ): { date2: string; time2: string } => {
    if (!d1 || !t1 || hours === 0) return { date2: "", time2: "" };

    const [h, m] = t1.split(":").map(Number);
    const workStartMinutes = h * 60 + m; // Minutes since midnight
    const WORK_START = 9 * 60; // 09:00
    const WORK_END = 18 * 60; // 18:00
    const DAY_WORK_HOURS = 8; // 8 hours work per day (09-18 with 1h lunch)

    const date1Obj = new Date(d1);
    let remainingHours = hours;
    let currentDate = new Date(date1Obj);
    let currentTimeMinutes = workStartMinutes;

    // Day 1: calculate how many hours we can fit
    const minutesAvailableDay1 = WORK_END - currentTimeMinutes;
    const hoursDay1 = minutesAvailableDay1 / 60;

    if (hours <= hoursDay1) {
      // Fits in one day
      return { date2: "", time2: "" };
    }

    remainingHours -= hoursDay1;
    currentDate.setDate(currentDate.getDate() + 1);

    // Subsequent days: 8 hours per day starting at 09:00
    while (remainingHours > DAY_WORK_HOURS) {
      remainingHours -= DAY_WORK_HOURS;
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Last day: calculate end time
    const finalHours = remainingHours;
    const finalMinutes = WORK_START + finalHours * 60;
    const finalHour = Math.floor(finalMinutes / 60);
    const finalMin = finalMinutes % 60;

    const date2Str = currentDate.toISOString().split("T")[0];
    const time2Str = `${finalHour.toString().padStart(2, "0")}:${finalMin.toString().padStart(2, "0")}`;

    return { date2: date2Str, time2: time2Str };
  }, []);

  // Load course hours when modal opens
  useEffect(() => {
    if (!isModalOpen) return;

    const firstKey = Array.from(selectedKeys)[0];
    if (!firstKey) return;

    const courseId = parseInt(firstKey.split("-")[1], 10);
    if (!courseId || courseHours[courseId]) return;

    fetch(`/api/formazione/pianificazione/course-hours?course_id=${courseId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setCourseHours((prev) => ({
            ...prev,
            [courseId]: { hours_elearning: data.hours_elearning || 0, hours_aula: data.hours_aula || 0 },
          }));
        }
      })
      .catch(() => {
        // No hours data yet
      });
  }, [isModalOpen, selectedKeys, courseHours]);

  // Auto-calculate date2/time2 when date1, time1, or courseType changes
  useEffect(() => {
    if (!date1 || !time1Start) {
      setDate2("");
      setTime2Start("");
      return;
    }

    const firstKey = Array.from(selectedKeys)[0];
    if (!firstKey) return;

    const courseId = parseInt(firstKey.split("-")[1], 10);
    const hoursData = courseHours[courseId];
    if (!hoursData) return;

    const hours = courseType === "e-learning" ? hoursData.hours_elearning : hoursData.hours_aula;
    const { date2: d2, time2: t2 } = calculateDate2AndTime2(date1, time1Start, hours);

    setDate2(d2);
    setTime2Start(t2);
  }, [date1, time1Start, courseType, selectedKeys, courseHours, calculateDate2AndTime2]);

  const openModal = () => {
    setSaveError("");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSaveError("");
  };

  const handlePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedKeys.size === 0) return;
    setSaveError("");
    setIsSaving(true);

    const payload = Array.from(selectedKeys).map((key) => {
      const [workerId, courseId] = key.split("-").map(Number);
      return {
        employee_id: workerId,
        course_id: courseId,
        course_type: courseType,
        fornitore,
        location,
        date1: date1 || null,
        time1_start: time1Start || null,
        date2: date2 || null,
        time2_start: time2Start || null,
        notes,
      };
    });

    try {
      const res = await fetch("/api/formazione/pianificazione/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore salvataggio");

      closeModal();
      setSelectedKeys(new Set());
      setCourseType("e-learning");
      setFornitore("");
      setLocation("");
      setDate1("");
      setTime1Start("09:00");
      setDate2("");
      setTime2Start("");
      setNotes("");
      await loadData();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Errore salvataggio");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDraft = async (id: string) => {
    setError("");
    try {
      const res = await fetch(`/api/formazione/pianificazione/drafts?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Errore eliminazione");
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore eliminazione");
    }
  };

  const handleExport = async () => {
    setExportError("");
    try {
      const exportPayload = drafts.map((d) => ({
        matricola: d.employees.matricola,
        cognome: d.employees.last_name,
        nome: d.employees.first_name,
        mansione: d.employees.job_title,
        cantiere: d.employees.sites?.display_name ?? "",
        sottocantiere: "",
        corsoCode: d.training_courses.code,
        upgradeInfo: "",
        dataConclusione: "",
        dataScadenza: "",
        dataPrevista: "",
        note: d.notes ?? "",
        stato: "Programmato",
        course_type: d.course_type ?? "",
        fornitore: d.fornitore ?? "",
        location: d.location ?? "",
        date1: d.date1 ?? null,
        time1_start: d.time1_start ?? null,
        date2: d.date2 ?? null,
        time2_start: d.time2_start ?? null,
      }));

      const res = await fetch("/api/formazione/pianificazione/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportPayload),
      });
      if (!res.ok) throw new Error("Errore export");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `caricamento_${formatYYYYMMDD_HHMM(new Date())}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Errore esportazione Excel");
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-[var(--brand-page)]">
      <ModuleHeader
        title="Pianificazione Formazione"
        description="Raggruppa e organizza i fabbisogni formativi"
        actions={
          <div className="flex flex-col items-end gap-1">
            <button onClick={handleExport} disabled={drafts.length === 0} data-soft="true">
              <Download size={16} /> Esporta Bozze (Excel)
            </button>
            {exportError ? <p className="text-xs font-medium text-red-600">{exportError}</p> : null}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 flex flex-col xl:flex-row gap-6">
        {/* Sinistra: Fabbisogni */}
        <div className="flex-1 flex flex-col min-w-0">
          <PanelCard className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[var(--brand-line)] flex flex-wrap justify-between items-center gap-3">
              <h2 className="text-base font-bold text-[var(--brand-ink)]">
                Fabbisogni Formativi{" "}
                <span className="text-sm font-normal text-[var(--brand-soft)]">
                  ({filteredCourses.length}/{courses.length})
                </span>
              </h2>
              <button
                disabled={selectedKeys.size === 0}
                onClick={openModal}
                className="flex items-center gap-2"
              >
                <Plus size={14} /> Aggiungi a Pianificazione ({selectedKeys.size})
              </button>
            </div>

            <div className="p-4 border-b border-[var(--brand-line)] grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca nome, matricola, corso..."
                className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
              />
              <select
                value={corsoFilter}
                onChange={(e) => setCorsoFilter(e.target.value)}
                className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
              >
                <option value="">Tutti i corsi</option>
                {corsoOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={cantiereFilter}
                onChange={(e) => setCantiereFilter(e.target.value)}
                className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
              >
                <option value="">Tutti i cantieri</option>
                {cantiereOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={mansioneFilter}
                onChange={(e) => setMansioneFilter(e.target.value)}
                className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
              >
                <option value="">Tutte le mansioni</option>
                {mansioneOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={statoFilter}
                onChange={(e) => setStatoFilter(e.target.value)}
                className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
              >
                <option value="">Tutti gli stati</option>
                {statoOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {search || corsoFilter || cantiereFilter || mansioneFilter || statoFilter ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCorsoFilter("");
                    setCantiereFilter("");
                    setMansioneFilter("");
                    setStatoFilter("");
                  }}
                  data-soft="true"
                  className="rounded-xl px-3 py-2 text-sm"
                >
                  Reset filtri
                </button>
              ) : null}
            </div>

            {error ? (
              <p className="mx-4 mt-3 text-xs font-medium text-red-600 rounded-xl bg-red-50 dark:bg-red-950/30 px-3 py-2">
                {error}
              </p>
            ) : null}

            {isLoading ? (
              <div className="p-8 text-center text-sm text-[var(--brand-soft)]">Caricamento...</div>
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="sticky top-0 bg-[var(--brand-panel-2)] z-10">
                    <tr>
                      <th className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAll}
                          aria-label="Seleziona tutti i filtrati"
                        />
                      </th>
                      <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-[var(--brand-soft)]">
                        Nominativo
                      </th>
                      <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-[var(--brand-soft)]">
                        Mansione
                      </th>
                      <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-[var(--brand-soft)]">
                        Cantiere
                      </th>
                      <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-[var(--brand-soft)]">
                        Corso
                      </th>
                      <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-[var(--brand-soft)]">
                        Stato
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCourses.map((r) => {
                      const key = `${r.workerId}-${r.courseId}`;
                      return (
                        <tr
                          key={key}
                          className="border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60 cursor-pointer"
                          onClick={() => toggleSelection(key)}
                        >
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(key)}
                              onChange={() => toggleSelection(key)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Seleziona ${r.cognome} ${r.nome}`}
                            />
                          </td>
                          <td className="px-4 py-2.5 font-medium text-[var(--brand-ink)]">
                            {r.cognome} {r.nome}
                            <span className="ml-2 text-xs text-[var(--brand-soft)]">{r.matricola}</span>
                          </td>
                          <td className="px-4 py-2.5 text-[var(--brand-soft)]">{r.mansione || "-"}</td>
                          <td className="px-4 py-2.5 text-[var(--brand-soft)]">{r.cantiere || "-"}</td>
                          <td className="px-4 py-2.5 text-[var(--brand-soft)]">
                            [{r.corsoCode}] {r.corso}
                          </td>
                          <td className="px-4 py-2.5">
                            {r.blockedBy ? (
                              <span
                                className="inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold leading-none border-red-300/60 bg-red-100/70 text-red-700"
                                title={`Bloccato da: ${r.blockedBy.title} (${r.blockedBy.code})`}
                              >
                                bloccato
                              </span>
                            ) : (
                              <span className="inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold leading-none border-slate-300/60 bg-slate-100/70 text-slate-700 dark:border-slate-600/60 dark:bg-slate-800/70 dark:text-slate-300">
                                {r.stato}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredCourses.length === 0 && !isLoading && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-sm text-[var(--brand-soft)]">
                          {courses.length === 0 ? "Nessun fabbisogno rilevato." : "Nessun risultato con i filtri attuali."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </PanelCard>
        </div>

        {/* Destra: Bozze */}
        <div className="w-full xl:w-96 flex flex-col shrink-0">
          <PanelCard className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[var(--brand-line)] flex justify-between items-center">
              <h2 className="text-base font-bold text-[var(--brand-ink)]">
                Bozze Salvate{" "}
                <span className="text-sm font-normal text-[var(--brand-soft)]">({drafts.length})</span>
              </h2>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className="bg-[var(--brand-panel-2)] p-4 rounded-xl border border-[var(--brand-line)] relative group"
                >
                  <button
                    onClick={() => void handleDeleteDraft(d.id)}
                    data-unstyled="true"
                    aria-label="Elimina bozza"
                    className="absolute top-3 right-3 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-700"
                  >
                    <Trash2 size={15} />
                  </button>
                  <div className="font-semibold text-[var(--brand-ink)] pr-6">
                    {d.employees.last_name} {d.employees.first_name}
                  </div>
                  <div className="text-xs text-[var(--brand-soft)] mb-2">
                    [{d.training_courses.code}] {d.training_courses.title}
                  </div>
                  <div className="flex flex-col gap-1 text-xs text-[var(--brand-soft)]">
                    {d.course_type ? (
                      <div>
                        <span className="font-medium text-[var(--brand-ink)]">Tipo:</span> {d.course_type}
                      </div>
                    ) : null}
                    {d.fornitore ? (
                      <div>
                        <span className="font-medium text-[var(--brand-ink)]">Fornitore:</span> {d.fornitore}
                      </div>
                    ) : null}
                    {d.location ? (
                      <div>
                        <span className="font-medium text-[var(--brand-ink)]">Luogo:</span> {d.location}
                      </div>
                    ) : null}
                    {d.date1 ? (
                      <div>
                        <span className="font-medium text-[var(--brand-ink)]">Data:</span>{" "}
                        {new Date(d.date1).toLocaleDateString("it-IT")}
                        {d.time1_start ? ` ${d.time1_start}` : null}
                        {d.date2 ? ` - ${new Date(d.date2).toLocaleDateString("it-IT")}` : null}
                        {d.time2_start ? ` ${d.time2_start}` : null}
                      </div>
                    ) : null}
                    {d.notes ? (
                      <div>
                        <span className="font-medium text-[var(--brand-ink)]">Note:</span> {d.notes}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {drafts.length === 0 && (
                <div className="text-center p-8 text-[var(--brand-soft)]">
                  <FileText className="mx-auto mb-2 opacity-40" size={32} />
                  <p className="text-sm">Nessuna bozza salvata.</p>
                </div>
              )}
            </div>
          </PanelCard>
        </div>
      </div>

      {/* Modal Pianificazione */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="animate-modal bg-[var(--brand-panel)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border border-[var(--brand-line)]">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-[var(--brand-ink)]">
                  Pianifica {selectedKeys.size} Selezionati
                </h2>
                <button data-unstyled="true" onClick={closeModal} aria-label="Chiudi">
                  <X size={18} className="text-[var(--brand-soft)]" />
                </button>
              </div>

              {saveError ? (
                <p className="mb-3 text-xs font-medium text-red-600 rounded-xl bg-red-50 dark:bg-red-950/30 px-3 py-2">
                  {saveError}
                </p>
              ) : null}

              <form onSubmit={(e) => void handlePlan(e)} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                    Tipo Corso
                  </label>
                  <select value={courseType} onChange={(e) => setCourseType(e.target.value)}>
                    <option value="e-learning">E-learning</option>
                    <option value="fad_sincrona">FAD Sincrona</option>
                    <option value="presenza">Presenza</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                    Fornitore
                  </label>
                  <input
                    value={fornitore}
                    onChange={(e) => setFornitore(e.target.value)}
                    type="text"
                    placeholder="Es. Tucano"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                    Luogo
                  </label>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    type="text"
                    placeholder="Es. Cantiere XX / Via XX"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                      Data 1
                    </label>
                    <input
                      value={date1}
                      onChange={(e) => setDate1(e.target.value)}
                      type="date"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                      Orario Inizio
                    </label>
                    <input
                      value={time1Start}
                      onChange={(e) => setTime1Start(e.target.value)}
                      type="time"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                      Data 2 (se multi-giorno)
                    </label>
                    <input
                      value={date2}
                      onChange={(e) => setDate2(e.target.value)}
                      type="date"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                      Orario Inizio Giorno 2
                    </label>
                    <input
                      value={time2Start}
                      onChange={(e) => setTime2Start(e.target.value)}
                      type="time"
                      disabled
                    />
                    <p className="text-[10px] text-[var(--brand-soft)] mt-0.5">Auto-calcolato</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">Note</label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    type="text"
                    placeholder="Note aggiuntive..."
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" data-soft="true" onClick={closeModal} disabled={isSaving}>
                    Annulla
                  </button>
                  <button type="submit" disabled={isSaving || !date1 || !fornitore}>
                    {isSaving ? "Salvataggio..." : "Conferma"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
