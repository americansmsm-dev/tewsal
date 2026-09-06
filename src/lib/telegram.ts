/**
 * ============================================================
 *  مزوّد تليجرام — Telegram Bot API
 * ------------------------------------------------------------
 *  بيستخدم في تسليم النسخ الاحتياطية لقناة خاصة + تنبيهات
 *  التشغيل. لو المتغيرات مش متضبطة بيرجّع false ومابيرميش —
 *  نفس نمط مزوّد واتساب بالظبط.
 *
 *  محتاج: TELEGRAM_BOT_TOKEN (من @BotFather)
 *         TELEGRAM_CHAT_ID   (معرّف القناة/المجموعة، والبوت
 *                             لازم يكون مشرف فيها)
 *
 *  ⚠️ حدود Telegram Bot API: الرسالة ٤٠٩٦ حرف،
 *     التعليق على الملف ١٠٢٤ حرف، وحجم الملف **٥٠ ميجا**.
 * ============================================================
 */
import { basename } from "node:path";
import { openAsBlob, readFileSync } from "node:fs";

/** أقصى حجم ملف يقبله Telegram Bot API */
export const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;
/** بنسيب هامش أمان تحت الحد */
export const TELEGRAM_SAFE_BYTES = 45 * 1024 * 1024;

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function api(method: string): string {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

/** يقص النص لحد معيّن من غير ما يكسر الرسالة */
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

/**
 * يبعت رسالة نصية للقناة. بيرمي خطأ لو تليجرام رفض.
 * (المنادي بيتحقق بـ isTelegramConfigured الأول.)
 */
export async function sendTelegramMessage(text: string): Promise<{ messageId: number }> {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: clip(text, 4096),
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`تليجرام رفض الرسالة (${res.status}): ${err.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { result?: { message_id: number } };
  return { messageId: json.result?.message_id ?? 0 };
}

/**
 * يبعت ملف للقناة. بيستخدم openAsBlob عشان مايحمّلش الملف كله
 * في الذاكرة (النسخة الاحتياطية ممكن تكون عشرات الميجات).
 */
export async function sendTelegramDocument(
  filePath: string,
  caption: string
): Promise<{ messageId: number }> {
  const form = new FormData();
  form.append("chat_id", String(process.env.TELEGRAM_CHAT_ID));
  form.append("caption", clip(caption, 1024));

  // openAsBlob بيقرا الملف تدريجيًا؛ لو مش متاح بنرجع للقراءة الكاملة
  let blob: Blob;
  try {
    blob = await openAsBlob(filePath);
  } catch {
    blob = new Blob([readFileSync(filePath)]);
  }
  form.append("document", blob, basename(filePath));

  const res = await fetch(api("sendDocument"), { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`تليجرام رفض الملف (${res.status}): ${err.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { result?: { message_id: number } };
  return { messageId: json.result?.message_id ?? 0 };
}

/**
 * تنبيه فشل — بيحاول يبعت ومابيرميش أبدًا (عشان مايخفيش
 * الخطأ الأصلي). بيرجّع true لو وصل.
 */
export async function tryTelegramAlert(text: string): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  try {
    await sendTelegramMessage(text);
    return true;
  } catch {
    return false;
  }
}
