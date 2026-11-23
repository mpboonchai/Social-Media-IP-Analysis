"use client";

import React, { useEffect, useRef, useState } from "react";
import { Filter, Loader2, X } from "lucide-react";
import { formatDateDMY } from "@/lib/date-format";

interface ColumnFilterPopoverProps {
  title: string;
  columnKey?: string;
  options: string[];
  selected: string[];
  onApply: (next: string[]) => void;
}

export default function ColumnFilterPopover({
  title,
  columnKey,
  options,
  selected,
  onApply,
}: ColumnFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(selected);
  const [remoteOptions, setRemoteOptions] = useState<string[] | null>(null);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(selected);
  }, [selected, open]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // Query entire TiDB Cloud database when opened or searching inside popover
  useEffect(() => {
    if (!open || !columnKey) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingOpts(true);
      try {
        // Allow user to type dd/mm/yyyy in date column search and convert to YYYY-MM-DD for DB lookup
        let qParam = query.trim();
        const dmyMatch = qParam.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dmyMatch && (columnKey === "local_date" || columnKey === "reported_date")) {
          qParam = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        }
        const qs = new URLSearchParams({
          column: columnKey,
          ...(qParam ? { q: qParam } : {}),
        });
        const res = await fetch(`/api/events/column-values?${qs.toString()}`, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const body = await res.json();
          setRemoteOptions(Array.isArray(body.values) ? body.values : []);
        }
      } finally {
        if (!cancelled) setLoadingOpts(false);
      }
    }, query ? 250 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, columnKey, query]);

  const activeList = columnKey && remoteOptions !== null ? remoteOptions : options;
  const filteredOptions = columnKey
    ? activeList
    : activeList.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));

  // Always keep currently selected values visible at top if not in the returned page
  const displayOptions = Array.from(new Set([...selected.filter((s) => !filteredOptions.includes(s)), ...filteredOptions]));

  const isDateCol = columnKey === "local_date" || columnKey === "reported_date";

  function toggle(val: string) {
    setDraft((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  }

  const isActive = selected.length > 0;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={`กรองจากฐานข้อมูลทั้งหมด: ${title}`}
        className={`p-1 rounded transition ${
          isActive
            ? "bg-[#ffd000] text-[#05112b] font-bold"
            : "text-blue-300/70 hover:text-[#ffd000] hover:bg-[#10285e]"
        }`}
      >
        <Filter className="w-3 h-3" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed sm:absolute right-2 sm:right-auto sm:left-0 mt-1.5 w-68 sm:w-72 rounded-xl bg-[#071638] border border-[#ffd000]/60 shadow-2xl z-50 p-3 text-xs text-slate-100 space-y-2.5"
        >
          <div className="flex items-center justify-between border-b border-[#1c397a] pb-1.5">
            <div>
              <span className="font-semibold text-[#ffd000]">กรอง: {title}</span>
              {columnKey && (
                <span className="ml-1.5 text-[10px] text-emerald-300">(ทั้งฐานข้อมูล)</span>
              )}
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            type="search"
            placeholder={isDateCol ? "ค้นหา (เช่น 20/11/2026 หรือ 2026-11)..." : "ค้นหาค่าในฐานข้อมูลทั้งหมด..."}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg bg-[#040d24] border border-[#ffd000]/60 px-2.5 py-1.5 text-white placeholder-slate-400 focus:outline-none focus:border-[#ffd000]"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDraft(displayOptions)}
              className="flex-1 py-1 rounded bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-[11px] text-blue-100"
            >
              เลือกทั้งหมดที่แสดง
            </button>
            <button
              type="button"
              onClick={() => setDraft([])}
              className="flex-1 py-1 rounded bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-[11px] text-blue-100"
            >
              ล้างทั้งหมด
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
            {loadingOpts ? (
              <div className="flex items-center justify-center gap-1.5 py-4 text-[#ffd000]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังค้นหาจากฐานข้อมูลทั้งหมด...
              </div>
            ) : displayOptions.length === 0 ? (
              <p className="text-center text-slate-400 py-3">ไม่พบตัวเลือก</p>
            ) : (
              displayOptions.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[#0f2454] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={draft.includes(opt)}
                    onChange={() => toggle(opt)}
                    className="accent-[#ffd000]"
                  />
                  <span className="truncate" title={opt}>
                    {isDateCol && opt !== "(ว่าง)" ? formatDateDMY(opt) : opt}
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-[#1c397a]">
            <span className="text-[11px] text-slate-400">{displayOptions.length} ค่า (จาก DB)</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2.5 py-1 rounded-lg bg-[#0f2454] hover:bg-[#163475] text-slate-200"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  onApply(draft);
                  setOpen(false);
                }}
                className="px-3 py-1 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold"
              >
                ใช้ตัวกรอง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
