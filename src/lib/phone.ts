/**
 * ============================================================
 *  أرقام التليفونات المصرية
 * ------------------------------------------------------------
 *  الأرقام بتوصل بأشكال كتير من الفورم والـ Excel والـ API:
 *    +20 100 123 4567 · 0020100... · 100... · ٠١٠٠١٢٣٤٥٦٧ · 010-012-34567
 *
 *  رقم غلط = شحنة متعذّرة = رسوم مرتجع = خلاف مع التاجر.
 *  عشان كده فيه دالة تطبيع واحدة بس، بتتنده من:
 *    - فورم إنشاء الشحنة
 *    - استيراد Excel
 *    - الـ API والتكاملات
 *  عشان القاعدة تبقى واحدة في كل مكان.
 * ============================================================
 */

/** الصيغة المعتمدة في قاعدة البيانات: 01XXXXXXXXX (11 رقم) */
export const EGYPT_MOBILE_LENGTH = 11;

/** بادئات المحمول المصرية الصالحة */
export const VALID_PREFIXES = ["010", "011", "012", "015"] as const;

/** تحويل الأرقام العربية والفارسية للاتينية */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * تطبيع رقم موبايل مصري للصيغة 01XXXXXXXXX.
 * بيرجّع null لو الرقم مش صالح — **مش** بيرمي خطأ، عشان
 * الاستيراد يقدر يجمع الأخطاء صف بصف ويعرضها للتاجر مرة واحدة.
 *
 * normalizeEgyptMobile("+20 100 123 4567") === "01001234567"
 * normalizeEgyptMobile("٠١٠٠١٢٣٤٥٦٧")      === "01001234567"
 * normalizeEgyptMobile("0123")             === null
 */
export function normalizeEgyptMobile(input: string | null | undefined): string | null {
  if (!input) return null;

  // أرقام لاتينية + شيل أي حاجة مش رقم
  let d = toLatinDigits(String(input)).replace(/\D/g, "");
  if (!d) return null;

  // شيل كود الدولة بكل أشكاله
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length > EGYPT_MOBILE_LENGTH) d = d.slice(2);

  // ضيف الصفر لو ناقص (المستخدم كتب 1001234567)
  if (d.length === EGYPT_MOBILE_LENGTH - 1 && d.startsWith("1")) d = "0" + d;

  if (d.length !== EGYPT_MOBILE_LENGTH) return null;
  if (!VALID_PREFIXES.some((p) => d.startsWith(p))) return null;

  return d;
}

/** هل الرقم صالح؟ */
export function isValidEgyptMobile(input: string | null | undefined): boolean {
  return normalizeEgyptMobile(input) !== null;
}

/**
 * الصيغة الدولية للواتساب: 201001234567 (بدون + ولا مسافات)
 * ده اللي wa.me بيحتاجه.
 */
export function toWhatsAppFormat(input: string): string | null {
  const n = normalizeEgyptMobile(input);
  return n ? "20" + n.slice(1) : null;
}

/** لينك واتساب جاهز، مع رسالة اختيارية */
export function whatsAppLink(phone: string, message?: string): string | null {
  const wa = toWhatsAppFormat(phone);
  if (!wa) return null;
  const base = `https://wa.me/${wa}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/**
 * تقنيع الرقم لصفحة التتبع العامة: 01001234567 -> 010****4567
 * عشان أي حد يجرّب أرقام بوالص عشوائية ميقدرش يجمع أرقام عملائك.
 */
export function maskPhone(phone: string): string {
  const n = normalizeEgyptMobile(phone);
  if (!n) return "***";
  return `${n.slice(0, 3)}****${n.slice(-4)}`;
}

/**
 * تقنيع الاسم لصفحة التتبع: "أحمد محمد علي" -> "أح*** م*** ع***"
 * بنسيب أول حرفين من كل كلمة عشان العميل يعرف إن دي شحنته،
 * من غير ما نكشف الاسم الكامل لأي حد.
 */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w : w.slice(0, 2) + "***"))
    .join(" ");
}

/** صيغة عرض مقروءة: 01001234567 -> 0100 123 4567 */
export function formatPhoneDisplay(phone: string): string {
  const n = normalizeEgyptMobile(phone);
  if (!n) return phone;
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}
