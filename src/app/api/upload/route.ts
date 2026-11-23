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
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "no_files" }, { status: 400 });

  const pool = getPool();
  const summary: Array<{ filename: string; status: string; records: number; error?: string }> = [];

  for (const file of files) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const shaHex = crypto.createHash("sha256").update(buf).digest("hex");
      const shaBuf = Buffer.from(shaHex, "hex");

      const [existing] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id, import_status FROM upload_batches WHERE sha256 = ? LIMIT 1`,
        [shaBuf]
      );
      if (existing.length && existing[0].import_status === "processed") {
        summary.push({ filename: file.name, status: "skipped_duplicate", records: 0 });
        continue;
      }

      const zip = await JSZip.loadAsync(buf);
      const names = Object.keys(zip.files).map((n) => n.replace(/\\/g, "/"));
      const isMeta = names.some((n) => /(^|\/)records?\.html$/i.test(n));
      const platform = isMeta ? "META" : "TikTok";

      await pool.execute(
        `INSERT INTO upload_batches (sha256, platform, filename, file_size, import_status, uploaded_by)
         VALUES (?, ?, ?, ?, 'processing', ?)
         ON DUPLICATE KEY UPDATE import_status = 'processing'`,
        [shaBuf, platform, file.name.slice(0, 255), buf.length, user.id]
      );

      const [batchRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM upload_batches WHERE sha256 = ? LIMIT 1`,
        [shaBuf]
      );
      const batchId = Number(batchRows[0].id);

      const parsed = isMeta ? await parseMetaZip(buf, file.name) : await parseTikTokZip(buf, file.name);

      // Ensure social account exists
      const first = parsed[0];
      const accIdentifier = (first.account_identifier || first.account || first.target_id || file.name).slice(0, 255);
      await pool.execute(
        `INSERT INTO social_accounts (platform, account_identifier, account_name, target_id, it_no, meta_account_type)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           target_id = IF(VALUES(target_id) <> '', VALUES(target_id), target_id),
           it_no = IF(VALUES(it_no) <> '', VALUES(it_no), it_no)`,
        [first.platform, accIdentifier, first.account.slice(0, 255), first.target_id.slice(0, 100), first.it_no.slice(0, 100), first.meta_account_type]
      );
      const [accRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM social_accounts WHERE platform = ? AND account_identifier = ? LIMIT 1`,
        [first.platform, accIdentifier]
      );
      const accountId = Number(accRows[0].id);

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

        values.push([
          hexToBuffer32(r.record_key),
          batchId,
          accountId,
          rdapId,
          r.platform,
          r.event_type.slice(0, 100),
          toMysqlDt(r.utc),
          toMysqlDt(r.local),
          ipParsed ? ipParsed.buf : null,
          ipParsed ? ipParsed.version : null,
          r.port,
          "",
          r.page_admin.slice(0, 255),
          r.meta_actor_display.slice(0, 255),
          r.tiktok_country.slice(0, 100),
          r.it_no.slice(0, 100),
          r.source_zip.slice(0, 255),
          r.source_pdf.slice(0, 255),
          r.source_no,
          r.no_ip_data ? 1 : 0,
        ]);
      }

      if (values.length) {
        await pool.query(
          `INSERT IGNORE INTO ip_events (
             record_key, upload_batch_id, account_id, rdap_network_id, platform, event_type,
             event_utc, event_local, ip_bin, ip_version, port, ip_type, page_admin,
             meta_actor_display, tiktok_country, it_no, source_zip, source_pdf, source_no, no_ip_data
           ) VALUES ?`,
          [values]
        );
      }

      await pool.execute(
        `UPDATE upload_batches SET import_status = 'processed', record_count = ?, completed_at = NOW() WHERE id = ?`,
        [parsed.length, batchId]
      );
      summary.push({ filename: file.name, status: "processed", records: parsed.length });
    } catch (err) {
      summary.push({
        filename: file.name,
        status: "failed",
        records: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, results: summary });
}
