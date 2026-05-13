"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ModuleHeader, PanelCard } from "@/components/module-ui";

type PdfImportPreviewRow = {
  page: number;
  employeeId: number | null;
  taxCode: string;
  lastName: string;
  firstName: string;
  nextDueDate: string | null;
  limitations: string;
  dueDateCandidates: string[];
  status: "ok" | "dubbio" | "errore";
  issues: string[];
};

type PdfImportErrorRow = {
  page: number;
  taxCode: string;
  errorType: string;
  errorMessage: string;
};

type PdfImportSummary = {
  totalPages: number;
  parsedPages: number;
  matchedEmployees: number;
  missingEmployees: number;
  updatedRecords: number;
  dueDateFound: number;
  limitationsFound: number;
  errors: number;
};

type ImportResponse = {
  mode: "preview" | "commit";
  summary: PdfImportSummary;
  previewRows: PdfImportPreviewRow[];
  errors: PdfImportErrorRow[];
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

const MAX_PDF_UPLOAD_BYTES = 6_000_000;
const MAX_PDF_DIRECT_UPLOAD_BYTES = 3_500_000;
const MAX_PDF_PAGES = 250;

function cleanSpaces(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTaxCode(value: string) {
  return cleanSpaces(value).toUpperCase().replace(/\s+/g, "");
}

function parseItDateToIso(value: string) {
  const raw = cleanSpaces(value);
  const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return null;
  const dd = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  let yyyy = Number(m[3]);
  if (yyyy < 100) yyyy = 2000 + yyyy;
  if (yyyy < 1900 || yyyy > 2200) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function extractTaxCode(text: string) {
  const normalized = text.toUpperCase().replace(/\s+/g, " ");
  const match = normalized.match(/\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/);
  return match ? normalizeTaxCode(match[0]) : "";
}

function extractNextDueDate(text: string) {
  const lines = text.split(/\r?\n/).map((l) => cleanSpaces(l)).filter(Boolean);
  const joined = lines.join(" ");
  const primaryMatch = joined.match(
    /(?:prossim\w*\s+visita|scaden\w*\s+visita|entro\s+il)\s*(?:il\s*)?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i,
  );
  if (primaryMatch?.[1]) {
    const iso = parseItDateToIso(primaryMatch[1]);
    if (iso) return { iso, candidates: [primaryMatch[1]], chosenRaw: primaryMatch[1] };
  }

  const includeWords = ["visita", "prossim", "scaden", "entro il", "idone"];
  const excludeWords = [
    "nasc",
    "nato",
    "nata",
    "nato il",
    "nata il",
    "data nasc",
    "emission",
    "rilasc",
    "stamp",
    "protocol",
    "referto",
  ];

  const dateRegex = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g;
  const allMatches: Array<{ raw: string; index: number }> = [];
  for (let m = dateRegex.exec(joined); m; m = dateRegex.exec(joined)) {
    allMatches.push({ raw: m[0], index: m.index });
  }

  const uniqueAll = Array.from(new Set(allMatches.map((m) => m.raw)));
  const byRawFirstIndex = new Map<string, number>();
  allMatches.forEach((m) => {
    if (!byRawFirstIndex.has(m.raw)) byRawFirstIndex.set(m.raw, m.index);
  });

  const scored = uniqueAll
    .map((raw) => {
      const iso = parseItDateToIso(raw);
      if (!iso) return null;
      const year = Number(String(iso).slice(0, 4));
      const idx = byRawFirstIndex.get(raw) ?? -1;
      const start = Math.max(0, idx - 40);
      const end = Math.min(joined.length, idx + raw.length + 40);
      const ctx = joined.slice(start, end).toLowerCase();

      let score = 0;
      if (excludeWords.some((w) => ctx.includes(w))) score -= 200;
      if (includeWords.some((w) => ctx.includes(w))) score += 40;
      if (ctx.includes("visita") && (ctx.includes("scaden") || ctx.includes("prossim") || ctx.includes("entro"))) score += 80;
      if (year < 2000) score -= 120;
      if (year < 1900 || year > 2200) score -= 500;

      return { raw, iso, score };
    })
    .filter(Boolean) as Array<{ raw: string; iso: string; score: number }>;

  const filteredCandidates = scored.filter((s) => s.score > -100).map((s) => s.raw);
  const candidates = filteredCandidates.length > 0 ? filteredCandidates : uniqueAll;

  const scoredCandidates = scored.filter((s) => candidates.includes(s.raw));
  if (scoredCandidates.length === 0) return { iso: null, candidates, chosenRaw: null };

  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.iso).localeCompare(String(a.iso));
  });
  const chosen = scoredCandidates[0];
  return { iso: (chosen?.iso ?? null) as string | null, candidates, chosenRaw: chosen?.raw ?? null };
}

