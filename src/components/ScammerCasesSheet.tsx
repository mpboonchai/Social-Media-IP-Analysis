"use client";

import React, { useEffect, useState } from "react";
import { Download, Search, RefreshCw } from "lucide-react";
import { formatDateDMY, formatDateTimeDMY } from "@/lib/date-format";

interface ScammerCaseItem {
  id: number;
  inst_id: string;
  data_id: string;
  tracking_code: string;
  heppen_date: string | null;
  team: string;
  platform: string;
  platform_url: string;
  account_name: string;
  tracking_status: string;
  replied_at: string;
  tpo_code: string;
  note: string | null;
  response_account: string;
}

export default function ScammerCasesSheet() {
  const [cases, setCases] = useState<ScammerCaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [team, setTeam] = useState("");

  async function loadCases() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(platform ? { platform } : {}),
        ...(team ? { team } : {}),
      });
      const res = await fetch(`/api/cases?${qs.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const body = await res.json();
        setCases(body.cases || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(loadCases, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, platform, team]);

  const distinctTeams = Array.from(new Set(cases.map((c) => c.team).filter(Boolean))).sort();

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-3.5 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div>
          <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">
            SCAMMER CASES SHEET (URL_CASES_SCAMMER.XLSX)
          </p>
          <h2 className="text-sm font-bold text-white">
            ชีทเคส Scammers ({cases.length.toLocaleString("th-TH")} เคส — โครงสร้างตรงกับไฟล์ url_cases_(Scammer).xlsx 100%)
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadCases}
            className="px-3 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-blue-100 flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> รีเฟรช
          </button>
          <button
            type="button"
            onClick={() => window.open("/api/export/excel?sheet=scammers", "_blank")}
            className="px-3 py-1.5 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> ส่งออกชีทเคส Scammers (.xlsx)
          </button>
        </div>
      </div>

      {/* Filter Row */}
      <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-3 grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
        <div className="sm:col-span-2 relative">
          <Search className="w-4 h-4 text-blue-300 absolute left-3 top-2" />
          <input
            type="search"
            placeholder="ค้นหา inst_id, data_id, tracking_code, TPO, ชื่อบัญชี, URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#05112b] border border-[#1d3a78] text-white"
          />
        </div>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2 text-white"
        >
          <option value="">ทุกแพลตฟอร์ม</option>
          <option value="Facebook">Facebook</option>
          <option value="Instagram">Instagram</option>
          <option value="TikTok">TikTok</option>
        </select>
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2 text-white"
        >
          <option value="">ทุกทีม</option>
          {distinctTeams.map((tm) => (
            <option key={tm} value={tm}>{tm}</option>
          ))}
        </select>
      </div>

      {/* Excel-style Scammer Table */}
      <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] overflow-hidden">
        <div className="overflow-x-auto max-h-[68vh]">
          <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
            <thead className="bg-[#05112b] text-[#ffd000] sticky top-0 z-10 border-b border-[#ffd000]/40">
              <tr>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">#</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">inst_id</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">data_id</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">tracking_code</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">heppen_date</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">team</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">platform</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">account_name</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">platform_url</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">tracking_status</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">replied_at</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">เลขหนังสือ / TPO</th>
                <th className="px-2.5 py-2.5 border-r border-[#1a346e]">note</th>
                <th className="px-2.5 py-2.5">response_account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#163066]">
              {cases.map((c, idx) => (
                <tr key={c.id} className={`${idx % 2 === 0 ? "bg-[#0a1d45]" : "bg-[#081738]"} hover:bg-[#122b63]/80`}>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-slate-400">{idx + 1}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-white">{c.inst_id || "—"}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-slate-300">{c.data_id || "—"}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-slate-300">{c.tracking_code || "—"}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-[#ffd000]">{formatDateDMY(c.heppen_date)}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] text-blue-200">{c.team || "—"}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066]">
                    <span className="px-2 py-0.5 rounded bg-[#133273] text-[#ffd000] font-semibold">{c.platform}</span>
                  </td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] max-w-[220px] truncate text-white" title={c.account_name}>
                    {c.account_name || "—"}
                  </td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] max-w-[260px] truncate text-sky-300" title={c.platform_url}>
                    {c.platform_url ? (
                      <a href={c.platform_url} target="_blank" rel="noreferrer" className="hover:underline">
                        {c.platform_url}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] text-blue-100">{c.tracking_status || "—"}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-slate-300">{formatDateTimeDMY(c.replied_at)}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] font-mono text-emerald-300">{c.tpo_code || "—"}</td>
                  <td className="px-2.5 py-1.5 border-r border-[#163066] max-w-[220px] truncate text-slate-200" title={c.note || ""}>
                    {c.note || "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-blue-200">{c.response_account || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
