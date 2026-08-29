"use client";

/** يسجّل الـ Service Worker مرة واحدة — عشان القشرة تفتح أوفلاين. */
import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* مش حرج */ });
    }
  }, []);
  return null;
}
