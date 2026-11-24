import { formatThaiDateLong, type SubpoenaEventItem } from "./docx-generator";

export interface IspContactRow {
  id: number;
  provider_code: string;
  provider_name: string;
  category: string;
  is_thai_isp: number;
  recipient: string;
  email_recipient: string;
  head_office_address: string;
  aliases: string;
  primary_channel: string;
  email_to: string;
  email_cc: string;
  email_subject_template: string;
  email_body_template: string;
  language: string;
  notes: string;
}

/**
 * Match an IP event's RDAP network_name + owner_name to the best isp_contacts record.
 */
export function matchIspContact(
  contacts: IspContactRow[],
  networkName?: string | null,
  ownerName?: string | null
): IspContactRow | null {
  const net = String(networkName || "").trim();
  const own = String(ownerName || "").trim();
  const combined = `${net} ${own}`.toLowerCase();
  if (!combined.trim()) return null;

  const byCode = new Map(contacts.map((c) => [c.provider_code, c]));

  // High-precision Thai ISP routing rules (keeps TrueMove/DTAC Mobile vs True Internet distinct)
  if (/truemove|true\s*move|realmove|dtac-mobile|dtac.*mobile|dtac.*trinet|trinet/i.test(combined)) {
    return byCode.get("ISP001") || null;
  }
  if (/trueinternet|truenet|truebb|true_bb|true-consumer|truewifi|true-corporate|true\s+internet|truehisp/i.test(combined)) {
    return byCode.get("ISP039") || byCode.get("ISP001") || null;
  }
  if (/awn[\s_-]*co|ais[\s_-]*fibre|aisfibre|ais[\s_-]*mobile|advanced\s+wireless|advanced\s+info/i.test(combined)) {
    return byCode.get("ISP002") || null;
  }
  if (/csloxinfo|cs\s*loxinfo/i.test(combined)) {
    return byCode.get("ISP003") || null;
  }
  if (/\buih\b|united\s+information\s+highway/i.test(combined)) {
    return byCode.get("ISP004") || null;
  }
  if (/cat-idc|cat-bb|cat\s+telecom|irt-ntpcl|national\s+telecom|thix/i.test(combined)) {
    return byCode.get("ISP005") || null;
  }
  if (/totnet|tot-net|tot-th|tot\s+public|irt-tot/i.test(combined)) {
    return byCode.get("ISP034") || byCode.get("ISP005") || null;
  }
  if (/public-th|vpshispeed|cloud\s+hosting/i.test(combined)) {
    return byCode.get("ISP006") || null;
  }
  if (/readyidc|readyi-/i.test(combined)) {
    return byCode.get("ISP007") || null;
  }
  if (/jastel/i.test(combined)) {
    return byCode.get("ISP008") || null;
  }
  if (/triple\s*t|3bb|tttbb/i.test(combined)) {
    return byCode.get("ISP022") || null;
  }
  if (/\binet\b|internet\s+thailand/i.test(combined)) {
    return byCode.get("ISP023") || null;
  }
  if (/symphony/i.test(combined)) {
    return byCode.get("ISP024") || null;
  }
  if (/nipa/i.test(combined)) {
    return byCode.get("ISP025") || null;
  }
  if (/proen/i.test(combined)) {
    return byCode.get("ISP026") || null;
  }
  if (/bangmod/i.test(combined)) {
    return byCode.get("ISP037") || null;
  }
  if (/ap-network|ruk-com/i.test(combined)) {
    return byCode.get("ISP036") || null;
  }
  if (/tan\s*spirit/i.test(combined)) {
    return byCode.get("ISP035") || null;
  }
  if (/server\s*&\s*networking|san-idc/i.test(combined)) {
    return byCode.get("ISP038") || null;
  }

  // Generic alias / provider_name match across all 39 contacts (including Cloud / International)
  const netLow = net.toLowerCase();
  for (const c of contacts) {
    const aliasTokens = String(c.aliases || "")
      .split(/[,;/\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 3);
    for (const alias of aliasTokens) {
      if ((netLow && (netLow === alias || netLow.includes(alias))) || combined.includes(alias)) {
        return c;
      }
    }
    const pname = c.provider_name.toLowerCase();
    if (pname.length >= 4 && combined.includes(pname)) {
      return c;
    }
  }

  return null;
}

export function isAisOrTrueDtac(
  providerCode?: string | null,
  providerName?: string | null,
  rawNetworkName?: string | null
): boolean {
  const code = String(providerCode || "").toUpperCase();
  const rawNet = String(rawNetworkName || "").toLowerCase();
  // Exclude Mobile & Home Broadband ISPs from Clause 3 (90-day traffic log):
  // TRUE/DTAC Mobile (ISP001), AIS/AIS Fibre (ISP002), TrueNet/True Internet (ISP039),
  // 3BB / Triple T Broadband (ISP022), TOT Broadband (ISP034), and NT Broadband (ISP005 unless CAT-IDC)
  if (code === "ISP001" || code === "ISP002" || code === "ISP039" || code === "ISP022" || code === "ISP034") {
    return true;
  }
  if (code === "ISP005" && !/idc/i.test(rawNet)) {
    return true;
  }
  const combined = `${providerName || ""} ${rawNetworkName || ""}`.toLowerCase();
  return /ais|awn|advanced\s+wireless|truemove|true\s*corp|true\s*internet|truenet|true_bb|truebb|dtac|3bb|triple\s*t|tttbb|totnet|tot-net|tot-th|cat-bb/.test(
    combined
  );
}

const SHORT_CODE_MAP: Record<string, string> = {
  ISP001: "TRUE_DTAC",
  ISP002: "AIS",
  ISP003: "CSLOXINFO",
  ISP004: "UIH",
  ISP005: "NT",
  ISP006: "CLOUD_HOSTING",
  ISP007: "READYIDC",
  ISP008: "JASTEL",
  ISP009: "PACIFIC_CITIC",
  ISP010: "AWS",
  ISP011: "ALIBABA_CLOUD",
  ISP012: "GTT",
  ISP013: "OVH",
  ISP014: "ZENLAYER",
  ISP015: "TELKOMSIGMA",
  ISP016: "MYTEL",
  ISP017: "IMNCL",
  ISP018: "GLOBALNET_MM",
  ISP019: "IQI_MM",
  ISP020: "CHEN_MM",
  ISP022: "3BB",
  ISP023: "INET",
  ISP024: "SYMPHONY",
  ISP025: "NIPA",
  ISP026: "PROEN",
  ISP027: "CLOUDFLARE",
  ISP028: "GOOGLE",
  ISP029: "AZURE",
  ISP030: "DIGITALOCEAN",
  ISP031: "ORACLE",
  ISP032: "AKAMAI",
  ISP033: "STARLINK",
  ISP034: "TOT",
  ISP035: "TAN_SPIRIT",
  ISP036: "RUKCOM",
  ISP037: "BANGMOD",
  ISP038: "SAN_IDC",
  ISP039: "TRUENET",
};

export function getIspShortCode(contact: IspContactRow | null, fallbackName: string): string {
  if (contact && SHORT_CODE_MAP[contact.provider_code]) {
    return SHORT_CODE_MAP[contact.provider_code];
  }
  const clean = String(fallbackName || "ISP")
    .replace(/[^0-9A-Za-zก-๙]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  return clean || "ISP";
}

export function buildDestinationForPlatforms(platforms: string[]): string {
  const set = new Set(platforms.map((p) => p.toLowerCase()));
  const hasMeta = set.has("facebook") || set.has("instagram") || set.has("meta");
  const hasTikTok = set.has("tiktok");
  const parts: string[] = [];

  if (hasMeta) {
    const domains: string[] = [];
    if (set.has("facebook") || set.has("meta")) {
      domains.push("facebook.com, www.facebook.com, m.facebook.com, *.facebook.com, *.fbcdn.net");
    }
    if (set.has("instagram")) {
      domains.push("instagram.com, www.instagram.com, *.instagram.com, *.cdninstagram.com");
    }
    parts.push(
      `${domains.join(", ")} รวมถึงหมายเลข IP Address ปลายทางภายใต้เครือข่าย Meta Platforms (AS32934) เช่น 31.13.64.0/18, 57.144.0.0/14, 129.134.0.0/16, 157.240.0.0/16, 163.70.128.0/17, 173.252.64.0/18 หรือบริการของ META`
    );
  }

  if (hasTikTok) {
    parts.push(
      `www.tiktok.com, *.tiktok.com รวมถึงหมายเลข IP Address ปลายทางของเซิร์ฟเวอร์ เช่น 103.136.220.0/23, 103.136.221.27, 161.117.0.0/16, 47.246.0.0/16 หรือบริการของ Tiktok`
    );
  }

  return parts.length ? parts.join(" และ ") : "แพลตฟอร์มสื่อสังคมออนไลน์ที่เกี่ยวข้อง";
}

export function buildPlatformLabel(platforms: string[]): string {
  const set = new Set(platforms.map((p) => p.toLowerCase()));
  const labels: string[] = [];
  if (set.has("facebook") || set.has("instagram") || set.has("meta")) labels.push("META");
  if (set.has("tiktok")) labels.push("TikTok");
  return labels.length ? labels.join(" / ") : "โซเชียลมีเดีย";
}

function formatEventLinesThai(events: SubpoenaEventItem[]): string {
  const sorted = [...events].sort((a, b) =>
    String(a.local_time || "").localeCompare(String(b.local_time || ""))
  );
  return sorted
    .map((e, i) => {
      const m = String(e.local_time || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
      const dateStr = m ? formatThaiDateLong(m[1]) : e.local_time || "-";
      const timeStr = m ? `${m[2]} น.` : "";
      const portStr = e.port ? ` Port: ${e.port}` : "";
      return `${i + 1}. IP ต้นทาง: ${e.ip} วันที่ ${dateStr} เวลา ${timeStr}${portStr}`;
    })
    .join("\n");
}

function formatEventLinesEn(events: SubpoenaEventItem[]): string {
  const sorted = [...events].sort((a, b) =>
    String(a.local_time || "").localeCompare(String(b.local_time || ""))
  );
  return sorted
    .map((e, i) => {
      const m = String(e.local_time || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/);
      const dateStr = m ? `${m[3]}/${m[2]}/${m[1]}` : e.local_time || "-";
      const timeStr = m ? m[4] : "";
      const portStr = e.port ? ` | Source Port: ${e.port}` : "";
      return `${i + 1}. Source IP: ${e.ip} | Date: ${dateStr} | Time: ${timeStr} (UTC+07:00)${portStr}`;
    })
    .join("\n");
}

export interface RenderedEmailDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
  language: "TH" | "EN";
}

export function renderEmailDraft(opts: {
  contact: IspContactRow | null;
  fallbackName: string;
  letter_no: string;
  issue_date: string;
  due_date: string;
  case_summary: string;
  platforms: string[];
  destination: string;
  contact_name: string;
  contact_position: string;
  contact_phone: string;
  contact_email: string;
  events: SubpoenaEventItem[];
}): RenderedEmailDraft {
  const c = opts.contact;
  const lang: "TH" | "EN" = c?.language === "EN" ? "EN" : "TH";
  const platformLabel = buildPlatformLabel(opts.platforms);
  const dueThai = formatThaiDateLong(opts.due_date);
  const issueThai = formatThaiDateLong(opts.issue_date);
  const ipList = lang === "EN" ? formatEventLinesEn(opts.events) : formatEventLinesThai(opts.events);

  // Use custom verified template stored in isp_contacts (NT, AIS, TRUE/DTAC, True Internet)
  if (c?.email_body_template && c.email_body_template.trim().length > 20) {
    const subject = (c.email_subject_template || `ขอความร่วมมือตรวจสอบรายละเอียดการเชื่อมต่ออินเตอร์เน็ต IP Address (${opts.letter_no})`)
      .replace(/\{\{LETTER_NO\}\}/g, opts.letter_no)
      .replace(/\{\{PLATFORM\}\}/g, platformLabel);
    const body = c.email_body_template
      .replace(/\{\{PLATFORM\}\}/g, platformLabel)
      .replace(/\{\{IP_LIST\}\}/g, ipList)
      .replace(/\{\{DUE_DATE\}\}/g, dueThai)
      .replace(/\{\{ISSUE_DATE\}\}/g, issueThai)
      .replace(/\{\{LETTER_NO\}\}/g, opts.letter_no);
    return {
      to: c.email_to || "",
      cc: c.email_cc || "",
      subject,
      body,
      language: lang,
    };
  }

  // Standard fallback template (Thai / English)
  if (lang === "EN") {
    return {
      to: c?.email_to || "",
      cc: c?.email_cc || "",
      subject: `Official Law Enforcement Request – IP Address Subscriber Information – ${opts.letter_no}`,
      body:
        `Dear ${c?.provider_name || opts.fallbackName} Legal Compliance Team,\n\n` +
        `We are officers of Sub-Division 2, Technology Crime Suppression Division (TCSD), Central Investigation Bureau (CIB), Royal Thai Police, Thailand.\n\n` +
        `The following source IP address records were identified in our online fraud investigation:\n\n` +
        `${ipList}\n\n` +
        `Destination URL / IP Address / Service: ${opts.destination}\n\n` +
        `Please find attached our official request letter, Reference No. ${opts.letter_no}, dated ${opts.issue_date}.\n\n` +
        `Sincerely,\n${opts.contact_name}\n${opts.contact_position}\nTel: ${opts.contact_phone}\nEmail: ${opts.contact_email}`,
      language: "EN",
    };
  }

  const recipient = c?.email_recipient || c?.recipient || `กรรมการผู้จัดการ ${opts.fallbackName}`;
  return {
    to: c?.email_to || "",
    cc: c?.email_cc || "",
    subject: `ขอความอนุเคราะห์ตรวจสอบข้อมูลผู้ใช้บริการ IP Address ตามหมายเรียกพยานเอกสาร ที่ ${opts.letter_no}`,
    body:
      `เรียน ${recipient}\n\n` +
      `ด้วย ฝ่ายแพลตฟอร์ม ด้านต่อต้านการฉ้อโกงออนไลน์ (ANTI CYBER SCAM CENTER) กองกำกับการ 2 กองบังคับการปราบปรามการกระทำความผิดเกี่ยวกับอาชญากรรมทางเทคโนโลยี (กก.2 บก.ปอท.) อยู่ระหว่างสืบสวนสอบสวนคดีเกี่ยวกับ${opts.case_summary}\n\n` +
      `จึงใคร่ขอความอนุเคราะห์บริษัทตรวจสอบข้อมูลผู้ใช้บริการหมายเลข IP Address ตามหมายเรียกพยานเอกสาร ที่ ${opts.letter_no} ลงวันที่ ${issueThai} ดังนี้\n\n` +
      `รายละเอียดการใช้งานตามเวลาประเทศไทย (UTC+07:00) มีดังนี้\n${ipList}\n\n` +
      `URL หรือ IP ปลายทาง: ${opts.destination}\n\n` +
      `ขอความอนุเคราะห์นำส่งข้อมูลภายในวันที่ ${dueThai} ตามรายละเอียดในเอกสารแนบ\n\n` +
      `ขอแสดงความนับถือ\n\n` +
      `${opts.contact_name}\n${opts.contact_position}\nโทร. ${opts.contact_phone}\nอีเมล: ${opts.contact_email}`,
    language: "TH",
  };
}
