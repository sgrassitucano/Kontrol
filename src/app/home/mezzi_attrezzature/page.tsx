"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ModuleHeader, EmptyState, StatusPill } from "@/components/module-ui";
import { ItDateInput } from "@/components/it-date-input";

type TabKey = "scadenze" | "asset" | "assegnazioni" | "timeline";

type AssetType = "mezzo" | "attrezzatura";
type OwnershipType = "proprieta" | "noleggio";
type AssetStatus = "attivo" | "fuori_servizio" | "dismesso";

type AssetRow = {
  id: number;
  assetType: AssetType;
  ownershipType: OwnershipType;
  status: AssetStatus;
  category: string;
  brand: string;
  model: string;
  plate: string;
  vin: string;
  internalCode: string;
  serialNumber: string;
  registrationDate: string | null;
  cantiere: string;
  sottocantiere: string;
  rentalSupplier: string;
  rentalStartDate: string | null;
  rentalEndDate: string | null;
  notes: string;
};

type ObligationStatus = "da impostare" | "ok" | "in scadenza" | "scaduto";

type ObligationRow = {
  obligationId: number;
  assetId: number;
  obligationCode: string;
  obligationLabel: string;
  lastDoneDate: string | null;
  nextDueDate: string | null;
  vendor: string;
  notes: string;
  status: ObligationStatus;
  asset: {
    id: number;
    assetType: AssetType;
    ownershipType: OwnershipType;
    status: AssetStatus;
    category: string;
    brand: string;
    model: string;
    plate: string;
    internalCode: string;
    serialNumber: string;
    rentalEndDate: string | null;
    cantiere: string;
    sottocantiere: string;
  } | null;
};

type EmployeeOption = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
};

type AnagraficaWorkerRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
};

type AssignmentRow = {
  id: number;
  assetId: number;
  employeeId: number;
  startDate: string;
  endDate: string | null;
  note: string;
  employee: { id: number; matricola: string; cognome: string; nome: string } | null;
  asset: {
    id: number;
    assetType: AssetType;
    ownershipType: OwnershipType;
    status: AssetStatus;
    category: string;
    brand: string;
    model: string;
    plate: string;
    internalCode: string;
    serialNumber: string;
    cantiere: string;
    sottocantiere: string;
  } | null;
};

type LookupSite = { id: number; label: string };
type LookupSubSite = { id: number; siteId: number; label: string };

function formatDateIt(value: string | null) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function assetLabel(row: Pick<AssetRow, "assetType" | "plate" | "internalCode" | "brand" | "model">) {
  if (row.assetType === "mezzo") {
    if (row.plate) return row.plate;
    if (row.internalCode) return row.internalCode;
  }
  if (row.internalCode) return row.internalCode;
  const parts = [row.brand, row.model].filter(Boolean).join(" ");
  return parts || "Asset";
}

function badgeClass(status: ObligationStatus) {
  const base =
    "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] leading-none";
  if (status === "scaduto") return `${base} border-red-900/40 bg-red-700/55 text-white`;
  if (status === "in scadenza") return `${base} border-amber-800/45 bg-amber-300/45 text-slate-950`;
  if (status === "ok") return `${base} border-emerald-900/35 bg-emerald-400/45 text-slate-950`;
  return `${base} border-slate-900/35 bg-slate-700/55 text-white`;
}

