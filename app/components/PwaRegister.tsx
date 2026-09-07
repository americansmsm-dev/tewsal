"use client";

/**
 * يسجّل الـ Service Worker مرة واحدة — عشان القشرة تفتح أوفلاين،
 * وبيسمع رسايل الإشعارات منه.
 *
 * لما إشعار يوصل والتطبيق **مفتوح**، الـSW بيبعت رسالة للصفحة
 * فبنشغّل نغمة توصّل. لما يكون مقفول، نغمة النظام بتشتغل لوحدها.
 */
import { useEffect } from "react";
import { playChime } from "../lib/push";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* مش حرج */ });

    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "tewsal-push") playChime();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
  return null;
}
