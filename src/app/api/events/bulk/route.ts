import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { hexToBuffer32 } from "@/lib/ip-utils";
import { invalidateEventsStatsCache } from "@/lib/events-cache";

interface BulkRowUpdate {
  record_key: string;
  unavailable?: boolean;
  requested?: boolean;
  replied?: boolean;
  received?: boolean;
  no_ip_request_needed?: boolean;
  letter_number?: string;
  result?: string;
  entity_name?: string;
  entity_phone?: string;
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as { updates?: BulkRowUpdate[] };
  const updates = Array.isArray(body.updates) ? body.updates.slice(0, 200) : [];
  if (!updates.length) {
    return NextResponse.json({ error: "no_updates" }, { status: 400 });
  }

  const pool = getPool();
  const keyBufs = updates
    .map((u) => hexToBuffer32(u.record_key))
    .filter((b): b is Buffer => b !== null);

  if (!keyBufs.length) {
    return NextResponse.json({ error: "invalid_record_keys" }, { status: 400 });
  }

  const [evRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, LOWER(HEX(record_key)) AS rk FROM ip_events WHERE record_key IN (?)`,
    [keyBufs]
  );
  const idByKey = new Map<string, number>();
  for (const r of evRows) {
    idByKey.set(String(r.rk), Number(r.id));
  }

  const values: unknown[][] = [];
  for (const u of updates) {
    const evId = idByKey.get(u.record_key.toLowerCase());
    if (!evId) continue;
    values.push([
      evId,
      u.unavailable ? 1 : 0,
      u.requested ? 1 : 0,
      u.replied ? 1 : 0,
      u.received ? 1 : 0,
      u.no_ip_request_needed ? 1 : 0,
      String(u.letter_number ?? "").slice(0, 100),
      u.result ? String(u.result) : null,
      String(u.entity_name ?? "").slice(0, 500),
      String(u.entity_phone ?? "").slice(0, 250),
      user.username,
    ]);
  }

  if (values.length) {
    await pool.query(
      `INSERT INTO ip_request_tracking (
         ip_event_id, unavailable, requested, replied, received, no_ip_request_needed,
         letter_number, result, entity_name, entity_phone, updated_by
       ) VALUES ?
       ON DUPLICATE KEY UPDATE
         unavailable = VALUES(unavailable),
         requested = VALUES(requested),
         replied = VALUES(replied),
         received = VALUES(received),
         no_ip_request_needed = VALUES(no_ip_request_needed),
         letter_number = VALUES(letter_number),
         result = VALUES(result),
         entity_name = VALUES(entity_name),
         entity_phone = VALUES(entity_phone),
         updated_by = VALUES(updated_by)`,
      [values]
    );
  }

  invalidateEventsStatsCache();
  return NextResponse.json({ ok: true, updated: values.length });
}
