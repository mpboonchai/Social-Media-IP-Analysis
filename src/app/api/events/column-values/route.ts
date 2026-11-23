import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";

interface CacheEntry {
  values: string[];
  expiresAt: number;
}

const globalColCache = globalThis as unknown as {
  colValuesCache?: Map<string, CacheEntry>;
};

function getColCache(): Map<string, CacheEntry> {
  if (!globalColCache.colValuesCache) {
    globalColCache.colValuesCache = new Map();
  }
  return globalColCache.colValuesCache;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const column = (sp.get("column") || "").trim();
  const q = (sp.get("q") || "").trim();
  const limit = Math.min(200, Math.max(20, Number(sp.get("limit") || 120)));

  const cacheKey = `${column}|${q.toLowerCase()}|${limit}`;
  const cacheMap = getColCache();
  const hit = cacheMap.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) {
    return NextResponse.json({ values: hit.values, source: "database_cached" });
  }

  const pool = getPool();
  const like = `%${q}%`;
  let sql = "";
  let params: unknown[] = [];

  switch (column) {
    case "platform":
      return NextResponse.json({ values: ["TikTok", "Facebook", "Instagram"], source: "database" });

    case "scammer_case":
      return NextResponse.json({ values: ["Scammer", "(ว่าง)"], source: "database" });

    case "account":
      sql = q
        ? `SELECT DISTINCT account_name AS val FROM social_accounts WHERE account_name LIKE ? ORDER BY account_name ASC LIMIT ?`
        : `SELECT DISTINCT account_name AS val FROM social_accounts WHERE account_name <> '' ORDER BY account_name ASC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "target_id":
      sql = q
        ? `SELECT DISTINCT target_id AS val FROM social_accounts WHERE target_id LIKE ? ORDER BY target_id ASC LIMIT ?`
        : `SELECT DISTINCT target_id AS val FROM social_accounts WHERE target_id <> '' ORDER BY target_id ASC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "meta_type":
      sql = `SELECT DISTINCT COALESCE(NULLIF(meta_account_type, ''), '(ว่าง)') AS val FROM social_accounts ORDER BY val ASC LIMIT ?`;
      params = [limit];
      break;

    case "network":
      sql = q
        ? `SELECT DISTINCT network_name AS val FROM rdap_networks WHERE network_name LIKE ? ORDER BY network_name ASC LIMIT ?`
        : `SELECT DISTINCT network_name AS val FROM rdap_networks WHERE network_name <> '' ORDER BY network_name ASC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "country":
      sql = q
        ? `SELECT DISTINCT country AS val FROM rdap_networks WHERE country LIKE ? ORDER BY country ASC LIMIT ?`
        : `SELECT DISTINCT country AS val FROM rdap_networks WHERE country <> '' ORDER BY country ASC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "letter":
      sql = q
        ? `SELECT DISTINCT letter_number AS val FROM ip_request_tracking WHERE letter_number LIKE ? ORDER BY letter_number ASC LIMIT ?`
        : `SELECT DISTINCT letter_number AS val FROM ip_request_tracking WHERE letter_number <> '' ORDER BY letter_number ASC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "team":
      sql = q
        ? `SELECT DISTINCT team AS val FROM ip_events WHERE team LIKE ? ORDER BY team ASC LIMIT ?`
        : `SELECT DISTINCT COALESCE(NULLIF(team, ''), '(ว่าง)') AS val FROM ip_events ORDER BY val ASC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "reported_date":
      sql = q
        ? `SELECT DISTINCT reported_date AS val FROM ip_events WHERE reported_date LIKE ? ORDER BY reported_date DESC LIMIT ?`
        : `SELECT DISTINCT COALESCE(NULLIF(reported_date, ''), '(ว่าง)') AS val FROM ip_events ORDER BY val DESC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "inst_id":
      sql = q
        ? `SELECT DISTINCT inst_id AS val FROM ip_events WHERE inst_id LIKE ? ORDER BY inst_id DESC LIMIT ?`
        : `SELECT DISTINCT inst_id AS val FROM ip_events WHERE inst_id <> '' ORDER BY inst_id DESC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "tpo_code":
      sql = q
        ? `SELECT DISTINCT tpo_code AS val FROM ip_events WHERE tpo_code LIKE ? ORDER BY tpo_code DESC LIMIT ?`
        : `SELECT DISTINCT tpo_code AS val FROM ip_events WHERE tpo_code <> '' ORDER BY tpo_code DESC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "it_no":
      sql = q
        ? `SELECT DISTINCT it_no AS val FROM social_accounts WHERE it_no LIKE ? ORDER BY it_no DESC LIMIT ?`
        : `SELECT DISTINCT it_no AS val FROM social_accounts WHERE it_no <> '' ORDER BY it_no DESC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "local_date":
      sql = q
        ? `SELECT DISTINCT DATE_FORMAT(event_local, '%Y-%m-%d') AS val FROM ip_events WHERE event_local IS NOT NULL AND DATE_FORMAT(event_local, '%Y-%m-%d') LIKE ? ORDER BY val DESC LIMIT ?`
        : `SELECT DISTINCT DATE_FORMAT(event_local, '%Y-%m-%d') AS val FROM ip_events WHERE event_local IS NOT NULL ORDER BY val DESC LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    case "ip":
      sql = q
        ? `SELECT DISTINCT INET6_NTOA(ip_bin) AS val FROM ip_events WHERE ip_bin IS NOT NULL AND INET6_NTOA(ip_bin) LIKE ? ORDER BY val ASC LIMIT ?`
        : `SELECT DISTINCT INET6_NTOA(ip_bin) AS val FROM ip_events WHERE ip_bin IS NOT NULL LIMIT ?`;
      params = q ? [like, limit] : [limit];
      break;

    default:
      return NextResponse.json({ values: [], source: "unknown_column" });
  }

  const [rows] = await pool.query<mysql.RowDataPacket[]>(sql, params);
  const values = rows.map((r) => String(r.val ?? "").trim()).filter(Boolean);

  if (!q && !values.includes("(ว่าง)") && column !== "local_date" && column !== "ip") {
    values.unshift("(ว่าง)");
  }

  if (cacheMap.size >= 100) {
    const oldest = cacheMap.keys().next().value;
    if (oldest !== undefined) cacheMap.delete(oldest);
  }
  cacheMap.set(cacheKey, { values, expiresAt: Date.now() + 60_000 });

  return NextResponse.json({ values, source: "database" });
}
