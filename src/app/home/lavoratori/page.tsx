"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ModuleHeader } from "@/components/module-ui";

type EmployeeRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
};

type WorkerCourseRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  corsoCode: string;
  corso: string;
  dataConclusione: string | null;
  dataScadenza: string | null;
  stato: "idoneo" | "in scadenza" | "scaduto" | "da fare" | "sospeso" | "programmato" | "upgrade";
  upgradeInfo: string | null;
  responsabile: string;
  referente: string;
  note: string;
  origine: "obbligatorio" | "aggiuntivo";
};

type DetailTab = "dati" | "turni";

type WorkerDpiRow = {
  workerId: number;
  dpiId: number;
  dpi: string;
  category: string;
  controlFrequency: string;
  controlType: string;
  dataConsegna: string | null;
  dataProssimoControllo: string | null;
  stato: "idoneo" | "consegnato" | "da consegnare" | "da verificare" | "scaduto" | "programmato";
  note: string;
};

type AssetType = "mezzo" | "attrezzatura";
type OwnershipType = "proprieta" | "noleggio";
type AssetStatus = "attivo" | "fuori_servizio" | "dismesso";

type EquipmentAssignmentRow = {
  id: number;
  assetId: number;
  employeeId: number;
  startDate: string;
  endDate: string | null;
  note: string;
  asset: {
    id: number;
    assetType: AssetType;
    ownershipType: OwnershipType;
    status: AssetStatus;
    category: string;
    brand: string;
    model: string;
    plate: string;
    internalCode: string;
    serialNumber: string;
    cantiere: string;
    sottocantiere: string;
  } | null;
};

type SortKey = "cognome" | "nome" | "mansione" | "cantiere" | "sottocantiere" | "responsabile" | "referente";
type SortDir = "asc" | "desc";

type MedicalDetail = {
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
  state?: "idoneo" | "in scadenza" | "scaduto" | "da fare" | "programmato" | "sospeso" | "escluso";
  requiresVisit?: boolean;
  freezeStatus?: string | null;
};

