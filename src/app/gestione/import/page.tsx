"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportErrorRow, ImportPreviewRow, ImportSummary } from "@/lib/import/anagrafica";

type ImportResponse = {
  mode: "preview" | "commit";
  summary: ImportSummary;
  previewRows: ImportPreviewRow[];
  errors: ImportErrorRow[];
  importRunId: string | null;
  message: string;
};

type LastImportRun = {
  id: string;
  source: string;
  fileName: string;
  status: string;
  createdAt: string;
  importedByName: string | null;
};

function formatDateTimeIt(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("it-IT");
}

export default function GestioneImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [progress, setProgress] = useState(0);
  const [lastRun, setLastRun] = useState<LastImportRun | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);

  const derivedCounts = useMemo(() => {
    const warningRows = result?.errors?.filter((row) => row.errorType === "row_imported_with_issues").length ?? 0;
    const blockingRows = (result?.errors?.length ?? 0) - warningRows;
    return { warningRows, blockingRows };
  }, [result]);

  const counters = useMemo(() => {
    if (!result) {
      return {
        righeTotali: 0,
        valide: 0,
        nuove: 0,
        aggiornate: 0,
        riattivate: 0,
        dimessi: 0,
        segnalazioni: 0,
        bloccanti: 0,
      };
    }

    return {
      righeTotali: result.summary.totalRows,
      valide: result.summary.validRows,
      nuove: result.summary.newRows,
      aggiornate: result.summary.updatedRows,
      riattivate: result.summary.reactivatedRows,
      dimessi: result.summary.dismissedRows,
      segnalazioni: derivedCounts.warningRows,
      bloccanti: derivedCounts.blockingRows,
    };
  }, [derivedCounts.blockingRows, derivedCounts.warningRows, result]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/import-runs/last?source=anagrafica", { method: "GET" });
      const body = (await response.json()) as { run: LastImportRun | null; error?: string };
      if (cancelled) return;
      if (!response.ok || body.error) return;
      setLastRun(body.run);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, []);

  async function runImport(mode: "preview" | "commit") {
    if (!selectedFile) return;

    runTokenRef.current += 1;
    const token = runTokenRef.current;
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    setIsLoading(true);
    setServerError("");
    setProgress(0);
    progressTimerRef.current = window.setInterval(() => {
      setProgress((value) => {
        if (runTokenRef.current !== token) return value;
        if (value >= 99) return 99;
        const step = value < 60 ? 4 : value < 85 ? 2 : 1;
        return Math.min(99, value + step);
      });
    }, 350);

    try {
      const formData = new FormData();
      formData.append("mode", mode);
      formData.append("file", selectedFile);

      const response = await fetch("/api/gestione/import", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as ImportResponse | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Errore in fase di import.");
      }

      setResult(payload);
      if (runTokenRef.current === token && progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setProgress(100);
      if (mode === "commit") {
        const response = await fetch("/api/import-runs/last?source=anagrafica", { method: "GET" });
        const body = (await response.json()) as { run: LastImportRun | null; error?: string };
        if (response.ok && !body.error) setLastRun(body.run);
      }
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Errore imprevisto durante l'import.",
      );
      setProgress(0);
    } finally {
      if (runTokenRef.current === token && progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (runTokenRef.current === token) setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--brand-ink)]">
          Import anagrafica
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          Flusso admin per upload, anteprima, validazione e commit dei dati.
        </p>
        {lastRun ? (
          <p className="mt-2 text-xs text-slate-500">
            Ultimo import: {formatDateTimeIt(lastRun.createdAt)}
            {lastRun.importedByName ? ` · ${lastRun.importedByName}` : ""} · {lastRun.fileName}
          </p>
        ) : null}
      </section>

      <section className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Caricamento file
        </h2>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            type="file"
            accept=".csv,.xls,.xlsx"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setSelectedFile(nextFile);
              setResult(null);
              setServerError("");
            }}
            className="block w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-600"
          />
          <button
            type="button"
            disabled={!selectedFile || isLoading}
            onClick={() => runImport("preview")}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            {isLoading ? "Elaborazione..." : "Anteprima"}
          </button>
          <button
            type="button"
            disabled={!selectedFile || isLoading}
            onClick={() => runImport("commit")}
            className="rounded-xl border border-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--brand-primary)] transition hover:bg-[var(--brand-tint)]"
          >
            Conferma import
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          File selezionato: {selectedFile?.name || "nessuno"}
        </p>
        {result ? (
          <p className="mt-2 text-xs font-medium text-[var(--brand-primary)]">
            {result.message}
          </p>
        ) : null}
        {serverError ? (
          <p className="mt-2 text-xs font-medium text-red-600">{serverError}</p>
        ) : null}
        {isLoading || progress > 0 ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Avanzamento</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-[var(--brand-primary)] transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Righe totali" value={counters.righeTotali} />
        <StatCard label="Valide" value={counters.valide} />
        <StatCard label="Nuove" value={counters.nuove} />
        <StatCard label="Aggiornate" value={counters.aggiornate} />
        <StatCard label="Riattivate" value={counters.riattivate} />
        <StatCard label="Dimessi" value={counters.dimessi} />
        <StatCard label="Segnalazioni" value={counters.segnalazioni} />
        <StatCard label="Bloccanti" value={counters.bloccanti} />
      </section>

      <section>
        <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-white">
          <div className="border-b border-[var(--brand-line)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--brand-ink)]">
              Report segnalazioni / errori
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--brand-panel)] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Matricola</th>
                  <th className="px-4 py-3">CF</th>
                  <th className="px-4 py-3">Cognome</th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Esito</th>
                </tr>
              </thead>
              <tbody>
                {result?.errors?.length ? (
                  result.errors.map((row, index) => (
                    (() => {
                      const isWarning = row.errorType === "row_imported_with_issues";
                      const tone = isWarning ? "text-amber-700" : "text-red-600";
                      return (
                    <tr
                      key={`${row.taxCode}-${index}`}
                      className="border-t border-[var(--brand-line)]"
                    >
                      <td className="px-4 py-3 text-slate-600">{row.matricola || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.taxCode || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.lastName || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.firstName || "-"}</td>
                      <td className={`px-4 py-3 font-medium ${tone}`}>
                        {row.errorMessage}
                      </td>
                    </tr>
                      );
                    })()
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                      Nessun report disponibile.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-[16px] border border-[var(--brand-line)] bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--brand-ink)]">
        {value}
      </p>
    </article>
  );
}
