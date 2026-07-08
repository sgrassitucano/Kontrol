"use client";

// Cruscotto KPI formazione — due pannelli affiancati BASE | OPERATIVI.
// Ogni tile = un bucket worst-wins a livello lavoratore (mutuamente esclusivo).
// Conteggio = lavoratori distinti; % = su totale azienda (tutti i lavoratori attivi).
// Click tile → filtra la tabella sottostante.

export type DashboardWorkerBuckets = {
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
  withProgrammatoSubcount: Record<"bloccato" | "scaduto" | "daFare" | "upgrade" | "inScadenza", number>;
};

export type DashboardBucketKey = Exclude<keyof DashboardWorkerBuckets, "withProgrammatoSubcount">;
export type DashboardCategory = "base" | "operativi";

type Tone = "danger" | "amber" | "yellow" | "blue" | "green" | "grey";

type TileDef = {
  key: DashboardBucketKey;
  label: string;
  hint: string;
  tone: Tone;
};

// Tile "primo rosso" diverso per categoria: BASE usa "Da fare", OPERATIVI usa "Bloccato".
const BASE_TILES: TileDef[] = [
  { key: "scaduto", label: "Scaduto", hint: "Formazione base scaduta (o persa).", tone: "danger" },
  { key: "daFare", label: "Da fare", hint: "Formazione base mai svolta.", tone: "danger" },
  { key: "inScadenza", label: "In scadenza", hint: "Base valida ma in scadenza entro la soglia.", tone: "amber" },
  { key: "upgrade", label: "Upgrade", hint: "Livello specifica inferiore a quello richiesto dalla matrice.", tone: "yellow" },
  { key: "programmato", label: "Programmato", hint: "Corso base pianificato.", tone: "blue" },
  { key: "conforme", label: "Conforme", hint: "Tutti i corsi base dovuti sono validi.", tone: "green" },
];

const OPERATIVI_TILES: TileDef[] = [
  { key: "bloccato", label: "Bloccato", hint: "Corso valido ma un prerequisito è scaduto/mancante: il lavoratore non può operare.", tone: "danger" },
  { key: "scaduto", label: "Scaduto", hint: "Corso operativo scaduto (o perso).", tone: "danger" },
  { key: "inScadenza", label: "In scadenza", hint: "Operativo valido ma in scadenza entro la soglia.", tone: "amber" },
  { key: "upgrade", label: "Upgrade", hint: "Livello inferiore a quello richiesto (es. antincendio).", tone: "yellow" },
  { key: "programmato", label: "Programmato", hint: "Corso operativo pianificato.", tone: "blue" },
  { key: "conforme", label: "Conforme", hint: "Tutti i corsi operativi dovuti sono validi.", tone: "green" },
];

