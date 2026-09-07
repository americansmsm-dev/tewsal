"use client";

/**
 * بانر «فعّل إشعارات توصّل».
 *
 * الإذن **لازم** ييجي من ضغطة مستخدم — المتصفح بيرفض أي طلب
 * بيتنادى لوحده وقت التحميل. عشان كده بانر مش نافذة تلقائية.
 *
 *  · بيظهر مرة واحدة بس لو الجهاز ينفع يتفعّل
 *  · اتقفل؟ يفضل مقفول أسبوع — والمستخدم يقدر يفعّله من
 *    صفحة الإشعارات في أي وقت
 *  · بيشتغل بنفس الكود على الفون واللاب والتاب
 */
import { useCallback, useEffect, useState } from "react";
import { pushState, subscribeToPush } from "../lib/push";

const DISMISS_KEY = "tewsal_push_dismissed";
const WEEK = 7 * 86400000;

export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = localStorage.getItem(DISMISS_KEY);
        if (d && Date.now() - Number(d) < WEEK) return;
      } catch { /* localStorage ممكن يكون مقفول */ }

      const state = await pushState();
      if (alive && state === "askable") setShow(true);
    })();
    return () => { alive = false; };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    const ok = await subscribeToPush().catch(() => false);
    setBusy(false);
    if (ok) {
      setMsg("تمام — الإشعارات هتوصلك على الجهاز ده ✅");
      setTimeout(() => setShow(false), 2200);
    } else {
      // رفض الإذن أو المتصفح رفض — مانلحّش عليه
      setMsg("مافيش إذن. تقدر تفعّلها بعدين من صفحة الإشعارات.");
      setTimeout(() => setShow(false), 3200);
    }
  }, []);

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* تجاهل */ }
  }

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed", insetInlineStart: 12, insetInlineEnd: 12, bottom: 84, zIndex: 60,
        background: "var(--surface, #1c1917)", color: "var(--ink, #f5f1ea)",
        border: "1px solid var(--border, #312b26)", borderRadius: 14,
        boxShadow: "0 10px 30px -12px rgba(0,0,0,.5)", padding: "0.85rem 1rem",
        display: "flex", alignItems: "center", gap: 12, maxWidth: 560, margin: "0 auto",
      }}
    >
      <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>🔔</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>فعّل إشعارات توصّل</div>
        <div style={{ fontSize: "0.8rem", color: "var(--muted, #a8a099)", lineHeight: 1.6 }}>
          {msg ?? "يوصلك تنبيه على الجهاز أول ما يحصل أي حاجة — حتى والتطبيق مقفول."}
        </div>
      </div>
      {!msg && (
        <button
          onClick={enable}
          disabled={busy}
          style={{
            background: "var(--color-orange-500, #ea580c)", color: "#fff", border: 0,
            borderRadius: 10, padding: "0.6rem 1.1rem", fontWeight: 800, fontSize: "0.9rem",
            whiteSpace: "nowrap", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "..." : "فعّل"}
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="إغلاق"
        style={{
          background: "transparent", color: "var(--muted, #a8a099)", border: 0,
          fontSize: "1.2rem", cursor: "pointer", padding: "0 0.2rem",
        }}
      >
        ✕
      </button>
    </div>
  );
}
