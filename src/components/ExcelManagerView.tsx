"use client";

import React, { useState } from "react";
import { Save, Copy, CheckSquare, ArrowUpDown, RotateCcw, Download } from "lucide-react";
import ColumnFilterPopover from "./ColumnFilterPopover";

export interface ExcelEventRow {
  record_key: string;
  platform: string;
  event_type: string;
  local_time: string | null;
  utc_at: string | null;
  ip: string | null;
  port: number | null;
  ip_type: string;
  it_no: string;
  inst_id: string;
  tpo_code: string;
  scammer_case: string;
  reported_date: string;
  team: string;
  case_window_match: number;
  source_zip: string;
  account: string;
  account_identifier: string;
  target_id?: string;
  meta_account_type: string;
  meta_actor_display: string;
  country: string;
  network: string;
  owner: string;
  no_ip_data: number;
  unavailable: number;
  requested: number;
  replied: number;
  received: number;
  no_ip_request_needed: number;
  letter_number: string;
  result: string;
  entity_name?: string;
  entity_phone?: string;
}

interface RowDraft {
  unavailable: boolean;
  requested: boolean;
  replied: boolean;
  received: boolean;
  no_ip_request_needed: boolean;
  letter_number: string;
  result: string;
  entity_name: string;
  entity_phone: string;
}

interface ExcelManagerViewProps {
  records: ExcelEventRow[];
  isAdmin: boolean;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  colFilters: {
    platform: string[];
    team: string[];
    reported_date: string[];
    scammer_case: string[];
    meta_type: string[];
  };
  onColFilterChange: (key: "platform" | "team" | "reported_date" | "scammer_case" | "meta_type", vals: string[]) => void;
  onSaved: () => void;
  onExportCsv: () => void;
}

