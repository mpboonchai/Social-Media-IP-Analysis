import JSZip from "jszip";
import { extractText } from "unpdf";
import { sha256Hex } from "../ip-utils";
import type { ParsedIpEvent } from "./meta";

async function extractPdfText(entry: JSZip.JSZipObject): Promise<string> {
  const raw = await entry.async("uint8array");
  // Copy into a standalone Uint8Array so pdf.js never reads outside bounds of a shared ArrayBuffer slab
  const clean = new Uint8Array(raw.byteLength);
  clean.set(raw);
  const { text } = await extractText(clean, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

function toLocalIsoPlus7(utcIso: string): string {
  return new Date(new Date(utcIso).getTime() + 7 * 3600_000).toISOString().slice(0, -1) + "+07:00";
}

function parseTikTokDate(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[4]) % 12;
  if (match[7].toUpperCase() === "PM") hour += 12;
  return new Date(
    Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hour, Number(match[5]), Number(match[6]))
  ).toISOString();
}

function normalizeTikTokPdfText(value: string): string {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/U\s*s\s*e\s*r\s*n\s*a\s*m\s*e/gi, "Username")
    .replace(/U\s*s\s*e\s*r(?=\s+(?:login|logout)\s+(?:time|IP|country):)/gi, "User");
}

function computeRecordKey(row: Omit<ParsedIpEvent, "record_key">): string {
  return sha256Hex(
    [
      row.platform,
      row.account,
      row.page_admin || "",
      row.event_type,
      row.utc,
      row.ip,
      row.port ?? "",
      row.source_zip,
      row.source_pdf,
      row.source_no,
    ].join("\u001f")
  );
}

export async function parseTikTokZip(buffer: Buffer | Uint8Array, filename: string): Promise<ParsedIpEvent[]> {
  const zip = await JSZip.loadAsync(buffer);
  const allPdfs = Object.values(zip.files).filter((item) => !item.dir && /\.pdf$/i.test(item.name));
  if (!allPdfs.length) throw new Error(`${filename}: ไม่พบไฟล์ PDF ในชุดข้อมูล TikTok`);

  const entries = allPdfs.filter(
    (item) => /(^|\/)App\/.*\.pdf$/i.test(item.name) && /(IPSessionHistory|LoginLogoutHistory)/i.test(item.name)
  );
  const topFolders = [
    ...new Set(
      Object.keys(zip.files)
        .map((name) => name.replace(/\\/g, "/").split("/")[0])
        .filter((name) => name && name !== "__MACOSX")
    ),
  ];
  const sourceZip = topFolders.find((name) => /^\d{8,}$/.test(name)) || topFolders[0] || filename;
  const targetId = /^\d{8,}$/.test(sourceZip)
    ? sourceZip
    : allPdfs.map((item) => item.name.split("/")[0]).find((val) => /^\d{8,}$/.test(val)) || "";

  let account = filename.replace(/\.zip$/i, "").replace(/_part_.*$/i, "").replace(/-\(\d+\)$/i, "");
  const bsiEntry = allPdfs.find((item) => /(^|\/)Profile\/BSI\.pdf$/i.test(item.name));
  if (bsiEntry) {
    const rawBsi = await extractPdfText(bsiEntry);
    const bsiText = normalizeTikTokPdfText(rawBsi);
    const matchUser = bsiText.match(/Username\s*[:\n\r ]+([^\r\n]+)/i)?.[1]?.replace(/\s+/g, "").trim();
    if (matchUser) account = matchUser;
  }

  const rows: ParsedIpEvent[] = [];

  for (const entry of entries) {
    const rawText = await extractPdfText(entry);
    const text = normalizeTikTokPdfText(rawText);
    const sourcePdf = entry.name.split("/").pop() || entry.name;
    let sourceNo = 0;

    if (/IPSessionHistory/i.test(sourcePdf)) {
      const pattern =
        /Date:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}(?:AM|PM))\s*\(UTC\s*\+00\)[\s\S]*?IP:\s*([0-9A-Fa-f:.]+)[\s\S]*?IP Port:\s*(\d+)[\s\S]*?Country:\s*([^\r\n]+)/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        const utc = parseTikTokDate(match[1].toUpperCase());
        if (!utc) continue;
        sourceNo += 1;
        const base: Omit<ParsedIpEvent, "record_key"> = {
          platform: "TikTok",
          platform_group: "TikTok",
          account,
          account_identifier: "",
          meta_account_type: "",
          meta_actor_display: "",
          page_admin: "",
          target_id: targetId,
          it_no: "",
          event_type: "IP Session",
          utc,
          local: toLocalIsoPlus7(utc),
          ip: match[2],
          port: Number(match[3]),
          tiktok_country: match[4].trim(),
          source_zip: sourceZip,
          source_pdf: sourcePdf,
          source_no: sourceNo,
          no_ip_data: false,
          no_ip_request_needed: false,
        };
        rows.push({ ...base, record_key: computeRecordKey(base) });
      }
    } else {
      const pattern =
        /User\s+(login|logout)\s+time:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}(?:AM|PM))\s*\(UTC\s*\+00\)[\s\S]*?User\s+\1\s+IP:\s*([0-9A-Fa-f:.]+)[\s\S]*?User\s+\1\s+country:\s*([^\r\n]+)/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        const utc = parseTikTokDate(match[2].toUpperCase());
        if (!utc) continue;
        sourceNo += 1;
        const base: Omit<ParsedIpEvent, "record_key"> = {
          platform: "TikTok",
          platform_group: "TikTok",
          account,
          account_identifier: "",
          meta_account_type: "",
          meta_actor_display: "",
          page_admin: "",
          target_id: targetId,
          it_no: "",
          event_type: match[1].toLowerCase() === "login" ? "Login" : "Logout",
          utc,
          local: toLocalIsoPlus7(utc),
          ip: match[3],
          port: null,
          tiktok_country: match[4].trim(),
          source_zip: sourceZip,
          source_pdf: sourcePdf,
          source_no: sourceNo,
          no_ip_data: false,
          no_ip_request_needed: false,
        };
        rows.push({ ...base, record_key: computeRecordKey(base) });
      }
    }
  }

  if (!rows.length) {
    const base: Omit<ParsedIpEvent, "record_key"> = {
      platform: "TikTok",
      platform_group: "TikTok",
      account,
      account_identifier: "",
      meta_account_type: "",
      meta_actor_display: "",
      page_admin: "",
      target_id: targetId,
      it_no: "",
      event_type: "ไฟล์ที่ได้รับไม่มีข้อมูล IP",
      utc: "",
      local: "",
      ip: "",
      port: null,
      tiktok_country: "",
      source_zip: sourceZip,
      source_pdf: (entries.length ? entries : allPdfs).map((i) => i.name.split("/").pop()).join(", "),
      source_no: 0,
      no_ip_data: true,
      no_ip_request_needed: true,
    };
    rows.push({ ...base, record_key: computeRecordKey(base) });
  }

  return rows;
}
