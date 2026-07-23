"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { DashboardCard, ModuleHeader, ActionMenu, courseStatusClassName } from "@/components/module-ui";
import { KpiTile } from "@/components/kpi-tile";
import { MultiSelectDropdown } from "@/components/multi-select-dropdown";
import { SurveillanceEventModal } from "@/app/home/sorveglianza_sanitaria/event-modal";
import { isoToItDate } from "@/lib/it-date";
import { buildHttpErrorMessage, extractResponseError, readJsonSafely } from "@/lib/client/http";
import { Eye, Calendar, Award, FileText } from "lucide-react";

function isoToMonthYear(value: string | null) {
  if (!value) return "(vuoto)";
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (!match) return "(vuoto)";
  return `${match[2]}/${match[1]}`;
}

function monthYearSortKey(value: string) {
  const match = value.match(/^(\d{2})\/(\d{4})$/);
  if (!match) return -1;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (!Number.isFinite(month) || !Number.isFinite(year)) return -1;
  return year * 12 + month;
}

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
type DashboardGroupBy = "mansione" | "cantiere" | "provider";
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

function computeCounts(rows: WorkerSurveillanceRow[]) {
  return rows.reduce(
    (acc, row) => {
      if (row.stato === "idoneo") acc.idoneo += 1;
      else if (row.stato === "in scadenza") acc.inScadenza += 1;
      else if (row.stato === "scaduto") acc.scaduto += 1;
      else if (row.stato === "da fare") acc.daFare += 1;
      else if (row.stato === "programmato") acc.programmato += 1;
      else if (row.stato === "sospeso") acc.sospeso += 1;
      else acc.escluso += 1;
      return acc;
    },
    { idoneo: 0, inScadenza: 0, scaduto: 0, daFare: 0, programmato: 0, sospeso: 0, escluso: 0 },
  );
}

