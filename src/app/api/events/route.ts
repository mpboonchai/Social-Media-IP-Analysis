import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { ipToBuffer } from "@/lib/ip-utils";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || 25)));
  const offset = Math.max(0, Number(sp.get("offset") || 0));
  const search = (sp.get("search") || "").trim();
  const platform = (sp.get("platform") || "").trim();
  const eventType = (sp.get("event_type") || "").trim();
  const country = (sp.get("country") || "").trim();
  const network = (sp.get("network") || "").trim();
  const requestStatus = (sp.get("request_status") || "").trim();
  const dateFrom = (sp.get("date_from") || "").trim();
  const dateTo = (sp.get("date_to") || "").trim();
  const scammerOnly = sp.get("scammer_only") === "true";
  const caseWindowOnly = sp.get("case_window_only") === "true";

  const where: string[] = [];
  const params: unknown[] = [];

  if (platform === "META") {
    where.push(`e.platform IN ('Facebook', 'Instagram')`);
  } else if (platform) {
    where.push(`e.platform = ?`);
    params.push(platform);
  }
  if (eventType) {
    where.push(`e.event_type = ?`);
    params.push(eventType);
  }
  if (country) {
    where.push(`r.country = ?`);
    params.push(country);
  }
  if (network) {
    where.push(`r.network_name = ?`);
    params.push(network);
  }
  if (dateFrom) {
    where.push(`e.event_local >= ?`);
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push(`e.event_local <= ?`);
    params.push(`${dateTo} 23:59:59`);
  }
  if (scammerOnly) {
    where.push(`e.scammer_case = 'Scammer'`);
  }
  if (caseWindowOnly) {
    where.push(`e.case_window_match = 1`);
  }
  if (requestStatus === "no_ip_data") where.push(`e.no_ip_data = 1`);
  else if (requestStatus === "unavailable") where.push(`t.unavailable = 1`);
  else if (requestStatus === "requested") where.push(`t.requested = 1`);
  else if (requestStatus === "replied") where.push(`t.replied = 1`);
  else if (requestStatus === "received") where.push(`t.received = 1`);
  else if (requestStatus === "complete") where.push(`t.no_ip_request_needed = 1`);
  else if (requestStatus === "pending") {
    where.push(`e.no_ip_data = 0 AND COALESCE(t.unavailable,0)=0 AND COALESCE(t.requested,0)=0 AND COALESCE(t.no_ip_request_needed,0)=0`);
  }

  if (search) {
    const ipParsed = ipToBuffer(search);
    if (ipParsed) {
      where.push(`e.ip_bin = ?`);
      params.push(ipParsed.buf);
    } else {
      const like = `%${search}%`;
      where.push(
        `(sa.account_name LIKE ? OR sa.account_identifier LIKE ? OR e.inst_id LIKE ? OR e.tpo_code LIKE ? OR r.network_name LIKE ? OR t.letter_number LIKE ?)`
      );
      params.push(like, like, like, like, like, like);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const baseFrom = `
    FROM ip_events e
    JOIN social_accounts sa ON sa.id = e.account_id
    LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id
    LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
  `;

  const pool = getPool();

  const [kpiRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_events,
       COUNT(DISTINCT e.account_id) AS unique_accounts,
       COUNT(DISTINCT e.ip_bin) AS unique_ips,
       SUM(CASE WHEN t.requested = 1 THEN 1 ELSE 0 END) AS requested_count,
       SUM(CASE WHEN t.unavailable = 1 THEN 1 ELSE 0 END) AS unavailable_count,
       SUM(CASE WHEN t.replied = 1 THEN 1 ELSE 0 END) AS replied_count,
       SUM(CASE WHEN t.received = 1 THEN 1 ELSE 0 END) AS received_count,
       SUM(CASE WHEN e.scammer_case = 'Scammer' THEN 1 ELSE 0 END) AS scammer_events
     ${baseFrom} ${whereSql}`,
    params
  );

  const [topNetworks] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(r.network_name, ''), 'ไม่ระบุ') AS label, COUNT(*) AS value
     ${baseFrom} ${whereSql}
     GROUP BY label ORDER BY value DESC LIMIT 6`,
    params
  );

  const [topCountries] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(r.country, ''), 'ไม่ระบุ') AS label, COUNT(*) AS value
     ${baseFrom} ${whereSql}
     GROUP BY label ORDER BY value DESC LIMIT 6`,
    params
  );

  const [records] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       LOWER(HEX(e.record_key)) AS record_key,
       e.platform,
       e.event_type,
       DATE_FORMAT(e.event_local, '%Y-%m-%d %H:%i:%s') AS local_time,
       DATE_FORMAT(e.event_utc, '%Y-%m-%d %H:%i:%s') AS utc_at,
       INET6_NTOA(e.ip_bin) AS ip,
       e.port,
       e.ip_type,
       e.it_no,
       e.inst_id,
       e.tpo_code,
       e.scammer_case,
       e.reported_date,
       e.team,
       e.case_window_match,
       e.source_zip,
       e.source_pdf,
       e.no_ip_data,
       sa.account_name AS account,
       sa.account_identifier,
       sa.target_id,
       sa.meta_account_type,
       e.page_admin,
       e.meta_actor_display,
       COALESCE(r.country, '') AS country,
       COALESCE(r.network_name, '') AS network,
       COALESCE(r.owner_name, '') AS owner,
       COALESCE(t.unavailable, 0) AS unavailable,
       COALESCE(t.requested, 0) AS requested,
       COALESCE(t.replied, 0) AS replied,
       COALESCE(t.received, 0) AS received,
       COALESCE(t.no_ip_request_needed, 0) AS no_ip_request_needed,
       COALESCE(t.letter_number, '') AS letter_number,
       COALESCE(t.result, '') AS result,
       COALESCE(t.entity_name, '') AS entity_name,
       COALESCE(t.entity_phone, '') AS entity_phone
     ${baseFrom} ${whereSql}
     ORDER BY e.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({
    kpi: kpiRows[0],
    top_networks: topNetworks,
    top_countries: topCountries,
    records,
    pagination: {
      limit,
      offset,
      total: Number(kpiRows[0]?.total_events || 0),
    },
  });
}
