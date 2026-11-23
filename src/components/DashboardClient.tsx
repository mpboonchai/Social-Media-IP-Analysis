"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Shield, Upload, FileSpreadsheet, LogOut, RefreshCw, Search, Edit3, X, Download, Presentation, ArrowLeftRight, Users, CheckCircle2 } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

interface IpEventRow {
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
}

interface DashboardResponse {
  kpi: {
    total_events: number;
    unique_accounts: number;
    unique_ips: number;
    requested_count: number;
    unavailable_count: number;
    replied_count: number;
    received_count: number;
    scammer_events: number;
  };
  top_networks: Array<{ label: string; value: number }>;
  top_countries: Array<{ label: string; value: number }>;
  records: IpEventRow[];
  pagination: { limit: number; offset: number; total: number };
}

const fmt = (n: number | string | undefined) => Number(n || 0).toLocaleString("th-TH");

function statusBadge(row: IpEventRow): { label: string; cls: string } {
  if (row.no_ip_data) return { label: "ไม่มีข้อมูล IP", cls: "bg-slate-700 text-slate-200" };
  if (row.unavailable) return { label: "ขอข้อมูลไม่ได้", cls: "bg-rose-900/70 text-rose-200 border border-rose-500/40" };
  if (row.received) return { label: "ได้รับข้อมูลแล้ว", cls: "bg-emerald-900/70 text-emerald-200 border border-emerald-500/40" };
  if (row.no_ip_request_needed) return { label: "ไม่ต้องขอ IP", cls: "bg-teal-900/70 text-teal-200" };
  if (row.replied) return { label: "ตอบกลับแล้ว", cls: "bg-sky-900/70 text-sky-200" };
  if (row.requested) return { label: "ขอข้อมูลแล้ว", cls: "bg-amber-900/70 text-amber-200" };
  return { label: "ยังไม่ดำเนินการ", cls: "bg-slate-800 text-slate-400" };
}

