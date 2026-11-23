import { NextRequest, NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import type mysql from "mysql2/promise";
import { getPool } from "@/db";
import { getSessionUser } from "@/lib/auth";

const fmt = (v: unknown) => Number(v || 0).toLocaleString("th-TH");
const TOTAL_SLIDES = 17;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const pool = getPool();
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id, report_name, template_version, summary_json, generated_at
     FROM report_snapshots WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || !rows[0].summary_json) {
    return NextResponse.json({ error: "report_not_found" }, { status: 404 });
  }

  const r =
    typeof rows[0].summary_json === "string"
      ? JSON.parse(rows[0].summary_json)
      : rows[0].summary_json;
  const s = r.summary || {};

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Social Media IP Analysis V2";
  pptx.title = r.report_name || "Social Media IP Report";

  const addFrame = (slide: PptxGenJS.Slide, num: number, title: string) => {
    slide.background = { color: "081521" };
    slide.addText("SOCIAL MEDIA IP INTELLIGENCE · V2 MYSQL", {
      x: 0.45, y: 0.28, w: 6.5, h: 0.25, fontFace: "Aptos", fontSize: 8, bold: true, color: "35D0BA",
    });
    slide.addText(title, {
      x: 0.45, y: 0.62, w: 12.1, h: 0.45, fontFace: "Aptos", fontSize: 22, bold: true, color: "FFFFFF", margin: 0,
    });
    slide.addText(`${num}/${TOTAL_SLIDES}  ·  ${r.id}`, {
      x: 8.3, y: 7.15, w: 4.5, h: 0.2, fontFace: "Aptos", fontSize: 7, color: "6F94AA", align: "right", margin: 0,
    });
  };

  // Slides 1-6: Master Lock Placeholders
  const lockedTitles = [
    "TPO Daily Online Crime Report",
    "สรุปผลการปฏิบัติงาน",
    "ผลการขอข้อมูลแพลตฟอร์ม",
    "ผลการขอข้อมูลแพลตฟอร์ม ชป.1",
    "ผลการขอข้อมูลแพลตฟอร์ม ชป.2",
    "ผลการขอข้อมูลคดีที่เข้าข่าย SCAMMER",
  ];
  lockedTitles.forEach((title, idx) => {
    const sl = pptx.addSlide();
    addFrame(sl, idx + 1, title);
    sl.addText("LOCKED MASTER TEMPLATE", {
      x: 2.5, y: 2.7, w: 8.3, h: 0.6, fontSize: 26, bold: true, color: "9AD8FF", align: "center",
    });
    sl.addText("คงโครงสร้างสไลด์ 1–6 ตามต้นฉบับรายงาน TPO", {
      x: 2.2, y: 3.45, w: 8.9, h: 0.4, fontSize: 13, color: "8DAFC1", align: "center",
    });
  });

  // Slide 7: IP & ISP KPIs
  let sl = pptx.addSlide();
  addFrame(sl, 7, "สถิติ IP และ ISP");
  const kpis: Array<[string, unknown]> = [
    ["Unique IP", s.unique_ips],
    ["Thailand IP", s.thailand_ips],
    ["Foreign IP", s.foreign_ips],
    ["Unknown IP", s.unknown_ips],
    ["ISP Groups", s.isp_groups],
    ["Thai ISP", s.thai_isp],
    ["Foreign ISP", s.foreign_isp],
    ["IP Events", s.events],
  ];
  kpis.forEach(([label, val], i) => {
    const x = 0.6 + (i % 4) * 3.12;
    const y = 1.45 + Math.floor(i / 4) * 2.1;
    sl.addShape(pptx.ShapeType.rect, { x, y, w: 2.75, h: 1.5, fill: { color: "0B2231" }, line: { color: "24546A", pt: 1 } });
    sl.addText(fmt(val), { x: x + 0.1, y: y + 0.25, w: 2.55, h: 0.55, fontSize: 24, bold: true, color: "FFFFFF", align: "center" });
    sl.addText(label, { x: x + 0.1, y: y + 0.95, w: 2.55, h: 0.3, fontSize: 10, color: "8DAFC1", align: "center" });
  });

  // Slide 8: Country Distribution
  sl = pptx.addSlide();
  addFrame(sl, 8, "การกระจาย IP ตามประเทศ (RDAP)");
  const countries = (r.countries || []).slice(0, 10);
  if (countries.length) {
    sl.addChart(
      pptx.ChartType.bar,
      [{ name: "Unique IP", labels: countries.map((c: any) => String(c.label)), values: countries.map((c: any) => Number(c.value)) }],
      { x: 0.65, y: 1.35, w: 7.6, h: 5.3, catAxisLabelColor: "A7C0CF", valAxisLabelColor: "A7C0CF", showLegend: false, chartColors: ["35D0BA"], showValue: true }
    );
  }
  sl.addChart(
    pptx.ChartType.doughnut,
    [{ name: "IP", labels: ["Thailand", "Foreign", "Unknown"], values: [Number(s.thailand_ips || 0), Number(s.foreign_ips || 0), Number(s.unknown_ips || 0)] }],
    { x: 8.6, y: 1.6, w: 3.8, h: 3.8, holeSize: 60, showLegend: true, legendPos: "b", legendColor: "D7EAF2", chartColors: ["35D0BA", "4AA8FF", "FFB84D"], showPercent: true }
  );

  // Slide 9: Top ISP
  sl = pptx.addSlide();
  addFrame(sl, 9, "เครือข่ายที่พบมากที่สุด (Top ISP by Unique IP)");
  const nets = (r.networks || []).slice(0, 10);
  if (nets.length) {
    sl.addChart(
      pptx.ChartType.bar,
      [{ name: "Unique IP", labels: nets.map((x: any) => String(x.label)), values: nets.map((x: any) => Number(x.unique_ips)) }],
      { x: 0.65, y: 1.35, w: 12.0, h: 5.4, catAxisLabelColor: "A7C0CF", valAxisLabelColor: "A7C0CF", showLegend: false, chartColors: ["4AA8FF"], showValue: true }
    );
  }

  // Slide 10: Top Foreign ISP
  sl = pptx.addSlide();
  addFrame(sl, 10, "เครือข่าย IP ต่างประเทศที่พบมากที่สุด");
  const fnets = (r.foreign_networks || []).slice(0, 10);
  if (fnets.length) {
    sl.addChart(
      pptx.ChartType.bar,
      [{ name: "Unique IP", labels: fnets.map((x: any) => String(x.label)), values: fnets.map((x: any) => Number(x.unique_ips)) }],
      { x: 0.65, y: 1.35, w: 12.0, h: 5.4, catAxisLabelColor: "A7C0CF", valAxisLabelColor: "A7C0CF", showLegend: false, chartColors: ["FFB84D"], showValue: true }
    );
  } else {
    sl.addText("ไม่พบเครือข่ายต่างประเทศภายใต้ตัวกรองที่เลือก", { x: 1, y: 3, w: 11, h: 0.8, fontSize: 20, color: "D9EDF5", align: "center" });
  }

  // Slide 11: Timeline
  sl = pptx.addSlide();
  addFrame(sl, 11, "กิจกรรม IP รายวัน (UTC+7)");
  const days = (r.timeline || []).slice(-31);
  if (days.length) {
    sl.addChart(
      pptx.ChartType.line,
      [
        { name: "Events", labels: days.map((d: any) => String(d.day)), values: days.map((d: any) => Number(d.events)) },
        { name: "Unique IP", labels: days.map((d: any) => String(d.day)), values: days.map((d: any) => Number(d.unique_ips)) },
      ],
      { x: 0.65, y: 1.35, w: 12.0, h: 5.4, catAxisLabelColor: "A7C0CF", valAxisLabelColor: "A7C0CF", showLegend: true, legendPos: "b", legendColor: "D7EAF2", chartColors: ["35D0BA", "4AA8FF"] }
    );
  }

  // Slide 12: Shared IPs
  sl = pptx.addSlide();
  addFrame(sl, 12, "ความเชื่อมโยงบัญชีและ IP (Shared IPs)");
  const shared = (r.shared_ips || []).slice(0, 10);
  shared.forEach((x: any, i: number) => {
    const y = 1.3 + i * 0.48;
    sl.addText(String(x.ip), { x: 0.7, y, w: 2.6, h: 0.3, fontSize: 10, bold: true, color: "35D0BA" });
    sl.addText(`${fmt(x.accounts)} บัญชี`, { x: 3.4, y, w: 1.4, h: 0.3, fontSize: 10, color: "FFFFFF" });
    sl.addText(String(x.network || "Unknown"), { x: 4.9, y, w: 5.2, h: 0.3, fontSize: 10, color: "9AD8FF" });
    sl.addText(String(x.country || "Unknown"), { x: 10.2, y, w: 2.2, h: 0.3, fontSize: 10, color: "A7C0CF" });
  });
  sl.addText("หมายเหตุ: Shared IP อาจเกิดจาก NAT / CGNAT / VPN และไม่ยืนยันตัวบุคคลโดยลำพัง", {
    x: 0.7, y: 6.55, w: 11.7, h: 0.3, fontSize: 9, color: "FFCF82",
  });

  // Slides 13-17
  const remaining: Array<[number, string, string]> = [
    [13, "ขอบเขตรายงาน (Report Scope)", `แพลตฟอร์ม: ${r.filters?.platform || "ทั้งหมด"}\nช่วงวันที่: ${r.filters?.date_from || "ทั้งหมด"} ถึง ${r.filters?.date_to || "ปัจจุบัน"}\nรวม ${fmt(s.events)} เหตุการณ์ · ${fmt(s.accounts)} บัญชี · ${fmt(s.unique_ips)} Unique IP`],
    [14, "ข้อมูลคดีที่เข้าข่าย Scammer", `เหตุการณ์ในเคส Scammer: ${fmt(s.scammer_events)} รายการ\nบัญชีที่เชื่อมโยง Scammer: ${fmt(s.scammer_accounts)} บัญชี\nUnique IP ในเคส Scammer: ${fmt(s.scammer_ips)} IP`],
    [15, "ความครบถ้วนของข้อมูล (Data Quality)", `IP ไม่ทราบประเทศ (Unknown RDAP): ${fmt(s.unknown_ips)} รายการ\nตัวเลขทั้งหมดคำนวณตรงจากฐานข้อมูล MySQL 8.0`],
    [16, "ข้อจำกัดการตีความ (Interpretation)", "การใช้ IP เดียวกันไม่ยืนยันว่าเป็นบุคคลเดียวกัน เนื่องจาก NAT, CGNAT, VPN หรือเครือข่ายสาธารณะ\nควรตรวจสอบร่วมกับ Timestamp, Port และข้อมูลผู้จดทะเบียนจาก ISP"],
    [17, "ข้อมูลตรวจสอบย้อนกลับ (Report Audit)", `${r.report_name}\nReport ID: ${r.id}\nGenerated By: ${r.generated_by}\nGenerated At: ${r.generated_at}`],
  ];

  remaining.forEach(([n, title, text]) => {
    const p = pptx.addSlide();
    addFrame(p, n, title);
    p.addText(text, {
      x: 1.0, y: 1.9, w: 11.3, h: 3.8, fontSize: 18, color: "D9EDF5", align: "center", valign: "middle",
      fill: { color: "0B2231" }, line: { color: "28495C", pt: 1 },
    });
  });

  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safeName = String(r.report_name || "report").replace(/[\\/:*?"<>|]/g, "_");

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${encodeURIComponent(safeName)}.pptx"`,
      "cache-control": "no-store",
    },
  });
}
