"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function statusBadgeClass(status: WorkerDpiRow["stato"]) {
  const base =
    "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] leading-none";
  if (status === "scaduto") return `${base} border-red-200 bg-red-50 text-red-700`;
  if (status === "da verificare") return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  if (status === "da consegnare") return `${base} border-red-200 bg-red-50 text-red-700`;
  if (status === "programmato") return `${base} border-sky-200 bg-sky-50 text-sky-700`;
  if (status === "idoneo") return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  return `${base} border-indigo-200 bg-indigo-50 text-indigo-700`;
}

function getDefaultSimulationDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function HomeDpiPage() {
  const [rows, setRows] = useState<WorkerDpiRow[]>([]);
  const [totalActiveEmployees, setTotalActiveEmployees] = useState(0);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [simulationDate, setSimulationDate] = useState(() => getDefaultSimulationDate());
  const [expiringDays, setExpiringDays] = useState(30);

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

  async function load() {
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
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void load();
  }, [simulationDate, expiringDays]);

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

  const dashboard = useMemo(() => {
    const byState: Record<string, Set<number>> = {
      scaduto: new Set(),
      "da verificare": new Set(),
      "da consegnare": new Set(),
      programmato: new Set(),
      idoneo: new Set(),
      consegnato: new Set(),
    };
    for (const row of filteredRows) {
      (byState[row.stato] ??= new Set()).add(row.workerId);
    }
    return {
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
      <section className="rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-ink)]">DPI</h1>
            <p className="mt-2 text-sm leading-7 text-slate-500">
              Elenco lavoratori↔DPI richiesti dalla matrice e stato consegna/verifica.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dpi/matrice"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Apri matrice
            </Link>
            <button
              type="button"
              onClick={() => setIsNewDpiOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Nuovo DPI
            </button>
            <button
              type="button"
              onClick={() => setIsAssignOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Assegna / Override
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <KpiCard label="Scaduto" value={dashboard.scaduto} total={totalActiveEmployees} tone="red" />
            <KpiCard label="Da verificare" value={dashboard.daVerificare} total={totalActiveEmployees} tone="amber" />
            <KpiCard label="Da consegnare" value={dashboard.daConsegnare} total={totalActiveEmployees} tone="red" />
            <KpiCard label="Programmato" value={dashboard.programmato} total={totalActiveEmployees} tone="blue" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[220px]">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ricerca…"
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Data</span>
              <input
                type="date"
                value={simulationDate}
                onChange={(e) => setSimulationDate(e.target.value)}
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
        {error ? <p className="mt-2 text-xs font-semibold text-red-600">{error}</p> : null}
      </section>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-white">
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
                filteredRows.map((row, idx) => (
                  <tr
                    key={`${row.workerId}-${row.dpiId}`}
                    className={[
                      "border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60",
                      idx % 2 === 1 ? "bg-[var(--brand-panel)]/25" : "bg-white",
                    ].join(" ")}
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
                      <span className={statusBadgeClass(row.stato)}>{row.stato}</span>
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
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              disabled={isBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void createDpi()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
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
              <input
                type="date"
                value={assignForm.deliveredDate}
                onChange={(e) => setAssignForm((v) => ({ ...v, deliveredDate: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                disabled={assignForm.mode !== "deliver"}
              />
            </Field>

            <Field label="Data programmata">
              <input
                type="date"
                value={assignForm.plannedDate}
                onChange={(e) => setAssignForm((v) => ({ ...v, plannedDate: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                disabled={assignForm.mode !== "plan"}
              />
            </Field>

            <Field label="Prossimo controllo">
              <input
                type="date"
                value={assignForm.nextCheckDate}
                onChange={(e) => setAssignForm((v) => ({ ...v, nextCheckDate: e.target.value }))}
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
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              disabled={isBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void assignDpi()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
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

function KpiCard({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "red" | "amber" | "blue";
}) {
  const toneClasses =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-sky-200 bg-sky-50 text-sky-700";

  const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

  return (
    <div className={`min-w-[180px] rounded-2xl border px-4 py-3 ${toneClasses}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em]">{label}</div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className="text-2xl font-black tabular-nums">{value}</div>
        <div className="text-xs font-semibold tabular-nums">{pct}%</div>
      </div>
      <div className="mt-1 text-[11px] font-medium opacity-80">
        su {total} lavoratori
      </div>
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
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white text-slate-600 transition hover:bg-slate-50"
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
