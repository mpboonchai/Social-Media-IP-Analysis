import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const search = (sp.get("search") || "").trim();
  const platform = (sp.get("platform") || "").trim();
  const team = (sp.get("team") || "").trim();

  const where: string[] = [];
  const params: unknown[] = [];

  if (platform) {
    where.push(`platform = ?`);
    params.push(platform);
  }
  if (team) {
    where.push(`team = ?`);
    params.push(team);
  }
  if (search) {
    const like = `%${search}%`;
    where.push(
      `(inst_id LIKE ? OR data_id LIKE ? OR tracking_code LIKE ? OR tpo_code LIKE ? OR account_name LIKE ? OR platform_url LIKE ? OR note LIKE ?)`
    );
    params.push(like, like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getPool();

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       id,
       inst_id,
       data_id,
       tracking_code,
       DATE_FORMAT(reported_date, '%Y-%m-%d') AS heppen_date,
       team,
       platform,
       platform_url,
       account_name,
       tracking_status,
       replied_at,
       tpo_code,
       note,
       response_account
     FROM cases
     ${whereSql}
     ORDER BY id DESC`,
    params
  );

  return NextResponse.json({
    total: rows.length,
    cases: rows,
  });
}
