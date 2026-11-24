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

export type CaseWindowHighlight = "reported_day" | "window_7d" | "none";

function extractIsoDateTokens(raw?: string | null): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const out: string[] = [];
  // Match YYYY-MM-DD
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    out.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  // Match dd/mm/yyyy
  for (const m of s.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)) {
    out.push(`${m[3]}-${m[2]}-${m[1]}`);
  }
  return out;
}

function isoDateToUtcDayMs(isoDate: string): number {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Determine row highlight level for an IP event relative to case reported_date(s):
 * - "reported_day": event_local falls on the exact reported date (day diff === 0) -> light red
 * - "window_7d": event_local is within ±3 days of reported date (or case_window_match === 1) -> yellow
 * - "none": outside window
 */
export function getCaseWindowHighlight(
  eventLocal?: string | null,
  reportedDate?: string | null,
  caseWindowMatch?: number | boolean | null
): CaseWindowHighlight {
  const evDates = extractIsoDateTokens(eventLocal);
  const repDates = extractIsoDateTokens(reportedDate);
  if (evDates.length > 0 && repDates.length > 0) {
    const evMs = isoDateToUtcDayMs(evDates[0]);
    if (Number.isFinite(evMs)) {
      let withinWindow = false;
      for (const rd of repDates) {
        if (rd === evDates[0]) return "reported_day";
        const repMs = isoDateToUtcDayMs(rd);
        if (Number.isFinite(repMs)) {
          const diffDays = Math.abs(evMs - repMs) / 86_400_000;
          if (diffDays <= 3) withinWindow = true;
        }
      }
      if (withinWindow) return "window_7d";
    }
  }
  return caseWindowMatch ? "window_7d" : "none";
}

export const TRUE_DTAC_20D_NOTE = "TRUE/DTAC ข้อมูลเกิน 20 วัน";

export function isTrueDtacOver20dResult(result?: string | null): boolean {
  return String(result ?? "").includes(TRUE_DTAC_20D_NOTE);
}


