"use client";

/**
 * زرار/شريط تثبيت التطبيق (PWA):
 *  • أندرويد/كروم: زرار «تثبيت التطبيق» حقيقي عبر beforeinstallprompt.
 *  • آيفون/Safari: آبل مابتدعمش تثبيت برمجي — بنعرض شريط إرشادي
 *    (المشاركة ⬆️ ← إضافة إلى الشاشة الرئيسية).
 *  • بيختفي لو التطبيق متثبّت أصلًا (standalone) أو المستخدم قفله.
 */
import { useEffect, useState } from "react";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "tewsal_install_dismissed";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    // متثبّت أصلًا؟ مانعرضش حاجة
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    // اتقفل قبل كده؟ (نفس اليوم)
    try {
      const d = localStorage.getItem(DISMISS_KEY);
      if (d && Date.now() - Number(d) < 3 * 86400000) return; // ٣ أيام
    } catch { /* localStorage ممكن يكون مقفول */ }

    // أندرويد/كروم: بنمسك الحدث ونعرض الزرار
    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    const onInstalled = () => { setHidden(true); setDeferred(null); };
    window.addEventListener("appinstalled", onInstalled);

    // آيفون/آيباد Safari: مفيش حدث — نكشف يدويًا
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    if (isIos && isSafari) { setShowIos(true); setHidden(false); }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* تجاهل */ }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setHidden(true);
    setDeferred(null);
  }

  return (
    <div
      style={{
        position: "fixed", insetInlineStart: 12, insetInlineEnd: 12, bottom: 12, zIndex: 60,
        background: "var(--surface, #1c1917)", color: "var(--ink, #f5f1ea)",
        border: "1px solid var(--border, #312b26)", borderRadius: 14,
        boxShadow: "0 10px 30px -12px rgba(0,0,0,.5)", padding: "0.85rem 1rem",
        display: "flex", alignItems: "center", gap: 12, maxWidth: 560, margin: "0 auto",
      }}
    >
      <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>📲</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>ثبّت تطبيق توصّل على تليفونك</div>
        {deferred ? (
          <div style={{ fontSize: "0.8rem", color: "var(--muted, #a8a099)" }}>
            يفتح أسرع ويشتغل حتى من غير نت.
          </div>
        ) : (
          <div style={{ fontSize: "0.8rem", color: "var(--muted, #a8a099)" }}>
            اضغط زر المشاركة <b>⬆️</b> تحت، ثم اختار <b>«إضافة إلى الشاشة الرئيسية»</b>.
          </div>
        )}
      </div>
      {deferred ? (
        <button
          onClick={install}
          style={{
            background: "var(--color-orange-500, #ea580c)", color: "#fff", border: 0,
            borderRadius: 10, padding: "0.6rem 1.1rem", fontWeight: 800, fontSize: "0.9rem",
            whiteSpace: "nowrap", cursor: "pointer",
          }}
        >
          تثبيت
        </button>
      ) : null}
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
