"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ModuleHeader, PanelCard } from "@/components/module-ui";
import { buildHttpErrorMessage, extractResponseError, readJsonSafely } from "@/lib/client/http";

type ScopeType = "job" | "site" | "sub_site";

type MatrixCourse = {
  id: number;
  code: string;
  title: string;
};

type MatrixEntity = {
  key: string;
  label: string;
  isExtra: boolean;
};

type MatrixPayload = {
  scopeType: ScopeType;
  courses: MatrixCourse[];
  entities: MatrixEntity[];
  flags: string[];
  cellSources?: Record<string, "baseline" | "manual">;
};

const scopeOptions: Array<{ value: ScopeType; label: string }> = [
  { value: "job", label: "Mansioni" },
  { value: "site", label: "Cantieri" },
  { value: "sub_site", label: "Sottocantieri" },
];

export default function FormazioneMatricePage() {
  const [scopeType, setScopeType] = useState<ScopeType>("job");
  const [payload, setPayload] = useState<MatrixPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingCell, setIsSavingCell] = useState<string>("");
  const [isSavingScope, setIsSavingScope] = useState<string>("");
  const [isSeeding, setIsSeeding] = useState(false);
  const [error, setError] = useState("");
  const [entitySearch, setEntitySearch] = useState("");
  const [courseSearch, setCourseSearch] = useState("");
  const [excludedScopeKeys, setExcludedScopeKeys] = useState<string[]>([]);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingRef = useRef(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  useEffect(() => {
    void loadMatrix(scopeType);
  }, [scopeType]);

  const flagSet = useMemo(() => new Set(payload?.flags ?? []), [payload]);
  const excludedScopeSet = useMemo(() => new Set(excludedScopeKeys), [excludedScopeKeys]);

  const filteredEntities = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    const entities = payload?.entities ?? [];
    if (!q) return entities;
    return entities.filter((entity) => entity.label.toLowerCase().includes(q));
  }, [entitySearch, payload]);

  const filteredCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    const courses = (payload?.courses ?? [])
      .filter((course) => !isExcludedFromMatrix(course))
      .slice()
      .sort(compareCoursesForMatrix);
    if (!q) return courses;
    return courses.filter(
      (course) =>
        course.code.toLowerCase().includes(q) || course.title.toLowerCase().includes(q),
    );
  }, [courseSearch, payload]);

  useEffect(() => {
    const width = tableRef.current?.scrollWidth ?? 0;
    setTableScrollWidth(width);
  }, [payload, filteredCourses.length, filteredEntities.length]);

  function syncHorizontalScroll(source: "top" | "middle") {
    if (syncingRef.current) return;
    syncingRef.current = true;

    const sourceElement =
      source === "top"
        ? topScrollRef.current
        : tableScrollRef.current;
    const nextLeft = sourceElement?.scrollLeft ?? 0;

    if (source !== "top" && topScrollRef.current) {
      topScrollRef.current.scrollLeft = nextLeft;
    }
    if (source !== "middle" && tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = nextLeft;
    }

    syncingRef.current = false;
  }

  async function loadMatrix(scope: ScopeType) {
    setIsLoading(true);
    setError("");
    try {
      const [matrixResponse, exclusionsResponse] = await Promise.all([
        fetch(`/api/formazione/matrice?scopeType=${scope}`),
        scope === "site" || scope === "sub_site"
          ? fetch(`/api/formazione/esclusioni-scope?scopeType=${scope}`)
          : Promise.resolve(null),
      ]);

      const matrixBody = await readJsonSafely<MatrixPayload & { error?: string }>(matrixResponse);
      if (!matrixBody || !matrixResponse.ok || extractResponseError(matrixBody)) {
        throw new Error(buildHttpErrorMessage(matrixResponse, matrixBody, "Errore caricamento matrice"));
      }

      setPayload(matrixBody);

      if (exclusionsResponse) {
        const exclusionsBody = await readJsonSafely<{ excludedKeys: string[]; error?: string }>(exclusionsResponse);
        if (!exclusionsBody || !exclusionsResponse.ok || extractResponseError(exclusionsBody)) {
          throw new Error(buildHttpErrorMessage(exclusionsResponse, exclusionsBody, "Errore caricamento esclusioni scope"));
        }
        setExcludedScopeKeys(exclusionsBody.excludedKeys ?? []);
      } else {
        setExcludedScopeKeys([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento matrice.");
    } finally {
      setIsLoading(false);
    }
  }

  async function toggleScope(entityKey: string, enabled: boolean) {
    if (scopeType !== "site" && scopeType !== "sub_site") return;
    setIsSavingScope(entityKey);
    setError("");
    try {
      const response = await fetch("/api/formazione/esclusioni-scope", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType,
          enabled,
          siteId: scopeType === "site" ? Number(entityKey) : undefined,
          subSiteId: scopeType === "sub_site" ? Number(entityKey) : undefined,
        }),
      });
      const body = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
      if (!body || !response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore aggiornamento esclusione"));
      }

      setExcludedScopeKeys((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(entityKey);
        else next.delete(entityKey);
        return Array.from(next);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore aggiornamento esclusione.");
    } finally {
      setIsSavingScope("");
    }
  }

  async function toggleCell(entityKey: string, courseId: number, enabled: boolean) {
    if (!payload) return;
    const cellId = `${entityKey}:${courseId}`;
    setIsSavingCell(cellId);
    setError("");

    const requestBody: {
      scopeType: ScopeType;
      enabled: boolean;
      courseId: number;
      jobCodeNorm?: string;
      siteId?: number;
      subSiteId?: number;
    } = {
      scopeType,
      enabled,
      courseId,
    };

    if (scopeType === "job") {
      requestBody.jobCodeNorm = entityKey;
    } else if (scopeType === "site") {
      requestBody.siteId = Number(entityKey);
    } else {
      requestBody.subSiteId = Number(entityKey);
    }

    try {
      const response = await fetch("/api/formazione/matrice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const body = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
      if (!body || !response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore salvataggio cella"));
      }

      await loadMatrix(scopeType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore salvataggio cella.");
    } finally {
      setIsSavingCell("");
    }
  }

  async function seedFromCsv() {
    setIsSeeding(true);
    setError("");
    try {
      const response = await fetch("/api/formazione/matrice/seed", { method: "POST" });
      const body = await readJsonSafely<unknown>(response);
      if (!response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore seed matrice"));
      }

      const isSeedOk = (
        value: unknown,
      ): value is {
        ok: true;
        seededCourses: number;
        seededBaselineRules: number;
        seededJobRules: number;
        missingCourseCodes: string[];
        unmappedLabels: string[];
      } => {
        if (!value || typeof value !== "object") return false;
        const v = value as Record<string, unknown>;
        if (v.ok !== true) return false;
        if (!Array.isArray(v.missingCourseCodes)) return false;
        if (!Array.isArray(v.unmappedLabels)) return false;
        return true;
      };

      if (!isSeedOk(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore seed matrice"));
      }
      if (body.missingCourseCodes.length > 0 || body.unmappedLabels.length > 0) {
        throw new Error(
          [
            body.missingCourseCodes.length > 0
              ? `Corsi mancanti: ${body.missingCourseCodes.join(", ")}`
              : "",
            body.unmappedLabels.length > 0
              ? `Requisiti non mappati: ${body.unmappedLabels.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
      await loadMatrix(scopeType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore seed matrice.");
    } finally {
      setIsSeeding(false);
    }
  }

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Matrice formazione"
        description="Click su cella per accendere o spegnere il corso obbligatorio. Le modifiche vengono salvate subito."
        actions={
          <button
            type="button"
            onClick={() => void seedFromCsv()}
            disabled={isSeeding}
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
            title="Ricalcola baseline e regole mansione leggendo corsi.csv e mansioni.csv"
          >
            {isSeeding ? "Aggiorno..." : "Aggiorna da CSV"}
          </button>
        }
      />

      <PanelCard className="p-4">
        <div className="grid gap-2 md:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)_150px_auto_auto]">
          <select
            className="rounded-lg border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value as ScopeType)}
          >
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={entitySearch}
            onChange={(event) => setEntitySearch(event.target.value)}
            placeholder="Filtro righe"
            className="rounded-lg border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
          <input
            value={courseSearch}
            onChange={(event) => setCourseSearch(event.target.value)}
            placeholder="Filtro corsi"
            className="rounded-lg border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
          <div className="rounded-lg border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm text-slate-600">
            Corsi visibili: {filteredCourses.length}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {isLoading ? <span>Caricamento...</span> : null}
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-600" />
            Baseline
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
            Manuale
          </span>
        </div>
        {error ? <p className="mt-3 text-xs font-medium text-red-600">{error}</p> : null}
      </PanelCard>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
        <div
          ref={topScrollRef}
          onScroll={() => syncHorizontalScroll("top")}
          className="overflow-x-auto border-b border-[var(--brand-line)]"
        >
          <div style={{ width: tableScrollWidth, height: 16 }} />
        </div>

        <div ref={tableScrollRef} onScroll={() => syncHorizontalScroll("middle")} className="max-h-[60vh] overflow-auto">
          <table ref={tableRef} className="min-w-full table-fixed text-left text-xs">
            <thead className="uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[210px] border-r border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-3">
                  {scopeOptions.find((option) => option.value === scopeType)?.label}
                </th>
                {filteredCourses.map((course) => (
                  <th
                    key={course.id}
                    className="sticky top-0 z-20 h-16 min-w-[105px] bg-[var(--brand-panel)] px-1.5 py-3 align-top"
                  >
                    <div className="truncate font-semibold text-[10px] text-[var(--brand-ink)]">
                      {course.code}
                    </div>
                    <div className="mt-0.5 line-clamp-2 normal-case text-[9px] text-slate-500">
                      {course.title}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredEntities.map((entity) => (
                <tr key={entity.key} className="border-t border-[var(--brand-line)]">
                  <td
                    className={[
                      "sticky left-0 z-10 border-r border-[var(--brand-line)] bg-white px-2 py-1.5 text-[11px] font-medium",
                      entity.isExtra ? "text-red-700" : "text-[var(--brand-ink)]",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2">
                        {entity.isExtra ? <span className="h-2 w-2 rounded-full bg-red-600" /> : null}
                        {entity.label}
                      </span>
                      {scopeType === "site" || scopeType === "sub_site" ? (
                        <button
                          type="button"
                          onClick={() => void toggleScope(entity.key, !excludedScopeSet.has(entity.key))}
                          disabled={isSavingScope === entity.key}
                          data-matrix-toggle="true"
                          data-on={excludedScopeSet.has(entity.key) ? "true" : "false"}
                          className={[
                            "inline-flex h-6 items-center justify-center rounded-md px-2 text-[10px] transition",
                          ].join(" ")}
                          title={
                            excludedScopeSet.has(entity.key)
                              ? "Perimetro escluso dalla Formazione (clicca per includere)."
                              : "Escludi questo perimetro dalla Formazione."
                          }
                        >
                          {isSavingScope === entity.key
                            ? "..."
                            : excludedScopeSet.has(entity.key)
                              ? "ESCLUSO"
                              : "ESCLUDI"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                  {filteredCourses.map((course) => {
                    const cellKey = `${entity.key}:${course.id}`;
                    const active = flagSet.has(cellKey);
                    const saving = isSavingCell === cellKey;

                    return (
                      <td key={cellKey} className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => void toggleCell(entity.key, course.id, !active)}
                          className={[
                            "inline-flex h-6 min-w-10 items-center justify-center rounded-md px-1 text-[10px] transition",
                          ].join(" ")}
                          disabled={saving}
                          data-matrix-toggle="true"
                          data-on={active ? "true" : "false"}
                          title={active ? "Attivo" : "Disattivo"}
                        >
                          {saving ? "..." : active ? "ON" : "OFF"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!isLoading && filteredEntities.length === 0 ? (
                <tr>
                  <td colSpan={filteredCourses.length + 1} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nessuna entita disponibile per questa matrice.
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

const COURSE_PRIORITY_ORDER = [
  "FORM_BASE",
  "FORM_SPEC_BASSO",
  "FORM_SPEC_MEDIO",
  "FORM_SPEC_ALTO",
  "CORSO_DIR",
  "CORSO_PREP",
  "CORSO_AI_1",
  "CORSO_AI_2",
  "CORSO_AI_3",
  "CORSO_PS",
] as const;

const COURSE_PRIORITY_INDEX = new Map<string, number>(
  COURSE_PRIORITY_ORDER.map((code, index) => [code, index]),
);

function compareCoursesForMatrix(a: MatrixCourse, b: MatrixCourse) {
  const aIndex = COURSE_PRIORITY_INDEX.get(a.code);
  const bIndex = COURSE_PRIORITY_INDEX.get(b.code);

  if (aIndex !== undefined && bIndex !== undefined) {
    return aIndex - bIndex;
  }
  if (aIndex !== undefined) return -1;
  if (bIndex !== undefined) return 1;

  return a.code.localeCompare(b.code);
}

const EXCLUDED_MATRIX_CODES = new Set([
  "CORSO_RLS",
  "CORSO_RSPP",
  "CORSO_PLE",
  "CORSO_QUOTA_DPI",
]);

const EXCLUDED_MATRIX_TITLE_MATCH = [
  "formatore",
  "ambiente confin",
  "carroponte",
  "gru",
  "escavat",
  "feretri",
  "fitosanit",
  "funi",
  "haccp",
  "ple",
  "ponteggio",
  "quota",
  "trabattello",
  "trasporto merci pericolose",
];

function isExcludedFromMatrix(course: MatrixCourse) {
  if (EXCLUDED_MATRIX_CODES.has(course.code)) return true;
  const title = course.title.toLowerCase();
  return EXCLUDED_MATRIX_TITLE_MATCH.some((needle) => title.includes(needle));
}
