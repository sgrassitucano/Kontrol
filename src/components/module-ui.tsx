import { ReactNode, useState, useEffect, useRef } from "react";
import { 
  X, Calendar, BookOpen, AlertTriangle, Eye, ShieldAlert, Award, FileText, 
  CheckCircle2, ChevronRight, User, MoreVertical, Shield, Sparkles
} from "lucide-react";

type Tone = "neutral" | "primary" | "danger" | "warning" | "info" | "success" | "muted" | "purple";

function toneClassName(tone: Tone) {
  if (tone === "danger") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400";
  if (tone === "info") return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-400";
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400";
  if (tone === "purple") return "border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900/50 dark:bg-purple-950/20 dark:text-purple-400";
  if (tone === "primary") return "border-[var(--brand-line)] bg-[var(--brand-panel)] text-[var(--brand-ink)]";
  if (tone === "muted") return "border-[var(--brand-line)] bg-[var(--brand-panel-2)] text-slate-600 dark:text-slate-400";
  return "border-[var(--brand-line)] bg-[var(--brand-panel-2)] text-[var(--brand-ink)]";
}

function pillToneClassName(tone: Tone) {
  if (tone === "danger") return "border-red-700/40 bg-red-600/25 text-red-100 dark:text-red-200";
  if (tone === "warning") return "border-amber-600/40 bg-amber-400/25 text-amber-950 dark:text-amber-200";
  if (tone === "info") return "border-sky-700/40 bg-sky-600/25 text-sky-100 dark:text-sky-200";
  if (tone === "success") return "border-emerald-700/40 bg-emerald-600/25 text-emerald-950 dark:text-emerald-200";
  if (tone === "purple") return "border-violet-700/40 bg-violet-600/25 text-violet-100 dark:text-violet-200";
  if (tone === "muted") return "border-slate-700/40 bg-slate-600/25 text-slate-100 dark:text-slate-200";
  if (tone === "primary") return "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white";
  return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export function ModuleHeader(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        "rounded-[20px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4",
        props.className ?? "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-ink)]">{props.title}</h1>
          {props.description ? (
            <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">{props.description}</p>
          ) : null}
        </div>
        {props.actions ? (
          <div className="module-actions flex flex-wrap items-center gap-2">{props.actions}</div>
        ) : null}
      </div>
      {props.children ? <div className="mt-4">{props.children}</div> : null}
    </section>
  );
}

export function PanelCard(props: { children: ReactNode; className?: string }) {
  return (
    <section className={["rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4", props.className ?? ""].join(" ")}>
      {props.children}
    </section>
  );
}

export function DashboardCard(props: { children: ReactNode; className?: string }) {
  return (
    <section className={["rounded-[16px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4", props.className ?? ""].join(" ")}>
      {props.children}
    </section>
  );
}

export function KpiGrid(props: { children: ReactNode; className?: string }) {
  return <div className={["grid gap-3", props.className ?? ""].join(" ")}>{props.children}</div>;
}