export default function ExcelManagerView({
  records,
  isAdmin,
  sortBy,
  sortDir,
  onSort,
  colFilters,
  onColFilterChange,
  onSaved,
  onExportCsv,
}: ExcelManagerViewProps) {
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Bulk apply bar state
  const [bulkStatus, setBulkStatus] = useState<"" | "requested" | "replied" | "received" | "unavailable" | "no_ip_request_needed">("");
  const [bulkLetter, setBulkLetter] = useState("");
  const [bulkResult, setBulkResult] = useState("");

  function getRowDraft(row: ExcelEventRow): RowDraft {
    if (drafts[row.record_key]) return drafts[row.record_key];
    return {
      unavailable: Boolean(row.unavailable),
      requested: Boolean(row.requested),
      replied: Boolean(row.replied),
      received: Boolean(row.received),
      no_ip_request_needed: Boolean(row.no_ip_request_needed),
      letter_number: row.letter_number || "",
      result: row.result || "",
      entity_name: row.entity_name || "",
      entity_phone: row.entity_phone || "",
    };
  }

  function updateCell<K extends keyof RowDraft>(row: ExcelEventRow, field: K, value: RowDraft[K]) {
    const current = getRowDraft(row);
    setDrafts((prev) => ({
      ...prev,
      [row.record_key]: { ...current, [field]: value },
    }));
  }

  function toggleSelectAll() {
    if (selectedKeys.length === records.length) {
      setSelectedKeys([]);
    } else {
      setSelectedKeys(records.map((r) => r.record_key));
    }
  }

  function toggleRow(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function applyBulkToSelected() {
    if (!selectedKeys.length) return;
    const nextDrafts = { ...drafts };
    for (const row of records) {
      if (!selectedKeys.includes(row.record_key)) continue;
      const cur = nextDrafts[row.record_key] || getRowDraft(row);
      const updated = { ...cur };
      if (bulkStatus) updated[bulkStatus] = true;
      if (bulkLetter.trim()) updated.letter_number = bulkLetter.trim();
      if (bulkResult.trim()) updated.result = bulkResult.trim();
      nextDrafts[row.record_key] = updated;
    }
    setDrafts(nextDrafts);
    setStatusMsg(`กำหนดค่าในตารางแล้ว ${selectedKeys.length} แถว — กด "บันทึกทั้งหมด" เพื่อบันทึกลงฐานข้อมูล`);
  }

  async function saveAllChanges() {
    const dirtyKeys = Object.keys(drafts);
    if (!dirtyKeys.length) return;
    setSaving(true);
    setStatusMsg("กำลังบันทึกลงฐานข้อมูล TiDB Cloud...");
    try {
      const updates = dirtyKeys.map((record_key) => ({
        record_key,
        ...drafts[record_key],
      }));
      const res = await fetch("/api/events/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const body = await res.json();
      if (!res.ok) {
        setStatusMsg(`บันทึกไม่สำเร็จ: ${body.error || res.status}`);
        return;
      }
      setDrafts({});
      setSelectedKeys([]);
      setStatusMsg(`บันทึกสำเร็จ ${body.updated} แถวเรียบร้อยแล้ว`);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function copyVisibleAsTsv() {
    const headers = [
      "เวลา UTC+7", "แพลตฟอร์ม", "IT No.", "Target ID", "INST ID", "TPO code",
      "เคส Scammer", "วันที่รับแจ้ง", "ทีม", "บัญชี", "IP", "Port", "เครือข่าย", "ประเทศ",
      "ขอไม่ได้", "ขอแล้ว", "ตอบกลับ", "ได้รับ", "ไม่ต้องขอ", "เลขหนังสือ", "ผลลัพธ์", "ชื่อเจ้าของ", "เบอร์โทร"
    ];
    const lines = [headers.join("\t")];
    for (const r of records) {
      const d = getRowDraft(r);
      lines.push([
        r.local_time || "", r.platform, r.it_no || "", r.target_id || "", r.inst_id || "", r.tpo_code || "",
        r.scammer_case || "", r.reported_date || "", r.team || "", r.account, r.ip || "", r.port ?? "", r.network || "", r.country || "",
        d.unavailable ? "1" : "0", d.requested ? "1" : "0", d.replied ? "1" : "0", d.received ? "1" : "0", d.no_ip_request_needed ? "1" : "0",
        d.letter_number, d.result, d.entity_name, d.entity_phone
      ].join("\t"));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    setStatusMsg(`คัดลอก ${records.length} แถวแล้ว — สามารถกด Ctrl+V วางลง Microsoft Excel / Google Sheets ได้ทันที!`);
  }

  const dirtyCount = Object.keys(drafts).length;
  const distinctTeams = Array.from(new Set(records.map((r) => r.team || "(ว่าง)"))).sort();
  const distinctDates = Array.from(new Set(records.map((r) => r.reported_date || "(ว่าง)"))).sort().reverse();
  const distinctMetaTypes = Array.from(new Set(records.map((r) => r.meta_account_type || "(ว่าง)"))).sort();

  const sortIndicator = (col: string) =>
    sortBy === col ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div className="space-y-3">
      {/* Excel Toolbar */}
      <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-[#ffd000]/15 border border-[#ffd000]/50 text-[#ffd000] font-bold">
            โหมดตาราง Excel (Inline Edit)
          </span>
          <button
            type="button"
            onClick={copyVisibleAsTsv}
            className="px-3 py-1.5 rounded-lg bg-[#10285e] hover:bg-[#17367d] border border-[#274b9c] text-blue-100 flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" /> คัดลอกวางใน Excel (Ctrl+V)
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            className="px-3 py-1.5 rounded-lg bg-[#10285e] hover:bg-[#17367d] border border-[#274b9c] text-blue-100 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> ส่งออก CSV (3 ชุด)
          </button>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {dirtyCount > 0 && (
              <button
                type="button"
                onClick={() => { setDrafts({}); setStatusMsg(""); }}
                className="px-3 py-1.5 rounded-lg bg-[#071533] hover:bg-[#0e2454] border border-[#274b9c] text-slate-300 flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" /> ยกเลิกที่แก้ ({dirtyCount})
              </button>
            )}
            <button
              type="button"
              disabled={dirtyCount === 0 || saving}
              onClick={saveAllChanges}
              className="px-4 py-1.5 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold flex items-center gap-1.5 disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "กำลังบันทึก..." : `บันทึกทั้งหมด (${dirtyCount} แถว)`}
            </button>
          </div>
        )}
      </div>

      {/* Bulk Action Bar for Selected Rows */}
      {isAdmin && selectedKeys.length > 0 && (
        <div className="rounded-xl bg-[#10285e] border border-[#ffd000]/60 p-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-[#ffd000] flex items-center gap-1.5">
            <CheckSquare className="w-4 h-4" /> เลือกอยู่ {selectedKeys.length} แถว:
          </span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as typeof bulkStatus)}
            className="rounded-lg bg-[#05112b] border border-[#274b9c] px-2.5 py-1.5 text-white"
          >
            <option value="">-- กำหนดสถานะพร้อมกัน --</option>
            <option value="requested">ติ๊ก: ขอข้อมูลแล้ว</option>
            <option value="replied">ติ๊ก: ตอบกลับแล้ว</option>
            <option value="received">ติ๊ก: ได้รับข้อมูลแล้ว</option>
            <option value="unavailable">ติ๊ก: ขอข้อมูลไม่ได้</option>
            <option value="no_ip_request_needed">ติ๊ก: ไม่ต้องขอ IP</option>
          </select>
          <input
            type="text"
            placeholder="ใส่เลขหนังสือทั้งชุด..."
            value={bulkLetter}
            onChange={(e) => setBulkLetter(e.target.value)}
            className="rounded-lg bg-[#05112b] border border-[#274b9c] px-2.5 py-1.5 text-white w-44"
          />
          <input
            type="text"
            placeholder="ใส่ผลลัพธ์/หมายเหตุทั้งชุด..."
            value={bulkResult}
            onChange={(e) => setBulkResult(e.target.value)}
            className="rounded-lg bg-[#05112b] border border-[#274b9c] px-2.5 py-1.5 text-white w-52"
          />
          <button
            type="button"
            onClick={applyBulkToSelected}
            className="px-3 py-1.5 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold"
          >
            ใช้กับแถวที่เลือก
          </button>
        </div>
      )}

      {statusMsg && (
        <div className="rounded-lg bg-[#0e2454] border border-[#ffd000]/40 px-3 py-2 text-xs text-[#ffd000]">
          {statusMsg}
        </div>
      )}

      {/* Spreadsheet Grid */}
      <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] overflow-hidden">
        <div className="overflow-x-auto max-h-[68vh]">
          <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
            <thead className="bg-[#05112b] text-blue-200 sticky top-0 z-20 border-b border-[#ffd000]/40">
              <tr>
                {isAdmin && (
                  <th className="px-2 py-2.5 border-r border-[#1a346e] text-center w-9">
                    <input
                      type="checkbox"
                      checked={records.length > 0 && selectedKeys.length === records.length}
                      onChange={toggleSelectAll}
                      className="accent-[#ffd000]"
                    />
                  </th>
                )}
                <th className="px-2 py-2.5 border-r border-[#1a346e] text-slate-400 text-center w-10">#</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e] cursor-pointer hover:text-[#ffd000]" onClick={() => onSort("local_time")}>
                  <span className="inline-flex items-center gap-1">เวลา UTC+7 <ArrowUpDown className="w-3 h-3" />{sortIndicator("local_time")}</span>
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">
                  <div className="inline-flex items-center gap-1">
                    <span className="cursor-pointer hover:text-[#ffd000]" onClick={() => onSort("platform")}>แพลตฟอร์ม{sortIndicator("platform")}</span>
                    <ColumnFilterPopover
                      title="แพลตฟอร์ม"
                      options={["TikTok", "Facebook", "Instagram"]}
                      selected={colFilters.platform}
                      onApply={(v) => onColFilterChange("platform", v)}
                    />
                  </div>
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e] cursor-pointer hover:text-[#ffd000]" onClick={() => onSort("it_no")}>
                  IT No.{sortIndicator("it_no")}
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e] cursor-pointer hover:text-[#ffd000]" onClick={() => onSort("inst_id")}>
                  INST ID{sortIndicator("inst_id")}
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e] cursor-pointer hover:text-[#ffd000]" onClick={() => onSort("tpo_code")}>
                  TPO code{sortIndicator("tpo_code")}
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">
                  <div className="inline-flex items-center gap-1">
                    <span>เคส</span>
                    <ColumnFilterPopover
                      title="เคส Scammer"
                      options={["Scammer", "(ว่าง)"]}
                      selected={colFilters.scammer_case}
                      onApply={(v) => onColFilterChange("scammer_case", v)}
                    />
                  </div>
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">
                  <div className="inline-flex items-center gap-1">
                    <span>วันที่รับแจ้ง</span>
                    <ColumnFilterPopover
                      title="วันที่รับแจ้ง"
                      options={distinctDates}
                      selected={colFilters.reported_date}
                      onApply={(v) => onColFilterChange("reported_date", v)}
                    />
                  </div>
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">
                  <div className="inline-flex items-center gap-1">
                    <span>ทีม</span>
                    <ColumnFilterPopover
                      title="ทีม"
                      options={distinctTeams}
                      selected={colFilters.team}
                      onApply={(v) => onColFilterChange("team", v)}
                    />
                  </div>
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e] cursor-pointer hover:text-[#ffd000]" onClick={() => onSort("account")}>
                  บัญชี{sortIndicator("account")}
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">
                  <div className="inline-flex items-center gap-1">
                    <span>ประเภท Meta</span>
                    <ColumnFilterPopover
                      title="ประเภทบัญชี Meta"
                      options={distinctMetaTypes}
                      selected={colFilters.meta_type}
                      onApply={(v) => onColFilterChange("meta_type", v)}
                    />
                  </div>
                </th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">IP / Port</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">เครือข่าย / ประเทศ</th>
                <th className="px-2 py-2.5 border-r border-[#1a346e] text-center text-rose-300">ขอไม่ได้</th>
                <th className="px-2 py-2.5 border-r border-[#1a346e] text-center text-[#ffd000]">ขอแล้ว</th>
                <th className="px-2 py-2.5 border-r border-[#1a346e] text-center text-sky-300">ตอบกลับ</th>
                <th className="px-2 py-2.5 border-r border-[#1a346e] text-center text-emerald-300">ได้รับ</th>
                <th className="px-2 py-2.5 border-r border-[#1a346e] text-center text-teal-300">ไม่ต้องขอ</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e] min-w-[140px]">เลขหนังสือ (แก้ได้)</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e] min-w-[180px]">ผลลัพธ์ / หมายเหตุ</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e] min-w-[160px]">ชื่อผู้จดทะเบียน / Entity</th>
                <th className="px-2.5 py-2.5 min-w-[130px]">เบอร์โทร</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#163066]">
              {records.map((row, idx) => {
                const d = getRowDraft(row);
                const isDirty = Boolean(drafts[row.record_key]);
                const isSelected = selectedKeys.includes(row.record_key);
                return (
                  <tr
                    key={row.record_key}
                    className={`${
                      isDirty
                        ? "bg-[#ffd000]/10"
                        : isSelected
                        ? "bg-[#1a3a82]/50"
                        : idx % 2 === 0
                        ? "bg-[#0a1d45]"
                        : "bg-[#081738]"
                    } hover:bg-[#122b63]/80 transition-colors`}
                  >
                    {isAdmin && (
                      <td className={`px-2 py-1.5 border-r border-[#163066] text-center ${isDirty ? "border-l-2 border-l-[#ffd000]" : ""}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(row.record_key)}
                          className="accent-[#ffd000]"
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5 border-r border-[#163066] text-center font-mono text-slate-400">{idx + 1}</td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-blue-100">{row.local_time || "—"}</td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066]">
                      <span className="px-2 py-0.5 rounded bg-[#133273] text-[#ffd000] font-medium">{row.platform}</span>
                    </td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-slate-200">{row.it_no || "—"}</td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-slate-200">{row.inst_id || "—"}</td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-slate-200">{row.tpo_code || "—"}</td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066]">
                      {row.scammer_case ? (
                        <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/40">{row.scammer_case}</span>
                      ) : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-slate-300">{row.reported_date || "—"}</td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] text-slate-300">{row.team || "—"}</td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] max-w-[200px] truncate text-white" title={row.account}>
                      {row.account}
                    </td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] text-blue-200">{row.meta_account_type || "—"}</td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-[#ffd000]">
                      {row.ip || "—"}{row.port ? `:${row.port}` : ""}
                    </td>
                    <td className="px-2.5 py-1.5 border-r border-[#163066] max-w-[190px] truncate text-slate-200" title={`${row.network} (${row.country})`}>
                      {row.network || "—"} <span className="text-slate-400">({row.country || "—"})</span>
                    </td>

                    {/* Inline Editable Cells */}
                    {(["unavailable", "requested", "replied", "received", "no_ip_request_needed"] as const).map((field) => (
                      <td key={field} className="px-2 py-1.5 border-r border-[#163066] text-center">
                        <input
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={d[field]}
                          onChange={(e) => updateCell(row, field, e.target.checked)}
                          className="accent-[#ffd000] w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                    ))}

                    <td className="px-1.5 py-1 border-r border-[#163066]">
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={d.letter_number}
                        onChange={(e) => updateCell(row, "letter_number", e.target.value)}
                        placeholder="ตช 0026..."
                        className="w-full bg-[#05112b] border border-transparent focus:border-[#ffd000] rounded px-2 py-1 text-white font-mono text-xs focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="px-1.5 py-1 border-r border-[#163066]">
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={d.result}
                        onChange={(e) => updateCell(row, "result", e.target.value)}
                        placeholder="หมายเหตุ..."
                        className="w-full bg-[#05112b] border border-transparent focus:border-[#ffd000] rounded px-2 py-1 text-white text-xs focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="px-1.5 py-1 border-r border-[#163066]">
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={d.entity_name}
                        onChange={(e) => updateCell(row, "entity_name", e.target.value)}
                        placeholder="ชื่อ-สกุล / บริษัท..."
                        className="w-full bg-[#05112b] border border-transparent focus:border-[#ffd000] rounded px-2 py-1 text-white text-xs focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={d.entity_phone}
                        onChange={(e) => updateCell(row, "entity_phone", e.target.value)}
                        placeholder="08x-xxx-xxxx"
                        className="w-full bg-[#05112b] border border-transparent focus:border-[#ffd000] rounded px-2 py-1 text-white font-mono text-xs focus:outline-none disabled:opacity-60"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
