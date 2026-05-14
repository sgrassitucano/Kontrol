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

  if (props.onClick) {
    return (
      <button
        type="button"
        data-kpi="true"
        onClick={props.onClick}
        className={[
          "rounded-2xl border p-3 text-left transition hover:bg-[var(--brand-panel)]",
          toneClassName(tone),
        ].join(" ")}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={["rounded-2xl border p-3", toneClassName(tone)].join(" ")}>
      {content}
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
