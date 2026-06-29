import type { ReactNode } from "react";

type Tone = "neutral" | "primary" | "danger" | "warning" | "info" | "success" | "muted" | "purple";

function toneClassName(tone: Tone) {
  if (tone === "danger") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "info") return "border-sky-200 bg-sky-50 text-sky-800";
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "purple") return "border-purple-200 bg-purple-50 text-purple-800";
  if (tone === "primary") return "border-[var(--brand-line)] bg-[var(--brand-panel)] text-[var(--brand-ink)]";
  if (tone === "muted") return "border-[var(--brand-line)] bg-[var(--brand-panel-2)] text-slate-600";
  return "border-[var(--brand-line)] bg-[var(--brand-panel-2)] text-[var(--brand-ink)]";
}

function pillToneClassName(tone: Tone) {
  if (tone === "danger") return "border-red-700/40 bg-red-600/25 text-white";
  if (tone === "warning") return "border-amber-600/40 bg-amber-400/25 text-slate-950";
  if (tone === "info") return "border-sky-700/40 bg-sky-600/25 text-white";
  if (tone === "success") return "border-emerald-700/40 bg-emerald-600/25 text-slate-950";
  if (tone === "purple") return "border-violet-700/40 bg-violet-600/25 text-white";
  if (tone === "muted") return "border-slate-700/40 bg-slate-600/25 text-white";
  if (tone === "primary") return "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white";
  return "border-slate-300 bg-slate-100 text-slate-700";
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
            <p className="mt-2 text-sm leading-7 text-slate-500">{props.description}</p>
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
        <p className="text-center text-sm font-bold text-slate-950">{props.label}</p>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <p className="text-2xl font-bold tabular-nums">{props.value}</p>
          {props.subValue !== undefined ? (
            <p className="text-2xl font-bold text-slate-700 tabular-nums">{props.subValue}</p>
          ) : null}
        </div>
        {props.hint !== undefined ? (
          <p className="mt-1 text-xs font-medium leading-snug text-slate-600">{props.hint}</p>
        ) : null}
      </>
    ) : (
      <>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{props.value}</p>
        {props.subValue !== undefined ? (
          <p className="mt-0.5 text-[10px] font-semibold text-slate-500 tabular-nums">{props.subValue}</p>
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
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        {content}
      </div>
      {props.icon && (
        <div className={`text-slate-400 p-1 rounded-xl bg-slate-50 transition-colors ${isActive ? 'bg-white text-[var(--brand-primary)]' : ''}`}>
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
    const cls = "h-8 w-8 text-slate-400 stroke-[1.5]";
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
      <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-slate-50 border border-slate-100 shadow-sm mb-4">
        {getIcon()}
      </div>
      <h3 className="text-sm font-bold text-slate-800 mb-1">{props.title}</h3>
      <p className="text-xs text-slate-500 max-w-[320px] leading-relaxed mb-4">{props.description}</p>
      {props.action && <div className="mt-1">{props.action}</div>}
    </div>
  );
}

