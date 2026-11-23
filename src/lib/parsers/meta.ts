import JSZip from "jszip";
import * as cheerio from "cheerio";
import { sha256Hex } from "../ip-utils";

export type MetaAccountType = "User" | "InstagramUser" | "Page" | "Group" | "Unknown" | "";

export interface ParsedIpEvent {
  record_key: string;
  platform: "TikTok" | "Facebook" | "Instagram";
  platform_group: "TikTok" | "META";
  account: string;
  account_identifier: string;
  meta_account_type: MetaAccountType;
  meta_actor_display: string;
  page_admin: string;
  target_id: string;
  it_no: string;
  event_type: string;
  utc: string;
  local: string;
  ip: string;
  port: number | null;
  tiktok_country: string;
  source_zip: string;
  source_pdf: string;
  source_no: number;
  no_ip_data: boolean;
  no_ip_request_needed: boolean;
}

const KNOWN_TYPES = new Map<string, MetaAccountType>([
  ["user", "User"],
  ["instagramuser", "InstagramUser"],
  ["page", "Page"],
  ["group", "Group"],
  ["unknown", "Unknown"],
]);

export function normalizeMetaAccountType(value: string, platform = "META"): MetaAccountType {
  const raw = String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
  return KNOWN_TYPES.get(raw) ?? (platform && platform !== "TikTok" ? "Unknown" : "");
}

export function metaActorDisplay(row: {
  page_admin?: string;
  platform?: string;
  meta_account_type?: string;
}): string {
  const admin = String(row.page_admin ?? "").trim();
  if (admin) return admin;
  if (row.platform === "TikTok") return "";
  const type = normalizeMetaAccountType(row.meta_account_type ?? "", row.platform || "META");
  if (type === "User") return "บัญชีผู้ใช้โดยตรง";
  if (type === "InstagramUser") return "บัญชี Instagram โดยตรง";
  if (type === "Page") return "ไม่พบแอดมินที่ตรงกับ IP/เวลา";
  if (type === "Group") return "ไม่พบผู้ดูแลที่ตรงกับ IP/เวลา";
  return "ยังระบุประเภทบัญชีไม่ได้";
}

function toLocalIsoPlus7(utcIso: string): string {
  return new Date(new Date(utcIso).getTime() + 7 * 3600_000).toISOString().slice(0, -1) + "+07:00";
}

function computeRecordKey(row: Omit<ParsedIpEvent, "record_key">): string {
  return sha256Hex(
    [
      row.platform,
      row.account,
      row.page_admin || "",
      row.event_type,
      row.utc,
      row.ip,
      row.port ?? "",
      row.source_zip,
      row.source_pdf,
      row.source_no,
    ].join("\u001f")
  );
}