export function KpiCard(props: {
  label: string;
  value: ReactNode;
  subValue?: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  layout?: "default" | "dashboard";
  isActive?: boolean;
  icon?: ReactNode;
}) {
  const tone = props.tone ?? "neutral";
  const layout = props.layout ?? "default";
  const content =
    layout === "dashboard" ? (
      <>
        <p className="text-center text-sm font-bold text-slate-950 dark:text-slate-200">{props.label}</p>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <p className="text-2xl font-bold tabular-nums">{props.value}</p>
          {props.subValue !== undefined ? (
            <p className="text-2xl font-bold text-slate-700 dark:text-slate-400 tabular-nums">{props.subValue}</p>
          ) : null}
        </div>
        {props.hint !== undefined ? (
          <p className="mt-1 text-xs font-medium leading-snug text-slate-600 dark:text-slate-400">{props.hint}</p>
        ) : null}
      </>
    ) : (
      <>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{props.label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{props.value}</p>
        {props.subValue !== undefined ? (
          <p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">{props.subValue}</p>
        ) : null}
      </>
    );

  const isClickable = Boolean(props.onClick);
  const isActive = Boolean(props.isActive);

  const containerClassName = [
    "relative rounded-2xl border p-4 text-left transition-all duration-200 overflow-hidden",
    toneClassName(tone),
    isClickable ? "hover:bg-[var(--brand-panel)] hover:shadow-md hover:-translate-y-0.5 cursor-pointer" : "",
    isActive ? "ring-2 ring-[var(--brand-primary)] border-transparent shadow-sm bg-[var(--brand-tint)]/40" : "",
  ].join(" ");

  const cardContent = (
    <div className="flex items-start justify-between gap-3 w-full">
      <div className="space-y-1">
        {content}
      </div>
      {props.icon && (
        <div className={`text-slate-400 p-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 transition-colors ${isActive ? 'bg-white dark:bg-slate-700 text-[var(--brand-primary)]' : ''}`}>
          {props.icon}
        </div>
      )}
    </div>
  );

  if (props.onClick) {
    return (
      <button
        type="button"
        data-kpi="true"
        onClick={props.onClick}
        className={containerClassName}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div className={containerClassName}>
      {cardContent}
    </div>
  );
}

export function StatusPill(props: { tone: Tone; children: ReactNode }) {
  return (
    <span className={["inline-flex rounded-full border px-2.5 py-1 text-xs font-bold", pillToneClassName(props.tone)].join(" ")}>
      {props.children}
    </span>
  );
}

export function EmptyState(props: {
  title: string;
  description: string;
  action?: ReactNode;
  iconType?: "search" | "box" | "users" | "calendar" | "truck";
}) {
  const getIcon = () => {
    const cls = "h-8 w-8 text-slate-400 dark:text-slate-500 stroke-[1.5]";
    if (props.iconType === "search") {
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      );
    }
    if (props.iconType === "users") {
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      );
    }
    if (props.iconType === "calendar") {
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    if (props.iconType === "truck") {
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 10-4 0 2 2 0 004 0z" />
        </svg>
      );
    }
    // Default box icon
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center text-center p-8 rounded-2xl border border-dashed border-[var(--brand-line)] bg-[var(--brand-panel)]/40 min-h-[220px]">
      <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm mb-4">
        {getIcon()}
      </div>
      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">{props.title}</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[320px] leading-relaxed mb-4">{props.description}</p>
      {props.action && <div className="mt-1">{props.action}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Componente KPI Donut Chart
   ───────────────────────────────────────────────────────── */
export function KpiDonutChart(props: {
  label: string;
  percentage: number;
  description?: string;
  tone?: Tone;
  icon?: ReactNode;
  onClick?: () => void;
  isActive?: boolean;
}) {
  const radius = 24;
  const strokeWidth = 5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (props.percentage / 100) * circumference;
  
  const tone = props.tone ?? "primary";
  const isActive = Boolean(props.isActive);

  // Determina la classe del colore in base al tone
  let strokeColor = "stroke-[var(--brand-primary)]";
  let trackColor = "stroke-slate-100 dark:stroke-slate-800";
  if (tone === "danger") strokeColor = "stroke-red-600 dark:stroke-red-500";
  if (tone === "warning") strokeColor = "stroke-amber-500 dark:stroke-amber-500";
  if (tone === "success") strokeColor = "stroke-emerald-600 dark:stroke-emerald-500";
  if (tone === "info") strokeColor = "stroke-sky-600 dark:stroke-sky-500";
  if (tone === "purple") strokeColor = "stroke-purple-600 dark:stroke-purple-500";

  const containerClass = [
    "flex items-center justify-between gap-4 rounded-2xl border p-4 text-left transition-all duration-200 overflow-hidden w-full",
    toneClassName(tone),
    props.onClick ? "hover:bg-[var(--brand-panel)] hover:shadow-md hover:-translate-y-0.5 cursor-pointer" : "",
    isActive ? "ring-2 ring-[var(--brand-primary)] border-transparent bg-[var(--brand-tint)]/40 shadow-sm" : ""
  ].join(" ");

  const cardContent = (
    <>
      <div className="space-y-1 flex-1">
        <div className="flex items-center gap-1.5">
          {props.icon && <span className="text-slate-400 dark:text-slate-500">{props.icon}</span>}
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{props.label}</p>
        </div>
        <p className="text-lg font-bold text-[var(--brand-ink)] mt-1">{props.percentage}%</p>
        {props.description && (
          <p className="text-[10px] leading-snug text-slate-400 dark:text-slate-500 font-medium">{props.description}</p>
        )}
      </div>
      
      <div className="relative flex items-center justify-center h-14 w-14 shrink-0">
        <svg className="transform -rotate-90 w-14 h-14">
          <circle
            cx="28"
            cy="28"
            r={radius}
            className={trackColor}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <circle
            cx="28"
            cy="28"
            r={radius}
            className={`${strokeColor} transition-all duration-500 ease-out`}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
          />
        </svg>
        <span className="absolute text-xs font-bold tabular-nums text-slate-800 dark:text-slate-200">{props.percentage}%</span>
      </div>
    </>
  );

  if (props.onClick) {
    return (
      <button type="button" onClick={props.onClick} className={containerClass}>
        {cardContent}
      </button>
    );
  }

  return (
    <div className={containerClass}>
      {cardContent}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Drawer Volante per Ispezione Lavoratori
   ───────────────────────────────────────────────────────── */
type DrawerWorkerData = {
  worker: {
    id: number;
    matricola: string;
    cognome: string;
    nome: string;
    mansione: string;
    cantiere: string;
    sottocantiere: string;
    responsabile: string;
    referente: string;
  };
  visits: Array<{
    visitaRichiesta: string;
    scadenzaVisita: string | null;
    stato: string;
    medico: string;
    limitazioni: string;
    note: string;
  }>;
  courses: Array<{
    corsoCode: string;
    corso: string;
    dataConclusione: string | null;
    dataScadenza: string | null;
    dataPrevista: string | null;
    stato: string;
    note: string;
  }>;
  dpi: Array<{
    dpi: string;
    category: string;
    dataConsegna: string | null;
    dataProssimoControllo: string | null;
    stato: string;
    note: string;
  }>;
};

export function DetailDrawer(props: {
  isOpen: boolean;
  onClose: () => void;
  workerId: number | null;
  workerSummary?: {
    matricola: string;
    cognome: string;
    nome: string;
    mansione: string;
    cantiere: string;
    sottocantiere: string;
    responsabile: string;
    referente: string;
  };
}) {
  const [data, setData] = useState<DrawerWorkerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"generale" | "corsi" | "visite" | "dpi">("generale");

  useEffect(() => {
    if (!props.isOpen || !props.workerId) {
      setData(null);
      return;
    }

    const loadData = async () => {
      setLoading(true);
      try {
        const [resCorsi, resVisite, resDpi] = await Promise.all([
          fetch(`/api/lavoratori/corsi?employeeId=${props.workerId}`),
          fetch(`/api/sorveglianza_sanitaria/lavoratori?employeeIds=${props.workerId}`),
          fetch(`/api/lavoratori/dpi?employeeId=${props.workerId}`)
        ]);

        const dataCorsi = resCorsi.ok ? await resCorsi.json() : { rows: [] };
        const dataVisite = resVisite.ok ? await resVisite.json() : { rows: [] };
        const dataDpi = resDpi.ok ? await resDpi.json() : { rows: [] };

        const summary = props.workerSummary ?? {
          matricola: dataVisite.rows[0]?.matricola ?? dataCorsi.rows[0]?.matricola ?? "-",
          cognome: dataVisite.rows[0]?.cognome ?? dataCorsi.rows[0]?.cognome ?? "-",
          nome: dataVisite.rows[0]?.nome ?? dataCorsi.rows[0]?.nome ?? "-",
          mansione: dataVisite.rows[0]?.mansione ?? dataCorsi.rows[0]?.mansione ?? "-",
          cantiere: dataVisite.rows[0]?.cantiere ?? dataCorsi.rows[0]?.cantiere ?? "-",
          sottocantiere: dataVisite.rows[0]?.sottocantiere ?? dataCorsi.rows[0]?.sottocantiere ?? "-",
          responsabile: dataVisite.rows[0]?.responsabile ?? dataCorsi.rows[0]?.responsabile ?? "-",
          referente: dataVisite.rows[0]?.referente ?? dataCorsi.rows[0]?.referente ?? "-"
        };

        setData({
          worker: { id: props.workerId!, ...summary },
          courses: dataCorsi.rows ?? [],
          visits: dataVisite.rows ?? [],
          dpi: dataDpi.rows ?? []
        });
      } catch (err) {
        console.error("Errore nel caricamento del Drawer", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [props.isOpen, props.workerId, props.workerSummary]);

  const getStateColor = (stato: string) => {
    const s = String(stato ?? "").toLowerCase();
    if (s === "idoneo" || s === "consegnato") return "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50";
    if (s === "in scadenza" || s === "da verificare" || s === "da consegnare") return "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50";
    if (s === "scaduto" || s === "perso") return "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30 border-red-200 dark:border-red-900/50";
    if (s === "programmato") return "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/30 border-purple-200 dark:border-purple-900/50";
    if (s === "sospeso") return "text-slate-600 bg-slate-50 dark:text-slate-400 dark:bg-slate-900 border-slate-200 dark:border-slate-800";
    return "text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-800 border-slate-200 dark:border-slate-700";
  };

  return (
    <>
      <div 
        className={`drawer-backdrop ${props.isOpen ? "open pointer-events-auto" : "pointer-events-none opacity-0"}`} 
        onClick={props.onClose} 
      />
      
      <div className={`drawer-panel ${props.isOpen ? "open" : ""} flex flex-col`}>
        <div className="flex items-center justify-between p-4 border-b border-[var(--brand-line)] bg-slate-50 dark:bg-slate-900/40">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] flex items-center justify-center">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-md font-bold text-[var(--brand-ink)]">
                {data ? `${data.worker.cognome} ${data.worker.nome}` : "Ispezione Lavoratore"}
              </h2>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Matricola: {data?.worker.matricola ?? "..."}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={props.onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex border-b border-[var(--brand-line)] bg-white dark:bg-slate-900 shrink-0">
          {(["generale", "corsi", "visite", "dpi"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-xs font-semibold border-b-2 transition-all capitalize ${
                activeTab === tab
                  ? "border-[var(--brand-primary)] text-[var(--brand-primary)]"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/10">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="h-8 w-8 rounded-full border-3 border-[var(--brand-primary)] border-t-transparent animate-spin" />
              <p className="text-xs text-slate-400 dark:text-slate-500 font-medium animate-pulse">Caricamento scheda...</p>
            </div>
          ) : data ? (
            <div className="animate-tab-content">
              {activeTab === "generale" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[var(--brand-line)] bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide border-b border-[var(--brand-line)] pb-2 flex items-center gap-1.5">
                      <Shield className="h-4 w-4 text-[var(--brand-primary)]" /> Informazioni Generali
                    </h3>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Mansione</p>
                        <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{data.worker.mansione}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Cantiere</p>
                        <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{data.worker.cantiere}</p>
                      </div>
                      {data.worker.sottocantiere !== "-" && (
                        <div>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Sottocantiere</p>
                          <p className="font-medium text-slate-700 dark:text-slate-300 mt-0.5">{data.worker.sottocantiere}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Responsabile</p>
                        <p className="font-medium text-slate-700 dark:text-slate-300 mt-0.5">{data.worker.responsabile}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--brand-line)] bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide border-b border-[var(--brand-line)] pb-2 flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-[var(--brand-primary)]" /> Sintesi Stato Lavoratore
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <BookOpen className="h-4 w-4" /> Corsi di formazione
                        </span>
                        <span className="font-bold">
                          {data.courses.filter(c => c.stato === "idoneo").length} / {data.courses.length} Conformi
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <Award className="h-4 w-4" /> Sorveglianza Sanitaria
                        </span>
                        <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold ${
                          data.visits[0]?.stato === "idoneo" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-amber-50 text-amber-600 border-amber-200"
                        }`}>
                          {data.visits[0]?.stato.toUpperCase() ?? "NON RICHIESTA"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <Shield className="h-4 w-4" /> DPI in Consegna
                        </span>
                        <span className="font-bold">
                          {data.dpi.filter(d => d.stato === "idoneo" || d.stato === "consegnato").length} / {data.dpi.length} Consegnati
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "corsi" && (
                <div className="space-y-2">
                  {data.courses.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500 py-10 text-center">Nessun corso richiesto per questa mansione.</p>
                  ) : (
                    data.courses.map((corso, idx) => (
                      <div key={idx} className="rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-900 p-3 flex flex-col gap-1.5 shadow-sm text-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-bold text-slate-800 dark:text-slate-200">{corso.corso}</div>
                          <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${getStateColor(corso.stato)}`}>
                            {corso.stato.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide">Codice: {corso.corsoCode}</div>
                        <div className="flex items-center justify-between gap-3 mt-1 pt-1.5 border-t border-[var(--brand-line)] text-[10px] text-slate-500">
                          <div>
                            Scadenza: <span className="font-bold text-slate-700 dark:text-slate-300">{corso.dataScadenza ?? "Illimitato"}</span>
                          </div>
                          {corso.dataPrevista && (
                            <div>
                              Previsto il: <span className="font-bold text-purple-600 dark:text-purple-400">{corso.dataPrevista}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "visite" ? (
                <div className="space-y-4">
                  {data.visits.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500 py-10 text-center">Nessun dato di sorveglianza sanitaria.</p>
                  ) : (
                    data.visits.map((visita, idx) => (
                      <div key={idx} className="space-y-3">
                        <div className="rounded-2xl border border-[var(--brand-line)] bg-white dark:bg-slate-900 p-4 shadow-sm text-xs space-y-3">
                          <div className="flex items-center justify-between border-b border-[var(--brand-line)] pb-2">
                            <div>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Stato Visita</p>
                              <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${getStateColor(visita.stato)}`}>
                                {visita.stato.toUpperCase()}
                              </span>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Medico</p>
                              <p className="font-bold text-slate-700 dark:text-slate-300 mt-0.5">{visita.medico}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Visita Richiesta</p>
                              <p className="font-bold text-slate-700 dark:text-slate-300 mt-0.5">{visita.visitaRichiesta}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Scadenza</p>
                              <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">{visita.scadenzaVisita ?? "Da definire"}</p>
                            </div>
                          </div>

                          {visita.limitazioni && (
                            <div className="p-2.5 rounded-xl border border-red-200/40 bg-red-50/15 text-slate-950 dark:text-red-200">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-700 dark:text-red-400 mb-1">
                                <AlertTriangle className="h-4 w-4 shrink-0" /> LIMITAZIONI / PRESCRIZIONI
                              </div>
                              <p className="text-[11px] leading-relaxed font-medium">{visita.limitazioni}</p>
                            </div>
                          )}

                          {visita.note && (
                            <div>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Note</p>
                              <p className="text-slate-600 dark:text-slate-400 mt-0.5 text-[11px]">{visita.note}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : null}

              {activeTab === "dpi" && (
                <div className="space-y-2">
                  {data.dpi.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500 py-10 text-center">Nessun DPI associato.</p>
                  ) : (
                    data.dpi.map((item, idx) => (
                      <div key={idx} className="rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-900 p-3 flex flex-col gap-1 shadow-sm text-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-bold text-slate-800 dark:text-slate-200">{item.dpi}</div>
                          <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${getStateColor(item.stato)}`}>
                            {item.stato.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">Categoria: {item.category}</div>
                        <div className="flex items-center justify-between gap-3 mt-1 pt-1.5 border-t border-[var(--brand-line)] text-[10px] text-slate-500">
                          <div>
                            Consegnato: <span className="font-bold text-slate-700 dark:text-slate-300">{item.dataConsegna ?? "Da consegnare"}</span>
                          </div>
                          {item.dataProssimoControllo && (
                            <div>
                              Prossimo controllo: <span className="font-bold text-slate-700 dark:text-slate-300">{item.dataProssimoControllo}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-10 text-center">Impossibile trovare le informazioni.</p>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Menu delle Azioni Rapide su Tabella (Action Popover)
   ───────────────────────────────────────────────────────── */
export function ActionMenu(props: {
  actions: Array<{
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    danger?: boolean;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  return (
    <div className="relative inline-block text-left shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-xl border border-[var(--brand-line)] bg-white dark:bg-slate-900 shadow-lg z-30 py-1.5 focus:outline-none animate-modal">
          {props.actions.map((act, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                act.onClick();
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                act.danger
                  ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                  : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {act.icon && <span className="shrink-0 text-slate-400 dark:text-slate-500">{act.icon}</span>}
              <span className="font-semibold">{act.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
