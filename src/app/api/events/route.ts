import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { ipToBuffer } from "@/lib/ip-utils";
import { getCachedEventStats, setCachedEventStats } from "@/lib/events-cache";

const SORT_COLUMNS: Record<string, string> = {
  id: "e.id",
  local_time: "e.event_local",
  platform: "e.platform",
  it_no: "e.it_no",
  target_id: "sa.target_id",
  inst_id: "e.inst_id",
  tpo_code: "e.tpo_code",
  scammer_case: "e.scammer_case",
  reported_date: "e.reported_date",
  team: "e.team",
  account: "sa.account_name",
  ip: "e.ip_bin",
  network: "r.network_name",
  country: "r.country",
  letter_number: "t.letter_number",
};

function parseCsvParam(val: string | null): string[] {
  if (!val) return [];
  return val
    .split("||")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit") || 25)));
  const offset = Math.max(0, Number(sp.get("offset") || 0));
  const skipStats = sp.get("skip_stats") === "1";

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

  // Excel-style multi-value column filters (delimited by "||")
  const colPlatform = parseCsvParam(sp.get("col_platform"));
  const colTeam = parseCsvParam(sp.get("col_team"));
  const colReportedDate = parseCsvParam(sp.get("col_reported_date"));
  const colScammerCase = parseCsvParam(sp.get("col_scammer_case"));
  const colMetaType = parseCsvParam(sp.get("col_meta_type"));

  // Sorting
  const sortByRaw = (sp.get("sort_by") || "id").trim();
  const sortDir = sp.get("sort_dir") === "asc" ? "ASC" : "DESC";
  const sortExpr = SORT_COLUMNS[sortByRaw] || "e.id";

  const where: string[] = [];
  const params: unknown[] = [];

  let needsSaJoin = sortExpr.startsWith("sa.");
  let needsRdapJoin = sortExpr.startsWith("r.");
  let needsTrackingJoin = sortExpr.startsWith("t.");

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
    needsRdapJoin = true;
  }
  if (network) {
    where.push(`r.network_name = ?`);
    params.push(network);
    needsRdapJoin = true;
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
  if (requestStatus === "no_ip_data") {
    where.push(`e.no_ip_data = 1`);
  } else if (requestStatus === "unavailable") {
    where.push(`t.unavailable = 1`);
    needsTrackingJoin = true;
  } else if (requestStatus === "requested") {
    where.push(`t.requested = 1`);
    needsTrackingJoin = true;
  } else if (requestStatus === "replied") {
    where.push(`t.replied = 1`);
    needsTrackingJoin = true;
  } else if (requestStatus === "received") {
    where.push(`t.received = 1`);
    needsTrackingJoin = true;
  } else if (requestStatus === "complete") {
    where.push(`t.no_ip_request_needed = 1`);
    needsTrackingJoin = true;
  } else if (requestStatus === "pending") {
    where.push(
      `e.no_ip_data = 0 AND COALESCE(t.unavailable,0)=0 AND COALESCE(t.requested,0)=0 AND COALESCE(t.no_ip_request_needed,0)=0`
    );
    needsTrackingJoin = true;
  }

  // Apply Excel-style column filters
  if (colPlatform.length) {
    where.push(`e.platform IN (${colPlatform.map(() => "?").join(",")})`);
    params.push(...colPlatform);
  }
  if (colTeam.length) {
    const vals = colTeam.map((v) => (v === "(ว่าง)" ? "" : v));
    where.push(`COALESCE(e.team, '') IN (${vals.map(() => "?").join(",")})`);
    params.push(...vals);
  }
  if (colReportedDate.length) {
    const vals = colReportedDate.map((v) => (v === "(ว่าง)" ? "" : v));
    where.push(`COALESCE(e.reported_date, '') IN (${vals.map(() => "?").join(",")})`);
    params.push(...vals);
  }
  if (colScammerCase.length) {
    const vals = colScammerCase.map((v) => (v === "(ว่าง)" ? "" : v));
    where.push(`COALESCE(e.scammer_case, '') IN (${vals.map(() => "?").join(",")})`);
    params.push(...vals);
  }
  if (colMetaType.length) {
    const vals = colMetaType.map((v) => (v === "(ว่าง)" ? "" : v));
    where.push(`COALESCE(sa.meta_account_type, '') IN (${vals.map(() => "?").join(",")})`);
    params.push(...vals);
    needsSaJoin = true;
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
      needsSaJoin = true;
      needsRdapJoin = true;
      needsTrackingJoin = true;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const isEventOnlyFilter = !needsSaJoin && !needsRdapJoin && !needsTrackingJoin;
  const isUnfiltered = where.length === 0;

  const fullFrom = `
    FROM ip_events e
    JOIN social_accounts sa ON sa.id = e.account_id
    LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id
    LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
  `;

  const minimalFilterFrom = `
    FROM ip_events e
    ${needsSaJoin ? "JOIN social_accounts sa ON sa.id = e.account_id" : ""}
    ${needsRdapJoin ? "LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id" : ""}
    ${needsTrackingJoin ? "LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id" : ""}
  `;

  const pool = getPool();

  const recordsSelect = `
    SELECT
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
  `;

  const recordsPromise =
    isEventOnlyFilter && sortExpr.startsWith("e.")
      ? pool.query<mysql.RowDataPacket[]>(
          `${recordsSelect}
           FROM (
             SELECT e.* FROM ip_events e ${whereSql} ORDER BY ${sortExpr} ${sortDir} LIMIT ? OFFSET ?
           ) e
           JOIN social_accounts sa ON sa.id = e.account_id
           LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id
           LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
           ORDER BY ${sortExpr} ${sortDir}`,
          [...params, limit, offset]
        )
      : pool.query<mysql.RowDataPacket[]>(
          `${recordsSelect}
           ${fullFrom} ${whereSql}
           ORDER BY ${sortExpr} ${sortDir}
           LIMIT ? OFFSET ?`,
          [...params, limit, offset]
        );

  if (skipStats) {
    const [records] = await recordsPromise;
    return NextResponse.json({
      records,
      pagination: { limit, offset },
      stats_skipped: true,
    });
  }

  const cacheKey = JSON.stringify({
    search,
    platform,
    eventType,
    country,
    network,
    requestStatus,
    dateFrom,
    dateTo,
    scammerOnly,
    caseWindowOnly,
    colPlatform,
    colTeam,
    colReportedDate,
    colScammerCase,
    colMetaType,
  });

  const cached = getCachedEventStats(cacheKey);
  if (cached) {
    const [records] = await recordsPromise;
    return NextResponse.json({
      kpi: cached.kpi,
      account_coverage: cached.account_coverage,
      tpo_coverage: cached.tpo_coverage,
      tracking_summary: cached.tracking_summary,
      top_networks: cached.top_networks,
      top_countries: cached.top_countries,
      filter_options: cached.filter_options,
      records,
      pagination: {
        limit,
        offset,
        total: Number(cached.kpi?.total_events || 0),
      },
      cached_stats: true,
    });
  }

  // Parallel KPI + Request Coverage + RDAP pre-aggregation
  const kpiPromise: Promise<Record<string, unknown>> = isUnfiltered
    ? Promise.all([
        pool.query<mysql.RowDataPacket[]>(
          `SELECT
             COUNT(*) AS total_events,
             COUNT(DISTINCT account_id) AS unique_accounts,
             COUNT(DISTINCT ip_bin) AS unique_ips,
             SUM(CASE WHEN scammer_case = 'Scammer' THEN 1 ELSE 0 END) AS scammer_events,
             SUM(CASE WHEN no_ip_data = 1 THEN 1 ELSE 0 END) AS no_ip_data_count,
             COUNT(DISTINCT CONCAT(account_id, '|', COALESCE(reported_date, ''))) AS acc_date_total,
             COUNT(DISTINCT NULLIF(tpo_code, '')) AS tpo_total
           FROM ip_events`
        ),
        pool.query<mysql.RowDataPacket[]>(
          `SELECT
             SUM(CASE WHEN t.requested = 1 THEN 1 ELSE 0 END) AS requested_count,
             SUM(CASE WHEN t.unavailable = 1 THEN 1 ELSE 0 END) AS unavailable_count,
             SUM(CASE WHEN t.replied = 1 THEN 1 ELSE 0 END) AS replied_count,
             SUM(CASE WHEN t.received = 1 THEN 1 ELSE 0 END) AS received_count,
             COUNT(DISTINCT NULLIF(t.letter_number, '')) AS distinct_letters,
             COUNT(DISTINCT CASE WHEN t.requested = 1 THEN CONCAT(e.account_id, '|', COALESCE(e.reported_date, '')) END) AS acc_date_requested,
             COUNT(DISTINCT CASE WHEN t.requested = 1 AND e.tpo_code <> '' THEN e.tpo_code END) AS tpo_requested
           FROM ip_request_tracking t
           JOIN ip_events e ON e.id = t.ip_event_id`
        ),
      ]).then(([[evRows], [trRows]]) => ({
        ...(evRows[0] as Record<string, unknown>),
        requested_count: trRows[0]?.requested_count ?? 0,
        unavailable_count: trRows[0]?.unavailable_count ?? 0,
        replied_count: trRows[0]?.replied_count ?? 0,
        received_count: trRows[0]?.received_count ?? 0,
        distinct_letters: trRows[0]?.distinct_letters ?? 0,
        acc_date_requested: trRows[0]?.acc_date_requested ?? 0,
        tpo_requested: trRows[0]?.tpo_requested ?? 0,
      }))
    : pool
        .query<mysql.RowDataPacket[]>(
          `SELECT
             COUNT(*) AS total_events,
             COUNT(DISTINCT e.account_id) AS unique_accounts,
             COUNT(DISTINCT e.ip_bin) AS unique_ips,
             SUM(CASE WHEN t.requested = 1 THEN 1 ELSE 0 END) AS requested_count,
             SUM(CASE WHEN t.unavailable = 1 THEN 1 ELSE 0 END) AS unavailable_count,
             SUM(CASE WHEN t.replied = 1 THEN 1 ELSE 0 END) AS replied_count,
             SUM(CASE WHEN t.received = 1 THEN 1 ELSE 0 END) AS received_count,
             SUM(CASE WHEN e.scammer_case = 'Scammer' THEN 1 ELSE 0 END) AS scammer_events,
             SUM(CASE WHEN e.no_ip_data = 1 THEN 1 ELSE 0 END) AS no_ip_data_count,
             COUNT(DISTINCT NULLIF(t.letter_number, '')) AS distinct_letters,
             COUNT(DISTINCT CONCAT(e.account_id, '|', COALESCE(e.reported_date, ''))) AS acc_date_total,
             COUNT(DISTINCT CASE WHEN t.requested = 1 THEN CONCAT(e.account_id, '|', COALESCE(e.reported_date, '')) END) AS acc_date_requested,
             COUNT(DISTINCT NULLIF(e.tpo_code, '')) AS tpo_total,
             COUNT(DISTINCT CASE WHEN t.requested = 1 AND e.tpo_code <> '' THEN e.tpo_code END) AS tpo_requested
           FROM ip_events e
           ${needsSaJoin ? "JOIN social_accounts sa ON sa.id = e.account_id" : ""}
           ${needsRdapJoin ? "LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id" : ""}
           LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
           ${whereSql}`,
          params
        )
        .then(([rows]) => (rows[0] as Record<string, unknown>) || {});

  const rdapAggPromise = pool.query<mysql.RowDataPacket[]>(
    `SELECT
       COALESCE(NULLIF(r.network_name, ''), 'ไม่ระบุ') AS network_name,
       COALESCE(NULLIF(r.country, ''), 'ไม่ระบุ') AS country,
       agg.cnt
     FROM (
       SELECT e.rdap_network_id, COUNT(*) AS cnt
       ${minimalFilterFrom} ${whereSql}
       GROUP BY e.rdap_network_id
     ) agg
     LEFT JOIN rdap_networks r ON r.id = agg.rdap_network_id`,
    params
  );

  const [[records], kpiRaw, [rdapRows]] = await Promise.all([
    recordsPromise,
    kpiPromise,
    rdapAggPromise,
  ]);

  const netMap = new Map<string, number>();
  const countryMap = new Map<string, number>();
  for (const row of rdapRows) {
    const cnt = Number(row.cnt || 0);
    const netLabel = String(row.network_name || "ไม่ระบุ");
    const cLabel = String(row.country || "ไม่ระบุ");
    netMap.set(netLabel, (netMap.get(netLabel) || 0) + cnt);
    countryMap.set(cLabel, (countryMap.get(cLabel) || 0) + cnt);
  }

  const sortedNets = Array.from(netMap.entries()).sort((a, b) => b[1] - a[1]);
  const sortedCountries = Array.from(countryMap.entries()).sort((a, b) => b[1] - a[1]);

  const topNetworks = sortedNets.slice(0, 6).map(([label, value]) => ({ label, value }));
  const topCountries = sortedCountries.slice(0, 6).map(([label, value]) => ({ label, value }));

  const filterOptions = {
    countries: sortedCountries.map(([l]) => l).filter((l) => l !== "ไม่ระบุ").slice(0, 40),
    networks: sortedNets.map(([l]) => l).filter((l) => l !== "ไม่ระบุ").slice(0, 50),
  };

  const accTotal = Number(kpiRaw.acc_date_total || 0);
  const accReq = Number(kpiRaw.acc_date_requested || 0);
  const tpoTotal = Number(kpiRaw.tpo_total || 0);
  const tpoReq = Number(kpiRaw.tpo_requested || 0);

  const accountCoverage = {
    total: accTotal,
    requested: accReq,
    pending: Math.max(0, accTotal - accReq),
    pct: accTotal > 0 ? Math.round((accReq / accTotal) * 100) : 0,
  };

  const tpoCoverage = {
    total: tpoTotal,
    requested: tpoReq,
    pending: Math.max(0, tpoTotal - tpoReq),
    pct: tpoTotal > 0 ? Math.round((tpoReq / tpoTotal) * 100) : 0,
  };

  const trackingSummary = {
    no_ip_data_count: Number(kpiRaw.no_ip_data_count || 0),
    unavailable_count: Number(kpiRaw.unavailable_count || 0),
    requested_count: Number(kpiRaw.requested_count || 0),
    replied_count: Number(kpiRaw.replied_count || 0),
    received_count: Number(kpiRaw.received_count || 0),
    distinct_letters: Number(kpiRaw.distinct_letters || 0),
    total_networks: sortedNets.filter(([l]) => l !== "ไม่ระบุ").length,
  };

  setCachedEventStats(cacheKey, {
    kpi: kpiRaw,
    account_coverage: accountCoverage,
    tpo_coverage: tpoCoverage,
    tracking_summary: trackingSummary,
    top_networks: topNetworks,
    top_countries: topCountries,
    filter_options: filterOptions,
  });

  return NextResponse.json({
    kpi: kpiRaw,
    account_coverage: accountCoverage,
    tpo_coverage: tpoCoverage,
    tracking_summary: trackingSummary,
    top_networks: topNetworks,
    top_countries: topCountries,
    filter_options: filterOptions,
    records,
    pagination: {
      limit,
      offset,
      total: Number(kpiRaw?.total_events || 0),
    },
  });
}
