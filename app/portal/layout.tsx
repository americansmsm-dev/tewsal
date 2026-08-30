import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * بوابة التاجر لها manifest مستقل عشان تتثبّت كأبليكيشن منفصل
 * يفتح على /portal مباشرة (مش تطبيق المندوب).
 */
export const metadata: Metadata = {
  title: "توصّل — التاجر",
  manifest: "/portal.webmanifest",
  appleWebApp: { capable: true, title: "توصّل تاجر", statusBarStyle: "black-translucent" },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