const TONE_CLASS: Record<Tone, { base: string; active: string }> = {
  danger: { base: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100", active: "ring-2 ring-red-400" },
  amber: { base: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100", active: "ring-2 ring-amber-400" },
  yellow: { base: "border-yellow-200 bg-yellow-50 text-yellow-800 hover:bg-yellow-100", active: "ring-2 ring-yellow-400" },
  blue: { base: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100", active: "ring-2 ring-sky-400" },
  green: { base: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100", active: "ring-2 ring-emerald-400" },
  grey: { base: "border-slate-200 bg-slate-50 text-slate-600", active: "" },
};

function pct(count: number, total: number) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function Tile({
  def,
  count,
  total,
  programmatoSubcount,
  isActive,
  onClick,
}: {
  def: TileDef;
  count: number;
  total: number;
  programmatoSubcount?: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const tone = TONE_CLASS[def.tone];
  const muted = count === 0;
  return (
    <button
      type="button"
      data-unstyled="true"
      onClick={onClick}
      title={def.hint}
      className={[
        "flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition",
        muted ? TONE_CLASS.grey.base : tone.base,
        isActive ? tone.active : "",
      ].join(" ")}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide">{def.label}</span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums">{count}</span>
        <span className="text-xs font-medium opacity-70 tabular-nums">{pct(count, total)}%</span>
      </span>
      {programmatoSubcount ? (
        <span
          className="mt-0.5 text-[10px] font-medium opacity-70"
          title="Di questi, quanti hanno già l'aggiornamento specifico pianificato."
        >
          di cui {programmatoSubcount} programmati
        </span>
      ) : null}
    </button>
  );
}

function Panel({
  title,
  tiles,
  buckets,
  total,
  category,
  activeCategory,
  activeBucket,
  onSelect,
}: {
  title: string;
  tiles: TileDef[];
  buckets: DashboardWorkerBuckets;
  total: number;
  category: DashboardCategory;
  activeCategory: DashboardCategory | null;
  activeBucket: DashboardBucketKey | null;
  onSelect: (category: DashboardCategory, bucket: DashboardBucketKey | null) => void;
}) {
  const conformi = buckets.conforme;
  const obbligati =
    buckets.scaduto +
    buckets.daFare +
    buckets.bloccato +
    buckets.inScadenza +
    buckets.upgrade +
    buckets.programmato +
    buckets.conforme +
    buckets.escluso +
    buckets.sospeso;

  return (
    <div className="rounded-xl border border-[var(--brand-line)] bg-white p-3">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <button
          type="button"
          data-unstyled="true"
          onClick={() => onSelect(category, null)}
          className={[
            "text-sm font-bold text-[var(--brand-ink)] transition hover:text-[var(--brand-primary)]",
            activeCategory === category && activeBucket === null ? "underline decoration-2 underline-offset-4" : "",
          ].join(" ")}
          title="Mostra tutti i corsi di questa categoria"
        >
          {title}
        </button>
        <span className="text-xs text-slate-500">
          Obbligati: <span className="font-semibold text-slate-700 tabular-nums">{obbligati}</span> · Conformi:{" "}
          <span className="font-semibold text-emerald-600 tabular-nums">{conformi}</span>{" "}
          ({pct(conformi, total)}%)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((def) => (
          <Tile
            key={def.key}
            def={def}
            count={buckets[def.key]}
            total={total}
            programmatoSubcount={
              def.key === "bloccato" || def.key === "scaduto" || def.key === "daFare" || def.key === "upgrade" || def.key === "inScadenza"
                ? buckets.withProgrammatoSubcount[def.key]
                : undefined
            }
            isActive={activeCategory === category && activeBucket === def.key}
            onClick={() => onSelect(category, def.key)}
          />
        ))}
      </div>

      {buckets.senzaObbligo > 0 || buckets.escluso > 0 || buckets.sospeso > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          {buckets.senzaObbligo > 0 ? (
            <span title="Lavoratori senza alcun corso dovuto in questa categoria.">
              Senza obbligo: <span className="font-semibold tabular-nums">{buckets.senzaObbligo}</span>
            </span>
          ) : null}
          {buckets.escluso > 0 ? (
            <button
              type="button"
              data-unstyled="true"
              onClick={() => onSelect(category, "escluso")}
              className="hover:text-[var(--brand-primary)]"
              title="Lavoratori con tutti i corsi dovuti esclusi manualmente."
            >
              Esclusi: <span className="font-semibold tabular-nums">{buckets.escluso}</span>
            </button>
          ) : null}
          {buckets.sospeso > 0 ? (
            <span title="Lavoratori in sospensione (congedo, ecc.).">
              Sospesi: <span className="font-semibold tabular-nums">{buckets.sospeso}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DashboardKpi({
  baseBuckets,
  operativiBuckets,
  total,
  activeCategory,
  activeBucket,
  onSelect,
}: {
  baseBuckets: DashboardWorkerBuckets;
  operativiBuckets: DashboardWorkerBuckets;
  total: number;
  activeCategory: DashboardCategory | null;
  activeBucket: DashboardBucketKey | null;
  onSelect: (category: DashboardCategory, bucket: DashboardBucketKey | null) => void;
}) {
  return (
    <div className="grid gap-3 2xl:grid-cols-2">
      <Panel
        title="Base"
        tiles={BASE_TILES}
        buckets={baseBuckets}
        total={total}
        category="base"
        activeCategory={activeCategory}
        activeBucket={activeBucket}
        onSelect={onSelect}
      />
      <Panel
        title="Operativi"
        tiles={OPERATIVI_TILES}
        buckets={operativiBuckets}
        total={total}
        category="operativi"
        activeCategory={activeCategory}
        activeBucket={activeBucket}
        onSelect={onSelect}
      />
    </div>
  );
}
