import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { hexToBuffer32 } from "@/lib/ip-utils";
import { invalidateEventsStatsCache } from "@/lib/events-cache";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ recordKey: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { recordKey } = await context.params;
  const keyBuf = hexToBuffer32(recordKey);
  if (!keyBuf) return NextResponse.json({ error: "invalid_record_key" }, { status: 400 });

  const body = (await req.json()) as Record<string, unknown>;
  const pool = getPool();

  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM ip_events WHERE record_key = ? LIMIT 1`,
    [keyBuf]
  );
  if (!rows.length) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const eventId = Number(rows[0].id);

  await pool.execute(
    `INSERT INTO ip_request_tracking (
       ip_event_id, unavailable, requested, replied, received, no_ip_request_needed,
       letter_number, result, entity_user_id, entity_name, entity_country,
       entity_address, entity_email, entity_phone, entity_payment, entity_account_no, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       unavailable = VALUES(unavailable),
       requested = VALUES(requested),
       replied = VALUES(replied),
       received = VALUES(received),
       no_ip_request_needed = VALUES(no_ip_request_needed),
       letter_number = VALUES(letter_number),
       result = VALUES(result),
       entity_user_id = VALUES(entity_user_id),
       entity_name = VALUES(entity_name),
       entity_country = VALUES(entity_country),
       entity_address = VALUES(entity_address),
       entity_email = VALUES(entity_email),
       entity_phone = VALUES(entity_phone),
       entity_payment = VALUES(entity_payment),
       entity_account_no = VALUES(entity_account_no),
       updated_by = VALUES(updated_by)`,
    [
      eventId,
      body.unavailable ? 1 : 0,
      body.requested ? 1 : 0,
      body.replied ? 1 : 0,
      body.received ? 1 : 0,
      body.no_ip_request_needed ? 1 : 0,
      String(body.letter_number ?? "").slice(0, 100),
      body.result ? String(body.result) : null,
      String(body.entity_user_id ?? "").slice(0, 250),
      String(body.entity_name ?? "").slice(0, 500),
      String(body.entity_country ?? "").slice(0, 250),
      String(body.entity_address ?? "").slice(0, 2000),
      String(body.entity_email ?? "").slice(0, 500),
      String(body.entity_phone ?? "").slice(0, 250),
      String(body.entity_payment ?? "").slice(0, 1000),
      String(body.entity_account_no ?? "").slice(0, 500),
      user.username,
    ]
  );

  invalidateEventsStatsCache();
  return NextResponse.json({ ok: true });
}
