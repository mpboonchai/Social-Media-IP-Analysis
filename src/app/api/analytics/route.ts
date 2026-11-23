import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { buildEventWhereClause } from "@/lib/events-query";
import { normalizeIspName, splitCaseIds } from "@/lib/isp-normalize";

interface AnalyticsCacheEntry {
  data: unknown;
  expiresAt: number;
}

const globalAnalyticsCache = globalThis as unknown as {
  analyticsCache?: Map<string, AnalyticsCacheEntry>;
};

function getAnalyticsCache(): Map<string, AnalyticsCacheEntry> {
  if (!globalAnalyticsCache.analyticsCache) {
    globalAnalyticsCache.analyticsCache = new Map();
  }
  return globalAnalyticsCache.analyticsCache;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const filters = {
    search: (sp.get("search") || "").trim() || undefined,
    platform: (sp.get("platform") || "").trim() || undefined,
    event_type: (sp.get("event_type") || "").trim() || undefined,
    country: (sp.get("country") || "").trim() || undefined,
    network: (sp.get("network") || "").trim() || undefined,
    request_status: (sp.get("request_status") || "").trim() || undefined,
    date_from: (sp.get("date_from") || "").trim() || undefined,
    date_to: (sp.get("date_to") || "").trim() || undefined,
    scammer_only: sp.get("scammer_only") === "true",
    case_window_only: sp.get("case_window_only") === "true",
  };

  const cacheKey = JSON.stringify(filters);
  const cacheMap = getAnalyticsCache();
  const hit = cacheMap.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) {
    return NextResponse.json(hit.data);
  }

  const { whereSql, params } = buildEventWhereClause(filters);
  const needsSa = Boolean(filters.search);
  const needsTracking = Boolean(filters.search || (filters.request_status && filters.request_status !== "no_ip_data"));
  const needsRdap = Boolean(filters.country || filters.network || filters.search);

  const filterFrom = `
    FROM ip_events e
    ${needsSa ? "JOIN social_accounts sa ON sa.id = e.account_id" : ""}
    ${needsRdap ? "LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id" : ""}
    ${needsTracking ? "LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id" : ""}
  `;

  const pool = getPool();

  // 1. Pre-aggregate by rdap_network_id for IP Events (fast!)
  // 2. Pre-aggregate distinct (rdap_network_id, tpo_code) for Case IDs (fast!)
  const [evAggRes, caseAggRes] = await Promise.all([
    pool.query<mysql.RowDataPacket[]>(
      `SELECT
         COALESCE(NULLIF(r.country, ''), 'ไม่ระบุ') AS country,
         COALESCE(r.network_name, '') AS network_name,
         COALESCE(r.owner_name, '') AS owner_name,
         agg.cnt
       FROM (
         SELECT e.rdap_network_id, COUNT(*) AS cnt
         ${filterFrom} ${whereSql}
         GROUP BY e.rdap_network_id
       ) agg
       LEFT JOIN rdap_networks r ON r.id = agg.rdap_network_id`,
      params
    ),
    pool.query<mysql.RowDataPacket[]>(
      `SELECT
         COALESCE(NULLIF(r.country, ''), 'ไม่ระบุ') AS country,
         COALESCE(r.network_name, '') AS network_name,
         COALESCE(r.owner_name, '') AS owner_name,
         agg.tpo_code
       FROM (
         SELECT DISTINCT e.rdap_network_id, e.tpo_code
         ${filterFrom}
         ${whereSql ? `${whereSql} AND e.tpo_code <> ''` : `WHERE e.tpo_code <> ''`}
       ) agg
       LEFT JOIN rdap_networks r ON r.id = agg.rdap_network_id`,
      params
    ),
  ]);

  const evRows = evAggRes[0];
  const caseRows = caseAggRes[0];

  // Aggregate IP Events by Country & Normalized ISP
  const countryEventsMap = new Map<string, number>();
  const ispEventsMap = new Map<string, number>();
  let totalEvents = 0;
  let thEvents = 0;

  for (const r of evRows) {
    const cnt = Number(r.cnt || 0);
    const country = String(r.country || "ไม่ระบุ");
    const isp = normalizeIspName(String(r.network_name || ""), String(r.owner_name || ""));
    totalEvents += cnt;
    if (country.toLowerCase() === "thailand") thEvents += cnt;
    if (country !== "ไม่ระบุ") {
      countryEventsMap.set(country, (countryEventsMap.get(country) || 0) + cnt);
    }
    if (isp !== "ไม่ระบุ") {
      ispEventsMap.set(isp, (ispEventsMap.get(isp) || 0) + cnt);
    }
  }

  // Aggregate Distinct Split Case IDs by Country & Normalized ISP
  const countryCasesMap = new Map<string, Set<string>>();
  const ispCasesMap = new Map<string, Set<string>>();
  const allDistinctCaseIds = new Set<string>();
  const thCaseIds = new Set<string>();
  const foreignCaseIds = new Set<string>();

  for (const r of caseRows) {
    const country = String(r.country || "ไม่ระบุ");
    const isp = normalizeIspName(String(r.network_name || ""), String(r.owner_name || ""));
    const caseIds = splitCaseIds(String(r.tpo_code || ""));
    for (const cid of caseIds) {
      allDistinctCaseIds.add(cid);
      if (country.toLowerCase() === "thailand") {
        thCaseIds.add(cid);
      } else if (country !== "ไม่ระบุ") {
        foreignCaseIds.add(cid);
      }

      if (country !== "ไม่ระบุ") {
        let s = countryCasesMap.get(country);
        if (!s) {
          s = new Set();
          countryCasesMap.set(country, s);
        }
        s.add(cid);
      }
      if (isp !== "ไม่ระบุ") {
        let s = ispCasesMap.get(isp);
        if (!s) {
          s = new Set();
          ispCasesMap.set(isp, s);
        }
        s.add(cid);
      }
    }
  }

  const countryByEvents = Array.from(countryEventsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));

  const countryByCases = Array.from(countryCasesMap.entries())
    .map(([label, set]) => ({ label, value: set.size }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const ispByEvents = Array.from(ispEventsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));

  const ispByCases = Array.from(ispCasesMap.entries())
    .map(([label, set]) => ({ label, value: set.size }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const foreignEvents = Math.max(0, totalEvents - thEvents);
  const countryCaseTotalSum = thCaseIds.size + foreignCaseIds.size;

  const payload = {
    summary: {
      total_events: totalEvents,
      th_events: thEvents,
      foreign_events: foreignEvents,
      th_events_pct: totalEvents > 0 ? Number(((thEvents / totalEvents) * 100).toFixed(1)) : 0,
      foreign_events_pct: totalEvents > 0 ? Number(((foreignEvents / totalEvents) * 100).toFixed(1)) : 0,
      unique_case_ids: allDistinctCaseIds.size,
      th_cases: thCaseIds.size,
      foreign_cases: foreignCaseIds.size,
      country_cases_sum: countryCaseTotalSum,
      th_cases_pct: countryCaseTotalSum > 0 ? Number(((thCaseIds.size / countryCaseTotalSum) * 100).toFixed(1)) : 0,
      foreign_cases_pct: countryCaseTotalSum > 0 ? Number(((foreignCaseIds.size / countryCaseTotalSum) * 100).toFixed(1)) : 0,
    },
    country_by_events: countryByEvents,
    country_by_cases: countryByCases,
    isp_by_events: ispByEvents,
    isp_by_cases: ispByCases,
  };

  if (cacheMap.size >= 30) {
    const oldest = cacheMap.keys().next().value;
    if (oldest !== undefined) cacheMap.delete(oldest);
  }
  cacheMap.set(cacheKey, { data: payload, expiresAt: Date.now() + 60_000 });

  return NextResponse.json(payload);
}
