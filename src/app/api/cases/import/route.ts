import { NextRequest, NextResponse } from "next/server";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { hexToBuffer32 } from "@/lib/ip-utils";
import {
  extractTargetFromUrl,
  normalizeSocialUrl,
  parseScammerCasesXlsx,
} from "@/lib/matching/scammer-cases";
import { invalidateEventsStatsCache } from "@/lib/events-cache";

interface CaseLite {
  inst_id: string;
  tpo_code: string;
  reported_date: string;
  team: string;
  platform: string;
  platform_url: string;
  normalized_url: string;
  resolved_url: string;
  account_name: string;
  response_account: string;
}

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
  if (!cases.length) {
    return NextResponse.json({ error: "ไม่พบข้อมูลเคสในไฟล์ Excel (กรุณาตรวจสอบรูปแบบ url_cases (Scammer).xlsx)" }, { status: 400 });
  }

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

  let casesUpserted = 0;
  for (let i = 0; i < values.length; i += 500) {
    const [res] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO cases (
         source_id, inst_id, data_id, tracking_code, reported_date, team, platform,
         platform_url, normalized_url, account_name, scammer_case, tracking_status,
         replied_at, tpo_code, note, source_filename, source_row
       ) VALUES ?
       ON DUPLICATE KEY UPDATE
         inst_id = VALUES(inst_id),
         tpo_code = VALUES(tpo_code),
         reported_date = VALUES(reported_date),
         team = VALUES(team),
         account_name = VALUES(account_name),
         platform_url = VALUES(platform_url),
         normalized_url = VALUES(normalized_url),
         tracking_status = VALUES(tracking_status),
         replied_at = VALUES(replied_at),
         note = VALUES(note)`,
      [values.slice(i, i + 500)]
    );
    casesUpserted += Number(res.affectedRows || 0);
  }

  // Re-correlate all social_accounts against the updated cases table and update ip_events!
  const [allCaseRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT inst_id, tpo_code, DATE_FORMAT(reported_date, '%Y-%m-%d') AS reported_date,
            team, platform, platform_url, normalized_url, resolved_url, account_name, response_account
     FROM cases`
  );
  const allCases: CaseLite[] = allCaseRows.map((c) => ({
    inst_id: String(c.inst_id || ""),
    tpo_code: String(c.tpo_code || ""),
    reported_date: String(c.reported_date || ""),
    team: String(c.team || ""),
    platform: String(c.platform || ""),
    platform_url: String(c.platform_url || ""),
    normalized_url: String(c.normalized_url || ""),
    resolved_url: String(c.resolved_url || ""),
    account_name: String(c.account_name || ""),
    response_account: String(c.response_account || ""),
  }));

  // Build token -> CaseLite[] lookup index for O(1) matching
  const tokenIndex = new Map<string, CaseLite[]>();
  const addToken = (raw: string, c: CaseLite) => {
    const t = String(raw || "").trim().toLowerCase().replace(/^@/, "");
    if (t.length < 2) return;
    let arr = tokenIndex.get(t);
    if (!arr) {
      arr = [];
      tokenIndex.set(t, arr);
    }
    arr.push(c);
  };

  for (const c of allCases) {
    addToken(c.account_name, c);
    addToken(c.response_account, c);
    addToken(c.normalized_url, c);
    addToken(extractTargetFromUrl(c.platform_url), c);
    addToken(extractTargetFromUrl(c.resolved_url), c);
  }

  const [accRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, platform, account_identifier, account_name, target_id FROM social_accounts`
  );

  let matchedAccounts = 0;
  let updatedEvents = 0;

  for (const acc of accRows) {
    const accId = Number(acc.id);
    const accPlat = String(acc.platform || "").toLowerCase();
    const candidates = new Set<CaseLite>();
    const accTokens = [
      String(acc.account_name || ""),
      String(acc.target_id || ""),
      String(acc.account_identifier || ""),
      normalizeSocialUrl(String(acc.account_name || "")),
      extractTargetFromUrl(String(acc.account_name || "")),
    ]
      .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
      .filter((s) => s.length >= 2);

    for (const t of accTokens) {
      const hits = tokenIndex.get(t);
      if (!hits) continue;
      for (const c of hits) {
        const cp = c.platform.toLowerCase();
        if (accPlat === "tiktok" && cp && !cp.includes("tiktok")) continue;
        if ((accPlat === "facebook" || accPlat === "instagram") && cp.includes("tiktok")) continue;
        candidates.add(c);
      }
    }

    if (!candidates.size) continue;
    matchedAccounts++;

    const list = Array.from(candidates);
    const instIds = [...new Set(list.map((c) => c.inst_id).filter(Boolean))].join(" / ").slice(0, 100);
    const tpoCodes = [...new Set(list.map((c) => c.tpo_code).filter(Boolean))].join(" / ").slice(0, 100);
    const reportedDates = [...new Set(list.map((c) => c.reported_date).filter(Boolean))];
    const reportedDateStr = reportedDates.join(" / ").slice(0, 100);
    const teams = [...new Set(list.map((c) => c.team).filter(Boolean))].join(" / ").slice(0, 100);

    // Update ip_events for this matched account where metadata differs
    const windowSql = reportedDates.length
      ? `CASE WHEN ${reportedDates.map(() => `ABS(DATEDIFF(DATE(event_local), ?)) <= 3`).join(" OR ")} THEN 1 ELSE 0 END`
      : `0`;

    const [upRes] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE ip_events
       SET inst_id = ?,
           tpo_code = ?,
           scammer_case = 'Scammer',
           reported_date = ?,
           team = ?,
           case_window_match = ${windowSql}
       WHERE account_id = ?
         AND (
           scammer_case <> 'Scammer'
           OR inst_id <> ?
           OR tpo_code <> ?
           OR reported_date <> ?
           OR team <> ?
         )`,
      [
        instIds,
        tpoCodes,
        reportedDateStr,
        teams,
        ...reportedDates,
        accId,
        instIds,
        tpoCodes,
        reportedDateStr,
        teams,
      ]
    );
    updatedEvents += Number(upRes.affectedRows || 0);
  }

  invalidateEventsStatsCache();

  return NextResponse.json({
    ok: true,
    imported_cases: cases.length,
    cases_changed: casesUpserted,
    matched_accounts: matchedAccounts,
    updated_events: updatedEvents,
  });
}
