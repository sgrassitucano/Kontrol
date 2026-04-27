"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type JobCode = { code: string; label: string };

type JobRule = {
  job_code_norm: string;
  always_exempt: boolean;
  exempt_below_weekly_minutes: number | null;
  note: string | null;
};

type ApiPayload = {
  jobCodes: JobCode[];
  rulesByCode: Record<string, JobRule>;
  supportsRules: boolean;
  defaults: {
    exemptJobCodes: string[];
    exemptBelowWeeklyMinutes: number;
    excludedFreezeStatuses: string[];
  };
  error?: string;
};

export default function SorveglianzaMatricePage() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { alwaysExempt: boolean; exemptBelowWeeklyMinutes: string; note: string }>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/sorveglianza_sanitaria/matrice");
      const body = (await response.json()) as ApiPayload;
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore caricamento matrice.");
      setPayload(body);

      const nextDrafts: Record<string, { alwaysExempt: boolean; exemptBelowWeeklyMinutes: string; note: string }> = {};
      (body.jobCodes ?? []).forEach((job) => {
        const existing = body.rulesByCode?.[job.code];
        nextDrafts[job.code] = {
          alwaysExempt: Boolean(existing?.always_exempt ?? false),
          exemptBelowWeeklyMinutes:
            existing?.exempt_below_weekly_minutes !== null && existing?.exempt_below_weekly_minutes !== undefined
              ? String(existing.exempt_below_weekly_minutes)
              : "",
          note: (existing?.note ?? "").trim(),
        };
      });
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento matrice.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const defaultExemptSet = useMemo(() => new Set(payload?.defaults?.exemptJobCodes ?? []), [payload]);

  const saveRule = useCallback(
    async (jobCodeNorm: string) => {
      const draft = drafts[jobCodeNorm];
      if (!draft) return;
      setSaving(jobCodeNorm);
      setError("");
      try {
        const minutesValue = draft.exemptBelowWeeklyMinutes.trim();
        const exemptBelowWeeklyMinutes = minutesValue ? Number(minutesValue) : null;
        const response = await fetch("/api/sorveglianza_sanitaria/matrice", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobCodeNorm,
            alwaysExempt: Boolean(draft.alwaysExempt),
            exemptBelowWeeklyMinutes:
              minutesValue === "" ? null : Number.isFinite(exemptBelowWeeklyMinutes) ? exemptBelowWeeklyMinutes : null,
            note: draft.note.trim() || null,
          }),
        });
        const body = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || body.error) throw new Error(body.error ?? "Errore salvataggio.");
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore salvataggio.");
      } finally {
        setSaving(null);
      }
    },
    [drafts, load],
  );

  return (
    <div className="space-y-4">
      <section className="rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-ink)]">Matrice sorveglianza sanitaria</h1>
            <p className="mt-2 text-sm leading-7 text-slate-500">
              Regole operative: tutti in visita, esclusi {payload?.defaults?.exemptJobCodes?.join(", ") ?? "-"} se &lt;{" "}
              {payload?.defaults?.exemptBelowWeeklyMinutes ?? 1200} minuti settimanali, e gli stati{" "}
              {payload?.defaults?.excludedFreezeStatuses?.join(", ") ?? "-"}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            disabled={isLoading}
          >
            {isLoading ? "Aggiorno…" : "Aggiorna"}
          </button>
        </div>
        {payload && !payload.supportsRules ? (
          <p className="mt-2 text-xs font-medium text-amber-700">
            Matrice non configurabile in questo ambiente (tabella regole mancante). Funzionano comunque le regole di default.
          </p>
        ) : null}
        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
      </section>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-white">
        <div className="border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-ink)]">Regole per mansione</h2>
          <p className="mt-1 text-xs text-slate-500">
            Le righe sono le mansioni presenti in anagrafica. Le regole qui aggiungono/escludono rispetto al default.
          </p>
        </div>
        <div className="max-h-[75vh] overflow-auto">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Mansione</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Sempre esente</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Esente se &lt; minuti</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Note</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.jobCodes ?? []).map((job, idx) => {
                const draft = drafts[job.code];
                const isDefaultExempt = defaultExemptSet.has(job.code);
                return (
                  <tr
                    key={job.code}
                    className={[
                      "border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60",
                      idx % 2 === 1 ? "bg-[var(--brand-panel)]/30" : "bg-white",
                    ].join(" ")}
                  >
                    <td className="w-[38%] px-4 py-2.5 text-slate-700">
                      <span className="font-semibold text-slate-800">{job.code}</span>
                      <span className="ml-2 text-slate-500">{job.label}</span>
                      {isDefaultExempt ? (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          default
                        </span>
                      ) : null}
                    </td>
                    <td className="w-[14%] px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={Boolean(draft?.alwaysExempt)}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [job.code]: { ...prev[job.code], alwaysExempt: event.target.checked },
                          }))
                        }
                        disabled={!payload?.supportsRules}
                      />
                    </td>
                    <td className="w-[16%] px-4 py-2.5">
                      <input
                        value={draft?.exemptBelowWeeklyMinutes ?? ""}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [job.code]: { ...prev[job.code], exemptBelowWeeklyMinutes: event.target.value },
                          }))
                        }
                        placeholder={isDefaultExempt ? String(payload?.defaults?.exemptBelowWeeklyMinutes ?? 1200) : "-"}
                        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                        disabled={!payload?.supportsRules}
                      />
                    </td>
                    <td className="w-[22%] px-4 py-2.5">
                      <input
                        value={draft?.note ?? ""}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [job.code]: { ...prev[job.code], note: event.target.value },
                          }))
                        }
                        placeholder="-"
                        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                        disabled={!payload?.supportsRules}
                      />
                    </td>
                    <td className="w-[10%] px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void saveRule(job.code)}
                        className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                        disabled={!payload?.supportsRules || saving === job.code}
                      >
                        {saving === job.code ? "Salvo…" : "Salva"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && (payload?.jobCodes?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                    Nessuna mansione trovata.
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
