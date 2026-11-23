import ExcelJS from "exceljs";
import { sha256Hex } from "../ip-utils";

export interface ScammerCaseRow {
  source_id: string;
  inst_id: string;
  data_id: string;
  tracking_code: string;
  reported_date: string | null;
  team: string;
  platform: "TikTok" | "Facebook" | "Instagram" | "Other";
  platform_url: string;
  normalized_url: string;
  account_name: string;
  tracking_status: string;
  replied_at: string;
  tpo_code: string;
  note: string;
  source_filename: string;
  source_row: number;
}

const DAY_MS = 86_400_000;

export function normalizeSocialUrl(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host.includes("facebook.com") && u.pathname.includes("profile.php")) {
      const id = u.searchParams.get("id");
      return id ? `facebook.com/profile.php?id=${id}` : `${host}${u.pathname}`;
    }
    return `${host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

export function extractTargetFromUrl(raw: string): string {
  const norm = normalizeSocialUrl(raw);
  const idMatch = norm.match(/[?&]id=(\d+)/);
  if (idMatch) return idMatch[1];
  const parts = norm.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[1].replace(/^@/, "") : "";
}

export function isWithinReportedWindow(eventUtcOrLocalMs: number, reportedDateYmd: string): boolean {
  if (!Number.isFinite(eventUtcOrLocalMs) || !/^\d{4}-\d{2}-\d{2}$/.test(reportedDateYmd)) return false;
  const boundary = Date.parse(`${reportedDateYmd}T00:00:00+07:00`);
  return Number.isFinite(boundary) && eventUtcOrLocalMs >= boundary - 3 * DAY_MS && eventUtcOrLocalMs < boundary + 4 * DAY_MS;
}

export async function parseScammerCasesXlsx(buffer: Buffer | ArrayBuffer, filename = "url_cases (Scammer).xlsx"): Promise<ScammerCaseRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("ไม่พบ Worksheet ในไฟล์ Excel");

  const headerMap = new Map<string, number>();
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    const key = String(cell.value ?? "").trim().toLowerCase();
    if (key) headerMap.set(key, colNumber);
  });

  const col = (row: ExcelJS.Row, ...names: string[]): string => {
    for (const n of names) {
      const idx = headerMap.get(n.toLowerCase());
      if (idx) {
        const val = row.getCell(idx).value;
        if (val instanceof Date) return val.toISOString().slice(0, 10);
        if (val && typeof val === "object" && "text" in val) return String((val as { text: string }).text).trim();
        return String(val ?? "").trim();
      }
    }
    return "";
  };

  const results: ScammerCaseRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const inst_id = col(row, "inst_id");
    const tracking_code = col(row, "tracking_code");
    const platform_url = col(row, "platform_url");
    if (!inst_id && !tracking_code && !platform_url) return;

    const platRaw = col(row, "platform").toLowerCase();
    const platform: ScammerCaseRow["platform"] = platRaw.includes("facebook")
      ? "Facebook"
      : platRaw.includes("instagram")
      ? "Instagram"
      : platRaw.includes("tiktok")
      ? "TikTok"
      : "Other";

    const rawDate = col(row, "heppen_date", "reported_date").slice(0, 10);
    const reported_date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
    const tpo_code = col(row, "เลขหนังสือ", "tpo_code") || tracking_code;

    results.push({
      source_id: sha256Hex(`${inst_id}|${tracking_code}|${platform_url}|${rowNumber}`),
      inst_id,
      data_id: col(row, "data_id"),
      tracking_code,
      reported_date,
      team: col(row, "team"),
      platform,
      platform_url,
      normalized_url: normalizeSocialUrl(platform_url),
      account_name: col(row, "account_name"),
      tracking_status: col(row, "tracking_status"),
      replied_at: col(row, "replied_at"),
      tpo_code,
      note: col(row, "note"),
      source_filename: filename,
      source_row: rowNumber,
    });
  });

  return results;
}
