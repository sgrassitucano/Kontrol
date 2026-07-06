import { PanelCard } from "@/components/module-ui";

type StatCardProps = {
  label: string;
  value: number;
};

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="rounded-xl border border-[var(--brand-line)] bg-[var(--brand-panel)] p-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}

export type ImportSummaryData = {
  totalRows: number;
  validRows: number;
  matchedEmployees: number;
  missingEmployees: number;
  visitRequiredYes?: number;
  visitRequiredNo?: number;
  dueDateMissing?: number;
  errorRows: number;
};

type ImportSummaryProps = {
  data: ImportSummaryData;
  variant?: "formazione" | "sorveglianza";
};

export function ImportSummary({ data, variant = "sorveglianza" }: ImportSummaryProps) {
  const baseCards = [
    { label: "Righe totali", value: data.totalRows },
    { label: "Valide", value: data.validRows },
    { label: "Associate", value: data.matchedEmployees },
    { label: "Non trovate", value: data.missingEmployees },
  ];

  const variantCards =
    variant === "sorveglianza"
      ? [
          { label: "Visita SI", value: data.visitRequiredYes ?? 0 },
          { label: "Visita NO", value: data.visitRequiredNo ?? 0 },
          { label: "Scadenza mancante", value: data.dueDateMissing ?? 0 },
        ]
      : [];

  const cards = [...baseCards, ...variantCards, { label: "Errori", value: data.errorRows }];

  return (
    <section className={`grid gap-4 ${variant === "sorveglianza" ? "md:grid-cols-4 xl:grid-cols-8" : "md:grid-cols-3 lg:grid-cols-5"}`}>
      {cards.map((card) => (
        <StatCard key={card.label} {...card} />
      ))}
    </section>
  );
}
