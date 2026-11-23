import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { hexToBuffer32 } from "@/lib/ip-utils";
import { parseScammerCasesXlsx } from "@/lib/matching/scammer-cases";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const cases = await parseScammerCasesXlsx(buf, file.name);
  const pool = getPool();

  const values = cases.map((c) => [
    hexToBuffer32(c.source_id),
    c.inst_id.slice(0, 100),
    c.data_id.slice(0, 100),
    c.tracking_code.slice(0, 100),
    c.reported_date,
    c.team.slice(0, 100),
    c.platform,
    c.platform_url.slice(0, 1000),
    c.normalized_url.slice(0, 500),
    c.account_name.slice(0, 255),
    "Scammer",
    c.tracking_status.slice(0, 150),
    c.replied_at.slice(0, 100),
    c.tpo_code.slice(0, 100),
    c.note || null,
    c.source_filename.slice(0, 255),
    c.source_row,
  ]);

  for (let i = 0; i < values.length; i += 500) {
    await pool.query(
      `INSERT INTO cases (
         source_id, inst_id, data_id, tracking_code, reported_date, team, platform,
         platform_url, normalized_url, account_name, scammer_case, tracking_status,
         replied_at, tpo_code, note, source_filename, source_row
       ) VALUES ?
       ON DUPLICATE KEY UPDATE
         tracking_status = VALUES(tracking_status),
         replied_at = VALUES(replied_at),
         note = VALUES(note)`,
      [values.slice(i, i + 500)]
    );
  }

  return NextResponse.json({ ok: true, imported: cases.length });
}