function normalizedLabel(val: string): string {
  return String(val || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseIpPort(value: string): { ip: string; port: number | null } | null {
  const cleaned = String(value || "").trim().replace(/^ip(?: address)?\s*[:=-]\s*/i, "");
  const validPort = (port?: string) => !port || (Number(port) >= 1 && Number(port) <= 65535);
  const ipv4 = cleaned.match(/^((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?$/);
  if (ipv4 && ipv4[1].split(".").every((p) => Number(p) <= 255) && validPort(ipv4[2])) {
    return { ip: ipv4[1], port: ipv4[2] ? Number(ipv4[2]) : null };
  }
  const bracketed = cleaned.match(/^\[([0-9A-Fa-f:]+)\](?::(\d+))?$/);
  if (bracketed && validPort(bracketed[2])) {
    return { ip: bracketed[1].toLowerCase(), port: bracketed[2] ? Number(bracketed[2]) : null };
  }
  if (/^(?=.*:)[0-9A-Fa-f:]+$/.test(cleaned)) {
    return { ip: cleaned.toLowerCase(), port: null };
  }
  return null;
}

function parseMetaTime(value: string): string {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  const exact = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(?:UTC|Z|\+00(?::?00)?)$/i);
  if (exact) {
    const parsed = new Date(
      Date.UTC(Number(exact[1]), Number(exact[2]) - 1, Number(exact[3]), Number(exact[4]), Number(exact[5]), Number(exact[6]))
    );
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  }
  const ts = Date.parse(raw.replace(/\s+UTC$/i, "Z"));
  return Number.isFinite(ts) ? new Date(ts).toISOString() : "";
}

export async function parseMetaZip(buffer: Buffer | Uint8Array, filename: string): Promise<ParsedIpEvent[]> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = Object.values(zip.files).find((item) => !item.dir && /(^|\/)records?\.html$/i.test(item.name));
  if (!entry) throw new Error(`${filename}: ไม่พบ record.html หรือ records.html`);

  const html = await entry.async("string");
  const $ = cheerio.load(html);

  const directText = (el: cheerio.Cheerio<any>): string =>
    el
      .contents()
      .filter((_, node) => node.type === "text")
      .text()
      .replace(/\s+/g, " ")
      .trim();

  const directValue = (el: cheerio.Cheerio<any>): string => {
    const m = el.children(".m").first();
    const wrapper = m.children().first().length ? m.children().first() : m;
    return wrapper
      .contents()
      .filter((_, node) => node.type === "text")
      .text()
      .replace(/\s+/g, " ")
      .trim();
  };

  const leafFields = (root: cheerio.Cheerio<any>) =>
    root
      .find(".t.i")
      .filter((_, node) => $(node).find(".t.i").length === 0)
      .map((_, node) => {
        const $n = $(node);
        const label = directText($n);
        const value = $n.children(".m").first().text().replace(/\s+/g, " ").trim();
        return { label, value };
      })
      .get();

  const allLeaves = leafFields($.root());
  const first = (label: string) =>
    allLeaves.find((item) => normalizedLabel(item.label) === normalizedLabel(label))?.value || "";

  const service: "Facebook" | "Instagram" = /instagram/i.test(first("Service")) ? "Instagram" : "Facebook";
  const identifier = first("Account Identifier");
  const account = identifier || filename.replace(/\.zip$/i, "");
  const metaAccountType = normalizeMetaAccountType(first("Account Type"), service);
  const targetId = first("Target");
  const itNo = first("Internal Ticket Number");
  const sourcePdf = entry.name.split("/").pop() || "records.html";

  const rows: ParsedIpEvent[] = [];
  const admins: string[] = [];
  let sourceNo = 0;

  const addRow = (parsedIp: { ip: string; port: number | null }, utc: string, pageAdmin: string) => {
    if (!parsedIp || !utc) return;
    sourceNo += 1;
    const base: Omit<ParsedIpEvent, "record_key"> = {
      platform: service,
      platform_group: "META",
      account,
      account_identifier: identifier,
      meta_account_type: metaAccountType,
      meta_actor_display: "",
      page_admin: pageAdmin,
      target_id: targetId,
      it_no: itNo,
      event_type: "IP Address",
      utc,
      local: toLocalIsoPlus7(utc),
      ip: parsedIp.ip,
      port: parsedIp.port,
      tiktok_country: "",
      source_zip: filename,
      source_pdf: sourcePdf,
      source_no: sourceNo,
      no_ip_data: false,
      no_ip_request_needed: false,
    };
    base.meta_actor_display = metaActorDisplay(base);
    rows.push({ ...base, record_key: computeRecordKey(base) });
  };

  const addSection = (section: cheerio.Cheerio<any>, pageAdmin = "") => {
    let pendingIp: { ip: string; port: number | null } | null = null;
    let pendingTime = "";
    for (const item of leafFields(section)) {
      const label = normalizedLabel(item.label);
      const parsedIp = parseIpPort(item.value);
      const parsedTime = parseMetaTime(item.value);
      const isIp = !label || ["ip", "ip address", "ip address and port", "ip and port"].includes(label);
      const isTime = !label || ["time", "date", "timestamp", "date time"].includes(label);
      if (isIp && parsedIp) {
        if (pendingTime) {
          addRow(parsedIp, pendingTime, pageAdmin);
          pendingTime = "";
          pendingIp = null;
        } else {
          pendingIp = parsedIp;
        }
        continue;
      }
      if (isTime && parsedTime) {
        if (pendingIp) {
          addRow(pendingIp, parsedTime, pageAdmin);
          pendingIp = null;
          pendingTime = "";
        } else {
          pendingTime = parsedTime;
        }
      }
    }
  };

  const findFieldNode = (root: cheerio.Cheerio<any>, labels: string[]) => {
    const wanted = new Set(labels.map(normalizedLabel));
    const found = root.find(".t.i").filter((_, node) => wanted.has(normalizedLabel(directText($(node)))));
    return found.length ? found.first() : null;
  };

  const adminRoot = $("#property-admins").length ? $("#property-admins") : findFieldNode($.root(), ["Admins"]);
  if (adminRoot) {
    const adminNodes = adminRoot
      .find(".t.i")
      .filter((_, node) => normalizedLabel(directText($(node))) === "user");
    adminNodes.each((_, node) => {
      const $admin = $(node);
      const pageAdmin = directValue($admin);
      if (pageAdmin) admins.push(pageAdmin);
      const section = findFieldNode($admin, ["Ip Addresses", "IP Addresses", "IP Address History"]);
      if (section) addSection(section, pageAdmin);
    });
  }

  if (!rows.length) {
    const section = $("#property-ip_addresses").length
      ? $("#property-ip_addresses")
      : findFieldNode($.root(), ["Ip Addresses", "IP Addresses", "IP Address History"]);
    if (section) addSection(section, "");
  }

  if (!rows.length) {
    const base: Omit<ParsedIpEvent, "record_key"> = {
      platform: service,
      platform_group: "META",
      account,
      account_identifier: identifier,
      meta_account_type: metaAccountType,
      meta_actor_display: "",
      page_admin: [...new Set(admins)].join(" / "),
      target_id: targetId,
      it_no: itNo,
      event_type: "ไฟล์ที่ได้รับไม่มีข้อมูล IP",
      utc: "",
      local: "",
      ip: "",
      port: null,
      tiktok_country: "",
      source_zip: filename,
      source_pdf: sourcePdf,
      source_no: 0,
      no_ip_data: true,
      no_ip_request_needed: true,
    };
    base.meta_actor_display = metaActorDisplay(base);
    rows.push({ ...base, record_key: computeRecordKey(base) });
  }

  return rows;
}
