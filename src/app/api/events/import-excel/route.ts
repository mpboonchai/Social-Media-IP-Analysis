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

  // Map column headers dynamically
  const headerMap = new Map<string, number>();
  ws.getRow(1).eachCell((cell, colNumber) => {
    headerMap.set(cellText(cell).toLowerCase(), colNumber);
  });

  const colOf = (...names: string[]) => {
    for (const n of names) {
      const idx = headerMap.get(n.toLowerCase());
      if (idx) return idx;
    }
    return 0;
  };

  const cKey = colOf("record_key");
  if (!cKey) {
    return NextResponse.json(
      { error: "ไม่พบคอลัมน์ record_key ในไฟล์ Excel (กรุณาใช้ไฟล์ที่ส่งออกจากระบบ)" },
      { status: 400 }
    );
  }

  const cUnavailable = colOf("ขอข้อมูลไม่ได้", "unavailable");
  const cRequested = colOf("ขอข้อมูลแล้ว", "requested");
  const cReplied = colOf("ตอบกลับแล้ว", "replied");
  const cReceived = colOf("ได้รับข้อมูลแล้ว", "received");
  const cNoIpNeeded = colOf("ไม่ต้องขอ ip", "no_ip_request_needed");
  const cLetter = colOf("เลขหนังสือ", "letter_number");
  const cResult = colOf("ผลลัพธ์ / หมายเหตุ", "ผลลัพธ์", "result");
  const cEntityName = colOf("ชื่อผู้จดทะเบียน / entity", "ชื่อผู้จดทะเบียน", "entity_name");
  const cEntityPhone = colOf("เบอร์โทร", "entity_phone");

  interface ParsedExcelRow {
    record_key: string;
    unavailable: number;
    requested: number;
    replied: number;
    received: number;
    no_ip_request_needed: number;
    letter_number: string;
    result: string;
    entity_name: string;
    entity_phone: string;
  }

  const parsed: ParsedExcelRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rk = cellText(row.getCell(cKey)).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(rk)) return;

    const item: ParsedExcelRow = {
      record_key: rk,
      unavailable: cUnavailable ? toBoolFlag(cellText(row.getCell(cUnavailable))) : 0,
      requested: cRequested ? toBoolFlag(cellText(row.getCell(cRequested))) : 0,
      replied: cReplied ? toBoolFlag(cellText(row.getCell(cReplied))) : 0,
      received: cReceived ? toBoolFlag(cellText(row.getCell(cReceived))) : 0,
      no_ip_request_needed: cNoIpNeeded ? toBoolFlag(cellText(row.getCell(cNoIpNeeded))) : 0,
      letter_number: cLetter ? cellText(row.getCell(cLetter)).slice(0, 100) : "",
      result: cResult ? cellText(row.getCell(cResult)) : "",
      entity_name: cEntityName ? cellText(row.getCell(cEntityName)).slice(0, 500) : "",
      entity_phone: cEntityPhone ? cellText(row.getCell(cEntityPhone)).slice(0, 250) : "",
    };

    // Only include rows that have any tracking info or status set
    const hasAnyValue =
      item.unavailable ||
      item.requested ||
      item.replied ||
      item.received ||
      item.no_ip_request_needed ||
      item.letter_number ||
      item.result ||
      item.entity_name ||
      item.entity_phone;

    if (hasAnyValue) {
      parsed.push(item);
    }
  });

  if (!parsed.length) {
    return NextResponse.json({ ok: true, scanned: ws.rowCount - 1, updated: 0 });
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
        item.entity_name,
        item.entity_phone,
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
      updatedTotal += values.length;
    }
  }

  invalidateEventsStatsCache();
  return NextResponse.json({
    ok: true,
    scanned: Math.max(0, ws.rowCount - 1),
    updated: updatedTotal,
  });
}
