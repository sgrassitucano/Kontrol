"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ItDateInput } from "@/components/it-date-input";
import { buildHttpErrorMessage, extractResponseError, readJsonSafely } from "@/lib/client/http";

type CourseOption = { code: string; title: string };
type WorkerOption = { workerId: number; matricola: string; fullName: string; cantiere: string; sottocantiere: string };

type EventType = "PROGRAMMATO" | "RIMUOVI_PROGRAMMATO" | "SVOLTO" | "MODIFICA_DATA" | "ANNULLA" | "DA_FARE" | "NOTE";

export function EventModal(props: {
  isOpen: boolean;
  onClose: () => void;
  selectedWorkerIds: Set<number>;
  toggleWorkerSelection: (workerId: number) => void;
  clearSelection: () => void;
  workerOptions: WorkerOption[];
  courseOptions: CourseOption[];
  initial: {
    courseCode: string;
    courseSearch: string;
    type: EventType;
    date: string;
    note: string;
    token: number;
  };
  onSaved: (employeeIds: number[]) => Promise<void> | void;
}) {
  const {
    isOpen,
    onClose,
    selectedWorkerIds,
    toggleWorkerSelection,
    clearSelection,
    workerOptions,
    courseOptions,
    initial,
    onSaved,
  } = props;

  const [eventWorkerSearch, setEventWorkerSearch] = useState("");
  const [eventCourseSearch, setEventCourseSearch] = useState("");
  const [eventSelectedCourseCode, setEventSelectedCourseCode] = useState("");
  const [eventType, setEventType] = useState<EventType>("PROGRAMMATO");
  const [eventDate, setEventDate] = useState("");
  const [eventNote, setEventNote] = useState("");
  const [eventSaveError, setEventSaveError] = useState("");
  const [eventSaving, setEventSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEventWorkerSearch("");
    setEventCourseSearch(initial.courseSearch);
    setEventSelectedCourseCode(initial.courseCode);
    setEventType(initial.type);
    setEventDate(initial.date);
    setEventNote(initial.note);
    setEventSaveError("");
    setEventSaving(false);
  }, [initial, isOpen]);

  const filteredEventWorkers = useMemo(() => {
    const q = eventWorkerSearch.trim().toLowerCase();
    const list = !q
      ? workerOptions
      : workerOptions.filter((worker) =>
          `${worker.matricola} ${worker.fullName} ${worker.cantiere} ${worker.sottocantiere}`
            .toLowerCase()
            .includes(q),
        );
    return list.slice(0, 10);
  }, [eventWorkerSearch, workerOptions]);

  const filteredEventCourses = useMemo(() => {
    const q = eventCourseSearch.trim().toLowerCase();
    const list = !q
      ? courseOptions
      : courseOptions.filter((course) =>
          `${course.code} ${course.title}`.toLowerCase().includes(q),
        );
    return list;
  }, [courseOptions, eventCourseSearch]);

  const selectedEventWorkers = useMemo(() => {
    if (selectedWorkerIds.size === 0) return [] as WorkerOption[];
    return workerOptions.filter((worker) => selectedWorkerIds.has(worker.workerId));
  }, [selectedWorkerIds, workerOptions]);

  const selectedEventCourse = useMemo(
    () => courseOptions.find((course) => course.code === eventSelectedCourseCode) ?? null,
    [courseOptions, eventSelectedCourseCode],
  );

  const canSaveEvent = Boolean(
    selectedEventWorkers.length > 0 &&
      selectedEventCourse &&
      (!(eventType === "SVOLTO" || eventType === "MODIFICA_DATA") || Boolean(eventDate)),
  );

  const saveEvent = useCallback(async () => {
    if (!selectedEventCourse) return;
    if (selectedEventWorkers.length === 0) return;

    setEventSaving(true);
    setEventSaveError("");
    try {
      const employeeIds = selectedEventWorkers.map((w) => w.workerId);
      const typeToSend: EventType = eventType;

      const courseCodes = selectedEventCourse.code.startsWith("FORM_BASE+")
        ? ["FORM_BASE", selectedEventCourse.code.slice("FORM_BASE+".length)]
        : [selectedEventCourse.code];

      if (typeToSend === "ANNULLA") {
        const previews = await Promise.all(
          courseCodes.map(async (courseCode) => {
            const previewResponse = await fetch("/api/formazione/eventi", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                employeeIds,
                courseCode,
                type: "ANNULLA",
                note: eventNote,
                dryRun: true,
              }),
            });
            const previewBody = (await previewResponse.json()) as {
              error?: string;
              excluded?: number;
              clearedPlanned?: number;
              completed?: number;
            };
            if (!previewResponse.ok || previewBody.error) {
              throw new Error(previewBody.error ?? "Errore salvataggio evento.");
            }
            return previewBody;
          }),
        );

        const completed = previews.reduce((acc, p) => acc + Number(p.completed ?? 0), 0);
        if (completed > 0) {
          const ok = window.confirm(
            `Ci sono ${completed} dipendenti che risultano già “SVOLTO” per questo corso. Procedo comunque ad annullare per gli altri?`,
          );
          if (!ok) return;
        }
      }

      if (typeToSend === "DA_FARE") {
        const previews = await Promise.all(
          courseCodes.map(async (courseCode) => {
            const previewResponse = await fetch("/api/formazione/eventi", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                employeeIds,
                courseCode,
                type: "DA_FARE",
                note: eventNote,
                dryRun: true,
              }),
            });
            const previewBody = (await previewResponse.json()) as { error?: string; completed?: number };
            if (!previewResponse.ok || previewBody.error) {
              throw new Error(previewBody.error ?? "Errore salvataggio evento.");
            }
            return previewBody;
          }),
        );

        const completed = previews.reduce((acc, p) => acc + Number(p.completed ?? 0), 0);
        if (completed > 0) {
          const ok = window.confirm(
            `Ci sono ${completed} dipendenti che risultano già “SVOLTO” per questo corso. Procedo comunque ad impostare “DA FARE” per gli altri?`,
          );
          if (!ok) return;
        }
      }

      await Promise.all(
        courseCodes.map(async (courseCode) => {
          const response = await fetch("/api/formazione/eventi", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employeeIds,
              courseCode,
              type: typeToSend,
              date: eventDate || undefined,
              note: eventNote,
            }),
          });
          const body = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
          if (!body || !response.ok || extractResponseError(body)) {
            throw new Error(buildHttpErrorMessage(response, body, "Errore salvataggio evento"));
          }
        }),
      );

      await onSaved(employeeIds);
    } catch (err) {
      setEventSaveError(err instanceof Error ? err.message : "Errore salvataggio evento.");
    } finally {
      setEventSaving(false);
    }
  }, [eventDate, eventNote, eventType, onSaved, selectedEventCourse, selectedEventWorkers]);

  if (!isOpen) return null;

  return (
    <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--brand-line)] bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--brand-ink)]">Nuovo Evento Corso</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Selezione guidata con ricerca su anagrafica e catalogo corsi.</p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold text-[var(--brand-ink)]">{selectedEventWorkers.length}</span>
            <span>selezionati</span>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg bg-[var(--brand-primary)] px-2 py-1 text-[11px] font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={selectedWorkerIds.size === 0}
            >
              Pulisci
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600">Ricerca lavoratore</label>
            <input
              value={eventWorkerSearch}
              onChange={(event) => setEventWorkerSearch(event.target.value)}
              className="w-full rounded-xl border border-[var(--brand-line)] px-3 py-2 text-sm"
              placeholder="Matricola, cognome, nome, cantiere..."
            />
            <div className="max-h-44 overflow-auto rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)]">
              {filteredEventWorkers.map((worker) => (
                <label
                  key={`search-${worker.workerId}`}
                  className="flex cursor-pointer items-start gap-2 border-b border-[var(--brand-line)] px-3 py-2 text-left text-xs transition last:border-b-0 hover:bg-white"
                >
                  <input
                    type="checkbox"
                    checked={selectedWorkerIds.has(worker.workerId)}
                    onChange={() => toggleWorkerSelection(worker.workerId)}
                    aria-label={`Seleziona ${worker.fullName} (${worker.matricola})`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-800">{worker.fullName}</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {worker.matricola} - {worker.cantiere} / {worker.sottocantiere}
                    </span>
                  </span>
                </label>
              ))}
              {filteredEventWorkers.length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-500">Nessun lavoratore trovato.</p>
              ) : null}
            </div>

            <label className="pt-2 text-xs font-semibold text-slate-600">Dipendenti selezionati</label>
            <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-3">
              <p className="text-xs text-slate-600">
                <span className="font-semibold text-[var(--brand-ink)]">{selectedEventWorkers.length}</span> selezionati.
              </p>
              <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-[var(--brand-line)] bg-white">
                {selectedEventWorkers.slice(0, 60).map((worker) => (
                  <div
                    key={`sel-${worker.workerId}`}
                    className="border-b border-[var(--brand-line)] px-3 py-2 text-xs last:border-b-0"
                  >
                    <div className="font-semibold text-slate-800">{worker.fullName}</div>
                    <div className="text-[11px] text-slate-500">
                      {worker.matricola} - {worker.cantiere} / {worker.sottocantiere}
                    </div>
                  </div>
                ))}
                {selectedEventWorkers.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-500">
                    Seleziona uno o più lavoratori dalla tabella o da questa ricerca.
                  </p>
                ) : null}
                {selectedEventWorkers.length > 60 ? (
                  <p className="px-3 py-2 text-[11px] text-slate-500">
                    Visualizzati i primi 60 su {selectedEventWorkers.length}.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600">Titolo corso</label>
            <input
              value={eventCourseSearch}
              onChange={(event) => setEventCourseSearch(event.target.value)}
              className="w-full rounded-xl border border-[var(--brand-line)] px-3 py-2 text-sm"
              placeholder="Filtra corsi..."
            />
            <select
              value={eventSelectedCourseCode}
              onChange={(event) => setEventSelectedCourseCode(event.target.value)}
              className="w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
            >
              <option value="">Seleziona corso</option>
              {filteredEventCourses.map((course) => (
                <option key={course.code} value={course.code}>
                  {course.title} ({course.code})
                </option>
              ))}
            </select>
            {filteredEventCourses.length === 0 ? <p className="px-1 text-xs text-slate-500">Nessun corso trovato.</p> : null}

            <div className="mt-3 grid gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-3 text-xs text-slate-600">
              <div>
                <span className="font-semibold text-[var(--brand-ink)]">Dipendenti: </span>
                {selectedEventWorkers.length > 0 ? selectedEventWorkers.length : "nessuno selezionato"}
              </div>
              <div>
                <span className="font-semibold text-[var(--brand-ink)]">Corso: </span>
                {selectedEventCourse ? `${selectedEventCourse.code} - ${selectedEventCourse.title}` : "non selezionato"}
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <select
                value={eventType}
                onChange={(event) => setEventType(event.target.value as EventType)}
                className="rounded-xl border border-[var(--brand-line)] px-3 py-2 text-sm"
              >
                <option value="PROGRAMMATO">PROGRAMMATO</option>
                <option value="RIMUOVI_PROGRAMMATO">RIMUOVI_PROGRAMMATO</option>
                <option value="DA_FARE">DA_FARE</option>
                <option value="SVOLTO">SVOLTO</option>
                <option value="MODIFICA_DATA">MODIFICA_DATA</option>
                <option value="ANNULLA">ANNULLA</option>
                <option value="NOTE">NOTE</option>
              </select>
              <ItDateInput
                valueIso={eventDate}
                onChangeIso={setEventDate}
                disabled={!(eventType === "SVOLTO" || eventType === "MODIFICA_DATA" || eventType === "PROGRAMMATO")}
                className="rounded-xl border border-[var(--brand-line)] px-3 py-2 text-sm disabled:bg-slate-100"
              />
              <input
                value={eventNote}
                onChange={(event) => setEventNote(event.target.value)}
                className="rounded-xl border border-[var(--brand-line)] px-3 py-2 text-sm md:col-span-2"
                placeholder="Note (opzionali)"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
          >
            Chiudi
          </button>
          <button
            type="button"
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
            disabled={!canSaveEvent || eventSaving}
            title="Salva evento"
            onClick={() => void saveEvent()}
          >
            {eventSaving ? "Salvo..." : "Salva evento"}
          </button>
        </div>

        {eventSaveError ? <p className="mt-3 text-xs font-medium text-red-600">{eventSaveError}</p> : null}
      </div>
    </section>
  );
}
