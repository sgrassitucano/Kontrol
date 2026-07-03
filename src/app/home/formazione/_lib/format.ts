// Helper puri di formattazione data/testo per la pagina formazione. Nessuno stato.
// Copiati verbatim da page.tsx: non alterare la logica senza verificarla contro l'originale.

export function isoToItDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatDateIt(value: string | null) {
  if (!value) return "-";
  return isoToItDate(value);
}

export function isoToMonthYear(value: string | null) {
  if (!value) return "(vuoto)";
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (!match) return "(vuoto)";
  return `${match[2]}/${match[1]}`;
}

export function monthYearSortKey(value: string) {
  const match = value.match(/^(\d{2})\/(\d{4})$/);
  if (!match) return -1;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (!Number.isFinite(month) || !Number.isFinite(year)) return -1;
  return year * 12 + month;
}

export function capitalizeFirst(value: string) {
  const v = String(value ?? "").trim();
  if (!v) return v;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function matchText(value: string, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) return true;
  const normalizedValue = value.toLowerCase();
  if (normalizedValue.includes(normalizedFilter)) return true;
  const formattedValue = isoToItDate(value).toLowerCase();
  if (formattedValue !== normalizedValue && formattedValue.includes(normalizedFilter)) return true;
  return false;
}

export function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchSearchQuery(parts: Array<string | null | undefined>, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText(parts.filter(Boolean).join(" "));
  if (!haystack) return false;
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

export function matchTextTokens(value: string, filter: string) {
  const tokens = filter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = String(value ?? "").toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

export function todayLocalIso() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatIsoToItDate(iso: string) {
  const match = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function normalizeItDateDraft(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseStrictItDateToIso(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const dd = match[1];
  const mm = match[2];
  const yyyy = match[3];
  const iso = `${yyyy}-${mm}-${dd}`;
  const dt = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(dt.getTime())) return null;
  const roundTrip = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return roundTrip === iso ? iso : null;
}

export function getDefaultSimulationDate() {
  return todayLocalIso();
}

export function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function downloadCsvFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
