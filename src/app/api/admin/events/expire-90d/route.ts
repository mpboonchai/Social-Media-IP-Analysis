import { NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { invalidateEventsStatsCache } from "@/lib/events-cache";

const EXPIRED_WHERE = `
  e.no_ip_data = 0
  AND e.event_local IS NOT NULL
  AND DATEDIFF(CURDATE(), DATE(e.event_local)) > 90
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
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS pending_expired_count,
            DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m-%d') AS cutoff_date
     FROM ip_events e
     LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
     WHERE ${EXPIRED_WHERE}`
  );

  return NextResponse.json({
    ok: true,
    pending_expired_count: Number(rows[0]?.pending_expired_count || 0),
    cutoff_date: String(rows[0]?.cutoff_date || ""),
  });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const pool = getPool();
  const noteText = "ข้อมูลเกิน 90 วัน";

  // Batch in chunks of 20,000 IDs to stay well within TiDB Serverless transaction memory limits
  let totalUpdated = 0;
  let lastId = 0;
  const BATCH_SIZE = 20000;

  while (true) {
    const [idRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT e.id
       FROM ip_events e
       LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
       WHERE e.id > ? AND ${EXPIRED_WHERE}
       ORDER BY e.id ASC
       LIMIT ?`,
      [lastId, BATCH_SIZE]
    );

    if (!idRows.length) break;

    const ids = idRows.map((r) => Number(r.id));
    lastId = ids[ids.length - 1];

    const values = ids.map((id) => [id, 1, noteText, user.username]);
    for (let i = 0; i < values.length; i += 2000) {
      const chunk = values.slice(i, i + 2000);
      await pool.query(
        `INSERT INTO ip_request_tracking (ip_event_id, unavailable, result, updated_by)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           unavailable = 1,
           result = IF(
             result IS NULL OR result = '',
             VALUES(result),
             IF(LOCATE('ข้อมูลเกิน 90 วัน', result) > 0, result, CONCAT(result, ' | ', VALUES(result)))
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
    updated_count: totalUpdated,
    note: noteText,
  });
}
