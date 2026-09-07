/**
 * ============================================================
 *  إشعارات الدفع (Web Push) — فون · لاب · تاب
 * ------------------------------------------------------------
 *  نفس نمط src/lib/whatsapp.ts: محروس بالبيئة، ومابيرميش
 *  استثناء لبرّه — فشل الإشعار عمره ما يوقّع عملية شغل.
 *
 *  ⚠️ **الخصوصية**: محتوى الإشعار بيظهر على شاشة القفل وفي
 *     سجلات النظام. القاعدة زي ما هي مكتوبة في inappNotify:
 *     أرقام مكسب الشركة ماتتبعتش للتاجر. الرسالة هنا مختصرة
 *     (عنوان + معرّف)، والتفاصيل تتقرا من التطبيق نفسه.
 *
 *  المفاتيح (VAPID): `npm run vapid` بيولّدهم. العام في
 *  NEXT_PUBLIC_VAPID_PUBLIC_KEY والخاص في VAPID_PRIVATE_KEY —
 *  **الخاص سر، إنت اللي بتحطه في Coolify**.
 * ============================================================
 */
import webpush from "web-push";

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  /** العنوان — بيظهر تحت اسم «توصّل» في تراي الإشعارات */
  title: string;
  body: string;
  /** الرابط اللي بيتفتح لما يدوس — لازم يبدأ بـ/ */
  url?: string;
  /** اسم الحدث — بيتجمّع بيه الإشعار المتكرر لنفس الشحنة */
  tag?: string;
  /** مهم؟ يقعد فوق لحد ما يتقرا بدل ما يختفي لوحده */
  urgent?: boolean;
}

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const subject = process.env.VAPID_SUBJECT ?? "mailto:support@tewsal.online";

let configured = false;
if (publicKey && privateKey) {
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch {
    // مفاتيح بشكل غلط — بنعتبر الخدمة مش متظبطة بدل ما نقع
    configured = false;
  }
}

/** الدفع متظبط؟ لو لأ، كل حاجة تحت بترجع من غير ما تعمل حاجة. */
export function isPushConfigured(): boolean {
  return configured;
}

export function vapidPublicKey(): string {
  return publicKey;
}

/** نتيجة إرسال لجهاز واحد */
export interface PushResult {
  subscriptionId: string;
  ok: boolean;
  /** true لو الاشتراك مات ولازم يتشال من القاعدة (404/410) */
  gone: boolean;
}

/**
 * بيبعت لجهاز واحد. **مابيرميش استثناء** — بيرجّع النتيجة.
 * المستدعي هو اللي بيقرّر يشيل الميت ولا لأ.
 */
export async function sendToSubscription(
  sub: PushSubscriptionRow,
  payload: PushPayload
): Promise<PushResult> {
  if (!configured) return { subscriptionId: sub.id, ok: false, gone: false };
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 } // ١٢ ساعة — بعدها الإشعار بقى قديم مايستاهلش
    );
    return { subscriptionId: sub.id, ok: true, gone: false };
  } catch (err) {
    // 404 = الاشتراك مش موجود · 410 = اتلغى. غير كده مشكلة مؤقتة.
    const status = (err as { statusCode?: number })?.statusCode;
    const gone = status === 404 || status === 410;
    if (!gone) {
      console.error("[push] فشل الإرسال:", status ?? "?", err instanceof Error ? err.message : err);
    }
    return { subscriptionId: sub.id, ok: false, gone };
  }
}

/** بيبعت لكل أجهزة المستلمين على التوازي. بيرجّع النتايج للتنضيف. */
export async function sendToSubscriptions(
  subs: PushSubscriptionRow[],
  payload: PushPayload
): Promise<PushResult[]> {
  if (!configured || subs.length === 0) return [];
  return Promise.all(subs.map((s) => sendToSubscription(s, payload)));
}
