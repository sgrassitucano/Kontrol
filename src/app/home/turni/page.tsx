"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardCard, ModuleHeader, PanelCard } from "@/components/module-ui";
import { ItDateInput } from "@/components/it-date-input";

type ExportEmployeeOption = {
  id: number;
  matricola: string;
  first_name: string;
  last_name: string;
  responsible_code: string;
  referral: string | null;
  site_id: number | null;
  sub_site_id: number | null;
};

type ExportSiteOption = { id: number; display_name: string };
type ExportSubSiteOption = { id: number; site_id: number; display_name: string };

type ExportOptionsResponse = {
  employees: ExportEmployeeOption[];
  sites: ExportSiteOption[];
  subSites: ExportSubSiteOption[];
  responsibleCodes: string[];
  referrals: string[];
};

function nowMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function nextMonth(value: string) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return value;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = new Date(y, m, 1); // month is 0-based -> this is the following month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseYearMonth(value: string) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  if (y < 2000 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  return { year: y, month: m };
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isoDateFromLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mondayOf(dateIso: string) {
  const parsed = new Date(`${dateIso}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return dateIso;
  const dayMon0 = (parsed.getDay() + 6) % 7;
  parsed.setDate(parsed.getDate() - dayMon0);
  return isoDateFromLocal(parsed);
}

async function downloadFrom(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  if (!response.ok) {
    const text = await blob.text();
    throw new Error(text || "Errore download.");
  }
  const disp = response.headers.get("content-disposition") ?? "";
  const match = disp.match(/filename="([^"]+)"/i);
  const filename = match?.[1] ?? "export";
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function HomeTurniPage() {
  const [month, setMonth] = useState(() => nowMonth());
  const [options, setOptions] = useState<ExportOptionsResponse | null>(null);
  const [isOptionsLoading, setIsOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");

  const [employeesSearch, setEmployeesSearch] = useState("");
  const [sitesSearch, setSitesSearch] = useState("");
  const [subSitesSearch, setSubSitesSearch] = useState("");
  const [responsibleSearch, setResponsibleSearch] = useState("");
  const [referralsSearch, setReferralsSearch] = useState("");

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<number[]>([]);
  const [selectedSubSiteIds, setSelectedSubSiteIds] = useState<number[]>([]);
  const [includeNullSubSite, setIncludeNullSubSite] = useState(true);
  const [selectedResponsibleCodes, setSelectedResponsibleCodes] = useState<string[]>([]);
  const [selectedReferrals, setSelectedReferrals] = useState<string[]>([]);
  const [includeCancelled, setIncludeCancelled] = useState(true);

  const [imageMode, setImageMode] = useState<"week" | "month">("week");
  const [weekStart, setWeekStart] = useState(() => mondayOf(isoDateFromLocal(new Date())));

  const [actionError, setActionError] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  const [copyToMonth, setCopyToMonth] = useState(() => nextMonth(nowMonth()));
  const [isCopying, setIsCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const loadOptions = useCallback(async () => {
    setIsOptionsLoading(true);
    setOptionsError("");
    try {
      const response = await fetch("/api/turni/export-options");
      const body = (await response.json()) as ExportOptionsResponse | { error: string };
      if (!response.ok || "error" in body) {
        throw new Error("error" in body ? body.error : "Errore caricamento opzioni export.");
      }
      setOptions(body);
    } catch (err) {
      setOptions(null);
      setOptionsError(err instanceof Error ? err.message : "Errore caricamento opzioni export.");
    } finally {
      setIsOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void loadOptions(), 0);
    return () => clearTimeout(id);
  }, [loadOptions]);

  const monthParsed = useMemo(() => parseYearMonth(month), [month]);

  const employeesBase = useMemo(() => options?.employees ?? [], [options?.employees]);
  const sitesBase = useMemo(() => options?.sites ?? [], [options?.sites]);
  const subSitesBase = useMemo(() => options?.subSites ?? [], [options?.subSites]);

  const candidateEmployees = useMemo(() => {
    if (!options) return [];
    const hasResponsible = selectedResponsibleCodes.length > 0;
    const hasReferral = selectedReferrals.length > 0;
    if (!hasResponsible && !hasReferral) return employeesBase;
    const setResp = new Set(selectedResponsibleCodes.map((v) => v.toLowerCase()));
    const setRef = new Set(selectedReferrals.map((v) => v.toLowerCase()));
    return employeesBase.filter((e) => {
      if (hasResponsible && !setResp.has(String(e.responsible_code ?? "").toLowerCase())) return false;
      if (hasReferral && !setRef.has(String(e.referral ?? "").toLowerCase())) return false;
      return true;
    });
  }, [employeesBase, options, selectedReferrals, selectedResponsibleCodes]);

  const filteredEmployees = useMemo(() => {
    const q = normalizeText(employeesSearch);
    if (!q) return candidateEmployees;
    return candidateEmployees.filter((e) => {
      const label = `${e.last_name} ${e.first_name} ${e.matricola}`.toLowerCase();
      return label.includes(q);
    });
  }, [candidateEmployees, employeesSearch]);

  const filteredSites = useMemo(() => {
    const q = normalizeText(sitesSearch);
    if (!q) return sitesBase;
    return sitesBase.filter((s) => String(s.display_name ?? "").toLowerCase().includes(q));
  }, [sitesBase, sitesSearch]);

  const filteredSubSites = useMemo(() => {
    const q = normalizeText(subSitesSearch);
    const base = selectedSiteIds.length > 0 ? subSitesBase.filter((s) => selectedSiteIds.includes(s.site_id)) : subSitesBase;
    if (!q) return base;
    return base.filter((s) => String(s.display_name ?? "").toLowerCase().includes(q));
  }, [selectedSiteIds, subSitesBase, subSitesSearch]);

  const filteredResponsibleCodes = useMemo(() => {
    const base = options?.responsibleCodes ?? [];
    const q = normalizeText(responsibleSearch);
    if (!q) return base;
    return base.filter((v) => v.toLowerCase().includes(q));
  }, [options?.responsibleCodes, responsibleSearch]);

  const filteredReferrals = useMemo(() => {
    const base = options?.referrals ?? [];
    const q = normalizeText(referralsSearch);
    if (!q) return base;
    return base.filter((v) => v.toLowerCase().includes(q));
  }, [options?.referrals, referralsSearch]);

  const toggleId = (list: number[], id: number) => (list.includes(id) ? list.filter((v) => v !== id) : [...list, id]);
  const toggleText = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const exportQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (monthParsed) {
      params.set("year", String(monthParsed.year));
      params.set("month", String(monthParsed.month));
    }
    if (selectedEmployeeIds.length > 0) params.set("employeeIds", selectedEmployeeIds.join(","));
    if (selectedSiteIds.length > 0) params.set("siteIds", selectedSiteIds.join(","));
    if (selectedSubSiteIds.length > 0) params.set("subSiteIds", selectedSubSiteIds.join(","));
    if (includeNullSubSite) params.set("includeNullSubSite", "1");
    if (selectedResponsibleCodes.length > 0) params.set("responsibleCodes", selectedResponsibleCodes.join(","));
    if (selectedReferrals.length > 0) params.set("referrals", selectedReferrals.join(","));
    if (includeCancelled) params.set("includeCancelled", "1");
    return params.toString();
  }, [
    includeCancelled,
    includeNullSubSite,
    monthParsed,
    selectedEmployeeIds,
    selectedReferrals,
    selectedResponsibleCodes,
    selectedSiteIds,
    selectedSubSiteIds,
  ]);

  const canExport = useMemo(() => {
    if (!monthParsed) return false;
    if (selectedEmployeeIds.length > 0) return true;
    if (selectedSiteIds.length > 0) return true;
    if (selectedSubSiteIds.length > 0) return true;
    if (selectedResponsibleCodes.length > 0) return true;
    if (selectedReferrals.length > 0) return true;
    return false;
  }, [monthParsed, selectedEmployeeIds, selectedReferrals, selectedResponsibleCodes, selectedSiteIds, selectedSubSiteIds]);

  const downloadExcel = useCallback(async () => {
    setActionError("");
    if (!monthParsed) {
      setActionError("Mese non valido.");
      return;
    }
    if (!canExport) {
      setActionError("Seleziona almeno un lavoratore o un filtro (cantiere/sottocantiere/responsabile/referente).");
      return;
    }
    setIsDownloading(true);
    try {
      await downloadFrom(`/api/turni/export?${exportQueryString}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Errore export Excel.");
    } finally {
      setIsDownloading(false);
    }
  }, [canExport, exportQueryString, monthParsed]);

  const downloadImages = useCallback(async () => {
    setActionError("");
    if (!monthParsed) {
      setActionError("Mese non valido.");
      return;
    }
    if (!canExport) {
      setActionError("Seleziona almeno un lavoratore o un filtro (cantiere/sottocantiere/responsabile/referente).");
      return;
    }
    setIsDownloading(true);
    try {
      const params = new URLSearchParams(exportQueryString);
      params.set("format", "jpg");
      params.set("mode", imageMode);
      if (imageMode === "week") params.set("weekStart", weekStart);
      else params.set("month", month);
      await downloadFrom(`/api/turni/worker-images?${params.toString()}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Errore export immagini.");
    } finally {
      setIsDownloading(false);
    }
  }, [canExport, exportQueryString, imageMode, month, monthParsed, weekStart]);

  const downloadPdf = useCallback(async () => {
    setActionError("");
    if (!monthParsed) {
      setActionError("Mese non valido.");
      return;
    }
    if (!canExport) {
      setActionError("Seleziona almeno un lavoratore o un filtro (cantiere/sottocantiere/responsabile/referente).");
      return;
    }
    setIsDownloading(true);
    try {
      const params = new URLSearchParams(exportQueryString);
      params.set("mode", imageMode);
      if (imageMode === "week") params.set("weekStart", weekStart);
      else params.set("month", month);
      await downloadFrom(`/api/turni/pdf?${params.toString()}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Errore export PDF.");
    } finally {
      setIsDownloading(false);
    }
  }, [canExport, exportQueryString, imageMode, month, monthParsed, weekStart]);

  const copyMonth = useCallback(async () => {
    setActionError("");
    setCopyMessage("");
    if (!monthParsed) {
      setActionError("Mese di origine non valido.");
      return;
    }
    const toParsed = parseYearMonth(copyToMonth);
    if (!toParsed) {
      setActionError("Mese di destinazione non valido.");
      return;
    }
    if (month === copyToMonth) {
      setActionError("Origine e destinazione coincidono.");
      return;
    }
    setIsCopying(true);
    try {
      const response = await fetch("/api/turni/copy-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromMonth: month,
          toMonth: copyToMonth,
          siteIds: selectedSiteIds.length > 0 ? selectedSiteIds : undefined,
          employeeIds: selectedEmployeeIds.length > 0 ? selectedEmployeeIds : undefined,
        }),
      });
      const body = (await response.json()) as {
        created?: number;
        conflicts?: number;
        skippedInvalidDay?: number;
        skippedInactive?: number;
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Errore copia mese.");
      const parts = [
        `Creati: ${body.created ?? 0}`,
        body.conflicts ? `conflitti: ${body.conflicts}` : null,
        body.skippedInactive ? `saltati (non attivi): ${body.skippedInactive}` : null,
        body.skippedInvalidDay ? `saltati (giorno assente): ${body.skippedInvalidDay}` : null,
      ].filter(Boolean);
      setCopyMessage(parts.join(" · "));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Errore copia mese.");
    } finally {
      setIsCopying(false);
    }
  }, [copyToMonth, month, monthParsed, selectedEmployeeIds, selectedSiteIds]);

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Turni"
        description="Export turni (Excel e immagini). Le viste operative restano in “Cantiere” e “Lavoratori”."
        actions={
          <>
            <a
              href="/turni/cantiere"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Vista cantiere
            </a>
            <a
              href="/turni/lavoratori"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Vista lavoratori
            </a>
          </>
        }
      />

      <PanelCard>
        <div className="grid gap-3 lg:grid-cols-[220px_auto]">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => void loadOptions()} className="rounded-xl px-3 py-2 text-xs transition">
              Aggiorna liste
            </button>
          </div>
        </div>
        {optionsError ? <p className="mt-2 text-xs font-medium text-red-600">{optionsError}</p> : null}
      </PanelCard>

      <DashboardCard>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-[var(--brand-ink)]">Export</h2>
          <div className="flex items-center gap-2">
            {isOptionsLoading ? <span className="text-xs text-slate-500">Caricamento…</span> : null}
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel-2)] p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[var(--brand-ink)]">Responsabile / Referente</h3>
              <button
                type="button"
                data-chip="true"
                onClick={() => {
                  setSelectedResponsibleCodes([]);
                  setSelectedReferrals([]);
                }}
                className="rounded-xl px-3 py-2 text-xs transition"
              >
                Svuota
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[var(--brand-ink)]">Responsabili</p>
                  <span className="text-xs text-slate-500">{selectedResponsibleCodes.length}</span>
                </div>
                <input
                  value={responsibleSearch}
                  onChange={(e) => setResponsibleSearch(e.target.value)}
                  placeholder="Cerca responsabile…"
                  className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                />
                <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)]">
                  {filteredResponsibleCodes.map((code) => (
                    <label key={code} className="flex cursor-pointer items-center gap-2 border-b border-[var(--brand-line)] px-3 py-2 text-sm last:border-b-0">
                      <input
                        type="checkbox"
                        checked={selectedResponsibleCodes.includes(code)}
                        onChange={() => setSelectedResponsibleCodes((v) => toggleText(v, code))}
                      />
                      <span className="font-semibold text-[var(--brand-ink)]">{code}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[var(--brand-ink)]">Referenti</p>
                  <span className="text-xs text-slate-500">{selectedReferrals.length}</span>
                </div>
                <input
                  value={referralsSearch}
                  onChange={(e) => setReferralsSearch(e.target.value)}
                  placeholder="Cerca referente…"
                  className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                />
                <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)]">
                  {filteredReferrals.map((code) => (
                    <label key={code} className="flex cursor-pointer items-center gap-2 border-b border-[var(--brand-line)] px-3 py-2 text-sm last:border-b-0">
                      <input type="checkbox" checked={selectedReferrals.includes(code)} onChange={() => setSelectedReferrals((v) => toggleText(v, code))} />
                      <span className="font-semibold text-[var(--brand-ink)]">{code}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel-2)] p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[var(--brand-ink)]">Lavoratori</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-chip="true"
                  onClick={() => setSelectedEmployeeIds(filteredEmployees.map((e) => e.id))}
                  className="rounded-xl px-3 py-2 text-xs transition"
                >
                  Seleziona filtrati
                </button>
                <button
                  type="button"
                  data-chip="true"
                  onClick={() => setSelectedEmployeeIds([])}
                  className="rounded-xl px-3 py-2 text-xs transition"
                >
                  Svuota
                </button>
              </div>
            </div>
            <input
              value={employeesSearch}
              onChange={(e) => setEmployeesSearch(e.target.value)}
              placeholder="Cerca lavoratore… (cognome/nome/matricola)"
              className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
            />
            <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)]">
              {filteredEmployees.slice(0, 400).map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 border-b border-[var(--brand-line)] px-3 py-2 text-sm last:border-b-0">
                  <input type="checkbox" checked={selectedEmployeeIds.includes(e.id)} onChange={() => setSelectedEmployeeIds((v) => toggleId(v, e.id))} />
                  <span className="font-semibold text-[var(--brand-ink)]">
                    {e.last_name} {e.first_name} ({e.matricola})
                  </span>
                </label>
              ))}
              {filteredEmployees.length > 400 ? (
                <div className="px-3 py-2 text-xs text-slate-500">Mostrati i primi 400 risultati. Affina la ricerca.</div>
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>Selezionati: {selectedEmployeeIds.length}</span>
              <span>Risultati: {filteredEmployees.length}</span>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel-2)] p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[var(--brand-ink)]">Cantieri / Sottocantieri</h3>
              <button
                type="button"
                data-chip="true"
                onClick={() => {
                  setSelectedSiteIds([]);
                  setSelectedSubSiteIds([]);
                }}
                className="rounded-xl px-3 py-2 text-xs transition"
              >
                Svuota
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[var(--brand-ink)]">Cantieri</p>
                  <span className="text-xs text-slate-500">{selectedSiteIds.length}</span>
                </div>
                <input
                  value={sitesSearch}
                  onChange={(e) => setSitesSearch(e.target.value)}
                  placeholder="Cerca cantiere…"
                  className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                />
                <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)]">
                  {filteredSites.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 border-b border-[var(--brand-line)] px-3 py-2 text-sm last:border-b-0">
                      <input type="checkbox" checked={selectedSiteIds.includes(s.id)} onChange={() => setSelectedSiteIds((v) => toggleId(v, s.id))} />
                      <span className="font-semibold text-[var(--brand-ink)]">{s.display_name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[var(--brand-ink)]">Sottocantieri</p>
                  <span className="text-xs text-slate-500">{selectedSubSiteIds.length}</span>
                </div>
                <input
                  value={subSitesSearch}
                  onChange={(e) => setSubSitesSearch(e.target.value)}
                  placeholder="Cerca sottocantiere…"
                  className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                />
                <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)]">
                  {filteredSubSites.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 border-b border-[var(--brand-line)] px-3 py-2 text-sm last:border-b-0">
                      <input type="checkbox" checked={selectedSubSiteIds.includes(s.id)} onChange={() => setSelectedSubSiteIds((v) => toggleId(v, s.id))} />
                      <span className="font-semibold text-[var(--brand-ink)]">{s.display_name}</span>
                    </label>
                  ))}
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={includeNullSubSite} onChange={() => setIncludeNullSubSite((v) => !v)} />
                  <span className="font-semibold text-[var(--brand-ink)]">Includi turni senza sottocantiere</span>
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel-2)] p-3">
            <h3 className="text-sm font-bold text-[var(--brand-ink)]">Opzioni export</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={includeCancelled} onChange={() => setIncludeCancelled((v) => !v)} />
                <span className="font-semibold text-[var(--brand-ink)]">Includi turni annullati</span>
              </label>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void downloadExcel()}
                  className="rounded-xl px-4 py-2 text-sm transition disabled:opacity-60"
                  disabled={isDownloading}
                >
                  Esporta Excel
                </button>
                <button
                  type="button"
                  onClick={() => void downloadImages()}
                  className="rounded-xl px-4 py-2 text-sm transition disabled:opacity-60"
                  disabled={isDownloading}
                >
                  Esporta JPG
                </button>
                <button
                  type="button"
                  onClick={() => void downloadPdf()}
                  className="rounded-xl px-4 py-2 text-sm transition disabled:opacity-60"
                  disabled={isDownloading}
                >
                  Esporta PDF
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-3">
                <p className="text-xs font-bold text-[var(--brand-ink)]">JPG: tipo calendario</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="imgmode" checked={imageMode === "week"} onChange={() => setImageMode("week")} />
                    <span className="font-semibold text-[var(--brand-ink)]">Settimanale</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="imgmode" checked={imageMode === "month"} onChange={() => setImageMode("month")} />
                    <span className="font-semibold text-[var(--brand-ink)]">Mensile</span>
                  </label>
                </div>
                {imageMode === "week" ? (
                  <div className="mt-2">
                    <label className="text-xs font-bold text-[var(--brand-ink)]">Settimana (lunedì)</label>
                    <ItDateInput
                      valueIso={weekStart}
                      onChangeIso={(valueIso) => setWeekStart(mondayOf(valueIso))}
                      className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-slate-500">Se scegli un giorno qualsiasi, viene allineato automaticamente al lunedì.</p>
                  </div>
                ) : null}
              </div>
              <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-3">
                <p className="text-xs font-bold text-[var(--brand-ink)]">Riepilogo selezione</p>
                <div className="mt-2 grid gap-1 text-xs text-slate-600">
                  <div>Lavoratori selezionati: {selectedEmployeeIds.length}</div>
                  <div>Responsabili selezionati: {selectedResponsibleCodes.length}</div>
                  <div>Referenti selezionati: {selectedReferrals.length}</div>
                  <div>Cantieri selezionati: {selectedSiteIds.length}</div>
                  <div>Sottocantieri selezionati: {selectedSubSiteIds.length}</div>
                </div>
              </div>
            </div>
            {actionError ? <p className="mt-3 text-xs font-medium text-red-600">{actionError}</p> : null}
          </div>
        </div>
      </DashboardCard>

      <DashboardCard>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-[var(--brand-ink)]">Copia mese</h2>
        </div>
        <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel-2)] p-3">
          <p className="text-xs text-slate-600">
            Duplica i turni di un mese sul mese successivo, mantenendo giorno del mese e orario. Salta i lavoratori non in
            forza e i turni già presenti. I filtri Cantiere e Lavoratori qui sopra restringono la copia. Le pause non
            vengono copiate.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
            <div>
              <label className="text-xs font-bold text-[var(--brand-ink)]">Da (origine)</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end justify-center pb-2 text-slate-400">→</div>
            <div>
              <label className="text-xs font-bold text-[var(--brand-ink)]">A (destinazione)</label>
              <input
                type="month"
                value={copyToMonth}
                onChange={(e) => setCopyToMonth(e.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void copyMonth()}
                className="w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
                disabled={isCopying}
              >
                {isCopying ? "Copia in corso…" : "Copia turni"}
              </button>
            </div>
          </div>
          {copyMessage ? <p className="mt-3 text-xs font-medium text-emerald-700">{copyMessage}</p> : null}
        </div>
      </DashboardCard>
    </div>
  );
}
