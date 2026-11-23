import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ username: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { username } = await context.params;
  const cleanUser = decodeURIComponent(username).trim().toLowerCase();
  const body = (await req.json()) as {
    approved?: boolean;
    active?: boolean;
    role?: string;
    password?: string;
  };

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (typeof body.approved === "boolean") {
    updates.push("approved = ?");
    params.push(body.approved ? 1 : 0);
  }
  if (typeof body.active === "boolean") {
    if (cleanUser === user.username && !body.active) {
      return NextResponse.json({ error: "cannot_disable_self" }, { status: 400 });
    }
    updates.push("active = ?");
    params.push(body.active ? 1 : 0);
  }
  if (body.role === "master_admin" || body.role === "viewer") {
    updates.push("role = ?");
    params.push(body.role);
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 10 || body.password.length > 128) {
      return NextResponse.json({ error: "password_too_short" }, { status: 400 });
    }
    const hash = await bcrypt.hash(body.password, 10);
    updates.push("password_hash = ?, failed_attempts = 0, locked_until = NULL");
    params.push(hash);
  }

  if (!updates.length) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }

  const pool = getPool();
  const [res] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE users SET ${updates.join(", ")} WHERE username = ?`,
    [...params, cleanUser]
  );
  if (res.affectedRows === 0) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
