import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Social Media IP Analysis · ACSC · CIB · TCSD",
  description: "ระบบวิเคราะห์ข้อมูลบัญชี เหตุการณ์ และเครือข่าย IP จาก TikTok, Facebook และ Instagram — ACSC · CIB · TCSD",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#05112b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
