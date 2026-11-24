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

export function buildDestinationForPlatforms(platforms: string[]): string {
  const set = new Set(platforms.map((p) => p.toLowerCase()));
  const parts: string[] = [];
  if (set.has("facebook") || set.has("instagram") || set.has("meta")) {
    parts.push("www.facebook.com / www.instagram.com (แพลตฟอร์ม META)");
  }
  if (set.has("tiktok")) {
    parts.push("www.tiktok.com หรือ 103.136.220.0/23 หรือบริการ TikTok");
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
