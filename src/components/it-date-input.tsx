"use client";

import { useEffect, useMemo, useState } from "react";
import { isoToItDate, normalizeItDateDraft, parseStrictItDateToIso } from "@/lib/it-date";

export function ItDateInput(props: {
  valueIso: string;
  onChangeIso: (valueIso: string) => void;
  onValidityChange?: (isInvalid: boolean) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(() => isoToItDate(props.valueIso));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraft(isoToItDate(props.valueIso));
  }, [editing, props.valueIso]);

  const parsedIso = useMemo(() => parseStrictItDateToIso(draft), [draft]);
  const isInvalid = !!draft.trim() && !parsedIso;

  useEffect(() => {
    props.onValidityChange?.(isInvalid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInvalid]);

  return (
    <input
      value={draft}
      inputMode="numeric"
      placeholder={props.placeholder ?? "gg/mm/aaaa"}
      disabled={props.disabled}
      aria-invalid={isInvalid ? "true" : undefined}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        const normalized = normalizeItDateDraft(draft);
        setDraft(normalized);
        const iso = parseStrictItDateToIso(normalized);
        if (iso) props.onChangeIso(iso);
        if (!normalized.trim()) props.onChangeIso("");
      }}
      onChange={(e) => {
        const normalized = normalizeItDateDraft(e.target.value);
        setDraft(normalized);
        const iso = parseStrictItDateToIso(normalized);
        if (iso) props.onChangeIso(iso);
        if (!normalized.trim()) props.onChangeIso("");
      }}
      className={[
        props.className ?? "",
        isInvalid ? "border-red-600 focus:border-red-600 focus:ring-red-600" : "",
      ].join(" ")}
    />
  );
}

