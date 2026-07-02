"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildHttpErrorMessage, extractResponseError, readJsonSafely } from "@/lib/client/http";

type WorkerOption = {
  workerId: number;
  matricola: string;
  fullName: string;
  cantiere: string;
  sottocantiere: string;
};

type PlannedAction = "no_change" | "set_true" | "set_false";
type FieldAction = "no_change" | "set" | "clear_value";
type ExclusionAction = "no_change" | "set_true" | "set_false";
type OverrideAction = "no_change" | "force_si" | "force_no" | "clear";

export function SurveillanceEventModal(props: {
  isOpen: boolean;
  onClose: () => void;
  selectedWorkerIds: Set<number>;
  toggleWorkerSelection: (workerId: number) => void;
  clearSelection: () => void;
  workerOptions: WorkerOption[];
  onSaved: (employeeIds: number[]) => Promise<void> | void;
  token: number;
}) {
  const {
    isOpen,
    onClose,
    selectedWorkerIds,
    toggleWorkerSelection,
    clearSelection,
    workerOptions,
    onSaved,
    token,
  } = props;

  const [workerSearch, setWorkerSearch] = useState("");

  const [plannedAction, setPlannedAction] = useState<PlannedAction>("no_change");
  const [providerAction, setProviderAction] = useState<FieldAction>("no_change");
  const [providerValue, setProviderValue] = useState("");

  const [dueDateAction, setDueDateAction] = useState<FieldAction>("no_change");
  const [dueDateValue, setDueDateValue] = useState("");

  const [limitationsAction, setLimitationsAction] = useState<FieldAction>("no_change");
  const [limitationsValue, setLimitationsValue] = useState("");

  const [notesAction, setNotesAction] = useState<FieldAction>("no_change");
  const [notesValue, setNotesValue] = useState("");

  const [exclusionAction, setExclusionAction] = useState<ExclusionAction>("no_change");
  const [exclusionNote, setExclusionNote] = useState("");

  const [overrideAction, setOverrideAction] = useState<OverrideAction>("no_change");
  const [overrideNote, setOverrideNote] = useState("");

  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setWorkerSearch("");
    setPlannedAction("no_change");
    setProviderAction("no_change");
    setProviderValue("");
    setDueDateAction("no_change");
    setDueDateValue("");
    setLimitationsAction("no_change");
    setLimitationsValue("");
    setNotesAction("no_change");
    setNotesValue("");
    setExclusionAction("no_change");
    setExclusionNote("");
    setOverrideAction("no_change");
    setOverrideNote("");
    setSaveError("");
    setSaving(false);
  }, [isOpen, token]);

  const filteredWorkers = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    const list = !q
      ? workerOptions
      : workerOptions.filter((w) =>
          `${w.matricola} ${w.fullName} ${w.cantiere} ${w.sottocantiere}`.toLowerCase().includes(q),
        );
    return list.slice(0, 12);
  }, [workerOptions, workerSearch]);

  const selectedWorkers = useMemo(() => {
    if (selectedWorkerIds.size === 0) return [] as WorkerOption[];
    return workerOptions.filter((w) => selectedWorkerIds.has(w.workerId));
  }, [selectedWorkerIds, workerOptions]);

  const hasAnyChange = Boolean(
    plannedAction !== "no_change" ||
      providerAction !== "no_change" ||
      dueDateAction !== "no_change" ||
      limitationsAction !== "no_change" ||
      notesAction !== "no_change" ||
      exclusionAction !== "no_change" ||
      overrideAction !== "no_change",
  );

  const canSave = Boolean(
    selectedWorkers.length > 0 &&
      hasAnyChange &&
      (dueDateAction !== "set" || Boolean(dueDateValue)),
  );

  const save = useCallback(async () => {
    if (selectedWorkers.length === 0) return;
    setSaving(true);
    setSaveError("");
    try {
      const employeeIds = selectedWorkers.map((w) => w.workerId);
      const response = await fetch("/api/sorveglianza_sanitaria/eventi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeIds,
          record: {
            planned: { action: plannedAction },
            provider: { action: providerAction, value: providerValue },
            nextDueDate: { action: dueDateAction, value: dueDateValue },
            limitations: { action: limitationsAction, value: limitationsValue },
            notes: { action: notesAction, value: notesValue },
          },
          exclusion: { action: exclusionAction, note: exclusionNote.trim() || null },
          override: { action: overrideAction, note: overrideNote.trim() || null },
        }),
      });
      const body = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
      if (!body || !response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore salvataggio evento"));
      }
      await onSaved(employeeIds);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Errore salvataggio evento.");
    } finally {
      setSaving(false);
    }
  }, [
    dueDateAction,
    dueDateValue,
    exclusionAction,
    exclusionNote,
    limitationsAction,
    limitationsValue,
    notesAction,
    notesValue,
    onSaved,
    overrideAction,
    overrideNote,
    plannedAction,
    providerAction,
    providerValue,
    selectedWorkers,
  ]);

  if (!isOpen) return null;

  return (
    <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--brand-ink)]">Nuovo evento sorveglianza</h2>
            <p className="mt-1 text-xs text-slate-500">
              Applica le modifiche ai lavoratori selezionati (sovrascrive i campi scelti).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
            title="Chiudi"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-xs text-slate-700">
              <span className="font-semibold text-[var(--brand-ink)]">{selectedWorkers.length}</span>
              <span>selezionati</span>
              <button
                type="button"
                onClick={clearSelection}
                data-soft="true"
                data-tone="muted"
                className="ml-2 rounded-lg px-2 py-1 text-xs"
                disabled={selectedWorkerIds.size === 0}
              >
                Svuota
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
              <div>
                <h3 className="text-sm font-bold text-[var(--brand-ink)]">Selezione lavoratori</h3>
                <input
                  value={workerSearch}
                  onChange={(e) => setWorkerSearch(e.target.value)}
                  placeholder="Cerca per matricola, nome, cantiere..."
                  className="mt-3 w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="max-h-72 overflow-auto rounded-xl border border-[var(--brand-line)] bg-white p-2">
                <div className="space-y-2">
                  {filteredWorkers.map((w) => {
                    const checked = selectedWorkerIds.has(w.workerId);
                    return (
                      <button
                        key={w.workerId}
                        type="button"
                        data-unstyled="true"
                        onClick={() => toggleWorkerSelection(w.workerId)}
                        className={[
                          "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition",
                          checked
                            ? "border-[var(--brand-primary)] bg-[var(--brand-tint)] text-[var(--brand-ink)]"
                            : "border-[var(--brand-line)] bg-white text-[var(--brand-ink)] hover:bg-[var(--brand-panel-2)]",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {w.matricola} · {w.fullName}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {w.cantiere} {w.sottocantiere ? `· ${w.sottocantiere}` : ""}
                          </p>
                        </div>
                        <input type="checkbox" readOnly checked={checked} className="pointer-events-none" />
                      </button>
                    );
                  })}
                  {filteredWorkers.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-slate-500">Nessun lavoratore trovato.</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--brand-line)] bg-white p-3">
                <p className="text-xs text-slate-600">
                  <span className="font-semibold text-[var(--brand-ink)]">{selectedWorkers.length}</span> selezionati.
                </p>
                <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-[var(--brand-line)] bg-[var(--brand-panel)]">
                  {selectedWorkers.slice(0, 60).map((w) => (
                    <div key={`sel-${w.workerId}`} className="border-b border-[var(--brand-line)] px-3 py-2 text-xs last:border-b-0">
                      <div className="font-semibold text-slate-800">{w.fullName}</div>
                      <div className="text-[11px] text-slate-500">
                        {w.matricola} - {w.cantiere} {w.sottocantiere ? `· ${w.sottocantiere}` : ""}
                      </div>
                    </div>
                  ))}
                  {selectedWorkers.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-slate-500">Seleziona uno o più lavoratori dalla tabella o da questa ricerca.</p>
                  ) : null}
                  {selectedWorkers.length > 60 ? (
                    <p className="px-3 py-2 text-[11px] text-slate-500">Visualizzati i primi 60 su {selectedWorkers.length}.</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
              <h3 className="text-sm font-bold text-[var(--brand-ink)]">Modifiche</h3>

              <div className="mt-3 grid gap-3">
                <LabeledSelect
                  label="Programmato"
                  value={plannedAction}
                  options={[
                    { value: "no_change", label: "Non modificare" },
                    { value: "set_true", label: "Imposta programmato" },
                    { value: "set_false", label: "Rimuovi programmato" },
                  ]}
                  onChange={(v) => setPlannedAction(v as PlannedAction)}
                />

                <FieldEditor
                  label="Provider (medico/ente)"
                  action={providerAction}
                  value={providerValue}
                  setAction={setProviderAction}
                  setValue={setProviderValue}
                  placeholder="Es. Medico competente / Ente"
                />

                <FieldEditor
                  label="Scadenza visita"
                  action={dueDateAction}
                  value={dueDateValue}
                  setAction={setDueDateAction}
                  setValue={setDueDateValue}
                  placeholder="YYYY-MM-DD"
                />

                <FieldEditor
                  label="Limitazioni"
                  action={limitationsAction}
                  value={limitationsValue}
                  setAction={setLimitationsAction}
                  setValue={setLimitationsValue}
                  placeholder="Testo limitazioni"
                  textarea
                />

                <FieldEditor
                  label="Note"
                  action={notesAction}
                  value={notesValue}
                  setAction={setNotesAction}
                  setValue={setNotesValue}
                  placeholder="Testo note"
                  textarea
                />

                <LabeledSelect
                  label="Esclusione"
                  value={exclusionAction}
                  options={[
                    { value: "no_change", label: "Non modificare" },
                    { value: "set_true", label: "Escludi" },
                    { value: "set_false", label: "Riattiva" },
                  ]}
                  onChange={(v) => setExclusionAction(v as ExclusionAction)}
                />
                {exclusionAction !== "no_change" ? (
                  <LabeledInput
                    label="Nota esclusione"
                    value={exclusionNote}
                    onChange={setExclusionNote}
                    placeholder="Motivazione"
                  />
                ) : null}

                <LabeledSelect
                  label="Override visita richiesta"
                  value={overrideAction}
                  options={[
                    { value: "no_change", label: "Non modificare" },
                    { value: "force_si", label: "Forza SI" },
                    { value: "force_no", label: "Forza NO" },
                    { value: "clear", label: "Rimuovi override" },
                  ]}
                  onChange={(v) => setOverrideAction(v as OverrideAction)}
                />
                {overrideAction !== "no_change" ? (
                  <LabeledInput label="Nota override" value={overrideNote} onChange={setOverrideNote} placeholder="Motivazione" />
                ) : null}
              </div>
            </div>
          </div>

          {saveError ? <p className="mt-3 text-xs font-medium text-red-600">{saveError}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--brand-line)] bg-[var(--brand-panel)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-[var(--brand-ink)]"
          >
            Chiudi
          </button>
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={() => void save()}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Salvataggio..." : "Salva evento"}
          </button>
        </div>
      </div>
    </section>
  );
}

function LabeledInput(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{props.label}</span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
      />
    </label>
  );
}

function LabeledSelect(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldEditor(props: {
  label: string;
  action: FieldAction;
  value: string;
  setAction: (v: FieldAction) => void;
  setValue: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--brand-line)] bg-white p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-600">{props.label}</p>
        </div>
        <select
          value={props.action}
          onChange={(e) => props.setAction(e.target.value as FieldAction)}
          className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
        >
          <option value="no_change">Non modificare</option>
          <option value="set">Sovrascrivi</option>
          <option value="clear_value">Svuota</option>
        </select>
      </div>

      {props.action === "set" ? (
        props.textarea ? (
          <textarea
            value={props.value}
            onChange={(e) => props.setValue(e.target.value)}
            placeholder={props.placeholder}
            className="mt-2 min-h-[80px] w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
        ) : (
          <input
            value={props.value}
            onChange={(e) => props.setValue(e.target.value)}
            placeholder={props.placeholder}
            className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
        )
      ) : null}
    </div>
  );
}
