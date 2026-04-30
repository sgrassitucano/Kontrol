"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleHeader } from "@/components/module-ui";

type JobCode = { code: string; label: string };

type JobRule = {
  job_code_norm: string;
  always_exempt: boolean;
  exempt_below_weekly_minutes: number | null;
  note: string | null;
};

type MansioniPayload = {
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

type SiteRow = { id: number; display_name: string };
type SubSiteRow = { id: number; site_id: number; display_name: string };

type CantieriRuleRow = {
  scope_type: "site" | "sub_site";
  site_id: number | null;
  sub_site_id: number | null;
  requires_visit: boolean;
  note: string | null;
};

type CantieriPayload = {
  sites: SiteRow[];
  subSites: SubSiteRow[];
  rules: CantieriRuleRow[];
  supportsRules: boolean;
  error?: string;
};

type ProviderAssignmentRow = {
  scope_type: "site" | "sub_site";
  site_id: number | null;
  sub_site_id: number | null;
  provider: string;
  is_active: boolean;
  note: string | null;
};

type ProviderPayload = {
  sites: SiteRow[];
  subSites: SubSiteRow[];
  assignments: ProviderAssignmentRow[];
  supportsRules: boolean;
  error?: string;
};

export default function SorveglianzaMatricePage() {
  const [tab, setTab] = useState<"cantieri" | "mansioni" | "provider">("cantieri");

  const [mansioniPayload, setMansioniPayload] = useState<MansioniPayload | null>(null);
  const [mansioniLoading, setMansioniLoading] = useState(false);
  const [mansioniSaving, setMansioniSaving] = useState<string | null>(null);
  const [mansioniDrafts, setMansioniDrafts] = useState<
    Record<string, { alwaysExempt: boolean; exemptBelowWeeklyMinutes: string; note: string }>
  >({});

  const [cantieriPayload, setCantieriPayload] = useState<CantieriPayload | null>(null);
  const [cantieriLoading, setCantieriLoading] = useState(false);
  const [cantieriSaving, setCantieriSaving] = useState<string | null>(null);
  const [cantieriDrafts, setCantieriDrafts] = useState<
    Record<string, { mode: "default" | "SI" | "NO"; note: string }>
  >({});

  const [providerPayload, setProviderPayload] = useState<ProviderPayload | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerSaving, setProviderSaving] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, { provider: string; enabled: boolean; note: string }>>({});
  const [providerSeedLoading, setProviderSeedLoading] = useState(false);
  const providerSeedInputRef = useRef<HTMLInputElement | null>(null);

  const [error, setError] = useState("");

  const loadMansioni = useCallback(async () => {
    setMansioniLoading(true);
    setError("");
    try {
      const response = await fetch("/api/sorveglianza_sanitaria/matrice");
      const body = (await response.json()) as MansioniPayload;
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore caricamento matrice.");
      setMansioniPayload(body);

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
      setMansioniDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento matrice.");
    } finally {
      setMansioniLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMansioni();
  }, [loadMansioni]);

  const loadCantieri = useCallback(async () => {
    setCantieriLoading(true);
    setError("");
    try {
      const response = await fetch("/api/sorveglianza_sanitaria/matrice/cantieri");
      const body = (await response.json()) as CantieriPayload;
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore caricamento matrice cantieri.");
      setCantieriPayload(body);

      const bySiteId = new Map<number, CantieriRuleRow>();
      const bySubSiteId = new Map<number, CantieriRuleRow>();
      (body.rules ?? []).forEach((r) => {
        if (r.scope_type === "site" && r.site_id) bySiteId.set(r.site_id, r);
        if (r.scope_type === "sub_site" && r.sub_site_id) bySubSiteId.set(r.sub_site_id, r);
      });

      const nextDrafts: Record<string, { mode: "default" | "SI" | "NO"; note: string }> = {};
      (body.sites ?? []).forEach((site) => {
        const existing = bySiteId.get(site.id);
        nextDrafts[`site:${site.id}`] = {
          mode: existing ? (existing.requires_visit ? "SI" : "NO") : "default",
          note: (existing?.note ?? "").trim(),
        };
      });
      (body.subSites ?? []).forEach((subSite) => {
        const existing = bySubSiteId.get(subSite.id);
        nextDrafts[`sub:${subSite.id}`] = {
          mode: existing ? (existing.requires_visit ? "SI" : "NO") : "default",
          note: (existing?.note ?? "").trim(),
        };
      });
      setCantieriDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento matrice cantieri.");
    } finally {
      setCantieriLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCantieri();
  }, [loadCantieri]);

  const loadProvider = useCallback(async () => {
    setProviderLoading(true);
    setError("");
    try {
      const response = await fetch("/api/sorveglianza_sanitaria/matrice/provider");
      const body = (await response.json()) as ProviderPayload;
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore caricamento matrice provider.");
      setProviderPayload(body);

      const bySiteId = new Map<number, ProviderAssignmentRow>();
      const bySubSiteId = new Map<number, ProviderAssignmentRow>();
      (body.assignments ?? []).forEach((r) => {
        if (!r.is_active) return;
        if (r.scope_type === "site" && r.site_id) bySiteId.set(r.site_id, r);
        if (r.scope_type === "sub_site" && r.sub_site_id) bySubSiteId.set(r.sub_site_id, r);
      });

      const nextDrafts: Record<string, { provider: string; enabled: boolean; note: string }> = {};
      (body.sites ?? []).forEach((site) => {
        const existing = bySiteId.get(site.id);
        nextDrafts[`site:${site.id}`] = {
          provider: (existing?.provider ?? "").trim(),
          enabled: Boolean(existing),
          note: (existing?.note ?? "").trim(),
        };
      });
      (body.subSites ?? []).forEach((subSite) => {
        const existing = bySubSiteId.get(subSite.id);
        nextDrafts[`sub:${subSite.id}`] = {
          provider: (existing?.provider ?? "").trim(),
          enabled: Boolean(existing),
          note: (existing?.note ?? "").trim(),
        };
      });
      setProviderDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento matrice provider.");
    } finally {
      setProviderLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProvider();
  }, [loadProvider]);

  const defaultExemptSet = useMemo(() => new Set(mansioniPayload?.defaults?.exemptJobCodes ?? []), [mansioniPayload]);

  const saveMansioneRule = useCallback(
    async (jobCodeNorm: string) => {
      const draft = mansioniDrafts[jobCodeNorm];
      if (!draft) return;
      setMansioniSaving(jobCodeNorm);
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
        await loadMansioni();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore salvataggio.");
      } finally {
        setMansioniSaving(null);
      }
    },
    [loadMansioni, mansioniDrafts],
  );

  const saveCantiereRule = useCallback(
    async (key: string) => {
      const draft = cantieriDrafts[key];
      if (!draft) return;
      setCantieriSaving(key);
      setError("");
      try {
        const [prefix, idRaw] = key.split(":");
        const id = Number(idRaw);
        if (!id) return;

        if (draft.mode === "default") {
          const response = await fetch("/api/sorveglianza_sanitaria/matrice/cantieri", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              prefix === "site" ? { scopeType: "site", siteId: id } : { scopeType: "sub_site", subSiteId: id },
            ),
          });
          const body = (await response.json()) as { ok?: boolean; error?: string };
          if (!response.ok || body.error) throw new Error(body.error ?? "Errore reset.");
        } else {
          const response = await fetch("/api/sorveglianza_sanitaria/matrice/cantieri", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scopeType: prefix === "site" ? "site" : "sub_site",
              siteId: prefix === "site" ? id : undefined,
              subSiteId: prefix === "sub" ? id : undefined,
              requiresVisit: draft.mode === "SI",
              note: draft.note.trim() || null,
            }),
          });
          const body = (await response.json()) as { ok?: boolean; error?: string };
          if (!response.ok || body.error) throw new Error(body.error ?? "Errore salvataggio.");
        }

        await loadCantieri();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore salvataggio.");
      } finally {
        setCantieriSaving(null);
      }
    },
    [cantieriDrafts, loadCantieri],
  );

  const saveProviderRule = useCallback(
    async (key: string) => {
      const draft = providerDrafts[key];
      if (!draft) return;
      setProviderSaving(key);
      setError("");
      try {
        const [prefix, idRaw] = key.split(":");
        const id = Number(idRaw);
        if (!id) return;

        const response = await fetch("/api/sorveglianza_sanitaria/matrice/provider", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scopeType: prefix === "site" ? "site" : "sub_site",
            siteId: prefix === "site" ? id : undefined,
            subSiteId: prefix === "sub" ? id : undefined,
            provider: draft.provider.trim(),
            enabled: draft.enabled && draft.provider.trim() !== "",
            note: draft.note.trim() || null,
          }),
        });
        const body = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || body.error) throw new Error(body.error ?? "Errore salvataggio.");
        await loadProvider();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore salvataggio.");
      } finally {
        setProviderSaving(null);
      }
    },
    [loadProvider, providerDrafts],
  );

  const seedProvider = useCallback(
    async (file: File) => {
      setProviderSeedLoading(true);
    setError("");
      try {
        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch("/api/sorveglianza_sanitaria/matrice/provider/seed", { method: "POST", body: formData });
        const body = (await response.json()) as { ok?: boolean; error?: string; seeded?: number; source?: string };
        if (!response.ok || body.error) throw new Error(body.error ?? "Errore seed.");
        await loadProvider();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore seed provider.");
      } finally {
        setProviderSeedLoading(false);
      }
    },
    [loadProvider],
  );

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Matrice sorveglianza sanitaria"
        description="Regole: visita SI/NO per cantieri e mansioni, assegnazione provider per cantiere/sottocantiere."
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("cantieri")}
            className={[
              "rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95",
              tab === "cantieri" ? "" : "opacity-80",
            ].join(" ")}
          >
            Cantieri
          </button>
          <button
            type="button"
            onClick={() => setTab("mansioni")}
            className={[
              "rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95",
              tab === "mansioni" ? "" : "opacity-80",
            ].join(" ")}
          >
            Mansioni
          </button>
          <button
            type="button"
            onClick={() => setTab("provider")}
            className={[
              "rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95",
              tab === "provider" ? "" : "opacity-80",
            ].join(" ")}
          >
            Provider
          </button>
        </div>

        {mansioniPayload && !mansioniPayload.supportsRules ? (
          <p className="mt-2 text-xs font-medium text-amber-700">
            Matrice non configurabile in questo ambiente (tabella regole mancante). Funzionano comunque le regole di default.
          </p>
        ) : null}
        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
      </ModuleHeader>

      {tab === "cantieri" ? (
        <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
          <div className="border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-3">
            <h2 className="text-sm font-bold text-[var(--brand-ink)]">Matrice cantieri</h2>
            <p className="mt-1 text-xs text-slate-500">Imposta visita SI/NO per cantiere o sottocantiere. Default = segue le altre regole.</p>
          </div>
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cantiere / Sottocantiere</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Visita</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Note</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {(cantieriPayload?.sites ?? []).map((site) => {
                  const key = `site:${site.id}`;
                  const draft = cantieriDrafts[key];
                  return (
                    <tr
                      key={key}
                      className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                    >
                      <td className="px-4 py-2.5 text-slate-700">
                        <span className="font-semibold text-slate-800">{site.display_name}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={draft?.mode ?? "default"}
                          onChange={(event) =>
                            setCantieriDrafts((prev) => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { note: "" }), mode: event.target.value as "default" | "SI" | "NO" },
                            }))
                          }
                          className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!cantieriPayload?.supportsRules}
                        >
                          <option value="default">Default</option>
                          <option value="SI">SI</option>
                          <option value="NO">NO</option>
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          value={draft?.note ?? ""}
                          onChange={(event) =>
                            setCantieriDrafts((prev) => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { mode: "default", note: "" }), note: event.target.value },
                            }))
                          }
                          placeholder="-"
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!cantieriPayload?.supportsRules}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void saveCantiereRule(key)}
                          className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={!cantieriPayload?.supportsRules || cantieriSaving === key}
                        >
                          {cantieriSaving === key ? "Salvo…" : "Salva"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {(cantieriPayload?.subSites ?? []).map((subSite) => {
                  const key = `sub:${subSite.id}`;
                  const draft = cantieriDrafts[key];
                  const siteName = (cantieriPayload?.sites ?? []).find((s) => s.id === subSite.site_id)?.display_name ?? "-";
                  return (
                    <tr
                      key={key}
                      className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                    >
                      <td className="px-4 py-2.5 text-slate-700">
                        <span className="text-slate-400">{siteName}</span>
                        <span className="ml-2 font-semibold text-slate-800">↳ {subSite.display_name}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={draft?.mode ?? "default"}
                          onChange={(event) =>
                            setCantieriDrafts((prev) => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { note: "" }), mode: event.target.value as "default" | "SI" | "NO" },
                            }))
                          }
                          className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!cantieriPayload?.supportsRules}
                        >
                          <option value="default">Default</option>
                          <option value="SI">SI</option>
                          <option value="NO">NO</option>
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          value={draft?.note ?? ""}
                          onChange={(event) =>
                            setCantieriDrafts((prev) => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { mode: "default", note: "" }), note: event.target.value },
                            }))
                          }
                          placeholder="-"
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!cantieriPayload?.supportsRules}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void saveCantiereRule(key)}
                          className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                          disabled={!cantieriPayload?.supportsRules || cantieriSaving === key}
                        >
                          {cantieriSaving === key ? "Salvo…" : "Salva"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!cantieriLoading && (cantieriPayload?.sites?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                      Nessun cantiere trovato.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "mansioni" ? (
        <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
          <div className="border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-3">
            <h2 className="text-sm font-bold text-[var(--brand-ink)]">Matrice mansioni</h2>
            <p className="mt-1 text-xs text-slate-500">
              Regole operative: tutti in visita, esclusi {mansioniPayload?.defaults?.exemptJobCodes?.join(", ") ?? "-"} se &lt;{" "}
              {mansioniPayload?.defaults?.exemptBelowWeeklyMinutes ?? 1200} minuti settimanali, e gli stati{" "}
              {mansioniPayload?.defaults?.excludedFreezeStatuses?.join(", ") ?? "-"}.
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
                {(mansioniPayload?.jobCodes ?? []).map((job) => {
                  const draft = mansioniDrafts[job.code];
                  const isDefaultExempt = defaultExemptSet.has(job.code);
                  return (
                    <tr
                      key={job.code}
                      className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
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
                            setMansioniDrafts((prev) => ({
                              ...prev,
                              [job.code]: { ...prev[job.code], alwaysExempt: event.target.checked },
                            }))
                          }
                          disabled={!mansioniPayload?.supportsRules}
                        />
                      </td>
                      <td className="w-[16%] px-4 py-2.5">
                        <input
                          value={draft?.exemptBelowWeeklyMinutes ?? ""}
                          onChange={(event) =>
                            setMansioniDrafts((prev) => ({
                              ...prev,
                              [job.code]: { ...prev[job.code], exemptBelowWeeklyMinutes: event.target.value },
                            }))
                          }
                          placeholder={isDefaultExempt ? String(mansioniPayload?.defaults?.exemptBelowWeeklyMinutes ?? 1200) : "-"}
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!mansioniPayload?.supportsRules}
                        />
                      </td>
                      <td className="w-[22%] px-4 py-2.5">
                        <input
                          value={draft?.note ?? ""}
                          onChange={(event) =>
                            setMansioniDrafts((prev) => ({
                              ...prev,
                              [job.code]: { ...prev[job.code], note: event.target.value },
                            }))
                          }
                          placeholder="-"
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!mansioniPayload?.supportsRules}
                        />
                      </td>
                      <td className="w-[10%] px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void saveMansioneRule(job.code)}
                          className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                          disabled={!mansioniPayload?.supportsRules || mansioniSaving === job.code}
                        >
                          {mansioniSaving === job.code ? "Salvo…" : "Salva"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!mansioniLoading && (mansioniPayload?.jobCodes?.length ?? 0) === 0 ? (
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
      ) : null}

      {tab === "provider" ? (
        <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--brand-ink)]">Matrice provider</h2>
              <p className="mt-1 text-xs text-slate-500">
                Assegna un provider a cantiere o sottocantiere. Se un cantiere ha provider diversi, usa “MISTO” sul cantiere.
              </p>
            </div>
            <input
              ref={providerSeedInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                event.target.value = "";
                if (!file) return;
                void seedProvider(file);
              }}
            />
            <button
              type="button"
              onClick={() => providerSeedInputRef.current?.click()}
              className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={!providerPayload?.supportsRules || providerSeedLoading}
            >
              {providerSeedLoading ? "Carico file…" : "Ricostruisci da file import"}
            </button>
          </div>
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cantiere / Sottocantiere</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Provider</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Note</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {(providerPayload?.sites ?? []).map((site) => {
                  const key = `site:${site.id}`;
                  const draft = providerDrafts[key];
                  return (
                    <tr
                      key={key}
                      className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                    >
                      <td className="px-4 py-2.5 text-slate-700">
                        <span className="font-semibold text-slate-800">{site.display_name}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          value={draft?.provider ?? ""}
                          onChange={(event) =>
                            setProviderDrafts((prev) => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { enabled: false, note: "" }), provider: event.target.value, enabled: true },
                            }))
                          }
                          placeholder="(vuoto = nessun provider)"
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!providerPayload?.supportsRules}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          value={draft?.note ?? ""}
                          onChange={(event) =>
                            setProviderDrafts((prev) => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { enabled: false, provider: "" }), note: event.target.value },
                            }))
                          }
                          placeholder="-"
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!providerPayload?.supportsRules}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void saveProviderRule(key)}
                          className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                          disabled={!providerPayload?.supportsRules || providerSaving === key}
                        >
                          {providerSaving === key ? "Salvo…" : "Salva"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {(providerPayload?.subSites ?? []).map((subSite) => {
                  const key = `sub:${subSite.id}`;
                  const draft = providerDrafts[key];
                  const siteName = (providerPayload?.sites ?? []).find((s) => s.id === subSite.site_id)?.display_name ?? "-";
                  return (
                    <tr
                      key={key}
                      className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                    >
                      <td className="px-4 py-2.5 text-slate-700">
                        <span className="text-slate-400">{siteName}</span>
                        <span className="ml-2 font-semibold text-slate-800">↳ {subSite.display_name}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          value={draft?.provider ?? ""}
                          onChange={(event) =>
                            setProviderDrafts((prev) => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { enabled: false, note: "" }), provider: event.target.value, enabled: true },
                            }))
                          }
                          placeholder="(vuoto = nessun provider)"
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!providerPayload?.supportsRules}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          value={draft?.note ?? ""}
                          onChange={(event) =>
                            setProviderDrafts((prev) => ({
                              ...prev,
                              [key]: { ...(prev[key] ?? { enabled: false, provider: "" }), note: event.target.value },
                            }))
                          }
                          placeholder="-"
                          className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-xs"
                          disabled={!providerPayload?.supportsRules}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void saveProviderRule(key)}
                          className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                          disabled={!providerPayload?.supportsRules || providerSaving === key}
                        >
                          {providerSaving === key ? "Salvo…" : "Salva"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!providerLoading && (providerPayload?.sites?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                      Nessun cantiere trovato.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
