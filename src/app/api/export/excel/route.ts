import { PassThrough } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { buildEventWhereClause } from "@/lib/events-query";
import { getCaseWindowHighlight, isTrueDtacOver20dResult } from "@/lib/date-format";
import { ipToBuffer } from "@/lib/ip-utils";

export const maxDuration = 60;

function computeStatusLabel(r: Record<string, unknown>): string {
  if (Number(r.no_ip_data)) return "ไม่มีข้อมูล IP";
  if (Number(r.unavailable)) return "ขอข้อมูลไม่ได้";
  if (Number(r.received)) return "ได้รับข้อมูลแล้ว";
  if (Number(r.no_ip_request_needed)) return "ไม่ต้องขอข้อมูล IP";
  if (Number(r.replied)) return "ตอบกลับแล้ว";
  if (Number(r.requested)) return "ขอข้อมูลแล้ว";
  return "ยังไม่ดำเนินการ";
}

function parseListParam(sp: URLSearchParams, key: string): string[] {
  const raw = (sp.get(key) || "").trim();
  if (!raw) return [];
  return raw
    .split("||")
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const sheetMode = sp.get("sheet") || "all";

  const base = buildEventWhereClause({
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

  const extraWhere: string[] = [];
  const params: unknown[] = [...base.params];

  const addColIn = (expr: string, values: string[]) => {
    if (!values.length) return;
    const normalized = values.map((v) => (v === "(ว่าง)" ? "" : v));
    extraWhere.push(`COALESCE(${expr}, '') IN (${normalized.map(() => "?").join(",")})`);
    params.push(...normalized);
  };

  const colLocalDate = parseListParam(sp, "col_local_date");
  if (colLocalDate.length) {
    const normalized = colLocalDate.map((v) => (v === "(ว่าง)" ? "" : v));
    extraWhere.push(`COALESCE(DATE_FORMAT(e.event_local, '%Y-%m-%d'), '') IN (${normalized.map(() => "?").join(",")})`);
    params.push(...normalized);
  }
  const colPlatform = parseListParam(sp, "col_platform");
  if (colPlatform.length) {
    extraWhere.push(`e.platform IN (${colPlatform.map(() => "?").join(",")})`);
    params.push(...colPlatform);
  }
  addColIn("e.it_no", parseListParam(sp, "col_it_no"));
  addColIn("sa.target_id", parseListParam(sp, "col_target_id"));
  addColIn("e.inst_id", parseListParam(sp, "col_inst_id"));
  addColIn("e.tpo_code", parseListParam(sp, "col_tpo_code"));
  addColIn("e.scammer_case", parseListParam(sp, "col_scammer_case"));
  addColIn("e.reported_date", parseListParam(sp, "col_reported_date"));
  addColIn("e.team", parseListParam(sp, "col_team"));
  addColIn("sa.account_name", parseListParam(sp, "col_account"));
  addColIn("sa.meta_account_type", parseListParam(sp, "col_meta_type"));
  const colIp = parseListParam(sp, "col_ip");
  if (colIp.length) {
    const ipBufs = colIp.map((ip) => ipToBuffer(ip)?.buf).filter((b): b is Buffer => Boolean(b));
    if (ipBufs.length) {
      extraWhere.push(`e.ip_bin IN (${ipBufs.map(() => "?").join(",")})`);
      params.push(...ipBufs);
    }
  }
  addColIn("r.network_name", parseListParam(sp, "col_network"));
  addColIn("r.country", parseListParam(sp, "col_country"));
  addColIn("t.letter_number", parseListParam(sp, "col_letter"));

  const baseConds: string[] = [];
  if (base.whereSql) baseConds.push(base.whereSql.replace(/^WHERE\s+/i, ""));
  if (extraWhere.length) baseConds.push(...extraWhere);

  const pool = getPool();
  const pass = new PassThrough();

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      pass.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      pass.on("end", () => controller.close());
      pass.on("error", (err) => controller.error(err));
    },
    cancel() {
      pass.destroy();
    },
  });

  // Stream workbook generation asynchronously so large exports (40k–200k+ rows) bypass Vercel's 4.5MB buffered limit
  (async () => {
    try {
      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: pass,
        useStyles: true,
        useSharedStrings: false,
      });
      wb.creator = "Social Media IP Analysis V2 (ACSC-CIB-TCSD)";
      wb.created = new Date();

      const headerFill: ExcelJS.Fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF05112B" },
      };
      const headerFont: Partial<ExcelJS.Font> = {
        bold: true,
        color: { argb: "FFFFD000" },
      };
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
      const fillTrueDtac20d: ExcelJS.Fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDBEAFE" },
      };

      if (sheetMode !== "scammers") {
        // Exact 57 columns matching Social_Media_IP_Analysis-Ex.xlsx (Sheet: IP Events)
        const ws = wb.addWorksheet("IP Events", {
          views: [{ state: "frozen", ySplit: 1 }],
        });
        ws.columns = [
          { header: "Platform", key: "platform", width: 12 },
          { header: "IT No.", key: "it_no", width: 14 },
          { header: "Target ID", key: "target_id", width: 20 },
          { header: "Case ID (INST)", key: "inst_id", width: 16 },
          { header: "TPO Code", key: "tpo_code", width: 18 },
          { header: "Scammer Case", key: "scammer_case", width: 14 },
          { header: "วันที่รับแจ้ง", key: "reported_date", width: 15 },
          { header: "Team", key: "team", width: 12 },
          { header: "บัญชี", key: "account", width: 26 },
          { header: "Account Identifier", key: "account_identifier", width: 28 },
          { header: "ประเภทบัญชี Meta", key: "meta_account_type", width: 18 },
          { header: "ชื่อผู้ใช้งาน/ผู้ดูแล Meta", key: "meta_actor_display", width: 22 },
          { header: "Admin Page / Account", key: "page_admin", width: 20 },
          { header: "ประเภทเหตุการณ์", key: "event_type", width: 18 },
          { header: "เวลา UTC", key: "utc_at", width: 20 },
          { header: "เวลา UTC+7", key: "local_time", width: 20 },
          { header: "IP", key: "ip", width: 22 },
          { header: "IP Version", key: "ip_version_label", width: 12 },
          { header: "ประเภท IP", key: "ip_type", width: 14 },
          { header: "Port", key: "port", width: 10 },
          { header: "ประเทศจาก TikTok", key: "tiktok_country", width: 16 },
          { header: "ไฟล์ ZIP", key: "source_zip", width: 28 },
          { header: "ไฟล์ PDF", key: "source_pdf", width: 24 },
          { header: "ลำดับในไฟล์", key: "source_no", width: 12 },
          { header: "Record Key", key: "record_key", width: 34 },
          { header: "ประเทศจาก RDAP", key: "country", width: 15 },
          { header: "เครือข่าย (RDAP)", key: "network", width: 24 },
          { header: "ผู้ให้บริการ / หน่วยงาน", key: "owner", width: 26 },
          { header: "ช่วง IP เริ่มต้น", key: "from_ip", width: 18 },
          { header: "ช่วง IP สิ้นสุด", key: "to_ip", width: 18 },
          { header: "ไม่มีข้อมูล IP", key: "no_ip_data", width: 12 },
          { header: "ขอข้อมูลไม่ได้", key: "unavailable", width: 13 },
          { header: "ขอข้อมูลแล้ว", key: "requested", width: 12 },
          { header: "ตอบกลับแล้ว", key: "replied", width: 12 },
          { header: "ได้รับข้อมูลแล้ว", key: "received", width: 14 },
          { header: "ไม่ต้องขอข้อมูล IP", key: "no_ip_request_needed", width: 16 },
          { header: "สถานะการขอข้อมูล", key: "status_label", width: 18 },
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
        ws.autoFilter = { from: "A1", to: "BE1" };

        const hdrRow = ws.getRow(1);
        hdrRow.eachCell((cell) => {
          cell.fill = headerFill;
          cell.font = headerFont;
        });
        hdrRow.commit();

        // Keyset cursor pagination (5,000 rows per batch) — exports ALL filtered rows with no 10,000-row cap
        const BATCH_SIZE = 5000;
        let lastId: number | null = null;

        while (true) {
          const conds = [...baseConds];
          const batchParams: unknown[] = [...params];
          if (lastId !== null) {
            conds.push(`e.id < ?`);
            batchParams.push(lastId);
          }
          const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

          const [rows] = await pool.query<mysql.RowDataPacket[]>(
            `SELECT
               e.id,
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
            [...batchParams, BATCH_SIZE]
          );

          if (!rows.length) break;

          for (const r of rows) {
            const excelRow = ws.addRow({
              ...r,
              status_label: computeStatusLabel(r),
            });
            const isBlue20d = isTrueDtacOver20dResult(r.result ? String(r.result) : null);
            const hl = getCaseWindowHighlight(
              r.local_time ? String(r.local_time) : null,
              r.reported_date ? String(r.reported_date) : null,
              r.case_window_match
            );
            if (isBlue20d) {
              excelRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.fill = fillTrueDtac20d;
              });
            } else if (hl === "reported_day") {
              excelRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.fill = fillReportedDay;
              });
            } else if (hl === "window_7d") {
              excelRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.fill = fillWindow7d;
              });
            }
            excelRow.commit();
          }

          lastId = Number(rows[rows.length - 1].id);
          if (rows.length < BATCH_SIZE) break;
        }

        ws.commit();
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

      const wsCases = wb.addWorksheet("URL Cases Scammer", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
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
      wsCases.autoFilter = { from: "A1", to: "M1" };

      const caseHdr = wsCases.getRow(1);
      caseHdr.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
      });
      caseHdr.commit();

      for (const c of caseRows) {
        wsCases.addRow(c).commit();
      }
      wsCases.commit();

      await wb.commit();
    } catch (err) {
      pass.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  const dateTag = new Date().toISOString().slice(0, 10);
  const fname =
    sheetMode === "scammers"
      ? `url_cases_scammer_${dateTag}.xlsx`
      : `Social_Media_IP_Analysis_${dateTag}.xlsx`;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
