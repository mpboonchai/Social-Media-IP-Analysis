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

interface CachedRdapRange {
  id: number;
  version: 4 | 6;
  from: bigint;
  to: bigint;
  span: bigint;
}

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

const globalRdap = globalThis as unknown as {
  rdapRanges?: CachedRdapRange[];
  rdapLoadedAt?: number;
  rdapNegativeIps?: Map<string, number>;
};

function bufToBigInt(buf: Buffer): bigint {
  return BigInt("0x" + buf.toString("hex"));
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

/**
 * Load all rdap_networks CIDR ranges into memory once (TTL 5 min).
 * Checking 1,000 IPs against 3,000 ranges in memory takes < 5 ms with ZERO DB round-trips.
 */
async function ensureRdapRangeCache(pool: mysql.Pool): Promise<CachedRdapRange[]> {
  const now = Date.now();
  if (globalRdap.rdapRanges && globalRdap.rdapLoadedAt && now - globalRdap.rdapLoadedAt < CACHE_TTL_MS) {
    return globalRdap.rdapRanges;
  }

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, ip_version, from_ip_bin, to_ip_bin FROM rdap_networks`
  );

  const ranges: CachedRdapRange[] = [];
  for (const r of rows) {
    const fBuf = r.from_ip_bin as Buffer;
    const tBuf = r.to_ip_bin as Buffer;
    if (!fBuf || !tBuf) continue;
    const from = bufToBigInt(fBuf);
    const to = bufToBigInt(tBuf);
    ranges.push({
      id: Number(r.id),
      version: Number(r.ip_version) === 6 ? 6 : 4,
      from,
      to,
      span: to >= from ? to - from : BigInt(0),
    });
  }
  // Sort by smallest CIDR span first so most-specific prefix matches first
  ranges.sort((a, b) => (a.span < b.span ? -1 : a.span > b.span ? 1 : 0));

  globalRdap.rdapRanges = ranges;
  globalRdap.rdapLoadedAt = now;
  if (!globalRdap.rdapNegativeIps) {
    globalRdap.rdapNegativeIps = new Map();
  }
  return ranges;
}

function findInMemoryRange(ranges: CachedRdapRange[], version: 4 | 6, ipVal: bigint): number | null {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.version === version && ipVal >= r.from && ipVal <= r.to) {
      return r.id;
    }
  }
  return null;
}

export async function lookupOrFetchRdap(
  pool: mysql.Pool,
  ip: string
): Promise<{ id: number | null; source: "cache" | "external" | "miss" }> {
  const parsed = ipToBuffer(ip);
  if (!parsed) return { id: null, source: "miss" };

  const ranges = await ensureRdapRangeCache(pool);
  const ipVal = bufToBigInt(parsed.buf);

  // 1. Ultra-fast in-memory CIDR range match (0 DB queries!)
  const hitId = findInMemoryRange(ranges, parsed.version, ipVal);
  if (hitId !== null) {
    return { id: hitId, source: "cache" };
  }

  // Negative cache: avoid hammering rdap.org repeatedly for unresolvable/private IPs
  const negExp = globalRdap.rdapNegativeIps?.get(ip);
  if (negExp && Date.now() < negExp) {
    return { id: null, source: "miss" };
  }

  // 2. Fetch external RDAP from rdap.org (only for genuinely new IP ranges)
  try {
    const res = await fetch(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
      headers: { accept: "application/rdap+json, application/json" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) {
      globalRdap.rdapNegativeIps?.set(ip, Date.now() + 10 * 60_000);
      return { id: null, source: "miss" };
    }
    const data = (await res.json()) as RdapResponse;

    const fromIp = String(data.startAddress || ip).trim();
    const toIp = String(data.endAddress || ip).trim();
    const fromParsed = ipToBuffer(fromIp) ?? parsed;
    const toParsed = ipToBuffer(toIp) ?? parsed;
    if (fromParsed.version !== toParsed.version) return { id: null, source: "miss" };

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
    if (!inserted.length) return { id: null, source: "miss" };

    const newId = Number(inserted[0].id);
    const fromBig = bufToBigInt(fromParsed.buf);
    const toBig = bufToBigInt(toParsed.buf);
    // Immediately add to in-memory cache so the remaining IPs & next 100 ZIP files hit memory!
    ranges.push({
      id: newId,
      version: fromParsed.version,
      from: fromBig,
      to: toBig,
      span: toBig >= fromBig ? toBig - fromBig : BigInt(0),
    });

    return { id: newId, source: "external" };
  } catch {
    return { id: null, source: "miss" };
  }
}

/**
 * Batch resolve unique IPs using the in-memory CIDR cache first,
 * and fetch external RDAP only for uncached IPs (bounded by a 5-second time budget per ZIP
 * to guarantee zero timeouts on Vercel Hobby even when uploading 50-150 files).
 */
export async function batchResolveRdap(
  pool: mysql.Pool,
  uniqueIps: string[]
): Promise<{
  map: Map<string, number | null>;
  cacheHits: number;
  externalFetched: number;
}> {
  const map = new Map<string, number | null>();
  const ranges = await ensureRdapRangeCache(pool);
  const misses: string[] = [];
  let cacheHits = 0;
  let externalFetched = 0;

  // Pass 1: instant in-memory lookup for all IPs
  for (const ip of uniqueIps) {
    const parsed = ipToBuffer(ip);
    if (!parsed) {
      map.set(ip, null);
      continue;
    }
    const hitId = findInMemoryRange(ranges, parsed.version, bufToBigInt(parsed.buf));
    if (hitId !== null) {
      map.set(ip, hitId);
      cacheHits++;
    } else {
      misses.push(ip);
    }
  }

  // Pass 2: external RDAP only for misses (concurrency 4, max 5s budget per file)
  if (misses.length > 0) {
    const deadline = Date.now() + 5_000;
    let cursor = 0;
    const worker = async () => {
      while (cursor < misses.length && Date.now() < deadline) {
        const ip = misses[cursor++];
        // Re-check in-memory cache first in case a previous worker just fetched the same CIDR block!
        const parsed = ipToBuffer(ip);
        if (parsed) {
          const reHit = findInMemoryRange(ranges, parsed.version, bufToBigInt(parsed.buf));
          if (reHit !== null) {
            map.set(ip, reHit);
            cacheHits++;
            continue;
          }
        }
        const res = await lookupOrFetchRdap(pool, ip);
        map.set(ip, res.id);
        if (res.source === "external") externalFetched++;
        else if (res.source === "cache") cacheHits++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, misses.length) }, worker));
  }

  return { map, cacheHits, externalFetched };
}
