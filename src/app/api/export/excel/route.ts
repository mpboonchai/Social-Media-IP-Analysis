import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { buildEventWhereClause } from "@/lib/events-query";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const maxRows = Math.min(25000, Math.max(100, Number(sp.get("max_rows") || 10000)));
  const sheetMode = sp.get("sheet") || "all"; // "all" | "scammers"

  const { whereSql, params } = buildEventWhereClause({
    search: (sp.get("search") || "").trim() || undefined,
    platform: (sp.get("platform") || "").trim() || undefined,
    event_type: (sp.get("event_type") || "").trim() || undefined,
    country: (sp.get("country") || "").trim() || undefined,
    network: (sp.get("network") || "").trim() || undefined,
    request_status: (sp.get("request_status") || "").trim() || undefined,
    date_from: (sp.get("date_from") || "").trim() || undefined,
    date_to: (sp.get("date_to") || "").trim() || undefined,
    reported_from: (sp.get("reported_from") || "").trim() || undefined,
    reported_to: (sp.get("reported_to") || "").trim() || undefined,
    scammer_only: sp.get("scammer_only") === "true",
    case_window_only: sp.get("case_window_only") === "true",
  });

  const pool = getPool();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Social Media IP Analysis V2 (ACSC-CIB-TCSD)";
  wb.created = new Date();

  if (sheetMode !== "scammers") {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT
         LOWER(HEX(e.record_key)) AS record_key,
         DATE_FORMAT(e.event_local, '%Y-%m-%d %H:%i:%s') AS local_time,
         DATE_FORMAT(e.event_utc, '%Y-%m-%d %H:%i:%s') AS utc_at,
         e.platform,
         e.event_type,
         e.it_no,
         sa.target_id,
         e.inst_id,
         e.tpo_code,
         e.scammer_case,
         e.reported_date,
         e.team,
         sa.account_name AS account,
         sa.meta_account_type,
         e.page_admin,
         e.meta_actor_display,
         INET6_NTOA(e.ip_bin) AS ip,
         e.port,
         e.ip_type,
         COALESCE(r.network_name, '') AS network,
         COALESCE(r.owner_name, '') AS owner,
         COALESCE(r.country, '') AS country,
         COALESCE(r.from_ip, '') AS from_ip,
         COALESCE(r.to_ip, '') AS to_ip,
         e.source_zip,
         e.source_pdf,
         COALESCE(t.unavailable, 0) AS unavailable,
         COALESCE(t.requested, 0) AS requested,
         COALESCE(t.replied, 0) AS replied,
         COALESCE(t.received, 0) AS received,
         COALESCE(t.no_ip_request_needed, 0) AS no_ip_request_needed,
         COALESCE(t.letter_number, '') AS letter_number,
         COALESCE(t.result, '') AS result,
         COALESCE(t.entity_name, '') AS entity_name,
         COALESCE(t.entity_phone, '') AS entity_phone,
         COALESCE(t.entity_email, '') AS entity_email,
         COALESCE(t.entity_address, '') AS entity_address
       FROM ip_events e
       JOIN social_accounts sa ON sa.id = e.account_id
       LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id
       LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
       ${whereSql}
       ORDER BY e.id DESC
       LIMIT ?`,
      [...params, maxRows]
    );

    const ws = wb.addWorksheet("IP Events");
    ws.columns = [
      { header: "record_key", key: "record_key", width: 22 },
      { header: "เวลา UTC+7", key: "local_time", width: 20 },
      { header: "เวลา UTC", key: "utc_at", width: 20 },
      { header: "แพลตฟอร์ม", key: "platform", width: 12 },
      { header: "ประเภทเหตุการณ์", key: "event_type", width: 16 },
      { header: "IT No.", key: "it_no", width: 14 },
      { header: "Target ID", key: "target_id", width: 20 },
      { header: "INST ID", key: "inst_id", width: 14 },
      { header: "TPO code", key: "tpo_code", width: 18 },
      { header: "เคส Scammer", key: "scammer_case", width: 13 },
      { header: "วันที่รับแจ้ง", key: "reported_date", width: 14 },
      { header: "ทีม", key: "team", width: 12 },
      { header: "บัญชี", key: "account", width: 30 },
      { header: "ประเภทบัญชี Meta", key: "meta_account_type", width: 16 },
      { header: "Page Admin", key: "page_admin", width: 22 },
      { header: "Meta Actor", key: "meta_actor_display", width: 22 },
      { header: "IP", key: "ip", width: 18 },
      { header: "Port", key: "port", width: 8 },
      { header: "IP Type", key: "ip_type", width: 12 },
      { header: "เครือข่าย (ISP)", key: "network", width: 24 },
      { header: "Owner / ISP Detail", key: "owner", width: 28 },
      { header: "ประเทศ (RDAP)", key: "country", width: 16 },
      { header: "From IP", key: "from_ip", width: 16 },
      { header: "To IP", key: "to_ip", width: 16 },
      { header: "Source ZIP", key: "source_zip", width: 24 },
      { header: "Source PDF/HTML", key: "source_pdf", width: 24 },
      { header: "ขอข้อมูลไม่ได้", key: "unavailable", width: 13 },
      { header: "ขอข้อมูลแล้ว", key: "requested", width: 13 },
      { header: "ตอบกลับแล้ว", key: "replied", width: 13 },
      { header: "ได้รับข้อมูลแล้ว", key: "received", width: 14 },
      { header: "ไม่ต้องขอ IP", key: "no_ip_request_needed", width: 13 },
      { header: "เลขหนังสือ", key: "letter_number", width: 22 },
      { header: "ผลลัพธ์ / หมายเหตุ", key: "result", width: 28 },
      { header: "ชื่อผู้จดทะเบียน / Entity", key: "entity_name", width: 24 },
      { header: "เบอร์โทร", key: "entity_phone", width: 16 },
      { header: "อีเมล Entity", key: "entity_email", width: 22 },
      { header: "ที่อยู่ Entity", key: "entity_address", width: 30 },
    ];

    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF05112B" } };
      cell.font = { bold: true, color: { argb: "FFFFD000" } };
    });
    ws.autoFilter = { from: "A1", to: "AK1" };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    for (const r of rows) {
      ws.addRow(r);
    }
  }

  // Sheet 2: Scammer Cases (matching url_cases_(Scammer).xlsx)
  const [caseRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       inst_id, data_id, tracking_code,
       DATE_FORMAT(reported_date, '%Y-%m-%d') AS heppen_date,
       team, platform, platform_url, account_name,
       tracking_status, replied_at, tpo_code, note, response_account
     FROM cases
     ORDER BY id DESC`
  );

  const wsCases = wb.addWorksheet("เคส Scammers");
  wsCases.columns = [
    { header: "inst_id", key: "inst_id", width: 14 },
    { header: "data_id", key: "data_id", width: 14 },
    { header: "tracking_code", key: "tracking_code", width: 18 },
    { header: "heppen_date", key: "heppen_date", width: 14 },
    { header: "team", key: "team", width: 12 },
    { header: "platform", key: "platform", width: 14 },
    { header: "platform_url", key: "platform_url", width: 42 },
    { header: "account_name", key: "account_name", width: 28 },
    { header: "tracking_status", key: "tracking_status", width: 18 },
    { header: "replied_at", key: "replied_at", width: 18 },
    { header: "เลขหนังสือ / TPO", key: "tpo_code", width: 20 },
    { header: "note", key: "note", width: 28 },
    { header: "response_account", key: "response_account", width: 24 },
  ];
  wsCases.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF05112B" } };
    cell.font = { bold: true, color: { argb: "FFFFD000" } };
  });
  wsCases.autoFilter = { from: "A1", to: "M1" };
  wsCases.views = [{ state: "frozen", ySplit: 1 }];
  for (const c of caseRows) {
    wsCases.addRow(c);
  }

  const outBuf = await wb.xlsx.writeBuffer();
  const dateTag = new Date().toISOString().slice(0, 10);
  const fname = sheetMode === "scammers" ? `scammer_cases_${dateTag}.xlsx` : `social_media_ip_filtered_${dateTag}.xlsx`;

  return new NextResponse(Buffer.from(outBuf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
