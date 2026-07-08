"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ModuleHeader } from "@/components/module-ui";

type Mansione = {
  key: string;
  code: string;
  description: string;
};

type DpiItem = {
  id: number;
  title: string;
  riskActivities: string;
  category: string;
  controlFrequency: string;
  controlType: string;
};

export default function DpiMatricePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [mansioni, setMansioni] = useState<Mansione[]>([]);
  const [dpiItems, setDpiItems] = useState<DpiItem[]>([]);
  const [requiredByJob, setRequiredByJob] = useState<Record<string, number[]>>({});

  const [searchMansione, setSearchMansione] = useState("");
  const [searchDpi, setSearchDpi] = useState("");

  const [isSavingKey, setIsSavingKey] = useState<string | null>(null);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editDpiId, setEditDpiId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    riskActivities: "",
    category: "",
    controlFrequency: "",
    controlType: "",
  });
  const [isEditBusy, setIsEditBusy] = useState(false);

  const tableRef = useRef<HTMLTableElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollTopRef = useRef<HTMLDivElement | null>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  function syncHorizontalScroll(source: "top" | "middle") {
    if (!tableScrollTopRef.current || !tableScrollRef.current) return;
    if (source === "top") {
      tableScrollRef.current.scrollLeft = tableScrollTopRef.current.scrollLeft;
    } else {
      tableScrollTopRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  }

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError("");
      setWarning("");
      try {
        const response = await fetch("/api/dpi/matrice");
        const body = (await response.json()) as {
          mansioni?: Mansione[];
          dpiItems?: DpiItem[];
          requiredByJob?: Record<string, number[]>;
          warning?: string;
          error?: string;
        };
        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Errore caricamento matrice DPI.");
        }
        setMansioni(body.mansioni ?? []);
        setDpiItems(body.dpiItems ?? []);
        setRequiredByJob(body.requiredByJob ?? {});
        setWarning(body.warning ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore caricamento matrice DPI.");
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    const width = tableRef.current?.scrollWidth ?? 0;
    setTableScrollWidth(width);
  }, [mansioni, dpiItems, requiredByJob]);

  const filteredMansioni = useMemo(() => {
    const q = searchMansione.trim().toLowerCase();
    if (!q) return mansioni;
    return mansioni.filter((m) => {
      const s = `${m.code} ${m.description}`.toLowerCase();
      return s.includes(q);
    });
  }, [mansioni, searchMansione]);

  const filteredDpiItems = useMemo(() => {
    const q = searchDpi.trim().toLowerCase();
    if (!q) return dpiItems;
    return dpiItems.filter((d) => {
      const s = `${d.title} ${d.category} ${d.riskActivities} ${d.controlFrequency} ${d.controlType}`.toLowerCase();
      return s.includes(q);
    });
  }, [dpiItems, searchDpi]);

  const requiredSet = useMemo(() => {
    const set = new Set<string>();
    for (const [jobKey, ids] of Object.entries(requiredByJob)) {
      for (const id of ids ?? []) {
        set.add(`${id}:${jobKey}`);
      }
    }
    return set;
  }, [requiredByJob]);

  function openEdit(dpi: DpiItem) {
    setError("");
    setEditDpiId(dpi.id);
    setEditForm({
      title: dpi.title ?? "",
      riskActivities: dpi.riskActivities ?? "",
      category: dpi.category ?? "",
      controlFrequency: dpi.controlFrequency ?? "",
      controlType: dpi.controlType ?? "",
    });
    setIsEditOpen(true);
  }

  async function saveEdit() {
    if (!editDpiId) return;
    setIsEditBusy(true);
    setError("");
    try {
      const response = await fetch("/api/dpi/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editDpiId,
          title: editForm.title,
          riskActivities: editForm.riskActivities,
          category: editForm.category,
          controlFrequency: editForm.controlFrequency,
          controlType: editForm.controlType,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore modifica DPI.");
      }

      setDpiItems((prev) =>
        prev.map((d) =>
          d.id === editDpiId
            ? {
                ...d,
                title: editForm.title.trim(),
                riskActivities: editForm.riskActivities.trim(),
                category: editForm.category.trim(),
                controlFrequency: editForm.controlFrequency.trim(),
                controlType: editForm.controlType.trim(),
              }
            : d,
        ),
      );

      setIsEditOpen(false);
      setEditDpiId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore modifica DPI.");
    } finally {
      setIsEditBusy(false);
    }
  }

  async function toggleRequired(dpiId: number, mansione: Mansione) {
    const key = `${dpiId}:${mansione.key}`;
    const was = requiredSet.has(key);
    const next = !was;

    setRequiredByJob((prev) => {
      const current = prev[mansione.key] ?? [];
      const nextIds = next
        ? Array.from(new Set([...current, dpiId]))
        : current.filter((id) => id !== dpiId);
      return { ...prev, [mansione.key]: nextIds };
    });

    setIsSavingKey(key);
    try {
      const response = await fetch("/api/dpi/matrice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobCode: mansione.code,
          dpiId,
          isRequired: next,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore salvataggio matrice DPI.");
      }
    } catch (err) {
      setRequiredByJob((prev) => {
        const current = prev[mansione.key] ?? [];
        const rollbackIds = was
          ? Array.from(new Set([...current, dpiId]))
          : current.filter((id) => id !== dpiId);
        return { ...prev, [mansione.key]: rollbackIds };
      });
      setError(err instanceof Error ? err.message : "Errore salvataggio matrice DPI.");
    } finally {
      setIsSavingKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Matrice DPI"
        description="DPI in riga e mansioni in colonna. Spunta per rendere il DPI richiesto per quella mansione."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={searchDpi}
            onChange={(e) => setSearchDpi(e.target.value)}
            placeholder="Filtra DPI…"
            className="w-[320px] max-w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
          />
          <input
            value={searchMansione}
            onChange={(e) => setSearchMansione(e.target.value)}
            placeholder="Filtra mansioni…"
            className="w-[320px] max-w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
          />
        </div>
        {warning ? <p className="mt-2 text-xs font-semibold text-amber-700">{warning}</p> : null}
        {error ? <p className="mt-2 text-xs font-semibold text-red-600">{error}</p> : null}
      </ModuleHeader>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
        <div
          ref={tableScrollTopRef}
          onScroll={() => syncHorizontalScroll("top")}
          className="overflow-x-auto border-b border-[var(--brand-line)]"
        >
          <div style={{ width: tableScrollWidth, height: 14 }} />
        </div>

        <div ref={tableScrollRef} onScroll={() => syncHorizontalScroll("middle")} className="max-h-[72vh] overflow-auto">
          <table ref={tableRef} className="min-w-full table-fixed text-left text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            <colgroup>
              <col style={{ width: 340 }} />
              {filteredMansioni.map((m) => (
                <col key={m.key} style={{ width: 160 }} />
              ))}
            </colgroup>
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky top-0 z-30 bg-[var(--brand-panel)] px-4 py-2">DPI</th>
                {filteredMansioni.map((m) => (
                  <th
                    key={m.key}
                    className="sticky top-0 z-20 bg-[var(--brand-panel)] px-3 py-2"
                    title={`${m.code} ${m.description}`.trim()}
                  >
                    <span className="block max-w-[148px] truncate font-semibold text-slate-700">{m.code}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={1 + filteredMansioni.length} className="px-4 py-10 text-center text-sm text-slate-500">
                    Caricamento…
                  </td>
                </tr>
              ) : null}

              {!isLoading && filteredDpiItems.length === 0 ? (
                <tr>
                  <td colSpan={1 + filteredMansioni.length} className="px-4 py-10 text-center text-sm text-slate-500">
                    Nessun DPI (carica l’elenco da file o inseriscilo manualmente).
                  </td>
                </tr>
              ) : null}

              {!isLoading &&
                filteredDpiItems.map((dpi) => (
                  <tr
                    key={dpi.id}
                    className="border-t border-[var(--brand-line)] bg-white"
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-4 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          data-unstyled="true"
                          onClick={() => openEdit(dpi)}
                          className="min-w-0 text-left font-semibold text-slate-900 hover:underline"
                          title="Modifica DPI"
                        >
                          <span className="block truncate">{dpi.title}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(dpi)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                          title="Modifica DPI"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
                          </svg>
                        </button>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        {dpi.category ? <span>{dpi.category}</span> : null}
                        {dpi.controlFrequency ? <span>· {dpi.controlFrequency}</span> : null}
                      </div>
                    </td>
                    {filteredMansioni.map((m) => {
                      const key = `${dpi.id}:${m.key}`;
                      const checked = requiredSet.has(key);
                      const busy = isSavingKey === key;
                      return (
                        <td key={m.key} className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => void toggleRequired(dpi.id, m)}
                            disabled={busy}
                            className={[
                              "inline-flex h-7 w-7 items-center justify-center rounded-lg transition",
                              busy ? "opacity-60" : "",
                            ].join(" ")}
                            title={checked ? "Richiesto" : "Non richiesto"}
                            data-matrix-toggle="true"
                            data-on={checked ? "true" : "false"}
                          >
                            {checked ? "✓" : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {isEditOpen ? (
        <Modal title="Modifica DPI" onClose={() => setIsEditOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo DPI">
              <input
                value={editForm.title}
                onChange={(e) => setEditForm((v) => ({ ...v, title: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Cat.">
              <input
                value={editForm.category}
                onChange={(e) => setEditForm((v) => ({ ...v, category: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Rischi/Attività">
              <input
                value={editForm.riskActivities}
                onChange={(e) => setEditForm((v) => ({ ...v, riskActivities: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm md:col-span-2"
              />
            </Field>
            <Field label="Controllo obbligatorio">
              <input
                value={editForm.controlFrequency}
                onChange={(e) => setEditForm((v) => ({ ...v, controlFrequency: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Tipo di controllo">
              <input
                value={editForm.controlType}
                onChange={(e) => setEditForm((v) => ({ ...v, controlType: e.target.value }))}
                className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditOpen(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={isEditBusy}
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
              disabled={isEditBusy || !editForm.title.trim()}
            >
              {isEditBusy ? "Salvataggio…" : "Salva"}
            </button>
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
    <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
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
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      {children}
    </label>
  );
}
