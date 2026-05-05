"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeJobCode } from "@/lib/training/normalize";
import { DashboardCard, KpiCard, KpiGrid, ModuleHeader, PanelCard } from "@/components/module-ui";
import { EventModal } from "./event-modal";

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
  stato: "idoneo" | "in scadenza" | "scaduto" | "da fare" | "sospeso" | "programmato" | "upgrade" | "escluso";
  upgradeInfo: string | null;
  responsabile: string;
  referente: string;
  note: string;
  origine: "obbligatorio" | "aggiuntivo";
};

type DashboardStateKey = "scaduto" | "da fare" | "in scadenza" | "programmato" | "upgrade" | "escluso";

type DashboardSummary = {
  total: number;
  counts: Record<DashboardStateKey, number>;
  percentages: Record<DashboardStateKey, number>;
};

type JobEntity = {
  key: string;
  label: string;
  isExtra: boolean;
};

type CourseOption = { code: string; title: string };
type EventType = "PROGRAMMATO" | "SVOLTO" | "MODIFICA_DATA" | "ANNULLA" | "DA_FARE";
type EventModalInit = {
  tab: "evento" | "da_fare";
  courseCode: string;
  courseSearch: string;
  type: Exclude<EventType, "DA_FARE">;
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
  corso: string;
  dataConclusione: string;
  dataScadenza: string;
  stato: "" | WorkerCourseRow["stato"];
  origine: "" | WorkerCourseRow["origine"];
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
  corso: "",
  dataConclusione: "",
  dataScadenza: "",
  stato: "",
  origine: "",
  note: "",
};

type DashboardCategory = "base" | "operativi";

