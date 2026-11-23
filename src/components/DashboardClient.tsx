"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  LogOut,
  RefreshCw,
  Search,
  Edit3,
  X,
  Download,
  Presentation,
  ArrowLeftRight,
  Users,
  CheckCircle2,
  Menu,
  Table2,
  LayoutDashboard,
  ArrowUpDown,
  BarChart3,
  ShieldAlert,
  Clock,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import ColumnFilterPopover from "./ColumnFilterPopover";
import ExcelManagerView, {
  type AllColFilters,
  type ColFilterKey,
  type ExcelEventRow,
} from "./ExcelManagerView";
import CountryIspStatsView from "./CountryIspStatsView";
import ScammerCasesSheet from "./ScammerCasesSheet";
import ZipUploadModal from "./ZipUploadModal";
import { formatDateDMY, formatDateTimeDMY } from "@/lib/date-format";

type IpEventRow = ExcelEventRow;

const EMPTY_COL_FILTERS: AllColFilters = {
  local_date: [],
  platform: [],
  it_no: [],
  target_id: [],
  inst_id: [],
  tpo_code: [],
  scammer_case: [],
  reported_date: [],
  team: [],
  account: [],
  meta_type: [],
  ip: [],
  network: [],
  country: [],
  letter: [],
};

const uniq = (arr: Array<string | null | undefined>) =>
  Array.from(new Set(arr.map((v) => String(v || "").trim() || "(ว่าง)"))).sort();

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
  account_coverage?: { total: number; requested: number; pending: number; pct: number };
  tpo_coverage?: { total: number; requested: number; pending: number; pct: number };
  tracking_summary?: {
    no_ip_data_count: number;
    unavailable_count: number;
    requested_count: number;
    replied_count: number;
    received_count: number;
    distinct_letters: number;
    total_networks: number;
  };
  top_networks: Array<{ label: string; value: number }>;
  top_countries: Array<{ label: string; value: number }>;
  filter_options?: {
    countries: string[];
    networks: string[];
  };
  records: IpEventRow[];
  pagination: { limit: number; offset: number; total: number };
}

const fmt = (n: number | string | undefined) => Number(n || 0).toLocaleString("th-TH");

const DONUT_COLORS = ["#ffd000", "#3b82f6", "#38bdf8", "#f97316", "#a855f7", "#ef4444"];

function statusBadge(row: IpEventRow): { label: string; cls: string } {
  if (row.no_ip_data) return { label: "ไม่มีข้อมูล IP", cls: "bg-slate-700 text-slate-200" };
  if (row.unavailable) return { label: "ขอข้อมูลไม่ได้", cls: "bg-rose-900/70 text-rose-200 border border-rose-500/40" };
  if (row.received) return { label: "ได้รับข้อมูลแล้ว", cls: "bg-emerald-900/70 text-emerald-200 border border-emerald-500/40" };
  if (row.no_ip_request_needed) return { label: "ไม่ต้องขอ IP", cls: "bg-teal-900/70 text-teal-200" };
  if (row.replied) return { label: "ตอบกลับแล้ว", cls: "bg-sky-900/70 text-sky-200" };
  if (row.requested) return { label: "ขอข้อมูลแล้ว", cls: "bg-[#ffd000]/20 text-[#ffd000] border border-[#ffd000]/50" };
  return { label: "ยังไม่ดำเนินการ", cls: "bg-[#0e2454] text-blue-200 border border-[#1d3a78]" };
}

