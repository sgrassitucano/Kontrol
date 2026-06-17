"use client";

 import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildHttpErrorMessage, readJsonSafely } from "@/lib/client/http";
import type {
  DismissalGuardrail,
  DismissalPreviewRow,
  ImportErrorRow,
  ImportPreviewRow,
  ImportSummary,
} from "@/lib/import/anagrafica";
import { ModuleHeader, PanelCard } from "@/components/module-ui";

type ImportResponse = {
  mode: "preview" | "commit";
  summary: ImportSummary;
  previewRows: ImportPreviewRow[];
  dismissalPreviewRows: DismissalPreviewRow[];
  dismissalGuardrail: DismissalGuardrail;
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
  totalRows?: number;
  processedRows?: number;
  errorRows?: number;
};

function formatDateTimeIt(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("it-IT");
}

export default function GestioneImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [progress, setProgress] = useState(0);
  const [lastRun, setLastRun] = useState<LastImportRun | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);
  const statusPollRef = useRef<number | null>(null);
  const lastRunPollRef = useRef<number | null>(null);
  const [confirmHighDismissals, setConfirmHighDismissals] = useState(false);
  const [confirmCriticalDismissals, setConfirmCriticalDismissals] = useState(false);
  const [overrideBlockedDismissals, setOverrideBlockedDismissals] = useState(false);
  const [confirmDismissalPhrase, setConfirmDismissalPhrase] = useState("");

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

  const dismissRate = useMemo(() => {
    const totalActive = result?.summary.existingActiveEmployees ?? 0;
    if (!totalActive) return 0;
    return (result?.summary.dismissedRows ?? 0) / totalActive;
  }, [result]);

  const dismissalRisk = result?.summary.dismissalRisk ?? "none";
  const dismissalGuardrail = result?.dismissalGuardrail ?? null;
  const isHighDismissals =
    dismissalRisk === "warning" || dismissalRisk === "critical" || dismissalRisk === "blocked";
  const isCriticalDismissals = dismissalRisk === "critical" || dismissalRisk === "blocked";
  const isBlockedDismissals = dismissalRisk === "blocked";

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/import-runs/last?source=anagrafica", { method: "GET" });
      const body = await readJsonSafely<{ run: LastImportRun | null; error?: string }>(response);
      if (cancelled) return;
      if (!response.ok || body?.error) return;
      setLastRun(body?.run ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    lastRunPollRef.current = window.setInterval(() => {
      void refreshLastRun();
    }, 10000);
    return () => {
      if (lastRunPollRef.current !== null) {
        window.clearInterval(lastRunPollRef.current);
        lastRunPollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (statusPollRef.current !== null) {
        window.clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
      if (lastRunPollRef.current !== null) {
        window.clearInterval(lastRunPollRef.current);
        lastRunPollRef.current = null;
      }
    };
  }, []);

  async function refreshLastRun() {
    const response = await fetch("/api/import-runs/last?source=anagrafica", { method: "GET" });
    const body = await readJsonSafely<{ run: LastImportRun | null; error?: string }>(response);
    if (!response.ok || body?.error) return;
    setLastRun(body?.run ?? null);
  }

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
    if (statusPollRef.current !== null) {
      window.clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    statusPollRef.current = window.setInterval(() => {
      void refreshLastRun();
    }, 2000);
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
      if (mode === "commit") {
        formData.append("confirmHighDismissals", confirmHighDismissals ? "1" : "0");
        formData.append("confirmCriticalDismissals", confirmCriticalDismissals ? "1" : "0");
        formData.append("overrideBlockedDismissals", overrideBlockedDismissals ? "1" : "0");
        formData.append("confirmDismissalPhrase", confirmDismissalPhrase);
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 180000);

      const response = await fetch("/api/gestione/import", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      const payload = await readJsonSafely<ImportResponse | { error: string }>(response);
      if (!response.ok || !payload || "error" in payload) {
        throw new Error(
          payload && "error" in payload
            ? payload.error
            : buildHttpErrorMessage(response, payload, "Errore in fase di import."),
        );
      }

      setResult(payload);
      window.clearTimeout(timeoutId);
      if (runTokenRef.current === token && progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setProgress(100);
      if (mode === "commit") {
        await refreshLastRun();
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      setServerError(
        isAbort
          ? "Richiesta lunga: l'import potrebbe essere ancora in corso. Controlla 'Ultimo import'."
          : error instanceof Error
            ? error.message
            : "Errore imprevisto durante l'import.",
      );
      setProgress(0);
    } finally {
      if (runTokenRef.current === token && progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (runTokenRef.current === token && statusPollRef.current !== null) {
        window.clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
      if (runTokenRef.current === token) setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Import anagrafica"
        description="Flusso admin per upload, anteprima, validazione e commit dei dati."
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
                  disabled={isLoading || isDownloadingReport}
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
          <input
            type="file"
            accept=".csv,.xls,.xlsx"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setSelectedFile(nextFile);
              setResult(null);
              setServerError("");
              setConfirmHighDismissals(false);
              setConfirmCriticalDismissals(false);
              setOverrideBlockedDismissals(false);
              setConfirmDismissalPhrase("");
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
            disabled={
              !selectedFile ||
              isLoading ||
              !result ||
              result.mode !== "preview" ||
              derivedCounts.blockingRows > 0 ||
              (isHighDismissals && !confirmHighDismissals) ||
              (isCriticalDismissals && !confirmCriticalDismissals) ||
              (isBlockedDismissals && !overrideBlockedDismissals) ||
              (Boolean(dismissalGuardrail?.requiresPhraseConfirmation) &&
                confirmDismissalPhrase.trim().toUpperCase() !==
                  String(dismissalGuardrail?.confirmationPhrase ?? "").trim().toUpperCase())
            }
            title={
              !result || result.mode !== "preview"
                ? "Esegui prima l'anteprima."
                : derivedCounts.blockingRows > 0
                  ? "Risolvi prima gli errori bloccanti."
                  : isBlockedDismissals && !overrideBlockedDismissals
                    ? "Caso bloccato: serve sblocco esplicito."
                  : isCriticalDismissals && !confirmCriticalDismissals
                    ? "Caso critico: serve doppia conferma."
                  : Boolean(dismissalGuardrail?.requiresPhraseConfirmation) &&
                      confirmDismissalPhrase.trim().toUpperCase() !==
                        String(dismissalGuardrail?.confirmationPhrase ?? "").trim().toUpperCase()
                    ? "Digita la frase di conferma richiesta."
                  : isHighDismissals && !confirmHighDismissals
                    ? "Dimessi > 5%: conferma richiesta."
                    : "Esegui commit import."
            }
            onClick={() => runImport("commit")}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Conferma import
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          File selezionato: {selectedFile?.name || "nessuno"}
        </p>
        {result && isHighDismissals ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            {dismissalGuardrail?.reasons?.length ? (
              <div className="mb-3 space-y-1 text-xs text-amber-900">
                {dismissalGuardrail.reasons.map((reason, index) => (
                  <p key={`${reason}-${index}`}>• {reason}</p>
                ))}
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-xs text-amber-800">
              <input
                type="checkbox"
                checked={confirmHighDismissals}
                onChange={(e) => setConfirmHighDismissals(e.target.checked)}
                className="mt-[2px]"
              />
              <span>
                Dimessi stimati: {result.summary.dismissedRows} su {result.summary.existingActiveEmployees} attivi
                ({Math.round(dismissRate * 1000) / 10}%). Snapshot CF validi: {result.summary.snapshotTaxCodes}.
                {dismissalGuardrail?.previousSnapshotTaxCodes
                  ? ` Ultimo import: ${dismissalGuardrail.previousSnapshotTaxCodes} CF.`
                  : ""}
                {dismissalGuardrail?.averageSnapshotTaxCodes
                  ? ` Media ultimi ${dismissalGuardrail.recentRunCount}: ${dismissalGuardrail.averageSnapshotTaxCodes} CF.`
                  : ""}
                Confermo di voler procedere comunque.
              </span>
            </label>
            {isCriticalDismissals ? (
              <>
                <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-red-700">
                  <input
                    type="checkbox"
                    checked={confirmCriticalDismissals}
                    onChange={(e) => setConfirmCriticalDismissals(e.target.checked)}
                    className="mt-[2px]"
                  />
                  <span>
                    Caso critico: confermo esplicitamente che il file e&apos; completo e che le dimissioni massive sono volute.
                  </span>
                </label>
                {isBlockedDismissals ? (
                  <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-red-800">
                    <input
                      type="checkbox"
                      checked={overrideBlockedDismissals}
                      onChange={(e) => setOverrideBlockedDismissals(e.target.checked)}
                      className="mt-[2px]"
                    />
                    <span>
                      Sblocco il blocco protettivo: riconosco che il file e&apos; fortemente anomalo rispetto allo storico e voglio procedere lo stesso.
                    </span>
                  </label>
                ) : null}
                {dismissalGuardrail?.requiresPhraseConfirmation && dismissalGuardrail.confirmationPhrase ? (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-red-800">
                      Digita esattamente: <span className="font-mono">{dismissalGuardrail.confirmationPhrase}</span>
                    </p>
                    <input
                      type="text"
                      value={confirmDismissalPhrase}
                      onChange={(e) => setConfirmDismissalPhrase(e.target.value)}
                      className="mt-2 block w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-slate-700"
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
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
      </PanelCard>

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

      {result?.dismissalPreviewRows?.length ? (
        <section>
          <article className="overflow-hidden rounded-[20px] border border-amber-200 bg-amber-50">
            <div className="border-b border-amber-200 px-5 py-4">
              <h2 className="text-base font-semibold text-amber-900">
                Anteprima dimessi previsti
              </h2>
              <p className="mt-1 text-xs text-amber-800">
                Mostro i primi {result.dismissalPreviewRows.length} lavoratori che verrebbero marcati come dimessi per assenza nel file importato.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-amber-100/70 text-xs uppercase tracking-wide text-amber-900">
                  <tr>
                    <th className="px-4 py-3">Matricola</th>
                    <th className="px-4 py-3">CF</th>
                    <th className="px-4 py-3">Cognome</th>
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">Ultimo import</th>
                  </tr>
                </thead>
                <tbody>
                  {result.dismissalPreviewRows.map((row) => (
                    <tr key={`${row.codiceFiscale}-${row.matricola}`} className="border-t border-amber-200/80 bg-white/70">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.matricola}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.codiceFiscale}</td>
                      <td className="px-4 py-3 text-slate-700">{row.cognome}</td>
                      <td className="px-4 py-3 text-slate-700">{row.nome}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {row.lastImportedAt ? formatDateTimeIt(row.lastImportedAt) : "n.d."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      <section>
        <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
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
