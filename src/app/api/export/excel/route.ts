import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { buildEventWhereClause } from "@/lib/events-query";
import { getCaseWindowHighlight } from "@/lib/date-format";

function computeStatusLabel(r: Record<string, unknown>): string {
  if (Number(r.no_ip_data)) return "ไม่มีข้อมูล IP";
  if (Number(r.unavailable)) return "ขอข้อมูลไม่ได้";
  if (Number(r.received)) return "ได้รับข้อมูลแล้ว";
  if (Number(r.no_ip_request_needed)) return "ไม่ต้องขอข้อมูล IP";
  if (Number(r.replied)) return "ตอบกลับแล้ว";
  if (Number(r.requested)) return "ขอข้อมูลแล้ว";
  return "ยังไม่ดำเนินการ";
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const maxRows = Math.min(25000, Math.max(100, Number(sp.get("max_rows") || 10000)));
  const sheetMode = sp.get("sheet") || "all";

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
         e.platform,
         e.it_no,
         sa.target_id,
         e.inst_id,
         e.tpo_code,
         e.scammer_case,
         e.reported_date,
         e.team,
         sa.account_name AS account,
         sa.account_identifier,
         sa.meta_account_type,
         e.meta_actor_display,
         e.page_admin,
         e.event_type,
         DATE_FORMAT(e.event_utc, '%Y-%m-%d %H:%i:%s') AS utc_at,
         DATE_FORMAT(e.event_local, '%Y-%m-%d %H:%i:%s') AS local_time,
         INET6_NTOA(e.ip_bin) AS ip,
         IF(e.ip_version = 6, 'IPv6', IF(e.ip_version = 4, 'IPv4', '')) AS ip_version_label,
         e.ip_type,
         e.port,
         e.tiktok_country,
         e.source_zip,
         e.source_pdf,
         e.source_no,
         LOWER(HEX(e.record_key)) AS record_key,
         COALESCE(r.country, '') AS country,
         COALESCE(r.network_name, '') AS network,
         COALESCE(r.owner_name, '') AS owner,
         COALESCE(r.from_ip, '') AS from_ip,
         COALESCE(r.to_ip, '') AS to_ip,
         e.no_ip_data,
         COALESCE(t.unavailable, 0) AS unavailable,
         COALESCE(t.requested, 0) AS requested,
         COALESCE(t.replied, 0) AS replied,
         COALESCE(t.received, 0) AS received,
         COALESCE(t.no_ip_request_needed, 0) AS no_ip_request_needed,
         COALESCE(t.letter_number, '') AS letter_number,
         COALESCE(t.result, '') AS result,
         COALESCE(t.entity_user_id, '') AS entity_user_id,
         COALESCE(t.entity_name, '') AS entity_name,
         COALESCE(t.entity_country, '') AS entity_country,
         COALESCE(t.entity_address, '') AS entity_address,
         COALESCE(t.entity_email, '') AS entity_email,
         COALESCE(t.entity_phone, '') AS entity_phone,
         COALESCE(t.entity_payment, '') AS entity_payment,
         COALESCE(t.entity_account_no, '') AS entity_account_no,
         COALESCE(t.access_service, '') AS access_service,
         COALESCE(t.access_datetime_local, '') AS access_datetime_local,
         COALESCE(t.access_ip, '') AS access_ip,
         COALESCE(t.access_remote_port, '') AS access_remote_port,
         COALESCE(t.access_ip_country, '') AS access_ip_country,
         COALESCE(t.access_network, '') AS access_network,
         COALESCE(t.access_isp, '') AS access_isp,
         COALESCE(t.updated_by, '') AS updated_by,
         DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         e.case_window_match
       FROM ip_events e
       JOIN social_accounts sa ON sa.id = e.account_id
       LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id
       LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
       ${whereSql}
       ORDER BY e.id DESC
       LIMIT ?`,
      [...params, maxRows]
    );

    // Exact 57 columns matching Social_Media_IP_Analysis-Ex.xlsx (Sheet: IP Events)
    const ws = wb.addWorksheet("IP Events");
    ws.columns = [
      { header: "Platform", key: "platform", width: 12 },
      { header: "IT No.", key: "it_no", width: 14 },
      { header: "Target ID", key: "target_id", width: 20 },
      { header: "INST ID", key: "inst_id", width: 14 },
      { header: "TPO code", key: "tpo_code", width: 18 },
      { header: "เคส Scammer", key: "scammer_case", width: 13 },
      { header: "วันที่รับแจ้ง", key: "reported_date", width: 14 },
      { header: "ทีม", key: "team", width: 12 },
      { header: "Account", key: "account", width: 28 },
      { header: "Account Identifier", key: "account_identifier", width: 28 },
      { header: "ประเภทบัญชี Meta", key: "meta_account_type", width: 16 },
      { header: "ผู้ใช้/แอดมิน ณ เวลา", key: "meta_actor_display", width: 22 },
      { header: "แอดมินเพจ (หลักฐานดิบ)", key: "page_admin", width: 22 },
      { header: "Event Type", key: "event_type", width: 16 },
      { header: "เวลา UTC", key: "utc_at", width: 20 },
      { header: "เวลา UTC+7", key: "local_time", width: 20 },
      { header: "IP", key: "ip", width: 18 },
      { header: "IP Version", key: "ip_version_label", width: 11 },
      { header: "ประเภท IP", key: "ip_type", width: 12 },
      { header: "Port", key: "port", width: 8 },
      { header: "Platform Country", key: "tiktok_country", width: 15 },
      { header: "Source ZIP", key: "source_zip", width: 24 },
      { header: "Source PDF", key: "source_pdf", width: 24 },
      { header: "Source No.", key: "source_no", width: 11 },
      { header: "Record Key", key: "record_key", width: 24 },
      { header: "Country", key: "country", width: 15 },
      { header: "Network Name", key: "network", width: 24 },
      { header: "Owner Name", key: "owner", width: 28 },
      { header: "From IP", key: "from_ip", width: 16 },
      { header: "To IP", key: "to_ip", width: 16 },
      { header: "ไม่มีข้อมูล IP", key: "no_ip_data", width: 12 },
      { header: "ขอข้อมูลไม่ได้", key: "unavailable", width: 13 },
      { header: "ขอข้อมูลแล้ว", key: "requested", width: 13 },
      { header: "ตอบกลับแล้ว", key: "replied", width: 13 },
      { header: "ได้รับข้อมูลแล้ว", key: "received", width: 14 },
      { header: "ไม่ต้องขอข้อมูล IP", key: "no_ip_request_needed", width: 15 },
      { header: "สถานะ", key: "status_label", width: 16 },
      { header: "เลขหนังสือ", key: "letter_number", width: 22 },
      { header: "ผลลัพธ์", key: "result", width: 28 },
      { header: "User ID", key: "entity_user_id", width: 18 },
      { header: "Name", key: "entity_name", width: 24 },
      { header: "Entity Country", key: "entity_country", width: 15 },
      { header: "Address", key: "entity_address", width: 28 },
      { header: "Email", key: "entity_email", width: 22 },
      { header: "Phone", key: "entity_phone", width: 16 },
      { header: "Payment", key: "entity_payment", width: 20 },
      { header: "Account No.", key: "entity_account_no", width: 20 },
      { header: "Service", key: "access_service", width: 16 },
      { header: "Access DateTime (UTC+7)", key: "access_datetime_local", width: 22 },
      { header: "Access IP", key: "access_ip", width: 18 },
      { header: "Remote port", key: "access_remote_port", width: 12 },
      { header: "Access IP Country", key: "access_ip_country", width: 16 },
      { header: "Access Network", key: "access_network", width: 22 },
      { header: "Access ISP", key: "access_isp", width: 22 },
      { header: "Updated By", key: "updated_by", width: 14 },
      { header: "Updated At", key: "updated_at", width: 20 },
      { header: "ใกล้วันรับแจ้ง", key: "case_window_match", width: 13 },
    ];

    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF05112B" } };
      cell.font = { bold: true, color: { argb: "FFFFD000" } };
    });
    ws.autoFilter = { from: "A1", to: "BE1" };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const fillReportedDay: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFDE2E2" },
    };
    const fillWindow7d: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFF3BF" },
    };

    for (const r of rows) {
      const excelRow = ws.addRow({
        ...r,
        status_label: computeStatusLabel(r),
      });
      const hl = getCaseWindowHighlight(
        r.local_time ? String(r.local_time) : null,
        r.reported_date ? String(r.reported_date) : null,
        r.case_window_match
      );
      if (hl === "reported_day") {
        excelRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = fillReportedDay;
        });
      } else if (hl === "window_7d") {
        excelRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = fillWindow7d;
        });
      }
    }
  }

  // Sheet 2: URL Cases Scammer (exact match with url_cases_(Scammer).xlsx)
  const [caseRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       inst_id, data_id, tracking_code,
       DATE_FORMAT(reported_date, '%Y-%m-%d') AS heppen_date,
       team, platform, platform_url, account_name,
       tracking_status, replied_at, tpo_code, note, response_account
     FROM cases
     ORDER BY id DESC`
  );

  const wsCases = wb.addWorksheet("URL Cases Scammer");
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
    { header: "เลขหนังสือ", key: "tpo_code", width: 20 },
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
  const fname = sheetMode === "scammers" ? `url_cases_scammer_${dateTag}.xlsx` : `Social_Media_IP_Analysis_${dateTag}.xlsx`;

  return new NextResponse(Buffer.from(outBuf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
