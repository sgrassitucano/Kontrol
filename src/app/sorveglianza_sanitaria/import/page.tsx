"use client";

import { useMemo, useState } from "react";
import type {
  SurveillanceImportErrorRow,
  SurveillanceImportPreviewRow,
  SurveillanceImportSummary,
} from "@/lib/import/sorveglianza";

type ImportResponse = {
  mode: "preview" | "commit";
  summary: SurveillanceImportSummary;
  previewRows: SurveillanceImportPreviewRow[];
  errors: SurveillanceImportErrorRow[];
  message: string;
};

export default function SorveglianzaImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [result, setResult] = useState<ImportResponse | null>(null);

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

  async function runImport(mode: "preview" | "commit") {
    if (!selectedFile) return;

    setIsLoading(true);
    setServerError("");

    try {
      const formData = new FormData();
      formData.append("mode", mode);
      formData.append("file", selectedFile);

      const response = await fetch("/api/sorveglianza_sanitaria/import", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as ImportResponse | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Errore in fase di import.");
      }

      setResult(payload);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Errore imprevisto durante l'import.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-white p-6">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--brand-ink)]">
          Import sorveglianza sanitaria
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          Upload, anteprima e commit del tracciato anagrafica_sorveglianza (visita SI/NO, scadenza, limitazioni, note).
        </p>
      </section>

      <section className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5">
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">
          Caricamento file
        </h2>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            type="file"
            accept=".xls,.xlsx"
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
      </section>

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
        <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-white">
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

        <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-white">
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