type DashboardFilter = {
  category: DashboardCategory;
  states: WorkerCourseRow["stato"][] | null;
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

const CRITICAL_STATES = ["scaduto", "da fare", "programmato", "upgrade"] as const;

export default function HomeFormazionePage() {
  const [rows, setRows] = useState<WorkerCourseRow[]>([]);
  const [totalActiveEmployees, setTotalActiveEmployees] = useState(0);
  const [excludedByScopeEmployees, setExcludedByScopeEmployees] = useState(0);
  const [frozenEmployees, setFrozenEmployees] = useState(0);
  const [eligibleEmployees, setEligibleEmployees] = useState(0);
  const [eligibleOperativiEmployees, setEligibleOperativiEmployees] = useState(0);
  const [search, setSearch] = useState("");
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
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<number>>(() => new Set());
  const [eventModalInit, setEventModalInit] = useState<EventModalInit>({
    tab: "evento",
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
  const [importLastRun, setImportLastRun] = useState<{ createdAt: string; fileName: string; importedByName: string | null } | null>(null);
  const importProgressTimerRef = useRef<number | null>(null);
  const importRunTokenRef = useRef(0);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingRef = useRef(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [dashboardCategoryFilter, setDashboardCategoryFilter] = useState<"base" | "operativi" | null>(null);
  const [dashboardStateFilter, setDashboardStateFilter] = useState<WorkerCourseRow["stato"][] | null>(null);
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
        const response = await fetch("/api/formazione/matrice?scopeType=job");
        const body = (await response.json()) as {
          courses?: Array<{ code: string; title: string }>;
          entities?: JobEntity[];
        };
        if (!response.ok) return;
        const normalized = (body.courses ?? [])
          .map((course) => ({ code: course.code, title: course.title }))
          .sort((a, b) => a.code.localeCompare(b.code));
        setCatalogCourses(normalized);
        setJobEntities((body.entities ?? []).map((entity) => ({ ...entity, isExtra: Boolean(entity.isExtra) })));
      } catch {
        // fallback automatico: se la fetch fallisce useremo comunque i corsi derivati dai rows.
      }
    }
    void loadCourseCatalog();
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/import-runs/last?source=formazione_legacy", { method: "GET" });
      const body = (await response.json()) as { run: { createdAt: string; fileName: string; importedByName: string | null } | null; error?: string };
      if (cancelled) return;
      if (!response.ok || body.error) return;
      setImportLastRun(body.run);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRows = useCallback(async (dateOverride?: string) => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("date", dateOverride ?? simulationDate);
      params.set("expiringDays", String(expiringDays));

      params.set("panel", "formazione");
      if (showExcludedEmployees) params.set("includeExcluded", "1");
      const response = await fetch(`/api/lavoratori/corsi?${params.toString()}`);
      const body = (await response.json()) as {
        rows?: WorkerCourseRow[];
        error?: string;
        totalActiveEmployees?: number;
        excludedByScopeEmployees?: number;
        frozenEmployees?: number;
        eligibleEmployees?: number;
        eligibleOperativiEmployees?: number;
      };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento formazione lavoratori.");
      }

      const nextRows = body.rows ?? [];
      setRows(nextRows);
      const nextWorkerIds = new Set(nextRows.map((r) => r.workerId));
      setSelectedWorkerIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set<number>();
        prev.forEach((id) => {
          if (nextWorkerIds.has(id)) next.add(id);
        });
        return next;
      });
      setTotalActiveEmployees(body.totalActiveEmployees ?? 0);
      setExcludedByScopeEmployees(body.excludedByScopeEmployees ?? 0);
      setFrozenEmployees(body.frozenEmployees ?? 0);
      setEligibleEmployees(body.eligibleEmployees ?? 0);
      setEligibleOperativiEmployees(body.eligibleOperativiEmployees ?? 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Errore caricamento formazione lavoratori.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [expiringDays, showExcludedEmployees, simulationDate]);

  useEffect(() => {
    const id = setTimeout(() => {
      void loadRows();
    }, 0);
    return () => clearTimeout(id);
  }, [loadRows]);

  const loadWorkerDetail = useCallback(
    async (employeeId: number) => {
      setWorkerDetailLoading(true);
      setWorkerDetailError("");
      try {
        const params = new URLSearchParams();
        params.set("panel", "formazione");
        params.set("employeeId", String(employeeId));
        params.set("date", simulationDate);
        params.set("expiringDays", String(expiringDays));
        const [rowsResponse, exclusionsResponse] = await Promise.all([
          fetch(`/api/lavoratori/corsi?${params.toString()}`),
          fetch(`/api/formazione/esclusioni?employeeId=${employeeId}`),
        ]);

        const rowsBody = (await rowsResponse.json()) as { rows?: WorkerCourseRow[]; error?: string };
        if (!rowsResponse.ok || rowsBody.error) {
          throw new Error(rowsBody.error ?? "Errore caricamento dettaglio lavoratore.");
        }
        const exclusionsBody = (await exclusionsResponse.json()) as {
          employee?: { isActive: boolean; note: string };
          excludedCourses?: Array<{ courseId: number; note: string }>;
          error?: string;
        };
        if (!exclusionsResponse.ok || exclusionsBody.error) {
          throw new Error(exclusionsBody.error ?? "Errore caricamento esclusioni.");
        }

        setWorkerDetailRows(rowsBody.rows ?? []);
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
    [expiringDays, simulationDate],
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
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "Errore salvataggio esclusione.");
      await loadWorkerDetail(workerDetailEmployeeId);
      await loadRows();
    },
    [loadRows, loadWorkerDetail, workerDetailEmployeeId],
  );

  const deleteCourseExclusion = useCallback(
    async (courseId: number) => {
      if (!workerDetailEmployeeId) return;
      try {
        const response = await fetch("/api/formazione/esclusioni", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "course", employeeId: workerDetailEmployeeId, courseId }),
        });
        const body = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || body.error) throw new Error(body.error ?? "Errore cancellazione esclusione.");
        await loadWorkerDetail(workerDetailEmployeeId);
        await loadRows();
      } catch (err) {
        setWorkerDetailError(err instanceof Error ? err.message : "Errore cancellazione esclusione.");
      }
    },
    [loadRows, loadWorkerDetail, workerDetailEmployeeId],
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

    try {
      const params = new URLSearchParams();
      params.set("date", simulationDate);
      params.set("expiringDays", String(expiringDays));

      params.set("panel", "formazione");
      if (showExcludedEmployees) params.set("includeExcluded", "1");
      const response = await fetch(`/api/lavoratori/corsi?${params.toString()}`);
      const body = (await response.json()) as {
        rows?: WorkerCourseRow[];
        error?: string;
        totalActiveEmployees?: number;
      };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore caricamento dashboard formazione.");
      }

      const allRows = body.rows ?? [];
      const totalActiveEmployees = body.totalActiveEmployees ?? 0;

      setDashboardRows(allRows);
      setDashboardTotalByAnagrafica(totalActiveEmployees);
    } catch (err) {
      setDashboardError(
        err instanceof Error ? err.message : "Errore caricamento dashboard formazione.",
      );
    } finally {
      setDashboardLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (dashboardCategoryFilter) {
        const isBase = isDashboardBaseCode(row.corsoCode);
        if (dashboardCategoryFilter === "base" && !isBase) return false;
        if (dashboardCategoryFilter === "operativi" && isBase) return false;
      }
      if (dashboardStateFilter && dashboardStateFilter.length > 0) {
        if (!dashboardStateFilter.includes(row.stato)) return false;
      }
      if (q) {
        const searchable = [
          row.matricola,
          row.cognome,
          row.nome,
          row.mansione,
          row.cantiere,
          row.sottocantiere,
          row.responsabile,
          row.referente,
          `${row.corsoCode} ${row.corso}`,
        ]
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      if (columnFilters.matricola && !matchText(row.matricola, columnFilters.matricola)) return false;
      if (columnFilters.cognome && !matchText(row.cognome, columnFilters.cognome)) return false;
      if (columnFilters.nome && !matchText(row.nome, columnFilters.nome)) return false;
      if (columnFilters.mansione && !matchText(row.mansione, columnFilters.mansione)) return false;
      if (columnFilters.cantiere && !matchText(row.cantiere, columnFilters.cantiere)) return false;
      if (columnFilters.sottocantiere && !matchText(row.sottocantiere, columnFilters.sottocantiere)) return false;
      if (columnFilters.responsabile && !matchText(row.responsabile, columnFilters.responsabile)) return false;
      if (columnFilters.referente && !matchText(row.referente, columnFilters.referente)) return false;
      if (columnFilters.corso && !matchText(`${row.corsoCode} ${row.corso}`, columnFilters.corso)) return false;
      if (columnFilters.dataConclusione && !matchText(row.dataConclusione ?? "", columnFilters.dataConclusione))
        return false;
      if (columnFilters.dataScadenza && !matchText(row.dataScadenza ?? "", columnFilters.dataScadenza))
        return false;
      if ((!dashboardStateFilter || dashboardStateFilter.length === 0) && columnFilters.stato && row.stato !== columnFilters.stato)
        return false;
      if (columnFilters.origine && row.origine !== columnFilters.origine) return false;
      if (columnFilters.note && !matchText(row.note ?? "", columnFilters.note)) return false;
      return true;
    });
  }, [columnFilters, dashboardCategoryFilter, dashboardStateFilter, rows, search]);

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
      else if (sort.key === "origine") cmp = compareText(a.origine, b.origine) || compareText(a.cognome, b.cognome);
      else if (sort.key === "stato") cmp = statusRank(a.stato) - statusRank(b.stato) || compareText(a.cognome, b.cognome);
      else cmp = compareNullableText(a.note, b.note) || compareText(a.cognome, b.cognome);
      return cmp * dirMul;
    });
    return list;
  }, [filteredRows, sort.dir, sort.key]);

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
      return;
    }
    setDashboardCategoryFilter(next.category);
    setDashboardStateFilter(next.states);
  }, []);

  useEffect(() => {
    const width = tableRef.current?.scrollWidth ?? 0;
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

  function syncHorizontalScroll(source: "top" | "middle") {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const nextLeft = (source === "top" ? topScrollRef.current : tableScrollRef.current)?.scrollLeft ?? 0;
    if (source !== "top" && topScrollRef.current) topScrollRef.current.scrollLeft = nextLeft;
    if (source !== "middle" && tableScrollRef.current) tableScrollRef.current.scrollLeft = nextLeft;
    syncingRef.current = false;
  }

  const courseOptions = useMemo(() => {
    if (catalogCourses.length > 0) return catalogCourses;
    const map = new Map<string, string>();
    rows.forEach((row) => map.set(row.corsoCode, row.corso));
    return Array.from(map.entries())
      .map(([code, title]) => ({ code, title }))
      .sort((a, b) => a.code.localeCompare(b.code));
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
        tab: init?.tab ?? "evento",
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
      const body = (await response.json()) as ImportPreviewResult & { error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore preview import massivo.");
      }
      setImportPreview(body);
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
      const body = (await response.json()) as ImportPreviewResult & { error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Errore commit import massivo.");
      }
      setImportPreview(body);
      if (importRunTokenRef.current === token && importProgressTimerRef.current !== null) {
        window.clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImportProgress(100);

      const last = await fetch("/api/import-runs/last?source=formazione_legacy", { method: "GET" });
      const lastBody = (await last.json()) as { run: { createdAt: string; fileName: string; importedByName: string | null } | null; error?: string };
      if (last.ok && !lastBody.error) setImportLastRun(lastBody.run);
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

  async function runExport() {
    setIsExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams();
      params.set("date", simulationDate);
      params.set("expiringDays", String(expiringDays));
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

    if (row.corsoCode.startsWith("FORM_BASE+")) {
      openEventModal({
        tab: "evento",
        courseCode: "",
        courseSearch: "",
        type: row.stato === "programmato" ? "SVOLTO" : "PROGRAMMATO",
        date: "",
        note: "",
      });
      return;
    }

    openEventModal({
      tab: "evento",
      courseCode: row.corsoCode,
      courseSearch: `${row.corsoCode} ${row.corso}`,
      type: row.stato === "programmato" ? "SVOLTO" : "PROGRAMMATO",
      date: "",
      note: "",
    });
  }

  const pageDashboardData = useMemo(() => {
    const baseRows = rows.filter((row) => isDashboardBaseCode(row.corsoCode));
    const operativiRows = rows.filter((row) => !isDashboardBaseCode(row.corsoCode));
    return {
      base: { rows: baseRows, summary: buildDashboardSummary(baseRows, eligibleEmployees) },
      operativi: { rows: operativiRows, summary: buildDashboardSummary(operativiRows, eligibleOperativiEmployees) },
    };
  }, [eligibleEmployees, eligibleOperativiEmployees, rows]);

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

      const targetMap = isDashboardBaseCode(row.corsoCode) ? baseRowsByJob : operativiRowsByJob;
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
      const baseSummary = buildDashboardSummary(baseRowsForJob, total);
      const operativiSummary = buildDashboardSummary(operativiRowsForJob, total);

      return {
        jobKey,
        label,
        isExtra,
        total,
        base: baseSummary,
        operativi: operativiSummary,
        baseCritico: countUniqueWorkersByStates(baseRowsForJob, CRITICAL_STATES),
        operativiCritico: countUniqueWorkersByStates(operativiRowsForJob, CRITICAL_STATES),
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
    <div className="space-y-4">
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
            {dashboardCategoryFilter || (dashboardStateFilter && dashboardStateFilter.length > 0) ? (
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
          <div className="grid gap-3">
            {(
              [
                { title: "Base", category: "base" as const, summary: pageDashboardData.base.summary, rows: pageDashboardData.base.rows },
                { title: "Operativi", category: "operativi" as const, summary: pageDashboardData.operativi.summary, rows: pageDashboardData.operativi.rows },
              ] as const
            ).map((panel) => {
              const summary = panel.summary;
              const criticoCount = countUniqueWorkersByStates(panel.rows, CRITICAL_STATES);
              const criticoPct = percentage(criticoCount, summary.total);

              return (
                <div key={panel.category} className="rounded-xl border border-[var(--brand-line)] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-[var(--brand-ink)]">{panel.title}</h3>
                    <button
                      type="button"
                      onClick={() => applyDashboardFilter({ category: panel.category, states: null })}
                      className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-bold text-white shadow-sm transition hover:brightness-95"
                      title="Applica filtro alla tabella"
                    >
                      Totale {summary.total}
                    </button>
                  </div>

                  <div className="mt-3">
                    <KpiGrid className="grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
                      <KpiCard
                        label="Totale"
                        value={summary.total}
                        subValue="100%"
                        onClick={() => applyDashboardFilter({ category: panel.category, states: null })}
                      />
                      <KpiCard
                        label="Critico"
                        value={criticoCount}
                        subValue={`${criticoPct}%`}
                        tone="danger"
                        onClick={() =>
                          applyDashboardFilter({ category: panel.category, states: ["scaduto", "da fare", "programmato", "upgrade"] })
                        }
                      />
                      <KpiCard
                        label="In scadenza"
                        value={summary.counts["in scadenza"]}
                        subValue={`${summary.percentages["in scadenza"]}%`}
                        tone="warning"
                        onClick={() => applyDashboardFilter({ category: panel.category, states: ["in scadenza"] })}
                      />
                      <KpiCard
                        label="Da fare"
                        value={summary.counts["da fare"]}
                        subValue={`${summary.percentages["da fare"]}%`}
                        tone="danger"
                        onClick={() => applyDashboardFilter({ category: panel.category, states: ["da fare"] })}
                      />
                      <KpiCard
                        label="Scaduto"
                        value={summary.counts.scaduto}
                        subValue={`${summary.percentages.scaduto}%`}
                        tone="danger"
                        onClick={() => applyDashboardFilter({ category: panel.category, states: ["scaduto"] })}
                      />
                      <KpiCard
                        label="Programmato"
                        value={summary.counts.programmato}
                        subValue={`${summary.percentages.programmato}%`}
                        tone="info"
                        onClick={() => applyDashboardFilter({ category: panel.category, states: ["programmato"] })}
                      />
                      <KpiCard
                        label="Upgrade"
                        value={summary.counts.upgrade}
                        subValue={`${summary.percentages.upgrade}%`}
                        tone="purple"
                        onClick={() => applyDashboardFilter({ category: panel.category, states: ["upgrade"] })}
                      />
                      <KpiCard
                        label="Esclusi"
                        value={summary.counts.escluso}
                        subValue={`${summary.percentages.escluso}%`}
                        tone="muted"
                        onClick={() => applyDashboardFilter({ category: panel.category, states: ["escluso"] })}
                      />
                    </KpiGrid>
                  </div>
                </div>
              );
            })}
          </div>
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
          <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showExcludedEmployees}
              onChange={(event) => setShowExcludedEmployees(event.target.checked)}
              className="h-4 w-4"
            />
            Mostra esclusi
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Simulazione su data selezionata (in scadenza: {expiringDays}gg).
        </p>
        {filterError ? <p className="mt-2 text-xs font-medium text-red-600">{filterError}</p> : null}
        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
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
          className="max-h-[62vh] overflow-auto"
        >
          <table
            ref={tableRef}
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
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 240 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 260 }} />
            </colgroup>
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <input
                    ref={selectAllVisibleRef}
                    type="checkbox"
                    checked={selectionStats.allVisibleSelected}
                    onChange={(event) => setAllVisibleSelection(event.target.checked)}
                    aria-label="Seleziona tutti i lavoratori visibili"
                    disabled={selectionStats.visibleCount === 0}
                  />
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("matricola")} className="inline-flex items-center gap-1">
                    Matricola {sortIcon("matricola")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("cognome")} className="inline-flex items-center gap-1">
                    Cognome {sortIcon("cognome")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
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
                  <button type="button" onClick={() => toggleSort("origine")} className="inline-flex items-center gap-1">
                    Origine {sortIcon("origine")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("stato")} className="inline-flex items-center gap-1">
                    Stato {sortIcon("stato")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">Azione</th>
                <th className="sticky top-0 z-20 bg-[var(--brand-panel)] px-4 py-2">
                  <button type="button" onClick={() => toggleSort("note")} className="inline-flex items-center gap-1">
                    Note {sortIcon("note")}
                  </button>
                </th>
              </tr>
              <tr>
                <th className="sticky top-8 z-10 bg-white px-3 py-2" />
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.matricola} onChange={(event) => setColumnFilters((v) => ({ ...v, matricola: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.cognome} onChange={(event) => setColumnFilters((v) => ({ ...v, cognome: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
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
                  <input value={columnFilters.corso} onChange={(event) => setColumnFilters((v) => ({ ...v, corso: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Codice/Titolo" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.dataConclusione} onChange={(event) => setColumnFilters((v) => ({ ...v, dataConclusione: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="gg/mm/aaaa" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.dataScadenza} onChange={(event) => setColumnFilters((v) => ({ ...v, dataScadenza: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="gg/mm/aaaa" />
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <select value={columnFilters.origine} onChange={(event) => setColumnFilters((v) => ({ ...v, origine: event.target.value as ColumnFilters["origine"] }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case">
                    <option value="">Tutte</option>
                    <option value="obbligatorio">Obbligatorio</option>
                    <option value="aggiuntivo">Aggiuntivo</option>
                  </select>
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <select value={columnFilters.stato} onChange={(event) => setColumnFilters((v) => ({ ...v, stato: event.target.value as ColumnFilters["stato"] }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case">
                    <option value="">Tutti</option>
                    <option value="idoneo">Idoneo</option>
                    <option value="in scadenza">In scadenza</option>
                    <option value="scaduto">Scaduto</option>
                    <option value="da fare">Da fare</option>
                    <option value="sospeso">Sospeso</option>
                    <option value="programmato">Programmato</option>
                    <option value="upgrade">Upgrade</option>
                    <option value="escluso">Escluso</option>
                  </select>
                </th>
                <th className="sticky top-8 z-10 bg-white px-3 py-2" />
                <th className="sticky top-8 z-10 bg-white px-3 py-2">
                  <input value={columnFilters.note} onChange={(event) => setColumnFilters((v) => ({ ...v, note: event.target.value }))} className="w-full rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case" placeholder="Filtro note" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={`${row.workerId}-${row.corsoCode}`}
                  className="border-t border-[var(--brand-line)] transition hover:bg-[var(--brand-panel)]/60"
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedWorkerIds.has(row.workerId)}
                      onChange={() => toggleWorkerSelection(row.workerId)}
                      aria-label={`Seleziona ${row.cognome} ${row.nome} (${row.matricola})`}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{row.matricola}</td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.cognome}>{row.cognome}</td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.nome}>{row.nome}</td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-600" title={row.mansione || "-"}>{row.mansione || "-"}</td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.cantiere}>{row.cantiere}</td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.sottocantiere}>{row.sottocantiere}</td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.responsabile || "-"}>{row.responsabile || "-"}</td>
                  <td className="max-w-[170px] truncate px-4 py-2.5 text-slate-600" title={row.referente || "-"}>{row.referente || "-"}</td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-600" title={row.corso}>{row.corso}</td>
                  <td className="px-4 py-2.5 font-medium tabular-nums text-slate-600">
                    {formatDateIt(row.dataConclusione)}
                  </td>
                  <td className="px-4 py-2.5 font-medium tabular-nums text-slate-600">
                    {formatDateIt(row.dataScadenza)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={originClassName(row.origine)} title={row.origine}>
                      {row.origine}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={statusClassName(row.stato)} title={row.stato}>
                        {row.stato}
                      </span>
                      {row.stato === "upgrade" && row.upgradeInfo ? (
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-600"
                          title={row.upgradeInfo}
                        >
                          {row.upgradeInfo}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openWorkerDetail(row)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                        title="Dettaglio lavoratore (esclusioni)"
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
                          <circle cx="11" cy="11" r="6.5" />
                          <path d="M20 20l-3.2-3.2" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => openQuickAction(row)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white shadow-sm transition hover:brightness-95"
                        title="Azione rapida su questa riga"
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
                          <rect x="4.5" y="6.5" width="15" height="14" rx="2.6" />
                          <path d="M8 3.5V7" />
                          <path d="M16 3.5V7" />
                          <path d="M4.5 10h15" />
                          <path d="M12 13.5V18" />
                          <path d="M9.8 15.75H14.2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-600" title={row.note || "-"}>
                    {row.note || "-"}
                  </td>
                </tr>
              ))}
              {!isLoading && sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nessun dato disponibile.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {isDashboardDetailOpen ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
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
                  onClick={() => setShowOnlyProblemJobsInDetail((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
                >
                  <span
                    className={[
                      "inline-flex h-4 w-4 items-center justify-center rounded border border-[var(--brand-line)]",
                      showOnlyProblemJobsInDetail ? "bg-[var(--brand-primary)] text-white" : "bg-white text-white",
                    ].join(" ")}
                  >
                    ✓
                  </span>
                  Solo problematiche
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmptyJobsInDetail((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
                >
                  <span
                    className={[
                      "inline-flex h-4 w-4 items-center justify-center rounded border border-[var(--brand-line)]",
                      showEmptyJobsInDetail ? "bg-[var(--brand-primary)] text-white" : "bg-white text-white",
                    ].join(" ")}
                  >
                    ✓
                  </span>
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
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardDetailSorted.base
                            .filter((item) => showEmptyJobsInDetail || item.total > 0)
                            .filter((item) => {
                              if (!showOnlyProblemJobsInDetail) return true;
                              const c = item.base.counts;
                              const problems =
                                c.scaduto +
                                c["da fare"] +
                                c["in scadenza"] +
                                c.programmato +
                                c.upgrade;
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
                              <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">{item.total}</td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="scaduto" count={item.base.counts.scaduto} pct={item.base.percentages.scaduto} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="da_fare" count={item.base.counts["da fare"]} pct={item.base.percentages["da fare"]} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="in_scadenza" count={item.base.counts["in scadenza"]} pct={item.base.percentages["in scadenza"]} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="programmato" count={item.base.counts.programmato} pct={item.base.percentages.programmato} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="upgrade" count={item.base.counts.upgrade} pct={item.base.percentages.upgrade} />
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
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardDetailSorted.operativi
                            .filter((item) => showEmptyJobsInDetail || item.total > 0)
                            .filter((item) => {
                              if (!showOnlyProblemJobsInDetail) return true;
                              const c = item.operativi.counts;
                              const problems =
                                c.scaduto +
                                c["da fare"] +
                                c["in scadenza"] +
                                c.programmato +
                                c.upgrade;
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
                              <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800">{item.total}</td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="scaduto" count={item.operativi.counts.scaduto} pct={item.operativi.percentages.scaduto} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="da_fare" count={item.operativi.counts["da fare"]} pct={item.operativi.percentages["da fare"]} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="in_scadenza" count={item.operativi.counts["in scadenza"]} pct={item.operativi.percentages["in scadenza"]} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="programmato" count={item.operativi.counts.programmato} pct={item.operativi.percentages.programmato} />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                                <StateCell tone="upgrade" count={item.operativi.counts.upgrade} pct={item.operativi.percentages.upgrade} />
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
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--brand-line)] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--brand-line)] bg-gradient-to-r from-[var(--brand-panel)] to-white px-5 py-4">
              <div className="space-y-0.5">
                <h2 className="text-lg font-bold text-[var(--brand-ink)]">Dettaglio lavoratore</h2>
                <p className="text-xs text-slate-500">{workerDetailTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsWorkerDetailOpen(false);
                  setWorkerDetailEmployeeId(null);
                  setWorkerDetailRows([]);
                  setWorkerDetailError("");
                  setIsExclusionNoteModalOpen(false);
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--brand-line)] bg-white text-slate-600 transition hover:bg-slate-50"
                title="Chiudi"
              >
                ✕
              </button>
            </div>

            <div className="border-b border-[var(--brand-line)] px-5 py-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setWorkerDetailTab("formazione")}
                  className={[
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    workerDetailTab === "formazione"
                      ? "bg-[var(--brand-primary)] text-white"
                      : "border border-[var(--brand-line)] bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Formazione
                </button>
                <button
                  type="button"
                  onClick={() => setWorkerDetailTab("esclusioni")}
                  className={[
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    workerDetailTab === "esclusioni"
                      ? "bg-[var(--brand-primary)] text-white"
                      : "border border-[var(--brand-line)] bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Esclusioni
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {workerDetailLoading ? (
                <p className="text-sm text-slate-600">Caricamento...</p>
              ) : workerDetailError ? (
                <p className="text-sm font-medium text-red-600">{workerDetailError}</p>
              ) : workerDetailTab === "formazione" ? (
                <div className="space-y-4">
                  {employeeExclusion.isActive ? (
                    <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4 text-sm text-slate-700">
                      <span className="font-semibold text-[var(--brand-ink)]">Lavoratore escluso.</span> La formazione
                      è marcata come esclusa in questo modulo.
                    </div>
                  ) : null}
                  <div className="overflow-hidden rounded-xl border border-[var(--brand-line)] bg-white">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-[var(--brand-panel)] text-slate-500">
                          <tr className="uppercase tracking-wide">
                            <th className="px-3 py-2">Corso</th>
                            <th className="px-3 py-2">Data corso</th>
                            <th className="px-3 py-2">Scadenza</th>
                            <th className="px-3 py-2">Stato</th>
                            <th className="px-3 py-2">Azione</th>
                          </tr>
                        </thead>
                        <tbody>
                          {workerDetailRows
                            .slice()
                            .sort((a, b) => `${a.corsoCode} ${a.corso}`.localeCompare(`${b.corsoCode} ${b.corso}`))
                            .map((r) => {
                              const courseId = r.courseId ?? null;
                              const isExcluded = courseId ? courseExclusionNotes.has(courseId) : false;
                              return (
                                <tr
                                  key={`${r.workerId}-${r.corsoCode}-${r.origine}`}
                                  className="border-t border-[var(--brand-line)] hover:bg-[var(--brand-panel)]/60"
                                >
                                  <td className="px-3 py-2 text-slate-700" title={`${r.corsoCode} - ${r.corso}`}>
                                    <span className="font-semibold text-slate-800">{r.corsoCode}</span> {r.corso}
                                  </td>
                                  <td className="px-3 py-2 font-medium tabular-nums text-slate-700">
                                    {formatDateIt(r.dataConclusione)}
                                  </td>
                                  <td className="px-3 py-2 font-medium tabular-nums text-slate-700">
                                    {formatDateIt(r.dataScadenza)}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={statusClassName(r.stato)}>{r.stato}</span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        disabled={employeeExclusion.isActive || !courseId}
                                        onClick={() => {
                                          if (!courseId) return;
                                          setSelectedWorkerIds(new Set([r.workerId]));
                                          openEventModal({
                                            tab: "evento",
                                            courseCode: r.corsoCode,
                                            courseSearch: `${r.corsoCode} ${r.corso}`.trim(),
                                            type: r.dataConclusione ? "MODIFICA_DATA" : "SVOLTO",
                                            date: r.dataConclusione ?? "",
                                            note: "",
                                          });
                                        }}
                                        className={[
                                          "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                                          employeeExclusion.isActive || !courseId
                                            ? "cursor-not-allowed border-[var(--brand-line)] bg-slate-100 text-slate-400"
                                            : "border-[var(--brand-line)] bg-white text-slate-700 hover:bg-slate-50",
                                        ].join(" ")}
                                      >
                                        Modifica data
                                      </button>
                                      <button
                                        type="button"
                                        disabled={employeeExclusion.isActive || !courseId}
                                        onClick={() => courseId && void requestCourseExclusionToggle(courseId)}
                                        className={[
                                          "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                                          employeeExclusion.isActive || !courseId
                                            ? "cursor-not-allowed border-[var(--brand-line)] bg-slate-100 text-slate-400"
                                            : isExcluded
                                              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                              : "border-[var(--brand-line)] bg-white text-slate-700 hover:bg-slate-50",
                                        ].join(" ")}
                                      >
                                        {isExcluded ? "Rimuovi esclusione" : "Escludi"}
                                      </button>
                                      {isExcluded && courseId ? (
                                        <button
                                          type="button"
                                          disabled={employeeExclusion.isActive}
                                          onClick={() => void deleteCourseExclusion(courseId)}
                                          className={[
                                            "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                                            employeeExclusion.isActive
                                              ? "cursor-not-allowed border-[var(--brand-line)] bg-slate-100 text-slate-400"
                                              : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
                                          ].join(" ")}
                                        >
                                          Elimina
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          {workerDetailRows.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                                Nessun corso disponibile.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
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
                    <p className="text-sm font-semibold text-[var(--brand-ink)]">Corsi esclusi</p>
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
                              workerDetailRows
                                .filter((r) => (r.courseId ? courseExclusionNotes.has(r.courseId) : false))
                                .slice()
                                .sort((a, b) => `${a.corsoCode} ${a.corso}`.localeCompare(`${b.corsoCode} ${b.corso}`))
                                .map((r) => (
                                  <tr
                                    key={`excluded-${r.courseId ?? r.corsoCode}`}
                                    className="border-t border-[var(--brand-line)]"
                                  >
                                    <td className="px-3 py-2 text-slate-700">
                                      <span className="font-semibold text-slate-800">{r.corsoCode}</span> {r.corso}
                                    </td>
                                    <td className="px-3 py-2 text-slate-700">
                                      {r.courseId ? courseExclusionNotes.get(r.courseId) ?? "-" : "-"}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <button
                                        type="button"
                                        disabled={!r.courseId}
                                        onClick={() => r.courseId && void deleteCourseExclusion(r.courseId)}
                                        className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        Cancella
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
          </div>

          {isExclusionNoteModalOpen ? (
            <section className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
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
                    onClick={() => setIsExclusionNoteModalOpen(false)}
                    className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
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
        </section>
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
          await loadRows();
          if (
            isWorkerDetailOpen &&
            typeof workerDetailEmployeeId === "number" &&
            employeeIds.includes(workerDetailEmployeeId)
          ) {
            await loadWorkerDetail(workerDetailEmployeeId);
          }
        }}
      />

      {isImportModalOpen ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
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
              <p className="mt-2 text-xs text-slate-500">
                Ultimo import: {formatDateTimeIt(importLastRun.createdAt)}
                {importLastRun.importedByName ? ` · ${importLastRun.importedByName}` : ""} · {importLastRun.fileName}
              </p>
            ) : null}
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
                onClick={() => {
                  setIsImportModalOpen(false);
                  resetImportForm();
                }}
                className="rounded-xl border border-[var(--brand-line)] px-4 py-2 text-sm font-semibold text-slate-600"
              >
                Chiudi
              </button>
              <button
                type="button"
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white"
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

function statusClassName(status: WorkerCourseRow["stato"]) {
  const base =
    "inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-[2px] text-[9px] font-medium uppercase tracking-[0.04em] leading-none";
  if (status === "escluso")
    return `${base} border-slate-200 bg-white text-slate-600`;
  if (status === "scaduto")
    return `${base} border-red-200 bg-red-50 text-red-700`;
  if (status === "in scadenza")
    return `${base} border-amber-200 bg-amber-50 text-amber-700`;
  if (status === "idoneo")
    return `${base} border-emerald-200 bg-emerald-50 text-emerald-700`;
  if (status === "sospeso")
    return `${base} border-slate-300 bg-slate-100 text-slate-700`;
  if (status === "programmato")
    return `${base} border-sky-200 bg-sky-50 text-sky-700`;
  if (status === "upgrade")
    return `${base} border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800`;
  return `${base} border-red-200 bg-red-50 text-red-700`;
}

function originClassName(origine: WorkerCourseRow["origine"]) {
  const base =
    "inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-[2px] text-[9px] font-medium uppercase tracking-[0.04em] leading-none";
  if (origine === "aggiuntivo") {
    return `${base} border-cyan-200 bg-cyan-50 text-cyan-700`;
  }
  return `${base} border-indigo-200 bg-indigo-50 text-indigo-700`;
}

function matchText(value: string, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) return true;
  const normalizedValue = value.toLowerCase();
  if (normalizedValue.includes(normalizedFilter)) return true;
  const formattedValue = isoToItDate(value).toLowerCase();
  if (formattedValue !== normalizedValue && formattedValue.includes(normalizedFilter)) return true;
  return false;
}

function isDashboardBaseCode(code: string) {
  return DASHBOARD_BASE_CODES.has(code) || code.startsWith("FORM_BASE+");
}

function isoToItDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatDateIt(value: string | null) {
  if (!value) return "-";
  return isoToItDate(value);
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

  rows.forEach((row) => {
    if (DASHBOARD_STATES.includes(row.stato as DashboardStateKey)) {
      counts[row.stato as DashboardStateKey].add(row.workerId);
    }
  });

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

  return { total: totalActiveEmployees, counts: finalCounts, percentages };
}

function countUniqueWorkersByStates(
  rows: WorkerCourseRow[],
  states: readonly WorkerCourseRow["stato"][],
) {
  const set = new Set<number>();
  rows.forEach((row) => {
    if (states.includes(row.stato)) set.add(row.workerId);
  });
  return set.size;
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
  tone: "scaduto" | "da_fare" | "in_scadenza" | "programmato" | "upgrade";
  count: number;
  pct: number;
}) {
  const cls =
    count === 0
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : tone === "scaduto"
        ? "border-red-200 bg-red-50 text-red-700"
        : tone === "da_fare"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : tone === "in_scadenza"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : tone === "programmato"
              ? "border-sky-200 bg-sky-50 text-sky-800"
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

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadCsvFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function todayLocalIso() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatIsoToItDate(iso: string) {
  const match = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function normalizeItDateDraft(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseStrictItDateToIso(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const dd = match[1];
  const mm = match[2];
  const yyyy = match[3];
  const iso = `${yyyy}-${mm}-${dd}`;
  const dt = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(dt.getTime())) return null;
  const roundTrip = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return roundTrip === iso ? iso : null;
}

function getDefaultSimulationDate() {
  return todayLocalIso();
}
