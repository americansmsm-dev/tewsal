import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Cairo } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "./components/PwaRegister";

// خط Cairo — بيتحمّل محليًا مع البناء (يشتغل أوفلاين في الـ PWA)
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  variable: "--font-cairo",
});

export const metadata: Metadata = {
  title: "توصّل — نظام إدارة الشحنات",
  description: "نظام تشغيل شركة توصّل للشحن",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "توصّل", statusBarStyle: "black-translucent" },
};

export const viewport = { themeColor: "#12100e" };

/**
 * القالب الجذري — عربي RTL من الجذر.
 * dir="rtl" و lang="ar" عشان كل الشاشات RTL أصلي مش متقلوب.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body style={{ fontFamily: "var(--font-cairo), Cairo, system-ui, sans-serif" }}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
