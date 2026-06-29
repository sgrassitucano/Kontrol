"use client";

import { useState } from "react";
import { buildHttpErrorMessage, readJsonSafely } from "@/lib/client/http";
import { ModuleHeader, PanelCard } from "@/components/module-ui";
import { Download, Upload, AlertTriangle, ShieldCheck, Database, Loader2 } from "lucide-react";

export default function GestioneBackupPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  // Scarica il file di backup JSON
  async function handleDownloadBackup() {
    setIsLoading(true);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const response = await fetch("/api/gestione/backup", { method: "GET" });
      if (!response.ok) {
        const body = await readJsonSafely<{ error?: string }>(response);
        throw new Error(buildHttpErrorMessage(response, body, "Errore generazione backup"));
      }

      // Estrai il nome del file dall'header Content-Disposition
      const disp = response.headers.get("content-disposition") ?? "";
      const match = disp.match(/filename=\"([^\"]+)\"/i);
      const filename = match?.[1] ?? `backup_kontrol_${new Date().toISOString().split("T")[0]}.json`;

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);

      setSuccessMessage("Backup creato ed esportato correttamente.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Errore generazione backup.");
    } finally {
      setIsLoading(false);
    }
  }

  // Seleziona il file da caricare per il ripristino
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setSuccessMessage("");
    setErrorMessage("");
    setConfirmRestore(false);
  }

  // Esegue il ripristino del database a partire dal JSON caricato
  async function handleRestoreBackup() {
    if (!selectedFile) return;
    setIsLoading(true);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const fileText = await selectedFile.text();
      let backupPayload;
      try {
        backupPayload = JSON.parse(fileText);
      } catch {
        throw new Error("Il file caricato non è un file JSON valido.");
      }

      const response = await fetch("/api/gestione/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backupPayload),
      });

      const body = await readJsonSafely<{ ok?: boolean; message?: string; error?: string }>(response);
      if (!response.ok || !body || !body.ok) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore durante il ripristino"));
      }

      setSuccessMessage("Database ripristinato con successo allo stato del backup.");
      setSelectedFile(null);
      setConfirmRestore(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Errore durante il ripristino.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Backup e Ripristino"
        description="Strumenti di salvataggio preventivo e recupero dei dati dell'intera applicazione."
      />

      {successMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Card Creazione Backup */}
        <PanelCard className="flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--brand-ink)]">Esporta Backup Database</h3>
                <p className="text-xs text-slate-500 mt-0.5">Scarica lo stato corrente in formato JSON.</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">
              Crea un file di ripristino contenente tutte le tabelle operative (lavoratori, turni, scadenze, formazione, DPI, mezzi). Consigliato prima di effettuare caricamenti massivi di nuovi file Excel.
            </p>
          </div>

          <div className="mt-6">
            <button
              type="button"
              disabled={isLoading}
              onClick={handleDownloadBackup}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Esegui Backup Ora
            </button>
          </div>
        </PanelCard>

        {/* Card Ripristino Backup */}
        <PanelCard className="flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--brand-ink)]">Ripristina Stato Precedente</h3>
                <p className="text-xs text-slate-500 mt-0.5">Carica un file JSON di backup precedentemente scaricato.</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">
              Il ripristino svuota e sovrascrive tutte le tabelle operative del gestionale. Le credenziali e gli account degli utenti amministratori non verranno cancellati.
            </p>

            <div className="mt-3">
              <input
                type="file"
                accept=".json"
                id="backup-file-input"
                onChange={handleFileChange}
                disabled={isLoading}
                className="hidden"
              />
              <label
                htmlFor="backup-file-input"
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-slate-50"
              >
                <Upload className="h-4 w-4 text-slate-500" />
                {selectedFile ? selectedFile.name : "Seleziona file backup..."}
              </label>
            </div>

            {selectedFile ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800 leading-normal">
                    Sei sicuro di voler sovrascrivere il database? Questa operazione eliminerà definitivamente tutte le modifiche inserite dopo la data di creazione di questo backup.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="checkbox-confirm-restore"
                    checked={confirmRestore}
                    onChange={(e) => setConfirmRestore(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[var(--brand-primary)]"
                  />
                  <label htmlFor="checkbox-confirm-restore" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                    Confermo di voler ripristinare il database
                  </label>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-6">
            <button
              type="button"
              disabled={isLoading || !selectedFile || !confirmRestore}
              onClick={handleRestoreBackup}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              Ripristina Database Ora
            </button>
          </div>
        </PanelCard>
      </div>

      <section className="rounded-[20px] border border-[var(--brand-line)] bg-white p-5">
        <h3 className="text-sm font-bold text-[var(--brand-ink)]">Note Importanti sulla Sicurezza</h3>
        <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-500">
          <li>
            <strong>Prevenzione del blocco account</strong>: Il ripristino non tocca gli account degli utenti registrati in Supabase Auth né cancella le righe della tabella <code>profiles</code> relative agli utenti attivi, per evitare che gli amministratori restino bloccati fuori dal sistema.
          </li>
          <li>
            <strong>Transazioni Atomiche</strong>: L'intero processo di ripristino avviene all'interno di una singola transazione del database. In caso di errore a metà caricamento (es. file corrotto o campi errati), viene eseguito un <em>Rollback</em> automatico e nessun dato viene modificato o perso.
          </li>
          <li>
            <strong>Frequenza consigliata</strong>: Si raccomanda di scaricare un backup ogni volta che si prevede di importare nuovi tracciati da file Excel, per avere un punto di ripristino rapido in caso di errori formali nei dati importati.
          </li>
        </ul>
      </section>
    </div>
  );
}
