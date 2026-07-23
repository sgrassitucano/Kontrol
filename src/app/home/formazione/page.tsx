"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { normalizeJobCode } from "@/lib/training/normalize";
import { DashboardCard, ModuleHeader, PanelCard, ActionMenu, courseStatusClassName } from "@/components/module-ui";
import { EventModal } from "./event-modal";
import { DashboardKpi, type DashboardBucketKey, type DashboardCategory as KpiCategory } from "./_components/dashboard-kpi";
import { MultiSelectDropdown } from "./_components/multi-select-dropdown";
import { ImportProgrammatiModal } from "./_components/import-programmati-modal";
import {
  isoToItDate,
  formatDateIt,
  isoToMonthYear,
  monthYearSortKey,
  capitalizeFirst,
  matchText,
  matchSearchQuery,
  matchTextTokens,
  todayLocalIso,
  formatIsoToItDate,
  normalizeItDateDraft,
  parseStrictItDateToIso,
  getDefaultSimulationDate,
  csvEscape,
  downloadCsvFile,
} from "./_lib/format";
import { buildHttpErrorMessage, extractResponseError, readJsonSafely } from "@/lib/client/http";
import { Eye, Calendar, Award, FileText } from "lucide-react";

const FORMAZIONE_NOTE_COL_WIDTH = 280;
const FORMAZIONE_STATO_COL_WIDTH = 260;
const FORMAZIONE_TABLE_WIDTH =
  56 +
  120 +
  170 +
  170 +
  220 +
  170 +
  170 +
  90 +
  90 +
  240 +
  90 +
  90 +
  120 +
  FORMAZIONE_STATO_COL_WIDTH +
  170 +
  FORMAZIONE_NOTE_COL_WIDTH;

type WorkerCourseRow = {
  workerId: number;
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  courseId?: number;
  corsoCode: string;
  corso: string;
  dataConclusione: string | null;
  dataScadenza: string | null;
  dataPrevista: string | null;
  stato:
    | "idoneo"
    | "in scadenza"
    | "scaduto"
    | "perso"
    | "da fare"
    | "sospeso"
    | "programmato"
    | "upgrade"
    | "escluso";
  upgradeInfo: string | null;
  blockedBy?: { code: string; title: string } | null;
  responsabile: string;
  referente: string;
  note: string;
  origine: "obbligatorio" | "aggiuntivo";
  // true se questa riga era in origine "scaduto" e consolidateFormationRows l'ha
  // riscritta come aggiornamento "da fare": il bucket KPI deve contarla come scaduto,
  // non come da fare (altrimenti il KPI "Scaduto" si svuota).
  wasScaduto?: boolean;
  // corsoCode originale pre-consolidamento: FORM_SPEC_AGGIORNAMENTO (il codice usato
  // dopo la trasformazione) non è in DASHBOARD_BASE_CODES, quindi senza questo campo
  // un corso BASE scaduto finirebbe classificato come OPERATIVI dopo il rename.
  originalCorsoCode?: string;
};

type DashboardStateKey = "scaduto" | "da fare" | "in scadenza" | "programmato" | "upgrade" | "escluso";

// Flag indipendenti per lavoratore (NON worst-wins): un lavoratore può comparire in
// più bucket. conforme = obbligati - unione(bloccato|scaduto|daFare|upgrade).
type DashboardWorkerBuckets = {
  scaduto: number;
  daFare: number;
  bloccato: number;
  inScadenza: number;
  upgrade: number;
  programmato: number;
  conforme: number;
  escluso: number;
  sospeso: number;
  senzaObbligo: number;
  obbligati: number;
  // Di ciascun bucket critico, quanti hanno già l'aggiornamento specifico programmato.
  withProgrammatoSubcount: Record<"bloccato" | "scaduto" | "daFare" | "upgrade" | "inScadenza", number>;
};

type DashboardSummary = {
  total: number;
  counts: Record<DashboardStateKey, number>;
  percentages: Record<DashboardStateKey, number>;
  workers: DashboardWorkerBuckets;
};

type JobEntity = {
  key: string;
  label: string;
  isExtra: boolean;
};

type CourseOption = { id?: number; code: string; title: string; isActive?: boolean };
type EventType = "PROGRAMMATO" | "RIMUOVI_PROGRAMMATO" | "SVOLTO" | "MODIFICA_DATA" | "ANNULLA" | "DA_FARE" | "NOTE";
type EventModalInit = {
  courseCode: string;
  courseSearch: string;
  type: EventType;
  date: string;
  note: string;
  token: number;
};
type ImportPreviewIssue = {
  rowNumber: number;
  matricola: string;
  cognome: string;
  nome: string;
  rawCourseCode: string;
  canonicalCourseCode: string | null;
  issueType: "missing_employee" | "missing_course" | "ambiguous_form_spec_note";
  message: string;
};
type ImportPreviewCourseStat = {
  courseCode: string;
  courseTitle: string;
  legacyRows: number;
  mappedRows: number;
  missingEmployeeRows: number;
};
type ImportPreviewMissingEmployee = {
  matricola: string;
  cognome: string;
  nome: string;
  rows: number;
  courses: string[];
};
type ImportPreviewSummary = {
  totalRows: number;
  mappedEmployees: number;
  missingEmployees: number;
  mappedCourses: number;
  missingCourses: number;
  svoltoIllimitato: number;
  daFare: number;
  daAggiornare: number;
  validi: number;
};
type ImportPreviewResult = {
  summary: ImportPreviewSummary;
  issues: ImportPreviewIssue[];
  courseStats: ImportPreviewCourseStat[];
  missingEmployeesList: ImportPreviewMissingEmployee[];
  message: string;
};

type ColumnFilters = {
  matricola: string;
  cognome: string;
  nome: string;
  mansione: string;
  cantiere: string;
  sottocantiere: string;
  responsabile: string;
  referente: string;
  corso: string[];
  dataConclusione: string[];
  dataScadenza: string[];
  stato: WorkerCourseRow["stato"][];
  origine: WorkerCourseRow["origine"][];
  note: string;
};

type SortKey =
  | "matricola"
  | "cognome"
  | "nome"
  | "mansione"
  | "cantiere"
  | "sottocantiere"
  | "responsabile"
  | "referente"
  | "corso"
  | "dataConclusione"
  | "dataScadenza"
  | "dataPrevista"
  | "origine"
  | "stato"
  | "note";
type SortDir = "asc" | "desc";

const INITIAL_COLUMN_FILTERS: ColumnFilters = {
  matricola: "",
  cognome: "",
  nome: "",
  mansione: "",
  cantiere: "",
  sottocantiere: "",
  responsabile: "",
  referente: "",
  corso: [],
  dataConclusione: [],
  dataScadenza: [],
  stato: [],
  origine: [],
  note: "",
};

type DashboardCategory = "base" | "operativi";

type DashboardFilter = {
  category: DashboardCategory;
  states: WorkerCourseRow["stato"][] | null;
  blocked?: boolean;
};

const DASHBOARD_BASE_CODES = new Set([
  "FORM_BASE",
  "FORM_SPEC_BASSO",
  "FORM_SPEC_MEDIO",
  "FORM_SPEC_ALTO",
  "CORSO_RLS",
  "CORSO_RSPP",
  "CORSO_DIR",
  "CORSO_ASPP",
]);

const DASHBOARD_STATES: DashboardStateKey[] = [
  "scaduto",
  "da fare",
  "in scadenza",
  "programmato",
  "upgrade",
  "escluso",
];

type ImportLastRun = {
  id: string;
  source: string;
  fileName: string;
  status: string;
  createdAt: string;
  importedByName: string | null;
  totalRows?: number;
  processedRows?: number;
  errorRows?: number;
};

