import { NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { invalidateEventsStatsCache } from "@/lib/events-cache";

export const maxDuration = 60;

const NOTE_TEXT = "ขอข้อมูลตามช่วงก่อเหตุเรียบร้อยแล้ว";

function extractIsoDates(raw: string): string[] {
  const out: string[] = [];
  for (const m of String(raw || "").matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    out.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return out;
}

function isoDateToUtcDayMs(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

async function findFullyCoveredAccounts(pool: mysql.Pool): Promise<number[]> {
  // 1. Collect ALL distinct reported dates per social account (handles 1, 2, 3+ Case IDs per account)
  const [repRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT account_id, reported_date
     FROM ip_events
     WHERE reported_date <> ''`
  );

  const accountRepDates = new Map<number, Set<string>>();
  for (const r of repRows) {
    const accId = Number(r.account_id);
    const dates = extractIsoDates(String(r.reported_date || ""));
    if (!dates.length) continue;
    let set = accountRepDates.get(accId);
    if (!set) {
      set = new Set<string>();
      accountRepDates.set(accId, set);
    }
    for (const d of dates) set.add(d);
  }

  if (accountRepDates.size === 0) return [];

  // 2. Collect all requested / replied / received IP event local dates per account
  const [reqRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT e.account_id, DATE_FORMAT(e.event_local, '%Y-%m-%d') AS ev_date
     FROM ip_events e
     JOIN ip_request_tracking t ON t.ip_event_id = e.id
     WHERE e.event_local IS NOT NULL
       AND (t.requested = 1 OR t.replied = 1 OR t.received = 1)`
  );

  const accountReqDayMs = new Map<number, number[]>();
  for (const r of reqRows) {
    const accId = Number(r.account_id);
    if (!accountRepDates.has(accId)) continue;
    const ms = isoDateToUtcDayMs(String(r.ev_date || ""));
    if (!Number.isFinite(ms)) continue;
    let arr = accountReqDayMs.get(accId);
    if (!arr) {
      arr = [];
      accountReqDayMs.set(accId, arr);
    }
    arr.push(ms);
  }

  // 3. An account is "fully covered" iff EVERY reported_date linked to that account
  //    has at least one requested/replied/received IP event within ±3 days (7-day window).
  const THREE_DAYS_MS = 3 * 86_400_000;
  const coveredAccountIds: number[] = [];

  for (const [accId, repDateSet] of accountRepDates.entries()) {
    const reqDays = accountReqDayMs.get(accId);
    if (!reqDays || reqDays.length === 0) continue;

    let allCovered = true;
    for (const rd of repDateSet) {
      const repMs = isoDateToUtcDayMs(rd);
      if (!Number.isFinite(repMs)) continue;
      const hit = reqDays.some((evMs) => Math.abs(evMs - repMs) <= THREE_DAYS_MS);
      if (!hit) {
        allCovered = false;
        break;
      }
    }
    if (allCovered) coveredAccountIds.push(accId);
  }

  return coveredAccountIds;
}

const PENDING_COND = `
  e.no_ip_data = 0
  AND (
    t.ip_event_id IS NULL
    OR (
      t.requested = 0
      AND t.replied = 0
      AND t.received = 0
      AND t.unavailable = 0
      AND t.no_ip_request_needed = 0
    )
  )
`;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const pool = getPool();
  const coveredAccountIds = await findFullyCoveredAccounts(pool);

  if (coveredAccountIds.length === 0) {
    return NextResponse.json({
      ok: true,
      covered_accounts_count: 0,
      pending_events_count: 0,
    });
  }

  const [cntRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM ip_events e
     LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
     WHERE e.account_id IN (?) AND ${PENDING_COND}`,
    [coveredAccountIds]
  );

  return NextResponse.json({
    ok: true,
    covered_accounts_count: coveredAccountIds.length,
    pending_events_count: Number(cntRows[0]?.cnt || 0),
  });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const pool = getPool();
  const coveredAccountIds = await findFullyCoveredAccounts(pool);

  if (coveredAccountIds.length === 0) {
    return NextResponse.json({
      ok: true,
      covered_accounts_count: 0,
      updated_count: 0,
      note: NOTE_TEXT,
    });
  }

  let totalUpdated = 0;
  let lastId = 0;
  const BATCH_SIZE = 20000;

  while (true) {
    const [idRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT e.id
       FROM ip_events e
       LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
       WHERE e.id > ? AND e.account_id IN (?) AND ${PENDING_COND}
       ORDER BY e.id ASC
       LIMIT ?`,
      [lastId, coveredAccountIds, BATCH_SIZE]
    );

    if (!idRows.length) break;

    const ids = idRows.map((r) => Number(r.id));
    lastId = ids[ids.length - 1];

    const values = ids.map((id) => [id, 1, NOTE_TEXT, user.username]);
    for (let i = 0; i < values.length; i += 2000) {
      const chunk = values.slice(i, i + 2000);
      await pool.query(
        `INSERT INTO ip_request_tracking (ip_event_id, no_ip_request_needed, result, updated_by)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           no_ip_request_needed = 1,
           result = IF(
             result IS NULL OR result = '',
             VALUES(result),
             IF(LOCATE('${NOTE_TEXT}', result) > 0, result, CONCAT(result, ' | ', VALUES(result)))
           ),
           updated_by = VALUES(updated_by)`,
        [chunk]
      );
    }

    totalUpdated += ids.length;
    if (ids.length < BATCH_SIZE) break;
  }

  invalidateEventsStatsCache();

  return NextResponse.json({
    ok: true,
    covered_accounts_count: coveredAccountIds.length,
    updated_count: totalUpdated,
    note: NOTE_TEXT,
  });
}
