import crypto from "node:crypto";
import net from "node:net";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function hexToBuffer32(hex: string): Buffer | null {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) return null;
  return Buffer.from(clean, "hex");
}

export function ipToBuffer(ip: string | null | undefined): { buf: Buffer; version: 4 | 6 } | null {
  const raw = String(ip ?? "").trim();
  if (!raw) return null;
  const v = net.isIP(raw);
  if (v === 4) {
    const parts = raw.split(".").map(Number);
    return { buf: Buffer.from(parts), version: 4 };
  }
  if (v === 6) {
    let source = raw.toLowerCase();
    const zoneIdx = source.indexOf("%");
    if (zoneIdx !== -1) source = source.slice(0, zoneIdx);
    const v4Match = source.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (v4Match) {
      const p = v4Match[1].split(".").map(Number);
      source =
        source.slice(0, source.length - v4Match[1].length) +
        `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
    }
    const halves = source.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const fillCount = halves.length === 2 ? Math.max(0, 8 - left.length - right.length) : 0;
    const parts = [...left, ...Array(fillCount).fill("0"), ...right];
    if (parts.length !== 8) return null;
    const buf = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) {
      const val = parseInt(parts[i], 16);
      if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
      buf.writeUInt16BE(val, i * 2);
    }
    return { buf, version: 6 };
  }
  return null;
}

export function bufferToIp(buf: Buffer | null | undefined): string {
  if (!buf || buf.length === 0) return "";
  if (buf.length === 4) {
    return `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`;
  }
  if (buf.length === 16) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push(buf.readUInt16BE(i).toString(16));
    }
    return groups.join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
  }
  return "";
}

const COUNTRY_ALIASES = new Map<string, string>([
  ["th", "Thailand"], ["tha", "Thailand"], ["thailand", "Thailand"],
  ["vn", "Vietnam"], ["vnm", "Vietnam"], ["viet nam", "Vietnam"], ["vietnam", "Vietnam"],
  ["sg", "Singapore"], ["sgp", "Singapore"], ["singapore", "Singapore"],
  ["us", "United States"], ["usa", "United States"], ["united states", "United States"], ["united states of america", "United States"],
  ["gb", "United Kingdom"], ["gbr", "United Kingdom"], ["uk", "United Kingdom"], ["united kingdom", "United Kingdom"],
  ["cn", "China"], ["chn", "China"], ["china", "China"],
  ["hk", "Hong Kong"], ["hkg", "Hong Kong"], ["hong kong", "Hong Kong"],
  ["jp", "Japan"], ["jpn", "Japan"], ["japan", "Japan"],
  ["kr", "South Korea"], ["kor", "South Korea"], ["south korea", "South Korea"], ["korea", "South Korea"],
  ["my", "Malaysia"], ["mys", "Malaysia"], ["malaysia", "Malaysia"],
  ["id", "Indonesia"], ["idn", "Indonesia"], ["indonesia", "Indonesia"],
  ["ph", "Philippines"], ["phl", "Philippines"], ["philippines", "Philippines"],
  ["mm", "Myanmar"], ["mmr", "Myanmar"], ["myanmar", "Myanmar"],
]);

const regionDisplay = new Intl.DisplayNames(["en"], { type: "region" });

export function normalizeCountry(value: string | null | undefined): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const parts = raw.toLowerCase().split(/[,/|*()\-]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of [raw.toLowerCase(), ...parts]) {
    const hit = COUNTRY_ALIASES.get(part);
    if (hit) return hit;
  }
  if (/^[A-Za-z]{2}$/.test(raw)) {
    try {
      const name = regionDisplay.of(raw.toUpperCase());
      if (name && name !== raw.toUpperCase()) return name;
    } catch {}
  }
  return raw;
}