export default function HomeMezziPage() {
  const [tab, setTab] = useState<TabKey>("scadenze");
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [obligations, setObligations] = useState<ObligationRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [allAssignments, setAllAssignments] = useState<AssignmentRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [sites, setSites] = useState<LookupSite[]>([]);
  const [subSites, setSubSites] = useState<LookupSubSite[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isObligationModalOpen, setIsObligationModalOpen] = useState(false);
  const [selectedObligation, setSelectedObligation] = useState<ObligationRow | null>(null);

  const [isBusy, setIsBusy] = useState(false);

  // States for Gantt/Timeline
  const [timelineDate, setTimelineDate] = useState(() => new Date());
  const [selectedAssignmentDetail, setSelectedAssignmentDetail] = useState<AssignmentRow | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const [assetForm, setAssetForm] = useState({
    assetType: "mezzo" as AssetType,
    ownershipType: "proprieta" as OwnershipType,
    status: "attivo" as AssetStatus,
    category: "",
    brand: "",
    model: "",
    plate: "",
    vin: "",
    internalCode: "",
    serialNumber: "",
    registrationDate: "",
    siteId: "",
    subSiteId: "",
    rentalSupplier: "",
    rentalStartDate: "",
    rentalEndDate: "",
    notes: "",
  });

  const [assignForm, setAssignForm] = useState({
    assetId: "",
    employeeId: "",
    startDate: new Date().toISOString().slice(0, 10),
    note: "",
  });

  const [obligationForm, setObligationForm] = useState({
    nextDueDate: "",
    vendor: "",
    notes: "",
    doneDate: new Date().toISOString().slice(0, 10),
    nextDueAfterDone: "",
    eventNote: "",
  });

  async function loadAll() {
    setError("");
    try {
      const [assetsRes, obligationsRes, lookupsRes] =
        await Promise.all([
          fetch("/api/mezzi_attrezzature/assets"),
          fetch("/api/mezzi_attrezzature/obligations?dueInDays=365&includeMissing=1"),
          fetch("/api/mezzi_attrezzature/lookups"),
        ]);

      const assetsBody = (await assetsRes.json()) as { rows?: AssetRow[]; error?: string };
      if (!assetsRes.ok || assetsBody.error) throw new Error(assetsBody.error ?? "Errore caricamento asset.");
      setAssets(assetsBody.rows ?? []);

      const obligationsBody = (await obligationsRes.json()) as { rows?: ObligationRow[]; error?: string };
      if (!obligationsRes.ok || obligationsBody.error)
        throw new Error(obligationsBody.error ?? "Errore caricamento scadenze.");
      setObligations(obligationsBody.rows ?? []);

      const lookupsBody = (await lookupsRes.json()) as {
        sites?: LookupSite[];
        subSites?: LookupSubSite[];
        error?: string;
      };
      if (!lookupsRes.ok || lookupsBody.error) throw new Error(lookupsBody.error ?? "Errore caricamento cantieri.");
      setSites(lookupsBody.sites ?? []);
      setSubSites(lookupsBody.subSites ?? []);

      const nextEmployees: Array<{
        workerId: number;
        matricola: string;
        cognome: string;
        nome: string;
      }> = [];
      let employeeOffset = 0;
      let employeesTruncated = true;
      while (employeesTruncated) {
        const employeesRes = await fetch(`/api/lavoratori/anagrafica?limit=5000&offset=${employeeOffset}`);
        const employeesBody = (await employeesRes.json()) as {
          rows?: AnagraficaWorkerRow[];
          error?: string;
          truncated?: boolean;
        };
        if (!employeesRes.ok || employeesBody.error) {
          throw new Error(employeesBody.error ?? "Errore caricamento lavoratori.");
        }
        const chunk = (employeesBody.rows ?? []).map((r) => ({
          workerId: r.workerId,
          matricola: r.matricola,
          cognome: r.cognome,
          nome: r.nome,
        }));
        nextEmployees.push(...chunk);
        employeesTruncated = Boolean(employeesBody.truncated);
        employeeOffset += chunk.length;
        if (chunk.length === 0) break;
      }
      setEmployees(nextEmployees);

      // Caricamento assegnazioni attive
      const nextAssignments: AssignmentRow[] = [];
      let assignmentOffset = 0;
      let assignmentsTruncated = true;
      while (assignmentsTruncated) {
        const assignmentsRes = await fetch(
          `/api/mezzi_attrezzature/assignments?activeOnly=1&limit=5000&offset=${assignmentOffset}`,
        );
        const assignmentsBody = (await assignmentsRes.json()) as {
          rows?: AssignmentRow[];
          error?: string;
          truncated?: boolean;
        };
        if (!assignmentsRes.ok || assignmentsBody.error) {
          throw new Error(assignmentsBody.error ?? "Errore caricamento assegnazioni.");
        }
        const chunk = assignmentsBody.rows ?? [];
        nextAssignments.push(...chunk);
        assignmentsTruncated = Boolean(assignmentsBody.truncated);
        assignmentOffset += chunk.length;
        if (chunk.length === 0) break;
      }
      setAssignments(nextAssignments);

      // Caricamento assegnazioni storiche complete per la timeline
      const nextAllAssignments: AssignmentRow[] = [];
      let allAssignmentOffset = 0;
      let allAssignmentsTruncated = true;
      while (allAssignmentsTruncated) {
        const allAssignmentsRes = await fetch(
          `/api/mezzi_attrezzature/assignments?activeOnly=0&limit=5000&offset=${allAssignmentOffset}`,
        );
        const assignmentsBody = (await allAssignmentsRes.json()) as {
          rows?: AssignmentRow[];
          error?: string;
          truncated?: boolean;
        };
        if (!allAssignmentsRes.ok || assignmentsBody.error) {
          throw new Error(assignmentsBody.error ?? "Errore caricamento storico assegnazioni.");
        }
        const chunk = assignmentsBody.rows ?? [];
        nextAllAssignments.push(...chunk);
        allAssignmentsTruncated = Boolean(assignmentsBody.truncated);
        allAssignmentOffset += chunk.length;
        if (chunk.length === 0) break;
      }
      setAllAssignments(nextAllAssignments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento modulo.");
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => {
      const s = [
        a.assetType,
        a.ownershipType,
        a.status,
        a.category,
        a.brand,
        a.model,
        a.plate,
        a.internalCode,
        a.serialNumber,
        a.cantiere,
        a.sottocantiere,
      ]
        .join(" ")
        .toLowerCase();
      return s.includes(q);
    });
  }, [assets, search]);

  const filteredObligations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return obligations;
    return obligations.filter((o) => {
      const a = o.asset;
      const s = [
        o.obligationLabel,
        o.obligationCode,
        o.status,
        a?.plate ?? "",
        a?.internalCode ?? "",
        a?.serialNumber ?? "",
        a?.category ?? "",
        a?.brand ?? "",
        a?.model ?? "",
        a?.cantiere ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return s.includes(q);
    });
  }, [obligations, search]);

  const filteredAssignments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignments;
    return assignments.filter((a) => {
      const s = [
        a.employee?.cognome ?? "",
        a.employee?.nome ?? "",
        a.employee?.matricola ?? "",
        a.asset?.plate ?? "",
        a.asset?.internalCode ?? "",
        a.asset?.serialNumber ?? "",
        a.asset?.category ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return s.includes(q);
    });
  }, [assignments, search]);

  const subSiteOptions = useMemo(() => {
    const siteId = Number(assetForm.siteId);
    if (!Number.isFinite(siteId)) return subSites;
    return subSites.filter((s) => s.siteId === siteId);
  }, [assetForm.siteId, subSites]);

  async function createAsset() {
    setIsBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mezzi_attrezzature/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetType: assetForm.assetType,
          ownershipType: assetForm.ownershipType,
          status: assetForm.status,
          category: assetForm.category,
          brand: assetForm.brand,
          model: assetForm.model,
          plate: assetForm.plate,
          vin: assetForm.vin,
          internalCode: assetForm.internalCode,
          serialNumber: assetForm.serialNumber,
          registrationDate: assetForm.registrationDate || null,
          siteId: assetForm.siteId ? Number(assetForm.siteId) : null,
          subSiteId: assetForm.subSiteId ? Number(assetForm.subSiteId) : null,
          rentalSupplier: assetForm.rentalSupplier,
          rentalStartDate: assetForm.rentalStartDate || null,
          rentalEndDate: assetForm.rentalEndDate || null,
          notes: assetForm.notes,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore creazione asset.");
      setIsAssetModalOpen(false);
      setAssetForm((v) => ({
        ...v,
        category: "",
        brand: "",
        model: "",
        plate: "",
        vin: "",
        internalCode: "",
        serialNumber: "",
        registrationDate: "",
        siteId: "",
        subSiteId: "",
        rentalSupplier: "",
        rentalStartDate: "",
        rentalEndDate: "",
        notes: "",
      }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore creazione asset.");
    } finally {
      setIsBusy(false);
    }
  }

  async function createAssignment() {
    setIsBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mezzi_attrezzature/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: Number(assignForm.assetId),
          employeeId: Number(assignForm.employeeId),
          startDate: assignForm.startDate,
          note: assignForm.note,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore assegnazione.");
      setIsAssignModalOpen(false);
      setAssignForm((v) => ({ ...v, assetId: "", employeeId: "", note: "" }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore assegnazione.");
    } finally {
      setIsBusy(false);
    }
  }

  function openObligationModal(row: ObligationRow) {
    setSelectedObligation(row);
    setObligationForm({
      nextDueDate: row.nextDueDate ?? "",
      vendor: row.vendor ?? "",
      notes: row.notes ?? "",
      doneDate: new Date().toISOString().slice(0, 10),
      nextDueAfterDone: "",
      eventNote: "",
    });
    setIsObligationModalOpen(true);
  }

  async function updateObligation() {
    if (!selectedObligation) return;
    setIsBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mezzi_attrezzature/obligations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          obligationId: selectedObligation.obligationId,
          nextDueDate: obligationForm.nextDueDate || null,
          vendor: obligationForm.vendor,
          notes: obligationForm.notes,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore aggiornamento scadenza.");
      setIsObligationModalOpen(false);
      setSelectedObligation(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore aggiornamento scadenza.");
    } finally {
      setIsBusy(false);
    }
  }

  async function completeObligation() {
    if (!selectedObligation) return;
    setIsBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mezzi_attrezzature/obligations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          obligationId: selectedObligation.obligationId,
          doneDate: obligationForm.doneDate,
          nextDueDate: obligationForm.nextDueAfterDone || null,
          note: obligationForm.eventNote,
          vendor: obligationForm.vendor,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore registrazione.");
      setIsObligationModalOpen(false);
      setSelectedObligation(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore registrazione.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="theme-mezzi space-y-4 animate-tab-content">
      <ModuleHeader
        title="Mezzi e attrezzature"
        description="Registro asset (mezzi targati e attrezzature) con scadenze e assegnazioni ai lavoratori."
        actions={
          <>
            <button
              type="button"
              onClick={() => setIsAssetModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Nuovo asset
            </button>
            <button
              type="button"
              onClick={() => setIsAssignModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Assegna
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="tab-group">
            <button
              type="button"
              onClick={() => setTab("scadenze")}
              data-active={tab === "scadenze" ? "true" : undefined}
            >
              Scadenze
            </button>
            <button
              type="button"
              onClick={() => setTab("asset")}
              data-active={tab === "asset" ? "true" : undefined}
            >
              Asset
            </button>
            <button
              type="button"
              onClick={() => setTab("assegnazioni")}
              data-active={tab === "assegnazioni" ? "true" : undefined}
            >
              Assegnazioni
            </button>
            <button
              type="button"
              onClick={() => setTab("timeline")}
              data-active={tab === "timeline" ? "true" : undefined}
            >
              Timeline Assegnazioni
            </button>
          </div>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ricerca…"
            className="w-[320px] max-w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
          />
        </div>

        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
      </ModuleHeader>      {tab === "scadenze" ? (
        filteredObligations.length === 0 ? (
          <EmptyState
            title="Nessuna scadenza trovata"
            description="Non ci sono scadenze attive o registrate per il periodo selezionato che corrispondono alla ricerca."
            iconType="calendar"
          />
        ) : (
          <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
            <div className="max-h-[72vh] overflow-y-auto">
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "8%" }} />
                </colgroup>
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Asset</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Obbligo</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Scadenza</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Ultimo</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Stato</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2 text-right">Az.</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredObligations.map((row) => (
                    <tr
                      key={row.obligationId}
                      className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                    >
                      <td className="px-4 py-2.5 font-semibold text-slate-800">
                        {row.asset
                          ? assetLabel({
                              assetType: row.asset.assetType,
                              plate: row.asset.plate,
                              internalCode: row.asset.internalCode,
                              brand: row.asset.brand,
                              model: row.asset.model,
                            })
                          : "-"}
                        <div className="mt-1 text-[11px] font-medium text-slate-500">
                          {row.asset ? `${row.asset.cantiere} · ${row.asset.sottocantiere}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        <div className="font-semibold text-slate-800">{row.obligationLabel}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{row.vendor || ""}</div>
                      </td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums text-slate-800">
                        {formatDateIt(row.nextDueDate)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">
                        {formatDateIt(row.lastDoneDate)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={badgeClass(row.status)}>{row.status}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openObligationModal(row)}
                          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[var(--brand-primary)] px-3 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                        >
                          Gestisci
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      ) : null}
      {tab === "asset" ? (
        <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
          <div className="max-h-[72vh] overflow-y-auto">
            <table className="w-full table-fixed text-left text-xs">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Tipo</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Identificativo</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Categoria</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Cantiere</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Titolo</th>
                  <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Stato</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                  >
                    <td className="px-4 py-2.5 text-slate-700">
                      <div className="font-semibold text-slate-900">{row.assetType}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {row.ownershipType}
                        {row.ownershipType === "noleggio" && row.rentalEndDate
                          ? ` · fine ${formatDateIt(row.rentalEndDate)}`
                          : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">
                      {assetLabel(row)}
                      <div className="mt-1 text-[11px] font-medium text-slate-500">
                        {[row.brand, row.model].filter(Boolean).join(" ")}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <span className="block line-clamp-2" title={row.category || "-"}>
                        {row.category || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <span className="block line-clamp-2" title={`${row.cantiere} ${row.sottocantiere}`.trim()}>
                        {row.cantiere} · {row.sottocantiere}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.ownershipType}</td>
                    <td className="px-4 py-2.5 text-slate-700">{row.status}</td>
                  </tr>
                ))}
                {filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                      Nessun asset.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "assegnazioni" ? (
        filteredAssignments.length === 0 ? (
          <EmptyState
            title="Nessuna assegnazione attiva"
            description="Non sono presenti assegnazioni di veicoli o attrezzature ai dipendenti in corso."
            iconType="users"
          />
        ) : (
          <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
            <div className="max-h-[72vh] overflow-y-auto">
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Lavoratore</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Asset</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Inizio</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Fine</th>
                    <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-[var(--brand-line)] bg-white transition hover:bg-[var(--brand-panel)]/60"
                    >
                      <td className="px-4 py-2.5 text-slate-800">
                        <div className="font-semibold">
                          {row.employee ? `${row.employee.cognome} ${row.employee.nome}` : "-"}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {row.employee?.matricola ?? ""}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        <div className="font-semibold">
                          {row.asset
                            ? assetLabel({
                                assetType: row.asset.assetType,
                                plate: row.asset.plate,
                                internalCode: row.asset.internalCode,
                                brand: row.asset.brand,
                                model: row.asset.model,
                              })
                            : "-"}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {row.asset ? `${row.asset.cantiere} · ${row.asset.sottocantiere}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums text-slate-700">
                        {formatDateIt(row.startDate)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">
                        {formatDateIt(row.endDate)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <span className="block line-clamp-2" title={row.note || ""}>
                          {row.note || "-"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      ) : null}

      {/* TIMELINE / GANTT TAB */}
      {tab === "timeline" ? (() => {
        // Calcolo giorni del mese selezionato
        const year = timelineDate.getFullYear();
        const month = timelineDate.getMonth(); // 0-indexed
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        
        const getDayIso = (dayNum: number) => {
          const y = String(year);
          const m = String(month + 1).padStart(2, "0");
          const d = String(dayNum).padStart(2, "0");
          return `${y}-${m}-${d}`;
        };

        const weekdayLabel = (dayNum: number) => {
          const d = new Date(year, month, dayNum);
          return ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"][d.getDay()];
        };

        const isWeekend = (dayNum: number) => {
          const d = new Date(year, month, dayNum);
          const w = d.getDay();
          return w === 0 || w === 6;
        };

        const isToday = (dayNum: number) => {
          const today = new Date();
          return today.getDate() === dayNum && today.getMonth() === month && today.getFullYear() === year;
        };

        const monthNames = [
          "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
          "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
        ];

        // Filtra gli asset correnti
        const query = search.trim().toLowerCase();
        const timelineAssets = assets.filter((a) => {
          if (!query) return true;
          const s = [
            a.assetType,
            a.ownershipType,
            a.status,
            a.category,
            a.brand,
            a.model,
            a.plate,
            a.internalCode,
            a.cantiere,
            a.sottocantiere
          ].join(" ").toLowerCase();
          return s.includes(query);
        });

        const handlePrevMonth = () => {
          setTimelineDate(new Date(year, month - 1, 1));
        };

        const handleNextMonth = () => {
          setTimelineDate(new Date(year, month + 1, 1));
        };

        return (
          <div className="space-y-4 animate-tab-content">
            {/* Controlli Timeline */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--brand-panel)] border border-[var(--brand-line)] p-3 rounded-2xl">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  data-soft="true"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-[var(--brand-line)] text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  ←
                </button>
                <div className="min-w-[150px] text-center font-bold text-slate-800 text-sm">
                  {monthNames[month]} {year}
                </div>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  data-soft="true"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-[var(--brand-line)] text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  →
                </button>
              </div>

              {/* Legenda */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-5 rounded-md bg-gradient-to-r from-blue-500 to-indigo-500 border border-indigo-600/25" />
                  <span>Assegnazione</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-5 rounded-md bg-[amber-50] border border-dashed border-amber-300" />
                  <span>Disponibilità Noleggio</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[9px]">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  <span>Scaduto</span>
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>In Scadenza</span>
                </div>
              </div>
            </div>

            {/* Griglia Gantt */}
            {timelineAssets.length === 0 ? (
              <EmptyState
                title="Nessun asset corrispondente"
                description="Modifica i filtri o la ricerca per visualizzare la timeline dei mezzi e attrezzature."
                iconType="search"
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[var(--brand-line)] bg-white shadow-sm">
                <div 
                  className="min-w-[1300px]"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `260px repeat(${daysInMonth}, minmax(40px, 1fr))`
                  }}
                >
                  {/* Riga Header: Giorno del mese */}
                  <div className="sticky left-0 z-30 bg-slate-50 border-b border-r border-[var(--brand-line)] px-4 py-2 text-xs font-bold text-slate-800 flex items-center">
                    Asset
                  </div>
                  {daysArray.map((day) => {
                    const weekend = isWeekend(day);
                    const today = isToday(day);
                    return (
                      <div
                        key={`h-day-${day}`}
                        className={`text-center py-1.5 text-xs font-bold border-b border-r border-[var(--brand-line)] flex flex-col justify-center items-center ${
                          today ? "bg-blue-50 text-blue-700" : weekend ? "bg-slate-100/60 text-slate-500" : "bg-slate-50 text-slate-700"
                        }`}
                      >
                        <span>{day}</span>
                        <span className="text-[10px] opacity-75 font-medium uppercase">{weekdayLabel(day)[0]}</span>
                      </div>
                    );
                  })}

                  {/* Righe degli Asset */}
                  {timelineAssets.map((asset) => {
                    // Calcolo assegnazioni di questo asset
                    const assetAssigns = allAssignments.filter((a) => a.assetId === asset.id);
                    // Calcolo obblighi di questo asset
                    const assetObligations = obligations.filter((o) => o.assetId === asset.id);

                    return (
                      <div
                        key={`row-asset-${asset.id}`}
                        style={{ display: "contents" }}
                      >
                        {/* Colonna Sticky Asset */}
                        <div className="sticky left-0 z-20 bg-white border-b border-r border-[var(--brand-line)] p-3 flex flex-col justify-center min-h-[64px] shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase leading-none ${
                              asset.assetType === "mezzo" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-purple-50 text-purple-700 border border-purple-200"
                            }`}>
                              {asset.assetType === "mezzo" ? "Mezzo" : "Attrezzatura"}
                            </span>
                            <span className="text-xs font-bold text-slate-900 tracking-tight">
                              {assetLabel(asset)}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-700 font-semibold mt-1">
                            {[asset.brand, asset.model].filter(Boolean).join(" ")}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                            {asset.cantiere || "Nessun cantiere"}
                          </div>
                        </div>

                        {/* Celle della Timeline */}
                        {daysArray.map((day) => {
                          const dayIso = getDayIso(day);
                          const weekend = isWeekend(day);
                          const today = isToday(day);

                          // Controlla se la data è fuori dal noleggio (se l'asset è a noleggio)
                          let isOutOfRental = false;
                          let isRentalActive = false;
                          if (asset.ownershipType === "noleggio") {
                            const rentStart = asset.rentalStartDate;
                            const rentEnd = asset.rentalEndDate;
                            if (rentStart && dayIso < rentStart) isOutOfRental = true;
                            if (rentEnd && dayIso > rentEnd) isOutOfRental = true;
                            if (!isOutOfRental) isRentalActive = true;
                          }

                          // Cerca scadenze in questo giorno
                          const obligationsDueToday = assetObligations.filter((o) => o.nextDueDate === dayIso);

                          return (
                            <div
                              key={`cell-${asset.id}-${day}`}
                              className={`relative border-b border-r border-[var(--brand-line)] flex items-center justify-center transition-colors min-h-[64px] ${
                                today ? "bg-blue-50/15" : weekend ? "bg-slate-50/30" : "bg-white"
                              } ${
                                isOutOfRental ? "bg-[repeating-linear-gradient(-45deg,#f1f5f9,#f1f5f9_4px,#f8fafc_4px,#f8fafc_8px)] opacity-50" : ""
                              } ${
                                isRentalActive ? "bg-amber-50/20" : ""
                              }`}
                            >
                              {/* Eventuali indicatori scadenze obblighi */}
                              {obligationsDueToday.length > 0 && (
                                <div className="absolute top-1 right-1 z-10 flex gap-0.5">
                                  {obligationsDueToday.map((ob, idx) => {
                                    const dotColor = ob.status === "scaduto" ? "bg-red-500 animate-pulse" : "bg-amber-500";
                                    return (
                                      <div
                                        key={idx}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openObligationModal(ob);
                                        }}
                                        className={`h-2.5 w-2.5 rounded-full cursor-pointer border border-white shadow-sm ${dotColor}`}
                                        title={`Scadenza: ${ob.obligationLabel} (${formatDateIt(ob.nextDueDate)})`}
                                      />
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Overlay delle Assegnazioni di questo Asset */}
                        {assetAssigns.map((assign) => {
                          const startIso = assign.startDate;
                          const endIso = assign.endDate ?? "9999-12-31";
                          
                          // Verifica se l'assegnazione si sovrappone al mese correntemente visualizzato
                          const monthStartIso = getDayIso(1);
                          const monthEndIso = getDayIso(daysInMonth);
                          
                          if (startIso > monthEndIso || endIso < monthStartIso) return null;

                          // Calcola le colonne di inizio e fine
                          const startDay = startIso < monthStartIso ? 1 : Number(startIso.slice(8, 10));
                          const endDay = endIso > monthEndIso ? daysInMonth : Number(endIso.slice(8, 10));

                          const startCol = startDay + 1; // +1 per colonna asset
                          const endCol = endDay + 2; // +2 per posizionamento grid esclusivo

                          const startsOutside = startIso < monthStartIso;
                          const endsOutside = endIso > monthEndIso;

                          const label = assign.employee ? `${assign.employee.cognome} ${assign.employee.nome}` : "Assegnato";

                          return (
                            <div
                              key={`assign-bar-${assign.id}`}
                              onClick={() => {
                                setSelectedAssignmentDetail(assign);
                                setIsDetailModalOpen(true);
                              }}
                              className="self-center h-8 mx-1 z-10 rounded-lg shadow-sm border text-white font-bold text-[11px] flex items-center justify-between px-2 cursor-pointer transition select-none overflow-hidden bg-gradient-to-r from-blue-600 to-indigo-600 border-indigo-700 hover:brightness-105 active:scale-[0.98]"
                              style={{
                                gridRow: `row-asset-${asset.id}`,
                                gridColumnStart: startCol,
                                gridColumnEnd: endCol,
                                marginTop: "16px",
                                marginBottom: "16px",
                                transform: "translateY(-4px)"
                              }}
                              title={`${label} (${formatDateIt(assign.startDate)} - ${formatDateIt(assign.endDate)})`}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                {startsOutside && <span className="opacity-75">◀</span>}
                                <span className="truncate">{label}</span>
                              </div>
                              {endsOutside && <span className="opacity-75">▶</span>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Modale Dettagli Assegnazione */}
            {isDetailModalOpen && selectedAssignmentDetail && (
              <Modal 
                title="Dettagli Assegnazione Mezzo" 
                onClose={() => {
                  setIsDetailModalOpen(false);
                  setSelectedAssignmentDetail(null);
                }}
              >
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4 space-y-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lavoratore</div>
                      <div className="text-sm font-bold text-slate-800">
                        {selectedAssignmentDetail.employee ? `${selectedAssignmentDetail.employee.cognome} ${selectedAssignmentDetail.employee.nome}` : "-"}
                      </div>
                      <div className="text-xs text-slate-500">Matricola: {selectedAssignmentDetail.employee?.matricola}</div>
                    </div>

                    <div className="border-t border-[var(--brand-line)] pt-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mezzo / Attrezzatura</div>
                      <div className="text-sm font-bold text-slate-800">
                        {selectedAssignmentDetail.asset ? assetLabel(selectedAssignmentDetail.asset) : "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {selectedAssignmentDetail.asset ? `${selectedAssignmentDetail.asset.brand} ${selectedAssignmentDetail.asset.model}` : ""}
                      </div>
                    </div>

                    <div className="border-t border-[var(--brand-line)] pt-2 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Data Inizio</div>
                        <div className="text-sm font-bold text-slate-700">{formatDateIt(selectedAssignmentDetail.startDate)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Data Fine</div>
                        <div className="text-sm font-bold text-slate-700">{formatDateIt(selectedAssignmentDetail.endDate)}</div>
                      </div>
                    </div>

                    {selectedAssignmentDetail.note && (
                      <div className="border-t border-[var(--brand-line)] pt-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Note</div>
                        <div className="text-xs text-slate-600 bg-white p-2 rounded-lg border border-[var(--brand-line)] mt-1">{selectedAssignmentDetail.note}</div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    {!selectedAssignmentDetail.endDate && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm("Sei sicuro di voler terminare questa assegnazione oggi?")) return;
                          setIsBusy(true);
                          setError("");
                          try {
                            const today = new Date().toISOString().slice(0, 10);
                            const res = await fetch("/api/mezzi_attrezzature/assignments", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                assignmentId: selectedAssignmentDetail.id,
                                endDate: today
                              })
                            });
                            const body = await res.json();
                            if (!res.ok || body.error) throw new Error(body.error ?? "Errore chiusura assegnazione.");
                            setIsDetailModalOpen(false);
                            setSelectedAssignmentDetail(null);
                            await loadAll();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Errore chiusura assegnazione.");
                          } finally {
                            setIsBusy(false);
                          }
                        }}
                        data-unstyled="true"
                        disabled={isBusy}
                        className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 shadow-sm transition hover:bg-red-100 disabled:opacity-60"
                      >
                        Termina Assegnazione Oggi
                      </button>
                    )}
                    <button
                      type="button"
                      data-unstyled="true"
                      onClick={() => {
                        setIsDetailModalOpen(false);
                        setSelectedAssignmentDetail(null);
                      }}
                      className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 ml-auto"
                    >
                      Chiudi
                    </button>
                  </div>
                </div>
              </Modal>
            )}
          </div>
        );
      })() : null}

      {isAssetModalOpen ? (
        <Modal title="Nuovo asset" onClose={() => setIsAssetModalOpen(false)}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)]/25 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Identità
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Tipo asset">
              <select
                value={assetForm.assetType}
                onChange={(e) => {
                  const next = e.target.value as AssetType;
                  setAssetForm((v) => ({
                    ...v,
                    assetType: next,
                    plate: next === "mezzo" ? v.plate : "",
                  }));
                }}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="mezzo">Mezzo (targato)</option>
                <option value="attrezzatura">Attrezzatura</option>
              </select>
            </Field>
                <Field label="Proprietà / noleggio">
              <select
                value={assetForm.ownershipType}
                onChange={(e) => {
                  const next = e.target.value as OwnershipType;
                  setAssetForm((v) => ({
                    ...v,
                    ownershipType: next,
                    rentalSupplier: next === "noleggio" ? v.rentalSupplier : "",
                    rentalStartDate: next === "noleggio" ? v.rentalStartDate : "",
                    rentalEndDate: next === "noleggio" ? v.rentalEndDate : "",
                  }));
                }}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="proprieta">Proprietà</option>
                <option value="noleggio">Noleggio</option>
              </select>
            </Field>
                <Field label="Stato asset">
              <select
                value={assetForm.status}
                onChange={(e) => setAssetForm((v) => ({ ...v, status: e.target.value as AssetStatus }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="attivo">Attivo</option>
                <option value="fuori_servizio">Fuori servizio</option>
                <option value="dismesso">Dismesso</option>
              </select>
            </Field>
                <Field label="Categoria">
              <input
                value={assetForm.category}
                onChange={(e) => setAssetForm((v) => ({ ...v, category: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                placeholder="Es. Furgone, PLE, Carrello elevatore…"
              />
            </Field>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Dati tecnici e collocazione
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Marca">
              <input
                value={assetForm.brand}
                onChange={(e) => setAssetForm((v) => ({ ...v, brand: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
                <Field label="Modello">
              <input
                value={assetForm.model}
                onChange={(e) => setAssetForm((v) => ({ ...v, model: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
                <Field label={assetForm.assetType === "mezzo" ? "Targa (mezzi targati)" : "Targa (non applicabile)"}>
              <input
                value={assetForm.plate}
                onChange={(e) => setAssetForm((v) => ({ ...v, plate: e.target.value.toUpperCase() }))}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm",
                  assetForm.assetType === "mezzo"
                    ? "border-[var(--brand-line)] bg-white text-slate-900"
                    : "border-[var(--brand-line)] bg-slate-50 text-slate-400",
                ].join(" ")}
                disabled={assetForm.assetType !== "mezzo"}
              />
            </Field>
                <Field label="Codice interno">
              <input
                value={assetForm.internalCode}
                onChange={(e) => setAssetForm((v) => ({ ...v, internalCode: e.target.value.toUpperCase() }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
                <Field label="Seriale">
              <input
                value={assetForm.serialNumber}
                onChange={(e) => setAssetForm((v) => ({ ...v, serialNumber: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
                <Field label={assetForm.assetType === "mezzo" ? "Telaio (VIN)" : "Telaio/identificativo tecnico"}>
              <input
                value={assetForm.vin}
                onChange={(e) => setAssetForm((v) => ({ ...v, vin: e.target.value.toUpperCase() }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
                <Field label={assetForm.assetType === "mezzo" ? "Data immatricolazione" : "Data acquisto / entrata"}>
              <ItDateInput
                valueIso={assetForm.registrationDate}
                onChangeIso={(valueIso) => setAssetForm((v) => ({ ...v, registrationDate: valueIso }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
                <Field label="Cantiere">
              <select
                value={assetForm.siteId}
                onChange={(e) => setAssetForm((v) => ({ ...v, siteId: e.target.value, subSiteId: "" }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="">-</option>
                {sites.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
                <Field label="Sottocantiere">
              <select
                value={assetForm.subSiteId}
                onChange={(e) => setAssetForm((v) => ({ ...v, subSiteId: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="">-</option>
                {subSiteOptions.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
              </div>
            </div>

            <div
              className={[
                "rounded-2xl border p-4",
                assetForm.ownershipType === "noleggio"
                  ? "border-[var(--brand-line)] bg-white"
                  : "border-[var(--brand-line)] bg-slate-50 text-slate-400",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  Noleggio
                </div>
                <div className="text-xs text-slate-500">
                  {assetForm.ownershipType === "noleggio"
                    ? "Compila i dati contratto."
                    : "Seleziona “Noleggio” per abilitarli."}
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Fornitore noleggio">
              <input
                value={assetForm.rentalSupplier}
                onChange={(e) => setAssetForm((v) => ({ ...v, rentalSupplier: e.target.value }))}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm",
                  assetForm.ownershipType === "noleggio"
                    ? "border-[var(--brand-line)] bg-white text-slate-900"
                    : "border-[var(--brand-line)] bg-slate-50 text-slate-400",
                ].join(" ")}
                disabled={assetForm.ownershipType !== "noleggio"}
              />
            </Field>
                <Field label="Inizio contratto">
              <ItDateInput
                valueIso={assetForm.rentalStartDate}
                onChangeIso={(valueIso) => setAssetForm((v) => ({ ...v, rentalStartDate: valueIso }))}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm",
                  assetForm.ownershipType === "noleggio"
                    ? "border-[var(--brand-line)] bg-white text-slate-900"
                    : "border-[var(--brand-line)] bg-slate-50 text-slate-400",
                ].join(" ")}
                disabled={assetForm.ownershipType !== "noleggio"}
              />
            </Field>
                <Field label="Fine contratto">
              <ItDateInput
                valueIso={assetForm.rentalEndDate}
                onChangeIso={(valueIso) => setAssetForm((v) => ({ ...v, rentalEndDate: valueIso }))}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-sm",
                  assetForm.ownershipType === "noleggio"
                    ? "border-[var(--brand-line)] bg-white text-slate-900"
                    : "border-[var(--brand-line)] bg-slate-50 text-slate-400",
                ].join(" ")}
                disabled={assetForm.ownershipType !== "noleggio"}
              />
            </Field>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Note
              </div>
              <div className="mt-3">
                <Field label="Note asset">
              <input
                value={assetForm.notes}
                onChange={(e) => setAssetForm((v) => ({ ...v, notes: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
              </div>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              data-unstyled="true"
              onClick={() => setIsAssetModalOpen(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              disabled={isBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void createAsset()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={isBusy}
            >
              {isBusy ? "Salvataggio…" : "Crea"}
            </button>
          </div>
        </Modal>
      ) : null}

      {isAssignModalOpen ? (
        <Modal title="Assegna asset a lavoratore" onClose={() => setIsAssignModalOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Asset">
              <select
                value={assignForm.assetId}
                onChange={(e) => setAssignForm((v) => ({ ...v, assetId: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="">Seleziona…</option>
                {assets.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {assetLabel(a)} · {a.category || "-"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lavoratore">
              <select
                value={assignForm.employeeId}
                onChange={(e) => setAssignForm((v) => ({ ...v, employeeId: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              >
                <option value="">Seleziona…</option>
                {employees.map((e) => (
                  <option key={e.workerId} value={String(e.workerId)}>
                    {e.cognome} {e.nome} · {e.matricola}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data inizio">
              <ItDateInput
                valueIso={assignForm.startDate}
                onChangeIso={(valueIso) => setAssignForm((v) => ({ ...v, startDate: valueIso }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Note">
              <input
                value={assignForm.note}
                onChange={(e) => setAssignForm((v) => ({ ...v, note: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              data-unstyled="true"
              onClick={() => setIsAssignModalOpen(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              disabled={isBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void createAssignment()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={isBusy || !assignForm.assetId || !assignForm.employeeId}
            >
              {isBusy ? "Salvataggio…" : "Assegna"}
            </button>
          </div>
        </Modal>
      ) : null}

      {isObligationModalOpen && selectedObligation ? (
        <Modal title="Gestisci scadenza" onClose={() => setIsObligationModalOpen(false)}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-panel)]/35 p-4">
              <div className="text-sm font-bold text-[var(--brand-ink)]">
                {selectedObligation.asset
                  ? assetLabel({
                      assetType: selectedObligation.asset.assetType,
                      plate: selectedObligation.asset.plate,
                      internalCode: selectedObligation.asset.internalCode,
                      brand: selectedObligation.asset.brand,
                      model: selectedObligation.asset.model,
                    })
                  : "-"}
              </div>
              <div className="mt-1 text-xs text-slate-500">{selectedObligation.obligationLabel}</div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Prossima scadenza">
                <ItDateInput
                  valueIso={obligationForm.nextDueDate}
                  onChangeIso={(valueIso) => setObligationForm((v) => ({ ...v, nextDueDate: valueIso }))}
                  className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Verificatore / fornitore">
                <input
                  value={obligationForm.vendor}
                  onChange={(e) => setObligationForm((v) => ({ ...v, vendor: e.target.value }))}
                  className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Note scadenza">
                <input
                  value={obligationForm.notes}
                  onChange={(e) => setObligationForm((v) => ({ ...v, notes: e.target.value }))}
                  className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm md:col-span-2"
                />
              </Field>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void updateObligation()}
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
                disabled={isBusy}
              >
                Salva
              </button>
            </div>

            <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
              <div className="text-sm font-bold text-[var(--brand-ink)]">Registra eseguito</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Data esecuzione">
                  <ItDateInput
                    valueIso={obligationForm.doneDate}
                    onChangeIso={(valueIso) => setObligationForm((v) => ({ ...v, doneDate: valueIso }))}
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Prossima scadenza (post eseguito)">
                  <ItDateInput
                    valueIso={obligationForm.nextDueAfterDone}
                    onChangeIso={(valueIso) => setObligationForm((v) => ({ ...v, nextDueAfterDone: valueIso }))}
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Note evento">
                  <input
                    value={obligationForm.eventNote}
                    onChange={(e) => setObligationForm((v) => ({ ...v, eventNote: e.target.value }))}
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm md:col-span-2"
                  />
                </Field>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void completeObligation()}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
                  disabled={isBusy || !obligationForm.doneDate}
                >
                  {isBusy ? "Salvataggio…" : "Registra"}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-5 py-4">
          <h2 className="text-lg font-bold text-[var(--brand-ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
            title="Chiudi"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      {children}
    </label>
  );
}
