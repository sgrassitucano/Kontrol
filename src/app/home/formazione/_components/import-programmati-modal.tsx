"use client";

import { useCallback, useState } from "react";

type ResolvedRow = {
  sheet: string;
  rowNumber: number;
  matricola: string;
  employeeName: string;
  employeeId: number | null;
  targetCourseCodes: string[];
  plannedDateIso: string | null;
  warnings: string[];
};

type PreviewResponse = {
  totalRows: number;
  validRows: number;
  rows: ResolvedRow[];
  message?: string;
  error?: string;
};

type CommitResponse = {
  applied: number;
  skipped: number;
  rows: ResolvedRow[];
  error?: string;
};

/**
 * Import massivo round-trip: riusa lo stesso file dell'export formazione.
 * L'utente marca stato="programmato" + "data prevista" su alcune righe e ricarica.
 */
export function ImportProgrammatiModal({
  isOpen,
  onClose,
  onCommitted,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [committed, setCommitted] = useState<CommitResponse | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setPreview(null);
    setError("");
    setCommitted(null);
  }, []);

  const runPreview = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setPreview(null);
    setCommitted(null);
    try {
      const formData = new FormData();
      formData.append("mode", "preview");
      formData.append("file", file);
      const response = await fetch("/api/formazione/pianificazione/import", { method: "POST", body: formData });
      const body = (await response.json()) as PreviewResponse;
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore preview import.");
      setPreview(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore preview import.");
    } finally {
      setLoading(false);
    }
  }, [file]);

  const runCommit = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("mode", "commit");
      formData.append("file", file);
      const response = await fetch("/api/formazione/pianificazione/import", { method: "POST", body: formData });
      const body = (await response.json()) as CommitResponse;
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore conferma import.");
      setCommitted(body);
      onCommitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore conferma import.");
    } finally {
      setLoading(false);
    }
  }, [file, onCommitted]);

  if (!isOpen) return null;

  const invalidRows = preview?.rows.filter((r) => r.warnings.length > 0) ?? [];
  const validRows = preview?.rows.filter((r) => r.warnings.length === 0) ?? [];

  return (
    <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--brand-line)] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--brand-ink)]">Importa programmati (round-trip export)</h2>
            <p className="mt-1 text-xs text-slate-500">
              Riusa il file scaricato con "Export": marca stato="programmato" e compila "data prevista" sulle righe
              da pianificare, poi ricarica qui lo stesso file.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".xlsx"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setCommitted(null);
                setError("");
              }}
              className="text-sm"
            />
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={!file || loading}
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
            >
              {loading && !preview ? "Verifica…" : "Verifica file"}
            </button>
          </div>

          {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}

          {preview && preview.totalRows === 0 ? (
            <p className="text-sm text-slate-600">{preview.message ?? "Nessuna riga da importare trovata."}</p>
          ) : null}

          {preview && preview.totalRows > 0 && !committed ? (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="font-semibold text-emerald-600">{validRows.length} valide</span>
                <span className="font-semibold text-red-600">{invalidRows.length} con problemi</span>
              </div>

              <div className="max-h-64 overflow-auto rounded-xl border border-[var(--brand-line)]">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[var(--brand-panel)] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Foglio</th>
                      <th className="px-3 py-2">Matricola</th>
                      <th className="px-3 py-2">Lavoratore</th>
                      <th className="px-3 py-2">Corso/i target</th>
                      <th className="px-3 py-2">Data prevista</th>
                      <th className="px-3 py-2">Avvisi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr
                        key={`${row.sheet}-${row.rowNumber}`}
                        className={row.warnings.length > 0 ? "bg-red-50" : "border-t border-[var(--brand-line)]"}
                      >
                        <td className="px-3 py-1.5">{row.sheet}</td>
                        <td className="px-3 py-1.5">{row.matricola}</td>
                        <td className="px-3 py-1.5">{row.employeeName}</td>
                        <td className="px-3 py-1.5">{row.targetCourseCodes.join(", ") || "-"}</td>
                        <td className="px-3 py-1.5">{row.plannedDateIso ?? "-"}</td>
                        <td className="px-3 py-1.5 text-red-600">{row.warnings.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => void runCommit()}
                disabled={loading || validRows.length === 0}
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
                title={validRows.length === 0 ? "Nessuna riga valida da applicare" : "Applica le righe valide"}
              >
                {loading ? "Applico…" : `Conferma import (${validRows.length} righe)`}
              </button>
            </div>
          ) : null}

          {committed ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Import completato: <strong>{committed.applied}</strong> corsi programmati,{" "}
              <strong>{committed.skipped}</strong> saltati (avvisi o corso non risolto).
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--brand-line)] px-5 py-4">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            Chiudi
          </button>
        </div>
      </div>
    </section>
  );
}
