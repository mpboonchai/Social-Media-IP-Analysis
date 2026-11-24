"use client";

import React, { useEffect, useState } from "react";
import { X, FileText, Download, Copy, Check, Mail, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

interface LetterEmail {
  to: string;
  cc: string;
  subject: string;
  body: string;
  language: "TH" | "EN";
}

interface LetterResult {
  group_key: string;
  provider_code: string;
  provider_name: string;
  is_thai_isp: boolean;
  matched_preset: boolean;
  letter_no: string;
  docx_filename: string;
  recipient: string;
  address: string;
  event_count: number;
  accounts: string[];
  platforms: string[];
  email: LetterEmail;
}

interface Props {
  open: boolean;
  recordKeys: string[];
  onClose: () => void;
  onCommitted: () => void;
}

function todayIsoBkk(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function addDaysIso(isoDate: string, days: number): string {
  const ms = Date.parse(isoDate + "T00:00:00Z");
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

export default function SubpoenaBatchModal({ open, recordKeys, onClose, onCommitted }: Props) {
  const [letterPrefix, setLetterPrefix] = useState("ตช. 0026.(12)2/");
  const [startNumber, setStartNumber] = useState<string>("");
  const [issueDate, setIssueDate] = useState<string>(() => todayIsoBkk());
  const [dueDate, setDueDate] = useState<string>(() => addDaysIso(todayIsoBkk(), 7));
  const [caseSummary, setCaseSummary] = useState(
    "การกระทำความผิดเกี่ยวกับการฉ้อโกงทางออนไลน์ (หลอกลวงขายสินค้า/บริการทางออนไลน์)"
  );
  const [contactName, setContactName] = useState("ร้อยตำรวจเอก บุญชัย ถิรภัทรไพบูลย์");
  const [contactPosition, setContactPosition] = useState("รองสารวัตร กก.2 บก.ปอท.");
  const [contactPhone, setContactPhone] = useState("0874427676");
  const [contactEmail, setContactEmail] = useState("pct.asc.phone@cib.go.th");
  const [updateStatus, setUpdateStatus] = useState(true);

  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [letters, setLetters] = useState<LetterResult[]>([]);
  const [totalSelected, setTotalSelected] = useState(0);
  const [committedInfo, setCommittedInfo] = useState<{
    updated_events: number;
    zip_filename: string | null;
    zip_base64: string | null;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string>("");

  async function loadPreview(customStart?: number) {
    if (!recordKeys.length) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/subpoena/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_keys: recordKeys,
          mode: "preview",
          letter_prefix: letterPrefix,
          start_number: customStart,
          issue_date: issueDate,
          due_date: dueDate,
          case_summary: caseSummary,
          contact_name: contactName,
          contact_position: contactPosition,
          contact_phone: contactPhone,
          contact_email: contactEmail,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `ตรวจสอบไม่สำเร็จ (${res.status})`);
        setLetters([]);
        return;
      }
      setLetters(body.letters || []);
      setTotalSelected(Number(body.total_selected || 0));
      if (!customStart && body.suggested_start_number) {
        setStartNumber(String(body.suggested_start_number));
      }
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && recordKeys.length > 0) {
      setCommittedInfo(null);
      loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recordKeys.join(",")]);

  if (!open) return null;

  function triggerZipDownload(base64: string, filename: string) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleCommit() {
    setCommitting(true);
    setError("");
    try {
      const parsedStart = Number(startNumber);
      const res = await fetch("/api/subpoena/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_keys: recordKeys,
          mode: "commit",
          letter_prefix: letterPrefix,
          start_number: Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : undefined,
          issue_date: issueDate,
          due_date: dueDate,
          case_summary: caseSummary,
          contact_name: contactName,
          contact_position: contactPosition,
          contact_phone: contactPhone,
          contact_email: contactEmail,
          update_status: updateStatus,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `ออกหมายเรียกไม่สำเร็จ (${res.status})`);
        return;
      }
      setLetters(body.letters || []);
      setCommittedInfo({
        updated_events: Number(body.updated_events || 0),
        zip_filename: body.zip_filename || null,
        zip_base64: body.zip_base64 || null,
      });
      if (body.zip_base64 && body.zip_filename) {
        triggerZipDownload(body.zip_base64, body.zip_filename);
      }
      if (updateStatus && Number(body.updated_events || 0) > 0) {
        onCommitted();
      }
    } catch {
      setError("เกิดข้อผิดพลาดระหว่างสร้างไฟล์หมายเรียก");
    } finally {
      setCommitting(false);
    }
  }

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? "" : prev)), 1800);
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full max-w-5xl max-h-[92vh] rounded-2xl bg-[#071638] border border-[#ffd000]/40 shadow-2xl flex flex-col overflow-hidden text-xs text-slate-100">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#05112b] border-b border-[#1d3a78] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ffd000]/15 border border-[#ffd000]/50 flex items-center justify-center">
              <FileText className="w-4 h-4 text-[#ffd000]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#ffd000]">
                ออกหนังสือหมายเรียกพยานเอกสาร (.docx) + ข้อความอีเมลอัตโนมัติ (ตัวทดสอบ)
              </h3>
              <p className="text-[11px] text-blue-200/80">
                เลือกไว้ {recordKeys.length} รายการ · จัดกลุ่มตาม ISP อัตโนมัติ · รันเลขหนังสือต่อเนื่อง + ติ๊ก &quot;ขอข้อมูลแล้ว&quot;
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#0f2454] hover:bg-[#1a3a82] text-blue-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Config Form */}
          <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-3.5 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] text-blue-300 mb-1">คำนำหน้าเลขหนังสือ</label>
                <input
                  value={letterPrefix}
                  onChange={(e) => setLetterPrefix(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#244894] text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-blue-300 mb-1">เลขรันเริ่มต้น (อัตโนมัติ)</label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={startNumber}
                    onChange={(e) => setStartNumber(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#ffd000]/60 text-[#ffd000] font-mono font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => loadPreview(Number(startNumber) || undefined)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#133273] hover:bg-[#1a4399] border border-[#2d58b5] text-blue-100 shrink-0"
                    title="รีเฟรชตัวอย่างเลขหนังสือ"
                  >
                    รีเฟรช
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-blue-300 mb-1">วันที่ออกหมาย</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => {
                    setIssueDate(e.target.value);
                    setDueDate(addDaysIso(e.target.value, 7));
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#244894] text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-blue-300 mb-1">กำหนดส่งข้อมูล (+7 วัน)</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#244894] text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-blue-300 mb-1">พฤติการณ์คดี (ในหมายเรียก)</label>
                <input
                  value={caseSummary}
                  onChange={(e) => setCaseSummary(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#244894] text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-blue-300 mb-1">ผู้ประสานงาน</label>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#244894] text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-blue-300 mb-1">อีเมลรับข้อมูลกลับ</label>
                  <input
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#244894] text-white font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 items-center">
              <div>
                <label className="block text-[11px] text-blue-300 mb-1">ตำแหน่งผู้ประสานงาน</label>
                <input
                  value={contactPosition}
                  onChange={(e) => setContactPosition(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#244894] text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-blue-300 mb-1">เบอร์โทรผู้ประสานงาน</label>
                <input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#05112b] border border-[#244894] text-white font-mono"
                />
              </div>
              <label className="flex items-center gap-2 pt-4 text-emerald-300 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={updateStatus}
                  onChange={(e) => setUpdateStatus(e.target.checked)}
                  className="accent-emerald-400 w-4 h-4"
                />
                ติ๊ก &quot;ขอข้อมูลแล้ว&quot; + บันทึกเลขหนังสือลง DB อัตโนมัติ
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-950/80 border border-rose-500/60 px-3.5 py-2.5 text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {committedInfo && (
            <div className="rounded-xl bg-emerald-950/70 border border-emerald-400/60 px-4 py-3 text-emerald-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-bold text-sm">
                    สร้างหมายเรียกสำเร็จ {letters.length} ฉบับ (รวม {totalSelected} รายการ IP)
                  </div>
                  <div className="text-[11px] text-emerald-200/90">
                    {committedInfo.updated_events > 0
                      ? `อัปเดตสถานะ "ขอข้อมูลแล้ว" + เลขหนังสือลงฐานข้อมูลแล้ว ${committedInfo.updated_events} รายการ`
                      : "ไม่ได้แก้ไขสถานะในฐานข้อมูล (โหมดสร้างไฟล์อย่างเดียว)"}
                  </div>
                </div>
              </div>
              {committedInfo.zip_base64 && committedInfo.zip_filename && (
                <button
                  type="button"
                  onClick={() => triggerZipDownload(committedInfo.zip_base64!, committedInfo.zip_filename!)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" /> ดาวน์โหลด ZIP อีกครั้ง
                </button>
              )}
            </div>
          )}

          {/* ISP Grouped Preview & Email Drafts */}
          {loading ? (
            <div className="py-10 text-center text-blue-200 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#ffd000]" /> กำลังจัดกลุ่ม ISP และเตรียมเลขหนังสือ...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[11px] text-blue-300 font-semibold">
                รายการหนังสือที่จะออกแยกตาม ISP ({letters.length} ฉบับ · {totalSelected} รายการ IP ที่ใช้ได้):
              </div>
              {letters.map((lt, idx) => (
                <div
                  key={lt.group_key}
                  className="rounded-xl bg-[#0a1d45] border border-[#244894] p-3.5 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1a346e] pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#ffd000] text-[#05112b] font-bold font-mono">
                        #{idx + 1} · {lt.letter_no}
                      </span>
                      <span className="font-bold text-white text-sm">{lt.provider_name}</span>
                      <span className="px-2 py-0.5 rounded bg-[#133273] text-sky-200 font-mono">
                        {lt.event_count} IP
                      </span>
                      {!lt.matched_preset && (
                        <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40">
                          ยังไม่พบใน Preset (ใช้ชื่อจาก RDAP)
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-blue-300">{lt.docx_filename}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-blue-300">เรียน: </span>
                      <span className="text-white">{lt.recipient}</span>
                    </div>
                    <div>
                      <span className="text-blue-300">ที่อยู่: </span>
                      <span className="text-slate-200">{lt.address}</span>
                    </div>
                  </div>

                  {/* Email Copy Box */}
                  <div className="rounded-lg bg-[#05112b] border border-[#1d3a78] p-2.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[#ffd000] font-semibold">
                        <Mail className="w-3.5 h-3.5" /> ข้อความอีเมลพร้อมส่ง ({lt.email.language})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lt.email.to && (
                          <button
                            type="button"
                            onClick={() => copyText(`to-${idx}`, lt.email.to)}
                            className="px-2 py-1 rounded bg-[#10285e] hover:bg-[#1a3a82] text-blue-100 flex items-center gap-1"
                          >
                            {copiedId === `to-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            คัดลอก To
                          </button>
                        )}
                        {lt.email.cc && (
                          <button
                            type="button"
                            onClick={() => copyText(`cc-${idx}`, lt.email.cc)}
                            className="px-2 py-1 rounded bg-[#10285e] hover:bg-[#1a3a82] text-blue-100 flex items-center gap-1"
                          >
                            {copiedId === `cc-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            คัดลอก CC
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => copyText(`subj-${idx}`, lt.email.subject)}
                          className="px-2 py-1 rounded bg-[#10285e] hover:bg-[#1a3a82] text-blue-100 flex items-center gap-1"
                        >
                          {copiedId === `subj-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          คัดลอกหัวข้อ
                        </button>
                        <button
                          type="button"
                          onClick={() => copyText(`body-${idx}`, lt.email.body)}
                          className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold flex items-center gap-1"
                        >
                          {copiedId === `body-${idx}` ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
                          คัดลอกเนื้อความ
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px] font-mono">
                      <div className="truncate">
                        <span className="text-blue-400">To: </span>
                        <span className={lt.email.to ? "text-emerald-300" : "text-amber-300"}>
                          {lt.email.to || "(ยังไม่มีอีเมลใน Preset — โปรดระบุก่อนส่ง)"}
                        </span>
                      </div>
                      <div className="truncate">
                        <span className="text-blue-400">CC: </span>
                        <span className="text-sky-200">{lt.email.cc || "—"}</span>
                      </div>
                    </div>
                    <div className="text-[11px]">
                      <span className="text-blue-400">เรื่อง: </span>
                      <span className="text-white font-semibold">{lt.email.subject}</span>
                    </div>
                    <pre className="text-[11px] text-slate-200 bg-[#030b1c] rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed border border-[#163066]">
                      {lt.email.body}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#05112b] border-t border-[#1d3a78] flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-blue-300">
            ระบบจะรวมไฟล์ `.docx` ทุกฉบับ + `Email_Drafts_All_ISPs.txt` เป็นไฟล์ `.zip` ดาวน์โหลดทีเดียว
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg bg-[#10285e] hover:bg-[#1a3a82] text-blue-100"
            >
              ปิดหน้าต่าง
            </button>
            <button
              type="button"
              disabled={loading || committing || letters.length === 0}
              onClick={handleCommit}
              className="px-4 py-2 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold flex items-center gap-1.5 disabled:opacity-50"
            >
              {committing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> กำลังสร้างหมายเรียก...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" /> ออกหมายเรียกทั้งหมด ({letters.length} ฉบับ)
                  {updateStatus ? " + อัปเดตขอข้อมูลแล้ว" : ""}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
