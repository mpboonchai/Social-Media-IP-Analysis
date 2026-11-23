import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { hexToBuffer32 } from "@/lib/ip-utils";
import { invalidateEventsStatsCache } from "@/lib/events-cache";

function toBoolFlag(v: unknown): number {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "0" || s === "false" || s === "no" || s === "ไม่") return 0;
  return 1;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "").trim();
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "").trim();
  return String(v).trim();
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "master_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws = wb.getWorksheet("IP Events") || wb.worksheets[0];
  if (!ws) {
    return NextResponse.json({ error: "empty_workbook" }, { status: 400 });
  }

  // Detect header row (row 1 or row 3 as in Social_Media_IP_Analysis-Ex.xlsx)
  let headerRowIdx = 1;
  const headerMap = new Map<string, number>();
  for (const candidateRow of [1, 2, 3]) {
    if (candidateRow > ws.rowCount) break;
    const temp = new Map<string, number>();
    ws.getRow(candidateRow).eachCell((cell, colNumber) => {
      temp.set(cellText(cell).toLowerCase(), colNumber);
    });
    if (temp.has("record_key") || temp.has("record key")) {
      headerRowIdx = candidateRow;
      temp.forEach((v, k) => headerMap.set(k, v));
      break;
    }
  }

  const colOf = (...names: string[]) => {
    for (const n of names) {
      const idx = headerMap.get(n.toLowerCase());
      if (idx) return idx;
    }
    return 0;
  };

  const cKey = colOf("record_key", "record key");
  if (!cKey) {
    return NextResponse.json(
      { error: "ไม่พบคอลัมน์ Record Key / record_key ในไฟล์ Excel" },
      { status: 400 }
    );
  }

  const cUnavailable = colOf("ขอข้อมูลไม่ได้", "unavailable");
  const cRequested = colOf("ขอข้อมูลแล้ว", "requested");
  const cReplied = colOf("ตอบกลับแล้ว", "replied");
  const cReceived = colOf("ได้รับข้อมูลแล้ว", "received");
  const cNoIpNeeded = colOf("ไม่ต้องขอข้อมูล ip", "ไม่ต้องขอ ip", "no_ip_request_needed");
  const cLetter = colOf("เลขหนังสือ", "letter_number");
  const cResult = colOf("ผลลัพธ์", "ผลลัพธ์ / หมายเหตุ", "result");
  const cEntityUserId = colOf("user id", "entity_user_id");
  const cEntityName = colOf("name", "ชื่อผู้จดทะเบียน / entity", "ชื่อผู้จดทะเบียน", "entity_name");
  const cEntityCountry = colOf("entity country", "entity_country");
  const cEntityAddress = colOf("address", "ที่อยู่ entity", "entity_address");
  const cEntityEmail = colOf("email", "อีเมล entity", "entity_email");
  const cEntityPhone = colOf("phone", "เบอร์โทร", "entity_phone");
  const cEntityPayment = colOf("payment", "entity_payment");
  const cEntityAccountNo = colOf("account no.", "entity_account_no");
  const cAccessService = colOf("service", "access_service");
  const cAccessDt = colOf("access datetime (utc+7)", "access_datetime_local");
  const cAccessIp = colOf("access ip", "access_ip");
  const cAccessPort = colOf("remote port", "access_remote_port");
  const cAccessCountry = colOf("access ip country", "access_ip_country");
  const cAccessNetwork = colOf("access network", "access_network");
  const cAccessIsp = colOf("access isp", "access_isp");

  interface ParsedRow {
    record_key: string;
    unavailable: number;
    requested: number;
    replied: number;
    received: number;
    no_ip_request_needed: number;
    letter_number: string;
    result: string;
    entity_user_id: string;
    entity_name: string;
    entity_country: string;
    entity_address: string;
    entity_email: string;
    entity_phone: string;
    entity_payment: string;
    entity_account_no: string;
    access_service: string;
    access_datetime_local: string;
    access_ip: string;
    access_remote_port: string;
    access_ip_country: string;
    access_network: string;
    access_isp: string;
  }

  const parsed: ParsedRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIdx) return;
    const rk = cellText(row.getCell(cKey)).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(rk)) return;

    const getStr = (c: number, maxLen: number) => (c ? cellText(row.getCell(c)).slice(0, maxLen) : "");
    const item: ParsedRow = {
      record_key: rk,
      unavailable: cUnavailable ? toBoolFlag(cellText(row.getCell(cUnavailable))) : 0,
      requested: cRequested ? toBoolFlag(cellText(row.getCell(cRequested))) : 0,
      replied: cReplied ? toBoolFlag(cellText(row.getCell(cReplied))) : 0,
      received: cReceived ? toBoolFlag(cellText(row.getCell(cReceived))) : 0,
      no_ip_request_needed: cNoIpNeeded ? toBoolFlag(cellText(row.getCell(cNoIpNeeded))) : 0,
      letter_number: getStr(cLetter, 100),
      result: cResult ? cellText(row.getCell(cResult)) : "",
      entity_user_id: getStr(cEntityUserId, 250),
      entity_name: getStr(cEntityName, 500),
      entity_country: getStr(cEntityCountry, 250),
      entity_address: getStr(cEntityAddress, 2000),
      entity_email: getStr(cEntityEmail, 500),
      entity_phone: getStr(cEntityPhone, 250),
      entity_payment: getStr(cEntityPayment, 1000),
      entity_account_no: getStr(cEntityAccountNo, 500),
      access_service: getStr(cAccessService, 100),
      access_datetime_local: getStr(cAccessDt, 50),
      access_ip: getStr(cAccessIp, 45),
      access_remote_port: getStr(cAccessPort, 20),
      access_ip_country: getStr(cAccessCountry, 100),
      access_network: getStr(cAccessNetwork, 255),
      access_isp: getStr(cAccessIsp, 255),
    };

    const hasAnyValue =
      item.unavailable || item.requested || item.replied || item.received || item.no_ip_request_needed ||
      item.letter_number || item.result || item.entity_user_id || item.entity_name ||
      item.entity_email || item.entity_phone || item.entity_address || item.access_ip;

    if (hasAnyValue) parsed.push(item);
  });

  if (!parsed.length) {
    return NextResponse.json({ ok: true, scanned: Math.max(0, ws.rowCount - headerRowIdx), updated: 0 });
  }

  const pool = getPool();
  let updatedTotal = 0;

  for (let i = 0; i < parsed.length; i += 500) {
    const chunk = parsed.slice(i, i + 500);
    const keyBufs = chunk.map((r) => hexToBuffer32(r.record_key)).filter((b): b is Buffer => b !== null);
    if (!keyBufs.length) continue;

    const [evRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, LOWER(HEX(record_key)) AS rk FROM ip_events WHERE record_key IN (?)`,
      [keyBufs]
    );
    const idByKey = new Map<string, number>();
    for (const r of evRows) {
      idByKey.set(String(r.rk), Number(r.id));
    }

    const values: unknown[][] = [];
    for (const item of chunk) {
      const evId = idByKey.get(item.record_key);
      if (!evId) continue;
      values.push([
        evId,
        item.unavailable,
        item.requested,
        item.replied,
        item.received,
        item.no_ip_request_needed,
        item.letter_number,
        item.result || null,
        item.entity_user_id,
        item.entity_name,
        item.entity_country,
        item.entity_address,
        item.entity_email,
        item.entity_phone,
        item.entity_payment,
        item.entity_account_no,
        item.access_service,
        item.access_datetime_local,
        item.access_ip,
        item.access_remote_port,
        item.access_ip_country,
        item.access_network,
        item.access_isp,
        user.username,
      ]);
    }

    if (values.length) {
      await pool.query(
        `INSERT INTO ip_request_tracking (
           ip_event_id, unavailable, requested, replied, received, no_ip_request_needed,
           letter_number, result, entity_user_id, entity_name, entity_country, entity_address,
           entity_email, entity_phone, entity_payment, entity_account_no,
           access_service, access_datetime_local, access_ip, access_remote_port,
           access_ip_country, access_network, access_isp, updated_by
         ) VALUES ?
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
           access_service = VALUES(access_service),
           access_datetime_local = VALUES(access_datetime_local),
           access_ip = VALUES(access_ip),
           access_remote_port = VALUES(access_remote_port),
           access_ip_country = VALUES(access_ip_country),
           access_network = VALUES(access_network),
           access_isp = VALUES(access_isp),
           updated_by = VALUES(updated_by)`,
        [values]
      );
      updatedTotal += values.length;
    }
  }

  invalidateEventsStatsCache();
  return NextResponse.json({
    ok: true,
    scanned: Math.max(0, ws.rowCount - headerRowIdx),
    updated: updatedTotal,
  });
}
