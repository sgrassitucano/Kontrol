"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardCard, KpiCard, KpiGrid, ModuleHeader } from "@/components/module-ui";
import { SurveillanceEventModal } from "@/app/home/sorveglianza_sanitaria/event-modal";

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
type SortKey =
  | "cognome"
  | "nome"
  | "mansione"
  | "cantiere"
  | "sottocantiere"
  | "visitaRichiesta"
  | "scadenzaVisita"
  | "stato"
  | "medico";
type SortDir = "asc" | "desc";

export default function HomeSorveglianzaPage() {
  const [rows, setRows] = useState<WorkerSurveillanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [expiringDays, setExpiringDays] = useState(30);

  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<number>>(() => new Set());
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventModalToken, setEventModalToken] = useState(0);

  const toggleWorkerSelection = useCallback((workerId: number) => {
    setSelectedWorkerIds((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedWorkerIds(new Set());
  }, []);

  const downloadFrom = useCallback(async (url: string) => {
    setExporting(true);
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) throw new Error("Errore export.");
      const blob = await response.blob();
      const disp = response.headers.get("content-disposition") ?? "";
      const match = disp.match(/filename=\"([^\"]+)\"/i);
      const filename = match?.[1] ?? "export.xlsx";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setExporting(false);
    }
  }, []);

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
  const [detailProvider, setDetailProvider] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("expiringDays", String(expiringDays));
      if (includeExcluded) params.set("includeExcluded", "1");
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
  }, [expiringDays, includeExcluded]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === "critico") {
        if (!(row.stato === "scaduto" || row.stato === "da fare")) return false;
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

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cognome", dir: "asc" });

  const sorted = useMemo(() => {
    const compareText = (a: string, b: string) =>
      a.localeCompare(b, "it", { sensitivity: "base", numeric: true });
    const compareNullableText = (a: string | null, b: string | null) => {
      const av = String(a ?? "").trim();
      const bv = String(b ?? "").trim();
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return compareText(av, bv);
    };
    const compareNullableIso = (a: string | null, b: string | null) => {
      const av = String(a ?? "").trim();
      const bv = String(b ?? "").trim();
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv);
    };
    const statusRank = (s: WorkerSurveillanceRow["stato"]) => {
      if (s === "scaduto") return 1;
      if (s === "da fare") return 2;
      if (s === "in scadenza") return 3;
      if (s === "programmato") return 4;
      if (s === "sospeso") return 5;
      if (s === "escluso") return 6;
      return 7;
    };

    const dirMul = sort.dir === "asc" ? 1 : -1;
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sort.key === "cognome") cmp = compareText(a.cognome, b.cognome) || compareText(a.nome, b.nome);
      else if (sort.key === "nome") cmp = compareText(a.nome, b.nome) || compareText(a.cognome, b.cognome);
      else if (sort.key === "mansione") cmp = compareText(a.mansione, b.mansione) || compareText(a.cognome, b.cognome);
      else if (sort.key === "cantiere") cmp = compareText(a.cantiere, b.cantiere) || compareText(a.cognome, b.cognome);
      else if (sort.key === "sottocantiere")
        cmp = compareText(a.sottocantiere, b.sottocantiere) || compareText(a.cognome, b.cognome);
      else if (sort.key === "visitaRichiesta") cmp = compareText(a.visitaRichiesta, b.visitaRichiesta);
      else if (sort.key === "scadenzaVisita") cmp = compareNullableIso(a.scadenzaVisita, b.scadenzaVisita);
      else if (sort.key === "stato") cmp = statusRank(a.stato) - statusRank(b.stato);
      else cmp = compareNullableText(a.medico, b.medico) || compareText(a.cognome, b.cognome);
      return cmp * dirMul;
    });
    return list;
  }, [filtered, sort.dir, sort.key]);

  const selectVisible = useCallback(() => {
    setSelectedWorkerIds((prev) => {
      const next = new Set(prev);
      sorted.forEach((r) => next.add(r.workerId));
      return next;
    });
  }, [sorted]);

  const allVisibleSelected = useMemo(() => {
    if (sorted.length === 0) return false;
    return sorted.every((r) => selectedWorkerIds.has(r.workerId));
  }, [selectedWorkerIds, sorted]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }, []);

  const sortIcon = (col: SortKey) => {
    if (sort.key !== col) return <span className="text-[10px] text-slate-400">↕</span>;
    return <span className="text-[10px] text-slate-700">{sort.dir === "asc" ? "↑" : "↓"}</span>;
  };

  function statusPillClassName(state: WorkerSurveillanceRow["stato"]) {
    const base = "inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold leading-none";
    if (state === "idoneo") return `${base} border-emerald-900/35 bg-emerald-400/45 text-slate-950`;
    if (state === "in scadenza") return `${base} border-amber-800/45 bg-amber-300/45 text-slate-950`;
    if (state === "programmato") return `${base} border-sky-900/40 bg-sky-700/55 text-white`;
    if (state === "scaduto" || state === "da fare") return `${base} border-red-900/40 bg-red-700/55 text-white`;
    if (state === "sospeso" || state === "escluso") return `${base} border-slate-900/35 bg-slate-700/55 text-white`;
    return `${base} border-slate-900/35 bg-slate-700/55 text-white`;
  }

  const criticoCount = meta.counts.scaduto + meta.counts.daFare + meta.counts.programmato;
  const excludedCount = meta.excludedByRule;
  const totalWorkers = meta.totalActiveEmployees;

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
      setDetailProvider(String((typed?.record ?? null)?.provider ?? "").trim());
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
          provider: detailProvider.trim() || null,
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
    detailProvider,
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
            <button
              type="button"
              onClick={() => {
                setEventModalToken((v) => v + 1);
                setEventModalOpen(true);
              }}
              data-soft="true"
              data-tone="success"
              className="rounded-xl px-3 py-2 text-sm shadow-sm transition hover:brightness-95"
            >
              + Evento
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                const params = new URLSearchParams();
                params.set("expiringDays", String(expiringDays));
                if (includeExcluded) params.set("includeExcluded", "1");
                if (search.trim()) params.set("q", search.trim());
                if (statusFilter) params.set("status", statusFilter);
                void downloadFrom(`/api/sorveglianza_sanitaria/export?${params.toString()}`);
              }}
              data-soft="true"
              data-tone="info"
              className="rounded-xl px-3 py-2 text-sm shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              title="Esporta la vista corrente (filtri inclusi)."
            >
              {exporting ? "Export..." : "Export vista"}
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                const params = new URLSearchParams();
                params.set("expiringDays", String(expiringDays));
                params.set("includeExcluded", "1");
                void downloadFrom(`/api/sorveglianza_sanitaria/export?${params.toString()}`);
              }}
              data-soft="true"
              data-tone="success"
              className="rounded-xl px-3 py-2 text-sm shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              title="Esporta tutti i lavoratori attivi (ignora ricerca/stato; include anche gli esclusi)."
            >
              {exporting ? "Export..." : "Export tutto"}
            </button>
            <Link
              href="/sorveglianza_sanitaria/matrice"
              data-soft="true"
              data-tone="purple"
              className="rounded-xl px-3 py-2 text-sm shadow-sm transition hover:brightness-95"
            >
              Matrice
            </Link>
            <Link
              href="/sorveglianza_sanitaria/import"
              data-soft="true"
              data-tone="warning"
              className="rounded-xl px-3 py-2 text-sm shadow-sm transition hover:brightness-95"
            >
              Import
            </Link>
            <Link
              href="/sorveglianza_sanitaria/import_pdf"
              data-soft="true"
              data-tone="warning"
              className="rounded-xl px-3 py-2 text-sm shadow-sm transition hover:brightness-95"
            >
              Import PDF
            </Link>
          </>
        }
      >
        <DashboardCard className="border-0 p-3">
          <KpiGrid className="sm:grid-cols-2 md:grid-cols-7">
            <KpiCard label="Totale lavoratori attivi" value={totalWorkers} subValue="100%" />
            <KpiCard
              label="Critico"
              value={criticoCount}
              subValue={pct(criticoCount, totalWorkers)}
              tone="danger"
              onClick={() => setStatusFilter("critico")}
            />
            <KpiCard
              label="In scadenza"
              value={meta.counts.inScadenza}
              subValue={pct(meta.counts.inScadenza, totalWorkers)}
              tone="warning"
              onClick={() => setStatusFilter("in scadenza")}
            />
            <KpiCard
              label="Da fare (prima visita)"
              value={meta.counts.daFare}
              subValue={pct(meta.counts.daFare, totalWorkers)}
              tone="danger"
              onClick={() => setStatusFilter("da fare")}
            />
            <KpiCard
              label="Scaduto"
              value={meta.counts.scaduto}
              subValue={pct(meta.counts.scaduto, totalWorkers)}
              tone="danger"
              onClick={() => setStatusFilter("scaduto")}
            />
            <KpiCard
              label="Programmato"
              value={meta.counts.programmato}
              subValue={pct(meta.counts.programmato, totalWorkers)}
              tone="info"
              onClick={() => setStatusFilter("programmato")}
            />
            <KpiCard
              label="Esclusi"
              value={excludedCount}
              subValue={pct(excludedCount, totalWorkers)}
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
                data-chip="true"
                className="rounded-xl px-3 py-2 text-sm transition disabled:opacity-60"
              >
                Tutti
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("critico")}
                data-chip="true"
                className="rounded-xl px-3 py-2 text-sm transition disabled:opacity-60"
              >
                Critico ({criticoCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setIncludeExcluded(true);
                  setStatusFilter("escluso");
                }}
                data-chip="true"
                className="rounded-xl px-3 py-2 text-sm transition disabled:opacity-60"
              >
                Esclusi ({meta.excludedByRule})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("sospeso")}
                data-chip="true"
                className="rounded-xl px-3 py-2 text-sm transition disabled:opacity-60"
              >
                Sospesi ({meta.counts.sospeso})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("programmato")}
                data-chip="true"
                className="rounded-xl px-3 py-2 text-sm transition disabled:opacity-60"
              >
                Programmati ({meta.counts.programmato})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm">
                <span className="text-slate-600">Selezionati:</span>
                <span className="font-bold text-[var(--brand-ink)]">{selectedWorkerIds.size}</span>
                <button
                  type="button"
                  onClick={selectVisible}
                  data-soft="true"
                  className="ml-2 rounded-lg px-2 py-1 text-xs"
                >
                  Seleziona filtrati
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  data-soft="true"
                  className="rounded-lg px-2 py-1 text-xs"
                >
                  Svuota
                </button>
              </div>
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
              <label className="flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-700">
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
        </DashboardCard>
      </ModuleHeader>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
        <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky top-0 z-20 w-[44px] bg-[var(--brand-panel)] px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedWorkerIds((prev) => {
                        const next = new Set(prev);
                        if (checked) sorted.forEach((r) => next.add(r.workerId));
                        else sorted.forEach((r) => next.delete(r.workerId));
                        return next;
                      });
                    }}
                  />
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("cognome")} className="inline-flex items-center gap-1">
                    Cognome {sortIcon("cognome")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("nome")} className="inline-flex items-center gap-1">
                    Nome {sortIcon("nome")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("mansione")} className="inline-flex items-center gap-1">
                    Mansione {sortIcon("mansione")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("cantiere")} className="inline-flex items-center gap-1">
                    Cantiere {sortIcon("cantiere")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("sottocantiere")}
                    className="inline-flex items-center gap-1"
                  >
                    Sottocantiere {sortIcon("sottocantiere")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("visitaRichiesta")}
                    className="inline-flex items-center gap-1"
                  >
                    Visita {sortIcon("visitaRichiesta")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("scadenzaVisita")}
                    className="inline-flex items-center gap-1"
                  >
                    Scadenza {sortIcon("scadenzaVisita")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("stato")} className="inline-flex items-center gap-1">
                    Stato {sortIcon("stato")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("medico")} className="inline-flex items-center gap-1">
                    Medico/Ente {sortIcon("medico")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.workerId}
                  className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                >
                  <td className="w-[44px] px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedWorkerIds.has(row.workerId)}
                      onChange={() => toggleWorkerSelection(row.workerId)}
                    />
                  </td>
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
                    <span className={statusPillClassName(row.stato)}>{row.stato}</span>
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
                      data-soft="true"
                      className="rounded-xl px-3 py-1.5 text-xs"
                    >
                      Dettaglio
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && sorted.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-sm text-slate-500">
                    Nessun risultato.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <SurveillanceEventModal
        isOpen={eventModalOpen}
        token={eventModalToken}
        onClose={() => setEventModalOpen(false)}
        selectedWorkerIds={selectedWorkerIds}
        toggleWorkerSelection={toggleWorkerSelection}
        clearSelection={clearSelection}
        workerOptions={rows.map((r) => ({
          workerId: r.workerId,
          matricola: r.matricola,
          fullName: `${r.cognome} ${r.nome}`.trim(),
          cantiere: r.cantiere,
          sottocantiere: r.sottocantiere,
        }))}
        onSaved={async () => {
          setEventModalOpen(false);
          clearSelection();
          await loadRows();
        }}
      />

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
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
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
                      <p className="text-sm font-semibold text-slate-900">Provider (Medico/Ente)</p>
                      <input
                        value={detailProvider}
                        onChange={(event) => setDetailProvider(event.target.value)}
                        placeholder="Es. Morelli Fabri / Moriste / …"
                        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                      />
                      <p className="text-xs text-slate-600">
                        Usato in tabella/export quando la matrice risulta “MISTO” o vuota.
                      </p>
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
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
              >
                Chiudi
              </button>
              <button
                type="button"
                onClick={() => void saveWorkerDetail()}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
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
