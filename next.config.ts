import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mysql2", "pdf-parse", "unpdf", "jszip", "exceljs", "pptxgenjs"],
  outputFileTracingIncludes: {
    "/api/subpoena/generate": ["./src/assets/ISP_Master.docx"],
  },
};

export default nextConfig;
