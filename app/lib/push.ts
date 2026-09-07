"use client";

/**
 * ============================================================
 *  إشعارات الجهاز (Web Push) — جانب المتصفح
 * ------------------------------------------------------------
 *  بيشتغل بنفس الكود على **الفون واللاب والتاب**.
 *
 *  ⚠️ على الآيفون والآيباد لازم «إضافة إلى الشاشة الرئيسية»
 *     الأول — شرط من آبل نفسها، مش نقص فينا. `InstallPrompt`
 *     بيعرض التعليمات دي.
 *
 *  ⚠️ طلب الإذن **لازم** يبقى من ضغطة مستخدم — المتصفح بيرفضه
 *     لو اتنادى لوحده وقت التحميل.
 * ============================================================
 */

export type PushState =
  | "unsupported"   // المتصفح مابيدعمش (أو آيفون من غير تثبيت)
  | "not-configured" // السيرفر لسه مفيهوش مفاتيح VAPID
  | "denied"        // المستخدم رفض — مايتسألش تاني إلا من الإعدادات
  | "granted"       // مفعّل ومشترك
  | "askable";      // ينفع نسأله

/** base64url → Uint8Array (شكل المفتاح اللي المتصفح عايزه) */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

interface KeyResponse { enabled: boolean; publicKey: string }

async function serverKey(): Promise<KeyResponse | null> {
  try {
    const r = await fetch("/api/v1/push/key");
    if (!r.ok) return null;
    return (await r.json()) as KeyResponse;
  } catch {
    return null;
  }
}

/** الحالة الحالية — الشاشة بتقرّر تعرض البانر ولا لأ على أساسها */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const key = await serverKey();
  if (!key?.enabled || !key.publicKey) return "not-configured";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "granted" : "askable";
  }
  return "askable";
}

/**
 * بيطلب الإذن ويسجّل الجهاز. **لازم يتنادى من ضغطة مستخدم.**
 * بيرجّع true لو الجهاز بقى مشترك فعلًا.
 */
export async function subscribeToPush(deviceLabel?: string): Promise<boolean> {
  if (!pushSupported()) return false;
  const key = await serverKey();
  if (!key?.enabled || !key.publicKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;
  // مشترك أصلًا؟ نعيد إرساله للسيرفر (ممكن الصف اتمسح من عندنا)
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true, // شرط المتصفح: كل دفعة لازم تعرض إشعار
      applicationServerKey: urlBase64ToUint8Array(key.publicKey) as BufferSource,
    }));

  const res = await fetch("/api/v1/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...sub.toJSON(), deviceLabel: deviceLabel ?? guessDevice() }),
  });
  return res.ok;
}

/** بيلغي اشتراك الجهاز ده بس — الأجهزة التانية بتفضل شغّالة */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  await fetch("/api/v1/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => null);
  return sub.unsubscribe();
}

/** اسم مبدئي للجهاز عشان المستخدم يفرّق بين أجهزته في الإعدادات */
function guessDevice(): string {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return "آيفون";
  if (/ipad/i.test(ua)) return "آيباد";
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? "موبايل أندرويد" : "تاب أندرويد";
  if (/windows/i.test(ua)) return "ويندوز";
  if (/mac/i.test(ua)) return "ماك";
  return "جهاز";
}

/**
 * نغمة توصّل — بتشتغل لما التطبيق **مفتوح**.
 * لما يكون مقفول، نغمة النظام العادية بتشتغل لوحدها.
 * نغمتين سريعتين (لا ثم مي) — مميّزة ومش مزعجة.
 */
export function playChime(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    [
      { f: 880, t: 0 },
      { f: 1318.5, t: 0.13 },
    ].forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.3);
    });
    setTimeout(() => void ctx.close().catch(() => null), 700);
  } catch {
    /* الصوت مش حرج — لو المتصفح رافض، الإشعار نفسه وصل */
  }
}
