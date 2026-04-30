"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ComboboxOption = {
  id: string;
  label: string;
  meta?: string;
};

export function Combobox(props: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => props.options.find((o) => o.id === props.value) ?? null, [props.options, props.value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter((o) => {
      const hay = `${o.label} ${o.meta ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [props.options, query]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, query]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const displayValue = open ? query : selected?.label ?? "";

  function choose(opt: ComboboxOption) {
    props.onChange(opt.id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        value={displayValue}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onFocus={() => {
          if (props.disabled) return;
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          if (props.disabled) return;
          setOpen(true);
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            setOpen(true);
            setQuery("");
            return;
          }
          if (!open) return;
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(0, i - 1));
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const opt = filtered[activeIndex];
            if (opt) choose(opt);
          }
        }}
        className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-50"
      />

      {open ? (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-[var(--brand-line)] bg-white shadow-lg">
          <div className="max-h-64 overflow-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-500">Nessun risultato</div>
            ) : (
              filtered.map((opt, idx) => {
                const isActive = idx === activeIndex;
                const isSelected = opt.id === props.value;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => choose(opt)}
                    className={[
                      "flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm",
                      isActive ? "bg-[var(--brand-panel)]" : "bg-white",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">{opt.label}</div>
                      {opt.meta ? <div className="truncate text-xs text-slate-500">{opt.meta}</div> : null}
                    </div>
                    {isSelected ? <div className="text-xs font-bold text-[var(--brand-primary)]">OK</div> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

