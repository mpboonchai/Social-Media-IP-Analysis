import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { hexToBuffer32, ipToBuffer, normalizeCountry, sha256Hex } from "../src/lib/ip-utils";

const EXPORT_DIR =
  process.env.EXPORT_DIR ||
  "/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/9ecb32ad-02de-4857-b4c8-d7bb6e11d963/scratch/export";

function parseMysqlDatetime(val: string | null | undefined): string | null {
  const raw = String(val ?? "").trim();
  if (!raw) return null;
  // ISO like 2026-11-11T23:59:29.000Z or 2026-11-12T06:59:29.000+07:00
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return null;
  const ms = m[3] ? m[3].padEnd(3, "0") : "000";
  return `${m[1]} ${m[2]}.${ms}`;
}

function parseDateOnly(val: string | null | undefined): string | null {
  const raw = String(val ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normPlatform(val: string | null | undefined): "TikTok" | "Facebook" | "Instagram" {
  const s = String(val ?? "").toLowerCase();
  if (s.includes("instagram")) return "Instagram";
  if (s.includes("facebook") || s.includes("meta")) return "Facebook";
  return "TikTok";
}

function normMetaType(val: string | null | undefined): "User" | "InstagramUser" | "Page" | "Group" | "Unknown" | "" {
  const s = String(val ?? "").trim().toLowerCase();
  if (s === "user") return "User";
  if (s === "instagramuser") return "InstagramUser";
  if (s === "page") return "Page";
  if (s === "group") return "Group";
  if (s === "unknown") return "Unknown";
  return "";
}

async function seedAdminUser(conn: mysql.Connection) {
  const hash = await bcrypt.hash(process.env.ADMIN_INIT_PASSWORD || "TCSD2tpo2026***", 10);
  await conn.execute(
    `INSERT INTO users (username, display_name, password_hash, role, approved, active)
     VALUES ('masteradmin', 'Master Admin', ?, 'master_admin', 1, 1)
     ON DUPLICATE KEY UPDATE approved = 1, active = 1`,
    [hash]
  );
  console.log("Seeded masteradmin user.");
}

async function migrateRdap(conn: mysql.Connection) {
  const rdapPath = path.join(EXPORT_DIR, "rdap_cache.json");
  const rows = JSON.parse(fs.readFileSync(rdapPath, "utf8")) as Array<Record<string, unknown>>;
  const map = new Map<string, number>();

  const values: unknown[][] = [];
  for (const r of rows) {
    const fromIp = String(r.from_ip ?? r.ip ?? "").trim();
    const toIp = String(r.to_ip ?? r.ip ?? "").trim();
    const f = ipToBuffer(fromIp);
    const t = ipToBuffer(toIp);
    if (!f || !t || f.version !== t.version) continue;
    values.push([
      f.version,
      fromIp,
      toIp,
      f.buf,
      t.buf,
      normalizeCountry(String(r.country ?? "")),
      String(r.network ?? "").slice(0, 255),
      String(r.owner ?? "").slice(0, 255),
      "",
    ]);
  }

  for (let i = 0; i < values.length; i += 1000) {
    const batch = values.slice(i, i + 1000);
    await conn.query(
      `INSERT INTO rdap_networks (ip_version, from_ip, to_ip, from_ip_bin, to_ip_bin, country, network_name, owner_name, ip_type)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         country = IF(VALUES(country) <> '', VALUES(country), country),
         network_name = IF(VALUES(network_name) <> '', VALUES(network_name), network_name),
         owner_name = IF(VALUES(owner_name) <> '', VALUES(owner_name), owner_name)`,
      [batch]
    );
  }

  const [dbRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, ip_version, from_ip_bin, to_ip_bin, network_name, owner_name, country FROM rdap_networks`
  );
  for (const row of dbRows) {
    const key = `${row.ip_version}:${(row.from_ip_bin as Buffer).toString("hex")}:${(row.to_ip_bin as Buffer).toString("hex")}`;
    map.set(key, Number(row.id));
  }
  console.log(`Migrated rdap_networks: ${dbRows.length} ranges.`);
  return map;
}

async function migrateCases(conn: mysql.Connection) {
  const casesPath = path.join(EXPORT_DIR, "cases.json");
  const rows = JSON.parse(fs.readFileSync(casesPath, "utf8")) as Array<Record<string, unknown>>;
  const values: unknown[][] = [];

  for (const c of rows) {
    const sourceHex = String(c.source_id ?? "").trim() || sha256Hex(`${c.inst_id}|${c.tracking_code}|${c.platform_url}`);
    const sourceBuf = hexToBuffer32(sourceHex) ?? Buffer.from(sha256Hex(sourceHex), "hex");
    const platRaw = String(c.platform ?? "TikTok").toLowerCase();
    const platform = platRaw.includes("facebook")
      ? "Facebook"
      : platRaw.includes("instagram")
      ? "Instagram"
      : platRaw.includes("tiktok")
      ? "TikTok"
      : "Other";

    values.push([
      sourceBuf,
      String(c.inst_id ?? "").slice(0, 100),
      String(c.data_id ?? "").slice(0, 100),
      String(c.tracking_code ?? "").slice(0, 100),
      parseDateOnly(String(c.reported_date ?? "")),
      String(c.team ?? "").slice(0, 100),
      platform,
      String(c.platform_url ?? "").slice(0, 1000),
      String(c.normalized_url ?? "").slice(0, 500),
      String(c.resolved_url ?? "").slice(0, 1000),
      String(c.account_name ?? "").slice(0, 255),
      "Scammer",
      String(c.tracking_status ?? "").slice(0, 150),
      String(c.replied_at ?? "").slice(0, 100),
      String(c.tpo_code ?? "").slice(0, 100),
      c.note ? String(c.note) : null,
      String(c.source_filename ?? "").slice(0, 255),
      Number(c.source_row || 0),
      String(c.response_account ?? "").slice(0, 255),
      String(c.response_target_id ?? "").slice(0, 100),
      parseMysqlDatetime(String(c.imported_at ?? "")),
    ]);
  }

  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await conn.query(
      `INSERT INTO cases (
        source_id, inst_id, data_id, tracking_code, reported_date, team, platform,
        platform_url, normalized_url, resolved_url, account_name, scammer_case,
        tracking_status, replied_at, tpo_code, note, source_filename, source_row,
        response_account, response_target_id, imported_at
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        tracking_status = VALUES(tracking_status),
        replied_at = VALUES(replied_at),
        note = VALUES(note)`,
      [batch]
    );
  }
  console.log(`Migrated cases: ${values.length}`);
}

async function migrateReports(conn: mysql.Connection) {
  const reportsPath = path.join(EXPORT_DIR, "reports.json");
  const rows = JSON.parse(fs.readFileSync(reportsPath, "utf8")) as Array<Record<string, unknown>>;
  for (const r of rows) {
    await conn.execute(
      `INSERT INTO report_snapshots (id, report_name, template_version, filters_json, summary_json, status, generated_by, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE report_name = VALUES(report_name)`,
      [
        String(r.id),
        String(r.report_name ?? "").slice(0, 200),
        String(r.template_version ?? "").slice(0, 100),
        JSON.stringify(r.filters ?? {}),
        null,
        String(r.status ?? "completed").slice(0, 50),
        String(r.generated_by ?? "").slice(0, 64),
        parseMysqlDatetime(String(r.generated_at ?? "")) ?? "2026-01-01 00:00:00",
      ]
    );
  }
  console.log(`Migrated report_snapshots: ${rows.length}`);
}

async function migrateIpEvents(conn: mysql.Connection, rdapMap: Map<string, number>) {
  const ndjsonPath = path.join(EXPORT_DIR, "ip_events.ndjson");
  const accountMap = new Map<string, number>();

  const [existingAccs] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, platform, account_identifier FROM social_accounts`
  );
  for (const a of existingAccs) {
    accountMap.set(`${a.platform}\u0000${String(a.account_identifier).toLowerCase()}`, Number(a.id));
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(ndjsonPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let batch: Array<Record<string, unknown>> = [];
  let totalProcessed = 0;

  async function flushBatch(items: Array<Record<string, unknown>>) {
    if (!items.length) return;

    // 1. Ensure all social_accounts exist
    const missingAccounts = new Map<string, unknown[]>();
    for (const r of items) {
      const platform = normPlatform(String(r.platform ?? ""));
      const accIdStr = String(r.account_identifier || r.account || r.target_id || "unknown").trim().slice(0, 255);
      const accKey = `${platform}\u0000${accIdStr.toLowerCase()}`;
      if (!accountMap.has(accKey) && !missingAccounts.has(accKey)) {
        missingAccounts.set(accKey, [
          platform,
          accIdStr,
          String(r.account || accIdStr).trim().slice(0, 255),
          String(r.target_id ?? "").trim().slice(0, 100),
          String(r.it_no ?? "").trim().slice(0, 100),
          normMetaType(String(r.meta_account_type ?? "")),
        ]);
      }
    }
    if (missingAccounts.size > 0) {
      const accVals = [...missingAccounts.values()];
      await conn.query(
        `INSERT IGNORE INTO social_accounts (platform, account_identifier, account_name, target_id, it_no, meta_account_type) VALUES ?`,
        [accVals]
      );
      const [newAccs] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT id, platform, account_identifier FROM social_accounts`
      );
      for (const a of newAccs) {
        accountMap.set(`${a.platform}\u0000${String(a.account_identifier).toLowerCase()}`, Number(a.id));
      }
    }

    // 2. Ensure any inline RDAP range exists
    const missingRdap = new Map<string, unknown[]>();
    for (const r of items) {
      const fromIp = String(r.from_ip ?? r.ip ?? "").trim();
      const toIp = String(r.to_ip ?? r.ip ?? "").trim();
      if (!fromIp || !toIp) continue;
      const f = ipToBuffer(fromIp);
      const t = ipToBuffer(toIp);
      if (!f || !t || f.version !== t.version) continue;
      const key = `${f.version}:${f.buf.toString("hex")}:${t.buf.toString("hex")}`;
      if (!rdapMap.has(key) && !missingRdap.has(key) && (r.network || r.owner || r.country)) {
        missingRdap.set(key, [
          f.version,
          fromIp,
          toIp,
          f.buf,
          t.buf,
          normalizeCountry(String(r.country ?? "")),
          String(r.network ?? "").slice(0, 255),
          String(r.owner ?? "").slice(0, 255),
          String(r.ip_type ?? "").slice(0, 100),
        ]);
      }
    }
    if (missingRdap.size > 0) {
      const rVals = [...missingRdap.values()];
      await conn.query(
        `INSERT IGNORE INTO rdap_networks (ip_version, from_ip, to_ip, from_ip_bin, to_ip_bin, country, network_name, owner_name, ip_type) VALUES ?`,
        [rVals]
      );
      const [newRdap] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT id, ip_version, from_ip_bin, to_ip_bin FROM rdap_networks`
      );
      for (const row of newRdap) {
        const key = `${row.ip_version}:${(row.from_ip_bin as Buffer).toString("hex")}:${(row.to_ip_bin as Buffer).toString("hex")}`;
        rdapMap.set(key, Number(row.id));
      }
    }

    // 3. Insert ip_events
    const eventValues: unknown[][] = [];
    const trackingByHex = new Map<string, Record<string, unknown>>();

    for (const r of items) {
      const platform = normPlatform(String(r.platform ?? ""));
      const accIdStr = String(r.account_identifier || r.account || r.target_id || "unknown").trim().slice(0, 255);
      const accountId = accountMap.get(`${platform}\u0000${accIdStr.toLowerCase()}`);
      if (!accountId) continue;

      const recHex = String(r.record_key ?? "").trim().toLowerCase() || sha256Hex(JSON.stringify(r));
      const recBuf = hexToBuffer32(recHex) ?? Buffer.from(sha256Hex(recHex), "hex");
      const ipParsed = ipToBuffer(String(r.ip ?? ""));

      let rdapId: number | null = null;
      const fromIp = String(r.from_ip ?? r.ip ?? "").trim();
      const toIp = String(r.to_ip ?? r.ip ?? "").trim();
      if (fromIp && toIp) {
        const f = ipToBuffer(fromIp);
        const t = ipToBuffer(toIp);
        if (f && t && f.version === t.version) {
          rdapId = rdapMap.get(`${f.version}:${f.buf.toString("hex")}:${t.buf.toString("hex")}`) ?? null;
        }
      }

      eventValues.push([
        recBuf,
        null,
        accountId,
        rdapId,
        platform,
        String(r.event_type ?? "IP Address").slice(0, 100),
        parseMysqlDatetime(String(r.utc ?? "")),
        parseMysqlDatetime(String(r.local ?? "")),
        ipParsed ? ipParsed.buf : null,
        ipParsed ? ipParsed.version : null,
        r.port !== null && r.port !== undefined && r.port !== "" ? Number(r.port) : null,
        String(r.ip_type ?? "").slice(0, 50),
        String(r.page_admin ?? "").slice(0, 255),
        String(r.meta_actor_display ?? "").slice(0, 255),
        String(r.tiktok_country ?? "").slice(0, 100),
        String(r.it_no ?? "").slice(0, 100),
        String(r.inst_id ?? "").slice(0, 100),
        String(r.tpo_code ?? "").slice(0, 100),
        String(r.scammer_case ?? "").slice(0, 50),
        String(r.reported_date ?? "").slice(0, 100),
        String(r.team ?? "").slice(0, 100),
        Number(r.case_match_count || 0),
        r.case_window_match ? 1 : 0,
        String(r.source_zip ?? "").slice(0, 255),
        String(r.source_folder ?? "").slice(0, 255),
        String(r.source_pdf ?? "").slice(0, 255),
        Number(r.source_no || 0),
        r.no_ip_data ? 1 : 0,
      ]);

      const hasTracking =
        r.unavailable || r.requested || r.replied || r.received || r.no_ip_request_needed ||
        r.letter_number || r.result || r.entity_user_id || r.entity_name || r.entity_email ||
        r.entity_phone || r.entity_account_no || r.access_ip || r.access_service;
      if (hasTracking) {
        trackingByHex.set(recBuf.toString("hex"), r);
      }
    }

    if (eventValues.length > 0) {
      await conn.query(
        `INSERT IGNORE INTO ip_events (
          record_key, upload_batch_id, account_id, rdap_network_id, platform, event_type,
          event_utc, event_local, ip_bin, ip_version, port, ip_type, page_admin,
          meta_actor_display, tiktok_country, it_no, inst_id, tpo_code, scammer_case,
          reported_date, team, case_match_count, case_window_match, source_zip,
          source_folder, source_pdf, source_no, no_ip_data
        ) VALUES ?`,
        [eventValues]
      );
    }

    // 4. Insert sparse ip_request_tracking
    if (trackingByHex.size > 0) {
      const keyBuffers = [...trackingByHex.keys()].map((h) => Buffer.from(h, "hex"));
      const [idRows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT id, record_key FROM ip_events WHERE record_key IN (?)`,
        [keyBuffers]
      );
      const trackValues: unknown[][] = [];
      for (const row of idRows) {
        const r = trackingByHex.get((row.record_key as Buffer).toString("hex"));
        if (!r) continue;
        trackValues.push([
          Number(row.id),
          r.unavailable ? 1 : 0,
          r.requested ? 1 : 0,
          r.replied ? 1 : 0,
          r.received ? 1 : 0,
          r.no_ip_request_needed ? 1 : 0,
          String(r.letter_number ?? "").slice(0, 100),
          r.result ? String(r.result) : null,
          String(r.entity_user_id ?? "").slice(0, 250),
          String(r.entity_name ?? "").slice(0, 500),
          String(r.entity_country ?? "").slice(0, 250),
          String(r.entity_address ?? "").slice(0, 2000),
          String(r.entity_email ?? "").slice(0, 500),
          String(r.entity_phone ?? "").slice(0, 250),
          String(r.entity_payment ?? "").slice(0, 1000),
          String(r.entity_account_no ?? "").slice(0, 500),
          String(r.access_service ?? "").slice(0, 100),
          String(r.access_datetime_local ?? "").slice(0, 50),
          String(r.access_ip ?? "").slice(0, 45),
          String(r.access_remote_port ?? "").slice(0, 20),
          String(r.access_ip_country ?? "").slice(0, 100),
          String(r.access_network ?? "").slice(0, 255),
          String(r.access_isp ?? "").slice(0, 255),
          String(r.updated_by ?? "").slice(0, 100),
        ]);
      }
      if (trackValues.length > 0) {
        await conn.query(
          `INSERT IGNORE INTO ip_request_tracking (
            ip_event_id, unavailable, requested, replied, received, no_ip_request_needed,
            letter_number, result, entity_user_id, entity_name, entity_country, entity_address,
            entity_email, entity_phone, entity_payment, entity_account_no,
            access_service, access_datetime_local, access_ip, access_remote_port,
            access_ip_country, access_network, access_isp, updated_by
          ) VALUES ?`,
          [trackValues]
        );
      }
    }

    totalProcessed += items.length;
    if (totalProcessed % 20000 === 0) {
      console.log(`Migrated ip_events: ${totalProcessed.toLocaleString()} rows...`);
    }
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= 2000) {
      await flushBatch(batch);
      batch = [];
    }
  }
  await flushBatch(batch);
  console.log(`Completed ip_events migration! Total processed: ${totalProcessed.toLocaleString()}`);
}

async function main() {
  const url = process.env.DATABASE_URL || "mysql://ipuser:ippass123@127.0.0.1:3306/social_media_ip";
  const conn = await mysql.createConnection({ uri: url, timezone: "Z" });
  try {
    await seedAdminUser(conn);
    const rdapMap = await migrateRdap(conn);
    await migrateCases(conn);
    await migrateReports(conn);
    await migrateIpEvents(conn, rdapMap);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
