import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { hexToBuffer32, ipToBuffer } from "@/lib/ip-utils";
import { parseMetaZip } from "@/lib/parsers/meta";
import { parseTikTokZip } from "@/lib/parsers/tiktok";
import { lookupOrFetchRdap } from "@/lib/rdap/lookup";
import { invalidateEventsStatsCache } from "@/lib/events-cache";
import {
  extractTargetFromUrl,
  isWithinReportedWindow,
  normalizeSocialUrl,
} from "@/lib/matching/scammer-cases";

interface DbCaseLite {
  inst_id: string;
  reported_date: string;
  team: string;
  platform: string;
  platform_url: string;
  normalized_url: string;
  resolved_url: string;
  account_name: string;
  tpo_code: string;
  response_account: string;
}

function matchDbCasesForAccount(
  cases: DbCaseLite[],
  platform: string,
  account: string,
  targetId: string,
  accountIdentifier: string
): DbCaseLite[] {
  const tokens = new Set(
    [
      account,
      targetId,
      accountIdentifier,
      normalizeSocialUrl(account),
      extractTargetFromUrl(account),
    ]
      .map((s) => String(s || "").trim().toLowerCase().replace(/^@/, ""))
      .filter((s) => s.length >= 2)
  );
  if (!tokens.size) return [];

  const platNorm = platform.toLowerCase();
  return cases.filter((c) => {
    const cp = c.platform.toLowerCase();
    if (platNorm === "tiktok" && cp && !cp.includes("tiktok")) return false;
    if ((platNorm === "facebook" || platNorm === "instagram") && cp.includes("tiktok")) return false;
    const cTokens = [
      c.account_name,
      c.response_account,
      c.normalized_url,
      extractTargetFromUrl(c.platform_url),
      extractTargetFromUrl(c.resolved_url),
    ]
      .map((s) => String(s || "").trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    return cTokens.some((ct) => tokens.has(ct));
  });
}

function toMysqlDt(iso: string): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return null;
  return `${m[1]} ${m[2]}.${(m[3] || "000").padEnd(3, "0")}`;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const platformHint = String(form.get("platform_hint") || "auto").trim();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "no_files" }, { status: 400 });

  const pool = getPool();

  // Load existing Scammer cases once for auto-correlation
  const [caseRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT inst_id, DATE_FORMAT(reported_date, '%Y-%m-%d') AS reported_date,
            team, platform, platform_url, normalized_url, resolved_url, account_name, tpo_code, response_account
     FROM cases`
  );
  const allCases: DbCaseLite[] = caseRows.map((c) => ({
    inst_id: String(c.inst_id || ""),
    reported_date: String(c.reported_date || ""),
    team: String(c.team || ""),
    platform: String(c.platform || ""),
    platform_url: String(c.platform_url || ""),
    normalized_url: String(c.normalized_url || ""),
    resolved_url: String(c.resolved_url || ""),
    account_name: String(c.account_name || ""),
    tpo_code: String(c.tpo_code || ""),
    response_account: String(c.response_account || ""),
  }));

  const summary: Array<{
    filename: string;
    platform: string;
    parser_used: string;
    status: string;
    records: number;
    unique_ips: number;
    scammer_matched: number;
    error?: string;
  }> = [];

  for (const file of files) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const shaHex = crypto.createHash("sha256").update(buf).digest("hex");
      const shaBuf = Buffer.from(shaHex, "hex");

      const [existing] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id, import_status, platform, record_count FROM upload_batches WHERE sha256 = ? LIMIT 1`,
        [shaBuf]
      );
      if (existing.length && existing[0].import_status === "processed") {
        summary.push({
          filename: file.name,
          platform: String(existing[0].platform || "Unknown"),
          parser_used: "cached",
          status: "skipped_duplicate",
          records: Number(existing[0].record_count || 0),
          unique_ips: 0,
          scammer_matched: 0,
        });
        continue;
      }

      const zip = await JSZip.loadAsync(buf);
      const names = Object.keys(zip.files).map((n) => n.replace(/\\/g, "/"));
      const hasMetaHtml = names.some((n) => /(^|\/)records?\.html$/i.test(n) || /preservation/i.test(n));
      const isMeta =
        platformHint === "META"
          ? true
          : platformHint === "TikTok"
          ? false
          : hasMetaHtml;

      const platform = isMeta ? "META" : "TikTok";
      const parserUsed = isMeta ? "META (Facebook / Instagram HTML+ZIP)" : "TikTok (PDF/HTML/Text+ZIP)";

      await pool.execute(
        `INSERT INTO upload_batches (sha256, platform, filename, file_size, import_status, uploaded_by)
         VALUES (?, ?, ?, ?, 'processing', ?)
         ON DUPLICATE KEY UPDATE import_status = 'processing', platform = VALUES(platform)`,
        [shaBuf, platform, file.name.slice(0, 255), buf.length, user.id]
      );

      const [batchRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM upload_batches WHERE sha256 = ? LIMIT 1`,
        [shaBuf]
      );
      const batchId = Number(batchRows[0].id);

      const parsed = isMeta ? await parseMetaZip(buf, file.name) : await parseTikTokZip(buf, file.name);
      if (!parsed.length) {
        await pool.execute(
          `UPDATE upload_batches SET import_status = 'failed', error_message = 'no_records_parsed' WHERE id = ?`,
          [batchId]
        );
        summary.push({
          filename: file.name,
          platform,
          parser_used: parserUsed,
          status: "failed",
          records: 0,
          unique_ips: 0,
          scammer_matched: 0,
          error: "ไม่พบรายการ IP หรือโครงสร้างไฟล์ไม่ตรงกับแพลตฟอร์มที่เลือก",
        });
        continue;
      }

      // Ensure social account exists
      const first = parsed[0];
      const accIdentifier = (first.account_identifier || first.account || first.target_id || file.name).slice(0, 255);
      await pool.execute(
        `INSERT INTO social_accounts (platform, account_identifier, account_name, target_id, it_no, meta_account_type)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           target_id = IF(VALUES(target_id) <> '', VALUES(target_id), target_id),
           it_no = IF(VALUES(it_no) <> '', VALUES(it_no), it_no),
           meta_account_type = IF(VALUES(meta_account_type) <> '', VALUES(meta_account_type), meta_account_type)`,
        [
          first.platform,
          accIdentifier,
          first.account.slice(0, 255),
          first.target_id.slice(0, 100),
          first.it_no.slice(0, 100),
          first.meta_account_type,
        ]
      );
      const [accRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM social_accounts WHERE platform = ? AND account_identifier = ? LIMIT 1`,
        [first.platform, accIdentifier]
      );
      const accountId = Number(accRows[0].id);

      // Match against Scammer cases
      const matchedCases = matchDbCasesForAccount(
        allCases,
        first.platform,
        first.account,
        first.target_id,
        first.account_identifier
      );
      const instIds = [...new Set(matchedCases.map((c) => c.inst_id).filter(Boolean))].join(" / ").slice(0, 100);
      const tpoCodes = [...new Set(matchedCases.map((c) => c.tpo_code).filter(Boolean))].join(" / ").slice(0, 100);
      const reportedDates = [...new Set(matchedCases.map((c) => c.reported_date).filter(Boolean))];
      const reportedDateStr = reportedDates.join(" / ").slice(0, 100);
      const teams = [...new Set(matchedCases.map((c) => c.team).filter(Boolean))].join(" / ").slice(0, 100);
      const scammerCaseLabel = matchedCases.length > 0 ? "Scammer" : "";

      // Match RDAP from cache or auto-fetch external RDAP for unique IPs
      const uniqueIps = [...new Set(parsed.map((r) => r.ip).filter(Boolean))];
      const ipRdapMap = new Map<string, number | null>();
      let ipCursor = 0;
      const runRdapWorker = async () => {
        while (ipCursor < uniqueIps.length) {
          const ip = uniqueIps[ipCursor++];
          const id = await lookupOrFetchRdap(pool, ip);
          ipRdapMap.set(ip, id);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, uniqueIps.length) }, runRdapWorker));

      const values: unknown[][] = [];
      for (const r of parsed) {
        const ipParsed = ipToBuffer(r.ip);
        const rdapId = r.ip ? (ipRdapMap.get(r.ip) ?? null) : null;
        const localDt = toMysqlDt(r.local);
        const evMs = r.local ? Date.parse(r.local) : NaN;
        const windowMatch =
          reportedDates.length > 0 && Number.isFinite(evMs)
            ? reportedDates.some((rd) => isWithinReportedWindow(evMs, rd))
              ? 1
              : 0
            : 0;

        values.push([
          hexToBuffer32(r.record_key),
          batchId,
          accountId,
          rdapId,
          r.platform,
          r.event_type.slice(0, 100),
          toMysqlDt(r.utc),
          localDt,
          ipParsed ? ipParsed.buf : null,
          ipParsed ? ipParsed.version : null,
          r.port,
          "",
          r.page_admin.slice(0, 255),
          r.meta_actor_display.slice(0, 255),
          r.tiktok_country.slice(0, 100),
          r.it_no.slice(0, 100),
          instIds,
          tpoCodes,
          scammerCaseLabel,
          reportedDateStr,
          teams,
          windowMatch,
          r.source_zip.slice(0, 255),
          r.source_pdf.slice(0, 255),
          r.source_no,
          r.no_ip_data ? 1 : 0,
        ]);
      }

      // Chunked insert (1,000 rows per batch) for TiDB Serverless reliability
      for (let i = 0; i < values.length; i += 1000) {
        const chunk = values.slice(i, i + 1000);
        await pool.query(
          `INSERT IGNORE INTO ip_events (
             record_key, upload_batch_id, account_id, rdap_network_id, platform, event_type,
             event_utc, event_local, ip_bin, ip_version, port, ip_type, page_admin,
             meta_actor_display, tiktok_country, it_no, inst_id, tpo_code, scammer_case,
             reported_date, team, case_window_match, source_zip, source_pdf, source_no, no_ip_data
           ) VALUES ?`,
          [chunk]
        );
      }

      await pool.execute(
        `UPDATE upload_batches SET import_status = 'processed', record_count = ?, completed_at = NOW() WHERE id = ?`,
        [parsed.length, batchId]
      );
      summary.push({
        filename: file.name,
        platform,
        parser_used: parserUsed,
        status: "processed",
        records: parsed.length,
        unique_ips: uniqueIps.length,
        scammer_matched: matchedCases.length,
      });
    } catch (err) {
      summary.push({
        filename: file.name,
        platform: platformHint === "auto" ? "Unknown" : platformHint,
        parser_used: platformHint,
        status: "failed",
        records: 0,
        unique_ips: 0,
        scammer_matched: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  invalidateEventsStatsCache();
  return NextResponse.json({ ok: true, results: summary });
}
