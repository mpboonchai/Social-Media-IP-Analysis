import type mysql from "mysql2/promise";
import { ipToBuffer, normalizeCountry } from "../ip-utils";

interface RdapEntity {
  vcardArray?: unknown[];
  entities?: RdapEntity[];
}

interface RdapResponse {
  startAddress?: string;
  endAddress?: string;
  country?: string;
  name?: string;
  entities?: RdapEntity[];
}

function extractOwnerFromEntities(entities?: RdapEntity[]): string {
  if (!Array.isArray(entities)) return "";
  const names: string[] = [];
  for (const ent of entities) {
    const vcard = ent.vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const prop of vcard[1] as unknown[]) {
        if (Array.isArray(prop) && prop[0] === "fn" && typeof prop[3] === "string") {
          const val = prop[3].trim();
          if (val && !names.includes(val)) names.push(val);
        }
      }
    }
    if (ent.entities) {
      const nested = extractOwnerFromEntities(ent.entities);
      if (nested && !names.includes(nested)) names.push(nested);
    }
  }
  return names.slice(0, 3).join("; ").slice(0, 255);
}

export async function lookupOrFetchRdap(
  pool: mysql.Pool,
  ip: string
): Promise<number | null> {
  const parsed = ipToBuffer(ip);
  if (!parsed) return null;

  // 1. Check local MySQL rdap_networks range cache
  const [cached] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM rdap_networks
     WHERE ip_version = ? AND from_ip_bin <= ? AND to_ip_bin >= ?
     ORDER BY (to_ip_bin - from_ip_bin) ASC LIMIT 1`,
    [parsed.version, parsed.buf, parsed.buf]
  );
  if (cached.length) return Number(cached[0].id);

  // 2. Fetch external RDAP from rdap.org
  try {
    const res = await fetch(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
      headers: { accept: "application/rdap+json, application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RdapResponse;

    const fromIp = String(data.startAddress || ip).trim();
    const toIp = String(data.endAddress || ip).trim();
    const fromParsed = ipToBuffer(fromIp) ?? parsed;
    const toParsed = ipToBuffer(toIp) ?? parsed;
    if (fromParsed.version !== toParsed.version) return null;

    const country = normalizeCountry(data.country || "");
    const network = String(data.name || "").trim().slice(0, 255);
    const owner = extractOwnerFromEntities(data.entities);

    await pool.execute(
      `INSERT INTO rdap_networks (ip_version, from_ip, to_ip, from_ip_bin, to_ip_bin, country, network_name, owner_name, ip_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
       ON DUPLICATE KEY UPDATE
         country = IF(VALUES(country) <> '', VALUES(country), country),
         network_name = IF(VALUES(network_name) <> '', VALUES(network_name), network_name),
         owner_name = IF(VALUES(owner_name) <> '', VALUES(owner_name), owner_name)`,
      [fromParsed.version, fromIp, toIp, fromParsed.buf, toParsed.buf, country, network, owner]
    );

    const [inserted] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id FROM rdap_networks
       WHERE ip_version = ? AND from_ip_bin = ? AND to_ip_bin = ? LIMIT 1`,
      [fromParsed.version, fromParsed.buf, toParsed.buf]
    );
    return inserted.length ? Number(inserted[0].id) : null;
  } catch {
    return null;
  }
}
