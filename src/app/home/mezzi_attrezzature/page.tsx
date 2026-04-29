"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ModuleHeader } from "@/components/module-ui";

type TabKey = "scadenze" | "asset" | "assegnazioni";

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
  if (status === "scaduto") return `${base} border-red-200 bg-red-50 text-red-700`;
  if (status === "in scadenza") return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  if (status === "ok") return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  return `${base} border-slate-200 bg-slate-50 text-slate-700`;
}

export default function HomeMezziPage() {
  const [tab, setTab] = useState<TabKey>("scadenze");
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [obligations, setObligations] = useState<ObligationRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
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
      const [assetsRes, obligationsRes, employeesRes, lookupsRes, assignmentsRes] =
        await Promise.all([
          fetch("/api/mezzi_attrezzature/assets"),
          fetch("/api/mezzi_attrezzature/obligations?dueInDays=60&includeMissing=1"),
          fetch("/api/lavoratori/anagrafica"),
          fetch("/api/mezzi_attrezzature/lookups"),
          fetch("/api/mezzi_attrezzature/assignments?activeOnly=1"),
        ]);

      const assetsBody = (await assetsRes.json()) as { rows?: AssetRow[]; error?: string };
      if (!assetsRes.ok || assetsBody.error) throw new Error(assetsBody.error ?? "Errore caricamento asset.");
      setAssets(assetsBody.rows ?? []);

      const obligationsBody = (await obligationsRes.json()) as { rows?: ObligationRow[]; error?: string };
      if (!obligationsRes.ok || obligationsBody.error)
        throw new Error(obligationsBody.error ?? "Errore caricamento scadenze.");
      setObligations(obligationsBody.rows ?? []);

      const employeesBody = (await employeesRes.json()) as { rows?: AnagraficaWorkerRow[]; error?: string };
      if (!employeesRes.ok || employeesBody.error)
        throw new Error(employeesBody.error ?? "Errore caricamento lavoratori.");
      setEmployees(
        (employeesBody.rows ?? []).map((r) => ({
          workerId: r.workerId,
          matricola: r.matricola,
          cognome: r.cognome,
          nome: r.nome,
        })),
      );

      const lookupsBody = (await lookupsRes.json()) as {
        sites?: LookupSite[];
        subSites?: LookupSubSite[];
        error?: string;
      };
      if (!lookupsRes.ok || lookupsBody.error) throw new Error(lookupsBody.error ?? "Errore caricamento cantieri.");
      setSites(lookupsBody.sites ?? []);
      setSubSites(lookupsBody.subSites ?? []);

      const assignmentsBody = (await assignmentsRes.json()) as { rows?: AssignmentRow[]; error?: string };
      if (!assignmentsRes.ok || assignmentsBody.error)
        throw new Error(assignmentsBody.error ?? "Errore caricamento assegnazioni.");
      setAssignments(assignmentsBody.rows ?? []);
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
    <div className="space-y-4">
      <ModuleHeader
        title="Mezzi e attrezzature"
        description="Registro asset (mezzi targati e attrezzature) con scadenze e assegnazioni ai lavoratori."
        actions={
          <>
            <button
              type="button"
              onClick={() => setIsAssetModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Nuovo asset
            </button>
            <button
              type="button"
              onClick={() => setIsAssignModalOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
            >
              Assegna
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full bg-white p-1 ring-1 ring-[var(--brand-line)]">
            <button
              type="button"
              onClick={() => setTab("scadenze")}
              className={[
                "min-h-9 rounded-full px-4 text-sm font-semibold transition",
                tab === "scadenze"
                  ? "bg-[var(--brand-primary)] text-white"
                  : "text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              Scadenze
            </button>
            <button
              type="button"
              onClick={() => setTab("asset")}
              className={[
                "min-h-9 rounded-full px-4 text-sm font-semibold transition",
                tab === "asset"
                  ? "bg-[var(--brand-primary)] text-white"
                  : "text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              Asset
            </button>
            <button
              type="button"
              onClick={() => setTab("assegnazioni")}
              className={[
                "min-h-9 rounded-full px-4 text-sm font-semibold transition",
                tab === "assegnazioni"
                  ? "bg-[var(--brand-primary)] text-white"
                  : "text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              Assegnazioni
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
      </ModuleHeader>

      {tab === "scadenze" ? (
        <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-white">
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
                {filteredObligations.map((row, idx) => (
                  <tr
                    key={row.obligationId}
                    className={[
                      "border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60",
                      idx % 2 === 1 ? "bg-[var(--brand-panel)]/25" : "bg-white",
                    ].join(" ")}
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
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--brand-line)] bg-white px-3 text-xs font-semibold text-[var(--brand-ink)] transition hover:bg-[var(--brand-panel)]"
                      >
                        Gestisci
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredObligations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                      Nessuna scadenza trovata.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "asset" ? (
        <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-white">
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
                {filteredAssets.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={[
                      "border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60",
                      idx % 2 === 1 ? "bg-[var(--brand-panel)]/25" : "bg-white",
                    ].join(" ")}
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
        <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-white">
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
                {filteredAssignments.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={[
                      "border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60",
                      idx % 2 === 1 ? "bg-[var(--brand-panel)]/25" : "bg-white",
                    ].join(" ")}
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
                {filteredAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                      Nessuna assegnazione.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
              <input
                type="date"
                value={assetForm.registrationDate}
                onChange={(e) => setAssetForm((v) => ({ ...v, registrationDate: e.target.value }))}
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
              <input
                type="date"
                value={assetForm.rentalStartDate}
                onChange={(e) => setAssetForm((v) => ({ ...v, rentalStartDate: e.target.value }))}
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
              <input
                type="date"
                value={assetForm.rentalEndDate}
                onChange={(e) => setAssetForm((v) => ({ ...v, rentalEndDate: e.target.value }))}
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
              onClick={() => setIsAssetModalOpen(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              disabled={isBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void createAsset()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
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
              <input
                type="date"
                value={assignForm.startDate}
                onChange={(e) => setAssignForm((v) => ({ ...v, startDate: e.target.value }))}
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
              onClick={() => setIsAssignModalOpen(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              disabled={isBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void createAssignment()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
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
                <input
                  type="date"
                  value={obligationForm.nextDueDate}
                  onChange={(e) => setObligationForm((v) => ({ ...v, nextDueDate: e.target.value }))}
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
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--brand-line)] bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                disabled={isBusy}
              >
                Salva
              </button>
            </div>

            <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
              <div className="text-sm font-bold text-[var(--brand-ink)]">Registra eseguito</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Data esecuzione">
                  <input
                    type="date"
                    value={obligationForm.doneDate}
                    onChange={(e) => setObligationForm((v) => ({ ...v, doneDate: e.target.value }))}
                    className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Prossima scadenza (post eseguito)">
                  <input
                    type="date"
                    value={obligationForm.nextDueAfterDone}
                    onChange={(e) => setObligationForm((v) => ({ ...v, nextDueAfterDone: e.target.value }))}
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
                  className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
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
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--brand-line)] bg-white text-slate-600 transition hover:bg-slate-50"
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
