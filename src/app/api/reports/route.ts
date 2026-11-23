import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { buildEventWhereClause } from "@/lib/events-query";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = getPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, report_name, template_version, filters_json, status, generated_by,
            DATE_FORMAT(generated_at, '%Y-%m-%d %H:%i:%s') AS generated_at
     FROM report_snapshots
     ORDER BY generated_at DESC
     LIMIT 30`
  );
  return NextResponse.json({ reports: rows });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    report_name?: string;
    platform?: string;
    date_from?: string;
    date_to?: string;
    country?: string;
    scammer_only?: boolean;
  };

  const reportName =
    String(body.report_name ?? "").trim() ||
    `Social Media IP Intelligence ${new Date().toISOString().slice(0, 10)}`;

  const filters = {
    platform: String(body.platform ?? "").trim(),
    date_from: String(body.date_from ?? "").trim(),
    date_to: String(body.date_to ?? "").trim(),
    country: body.country && body.country !== "ALL" ? String(body.country).trim() : "",
    scammer_only: Boolean(body.scammer_only),
  };

  const { whereSql, params } = buildEventWhereClause(filters);
  const baseFrom = `
    FROM ip_events e
    JOIN social_accounts sa ON sa.id = e.account_id
    LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id
    LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
  `;
  const pool = getPool();

  const [sumRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       COUNT(*) AS events,
       COUNT(DISTINCT e.account_id) AS accounts,
       COUNT(DISTINCT e.ip_bin) AS unique_ips,
       COUNT(DISTINCT CASE WHEN r.country = 'Thailand' THEN e.ip_bin END) AS thailand_ips,
       COUNT(DISTINCT CASE WHEN r.country IS NOT NULL AND r.country <> '' AND r.country <> 'Thailand' THEN e.ip_bin END) AS foreign_ips,
       COUNT(DISTINCT CASE WHEN r.country IS NULL OR r.country = '' THEN e.ip_bin END) AS unknown_ips,
       COUNT(DISTINCT NULLIF(r.network_name, '')) AS isp_groups,
       COUNT(DISTINCT CASE WHEN r.country = 'Thailand' THEN NULLIF(r.network_name, '') END) AS thai_isp,
       COUNT(DISTINCT CASE WHEN r.country IS NOT NULL AND r.country <> '' AND r.country <> 'Thailand' THEN NULLIF(r.network_name, '') END) AS foreign_isp,
       COUNT(DISTINCT CASE WHEN r.country IS NULL OR r.country = '' THEN NULLIF(r.network_name, '') END) AS unknown_isp,
       SUM(CASE WHEN e.scammer_case = 'Scammer' THEN 1 ELSE 0 END) AS scammer_events,
       COUNT(DISTINCT CASE WHEN e.scammer_case = 'Scammer' THEN e.account_id END) AS scammer_accounts,
       COUNT(DISTINCT CASE WHEN e.scammer_case = 'Scammer' THEN e.ip_bin END) AS scammer_ips
     ${baseFrom} ${whereSql}`,
    params
  );

  const [countries] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(r.country, ''), 'Unknown') AS label, COUNT(DISTINCT e.ip_bin) AS value
     ${baseFrom} ${whereSql}
     GROUP BY label ORDER BY value DESC LIMIT 10`,
    params
  );

  const [networks] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(r.network_name, ''), 'Unknown') AS label, COUNT(DISTINCT e.ip_bin) AS unique_ips
     ${baseFrom} ${whereSql}
     GROUP BY label ORDER BY unique_ips DESC LIMIT 10`,
    params
  );

  const foreignWhere = whereSql
    ? `${whereSql} AND r.country IS NOT NULL AND r.country <> '' AND r.country <> 'Thailand'`
    : `WHERE r.country IS NOT NULL AND r.country <> '' AND r.country <> 'Thailand'`;

  const [foreignNetworks] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(r.network_name, ''), 'Unknown') AS label, COUNT(DISTINCT e.ip_bin) AS unique_ips
     ${baseFrom} ${foreignWhere}
     GROUP BY label ORDER BY unique_ips DESC LIMIT 10`,
    params
  );

  const [timeline] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DATE_FORMAT(e.event_local, '%Y-%m-%d') AS day, COUNT(*) AS events, COUNT(DISTINCT e.ip_bin) AS unique_ips
     ${baseFrom} ${whereSql ? `${whereSql} AND e.event_local IS NOT NULL` : "WHERE e.event_local IS NOT NULL"}
     GROUP BY day ORDER BY day DESC LIMIT 31`,
    params
  );

  const [sharedIps] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT INET6_NTOA(e.ip_bin) AS ip, COUNT(DISTINCT e.account_id) AS accounts,
            MAX(COALESCE(r.network_name, 'Unknown')) AS network,
            MAX(COALESCE(r.country, 'Unknown')) AS country
     ${baseFrom} ${whereSql ? `${whereSql} AND e.ip_bin IS NOT NULL` : "WHERE e.ip_bin IS NOT NULL"}
     GROUP BY e.ip_bin
     HAVING accounts > 1
     ORDER BY accounts DESC LIMIT 12`,
    params
  );

  const id = crypto.randomUUID();
  const reportData = {
    id,
    report_name: reportName,
    template_version: "V2 MySQL Intelligence Report · 17 Slides",
    generated_at: new Date().toISOString(),
    generated_by: user.username,
    filters,
    summary: sumRows[0],
    countries,
    networks,
    foreign_networks: foreignNetworks,
    timeline: [...timeline].reverse(),
    shared_ips: sharedIps,
  };

  await pool.execute(
    `INSERT INTO report_snapshots (id, report_name, template_version, filters_json, summary_json, status, generated_by)
     VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
    [id, reportName, reportData.template_version, JSON.stringify(filters), JSON.stringify(reportData), user.username]
  );

  return NextResponse.json({ ok: true, report: reportData });
}
