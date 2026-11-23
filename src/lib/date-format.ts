/**
 * Format YYYY-MM-DD (or multi-date "YYYY-MM-DD / YYYY-MM-DD") into dd/mm/yyyy.
 */
export function formatDateDMY(raw?: string | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  return s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
}

/**
 * Format "YYYY-MM-DD HH:mm:ss" or ISO datetime into "dd/mm/yyyy HH:mm:ss".
 */
export function formatDateTimeDMY(raw?: string | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]} ${m[4]}`;
  }
  return formatDateDMY(s);
}
