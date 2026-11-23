import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, signSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = (await req.json()) as { username?: string; password?: string };
    const cleanUser = String(username ?? "").trim();
    const rawPass = String(password ?? "");
    if (!cleanUser || !rawPass) {
      return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
    }

    const pool = getPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, username, display_name, password_hash, role, approved, active, failed_attempts, locked_until
       FROM users WHERE username = ? LIMIT 1`,
      [cleanUser]
    );
    const user = rows[0];
    if (!user || !user.approved || !user.active) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return NextResponse.json({ error: "account_locked" }, { status: 423 });
    }

    const valid = await bcrypt.compare(rawPass, String(user.password_hash));
    if (!valid) {
      const attempts = Number(user.failed_attempts || 0) + 1;
      const lockClause = attempts >= 5 ? ", locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE)" : "";
      await pool.execute(`UPDATE users SET failed_attempts = ? ${lockClause} WHERE id = ?`, [attempts, user.id]);
      return NextResponse.json(
        { error: attempts >= 5 ? "account_locked" : "invalid_credentials" },
        { status: attempts >= 5 ? 423 : 401 }
      );
    }

    await pool.execute(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?`,
      [user.id]
    );

    const sessionUser = {
      id: Number(user.id),
      username: String(user.username),
      display_name: String(user.display_name),
      role: (user.role === "master_admin" ? "master_admin" : "viewer") as "master_admin" | "viewer",
    };

    const res = NextResponse.json({ ok: true, user: sessionUser });
    res.cookies.set(SESSION_COOKIE_NAME, signSession(sessionUser), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
