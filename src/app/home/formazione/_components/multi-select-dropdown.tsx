"use client";

import { useMemo, useState } from "react";

function toggleMultiSelect<T extends string>(list: T[], value: T) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function MultiSelectDropdown<T extends string>({
  selected,
  options,
  onChange,
  placeholder,
  searchable,
  searchPlaceholder,
}: {
  selected: T[];
  options: Array<{ value: T; label: string }>;
  onChange: (next: T[]) => void;
  placeholder: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const label = useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) {
      const found = options.find((o) => o.value === selected[0]);
      return found?.label ?? selected[0];
    }
    return `${selected.length} selezionati`;
  }, [options, placeholder, selected]);

  return (
    <details className="relative">
      <summary className="w-full list-none rounded border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px] normal-case text-slate-700">
        <span className="block truncate">{label}</span>
      </summary>
      <div className="absolute z-30 mt-1 w-[260px] rounded-xl border border-[var(--brand-line)] bg-white p-2 shadow-lg">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-lg bg-[var(--brand-primary)] px-2 py-1 text-[11px] font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
            disabled={selected.length === 0}
          >
            Pulisci
          </button>
          {searchable ? (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder ?? "Cerca"}
              className="w-full rounded-lg border border-[var(--brand-line)] bg-[var(--brand-panel)] px-2 py-1 text-[11px]"
            />
          ) : null}
        </div>
        <div className="max-h-56 overflow-auto rounded-lg border border-[var(--brand-line)] bg-white">
          {filteredOptions.map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px]">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => onChange(toggleMultiSelect(selected, opt.value))}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1 truncate">{opt.label}</span>
            </label>
          ))}
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-slate-500">Nessun valore</div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