export default function HomeFormazionePage() {
  const [rows, setRows] = useState<WorkerCourseRow[]>([]);
  const [totalActiveEmployees, setTotalActiveEmployees] = useState(0);
  const [excludedByScopeEmployees, setExcludedByScopeEmployees] = useState(0);
  const [frozenEmployees, setFrozenEmployees] = useState(0);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [showExcludedEmployees, setShowExcludedEmployees] = useState(false);
  const [simulationDate, setSimulationDate] = useState(() => getDefaultSimulationDate());
  const [simulationDateDraft, setSimulationDateDraft] = useState(() =>
    formatIsoToItDate(getDefaultSimulationDate()),
  );
  const [expiringDays, setExpiringDays] = useState(30);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterError, setFilterError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(INITIAL_COLUMN_FILTERS);
  const [isDashboardDetailOpen, setIsDashboardDetailOpen] = useState(false);
  const [showEmptyJobsInDetail, setShowEmptyJobsInDetail] = useState(false);
  const [showOnlyProblemJobsInDetail, setShowOnlyProblemJobsInDetail] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardRows, setDashboardRows] = useState<WorkerCourseRow[]>([]);
  const [dashboardTotalByAnagrafica, setDashboardTotalByAnagrafica] = useState(0);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImportProgrammatiModalOpen, setIsImportProgrammatiModalOpen] = useState(false);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<number>>(() => new Set());
  const [eventModalInit, setEventModalInit] = useState<EventModalInit>({
    courseCode: "",
    courseSearch: "",
    type: "PROGRAMMATO",
    date: "",
    note: "",
    token: 0,
  });
  const [catalogCourses, setCatalogCourses] = useState<CourseOption[]>([]);
  const [jobEntities, setJobEntities] = useState<JobEntity[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [importLastRun, setImportLastRun] = useState<ImportLastRun | null>(null);
  const [isDownloadingImportReport, setIsDownloadingImportReport] = useState(false);
  const [importUndoLoading, setImportUndoLoading] = useState(false);
  const [importUndoMessage, setImportUndoMessage] = useState("");
  const importProgressTimerRef = useRef<number | null>(null);
  const importRunTokenRef = useRef(0);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingRef = useRef(false);
  const loadRowsAbortRef = useRef<AbortController | null>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(FORMAZIONE_TABLE_WIDTH);
  const [dashboardCategoryFilter, setDashboardCategoryFilter] = useState<"base" | "operativi" | null>(null);
  const [dashboardStateFilter, setDashboardStateFilter] = useState<WorkerCourseRow["stato"][] | null>(null);
  const [dashboardBlockedFilter, setDashboardBlockedFilter] = useState(false);
  const [dashboardActiveBucket, setDashboardActiveBucket] = useState<DashboardBucketKey | null>(null);
  const [isDashboardCollapsed, setIsDashboardCollapsed] = useState(false);
  const [isWorkerDetailOpen, setIsWorkerDetailOpen] = useState(false);
  const [workerDetailEmployeeId, setWorkerDetailEmployeeId] = useState<number | null>(null);
  const [workerDetailTitle, setWorkerDetailTitle] = useState("");
  const [workerDetailRows, setWorkerDetailRows] = useState<WorkerCourseRow[]>([]);
  const [workerDetailLoading, setWorkerDetailLoading] = useState(false);
  const [workerDetailError, setWorkerDetailError] = useState("");
  const [workerDetailTab, setWorkerDetailTab] = useState<"formazione" | "esclusioni">("formazione");
  const [employeeExclusion, setEmployeeExclusion] = useState<{ isActive: boolean; note: string }>({
    isActive: false,
    note: "",
  });
  const [courseExclusionNotes, setCourseExclusionNotes] = useState<Map<number, string>>(() => new Map());
  const [isExclusionNoteModalOpen, setIsExclusionNoteModalOpen] = useState(false);
  const [exclusionNoteKind, setExclusionNoteKind] = useState<"employee" | "course">("course");
  const [exclusionNoteCourseId, setExclusionNoteCourseId] = useState<number | null>(null);
  const [exclusionNoteDraft, setExclusionNoteDraft] = useState("");
  const [exclusionCourseSearch, setExclusionCourseSearch] = useState("");
  const [exclusionSelectedCourseId, setExclusionSelectedCourseId] = useState<number | null>(null);
  const [exclusionCourseCode, setExclusionCourseCode] = useState("");
  const [exclusionCourseNote, setExclusionCourseNote] = useState("");
  const [exclusionCourseSaving, setExclusionCourseSaving] = useState(false);
  const [exclusionCourseError, setExclusionCourseError] = useState("");
  const [inlineSaveError, setInlineSaveError] = useState("");
  const [inlineSavingKeys, setInlineSavingKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (simulationDateDraft.trim().length !== 10) return;
      const next = parseStrictItDateToIso(simulationDateDraft);
      if (!next) {
        setFilterError("Data non valida (formato gg/mm/aaaa).");
        return;
      }
      setFilterError("");
      setSimulationDate(next);
    }, 350);
    return () => window.clearTimeout(id);
  }, [simulationDateDraft]);

  useEffect(() => {
    async function loadCourseCatalog() {
      try {
        const [coursesResponse, jobResponse] = await Promise.all([
          fetch("/api/formazione/corsi"),
          fetch("/api/formazione/matrice?scopeType=job"),
        ]);

        const coursesBody = (await coursesResponse.json()) as {
          courses?: Array<{ id: number; code: string; title: string; isActive: boolean }>;
          error?: string;
        };
        if (coursesResponse.ok && !coursesBody.error) {
          const normalized = (coursesBody.courses ?? [])
            .map((course) => ({ id: Number(course.id), code: course.code, title: course.title, isActive: Boolean(course.isActive) }))
            .filter((course) => Number.isFinite(course.id) && course.id > 0 && course.code && course.title)
            .sort((a, b) => a.code.localeCompare(b.code));
          setCatalogCourses(normalized);
        }

        const jobBody = (await jobResponse.json()) as { entities?: JobEntity[]; error?: string };
        if (jobResponse.ok && !jobBody.error) {
          setJobEntities((jobBody.entities ?? []).map((entity) => ({ ...entity, isExtra: Boolean(entity.isExtra) })));
        }
      } catch {
        // fallback automatico: se la fetch fallisce useremo comunque i corsi derivati dai rows.
      }
    }
    void loadCourseCatalog();
  }, [setShowExcludedEmployees]);

  const courseById = useMemo(() => {
    const map = new Map<number, CourseOption>();
    catalogCourses.forEach((course) => {
      if (!course.id) return;
      map.set(course.id, course);
    });
    return map;
  }, [catalogCourses]);

  const exclusionCourseOptions = useMemo(() => {
    const q = exclusionCourseSearch.trim().toLowerCase();
    const pinnedCodes = new Set(["FORM_SPEC_BASSO", "FORM_SPEC_MEDIO", "FORM_SPEC_ALTO", "FORM_BASE"]);
    const list = catalogCourses
      .filter((c) => typeof c.id === "number" && c.id > 0)
      .filter((c) => {
        if (!c.id) return false;
        if (courseExclusionNotes.has(c.id)) return false;
        if (!q) return true;
        return `${c.code} ${c.title}`.toLowerCase().includes(q);
      });

    if (!q) {
      const pinned = list.filter((c) => pinnedCodes.has(c.code));
      const others = list.filter((c) => !pinnedCodes.has(c.code)).slice(0, 50);
      return [...pinned, ...others];
    }

    return list.slice(0, 200);
  }, [catalogCourses, courseExclusionNotes, exclusionCourseSearch]);

  const formSpecShortcut = useMemo(() => {
    const find = (code: string) => catalogCourses.find((c) => c.id && c.code === code) ?? null;
    return {
      basso: find("FORM_SPEC_BASSO"),
      medio: find("FORM_SPEC_MEDIO"),
      alto: find("FORM_SPEC_ALTO"),
    };
  }, [catalogCourses]);

  useEffect(() => {
    return () => {
      if (importProgressTimerRef.current !== null) {
        window.clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
    };
  }, []);

  function formatDateTimeIt(value: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString("it-IT");
  }

  const downloadFrom = useCallback(async (url: string) => {
    setIsDownloadingImportReport(true);
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) throw new Error("Errore download report.");
      const blob = await response.blob();
      const disp = response.headers.get("content-disposition") ?? "";
      const match = disp.match(/filename=\"([^\"]+)\"/i);
      const filename = match?.[1] ?? "report.csv";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setIsDownloadingImportReport(false);
    }
  }, []);

  const refreshImportLastRun = useCallback(async () => {
    const response = await fetch("/api/import-runs/last?source=formazione_legacy", { method: "GET" });
    const body = await readJsonSafely<{ run: ImportLastRun | null; error?: string }>(response);
    if (!response.ok) {
      throw new Error(buildHttpErrorMessage(response, body, "Errore caricamento ultimo import"));
    }
    if (extractResponseError(body)) {
      throw new Error(extractResponseError(body) ?? "Errore caricamento ultimo import.");
    }
    setImportLastRun(body?.run ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/import-runs/last?source=formazione_legacy", { method: "GET" });
        const body = await readJsonSafely<{ run: ImportLastRun | null; error?: string }>(response);
        if (cancelled) return;
        if (!response.ok || extractResponseError(body)) return;
        setImportLastRun(body?.run ?? null);
      } catch {
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshImportLastRun]);

  const loadRows = useCallback(async (dateOverride?: string) => {
    setIsLoading(true);
    setError("");
    loadRowsAbortRef.current?.abort();
    const controller = new AbortController();
    loadRowsAbortRef.current = controller;
    try {
      async function fetchChunk(offset: number) {
        const params = new URLSearchParams();
        params.set("date", dateOverride ?? simulationDate);
        params.set("expiringDays", String(expiringDays));
        params.set("panel", "formazione");
        params.set("limit", "5000");
        params.set("offset", String(offset));
        if (deferredSearch.trim()) params.set("q", deferredSearch.trim());
        if (showExcludedEmployees) params.set("includeExcluded", "1");
        const response = await fetch(`/api/lavoratori/corsi?${params.toString()}`, { signal: controller.signal });
        const body = await readJsonSafely<{
          rows?: WorkerCourseRow[];
          error?: string;
          truncated?: boolean;
          totalActiveEmployees?: number;
          excludedByScopeEmployees?: number;
          frozenEmployees?: number;
        }>(response);
        if (!response.ok || extractResponseError(body)) {
          if (response.status === 401) {
            window.location.href = "/login";
            return null;
          }
          throw new Error(buildHttpErrorMessage(response, body, "Errore caricamento formazione lavoratori"));
        }
        return body;
      }

      const nextRows: WorkerCourseRow[] = [];
      let offset = 0;
      let truncated = true;
      let totalActiveEmployeesNext = 0;
      let excludedByScopeEmployeesNext = 0;
      let frozenEmployeesNext = 0;

      while (truncated) {
        const body = await fetchChunk(offset);
        if (!body) return;
        nextRows.push(...(body.rows ?? []));
        truncated = Boolean(body.truncated);
        offset += (body.rows ?? []).length;
        totalActiveEmployeesNext = body.totalActiveEmployees ?? totalActiveEmployeesNext;
        excludedByScopeEmployeesNext = body.excludedByScopeEmployees ?? excludedByScopeEmployeesNext;
        frozenEmployeesNext = body.frozenEmployees ?? frozenEmployeesNext;
        if ((body.rows ?? []).length === 0) break;
      }

      setRows(consolidateFormationRows(nextRows));
      const nextWorkerIds = new Set(nextRows.map((r) => r.workerId));
      setSelectedWorkerIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set<number>();
        prev.forEach((id) => {
          if (nextWorkerIds.has(id)) next.add(id);
        });
        return next;
      });
      setTotalActiveEmployees(totalActiveEmployeesNext);
      setExcludedByScopeEmployees(excludedByScopeEmployeesNext);
      setFrozenEmployees(frozenEmployeesNext);

      setSearch("");
      setColumnFilters(INITIAL_COLUMN_FILTERS);
      setDashboardCategoryFilter(null);
      setDashboardStateFilter(null);
      setShowExcludedEmployees(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(
        err instanceof Error ? err.message : "Errore caricamento formazione lavoratori.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [deferredSearch, expiringDays, showExcludedEmployees, simulationDate]);

  const upsertEmployeeRows = useCallback((employeeId: number, employeeRows: WorkerCourseRow[]) => {
    setRows((prev) => {
      const next = prev.filter((row) => row.workerId !== employeeId);
      next.push(...employeeRows);
      return consolidateFormationRows(next);
    });
  }, []);

  const reloadEmployeeRows = useCallback(
    async (employeeId: number) => {
      const params = new URLSearchParams();
      params.set("panel", "formazione");
      params.set("employeeId", String(employeeId));
      params.set("date", simulationDate);
      params.set("expiringDays", String(expiringDays));
      const response = await fetch(`/api/lavoratori/corsi?${params.toString()}`);
      const body = await readJsonSafely<{ rows?: WorkerCourseRow[]; error?: string }>(response);
      if (response.status === 401) {
        window.location.href = "/login";
        return [];
      }
      if (!body || !response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore caricamento dettaglio lavoratore"));
      }
      const employeeRows = body.rows ?? [];
      upsertEmployeeRows(employeeId, employeeRows);
      return employeeRows;
    },
    [expiringDays, simulationDate, upsertEmployeeRows],
  );

  const reloadEmployeeRowsAndMaybeDetail = useCallback(
    async (employeeId: number) => {
      const employeeRows = await reloadEmployeeRows(employeeId);
      if (isWorkerDetailOpen && workerDetailEmployeeId === employeeId) {
        setWorkerDetailRows(employeeRows);
      }
    },
    [isWorkerDetailOpen, reloadEmployeeRows, workerDetailEmployeeId],
  );

  useEffect(() => {
    void loadRows();
  }, [loadRows]);


  const loadWorkerDetail = useCallback(
    async (employeeId: number) => {
      setWorkerDetailLoading(true);
      setWorkerDetailError("");
      try {
        const [rowsResponse, exclusionsResponse] = await Promise.all([
          reloadEmployeeRows(employeeId),
          fetch(`/api/formazione/esclusioni?employeeId=${employeeId}`),
        ]);

        const exclusionsBody = await readJsonSafely<{
          employee?: { isActive: boolean; note: string };
          excludedCourses?: Array<{ courseId: number; note: string }>;
          error?: string;
        }>(exclusionsResponse);
        if (!exclusionsBody || !exclusionsResponse.ok || extractResponseError(exclusionsBody)) {
          throw new Error(buildHttpErrorMessage(exclusionsResponse, exclusionsBody, "Errore caricamento esclusioni"));
        }

        setWorkerDetailRows(rowsResponse);
        const employee = exclusionsBody.employee ?? { isActive: false, note: "" };
        setEmployeeExclusion({ isActive: Boolean(employee.isActive), note: employee.note ?? "" });
        setCourseExclusionNotes(
          new Map((exclusionsBody.excludedCourses ?? []).map((item) => [item.courseId, item.note ?? ""])),
        );
      } catch (err) {
        setWorkerDetailError(err instanceof Error ? err.message : "Errore caricamento dettaglio lavoratore.");
      } finally {
        setWorkerDetailLoading(false);
      }
    },
    [reloadEmployeeRows],
  );

  const openWorkerDetailById = useCallback(
    async (employeeId: number) => {
      setWorkerDetailEmployeeId(employeeId);
      setWorkerDetailTitle("Caricamento...");
      setWorkerDetailRows([]);
      setEmployeeExclusion({ isActive: false, note: "" });
      setCourseExclusionNotes(new Map());
      setWorkerDetailTab("formazione");
      setIsWorkerDetailOpen(true);
      try {
        const rowsResponse = await reloadEmployeeRows(employeeId);
        if (rowsResponse && rowsResponse.length > 0) {
          const first = rowsResponse[0];
          setWorkerDetailTitle(`${first.cognome} ${first.nome} (${first.matricola})`);
        } else {
          setWorkerDetailTitle(`Dipendente #${employeeId}`);
        }
      } catch {
        setWorkerDetailTitle(`Dipendente #${employeeId}`);
      }
      await loadWorkerDetail(employeeId);
    },
    [loadWorkerDetail, reloadEmployeeRows]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialWorkerId = params.get("workerId") || params.get("employeeId");
    if (initialWorkerId) {
      const id = Number(initialWorkerId);
      if (Number.isFinite(id) && id > 0) {
        void openWorkerDetailById(id);
      }
    }
  }, [openWorkerDetailById]);


  const setInlineSaving = useCallback((key: string, saving: boolean) => {
    setInlineSavingKeys((prev) => {
      const next = new Set(prev);
      if (saving) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const updateInline = useCallback(
    async (payload: { employeeId: number; courseCode: string; type: "PROGRAMMATO" | "RIMUOVI_PROGRAMMATO" | "DA_FARE" | "NOTE"; note?: string | null }) => {
      const response = await fetch("/api/formazione/eventi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: payload.employeeId,
          courseCode: payload.courseCode,
          type: payload.type,
          note: payload.note ?? null,
        }),
      });
      const body = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
      if (!body || !response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore salvataggio"));
      }
    },
    [],
  );

  const removeProgrammedInline = useCallback(
    async (row: WorkerCourseRow) => {
      const key = `${row.workerId}-${row.corsoCode}`;
      setInlineSaveError("");
      setInlineSaving(key, true);
      try {
        const courseCodes = row.corsoCode.startsWith("FORM_BASE+") && !row.courseId
          ? ["FORM_BASE", row.corsoCode.slice("FORM_BASE+".length)]
          : [row.corsoCode];
        await Promise.all(
          courseCodes.map((courseCode) =>
            updateInline({
              employeeId: row.workerId,
              courseCode,
              type: "RIMUOVI_PROGRAMMATO",
              note: null,
            }),
          ),
        );
        await reloadEmployeeRowsAndMaybeDetail(row.workerId);
      } catch (err) {
        setInlineSaveError(err instanceof Error ? err.message : "Errore salvataggio.");
      } finally {
        setInlineSaving(key, false);
      }
    },
    [reloadEmployeeRowsAndMaybeDetail, setInlineSaving, updateInline],
  );

  const saveInlineNote = useCallback(
    async (row: WorkerCourseRow, note: string) => {
      const key = `${row.workerId}-${row.corsoCode}`;
      setInlineSaveError("");
      setInlineSaving(key, true);
      try {
        const courseCodes = row.corsoCode.startsWith("FORM_BASE+") && !row.courseId
          ? ["FORM_BASE", row.corsoCode.slice("FORM_BASE+".length)]
          : [row.corsoCode];
        const normalizedNote = note.trim() ? note : null;
        await Promise.all(
          courseCodes.map((courseCode) =>
            updateInline({
              employeeId: row.workerId,
              courseCode,
              type: "NOTE",
              note: normalizedNote,
            }),
          ),
        );
        await reloadEmployeeRowsAndMaybeDetail(row.workerId);
      } catch (err) {
        setInlineSaveError(err instanceof Error ? err.message : "Errore salvataggio.");
      } finally {
        setInlineSaving(key, false);
      }
    },
    [reloadEmployeeRowsAndMaybeDetail, setInlineSaving, updateInline],
  );

  const openWorkerDetail = useCallback(
    async (row: WorkerCourseRow) => {
      setWorkerDetailEmployeeId(row.workerId);
      setWorkerDetailTitle(`${row.cognome} ${row.nome} (${row.matricola})`);
      setWorkerDetailRows([]);
      setEmployeeExclusion({ isActive: false, note: "" });
      setCourseExclusionNotes(new Map());
      setWorkerDetailTab("formazione");
      setIsWorkerDetailOpen(true);
      await loadWorkerDetail(row.workerId);
    },
    [loadWorkerDetail],
  );

  const openExclusionNoteModal = useCallback(
    (params: { kind: "employee" } | { kind: "course"; courseId: number }) => {
      setExclusionNoteKind(params.kind);
      setExclusionNoteCourseId(params.kind === "course" ? params.courseId : null);
      setExclusionNoteDraft("");
      setIsExclusionNoteModalOpen(true);
    },
    [],
  );

  const submitExclusion = useCallback(
    async (payload: { kind: "employee"; enabled: boolean; note: string } | { kind: "course"; courseId: number; enabled: boolean; note: string }) => {
      if (!workerDetailEmployeeId) return;
      const response = await fetch("/api/formazione/esclusioni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: payload.kind,
          employeeId: workerDetailEmployeeId,
          enabled: payload.enabled,
          note: payload.note,
          ...(payload.kind === "course" ? { courseId: payload.courseId } : {}),
        }),
      });
      const body = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
      if (!body || !response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore salvataggio esclusione"));
      }
      await loadWorkerDetail(workerDetailEmployeeId);
    },
    [loadWorkerDetail, workerDetailEmployeeId],
  );

  const submitCourseDerogaByCode = useCallback(
    async (payload: { courseCode: string; note: string }) => {
      if (!workerDetailEmployeeId) return;
      setExclusionCourseSaving(true);
      setExclusionCourseError("");
      try {
        const code = payload.courseCode.trim().toUpperCase();
        if (!code) throw new Error("Codice corso obbligatorio.");
        const response = await fetch("/api/formazione/esclusioni", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "course",
            employeeId: workerDetailEmployeeId,
            enabled: true,
            note: payload.note,
            courseCode: code,
          }),
        });
        const body = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
        if (!body || !response.ok || extractResponseError(body)) {
          throw new Error(buildHttpErrorMessage(response, body, "Errore salvataggio deroga"));
        }
        setExclusionCourseCode("");
        setExclusionCourseNote("");
        await loadWorkerDetail(workerDetailEmployeeId);
      } catch (err) {
        setExclusionCourseError(err instanceof Error ? err.message : "Errore salvataggio deroga.");
      } finally {
        setExclusionCourseSaving(false);
      }
    },
    [loadWorkerDetail, workerDetailEmployeeId],
  );

  const deleteExcludedCourse = useCallback(
    async (courseId: number) => {
      if (!workerDetailEmployeeId) return;
      const ok = window.confirm(
        "Eliminare definitivamente questo corso dal lavoratore? L'operazione rimuove sia il corso sia la relativa esclusione.",
      );
      if (!ok) return;
      try {
        const response = await fetch("/api/formazione/esclusioni", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "course", employeeId: workerDetailEmployeeId, courseId }),
        });
        const body = await readJsonSafely<{ ok?: boolean; error?: string }>(response);
        if (!body || !response.ok || extractResponseError(body)) {
          throw new Error(buildHttpErrorMessage(response, body, "Errore eliminazione corso"));
        }
        await loadWorkerDetail(workerDetailEmployeeId);
      } catch (err) {
        setWorkerDetailError(err instanceof Error ? err.message : "Errore eliminazione corso.");
      }
    },
    [loadWorkerDetail, workerDetailEmployeeId],
  );

  const requestEmployeeExclusionToggle = useCallback(async () => {
    if (!workerDetailEmployeeId) return;
    if (!employeeExclusion.isActive) {
      openExclusionNoteModal({ kind: "employee" });
      return;
    }
    const ok = window.confirm("Rimuovere l'esclusione del lavoratore dalla Formazione?");
    if (!ok) return;
    try {
      await submitExclusion({ kind: "employee", enabled: false, note: employeeExclusion.note });
    } catch (err) {
      setWorkerDetailError(err instanceof Error ? err.message : "Errore salvataggio esclusione.");
    }
  }, [employeeExclusion.isActive, employeeExclusion.note, openExclusionNoteModal, submitExclusion, workerDetailEmployeeId]);

  const requestCourseExclusionToggle = useCallback(
    async (courseId: number) => {
      if (!workerDetailEmployeeId) return;
      const isExcluded = courseExclusionNotes.has(courseId);
      if (!isExcluded) {
        openExclusionNoteModal({ kind: "course", courseId });
        return;
      }
      const ok = window.confirm("Rimuovere l'esclusione del corso per questo lavoratore?");
      if (!ok) return;
      try {
        await submitExclusion({ kind: "course", courseId, enabled: false, note: courseExclusionNotes.get(courseId) ?? "" });
      } catch (err) {
        setWorkerDetailError(err instanceof Error ? err.message : "Errore salvataggio esclusione.");
      }
    },
    [courseExclusionNotes, openExclusionNoteModal, submitExclusion, workerDetailEmployeeId],
  );

  const confirmExclusionNote = useCallback(async () => {
    if (!workerDetailEmployeeId) return;
    try {
      if (exclusionNoteKind === "employee") {
        await submitExclusion({ kind: "employee", enabled: true, note: exclusionNoteDraft });
      } else if (exclusionNoteKind === "course" && exclusionNoteCourseId) {
        await submitExclusion({ kind: "course", courseId: exclusionNoteCourseId, enabled: true, note: exclusionNoteDraft });
      }
      setIsExclusionNoteModalOpen(false);
    } catch (err) {
      setWorkerDetailError(err instanceof Error ? err.message : "Errore salvataggio esclusione.");
    }
  }, [exclusionNoteCourseId, exclusionNoteDraft, exclusionNoteKind, submitExclusion, workerDetailEmployeeId]);

  async function openDetail() {
    setIsDashboardDetailOpen(true);
    setShowEmptyJobsInDetail(false);
    setShowOnlyProblemJobsInDetail(true);
    setDashboardLoading(true);
    setDashboardError("");
    setDashboardRows([]);
    setDashboardTotalByAnagrafica(0);

    setDashboardRows(rows);
    setDashboardTotalByAnagrafica(totalActiveEmployees);
    setDashboardLoading(false);
  }

  const rowsForFacets = useMemo(() => {
    const q = deferredSearch.trim();
    return rows.filter((row) => {
      if (dashboardCategoryFilter) {
        const isBase = isDashboardBaseRow(row);
        if (dashboardCategoryFilter === "base" && !isBase) return false;
        if (dashboardCategoryFilter === "operativi" && isBase) return false;
      }
      if (dashboardBlockedFilter && !row.blockedBy) return false;
      // Scaduto e Da fare non si possono filtrare con un semplice match su `stato`:
      // consolidateFormationRows riscrive uno scaduto in "da fare" (wasScaduto=true)
      // e un aggiornamento mai fatto non conta come Da fare (bucketOfRow in
      // buildWorkerBuckets usa la stessa regola, va tenuta allineata qui).
      if (dashboardActiveBucket === "scaduto") {
        if (!(row.wasScaduto || row.stato === "scaduto" || row.stato === "perso")) return false;
      } else if (dashboardActiveBucket === "daFare") {
        if (!(row.stato === "da fare" && !isAggiornamentoCode(row.corsoCode))) return false;
      } else if (dashboardStateFilter && dashboardStateFilter.length > 0) {
        if (!dashboardStateFilter.includes(row.stato)) return false;
      }
      if (
        q &&
        !matchSearchQuery(
          [
            row.matricola,
            row.cognome,
            row.nome,
            row.cantiere,
            row.sottocantiere,
            row.responsabile,
            row.referente,
            row.mansione,
            row.corsoCode,
            row.corso,
            row.note,
          ],
          q,
        )
      ) {
        return false;
      }
      if (columnFilters.matricola && !matchText(row.matricola, columnFilters.matricola)) return false;
      if (columnFilters.cognome) {
        const filter = columnFilters.cognome.trim();
        if (filter.includes(" ") && !columnFilters.nome.trim()) {
          if (!matchTextTokens(`${row.cognome} ${row.nome}`, filter)) return false;
        } else if (!matchText(row.cognome, filter)) {
          return false;
        }
      }
      if (columnFilters.nome && !matchText(row.nome, columnFilters.nome)) return false;
      if (columnFilters.mansione && !matchText(row.mansione, columnFilters.mansione)) return false;
      if (columnFilters.cantiere && !matchText(row.cantiere, columnFilters.cantiere)) return false;
      if (columnFilters.sottocantiere && !matchText(row.sottocantiere, columnFilters.sottocantiere)) return false;
      if (columnFilters.responsabile && !matchText(row.responsabile, columnFilters.responsabile)) return false;
      if (columnFilters.referente && !matchText(row.referente, columnFilters.referente)) return false;
      if (columnFilters.note && !matchText(row.note ?? "", columnFilters.note)) return false;
      return true;
    });
  }, [
    columnFilters.cantiere,
    columnFilters.cognome,
    columnFilters.mansione,
    columnFilters.matricola,
    columnFilters.nome,
    columnFilters.note,
    columnFilters.referente,
    columnFilters.responsabile,
    columnFilters.sottocantiere,
    dashboardCategoryFilter,
    dashboardStateFilter,
    dashboardBlockedFilter,
    dashboardActiveBucket,
    rows,
    deferredSearch,
  ]);

  const filteredRows = useMemo(() => {
    const corsoFilter = columnFilters.corso.length > 0 ? new Set(columnFilters.corso) : null;
    const statoFilter = columnFilters.stato.length > 0 ? new Set(columnFilters.stato) : null;
    const origineFilter = columnFilters.origine.length > 0 ? new Set(columnFilters.origine) : null;
    const conclusioneFilter =
      columnFilters.dataConclusione.length > 0 ? new Set(columnFilters.dataConclusione) : null;
    const scadenzaFilter = columnFilters.dataScadenza.length > 0 ? new Set(columnFilters.dataScadenza) : null;

    return rowsForFacets.filter((row) => {
      if (corsoFilter && !corsoFilter.has(row.corsoCode)) return false;
      if (statoFilter && !statoFilter.has(row.stato)) return false;
      if (origineFilter && !origineFilter.has(row.origine)) return false;
      if (conclusioneFilter) {
        const key = isoToMonthYear(row.dataConclusione);
        if (!conclusioneFilter.has(key)) return false;
      }
      if (scadenzaFilter) {
        const key = isoToMonthYear(row.dataScadenza);
        if (!scadenzaFilter.has(key)) return false;
      }
      return true;
    });
  }, [
    columnFilters.corso,
    columnFilters.dataConclusione,
    columnFilters.dataScadenza,
    columnFilters.origine,
    columnFilters.stato,
    rowsForFacets,
  ]);

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cognome", dir: "asc" });

  const sortedRows = useMemo(() => {
    const compareText = (a: string, b: string) =>
      a.localeCompare(b, "it", { sensitivity: "base", numeric: true });
    const compareNullableText = (a: string | null, b: string | null) => {
      const av = String(a ?? "").trim();
      const bv = String(b ?? "").trim();
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return compareText(av, bv);
    };
    const compareNullableIso = (a: string | null, b: string | null) => {
      const av = String(a ?? "").trim();
      const bv = String(b ?? "").trim();
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv);
    };
    const statusRank = (s: WorkerCourseRow["stato"]) => {
      if (s === "scaduto") return 1;
      if (s === "da fare") return 2;
      if (s === "upgrade") return 3;
      if (s === "in scadenza") return 4;
      if (s === "programmato") return 5;
      if (s === "sospeso") return 6;
      if (s === "escluso") return 7;
      return 8;
    };

    const dirMul = sort.dir === "asc" ? 1 : -1;
    const list = [...filteredRows];
    list.sort((a, b) => {
      let cmp = 0;
      if (sort.key === "matricola") cmp = compareText(a.matricola, b.matricola);
      else if (sort.key === "cognome") cmp = compareText(a.cognome, b.cognome) || compareText(a.nome, b.nome);
      else if (sort.key === "nome") cmp = compareText(a.nome, b.nome) || compareText(a.cognome, b.cognome);
      else if (sort.key === "mansione") cmp = compareText(a.mansione, b.mansione) || compareText(a.cognome, b.cognome);
      else if (sort.key === "cantiere") cmp = compareText(a.cantiere, b.cantiere) || compareText(a.cognome, b.cognome);
      else if (sort.key === "sottocantiere")
        cmp = compareText(a.sottocantiere, b.sottocantiere) || compareText(a.cognome, b.cognome);
      else if (sort.key === "responsabile")
        cmp = compareText(a.responsabile, b.responsabile) || compareText(a.cognome, b.cognome);
      else if (sort.key === "referente") cmp = compareText(a.referente, b.referente) || compareText(a.cognome, b.cognome);
      else if (sort.key === "corso")
        cmp = compareText(`${a.corsoCode} ${a.corso}`, `${b.corsoCode} ${b.corso}`) || compareText(a.cognome, b.cognome);
      else if (sort.key === "dataConclusione") cmp = compareNullableIso(a.dataConclusione, b.dataConclusione);
      else if (sort.key === "dataScadenza") cmp = compareNullableIso(a.dataScadenza, b.dataScadenza);
      else if (sort.key === "dataPrevista") cmp = compareNullableIso(a.dataPrevista, b.dataPrevista);
      else if (sort.key === "origine") cmp = compareText(a.origine, b.origine) || compareText(a.cognome, b.cognome);
      else if (sort.key === "stato") cmp = statusRank(a.stato) - statusRank(b.stato) || compareText(a.cognome, b.cognome);
      else cmp = compareNullableText(a.note, b.note) || compareText(a.cognome, b.cognome);
      return cmp * dirMul;
    });
    return list;
  }, [filteredRows, sort.dir, sort.key]);

  // Virtualize the table body: rendering all ~3000+ rows unconditionally produced
  // 100k+ DOM nodes, making every interaction (typing, opening modals) sluggish.
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualPaddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const virtualPaddingBottom =
    virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  const toggleSort = useCallback((key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }, []);

  const sortIcon = (col: SortKey) => {
    if (sort.key !== col) return <span className="text-[10px] text-slate-400">↕</span>;
    return <span className="text-[10px] text-slate-700">{sort.dir === "asc" ? "↑" : "↓"}</span>;
  };

  const applyDashboardFilter = useCallback((next: DashboardFilter | null) => {
    if (!next) {
      setDashboardCategoryFilter(null);
      setDashboardStateFilter(null);
      setDashboardBlockedFilter(false);
      setDashboardActiveBucket(null);
      return;
    }
    if (next.states && next.states.includes("escluso")) setShowExcludedEmployees(true);
    setDashboardCategoryFilter(next.category);
    setDashboardStateFilter(next.states);
    setDashboardBlockedFilter(Boolean(next.blocked));
  }, []);

  // Traduce il click su un tile KPI (bucket worst-wins) nel filtro tabella corrispondente.
  const selectDashboardBucket = useCallback(
    (category: KpiCategory, bucket: DashboardBucketKey | null) => {
      // Toggle: riclick sullo stesso bucket azzera.
      if (dashboardCategoryFilter === category && dashboardActiveBucket === bucket) {
        applyDashboardFilter(null);
        return;
      }

      const statesByBucket: Record<DashboardBucketKey, WorkerCourseRow["stato"][] | null> = {
        scaduto: ["scaduto", "perso"],
        daFare: ["da fare"],
        bloccato: null,
        inScadenza: ["in scadenza"],
        upgrade: ["upgrade"],
        programmato: ["programmato"],
        conforme: ["idoneo"],
        escluso: ["escluso"],
        sospeso: ["sospeso"],
        senzaObbligo: null,
        obbligati: null,
      };

      const states = bucket ? statesByBucket[bucket] : null;
      applyDashboardFilter({ category, states, blocked: bucket === "bloccato" });
      setDashboardActiveBucket(bucket);
    },
    [applyDashboardFilter, dashboardActiveBucket, dashboardCategoryFilter],
  );

  const resetAllFilters = useCallback(() => {
    setSearch("");
    setColumnFilters(INITIAL_COLUMN_FILTERS);
    setShowExcludedEmployees(false);
    setFilterError("");
    applyDashboardFilter(null);
  }, [applyDashboardFilter]);

  useEffect(() => {
    const width = tableRef.current?.scrollWidth ?? FORMAZIONE_TABLE_WIDTH;
    setTableScrollWidth(width);
  }, [filteredRows.length]);

  const selectionStats = useMemo(() => {
    const visibleIdsSet = new Set<number>();
    filteredRows.forEach((row) => visibleIdsSet.add(row.workerId));
    const visibleIds = Array.from(visibleIdsSet.values());
    let selectedVisible = 0;
    visibleIds.forEach((id) => {
      if (selectedWorkerIds.has(id)) selectedVisible += 1;
    });
    return {
      visibleIds,
      visibleCount: visibleIds.length,
      selectedVisible,
      allVisibleSelected: visibleIds.length > 0 && selectedVisible === visibleIds.length,
      someVisibleSelected: selectedVisible > 0 && selectedVisible < visibleIds.length,
    };
  }, [filteredRows, selectedWorkerIds]);

  const getFacetRows = useCallback(
    (exclude: "corso" | "stato" | "origine" | "dataConclusione" | "dataScadenza") => {
      const corsoFilter = exclude === "corso" || columnFilters.corso.length === 0 ? null : new Set(columnFilters.corso);
      const statoFilter = exclude === "stato" || columnFilters.stato.length === 0 ? null : new Set(columnFilters.stato);
      const origineFilter =
        exclude === "origine" || columnFilters.origine.length === 0 ? null : new Set(columnFilters.origine);
      const conclusioneFilter =
        exclude === "dataConclusione" || columnFilters.dataConclusione.length === 0
          ? null
          : new Set(columnFilters.dataConclusione);
      const scadenzaFilter =
        exclude === "dataScadenza" || columnFilters.dataScadenza.length === 0
          ? null
          : new Set(columnFilters.dataScadenza);

      return rowsForFacets.filter((row) => {
        if (corsoFilter && !corsoFilter.has(row.corsoCode)) return false;
        if (statoFilter && !statoFilter.has(row.stato)) return false;
        if (origineFilter && !origineFilter.has(row.origine)) return false;
        if (conclusioneFilter && !conclusioneFilter.has(isoToMonthYear(row.dataConclusione))) return false;
        if (scadenzaFilter && !scadenzaFilter.has(isoToMonthYear(row.dataScadenza))) return false;
        return true;
      });
    },
    [
      columnFilters.corso,
      columnFilters.dataConclusione,
      columnFilters.dataScadenza,
      columnFilters.origine,
      columnFilters.stato,
      rowsForFacets,
    ],
  );

  const corsoFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    getFacetRows("corso").forEach((row) => {
      if (!map.has(row.corsoCode)) map.set(row.corsoCode, `${row.corsoCode} ${row.corso}`.trim());
    });
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base", numeric: true }));
  }, [getFacetRows]);

  const origineFilterOptions = useMemo(() => {
    const set = new Set<WorkerCourseRow["origine"]>();
    getFacetRows("origine").forEach((row) => set.add(row.origine));
    return Array.from(set.values())
      .map((value) => ({ value, label: capitalizeFirst(value) }))
      .sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
  }, [getFacetRows]);

  const statoFilterOptions = useMemo(() => {
    const set = new Set<WorkerCourseRow["stato"]>();
    getFacetRows("stato").forEach((row) => set.add(row.stato));
    return Array.from(set.values())
      .map((value) => ({ value, label: formatStatoLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
  }, [getFacetRows]);

  const dataConclusioneFilterOptions = useMemo(() => {
    return buildMonthYearFilterOptions(getFacetRows("dataConclusione"), (row) => row.dataConclusione);
  }, [getFacetRows]);

  const dataScadenzaFilterOptions = useMemo(() => {
    return buildMonthYearFilterOptions(getFacetRows("dataScadenza"), (row) => row.dataScadenza);
  }, [getFacetRows]);

  const selectAllVisibleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!selectAllVisibleRef.current) return;
    selectAllVisibleRef.current.indeterminate = selectionStats.someVisibleSelected;
  }, [selectionStats.someVisibleSelected]);

  const toggleWorkerSelection = useCallback((workerId: number) => {
    setSelectedWorkerIds((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  }, []);

  const setAllVisibleSelection = useCallback((checked: boolean) => {
    setSelectedWorkerIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        selectionStats.visibleIds.forEach((id) => next.add(id));
      } else {
        selectionStats.visibleIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  }, [selectionStats.visibleIds]);

  function syncHorizontalScroll(source: "top" | "middle" | "bottom") {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const nextLeft =
      (source === "top"
        ? topScrollRef.current
        : source === "bottom"
          ? bottomScrollRef.current
          : tableScrollRef.current
      )?.scrollLeft ?? 0;
    if (source !== "top" && topScrollRef.current) topScrollRef.current.scrollLeft = nextLeft;
    if (source !== "bottom" && bottomScrollRef.current) bottomScrollRef.current.scrollLeft = nextLeft;
    if (source !== "middle" && tableScrollRef.current) tableScrollRef.current.scrollLeft = nextLeft;
    syncingRef.current = false;
  }

  const courseOptions = useMemo(() => {
    const map = new Map<string, CourseOption>();
    catalogCourses.forEach((course) => map.set(course.code, { id: course.id, code: course.code, title: course.title }));
    rows.forEach((row) => {
      if (map.has(row.corsoCode)) return;
      map.set(row.corsoCode, { id: row.courseId, code: row.corsoCode, title: row.corso });
    });

    // Ordina alfabeticamente per titolo "pulito" (senza il prefisso corso/formazione)
    // e mette l'aggiornamento di ogni corso subito sotto il corso base, per codice
    // (i titoli di base e aggiornamento non sempre coincidono testualmente, es.
    // "corso uso muletto" vs "Aggiornamento carrello elevatore").
    const cleanTitle = (title: string) => title.replace(/^\s*(corso|formazione)\s+/i, "").trim();
    const all = Array.from(map.values());
    const aggiornamentoCodes = new Set(all.filter((c) => c.code.endsWith("_AGGIORNAMENTO")).map((c) => c.code));
    const baseCourses = all.filter((c) => !aggiornamentoCodes.has(c.code));
    baseCourses.sort((a, b) => cleanTitle(a.title).localeCompare(cleanTitle(b.title), "it"));

    const ordered: CourseOption[] = [];
    baseCourses.forEach((base) => {
      ordered.push(base);
      const agg = map.get(`${base.code}_AGGIORNAMENTO`);
      if (agg) ordered.push(agg);
    });
    // Aggiornamenti "orfani" (nessun corso base con quel codice esatto, es. FORM_SPEC_AGGIORNAMENTO
    // che copre più livelli) vanno comunque in lista, in coda.
    aggiornamentoCodes.forEach((code) => {
      if (!ordered.some((c) => c.code === code)) {
        const agg = map.get(code);
        if (agg) ordered.push(agg);
      }
    });
    return ordered;
  }, [catalogCourses, rows]);

  const workerOptions = useMemo(() => {
    const map = new Map<
      number,
      { workerId: number; matricola: string; fullName: string; cantiere: string; sottocantiere: string }
    >();
    rows.forEach((row) => {
      if (map.has(row.workerId)) return;
      map.set(row.workerId, {
        workerId: row.workerId,
        matricola: row.matricola,
        fullName: `${row.cognome} ${row.nome}`.trim(),
        cantiere: row.cantiere,
        sottocantiere: row.sottocantiere,
      });
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.fullName !== b.fullName) return a.fullName.localeCompare(b.fullName);
      return a.matricola.localeCompare(b.matricola);
    });
  }, [rows]);

  const clearSelection = useCallback(() => {
    setSelectedWorkerIds(new Set());
  }, []);

  const openEventModal = useCallback(
    (init?: Partial<Omit<EventModalInit, "token">>) => {
      setEventModalInit((prev) => ({
        courseCode: init?.courseCode ?? "",
        courseSearch: init?.courseSearch ?? "",
        type: init?.type ?? "PROGRAMMATO",
        date: init?.date ?? "",
        note: init?.note ?? "",
        token: prev.token + 1,
      }));
      setIsEventModalOpen(true);
    },
    [],
  );

  function resetImportForm() {
    setImportFile(null);
    setImportPreview(null);
    setImportError("");
    setImportUndoMessage("");
  }

  async function runImportPreview() {
    if (!importFile) {
      setImportError("Seleziona prima un file .xls/.xlsx da analizzare.");
      return;
    }

    setImportLoading(true);
    setImportError("");
    setImportPreview(null);
    importRunTokenRef.current += 1;
    const token = importRunTokenRef.current;
    if (importProgressTimerRef.current !== null) {
      window.clearInterval(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }
    setImportProgress(0);
    importProgressTimerRef.current = window.setInterval(() => {
      setImportProgress((value) => {
        if (importRunTokenRef.current !== token) return value;
        if (value >= 99) return 99;
        const step = value < 60 ? 4 : value < 85 ? 2 : 1;
        return Math.min(99, value + step);
      });
    }, 350);
    try {
      const formData = new FormData();
      formData.set("mode", "preview");
      formData.set("file", importFile);

      const response = await fetch("/api/formazione/import", {
        method: "POST",
        body: formData,
      });
      const body = await readJsonSafely<ImportPreviewResult & { error?: string }>(response);
      if (!response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore preview import massivo"));
      }
      setImportPreview(body as ImportPreviewResult);
      if (importRunTokenRef.current === token && importProgressTimerRef.current !== null) {
        window.clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImportProgress(100);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Errore preview import massivo.");
      setImportProgress(0);
    } finally {
      if (importRunTokenRef.current === token && importProgressTimerRef.current !== null) {
        window.clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImportLoading(false);
    }
  }

  async function runImportCommit() {
    if (!importFile) {
      setImportError("Seleziona prima un file .xls/.xlsx da importare.");
      return;
    }

    setImportLoading(true);
    setImportError("");
    importRunTokenRef.current += 1;
    const token = importRunTokenRef.current;
    if (importProgressTimerRef.current !== null) {
      window.clearInterval(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }
    setImportProgress(0);
    importProgressTimerRef.current = window.setInterval(() => {
      setImportProgress((value) => {
        if (importRunTokenRef.current !== token) return value;
        if (value >= 99) return 99;
        const step = value < 60 ? 4 : value < 85 ? 2 : 1;
        return Math.min(99, value + step);
      });
    }, 350);
    try {
      const formData = new FormData();
      formData.set("mode", "commit");
      formData.set("file", importFile);

      const response = await fetch("/api/formazione/import", {
        method: "POST",
        body: formData,
      });
      const body = await readJsonSafely<ImportPreviewResult & { error?: string }>(response);
      if (!response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore commit import massivo"));
      }
      setImportPreview(body as ImportPreviewResult);
      if (importRunTokenRef.current === token && importProgressTimerRef.current !== null) {
        window.clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImportProgress(100);

      await refreshImportLastRun();
      await loadRows();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Errore commit import massivo.");
      setImportProgress(0);
    } finally {
      if (importRunTokenRef.current === token && importProgressTimerRef.current !== null) {
        window.clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImportLoading(false);
    }
  }

  async function runImportUndo() {
    setImportUndoLoading(true);
    setImportError("");
    setImportUndoMessage("");
    try {
      const response = await fetch("/api/formazione/import/undo", { method: "POST" });
      const body = await readJsonSafely<
        { ok: true; deletedRows: number; restoredRows: number; skippedRows: number; source: string } | { error: string }
      >(response);
      if (!response.ok || extractResponseError(body)) {
        throw new Error(buildHttpErrorMessage(response, body, "Errore annullamento import"));
      }
      setImportUndoMessage(
        `Annullamento completato (${(body as { source: string }).source}): ripristinate ${(body as { restoredRows: number }).restoredRows}, eliminate ${(body as { deletedRows: number }).deletedRows}, saltate ${(body as { skippedRows: number }).skippedRows}.`,
      );
      await refreshImportLastRun();
      await loadRows();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Errore annullamento import.");
    } finally {
      setImportUndoLoading(false);
    }
  }

  async function runExport() {
    setIsExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams();
      params.set("date", simulationDate);
      params.set("expiringDays", String(expiringDays));
      params.set("panel", "formazione");
      if (showExcludedEmployees) params.set("includeExcluded", "1");

      const q = search.trim();
      if (q) params.set("q", q);

      if (dashboardCategoryFilter) params.set("category", dashboardCategoryFilter);

      {
        let exportStates: WorkerCourseRow["stato"][] = [];
        if (dashboardStateFilter && dashboardStateFilter.length > 0) {
          exportStates =
            columnFilters.stato.length > 0
              ? dashboardStateFilter.filter((s) => columnFilters.stato.includes(s))
              : dashboardStateFilter;
        } else if (columnFilters.stato.length > 0) {
          exportStates = columnFilters.stato;
        }
        if (exportStates.length > 0) params.set("states", exportStates.join(","));
      }

      if (columnFilters.origine.length > 0) params.set("origini", columnFilters.origine.join(","));

      if (columnFilters.matricola) params.set("matricola", columnFilters.matricola);
      if (columnFilters.cognome) params.set("cognome", columnFilters.cognome);
      if (columnFilters.nome) params.set("nome", columnFilters.nome);
      if (columnFilters.mansione) params.set("mansione", columnFilters.mansione);
      if (columnFilters.cantiere) params.set("cantiere", columnFilters.cantiere);
      if (columnFilters.sottocantiere) params.set("sottocantiere", columnFilters.sottocantiere);
      if (columnFilters.responsabile) params.set("responsabile", columnFilters.responsabile);
      if (columnFilters.referente) params.set("referente", columnFilters.referente);
      if (columnFilters.corso.length > 0) params.set("courseCodes", columnFilters.corso.join(","));
      if (columnFilters.dataConclusione.length > 0)
        params.set("completionMonths", columnFilters.dataConclusione.join(","));
      if (columnFilters.dataScadenza.length > 0) params.set("expiryMonths", columnFilters.dataScadenza.join(","));
      if (columnFilters.note) params.set("note", columnFilters.note);

      const response = await fetch(`/api/formazione/export?${params.toString()}`);
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Errore export.");
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
      const filename = match?.[1] ?? "export_formazione.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Errore export.");
    } finally {
      setIsExporting(false);
    }
  }

  function openQuickAction(row: WorkerCourseRow) {
    setSelectedWorkerIds((prev) => {
      const next = new Set(prev);
      next.add(row.workerId);
      return next;
    });

    openEventModal({
      courseCode: row.corsoCode,
      courseSearch: `${row.corsoCode} ${row.corso}`,
      type: row.stato === "programmato" ? "RIMUOVI_PROGRAMMATO" : "PROGRAMMATO",
      date: "",
      note: "",
    });
  }

  function openRowEvent(row: WorkerCourseRow) {
    if (row.stato === "programmato") {
      void removeProgrammedInline(row);
      return;
    }
    setSelectedWorkerIds(new Set([row.workerId]));
    openEventModal({
      courseCode: row.corsoCode,
      courseSearch: `${row.corsoCode} ${row.corso}`.trim(),
      type: "PROGRAMMATO",
      date: "",
      note: "",
    });
  }

  const pageDashboardData = useMemo(() => {
    const baseRows = rows.filter((row) => isDashboardBaseRow(row));
    const operativiRows = rows.filter((row) => !isDashboardBaseRow(row));
    return {
      base: { rows: baseRows, summary: buildDashboardSummary(baseRows, totalActiveEmployees) },
      operativi: { rows: operativiRows, summary: buildDashboardSummary(operativiRows, totalActiveEmployees) },
    };
  }, [rows, totalActiveEmployees]);

  const dashboardDetailByJob = useMemo(() => {
    const entityByKey = new Map(jobEntities.map((entity) => [entity.key, entity]));
    const keysInOrder = jobEntities.map((entity) => entity.key);

    const workersByJob = new Map<string, Set<number>>();
    const baseRowsByJob = new Map<string, WorkerCourseRow[]>();
    const operativiRowsByJob = new Map<string, WorkerCourseRow[]>();

    dashboardRows.forEach((row) => {
      const key = normalizeJobCode(row.mansione || "");
      if (!key) return;

      const workerSet = workersByJob.get(key) ?? new Set<number>();
      workerSet.add(row.workerId);
      workersByJob.set(key, workerSet);

      const targetMap = isDashboardBaseRow(row) ? baseRowsByJob : operativiRowsByJob;
      const list = targetMap.get(key);
      if (!list) {
        targetMap.set(key, [row]);
      } else {
        list.push(row);
      }
    });

    const unknownKeys = Array.from(workersByJob.keys()).filter((key) => !entityByKey.has(key));
    unknownKeys.sort((a, b) => a.localeCompare(b));

    return [...keysInOrder, ...unknownKeys].map((jobKey) => {
      const entity = entityByKey.get(jobKey);
      const label = entity?.label ?? jobKey;
      const isExtra = Boolean(entity?.isExtra);
      const total = workersByJob.get(jobKey)?.size ?? 0;
      const baseRowsForJob = baseRowsByJob.get(jobKey) ?? [];
      const operativiRowsForJob = operativiRowsByJob.get(jobKey) ?? [];
      const baseBuckets = buildWorkerBuckets(baseRowsForJob, total);
      const operativiBuckets = buildWorkerBuckets(operativiRowsForJob, total);

      return {
        jobKey,
        label,
        isExtra,
        total,
        base: baseBuckets,
        operativi: operativiBuckets,
        baseCritico: baseBuckets.scaduto + baseBuckets.daFare + baseBuckets.upgrade + baseBuckets.inScadenza,
        operativiCritico:
          operativiBuckets.bloccato +
          operativiBuckets.scaduto +
          operativiBuckets.daFare +
          operativiBuckets.upgrade +
          operativiBuckets.inScadenza,
      };
    });
  }, [dashboardRows, jobEntities]);

  const dashboardDetailSorted = useMemo(() => {
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

    const base = dashboardDetailByJob
      .slice()
      .sort((a, b) => b.baseCritico - a.baseCritico || byLabel(a, b));
    const operativi = dashboardDetailByJob
      .slice()
      .sort((a, b) => b.operativiCritico - a.operativiCritico || byLabel(a, b));

    return { base, operativi };
  }, [dashboardDetailByJob]);

  return (
    <div className="theme-formazione space-y-4 animate-tab-content">
      <ModuleHeader
        title="Formazione"
        description="Elenco lavoratori per corso e stato scadenza."
        actions={
          <>
            <button
              type="button"
              onClick={() => openEventModal()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
              title="Nuovo evento corso"
            >
              + Evento
            </button>
            <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-700">
              <span className="font-semibold text-[var(--brand-ink)]">{selectedWorkerIds.size}</span>
              <span>selezionati</span>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-lg bg-[var(--brand-primary)] px-2 py-1 text-xs font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
                disabled={selectedWorkerIds.size === 0}
              >
                Pulisci
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                resetImportForm();
                setIsImportModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
              title="Import massivo scadenzario"
            >
              Import massivo
            </button>
            <button
              type="button"
              onClick={() => setIsImportProgrammatiModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
              title="Importa programmati da file export compilato"
            >
              Importa programmati
            </button>
            <button
              type="button"
              onClick={() => void runExport()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              title="Export Excel"
              disabled={isExporting}
            >
              {isExporting ? "Export…" : "Export"}
            </button>
            <button
              type="button"
              onClick={() => void openDetail()}
              className="inline-flex items-center gap-2 rounded-xl border border-[#2f5ea8] bg-gradient-to-r from-[var(--brand-primary)] to-[#2f5ea8] px-4 py-2 text-sm font-bold text-white shadow-sm ring-1 ring-white/20 transition hover:-translate-y-0.5 hover:shadow-md"
              title="Apri dettaglio formazione"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-white/20">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                  aria-hidden
                >
                  <path d="M4 19h16" />
                  <path d="M7 16V9" />
                  <path d="M12 16v-5" />
                  <path d="M17 16V7" />
                </svg>
              </span>
              Dettaglio
            </button>
          </>
        }
      >
        {exportError ? <p className="text-xs font-medium text-red-600">{exportError}</p> : null}
        {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      </ModuleHeader>

      <DashboardCard className="p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--brand-ink)]">Cruscotto Operativo</h2>
            <p className="mt-1 text-xs text-slate-500">
              Totale lavoratori attivi: {totalActiveEmployees} · Esclusi da scope: {excludedByScopeEmployees} · Sospesi: {frozenEmployees}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dashboardCategoryFilter || (dashboardStateFilter && dashboardStateFilter.length > 0) || dashboardBlockedFilter ? (
              <button
                type="button"
                onClick={() => applyDashboardFilter(null)}
                className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
              >
                Reset filtro
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setIsDashboardCollapsed((value) => !value)}
              className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
              title={isDashboardCollapsed ? "Espandi cruscotto" : "Comprimi cruscotto"}
            >
              {isDashboardCollapsed ? "Espandi" : "Comprimi"}
            </button>
          </div>
        </div>
        {!isDashboardCollapsed ? (
          <DashboardKpi
            baseBuckets={pageDashboardData.base.summary.workers}
            operativiBuckets={pageDashboardData.operativi.summary.workers}
            total={totalActiveEmployees}
            activeCategory={dashboardCategoryFilter}
            activeBucket={dashboardActiveBucket}
            onSelect={selectDashboardBucket}
          />
        ) : null}
      </DashboardCard>

      <PanelCard className="p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_140px_auto]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ricerca: cantiere, sottocantiere, cognome, nome, responsabile, referente"
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
          <input
            value={simulationDateDraft}
            inputMode="numeric"
            onChange={(event) => {
              setFilterError("");
              setSimulationDateDraft(normalizeItDateDraft(event.target.value));
            }}
            onBlur={() => {
              if (simulationDateDraft.trim().length !== 10) return;
              const next = parseStrictItDateToIso(simulationDateDraft);
              if (!next) {
                setFilterError("Data non valida (formato gg/mm/aaaa).");
                return;
              }
              setFilterError("");
              setSimulationDate(next);
              setSimulationDateDraft(formatIsoToItDate(next));
            }}
            placeholder="gg/mm/aaaa"
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          />
          <select
            value={String(expiringDays)}
            onChange={(event) => setExpiringDays(Number(event.target.value))}
            className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-sm"
          >
            <option value="7">7gg</option>
            <option value="30">30gg</option>
            <option value="60">60gg</option>
            <option value="90">90gg</option>
          </select>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showExcludedEmployees}
                onChange={(event) => setShowExcludedEmployees(event.target.checked)}
                className="h-4 w-4"
              />
              Mostra esclusi
            </label>
            <button
              type="button"
              onClick={resetAllFilters}
              className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
            >
              Reset filtri
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Simulazione su data selezionata (in scadenza: {expiringDays}gg).
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Visibili: <span className="font-semibold text-slate-700">{selectionStats.visibleCount}</span> lavoratori ·{" "}
          <span className="font-semibold text-slate-700">{sortedRows.length}</span> righe
        </p>
        {filterError ? <p className="mt-2 text-xs font-medium text-red-600">{filterError}</p> : null}
        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
        {inlineSaveError ? <p className="mt-2 text-xs font-medium text-red-600">{inlineSaveError}</p> : null}
      </PanelCard>

      <section className="overflow-hidden rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)]">
        <div
          ref={topScrollRef}
          onScroll={() => syncHorizontalScroll("top")}
          className="overflow-x-auto border-b border-[var(--brand-line)]"
        >
          <div style={{ width: tableScrollWidth, height: 16 }} />
        </div>
        <div
          ref={tableScrollRef}
          onScroll={() => syncHorizontalScroll("middle")}
          className="max-h-[62vh] overflow-auto hide-native-hscrollbar"
        >
          <table
            ref={tableRef}
            style={{ width: FORMAZIONE_TABLE_WIDTH }}
            className="min-w-full table-fixed text-left text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap"
          >
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 240 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: FORMAZIONE_STATO_COL_WIDTH }} />
              <col style={{ width: 170 }} />
              <col style={{ width: FORMAZIONE_NOTE_COL_WIDTH }} />
            </colgroup>
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 top-0 z-40 bg-[var(--brand-panel)] px-4 py-2">
                  <input
                    ref={selectAllVisibleRef}
                    type="checkbox"
                    checked={selectionStats.allVisibleSelected}
                    onChange={(event) => setAllVisibleSelection(event.target.checked)}
                    aria-label="Seleziona tutti i lavoratori visibili"
                    disabled={selectionStats.visibleCount === 0}
                  />
                </th>
                <th className="sticky left-[56px] top-0 z-40 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("matricola")} className="inline-flex items-center gap-1">
                    Matricola {sortIcon("matricola")}
                  </button>
                </th>
                <th className="sticky left-[176px] top-0 z-40 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("cognome")} className="inline-flex items-center gap-1">
                    Cognome {sortIcon("cognome")}
                  </button>
                </th>
                <th className="sticky left-[346px] top-0 z-40 border-r border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("nome")} className="inline-flex items-center gap-1">
                    Nome {sortIcon("nome")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("mansione")} className="inline-flex items-center gap-1">
                    Mansione {sortIcon("mansione")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("cantiere")} className="inline-flex items-center gap-1">
                    Cantiere {sortIcon("cantiere")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("sottocantiere")}
                    className="inline-flex items-center gap-1"
                  >
                    Sottocantiere {sortIcon("sottocantiere")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("responsabile")}
                    className="inline-flex items-center gap-1"
                  >
                    Responsabile {sortIcon("responsabile")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("referente")} className="inline-flex items-center gap-1">
                    Referente {sortIcon("referente")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("corso")} className="inline-flex items-center gap-1">
                    Corso {sortIcon("corso")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("dataConclusione")}
                    className="inline-flex items-center gap-1"
                  >
                    Data conclusione {sortIcon("dataConclusione")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("dataScadenza")}
                    className="inline-flex items-center gap-1"
                  >
                    Data scadenza {sortIcon("dataScadenza")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("dataPrevista")}
                    className="inline-flex items-center gap-1"
                  >
                    Data prevista {sortIcon("dataPrevista")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("stato")} className="inline-flex items-center gap-1">
                    Stato {sortIcon("stato")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Azione</th>
                <th
                  style={{ width: FORMAZIONE_NOTE_COL_WIDTH, minWidth: FORMAZIONE_NOTE_COL_WIDTH }}
                  className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2"
                >
                  <button type="button" onClick={() => toggleSort("note")} className="inline-flex items-center gap-1">
                    Note {sortIcon("note")}
                  </button>
                </th>
              </tr>
              <tr>
                <th className="sticky left-0 top-8 z-30 bg-white px-3 py-2" />
                <th className="sticky left-[56px] top-8 z-30 bg-white px-3 py-2">
                  <input value={columnFilters.matricola} onChange={(event) => setColumnFilters((v) => ({ ...v, matricola: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky left-[176px] top-8 z-30 bg-white px-3 py-2">
                  <input value={columnFilters.cognome} onChange={(event) => setColumnFilters((v) => ({ ...v, cognome: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky left-[346px] top-8 z-30 border-r border-[var(--brand-line)] bg-white px-3 py-2">
                  <input value={columnFilters.nome} onChange={(event) => setColumnFilters((v) => ({ ...v, nome: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.mansione} onChange={(event) => setColumnFilters((v) => ({ ...v, mansione: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.cantiere} onChange={(event) => setColumnFilters((v) => ({ ...v, cantiere: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.sottocantiere} onChange={(event) => setColumnFilters((v) => ({ ...v, sottocantiere: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.responsabile} onChange={(event) => setColumnFilters((v) => ({ ...v, responsabile: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.referente} onChange={(event) => setColumnFilters((v) => ({ ...v, referente: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <MultiSelectDropdown
                    selected={columnFilters.corso}
                    options={corsoFilterOptions}
                    onChange={(selected) => setColumnFilters((v) => ({ ...v, corso: selected }))}
                    placeholder="Tutti"
                    searchable
                    searchPlaceholder="Cerca corso"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <MultiSelectDropdown
                    selected={columnFilters.dataConclusione}
                    options={dataConclusioneFilterOptions}
                    onChange={(selected) => setColumnFilters((v) => ({ ...v, dataConclusione: selected }))}
                    placeholder="mm/aaaa"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <MultiSelectDropdown
                    selected={columnFilters.dataScadenza}
                    options={dataScadenzaFilterOptions}
                    onChange={(selected) => setColumnFilters((v) => ({ ...v, dataScadenza: selected }))}
                    placeholder="mm/aaaa"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2" />
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <MultiSelectDropdown
                    selected={columnFilters.stato}
                    options={statoFilterOptions}
                    onChange={(selected) => setColumnFilters((v) => ({ ...v, stato: selected }))}
                    placeholder="Tutti"
                  />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2" />
                <th
                  style={{ width: FORMAZIONE_NOTE_COL_WIDTH, minWidth: FORMAZIONE_NOTE_COL_WIDTH }}
                  className="sticky top-8 z-10 bg-white px-3 py-2"
                >
                  <input value={columnFilters.note} onChange={(event) => setColumnFilters((v) => ({ ...v, note: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro note" />
                </th>
              </tr>
            </thead>
            <tbody>
              {virtualPaddingTop > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={15} style={{ height: virtualPaddingTop, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {virtualRows.map((virtualRow) => {
                const row = sortedRows[virtualRow.index];
                const isLost = row.stato === "perso";
                const textClass = isLost ? "text-slate-400" : "text-slate-600";
                const rowClass = isLost
                  ? "border-t border-[var(--brand-line)] bg-slate-50/70 transition hover:bg-slate-100/60"
                  : "border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60";
                const stickyBg = isLost
                  ? "bg-slate-50/70 group-hover:bg-slate-100/60"
                  : "bg-[var(--brand-panel)] group-hover:bg-[var(--brand-panel)]/60";
                const inlineKey = `${row.workerId}-${row.corsoCode}`;
                const isInlineSaving = inlineSavingKeys.has(inlineKey);

                return (
                <tr
                  key={`${row.workerId}-${row.corsoCode}`}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className={`${rowClass} group`}
                >
                  <td className={`sticky left-0 z-20 px-4 py-2.5 ${stickyBg}`}>
                    <input
                      type="checkbox"
                      checked={selectedWorkerIds.has(row.workerId)}
                      onChange={() => toggleWorkerSelection(row.workerId)}
                      aria-label={`Seleziona ${row.cognome} ${row.nome} (${row.matricola})`}
                    />
                  </td>
                  <td className={`sticky left-[56px] z-20 px-4 py-2.5 ${stickyBg} ${textClass}`}>{row.matricola}</td>
                  <td className={`sticky left-[176px] z-20 max-w-[170px] truncate px-4 py-2.5 ${stickyBg} ${textClass}`} title={row.cognome}>
                    <button type="button" data-unstyled="true" onClick={() => void openWorkerDetail(row)} className="hover:underline text-left text-slate-800 dark:text-slate-200">
                      {row.cognome}
                    </button>
                  </td>
                  <td className={`sticky left-[346px] z-20 max-w-[170px] truncate border-r border-[var(--brand-line)] px-4 py-2.5 ${stickyBg} ${textClass}`} title={row.nome}>
                    <button type="button" data-unstyled="true" onClick={() => void openWorkerDetail(row)} className="hover:underline text-left text-slate-800 dark:text-slate-200">
                      {row.nome}
                    </button>
                  </td>
                  <td className={`max-w-[220px] truncate px-4 py-2.5 ${textClass}`} title={row.mansione || "-"}>{row.mansione || "-"}</td>
                  <td className={`max-w-[170px] truncate px-4 py-2.5 ${textClass}`} title={row.cantiere}>{row.cantiere}</td>
                  <td className={`max-w-[170px] truncate px-4 py-2.5 ${textClass}`} title={row.sottocantiere}>{row.sottocantiere}</td>
                  <td className={`max-w-[170px] truncate px-4 py-2.5 ${textClass}`} title={row.responsabile || "-"}>{row.responsabile || "-"}</td>
                  <td className={`max-w-[170px] truncate px-4 py-2.5 ${textClass}`} title={row.referente || "-"}>{row.referente || "-"}</td>
                  <td className={`w-[260px] px-4 py-2.5 leading-snug ${textClass}`} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={row.corso}>{row.corso}</td>
                  <td className={`px-4 py-2.5 font-medium tabular-nums ${textClass}`}>
                    {formatDateIt(row.dataConclusione)}
                  </td>
                  <td className={`px-4 py-2.5 font-medium tabular-nums ${textClass}`}>
                    {formatDateIt(row.dataScadenza)}
                  </td>
                  <td className={`px-4 py-2.5 font-medium tabular-nums ${textClass}`}>
                    {formatDateIt(row.dataPrevista)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={isInlineSaving}
                        onClick={() => openRowEvent(row)}
                        data-unstyled="true"
                        className={[
                          statusClassName(row.stato),
                          "transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60",
                        ].join(" ")}
                        title={
                          row.blockedBy
                            ? `Bloccato: ${row.blockedBy.title} (${row.blockedBy.code}) non in regola`
                            : "Cambia stato (Evento)"
                        }
                      >
                        {row.blockedBy ? "bloccato" : row.stato}
                      </button>
                      {row.blockedBy ? (
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] font-semibold text-red-600"
                          title={`Prerequisito non in regola: ${row.blockedBy.title} (${row.blockedBy.code})`}
                        >
                          ⚠ {row.blockedBy.code}
                        </span>
                      ) : row.stato === "upgrade" && row.upgradeInfo ? (
                        <span
                          className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${textClass}`}
                          title={row.upgradeInfo}
                        >
                          {row.upgradeInfo}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-unstyled="true"
                        onClick={() => {
                          setSelectedWorkerIds(new Set([row.workerId]));
                          openEventModal({
                            courseCode: row.corsoCode,
                            courseSearch: `${row.corsoCode} ${row.corso}`.trim(),
                            type: "SVOLTO",
                            date: "",
                            note: "",
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--brand-line)] bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-[var(--brand-panel-2)]"
                        title="Registra corso svolto"
                      >
                        <Award className="h-3.5 w-3.5" />
                        Svolto
                      </button>
                    <ActionMenu
                      actions={[
                        {
                          label: "Scheda Lavoratore",
                          icon: <Eye className="h-3.5 w-3.5" />,
                          onClick: () => void openWorkerDetail(row)
                        },
                        {
                          label: row.stato === "programmato" ? "Rimuovi Pianificato" : "Pianifica Corso",
                          icon: <Calendar className="h-3.5 w-3.5" />,
                          onClick: () => openQuickAction(row)
                        },
                        {
                          label: "Scarica Fascicolo PDF",
                          icon: <FileText className="h-3.5 w-3.5" />,
                          onClick: () => {
                            window.open(`/api/lavoratori/fascicolo?employeeId=${row.workerId}`, "_blank");
                          }
                        }
                      ]}
                    />
                    </div>
                  </td>
                  <td style={{ width: FORMAZIONE_NOTE_COL_WIDTH, minWidth: FORMAZIONE_NOTE_COL_WIDTH }} className={`px-4 py-2.5 ${textClass}`}>
                    <input
                      key={`${inlineKey}-${row.note}`}
                      type="text"
                      defaultValue={row.note ?? ""}
                      disabled={isInlineSaving}
                      onBlur={(event) => {
                        const next = String(event.target.value ?? "");
                        if (next !== row.note) void saveInlineNote(row, next);
                      }}
                      className="w-full rounded-lg border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="-"
                    />
                  </td>
                </tr>
                );
              })}
              {virtualPaddingBottom > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={15} style={{ height: virtualPaddingBottom, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {!isLoading && sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nessun dato disponibile.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div
          ref={bottomScrollRef}
          onScroll={() => syncHorizontalScroll("bottom")}
          className="overflow-x-auto border-t border-[var(--brand-line)]"
        >
          <div style={{ width: tableScrollWidth, height: 16 }} />
        </div>
      </section>

      {isDashboardDetailOpen ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-5 py-4">
              <div className="space-y-0.5">
                <h2 className="text-lg font-bold text-[var(--brand-ink)]">
                  Dettaglio per mansione
                </h2>
                <p className="text-xs text-slate-500">
                  Percentuali calcolate sul totale dipendenti della mansione.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-unstyled="true"
                  onClick={() => setShowOnlyProblemJobsInDetail((v) => !v)}
                  className={[
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition",
                    showOnlyProblemJobsInDetail
                      ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                      : "border-[var(--brand-line)] bg-white text-slate-600 hover:bg-[var(--brand-panel-2)]",
                  ].join(" ")}
                >
                  Solo problematiche
                </button>
                <button
                  type="button"
                  data-unstyled="true"
                  onClick={() => setShowEmptyJobsInDetail((v) => !v)}
                  className={[
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition",
                    showEmptyJobsInDetail
                      ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                      : "border-[var(--brand-line)] bg-white text-slate-600 hover:bg-[var(--brand-panel-2)]",
                  ].join(" ")}
                >
                  Mostra mansioni vuote
                </button>
                <button
                  type="button"
                  onClick={() => setIsDashboardDetailOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                  title="Chiudi dettaglio"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {dashboardLoading ? <p className="mt-1 text-sm text-slate-600">Caricamento dettaglio...</p> : null}
              {dashboardError ? (
                <p className="mt-1 text-sm font-medium text-red-600">{dashboardError}</p>
              ) : null}

              {!dashboardLoading && !dashboardError ? (
                <div className="space-y-6">
                  <div className="overflow-hidden rounded-xl border border-[var(--brand-line)] bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-3">
                      <h3 className="text-sm font-bold text-[var(--brand-ink)]">Base</h3>
                      <span className="text-xs text-slate-500">
                        Totale lavoratori {dashboardTotalByAnagrafica}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-white text-[10px] uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="sticky left-0 z-20 w-[420px] bg-white px-3 py-2">Mansione</th>
                            <th className="w-[72px] px-2 py-2 text-right">Dip</th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-red-600" />
                                Scaduto
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-rose-600" />
                                Da fare
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                                In scadenza
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-sky-500" />
                                Programmato
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-purple-500" />
                                Upgrade
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                Conforme
                              </span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardDetailSorted.base
                            .filter((item) => showEmptyJobsInDetail || item.total > 0)
                            .filter((item) => {
                              if (!showOnlyProblemJobsInDetail) return true;
                              const b = item.base;
                              const problems = b.scaduto + b.daFare + b.inScadenza + b.programmato + b.upgrade;
                              return problems > 0;
                            })
                            .map((item, index) => (
                            <tr
                              key={`base-${item.jobKey}`}
                              className={[
                                "border-t border-[var(--brand-line)]",
                                index % 2 === 1 ? "bg-[var(--brand-panel)]/40" : "bg-white",
                                "hover:bg-[var(--brand-panel)]/70",
                              ].join(" ")}
                            >
                              <td
                                className={[
                                  "sticky left-0 z-10 max-w-[420px] px-3 py-2 font-semibold",
                                  index % 2 === 1 ? "bg-[var(--brand-panel)]/40" : "bg-white",
                                  item.isExtra ? "text-red-700" : "text-[var(--brand-ink)]",
                                ].join(" ")}
                              >
                                <span className="inline-flex items-center gap-2">
                                  {item.isExtra ? <span className="h-2 w-2 rounded-full bg-red-600" /> : null}
                                  {item.label}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-200">{item.total}</td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="scaduto" count={item.base.scaduto} pct={percentage(item.base.scaduto, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="da_fare" count={item.base.daFare} pct={percentage(item.base.daFare, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="in_scadenza" count={item.base.inScadenza} pct={percentage(item.base.inScadenza, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="programmato" count={item.base.programmato} pct={percentage(item.base.programmato, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="upgrade" count={item.base.upgrade} pct={percentage(item.base.upgrade, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="conforme" count={item.base.conforme} pct={percentage(item.base.conforme, item.total)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-[var(--brand-line)] bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-4 py-3">
                      <h3 className="text-sm font-bold text-[var(--brand-ink)]">Operativi</h3>
                      <span className="text-xs text-slate-500">
                        Totale lavoratori {dashboardTotalByAnagrafica}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-white text-[10px] uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="sticky left-0 z-20 w-[420px] bg-white px-3 py-2">Mansione</th>
                            <th className="w-[72px] px-2 py-2 text-right">Dip</th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-red-700" />
                                Bloccato
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-red-600" />
                                Scaduto
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-rose-600" />
                                Da fare
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                                In scadenza
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-sky-500" />
                                Programmato
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-purple-500" />
                                Upgrade
                              </span>
                            </th>
                            <th className="w-[92px] px-2 py-2 text-right">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                Conforme
                              </span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardDetailSorted.operativi
                            .filter((item) => showEmptyJobsInDetail || item.total > 0)
                            .filter((item) => {
                              if (!showOnlyProblemJobsInDetail) return true;
                              const o = item.operativi;
                              const problems = o.bloccato + o.scaduto + o.daFare + o.inScadenza + o.programmato + o.upgrade;
                              return problems > 0;
                            })
                            .map((item, index) => (
                            <tr
                              key={`operativi-${item.jobKey}`}
                              className={[
                                "border-t border-[var(--brand-line)]",
                                index % 2 === 1 ? "bg-[var(--brand-panel)]/40" : "bg-white",
                                "hover:bg-[var(--brand-panel)]/70",
                              ].join(" ")}
                            >
                              <td
                                className={[
                                  "sticky left-0 z-10 max-w-[420px] px-3 py-2 font-semibold",
                                  index % 2 === 1 ? "bg-[var(--brand-panel)]/40" : "bg-white",
                                  item.isExtra ? "text-red-700" : "text-[var(--brand-ink)]",
                                ].join(" ")}
                              >
                                <span className="inline-flex items-center gap-2">
                                  {item.isExtra ? <span className="h-2 w-2 rounded-full bg-red-600" /> : null}
                                  {item.label}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-200">{item.total}</td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="bloccato" count={item.operativi.bloccato} pct={percentage(item.operativi.bloccato, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="scaduto" count={item.operativi.scaduto} pct={percentage(item.operativi.scaduto, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="da_fare" count={item.operativi.daFare} pct={percentage(item.operativi.daFare, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="in_scadenza" count={item.operativi.inScadenza} pct={percentage(item.operativi.inScadenza, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="programmato" count={item.operativi.programmato} pct={percentage(item.operativi.programmato, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="upgrade" count={item.operativi.upgrade} pct={percentage(item.operativi.upgrade, item.total)} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800 dark:text-slate-200">
                                <StateCell tone="conforme" count={item.operativi.conforme} pct={percentage(item.operativi.conforme, item.total)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {isWorkerDetailOpen ? (
        <>
          <div 
            className="drawer-backdrop open" 
            onClick={() => {
              setIsWorkerDetailOpen(false);
              setWorkerDetailEmployeeId(null);
              setWorkerDetailRows([]);
              setWorkerDetailError("");
              setIsExclusionNoteModalOpen(false);
            }} 
          />
          <section className="drawer-panel open flex flex-col h-full z-50">
            <div className="flex items-center justify-between p-4 border-b border-[var(--brand-line)] bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <div className="space-y-0.5">
                <h2 className="text-md font-bold text-[var(--brand-ink)]">Dettaglio lavoratore</h2>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">{workerDetailTitle}</p>
              </div>
              <button
                type="button"
                data-unstyled="true"
                onClick={() => {
                  setIsWorkerDetailOpen(false);
                  setWorkerDetailEmployeeId(null);
                  setWorkerDetailRows([]);
                  setWorkerDetailError("");
                  setIsExclusionNoteModalOpen(false);
                }}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                title="Chiudi"
              >
                ✕
              </button>
            </div>

            <div className="border-b border-[var(--brand-line)] px-4 py-2 bg-white dark:bg-slate-900 shrink-0">
              <div className="flex gap-2">
                <button
                  type="button"
                  data-unstyled="true"
                  onClick={() => setWorkerDetailTab("formazione")}
                  className={[
                    "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                    workerDetailTab === "formazione"
                      ? "bg-[var(--brand-primary)] text-white"
                      : "border border-[var(--brand-line)] bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Formazione
                </button>
                <button
                  type="button"
                  data-unstyled="true"
                  onClick={() => setWorkerDetailTab("esclusioni")}
                  className={[
                    "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                    workerDetailTab === "esclusioni"
                      ? "bg-[var(--brand-primary)] text-white"
                      : "border border-[var(--brand-line)] bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Esclusioni
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/10">
              {workerDetailLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2">
                  <div className="h-6 w-6 rounded-full border-2 border-[var(--brand-primary)] border-t-transparent animate-spin" />
                  <p className="text-xs text-slate-400 font-medium">Caricamento...</p>
                </div>
              ) : workerDetailError ? (
                <p className="text-xs font-medium text-red-600 p-2 bg-red-50 rounded-xl">{workerDetailError}</p>
              ) : workerDetailTab === "formazione" ? (
                <div className="space-y-3">
                  {employeeExclusion.isActive ? (
                    <div className="rounded-xl border border-red-200/40 bg-red-50/15 p-3 text-xs text-red-800 dark:text-red-300 font-medium">
                      Lavoratore escluso dal modulo Formazione.
                    </div>
                  ) : null}
                  
                  {workerDetailRows.length === 0 ? (
                    <p className="text-xs text-slate-400 py-10 text-center">Nessun corso disponibile.</p>
                  ) : (
                    workerDetailRows
                      .slice()
                      .sort((a, b) => `${a.corsoCode} ${a.corso}`.localeCompare(`${b.corsoCode} ${b.corso}`))
                      .map((r) => {
                        const courseId = r.courseId ?? null;
                        const isExcluded = courseId ? courseExclusionNotes.has(courseId) : false;
                        return (
                          <div
                            key={`${r.workerId}-${r.corsoCode}-${r.origine}`}
                            className="rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-900 p-3 shadow-sm text-xs flex flex-col gap-2 transition-all hover:shadow"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="font-bold text-slate-800 dark:text-slate-200">
                                <span className="font-semibold text-slate-500">{r.corsoCode}</span> - {r.corso}
                              </div>
                              <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusClassName(r.stato)}`}>
                                {r.stato.toUpperCase()}
                              </span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                              <div>
                                <span className="font-medium text-slate-400">Data corso:</span> {formatDateIt(r.dataConclusione) || "-"}
                              </div>
                              <div>
                                <span className="font-medium text-slate-400">Scadenza:</span> {formatDateIt(r.dataScadenza) || "Illimitato"}
                              </div>
                              {r.dataPrevista && (
                                <div className="col-span-2">
                                  <span className="font-medium text-slate-400">Pianificato:</span> <span className="text-purple-600 dark:text-purple-400 font-bold">{formatDateIt(r.dataPrevista)}</span>
                                </div>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-1.5 mt-2 pt-2 border-t border-[var(--brand-line)]">
                              <button
                                type="button"
                                data-unstyled="true"
                                disabled={employeeExclusion.isActive || !courseId}
                                onClick={() => {
                                  if (!courseId) return;
                                  setSelectedWorkerIds(new Set([r.workerId]));
                                  openEventModal({
                                    courseCode: r.corsoCode,
                                    courseSearch: `${r.corsoCode} ${r.corso}`.trim(),
                                    type: r.dataConclusione ? "MODIFICA_DATA" : "SVOLTO",
                                    date: r.dataConclusione ?? "",
                                    note: "",
                                  });
                                }}
                                className={[
                                  "rounded-lg border px-2 py-1 text-[10px] font-semibold transition",
                                  employeeExclusion.isActive || !courseId
                                    ? "cursor-not-allowed border-[var(--brand-line)] bg-slate-100 text-slate-400"
                                    : "border-[var(--brand-line)] bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-50",
                                ].join(" ")}
                              >
                                Evento
                              </button>
                              <button
                                type="button"
                                data-unstyled="true"
                                disabled={employeeExclusion.isActive || !courseId}
                                onClick={() => courseId && void requestCourseExclusionToggle(courseId)}
                                className={[
                                  "rounded-lg border px-2 py-1 text-[10px] font-semibold transition",
                                  employeeExclusion.isActive || !courseId
                                    ? "cursor-not-allowed border-[var(--brand-line)] bg-slate-100 text-slate-400"
                                    : isExcluded
                                      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                      : "border-[var(--brand-line)] bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-50",
                                ].join(" ")}
                              >
                                {isExcluded ? "Rinv. esclusione" : "Escludi"}
                              </button>
                              {isExcluded && courseId ? (
                                <button
                                  type="button"
                                  data-unstyled="true"
                                  disabled={employeeExclusion.isActive}
                                  onClick={() => void deleteExcludedCourse(courseId)}
                                  className={[
                                    "rounded-lg border px-2 py-1 text-[10px] font-semibold transition",
                                    employeeExclusion.isActive
                                      ? "cursor-not-allowed border-[var(--brand-line)] bg-slate-100 text-slate-400"
                                      : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
                                  ].join(" ")}
                                >
                                  Elimina
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--brand-line)] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[var(--brand-ink)]">
                          Esclusione lavoratore dalla Formazione
                        </p>
                        <p className="text-xs text-slate-500">
                          L’esclusione vale solo nel modulo Formazione.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void requestEmployeeExclusionToggle()}
                        className={[
                          "rounded-xl px-4 py-2 text-sm font-semibold transition",
                          employeeExclusion.isActive
                            ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            : "bg-[var(--brand-primary)] text-white hover:opacity-90",
                        ].join(" ")}
                      >
                        {employeeExclusion.isActive ? "Rimuovi esclusione" : "Escludi lavoratore"}
                      </button>
                    </div>
                    {employeeExclusion.isActive ? (
                      <div className="mt-3 rounded-lg border border-[var(--brand-line)] bg-[var(--brand-panel)] p-3 text-sm text-slate-700">
                        <p className="font-semibold text-[var(--brand-ink)]">Motivazione</p>
                        <p className="mt-1 whitespace-pre-wrap">{employeeExclusion.note || "-"}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-[var(--brand-line)] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--brand-ink)]">Deroga su corsi (per lavoratore)</p>
                        <p className="mt-1 text-xs text-slate-500">Puoi escludere qualsiasi corso per questo lavoratore (solo nel modulo Formazione).</p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                      <input
                        value={exclusionCourseSearch}
                        onChange={(event) => {
                          setExclusionCourseSearch(event.target.value);
                          setExclusionSelectedCourseId(null);
                        }}
                        placeholder="Cerca corso (codice o titolo)"
                        className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                        disabled={employeeExclusion.isActive}
                      />
                      <select
                        value={exclusionSelectedCourseId ? String(exclusionSelectedCourseId) : ""}
                        onChange={(event) => setExclusionSelectedCourseId(event.target.value ? Number(event.target.value) : null)}
                        className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                        disabled={employeeExclusion.isActive}
                      >
                        <option value="">Seleziona corso</option>
                      {exclusionCourseOptions.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.code} - {c.title}{c.isActive === false ? " (disattivo)" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={employeeExclusion.isActive || !exclusionSelectedCourseId}
                        onClick={() => exclusionSelectedCourseId && openExclusionNoteModal({ kind: "course", courseId: exclusionSelectedCourseId })}
                        className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Aggiungi deroga
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-600">Scorciatoie:</span>
                      {[
                        { label: "Spec basso", course: formSpecShortcut.basso },
                        { label: "Spec medio", course: formSpecShortcut.medio },
                        { label: "Spec alto", course: formSpecShortcut.alto },
                      ].map((item) => {
                        const id = item.course?.id ?? null;
                        const disabled = employeeExclusion.isActive || !id || courseExclusionNotes.has(id);
                        return (
                          <button
                            key={item.label}
                            type="button"
                            data-unstyled="true"
                            disabled={disabled}
                            onClick={() => {
                              if (!id) return;
                              setExclusionCourseSearch(item.course?.code ?? "");
                              setExclusionSelectedCourseId(id);
                              openExclusionNoteModal({ kind: "course", courseId: id });
                            }}
                            className={[
                              "rounded-full border px-3 py-1.5 text-xs font-bold transition",
                              disabled
                                ? "cursor-not-allowed border-[var(--brand-line)] bg-slate-100 text-slate-400"
                                : "border-[var(--brand-line)] bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                            title={item.course ? `${item.course.code} - ${item.course.title}` : "Non presente nel catalogo corsi"}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-3">
                      <p className="text-xs font-semibold text-slate-600">Aggiungi deroga da codice (fallback)</p>
                      <div className="mt-2 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                        <input
                          value={exclusionCourseCode}
                          onChange={(event) => setExclusionCourseCode(event.target.value)}
                          placeholder="FORM_SPEC_ALTO"
                          className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                          disabled={employeeExclusion.isActive || exclusionCourseSaving}
                        />
                        <input
                          value={exclusionCourseNote}
                          onChange={(event) => setExclusionCourseNote(event.target.value)}
                          placeholder="Motivazione (testo libero)"
                          className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                          disabled={employeeExclusion.isActive || exclusionCourseSaving}
                        />
                        <button
                          type="button"
                          disabled={employeeExclusion.isActive || exclusionCourseSaving || !exclusionCourseCode.trim()}
                          onClick={() => void submitCourseDerogaByCode({ courseCode: exclusionCourseCode, note: exclusionCourseNote })}
                          className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {exclusionCourseSaving ? "Salvo..." : "Aggiungi"}
                        </button>
                      </div>
                      {exclusionCourseError ? <p className="mt-2 text-xs font-medium text-red-600">{exclusionCourseError}</p> : null}
                    </div>

                    <p className="mt-4 text-sm font-semibold text-[var(--brand-ink)]">Corsi esclusi</p>
                    <p className="mt-1 text-xs text-slate-500">Elenco esclusioni attive per singolo corso.</p>
                    <div className="mt-3 overflow-hidden rounded-xl border border-[var(--brand-line)] bg-white">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-[var(--brand-panel)] text-slate-500">
                            <tr className="uppercase tracking-wide">
                              <th className="px-3 py-2">Corso</th>
                              <th className="px-3 py-2">Motivazione</th>
                              <th className="px-3 py-2 text-right">Azioni</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from(courseExclusionNotes.entries()).length === 0 ? (
                              <tr>
                                <td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-500">
                                  Nessuna esclusione attiva.
                                </td>
                              </tr>
                            ) : (
                              Array.from(courseExclusionNotes.entries())
                                .map(([courseId, note]) => {
                                  const course = courseById.get(courseId) ?? null;
                                  const label = course ? `${course.code} ${course.title}` : `Corso #${courseId}`;
                                  const sortKey = course ? `${course.code} ${course.title}` : `ZZZ-${courseId}`;
                                  return { courseId, note, label, sortKey, code: course?.code ?? "" };
                                })
                                .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "it", { sensitivity: "base", numeric: true }))
                                .map((r) => (
                                  <tr key={`excluded-${r.courseId}`} className="border-t border-[var(--brand-line)]">
                                    <td className="px-3 py-2 text-slate-700">
                                      {r.code ? <span className="font-semibold text-slate-800">{r.code}</span> : null}{" "}
                                      {r.label}
                                    </td>
                                    <td className="px-3 py-2 text-slate-700">{r.note || "-"}</td>
                                    <td className="px-3 py-2 text-right">
                                      <button
                                        type="button"
                                        onClick={() => void deleteExcludedCourse(r.courseId)}
                                        className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                                      >
                                        Elimina corso
                                      </button>
                                    </td>
                                  </tr>
                                ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {isExclusionNoteModalOpen ? (
            <section className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4">
              <div className="w-full max-w-lg rounded-2xl border border-[var(--brand-line)] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[var(--brand-ink)]">Motivazione esclusione</h3>
                  <button
                    type="button"
                    onClick={() => setIsExclusionNoteModalOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                  >
                    ✕
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {exclusionNoteKind === "employee"
                    ? "Inserisci una motivazione per l’esclusione del lavoratore."
                    : "Inserisci una motivazione per l’esclusione del corso."}
                </p>
                <textarea
                  value={exclusionNoteDraft}
                  onChange={(event) => setExclusionNoteDraft(event.target.value)}
                  className="mt-3 min-h-28 w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                  placeholder="Testo libero"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    data-unstyled="true"
                    onClick={() => setIsExclusionNoteModalOpen(false)}
                    className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmExclusionNote()}
                    className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
                  >
                    Salva
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <EventModal
        isOpen={isEventModalOpen}
        onClose={() => setIsEventModalOpen(false)}
        selectedWorkerIds={selectedWorkerIds}
        toggleWorkerSelection={toggleWorkerSelection}
        clearSelection={clearSelection}
        workerOptions={workerOptions}
        courseOptions={courseOptions}
        initial={eventModalInit}
        onSaved={async (employeeIds) => {
          if (employeeIds.length > 15) {
            await loadRows();
            if (
              isWorkerDetailOpen &&
              typeof workerDetailEmployeeId === "number" &&
              employeeIds.includes(workerDetailEmployeeId)
            ) {
              await loadWorkerDetail(workerDetailEmployeeId);
            }
            return;
          }
          for (const employeeId of employeeIds) {
            await reloadEmployeeRowsAndMaybeDetail(employeeId);
          }
        }}
      />

      <ImportProgrammatiModal
        isOpen={isImportProgrammatiModalOpen}
        onClose={() => setIsImportProgrammatiModalOpen(false)}
        onCommitted={() => void loadRows()}
      />

      {isImportModalOpen ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-[var(--brand-line)] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--brand-ink)]">Import Massivo Scadenzario</h2>
              <button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false);
                  resetImportForm();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Import massivo su template fisso: download modello, compila, carica, verifica preview, commit.
            </p>
            {importLastRun ? (
              <div className="mt-2 flex flex-col gap-2 text-xs text-slate-500">
                <p>
                  Ultimo import: {formatDateTimeIt(importLastRun.createdAt)}
                  {importLastRun.importedByName ? ` · ${importLastRun.importedByName}` : ""} · {importLastRun.fileName}
                  {typeof importLastRun.processedRows === "number" && typeof importLastRun.totalRows === "number"
                    ? ` · ${importLastRun.processedRows}/${importLastRun.totalRows}`
                    : ""}
                </p>
                {typeof importLastRun.errorRows === "number" && importLastRun.errorRows > 0 ? (
                  <div>
                    <button
                      type="button"
                      data-unstyled="true"
                      disabled={importLoading || importUndoLoading || isDownloadingImportReport}
                      onClick={() => void downloadFrom(`/api/import-runs/errors?importRunId=${encodeURIComponent(importLastRun.id)}`)}
                      className="rounded-lg border border-[var(--brand-line)] bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Scarica report errori
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void runImportUndo()}
                disabled={importUndoLoading || importLoading}
                className="rounded-lg border border-[var(--brand-line)] bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                {importUndoLoading ? "Annullamento..." : "Annulla ultimo import"}
              </button>
              {importUndoMessage ? (
                <p className="text-xs font-medium text-[var(--brand-primary)]">{importUndoMessage}</p>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {["Template", "Upload", "Preview", "Commit"].map((step, index) => (
                <div
                  key={step}
                  className={[
                    "rounded-xl border px-3 py-3 text-center text-xs font-semibold",
                    index === 0
                      ? "border-[var(--brand-primary)] bg-[var(--brand-tint)] text-[var(--brand-primary)]"
                      : "border-[var(--brand-line)] bg-[var(--brand-panel)] text-slate-500",
                  ].join(" ")}
                >
                  {index + 1}. {step}
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--brand-ink)]">Template import scadenzario</p>
                  <p className="text-xs text-slate-500">Scarica il file base e compila le righe da importare.</p>
                </div>
                <a
                  href="/templates/import_scadenzario_template.xlsx"
                  download
                  className="inline-flex items-center rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                >
                  Scarica template XLSX
                </a>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                <p><span className="font-semibold text-[var(--brand-ink)]">Obbligatori:</span> operation_type, matricola, tax_code, course_code, event_date</p>
                <p><span className="font-semibold text-[var(--brand-ink)]">Opzionali:</span> note, source_ref</p>
                <p><span className="font-semibold text-[var(--brand-ink)]">operation_type:</span> PROGRAMMATO | SVOLTO | MODIFICA_DATA | ANNULLA</p>
                <p><span className="font-semibold text-[var(--brand-ink)]">Formato data:</span> YYYY-MM-DD</p>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-dashed border-[var(--brand-line)] bg-[var(--brand-panel)] p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    setImportFile(selected);
                    setImportPreview(null);
                    setImportError("");
                    setImportUndoMessage("");
                  }}
                  className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void runImportPreview()}
                  disabled={importLoading}
                  className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
                >
                  {importLoading ? "Analisi in corso..." : "Analizza file"}
                </button>
              </div>
              {importFile ? (
                <p className="mt-2 text-xs text-slate-600">
                  File selezionato: <span className="font-semibold">{importFile.name}</span>
                </p>
              ) : null}
              {importError ? (
                <p className="mt-2 text-xs font-medium text-red-600">{importError}</p>
              ) : null}
              {importLoading || importProgress > 0 ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Avanzamento</span>
                    <span>{importProgress}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-[var(--brand-primary)] transition-[width] duration-200"
                      style={{ width: `${importProgress}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {importPreview ? (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const csv = buildIssuesCsv(importPreview.issues);
                      downloadCsvFile("preview_issues_scadenzario.csv", csv);
                    }}
                    className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                  >
                    Scarica issues CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const csv = buildMissingEmployeesCsv(importPreview.missingEmployeesList);
                      downloadCsvFile("preview_dipendenti_mancanti.csv", csv);
                    }}
                    className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                  >
                    Scarica dipendenti mancanti CSV
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
                  <PreviewKpi label="Righe lette" value={importPreview.summary.totalRows} />
                  <PreviewKpi label="Dip. mappati" value={importPreview.summary.mappedEmployees} />
                  <PreviewKpi label="Dip. mancanti" value={importPreview.summary.missingEmployees} tone="danger" />
                  <PreviewKpi label="Corsi mappati" value={importPreview.summary.mappedCourses} />
                  <PreviewKpi label="Corsi mancanti" value={importPreview.summary.missingCourses} tone="danger" />
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <PreviewKpi label="Svolto illimitato" value={importPreview.summary.svoltoIllimitato} tone="info" />
                  <PreviewKpi label="Da fare" value={importPreview.summary.daFare} tone="danger" />
                  <PreviewKpi label="Da aggiornare" value={importPreview.summary.daAggiornare} tone="warning" />
                  <PreviewKpi label="Valido" value={importPreview.summary.validi} tone="success" />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-[var(--brand-line)]">
                    <div className="border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Issues principali (max 1000)
                    </div>
                    <div className="max-h-56 overflow-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-white text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Riga</th>
                            <th className="px-3 py-2">Matricola</th>
                            <th className="px-3 py-2">Corso</th>
                            <th className="px-3 py-2">Problema</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.issues.slice(0, 120).map((issue, index) => (
                            <tr key={`${issue.rowNumber}-${issue.matricola}-${index}`} className="border-t border-[var(--brand-line)]">
                              <td className="px-3 py-2">{issue.rowNumber}</td>
                              <td className="px-3 py-2">{issue.matricola || "-"}</td>
                              <td className="px-3 py-2">{issue.canonicalCourseCode ?? issue.rawCourseCode}</td>
                              <td className="px-3 py-2 text-slate-600">{issue.message}</td>
                            </tr>
                          ))}
                          {importPreview.issues.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-3 py-5 text-center text-slate-500">
                                Nessuna anomalia bloccante rilevata.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--brand-line)]">
                    <div className="border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Quadratura corsi (top 200)
                    </div>
                    <div className="max-h-56 overflow-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-white text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Corso</th>
                            <th className="px-3 py-2">Legacy</th>
                            <th className="px-3 py-2">Mappate</th>
                            <th className="px-3 py-2">Dip. mancanti</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.courseStats.map((stat) => (
                            <tr key={stat.courseCode} className="border-t border-[var(--brand-line)]">
                              <td className="px-3 py-2 font-semibold">
                                <div>{stat.courseCode}</div>
                                <div className="text-[11px] font-normal text-slate-500">{stat.courseTitle}</div>
                              </td>
                              <td className="px-3 py-2">{stat.legacyRows}</td>
                              <td className="px-3 py-2">{stat.mappedRows}</td>
                              <td className="px-3 py-2">{stat.missingEmployeeRows}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--brand-line)]">
                  <div className="border-b border-[var(--brand-line)] bg-[var(--brand-panel)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Dipendenti mancanti aggregati (top 2000)
                  </div>
                  <div className="max-h-56 overflow-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-white text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Matricola</th>
                          <th className="px-3 py-2">Cognome</th>
                          <th className="px-3 py-2">Nome</th>
                          <th className="px-3 py-2">Righe</th>
                          <th className="px-3 py-2">Corsi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.missingEmployeesList.map((item) => (
                          <tr key={`${item.matricola}-${item.cognome}-${item.nome}`} className="border-t border-[var(--brand-line)]">
                            <td className="px-3 py-2">{item.matricola}</td>
                            <td className="px-3 py-2">{item.cognome || "-"}</td>
                            <td className="px-3 py-2">{item.nome || "-"}</td>
                            <td className="px-3 py-2">{item.rows}</td>
                            <td className="px-3 py-2 text-slate-600">{item.courses.join(", ")}</td>
                          </tr>
                        ))}
                        {importPreview.missingEmployeesList.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-5 text-center text-slate-500">
                              Nessun dipendente mancante.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-unstyled="true"
                onClick={() => {
                  setIsImportModalOpen(false);
                  resetImportForm();
                }}
                className="rounded-xl border border-[var(--brand-line)] bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                Chiudi
              </button>
              <button
                type="button"
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={!importFile || !importPreview || importLoading}
                title={importPreview ? "Esegui commit import massivo" : "Esegui prima la preview per controllare i dati"}
                onClick={() => void runImportCommit()}
              >
                {importLoading ? "Import in corso..." : "Conferma import"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const statusClassName = courseStatusClassName;

function isDashboardBaseCode(code: string) {
  return DASHBOARD_BASE_CODES.has(code) || code.startsWith("FORM_BASE+");
}

// Usa il corsoCode originale (pre-consolidamento) quando presente: dopo il rename in
// FORM_SPEC_AGGIORNAMENTO il codice non basta più a distinguere BASE da OPERATIVI.
function isDashboardBaseRow(row: WorkerCourseRow) {
  return isDashboardBaseCode(row.originalCorsoCode ?? row.corsoCode);
}

function consolidateFormationRows(rows: WorkerCourseRow[]): WorkerCourseRow[] {
  const stateRank = (s: WorkerCourseRow["stato"]) => {
    if (s === "scaduto") return 1;
    if (s === "da fare") return 2;
    if (s === "upgrade") return 3;
    if (s === "in scadenza") return 4;
    if (s === "programmato") return 5;
    if (s === "escluso") return 6;
    if (s === "sospeso") return 7;
    return 8;
  };

  // Mappa i corsi scaduti ai loro aggiornamenti
  const byWorkerAndCategory = new Map<string, WorkerCourseRow[]>();
  const allCoursesByWorkerAndCode = new Map<string, WorkerCourseRow>();

  rows.forEach((row) => {
    allCoursesByWorkerAndCode.set(`${row.workerId}-${row.corsoCode}`, row);
    const isBase = isDashboardBaseCode(row.corsoCode);
    const key = `${row.workerId}-${isBase ? "base" : "operativi"}`;
    const list = byWorkerAndCategory.get(key);
    if (!list) byWorkerAndCategory.set(key, [row]);
    else list.push(row);
  });

  // Trasforma i corsi scaduti in aggiornamenti
  const processedRows = rows.map((row) => {
    if (row.stato !== "scaduto") return row;

    const aggCode = aggiornamentoCodeFor(row.corsoCode);
    if (!aggCode) return row;

    // Controlla se l'aggiornamento è già programmato o già stato svolto: in entrambi i
    // casi la riga reale (con le sue date vere) deve prevalere sul placeholder fittizio,
    // altrimenti un aggiornamento già completato viene nascosto da un "da fare" fasullo.
    const aggRow = allCoursesByWorkerAndCode.get(`${row.workerId}-${aggCode}`);
    if (aggRow && (aggRow.stato === "programmato" || aggRow.dataPrevista || aggRow.dataConclusione)) return row;

    // Trasforma il corso scaduto in aggiornamento
    return {
      ...row,
      corsoCode: aggCode,
      corso: `Aggiornamento ${row.corso}`,
      stato: "da fare" as WorkerCourseRow["stato"],
      dataConclusione: null,
      dataScadenza: null,
      dataPrevista: null,
      wasScaduto: true,
      originalCorsoCode: row.corsoCode,
    };
  });

  const consolidated: WorkerCourseRow[] = [];
  const byWorkerAndCategoryNew = new Map<string, WorkerCourseRow[]>();

  processedRows.forEach((row) => {
    const isBase = isDashboardBaseRow(row);
    // Per gli "operativi" il worst-wins va applicato solo entro la stessa famiglia di
    // corso (es. QUOTA_DPI + QUOTA_DPI_AGGIORNAMENTO), non su tutti i corsi extra del
    // lavoratore: altrimenti un corso non conforme nascondeva anche gli altri corsi
    // idonei senza nessuna relazione con esso.
    const familyCode = isAggiornamentoCode(row.corsoCode)
      ? row.corsoCode.slice(0, -"_AGGIORNAMENTO".length)
      : row.corsoCode;
    const key = isBase ? `${row.workerId}-base` : `${row.workerId}-operativi-${familyCode}`;
    const list = byWorkerAndCategoryNew.get(key);
    if (!list) byWorkerAndCategoryNew.set(key, [row]);
    else list.push(row);
  });

  byWorkerAndCategoryNew.forEach((rowsInGroup, key) => {
    const [workerId, category] = key.split("-");
    const isBaseGroup = category === "base";

    if (!isBaseGroup) {
      // Se l'aggiornamento della famiglia è già stato svolto, è il dato vero e più
      // recente: va mostrato da solo, non nascosto dietro il worst-wins del corso
      // base ormai superato (altrimenti un aggiornamento completato spariva dietro
      // il corso base scaduto che ha appena rinnovato).
      const completedAgg = rowsInGroup.find((r) => isAggiornamentoCode(r.corsoCode) && r.dataConclusione);
      if (completedAgg) {
        consolidated.push(completedAgg);
        return;
      }

      const worstOperativi = rowsInGroup.reduce((worst, curr) =>
        stateRank(curr.stato) < stateRank(worst.stato) ? curr : worst,
      );
      const rowsToShowOperativi =
        worstOperativi.stato !== "idoneo" ? rowsInGroup.filter((r) => r.stato !== "idoneo") : rowsInGroup;
      consolidated.push(...rowsToShowOperativi);
      return;
    }

    // Applica worst-wins: se c'è uno stato peggiore, nasconde i conformi
    const worstState = rowsInGroup.reduce((worst, curr) => {
      const worstRank = stateRank(worst.stato);
      const currRank = stateRank(curr.stato);
      return currRank < worstRank ? curr : worst;
    });

    let rowsToShow = rowsInGroup;
    if (worstState.stato !== "idoneo") {
      rowsToShow = rowsInGroup.filter((r) => r.stato !== "idoneo");
    }

    const isFormBase = (code: string) => code === "FORM_BASE" || code.startsWith("FORM_BASE+");
    const isFormSpec = (code: string) => code.startsWith("FORM_SPEC_");

    const formBaseRows = rowsToShow.filter((r) => isFormBase(r.corsoCode));
    const formSpecRows = rowsToShow.filter((r) => isFormSpec(r.corsoCode));
    const otherBaseRows = rowsToShow.filter((r) => !isFormBase(r.corsoCode) && !isFormSpec(r.corsoCode));

    if (formBaseRows.length > 0 && formSpecRows.length > 0) {
      const baseRow = formBaseRows[0];
      const specRow = formSpecRows.reduce((best, curr) => (stateRank(curr.stato) < stateRank(best.stato) ? curr : best));
      const worstState = stateRank(baseRow.stato) < stateRank(specRow.stato) ? baseRow.stato : specRow.stato;

      const riskLabel = specRow.corsoCode === "FORM_SPEC_ALTO" ? "alto" : specRow.corsoCode === "FORM_SPEC_MEDIO" ? "medio" : "basso";

      const merged: WorkerCourseRow = {
        ...baseRow,
        corsoCode: "FORM_BASE+FORM_SPEC",
        corso: `Formazione generale e specifica [rischio ${riskLabel}]`,
        stato: worstState as WorkerCourseRow["stato"],
        dataConclusione: worstState === baseRow.stato ? baseRow.dataConclusione : specRow.dataConclusione,
        dataScadenza: worstState === baseRow.stato ? baseRow.dataScadenza : specRow.dataScadenza,
        dataPrevista: worstState === baseRow.stato ? baseRow.dataPrevista : specRow.dataPrevista,
      };
      consolidated.push(merged);
    } else if (formBaseRows.length > 0) {
      consolidated.push(...formBaseRows);
    } else if (formSpecRows.length > 0) {
      consolidated.push(...formSpecRows);
    }

    consolidated.push(...otherBaseRows);
  });

  return consolidated;
}

function buildMonthYearFilterOptions(
  rows: WorkerCourseRow[],
  getter: (row: WorkerCourseRow) => string | null,
) {
  const set = new Set<string>();
  rows.forEach((row) => set.add(isoToMonthYear(getter(row))));
  const list = Array.from(set.values()).map((value) => ({ value, label: value }));
  list.sort((a, b) => monthYearSortKey(b.value) - monthYearSortKey(a.value) || a.label.localeCompare(b.label));
  return list;
}

function formatStatoLabel(value: WorkerCourseRow["stato"]) {
  if (value === "da fare") return "Da fare";
  if (value === "in scadenza") return "In scadenza";
  return capitalizeFirst(value);
}

function buildDashboardSummary(rows: WorkerCourseRow[], totalActiveEmployees: number): DashboardSummary {
  const counts: Record<DashboardStateKey, Set<number>> = {
    scaduto: new Set(),
    "da fare": new Set(),
    "in scadenza": new Set(),
    programmato: new Set(),
    upgrade: new Set(),
    escluso: new Set(),
  };

  const looksLikeBase = rows.some(
    (row) => row.corsoCode === "FORM_BASE" || row.corsoCode.startsWith("FORM_BASE+") || row.corsoCode.startsWith("FORM_SPEC_"),
  );

  // Allineato a buildWorkerBuckets: scaduto/da fare/upgrade/in scadenza battono sempre
  // programmato. Pianificare un corso non deve nascondere altre criticità del lavoratore.
  const stateRank = (s: WorkerCourseRow["stato"]) => {
    if (s === "scaduto") return 1;
    if (s === "da fare") return 2;
    if (s === "upgrade") return 3;
    if (s === "in scadenza") return 4;
    if (s === "programmato") return 5;
    if (s === "escluso") return 6;
    if (s === "sospeso") return 6;
    return 7;
  };

  if (looksLikeBase) {
    const aggregateByWorker = new Map<number, WorkerCourseRow>();
    const specByWorker = new Map<number, WorkerCourseRow>();
    const generalByWorker = new Map<number, WorkerCourseRow>();

    rows.forEach((row) => {
      if (row.corsoCode.startsWith("FORM_BASE+")) {
        aggregateByWorker.set(row.workerId, row);
        return;
      }
      if (row.corsoCode.startsWith("FORM_SPEC_")) {
        const prev = specByWorker.get(row.workerId);
        if (!prev || stateRank(row.stato) < stateRank(prev.stato)) specByWorker.set(row.workerId, row);
        return;
      }
      if (row.corsoCode === "FORM_BASE") {
        const prev = generalByWorker.get(row.workerId);
        if (!prev || stateRank(row.stato) < stateRank(prev.stato)) generalByWorker.set(row.workerId, row);
      }
    });

    const allWorkerIds = new Set<number>([
      ...aggregateByWorker.keys(),
      ...specByWorker.keys(),
      ...generalByWorker.keys(),
    ]);

    allWorkerIds.forEach((workerId) => {
      const candidates = [
        aggregateByWorker.get(workerId) ?? null,
        specByWorker.get(workerId) ?? null,
        generalByWorker.get(workerId) ?? null,
      ].filter(Boolean) as WorkerCourseRow[];
      const preferred =
        candidates.length === 0
          ? null
          : candidates.reduce((best, curr) => (stateRank(curr.stato) < stateRank(best.stato) ? curr : best));
      if (!preferred) return;
      const state = preferred.stato as DashboardStateKey;
      if (DASHBOARD_STATES.includes(state)) counts[state].add(workerId);
    });
  } else {
    const preferredStateByWorker = new Map<number, DashboardStateKey>();
    rows.forEach((row) => {
      const state = row.stato as DashboardStateKey;
      if (!DASHBOARD_STATES.includes(state)) return;
      const prev = preferredStateByWorker.get(row.workerId);
      if (!prev || stateRank(state) < stateRank(prev)) preferredStateByWorker.set(row.workerId, state);
    });

    preferredStateByWorker.forEach((state, workerId) => {
      counts[state].add(workerId);
    });
  }

  const finalCounts = {
    "scaduto": counts.scaduto.size,
    "da fare": counts["da fare"].size,
    "in scadenza": counts["in scadenza"].size,
    "programmato": counts.programmato.size,
    "upgrade": counts.upgrade.size,
    "escluso": counts.escluso.size,
  };

  const percentages: Record<DashboardStateKey, number> = {
    "scaduto": percentage(finalCounts.scaduto, totalActiveEmployees),
    "da fare": percentage(finalCounts["da fare"], totalActiveEmployees),
    "in scadenza": percentage(finalCounts["in scadenza"], totalActiveEmployees),
    "programmato": percentage(finalCounts.programmato, totalActiveEmployees),
    "upgrade": percentage(finalCounts.upgrade, totalActiveEmployees),
    "escluso": percentage(finalCounts.escluso, totalActiveEmployees),
  };

  const workers = buildWorkerBuckets(rows, totalActiveEmployees);

  return { total: totalActiveEmployees, counts: finalCounts, percentages, workers };
}

// Assegna ogni lavoratore a UN solo bucket = suo stato peggiore tra i corsi DOVUTI
// (origine "obbligatorio") della categoria. Corsi aggiuntivi non incidono sulla conformità.
// La somma dei bucket = totale lavoratori azienda (i mancanti nel dataset = senzaObbligo).
// Mappa un corso al proprio corso di "aggiornamento" (rinnovo). Le tre formazioni
// specifiche (basso/medio/alto) condividono un unico aggiornamento generico, non
// uno per livello — così deciso: l'aggiornamento è identico per tutte e tre.
function aggiornamentoCodeFor(courseCode: string): string | null {
  if (courseCode.endsWith("_AGGIORNAMENTO")) return null;
  if (courseCode.startsWith("FORM_SPEC_")) return "FORM_SPEC_AGGIORNAMENTO";
  if (courseCode === "FORM_BASE" || courseCode.startsWith("FORM_BASE+")) return "FORM_SPEC_AGGIORNAMENTO";
  return `${courseCode}_AGGIORNAMENTO`;
}

function isAggiornamentoCode(courseCode: string): boolean {
  return courseCode.endsWith("_AGGIORNAMENTO");
}

function buildWorkerBuckets(rows: WorkerCourseRow[], totalActiveEmployees: number): DashboardWorkerBuckets {
  type BucketKey =
    | "bloccato"
    | "scaduto"
    | "daFare"
    | "upgrade"
    | "inScadenza"
    | "programmato"
    | "conforme"
    | "escluso"
    | "sospeso";

  // origine (obbligatorio/aggiuntivo) resta un campo distintivo del dato, visibile e
  // filtrabile in tabella, ma NON esclude un corso dal bucket: ogni corso mappato per
  // il lavoratore va monitorato, obbligatorio o aggiuntivo che sia.
  const dueByWorker = new Map<number, WorkerCourseRow[]>();
  rows.forEach((row) => {
    const list = dueByWorker.get(row.workerId);
    if (!list) dueByWorker.set(row.workerId, [row]);
    else list.push(row);
  });

  const tally: Record<BucketKey, number> = {
    bloccato: 0,
    scaduto: 0,
    daFare: 0,
    upgrade: 0,
    inScadenza: 0,
    programmato: 0,
    conforme: 0,
    escluso: 0,
    sospeso: 0,
  };

  // Sotto-conteggio per bucket: quanti dei lavoratori del bucket hanno GIÀ pianificato
  // il corso di aggiornamento che risolve esattamente il problema che li rende peggiori
  // (non un obbligo diverso). Es: FORM_SPEC_ALTO scaduto conta solo se FORM_SPEC_AGGIORNAMENTO
  // risulta programmato; CORSO_RLS programmato non conta per uno scaduto su FORM_SPEC_ALTO.
  const withProgrammatoSubcount: Record<BucketKey, number> = {
    bloccato: 0,
    scaduto: 0,
    daFare: 0,
    upgrade: 0,
    inScadenza: 0,
    programmato: 0,
    conforme: 0,
    escluso: 0,
    sospeso: 0,
  };

  const isScadutoRow = (row: WorkerCourseRow) => row.wasScaduto || row.stato === "scaduto" || row.stato === "perso";
  const isDaFareRow = (row: WorkerCourseRow) => row.stato === "da fare" && !isAggiornamentoCode(row.corsoCode);

  const hasRescheduledAggiornamento = (rowsByCode: Map<string, WorkerCourseRow>, matched: WorkerCourseRow[]) =>
    matched.some((row) => {
      const aggCode = aggiornamentoCodeFor(row.corsoCode);
      if (!aggCode) return false;
      return rowsByCode.get(aggCode)?.stato === "programmato";
    });

  let workersWithObligation = 0;
  dueByWorker.forEach((dueRows) => {
    workersWithObligation += 1;

    // freeze marca TUTTE le righe di un lavoratore come "sospeso" (engine.ts), basta
    // una riga per saperlo. escluso è per-corso: conta come residuo solo se non c'è
    // nessun altro segnale reale (tutte le righe dovute sono escluse).
    if (dueRows.some((r) => r.stato === "sospeso")) {
      tally.sospeso += 1;
      return;
    }
    if (dueRows.every((r) => r.stato === "escluso")) {
      tally.escluso += 1;
      return;
    }

    const activeRows = dueRows.filter((r) => r.stato !== "escluso");
    const rowsByCode = new Map(dueRows.map((r) => [r.corsoCode, r]));

    const bloccatoRows = activeRows.filter((r) => r.blockedBy);
    const scadutoRows = activeRows.filter(isScadutoRow);
    const daFareRows = activeRows.filter(isDaFareRow);
    const upgradeRows = activeRows.filter((r) => r.stato === "upgrade");
    const inScadenzaRows = activeRows.filter((r) => r.stato === "in scadenza");
    const programmatoRows = activeRows.filter((r) => r.stato === "programmato");

    if (bloccatoRows.length) {
      tally.bloccato += 1;
      if (hasRescheduledAggiornamento(rowsByCode, bloccatoRows)) withProgrammatoSubcount.bloccato += 1;
    }
    if (scadutoRows.length) {
      tally.scaduto += 1;
      if (hasRescheduledAggiornamento(rowsByCode, scadutoRows)) withProgrammatoSubcount.scaduto += 1;
    }
    if (daFareRows.length) {
      tally.daFare += 1;
      if (hasRescheduledAggiornamento(rowsByCode, daFareRows)) withProgrammatoSubcount.daFare += 1;
    }
    if (upgradeRows.length) {
      tally.upgrade += 1;
      if (hasRescheduledAggiornamento(rowsByCode, upgradeRows)) withProgrammatoSubcount.upgrade += 1;
    }
    if (inScadenzaRows.length) {
      tally.inScadenza += 1;
      if (hasRescheduledAggiornamento(rowsByCode, inScadenzaRows)) withProgrammatoSubcount.inScadenza += 1;
    }
    if (programmatoRows.length) tally.programmato += 1;

    const isBad = bloccatoRows.length > 0 || scadutoRows.length > 0 || daFareRows.length > 0 || upgradeRows.length > 0;
    if (!isBad) tally.conforme += 1;
  });

  // Lavoratori senza alcun obbligo nella categoria: differenza sul totale azienda.
  const senzaObbligo = Math.max(0, totalActiveEmployees - workersWithObligation);
  // Obbligati = chi ha almeno un corso tracciato in categoria, esclusi i residui
  // "tutto escluso" / "tutto sospeso" (mostrati a parte, non fanno parte del giudizio).
  const obbligati = workersWithObligation - tally.escluso - tally.sospeso;

  return {
    scaduto: tally.scaduto,
    daFare: tally.daFare,
    bloccato: tally.bloccato,
    inScadenza: tally.inScadenza,
    upgrade: tally.upgrade,
    programmato: tally.programmato,
    conforme: tally.conforme,
    escluso: tally.escluso,
    sospeso: tally.sospeso,
    withProgrammatoSubcount,
    senzaObbligo,
    obbligati,
  };
}

function percentage(count: number, total: number) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function StateCell({
  tone,
  count,
  pct,
}: {
  tone: "scaduto" | "da_fare" | "in_scadenza" | "programmato" | "upgrade" | "bloccato" | "conforme";
  count: number;
  pct: number;
}) {
  const cls =
    count === 0
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : tone === "scaduto" || tone === "bloccato"
        ? "border-red-200 bg-red-50 text-red-700"
        : tone === "da_fare"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : tone === "in_scadenza"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : tone === "programmato"
              ? "border-sky-200 bg-sky-50 text-sky-800"
              : tone === "conforme"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-purple-200 bg-purple-50 text-purple-800";

  return (
    <div className="flex flex-col items-end leading-tight">
      <span className={`inline-flex min-w-[34px] justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>
        {count}
      </span>
      <span className="mt-0.5 text-[10px] text-slate-500 tabular-nums">{pct}%</span>
    </div>
  );
}

function PreviewKpi({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "danger" | "warning" | "success" | "info";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : tone === "info"
            ? "border-sky-200 bg-sky-50 text-sky-700"
            : "border-[var(--brand-line)] bg-white text-[var(--brand-ink)]";

  return (
    <div className={`rounded-xl border px-3 py-3 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function buildIssuesCsv(issues: ImportPreviewIssue[]) {
  const header = [
    "row_number",
    "matricola",
    "cognome",
    "nome",
    "raw_course_code",
    "canonical_course_code",
    "issue_type",
    "message",
  ];
  const lines = issues.map((issue) =>
    [
      issue.rowNumber,
      issue.matricola,
      issue.cognome,
      issue.nome,
      issue.rawCourseCode,
      issue.canonicalCourseCode ?? "",
      issue.issueType,
      issue.message,
    ].map(csvEscape).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function buildMissingEmployeesCsv(rows: ImportPreviewMissingEmployee[]) {
  const header = ["matricola", "cognome", "nome", "rows", "courses"];
  const lines = rows.map((row) =>
    [
      row.matricola,
      row.cognome,
      row.nome,
      row.rows,
      row.courses.join(" | "),
    ].map(csvEscape).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