export default function DashboardClient({ initialUser }: { initialUser: SessionUser | null }) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  // Filters
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [eventType, setEventType] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [scammerOnly, setScammerOnly] = useState(false);
  const [caseWindowOnly, setCaseWindowOnly] = useState(false);

  // Modals
  const [editing, setEditing] = useState<IpEventRow | null>(null);
  const [editForm, setEditForm] = useState({
    unavailable: false,
    requested: false,
    replied: false,
    received: false,
    letter_number: "",
    result: "",
  });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [casesOpen, setCasesOpen] = useState(false);
  const [casesMsg, setCasesMsg] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportName, setReportName] = useState("Social Media IP Intelligence Report");
  const [reportMsg, setReportMsg] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportHistory, setReportHistory] = useState<Array<{ id: string; report_name: string; generated_by: string; generated_at: string }>>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [usersOpen, setUsersOpen] = useState(false);
  const [usersList, setUsersList] = useState<Array<{ id: number; username: string; display_name: string; role: string; approved: number; active: number; last_login_at: string | null }>>([]);
  const [userMsg, setUserMsg] = useState("");
  const [newUserForm, setNewUserForm] = useState({ username: "", display_name: "", password: "", role: "viewer", approved: true });
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completePlatform, setCompletePlatform] = useState("TikTok");
  const [completeAccounts, setCompleteAccounts] = useState<Array<{ id: number; account_name: string; is_completed: number }>>([]);
  const [completeAccountId, setCompleteAccountId] = useState("");
  const [completeReason, setCompleteReason] = useState("ได้รับข้อมูลบัญชีครบถ้วนแล้ว ไม่ต้องขอข้อมูล IP เพิ่ม");
  const [completeMsg, setCompleteMsg] = useState("");

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        ...(search ? { search } : {}),
        ...(platform ? { platform } : {}),
        ...(eventType ? { event_type: eventType } : {}),
        ...(requestStatus ? { request_status: requestStatus } : {}),
        ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(dateTo ? { date_to: dateTo } : {}),
        ...(scammerOnly ? { scammer_only: "true" } : {}),
        ...(caseWindowOnly ? { case_window_only: "true" } : {}),
      });
      const res = await fetch(`/api/events?${qs.toString()}`, { cache: "no-store" });
      if (res.status === 401) {
        setUser(null);
        return;
      }
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [user, offset, search, platform, eventType, requestStatus, dateFrom, dateTo, scammerOnly, caseWindowOnly]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setLoginError(
          body.error === "account_locked"
            ? "บัญชีถูกล็อกชั่วคราว 15 นาที"
            : "Username หรือ Password ไม่ถูกต้อง"
        );
        return;
      }
      setUser(body.user);
      setPassword("");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setData(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const res = await fetch(`/api/events/${editing.record_key}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(editForm),
    });
    if (res.ok) {
      setEditing(null);
      fetchEvents();
    }
  }

  async function handleZipUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const input = formEl.elements.namedItem("files") as HTMLInputElement;
    if (!input?.files?.length) return;
    setUploadMsg("กำลังอัปโหลดและแกะไฟล์ ZIP...");
    const fd = new FormData();
    for (const f of Array.from(input.files)) fd.append("files", f);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = await res.json();
    if (res.ok) {
      setUploadMsg(
        `นำเข้าสำเร็จ: ${body.results.map((r: any) => `${r.filename} (${r.status}: ${r.records})`).join(", ")}`
      );
      fetchEvents();
    } else {
      setUploadMsg(`ผิดพลาด: ${body.error}`);
    }
  }

  async function handleCasesUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const input = formEl.elements.namedItem("file") as HTMLInputElement;
    if (!input?.files?.length) return;
    setCasesMsg("กำลังนำเข้าไฟล์ Excel ฐานคดี...");
    const fd = new FormData();
    fd.append("file", input.files[0]);
    const res = await fetch("/api/cases/import", { method: "POST", body: fd });
    const body = await res.json();
    setCasesMsg(res.ok ? `นำเข้าฐานคดีสำเร็จ ${fmt(body.imported)} คดี` : `ผิดพลาด: ${body.error}`);
  }

  function handleExportCsv() {
    const qs = new URLSearchParams({
      ...(search ? { search } : {}),
      ...(platform ? { platform } : {}),
      ...(eventType ? { event_type: eventType } : {}),
      ...(requestStatus ? { request_status: requestStatus } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
      ...(scammerOnly ? { scammer_only: "true" } : {}),
      ...(caseWindowOnly ? { case_window_only: "true" } : {}),
    });
    window.location.href = `/api/export/csv?${qs.toString()}`;
  }

  async function loadReportHistory() {
    const res = await fetch("/api/reports", { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setReportHistory(body.reports || []);
    }
  }

  async function openReportModal() {
    setReportMsg("");
    setActiveReportId(null);
    setReportOpen(true);
    await loadReportHistory();
  }

  async function handleGenerateReport(e: React.FormEvent) {
    e.preventDefault();
    setReportBusy(true);
    setReportMsg("กำลังประมวลผลสถิติจากฐานข้อมูล MySQL...");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          report_name: reportName,
          platform,
          date_from: dateFrom,
          date_to: dateTo,
          scammer_only: scammerOnly,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setReportMsg(`สร้างรายงานไม่สำเร็จ: ${body.error}`);
        return;
      }
      setActiveReportId(body.report.id);
      setReportMsg(`สร้างรายงานสำเร็จ (17 สไลด์ · ${fmt(body.report.summary?.events)} เหตุการณ์)`);
      await loadReportHistory();
    } finally {
      setReportBusy(false);
    }
  }

  async function handleRequestSync() {
    setSyncMsg("กำลังส่งคำขอซิงค์สามทาง...");
    const res = await fetch("/api/sync", { method: "POST" });
    const body = await res.json();
    setSyncMsg(res.ok ? body.job?.message || "ส่งคำขอซิงค์แล้ว" : `ผิดพลาด: ${body.error}`);
    setTimeout(() => setSyncMsg(""), 6000);
  }

  async function loadUsers() {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setUsersList(body.users || []);
    }
  }

  async function openUsersModal() {
    setUserMsg("");
    setUsersOpen(true);
    await loadUsers();
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setUserMsg("กำลังเพิ่มผู้ใช้งาน...");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newUserForm),
    });
    const body = await res.json();
    if (!res.ok) {
      setUserMsg(body.error === "username_exists" ? "Username นี้มีอยู่แล้ว" : `ผิดพลาด: ${body.error}`);
      return;
    }
    setNewUserForm({ username: "", display_name: "", password: "", role: "viewer", approved: true });
    setUserMsg(`เพิ่มผู้ใช้ ${body.username} เรียบร้อยแล้ว`);
    await loadUsers();
  }

  async function handleUpdateUser(targetUsername: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(targetUsername)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok) {
      setUserMsg(`อัปเดตไม่สำเร็จ: ${body.error}`);
      return;
    }
    setUserMsg(`อัปเดตผู้ใช้ ${targetUsername} แล้ว`);
    await loadUsers();
  }

  async function loadAccountsForCompletion(plat: string) {
    const res = await fetch(`/api/admin/accounts/complete?platform=${encodeURIComponent(plat)}`, { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setCompleteAccounts(body.accounts || []);
      setCompleteAccountId("");
    }
  }

  async function openCompleteModal() {
    const initPlat = ["TikTok", "Facebook", "Instagram"].includes(platform) ? platform : "TikTok";
    setCompletePlatform(initPlat);
    setCompleteMsg("");
    setCompleteOpen(true);
    await loadAccountsForCompletion(initPlat);
  }

  async function handleCompleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!completeAccountId) return;
    setCompleteMsg("กำลังปิดงานบัญชี...");
    const res = await fetch("/api/admin/accounts/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: completePlatform,
        account_id: Number(completeAccountId),
        reason: completeReason,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setCompleteMsg(`ผิดพลาด: ${body.error}`);
      return;
    }
    setCompleteMsg(`ปิดงานบัญชี ${body.account} สำเร็จ (อัปเดต ${fmt(body.updated_records)} รายการ)`);
    fetchEvents();
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#081521]">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md rounded-2xl bg-[#0c1f2e] border border-[#1e3b4f] p-8 shadow-2xl space-y-5"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#35d0ba]/15 border border-[#35d0ba]/40 flex items-center justify-center text-[#35d0ba]">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs tracking-widest text-[#35d0ba] font-semibold">V2 · MYSQL 8.0</p>
              <h1 className="text-xl font-bold text-white">Social Media IP Analysis</h1>
            </div>
          </div>
          <div className="space-y-3">
            <label className="block text-sm text-slate-300">
              <span>Username</span>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2 text-white focus:outline-none focus:border-[#35d0ba]"
              />
            </label>
            <label className="block text-sm text-slate-300">
              <span>Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2 text-white focus:outline-none focus:border-[#35d0ba]"
              />
            </label>
          </div>
          {loginError && <p className="text-sm text-rose-400">{loginError}</p>}
          <button
            type="submit"
            disabled={loggingIn}
            className="w-full py-2.5 rounded-lg bg-[#35d0ba] text-[#081521] font-semibold hover:bg-[#2bb8a4] disabled:opacity-50"
          >
            {loggingIn ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    );
  }

  const kpi = data?.kpi;
  const maxNet = Math.max(1, ...(data?.top_networks || []).map((n) => Number(n.value)));
  const totalPages = Math.max(1, Math.ceil((data?.pagination.total || 0) / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="min-h-screen bg-[#081521] text-slate-100">
      <header className="border-b border-[#1e3b4f] bg-[#0c1f2e]/90 backdrop-blur sticky top-0 z-20 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#35d0ba]/15 border border-[#35d0ba]/40 flex items-center justify-center text-[#35d0ba] font-bold">
            IP
          </div>
          <div>
            <p className="text-[11px] tracking-widest text-[#35d0ba] font-semibold">SOCIAL MEDIA IP ANALYSIS V2</p>
            <h1 className="text-base font-bold text-white">Full MySQL Analytics ({fmt(kpi?.total_events)} รายการ)</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="px-3 py-1 rounded-full bg-[#081521] border border-[#1e3b4f] text-slate-300">
            {user.display_name} · {user.role === "master_admin" ? "Master Admin" : "Viewer"}
          </span>
          <button
            onClick={fetchEvents}
            className="px-3 py-1.5 rounded-lg bg-[#122b3e] hover:bg-[#193b54] border border-[#244c68] flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> รีเฟรช
          </button>
          <button
            onClick={handleExportCsv}
            className="px-3 py-1.5 rounded-lg bg-[#122b3e] hover:bg-[#193b54] border border-[#244c68] text-slate-200 flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" /> ส่งออก CSV (3 ชุด)
          </button>
          <button
            onClick={openReportModal}
            className="px-3 py-1.5 rounded-lg bg-indigo-950/70 hover:bg-indigo-900/70 border border-indigo-400/40 text-indigo-200 flex items-center gap-1.5"
          >
            <Presentation className="w-4 h-4" /> รายงาน 17 สไลด์
          </button>
          {user.role === "master_admin" && (
            <>
              <button
                onClick={openUsersModal}
                className="px-3 py-1.5 rounded-lg bg-[#122b3e] hover:bg-[#193b54] border border-[#244c68] text-slate-200 flex items-center gap-1.5"
              >
                <Users className="w-4 h-4" /> จัดการผู้ใช้
              </button>
              <button
                onClick={openCompleteModal}
                className="px-3 py-1.5 rounded-lg bg-teal-950/60 hover:bg-teal-900/60 border border-teal-400/40 text-teal-200 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" /> ปิดงานบัญชี
              </button>
              <button
                onClick={handleRequestSync}
                className="px-3 py-1.5 rounded-lg bg-amber-950/50 hover:bg-amber-900/50 border border-amber-400/40 text-amber-200 flex items-center gap-1.5"
              >
                <ArrowLeftRight className="w-4 h-4" /> ซิงค์สามทาง
              </button>
              <button
                onClick={() => { setUploadMsg(""); setUploadOpen(true); }}
                className="px-3 py-1.5 rounded-lg bg-[#35d0ba]/15 hover:bg-[#35d0ba]/25 border border-[#35d0ba]/40 text-[#35d0ba] flex items-center gap-1.5"
              >
                <Upload className="w-4 h-4" /> อัปโหลด ZIP
              </button>
              <button
                onClick={() => { setCasesMsg(""); setCasesOpen(true); }}
                className="px-3 py-1.5 rounded-lg bg-[#4aa8ff]/15 hover:bg-[#4aa8ff]/25 border border-[#4aa8ff]/40 text-[#4aa8ff] flex items-center gap-1.5"
              >
                <FileSpreadsheet className="w-4 h-4" /> นำเข้า Scammer Excel
              </button>
            </>
          )}
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300 flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" /> ออก
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 space-y-6">
        {/* Filter Bar */}
        <section className="rounded-xl bg-[#0c1f2e] border border-[#1e3b4f] p-4 grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
          <div className="md:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="search"
              placeholder="ค้นหา บัญชี, IP, TPO code, INST ID, ISP, เลขหนังสือ..."
              value={search}
              onChange={(e) => { setOffset(0); setSearch(e.target.value); }}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#081521] border border-[#1e3b4f] text-white"
            />
          </div>
          <select
            value={platform}
            onChange={(e) => { setOffset(0); setPlatform(e.target.value); }}
            className="rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2"
          >
            <option value="">ทุกแพลตฟอร์ม</option>
            <option value="TikTok">TikTok</option>
            <option value="Facebook">Facebook</option>
            <option value="Instagram">Instagram</option>
            <option value="META">META รวม</option>
          </select>
          <select
            value={eventType}
            onChange={(e) => { setOffset(0); setEventType(e.target.value); }}
            className="rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2"
          >
            <option value="">ทุกประเภทเหตุการณ์</option>
            <option value="IP Address">IP Address</option>
            <option value="IP Session">IP Session</option>
            <option value="Login">Login</option>
            <option value="Logout">Logout</option>
            <option value="Signup">Signup</option>
          </select>
          <select
            value={requestStatus}
            onChange={(e) => { setOffset(0); setRequestStatus(e.target.value); }}
            className="rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2"
          >
            <option value="">ทุกสถานะหนังสือ</option>
            <option value="pending">ยังไม่ดำเนินการ</option>
            <option value="requested">ขอข้อมูลแล้ว</option>
            <option value="replied">ตอบกลับแล้ว</option>
            <option value="received">ได้รับข้อมูลแล้ว</option>
            <option value="unavailable">ขอข้อมูลไม่ได้</option>
            <option value="no_ip_data">ไม่มีข้อมูล IP</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setOffset(0); setDateFrom(e.target.value); }}
            className="rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setOffset(0); setDateTo(e.target.value); }}
            className="rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2"
          />
          <div className="md:col-span-4 lg:col-span-7 flex flex-wrap items-center gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scammerOnly}
                onChange={(e) => { setOffset(0); setScammerOnly(e.target.checked); }}
              />
              <span>เฉพาะเคส Scammer</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={caseWindowOnly}
                onChange={(e) => { setOffset(0); setCaseWindowOnly(e.target.checked); }}
              />
              <span>เฉพาะช่วงวันก่อเหตุ 7 วัน (±3 วัน)</span>
            </label>
            <button
              onClick={() => {
                setOffset(0); setSearch(""); setPlatform(""); setEventType("");
                setRequestStatus(""); setDateFrom(""); setDateTo("");
                setScammerOnly(false); setCaseWindowOnly(false);
              }}
              className="ml-auto text-xs text-slate-400 hover:text-white underline"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          </div>
        </section>

        {/* KPI Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="rounded-xl bg-[#0c1f2e] border border-[#35d0ba]/40 p-4">
            <p className="text-xs text-slate-400">เหตุการณ์ที่ตรงเงื่อนไข</p>
            <p className="text-2xl font-bold text-[#35d0ba] mt-1">{fmt(kpi?.total_events)}</p>
            <p className="text-xs text-slate-500 mt-1">Scammer: {fmt(kpi?.scammer_events)}</p>
          </div>
          <div className="rounded-xl bg-[#0c1f2e] border border-[#1e3b4f] p-4">
            <p className="text-xs text-slate-400">บัญชีที่เกี่ยวข้อง</p>
            <p className="text-2xl font-bold text-white mt-1">{fmt(kpi?.unique_accounts)}</p>
            <p className="text-xs text-slate-500 mt-1">บัญชีไม่ซ้ำ</p>
          </div>
          <div className="rounded-xl bg-[#0c1f2e] border border-[#1e3b4f] p-4">
            <p className="text-xs text-slate-400">IP ไม่ซ้ำทั้งหมด</p>
            <p className="text-2xl font-bold text-[#4aa8ff] mt-1">{fmt(kpi?.unique_ips)}</p>
            <p className="text-xs text-slate-500 mt-1">IPv4 & IPv6</p>
          </div>
          <div className="rounded-xl bg-[#0c1f2e] border border-[#1e3b4f] p-4">
            <p className="text-xs text-slate-400">ขอข้อมูลแล้ว</p>
            <p className="text-2xl font-bold text-amber-300 mt-1">{fmt(kpi?.requested_count)}</p>
            <p className="text-xs text-slate-500 mt-1">ได้รับแล้ว: {fmt(kpi?.received_count)}</p>
          </div>
          <div className="rounded-xl bg-[#0c1f2e] border border-rose-500/30 p-4">
            <p className="text-xs text-slate-400">ขอข้อมูลไม่ได้</p>
            <p className="text-2xl font-bold text-rose-400 mt-1">{fmt(kpi?.unavailable_count)}</p>
            <p className="text-xs text-slate-500 mt-1">ตอบกลับแล้ว: {fmt(kpi?.replied_count)}</p>
          </div>
        </section>

        {/* Charts */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl bg-[#0c1f2e] border border-[#1e3b4f] p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">เครือข่ายที่พบมากที่สุด (Top 6 Networks)</h2>
            <div className="space-y-2">
              {(data?.top_networks || []).map((n) => (
                <div key={n.label} className="flex items-center gap-3 text-xs">
                  <span className="w-40 truncate text-slate-300" title={n.label}>{n.label}</span>
                  <div className="flex-1 h-2.5 bg-[#081521] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#35d0ba] rounded-full"
                      style={{ width: `${Math.max(2, (Number(n.value) / maxNet) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono text-slate-200">{fmt(n.value)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-[#0c1f2e] border border-[#1e3b4f] p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">ประเทศที่จดทะเบียนเครือข่าย (RDAP)</h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(data?.top_countries || []).map((c) => (
                <div key={c.label} className="flex items-center justify-between bg-[#081521] rounded-lg px-3 py-2 border border-[#1e3b4f]">
                  <span className="truncate text-slate-300">{c.label}</span>
                  <span className="font-mono font-semibold text-[#4aa8ff]">{fmt(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Table */}
        <section className="rounded-xl bg-[#0c1f2e] border border-[#1e3b4f] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-[#081521] text-slate-400 border-b border-[#1e3b4f]">
                <tr>
                  <th className="px-3 py-3">เวลา UTC+7</th>
                  <th className="px-3 py-3">แพลตฟอร์ม</th>
                  <th className="px-3 py-3">บัญชี / ประเภท</th>
                  <th className="px-3 py-3">INST / TPO</th>
                  <th className="px-3 py-3">เคส</th>
                  <th className="px-3 py-3">IP / Port</th>
                  <th className="px-3 py-3">เครือข่าย / ประเทศ</th>
                  <th className="px-3 py-3">สถานะหนังสือ</th>
                  <th className="px-3 py-3">เลขหนังสือ</th>
                  {user.role === "master_admin" && <th className="px-3 py-3">จัดการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e3b4f]/60">
                {(data?.records || []).map((row) => {
                  const st = statusBadge(row);
                  return (
                    <tr key={row.record_key} className="hover:bg-[#12283a]/60">
                      <td className="px-3 py-2.5 font-mono text-slate-300">{row.local_time || "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className="px-2 py-0.5 rounded bg-[#122b3e] text-[#4aa8ff] font-medium">
                          {row.platform}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[240px] truncate" title={row.account}>
                        <div className="text-white font-medium truncate">{row.account}</div>
                        <div className="text-[11px] text-slate-400">{row.event_type}</div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-300">
                        <div>{row.inst_id || "—"}</div>
                        <div className="text-[11px] text-slate-400">{row.tpo_code || ""}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.scammer_case ? (
                          <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/40">
                            {row.scammer_case}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        <div className="text-[#35d0ba]">{row.ip || "—"}</div>
                        <div className="text-[11px] text-slate-400">{row.port ? `Port ${row.port}` : ""}</div>
                      </td>
                      <td className="px-3 py-2.5 max-w-[220px] truncate" title={row.network}>
                        <div className="text-slate-200 truncate">{row.network || "—"}</div>
                        <div className="text-[11px] text-slate-400">{row.country || "—"}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-300">{row.letter_number || "—"}</td>
                      {user.role === "master_admin" && (
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => {
                              setEditing(row);
                              setEditForm({
                                unavailable: Boolean(row.unavailable),
                                requested: Boolean(row.requested),
                                replied: Boolean(row.replied),
                                received: Boolean(row.received),
                                letter_number: row.letter_number || "",
                                result: row.result || "",
                              });
                            }}
                            className="p-1.5 rounded bg-[#122b3e] hover:bg-[#1a3d56] text-slate-200"
                            title="แก้ไข"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-[#1e3b4f] flex items-center justify-between text-xs text-slate-400">
            <span>หน้า {fmt(currentPage)} / {fmt(totalPages)} (ทั้งหมด {fmt(data?.pagination.total)} รายการ)</span>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="px-3 py-1 rounded bg-[#081521] border border-[#1e3b4f] disabled:opacity-40"
              >
                ก่อนหน้า
              </button>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + limit)}
                className="px-3 py-1 rounded bg-[#081521] border border-[#1e3b4f] disabled:opacity-40"
              >
                ถัดไป
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <form onSubmit={saveEdit} className="w-full max-w-lg rounded-2xl bg-[#0c1f2e] border border-[#1e3b4f] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">แก้ไขสถานะหนังสือ · {editing.ip}</h3>
              <button type="button" onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(["unavailable", "requested", "replied", "received"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 bg-[#081521] p-2.5 rounded-lg border border-[#1e3b4f]">
                  <input
                    type="checkbox"
                    checked={editForm[k]}
                    onChange={(e) => setEditForm({ ...editForm, [k]: e.target.checked })}
                  />
                  <span>{k === "unavailable" ? "ขอข้อมูลไม่ได้" : k === "requested" ? "ขอข้อมูลแล้ว" : k === "replied" ? "ตอบกลับแล้ว" : "ได้รับข้อมูลแล้ว"}</span>
                </label>
              ))}
            </div>
            <label className="block text-sm">
              <span className="text-slate-300">เลขหนังสือ</span>
              <input
                type="text"
                value={editForm.letter_number}
                onChange={(e) => setEditForm({ ...editForm, letter_number: e.target.value })}
                className="mt-1 w-full rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-300">ผลลัพธ์</span>
              <textarea
                rows={4}
                value={editForm.result}
                onChange={(e) => setEditForm({ ...editForm, result: e.target.value })}
                className="mt-1 w-full rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-slate-800">ยกเลิก</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#35d0ba] text-[#081521] font-semibold">บันทึก</button>
            </div>
          </form>
        </div>
      )}

      {/* Upload ZIP Modal */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleZipUpload} className="w-full max-w-md rounded-2xl bg-[#0c1f2e] border border-[#1e3b4f] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">อัปโหลดไฟล์ ZIP (TikTok / META)</h3>
              <button type="button" onClick={() => setUploadOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <input name="files" type="file" accept=".zip" multiple required className="w-full text-sm" />
            {uploadMsg && <p className="text-xs text-[#35d0ba]">{uploadMsg}</p>}
            <div className="flex justify-end gap-2">
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#35d0ba] text-[#081521] font-semibold">นำเข้าข้อมูล</button>
            </div>
          </form>
        </div>
      )}

      {/* Upload Scammer Excel Modal */}
      {casesOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCasesUpload} className="w-full max-w-md rounded-2xl bg-[#0c1f2e] border border-[#1e3b4f] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">นำเข้าไฟล์ url_cases_(Scammer).xlsx</h3>
              <button type="button" onClick={() => setCasesOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <input name="file" type="file" accept=".xlsx" required className="w-full text-sm" />
            {casesMsg && <p className="text-xs text-[#4aa8ff]">{casesMsg}</p>}
            <div className="flex justify-end gap-2">
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#4aa8ff] text-[#081521] font-semibold">นำเข้าฐานคดี</button>
            </div>
          </form>
        </div>
      )}

      {/* 17-Slide Report Modal */}
      {reportOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-2xl rounded-2xl bg-[#0c1f2e] border border-[#1e3b4f] p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] tracking-widest text-indigo-300 font-semibold">INTELLIGENCE PRESENTATION</p>
                <h3 className="font-bold text-white text-lg">สร้างรายงานนำเสนอ 17 สไลด์ (.pptx)</h3>
              </div>
              <button type="button" onClick={() => setReportOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleGenerateReport} className="space-y-3">
              <label className="block text-sm">
                <span className="text-slate-300">ชื่อรายงาน</span>
                <input
                  type="text"
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2 text-white"
                />
              </label>
              <p className="text-xs text-slate-400">
                ใช้เงื่อนไขตัวกรองปัจจุบัน: แพลตฟอร์ม {platform || "ทั้งหมด"} · วันที่ {dateFrom || "ทั้งหมด"} ถึง {dateTo || "ปัจจุบัน"} {scammerOnly ? "· เฉพาะ Scammer" : ""}
              </p>
              {reportMsg && <p className="text-xs text-[#35d0ba]">{reportMsg}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={reportBusy}
                  className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold disabled:opacity-50"
                >
                  {reportBusy ? "กำลังคำนวณ..." : "วิเคราะห์ข้อมูลและสร้างรายงาน"}
                </button>
                {activeReportId && (
                  <a
                    href={`/api/reports/${activeReportId}/pptx`}
                    className="px-4 py-2 rounded-lg bg-[#35d0ba] text-[#081521] font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" /> ดาวน์โหลด PowerPoint (.pptx)
                  </a>
                )}
              </div>
            </form>
            <div className="border-t border-[#1e3b4f] pt-3 space-y-2">
              <h4 className="text-xs font-semibold text-slate-400">ประวัติรายงานล่าสุด</h4>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {reportHistory.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs bg-[#081521] px-3 py-2 rounded-lg border border-[#1e3b4f]">
                    <div>
                      <div className="text-slate-200 font-medium">{item.report_name}</div>
                      <div className="text-[11px] text-slate-500">{item.generated_by} · {item.generated_at}</div>
                    </div>
                    <a
                      href={`/api/reports/${item.id}/pptx`}
                      className="px-2.5 py-1 rounded bg-[#122b3e] hover:bg-[#1a3d56] text-[#35d0ba]"
                    >
                      .pptx
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Users Modal */}
      {usersOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-3xl rounded-2xl bg-[#0c1f2e] border border-[#1e3b4f] p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] tracking-widest text-[#35d0ba] font-semibold">ACCESS CONTROL</p>
                <h3 className="font-bold text-white text-lg">จัดการผู้ใช้งาน</h3>
              </div>
              <button type="button" onClick={() => setUsersOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm bg-[#081521] p-4 rounded-xl border border-[#1e3b4f]">
              <input
                required
                pattern="[a-z0-9._-]{3,64}"
                placeholder="Username (เช่น viewer01)"
                value={newUserForm.username}
                onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                className="rounded-lg bg-[#0c1f2e] border border-[#1e3b4f] px-3 py-2 text-white"
              />
              <input
                required
                placeholder="ชื่อผู้ใช้งาน"
                value={newUserForm.display_name}
                onChange={(e) => setNewUserForm({ ...newUserForm, display_name: e.target.value })}
                className="rounded-lg bg-[#0c1f2e] border border-[#1e3b4f] px-3 py-2 text-white"
              />
              <input
                required
                type="password"
                minLength={10}
                placeholder="รหัสผ่านเริ่มต้น (อย่างน้อย 10 ตัวอักษร)"
                value={newUserForm.password}
                onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                className="rounded-lg bg-[#0c1f2e] border border-[#1e3b4f] px-3 py-2 text-white"
              />
              <select
                value={newUserForm.role}
                onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                className="rounded-lg bg-[#0c1f2e] border border-[#1e3b4f] px-3 py-2 text-white"
              >
                <option value="viewer">ผู้ชม (Viewer)</option>
                <option value="master_admin">Master Admin</option>
              </select>
              <label className="flex items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={newUserForm.approved}
                  onChange={(e) => setNewUserForm({ ...newUserForm, approved: e.target.checked })}
                />
                <span>อนุมัติให้เข้าใช้งานทันที</span>
              </label>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#35d0ba] text-[#081521] font-semibold">
                เพิ่มผู้ใช้งาน
              </button>
            </form>
            {userMsg && <p className="text-xs text-[#35d0ba]">{userMsg}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-[#081521] text-slate-400 border-b border-[#1e3b4f]">
                  <tr>
                    <th className="px-3 py-2">Username</th>
                    <th className="px-3 py-2">ชื่อ</th>
                    <th className="px-3 py-2">สิทธิ์</th>
                    <th className="px-3 py-2">อนุมัติ</th>
                    <th className="px-3 py-2">ใช้งาน</th>
                    <th className="px-3 py-2">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3b4f]/60">
                  {usersList.map((u) => (
                    <tr key={u.id}>
                      <td className="px-3 py-2 font-mono text-white">{u.username}</td>
                      <td className="px-3 py-2 text-slate-200">{u.display_name}</td>
                      <td className="px-3 py-2">{u.role === "master_admin" ? "Master Admin" : "Viewer"}</td>
                      <td className="px-3 py-2">{u.approved ? "อนุมัติ" : "รออนุมัติ"}</td>
                      <td className="px-3 py-2">{u.active ? "เปิด" : "ปิด"}</td>
                      <td className="px-3 py-2 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleUpdateUser(u.username, { approved: !u.approved })}
                          className="px-2 py-1 rounded bg-[#122b3e] hover:bg-[#1a3d56]"
                        >
                          {u.approved ? "ถอนอนุมัติ" : "อนุมัติ"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateUser(u.username, { active: !u.active })}
                          className="px-2 py-1 rounded bg-[#122b3e] hover:bg-[#1a3d56]"
                        >
                          {u.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const pwd = window.prompt(`ตั้งรหัสผ่านใหม่สำหรับ ${u.username} (อย่างน้อย 10 ตัวอักษร)`);
                            if (pwd) handleUpdateUser(u.username, { password: pwd });
                          }}
                          className="px-2 py-1 rounded bg-amber-950/60 hover:bg-amber-900/60 text-amber-200"
                        >
                          รีเซ็ตรหัส
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Account Completion Modal */}
      {completeOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCompleteAccount} className="w-full max-w-lg rounded-2xl bg-[#0c1f2e] border border-[#1e3b4f] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] tracking-widest text-teal-300 font-semibold">ACCOUNT COMPLETION</p>
                <h3 className="font-bold text-white text-lg">ปิดงานระดับบัญชี</h3>
              </div>
              <button type="button" onClick={() => setCompleteOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-slate-400">
              ระบบจะเปลี่ยน IP ที่ยังไม่ได้ดำเนินการทั้งหมดของบัญชีนี้เป็น “เรียบร้อยแล้ว — ไม่ต้องขอข้อมูล IP” โดยไม่กระทบรายการที่เคยขอหรือได้รับข้อมูลแล้ว
            </p>
            <label className="block text-sm">
              <span className="text-slate-300">แพลตฟอร์ม</span>
              <select
                value={completePlatform}
                onChange={(e) => {
                  setCompletePlatform(e.target.value);
                  loadAccountsForCompletion(e.target.value);
                }}
                className="mt-1 w-full rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2 text-white"
              >
                <option value="TikTok">TikTok</option>
                <option value="Facebook">Facebook</option>
                <option value="Instagram">Instagram</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-300">บัญชีโซเชียล ({fmt(completeAccounts.length)} บัญชี)</span>
              <select
                required
                value={completeAccountId}
                onChange={(e) => setCompleteAccountId(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2 text-white"
              >
                <option value="">เลือกบัญชี...</option>
                {completeAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.account_name} {acc.is_completed ? "(ปิดงานแล้ว)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-300">หมายเหตุ</span>
              <textarea
                rows={3}
                value={completeReason}
                onChange={(e) => setCompleteReason(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#081521] border border-[#1e3b4f] px-3 py-2 text-white"
              />
            </label>
            {completeMsg && <p className="text-xs text-teal-300">{completeMsg}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCompleteOpen(false)} className="px-4 py-2 rounded-lg bg-slate-800">ปิด</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-teal-400 text-[#081521] font-semibold">ยืนยันปิดงานบัญชี</button>
            </div>
          </form>
        </div>
      )}

      {/* Sync Toast */}
      {syncMsg && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-amber-950 border border-amber-400/40 text-amber-200 text-sm shadow-xl">
          {syncMsg}
        </div>
      )}
    </div>
  );
}
