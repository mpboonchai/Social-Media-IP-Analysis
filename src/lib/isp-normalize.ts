/**
 * Normalize ISP / RDAP network names so variations of the same company merge
 * (e.g. "ReadyIDC co.,Ltd." and "ReadyIDC Company Limited" -> "ReadyIDC"),
 * while keeping mobile vs home broadband separate (e.g. "AIS Mobile (AWN)" vs "AIS Fibre",
 * "TrueMove H" vs "True Internet").
 */
export function normalizeIspName(networkName?: string | null, ownerName?: string | null): string {
  const net = String(networkName || "").trim();
  const own = String(ownerName || "").trim();
  const combined = `${net} ${own}`.toLowerCase();

  if (!net && !own) return "ไม่ระบุ";

  // 1. AIS: strictly separate Fibre (home internet) vs Mobile (AWN)
  if (/ais[\s_-]*fibre|aisfibre/i.test(combined)) {
    return "AIS Fibre";
  }
  if (/awn[\s_-]*co|ais[\s_-]*mobile|advanced\s+wireless\s+network|advanced\s+info\s+service/i.test(combined)) {
    return "AIS Mobile (AWN)";
  }

  // 2. True: strictly separate TrueMove H (mobile) vs True Internet (broadband)
  if (/truemove/i.test(combined)) {
    return "TrueMove H";
  }
  if (/trueinternet|truenet|true\s+internet/i.test(combined)) {
    return "True Internet";
  }

  // 3. ReadyIDC: merge all variations (ReadyIDC Co., Ltd., ReadyIDC Company Limited, ReadyIDC-TH, READYI-*)
  if (/readyidc|readyi-/i.test(combined)) {
    return "ReadyIDC";
  }

  // 4. Internet Maekhong Network (IMNCL-MM)
  if (/imncl|maekhong/i.test(combined)) {
    return "Internet Maekhong Network (IMNCL)";
  }

  // 5. Triple T Broadband (3BB)
  if (/triple\s*t|3bb|tttbb/i.test(combined)) {
    return "Triple T Broadband (3BB)";
  }

  // 6. Zenlayer
  if (/zenlayer|zen-sg|irt-zen/i.test(combined)) {
    return "Zenlayer";
  }

  // 7. NT / TOT / CAT
  if (/totnet|tot-net|tot\s+public|irt-tot/i.test(combined)) {
    return "NT / TOT";
  }
  if (/cat-idc|cat\s+telecom|cat-net|irt-ntpcl/i.test(combined)) {
    return "NT / CAT";
  }

  // 8. DTAC
  if (/dtac|trinet/i.test(combined)) {
    return "DTAC TriNet";
  }

  // 9. Major Global Cloud / VPN / Content providers
  if (/cloudflare/i.test(combined)) return "Cloudflare";
  if (/google/i.test(combined)) return "Google";
  if (/amazon|aws/i.test(combined)) return "Amazon AWS";
  if (/microsoft|azure/i.test(combined)) return "Microsoft Azure";
  if (/digitalocean/i.test(combined)) return "DigitalOcean";
  if (/cogent/i.test(combined)) return "Cogent Communications";
  if (/diamond\s+ip/i.test(combined)) return "Diamond IP Brokers";
  if (/innovative\s+quality/i.test(combined)) return "Innovative Quality";
  if (/singtel/i.test(combined)) return "Singtel";
  if (/mytel/i.test(combined)) return "Mytel (Myanmar)";
  if (/mpt[\s_-]|myanma\s+posts/i.test(combined)) return "MPT (Myanmar)";
  if (/ooredoo/i.test(combined)) return "Ooredoo";
  if (/telenor|atom\s+myanmar/i.test(combined)) return "ATOM / Telenor";

  // Fallback: clean legal suffixes from network_name (prefer concise network_name over long contact strings)
  const base = (net || own)
    .replace(/\b(co\.?\s*,?\s*ltd\.?|company\s+limited|public\s+company\s+limited|pte\.?\s*ltd\.?|inc\.?|llc|corp\.?)\b/gi, "")
    .replace(/[;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return base || "ไม่ระบุ";
}

/**
 * Split multi-value TPO / Case IDs like "L69081110077 / L69081110063"
 * into individual unique case IDs: ["L69081110077", "L69081110063"].
 */
export function splitCaseIds(raw?: string | null): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[\/,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}
