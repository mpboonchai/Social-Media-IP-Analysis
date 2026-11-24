import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { hexToBuffer32 } from "@/lib/ip-utils";
import { invalidateEventsStatsCache } from "@/lib/events-cache";
import { generateSubpoenaDocx, type SubpoenaEventItem } from "@/lib/subpoena/docx-generator";
import {
  buildDestinationForPlatforms,
  getIspShortCode,
  isAisOrTrueDtac,
  matchIspContact,
  renderEmailDraft,
  type IspContactRow,
} from "@/lib/subpoena/matcher";

export const maxDuration = 60;

interface GenerateBody {
  record_keys: string[];
  mode?: "preview" | "commit";
  letter_prefix?: string;
  start_number?: number;
  issue_date?: string; // YYYY-MM-DD
  due_date?: string; // YYYY-MM-DD
  case_summary?: string;
  contact_name?: string;
  contact_position?: string;
  contact_phone?: string;
  contact_email?: string;
  update_status?: boolean; // default true on commit
}

function sanitizeFilePart(s: string): string {
  return String(s || "ISP")
    .replace(/[^0-9A-Za-zก-๙._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

async function getNextSuggestedLetterNumber(pool: mysql.Pool, prefix: string): Promise<number> {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT letter_number FROM ip_request_tracking WHERE letter_number LIKE ? ORDER BY ip_event_id DESC LIMIT 2000`,
    [`${prefix}%`]
  );
  let maxNum = 1000;
  const re = new RegExp(`^${escapedPrefix}(\\d+)`);
  for (const r of rows) {
    const m = String(r.letter_number || "").trim().match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxNum && n < 999999) maxNum = n;
    }
  }
  return maxNum + 1;
}

export async function POST(req: NextRequest) {
  try {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as GenerateBody | null;
  if (!body || !Array.isArray(body.record_keys) || body.record_keys.length === 0) {
    return NextResponse.json({ error: "กรุณาเลือกรายการ IP อย่างน้อย 1 รายการ" }, { status: 400 });
  }

  const uniqueHexKeys = [...new Set(body.record_keys.map((k) => String(k || "").trim().toLowerCase()).filter((k) => /^[0-9a-f]{64}$/.test(k)))];
  if (!uniqueHexKeys.length) {
    return NextResponse.json({ error: "ไม่พบ record_key ที่ถูกต้อง" }, { status: 400 });
  }
  if (uniqueHexKeys.length > 1000) {
    return NextResponse.json({ error: "รองรับสูงสุด 1,000 รายการต่อครั้ง" }, { status: 400 });
  }

  const mode = body.mode === "commit" ? "commit" : "preview";
  const letterPrefix = String(body.letter_prefix || "ตช. 0026.(12)2/").trim();
  const todayIso = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const issueDate = String(body.issue_date || todayIso).slice(0, 10);
  const defaultDue = new Date(Date.parse(issueDate + "T00:00:00Z") + 7 * 86_400_000).toISOString().slice(0, 10);
  const dueDate = String(body.due_date || defaultDue).slice(0, 10);
  const caseSummary = String(
    body.case_summary || "การกระทำความผิดเกี่ยวกับการฉ้อโกงทางออนไลน์ (หลอกลวงขายสินค้า/บริการทางออนไลน์)"
  ).trim();
  const contactName = String(body.contact_name || "ร้อยตำรวจเอก บุญชัย ถิรภัทรไพบูลย์").trim();
  const contactPosition = String(body.contact_position || "รองสารวัตร กก.2 บก.ปอท.").trim();
  const contactPhone = String(body.contact_phone || "0874427676").trim();
  const contactEmail = String(body.contact_email || "pct.asc.phone@cib.go.th").trim();
  const shouldUpdateStatus = body.update_status !== false;

  const pool = getPool();

  // 1. Load ISP contacts directory
  const [contactRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, provider_code, provider_name, category, is_thai_isp, recipient, email_recipient,
            head_office_address, aliases, primary_channel, email_to, email_cc,
            email_subject_template, email_body_template, language, notes
     FROM isp_contacts
     ORDER BY is_thai_isp DESC, id ASC`
  );
  const contacts: IspContactRow[] = contactRows.map((r) => ({
    id: Number(r.id),
    provider_code: String(r.provider_code || ""),
    provider_name: String(r.provider_name || ""),
    category: String(r.category || ""),
    is_thai_isp: Number(r.is_thai_isp || 0),
    recipient: String(r.recipient || ""),
    email_recipient: String(r.email_recipient || ""),
    head_office_address: String(r.head_office_address || ""),
    aliases: String(r.aliases || ""),
    primary_channel: String(r.primary_channel || ""),
    email_to: String(r.email_to || ""),
    email_cc: String(r.email_cc || ""),
    email_subject_template: String(r.email_subject_template || ""),
    email_body_template: String(r.email_body_template || ""),
    language: String(r.language || "TH"),
    notes: String(r.notes || ""),
  }));

  // 2. Load selected IP events
  const keyBufs = uniqueHexKeys.map((k) => hexToBuffer32(k));
  const [eventRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT e.id, LOWER(HEX(e.record_key)) AS record_key, e.platform, e.port,
            DATE_FORMAT(e.event_local, '%Y-%m-%d %H:%i:%s') AS local_time,
            INET6_NTOA(e.ip_bin) AS ip,
            COALESCE(r.network_name, '') AS network,
            COALESCE(r.owner_name, '') AS owner,
            COALESCE(r.country, '') AS country,
            COALESCE(sa.account_name, '') AS account,
            e.no_ip_data
     FROM ip_events e
     JOIN social_accounts sa ON sa.id = e.account_id
     LEFT JOIN rdap_networks r ON r.id = e.rdap_network_id
     WHERE e.record_key IN (?)`,
    [keyBufs]
  );

  const validRows = eventRows.filter((r) => !Number(r.no_ip_data) && r.ip && r.local_time);
  if (!validRows.length) {
    return NextResponse.json(
      { error: "รายการที่เลือกไม่มีข้อมูล IP หรือเวลาที่สามารถออกหมายเรียกได้" },
      { status: 400 }
    );
  }

  // 3. Determine starting sequence number
  const suggestedStart = await getNextSuggestedLetterNumber(pool, letterPrefix);
  const startNum =
    typeof body.start_number === "number" && Number.isFinite(body.start_number) && body.start_number >= 1
      ? Math.floor(body.start_number)
      : suggestedStart;

  // 4. Group selected IP events by matched ISP
  interface GroupBucket {
    group_key: string;
    contact: IspContactRow | null;
    display_name: string;
    recipient: string;
    address: string;
    event_ids: number[];
    record_keys: string[];
    platforms: Set<string>;
    accounts: Set<string>;
    events: SubpoenaEventItem[];
  }

  const groupMap = new Map<string, GroupBucket>();
  for (const r of validRows) {
    const net = String(r.network || "").trim();
    const own = String(r.owner || "").trim();
    const matched = matchIspContact(contacts, net, own);
    const gKey = matched ? matched.provider_code : `RAW:${net || own || "UNKNOWN"}`;

    let bucket = groupMap.get(gKey);
    if (!bucket) {
      const displayName = matched ? matched.provider_name : net || own || "ไม่ระบุผู้ให้บริการ";
      bucket = {
        group_key: gKey,
        contact: matched,
        display_name: displayName,
        recipient: matched?.recipient || `กรรมการผู้จัดการ ${displayName}`,
        address: matched?.head_office_address || "-",
        event_ids: [],
        record_keys: [],
        platforms: new Set<string>(),
        accounts: new Set<string>(),
        events: [],
      };
      groupMap.set(gKey, bucket);
    }

    bucket.event_ids.push(Number(r.id));
    bucket.record_keys.push(String(r.record_key));
    if (r.platform) bucket.platforms.add(String(r.platform));
    if (r.account) bucket.accounts.add(String(r.account));
    bucket.events.push({
      ip: String(r.ip),
      port: r.port !== null && r.port !== undefined && Number(r.port) > 0 ? String(r.port) : "",
      local_time: String(r.local_time),
    });
  }

  // Sort groups: Thai ISPs first, then by event count descending
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const ta = a.contact?.is_thai_isp ?? 0;
    const tb = b.contact?.is_thai_isp ?? 0;
    if (tb !== ta) return tb - ta;
    return b.events.length - a.events.length;
  });

  // 5. Build previews (and DOCX + ZIP + DB updates on commit)
  const zipOut = mode === "commit" ? new JSZip() : null;
  const results: Array<{
    group_key: string;
    provider_code: string;
    provider_name: string;
    is_thai_isp: boolean;
    matched_preset: boolean;
    letter_no: string;
    docx_filename: string;
    recipient: string;
    address: string;
    event_count: number;
    accounts: string[];
    platforms: string[];
    email: ReturnType<typeof renderEmailDraft>;
  }> = [];

  let totalDbUpdated = 0;

  const issueYearMatch = issueDate.match(/^(\d{4})-/);
  const thaiYear2Digit = String(((issueYearMatch ? Number(issueYearMatch[1]) : new Date().getFullYear()) + 543) % 100).padStart(2, "0");

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const seqNo = startNum + i;
    const letterNo = `${letterPrefix}${seqNo}`;
    const platformsArr = Array.from(g.platforms);
    const destination = buildDestinationForPlatforms(platformsArr);
    const ispShort = getIspShortCode(g.contact, g.display_name);
    const docxFilename = `TCSD2_${thaiYear2Digit}-${seqNo}_${ispShort}.docx`;
    const includeTrafficLog90d = !isAisOrTrueDtac(g.contact?.provider_code, g.display_name);

    const email = renderEmailDraft({
      contact: g.contact,
      fallbackName: g.display_name,
      letter_no: letterNo,
      issue_date: issueDate,
      due_date: dueDate,
      case_summary: caseSummary,
      platforms: platformsArr,
      destination,
      contact_name: contactName,
      contact_position: contactPosition,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      events: g.events,
    });

    if (mode === "commit" && zipOut) {
      const docxBuf = await generateSubpoenaDocx({
        letter_no: letterNo,
        issue_date: issueDate,
        recipient: g.recipient,
        address: g.address,
        case_summary: caseSummary,
        destination,
        contact_name: contactName,
        contact_position: contactPosition,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        include_traffic_log_90d: includeTrafficLog90d,
        events: g.events,
      });
      zipOut.file(docxFilename, docxBuf);

      // Automatically tick "ขอข้อมูลแล้ว" (requested = 1) + assign auto letter_number in TiDB
      if (shouldUpdateStatus && g.event_ids.length > 0) {
        const values = g.event_ids.map((id) => [id, 1, letterNo, user.username]);
        for (let c = 0; c < values.length; c += 500) {
          const chunk = values.slice(c, c + 500);
          await pool.query(
            `INSERT INTO ip_request_tracking (ip_event_id, requested, letter_number, updated_by)
             VALUES ?
             ON DUPLICATE KEY UPDATE
               requested = 1,
               letter_number = VALUES(letter_number),
               updated_by = VALUES(updated_by)`,
            [chunk]
          );
        }
        totalDbUpdated += g.event_ids.length;
      }
    }

    results.push({
      group_key: g.group_key,
      provider_code: g.contact?.provider_code || "UNMATCHED",
      provider_name: g.display_name,
      is_thai_isp: Boolean(g.contact?.is_thai_isp),
      matched_preset: Boolean(g.contact),
      letter_no: letterNo,
      docx_filename: docxFilename,
      recipient: g.recipient,
      address: g.address,
      event_count: g.events.length,
      accounts: Array.from(g.accounts).slice(0, 10),
      platforms: platformsArr,
      email,
    });
  }

  let zipBase64: string | null = null;
  let zipFilename: string | null = null;

  if (mode === "commit" && zipOut) {
    // Also include a summary Email_Drafts.txt inside the ZIP for convenience
    const emailTxt = results
      .map(
        (r, idx) =>
          `==================== [${idx + 1}] ${r.provider_name} (${r.letter_no}) ====================\n` +
          `ไฟล์แนบ: ${r.docx_filename}\n` +
          `To: ${r.email.to || "(โปรดระบุอีเมลปลายทาง)"}\n` +
          `CC: ${r.email.cc || "-"}\n` +
          `Subject: ${r.email.subject}\n\n` +
          `${r.email.body}\n`
      )
      .join("\n\n");
    zipOut.file("Email_Drafts_All_ISPs.txt", emailTxt);

    const zipBuf = await zipOut.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    zipBase64 = zipBuf.toString("base64");
    zipFilename = `Subpoena_Batch_${issueDate}_${results.length}ISP.zip`;

    if (totalDbUpdated > 0) {
      invalidateEventsStatsCache();
    }
  }

  return NextResponse.json({
    ok: true,
    mode,
    suggested_start_number: suggestedStart,
    start_number: startNum,
    letter_prefix: letterPrefix,
    issue_date: issueDate,
    due_date: dueDate,
    total_selected: validRows.length,
    total_letters: results.length,
    updated_events: totalDbUpdated,
    zip_filename: zipFilename,
    zip_base64: zipBase64,
    letters: results,
  });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
