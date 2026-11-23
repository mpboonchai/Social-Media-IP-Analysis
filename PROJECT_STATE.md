# Social Media IP Analysis V2 - Project State & Architecture Record

> **วัตถุประสงค์ของไฟล์นี้**: บันทึกสถานะโปรเจกต์ โครงสร้างสถาปัตยกรรม ฐานข้อมูล และขั้นตอนสำคัญอย่างกระชับ เพื่อให้อ่านเข้าใจได้ทันทีในการทำงานรอบถัดไป ช่วยประหยัด Context/Tokens ได้มหาศาลโดยไม่ต้องไล่อ่านประวัติเก่าทั้งหมด

---

## 1. ข้อมูลภาพรวม (Overview)
- **Production URL (Vercel)**: `https://social-media-ip-analysis-one.vercel.app`
- **Repo GitHub**: [`mpboonchai/Social-Media-IP-Analysis`](https://github.com/mpboonchai/Social-Media-IP-Analysis) (Branch: `main`)
- **Google Drive Project Folder**: `https://drive.google.com/drive/folders/1wEc9RQ6P8uJklTYse1R-dy20x45QJ-Yb` (Master Workbook: `Social_Media_IP_Analysis.xlsx` — 6 ชีท, 608,636 IP Events, 101,386 Unique IPs, 989 Cases — ยืนยันตรงกับ TiDB Cloud 100%)
- **เทคโนโลยีหลัก**: Next.js 15 (App Router, TypeScript) + Tailwind CSS + MySQL 8.0 / TiDB Cloud Serverless
- **สถานะปัจจุบัน**:
  - **Deploy ขึ้น Production เรียบร้อยแล้ว** (Vercel + TiDB Cloud Serverless 100% Free Tier)
  - **ธีม & แบรนด์ตำรวจสอบสวนกลาง (`ACSC · CIB · TCSD`)**: ธีมสีน้ำเงินเข้ม-เหลืองทอง (`#05112b` / `#ffd000`) โลโก้เรียง **ACSC** (`/logos/acsc-logo.png`) ➔ **TCSD** (`/logos/tcsd-logo.png`)
  - **ครบทั้ง 4 โหมด/แท็บหลัก**:
    1. `แดชบอร์ด & IP Events`: 5 KPI Cards, 2 Request Coverage Cards, 3 Visual Cards (Donut + Tracking), ตารางพร้อมตัวกรองหัวคอลัมน์แบบ Excel ทุกคอลัมน์
    2. `สถิติประเทศ & ISP (Top 10)` (`/api/analytics` + `CountryIspStatsView`): กราฟ 4 แผง (IP Event & Case ID แยกประเทศพร้อมโดนัท Thailand vs Foreign + Top 10 ISP ที่รวมชื่อเครือข่ายเดียวกันเช่น ReadyIDC และแยก AIS Mobile vs AIS Fibre พร้อมแยกรหัส Case ID ที่คั่นด้วย `/`)
    3. `จัดการข้อมูลแบบ Excel` (`ExcelManagerView`): แสดงครบทุกคอลัมน์จากฐานข้อมูลเดิม (รวม UTC, Page Admin, Meta Actor, Owner, From-To IP, Source ZIP/PDF), ตัวกรองหัวคอลัมน์ทุกคอลัมน์, Inline Edit + Bulk Apply, **ส่งออก Excel ที่กรอง (.xlsx)** (`/api/export/excel`) และ **นำเข้า Excel อัปเดตลงฐานข้อมูลอัตโนมัติ** (`/api/events/import-excel`)
    4. `เคส Scammers` (`ScammerCasesSheet` + `/api/cases`): ชีทแยก 989 เคส โครงสร้างตรงกับ `url_cases_(Scammer).xlsx` 100% พร้อมส่งออก `.xlsx`
  - **ระบบอัปโหลด ZIP (META & TikTok แยกชัดเจน)**: แยกแท็บ META / TikTok / Auto, จับคู่ Scammer & RDAP อัตโนมัติ
  - Unit Tests: 6/6 ผ่าน · ข้อมูลเดิม 608,636 รายการ (ครบ 58 คอลัมน์) + 989 เคส บน TiDB Cloud 100%

---

## 2. ข้อมูลสถิติของ Dataset บน TiDB Cloud Serverless (ย้ายข้อมูลเรียบร้อยแล้ว 100%)
- **`ip_events`**: **608,636** รายการ IP ครบถ้วน 100%
- **`cases`**: **989** เคส Scammer / ผู้เสียหาย
- **`rdap_networks`**: **2,977** IP Ranges
- **`report_snapshots`**: **8** สรุปรายงานสืบสวนเดิม
- **`users`**: บัญชี Admin เดิม (`masteradmin` / `TCSD2tpo2026***`)
- **ขนาดบน TiDB Cloud**: ~382 MB (ใช้ไปไม่ถึง 8% ของโควตาฟรี 5 GiB)

---

## 3. โครงสร้างฐานข้อมูล (Database Schema)
ไฟล์นิยามตาราง: `db/schema.sql` (10 ตาราง)
1. `users`: จัดการผู้ใช้ (master_admin / viewer) พร้อมระบบ approved/active/lock
2. `upload_batches`: บันทึกประวัติไฟล์ ZIP ที่อัปโหลด พร้อม SHA-256 hash
3. `social_accounts`: บัญชี TikTok / META พร้อมปุ่มปิดงานบัญชี (`is_completed`)
4. `cases`: ตารางเคส Scammer (`INST ID`, `tpo_code`, `tracking_code`)
5. `rdap_networks`: ช่วง IP, ISP, Network, ประเทศ (เก็บ binary IPv4/IPv6 สำหรับ lookup เร็ว)
6. `ip_events`: บันทึกประวัติการใช้งาน IP (SHA-256 hash, platform, account, timestamp, correlated cases)
7. `ip_event_case_correlations`: ความสัมพันธ์ระหว่าง IP Event กับ Case (M:N)
8. `ip_request_tracking`: สถานะการขอข้อมูล IP จาก ISP/ค่ายเน็ต
9. `report_snapshots`: บันทึกข้อมูลรายงานสรุป (PPTX)
10. `audit_logs`: บันทึกประวัติการทำงานของผู้ใช้

---

## 4. โครงสร้างโค้ดหลัก (Directory Structure)
- `src/app/page.tsx` & `src/components/DashboardClient.tsx`: หน้า Dashboard หลัก ค้นหา กรอง จัดการผู้ใช้ นำเข้า/ส่งออก
- `src/app/api/auth/`: ระบบ Authentication (Login, Logout, Session ด้วย JWT/Cookie)
- `src/app/api/events/`: ดึงรายการ IP Events พร้อม Pagination, Full-text Search, Case Correlation
- `src/app/api/upload/`: รับไฟล์ ZIP (TikTok / META) แตกไฟล์ พาร์ส จับคู่เคส ดึง RDAP อัตโนมัติ และบันทึกลง DB
- `src/app/api/cases/import/`: นำเข้าไฟล์ Excel `url_cases_(Scammer).xlsx`
- `src/app/api/export/csv/`: ส่งออก ZIP ที่บรรจุ CSV 3 ไฟล์ (ตารางรวม, สรุปราย IP, สรุปรายบัญชี)
- `src/app/api/reports/`: สรุปข้อมูลรายงาน และสร้างไฟล์ PPTX 17 สไลด์
- `src/app/api/admin/users/`: จัดการผู้ใช้งาน (สร้าง, อนุมัติ, รีเซ็ตรหัสผ่าน)
- `src/app/api/admin/accounts/complete/`: ปิดงานบัญชี (Account Completion)
- `src/lib/parsers/`: ตัวแปลงไฟล์ TikTok (HTML/JSON) และ META (JSON/HTML)
- `src/lib/rdap/lookup.ts`: ตรวจสอบและดึงข้อมูล RDAP อัตโนมัติ
- `scripts/migrate_to_mysql.ts`: สคริปต์ย้ายข้อมูล 608,636 รายการลง MySQL / TiDB

---

## 5. การตั้งค่า TiDB Cloud Serverless & Vercel
### TiDB Cloud Serverless Connection String
รูปแบบสำหรับใช้งานในโปรเจกต์:
```text
mysql://3QYhubE1cu7gP5C.root:<PASSWORD>@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/social_media_ip?ssl={"rejectUnauthorized":true}
```
*(หมายเหตุ: ต้องแทนที่ `<PASSWORD>` ด้วยรหัสผ่านจริงที่สร้างไว้)*

### ตัวแปรสภาพแวดล้อม (Environment Variables) สำหรับ Production บน Vercel:
- `DATABASE_URL`: Connection string ของ TiDB Cloud ข้างต้น
- `SESSION_SECRET`: ข้อความสุ่ม 32 ตัวอักษรขึ้นไปสำหรับลงชื่อ JWT
- `NODE_ENV`: `production`

---

## 6. งานที่เตรียมไว้ในอนาคต (Future Integration)
- **TPO System (`https://tpo.tcsd2.me/`)**: ผู้ใช้ให้บันทึกไฟล์โครงสร้างและรูปภาพไว้ก่อน (`TPO_System_files.zip`, `image.png`) ยังไม่ต้องนำมาเชื่อมต่อจนกว่าระบบ V2 จะ Deploy เรียบร้อย
