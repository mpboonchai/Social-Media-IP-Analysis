import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { buildEventWhereClause, toCsv } from "@/lib/events-query";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const maxRows = Math.min(100_000, Math.max(100, Number(sp.get("max_rows") || 50_000)));

  const { whereSql, params } = buildEventWhereClause({
    search: (sp.get("search") || "").trim(),
    platform: (sp.get("platform") || "").trim(),
    event_type: (sp.get("event_type") || "").trim(),
    country: (sp.get("country") || "").trim(),
    network: (sp.get("network") || "").trim(),
    request_status: (sp.get("request_status") || "").trim(),
    date_from: (sp.get("date_from") || "").trim(),
    date_to: (sp.get("date_to") || "").trim(),
    scammer_only: sp.get("scammer_only") === "true",
    case_window_only: sp.get("case_window_only") === "true",
  });

  const baseFrom = `
    FROM ip_events e
    JOIN social_accounts sa ON sa.id = e.account_id
    LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id
    LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
  `;

  const pool = getPool();

  const [eventRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       e.platform, e.it_no, sa.target_id, e.inst_id, e.tpo_code, e.scammer_case,
       e.reported_date, e.team, sa.account_name AS account, sa.account_identifier,
       sa.meta_account_type, e.meta_actor_display, e.page_admin, e.event_type,
       DATE_FORMAT(e.event_utc, '%Y-%m-%dT%H:%i:%sZ') AS utc_at,
       DATE_FORMAT(e.event_local, '%Y-%m-%d %H:%i:%s') AS local_time,
       INET6_NTOA(e.ip_bin) AS ip, e.ip_version, e.ip_type, e.port, e.tiktok_country,
       e.source_zip, e.source_pdf, e.source_no, LOWER(HEX(e.record_key)) AS record_key,
       COALESCE(r.country, '') AS country, COALESCE(r.network_name, '') AS network,
       COALESCE(r.owner_name, '') AS owner, COALESCE(r.from_ip, '') AS from_ip,
       COALESCE(r.to_ip, '') AS to_ip, e.no_ip_data,
       COALESCE(t.unavailable, 0) AS unavailable, COALESCE(t.requested, 0) AS requested,
       COALESCE(t.replied, 0) AS replied, COALESCE(t.received, 0) AS received,
       COALESCE(t.no_ip_request_needed, 0) AS no_ip_request_needed,
       COALESCE(t.letter_number, '') AS letter_number, COALESCE(t.result, '') AS result,
       COALESCE(t.entity_user_id, '') AS entity_user_id, COALESCE(t.entity_name, '') AS entity_name,
       COALESCE(t.entity_country, '') AS entity_country, COALESCE(t.entity_address, '') AS entity_address,
       COALESCE(t.entity_email, '') AS entity_email, COALESCE(t.entity_phone, '') AS entity_phone,
       COALESCE(t.entity_payment, '') AS entity_payment, COALESCE(t.entity_account_no, '') AS entity_account_no
     ${baseFrom} ${whereSql}
     ORDER BY e.id DESC
     LIMIT ?`,
    [...params, maxRows]
  );

  const [accountRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       e.platform, sa.account_name AS account, sa.account_identifier,
       sa.target_id, sa.meta_account_type,
       COUNT(*) AS event_count,
       COUNT(DISTINCT e.ip_bin) AS unique_ips,
       SUM(CASE WHEN e.no_ip_data = 1 THEN 1 ELSE 0 END) AS no_ip_files,
       MIN(DATE_FORMAT(e.event_local, '%Y-%m-%d %H:%i:%s')) AS first_seen,
       MAX(DATE_FORMAT(e.event_local, '%Y-%m-%d %H:%i:%s')) AS last_seen
     ${baseFrom} ${whereSql}
     GROUP BY e.platform, sa.id
     ORDER BY event_count DESC`,
    params
  );

  const [caseRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       inst_id, tracking_code, DATE_FORMAT(reported_date, '%Y-%m-%d') AS reported_date,
       team, platform, platform_url, account_name, scammer_case,
       tracking_status, replied_at, tpo_code, note, source_filename, source_row
     FROM cases
     ORDER BY id DESC`
  );

  const accountCsv = toCsv(
    ["ลำดับ", "Platform", "บัญชี", "Account Identifier", "Target ID", "ประเภทบัญชี Meta", "จำนวนเหตุการณ์", "IP ไม่ซ้ำ", "ไฟล์ไม่มีข้อมูล IP", "พบครั้งแรก UTC+7", "พบล่าสุด UTC+7"],
    accountRows.map((r, i) => [
      i + 1, r.platform, r.account, r.account_identifier, r.target_id, r.meta_account_type,
      r.event_count, r.unique_ips, r.no_ip_files, r.first_seen, r.last_seen,
    ])
  );

  const eventsCsv = toCsv(
    [
      "Platform", "IT No.", "Target ID", "INST ID", "TPO code", "เคส Scammer", "วันที่รับแจ้ง", "ทีม",
      "Account", "Account Identifier", "ประเภทบัญชี Meta", "ผู้ใช้/แอดมิน ณ เวลา", "แอดมินเพจ",
      "Event Type", "เวลา UTC", "เวลา UTC+7", "IP", "IP Version", "ประเภท IP", "Port", "Platform Country",
      "Source ZIP", "Source PDF", "Source No.", "Record Key", "Country", "Network Name", "Owner Name",
      "From IP", "To IP", "ไม่มีข้อมูล IP", "ขอข้อมูลไม่ได้", "ขอข้อมูลแล้ว", "ตอบกลับแล้ว", "ได้รับข้อมูลแล้ว",
      "ไม่ต้องขอข้อมูล IP", "เลขหนังสือ", "ผลลัพธ์", "User ID", "Name", "Entity Country", "Address",
      "Email", "Phone", "Payment", "Account No.",
    ],
    eventRows.map((r) => [
      r.platform, r.it_no, r.target_id, r.inst_id, r.tpo_code, r.scammer_case, r.reported_date, r.team,
      r.account, r.account_identifier, r.meta_account_type, r.meta_actor_display, r.page_admin,
      r.event_type, r.utc_at, r.local_time, r.ip, r.ip_version ? `IPv${r.ip_version}` : "", r.ip_type, r.port, r.tiktok_country,
      r.source_zip, r.source_pdf, r.source_no, r.record_key, r.country, r.network, r.owner,
      r.from_ip, r.to_ip, r.no_ip_data ? "TRUE" : "FALSE", r.unavailable ? "TRUE" : "FALSE",
      r.requested ? "TRUE" : "FALSE", r.replied ? "TRUE" : "FALSE", r.received ? "TRUE" : "FALSE",
      r.no_ip_request_needed ? "TRUE" : "FALSE", r.letter_number, r.result,
      r.entity_user_id, r.entity_name, r.entity_country, r.entity_address,
      r.entity_email, r.entity_phone, r.entity_payment, r.entity_account_no,
    ])
  );

  const casesCsv = toCsv(
    ["INST ID", "Tracking Code", "วันที่รับแจ้ง", "ทีม", "Platform", "URL จากฐานคดี", "Account Name", "Scammer", "Tracking Status", "Replied At", "TPO code", "Note", "Source File", "Source Row"],
    caseRows.map((r) => [
      r.inst_id, r.tracking_code, r.reported_date, r.team, r.platform, r.platform_url, r.account_name,
      r.scammer_case, r.tracking_status, r.replied_at, r.tpo_code, r.note, r.source_filename, r.source_row,
    ])
  );

  const zip = new JSZip();
  zip.file("บัญชีทั้งหมด.csv", accountCsv);
  zip.file("IP Events.csv", eventsCsv);
  zip.file("ฐานคดี INST-TPO.csv", casesCsv);
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 3 } });
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(zipBuf), {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="Social_Media_IP_Analysis_CSV_${dateStr}.zip"`,
      "cache-control": "no-store",
    },
  });
}
