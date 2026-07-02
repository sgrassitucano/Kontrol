"use client";

import { useEffect, useState, useCallback } from "react";
import { ModuleHeader, PanelCard } from "@/components/module-ui";
import { Download, Plus, Trash2, FileText, X } from "lucide-react";

function formatYYYYMMDD_HHMM(d: Date) {
  return `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, "0")}${d.getDate().toString().padStart(2, "0")}_${d.getHours().toString().padStart(2, "0")}${d.getMinutes().toString().padStart(2, "0")}`;
}

type DraftRow = {
  id: string;
  employee_id: number;
  course_id: number;
  provider: string | null;
  mode: string | null;
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
  responsabile: string;
  referente: string;
  note: string;
};

export default function PianificazionePage() {
  const [courses, setCourses] = useState<WorkerCourseRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [mode, setMode] = useState("E-learning");
  const [plannedDate, setPlannedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
      const filtered = (coursesData.rows || []).filter(
        (r: WorkerCourseRow) =>
          ["scaduto", "in scadenza", "da fare", "perso"].includes(r.stato) && !r.dataPrevista,
      );
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

  const toggleSelection = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const toggleAll = () => {
    if (selectedKeys.size === courses.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(courses.map((r) => `${r.workerId}-${r.courseId}`)));
    }
  };

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
        provider,
        mode,
        notes,
        planned_date: plannedDate ? new Date(plannedDate).toISOString() : null,
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
      setProvider("");
      setPlannedDate("");
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
        mode: d.mode ?? "",
        provider: d.provider ?? "",
        planned_date: null,
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
                <span className="text-sm font-normal text-[var(--brand-soft)]">({courses.length})</span>
              </h2>
              <button
                disabled={selectedKeys.size === 0}
                onClick={openModal}
                className="flex items-center gap-2"
              >
                <Plus size={14} /> Aggiungi a Pianificazione ({selectedKeys.size})
              </button>
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
                          checked={selectedKeys.size > 0 && selectedKeys.size === courses.length}
                          onChange={toggleAll}
                          aria-label="Seleziona tutti"
                        />
                      </th>
                      <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-[var(--brand-soft)]">
                        Nominativo
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
                    {courses.map((r) => {
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
                          <td className="px-4 py-2.5 text-[var(--brand-soft)]">
                            [{r.corsoCode}] {r.corso}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold leading-none border-slate-300/60 bg-slate-100/70 text-slate-700 dark:border-slate-600/60 dark:bg-slate-800/70 dark:text-slate-300">
                              {r.stato}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {courses.length === 0 && !isLoading && (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-sm text-[var(--brand-soft)]">
                          Nessun fabbisogno rilevato.
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
                    {d.provider ? (
                      <div>
                        <span className="font-medium text-[var(--brand-ink)]">Fornitore:</span> {d.provider}
                      </div>
                    ) : null}
                    {d.mode ? (
                      <div>
                        <span className="font-medium text-[var(--brand-ink)]">Modalità:</span> {d.mode}
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
                    Fornitore / Luogo
                  </label>
                  <input
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    type="text"
                    placeholder="Es. Tucano"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                    Modalità
                  </label>
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="E-learning">E-learning</option>
                    <option value="Aula">Aula</option>
                    <option value="Videoconferenza">Videoconferenza</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--brand-soft)] mb-1">
                    Data Prevista (Opzionale)
                  </label>
                  <input
                    value={plannedDate}
                    onChange={(e) => setPlannedDate(e.target.value)}
                    type="date"
                  />
                  <p className="text-[11px] text-[var(--brand-soft)] mt-1">
                    Con data → &ldquo;Programmato&rdquo; sulla riga. Senza data → bozza.
                  </p>
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
                  <button type="submit" disabled={isSaving}>
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
