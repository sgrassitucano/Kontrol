"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  stato: "idoneo" | "in scadenza" | "scaduto" | "da fare" | "sospeso" | "escluso";
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
    sospeso: number;
    escluso: number;
  };
  error?: string;
};

type StatusFilter = "" | WorkerSurveillanceRow["stato"];

export default function HomeSorveglianzaPage() {
  const [rows, setRows] = useState<WorkerSurveillanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [expiringDays, setExpiringDays] = useState(30);

  const [meta, setMeta] = useState<{
    totalActiveEmployees: number;
    excludedByRule: number;
    frozenEmployees: number;
    counts: ApiResponse["counts"];
  }>({
    totalActiveEmployees: 0,
    excludedByRule: 0,
    frozenEmployees: 0,
    counts: { idoneo: 0, inScadenza: 0, scaduto: 0, daFare: 0, sospeso: 0, escluso: 0 },
  });

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("expiringDays", String(expiringDays));
      if (includeExcluded) params.set("includeExcluded", "1");
      if (search.trim()) params.set("q", search.trim());
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
        counts: body.counts ?? { idoneo: 0, inScadenza: 0, scaduto: 0, daFare: 0, sospeso: 0, escluso: 0 },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento sorveglianza sanitaria.");
    } finally {
      setIsLoading(false);
    }
  }, [expiringDays, includeExcluded, search]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter && row.stato !== statusFilter) return false;
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

  function badgeTone(state: WorkerSurveillanceRow["stato"]) {
    if (state === "scaduto" || state === "da fare") return "bg-red-50 text-red-700";
    if (state === "in scadenza") return "bg-amber-50 text-amber-700";
    if (state === "sospeso") return "bg-slate-100 text-slate-700";
    if (state === "escluso") return "bg-slate-100 text-slate-700";
    return "bg-emerald-50 text-emerald-700";
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-ink)]">Sorveglianza sanitaria</h1>
            <p className="mt-2 text-sm leading-7 text-slate-500">
              Cruscotto e tabella lavoratori. Import e matrice restano raggiungibili dalle azioni.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Totale attivi</p>
            <p className="mt-1 text-2xl font-bold text-[var(--brand-ink)]">{meta.totalActiveEmployees}</p>
          </div>
          <button
            type="button"
            onClick={() => setStatusFilter("scaduto")}
            className="rounded-2xl border border-[var(--brand-line)] bg-white p-3 text-left transition hover:bg-[var(--brand-panel)]"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scaduti</p>
            <p className="mt-1 text-2xl font-bold text-red-700">{meta.counts.scaduto}</p>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("in scadenza")}
            className="rounded-2xl border border-[var(--brand-line)] bg-white p-3 text-left transition hover:bg-[var(--brand-panel)]"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">In scadenza</p>
            <p className="mt-1 text-2xl font-bold text-amber-700">{meta.counts.inScadenza}</p>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("da fare")}
            className="rounded-2xl border border-[var(--brand-line)] bg-white p-3 text-left transition hover:bg-[var(--brand-panel)]"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Da fare</p>
            <p className="mt-1 text-2xl font-bold text-red-700">{meta.counts.daFare}</p>
          </button>
        </div>

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
              onClick={() => setStatusFilter("escluso")}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Esclusi ({meta.counts.escluso})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("sospeso")}
              className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Sospesi ({meta.counts.sospeso})
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
            <button
              type="button"
              onClick={() => void loadRows()}
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              disabled={isLoading}
            >
              {isLoading ? "Aggiorno…" : "Aggiorna"}
            </button>
          </div>
        </div>

        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
        {!error && meta.excludedByRule > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Esclusi per regole: {meta.excludedByRule}. Sospesi (stati attivi): {meta.frozenEmployees}.
          </p>
        ) : null}
      </section>

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
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeTone(row.stato)}`}>
                      {row.stato}
                    </span>
                  </td>
                  <td className="w-[18%] px-4 py-2.5 text-slate-600">
                    <span className="block line-clamp-2" title={row.medico}>
                      {row.medico}
                    </span>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">
                    Nessun risultato.
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
