"use client";

// Tile KPI condivisa tra formazione e sorveglianza sanitaria: stesso linguaggio
// visivo (colore per gravità, conteggio + %, clic per filtrare) in tutti i moduli.

export type KpiTileTone = "danger" | "amber" | "yellow" | "blue" | "green" | "grey";

export const KPI_TONE_CLASS: Record<KpiTileTone, { base: string; active: string }> = {
  danger: { base: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100", active: "ring-2 ring-red-400" },
  amber: { base: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100", active: "ring-2 ring-amber-400" },
  yellow: { base: "border-yellow-200 bg-yellow-50 text-yellow-800 hover:bg-yellow-100", active: "ring-2 ring-yellow-400" },
  blue: { base: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100", active: "ring-2 ring-sky-400" },
  green: { base: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100", active: "ring-2 ring-emerald-400" },
  grey: { base: "border-slate-200 bg-slate-50 text-slate-600", active: "" },
};

export function kpiPercentage(count: number, total: number) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

export function KpiTile({
  label,
  hint,
  tone,
  count,
  total,
  subLabel,
  isActive,
  onClick,
}: {
  label: string;
  hint?: string;
  tone: KpiTileTone;
  count: number;
  total: number;
  subLabel?: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const toneCls = KPI_TONE_CLASS[tone];
  const muted = count === 0;
  return (
    <button
      type="button"
      data-unstyled="true"
      onClick={onClick}
      title={hint}
      className={[
        "flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition",
        muted ? KPI_TONE_CLASS.grey.base : toneCls.base,
        isActive ? toneCls.active : "",
      ].join(" ")}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums">{count}</span>
        <span className="text-xs font-medium opacity-70 tabular-nums">{kpiPercentage(count, total)}%</span>
      </span>
      {subLabel ? <span className="mt-0.5 text-[10px] font-medium opacity-70">{subLabel}</span> : null}
    </button>
  );
}
