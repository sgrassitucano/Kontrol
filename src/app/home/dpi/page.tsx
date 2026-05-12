"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KpiCard, KpiGrid, ModuleHeader } from "@/components/module-ui";
import { ItDateInput } from "@/components/it-date-input";

type WorkerDpiRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
  dpiId: number;
  dpi: string;
  riskActivities: string;
  category: string;
  controlFrequency: string;
  controlType: string;
  dataConsegna: string | null;
  dataProssimoControllo: string | null;
  stato: "idoneo" | "consegnato" | "da consegnare" | "da verificare" | "scaduto" | "programmato";
  note: string;
};

type EmployeeOption = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
};

type DpiItem = {
  id: number;
  title: string;
  riskActivities: string;
  category: string;
  controlFrequency: string;
  controlType: string;
};

function formatDateIt(value: string | null) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function todayLocalIso() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatIsoToItDate(iso: string) {
  const match = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function normalizeItDateDraft(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseStrictItDateToIso(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const dd = match[1];
  const mm = match[2];
  const yyyy = match[3];
  const iso = `${yyyy}-${mm}-${dd}`;
  const dt = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(dt.getTime())) return null;
  const roundTrip = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return roundTrip === iso ? iso : null;
}

function getDefaultSimulationDate() {
  return todayLocalIso();
}

export default function HomeDpiPage() {
  const [rows, setRows] = useState<WorkerDpiRow[]>([]);
  const [totalActiveEmployees, setTotalActiveEmployees] = useState(0);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [simulationDate, setSimulationDate] = useState(() => getDefaultSimulationDate());
  const [simulationDateDraft, setSimulationDateDraft] = useState(() =>
    formatIsoToItDate(getDefaultSimulationDate()),
  );
  const [expiringDays, setExpiringDays] = useState(30);
  const [filterError, setFilterError] = useState("");

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [dpiItems, setDpiItems] = useState<DpiItem[]>([]);

  const [isNewDpiOpen, setIsNewDpiOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const [newDpiForm, setNewDpiForm] = useState({
    title: "",
    riskActivities: "",
    category: "",
    controlFrequency: "",
    controlType: "",
  });

  const [assignForm, setAssignForm] = useState({
    employeeId: "",
    dpiId: "",
    mode: "deliver" as "deliver" | "plan" | "require" | "exclude",
    deliveredDate: getDefaultSimulationDate(),
    plannedDate: getDefaultSimulationDate(),
    nextCheckDate: "",
    note: "",
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setWarning("");
    try {
      const [dpiRes, employeesRes, itemsRes] = await Promise.all([
        fetch(
          `/api/lavoratori/dpi?expiringDays=${encodeURIComponent(String(expiringDays))}&date=${encodeURIComponent(
            simulationDate,
          )}`,
        ),
        fetch("/api/lavoratori/anagrafica"),
        fetch("/api/dpi/items"),
      ]);

      const dpiBody = (await dpiRes.json()) as { rows?: WorkerDpiRow[]; warning?: string; error?: string };
      if (!dpiRes.ok || dpiBody.error) throw new Error(dpiBody.error ?? "Errore caricamento DPI.");
      setRows(dpiBody.rows ?? []);
      setWarning(dpiBody.warning ?? "");

      const employeesBody = (await employeesRes.json()) as { rows?: EmployeeOption[]; totalRows?: number; error?: string };
      if (!employeesRes.ok || employeesBody.error) throw new Error(employeesBody.error ?? "Errore caricamento lavoratori.");
      setEmployees(employeesBody.rows ?? []);
      setTotalActiveEmployees(employeesBody.totalRows ?? 0);

      const itemsBody = (await itemsRes.json()) as { rows?: DpiItem[]; warning?: string; error?: string };
      if (!itemsRes.ok || itemsBody.error) throw new Error(itemsBody.error ?? "Errore caricamento catalogo DPI.");
      setDpiItems(itemsBody.rows ?? []);
      if (!dpiBody.warning) setWarning(itemsBody.warning ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento DPI.");
    } finally {
      setIsLoading(false);
    }
  }, [expiringDays, simulationDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const s = [
        row.matricola,
        row.cognome,
        row.nome,
        row.mansione,
        row.cantiere,
        row.sottocantiere,
        row.responsabile,
        row.referente,
        row.dpi,
        row.category,
        row.riskActivities,
        row.controlFrequency,
        row.controlType,
      ]
        .join(" ")
        .toLowerCase();
      return s.includes(q);
    });
  }, [rows, search]);

  function pct(count: number, total: number) {
    if (!total) return "0%";
    return `${Number(((count / total) * 100).toFixed(1))}%`;
  }

  function statusPillClassName(status: WorkerDpiRow["stato"]) {
    const base =
      "inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold leading-none";
    if (status === "idoneo" || status === "consegnato") return `${base} border-emerald-900/35 bg-emerald-400/45 text-slate-950`;
    if (status === "da verificare") return `${base} border-amber-800/45 bg-amber-300/45 text-slate-950`;
    if (status === "programmato") return `${base} border-sky-900/40 bg-sky-700/55 text-white`;
    if (status === "scaduto" || status === "da consegnare") return `${base} border-red-900/40 bg-red-700/55 text-white`;
    return `${base} border-slate-900/35 bg-slate-700/55 text-white`;
  }

  const dashboard = useMemo(() => {
    const stateRank = (s: WorkerDpiRow["stato"]) => {
      if (s === "scaduto") return 1;
      if (s === "da consegnare") return 2;
      if (s === "da verificare") return 3;
      if (s === "programmato") return 4;
      if (s === "consegnato") return 5;
      if (s === "idoneo") return 6;
      return 7;
    };

    const preferredByWorker = new Map<number, WorkerDpiRow["stato"]>();
    for (const row of filteredRows) {
      const prev = preferredByWorker.get(row.workerId);
      if (!prev || stateRank(row.stato) < stateRank(prev)) preferredByWorker.set(row.workerId, row.stato);
    }

    const byState: Record<WorkerDpiRow["stato"], Set<number>> = {
      scaduto: new Set(),
      "da verificare": new Set(),
      "da consegnare": new Set(),
      programmato: new Set(),
      idoneo: new Set(),
      consegnato: new Set(),
    };

    preferredByWorker.forEach((state, workerId) => {
      byState[state].add(workerId);
    });

    return {
      total: preferredByWorker.size,
      scaduto: byState.scaduto.size,
      daVerificare: byState["da verificare"].size,
      daConsegnare: byState["da consegnare"].size,
      programmato: byState.programmato.size,
      idoneo: byState.idoneo.size,
      consegnato: byState.consegnato.size,
    };
  }, [filteredRows]);

  async function createDpi() {
    setIsBusy(true);
    setError("");
    try {
      const response = await fetch("/api/dpi/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newDpiForm),
      });
      const body = (await response.json()) as { id?: number; error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore creazione DPI.");
      setIsNewDpiOpen(false);
      setNewDpiForm({ title: "", riskActivities: "", category: "", controlFrequency: "", controlType: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore creazione DPI.");
    } finally {
      setIsBusy(false);
    }
  }

  async function assignDpi() {
    setIsBusy(true);
    setError("");
    try {
      const response = await fetch("/api/dpi/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: Number(assignForm.employeeId),
          dpiId: Number(assignForm.dpiId),
          mode: assignForm.mode,
          deliveredDate: assignForm.deliveredDate || null,
          plannedDate: assignForm.plannedDate || null,
          nextCheckDate: assignForm.nextCheckDate || null,
          note: assignForm.note,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore assegnazione DPI.");
      setIsAssignOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore assegnazione DPI.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="DPI"
        description="Elenco lavoratori↔DPI richiesti dalla matrice e stato consegna/verifica."
        actions={
          <>
            <Link
              href="/dpi/matrice"
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Apri matrice
            </Link>
            <button
              type="button"
              onClick={() => setIsNewDpiOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Nuovo DPI
            </button>
            <button
              type="button"
              onClick={() => setIsAssignOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Assegna / Override
            </button>
          </>
        }
      >
        <KpiGrid className="sm:grid-cols-2 md:grid-cols-5">
          <KpiCard
            label="Totale"
            value={dashboard.total}
            subValue="100%"
          />
          <KpiCard
            label="Scaduto"
            value={dashboard.scaduto}
            subValue={pct(dashboard.scaduto, dashboard.total)}
            tone="danger"
          />
          <KpiCard
            label="Da verificare"
            value={dashboard.daVerificare}
            subValue={pct(dashboard.daVerificare, dashboard.total)}
            tone="warning"
          />
          <KpiCard
            label="Da consegnare"
            value={dashboard.daConsegnare}
            subValue={pct(dashboard.daConsegnare, dashboard.total)}
            tone="danger"
          />
          <KpiCard
            label="Programmato"
            value={dashboard.programmato}
            subValue={pct(dashboard.programmato, dashboard.total)}
            tone="info"
          />
        </KpiGrid>

        <p className="mt-2 text-xs text-slate-500">
          Totale lavoratori attivi: {totalActiveEmployees} · In tabella: {dashboard.total}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ricerca…"
              className="w-[320px] max-w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Data</span>
              <input
                value={simulationDateDraft}
                inputMode="numeric"
                onChange={(e) => {
                  setFilterError("");
                  setSimulationDateDraft(normalizeItDateDraft(e.target.value));
                }}
                onBlur={() => {
                  if (simulationDateDraft.trim().length !== 10) return;
                  const next = parseStrictItDateToIso(simulationDateDraft);
                  if (!next) return setFilterError("Data non valida (formato gg/mm/aaaa).");
                  setFilterError("");
                  setSimulationDate(next);
                  setSimulationDateDraft(formatIsoToItDate(next));
                }}
                placeholder="gg/mm/aaaa"
                className="text-sm"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Soglia</span>
              <select
                value={String(expiringDays)}
                onChange={(e) => setExpiringDays(Number(e.target.value))}
                className="text-sm"
              >
                <option value="7">7gg</option>
                <option value="30">30gg</option>
                <option value="60">60gg</option>
                <option value="90">90gg</option>
              </select>
            </div>
          </div>
        </div>

        {warning ? <p className="mt-2 text-xs font-semibold text-amber-700">{warning}</p> : null}
        {filterError ? <p className="mt-2 text-xs font-semibold text-red-600">{filterError}</p> : null}
        {error ? <p className="mt-2 text-xs font-semibold text-red-600">{error}</p> : null}
      </ModuleHeader>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
        <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            <colgroup>
              <col style={{ width: "10%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Matricola</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cognome</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Nome</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Mansione</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cantiere</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">DPI</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Scad./Ver.</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Stato</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    Caricamento…
                  </td>
                </tr>
              ) : null}

              {!isLoading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    Nessun DPI da mostrare (compila la matrice per generare righe).
                  </td>
                </tr>
              ) : null}

              {!isLoading &&
                filteredRows.map((row) => (
                  <tr
                    key={`${row.workerId}-${row.dpiId}`}
                    className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                  >
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{row.matricola}</td>
                    <td className="px-4 py-2.5 text-slate-800">{row.cognome}</td>
                    <td className="px-4 py-2.5 text-slate-800">{row.nome}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <span className="block line-clamp-2" title={row.mansione}>
                        {row.mansione}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <span className="block line-clamp-2" title={`${row.cantiere} ${row.sottocantiere}`.trim()}>
                        {row.cantiere} · {row.sottocantiere}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      <div className="font-semibold text-slate-900" title={row.dpi}>
                        {row.dpi}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {row.controlFrequency ? row.controlFrequency : ""}
                        {row.controlType ? ` · ${row.controlType}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums text-slate-700">
                      {formatDateIt(row.dataProssimoControllo)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={statusPillClassName(row.stato)}>{row.stato}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {isNewDpiOpen ? (
        <Modal title="Nuovo DPI" onClose={() => setIsNewDpiOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo DPI">
              <input
                value={newDpiForm.title}
                onChange={(e) => setNewDpiForm((v) => ({ ...v, title: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Cat.">
              <input
                value={newDpiForm.category}
                onChange={(e) => setNewDpiForm((v) => ({ ...v, category: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Rischi/Attività">
              <input
                value={newDpiForm.riskActivities}
                onChange={(e) => setNewDpiForm((v) => ({ ...v, riskActivities: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm md:col-span-2"
              />
            </Field>
            <Field label="Controllo obbligatorio">
              <input
                value={newDpiForm.controlFrequency}
                onChange={(e) => setNewDpiForm((v) => ({ ...v, controlFrequency: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Tipo di controllo">
              <input
                value={newDpiForm.controlType}
                onChange={(e) => setNewDpiForm((v) => ({ ...v, controlType: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsNewDpiOpen(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={isBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void createDpi()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={isBusy || !newDpiForm.title.trim()}
            >
              {isBusy ? "Salvataggio…" : "Crea"}
            </button>
          </div>
        </Modal>
      ) : null}

      {isAssignOpen ? (
        <Modal title="Assegna / Override DPI" onClose={() => setIsAssignOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Lavoratore">
              <select
                value={assignForm.employeeId}
                onChange={(e) => setAssignForm((v) => ({ ...v, employeeId: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="">Seleziona…</option>
                {employees.map((e) => (
                  <option key={e.workerId} value={String(e.workerId)}>
                    {e.cognome} {e.nome} · {e.matricola}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="DPI">
              <select
                value={assignForm.dpiId}
                onChange={(e) => setAssignForm((v) => ({ ...v, dpiId: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="">Seleziona…</option>
                {dpiItems.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Azione">
              <select
                value={assignForm.mode}
                onChange={(e) =>
                  setAssignForm((v) => ({ ...v, mode: e.target.value as typeof assignForm.mode }))
                }
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="deliver">Segna consegnato</option>
                <option value="plan">Programma consegna</option>
                <option value="require">Override: richiedi</option>
                <option value="exclude">Override: escludi</option>
              </select>
            </Field>

            <Field label="Data consegna">
              <ItDateInput
                valueIso={assignForm.deliveredDate}
                onChangeIso={(valueIso) => setAssignForm((v) => ({ ...v, deliveredDate: valueIso }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                disabled={assignForm.mode !== "deliver"}
              />
            </Field>

            <Field label="Data programmata">
              <ItDateInput
                valueIso={assignForm.plannedDate}
                onChangeIso={(valueIso) => setAssignForm((v) => ({ ...v, plannedDate: valueIso }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                disabled={assignForm.mode !== "plan"}
              />
            </Field>

            <Field label="Prossimo controllo">
              <ItDateInput
                valueIso={assignForm.nextCheckDate}
                onChangeIso={(valueIso) => setAssignForm((v) => ({ ...v, nextCheckDate: valueIso }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                disabled={assignForm.mode !== "deliver" && assignForm.mode !== "plan"}
              />
            </Field>

            <Field label="Note">
              <input
                value={assignForm.note}
                onChange={(e) => setAssignForm((v) => ({ ...v, note: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm md:col-span-2"
              />
            </Field>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsAssignOpen(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={isBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void assignDpi()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={isBusy || !assignForm.employeeId || !assignForm.dpiId}
            >
              {isBusy ? "Salvataggio…" : "Salva"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-5 py-4">
          <h2 className="text-lg font-bold text-[var(--brand-ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
            title="Chiudi"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      {children}
    </label>
  );
}
