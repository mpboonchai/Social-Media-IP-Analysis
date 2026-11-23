"use client";

import React, { useEffect, useRef, useState } from "react";
import { Filter, X } from "lucide-react";

interface ColumnFilterPopoverProps {
  title: string;
  options: string[];
  selected: string[];
  onApply: (next: string[]) => void;
}

export default function ColumnFilterPopover({
  title,
  options,
  selected,
  onApply,
}: ColumnFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(selected);
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

  const filteredOptions = options.filter((o) =>
    o.toLowerCase().includes(query.trim().toLowerCase())
  );

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
        title={`กรอง: ${title}`}
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
          className="fixed sm:absolute right-2 sm:right-auto sm:left-0 mt-1.5 w-64 rounded-xl bg-[#071638] border border-[#ffd000]/50 shadow-2xl z-50 p-3 text-xs text-slate-100 space-y-2.5"
        >
          <div className="flex items-center justify-between border-b border-[#1c397a] pb-1.5">
            <span className="font-semibold text-[#ffd000]">กรอง: {title}</span>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            type="search"
            placeholder="ค้นหาค่า..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg bg-[#040d24] border border-[#ffd000]/60 px-2.5 py-1.5 text-white placeholder-slate-400 focus:outline-none focus:border-[#ffd000]"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDraft(filteredOptions)}
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
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {filteredOptions.length === 0 ? (
              <p className="text-center text-slate-400 py-3">ไม่พบตัวเลือก</p>
            ) : (
              filteredOptions.map((opt) => (
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
                  <span className="truncate" title={opt}>{opt}</span>
                </label>
              ))
            )}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-[#1c397a]">
            <span className="text-[11px] text-slate-400">{filteredOptions.length} ค่า</span>
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
