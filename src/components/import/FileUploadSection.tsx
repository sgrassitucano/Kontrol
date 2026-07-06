import { PanelCard } from "@/components/module-ui";

type FileUploadSectionProps = {
  selectedFile: File | null;
  isLoading: boolean;
  isUndoing: boolean;
  onFileSelect: (file: File | null) => void;
  onPreview: () => void;
  onCommit: () => void;
  onUndo: () => void;
  onDownloadTemplate: () => void;
  templateLabel?: string;
  extraActions?: React.ReactNode;
  progress: number;
  resultMessage?: string;
  serverError?: string;
  undoMessage?: string;
};

export function FileUploadSection({
  selectedFile,
  isLoading,
  isUndoing,
  onFileSelect,
  onPreview,
  onCommit,
  onUndo,
  onDownloadTemplate,
  templateLabel = "Scarica modello",
  extraActions,
  progress,
  resultMessage,
  serverError,
  undoMessage,
}: FileUploadSectionProps) {
  return (
    <PanelCard>
      <h2 className="text-base font-semibold text-[var(--brand-ink)]">Caricamento file</h2>
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:flex-wrap">
        <button
          type="button"
          onClick={onDownloadTemplate}
          className="inline-flex items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          {templateLabel}
        </button>

        {extraActions}

        <button
          type="button"
          disabled={isLoading || isUndoing}
          onClick={onUndo}
          className="inline-flex items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUndoing ? "Annullamento..." : "Annulla ultimo import"}
        </button>

        <input
          type="file"
          accept=".xls,.xlsx"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            onFileSelect(file);
          }}
          className="block flex-1 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-600"
        />

        <button
          type="button"
          disabled={!selectedFile || isLoading}
          onClick={onPreview}
          className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Elaborazione..." : "Anteprima"}
        </button>

        <button
          type="button"
          disabled={!selectedFile || isLoading}
          onClick={onCommit}
          className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Conferma import
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        File selezionato: {selectedFile?.name || "nessuno"}
      </p>

      {resultMessage && <p className="mt-2 text-xs font-medium text-[var(--brand-primary)]">{resultMessage}</p>}
      {serverError && <p className="mt-2 text-xs font-medium text-red-600">{serverError}</p>}
      {undoMessage && <p className="mt-2 text-xs font-medium text-[var(--brand-primary)]">{undoMessage}</p>}

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
  );
}
