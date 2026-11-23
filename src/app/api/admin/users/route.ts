import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const pool = getPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, username, display_name, role, approved, active,
            DATE_FORMAT(last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM users
     ORDER BY id ASC`
  );
  return NextResponse.json({ users: rows });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    username?: string;
    display_name?: string;
    password?: string;
    role?: string;
    approved?: boolean;
  };

  const username = String(body.username ?? "").trim().toLowerCase();
  const displayName = String(body.display_name ?? "").trim();
  const password = String(body.password ?? "");
  const role = body.role === "master_admin" ? "master_admin" : "viewer";
  const approved = body.approved !== false ? 1 : 0;

  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }
  if (!displayName || displayName.length > 100) {
    return NextResponse.json({ error: "invalid_display_name" }, { status: 400 });
  }
  if (password.length < 10 || password.length > 128) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 10);
  const pool = getPool();
  try {
    await pool.execute(
      `INSERT INTO users (username, display_name, password_hash, role, approved, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [username, displayName, hash, role, approved]
    );
    return NextResponse.json({ ok: true, username }, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "username_exists" }, { status: 409 });
    }
    throw err;
  }
}
