# Social Media IP Analysis V2

Next.js 15 (TypeScript) + Tailwind CSS + MySQL 8.0 / TiDB Cloud Serverless dashboard for analyzing Social Media IP evidence from **TikTok**, **Facebook**, and **Instagram (META)**, correlated with **Scammer Cases (`INST ID` / `TPO code`)** and **RDAP** network data.

> Legacy reference: `https://tiktok-ip-command-dashboard.mpboonchai-ti.chatgpt.site/`

## Architecture
- **Frontend & API**: Next.js 15 App Router (TypeScript)
- **Database**: MySQL 8.0 / TiDB Cloud Serverless (10 normalized tables, `BINARY(32)` SHA-256 keys, `VARBINARY(16)` IPv4/IPv6 binary indexing)
- **Evidence Storage (Optional)**: Local disk or S3-compatible Object Storage (e.g., Cloudflare R2 Free 10 GB)

## Quick Start (Local Development)
1. Start MySQL 8.0 via Docker:
   ```bash
   docker compose up -d
   ```
2. Copy environment template and install dependencies:
   ```bash
   cp .env.example .env
   npm install
   ```
3. Run tests & start dev server:
   ```bash
   npm run test
   npm run dev
   ```

## Migrating Data to TiDB Cloud Serverless (Production)
1. Create a free Serverless cluster on TiDB Cloud (5 GiB free storage).
2. Run `db/schema.sql` against your TiDB database.
3. Set `DATABASE_URL` in `.env` (with `?ssl={"rejectUnauthorized":true}`) and run:
   ```bash
   npm run db:migrate
   ```
