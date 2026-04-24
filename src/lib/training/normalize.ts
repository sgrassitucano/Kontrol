export function normalizeJobCode(value: string) {
  return value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\./, "")
    .replace(/\.$/, "");
}
