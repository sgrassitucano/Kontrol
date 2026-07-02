"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  SurveillanceImportErrorRow,
  SurveillanceImportPreviewRow,
  SurveillanceImportSummary,
} from "@/lib/import/sorveglianza";
import { ModuleHeader, PanelCard } from "@/components/module-ui";
import { buildHttpErrorMessage, extractResponseError, readJsonSafely } from "@/lib/client/http";

type ImportResponse = {
  mode: "preview" | "commit";
  summary: SurveillanceImportSummary;
  previewRows: SurveillanceImportPreviewRow[];
  errors: SurveillanceImportErrorRow[];
  message: string;
};

type LastImportRun = {
  id: string;
  source: string;
  fileName: string;
  status: string;
  createdAt: string;
  importedByName: string | null;
  totalRows?: number;
  processedRows?: number;
  errorRows?: number;
};

function formatDateTimeIt(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("it-IT");
}

export default function SorveglianzaImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [undoMessage, setUndoMessage] = useState<string>("");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [progress, setProgress] = useState(0);
  const [lastRun, setLastRun] = useState<LastImportRun | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);

  const refreshLastRun = useCallback(async () => {
    const response = await fetch("/api/import-runs/last?source=sorveglianza", { method: "GET" });
    const body = await readJsonSafely<{ run: LastImportRun | null; error?: string }>(response);
    if (!response.ok) {
      throw new Error(buildHttpErrorMessage(response, body, "Errore caricamento ultimo import"));
    }
    if (extractResponseError(body)) {
      throw new Error(extractResponseError(body) ?? "Errore caricamento ultimo import.");
    }
    setLastRun(body?.run ?? null);
  }, []);

  const downloadFrom = useCallback(async (url: string) => {
    setIsDownloadingReport(true);
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) throw new Error("Errore download report.");
      const blob = await response.blob();
      const disp = response.headers.get("content-disposition") ?? "";
      const match = disp.match(/filename=\"([^\"]+)\"/i);
      const filename = match?.[1] ?? "report.csv";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setIsDownloadingReport(false);
    }
  }, []);

  const counters = useMemo(() => {
    if (!result) {
      return {
        righeTotali: 0,
        valide: 0,
        associate: 0,
        mancanti: 0,
        visitaSi: 0,
        visitaNo: 0,
        scadenzaMancante: 0,
        errori: 0,
      };
    }

    return {
      righeTotali: result.summary.totalRows,
      valide: result.summary.validRows,
      associate: result.summary.matchedEmployees,
      mancanti: result.summary.missingEmployees,
      visitaSi: result.summary.visitRequiredYes,
      visitaNo: result.summary.visitRequiredNo,
      scadenzaMancante: result.summary.dueDateMissing,
      errori: result.summary.errorRows,
    };
  }, [result]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/import-runs/last?source=sorveglianza", { method: "GET" });
        const body = await readJsonSafely<{ run: LastImportRun | null; error?: string }>(response);
        if (cancelled) return;
        if (!response.ok || extractResponseError(body)) return;
        setLastRun(body?.run ?? null);
      } catch {
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLastRun]);

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

      const response = await fetch("/api/sorveglianza_sanitaria/import", {
        method: "POST",
        body: formData,
      });

      const payload = await readJsonSafely<ImportResponse | { error: string }>(response);
      if (!response.ok || extractResponseError(payload)) {
        throw new Error(buildHttpErrorMessage(response, payload, "Errore in fase di import"));
      }

      setResult(payload as ImportResponse);
      if (runTokenRef.current === token && progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setProgress(100);
      if (mode === "commit") {
        await refreshLastRun();
      }
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Errore imprevisto durante l'import.");
      setProgress(0);
    } finally {
      if (runTokenRef.current === token && progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (runTokenRef.current === token) setIsLoading(false);
    }
  }

  async function undoLastImport() {
    setIsUndoing(true);
    setServerError("");
    setUndoMessage("");
    try {
      const response = await fetch("/api/sorveglianza_sanitaria/import/undo", { method: "POST" });
      const body = await readJsonSafely<
        { ok: true; deletedRows: number; restoredRows: number; skippedRows: number; source: string } | { error: string }
      >(response);
      if (!response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore annullamento import"));
      }
      setUndoMessage(
        `Annullamento completato (${(body as { source: string }).source}): ripristinate ${(body as { restoredRows: number }).restoredRows}, eliminate ${(body as { deletedRows: number }).deletedRows}, saltate ${(body as { skippedRows: number }).skippedRows}.`,
      );
      await refreshLastRun();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Errore annullamento import.");
    } finally {
      setIsUndoing(false);
    }
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Import sorveglianza sanitaria"
        description="Scarica il modello, compilalo e poi fai upload: anteprima e commit del tracciato sorveglianza (visita SI/NO, scadenza, limitazioni, note)."
      >
        {lastRun ? (
          <div className="mt-2 flex flex-col gap-2 text-xs text-slate-500">
            <p>
              Ultimo import: {formatDateTimeIt(lastRun.createdAt)}
              {lastRun.importedByName ? ` · ${lastRun.importedByName}` : ""} · {lastRun.fileName}
              {typeof lastRun.processedRows === "number" && typeof lastRun.totalRows === "number"
                ? ` · ${lastRun.processedRows}/${lastRun.totalRows}`
                : ""}
            </p>
            {typeof lastRun.errorRows === "number" && lastRun.errorRows > 0 ? (
              <div>
                <button
                  type="button"
                  data-unstyled="true"
                  disabled={isLoading || isUndoing || isDownloadingReport}
                  onClick={() => void downloadFrom(`/api/import-runs/errors?importRunId=${encodeURIComponent(lastRun.id)}`)}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Scarica report errori
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </ModuleHeader>

      <PanelCard>
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Caricamento file</h2>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <a
            href="/api/sorveglianza_sanitaria/import/template"
            className="inline-flex items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            Scarica modello
          </a>
          <Link
            href="/sorveglianza_sanitaria/import_pdf"
            className="inline-flex items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            Import PDF
          </Link>
          <button
            type="button"
            data-unstyled="true"
            disabled={isLoading || isUndoing}
            onClick={() => void undoLastImport()}
            className="inline-flex items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUndoing ? "Annullamento..." : "Annulla ultimo import"}
          </button>
          <input
            type="file"
            accept=".xls,.xlsx"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setSelectedFile(nextFile);
              setResult(null);
              setServerError("");
              setUndoMessage("");
            }}
            className="block w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-600"
          />
          <button
            type="button"
            disabled={!selectedFile || isLoading}
            onClick={() => runImport("preview")}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Elaborazione..." : "Anteprima"}
          </button>
          <button
            type="button"
            disabled={!selectedFile || isLoading}
            onClick={() => runImport("commit")}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
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
        {undoMessage ? (
          <p className="mt-2 text-xs font-medium text-[var(--brand-primary)]">{undoMessage}</p>
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
      </PanelCard>

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Righe totali" value={counters.righeTotali} />
        <StatCard label="Valide" value={counters.valide} />
        <StatCard label="Associate" value={counters.associate} />
        <StatCard label="Non trovate" value={counters.mancanti} />
        <StatCard label="Visita SI" value={counters.visitaSi} />
        <StatCard label="Visita NO" value={counters.visitaNo} />
        <StatCard label="Scadenza mancante" value={counters.scadenzaMancante} />
        <StatCard label="Errori" value={counters.errori} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
          <div className="border-b border-[var(--brand-line)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--brand-ink)]">
              Anteprima (prime 50 righe)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--brand-panel)] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Matricola</th>
                  <th className="px-4 py-3">Cognome</th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Visita</th>
                  <th className="px-4 py-3">Scadenza</th>
                </tr>
              </thead>
              <tbody>
                {result?.previewRows?.length ? (
                  result.previewRows.map((row, index) => (
                    <tr key={`${row.codiceFiscale}-${index}`} className="border-t border-[var(--brand-line)]">
                      <td className="px-4 py-3 text-slate-600">{row.matricola || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.cognome || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.nome || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.visitaRichiesta}</td>
                      <td className="px-4 py-3 text-slate-600">{row.scadenzaVisita}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                      Nessuna anteprima disponibile.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
          <div className="border-b border-[var(--brand-line)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--brand-ink)]">
              Report errori
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
                  <th className="px-4 py-3">Errore</th>
                </tr>
              </thead>
              <tbody>
                {result?.errors?.length ? (
                  result.errors.slice(0, 200).map((row, index) => (
                    <tr key={`${row.taxCode}-${index}`} className="border-t border-[var(--brand-line)]">
                      <td className="px-4 py-3 text-slate-600">{row.matricola || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.taxCode || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.lastName || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.firstName || "-"}</td>
                      <td className="px-4 py-3 font-medium text-red-600">{row.errorMessage}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                      Nessun errore rilevato.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {result?.errors?.length ? (
            <p className="border-t border-[var(--brand-line)] px-5 py-3 text-xs text-slate-500">
              Mostrate le prime 200 righe di errore.
            </p>
          ) : null}
        </article>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--brand-ink)]">
        {value}
      </p>
    </article>
  );
}