function CountryDonutChart({
  countries,
  total,
}: {
  countries: Array<{ label: string; value: number }>;
  total: number;
}) {
  const sumTop = countries.reduce((acc, c) => acc + Number(c.value || 0), 0);
  const safeTotal = Math.max(1, sumTop);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="relative w-32 h-32 shrink-0">
        <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
          <circle cx="55" cy="55" r={radius} fill="none" stroke="#0e2454" strokeWidth="14" />
          {countries.map((c, idx) => {
            const frac = Number(c.value || 0) / safeTotal;
            const dash = frac * circumference;
            const seg = (
              <circle
                key={c.label}
                cx="55"
                cy="55"
                r={radius}
                fill="none"
                stroke={DONUT_COLORS[idx % DONUT_COLORS.length]}
                strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-sm font-bold text-white leading-tight">{fmt(total)}</span>
          <span className="text-[10px] text-blue-200">เหตุการณ์</span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-1.5 text-xs">
        {countries.map((c, idx) => (
          <div key={c.label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: DONUT_COLORS[idx % DONUT_COLORS.length] }}
              />
              <span className="truncate text-blue-100">{c.label}</span>
            </div>
            <span className="font-mono font-semibold text-[#ffd000] shrink-0">{fmt(c.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
  const [limit, setLimit] = useState(25);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<"dashboard" | "analytics" | "excel" | "scammers">("dashboard");
  const [lastRefreshed, setLastRefreshed] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [eventType, setEventType] = useState("");
  const [country, setCountry] = useState("");
  const [network, setNetwork] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reportedFrom, setReportedFrom] = useState("");
  const [reportedTo, setReportedTo] = useState("");
  const [scammerOnly, setScammerOnly] = useState(false);
  const [caseWindowOnly, setCaseWindowOnly] = useState(false);

  // Sorting & Excel-style ALL-column filters
  const [sortBy, setSortBy] = useState("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [colFilters, setColFilters] = useState<AllColFilters>(EMPTY_COL_FILTERS);

  const lastFilterKeyRef = useRef<string>("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

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
  const [uploadPlatformHint, setUploadPlatformHint] = useState<"META" | "TikTok" | "auto">("META");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadResults, setUploadResults] = useState<
    Array<{
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
    }>
  >([]);

  const [casesOpen, setCasesOpen] = useState(false);
  const [casesMsg, setCasesMsg] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportName, setReportName] = useState("Social Media IP Intelligence Report (ACSC-CIB-TCSD)");
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

  const fetchEvents = useCallback(
    async (forceFull = false) => {
      if (!user) return;
      setLoading(true);
      try {
        const filterKey = JSON.stringify({
          debouncedSearch,
          platform,
          eventType,
          country,
          network,
          requestStatus,
          dateFrom,
          dateTo,
          reportedFrom,
          reportedTo,
          scammerOnly,
          caseWindowOnly,
          colFilters,
        });
        const canSkipStats = !forceFull && lastFilterKeyRef.current === filterKey && lastFilterKeyRef.current !== "";

        const colParams: Record<string, string> = {};
        (Object.keys(colFilters) as ColFilterKey[]).forEach((k) => {
          if (colFilters[k].length) colParams[`col_${k}`] = colFilters[k].join("||");
        });

        const qs = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          sort_by: sortBy,
          sort_dir: sortDir,
          ...(canSkipStats ? { skip_stats: "1" } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(platform ? { platform } : {}),
          ...(eventType ? { event_type: eventType } : {}),
          ...(country ? { country } : {}),
          ...(network ? { network } : {}),
          ...(requestStatus ? { request_status: requestStatus } : {}),
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo ? { date_to: dateTo } : {}),
          ...(reportedFrom ? { reported_from: reportedFrom } : {}),
          ...(reportedTo ? { reported_to: reportedTo } : {}),
          ...(scammerOnly ? { scammer_only: "true" } : {}),
          ...(caseWindowOnly ? { case_window_only: "true" } : {}),
          ...colParams,
        });
        const res = await fetch(`/api/events?${qs.toString()}`, { cache: "no-store" });
        if (res.status === 401) {
          setUser(null);
          return;
        }
        if (res.ok) {
          const json = await res.json();
          setLastRefreshed(new Date().toLocaleTimeString("th-TH"));
          if (json.stats_skipped) {
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    records: json.records,
                    pagination: {
                      ...prev.pagination,
                      limit: json.pagination.limit,
                      offset: json.pagination.offset,
                    },
                  }
                : prev
            );
          } else {
            lastFilterKeyRef.current = filterKey;
            setData(json);
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [
      user,
      limit,
      offset,
      sortBy,
      sortDir,
      debouncedSearch,
      platform,
      eventType,
      country,
      network,
      requestStatus,
      dateFrom,
      dateTo,
      reportedFrom,
      reportedTo,
      scammerOnly,
      caseWindowOnly,
      colFilters,
    ]
  );

  useEffect(() => {
    fetchEvents(false);
  }, [fetchEvents]);

  function handleSort(col: string) {
    setOffset(0);
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  function handleColFilterChange(key: ColFilterKey, vals: string[]) {
    setOffset(0);
    setColFilters((prev) => ({ ...prev, [key]: vals }));
  }

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
      fetchEvents(true);
    }
  }

  async function handleZipUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    fd.set("platform_hint", uploadPlatformHint);
    setUploadBusy(true);
    setUploadResults([]);
    setUploadMsg("กำลังแตกไฟล์ ZIP, แยกโครงสร้าง META / TikTok, จับคู่เคส Scammer และดึง RDAP อัตโนมัติ...");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const body = await res.json();
      if (res.ok) {
        setUploadResults(body.results || []);
        setUploadMsg(`นำเข้าข้อมูลลงฐานข้อมูล TiDB Cloud สำเร็จ (${(body.results || []).length} ไฟล์)`);
        fetchEvents(true);
      } else {
        setUploadMsg(`ผิดพลาด: ${body.error}`);
      }
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleCasesUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setCasesMsg("กำลังนำเข้าไฟล์ Scammer Excel และจับคู่เคส...");
    const res = await fetch("/api/cases/import", { method: "POST", body: fd });
    const body = await res.json();
    if (res.ok) {
      setCasesMsg(`นำเข้าเคส Scammer สำเร็จ ${fmt(body.imported_cases)} รายการ`);
      fetchEvents(true);
    } else {
      setCasesMsg(`ผิดพลาด: ${body.error}`);
    }
  }

  function buildFilterQuery() {
    return new URLSearchParams({
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(platform ? { platform } : {}),
      ...(eventType ? { event_type: eventType } : {}),
      ...(country ? { country } : {}),
      ...(network ? { network } : {}),
      ...(requestStatus ? { request_status: requestStatus } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
      ...(reportedFrom ? { reported_from: reportedFrom } : {}),
      ...(reportedTo ? { reported_to: reportedTo } : {}),
      ...(scammerOnly ? { scammer_only: "true" } : {}),
      ...(caseWindowOnly ? { case_window_only: "true" } : {}),
    });
  }

  function handleExportCsv() {
    const qs = buildFilterQuery();
    window.open(`/api/export/csv?${qs.toString()}`, "_blank");
  }

  function handleExportExcel() {
    const qs = buildFilterQuery();
    window.open(`/api/export/excel?${qs.toString()}`, "_blank");
  }

  async function openReportModal() {
    setReportOpen(true);
    setReportMsg("");
    const res = await fetch("/api/reports", { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setReportHistory(body.reports || []);
    }
  }

  async function handleCreateReport(e: React.FormEvent) {
    e.preventDefault();
    setReportBusy(true);
    setReportMsg("กำลังประมวลผลสถิติรายงาน 17 สไลด์จากฐานข้อมูล...");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          report_name: reportName,
          filters: {
            search: debouncedSearch || undefined,
            platform: platform || undefined,
            event_type: eventType || undefined,
            country: country || undefined,
            network: network || undefined,
            request_status: requestStatus || undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
            scammer_only: scammerOnly,
            case_window_only: caseWindowOnly,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setReportMsg(`ผิดพลาด: ${body.error || res.status}`);
        return;
      }
      setActiveReportId(body.id);
      setReportMsg(`สร้างรายงาน "${body.report_name}" สำเร็จ — กดดาวน์โหลด PPTX ได้เลย`);
      const histRes = await fetch("/api/reports", { cache: "no-store" });
      if (histRes.ok) {
        const histBody = await histRes.json();
        setReportHistory(histBody.reports || []);
      }
    } finally {
      setReportBusy(false);
    }
  }

  async function handleRequestSync() {
    setSyncMsg("กำลังสร้างคิวซิงค์...");
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job_type: "all_three_way" }),
    });
    const body = await res.json();
    if (res.ok) {
      setSyncMsg(`ซิงค์เรียบร้อย: ${body.summary}`);
      setTimeout(() => setSyncMsg(""), 6000);
    } else {
      setSyncMsg(`ซิงค์ไม่สำเร็จ: ${body.error || res.status}`);
    }
  }

  async function handleExpire90Days() {
    setSyncMsg("กำลังตรวจสอบรายการ IP ที่เกิน 90 วันและยังไม่ได้ขอข้อมูลจาก ISP...");
    try {
      const checkRes = await fetch("/api/admin/events/expire-90d", { cache: "no-store" });
      const checkBody = await checkRes.json();
      if (!checkRes.ok) {
        setSyncMsg(`ตรวจสอบไม่สำเร็จ: ${checkBody.error || checkRes.status}`);
        return;
      }
      const pendingCount = Number(checkBody.pending_expired_count || 0);
      if (pendingCount === 0) {
        setSyncMsg(`ไม่พบรายการ IP ที่เกิน 90 วัน (ก่อนวันที่ ${checkBody.cutoff_date}) ที่ยังไม่ได้ดำเนินการครับ`);
        setTimeout(() => setSyncMsg(""), 7000);
        return;
      }
      const confirmed = window.confirm(
        `พบข้อมูลการใช้ IP ที่เกิน 90 วัน (ก่อนวันที่ ${checkBody.cutoff_date}) และยังไม่ได้ขอข้อมูลจาก ISP จำนวน ${fmt(pendingCount)} รายการ\n\nยืนยันอัปเดตติ๊ก "ขอข้อมูลไม่ได้" และหมายเหตุ "ข้อมูลเกิน 90 วัน" ทั้งหมดหรือไม่?`
      );
      if (!confirmed) {
        setSyncMsg("");
        return;
      }
      setSyncMsg(`กำลังอัปเดต ${fmt(pendingCount)} รายการเป็น "ขอข้อมูลไม่ได้ (ข้อมูลเกิน 90 วัน)"...`);
      const res = await fetch("/api/admin/events/expire-90d", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setSyncMsg(`อัปเดตไม่สำเร็จ: ${body.error || res.status}`);
        return;
      }
      setSyncMsg(`อัปเดตข้อมูล IP เกิน 90 วันสำเร็จ ${fmt(body.updated_count)} รายการ (ติ๊ก "ขอข้อมูลไม่ได้" + หมายเหตุ "ข้อมูลเกิน 90 วัน")`);
      fetchEvents(true);
    } catch {
      setSyncMsg("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    }
  }

  async function handleQuickToggleCheckbox(
    row: IpEventRow,
    field: "unavailable" | "requested" | "replied" | "received" | "no_ip_request_needed",
    checked: boolean
  ) {
    if (!user || user.role !== "master_admin") return;
    const payload = {
      unavailable: field === "unavailable" ? checked : Boolean(row.unavailable),
      requested: field === "requested" ? checked : Boolean(row.requested),
      replied: field === "replied" ? checked : Boolean(row.replied),
      received: field === "received" ? checked : Boolean(row.received),
      no_ip_request_needed: field === "no_ip_request_needed" ? checked : Boolean(row.no_ip_request_needed),
      letter_number: row.letter_number || "",
      result: row.result || "",
    };
    // Optimistic UI update
    setData((prev) =>
      prev
        ? {
            ...prev,
            records: prev.records.map((r) =>
              r.record_key === row.record_key
                ? { ...r, [field]: checked ? 1 : 0 }
                : r
            ),
          }
        : prev
    );
    const res = await fetch(`/api/events/${row.record_key}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      fetchEvents(true);
    }
  }

  async function openUsersModal() {
    setUsersOpen(true);
    setUserMsg("");
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setUsersList(body.users || []);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setUserMsg("กำลังสร้างผู้ใช้...");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newUserForm),
    });
    const body = await res.json();
    if (!res.ok) {
      setUserMsg(`ผิดพลาด: ${body.error || res.status}`);
      return;
    }
    setUserMsg(`สร้างผู้ใช้ "${body.user.username}" สำเร็จ`);
    setNewUserForm({ username: "", display_name: "", password: "", role: "viewer", approved: true });
    openUsersModal();
  }

  async function handleUpdateUser(
    targetUsername: string,
    patch: { approved?: boolean; active?: boolean; role?: string; password?: string }
  ) {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(targetUsername)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok) {
      setUserMsg(`แก้ไขไม่สำเร็จ: ${body.error || res.status}`);
      return;
    }
    setUserMsg(`อัปเดตผู้ใช้ "${targetUsername}" สำเร็จ`);
    openUsersModal();
  }

  async function loadCompleteAccounts(plat: string) {
    setCompletePlatform(plat);
    setCompleteAccountId("");
    const res = await fetch(`/api/admin/accounts/complete?platform=${encodeURIComponent(plat)}`, { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setCompleteAccounts(body.accounts || []);
    }
  }

  async function openCompleteModal() {
    setCompleteOpen(true);
    setCompleteMsg("");
    await loadCompleteAccounts(completePlatform);
  }

  async function handleCompleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!completeAccountId) {
      setCompleteMsg("กรุณาเลือกบัญชี");
      return;
    }
    setCompleteMsg("กำลังปิดงานบัญชี...");
    const res = await fetch("/api/admin/accounts/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account_id: Number(completeAccountId), reason: completeReason }),
    });
    const body = await res.json();
    if (!res.ok) {
      setCompleteMsg(`ผิดพลาด: ${body.error || res.status}`);
      return;
    }
    setCompleteMsg(`ปิดงานบัญชี ${body.account} สำเร็จ (อัปเดต ${fmt(body.updated_records)} รายการ)`);
    fetchEvents(true);
  }

  // ==================== LOGIN SCREEN (CIB NAVY & GOLD + TCSD & ACSC LOGOS) ====================
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#05112b] bg-[radial-gradient(ellipse_at_top,_#0f2c6e_0%,_#05112b_65%)] p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md rounded-2xl bg-[#0a1d45] border-2 border-[#ffd000]/50 p-6 sm:p-8 shadow-2xl space-y-5"
        >
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex items-center justify-center gap-4">
              <img
                src="/logos/acsc-logo.png?v=2"
                alt="ACSC Logo"
                width={56}
                height={56}
                className="w-14 h-14 object-contain rounded-full border-2 border-[#ffd000]/70 bg-white p-0.5 shadow-lg"
              />
              <img
                src="/logos/tcsd-logo.png?v=2"
                alt="TCSD Logo"
                width={64}
                height={64}
                className="w-16 h-16 object-contain drop-shadow-lg"
              />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-widest text-[#ffd000] font-bold">
                ACSC · CIB · TCSD · ตำรวจสอบสวนกลาง
              </p>
              <h1 className="text-xl font-bold text-white mt-1">Social Media IP Analysis V2</h1>
              <p className="text-xs text-blue-200/80 mt-0.5">ระบบวิเคราะห์ข้อมูล IP · TikTok & META</p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-blue-100 font-medium">Username</span>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2.5 text-white focus:outline-none focus:border-[#ffd000]"
              />
            </label>
            <label className="block text-sm">
              <span className="text-blue-100 font-medium">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2.5 text-white focus:outline-none focus:border-[#ffd000]"
              />
            </label>
          </div>

          {loginError && <p className="text-sm text-rose-400 font-medium">{loginError}</p>}

          <button
            type="submit"
            disabled={loggingIn}
            className="w-full py-2.5 rounded-lg bg-[#ffd000] text-[#05112b] font-bold hover:bg-[#eab308] transition disabled:opacity-50 shadow-lg"
          >
            {loggingIn ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    );
  }

  const kpi = data?.kpi;
  const accCov = data?.account_coverage || { total: 0, requested: 0, pending: 0, pct: 0 };
  const tpoCov = data?.tpo_coverage || { total: 0, requested: 0, pending: 0, pct: 0 };
  const trSum = data?.tracking_summary || {
    no_ip_data_count: 0,
    unavailable_count: 0,
    requested_count: 0,
    replied_count: 0,
    received_count: 0,
    distinct_letters: 0,
    total_networks: 0,
  };
  const totalEventsNum = Math.max(1, Number(kpi?.total_events || 0));
  const maxNet = Math.max(1, ...(data?.top_networks || []).map((n) => Number(n.value)));
  const totalPages = Math.max(1, Math.ceil((data?.pagination.total || 0) / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  const tableOpts = {
    local_date: uniq((data?.records || []).map((r) => r.local_time?.slice(0, 10))),
    it_no: uniq((data?.records || []).map((r) => r.it_no)),
    target_id: uniq((data?.records || []).map((r) => r.target_id)),
    inst_id: uniq((data?.records || []).map((r) => r.inst_id)),
    tpo_code: uniq((data?.records || []).map((r) => r.tpo_code)),
    reported_date: uniq((data?.records || []).map((r) => r.reported_date)).reverse(),
    team: uniq((data?.records || []).map((r) => r.team)),
    account: uniq((data?.records || []).map((r) => r.account)),
    meta_type: uniq((data?.records || []).map((r) => r.meta_account_type)),
    ip: uniq((data?.records || []).map((r) => r.ip)),
    network: uniq((data?.records || []).map((r) => r.network)),
    country: uniq((data?.records || []).map((r) => r.country)),
    letter: uniq((data?.records || []).map((r) => r.letter_number)),
  };
  const sortIndicator = (col: string) => (sortBy === col ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="min-h-screen bg-[#05112b] text-slate-100">
      {/* ==================== TOP CIB HEADER ==================== */}
      <header className="border-b-2 border-[#ffd000]/60 bg-[#071638]/95 backdrop-blur sticky top-0 z-30 shadow-lg">
        <div className="px-3 sm:px-5 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <img
                src="/logos/acsc-logo.png?v=2"
                alt="ACSC"
                width={36}
                height={36}
                className="w-8 h-8 sm:w-9 sm:h-9 object-contain rounded-full border border-[#ffd000]/70 bg-white p-0.5"
              />
              <img
                src="/logos/tcsd-logo.png?v=2"
                alt="TCSD"
                width={40}
                height={40}
                className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-[11px] tracking-widest text-[#ffd000] font-bold truncate">
                ACSC · CIB · TCSD · SOCIAL MEDIA IP ANALYSIS
              </p>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold text-white truncate">
                  Social Media IP Analysis
                </h1>
                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#0e2454] border border-[#ffd000]/40 text-[11px] text-[#ffd000]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  พร้อมใช้งาน · {fmt(kpi?.total_events)} รายการ
                </span>
              </div>
            </div>
          </div>

          {/* Mobile quick buttons */}
          <div className="flex xl:hidden items-center gap-1.5 shrink-0">
            <button
              onClick={() => fetchEvents(true)}
              className="p-2 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-[#ffd000]"
              aria-label="รีเฟรช"
              title="รีเฟรชข้อมูล"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="px-2.5 py-2 rounded-lg bg-[#ffd000] text-[#05112b] font-bold flex items-center gap-1 text-xs"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              <span>เมนู</span>
            </button>
          </div>

          {/* Desktop toolbar */}
          <div className="hidden xl:flex flex-wrap items-center justify-end gap-1.5 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-[#05112b] border border-[#1d3a78] text-blue-100">
              {user.display_name} · {user.role === "master_admin" ? "Master Admin" : "Viewer"}
            </span>
            <button
              onClick={() => fetchEvents(true)}
              className="px-2.5 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-blue-100 flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> รีเฟรช
            </button>
            <button
              onClick={openReportModal}
              className="px-2.5 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-blue-100 flex items-center gap-1"
            >
              <Presentation className="w-3.5 h-3.5 text-[#ffd000]" /> สร้างรายงานนำเสนอ
            </button>
            {user.role === "master_admin" && (
              <>
                <button
                  onClick={openUsersModal}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-blue-100 flex items-center gap-1"
                >
                  <Users className="w-3.5 h-3.5 text-[#ffd000]" /> จัดการผู้ใช้
                </button>
                <button
                  onClick={() => { setUploadMsg(""); setUploadResults([]); setUploadOpen(true); }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" /> อัปโหลด ZIP (META/TikTok)
                </button>
                <button
                  onClick={() => { setCasesMsg(""); setCasesOpen(true); }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#133273] hover:bg-[#1a4399] border border-blue-400/40 text-blue-100 flex items-center gap-1"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#ffd000]" /> อัปเดตจาก Excel
                </button>
                <button
                  onClick={handleRequestSync}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-blue-100 flex items-center gap-1"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-[#ffd000]" /> ซิงค์ทั้งหมด
                </button>
                <button
                  onClick={openCompleteModal}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-blue-100 flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> ปิดงานบัญชี
                </button>
                <button
                  onClick={handleExpire90Days}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-400/50 text-rose-200 flex items-center gap-1"
                  title="ตรวจสอบและอัปเดตรายการ IP ที่เกิน 90 วันและยังไม่ได้ขอข้อมูลจาก ISP เป็น ขอข้อมูลไม่ได้ (ข้อมูลเกิน 90 วัน)"
                >
                  <Clock className="w-3.5 h-3.5 text-[#ffd000]" /> อัปเดต IP เกิน 90 วัน
                </button>
              </>
            )}
            <button
              onClick={handleLogout}
              className="px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-500/40 text-rose-200 flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" /> ออกจากระบบ
            </button>
          </div>
        </div>

        {/* Mobile / Tablet Collapsible Action Drawer */}
        {mobileMenuOpen && (
          <div className="xl:hidden border-t border-[#1d3a78] bg-[#061330] px-3 py-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-blue-100 pb-1 border-b border-[#1d3a78]/70">
              <span>ผู้ใช้: <strong className="text-white">{user.display_name}</strong></span>
              <span className="px-2 py-0.5 rounded-full bg-[#ffd000]/20 text-[#ffd000] font-semibold">
                {user.role === "master_admin" ? "Master Admin" : "Viewer"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => { setMobileMenuOpen(false); handleExportCsv(); }}
                className="px-3 py-2 rounded-lg bg-[#0f2454] border border-[#244894] text-blue-100 flex items-center justify-center gap-1.5"
              >
                <Download className="w-4 h-4 text-[#ffd000]" /> ส่งออก CSV
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); openReportModal(); }}
                className="px-3 py-2 rounded-lg bg-[#0f2454] border border-[#244894] text-blue-100 flex items-center justify-center gap-1.5"
              >
                <Presentation className="w-4 h-4 text-[#ffd000]" /> รายงาน 17 สไลด์
              </button>
              {user.role === "master_admin" && (
                <>
                  <button
                    onClick={() => { setMobileMenuOpen(false); setUploadOpen(true); }}
                    className="px-3 py-2 rounded-lg bg-[#ffd000] text-[#05112b] font-bold flex items-center justify-center gap-1.5"
                  >
                    <Upload className="w-4 h-4" /> อัปโหลด ZIP
                  </button>
                  <button
                    onClick={() => { setMobileMenuOpen(false); setCasesMsg(""); setCasesOpen(true); }}
                    className="px-3 py-2 rounded-lg bg-[#133273] border border-blue-400/40 text-blue-100 flex items-center justify-center gap-1.5"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-[#ffd000]" /> อัปเดต Excel
                  </button>
                  <button
                    onClick={() => { setMobileMenuOpen(false); openUsersModal(); }}
                    className="px-3 py-2 rounded-lg bg-[#0f2454] border border-[#244894] text-blue-100 flex items-center justify-center gap-1.5"
                  >
                    <Users className="w-4 h-4 text-[#ffd000]" /> จัดการผู้ใช้
                  </button>
                  <button
                    onClick={() => { setMobileMenuOpen(false); openCompleteModal(); }}
                    className="px-3 py-2 rounded-lg bg-[#0f2454] border border-[#244894] text-blue-100 flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> ปิดงานบัญชี
                  </button>
                  <button
                    onClick={() => { setMobileMenuOpen(false); handleExpire90Days(); }}
                    className="px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-400/50 text-rose-200 flex items-center justify-center gap-1.5"
                  >
                    <Clock className="w-4 h-4 text-[#ffd000]" /> IP เกิน 90 วัน
                  </button>
                  <button
                    onClick={() => { setMobileMenuOpen(false); handleRequestSync(); }}
                    className="px-3 py-2 rounded-lg bg-[#0f2454] border border-[#244894] text-blue-100 flex items-center justify-center gap-1.5"
                  >
                    <ArrowLeftRight className="w-4 h-4 text-[#ffd000]" /> ซิงค์ทั้งหมด
                  </button>
                </>
              )}
              <button
                onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                className="px-3 py-2 rounded-lg bg-rose-950/70 border border-rose-500/40 text-rose-200 flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-4 h-4" /> ออกจากระบบ
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-[1660px] mx-auto p-3 sm:p-4 lg:p-5 space-y-4">
        {/* Status Progress Banner (matching screenshot) */}
        <section className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">
              {loading ? "กำลังโหลดข้อมูลจากฐานข้อมูล TiDB Cloud..." : "ข้อมูลพร้อมใช้งาน"}
            </span>
            <span className="font-mono font-bold text-[#ffd000]">{loading ? "..." : "100%"}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[#05112b] overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-[#2563eb] via-[#38bdf8] to-[#ffd000] transition-all duration-300 ${
                loading ? "w-2/3 animate-pulse" : "w-full"
              }`}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-blue-200/80">
            <span>
              ฐานข้อมูล TiDB Cloud: แสดงหน้าละ {limit} รายการ จากทั้งหมด {fmt(kpi?.total_events)} รายการ
              {lastRefreshed ? ` · ตรวจสอบล่าสุด ${lastRefreshed}` : ""}
            </span>
            {syncMsg && <span className="text-[#ffd000] font-medium">{syncMsg}</span>}
          </div>
        </section>

        {/* Filter Bar (matching screenshot) */}
        <section className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-3.5 sm:p-4 space-y-3 text-xs sm:text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2.5">
            <div className="sm:col-span-2 relative">
              <Search className="w-4 h-4 text-blue-300 absolute left-3 top-2.5" />
              <input
                type="search"
                placeholder="ค้นหา บัญชี, INST ID, TPO code, IP, ISP, เลขหนังสือ..."
                value={search}
                onChange={(e) => { setOffset(0); setSearch(e.target.value); }}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#05112b] border border-[#1d3a78] text-white placeholder-blue-300/60 focus:outline-none focus:border-[#ffd000]"
              />
            </div>

            <select
              value={platform}
              onChange={(e) => { setOffset(0); setPlatform(e.target.value); }}
              className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-2 text-white focus:border-[#ffd000]"
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
              className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-2 text-white focus:border-[#ffd000]"
            >
              <option value="">ทุกประเภทเหตุการณ์</option>
              <option value="IP Address">IP Address</option>
              <option value="IP Session">IP Session</option>
              <option value="Login">Login</option>
              <option value="Logout">Logout</option>
              <option value="Signup">Signup</option>
            </select>

            <select
              value={country}
              onChange={(e) => { setOffset(0); setCountry(e.target.value); }}
              className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-2 text-white focus:border-[#ffd000]"
            >
              <option value="">ทุกประเทศ (RDAP)</option>
              {(data?.filter_options?.countries || []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              value={network}
              onChange={(e) => { setOffset(0); setNetwork(e.target.value); }}
              className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-2 text-white focus:border-[#ffd000]"
            >
              <option value="">ทุกเครือข่าย (ISP)</option>
              {(data?.filter_options?.networks || []).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>

            <select
              value={requestStatus}
              onChange={(e) => { setOffset(0); setRequestStatus(e.target.value); }}
              className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-2 text-white focus:border-[#ffd000]"
            >
              <option value="">ทุกสถานะหนังสือ</option>
              <option value="pending">ยังไม่ดำเนินการ</option>
              <option value="requested">ขอข้อมูลแล้ว</option>
              <option value="replied">ตอบกลับแล้ว</option>
              <option value="received">ได้รับข้อมูลแล้ว</option>
              <option value="unavailable">ขอข้อมูลไม่ได้</option>
              <option value="complete">ไม่ต้องขอ IP (ปิดงาน)</option>
              <option value="no_ip_data">ไม่มีข้อมูล IP</option>
            </select>

            <div className="sm:col-span-2 md:col-span-4 xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1 border-t border-[#1d3a78]/60">
              <label className="flex flex-col gap-1 text-[11px] text-blue-200">
                <span className="font-semibold text-[#ffd000]">วันที่รับแจ้ง (ตั้งแต่)</span>
                <input
                  type="date"
                  value={reportedFrom}
                  onChange={(e) => { setOffset(0); setReportedFrom(e.target.value); }}
                  className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-1.5 text-xs text-white focus:border-[#ffd000]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-blue-200">
                <span className="font-semibold text-[#ffd000]">วันที่รับแจ้ง (ถึง)</span>
                <input
                  type="date"
                  value={reportedTo}
                  onChange={(e) => { setOffset(0); setReportedTo(e.target.value); }}
                  className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-1.5 text-xs text-white focus:border-[#ffd000]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-blue-200">
                <span className="font-semibold text-sky-300">วันที่ของข้อมูล IP (ตั้งแต่)</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setOffset(0); setDateFrom(e.target.value); }}
                  className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-1.5 text-xs text-white focus:border-[#ffd000]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-blue-200">
                <span className="font-semibold text-sky-300">วันที่ของข้อมูล IP (ถึง)</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setOffset(0); setDateTo(e.target.value); }}
                  className="rounded-lg bg-[#05112b] border border-[#1d3a78] px-2.5 py-1.5 text-xs text-white focus:border-[#ffd000]"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-rose-200 cursor-pointer text-xs font-medium">
              <input
                type="checkbox"
                checked={scammerOnly}
                onChange={(e) => { setOffset(0); setScammerOnly(e.target.checked); }}
                className="accent-rose-500"
              />
              <span>เฉพาะเคส Scammer</span>
            </label>
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#ffd000]/10 border border-[#ffd000]/50 text-[#ffd000] cursor-pointer text-xs font-medium">
              <input
                type="checkbox"
                checked={caseWindowOnly}
                onChange={(e) => { setOffset(0); setCaseWindowOnly(e.target.checked); }}
                className="accent-[#ffd000]"
              />
              <span>เฉพาะช่วงวันก่อเหตุ 7 วัน (±3 วัน)</span>
            </label>
            <button
              onClick={() => {
                setOffset(0);
                setSearch("");
                setDebouncedSearch("");
                setPlatform("");
                setEventType("");
                setCountry("");
                setNetwork("");
                setRequestStatus("");
                setDateFrom("");
                setDateTo("");
                setReportedFrom("");
                setReportedTo("");
                setScammerOnly(false);
                setCaseWindowOnly(false);
                setColFilters(EMPTY_COL_FILTERS);
              }}
              className="ml-auto px-3 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-xs text-blue-100"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          </div>
        </section>

        {/* ==================== MODE SWITCHER TABS ==================== */}
        <section className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex flex-wrap rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-1 gap-1">
            <button
              type="button"
              onClick={() => setActiveView("dashboard")}
              className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1.5 transition ${
                activeView === "dashboard"
                  ? "bg-[#ffd000] text-[#05112b] shadow"
                  : "text-blue-200 hover:bg-[#10285e]"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" /> แดชบอร์ด & IP Events
            </button>
            <button
              type="button"
              onClick={() => setActiveView("analytics")}
              className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1.5 transition ${
                activeView === "analytics"
                  ? "bg-[#ffd000] text-[#05112b] shadow"
                  : "text-blue-200 hover:bg-[#10285e]"
              }`}
            >
              <BarChart3 className="w-4 h-4" /> สถิติประเทศ & ISP (Top 10)
            </button>
            <button
              type="button"
              onClick={() => setActiveView("excel")}
              className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1.5 transition ${
                activeView === "excel"
                  ? "bg-[#ffd000] text-[#05112b] shadow"
                  : "text-blue-200 hover:bg-[#10285e]"
              }`}
            >
              <Table2 className="w-4 h-4" /> จัดการข้อมูลแบบ Excel
            </button>
            <button
              type="button"
              onClick={() => setActiveView("scammers")}
              className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1.5 transition ${
                activeView === "scammers"
                  ? "bg-[#ffd000] text-[#05112b] shadow"
                  : "text-blue-200 hover:bg-[#10285e]"
              }`}
            >
              <ShieldAlert className="w-4 h-4" /> เคส Scammers
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-blue-200">แสดงต่อหน้า:</span>
            <select
              value={limit}
              onChange={(e) => { setOffset(0); setLimit(Number(e.target.value)); }}
              className="rounded-lg bg-[#0a1d45] border border-[#1d3a78] px-2.5 py-1.5 text-white"
            >
              <option value={25}>25 แถว</option>
              <option value={50}>50 แถว</option>
              <option value={100}>100 แถว</option>
              <option value={200}>200 แถว</option>
            </select>
          </div>
        </section>

        {/* ==================== DASHBOARD ANALYTICS (KPI + COVERAGE + 3 CHARTS) ==================== */}
        {activeView === "dashboard" && (
          <>
            {/* Row 1: 5 KPI Cards */}
            <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="col-span-2 sm:col-span-1 rounded-xl bg-[#0a1d45] border border-[#1d3a78] border-b-2 border-b-[#ffd000] p-4">
                <p className="text-xs text-blue-200">เหตุการณ์ที่ตรงเงื่อนไข</p>
                <p className="text-2xl font-bold text-white mt-1">{fmt(kpi?.total_events)}</p>
                <p className="text-[11px] text-[#ffd000] mt-1">เคส Scammer: {fmt(kpi?.scammer_events)}</p>
              </div>
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-4">
                <p className="text-xs text-blue-200">บัญชีที่เกี่ยวข้อง</p>
                <p className="text-2xl font-bold text-white mt-1">{fmt(kpi?.unique_accounts)}</p>
                <p className="text-[11px] text-blue-300/80 mt-1">บัญชีไม่ซ้ำ</p>
              </div>
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-4">
                <p className="text-xs text-blue-200">IP ไม่ซ้ำทั้งหมด</p>
                <p className="text-2xl font-bold text-sky-300 mt-1">{fmt(kpi?.unique_ips)}</p>
                <p className="text-[11px] text-blue-300/80 mt-1">IPv4 & IPv6 ภายใต้ตัวกรอง</p>
              </div>
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-4">
                <p className="text-xs text-blue-200">ขอข้อมูลแล้ว</p>
                <p className="text-2xl font-bold text-[#ffd000] mt-1">{fmt(kpi?.requested_count)}</p>
                <p className="text-[11px] text-blue-300/80 mt-1">
                  {accCov.pct}% ของ {fmt(accCov.total)} บัญชี+วันรับแจ้ง
                </p>
              </div>
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] border-b-2 border-b-rose-500 p-4">
                <p className="text-xs text-blue-200">ขอข้อมูลไม่ได้</p>
                <p className="text-2xl font-bold text-rose-400 mt-1">{fmt(kpi?.unavailable_count)}</p>
                <p className="text-[11px] text-blue-300/80 mt-1">
                  {((Number(kpi?.unavailable_count || 0) / totalEventsNum) * 100).toFixed(1)}% ของรายการทั้งหมด
                </p>
              </div>
            </section>

            {/* Row 2: 2 REQUEST COVERAGE Cards (matching screenshot) */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Account Coverage */}
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">REQUEST COVERAGE</p>
                    <h2 className="text-sm font-bold text-white">สรุปตามบัญชี Account</h2>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-blue-300">ทั้งหมด</p>
                    <p className="text-xl font-bold text-white">{fmt(accCov.total)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-lg bg-[#05112b] border border-[#1d3a78] p-3">
                    <p className="text-[11px] text-blue-200">ขอข้อมูลแล้ว</p>
                    <p className="text-lg font-bold text-emerald-400 mt-0.5">{fmt(accCov.requested)}</p>
                  </div>
                  <div className="rounded-lg bg-[#05112b] border border-[#1d3a78] p-3">
                    <p className="text-[11px] text-blue-200">ยังไม่ขอข้อมูล</p>
                    <p className="text-lg font-bold text-[#ffd000] mt-0.5">{fmt(accCov.pending)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-blue-300">
                  <span>Account + วันที่รับแจ้ง</span>
                  <span className="font-mono font-bold text-[#ffd000]">{accCov.pct}%</span>
                </div>
              </div>

              {/* TPO Coverage */}
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">REQUEST COVERAGE</p>
                    <h2 className="text-sm font-bold text-white">สรุปตามเคส TPO</h2>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-blue-300">ทั้งหมด</p>
                    <p className="text-xl font-bold text-white">{fmt(tpoCov.total)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-lg bg-[#05112b] border border-[#1d3a78] p-3">
                    <p className="text-[11px] text-blue-200">ขอข้อมูลแล้ว</p>
                    <p className="text-lg font-bold text-emerald-400 mt-0.5">{fmt(tpoCov.requested)}</p>
                  </div>
                  <div className="rounded-lg bg-[#05112b] border border-[#1d3a78] p-3">
                    <p className="text-[11px] text-blue-200">ยังไม่ขอข้อมูล</p>
                    <p className="text-lg font-bold text-[#ffd000] mt-0.5">{fmt(tpoCov.pending)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-blue-300">
                  <span>รหัส TPO ไม่ซ้ำ</span>
                  <span className="font-mono font-bold text-[#ffd000]">{tpoCov.pct}%</span>
                </div>
              </div>
            </section>

            {/* Row 3: 3 Visual Cards (Network Distribution, Country Donut, Request Tracking) */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* 1. Network Distribution */}
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">NETWORK DISTRIBUTION</p>
                    <h2 className="text-sm font-bold text-white">เครือข่ายที่พบมากที่สุด</h2>
                  </div>
                  <span className="text-xs text-blue-300">{fmt(trSum.total_networks)} เครือข่าย</span>
                </div>
                <div className="space-y-2.5">
                  {(data?.top_networks || []).map((n) => (
                    <div key={n.label} className="flex items-center gap-2 text-xs">
                      <span className="w-28 sm:w-32 truncate text-blue-100" title={n.label}>{n.label}</span>
                      <div className="flex-1 h-2 bg-[#05112b] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#3b82f6] to-[#ffd000] rounded-full"
                          style={{ width: `${Math.max(3, (Number(n.value) / maxNet) * 100)}%` }}
                        />
                      </div>
                      <span className="w-14 text-right font-mono text-white">{fmt(n.value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 2. Country Signal (SVG Donut Chart) */}
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">COUNTRY SIGNAL</p>
                    <h2 className="text-sm font-bold text-white">ประเทศที่จดทะเบียนเครือข่าย</h2>
                  </div>
                  <span className="text-xs text-blue-300 font-mono">RDAP</span>
                </div>
                <CountryDonutChart
                  countries={data?.top_countries || []}
                  total={Number(kpi?.total_events || 0)}
                />
              </div>

              {/* 3. Request Tracking (5 Progress Bars) */}
              <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">REQUEST TRACKING</p>
                    <h2 className="text-sm font-bold text-white">ติดตามหนังสือขอข้อมูล</h2>
                  </div>
                  <span className="text-xs text-[#ffd000] font-mono">{fmt(trSum.distinct_letters)} เลขหนังสือ</span>
                </div>
                <div className="space-y-2.5 text-xs">
                  {[
                    { label: "ไฟล์ไม่มีข้อมูล IP", val: trSum.no_ip_data_count, denom: totalEventsNum, color: "bg-slate-400" },
                    { label: "ขอข้อมูลไม่ได้", val: trSum.unavailable_count, denom: totalEventsNum, color: "bg-rose-400" },
                    { label: "ขอข้อมูลแล้ว (บัญชี+วันรับแจ้ง)", val: accCov.requested, denom: Math.max(1, accCov.total), color: "bg-[#ffd000]" },
                    { label: "ตอบกลับแล้ว", val: trSum.replied_count, denom: totalEventsNum, color: "bg-sky-400" },
                    { label: "ได้รับข้อมูลแล้ว", val: trSum.received_count, denom: totalEventsNum, color: "bg-emerald-400" },
                  ].map((item) => {
                    const pct = Math.min(100, (item.val / item.denom) * 100);
                    return (
                      <div key={item.label} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-blue-100">{item.label}</span>
                          <span className="font-mono text-blue-200">
                            {fmt(item.val)} / {fmt(item.denom)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-[#05112b] rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${item.color}`} style={{ width: `${Math.max(item.val > 0 ? 2 : 0, pct)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </>
        )}

        {/* ==================== DATA SECTION: 4 VIEWS ==================== */}
        {activeView === "analytics" ? (
          <CountryIspStatsView filterQuery={buildFilterQuery().toString()} />
        ) : activeView === "scammers" ? (
          <ScammerCasesSheet />
        ) : activeView === "excel" ? (
          <ExcelManagerView
            records={data?.records || []}
            isAdmin={user.role === "master_admin"}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
            colFilters={colFilters}
            onColFilterChange={handleColFilterChange}
            onSaved={() => fetchEvents(true)}
            onExportCsv={handleExportCsv}
            onExportExcel={handleExportExcel}
          />
        ) : (
          <section className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1d3a78] flex flex-wrap items-center justify-between gap-2 bg-[#071638]">
              <div>
                <p className="text-[10px] tracking-widest text-[#ffd000] font-bold">SOCIAL MEDIA IP EVENTS</p>
                <h2 className="text-sm font-bold text-white">
                  รายการเหตุการณ์ IP ({fmt(data?.pagination.total)} รายการ)
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveView("excel")}
                  className="px-3 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#ffd000]/40 text-[#ffd000] text-xs font-semibold flex items-center gap-1.5"
                >
                  <Table2 className="w-3.5 h-3.5" /> เปิดโหมด Excel
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> ส่งออก Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="px-3 py-1.5 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] text-xs font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> ส่งออก CSV (3 ชุด)
                </button>
              </div>
            </div>

            {/* Mobile Card List (< md) */}
            <div className="md:hidden divide-y divide-[#1d3a78]/70">
              {(data?.records || []).map((row) => {
                const st = statusBadge(row);
                return (
                  <div key={row.record_key} className="p-3.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="px-2 py-0.5 rounded bg-[#133273] text-[#ffd000] font-semibold shrink-0">
                          {row.platform}
                        </span>
                        {row.scammer_case && (
                          <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/40 shrink-0">
                            {row.scammer_case}
                          </span>
                        )}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] shrink-0 ${st.cls}`}>{st.label}</span>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-semibold text-white text-sm truncate" title={row.account}>{row.account}</div>
                      <div className="text-[11px] text-blue-300 shrink-0">{row.event_type}</div>
                    </div>

                    <div className="bg-[#05112b] rounded-lg p-2.5 border border-[#1d3a78]/80 space-y-1">
                      <div className="flex items-center justify-between gap-2 font-mono">
                        <span className="text-[#ffd000] font-semibold break-all">{row.ip || "—"}</span>
                        {row.port ? <span className="text-[11px] text-blue-300 shrink-0">Port {row.port}</span> : null}
                      </div>
                      <div className="text-blue-100 truncate">{row.network || "ไม่ระบุเครือข่าย"} · {row.country || "—"}</div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-blue-300">
                      <span className="font-mono">{formatDateTimeDMY(row.local_time)}</span>
                      <span>
                        {row.inst_id ? `INST: ${row.inst_id}` : ""}
                        {row.tpo_code ? ` · ${row.tpo_code}` : ""}
                        {row.letter_number ? ` · หนังสือ: ${row.letter_number}` : ""}
                      </span>
                    </div>

                    {user.role === "master_admin" && (
                      <div className="pt-1">
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
                          className="w-full py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] border border-[#244894] text-[#ffd000] flex items-center justify-center gap-1.5 font-semibold"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> แก้ไขสถานะหนังสือ
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (>= md) with FROZEN เวลา UTC+7, IP, Port + Excel-style Column Filter Popovers */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
                <thead className="bg-[#05112b] text-blue-200 border-b border-[#1d3a78]">
                  <tr>
                    <th className="sticky left-0 z-20 bg-[#05112b] px-3 py-3 border-r border-[#1a346e] min-w-[156px] w-[156px]">
                      <div className="inline-flex items-center gap-1">
                        <span className="cursor-pointer hover:text-[#ffd000] inline-flex items-center gap-1" onClick={() => handleSort("local_time")}>
                          เวลา UTC+7 <ArrowUpDown className="w-3 h-3" />{sortIndicator("local_time")}
                        </span>
                        <ColumnFilterPopover columnKey="local_date" title="วันที่ (UTC+7)" options={tableOpts.local_date} selected={colFilters.local_date} onApply={(v) => handleColFilterChange("local_date", v)} />
                      </div>
                    </th>
                    <th className="sticky left-[156px] z-20 bg-[#05112b] px-3 py-3 border-r border-[#1a346e] min-w-[148px] w-[148px]">
                      <div className="inline-flex items-center gap-1">
                        <span className="text-[#ffd000]">IP</span>
                        <ColumnFilterPopover columnKey="ip" title="IP" options={tableOpts.ip} selected={colFilters.ip} onApply={(v) => handleColFilterChange("ip", v)} />
                      </div>
                    </th>
                    <th className="sticky left-[304px] z-20 bg-[#05112b] px-2.5 py-3 border-r-2 border-r-[#ffd000]/60 min-w-[68px] w-[68px] text-center text-[#ffd000]">
                      Port
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span className="cursor-pointer hover:text-[#ffd000]" onClick={() => handleSort("platform")}>แพลตฟอร์ม{sortIndicator("platform")}</span>
                        <ColumnFilterPopover columnKey="platform" title="แพลตฟอร์ม" options={["TikTok", "Facebook", "Instagram"]} selected={colFilters.platform} onApply={(v) => handleColFilterChange("platform", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span className="cursor-pointer hover:text-[#ffd000]" onClick={() => handleSort("it_no")}>IT No.{sortIndicator("it_no")}</span>
                        <ColumnFilterPopover columnKey="it_no" title="IT No." options={tableOpts.it_no} selected={colFilters.it_no} onApply={(v) => handleColFilterChange("it_no", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span className="cursor-pointer hover:text-[#ffd000]" onClick={() => handleSort("target_id")}>Target ID{sortIndicator("target_id")}</span>
                        <ColumnFilterPopover columnKey="target_id" title="Target ID" options={tableOpts.target_id} selected={colFilters.target_id} onApply={(v) => handleColFilterChange("target_id", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span className="cursor-pointer hover:text-[#ffd000]" onClick={() => handleSort("inst_id")}>INST ID{sortIndicator("inst_id")}</span>
                        <ColumnFilterPopover columnKey="inst_id" title="INST ID" options={tableOpts.inst_id} selected={colFilters.inst_id} onApply={(v) => handleColFilterChange("inst_id", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span className="cursor-pointer hover:text-[#ffd000]" onClick={() => handleSort("tpo_code")}>TPO code{sortIndicator("tpo_code")}</span>
                        <ColumnFilterPopover columnKey="tpo_code" title="TPO code" options={tableOpts.tpo_code} selected={colFilters.tpo_code} onApply={(v) => handleColFilterChange("tpo_code", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span>เคส Scammer</span>
                        <ColumnFilterPopover columnKey="scammer_case" title="เคส Scammer" options={["Scammer", "(ว่าง)"]} selected={colFilters.scammer_case} onApply={(v) => handleColFilterChange("scammer_case", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span>วันที่รับแจ้ง</span>
                        <ColumnFilterPopover columnKey="reported_date" title="วันที่รับแจ้ง" options={tableOpts.reported_date} selected={colFilters.reported_date} onApply={(v) => handleColFilterChange("reported_date", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span>ทีม</span>
                        <ColumnFilterPopover columnKey="team" title="ทีม" options={tableOpts.team} selected={colFilters.team} onApply={(v) => handleColFilterChange("team", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span className="cursor-pointer hover:text-[#ffd000]" onClick={() => handleSort("account")}>บัญชี / ประเภท{sortIndicator("account")}</span>
                        <ColumnFilterPopover columnKey="account" title="บัญชี" options={tableOpts.account} selected={colFilters.account} onApply={(v) => handleColFilterChange("account", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span>ประเภทบัญชี Meta</span>
                        <ColumnFilterPopover columnKey="meta_type" title="ประเภทบัญชี Meta" options={tableOpts.meta_type} selected={colFilters.meta_type} onApply={(v) => handleColFilterChange("meta_type", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span>เครือข่าย / ประเทศ</span>
                        <ColumnFilterPopover columnKey="network" title="เครือข่าย" options={tableOpts.network} selected={colFilters.network} onApply={(v) => handleColFilterChange("network", v)} />
                        <ColumnFilterPopover columnKey="country" title="ประเทศ" options={tableOpts.country} selected={colFilters.country} onApply={(v) => handleColFilterChange("country", v)} />
                      </div>
                    </th>
                    <th className="px-2 py-3 text-center text-slate-300">ไม่มีข้อมูล IP</th>
                    <th className="px-2 py-3 text-center text-rose-300">ขอข้อมูลไม่ได้</th>
                    <th className="px-2 py-3 text-center text-[#ffd000]">ขอข้อมูลแล้ว</th>
                    <th className="px-2 py-3 text-center text-sky-300">ตอบกลับแล้ว</th>
                    <th className="px-2 py-3 text-center text-emerald-300">ได้รับข้อมูลแล้ว</th>
                    <th className="px-2 py-3 text-center text-teal-300">ไม่ต้องขอข้อมูล IP</th>
                    <th className="px-3 py-3">สถานะ</th>
                    <th className="px-3 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span>เลขหนังสือ</span>
                        <ColumnFilterPopover columnKey="letter" title="เลขหนังสือ" options={tableOpts.letter} selected={colFilters.letter} onApply={(v) => handleColFilterChange("letter", v)} />
                      </div>
                    </th>
                    <th className="px-3 py-3">ผลลัพธ์</th>
                    {user.role === "master_admin" && <th className="px-3 py-3">จัดการ</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#163066]">
                  {(data?.records || []).map((row, idx) => {
                    const st = statusBadge(row);
                    const stickyBg = idx % 2 === 0 ? "bg-[#0a1d45]" : "bg-[#081738]";
                    return (
                      <tr key={row.record_key} className={`${stickyBg} hover:bg-[#10285e]/70`}>
                        <td className={`sticky left-0 z-10 ${stickyBg} px-3 py-2.5 border-r border-[#163066] font-mono text-blue-100 min-w-[156px] w-[156px]`}>
                          {formatDateTimeDMY(row.local_time)}
                        </td>
                        <td className={`sticky left-[156px] z-10 ${stickyBg} px-3 py-2.5 border-r border-[#163066] font-mono text-[#ffd000] font-semibold min-w-[148px] w-[148px] max-w-[148px] truncate`} title={row.ip || ""}>
                          {row.ip || "—"}
                        </td>
                        <td className={`sticky left-[304px] z-10 ${stickyBg} px-2.5 py-2.5 border-r-2 border-r-[#ffd000]/60 font-mono text-blue-200 text-center min-w-[68px] w-[68px]`}>
                          {row.port ?? "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded bg-[#133273] text-[#ffd000] font-semibold">
                            {row.platform}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-200">{row.it_no || "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-300">{row.target_id || "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-200">{row.inst_id || "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-200">{row.tpo_code || "—"}</td>
                        <td className="px-3 py-2.5">
                          {row.scammer_case ? (
                            <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/40">
                              {row.scammer_case}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-blue-200">{formatDateDMY(row.reported_date)}</td>
                        <td className="px-3 py-2.5 text-blue-200">{row.team || "—"}</td>
                        <td className="px-3 py-2.5 max-w-[230px] truncate" title={row.account}>
                          <div className="text-white font-medium truncate">{row.account}</div>
                          <div className="text-[11px] text-blue-300">{row.event_type}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          {row.meta_account_type ? (
                            <span className="px-2 py-0.5 rounded bg-[#0f2454] border border-[#244894] text-blue-100">
                              {row.meta_account_type}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 max-w-[210px] truncate" title={row.network}>
                          <div className="text-slate-100 truncate">{row.network || "—"}</div>
                          <div className="text-[11px] text-blue-300">{row.country || "—"}</div>
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <input
                            type="checkbox"
                            disabled
                            checked={Boolean(row.no_ip_data)}
                            className="accent-slate-400 w-3.5 h-3.5"
                          />
                        </td>
                        {(["unavailable", "requested", "replied", "received", "no_ip_request_needed"] as const).map((field) => (
                          <td key={field} className="px-2 py-2.5 text-center">
                            <input
                              type="checkbox"
                              disabled={user.role !== "master_admin"}
                              checked={Boolean(row[field])}
                              onChange={(e) => handleQuickToggleCheckbox(row, field, e.target.checked)}
                              className="accent-[#ffd000] w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-blue-100">{row.letter_number || "—"}</td>
                        <td className="px-3 py-2.5 max-w-[200px] truncate text-blue-100" title={row.result || ""}>
                          {row.result || "—"}
                        </td>
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
                              className="p-1.5 rounded bg-[#0f2454] hover:bg-[#163475] text-[#ffd000]"
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
          </section>
        )}

        {/* Shared Pagination Footer */}
        <div className="rounded-xl bg-[#0a1d45] border border-[#1d3a78] px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs text-blue-200">
          <span>หน้า {fmt(currentPage)} / {fmt(totalPages)} (ทั้งหมด {fmt(data?.pagination.total)} รายการ)</span>
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              className="flex-1 sm:flex-none px-4 py-2 sm:py-1.5 rounded-lg bg-[#05112b] border border-[#1d3a78] hover:border-[#ffd000] disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <button
              disabled={currentPage >= totalPages || loading}
              onClick={() => setOffset(offset + limit)}
              className="flex-1 sm:flex-none px-4 py-2 sm:py-1.5 rounded-lg bg-[#05112b] border border-[#1d3a78] hover:border-[#ffd000] disabled:opacity-40"
            >
              ถัดไป
            </button>
          </div>
        </div>
      </main>

      {/* ==================== EDIT MODAL ==================== */}
      {editing && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <form onSubmit={saveEdit} className="w-full max-w-lg rounded-2xl bg-[#0a1d45] border border-[#ffd000]/50 p-4 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">แก้ไขสถานะหนังสือ · <span className="text-[#ffd000]">{editing.ip}</span></h3>
              <button type="button" onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(["unavailable", "requested", "replied", "received"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 bg-[#05112b] p-2.5 rounded-lg border border-[#1d3a78]">
                  <input
                    type="checkbox"
                    checked={editForm[k]}
                    onChange={(e) => setEditForm({ ...editForm, [k]: e.target.checked })}
                    className="accent-[#ffd000]"
                  />
                  <span>{k === "unavailable" ? "ขอข้อมูลไม่ได้" : k === "requested" ? "ขอข้อมูลแล้ว" : k === "replied" ? "ตอบกลับแล้ว" : "ได้รับข้อมูลแล้ว"}</span>
                </label>
              ))}
            </div>
            <label className="block text-sm">
              <span className="text-blue-200">เลขหนังสือ</span>
              <input
                type="text"
                value={editForm.letter_number}
                onChange={(e) => setEditForm({ ...editForm, letter_number: e.target.value })}
                className="mt-1 w-full rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm">
              <span className="text-blue-200">ผลลัพธ์ / หมายเหตุ</span>
              <textarea
                rows={3}
                value={editForm.result}
                onChange={(e) => setEditForm({ ...editForm, result: e.target.value })}
                className="mt-1 w-full rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2 text-white"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-[#0f2454]">ยกเลิก</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#ffd000] text-[#05112b] font-bold">บันทึก</button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== UPLOAD ZIP MODAL (DRAG & DROP MULTI-FILE + LIVE PROGRESS) ==================== */}
      <ZipUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onComplete={() => fetchEvents(true)}
      />

      {/* ==================== CASES EXCEL MODAL ==================== */}
      {casesOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCasesUpload} className="w-full max-w-md rounded-2xl bg-[#0a1d45] border border-[#ffd000]/50 p-4 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">นำเข้าไฟล์ Scammer Excel</h3>
              <button type="button" onClick={() => setCasesOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-blue-200">เลือกไฟล์ `url_cases_(Scammer).xlsx` เพื่ออัปเดตเคส INST ID / TPO code และจับคู่กับบัญชีในฐานข้อมูล</p>
            <input type="file" name="file" accept=".xlsx" required className="w-full text-sm text-blue-100" />
            {casesMsg && <p className="text-xs text-[#ffd000]">{casesMsg}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCasesOpen(false)} className="px-4 py-2 rounded-lg bg-[#0f2454]">ปิด</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#ffd000] text-[#05112b] font-bold">นำเข้า Excel</button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== REPORT 17-SLIDE MODAL ==================== */}
      {reportOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-2xl rounded-2xl bg-[#0a1d45] border border-[#ffd000]/50 p-4 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] tracking-widest text-[#ffd000] font-bold">EXECUTIVE REPORT GENERATOR</p>
                <h3 className="font-bold text-white text-base">สร้างรายงานนำเสนอ PowerPoint (17 สไลด์)</h3>
              </div>
              <button type="button" onClick={() => setReportOpen(false)}><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleCreateReport} className="space-y-3 bg-[#05112b] p-4 rounded-xl border border-[#1d3a78]">
              <label className="block text-sm">
                <span className="text-blue-200">ชื่อรายงาน</span>
                <input
                  type="text"
                  required
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-[#0a1d45] border border-[#1d3a78] px-3 py-2 text-white"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={reportBusy}
                  className="px-4 py-2 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold text-sm disabled:opacity-50"
                >
                  {reportBusy ? "กำลังสร้าง..." : "สร้างสแนปช็อตรายงานใหม่"}
                </button>
                {activeReportId && (
                  <a
                    href={`/api/reports/${activeReportId}/pptx`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#05112b] font-bold text-sm inline-flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" /> ดาวน์โหลด PPTX (17 สไลด์)
                  </a>
                )}
              </div>
              {reportMsg && <p className="text-xs text-[#ffd000]">{reportMsg}</p>}
            </form>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-blue-300 uppercase tracking-wider">ประวัติรายงานล่าสุด</h4>
              <div className="divide-y divide-[#1d3a78] rounded-xl border border-[#1d3a78] overflow-hidden text-xs">
                {reportHistory.length === 0 ? (
                  <p className="p-3 text-blue-300">ยังไม่มีประวัติรายงาน</p>
                ) : (
                  reportHistory.map((r) => (
                    <div key={r.id} className="p-3 bg-[#05112b] flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">{r.report_name}</div>
                        <div className="text-blue-300 text-[11px]">{r.generated_by} · {r.generated_at}</div>
                      </div>
                      <a
                        href={`/api/reports/${r.id}/pptx`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-[#0f2454] hover:bg-[#163475] text-[#ffd000] font-semibold shrink-0 inline-flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> PPTX
                      </a>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== USER MANAGEMENT MODAL ==================== */}
      {usersOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-3xl rounded-2xl bg-[#0a1d45] border border-[#ffd000]/50 p-4 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] tracking-widest text-[#ffd000] font-bold">USER MANAGEMENT</p>
                <h3 className="font-bold text-white text-base">จัดการผู้ใช้งาน (Master Admin / Viewer)</h3>
              </div>
              <button type="button" onClick={() => setUsersOpen(false)}><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-5 gap-2 bg-[#05112b] p-3.5 rounded-xl border border-[#1d3a78] text-xs">
              <input
                type="text"
                required
                placeholder="Username"
                value={newUserForm.username}
                onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                className="rounded-lg bg-[#0a1d45] border border-[#1d3a78] px-2.5 py-2 text-white"
              />
              <input
                type="text"
                required
                placeholder="ชื่อแสดงผล"
                value={newUserForm.display_name}
                onChange={(e) => setNewUserForm({ ...newUserForm, display_name: e.target.value })}
                className="rounded-lg bg-[#0a1d45] border border-[#1d3a78] px-2.5 py-2 text-white"
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder="รหัสผ่าน (6+ ตัว)"
                value={newUserForm.password}
                onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                className="rounded-lg bg-[#0a1d45] border border-[#1d3a78] px-2.5 py-2 text-white"
              />
              <select
                value={newUserForm.role}
                onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                className="rounded-lg bg-[#0a1d45] border border-[#1d3a78] px-2.5 py-2 text-white"
              >
                <option value="viewer">Viewer (ดูอย่างเดียว)</option>
                <option value="master_admin">Master Admin</option>
              </select>
              <button type="submit" className="rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold py-2">
                + เพิ่มผู้ใช้
              </button>
            </form>

            {userMsg && <p className="text-xs text-[#ffd000]">{userMsg}</p>}

            <div className="rounded-xl border border-[#1d3a78] overflow-x-auto text-xs">
              <table className="w-full text-left whitespace-nowrap">
                <thead className="bg-[#05112b] text-blue-200 border-b border-[#1d3a78]">
                  <tr>
                    <th className="px-3 py-2.5">Username</th>
                    <th className="px-3 py-2.5">ชื่อแสดงผล</th>
                    <th className="px-3 py-2.5">สิทธิ์</th>
                    <th className="px-3 py-2.5">สถานะ</th>
                    <th className="px-3 py-2.5">ล็อกอินล่าสุด</th>
                    <th className="px-3 py-2.5">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1d3a78]/60">
                  {usersList.map((u) => (
                    <tr key={u.username}>
                      <td className="px-3 py-2 font-mono text-white">{u.username}</td>
                      <td className="px-3 py-2 text-blue-100">{u.display_name}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded ${u.role === "master_admin" ? "bg-[#ffd000]/20 text-[#ffd000]" : "bg-[#133273] text-blue-200"}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {u.active ? (u.approved ? "อนุมัติแล้ว" : "รออนุมัติ") : "ระงับใช้งาน"}
                      </td>
                      <td className="px-3 py-2 font-mono text-blue-300">{u.last_login_at || "—"}</td>
                      <td className="px-3 py-2 flex flex-wrap gap-1.5">
                        {!u.approved && (
                          <button
                            onClick={() => handleUpdateUser(u.username, { approved: true, active: true })}
                            className="px-2 py-1 rounded bg-emerald-900/70 text-emerald-200"
                          >
                            อนุมัติ
                          </button>
                        )}
                        <button
                          onClick={() => handleUpdateUser(u.username, { active: !u.active })}
                          className="px-2 py-1 rounded bg-[#0f2454] text-blue-100"
                        >
                          {u.active ? "ระงับ" : "เปิดใช้"}
                        </button>
                        <button
                          onClick={() => {
                            const nextPw = window.prompt(`ตั้งรหัสผ่านใหม่สำหรับ ${u.username} (อย่างน้อย 6 ตัวอักษร):`);
                            if (nextPw && nextPw.length >= 6) handleUpdateUser(u.username, { password: nextPw });
                          }}
                          className="px-2 py-1 rounded bg-[#ffd000]/20 text-[#ffd000]"
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

      {/* ==================== ACCOUNT COMPLETION MODAL ==================== */}
      {completeOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCompleteAccount} className="w-full max-w-lg rounded-2xl bg-[#0a1d45] border border-[#ffd000]/50 p-4 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] tracking-widest text-[#ffd000] font-bold">ACCOUNT COMPLETION</p>
                <h3 className="font-bold text-white text-base">ปิดงานบัญชี (ไม่ต้องขอ IP เพิ่มทั้งชุด)</h3>
              </div>
              <button type="button" onClick={() => setCompleteOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-blue-200">
              ระบบจะเปลี่ยนสถานะ IP ที่ยังไม่เคยดำเนินการของบัญชีที่เลือกให้เป็น &quot;ไม่ต้องขอ IP&quot; ทั้งชุด โดยไม่กระทบรายการที่ขอหนังสือหรือได้รับข้อมูลแล้ว
            </p>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-blue-200 text-xs">แพลตฟอร์ม</span>
                <select
                  value={completePlatform}
                  onChange={(e) => loadCompleteAccounts(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2 text-white"
                >
                  <option value="TikTok">TikTok</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Instagram">Instagram</option>
                </select>
              </label>
              <label className="block">
                <span className="text-blue-200 text-xs">เลือกบัญชี ({completeAccounts.length} บัญชี)</span>
                <select
                  required
                  value={completeAccountId}
                  onChange={(e) => setCompleteAccountId(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2 text-white"
                >
                  <option value="">-- เลือกบัญชี --</option>
                  {completeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_name} {a.is_completed ? "(ปิดงานแล้ว)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-blue-200 text-xs">เหตุผลการปิดงาน</span>
                <input
                  type="text"
                  value={completeReason}
                  onChange={(e) => setCompleteReason(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-[#05112b] border border-[#1d3a78] px-3 py-2 text-white"
                />
              </label>
            </div>
            {completeMsg && <p className="text-xs text-[#ffd000]">{completeMsg}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCompleteOpen(false)} className="px-4 py-2 rounded-lg bg-[#0f2454]">ปิด</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#ffd000] hover:bg-[#eab308] text-[#05112b] font-bold">
                ยืนยันปิดงานบัญชี
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