export default function HomeSorveglianzaPage() {
  const [rows, setRows] = useState<WorkerSurveillanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [extendedSearch, setExtendedSearch] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [expiringDays, setExpiringDays] = useState(30);

  const [columnFilters, setColumnFilters] = useState({
    cognome: "",
    nome: "",
    mansione: "",
    cantiere: "",
    sottocantiere: "",
    visita: [] as string[],
    scadenza: [] as string[],
    medico: "",
  });

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

  const [isDashboardDetailOpen, setIsDashboardDetailOpen] = useState(false);
  const [dashboardGroupBy, setDashboardGroupBy] = useState<DashboardGroupBy>("mansione");
  const [dashboardOnlyCritical, setDashboardOnlyCritical] = useState(true);

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

  const loadRowsAbortRef = useRef<AbortController | null>(null);
  const loadDetailAbortRef = useRef<AbortController | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dashboardDetailGroups = useMemo(() => {
    const normalizeKey = (value: string) => String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    const buildGroupKey = (row: WorkerSurveillanceRow) => {
      if (dashboardGroupBy === "cantiere") return normalizeKey(row.cantiere) || "NON_INDICATO";
      if (dashboardGroupBy === "provider") return normalizeKey(row.medico) || "NON_ASSEGNATO";
      return normalizeKey(row.mansione) || "NON_INDICATO";
    };
    const buildGroupLabel = (row: WorkerSurveillanceRow) => {
      if (dashboardGroupBy === "cantiere") return String(row.cantiere ?? "").trim() || "Non indicato";
      if (dashboardGroupBy === "provider") return String(row.medico ?? "").trim() || "Non assegnato";
      return String(row.mansione ?? "").trim() || "Non indicato";
    };

    const byKey = new Map<
      string,
      {
        key: string;
        label: string;
        workerIds: Set<number>;
        counts: Record<WorkerSurveillanceRow["stato"], Set<number>>;
      }
    >();

    const emptyCounts = () => ({
      "idoneo": new Set<number>(),
      "in scadenza": new Set<number>(),
      "scaduto": new Set<number>(),
      "da fare": new Set<number>(),
      "programmato": new Set<number>(),
      "sospeso": new Set<number>(),
      "escluso": new Set<number>(),
    });

    rows.forEach((row) => {
      const key = buildGroupKey(row);
      const existing = byKey.get(key);
      const group =
        existing ??
        (() => {
          const created = {
            key,
            label: buildGroupLabel(row),
            workerIds: new Set<number>(),
            counts: emptyCounts(),
          };
          byKey.set(key, created);
          return created;
        })();

      group.workerIds.add(row.workerId);
      group.counts[row.stato].add(row.workerId);
    });

    const list = Array.from(byKey.values()).map((group) => {
      const total = group.workerIds.size;
      const counts = {
        idoneo: group.counts["idoneo"].size,
        inScadenza: group.counts["in scadenza"].size,
        scaduto: group.counts["scaduto"].size,
        daFare: group.counts["da fare"].size,
        programmato: group.counts["programmato"].size,
        sospeso: group.counts["sospeso"].size,
        escluso: group.counts["escluso"].size,
      };
      const critico = counts.scaduto + counts.daFare;
      return { key: group.key, label: group.label, total, counts, critico };
    });

    const filtered = dashboardOnlyCritical ? list.filter((g) => g.critico > 0) : list;
    filtered.sort((a, b) => b.critico - a.critico || a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
    return filtered;
  }, [dashboardGroupBy, dashboardOnlyCritical, rows]);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError("");
    loadRowsAbortRef.current?.abort();
    const controller = new AbortController();
    loadRowsAbortRef.current = controller;
    try {
      async function fetchChunk(offset: number) {
        const params = new URLSearchParams();
        params.set("expiringDays", String(expiringDays));
        params.set("limit", "2000");
        params.set("offset", String(offset));
        if (deferredSearch.trim()) params.set("q", deferredSearch.trim());
        params.set("extendedSearch", extendedSearch ? "1" : "0");
        if (includeExcluded) params.set("includeExcluded", "1");
        const response = await fetch(`/api/sorveglianza_sanitaria/lavoratori?${params.toString()}`, { signal: controller.signal });
        const body = await readJsonSafely<ApiResponse & { truncated?: boolean; error?: string }>(response);
        if (!body || !response.ok || extractResponseError(body)) {
          throw new Error(buildHttpErrorMessage(response, body, "Errore caricamento sorveglianza sanitaria"));
        }
        return body;
      }

      const nextRows: WorkerSurveillanceRow[] = [];
      let offset = 0;
      let truncated = true;
      let metaNext = {
        totalActiveEmployees: 0,
        excludedByRule: 0,
        frozenEmployees: 0,
        counts: { idoneo: 0, inScadenza: 0, scaduto: 0, daFare: 0, programmato: 0, sospeso: 0, escluso: 0 },
      };

      while (truncated) {
        const body = await fetchChunk(offset);
        nextRows.push(...(body.rows ?? []));
        truncated = Boolean(body.truncated);
        offset += (body.rows ?? []).length;
        metaNext = {
          totalActiveEmployees: body.totalActiveEmployees ?? metaNext.totalActiveEmployees,
          excludedByRule: body.excludedByRule ?? metaNext.excludedByRule,
          frozenEmployees: body.frozenEmployees ?? metaNext.frozenEmployees,
          counts: body.counts ?? metaNext.counts,
        };
        if ((body.rows ?? []).length === 0) break;
      }

      setRows(nextRows);
      setMeta({
        totalActiveEmployees: metaNext.totalActiveEmployees,
        excludedByRule: metaNext.excludedByRule,
        frozenEmployees: metaNext.frozenEmployees,
        counts: metaNext.counts,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Errore caricamento sorveglianza sanitaria.");
    } finally {
      setIsLoading(false);
    }
  }, [deferredSearch, expiringDays, includeExcluded, extendedSearch]);

  const scheduleLoadRows = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      void loadRows();
    }, 800);
  }, [loadRows]);

  const refreshRowsByEmployeeIds = useCallback(
    async (employeeIds: number[]) => {
      const ids = Array.from(new Set(employeeIds.filter((id) => Number.isFinite(id) && id > 0)));
      if (ids.length === 0) return;

      const refreshedRows: WorkerSurveillanceRow[] = [];
      let offset = 0;
      let truncated = true;

      while (truncated) {
        const params = new URLSearchParams();
        params.set("employeeIds", ids.join(","));
        params.set("expiringDays", String(expiringDays));
        params.set("limit", "2000");
        params.set("offset", String(offset));
        if (deferredSearch.trim()) params.set("q", deferredSearch.trim());
        params.set("extendedSearch", extendedSearch ? "1" : "0");
        if (includeExcluded) params.set("includeExcluded", "1");

        const response = await fetch(`/api/sorveglianza_sanitaria/lavoratori?${params.toString()}`);
        const body = await readJsonSafely<ApiResponse & { truncated?: boolean; error?: string }>(response);
        if (!body || !response.ok || extractResponseError(body)) {
          throw new Error(buildHttpErrorMessage(response, body, "Errore aggiornamento righe sorveglianza"));
        }
        refreshedRows.push(...(body.rows ?? []));
        truncated = Boolean(body.truncated);
        offset += (body.rows ?? []).length;
        if ((body.rows ?? []).length === 0) break;
      }

      setRows((prev) => {
        const nextById = new Map(prev.map((row) => [row.workerId, row]));
        ids.forEach((id) => nextById.delete(id));
        for (const row of refreshedRows) {
          nextById.set(row.workerId, row);
        }
        const nextRows = Array.from(nextById.values());
        setMeta((prevMeta) => ({
          ...prevMeta,
          counts: computeCounts(nextRows),
        }));
        return nextRows;
      });
    },
    [deferredSearch, expiringDays, includeExcluded, extendedSearch],
  );

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialWorkerId = params.get("workerId") || params.get("employeeId");
    if (initialWorkerId) {
      const id = Number(initialWorkerId);
      if (Number.isFinite(id) && id > 0) {
        setWorkerDetailId(id);
      }
    }
  }, []);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const matchCol = (value: string, filterValue: string) =>
      !filterValue.trim() || value.toLowerCase().includes(filterValue.trim().toLowerCase());
    return rows.filter((row) => {
      if (statusFilter === "critico") {
        if (!(row.stato === "scaduto" || row.stato === "da fare")) return false;
      } else if (statusFilter && row.stato !== statusFilter) {
        return false;
      }
      if (!matchCol(row.cognome, columnFilters.cognome)) return false;
      if (!matchCol(row.nome, columnFilters.nome)) return false;
      if (!matchCol(row.mansione, columnFilters.mansione)) return false;
      if (!matchCol(row.cantiere, columnFilters.cantiere)) return false;
      if (!matchCol(row.sottocantiere, columnFilters.sottocantiere)) return false;
      if (!matchCol(row.medico, columnFilters.medico)) return false;
      if (columnFilters.visita.length > 0 && !columnFilters.visita.includes(row.visitaRichiesta)) return false;
      if (columnFilters.scadenza.length > 0 && !columnFilters.scadenza.includes(isoToMonthYear(row.scadenzaVisita)))
        return false;
      if (!q) return true;
      const searchable = extendedSearch
        ? [
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
            .toLowerCase()
        : [row.matricola, row.cognome, row.nome].join(" ").toLowerCase();
      return searchable.includes(q);
    });
  }, [rows, deferredSearch, statusFilter, extendedSearch, columnFilters]);

  const visitaFilterOptions = useMemo(
    () => [
      { value: "SI", label: "SI" },
      { value: "NO", label: "NO" },
    ],
    [],
  );

  const scadenzaFilterOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => set.add(isoToMonthYear(row.scadenzaVisita)));
    return Array.from(set.values())
      .map((value) => ({ value, label: value }))
      .sort((a, b) => monthYearSortKey(b.value) - monthYearSortKey(a.value) || a.label.localeCompare(b.label));
  }, [rows]);

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

  const statusPillClassName = courseStatusClassName;

  const excludedCount = meta.excludedByRule;
  const totalWorkers = meta.totalActiveEmployees;

  function pct(count: number, total: number) {
    if (!total) return "0%";
    return `${Number(((count / total) * 100).toFixed(1))}%`;
  }

  const loadWorkerDetail = useCallback(async (employeeId: number) => {
    setWorkerDetailLoading(true);
    setWorkerDetailError("");
    loadDetailAbortRef.current?.abort();
    const controller = new AbortController();
    loadDetailAbortRef.current = controller;
    try {
      const params = new URLSearchParams();
      params.set("employeeId", String(employeeId));
      params.set("expiringDays", String(expiringDays));
      const response = await fetch(`/api/sorveglianza_sanitaria/lavoratore?${params.toString()}`, { signal: controller.signal });
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
      if (err instanceof DOMException && err.name === "AbortError") return;
      setWorkerDetailError(err instanceof Error ? err.message : "Errore caricamento lavoratore.");
    } finally {
      setWorkerDetailLoading(false);
    }
  }, [expiringDays]);

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
      await refreshRowsByEmployeeIds([workerDetailId]);
      await loadWorkerDetail(workerDetailId);
      scheduleLoadRows();
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
    loadWorkerDetail,
    refreshRowsByEmployeeIds,
    scheduleLoadRows,
    workerDetailId,
  ]);

  const workerOptions = useMemo(
    () =>
      rows.map((r) => ({
        workerId: r.workerId,
        matricola: r.matricola,
        fullName: `${r.cognome} ${r.nome}`.trim(),
        cantiere: r.cantiere,
        sottocantiere: r.sottocantiere,
      })),
    [rows],
  );

  return (
    <div className="theme-sorveglianza space-y-4 animate-tab-content">
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
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
              title="Nuovo evento sorveglianza"
            >
              + Evento
            </button>
            <button
              type="button"
              onClick={() => {
                setDashboardGroupBy("mansione");
                setDashboardOnlyCritical(true);
                setIsDashboardDetailOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
              title="Dettaglio aggregato per mansione/cantiere/provider."
            >
              Dettaglio
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
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              title="Esporta tutti i lavoratori attivi (ignora ricerca/stato; include anche gli esclusi)."
            >
              {exporting ? "Export..." : "Export tutto"}
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                const params = new URLSearchParams();
                params.set("includeExcluded", "1");
                params.set("byProvider", "1");
                void downloadFrom(`/api/sorveglianza_sanitaria/export?${params.toString()}`);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              title="Genera un file Excel separato per ciascun provider medico (zip)."
            >
              {exporting ? "Export..." : "Export per provider"}
            </button>
            <Link
              href="/sorveglianza_sanitaria/matrice"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Matrice
            </Link>
            <Link
              href="/sorveglianza_sanitaria/import"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Import
            </Link>
            <Link
              href="/sorveglianza_sanitaria/import_pdf"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Import PDF
            </Link>
          </>
        }
      >
        <DashboardCard className="border-0 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-bold text-[var(--brand-ink)]">Sorveglianza sanitaria</span>
            <span className="text-xs text-slate-500">
              Totale lavoratori: <span className="font-semibold text-slate-700 tabular-nums">{totalWorkers}</span> · Conformi:{" "}
              <span className="font-semibold text-emerald-600 tabular-nums">{meta.counts.idoneo}</span>{" "}
              ({pct(meta.counts.idoneo, totalWorkers)})
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile
              label="Scaduto"
              hint="Visita scaduta, da rifare."
              tone="danger"
              count={meta.counts.scaduto}
              total={totalWorkers}
              isActive={statusFilter === "scaduto"}
              onClick={() => setStatusFilter("scaduto")}
            />
            <KpiTile
              label="Da fare"
              hint="Prima visita mai effettuata."
              tone="danger"
              count={meta.counts.daFare}
              total={totalWorkers}
              isActive={statusFilter === "da fare"}
              onClick={() => setStatusFilter("da fare")}
            />
            <KpiTile
              label="In scadenza"
              hint="Visita valida ma in scadenza entro la soglia."
              tone="amber"
              count={meta.counts.inScadenza}
              total={totalWorkers}
              isActive={statusFilter === "in scadenza"}
              onClick={() => setStatusFilter("in scadenza")}
            />
            <KpiTile
              label="Programmato"
              hint="Visita già pianificata."
              tone="blue"
              count={meta.counts.programmato}
              total={totalWorkers}
              isActive={statusFilter === "programmato"}
              onClick={() => setStatusFilter("programmato")}
            />
            <KpiTile
              label="Sospeso"
              hint="Lavoratore in periodo di sospensione (maternità, infortunio, malattia, distacco)."
              tone="grey"
              count={meta.counts.sospeso}
              total={totalWorkers}
              isActive={statusFilter === "sospeso"}
              onClick={() => setStatusFilter("sospeso")}
            />
            <KpiTile
              label="Conforme"
              hint="Visita valida, nessuna azione richiesta."
              tone="green"
              count={meta.counts.idoneo}
              total={totalWorkers}
              isActive={statusFilter === ""}
              onClick={() => setStatusFilter("")}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <button
              type="button"
              data-unstyled="true"
              onClick={() => {
                setIncludeExcluded(true);
                setStatusFilter("escluso");
              }}
              className="hover:text-[var(--brand-primary)]"
              title="Esclusi da regola mansione/scope o esclusione manuale."
            >
              Esclusi: <span className="font-semibold tabular-nums">{excludedCount}</span> ({pct(excludedCount, totalWorkers)})
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {statusFilter ? (
                <button
                  type="button"
                  onClick={() => setStatusFilter("")}
                  className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                >
                  Reset filtro
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-700">
                <span className="font-semibold text-[var(--brand-ink)]">{selectedWorkerIds.size}</span>
                <span>selezionati</span>
                <button
                  type="button"
                  onClick={selectVisible}
                  className="ml-1 rounded-lg bg-[var(--brand-primary)] px-2 py-1 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                >
                  Seleziona filtrati
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-lg bg-[var(--brand-primary)] px-2 py-1 text-xs font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
                  disabled={selectedWorkerIds.size === 0}
                >
                  Pulisci
                </button>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={extendedSearch ? "Ricerca estesa" : "Ricerca dipendente (matricola, cognome, nome)"}
                className="w-[320px] max-w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={extendedSearch}
                  onChange={(event) => setExtendedSearch(event.target.checked)}
                />
                Ricerca estesa
              </label>
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
        <div className="max-h-[70vh] overflow-auto hide-native-hscrollbar">
          <table className="min-w-full table-fixed text-left text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            <colgroup>
              <col style={{ width: 44 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 top-0 z-40 bg-[var(--brand-panel)] px-3 py-2">
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
                <th className="sticky left-[44px] top-0 z-40 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("cognome")} className="inline-flex items-center gap-1">
                    Cognome {sortIcon("cognome")}
                  </button>
                </th>
                <th className="sticky left-[184px] top-0 z-40 border-r border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-2">
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
              <tr>
                <th className="sticky left-0 top-8 z-30 bg-white px-3 py-2" />
                <th className="sticky left-[44px] top-8 z-30 bg-white px-3 py-2">
                  <input
                    value={columnFilters.cognome}
                    onChange={(e) => setColumnFilters((v) => ({ ...v, cognome: e.target.value }))}
                    className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case"
                    placeholder="Filtro"
                  />
                </th>
                <th className="sticky left-[184px] top-8 z-30 border-r border-[var(--brand-line)] bg-white px-3 py-2">
                  <input
                    value={columnFilters.nome}
                    onChange={(e) => setColumnFilters((v) => ({ ...v, nome: e.target.value }))}
                    className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case"
                    placeholder="Filtro"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input
                    value={columnFilters.mansione}
                    onChange={(e) => setColumnFilters((v) => ({ ...v, mansione: e.target.value }))}
                    className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case"
                    placeholder="Filtro"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input
                    value={columnFilters.cantiere}
                    onChange={(e) => setColumnFilters((v) => ({ ...v, cantiere: e.target.value }))}
                    className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case"
                    placeholder="Filtro"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input
                    value={columnFilters.sottocantiere}
                    onChange={(e) => setColumnFilters((v) => ({ ...v, sottocantiere: e.target.value }))}
                    className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case"
                    placeholder="Filtro"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <MultiSelectDropdown
                    selected={columnFilters.visita}
                    options={visitaFilterOptions}
                    onChange={(selected) => setColumnFilters((v) => ({ ...v, visita: selected }))}
                    placeholder="Tutti"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <MultiSelectDropdown
                    selected={columnFilters.scadenza}
                    options={scadenzaFilterOptions}
                    onChange={(selected) => setColumnFilters((v) => ({ ...v, scadenza: selected }))}
                    placeholder="mm/aaaa"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2" />
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input
                    value={columnFilters.medico}
                    onChange={(e) => setColumnFilters((v) => ({ ...v, medico: e.target.value }))}
                    className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case"
                    placeholder="Filtro"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.workerId}
                  className="border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60"
                >
                  <td className="sticky left-0 z-20 bg-[var(--brand-panel)] px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedWorkerIds.has(row.workerId)}
                      onChange={() => toggleWorkerSelection(row.workerId)}
                    />
                  </td>
                  <td className="sticky left-[44px] z-20 bg-[var(--brand-panel)] px-4 py-2.5">
                    <button type="button" data-unstyled="true" onClick={() => void openWorkerDetail(row.workerId)} className="hover:underline text-slate-800 dark:text-slate-200 text-left">
                      {row.cognome}
                    </button>
                  </td>
                  <td className="sticky left-[184px] z-20 border-r border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-2.5">
                    <button type="button" data-unstyled="true" onClick={() => void openWorkerDetail(row.workerId)} className="hover:underline text-slate-800 dark:text-slate-200 text-left">
                      {row.nome}
                    </button>
                  </td>
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
                  <td className="w-[10%] px-4 py-2.5 font-medium tabular-nums text-slate-700">
                    {row.scadenzaVisita ? isoToItDate(row.scadenzaVisita) : "-"}
                  </td>
                  <td className="w-[10%] px-4 py-2.5">
                    <span className={statusPillClassName(row.stato)}>{row.stato}</span>
                  </td>
                  <td className="w-[18%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.medico}>
                      {row.medico}
                    </span>
                  </td>
                  <td className="w-[10%] px-4 py-2.5">
                    <ActionMenu
                      actions={[
                        {
                          label: "Scheda Lavoratore",
                          icon: <Eye className="h-3.5 w-3.5" />,
                          onClick: () => void openWorkerDetail(row.workerId)
                        },
                        {
                          label: "Registra Evento Medico",
                          icon: <Calendar className="h-3.5 w-3.5" />,
                          onClick: () => {
                            setSelectedWorkerIds(new Set([row.workerId]));
                            setEventModalToken(Date.now());
                            setEventModalOpen(true);
                          }
                        },
                        {
                          label: "Scarica Fascicolo PDF",
                          icon: <FileText className="h-3.5 w-3.5" />,
                          onClick: () => {
                            window.open(`/api/lavoratori/fascicolo?employeeId=${row.workerId}`, "_blank");
                          }
                        }
                      ]}
                    />
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

      {isDashboardDetailOpen ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-5 py-4">
              <div className="space-y-0.5">
                <h2 className="text-lg font-bold text-[var(--brand-ink)]">Dettaglio cruscotto</h2>
                <p className="text-xs text-slate-500">Conteggi su lavoratori attivi caricati in tabella.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsDashboardDetailOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                title="Chiudi"
              >
                ✕
              </button>
            </div>

            <div className="border-b border-[var(--brand-line)] px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Raggruppa per</span>
                  {(
                    [
                      { key: "mansione" as const, label: "Mansione" },
                      { key: "cantiere" as const, label: "Cantiere" },
                      { key: "provider" as const, label: "Provider" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      data-unstyled="true"
                      onClick={() => setDashboardGroupBy(opt.key)}
                      className={[
                        "rounded-full px-4 py-2 text-sm font-semibold transition",
                        dashboardGroupBy === opt.key
                          ? "bg-[var(--brand-primary)] text-white"
                          : "border border-[var(--brand-line)] bg-white text-slate-700 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={dashboardOnlyCritical}
                    onChange={(e) => setDashboardOnlyCritical(e.target.checked)}
                  />
                  Solo critici
                </label>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">Lavoratori in tabella {rows.length}</span>
                <span className="text-xs text-slate-500">Gruppi {dashboardDetailGroups.length}</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--brand-line)] bg-white">
                <div className="overflow-x-auto">
                  <table className="min-w-full table-fixed text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-[var(--brand-panel)] text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="sticky left-0 z-20 w-[420px] bg-[var(--brand-panel)] px-3 py-2">
                          {dashboardGroupBy === "provider"
                            ? "Provider"
                            : dashboardGroupBy === "cantiere"
                              ? "Cantiere"
                              : "Mansione"}
                        </th>
                        <th className="w-[72px] px-2 py-2 text-right">Dip</th>
                        <th className="w-[92px] px-2 py-2 text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            <span className="h-2 w-2 rounded-full bg-red-600" />
                            Critico
                          </span>
                        </th>
                        <th className="w-[92px] px-2 py-2 text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            <span className="h-2 w-2 rounded-full bg-amber-500" />
                            In scad.
                          </span>
                        </th>
                        <th className="w-[92px] px-2 py-2 text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            <span className="h-2 w-2 rounded-full bg-sky-500" />
                            Prog.
                          </span>
                        </th>
                        <th className="w-[92px] px-2 py-2 text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            Idoneo
                          </span>
                        </th>
                        <th className="w-[92px] px-2 py-2 text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            <span className="h-2 w-2 rounded-full bg-slate-500" />
                            Sosp.
                          </span>
                        </th>
                        <th className="w-[92px] px-2 py-2 text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            <span className="h-2 w-2 rounded-full bg-slate-500" />
                            Escluso
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardDetailGroups.map((g, index) => (
                        <tr
                          key={`${dashboardGroupBy}-${g.key}`}
                          className={[
                            "border-t border-[var(--brand-line)]",
                            index % 2 === 1 ? "bg-[var(--brand-panel)]/40" : "bg-white",
                            "hover:bg-[var(--brand-panel)]/70",
                          ].join(" ")}
                        >
                          <td
                            className={[
                              "sticky left-0 z-10 max-w-[420px] px-3 py-2 font-semibold",
                              index % 2 === 1 ? "bg-[var(--brand-panel)]/40" : "bg-white",
                              "text-[var(--brand-ink)]",
                            ].join(" ")}
                            title={g.label}
                          >
                            {g.label}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">{g.total}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                            <SurveillanceStateCell count={g.critico} pct={percentage(g.critico, g.total)} />
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                            <SurveillanceStateCell
                              count={g.counts.inScadenza}
                              pct={percentage(g.counts.inScadenza, g.total)}
                            />
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                            <SurveillanceStateCell
                              count={g.counts.programmato}
                              pct={percentage(g.counts.programmato, g.total)}
                            />
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                            <SurveillanceStateCell count={g.counts.idoneo} pct={percentage(g.counts.idoneo, g.total)} />
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                            <SurveillanceStateCell count={g.counts.sospeso} pct={percentage(g.counts.sospeso, g.total)} />
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                            <SurveillanceStateCell count={g.counts.escluso} pct={percentage(g.counts.escluso, g.total)} />
                          </td>
                        </tr>
                      ))}
                      {dashboardDetailGroups.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                            Nessun dato disponibile.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <SurveillanceEventModal
        isOpen={eventModalOpen}
        token={eventModalToken}
        onClose={() => setEventModalOpen(false)}
        selectedWorkerIds={selectedWorkerIds}
        toggleWorkerSelection={toggleWorkerSelection}
        clearSelection={clearSelection}
        workerOptions={workerOptions}
        onSaved={async () => {
          const selectedIds = Array.from(selectedWorkerIds);
          setEventModalOpen(false);
          clearSelection();
          await refreshRowsByEmployeeIds(selectedIds);
          scheduleLoadRows();
        }}
      />

      {workerDetailId ? (
        <>
          <div 
            className="drawer-backdrop open" 
            onClick={closeWorkerDetail} 
          />
          <section className="drawer-panel open flex flex-col h-full z-50">
            <div className="flex items-center justify-between p-4 border-b border-[var(--brand-line)] bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <div className="space-y-0.5">
                <h2 className="text-md font-bold text-[var(--brand-ink)]">Dettaglio lavoratore</h2>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                  Override visita, programmato ed esclusione singola.
                </p>
              </div>
              <button
                type="button"
                data-unstyled="true"
                onClick={closeWorkerDetail}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                title="Chiudi"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/10">
              {workerDetailLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2">
                  <div className="h-6 w-6 rounded-full border-2 border-[var(--brand-primary)] border-t-transparent animate-spin" />
                  <p className="text-xs text-slate-400 font-medium">Caricamento...</p>
                </div>
              ) : workerDetail ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-950 p-4 shadow-sm">
                    <div className="flex flex-col gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                          {workerDetail.employee.last_name} {workerDetail.employee.first_name}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          Matricola: <span className="font-semibold text-slate-700 dark:text-slate-300">{workerDetail.employee.matricola}</span> · Mansione: <span className="font-semibold text-slate-700 dark:text-slate-300">{workerDetail.employee.job_title || "-"}</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          Cantiere: <span className="font-semibold text-slate-700 dark:text-slate-300">{workerDetail.employee.site || "-"}</span> · Sottocantiere: <span className="font-semibold text-slate-700 dark:text-slate-300">{workerDetail.employee.sub_site || "-"}</span>
                        </p>
                      </div>
                      <div className="mt-2 pt-2 border-t border-[var(--brand-line)] flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Scadenza attuale</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {workerDetail.record?.next_due_date ? isoToItDate(workerDetail.record.next_due_date) : "-"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-2 rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-950 p-4 shadow-sm">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Pianificazione</p>
                      <label className="flex items-center gap-2 text-xs text-slate-600 font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={detailPlanned}
                          onChange={(event) => setDetailPlanned(event.target.checked)}
                          disabled={workerDetailLoading}
                          className="rounded text-[var(--brand-primary)] focus:ring-[var(--brand-primary)] disabled:opacity-50"
                        />
                        Segna come programmato
                      </label>
                    </div>

                    <div className="space-y-2 rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-950 p-4 shadow-sm">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Provider (Medico/Ente)</p>
                      <input
                        value={detailProvider}
                        onChange={(event) => setDetailProvider(event.target.value)}
                        disabled={workerDetailLoading}
                        placeholder="Es. Morelli Fabri / Moriste / …"
                        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs disabled:opacity-50"
                      />
                      <p className="text-[10px] text-slate-400">
                        Usato in tabella/export quando la matrice risulta “MISTO” o vuota.
                      </p>
                    </div>

                    <div className="space-y-2 rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-950 p-4 shadow-sm">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Override visita (SI/NO)</p>
                      <select
                        value={detailOverrideMode}
                        onChange={(event) => setDetailOverrideMode(event.target.value as "default" | "SI" | "NO")}
                        disabled={workerDetailLoading}
                        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs disabled:opacity-50"
                      >
                        <option value="default">Default (matrice)</option>
                        <option value="SI">Visita SI</option>
                        <option value="NO">Visita NO</option>
                      </select>
                      <input
                        value={detailOverrideNote}
                        onChange={(event) => setDetailOverrideNote(event.target.value)}
                        disabled={workerDetailLoading}
                        placeholder="Nota override (opzionale)"
                        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs disabled:opacity-50"
                      />
                    </div>

                    <div className="space-y-2 rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-950 p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Esclusione lavoratore</p>
                        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={detailExcluded}
                            onChange={(event) => setDetailExcluded(event.target.checked)}
                            disabled={workerDetailLoading}
                            className="rounded text-[var(--brand-primary)] focus:ring-[var(--brand-primary)] disabled:opacity-50"
                          />
                          Escludi
                        </label>
                      </div>
                      <textarea
                        value={detailExclusionNote}
                        onChange={(event) => setDetailExclusionNote(event.target.value)}
                        placeholder="Motivazione esclusione (opzionale)"
                        className="min-h-[84px] w-full resize-none rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs disabled:opacity-50"
                        disabled={workerDetailLoading || !detailExcluded}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {workerDetailError ? (
                <p className="text-xs font-medium text-red-600 p-2 bg-red-50 rounded-xl">{workerDetailError}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--brand-line)] bg-slate-50 dark:bg-slate-900/30 px-4 py-3 shrink-0">
              <button
                type="button"
                data-unstyled="true"
                onClick={closeWorkerDetail}
                className="rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-800 dark:text-slate-200 px-4 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Chiudi
              </button>
              <button
                type="button"
                onClick={() => void saveWorkerDetail()}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={workerDetailLoading || detailSaving}
              >
                {detailSaving ? "Salvo…" : "Salva modifiche"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function percentage(count: number, total: number) {
  if (!total) return "0%";
  return `${Number(((count / total) * 100).toFixed(1))}%`;
}

function SurveillanceStateCell(props: { count: number; pct: string }) {
  if (!props.count) return <span className="text-slate-400">0</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="font-semibold tabular-nums text-slate-800">{props.count}</span>
      <span className="text-[10px] text-slate-500">{props.pct}</span>
    </span>
  );
}
