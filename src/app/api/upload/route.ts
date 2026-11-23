import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { hexToBuffer32, ipToBuffer } from "@/lib/ip-utils";
import { parseMetaZip } from "@/lib/parsers/meta";
import { parseTikTokZip } from "@/lib/parsers/tiktok";
import { batchResolveRdap } from "@/lib/rdap/lookup";
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

const CASES_CACHE_TTL_MS = 2 * 60_000;
const globalCasesCache = globalThis as unknown as {
  uploadCasesIndex?: Map<string, DbCaseLite[]>;
  uploadCasesLoadedAt?: number;
};

async function getCasesTokenIndex(pool: mysql.Pool): Promise<Map<string, DbCaseLite[]>> {
  const now = Date.now();
  if (
    globalCasesCache.uploadCasesIndex &&
    globalCasesCache.uploadCasesLoadedAt &&
    now - globalCasesCache.uploadCasesLoadedAt < CASES_CACHE_TTL_MS
  ) {
    return globalCasesCache.uploadCasesIndex;
  }

  const [caseRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT inst_id, DATE_FORMAT(reported_date, '%Y-%m-%d') AS reported_date,
            team, platform, platform_url, normalized_url, resolved_url, account_name, tpo_code, response_account
     FROM cases`
  );

  const tokenIndex = new Map<string, DbCaseLite[]>();
  const addToken = (raw: string, c: DbCaseLite) => {
    const t = String(raw || "").trim().toLowerCase().replace(/^@/, "");
    if (t.length < 2) return;
    let arr = tokenIndex.get(t);
    if (!arr) {
      arr = [];
      tokenIndex.set(t, arr);
    }
    arr.push(c);
  };

  for (const r of caseRows) {
    const c: DbCaseLite = {
      inst_id: String(r.inst_id || ""),
      reported_date: String(r.reported_date || ""),
      team: String(r.team || ""),
      platform: String(r.platform || ""),
      platform_url: String(r.platform_url || ""),
      normalized_url: String(r.normalized_url || ""),
      resolved_url: String(r.resolved_url || ""),
      account_name: String(r.account_name || ""),
      tpo_code: String(r.tpo_code || ""),
      response_account: String(r.response_account || ""),
    };
    addToken(c.account_name, c);
    addToken(c.response_account, c);
    addToken(c.normalized_url, c);
    addToken(extractTargetFromUrl(c.platform_url), c);
    addToken(extractTargetFromUrl(c.resolved_url), c);
  }

  globalCasesCache.uploadCasesIndex = tokenIndex;
  globalCasesCache.uploadCasesLoadedAt = now;
  return tokenIndex;
}

function matchFromTokenIndex(
  tokenIndex: Map<string, DbCaseLite[]>,
  platform: string,
  account: string,
  targetId: string,
  accountIdentifier: string
): DbCaseLite[] {
  const tokens = [
    account,
    targetId,
    accountIdentifier,
    normalizeSocialUrl(account),
    extractTargetFromUrl(account),
  ]
    .map((s) => String(s || "").trim().toLowerCase().replace(/^@/, ""))
    .filter((s) => s.length >= 2);

  const platNorm = platform.toLowerCase();
  const matched = new Set<DbCaseLite>();
  for (const t of tokens) {
    const hits = tokenIndex.get(t);
    if (!hits) continue;
    for (const c of hits) {
      const cp = c.platform.toLowerCase();
      if (platNorm === "tiktok" && cp && !cp.includes("tiktok")) continue;
      if ((platNorm === "facebook" || platNorm === "instagram") && cp.includes("tiktok")) continue;
      matched.add(c);
    }
  }
  return Array.from(matched);
}

function toMysqlDt(iso: string): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return null;
  return `${m[1]} ${m[2]}.${(m[3] || "000").padEnd(3, "0")}`;
}

/**
 * Canonical semantic event fingerprint for exact deduplication across ANY ZIP file:
 * (platform + account_id + event_local(second) + ip + port)
 */
function semanticFingerprint(localMysqlDt: string | null, ip: string, port: number | null): string {
  const sec = localMysqlDt ? localMysqlDt.slice(0, 19) : "";
  const normIp = String(ip || "").trim().toLowerCase();
  const normPort = port !== null && port !== undefined ? String(port) : "";
  return `${sec}|${normIp}|${normPort}`;
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
  const casesTokenIndex = await getCasesTokenIndex(pool);

  const summary: Array<{
    filename: string;
    platform: string;
    parser_used: string;
    status: string;
    records: number;
    inserted_new?: number;
    skipped_duplicates?: number;
    unique_ips: number;
    rdap_cache_hits?: number;
    rdap_external_fetched?: number;
    scammer_matched: number;
    error?: string;
  }> = [];

  for (const file of files) {
    let batchId: number | null = null;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const shaHex = crypto.createHash("sha256").update(buf).digest("hex");
      const shaBuf = Buffer.from(shaHex, "hex");

      // Layer 1 Deduplication: Exact file SHA-256 check
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
          inserted_new: 0,
          skipped_duplicates: Number(existing[0].record_count || 0),
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
         ON DUPLICATE KEY UPDATE import_status = 'processing', error_message = NULL, platform = VALUES(platform)`,
        [shaBuf, platform, file.name.slice(0, 255), buf.length, user.id]
      );

      const [batchRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM upload_batches WHERE sha256 = ? LIMIT 1`,
        [shaBuf]
      );
      batchId = Number(batchRows[0].id);

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

      // Ensure social account exists — also check existing accounts by account_name (e.g. Excel-imported TikTok URLs)
      const first = parsed[0];
      const accIdentifier = (first.account_identifier || first.account || first.target_id || file.name).slice(0, 255);
      const accNameClean = first.account.slice(0, 255);

      const [matchedAccRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id, account_identifier FROM social_accounts
         WHERE platform = ? AND (account_identifier = ? OR (account_name <> '' AND account_name = ?))
         ORDER BY (account_identifier = ?) DESC, id ASC`,
        [first.platform, accIdentifier, accNameClean, accIdentifier]
      );

      let accountId: number;
      const relatedAccountIds: number[] = matchedAccRows.map((r) => Number(r.id));
      if (matchedAccRows.length > 0) {
        accountId = Number(matchedAccRows[0].id);
        await pool.execute(
          `UPDATE social_accounts
           SET target_id = IF(? <> '' AND target_id = '', ?, target_id),
               it_no = IF(? <> '' AND it_no = '', ?, it_no),
               meta_account_type = IF(? <> '' AND meta_account_type = '', ?, meta_account_type)
           WHERE id = ?`,
          [
            first.target_id.slice(0, 100),
            first.target_id.slice(0, 100),
            first.it_no.slice(0, 100),
            first.it_no.slice(0, 100),
            first.meta_account_type,
            first.meta_account_type,
            accountId,
          ]
        );
      } else {
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
            accNameClean,
            first.target_id.slice(0, 100),
            first.it_no.slice(0, 100),
            first.meta_account_type,
          ]
        );
        const [accRows] = await pool.execute<mysql.RowDataPacket[]>(
          `SELECT id FROM social_accounts WHERE platform = ? AND account_identifier = ? LIMIT 1`,
          [first.platform, accIdentifier]
        );
        accountId = Number(accRows[0].id);
        relatedAccountIds.push(accountId);
      }

      // Layer 2 Semantic Deduplication: Load existing (event_local, ip, port) across all matching account_ids
      // so the exact same event (Account + Time + IP + Port) is NEVER duplicated even from a different ZIP!
      const [existingEvRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT DATE_FORMAT(event_local, '%Y-%m-%d %H:%i:%s') AS lt,
                INET6_NTOA(ip_bin) AS ip,
                port
         FROM ip_events
         WHERE account_id IN (?)`,
        [relatedAccountIds]
      );
      const seenFingerprints = new Set<string>();
      for (const er of existingEvRows) {
        const fp = semanticFingerprint(
          er.lt ? String(er.lt) : null,
          er.ip ? String(er.ip) : "",
          er.port !== null && er.port !== undefined ? Number(er.port) : null
        );
        seenFingerprints.add(fp);
      }

      // Filter out semantic duplicates BEFORE doing RDAP lookup (saves time & external API calls!)
      const dedupedParsed: typeof parsed = [];
      let semanticSkipped = 0;
      for (const r of parsed) {
        const localDt = toMysqlDt(r.local);
        if (!r.no_ip_data && r.ip && localDt) {
          const fp = semanticFingerprint(localDt, r.ip, r.port);
          if (seenFingerprints.has(fp)) {
            semanticSkipped++;
            continue;
          }
          seenFingerprints.add(fp);
        }
        dedupedParsed.push(r);
      }

      // Match against cached Scammer cases index (O(1))
      const matchedCases = matchFromTokenIndex(
        casesTokenIndex,
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

      // Ultra-fast RDAP resolution (in-memory CIDR cache -> external fetch only for genuinely new ranges)
      const uniqueIps = [...new Set(dedupedParsed.map((r) => r.ip).filter(Boolean))];
      const { map: ipRdapMap, cacheHits, externalFetched } = await batchResolveRdap(pool, uniqueIps);

      const values: unknown[][] = [];
      for (const r of dedupedParsed) {
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

      // Layer 3 Deduplication: record_key UNIQUE constraint via INSERT IGNORE (chunked 1,000 rows)
      let insertedNew = 0;
      for (let i = 0; i < values.length; i += 1000) {
        const chunk = values.slice(i, i + 1000);
        const [insRes] = await pool.query<mysql.ResultSetHeader>(
          `INSERT IGNORE INTO ip_events (
             record_key, upload_batch_id, account_id, rdap_network_id, platform, event_type,
             event_utc, event_local, ip_bin, ip_version, port, ip_type, page_admin,
             meta_actor_display, tiktok_country, it_no, inst_id, tpo_code, scammer_case,
             reported_date, team, case_window_match, source_zip, source_pdf, source_no, no_ip_data
           ) VALUES ?`,
          [chunk]
        );
        insertedNew += Number(insRes.affectedRows || 0);
      }

      // For files with no IP data (1 placeholder row with no_ip_data = 1), automatically record result = 'ไม่มีข้อมูล'
      const noIpKeys = dedupedParsed.filter((r) => r.no_ip_data).map((r) => hexToBuffer32(r.record_key));
      if (noIpKeys.length > 0) {
        await pool.query(
          `INSERT INTO ip_request_tracking (ip_event_id, result, updated_by)
           SELECT e.id, 'ไม่มีข้อมูล', ?
           FROM ip_events e
           WHERE e.record_key IN (?) AND e.no_ip_data = 1
           ON DUPLICATE KEY UPDATE
             result = IF(COALESCE(result, '') = '', 'ไม่มีข้อมูล', result),
             updated_by = IF(COALESCE(result, '') = '', VALUES(updated_by), updated_by)`,
          [user.username, noIpKeys]
        );
      }

      const skippedDuplicates = semanticSkipped + Math.max(0, dedupedParsed.length - insertedNew);

      await pool.execute(
        `UPDATE upload_batches SET import_status = 'processed', record_count = ?, completed_at = NOW() WHERE id = ?`,
        [insertedNew, batchId]
      );
      summary.push({
        filename: file.name,
        platform,
        parser_used: parserUsed,
        status: "processed",
        records: parsed.length,
        inserted_new: insertedNew,
        skipped_duplicates: skippedDuplicates,
        unique_ips: uniqueIps.length,
        rdap_cache_hits: cacheHits,
        rdap_external_fetched: externalFetched,
        scammer_matched: matchedCases.length,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (batchId !== null) {
        try {
          await pool.execute(
            `UPDATE upload_batches SET import_status = 'failed', error_message = ? WHERE id = ?`,
            [errMsg.slice(0, 500), batchId]
          );
        } catch {
          // ignore secondary DB logging failure
        }
      }
      summary.push({
        filename: file.name,
        platform: platformHint === "auto" ? "Unknown" : platformHint,
        parser_used: platformHint,
        status: "failed",
        records: 0,
        unique_ips: 0,
        scammer_matched: 0,
        error: errMsg,
      });
    }
  }

  invalidateEventsStatsCache();
  return NextResponse.json({ ok: true, results: summary });
}
