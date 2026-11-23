"use client";

import React, { useRef, useState } from "react";
import { Upload, X, FileArchive, CheckCircle2, AlertTriangle, Loader2, Trash2 } from "lucide-react";

interface FileResultItem {
  filename: string;
  platform: string;
  parser_used: string;
  status: string;
  records: number;
  inserted_new?: number;
  skipped_duplicates?: number;
  unique_ips: number;
  scammer_matched: number;
  error?: string;
}

interface QueuedFile {
  id: string;
  file: File;
  state: "queued" | "uploading" | "done" | "duplicate" | "error";
  result?: FileResultItem;
}

interface ZipUploadModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const fmt = (n: number | undefined) => Number(n || 0).toLocaleString("th-TH");

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ZipUploadModal({ open, onClose, onComplete }: ZipUploadModalProps) {
  const [platformHint, setPlatformHint] = useState<"META" | "TikTok" | "auto">("auto");
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [liveStatus, setLiveStatus] = useState("");
  const [doneSummary, setDoneSummary] = useState<{
    totalFiles: number;
    processedFiles: number;
    duplicateFiles: number;
    failedFiles: number;
    totalParsed: number;
    totalInsertedNew: number;
    totalSkippedDup: number;
    totalScammerMatched: number;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".zip"));
    if (!incoming.length) return;
    setDoneSummary(null);
    setQueue((prev) => {
      const existingNames = new Set(prev.map((q) => `${q.file.name}:${q.file.size}`));
      const next = [...prev];
      for (const f of incoming) {
        const key = `${f.name}:${f.size}`;
        if (existingNames.has(key)) continue;
        next.push({ id: `${Date.now()}-${Math.random()}`, file: f, state: "queued" });
      }
      return next;
    });
  }

  function removeQueuedFile(id: string) {
    if (busy) return;
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (busy) return;
    if (e.dataTransfer.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  }

  async function startUpload() {
    if (!queue.length || busy) return;
    setBusy(true);
    setDoneSummary(null);

    let processedFiles = 0;
    let duplicateFiles = 0;
    let failedFiles = 0;
    let totalParsed = 0;
    let totalInsertedNew = 0;
    let totalSkippedDup = 0;
    let totalScammerMatched = 0;

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      setCurrentIdx(i + 1);
      setLiveStatus(
        `กำลังประมวลผลไฟล์ที่ ${i + 1}/${queue.length}: ${item.file.name} — แตกไฟล์ ZIP ➔ แยกโครงสร้าง META/TikTok ➔ ตรวจซ้ำ SHA-256 ➔ จับคู่เคส Scammer ➔ ดึง RDAP ➔ บันทึก TiDB Cloud`
      );

      setQueue((prev) =>
        prev.map((q, idx) => (idx === i ? { ...q, state: "uploading" } : q))
      );

      try {
        const fd = new FormData();
        fd.append("platform_hint", platformHint);
        fd.append("files", item.file);

        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const body = await res.json();
        const r: FileResultItem | undefined = body.results?.[0];

        if (!res.ok || !r || r.status === "failed") {
          failedFiles++;
          const errMsg = r?.error || body.error || `HTTP ${res.status}`;
          setQueue((prev) =>
            prev.map((q, idx) =>
              idx === i
                ? {
                    ...q,
                    state: "error",
                    result: r || {
                      filename: item.file.name,
                      platform: platformHint,
                      parser_used: platformHint,
                      status: "failed",
                      records: 0,
                      unique_ips: 0,
                      scammer_matched: 0,
                      error: errMsg,
                    },
                  }
                : q
            )
          );
        } else if (r.status === "skipped_duplicate") {
          duplicateFiles++;
          totalSkippedDup += Number(r.records || 0);
          setQueue((prev) =>
            prev.map((q, idx) => (idx === i ? { ...q, state: "duplicate", result: r } : q))
          );
        } else {
          processedFiles++;
          totalParsed += Number(r.records || 0);
          totalInsertedNew += Number(r.inserted_new ?? r.records ?? 0);
          totalSkippedDup += Number(r.skipped_duplicates || 0);
          totalScammerMatched += Number(r.scammer_matched || 0);
          setQueue((prev) =>
            prev.map((q, idx) => (idx === i ? { ...q, state: "done", result: r } : q))
          );
        }
      } catch (err) {
        failedFiles++;
        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i
              ? {
                  ...q,
                  state: "error",
                  result: {
                    filename: item.file.name,
                    platform: platformHint,
                    parser_used: platformHint,
                    status: "failed",
                    records: 0,
                    unique_ips: 0,
                    scammer_matched: 0,
                    error: err instanceof Error ? err.message : "Network error",
                  },
                }
              : q
          )
        );
      }
    }

    setBusy(false);
    setLiveStatus("อัปโหลดและประมวลผลครบทุกไฟล์เรียบร้อยแล้ว!");
    setDoneSummary({
      totalFiles: queue.length,
      processedFiles,
      duplicateFiles,
      failedFiles,
      totalParsed,
      totalInsertedNew,
      totalSkippedDup,
      totalScammerMatched,
    });
    onComplete();
  }

  function handleResetAndClose() {
    if (busy) return;
    setQueue([]);
    setLiveStatus("");
    setDoneSummary(null);
    setCurrentIdx(0);
    onClose();
  }

  const completedCount = queue.filter((q) => q.state === "done" || q.state === "duplicate" || q.state === "error").length;
  const progressPct = queue.length > 0 ? Math.round((completedCount / queue.length) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-3 sm:p-4 z-50">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0a1d45] border-2 border-[#ffd000]/60 p-4 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">
              MULTI-FILE RAW EVIDENCE INGESTION · ACSC · CIB · TCSD
            </p>
            <h3 className="font-bold text-white text-base">
              อัปโหลดไฟล์ดิบ ZIP ลงฐานข้อมูล (META / TikTok)
            </h3>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleResetAndClose}
            className="text-blue-200 hover:text-white disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Platform Parser Tabs */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          {(
            [
              { id: "auto", title: "ตรวจจับอัตโนมัติ", sub: "อัปโหลด META + TikTok รวมได้" },
              { id: "META", title: "META ZIP", sub: "Facebook / Instagram" },
              { id: "TikTok", title: "TikTok ZIP", sub: "TikTok Response ZIP" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              disabled={busy}
              onClick={() => setPlatformHint(tab.id)}
              className={`p-2.5 rounded-xl border text-left transition ${
                platformHint === tab.id
                  ? "bg-[#ffd000] text-[#05112b] border-[#ffd000] font-bold"
                  : "bg-[#05112b] text-blue-100 border-[#1d3a78] hover:border-[#ffd000]/50"
              }`}
            >
              <div className="text-xs sm:text-sm font-bold">{tab.title}</div>
              <div className="text-[10px] sm:text-[11px] opacity-80">{tab.sub}</div>
            </button>
          ))}
        </div>

        {/* Drag & Drop Multi-File Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !busy && inputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-5 sm:p-6 text-center cursor-pointer transition ${
            isDragging
              ? "border-[#ffd000] bg-[#ffd000]/15 scale-[1.01]"
              : "border-[#2a4f9e] bg-[#05112b] hover:border-[#ffd000]/70 hover:bg-[#08193d]"
          } ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".zip"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Upload className="w-8 h-8 mx-auto text-[#ffd000] mb-2" />
          <p className="text-sm font-bold text-white">
            ลากไฟล์ ZIP มาวางที่นี่พร้อมกันหลายไฟล์ หรือคลิกเพื่อเลือกไฟล์
          </p>
          <p className="text-xs text-blue-200/80 mt-1">
            รองรับไฟล์ `.zip` จากทั้ง META และ TikTok · ระบบตรวจกรองไฟล์ซ้ำ (SHA-256) และรายการซ้ำอัตโนมัติ
          </p>
        </div>

        {/* Queued Files List */}
        {queue.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-blue-100">
                รายการไฟล์ที่เลือก ({queue.length} ไฟล์)
              </span>
              {!busy && (
                <button
                  type="button"
                  onClick={() => {
                    setQueue([]);
                    setDoneSummary(null);
                    setLiveStatus("");
                  }}
                  className="text-rose-300 hover:text-rose-200 underline"
                >
                  ล้างรายการทั้งหมด
                </button>
              )}
            </div>

            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 text-xs">
              {queue.map((q) => (
                <div
                  key={q.id}
                  className={`rounded-lg border p-2.5 flex flex-col gap-1 ${
                    q.state === "uploading"
                      ? "bg-[#10285e] border-[#ffd000]"
                      : q.state === "done"
                      ? "bg-[#05112b] border-emerald-500/40"
                      : q.state === "duplicate"
                      ? "bg-[#05112b] border-amber-500/40"
                      : q.state === "error"
                      ? "bg-[#05112b] border-rose-500/50"
                      : "bg-[#05112b] border-[#1d3a78]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {q.state === "uploading" ? (
                        <Loader2 className="w-4 h-4 text-[#ffd000] animate-spin shrink-0" />
                      ) : q.state === "done" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : q.state === "duplicate" ? (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <FileArchive className="w-4 h-4 text-blue-300 shrink-0" />
                      )}
                      <span className="font-semibold text-white truncate">{q.file.name}</span>
                      <span className="text-[11px] text-blue-300 shrink-0">({fmtBytes(q.file.size)})</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          q.state === "uploading"
                            ? "bg-[#ffd000] text-[#05112b]"
                            : q.state === "done"
                            ? "bg-emerald-900/80 text-emerald-200"
                            : q.state === "duplicate"
                            ? "bg-amber-900/80 text-amber-200"
                            : q.state === "error"
                            ? "bg-rose-900/80 text-rose-200"
                            : "bg-[#0f2454] text-blue-200"
                        }`}
                      >
                        {q.state === "queued"
                          ? "รอคิว"
                          : q.state === "uploading"
                          ? "กำลังประมวลผล..."
                          : q.state === "done"
                          ? "นำเข้าสำเร็จ"
                          : q.state === "duplicate"
                          ? "ไฟล์ซ้ำ (ข้าม)"
                          : "ผิดพลาด"}
                      </span>
                      {!busy && q.state === "queued" && (
                        <button
                          type="button"
                          onClick={() => removeQueuedFile(q.id)}
                          className="p-1 text-slate-400 hover:text-rose-400"
                          title="นำออก"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {q.result && (
                    <div className="text-[11px] text-blue-200 pl-6">
                      {q.state === "done" && (
                        <>
                          ตัวอ่าน: {q.result.parser_used} · อ่านได้ {fmt(q.result.records)} ·{" "}
                          <span className="text-emerald-300 font-bold">เพิ่มใหม่ +{fmt(q.result.inserted_new)}</span> ·{" "}
                          <span className="text-amber-300">ซ้ำ (ข้าม) {fmt(q.result.skipped_duplicates)}</span> ·{" "}
                          {fmt(q.result.unique_ips)} IP · Scammer: {fmt(q.result.scammer_matched)}
                        </>
                      )}
                      {q.state === "duplicate" && (
                        <span className="text-amber-300">
                          ไฟล์นี้มีในระบบแล้ว (SHA-256 ตรงกัน) — ข้ามอัตโนมัติไม่นับซ้ำ ({fmt(q.result.records)} รายการเดิม)
                        </span>
                      )}
                      {q.state === "error" && (
                        <span className="text-rose-300">สาเหตุ: {q.result.error}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live Progress Bar & Step Status */}
        {(busy || liveStatus) && (
          <div className="rounded-xl bg-[#05112b] border border-[#1d3a78] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#ffd000]">
                {busy ? `กำลังดำเนินการ (${currentIdx}/${queue.length} ไฟล์)` : "สถานะการทำงาน"}
              </span>
              <span className="font-mono font-bold text-white">{progressPct}%</span>
            </div>
            <div className="w-full h-2 bg-[#0a1d45] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#2563eb] via-[#38bdf8] to-[#ffd000] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-[11px] text-blue-200 leading-relaxed">{liveStatus}</p>
          </div>
        )}

        {/* Final Completion Notification Banner */}
        {doneSummary && (
          <div className="rounded-xl bg-emerald-950/60 border-2 border-emerald-400/60 p-3.5 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>อัปโหลดและบันทึกลงฐานข้อมูล TiDB Cloud เสร็จสมบูรณ์!</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div className="rounded-lg bg-[#05112b] p-2 border border-[#1d3a78]">
                <div className="text-[10px] text-blue-300">ไฟล์ใหม่ที่นำเข้า</div>
                <div className="text-base font-bold text-emerald-300">
                  {fmt(doneSummary.processedFiles)} / {fmt(doneSummary.totalFiles)} ไฟล์
                </div>
              </div>
              <div className="rounded-lg bg-[#05112b] p-2 border border-[#1d3a78]">
                <div className="text-[10px] text-blue-300">ไฟล์ซ้ำ (ข้ามทั้งไฟล์)</div>
                <div className="text-base font-bold text-amber-300">{fmt(doneSummary.duplicateFiles)} ไฟล์</div>
              </div>
              <div className="rounded-lg bg-[#05112b] p-2 border border-[#1d3a78]">
                <div className="text-[10px] text-blue-300">รายการ IP เพิ่มใหม่จริง</div>
                <div className="text-base font-bold text-[#ffd000]">+{fmt(doneSummary.totalInsertedNew)} รายการ</div>
              </div>
              <div className="rounded-lg bg-[#05112b] p-2 border border-[#1d3a78]">
                <div className="text-[10px] text-blue-300">รายการซ้ำที่ถูกข้าม</div>
                <div className="text-base font-bold text-blue-200">{fmt(doneSummary.totalSkippedDup)} รายการ</div>
              </div>
            </div>
            {doneSummary.failedFiles > 0 && (
              <p className="text-rose-300 font-medium">
                * มีไฟล์ที่ไม่สำเร็จ {fmt(doneSummary.failedFiles)} ไฟล์ (ตรวจสอบรายละเอียดในรายการด้านบน)
              </p>
            )}
          </div>
        )}

        {/* Footer Buttons */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={handleResetAndClose}
            className="px-4 py-2 rounded-lg bg-[#0f2454] hover:bg-[#163475] text-blue-100 text-xs sm:text-sm disabled:opacity-40"
          >
            ปิดหน้าต่าง
          </button>
          <button
            type="button"
            disabled={busy || queue.length === 0}
            onClick={startUpload}
            className="px-5 py-2 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold text-xs sm:text-sm disabled:opacity-40 flex items-center gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> กำลังอัปโหลด ({currentIdx}/{queue.length})...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" /> เริ่มอัปโหลด ({queue.length} ไฟล์)
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
