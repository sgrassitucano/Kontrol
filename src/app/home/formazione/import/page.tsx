"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleHeader } from "@/components/module-ui";
import { FileUploadSection } from "@/components/import/FileUploadSection";
import { ImportSummary, type ImportSummaryData } from "@/components/import/ImportSummary";
import { PreviewTable } from "@/components/import/PreviewTable";
import { buildHttpErrorMessage, extractResponseError, readJsonSafely } from "@/lib/client/http";

type TrainingImportResponse = {
  mode: "preview" | "commit";
  summary: {
    totalRows: number;
    validRows: number;
    matchedEmployees: number;
    missingEmployees: number;
    missingCourses: number;
    missingStartDateRows: number;
    committedRows?: number;
    issueRows?: number;
    errorRows?: number;
  };
  previewRows: Array<{
    matricola: string;
    cognome: string;
    nome: string;
    corsoCode: string;
    corso: string;
    dataCompletamento?: string;
    dataScadenza?: string;
  }>;
  errors: Array<{
    matricola?: string;
    cognome?: string;
    nome?: string;
    message: string;
  }>;
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

export default function FormazioneImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [serverError, setServerError] = useState("");
  const [undoMessage, setUndoMessage] = useState("");
  const [result, setResult] = useState<TrainingImportResponse | null>(null);
  const [progress, setProgress] = useState(0);
  const [lastRun, setLastRun] = useState<LastImportRun | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);

  const refreshLastRun = useCallback(async () => {
    try {
      const response = await fetch("/api/import-runs/last?source=formazione_legacy");
      const body = await readJsonSafely<{ run: LastImportRun | null; error?: string }>(response);
      if (response.ok && !extractResponseError(body)) {
        setLastRun(body?.run ?? null);
      }
    } catch {
      // Silently fail on refresh
    }
  }, []);

  const counters = useMemo<ImportSummaryData>(() => {
    if (!result) {
      return {
        totalRows: 0,
        validRows: 0,
        matchedEmployees: 0,
        missingEmployees: 0,
        errorRows: 0,
      };
    }

    return {
      totalRows: result.summary.totalRows,
      validRows: result.summary.validRows,
      matchedEmployees: result.summary.matchedEmployees,
      missingEmployees: result.summary.missingEmployees,
      errorRows: (result.summary.missingCourses ?? 0) + (result.summary.missingStartDateRows ?? 0),
    };
  }, [result]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/import-runs/last?source=formazione_legacy");
        const body = await readJsonSafely<{ run: LastImportRun | null; error?: string }>(response);
        if (cancelled) return;
        if (response.ok && !extractResponseError(body)) {
          setLastRun(body?.run ?? null);
        }
      } catch {
        if (cancelled) return;
      }
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

      const response = await fetch("/api/formazione/import", {
        method: "POST",
        body: formData,
      });

      const payload = await readJsonSafely<TrainingImportResponse | { error: string }>(response);
      if (!response.ok || extractResponseError(payload)) {
        throw new Error(buildHttpErrorMessage(response, payload, "Errore in fase di import"));
      }

      setResult(payload as TrainingImportResponse);
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
      const response = await fetch("/api/formazione/import/undo", { method: "POST" });
      const body = await readJsonSafely<
        { ok: true; deletedRows: number; restoredRows: number; skippedRows: number; source: string } | { error: string }
      >(response);
      if (!response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore annullamento import"));
      }
      const data = body as { source: string; restoredRows: number; deletedRows: number; skippedRows: number };
      setUndoMessage(
        `Annullamento completato: ripristinate ${data.restoredRows}, eliminate ${data.deletedRows}, saltate ${data.skippedRows}.`,
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
        title="Import formazione"
        description="Carica l'elenco dei corsi frequentati: anteprima e commit del tracciato (matricola, corso, data completamento, scadenza)."
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
          </div>
        ) : null}
      </ModuleHeader>

      <FileUploadSection
        selectedFile={selectedFile}
        isLoading={isLoading}
        isUndoing={isUndoing}
        onFileSelect={(file) => {
          setSelectedFile(file);
          setResult(null);
          setServerError("");
          setUndoMessage("");
        }}
        onPreview={() => runImport("preview")}
        onCommit={() => runImport("commit")}
        onUndo={undoLastImport}
        onDownloadTemplate={() => {
          const a = document.createElement("a");
          a.href = "/api/formazione/import/template";
          a.click();
        }}
        templateLabel="Scarica modello"
        progress={progress}
        resultMessage={result?.message}
        serverError={serverError}
        undoMessage={undoMessage}
      />

      {result && <ImportSummary data={counters} variant="formazione" />}

      {result && (
        <section className="grid gap-4 lg:grid-cols-2">
          <PreviewTable
            title="Anteprima (prime 50 righe)"
            rows={result.previewRows}
            columns={[
              { key: "matricola", label: "Matricola" },
              { key: "cognome", label: "Cognome" },
              { key: "nome", label: "Nome" },
              { key: "corsoCode", label: "Corso" },
              { key: "dataCompletamento", label: "Completamento" },
              { key: "dataScadenza", label: "Scadenza" },
            ]}
            emptyMessage="Nessuna anteprima disponibile."
          />

          <PreviewTable
            title="Report errori"
            rows={result.errors}
            columns={[
              { key: "matricola", label: "Matricola" },
              { key: "cognome", label: "Cognome" },
              { key: "nome", label: "Nome" },
              { key: "message", label: "Errore" },
            ]}
            emptyMessage="Nessun errore rilevato."
          />
        </section>
      )}
    </div>
  );
}
