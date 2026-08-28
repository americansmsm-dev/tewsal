/**
 * ============================================================
 *  رقم البوليصة — AWB (Air Waybill)
 * ------------------------------------------------------------
 *  الصيغة: T + سنتين + 8 أرقام + رقم تحقق
 *  مثال:   T26000142839
 *          │ │  │        └─ رقم التحقق (Luhn mod-10)
 *          │ │  └────────── التسلسل (من SEQUENCE في قاعدة البيانات)
 *          │ └───────────── السنة (26 = 2026)
 *          └─────────────── ثابت
 *
 *  ⚠️ التسلسل لازم ييجي من Postgres SEQUENCE — مش MAX()+1
 *     ولا عدّاد في الكود. ده اللي بيمنع البوالص المكررة
 *     وقت الإنشاء المتزامن أو بعد استرجاع نسخة احتياطية.
 *
 *  رقم التحقق بيرفض الأرقام المكتوبة أو الممسوحة غلط قبل
 *  ما تعمل سجل وهمي في السيستم.
 * ============================================================
 */

export const AWB_PREFIX = "T";
export const AWB_SEQ_DIGITS = 8;
/** الطول الكامل: T(1) + سنة(2) + تسلسل(8) + تحقق(1) = 12 */
export const AWB_LENGTH = 1 + 2 + AWB_SEQ_DIGITS + 1;

/**
 * حساب رقم التحقق بخوارزمية Luhn (mod-10).
 * نفس الخوارزمية بتاعة كروت الائتمان — بتكشف:
 *  - أي رقم واحد غلط
 *  - أغلب حالات تبديل رقمين متجاورين (أشهر غلطة في الكتابة اليدوي)
 */
export function luhnCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) {
    throw new Error(`أرقام غير صالحة لحساب رقم التحقق: "${digits}"`);
  }
  let sum = 0;
  let double = true; // بنبدأ من اليمين، وأول رقم بيتضاعف
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * بناء رقم بوليصة كامل من التسلسل.
 * @param sequence الرقم الجاي من Postgres SEQUENCE
 * @param year السنة الميلادية (افتراضي: السنة الحالية)
 */
export function buildAwb(sequence: number | bigint, year?: number): string {
  const seq = BigInt(sequence);
  if (seq <= 0n) throw new Error("تسلسل البوليصة لازم يكون أكبر من صفر");

  const yy = String((year ?? new Date().getFullYear()) % 100).padStart(2, "0");
  const seqStr = seq.toString().padStart(AWB_SEQ_DIGITS, "0");

  if (seqStr.length > AWB_SEQ_DIGITS) {
    throw new Error(
      `التسلسل تعدى ${AWB_SEQ_DIGITS} خانات (${seqStr}) — محتاج توسيع الصيغة`
    );
  }

  const body = yy + seqStr;
  return `${AWB_PREFIX}${body}${luhnCheckDigit(body)}`;
}

/**
 * التحقق من صحة رقم بوليصة.
 * بيتنده عند كل مسح وكل بحث — بيرفض الغلط قبل ما يوصل قاعدة البيانات.
 */
export function isValidAwb(awb: string): boolean {
  const s = awb.trim().toUpperCase();
  if (s.length !== AWB_LENGTH) return false;
  if (!s.startsWith(AWB_PREFIX)) return false;

  const rest = s.slice(1);
  if (!/^\d+$/.test(rest)) return false;

  const body = rest.slice(0, -1);
  const check = rest.charCodeAt(rest.length - 1) - 48;
  return luhnCheckDigit(body) === check;
}

/**
 * تنظيف مدخل المستخدم أو الماسح لصيغة موحّدة.
 * الماسحات أحيانًا بتضيف مسافات أو أسطر، والمستخدم بيكتب بحروف صغيرة.
 * وبنحوّل الأرقام العربية للاتينية عشان الكتابة من كيبورد عربي تشتغل.
 */
export function normalizeAwb(input: string): string {
  return input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-_.]/g, "")
    .toUpperCase();
}

/** استخراج السنة والتسلسل من رقم بوليصة صالح */
export function parseAwb(awb: string): { year: number; sequence: number } | null {
  const s = normalizeAwb(awb);
  if (!isValidAwb(s)) return null;
  const yy = Number(s.slice(1, 3));
  const seq = Number(s.slice(3, 3 + AWB_SEQ_DIGITS));
  // نفترض القرن الحالي — السيستم مش هيعيش لـ 2100
  return { year: 2000 + yy, sequence: seq };
}
