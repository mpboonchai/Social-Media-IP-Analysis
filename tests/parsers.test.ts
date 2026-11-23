import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMetaZip } from "../src/lib/parsers/meta";
import { parseTikTokZip } from "../src/lib/parsers/tiktok";
import { parseScammerCasesXlsx, isWithinReportedWindow, normalizeSocialUrl } from "../src/lib/matching/scammer-cases";
import { bufferToIp, ipToBuffer, normalizeCountry } from "../src/lib/ip-utils";

describe("IP & Country Utils", () => {
  it("converts IPv4 and IPv6 to binary and back", () => {
    const v4 = ipToBuffer("171.97.104.188");
    expect(v4?.version).toBe(4);
    expect(bufferToIp(v4?.buf)).toBe("171.97.104.188");

    const v6 = ipToBuffer("2001:4860:4860::8888");
    expect(v6?.version).toBe(6);
    expect(bufferToIp(v6?.buf)).toBe("2001:4860:4860::8888");
  });

  it("normalizes country codes and aliases", () => {
    expect(normalizeCountry("TH")).toBe("Thailand");
    expect(normalizeCountry("sgp")).toBe("Singapore");
    expect(normalizeCountry("US")).toBe("United States");
  });
});

describe("Real Sample Files Parsing", () => {
  it("parses all 5 real META ZIP samples", async () => {
    const files = [
      "807386959136748.zip",
      "823807704160745.zip",
      "878097425330160.zip",
      "906967435743405.zip",
      "914782541628320.zip",
    ];
    for (const f of files) {
      const p = `/home/antigravity/${f}`;
      if (!fs.existsSync(p)) continue;
      const rows = await parseMetaZip(fs.readFileSync(p), f);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].platform_group).toBe("META");
      expect(rows[0].record_key).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("parses all 5 real TikTok ZIP samples", async () => {
    const files = [
      "_iphone.1228_part_1.zip",
      "_notebook.2_part_1.zip",
      "06vdvot_part_1.zip",
      "013ohjxx_part_1.zip",
      "amonarat_part_1.zip",
    ];
    for (const f of files) {
      const p = `/home/antigravity/${f}`;
      if (!fs.existsSync(p)) continue;
      const rows = await parseTikTokZip(fs.readFileSync(p), f);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].platform).toBe("TikTok");
      expect(rows[0].record_key).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("parses real url_cases_(Scammer).xlsx (989 cases)", async () => {
    const p = "/home/antigravity/url_cases_(Scammer).xlsx";
    if (!fs.existsSync(p)) return;
    const cases = await parseScammerCasesXlsx(fs.readFileSync(p));
    expect(cases.length).toBe(989);
    expect(cases[0].inst_id).toBeTruthy();
    expect(normalizeSocialUrl("https://www.facebook.com/profile.php?id=61596170133429&mibextid=rS40aB7S9Ucbxw6v"))
      .toBe("facebook.com/profile.php?id=61596170133429");
  });

  it("checks +/- 3 day reported date window accurately", () => {
    const reported = "2026-11-20";
    expect(isWithinReportedWindow(Date.parse("2026-11-17T00:00:00+07:00"), reported)).toBe(true);
    expect(isWithinReportedWindow(Date.parse("2026-11-23T23:59:59+07:00"), reported)).toBe(true);
    expect(isWithinReportedWindow(Date.parse("2026-11-16T23:59:59+07:00"), reported)).toBe(false);
    expect(isWithinReportedWindow(Date.parse("2026-11-24T00:00:00+07:00"), reported)).toBe(false);
  });
});
