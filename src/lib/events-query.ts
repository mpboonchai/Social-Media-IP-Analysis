import { ipToBuffer } from "./ip-utils";

export interface EventFilterParams {
  search?: string;
  platform?: string;
  event_type?: string;
  country?: string;
  network?: string;
  request_status?: string;
  date_from?: string;
  date_to?: string;
  scammer_only?: boolean;
  case_window_only?: boolean;
}

export function buildEventWhereClause(filters: EventFilterParams): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.platform === "META") {
    where.push(`e.platform IN ('Facebook', 'Instagram')`);
  } else if (filters.platform) {
    where.push(`e.platform = ?`);
    params.push(filters.platform);
  }
  if (filters.event_type) {
    where.push(`e.event_type = ?`);
    params.push(filters.event_type);
  }
  if (filters.country) {
    where.push(`r.country = ?`);
    params.push(filters.country);
  }
  if (filters.network) {
    where.push(`r.network_name = ?`);
    params.push(filters.network);
  }
  if (filters.date_from) {
    where.push(`e.event_local >= ?`);
    params.push(`${filters.date_from} 00:00:00`);
  }
  if (filters.date_to) {
    where.push(`e.event_local <= ?`);
    params.push(`${filters.date_to} 23:59:59`);
  }
  if (filters.scammer_only) {
    where.push(`e.scammer_case = 'Scammer'`);
  }
  if (filters.case_window_only) {
    where.push(`e.case_window_match = 1`);
  }

  const rs = filters.request_status;
  if (rs === "no_ip_data") where.push(`e.no_ip_data = 1`);
  else if (rs === "unavailable") where.push(`t.unavailable = 1`);
  else if (rs === "requested") where.push(`t.requested = 1`);
  else if (rs === "replied") where.push(`t.replied = 1`);
  else if (rs === "received") where.push(`t.received = 1`);
  else if (rs === "complete") where.push(`t.no_ip_request_needed = 1`);
  else if (rs === "pending") {
    where.push(
      `e.no_ip_data = 0 AND COALESCE(t.unavailable,0)=0 AND COALESCE(t.requested,0)=0 AND COALESCE(t.no_ip_request_needed,0)=0`
    );
  }

  if (filters.search) {
    const ipParsed = ipToBuffer(filters.search);
    if (ipParsed) {
      where.push(`e.ip_bin = ?`);
      params.push(ipParsed.buf);
    } else {
      const like = `%${filters.search}%`;
      where.push(
        `(sa.account_name LIKE ? OR sa.account_identifier LIKE ? OR e.inst_id LIKE ? OR e.tpo_code LIKE ? OR r.network_name LIKE ? OR t.letter_number LIKE ?)`
      );
      params.push(like, like, like, like, like, like);
    }
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return "\ufeff" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
