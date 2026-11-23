"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

interface BarItem {
  label: string;
  value: number;
}

interface AnalyticsPayload {
  summary: {
    total_events: number;
    th_events: number;
    foreign_events: number;
    th_events_pct: number;
    foreign_events_pct: number;
    unique_case_ids: number;
    th_cases: number;
    foreign_cases: number;
    country_cases_sum: number;
    th_cases_pct: number;
    foreign_cases_pct: number;
  };
  country_by_events: BarItem[];
  country_by_cases: BarItem[];
  isp_by_events: BarItem[];
  isp_by_cases: BarItem[];
}

const fmt = (n: number | undefined) => Number(n || 0).toLocaleString("th-TH");

const BAR_COLORS = [
  "#3b82f6",
  "#a78bfa",
  "#fbbf24",
  "#fde047",
  "#f87171",
  "#34d399",
  "#60a5fa",
  "#c084fc",
  "#38bdf8",
  "#2dd4bf",
];

function VerticalBarChart({
  items,
  unit,
}: {
  items: BarItem[];
  unit: string;
}) {
  const maxVal = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="min-w-[520px] flex items-end gap-2 sm:gap-3 h-56 pt-7 px-2 border-b border-[#1d3a78]">
        {items.length === 0 ? (
          <div className="w-full text-center text-blue-300 text-xs self-center">ไม่มีข้อมูล</div>
        ) : (
          items.map((item, idx) => {
            const pct = Math.max(4, (item.value / maxVal) * 100);
            return (
              <div key={item.label} className="flex-1 flex flex-col items-center h-full justify-end min-w-0">
                <span className="text-[11px] font-mono font-bold text-[#ffd000] mb-1">
                  {fmt(item.value)}
                </span>
                <div
                  className="w-full max-w-[46px] rounded-t-md transition-all shadow"
                  style={{
                    height: `${pct}%`,
                    backgroundColor: BAR_COLORS[idx % BAR_COLORS.length],
                  }}
                  title={`${item.label}: ${fmt(item.value)} ${unit}`}
                />
              </div>
            );
          })
        )}
      </div>
      <div className="min-w-[520px] flex gap-2 sm:gap-3 px-2 pt-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex-1 text-center text-[10px] text-blue-100 leading-tight break-words line-clamp-2"
            title={item.label}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThForeignDonut({
  total,
  subtitle,
  thVal,
  thPct,
  foreignVal,
  foreignPct,
  unit,
}: {
  total: number;
  subtitle: string;
  thVal: number;
  thPct: number;
  foreignVal: number;
  foreignPct: number;
  unit: string;
}) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const thDash = (Math.min(100, Math.max(0, thPct)) / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center gap-3 shrink-0 w-full sm:w-52">
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 112 112" className="w-full h-full -rotate-90">
          {/* Foreign (Gold/Amber) */}
          <circle cx="56" cy="56" r={radius} fill="none" stroke="#fbbf24" strokeWidth="16" />
          {/* Thailand (Deep CIB Navy Blue) */}
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke="#1d4ed8"
            strokeWidth="16"
            strokeDasharray={`${thDash} ${circumference - thDash}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
          <span className="text-lg font-extrabold text-white leading-tight">{fmt(total)}</span>
          <span className="text-[10px] text-blue-200">{subtitle}</span>
        </div>
      </div>
      <div className="space-y-1 text-[11px] w-full bg-[#05112b] border border-[#1d3a78] rounded-lg p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-blue-100">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1d4ed8] inline-block" /> Thailand
          </span>
          <span className="font-mono font-semibold text-white">
            {thPct}% ({fmt(thVal)} {unit})
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-blue-100">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#fbbf24] inline-block" /> Foreign
          </span>
          <span className="font-mono font-semibold text-[#ffd000]">
            {foreignPct}% ({fmt(foreignVal)} {unit})
          </span>
        </div>
      </div>
    </div>
  );
}

export default function CountryIspStatsView({ filterQuery }: { filterQuery: string }) {
  const [stats, setStats] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadStats() {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?${filterQuery}`, { cache: "no-store" });
      if (res.ok) {
        setStats(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQuery]);

  const s = stats?.summary;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">
            COUNTRY & ISP INTELLIGENCE (TOP 10)
          </p>
          <h2 className="text-sm sm:text-base font-bold text-white">
            สถิติประเทศและเครือข่าย ISP 10 อันดับแรก — แยกตามจำนวน IP Event และ Case ID
          </h2>
          <p className="text-[11px] text-blue-200/80">
            * ระบบแยกรหัส Case ID ที่คั่นด้วย / (เช่น L69081110077 / L69081110063 นับเป็น 2 เคส) · รวมชื่อเครือข่ายเดียวกัน (เช่น ReadyIDC) และแยก AIS Mobile vs AIS Fibre ออกจากกันชัดเจน
          </p>
        </div>
        <button
          type="button"
          onClick={loadStats}
          className="px-3 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-xs text-[#ffd000] flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> คำนวณใหม่
        </button>
      </div>

      {loading && !stats ? (
        <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-12 text-center text-sm text-[#ffd000]">
          กำลังประมวลผลสถิติ 10 อันดับประเทศและ ISP จากฐานข้อมูล TiDB Cloud...
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Panel 1: Country by IP Event */}
          <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] overflow-hidden">
            <div className="bg-gradient-to-r from-[#0e2a66] to-[#173d8f] px-4 py-2.5 flex items-center justify-between border-b border-[#ffd000]/40">
              <span className="font-bold text-white text-sm">ประเทศ 10 อันดับแรก — IP EVENT</span>
              <span className="px-2.5 py-0.5 rounded bg-[#05112b] text-[#ffd000] font-bold text-xs">
                IP EVENT
              </span>
            </div>
            <div className="p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="flex-1 w-full min-w-0">
                <VerticalBarChart items={stats?.country_by_events || []} unit="events" />
              </div>
              <ThForeignDonut
                total={s?.total_events || 0}
                subtitle="IP event"
                thVal={s?.th_events || 0}
                thPct={s?.th_events_pct || 0}
                foreignVal={s?.foreign_events || 0}
                foreignPct={s?.foreign_events_pct || 0}
                unit="events"
              />
            </div>
          </div>

          {/* Panel 2: Country by Case ID */}
          <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] overflow-hidden">
            <div className="bg-gradient-to-r from-[#0e2a66] to-[#173d8f] px-4 py-2.5 flex items-center justify-between border-b border-[#ffd000]/40">
              <span className="font-bold text-white text-sm">ประเทศ 10 อันดับแรก — CASE ID</span>
              <span className="px-2.5 py-0.5 rounded bg-[#ffd000] text-[#05112b] font-bold text-xs">
                CASE ID ({fmt(s?.unique_case_ids)} เคสไม่ซ้ำ)
              </span>
            </div>
            <div className="p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="flex-1 w-full min-w-0">
                <VerticalBarChart items={stats?.country_by_cases || []} unit="เคส" />
              </div>
              <ThForeignDonut
                total={s?.country_cases_sum || 0}
                subtitle="เคส (นับตามประเทศ)"
                thVal={s?.th_cases || 0}
                thPct={s?.th_cases_pct || 0}
                foreignVal={s?.foreign_cases || 0}
                foreignPct={s?.foreign_cases_pct || 0}
                unit="เคส"
              />
            </div>
          </div>

          {/* Panel 3: Top 10 Normalized ISP by IP Event */}
          <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] overflow-hidden">
            <div className="bg-gradient-to-r from-[#0e2a66] to-[#173d8f] px-4 py-2.5 flex items-center justify-between border-b border-[#ffd000]/40">
              <span className="font-bold text-white text-sm">ผู้ให้บริการเครือข่าย (ISP) 10 อันดับแรก — IP EVENT</span>
              <span className="px-2.5 py-0.5 rounded bg-[#05112b] text-[#ffd000] font-bold text-xs">
                IP EVENT
              </span>
            </div>
            <div className="p-4">
              <VerticalBarChart items={stats?.isp_by_events || []} unit="events" />
            </div>
          </div>

          {/* Panel 4: Top 10 Normalized ISP by Case ID */}
          <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] overflow-hidden">
            <div className="bg-gradient-to-r from-[#0e2a66] to-[#173d8f] px-4 py-2.5 flex items-center justify-between border-b border-[#ffd000]/40">
              <span className="font-bold text-white text-sm">ผู้ให้บริการเครือข่าย (ISP) 10 อันดับแรก — CASE ID</span>
              <span className="px-2.5 py-0.5 rounded bg-[#ffd000] text-[#05112b] font-bold text-xs">
                CASE ID
              </span>
            </div>
            <div className="p-4">
              <VerticalBarChart items={stats?.isp_by_cases || []} unit="เคส" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