function extractLimitationsText(text: string) {
  const lines = text.split(/\r?\n/).map((l) => cleanSpaces(l)).filter(Boolean);
  const lower = lines.map((l) => l.toLowerCase());
  const hasWithLimitations = lower.some((l) => l.includes("idoneo con limitazioni") || l.includes("idoneo con limitazione"));
  if (!hasWithLimitations) return { text: "", found: false };

  let start = -1;
  for (let i = 0; i < lower.length; i += 1) {
    if (lower[i]?.includes("con le seguenti limitazioni")) {
      start = i + 1;
      break;
    }
  }

  if (start < 0) {
    for (let i = 0; i < lower.length; i += 1) {
      if (lower[i]?.includes("limitazione")) {
        start = i + 1;
        break;
      }
    }
  }

  const stopWords = ["avverso", "medico competente", "trasmissione", "datore di lavoro", "art.", "art "];
  const items: string[] = [];
  if (start >= 0) {
    for (let i = start; i < lines.length; i += 1) {
      const l = lines[i] ?? "";
      const low = lower[i] ?? "";
      if (!l) continue;
      if (stopWords.some((w) => low.includes(w))) break;
      if (low.includes("limitazione") && low.includes("data scadenza")) continue;
      if (l.length <= 2) continue;
      items.push(l);
    }
  }

  const cleaned = items
    .map((l) => l.replace(/^\-+\s*/, "").trim())
    .filter(Boolean);

  const body = cleaned.length ? cleaned.map((l) => `- ${l}`).join("\n") : "";
  const out = body ? `IDONEO CON LIMITAZIONI\n${body}` : "IDONEO CON LIMITAZIONI";
  return { text: out, found: true };
}

async function extractPdfParsedClient(file: File, onProgress: (done: number, total: number) => void) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true } as never);
  const pdf = await loadingTask.promise;
  const totalPages = Number((pdf as { numPages?: number }).numPages ?? 0);
  if (!Number.isFinite(totalPages) || totalPages <= 0) {
    throw new Error("PDF non valido o non leggibile.");
  }
  if (totalPages > MAX_PDF_PAGES) {
    throw new Error(`PDF troppo grande: ${totalPages} pagine (max ${MAX_PDF_PAGES}). Dividi il file e riprova.`);
  }
  const out: Array<{
    page: number;
    taxCode: string;
    nextDueDate: string | null;
    dueDateCandidates: string[];
    limitations: string;
    limitationsFound: boolean;
  }> = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    onProgress(pageNumber - 1, totalPages);
    const page = await (pdf as { getPage: (n: number) => Promise<unknown> }).getPage(pageNumber);
    const content = await (page as { getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }).getTextContent();
    const parts = (content.items ?? []).map((i) => String(i.str ?? "")).filter(Boolean);
    const text = parts.join("\n");
    const taxCode = extractTaxCode(text);
    const due = extractNextDueDate(text);
    const lim = extractLimitationsText(text);
    out.push({
      page: pageNumber,
      taxCode,
      nextDueDate: due.iso,
      dueDateCandidates: due.candidates,
      limitations: lim.text,
      limitationsFound: lim.found,
    });
    onProgress(pageNumber, totalPages);
  }
  return out;
}

function formatDateTimeIt(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("it-IT");
}

function isoToItDate(value: string) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

type EditableRow = {
  page: number;
  employeeId: number | null;
  taxCode: string;
  lastName: string;
  firstName: string;
  status: "ok" | "dubbio" | "errore";
  issues: string[];
  dueDateCandidates: string[];
  applyRow: boolean;
  applyDueDate: boolean;
  applyLimitations: boolean;
  nextDueDateIt: string;
  limitations: string;
};

