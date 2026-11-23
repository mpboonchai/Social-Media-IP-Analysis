import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const platform = (req.nextUrl.searchParams.get("platform") || "").trim();
  const search = (req.nextUrl.searchParams.get("search") || "").trim();
  const where: string[] = [];
  const params: unknown[] = [];

  if (platform) {
    where.push("platform = ?");
    params.push(platform);
  }
  if (search) {
    const like = `%${search}%`;
    where.push("(account_name LIKE ? OR account_identifier LIKE ?)");
    params.push(like, like);
  }

  const pool = getPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, platform, account_identifier, account_name, is_completed, complete_reason
     FROM social_accounts
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY account_name ASC
     LIMIT 300`,
    params
  );
  return NextResponse.json({ accounts: rows });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    platform?: string;
    account_id?: number;
    reason?: string;
  };

  const accountId = Number(body.account_id);
  const reason =
    String(body.reason ?? "").trim().slice(0, 1000) ||
    "ได้รับข้อมูลบัญชีครบถ้วนแล้ว ไม่ต้องขอข้อมูล IP เพิ่ม";

  if (!Number.isFinite(accountId) || accountId <= 0) {
    return NextResponse.json({ error: "invalid_account_id" }, { status: 400 });
  }

  const pool = getPool();
  const [accRows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id, platform, account_name FROM social_accounts WHERE id = ? LIMIT 1`,
    [accountId]
  );
  if (!accRows.length) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }

  await pool.execute(
    `UPDATE social_accounts
     SET is_completed = 1, complete_reason = ?, completed_at = NOW()
     WHERE id = ?`,
    [reason, accountId]
  );

  // Mark all untouched events for this account as no_ip_request_needed = 1
  const [insertRes] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO ip_request_tracking (ip_event_id, no_ip_request_needed, result, updated_by)
     SELECT e.id, 1, ?, ?
     FROM ip_events e
     LEFT JOIN ip_request_tracking t ON t.ip_event_id = e.id
     WHERE e.account_id = ?
       AND e.no_ip_data = 0
       AND (
         t.ip_event_id IS NULL OR (
           t.unavailable = 0 AND t.requested = 0 AND t.replied = 0 AND t.received = 0
           AND t.letter_number = '' AND (t.result IS NULL OR t.result = '')
           AND t.entity_name = '' AND t.entity_user_id = ''
         )
       )
     ON DUPLICATE KEY UPDATE
       no_ip_request_needed = 1,
       result = IF(result IS NULL OR result = '', VALUES(result), result),
       updated_by = VALUES(updated_by)`,
    [reason, user.username, accountId]
  );

  return NextResponse.json({
    ok: true,
    platform: accRows[0].platform,
    account: accRows[0].account_name,
    updated_records: insertRes.affectedRows,
    reason,
  });
}
