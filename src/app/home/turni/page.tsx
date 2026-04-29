"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KpiCard, KpiGrid, ModuleHeader, PanelCard } from "@/components/module-ui";

type TurniTableRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
  turnoAssegnato: boolean;
  expectedShifts: number;
  assignedShifts: number;
  expectedMinutes: number;
  assignedMinutes: number;
};

type DashboardPayload = {
  month: string;
  range: { startDate: string; endDate: string };
  workers: {
    totalWorkers: number;
    expectedShifts: number;
    assignedShifts: number;
    unassignedShifts: number;
    expectedMinutes: number;
    assignedMinutes: number;
    unassignedMinutes: number;
  };
  sites: {
    totalSites: number;
    sitesWithAssigned: number;
    sitesWithoutAssigned: number;
    expectedShifts: number;
    assignedShifts: number;
    unassignedShifts: number;
    expectedMinutes: number;
    assignedMinutes: number;
    unassignedMinutes: number;
  };
  tableRows: TurniTableRow[];
};

type ColumnFilters = {
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
  assegnato: "" | "si" | "no";
};

const INITIAL_COLUMN_FILTERS: ColumnFilters = {
  matricola: "",
  cognome: "",
  nome: "",
  mansione: "",
  cantiere: "",
  sottocantiere: "",
  responsabile: "",
  referente: "",
  assegnato: "",
};

function nowMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function percentage(count: number, total: number) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function formatHours(minutes: number) {
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h`;
}

function matchText(value: string, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) return true;
  return String(value ?? "").toLowerCase().includes(normalizedFilter);
}

export default function HomeTurniPage() {
  const [month, setMonth] = useState(() => nowMonth());
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDashboardCollapsed, setIsDashboardCollapsed] = useState(false);
  const [dashboardAssignedFilter, setDashboardAssignedFilter] = useState<null | boolean>(null);
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(INITIAL_COLUMN_FILTERS);

  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingRef = useRef(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/turni/dashboard?month=${encodeURIComponent(month)}`);
      const body = (await response.json()) as DashboardPayload | { error: string };
      if (!response.ok || "error" in body) {
        throw new Error("error" in body ? body.error : "Errore caricamento cruscotto turni.");
      }
      setPayload(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento cruscotto turni.");
      setPayload(null);
    } finally {
      setIsLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const filteredRows = useMemo(() => {
    const list = payload?.tableRows ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((row) => {
      if (dashboardAssignedFilter !== null) {
        if (row.turnoAssegnato !== dashboardAssignedFilter) return false;
      }
      if (q) {
        const searchable = [
          row.matricola,
          row.cognome,
          row.nome,
          row.mansione,
          row.cantiere,
          row.sottocantiere,
          row.responsabile,
          row.referente,
        ]
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      if (columnFilters.matricola && !matchText(row.matricola, columnFilters.matricola)) return false;
      if (columnFilters.cognome && !matchText(row.cognome, columnFilters.cognome)) return false;
      if (columnFilters.nome && !matchText(row.nome, columnFilters.nome)) return false;
      if (columnFilters.mansione && !matchText(row.mansione, columnFilters.mansione)) return false;
      if (columnFilters.cantiere && !matchText(row.cantiere, columnFilters.cantiere)) return false;
      if (columnFilters.sottocantiere && !matchText(row.sottocantiere, columnFilters.sottocantiere)) return false;
      if (columnFilters.responsabile && !matchText(row.responsabile, columnFilters.responsabile)) return false;
      if (columnFilters.referente && !matchText(row.referente, columnFilters.referente)) return false;
      if (columnFilters.assegnato) {
        const expected = columnFilters.assegnato === "si";
        if (row.turnoAssegnato !== expected) return false;
      }
      return true;
    });
  }, [columnFilters, dashboardAssignedFilter, payload?.tableRows, search]);

  useEffect(() => {
    const width = tableRef.current?.scrollWidth ?? 0;
    setTableScrollWidth(width);
  }, [filteredRows.length]);

  function syncHorizontalScroll(source: "top" | "middle") {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const nextLeft = (source === "top" ? topScrollRef.current : tableScrollRef.current)?.scrollLeft ?? 0;
    if (source !== "top" && topScrollRef.current) topScrollRef.current.scrollLeft = nextLeft;
    if (source !== "middle" && tableScrollRef.current) tableScrollRef.current.scrollLeft = nextLeft;
    syncingRef.current = false;
  }

  const workers = payload?.workers ?? null;
  const sites = payload?.sites ?? null;

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Turni"
        description="Cruscotto mensile e tabella lavoratori. Le viste operative restano in “Cantiere” e “Lavoratori”."
        actions={
          <>
            <a
              href="/turni/cantiere"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Vista cantiere
            </a>
            <a
              href="/turni/lavoratori"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Vista lavoratori
            </a>
          </>
        }
      />

      <PanelCard>
        <div className="grid gap-3 lg:grid-cols-[220px_auto]">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            {dashboardAssignedFilter !== null || columnFilters.assegnato ? (
              <button
                type="button"
                onClick={() => {
                  setDashboardAssignedFilter(null);
                  setColumnFilters((v) => ({ ...v, assegnato: "" }));
                }}
                className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-[var(--brand-panel)]"
              >
                Reset filtro
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setIsDashboardCollapsed((v) => !v)}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
              title={isDashboardCollapsed ? "Espandi cruscotto" : "Comprimi cruscotto"}
            >
              {isDashboardCollapsed ? "Espandi" : "Comprimi"}
            </button>
          </div>
        </div>
        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
      </PanelCard>

      <PanelCard>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-[var(--brand-ink)]">Cruscotto</h2>
          {payload?.range ? (
            <span className="text-xs text-slate-500">
              Periodo {payload.range.startDate} → {payload.range.endDate}
            </span>
          ) : null}
        </div>
        {!isDashboardCollapsed && workers && sites ? (
          <div className="grid gap-3">
            <div className="rounded-xl border border-[var(--brand-line)] bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-[var(--brand-ink)]">Lavoratori</h3>
                <button
                  type="button"
                  onClick={() => setDashboardAssignedFilter(null)}
                  className="rounded-lg border border-[var(--brand-line)] bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-[var(--brand-panel)]"
                  title="Rimuovi filtro"
                >
                  Totale {workers.totalWorkers}
                </button>
              </div>
              <div className="mt-3">
                <KpiGrid className="sm:grid-cols-2 md:grid-cols-5">
                  <KpiCard label="Totale" value={workers.totalWorkers} subValue="100%" />
                  <KpiCard
                    label="Turni assegnati"
                    value={workers.assignedShifts}
                    subValue={`${percentage(workers.assignedShifts, workers.expectedShifts)}%`}
                    tone="success"
                    onClick={() => setDashboardAssignedFilter(true)}
                  />
                  <KpiCard
                    label="Turni non assegnati"
                    value={workers.unassignedShifts}
                    subValue={`${percentage(workers.unassignedShifts, workers.expectedShifts)}%`}
                    tone="danger"
                    onClick={() => setDashboardAssignedFilter(false)}
                  />
                  <KpiCard
                    label="Ore assegnate"
                    value={formatHours(workers.assignedMinutes)}
                    subValue={`${percentage(workers.assignedMinutes, workers.expectedMinutes)}%`}
                    tone="success"
                    onClick={() => setDashboardAssignedFilter(true)}
                  />
                  <KpiCard
                    label="Ore non assegnate"
                    value={formatHours(workers.unassignedMinutes)}
                    subValue={`${percentage(workers.unassignedMinutes, workers.expectedMinutes)}%`}
                    tone="danger"
                    onClick={() => setDashboardAssignedFilter(false)}
                  />
                </KpiGrid>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--brand-line)] bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-[var(--brand-ink)]">Cantieri</h3>
                <button
                  type="button"
                  onClick={() => setDashboardAssignedFilter(null)}
                  className="rounded-lg border border-[var(--brand-line)] bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-[var(--brand-panel)]"
                  title="Rimuovi filtro"
                >
                  Totale {sites.totalSites}
                </button>
              </div>
              <div className="mt-3">
                <KpiGrid className="sm:grid-cols-2 md:grid-cols-5">
                  <KpiCard label="Totale" value={sites.totalSites} subValue="100%" />
                  <KpiCard
                    label="Con turni"
                    value={sites.sitesWithAssigned}
                    subValue={`${percentage(sites.sitesWithAssigned, sites.totalSites)}%`}
                    tone="info"
                    onClick={() => setDashboardAssignedFilter(true)}
                  />
                  <KpiCard
                    label="Senza turni"
                    value={sites.sitesWithoutAssigned}
                    subValue={`${percentage(sites.sitesWithoutAssigned, sites.totalSites)}%`}
                    tone="warning"
                    onClick={() => setDashboardAssignedFilter(false)}
                  />
                  <KpiCard
                    label="Turni non assegnati"
                    value={sites.unassignedShifts}
                    subValue={`${percentage(sites.unassignedShifts, sites.expectedShifts)}%`}
                    tone="danger"
                    onClick={() => setDashboardAssignedFilter(false)}
                  />
                  <KpiCard
                    label="Ore non assegnate"
                    value={formatHours(sites.unassignedMinutes)}
                    subValue={`${percentage(sites.unassignedMinutes, sites.expectedMinutes)}%`}
                    tone="danger"
                    onClick={() => setDashboardAssignedFilter(false)}
                  />
                </KpiGrid>
              </div>
            </div>
          </div>
        ) : null}
      </PanelCard>

      <section className="rounded-[16px] border border-[var(--brand-line)] bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ricerca: cantiere, sottocantiere, cognome, nome, responsabile, referente"
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
          <select
            value={columnFilters.assegnato}
            onChange={(event) => setColumnFilters((v) => ({ ...v, assegnato: event.target.value as ColumnFilters["assegnato"] }))}
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          >
            <option value="">Tutti</option>
            <option value="si">Assegnato</option>
            <option value="no">Non assegnato</option>
          </select>
          <div className="flex items-center justify-end text-xs text-slate-500">
            Righe {filteredRows.length}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-white">
        <div
          ref={topScrollRef}
          onScroll={() => syncHorizontalScroll("top")}
          className="overflow-x-auto border-b border-[var(--brand-line)]"
        >
          <div style={{ width: tableScrollWidth, height: 16 }} />
        </div>
        <div
          ref={tableScrollRef}
          onScroll={() => syncHorizontalScroll("middle")}
          className="max-h-[62vh] overflow-auto"
        >
          <table
            ref={tableRef}
            className="min-w-full table-fixed text-left text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap"
          >
            <colgroup>
              <col style={{ width: 120 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Matricola</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cognome</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Nome</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Mansione</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cantiere</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Sottocantiere</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Responsabile</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Referente</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Turno assegnato</th>
              </tr>
              <tr>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.matricola} onChange={(event) => setColumnFilters((v) => ({ ...v, matricola: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.cognome} onChange={(event) => setColumnFilters((v) => ({ ...v, cognome: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.nome} onChange={(event) => setColumnFilters((v) => ({ ...v, nome: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.mansione} onChange={(event) => setColumnFilters((v) => ({ ...v, mansione: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.cantiere} onChange={(event) => setColumnFilters((v) => ({ ...v, cantiere: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.sottocantiere} onChange={(event) => setColumnFilters((v) => ({ ...v, sottocantiere: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.responsabile} onChange={(event) => setColumnFilters((v) => ({ ...v, responsabile: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.referente} onChange={(event) => setColumnFilters((v) => ({ ...v, referente: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.workerId}
                  className="border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60"
                >
                  <td className="px-4 py-2.5 text-slate-600">{row.matricola}</td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.cognome}>
                    {row.cognome}
                  </td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.nome}>
                    {row.nome}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-600" title={row.mansione || "-"}>
                    {row.mansione || "-"}
                  </td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.cantiere}>
                    {row.cantiere}
                  </td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.sottocantiere}>
                    {row.sottocantiere}
                  </td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.responsabile || "-"}>
                    {row.responsabile || "-"}
                  </td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.referente || "-"}>
                    {row.referente || "-"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={[
                        "inline-flex items-center rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide",
                        row.turnoAssegnato
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-rose-200 bg-rose-50 text-rose-700",
                      ].join(" ")}
                    >
                      {row.turnoAssegnato ? "SI" : "NO"}
                    </span>
                  </td>
                </tr>
              ))}
              {!isLoading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nessun dato disponibile.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