export default function HomeLavoratoriPage() {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const [selected, setSelected] = useState<EmployeeRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("dati");
  const [trainingRows, setTrainingRows] = useState<WorkerCourseRow[]>([]);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState("");

  const [dpiRows, setDpiRows] = useState<WorkerDpiRow[]>([]);
  const [dpiLoading, setDpiLoading] = useState(false);
  const [dpiError, setDpiError] = useState("");

  const [medicalDetail, setMedicalDetail] = useState<MedicalDetail | null>(null);
  const [medicalLoading, setMedicalLoading] = useState(false);
  const [medicalError, setMedicalError] = useState("");

  const [equipmentRows, setEquipmentRows] = useState<EquipmentAssignmentRow[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipmentError, setEquipmentError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchChunk(params: URLSearchParams) {
      const response = await fetch(`/api/lavoratori/anagrafica?${params.toString()}`);
      const body = (await response.json()) as {
        rows?: EmployeeRow[];
        error?: string;
        truncated?: boolean;
      };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento lavoratori.");
      }
      return {
        rows: body.rows ?? [],
        truncated: Boolean(body.truncated),
      };
    }

    async function loadEmployees() {
      setIsLoading(true);
      setError("");
      try {
        const nextRows: EmployeeRow[] = [];
        let offset = 0;
        let truncated = true;
        const q = deferredSearch.trim();
        while (truncated) {
          const params = new URLSearchParams();
          params.set("limit", "1000");
          params.set("offset", String(offset));
          if (q) params.set("q", q);
          const result = await fetchChunk(params);
          nextRows.push(...result.rows);
          truncated = result.truncated;
          offset += result.rows.length;
          if (result.rows.length === 0) break;
        }
        if (!cancelled) setRows(nextRows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento lavoratori.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadEmployees();
    return () => {
      cancelled = true;
    };
  }, [deferredSearch]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
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
      return searchable.includes(q);
    });
  }, [rows, deferredSearch]);

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cognome", dir: "asc" });

  const sorted = useMemo(() => {
    const compareText = (a: string, b: string) =>
      a.localeCompare(b, "it", { sensitivity: "base", numeric: true });
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
      else if (sort.key === "responsabile") cmp = compareText(a.responsabile, b.responsabile) || compareText(a.cognome, b.cognome);
      else cmp = compareText(a.referente, b.referente) || compareText(a.cognome, b.cognome);
      return cmp * dirMul;
    });
    return list;
  }, [filtered, sort.dir, sort.key]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  const sortIcon = (col: SortKey) => {
    if (sort.key !== col) return <span className="text-[10px] text-slate-400">↕</span>;
    return <span className="text-[10px] text-slate-700">{sort.dir === "asc" ? "↑" : "↓"}</span>;
  };

  const medicalState = (detail: MedicalDetail | null) => {
    if (!detail) return "da fare" as const;
    if (detail.state) return detail.state;
    if (detail.exclusion?.is_active) return "escluso" as const;
    if (detail.override?.is_active && detail.override.requires_visit === false) return "idoneo" as const;
    const todayIso = new Date().toISOString().slice(0, 10);
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + 30);
    const thresholdIso = threshold.toISOString().slice(0, 10);
    const due = detail.record?.next_due_date ?? null;
    const planned = Boolean(detail.record?.is_planned ?? false);
    if (!due) return planned ? ("programmato" as const) : ("da fare" as const);
    if (due < todayIso) return "scaduto" as const;
    if (planned) return "programmato" as const;
    if (due <= thresholdIso) return "in scadenza" as const;
    return "idoneo" as const;
  };

  const medicalStatusClassName = (state: string) => {
    if (state === "scaduto" || state === "da fare") return "rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold text-red-700";
    if (state === "in scadenza") return "rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700";
    if (state === "programmato") return "rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-700";
    if (state === "escluso") return "rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700";
    return "rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700";
  };

  async function openDetail(employee: EmployeeRow) {
    setSelected(employee);
    setDetailTab("dati");
    setTrainingRows([]);
    setTrainingError("");
    setTrainingLoading(true);
    setDpiRows([]);
    setDpiError("");
    setDpiLoading(true);
    setMedicalDetail(null);
    setMedicalError("");
    setMedicalLoading(true);
    setEquipmentRows([]);
    setEquipmentError("");
    setEquipmentLoading(true);
    try {
      const response = await fetch(`/api/lavoratori/corsi?employeeId=${encodeURIComponent(String(employee.workerId))}&expiringDays=30`);
      const body = (await response.json()) as { rows?: WorkerCourseRow[]; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento formazione lavoratore.");
      }
      const list = body.rows ?? [];
      list.sort((a, b) => statusSortKey(a.stato) - statusSortKey(b.stato) || a.corsoCode.localeCompare(b.corsoCode));
      setTrainingRows(list);
    } catch (err) {
      setTrainingError(err instanceof Error ? err.message : "Errore caricamento formazione lavoratore.");
    } finally {
      setTrainingLoading(false);
    }

    try {
      const response = await fetch(
        `/api/sorveglianza_sanitaria/lavoratore?employeeId=${encodeURIComponent(String(employee.workerId))}`,
      );
      const body = (await response.json()) as {
        record?: MedicalDetail["record"];
        exclusion?: MedicalDetail["exclusion"];
        override?: MedicalDetail["override"];
        state?: MedicalDetail["state"];
        requiresVisit?: boolean;
        freezeStatus?: string | null;
        error?: string;
      };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento visita medica.");
      }
      setMedicalDetail({
        record: (body.record ?? null) as MedicalDetail["record"],
        exclusion: (body.exclusion ?? null) as MedicalDetail["exclusion"],
        override: (body.override ?? null) as MedicalDetail["override"],
        state: body.state,
        requiresVisit: body.requiresVisit,
        freezeStatus: body.freezeStatus ?? null,
      });
    } catch (err) {
      setMedicalError(err instanceof Error ? err.message : "Errore caricamento visita medica.");
    } finally {
      setMedicalLoading(false);
    }

    try {
      const response = await fetch(
        `/api/lavoratori/dpi?employeeId=${encodeURIComponent(String(employee.workerId))}&expiringDays=30&date=${encodeURIComponent(
          new Date().toISOString().slice(0, 10),
        )}`,
      );
      const body = (await response.json()) as { rows?: WorkerDpiRow[]; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento DPI lavoratore.");
      }
      setDpiRows(body.rows ?? []);
    } catch (err) {
      setDpiError(err instanceof Error ? err.message : "Errore caricamento DPI lavoratore.");
    } finally {
      setDpiLoading(false);
    }

    try {
      const response = await fetch(
        `/api/mezzi_attrezzature/assignments?employeeId=${encodeURIComponent(String(employee.workerId))}&activeOnly=1`,
      );
      const body = (await response.json()) as { rows?: EquipmentAssignmentRow[]; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento assegnazioni mezzi/attrezzature.");
      }
      setEquipmentRows(body.rows ?? []);
    } catch (err) {
      setEquipmentError(
        err instanceof Error ? err.message : "Errore caricamento assegnazioni mezzi/attrezzature.",
      );
    } finally {
      setEquipmentLoading(false);
    }
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every((r) => selectedIds.has(r.workerId));

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (sorted.every((r) => next.has(r.workerId))) sorted.forEach((r) => next.delete(r.workerId));
      else sorted.forEach((r) => next.add(r.workerId));
      return next;
    });
  }

  async function downloadFascicoli() {
    if (selectedIds.size === 0 || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch("/api/lavoratori/fascicolo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeIds: Array.from(selectedIds) }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Errore generazione fascicoli.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fascicoli-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore generazione fascicoli.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <ModuleHeader title="Lavoratori" description="Elenco lavoratori attivi e pannello di dettaglio.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ricerca: cognome, nome, mansione, cantiere, responsabile"
            className="w-[360px] max-w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void downloadFascicoli()}
            disabled={selectedIds.size === 0 || downloading}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white shadow-sm transition enabled:hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            title="Genera un PDF con una pagina per ogni lavoratore selezionato"
          >
            {downloading ? "Genero…" : `Genera fascicoli${selectedIds.size ? ` (${selectedIds.size})` : ""}`}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
      </ModuleHeader>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
        <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky top-0 z-20 w-[40px] bg-[var(--brand-panel)] px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Seleziona tutti"
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
                    onClick={() => toggleSort("responsabile")}
                    className="inline-flex items-center gap-1"
                  >
                    Responsabile {sortIcon("responsabile")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("referente")} className="inline-flex items-center gap-1">
                    Referente {sortIcon("referente")}
                  </button>
                </th>
                <th className="sticky top-0 z-30 bg-[var(--brand-panel)] px-4 py-2 text-right">Dett.</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.workerId}
                  className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                >
                  <td className="w-[40px] px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.workerId)}
                      onChange={() => toggleOne(row.workerId)}
                      aria-label={`Seleziona ${row.cognome} ${row.nome}`}
                    />
                  </td>
                  <td className="w-[14%] px-4 py-2.5 font-semibold text-slate-800">{row.cognome}</td>
                  <td className="w-[12%] px-4 py-2.5 text-slate-800">{row.nome}</td>
                  <td className="w-[20%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.mansione || "-"}>
                      {row.mansione || "-"}
                    </span>
                  </td>
                  <td className="w-[15%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.cantiere}>
                      {row.cantiere}
                    </span>
                  </td>
                  <td className="w-[15%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.sottocantiere}>
                      {row.sottocantiere}
                    </span>
                  </td>
                  <td className="w-[10%] px-4 py-2.5 font-medium text-slate-700">{row.responsabile}</td>
                  <td className="w-[12%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.referente || "-"}>
                      {row.referente || "-"}
                    </span>
                  </td>
                  <td className="sticky right-0 w-[56px] bg-white px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => void openDetail(row)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                      title="Apri dettaglio lavoratore"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                        aria-hidden
                      >
                        <circle cx="11" cy="11" r="6.2" />
                        <path d="M20 20l-3.5-3.5" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                    Nessun dato disponibile.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {isLoading ? <p className="px-4 py-3 text-xs text-slate-500">Caricamento…</p> : null}
      </section>

      {selected ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
            <div className="border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-bold text-[var(--brand-primary)] shadow-sm ring-1 ring-[var(--brand-line)]">
                    {`${selected.cognome}`.slice(0, 1)}
                    {`${selected.nome}`.slice(0, 1)}
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-lg font-bold text-[var(--brand-ink)]">
                      {selected.cognome} {selected.nome}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-[var(--brand-line)]">
                        {selected.mansione || "-"}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-[var(--brand-line)]">
                        {selected.cantiere}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="tab-group">
                    <button
                      type="button"
                      onClick={() => setDetailTab("dati")}
                      data-active={detailTab === "dati" ? "true" : undefined}
                    >
                      Dati
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab("turni")}
                      data-active={detailTab === "turni" ? "true" : undefined}
                    >
                      Turni e cantieri
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                    title="Chiudi"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {detailTab === "dati" ? (
                <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
                  <article className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)]/35 p-5">
                    <h3 className="text-sm font-bold text-[var(--brand-ink)]">Dati dipendente</h3>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <dt className="text-slate-500">Matricola</dt>
                        <dd className="font-semibold text-slate-800">{selected.matricola}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <dt className="text-slate-500">Mansione</dt>
                        <dd className="text-right font-medium text-slate-700">{selected.mansione || "-"}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <dt className="text-slate-500">Cantiere</dt>
                        <dd className="text-right font-medium text-slate-700">{selected.cantiere}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <dt className="text-slate-500">Sottocantiere</dt>
                        <dd className="text-right font-medium text-slate-700">{selected.sottocantiere}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <dt className="text-slate-500">Responsabile</dt>
                        <dd className="font-semibold text-slate-800">{selected.responsabile}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <dt className="text-slate-500">Referente</dt>
                        <dd className="text-right font-medium text-slate-700">{selected.referente || "-"}</dd>
                      </div>
                    </dl>
                  </article>

                  <article className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-bold text-[var(--brand-ink)]">Formazione</h3>
                      <p className="text-xs text-slate-500">Colori scadenza: rosso scaduto, giallo in scadenza, verde ok.</p>
                    </div>
                    {trainingLoading ? <p className="mt-2 text-sm text-slate-500">Caricamento…</p> : null}
                    {trainingError ? (
                      <p className="mt-2 text-sm font-medium text-red-600">{trainingError}</p>
                    ) : null}
                    {!trainingLoading && !trainingError ? (
                      <div className="mt-3 max-h-[420px] overflow-auto rounded-2xl border border-[var(--brand-line)]">
                        <table className="w-full table-fixed text-left text-xs">
                          <colgroup>
                            <col style={{ width: "56%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "26%" }} />
                          </colgroup>
                          <thead className="sticky top-0 z-10 bg-white text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Corso</th>
                              <th className="px-3 py-2">Scadenza</th>
                              <th className="px-3 py-2">Stato</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trainingRows.map((courseRow) => (
                              <tr
                                key={`${courseRow.workerId}-${courseRow.corsoCode}-${courseRow.dataScadenza ?? ""}-${courseRow.stato}`}
                                className="border-t border-[var(--brand-line)] bg-white"
                              >
                                <td className="px-3 py-2 text-slate-800" title={courseRow.corso}>
                                  {courseRow.corso}
                                </td>
                                <td className={trainingExpiryClassName(courseRow.stato)}>
                                  {formatDateIt(courseRow.dataScadenza)}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className={trainingStatusClassName(courseRow.stato)}>
                                      {courseRow.stato}
                                    </span>
                                    {courseRow.stato === "upgrade" && courseRow.upgradeInfo ? (
                                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-600">
                                        {courseRow.upgradeInfo}
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {trainingRows.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="px-3 py-6 text-center text-xs text-slate-500">
                                  Nessun corso.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </article>

                  <article className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-5 lg:col-span-2">
                    <h3 className="text-sm font-bold text-[var(--brand-ink)]">Visita medica</h3>
                    {medicalLoading ? <p className="mt-2 text-sm text-slate-500">Caricamento…</p> : null}
                    {medicalError ? <p className="mt-2 text-sm font-medium text-red-600">{medicalError}</p> : null}
                    {!medicalLoading && !medicalError ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-semibold text-slate-700">Prossima scadenza</div>
                            <span className={medicalStatusClassName(medicalState(medicalDetail))}>
                              {medicalState(medicalDetail)}
                            </span>
                          </div>
                          <div className="mt-2 text-sm font-semibold tabular-nums text-slate-900">
                            {formatDateIt(medicalDetail?.record?.next_due_date ?? null)}
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            Provider: {medicalDetail?.record?.provider ? medicalDetail.record.provider : "-"}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Programmato: {medicalDetail?.record?.is_planned ? "si" : "no"}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Visita richiesta: {medicalDetail?.requiresVisit ? "SI" : "NO"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
                          <div className="text-xs font-semibold text-slate-700">Note / Limitazioni</div>
                          <div className="mt-2 text-xs text-slate-600">
                            Limitazioni: {String(medicalDetail?.record?.limitations ?? "").trim() || "-"}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            Note: {String(medicalDetail?.record?.notes ?? "").trim() || "-"}
                          </div>
                          {medicalDetail?.override?.is_active ? (
                            <div className="mt-3 text-xs font-semibold text-slate-700">
                              Override: {medicalDetail.override.requires_visit ? "visita SI" : "visita NO"}
                            </div>
                          ) : null}
                          {medicalDetail?.freezeStatus ? (
                            <div className="mt-3 text-xs font-semibold text-slate-700">
                              Freeze: {medicalDetail.freezeStatus}
                            </div>
                          ) : null}
                          {medicalDetail?.exclusion?.is_active ? (
                            <div className="mt-3 text-xs font-semibold text-slate-700">Escluso: si</div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </article>

                  <article className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-5 lg:col-span-2">
                    <h3 className="text-sm font-bold text-[var(--brand-ink)]">DPI</h3>
                    {dpiLoading ? <p className="mt-2 text-sm text-slate-500">Caricamento…</p> : null}
                    {dpiError ? <p className="mt-2 text-sm font-medium text-red-600">{dpiError}</p> : null}
                    {!dpiLoading && !dpiError ? (
                      <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--brand-line)]">
                        <table className="w-full table-fixed text-left text-xs">
                          <colgroup>
                            <col style={{ width: "46%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "18%" }} />
                          </colgroup>
                          <thead className="bg-white text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2">DPI</th>
                              <th className="px-3 py-2">Consegna</th>
                              <th className="px-3 py-2">Prossimo controllo</th>
                              <th className="px-3 py-2">Stato</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dpiRows.map((row) => (
                              <tr
                                key={`${row.workerId}-${row.dpiId}`}
                                className="border-t border-[var(--brand-line)] bg-white"
                              >
                                <td className="px-3 py-2 text-slate-800">
                                  <div className="font-semibold text-slate-900" title={row.dpi}>
                                    {row.dpi}
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-500">
                                    {row.controlFrequency ? row.controlFrequency : ""}
                                    {row.controlType ? ` · ${row.controlType}` : ""}
                                  </div>
                                </td>
                                <td className="px-3 py-2 font-semibold tabular-nums text-slate-700">
                                  {formatDateIt(row.dataConsegna)}
                                </td>
                                <td className="px-3 py-2 font-semibold tabular-nums text-slate-700">
                                  {formatDateIt(row.dataProssimoControllo)}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={dpiStatusClassName(row.stato)}>{row.stato}</span>
                                </td>
                              </tr>
                            ))}
                            {dpiRows.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-500">
                                  Nessun DPI.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </article>

                  <article className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-5 lg:col-span-2">
                    <h3 className="text-sm font-bold text-[var(--brand-ink)]">Mezzi / attrezzature assegnati</h3>
                    {equipmentLoading ? <p className="mt-2 text-sm text-slate-500">Caricamento…</p> : null}
                    {equipmentError ? (
                      <p className="mt-2 text-sm font-medium text-red-600">{equipmentError}</p>
                    ) : null}
                    {!equipmentLoading && !equipmentError ? (
                      <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--brand-line)]">
                        <table className="w-full table-fixed text-left text-xs">
                          <colgroup>
                            <col style={{ width: "32%" }} />
                            <col style={{ width: "20%" }} />
                            <col style={{ width: "16%" }} />
                            <col style={{ width: "16%" }} />
                            <col style={{ width: "16%" }} />
                          </colgroup>
                          <thead className="bg-white text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Asset</th>
                              <th className="px-3 py-2">Tipo</th>
                              <th className="px-3 py-2">Inizio</th>
                              <th className="px-3 py-2">Fine</th>
                              <th className="px-3 py-2">Note</th>
                            </tr>
                          </thead>
                          <tbody>
                            {equipmentRows.map((row) => (
                              <tr
                                key={row.id}
                                className="border-t border-[var(--brand-line)] bg-white"
                              >
                                <td className="px-3 py-2 font-semibold text-slate-800">
                                  {row.asset ? equipmentAssetLabel(row.asset) : "-"}
                                  <div className="mt-1 text-[11px] font-medium text-slate-500">
                                    {row.asset ? `${row.asset.cantiere} · ${row.asset.sottocantiere}` : ""}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {row.asset ? row.asset.assetType : "-"}
                                </td>
                                <td className="px-3 py-2 font-semibold tabular-nums text-slate-700">
                                  {formatDateIt(row.startDate)}
                                </td>
                                <td className="px-3 py-2 tabular-nums text-slate-600">
                                  {formatDateIt(row.endDate)}
                                </td>
                                <td className="px-3 py-2 text-slate-600">
                                  <span className="block line-clamp-2" title={row.note || ""}>
                                    {row.note || "-"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {equipmentRows.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">
                                  Nessun mezzo/attrezzatura assegnato.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </article>
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-6 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[var(--brand-ink)]">Gestione Turni e Pianificazione</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                    Per visualizzare la pianificazione del mese corrente, gestire le assenze o modificare la settimana tipo di {selected.cognome} {selected.nome}, accedi alla vista operativa dedicata.
                  </p>
                  <div className="mt-6">
                    <a
                      href={`/turni/lavoratori?employeeId=${selected.workerId}`}
                      className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
                    >
                      Apri Turni Lavoratore &rarr;
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function statusSortKey(status: WorkerCourseRow["stato"]) {
  if (status === "scaduto") return 1;
  if (status === "da fare") return 2;
  if (status === "upgrade") return 3;
  if (status === "in scadenza") return 4;
  if (status === "programmato") return 5;
  if (status === "sospeso") return 6;
  return 7;
}

function trainingStatusClassName(status: WorkerCourseRow["stato"]) {
  const base =
    "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.05em] leading-none";
  if (status === "scaduto") return `${base} border-red-900/40 bg-red-700/55 text-white`;
  if (status === "da fare") return `${base} border-rose-900/40 bg-rose-700/55 text-white`;
  if (status === "upgrade") return `${base} border-violet-900/40 bg-violet-700/55 text-white`;
  if (status === "in scadenza") return `${base} border-amber-800/45 bg-amber-300/45 text-slate-950`;
  if (status === "programmato") return `${base} border-sky-900/40 bg-sky-700/55 text-white`;
  if (status === "idoneo") return `${base} border-emerald-900/35 bg-emerald-400/45 text-slate-950`;
  if (status === "sospeso" || status === "escluso") return `${base} border-slate-900/35 bg-slate-700/55 text-white`;
  return `${base} border-slate-900/35 bg-slate-700/55 text-white`;
}

function trainingExpiryClassName(status: WorkerCourseRow["stato"]) {
  const base = "px-3 py-2 font-semibold tabular-nums";
  if (status === "scaduto") return `${base} text-red-700`;
  if (status === "in scadenza") return `${base} text-amber-700`;
  if (status === "idoneo") return `${base} text-emerald-700`;
  return `${base} text-slate-700`;
}

function dpiStatusClassName(status: WorkerDpiRow["stato"]) {
  const base =
    "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.05em] leading-none";
  if (status === "scaduto") return `${base} border-red-900/40 bg-red-700/55 text-white`;
  if (status === "da consegnare") return `${base} border-rose-900/40 bg-rose-700/55 text-white`;
  if (status === "da verificare") return `${base} border-amber-800/45 bg-amber-300/45 text-slate-950`;
  if (status === "programmato") return `${base} border-sky-900/40 bg-sky-700/55 text-white`;
  if (status === "idoneo") return `${base} border-emerald-900/35 bg-emerald-400/45 text-slate-950`;
  return `${base} border-slate-900/35 bg-slate-700/55 text-white`;
}

function equipmentAssetLabel(asset: {
  assetType: AssetType;
  plate: string;
  internalCode: string;
  brand: string;
  model: string;
}) {
  if (asset.assetType === "mezzo") {
    if (asset.plate) return asset.plate;
    if (asset.internalCode) return asset.internalCode;
  }
  if (asset.internalCode) return asset.internalCode;
  const parts = [asset.brand, asset.model].filter(Boolean).join(" ");
  return parts || "Asset";
}

function formatDateIt(value: string | null) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
