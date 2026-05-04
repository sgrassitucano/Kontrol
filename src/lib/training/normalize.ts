export function normalizeJobCode(value: string) {
  return value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\./, "")
    .replace(/\.$/, "");
}

export function normalizeFreeTextKey(value: string) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .replace(/_+/g, "_");
}

export function buildJobVariantKey(jobTitle: string, jobTitleNotes: string | null | undefined) {
  const base = normalizeJobCode(jobTitle ?? "");
  const notes = normalizeFreeTextKey(jobTitleNotes ?? "");
  if (!notes) return null;
  if (!base) return notes;
  return `${base}__${notes}`;
}
