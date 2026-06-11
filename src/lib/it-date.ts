export function isoToItDate(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function normalizeItDateDraft(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseStrictIsoDateToIso(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const dt = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(dt.getTime())) return null;
  const roundTrip = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return roundTrip === iso ? iso : null;
}

export function parseStrictItDateToIso(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const dd = match[1];
  const mm = match[2];
  const yyyy = match[3];
  return parseStrictIsoDateToIso(`${yyyy}-${mm}-${dd}`);
}
