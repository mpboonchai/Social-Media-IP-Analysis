import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import * as cheerio from "cheerio";

const THAI_MONTHS = [
  "",
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

export interface SubpoenaEventItem {
  ip: string;
  port: string;
  local_time: string; // YYYY-MM-DD HH:MM:SS
}

export interface SubpoenaDocxInput {
  letter_no: string; // e.g. "ตช. 0026.(12)2/1075"
  issue_date: string; // YYYY-MM-DD
  recipient: string;
  address: string;
  case_summary: string;
  destination: string;
  contact_name: string;
  contact_position: string;
  contact_phone: string;
  contact_email: string;
  deadline?: string;
  include_traffic_log_90d?: boolean;
  events: SubpoenaEventItem[];
}

export function formatThaiDateLong(isoDate: string): string {
  const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoDate;
  const year = Number(m[1]) + 543;
  const month = THAI_MONTHS[Number(m[2])] || m[2];
  const day = Number(m[3]);
  return `${day} ${month} ${year}`;
}

function escapeXml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function setParagraphText($: cheerio.CheerioAPI, pEl: cheerio.Cheerio<any>, text: string) {
  // Remove hyperlinks/fldSimple children if any
  pEl.children("w\\:hyperlink, w\\:fldSimple").remove();
  const runs = pEl.children("w\\:r");
  if (runs.length > 0) {
    // Find first run without drawings/picts so embedded images are preserved
    let targetIdx = -1;
    runs.each((idx, r) => {
      const $r = $(r);
      if (targetIdx === -1 && $r.find("w\\:drawing, w\\:pict").length === 0) {
        targetIdx = idx;
      }
    });
    if (targetIdx === -1) {
      pEl.append(`<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`);
      return;
    }
    runs.each((idx, r) => {
      const $r = $(r);
      if (idx === targetIdx) {
        const ts = $r.find("w\\:t");
        if (ts.length > 0) {
          ts.first().attr("xml:space", "preserve").text(text);
          ts.slice(1).text("");
        } else {
          $r.append(`<w:t xml:space="preserve">${escapeXml(text)}</w:t>`);
        }
      } else if ($r.find("w\\:drawing, w\\:pict").length > 0) {
        $r.find("w\\:t").text("");
      } else {
        $r.find("w\\:t").text("");
      }
    });
  } else {
    pEl.append(`<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`);
  }
}

function setCellText($: cheerio.CheerioAPI, tcEl: cheerio.Cheerio<any>, text: string) {
  const ps = tcEl.children("w\\:p");
  if (ps.length > 0) {
    setParagraphText($, ps.first(), text);
    ps.slice(1).each((_, p) => setParagraphText($, $(p), ""));
  } else {
    tcEl.append(`<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`);
  }
}

let cachedTemplateBuf: Buffer | null = null;
function loadMasterTemplate(): Buffer {
  if (cachedTemplateBuf) return cachedTemplateBuf;
  const candidates = [
    path.join(process.cwd(), "src", "assets", "ISP_Master.docx"),
    path.join(process.cwd(), "public", "templates", "ISP_Master.docx"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cachedTemplateBuf = fs.readFileSync(p);
      return cachedTemplateBuf;
    }
  }
  throw new Error("ไม่พบไฟล์ต้นฉบับ ISP_Master.docx");
}

export async function generateSubpoenaDocx(input: SubpoenaDocxInput): Promise<Buffer> {
  const masterBuf = loadMasterTemplate();
  const zip = await JSZip.loadAsync(masterBuf);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("โครงสร้าง ISP_Master.docx ไม่สมบูรณ์ (ไม่พบ word/document.xml)");

  const $ = cheerio.load(docXml, { xmlMode: true });
  const body = $("w\\:body").first();
  const bodyParagraphs = body.children("w\\:p");
  const bodyTables = body.children("w\\:tbl");

  if (bodyTables.length < 5) {
    throw new Error(`โครงสร้างตารางใน ISP_Master.docx ไม่ครบ (พบ ${bodyTables.length}/5)`);
  }

  // Parse issue date
  const dateMatch = String(input.issue_date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const now = new Date();
  const y = dateMatch ? Number(dateMatch[1]) : now.getFullYear();
  const m = dateMatch ? Number(dateMatch[2]) : now.getMonth() + 1;
  const d = dateMatch ? Number(dateMatch[3]) : now.getDate();
  const thaiMonth = THAI_MONTHS[m] || String(m);
  const thaiYear = String(y + 543);
  const seqSuffix = input.letter_no.includes("/")
    ? input.letter_no.split("/").slice(1).join("/").trim()
    : input.letter_no;

  // 1. Replace "xxxx" after "/" inside top TextBox runs (paragraph 0)
  const p0Texts = bodyParagraphs.eq(0).find("w\\:t").toArray();
  for (let i = 0; i < p0Texts.length - 1; i++) {
    const cur = $(p0Texts[i]).text();
    const nxt = $(p0Texts[i + 1]).text();
    if (cur === "/" && nxt.toLowerCase() === "xxxx") {
      $(p0Texts[i + 1]).text(seqSuffix);
    }
  }

  // 2. Issue date in Table 0 row 2 (6 w:tc elements: [1]=day, [3]=month, [5]=Buddhist year)
  const t0Row2Cells = bodyTables.eq(0).children("w\\:tr").eq(2).children("w\\:tc");
  if (t0Row2Cells.length >= 6) {
    setCellText($, t0Row2Cells.eq(1), String(d));
    setCellText($, t0Row2Cells.eq(3), thaiMonth);
    setCellText($, t0Row2Cells.eq(5), thaiYear);
  }

  // 3. Recipient & Head Office Address in Table 2 (row 0 cell 1, row 1 cell 1)
  const t2Rows = bodyTables.eq(2).children("w\\:tr");
  setCellText($, t2Rows.eq(0).children("w\\:tc").eq(1), input.recipient);
  setCellText($, t2Rows.eq(1).children("w\\:tc").eq(1), input.address || "-");

  // 4. Case summary paragraph (bodyParagraphs[4] — preserve bold "ด้วยเหตุ " on run 0)
  let cleanCase = String(input.case_summary || "สืบสวนการกระทำความผิดเกี่ยวกับการฉ้อโกงทางออนไลน์").trim();
  cleanCase = cleanCase.replace(/^(ด้วยเหตุ\s+|กรณี\s+)/, "");
  const caseRest = `เจ้าหน้าที่ตำรวจได้ดำเนินการสืบสวน กรณี ${cleanCase} โดยใช้อินเตอร์เน็ตเป็นเครื่องมือในการกระทำความผิดเชื่อมโยงกัน ผ่านหมายเลข IP-Address จึงขอความอนุเคราะห์จากท่าน ตรวจสอบข้อมูล ดังรายละเอียดตามเอกสารแนบท้าย`;
  const pCase = bodyParagraphs.eq(4);
  const caseRuns = pCase.children("w\\:r");
  if (caseRuns.length >= 2) {
    caseRuns.eq(0).find("w\\:t").first().attr("xml:space", "preserve").text("ด้วยเหตุ ");
    caseRuns.eq(1).find("w\\:t").first().attr("xml:space", "preserve").text(caseRest);
    caseRuns.slice(2).find("w\\:t").text("");
  } else {
    setParagraphText($, pCase, `ด้วยเหตุ ${caseRest}`);
  }

  // 4b. Clause 1 (bodyParagraphs[6]): updated subscriber identity fields (Thai ID / Passport / Juristic ID)
  const clause1Text =
    "ตรวจสอบข้อมูล ชื่อ-สกุล, เลขประจำตัวประชาชน/หมายเลขหนังสือเดินทาง/เลขนิติบุคคล, ที่อยู่, อีเมล, หมายเลขโทรศัพท์, หมายเลข MAC Address ที่ใช้เชื่อมต่อ และรายละเอียดการขอจดทะเบียน รวมถึงข้อมูลชื่อ ที่อยู่ ที่ใช้ในการจัดส่งเอกสารของผู้ใช้บริการดังกล่าว";
  const pClause1 = bodyParagraphs.eq(6);
  setParagraphText($, pClause1, clause1Text);

  // 4c. Clause 3 (optional — all ISPs EXCEPT AIS & TRUE/DTAC): 90-day computer traffic log
  if (input.include_traffic_log_90d) {
    const issueUtcMs = Date.UTC(y, m - 1, d);
    const from90dDate = new Date(issueUtcMs - 90 * 86_400_000);
    const fromIso = from90dDate.toISOString().slice(0, 10);
    const toIso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const clause3Text =
      `ข้อมูลจราจรทางคอมพิวเตอร์ (Log File) ของผู้ใช้บริการดังกล่าว ตั้งแต่ วันที่ ${formatThaiDateLong(fromIso)} ถึง วันที่ ${formatThaiDateLong(toIso)} ` +
      `ได้แก่ วันเวลาที่เข้า-ออกระบบ (Login/Logout), หมายเลข IP Address ต้นทาง-ปลายทาง และพอร์ตเชื่อมต่อ (Port)`;

    // Clone P[6] (same Word auto-numbering w:numPr, font, indent, and zero drawings so signature in P[7] is never duplicated)
    const pClause3Xml = $.html(pClause1);
    const $pClause3 = $(pClause3Xml);
    setParagraphText($, $pClause3, clause3Text);
    bodyParagraphs.eq(7).after($pClause3);
  }

  // 5. Coordinator & email cell in Table 3 row 2 cell 0
  const deadline = input.deadline || "ภายใน 7 วัน นับแต่ได้รับหมายนี้";
  const contactText =
    `${deadline} หรือจัดส่งเอกสารข้อมูลมายังสถานที่ออกหมาย หรือนำส่งข้อมูลดังกล่าวในรูปแบบไฟล์อิเล็กทรอนิกส์มายัง E-mail : ${input.contact_email} ` +
    `พร้อมนี้ได้มอบหมายให้ ${input.contact_name} ${input.contact_position} โทร. ${input.contact_phone} เป็นผู้ติดต่อประสานงานและขอรับข้อมูลดังกล่าว ` +
    `หวังว่าคงได้รับความอนุเคราะห์จากท่านด้วยดีเช่นเคย และขอขอบคุณมา ณ โอกาสนี้ หากขัดข้องประการใด กรุณาแจ้งให้ทราบด้วย`;
  const t3Row2Cell0 = bodyTables.eq(3).children("w\\:tr").eq(2).children("w\\:tc").eq(0);
  setCellText($, t3Row2Cell0, contactText);

  // 6. Annex header paragraph ("ที่ ตช. ... ลงวันที่ ...")
  bodyParagraphs.each((_, el) => {
    const $p = $(el);
    const full = $p.text().trim();
    if (full.startsWith("ที่ ตช.") && full.includes("ลงวันที่")) {
      setParagraphText($, $p, `ที่ ${input.letter_no} ลงวันที่ ${d} ${thaiMonth} ${thaiYear}`);
    } else if (full.startsWith("URL ")) {
      setParagraphText($, $p, `URL หรือ IP ปลายทาง: ${input.destination}`);
    }
  });

  // 7. Annex IP Table (Table 4): clone row 1 for each IP event sorted chronologically
  const t4 = bodyTables.eq(4);
  const t4Rows = t4.children("w\\:tr");
  const sampleRowXml = $.html(t4Rows.eq(1));
  // Remove all data rows after header (row 0)
  t4Rows.slice(1).remove();

  const sortedEvents = [...input.events].sort((a, b) =>
    String(a.local_time || "").localeCompare(String(b.local_time || ""))
  );

  for (let i = 0; i < sortedEvents.length; i++) {
    const ev = sortedEvents[i];
    const $newRow = $(sampleRowXml);
    const cells = $newRow.children("w\\:tc");
    setCellText($, cells.eq(0), String(i + 1));
    setCellText($, cells.eq(1), ev.ip || "-");
    setCellText($, cells.eq(2), ev.port || "-");
    setCellText($, cells.eq(3), ev.local_time || "-");
    t4.append($newRow);
  }

  zip.file("word/document.xml", $.xml());
  const outBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return outBuf;
}