async function readJsonOrThrow(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const looksJson = contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[");
  if (looksJson) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Risposta non valida dal server (${response.status}).`);
    }
  }

  if (response.status === 413 || text.toLowerCase().includes("request entity too large")) {
    throw new Error("Richiesta troppo grande per l'import. Dividi il PDF in più file (o riduci le pagine) e riprova.");
  }

  const snippet = text.trim().slice(0, 180);
  throw new Error(`Errore server (${response.status}): ${snippet || "risposta non valida"}`);
}

export default function SorveglianzaPdfImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [lastRun, setLastRun] = useState<LastImportRun | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);

  const counters = useMemo(() => {
    if (!result) {
      return {
        pagineTotali: 0,
        associate: 0,
        mancanti: 0,
        aggiornate: 0,
        scadenzaTrovata: 0,
        limitazioniTrovate: 0,
        errori: 0,
        dubbi: 0,
        pagineErrore: 0,
      };
    }

    const dubbi = rows.filter((r) => r.status === "dubbio").length;
    const pagineErrore = rows.filter((r) => r.status === "errore").length;

    return {
      pagineTotali: result.summary.totalPages,
      associate: result.summary.matchedEmployees,
      mancanti: result.summary.missingEmployees,
      aggiornate: result.summary.updatedRecords,
      scadenzaTrovata: result.summary.dueDateFound,
      limitazioniTrovate: result.summary.limitationsFound,
      errori: result.summary.errors,
      dubbi,
      pagineErrore,
    };
  }, [result, rows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/import-runs/last?source=sorveglianza_pdf", { method: "GET" });
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

  function resetRunState() {
    setResult(null);
    setRows([]);
    setServerError("");
    setProgress(0);
  }

  async function runPreview() {
    if (!selectedFile) return;
    if (selectedFile.size > MAX_PDF_UPLOAD_BYTES) {
      setServerError("PDF troppo grande per l'import diretto. Dividi il file in più PDF (max ~6MB) e riprova.");
      return;
    }

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
        const step = value < 60 ? 3 : value < 85 ? 2 : 1;
        return Math.min(99, value + step);
      });
    }, 350);

    try {
      const shouldUseClientParse = selectedFile.size > MAX_PDF_DIRECT_UPLOAD_BYTES;

      let response: Response | null = null;
      if (!shouldUseClientParse) {
        const formData = new FormData();
        formData.append("mode", "preview");
        formData.append("file", selectedFile);
        response = await fetch("/api/sorveglianza_sanitaria/import-pdf", { method: "POST", body: formData });
      }

      if (!response || response.status === 413) {
        if (progressTimerRef.current !== null) {
          window.clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        setProgress(0);
        const parsed = await extractPdfParsedClient(selectedFile, (done, total) => {
          if (runTokenRef.current !== token) return;
          const pct = total ? Math.min(95, Math.round((done / total) * 95)) : 0;
          setProgress(pct);
        });

        response = await fetch("/api/sorveglianza_sanitaria/import-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "preview", fileName: selectedFile.name, parsed }),
        });
      }

      const payload = (await readJsonOrThrow(response)) as ImportResponse | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Errore in fase di import.");

      setResult(payload);
      const nextRows: EditableRow[] = (payload.previewRows ?? []).map((r) => {
        const dueIt = r.nextDueDate ? isoToItDate(r.nextDueDate) : "";
        const lim = String(r.limitations ?? "");
        const applyRow = r.status !== "errore" && Boolean(r.employeeId) && (Boolean(r.nextDueDate) || lim.trim().length > 0);
        return {
          page: r.page,
          employeeId: r.employeeId,
          taxCode: r.taxCode,
          lastName: r.lastName,
          firstName: r.firstName,
          status: r.status,
          issues: r.issues ?? [],
          dueDateCandidates: r.dueDateCandidates ?? [],
          applyRow,
          applyDueDate: Boolean(r.nextDueDate),
          applyLimitations: lim.trim().length > 0,
          nextDueDateIt: dueIt,
          limitations: lim,
        };
      });
      setRows(nextRows);
      if (runTokenRef.current === token && progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setProgress(100);
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

  async function runCommit() {
    if (!selectedFile) return;
    if (!result) {
      setServerError("Esegui prima l'anteprima.");
      return;
    }

    const selected = rows.filter((r) => r.applyRow);
    if (selected.length === 0) {
      setServerError("Nessuna riga selezionata per l'import.");
      return;
    }

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
        const step = value < 60 ? 3 : value < 85 ? 2 : 1;
        return Math.min(99, value + step);
      });
    }, 350);

    try {
      const updates = selected.map((r) => ({
        page: r.page,
        taxCode: r.taxCode,
        nextDueDate: r.nextDueDateIt || null,
        limitations: r.limitations,
        applyDueDate: r.applyDueDate,
        applyLimitations: r.applyLimitations,
      }));

      const formData = new FormData();
      formData.append("mode", "commit");
      formData.append("fileName", selectedFile.name);
      formData.append("updates", JSON.stringify(updates));

      const response = await fetch("/api/sorveglianza_sanitaria/import-pdf", {
        method: "POST",
        body: formData,
      });
      const payload = (await readJsonOrThrow(response)) as ImportResponse | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Errore in fase di import.");

      setResult(payload);
      if (runTokenRef.current === token && progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setProgress(100);

      const last = await fetch("/api/import-runs/last?source=sorveglianza_pdf", { method: "GET" });
      const body = (await last.json()) as { run: LastImportRun | null; error?: string };
      if (last.ok && !body.error) setLastRun(body.run);
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

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Import PDF idoneità"
        description="Carica un PDF multi-pagina: una pagina = un certificato. Estrae CF, scadenza prossima visita e limitazioni."
      >
        {lastRun ? (
          <p className="mt-2 text-xs text-slate-500">
            Ultimo import: {formatDateTimeIt(lastRun.createdAt)}
            {lastRun.importedByName ? ` · ${lastRun.importedByName}` : ""} · {lastRun.fileName}
          </p>
        ) : null}
      </ModuleHeader>

      <PanelCard>
        <h2 className="text-base font-semibold text-[var(--brand-ink)]">Caricamento file</h2>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            type="file"
            accept=".pdf"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setSelectedFile(nextFile);
              resetRunState();
              if (nextFile && nextFile.size > MAX_PDF_UPLOAD_BYTES) {
                setServerError("PDF troppo grande per l'import diretto. Dividi il file in più PDF (max ~6MB) e riprova.");
              }
            }}
            className="block w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-600"
          />
          <button
            type="button"
            disabled={!selectedFile || isLoading}
            onClick={() => runPreview()}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Elaborazione..." : "Anteprima"}
          </button>
          <button
            type="button"
            disabled={!selectedFile || isLoading || !result}
            onClick={() => runCommit()}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Conferma import
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">File selezionato: {selectedFile?.name || "nessuno"}</p>
        {result ? (
          <p className="mt-2 text-xs font-medium text-[var(--brand-primary)]">{result.message}</p>
        ) : null}
        {serverError ? <p className="mt-2 text-xs font-medium text-red-600">{serverError}</p> : null}
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

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Pagine totali" value={counters.pagineTotali} />
        <StatCard label="Associate" value={counters.associate} />
        <StatCard label="Non trovate" value={counters.mancanti} />
        <StatCard label="Aggiornate" value={counters.aggiornate} />
        <StatCard label="Scadenza trovata" value={counters.scadenzaTrovata} />
        <StatCard label="Limitazioni trovate" value={counters.limitazioniTrovate} />
        <StatCard label="Errori" value={counters.errori} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
          <div className="border-b border-[var(--brand-line)] px-5 py-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-base font-semibold text-[var(--brand-ink)]">Analisi e correzione</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!rows.length || isLoading}
                  onClick={() => {
                    setRows((prev) =>
                      prev.map((r) => ({
                        ...r,
                        applyRow: r.status !== "errore" && Boolean(r.employeeId) && (r.applyDueDate || r.applyLimitations),
                      })),
                    );
                  }}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Seleziona aggiornabili
                </button>
                <button
                  type="button"
                  disabled={!rows.length || isLoading}
                  onClick={() => {
                    setRows((prev) => prev.map((r) => ({ ...r, applyRow: r.status === "dubbio" && Boolean(r.employeeId) })));
                  }}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Solo dubbi
                </button>
                <button
                  type="button"
                  disabled={!rows.length || isLoading}
                  onClick={() => {
                    setRows((prev) => prev.map((r) => ({ ...r, applyRow: false })));
                  }}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Deseleziona tutto
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--brand-panel)] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">OK</th>
                  <th className="px-4 py-3">Stato</th>
                  <th className="px-4 py-3">Pag</th>
                  <th className="px-4 py-3">CF</th>
                  <th className="px-4 py-3">Cognome</th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Scadenza</th>
                  <th className="px-4 py-3">Applica scad.</th>
                  <th className="px-4 py-3">Applica lim.</th>
                  <th className="px-4 py-3">Limitazioni</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => (
                    <tr key={`${row.page}-${row.taxCode}`} className="border-t border-[var(--brand-line)] align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={row.applyRow}
                          disabled={isLoading || row.status === "errore" || !row.employeeId}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setRows((prev) =>
                              prev.map((r) => (r.page === row.page ? { ...r, applyRow: checked } : r)),
                            );
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={row.status} />
                        {row.issues.includes("multiple_date_candidates") ? (
                          <p className="mt-1 text-xs text-slate-500">Date trovate: {row.dueDateCandidates.join(", ")}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.page}</td>
                      <td className="px-4 py-3">
                        <input
                          value={row.taxCode}
                          disabled={isLoading}
                          onChange={(e) => {
                            const value = e.target.value;
                            setRows((prev) =>
                              prev.map((r) => (r.page === row.page ? { ...r, taxCode: value } : r)),
                            );
                          }}
                          className="w-44 rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-sm text-slate-700"
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.lastName || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.firstName || "-"}</td>
                      <td className="px-4 py-3">
                        <input
                          value={row.nextDueDateIt}
                          disabled={isLoading}
                          onChange={(e) => {
                            const value = e.target.value;
                            setRows((prev) =>
                              prev.map((r) => (r.page === row.page ? { ...r, nextDueDateIt: value } : r)),
                            );
                          }}
                          placeholder="gg/mm/aaaa"
                          className="w-32 rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-sm text-slate-700"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={row.applyDueDate}
                          disabled={isLoading || row.status === "errore" || !row.employeeId}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setRows((prev) =>
                              prev.map((r) => (r.page === row.page ? { ...r, applyDueDate: checked } : r)),
                            );
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={row.applyLimitations}
                          disabled={isLoading || row.status === "errore" || !row.employeeId}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setRows((prev) =>
                              prev.map((r) => (r.page === row.page ? { ...r, applyLimitations: checked } : r)),
                            );
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <textarea
                          value={row.limitations}
                          disabled={isLoading}
                          onChange={(e) => {
                            const value = e.target.value;
                            setRows((prev) =>
                              prev.map((r) => (r.page === row.page ? { ...r, limitations: value } : r)),
                            );
                          }}
                          rows={3}
                          className="w-80 rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1 text-sm text-slate-700"
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-500">
                      Nessuna analisi disponibile.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="overflow-hidden rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
          <div className="border-b border-[var(--brand-line)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--brand-ink)]">Report errori</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--brand-panel)] text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Pag</th>
                  <th className="px-4 py-3">CF</th>
                  <th className="px-4 py-3">Errore</th>
                </tr>
              </thead>
              <tbody>
                {result?.errors?.length ? (
                  result.errors.map((row) => (
                    <tr key={`${row.page}-${row.taxCode}-${row.errorType}`} className="border-t border-[var(--brand-line)]">
                      <td className="px-4 py-3 text-slate-600">{row.page}</td>
                      <td className="px-4 py-3 text-slate-600">{row.taxCode || "-"}</td>
                      <td className="px-4 py-3 font-medium text-red-600">{row.errorMessage}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">
                      Nessun errore rilevato.
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
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--brand-ink)]">{value}</p>
    </article>
  );
}

function StatusPill({ status }: { status: "ok" | "dubbio" | "errore" }) {
  const label = status === "ok" ? "OK" : status === "dubbio" ? "Dubbio" : "Errore";
  const cls =
    status === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "dubbio"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}
