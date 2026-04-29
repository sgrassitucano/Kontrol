"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KpiCard, KpiGrid, ModuleHeader, StatusPill } from "@/components/module-ui";

type WorkerSurveillanceRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
  visitaRichiesta: "SI" | "NO";
  scadenzaVisita: string | null;
  stato: "idoneo" | "in scadenza" | "scaduto" | "da fare" | "programmato" | "sospeso" | "escluso";
  medico: string;
  limitazioni: string;
  note: string;
};

type ApiResponse = {
  rows: WorkerSurveillanceRow[];
  totalRows: number;
  totalActiveEmployees: number;
  excludedByRule: number;
  frozenEmployees: number;
  expiringDays: number;
  counts: {
    idoneo: number;
    inScadenza: number;
    scaduto: number;
    daFare: number;
    programmato: number;
    sospeso: number;
    escluso: number;
  };
  error?: string;
};

type StatusFilter = "" | WorkerSurveillanceRow["stato"] | "critico";

export default function HomeSorveglianzaPage() {
  const [rows, setRows] = useState<WorkerSurveillanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [expiringDays, setExpiringDays] = useState(30);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);
    return () => window.clearTimeout(id);
  }, [search]);

  const [meta, setMeta] = useState<{
    totalActiveEmployees: number;
    excludedByRule: number;
    frozenEmployees: number;
    counts: ApiResponse["counts"];
  }>({
    totalActiveEmployees: 0,
    excludedByRule: 0,
    frozenEmployees: 0,
    counts: { idoneo: 0, inScadenza: 0, scaduto: 0, daFare: 0, programmato: 0, sospeso: 0, escluso: 0 },
  });

  const [workerDetailId, setWorkerDetailId] = useState<number | null>(null);
  const [workerDetailLoading, setWorkerDetailLoading] = useState(false);
  const [workerDetailError, setWorkerDetailError] = useState("");
  const [workerDetail, setWorkerDetail] = useState<{
    employee: {
      id: number;
      matricola: string;
      first_name: string;
      last_name: string;
      job_title: string;
      theoretical_weekly_minutes: number;
      site: string;
      sub_site: string;
    };
    record: {
      employee_id: number;
      provider: string | null;
      is_planned: boolean;
      next_due_date: string | null;
      limitations: string | null;
      notes: string | null;
    } | null;
    exclusion: { employee_id: number; is_active: boolean; note: string | null } | null;
    override: { employee_id: number; requires_visit: boolean; is_active: boolean; note: string | null } | null;
  } | null>(null);

  const [detailOverrideMode, setDetailOverrideMode] = useState<"default" | "SI" | "NO">("default");
  const [detailOverrideNote, setDetailOverrideNote] = useState("");
  const [detailExcluded, setDetailExcluded] = useState(false);
  const [detailExclusionNote, setDetailExclusionNote] = useState("");
  const [detailPlanned, setDetailPlanned] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("expiringDays", String(expiringDays));
      if (includeExcluded) params.set("includeExcluded", "1");
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      const response = await fetch(`/api/sorveglianza_sanitaria/lavoratori?${params.toString()}`);
      const body = (await response.json()) as ApiResponse;
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento sorveglianza sanitaria.");
      }
      setRows(body.rows ?? []);
      setMeta({
        totalActiveEmployees: body.totalActiveEmployees ?? 0,
        excludedByRule: body.excludedByRule ?? 0,
        frozenEmployees: body.frozenEmployees ?? 0,
        counts: body.counts ?? {
          idoneo: 0,
          inScadenza: 0,
          scaduto: 0,
          daFare: 0,
          programmato: 0,
          sospeso: 0,
          escluso: 0,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento sorveglianza sanitaria.");
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, expiringDays, includeExcluded]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === "critico") {
        if (!(row.stato === "scaduto" || row.stato === "da fare" || row.stato === "programmato")) return false;
      } else if (statusFilter && row.stato !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const searchable = [
        row.matricola,
        row.cognome,
        row.nome,
        row.mansione,
        row.cantiere,
        row.sottocantiere,
        row.responsabile,
        row.referente,
        row.medico,
        row.limitazioni,
        row.note,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(q);
    });
  }, [rows, search, statusFilter]);

  function statusTone(state: WorkerSurveillanceRow["stato"]) {
    if (state === "scaduto" || state === "da fare") return "danger" as const;
    if (state === "in scadenza") return "warning" as const;
    if (state === "programmato") return "info" as const;
    if (state === "sospeso" || state === "escluso") return "muted" as const;
    return "success" as const;
  }

  const criticoCount = meta.counts.scaduto + meta.counts.daFare + meta.counts.programmato;
  const inScopeTotal = Math.max(0, meta.totalActiveEmployees - meta.excludedByRule);

  function pct(count: number, total: number) {
    if (!total) return "0%";
    return `${Number(((count / total) * 100).toFixed(1))}%`;
  }

  const loadWorkerDetail = useCallback(async (employeeId: number) => {
    setWorkerDetailLoading(true);
    setWorkerDetailError("");
    try {
      const response = await fetch(`/api/sorveglianza_sanitaria/lavoratore?employeeId=${employeeId}`);
      const body = (await response.json()) as { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore caricamento lavoratore.");
      const typed = body as typeof workerDetail;
      setWorkerDetail(typed);

      const exclusion = (typed?.exclusion ?? null) as { is_active?: boolean; note?: string | null } | null;
      setDetailExcluded(Boolean(exclusion?.is_active));
      setDetailExclusionNote(String(exclusion?.note ?? "").trim());

      const override = (typed?.override ?? null) as { is_active?: boolean; requires_visit?: boolean; note?: string | null } | null;
      if (override?.is_active) {
        setDetailOverrideMode(override.requires_visit ? "SI" : "NO");
        setDetailOverrideNote(String(override.note ?? "").trim());
      } else {
        setDetailOverrideMode("default");
        setDetailOverrideNote("");
      }

      const record = (typed?.record ?? null) as { is_planned?: boolean } | null;
      setDetailPlanned(Boolean(record?.is_planned));
    } catch (err) {
      setWorkerDetailError(err instanceof Error ? err.message : "Errore caricamento lavoratore.");
    } finally {
      setWorkerDetailLoading(false);
    }
  }, []);

  const openWorkerDetail = useCallback(
    async (employeeId: number) => {
      setWorkerDetailId(employeeId);
      await loadWorkerDetail(employeeId);
    },
    [loadWorkerDetail],
  );

  const closeWorkerDetail = useCallback(() => {
    setWorkerDetailId(null);
    setWorkerDetail(null);
    setWorkerDetailError("");
  }, []);

  const saveWorkerDetail = useCallback(async () => {
    if (!workerDetailId) return;
    setDetailSaving(true);
    setWorkerDetailError("");
    try {
      const response = await fetch("/api/sorveglianza_sanitaria/lavoratore", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: workerDetailId,
          planned: detailPlanned,
          exclusionEnabled: detailExcluded,
          exclusionNote: detailExclusionNote.trim() || null,
          overrideEnabled: detailOverrideMode !== "default",
          overrideRequiresVisit: detailOverrideMode === "SI",
          overrideNote: detailOverrideNote.trim() || null,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore salvataggio.");
      await loadWorkerDetail(workerDetailId);
      await loadRows();
    } catch (err) {
      setWorkerDetailError(err instanceof Error ? err.message : "Errore salvataggio.");
    } finally {
      setDetailSaving(false);
    }
  }, [
    detailExcluded,
    detailExclusionNote,
    detailOverrideMode,
    detailOverrideNote,
    detailPlanned,
    loadRows,
    loadWorkerDetail,
    workerDetailId,
  ]);

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Sorveglianza sanitaria"
        description="Cruscotto e tabella lavoratori. Import e matrice restano raggiungibili dalle azioni."
        actions={
          <>
            <Link
              href="/sorveglianza_sanitaria/matrice"
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Matrice
            </Link>
            <Link
              href="/sorveglianza_sanitaria/import"
              className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Import
            </Link>
          </>
        }
      >
        <KpiGrid className="sm:grid-cols-2 md:grid-cols-7">
          <KpiCard label="Totale attivi" value={meta.totalActiveEmployees} subValue="100%" />
          <KpiCard
            label="Critico"
            value={criticoCount}
            subValue={pct(criticoCount, inScopeTotal)}
            tone="danger"
            onClick={() => setStatusFilter("critico")}
          />
          <KpiCard
            label="In scadenza"
            value={meta.counts.inScadenza}
            subValue={pct(meta.counts.inScadenza, inScopeTotal)}
            tone="warning"
            onClick={() => setStatusFilter("in scadenza")}
          />
          <KpiCard
            label="Da fare (prima visita)"
            value={meta.counts.daFare}
            subValue={pct(meta.counts.daFare, inScopeTotal)}
            tone="danger"
            onClick={() => setStatusFilter("da fare")}
          />
          <KpiCard
            label="Scaduto"
            value={meta.counts.scaduto}
            subValue={pct(meta.counts.scaduto, inScopeTotal)}
            tone="danger"
            onClick={() => setStatusFilter("scaduto")}
          />
          <KpiCard
            label="Programmato"
            value={meta.counts.programmato}
            subValue={pct(meta.counts.programmato, inScopeTotal)}
            tone="info"
            onClick={() => setStatusFilter("programmato")}
          />
          <KpiCard
            label="Esclusi"
            value={meta.excludedByRule}
            subValue={pct(meta.excludedByRule, meta.totalActiveEmployees)}
            tone="muted"
            onClick={() => {
              setIncludeExcluded(true);
              setStatusFilter("escluso");
            }}
          />
        </KpiGrid>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStatusFilter("")}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Tutti
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("critico")}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Critico ({criticoCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setIncludeExcluded(true);
                setStatusFilter("escluso");
              }}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Esclusi ({meta.excludedByRule})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("sospeso")}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Sospesi ({meta.counts.sospeso})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("programmato")}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Programmati ({meta.counts.programmato})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ricerca: cognome, mansione, cantiere, medico"
              className="w-[320px] max-w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
            />
            <select
              value={String(expiringDays)}
              onChange={(event) => setExpiringDays(Number(event.target.value))}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
            >
              <option value="15">15 gg</option>
              <option value="30">30 gg</option>
              <option value="60">60 gg</option>
              <option value="90">90 gg</option>
            </select>
            <label className="flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeExcluded}
                onChange={(event) => setIncludeExcluded(event.target.checked)}
              />
              Mostra esclusi
            </label>
          </div>
        </div>

        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
        {!error && meta.excludedByRule > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Esclusi per regole: {meta.excludedByRule}. Sospesi (stati attivi): {meta.frozenEmployees}.
          </p>
        ) : null}
      </ModuleHeader>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-white">
        <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cognome</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Nome</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Mansione</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cantiere</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Sottocantiere</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Visita</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Scadenza</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Stato</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Medico/Ente</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr
                  key={row.workerId}
                  className={[
                    "border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60",
                    idx % 2 === 1 ? "bg-[var(--brand-panel)]/30" : "bg-white",
                  ].join(" ")}
                >
                  <td className="w-[14%] px-4 py-2.5 font-semibold text-slate-800">{row.cognome}</td>
                  <td className="w-[12%] px-4 py-2.5 text-slate-800">{row.nome}</td>
                  <td className="w-[20%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.mansione || "-"}>
                      {row.mansione || "-"}
                    </span>
                  </td>
                  <td className="w-[14%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.cantiere}>
                      {row.cantiere}
                    </span>
                  </td>
                  <td className="w-[14%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.sottocantiere}>
                      {row.sottocantiere}
                    </span>
                  </td>
                  <td className="w-[8%] px-4 py-2.5 text-slate-700">{row.visitaRichiesta}</td>
                  <td className="w-[10%] px-4 py-2.5 text-slate-700">{row.scadenzaVisita ?? "-"}</td>
                  <td className="w-[10%] px-4 py-2.5">
                    <StatusPill tone={statusTone(row.stato)}>{row.stato}</StatusPill>
                  </td>
                  <td className="w-[18%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.medico}>
                      {row.medico}
                    </span>
                  </td>
                  <td className="w-[10%] px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => void openWorkerDetail(row.workerId)}
                      className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-[var(--brand-panel)]"
                    >
                      Dettaglio
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-500">
                    Nessun risultato.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {workerDetailId ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-[var(--brand-ink)]">Dettaglio lavoratore</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Override visita, programmato ed esclusione singola per sorveglianza sanitaria.
                </p>
              </div>
              <button
                type="button"
                onClick={closeWorkerDetail}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white text-slate-600 transition hover:bg-slate-50"
                title="Chiudi"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {workerDetailLoading ? (
                <p className="text-sm text-slate-600">Carico…</p>
              ) : workerDetail ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {workerDetail.employee.last_name} {workerDetail.employee.first_name}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Matricola: {workerDetail.employee.matricola} · Mansione: {workerDetail.employee.job_title || "-"}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Cantiere: {workerDetail.employee.site || "-"} · Sottocantiere: {workerDetail.employee.sub_site || "-"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scadenza attuale</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{workerDetail.record?.next_due_date ?? "-"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3 rounded-2xl border border-[var(--brand-line)] bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900">Programmato</p>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={detailPlanned}
                          onChange={(event) => setDetailPlanned(event.target.checked)}
                        />
                        Segna come programmato
                      </label>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-[var(--brand-line)] bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900">Override visita (SI/NO)</p>
                      <select
                        value={detailOverrideMode}
                        onChange={(event) => setDetailOverrideMode(event.target.value as "default" | "SI" | "NO")}
                        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                      >
                        <option value="default">Default (matrice)</option>
                        <option value="SI">Visita SI</option>
                        <option value="NO">Visita NO</option>
                      </select>
                      <input
                        value={detailOverrideNote}
                        onChange={(event) => setDetailOverrideNote(event.target.value)}
                        placeholder="Nota override (opzionale)"
                        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-[var(--brand-line)] bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">Esclusione lavoratore</p>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={detailExcluded}
                          onChange={(event) => setDetailExcluded(event.target.checked)}
                        />
                        Escludi
                      </label>
                    </div>
                    <textarea
                      value={detailExclusionNote}
                      onChange={(event) => setDetailExclusionNote(event.target.value)}
                      placeholder="Motivazione esclusione (opzionale)"
                      className="min-h-[84px] w-full resize-none rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                      disabled={!detailExcluded}
                    />
                  </div>
                </div>
              ) : null}

              {workerDetailError ? <p className="mt-3 text-xs font-medium text-red-600">{workerDetailError}</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--brand-line)] bg-[var(--brand-panel)] px-5 py-4">
              <button
                type="button"
                onClick={closeWorkerDetail}
                className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Chiudi
              </button>
              <button
                type="button"
                onClick={() => void saveWorkerDetail()}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                disabled={workerDetailLoading || detailSaving}
              >
                {detailSaving ? "Salvo…" : "Salva"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
