import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = getPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, status, phase, progress_percent, message,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM sync_jobs
     ORDER BY id DESC LIMIT 1`
  );
  return NextResponse.json({ job: rows[0] || null });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const pool = getPool();
  const [res] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO sync_jobs (status, phase, progress_percent, message, requested_by)
     VALUES ('queued', 'queued', 0, 'ส่งคำขอซิงค์สามทางแล้ว · รอ Sync Agent รับงาน', ?)`,
    [user.id]
  );

  return NextResponse.json({
    ok: true,
    job: {
      id: res.insertId,
      status: "queued",
      phase: "queued",
      progress_percent: 0,
      message: "ส่งคำขอซิงค์สามทางแล้ว · รอ Sync Agent รับงาน",
    },
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    id?: number;
    status?: string;
    phase?: string;
    progress_percent?: number;
    message?: string;
  };
  if (!body.id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const pool = getPool();
  await pool.execute(
    `UPDATE sync_jobs
     SET status = COALESCE(?, status),
         phase = COALESCE(?, phase),
         progress_percent = COALESCE(?, progress_percent),
         message = COALESCE(?, message)
     WHERE id = ?`,
    [
      body.status ?? null,
      body.phase ?? null,
      body.progress_percent ?? null,
      body.message ?? null,
      body.id,
    ]
  );
  return NextResponse.json({ ok: true });
}
