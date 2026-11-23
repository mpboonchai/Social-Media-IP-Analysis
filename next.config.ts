import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mysql2", "pdf-parse", "jszip", "exceljs", "pptxgenjs"],
};

export default nextConfig;
